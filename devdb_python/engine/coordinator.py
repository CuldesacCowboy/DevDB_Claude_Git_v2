"""
coordinator — Convergence coordinator: wires starts pipeline and supply pipeline.

Reads:   all tables read by child modules (delegates entirely)
Writes:  all tables written by child modules (delegates entirely)
Input:   ent_group_id: int, conn: DBConnection
Rules:   Runs per entitlement group. Alternates supply pipeline (P-modules) and
         starts pipeline (S-modules) until phase delivery dates stabilize.
         Max iterations: 10 (safety limit — normal convergence is 1-3).
         The coordinator stays dumb: run A, run B, check convergence, repeat.
         No domain logic here — all logic lives in the individual pipeline modules.
"""

import logging
import random
from datetime import date, timedelta

logger = logging.getLogger(__name__)

# ── Canonical execution order ────────────────────────────────────────────────
# Descriptive module names in the order they execute.
# This is the single source of truth for pipeline sequencing.

STARTS_SEQUENCE = [
    # Pre-loop (once per coordinator invocation)
    "marks_builder_sync",
    "real_lot_builder_assign",
    # Per-development (once per dev per iteration)
    "lot_loader",
    "date_actualizer",
    "building_group_sync",
    "lot_date_overrides",
    "gap_fill_engine",
    "chronology_validator",
    "tda_preclear",
    "demand_generator",
    "hc_bldr_date_projector",
    # ── _build_sim_demand: shift demand start + deduct HC starts ──
    # ── kernel boundary ──
    # (demand_allocator, temp_lot_generator, building_group_enforcer run inside kernel)
    "timing_expansion",
    "post_gen_chronology_guard",
    "d_bldr_date_projector",
    "tda_checkpoint_assigner",
    "tda_hc_enforcer",
    "builder_assignment",
    "demand_derived_date_writer",
    "persistence_writer",
    "real_lot_projections",
    "spec_assignment",
    "ledger_aggregator",
]

SUPPLY_SEQUENCE = [
    "locked_event_rebuilder",
    "placeholder_rebuilder",        # orchestrates: delivery_phase_collector → delivery_scheduler → delivery_event_writer
    "actual_date_applicator",
    "dependency_resolver",
    # ── event resolution loop ──
    "constraint_urgency_ranker",
    "delivery_date_assigner",
    "eligibility_updater",
    # ── end loop ──
    "phase_date_propagator",
    "lot_date_propagator",
    "sync_flag_writer",
]

from .connection import PGConnection as DBConnection
from .marks_builder_sync import marks_builder_sync
from .lot_loader import lot_loader
from .date_actualizer import date_actualizer
from .building_group_sync import building_group_sync
from .lot_date_overrides import apply_lot_date_overrides
from .gap_fill_engine import gap_fill_engine, load_phase_delivery_dates
from .chronology_validator import chronology_validator, persist_violations
from .tda_preclear import takedown_engine
from .demand_generator import demand_generator
from .hc_bldr_date_projector import hc_bldr_date_projector
from .d_bldr_date_projector import d_bldr_date_projector
from .tda_checkpoint_assigner import tda_checkpoint_assigner
from .tda_hc_enforcer import tda_hc_enforcer
from .post_gen_chronology_guard import post_generation_chronology_guard
from .timing_expansion import load_build_lag_curves, timing_expansion
from .builder_assignment import builder_assignment
from .real_lot_builder_assign import assign_real_lot_builders
from .spec_assignment import spec_assignment
from .demand_derived_date_writer import demand_derived_date_writer
from .real_lot_projections import write_real_lot_projections
from .persistence_writer import persistence_writer
from .ledger_aggregator import ledger_aggregator
from .placeholder_rebuilder import placeholder_rebuilder
from .actual_date_applicator import actual_date_applicator
from .dependency_resolver import dependency_resolver
from .constraint_urgency_ranker import constraint_urgency_ranker
from .delivery_date_assigner import delivery_date_assigner
from .eligibility_updater import eligibility_updater
from .phase_date_propagator import phase_date_propagator
from .lot_date_propagator import lot_date_propagator
from .sync_flag_writer import sync_flag_writer, load_phase_delivery_snapshot
from .locked_event_rebuilder import locked_event_rebuilder
from kernel import plan, FrozenInput
from kernel.frozen_input_builder import build_frozen_input, load_builder_splits
import pandas as pd


def _add_months(d: date, n: int) -> date:
    """Advance date d by n months (first of month)."""
    m = d.month + n
    y = d.year + (m - 1) // 12
    m = ((m - 1) % 12) + 1
    return d.replace(year=y, month=m, day=1)


def _build_sim_demand(conn, dev_id: int, run_start_date: date,
                      demand_series: pd.DataFrame, snapshot: pd.DataFrame,
                      needs_config: bool) -> pd.DataFrame:
    """
    Build the demand series for the kernel (sim lot generation).
    Two adjustments vs raw demand_series:

    A) Shift demand start: if the earliest phase with sim capacity delivers
       AFTER run_start_date, regenerate demand from that delivery + 1 month.
       This prevents unfillable early demand months from producing deferred
       sim lots that pile into later years alongside HC starts.

    B) Deduct HC starts: HC lots (date_td_hold_projected + date_td_projected set)
       have already been projected by hc_bldr_date_projector. Deduct their
       projected start months from the demand so the kernel doesn't generate
       sim lots in months where HC lots are already starting.

    Returns a DataFrame [year, month, slots] ready for the kernel.
    """
    if needs_config or demand_series.empty:
        return demand_series

    # ── A) Determine earliest sim supply ────────────────────────────────
    # Query phases with sim capacity (projected - real > 0)
    phase_df = conn.read_df("""
        SELECT sdp.phase_id,
               COALESCE(sdp.date_dev_projected, sdp.date_dev_actual) AS delivery,
               sps.projected_count,
               COALESCE(rc.real_count, 0) AS real_count
        FROM sim_phase_product_splits sps
        JOIN sim_dev_phases sdp ON sps.phase_id = sdp.phase_id
        LEFT JOIN (
            SELECT phase_id, COUNT(*) AS real_count
            FROM sim_lots
            WHERE dev_id = %s AND lot_source = 'real'
            GROUP BY phase_id
        ) rc ON rc.phase_id = sps.phase_id
        WHERE sdp.dev_id = %s
    """, (dev_id, dev_id))

    sim_phases = phase_df[
        (phase_df["projected_count"] - phase_df["real_count"]) > 0
    ]
    if not sim_phases.empty:
        deliveries = sim_phases["delivery"].dropna()
        if not deliveries.empty:
            earliest_delivery = pd.Timestamp(deliveries.min()).date()
            earliest_sim_start = _add_months(earliest_delivery, 1)
        else:
            earliest_sim_start = run_start_date
    else:
        earliest_sim_start = run_start_date

    effective_start = max(run_start_date, earliest_sim_start)

    if effective_start > run_start_date:
        logger.info(f"  _build_sim_demand: dev {dev_id} — shifting demand start "
                     f"from {run_start_date} to {effective_start} "
                     f"(earliest sim supply)")
        sim_demand, _ = demand_generator(conn, dev_id, effective_start)
    else:
        sim_demand = demand_series.copy()

    # ── B) Deduct HC projected starts at month level ────────────────────
    has_tdh_proj = "date_td_hold_projected" in snapshot.columns
    has_tdp = "date_td_projected" in snapshot.columns

    if has_tdh_proj and has_tdp:
        hc_snap = snapshot[
            snapshot["date_td_hold_projected"].notna()
            & snapshot["date_td_projected"].notna()
            & snapshot["lot_source"].isin(["real", "pre"])
        ].copy()
    else:
        hc_snap = pd.DataFrame()

    if not hc_snap.empty:
        # Group HC starts by (year, month) of their projected start
        hc_snap["_str_proj"] = pd.to_datetime(
            hc_snap["date_td_projected"]
        ).apply(lambda d: _add_months(d.date(), 1) if pd.notna(d) else None)
        hc_snap = hc_snap[hc_snap["_str_proj"].notna()]
        hc_snap["_yr"] = hc_snap["_str_proj"].apply(lambda d: d.year)
        hc_snap["_mo"] = hc_snap["_str_proj"].apply(lambda d: d.month)

        hc_by_month = (
            hc_snap.groupby(["_yr", "_mo"]).size()
            .reset_index(name="hc_count")
        )

        # Determine the first month in sim_demand — HC starts before this
        # month don't compete with sim lots and need no deduction.
        if not sim_demand.empty:
            first_yr = int(sim_demand.iloc[0]["year"])
            first_mo = int(sim_demand.iloc[0]["month"])
        else:
            first_yr, first_mo = 9999, 1

        for _, r in hc_by_month.iterrows():
            yr, mo, to_deduct = int(r["_yr"]), int(r["_mo"]), int(r["hc_count"])

            # Skip HC months that fall before the sim demand start — the demand
            # shift already accounted for no supply in those early months.
            if (yr, mo) < (first_yr, first_mo):
                continue

            # Deduct from the exact demand month first. If that month has
            # fewer slots than HC lots, spill to the nearest LATER demand
            # month (HC lot starting in Apr means one fewer sim lot can start
            # in Apr or soon after).
            mask = (sim_demand["year"] == yr) & (sim_demand["month"] == mo)
            for idx in sim_demand[mask].index:
                if to_deduct <= 0:
                    break
                avail = int(sim_demand.at[idx, "slots"])
                take = min(avail, to_deduct)
                sim_demand.at[idx, "slots"] = avail - take
                to_deduct -= take
            # Spillover to next available months AFTER the HC month
            if to_deduct > 0:
                later = sim_demand[
                    (sim_demand["year"] > yr)
                    | ((sim_demand["year"] == yr) & (sim_demand["month"] > mo))
                ]
                for idx in later.index:
                    if to_deduct <= 0:
                        break
                    avail = int(sim_demand.at[idx, "slots"])
                    take = min(avail, to_deduct)
                    sim_demand.at[idx, "slots"] = avail - take
                    to_deduct -= take

        sim_demand = (
            sim_demand[sim_demand["slots"] > 0][["year", "month", "slots"]]
            .reset_index(drop=True)
        )
        logger.info(f"  _build_sim_demand: dev {dev_id} — deducted {len(hc_snap)} "
                     f"HC starts, {int(sim_demand['slots'].sum())} sim demand remaining")

    return sim_demand


def run_starts_pipeline(conn: DBConnection, dev_id: int,
                        sim_run_id: int, run_start_date: date,
                        builder_splits: dict,
                        build_lag_curves: dict,
                        rng: random.Random) -> tuple[list, bool, list]:
    """
    Run all starts pipeline modules in order for one development.
    Returns (temp_lots list, needs_config bool, residual_gaps list).
    """
    # lot_loader
    snapshot = lot_loader(conn, dev_id)

    # date_actualizer
    snapshot = date_actualizer(conn, snapshot)

    # building_group_sync
    snapshot = building_group_sync(conn, snapshot)

    # lot_date_overrides: apply planning overrides (wins over MARKS actuals in engine)
    snapshot = apply_lot_date_overrides(conn, snapshot)

    # gap_fill_engine
    phase_delivery_dates = load_phase_delivery_dates(conn, dev_id)
    snapshot = gap_fill_engine(snapshot, phase_delivery_dates)

    # chronology_validator
    snapshot, violations, has_violations = chronology_validator(snapshot)
    if has_violations:
        vcount = len(violations) if hasattr(violations, '__len__') else violations.shape[0]
        logger.warning(f"  WARNING: {vcount} chronology violations in dev {dev_id}. Run continues.")
    persist_violations(conn, violations, dev_id, sim_run_id)

    # tda_preclear
    horizon_days   = build_lag_curves.get("_scheduling_horizon_days", 0)
    hc_to_bldr_lag = build_lag_curves.get("_hc_to_bldr_lag_days", 16)
    snapshot, residual_gaps = takedown_engine(conn, snapshot, dev_id,
                                              scheduling_horizon_days=horizon_days,
                                              hc_to_bldr_lag_days=hc_to_bldr_lag)

    # demand_generator
    demand_series, needs_config = demand_generator(conn, dev_id, run_start_date)
    if needs_config:
        logger.warning(f"  WARNING: Dev {dev_id} has no sim_dev_params. No demand generated.")
        demand_series = pd.DataFrame(columns=["year", "month", "slots"])

    td_to_str_lag = build_lag_curves.get("_td_to_str_lag", 1)

    # hc_bldr_date_projector: runs BEFORE kernel so HC starts can be deducted from
    # demand before sim lot generation.  Prevents double-counting where HC lots
    # claim demand slots they can't fill on time and sim lots pile into the same years.
    snapshot = hc_bldr_date_projector(conn, snapshot, demand_series,
                                      dev_id, run_start_date, td_to_str_lag,
                                      build_lag_curves=build_lag_curves, rng=rng)

    # Build sim_demand: the demand series the kernel will use for sim lot generation.
    # Two adjustments:
    #   A) Shift demand start to earliest achievable sim supply (first phase delivery
    #      with sim capacity). Prevents unfillable early demand from generating sim lots
    #      that defer into HC-heavy years and blow past the annual target.
    #   B) Deduct HC projected starts at the month level so sim lots don't double-book
    #      months where HC lots are already starting.
    sim_demand = _build_sim_demand(conn, dev_id, run_start_date, demand_series,
                                   snapshot, needs_config)

    # kernel through post_gen_chronology_guard: kernel planning pass.
    # Exclude HC lots from the kernel snapshot — they're already projected by
    # hc_bldr_date_projector and deducted from sim_demand. If included, the
    # kernel's allocator would assign them to sim demand slots again (double-count).
    has_tdh_proj_col = "date_td_hold_projected" in snapshot.columns
    has_tdp_col = "date_td_projected" in snapshot.columns
    hc_mask = (
        (snapshot["date_td_hold_projected"].notna() if has_tdh_proj_col else False)
        & (snapshot["date_td_projected"].notna() if has_tdp_col else False)
        & snapshot["date_td"].isna()
        & snapshot["date_str"].isna()
    )
    kernel_snapshot = snapshot[~hc_mask].copy() if hc_mask.any() else snapshot
    frozen = build_frozen_input(conn, dev_id, kernel_snapshot, sim_demand, sim_run_id,
                                td_to_str_lag=td_to_str_lag)
    proposal = plan(frozen)
    if proposal.warnings:
        for w in proposal.warnings:
            logger.info(f"  {w}")

    # timing_expansion: derive date_cmp and date_cls from date_str via empirical lag curves
    temp_lots = timing_expansion(proposal.temp_lots, build_lag_curves, rng)

    # post_gen_chronology_guard (shell stage): discard temp lots with chronology violations post-expansion
    temp_lots, discarded_lots, guard_warnings = post_generation_chronology_guard(temp_lots)

    # d_bldr_date_projector: project BLDR/STR/CMP/CLS for D-status real lots.
    # Uses sim_demand (already HC-deducted) so D-lots don't double-book HC months.
    snapshot = d_bldr_date_projector(conn, snapshot, sim_demand,
                                     dev_id, run_start_date, td_to_str_lag,
                                     build_lag_curves=build_lag_curves, rng=rng)
    for w in guard_warnings:
        logger.info(f"  {w}")
    if discarded_lots:
        logger.info(f"  post_gen_chronology_guard: {len(discarded_lots)} temp lot(s) discarded for chronology violations.")

    # tda_checkpoint_assigner: sort TDA lots by BLDR date, assign to checkpoints sequentially
    tda_checkpoint_assigner(conn, snapshot, dev_id)

    # tda_hc_enforcer: HC hold for lots whose BLDR date > checkpoint deadline
    snapshot = tda_hc_enforcer(conn, snapshot, dev_id,
                                hc_to_bldr_lag_days=hc_to_bldr_lag)

    # builder_assignment
    temp_lots = builder_assignment(temp_lots, builder_splits)

    # demand_derived_date_writer
    demand_derived_date_writer(conn, temp_lots)

    # persistence_writer
    persistence_writer(conn, temp_lots, dev_id, sim_run_id, _proposal=proposal)

    # real_lot_projections: write projected dates to real P lots at configured annual pace
    write_real_lot_projections(conn, dev_id, run_start_date, build_lag_curves, rng)

    # ledger_aggregator
    ledger_aggregator(conn)

    return temp_lots, needs_config, residual_gaps


def run_supply_pipeline(conn: DBConnection, ent_group_id: int) -> tuple:
    """
    Run all supply pipeline modules in order for the entitlement group.
    Returns (post_run_phases dict, affected_dev_ids list).
    """
    # P-pre: rebuild locked delivery events from sim_dev_phases.date_dev_actual
    locked_event_rebuilder(conn, ent_group_id)

    pre_run_phases = load_phase_delivery_snapshot(conn, ent_group_id)

    # placeholder_rebuilder
    placeholder_rebuilder(conn, ent_group_id)

    # actual_date_applicator
    locked = actual_date_applicator(conn, ent_group_id)

    # dependency_resolver
    sorted_queue, eligible_pool = dependency_resolver(conn, ent_group_id, locked)

    # constraint_urgency_ranker through eligibility_updater: process eligible events until pool is empty
    resolved_events = []
    resolved_so_far = set(locked)

    while eligible_pool:
        # constraint_urgency_ranker
        ranked = constraint_urgency_ranker(conn, eligible_pool)
        if not ranked:
            break

        top_event = ranked[0]

        # delivery_date_assigner
        projected = delivery_date_assigner(conn, top_event, ent_group_id)
        if projected:
            resolved_events.append((top_event, projected))

        # eligibility_updater
        eligible_pool = eligibility_updater(conn, top_event, sorted_queue,
                                            eligible_pool, resolved_so_far)

    # phase_date_propagator
    phase_date_propagator(conn, resolved_events)

    # lot_date_propagator
    lot_date_propagator(conn, resolved_events)

    # ledger_aggregator (final refresh): rebuild ledger now that P-07 has written date_dev to lots
    ledger_aggregator(conn)

    post_run_phases = load_phase_delivery_snapshot(conn, ent_group_id)

    # sync_flag_writer
    affected_devs = sync_flag_writer(conn, pre_run_phases, post_run_phases)

    return post_run_phases, affected_devs


def run_scenario_pipeline(conn, dev_id: int, run_start_date: date,
                          builder_splits: dict, build_lag_curves: dict,
                          rng: random.Random, sim_run_id: int,
                          dev_param_overrides: dict = None) -> list:
    """
    Simplified read-only pipeline for scenario mode.
    Reads lot snapshot, generates demand with overrides, runs kernel, returns temp_lots.
    Never writes to sim_lots or any base table.
    """
    # Load snapshot (read-only)
    snapshot = lot_loader(conn, dev_id)

    # Generate demand with overrides
    demand_series, needs_config = demand_generator(conn, dev_id, run_start_date,
                                                    dev_param_overrides=dev_param_overrides)
    if needs_config:
        logger.warning(f"  Scenario: Dev {dev_id} has no starts target. Skipping.")
        return []

    td_to_str_lag = build_lag_curves.get("_td_to_str_lag", 1)

    # Kernel planning pass
    frozen = build_frozen_input(conn, dev_id, snapshot, demand_series, sim_run_id,
                                td_to_str_lag=td_to_str_lag)
    proposal = plan(frozen)

    # Timing expansion (pure computation)
    temp_lots = timing_expansion(proposal.temp_lots, build_lag_curves, rng)

    # Post-gen chronology guard (pure computation)
    temp_lots, _, _ = post_generation_chronology_guard(temp_lots)

    # Builder assignment (pure computation)
    temp_lots = builder_assignment(temp_lots, builder_splits)

    return temp_lots


def convergence_coordinator(ent_group_id: int, run_start_date: date = None,
                             max_iterations: int = 10,
                             rng_seed: int | None = None,
                             overrides: dict = None) -> int:
    """
    Run starts and supply pipelines iteratively until delivery dates stabilize.
    Returns (iterations, missing_params_devs).

    rng_seed: explicit seed for the random number generator (test-time control).
              Default None uses a date-based seed (YYYYMMDD * 1000 + ent_group_id)
              for within-day reproducibility.
    """
    if run_start_date is None:
        run_start_date = date.today().replace(day=1)

    sim_run_id = int(date.today().strftime("%Y%m%d"))

    with DBConnection() as conn:
        dev_df = conn.read_df(
            """
            SELECT dev_id
            FROM sim_ent_group_developments
            WHERE ent_group_id = %s
            ORDER BY dev_id
            """,
            (ent_group_id,),
        )

        if dev_df.empty:
            logger.warning(f"No developments found for ent_group_id={ent_group_id}. Aborting.")
            return 0, set()

        dev_ids = [int(r) for r in dev_df["dev_id"]]
        logger.info(f"Convergence coordinator: ent_group_id={ent_group_id}, "
                    f"{len(dev_ids)} development(s): {dev_ids}")

        # ── Scenario mode: read-only, single pass, return temp_lots ──────
        if overrides is not None:
            builder_splits = load_builder_splits(conn)
            build_lag_curves = load_build_lag_curves(conn)
            from engine.config_loader import load_delivery_config
            ent_overrides = overrides.get("ent_group", {})
            _cfg = load_delivery_config(conn, ent_group_id, overrides=ent_overrides)
            build_lag_curves["_default_cmp"] = _cfg["default_cmp_lag_days"]
            build_lag_curves["_default_cls"] = _cfg["default_cls_lag_days"]
            build_lag_curves["_td_to_str_lag"] = _cfg["td_to_str_lag"]
            build_lag_curves["_scheduling_horizon_days"] = _cfg["scheduling_horizon_days"]
            build_lag_curves["_hc_to_bldr_lag_days"] = _cfg["hc_to_bldr_lag_days"]

            _seed = rng_seed if rng_seed is not None else sim_run_id * 1000 + ent_group_id
            rng = random.Random(_seed)

            all_scenario_lots = []
            for dev_id in dev_ids:
                dev_overrides = overrides.get("dev", {}).get(dev_id, None)
                temp_lots = run_scenario_pipeline(
                    conn, dev_id, run_start_date, builder_splits,
                    build_lag_curves, rng, sim_run_id,
                    dev_param_overrides=dev_overrides,
                )
                all_scenario_lots.extend(temp_lots)
                logger.info(f"  Scenario dev {dev_id}: {len(temp_lots)} temp lots")

            logger.info(f"Scenario complete: {len(all_scenario_lots)} total lots across {len(dev_ids)} dev(s)")
            return all_scenario_lots

        # ── Normal mode: full convergence loop ───────────────────────────
        # Load shared config once (does not change per iteration)
        builder_splits = load_builder_splits(conn)
        build_lag_curves = load_build_lag_curves(conn)

        # Inject default lag constants from community/global config into curves dict
        from engine.config_loader import load_delivery_config
        _cfg = load_delivery_config(conn, ent_group_id)
        build_lag_curves["_default_cmp"] = _cfg["default_cmp_lag_days"]
        build_lag_curves["_default_cls"] = _cfg["default_cls_lag_days"]
        build_lag_curves["_td_to_str_lag"] = _cfg["td_to_str_lag"]
        build_lag_curves["_scheduling_horizon_days"] = _cfg["scheduling_horizon_days"]
        build_lag_curves["_hc_to_bldr_lag_days"] = _cfg["hc_to_bldr_lag_days"]

        # Apply scheduling horizon floor to run_start_date.
        _horizon_days = _cfg["scheduling_horizon_days"]
        _horizon_first = (date.today() + timedelta(days=_horizon_days)).replace(day=1)
        if run_start_date < _horizon_first:
            run_start_date = _horizon_first

        # S-0050: apply MARKS builder_id from devdb_ext.housemaster (once per run)
        marks_builder_sync(conn, ent_group_id)

        # builder_assignment pre-pass: assign builder_id to real/pre lots not in MARKS (idempotent)
        assign_real_lot_builders(conn, ent_group_id, builder_splits)

        _seed = rng_seed if rng_seed is not None else sim_run_id * 1000 + ent_group_id
        rng = random.Random(_seed)

        missing_params_devs: set[int] = set()
        # Residual gaps from S-0500 — overwritten each iteration; final value
        # reflects the converged state and is returned to the caller.
        latest_residual_gaps: list[dict] = []

        for iteration in range(1, max_iterations + 1):
            logger.info(f"\n--- Iteration {iteration} ---")

            # Snapshot delivery event effective dates before this iteration.
            pre_df = conn.read_df(
                """
                SELECT COALESCE(date_dev_actual, date_dev_projected)::text AS effective_date
                FROM sim_delivery_events
                WHERE ent_group_id = %s
                """,
                (ent_group_id,),
            )

            # Step 1: Run starts pipeline for ALL developments
            iter_gaps: list[dict] = []
            for dev_id in dev_ids:
                logger.info(f"  Running starts pipeline for dev {dev_id}...")
                _, needs_config, dev_gaps = run_starts_pipeline(
                    conn, dev_id, sim_run_id, run_start_date,
                    builder_splits, build_lag_curves, rng,
                )
                if needs_config:
                    missing_params_devs.add(dev_id)
                iter_gaps.extend(dev_gaps)

            latest_residual_gaps = iter_gaps

            # spec_assignment: assign is_spec to all NULL lots after S-1100 flushes sim lots
            spec_assignment(conn, ent_group_id)

            # Step 2: Run supply pipeline
            logger.info(f"  Running supply pipeline for ent_group_id={ent_group_id}...")
            _, affected_devs = run_supply_pipeline(conn, ent_group_id)

            # Step 3: Convergence check — compare sorted effective date lists
            post_df = conn.read_df(
                """
                SELECT COALESCE(date_dev_actual, date_dev_projected)::text AS effective_date
                FROM sim_delivery_events
                WHERE ent_group_id = %s
                """,
                (ent_group_id,),
            )

            def _date_list(df) -> list[str]:
                return sorted(
                    str(r["effective_date"]) if r["effective_date"] is not None else "null"
                    for _, r in df.iterrows()
                )

            if _date_list(pre_df) == _date_list(post_df):
                logger.info(f"\nConvergence reached after {iteration} iteration(s).")
                return iteration, missing_params_devs, latest_residual_gaps

            logger.info(f"  Schedule changed. Re-running.")

    logger.warning(f"WARNING: Max iterations ({max_iterations}) reached without convergence.")
    return max_iterations, missing_params_devs, latest_residual_gaps
