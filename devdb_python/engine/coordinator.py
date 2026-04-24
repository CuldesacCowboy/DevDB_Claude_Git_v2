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
    # ── kernel boundary ──
    # (demand_allocator, temp_lot_generator, building_group_enforcer run inside kernel)
    "timing_expansion",
    "post_gen_chronology_guard",
    "hc_bldr_date_projector",
    "d_bldr_date_projector",
    "tda_checkpoint_assigner",   # planned — not yet wired
    "tda_hc_enforcer",           # planned — not yet wired
    "builder_assignment",
    "demand_derived_date_writer",
    "persistence_writer",
    "real_lot_projections",
    "spec_assignment",
    "ledger_aggregator",
]

SUPPLY_SEQUENCE = [
    "locked_event_rebuilder",
    "placeholder_rebuilder",
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
from .post_gen_chronology_guard import post_generation_chronology_guard
from .timing_expansion import load_build_lag_curves, timing_expansion
from .builder_assignment import builder_assignment
from .real_lot_builder_assign import assign_real_lot_builders
from .spec_assignment import spec_assignment
from .demand_derived_date_writer import demand_derived_date_writer
from .real_lot_projections import write_real_lot_projections
from .persistence_writer import persistence_writer
from .ledger_aggregator import ledger_aggregator
from .p0050_placeholder_rebuilder import placeholder_rebuilder
from .p0100_actual_date_applicator import actual_date_applicator
from .p0200_dependency_resolver import dependency_resolver
from .p0300_constraint_urgency_ranker import constraint_urgency_ranker
from .p0400_delivery_date_assigner import delivery_date_assigner
from .p0500_eligibility_updater import eligibility_updater
from .p0600_phase_date_propagator import phase_date_propagator
from .p0700_lot_date_propagator import lot_date_propagator
from .p0800_sync_flag_writer import sync_flag_writer, load_phase_delivery_snapshot
from .p_pre_locked_event_rebuilder import locked_event_rebuilder
from kernel import plan, FrozenInput
from kernel.frozen_input_builder import build_frozen_input, load_builder_splits
import pandas as pd


def run_starts_pipeline(conn: DBConnection, dev_id: int,
                        sim_run_id: int, run_start_date: date,
                        builder_splits: dict,
                        build_lag_curves: dict,
                        rng: random.Random) -> tuple[list, bool, list]:
    """
    Run all starts pipeline modules in order for one development.
    Returns (temp_lots list, needs_config bool, residual_gaps list).
    """
    # S-01
    snapshot = lot_loader(conn, dev_id)

    # S-02
    snapshot = date_actualizer(conn, snapshot)

    # S-0205
    snapshot = building_group_sync(conn, snapshot)

    # S-0250: apply planning overrides (wins over MARKS actuals in engine)
    snapshot = apply_lot_date_overrides(conn, snapshot)

    # S-03
    phase_delivery_dates = load_phase_delivery_dates(conn, dev_id)
    snapshot = gap_fill_engine(snapshot, phase_delivery_dates)

    # S-04
    snapshot, violations, has_violations = chronology_validator(snapshot)
    if has_violations:
        vcount = len(violations) if hasattr(violations, '__len__') else violations.shape[0]
        logger.warning(f"  WARNING: {vcount} chronology violations in dev {dev_id}. Run continues.")
    persist_violations(conn, violations, dev_id, sim_run_id)

    # S-05
    horizon_days   = build_lag_curves.get("_scheduling_horizon_days", 0)
    hc_to_bldr_lag = build_lag_curves.get("_hc_to_bldr_lag_days", 16)
    snapshot, residual_gaps = takedown_engine(conn, snapshot, dev_id,
                                              scheduling_horizon_days=horizon_days,
                                              hc_to_bldr_lag_days=hc_to_bldr_lag)

    # S-06
    demand_series, needs_config = demand_generator(conn, dev_id, run_start_date)
    if needs_config:
        logger.warning(f"  WARNING: Dev {dev_id} has no sim_dev_params. No demand generated.")
        demand_series = pd.DataFrame(columns=["year", "month", "slots"])

    td_to_str_lag = build_lag_curves.get("_td_to_str_lag", 1)

    # S-07 through S-0820: kernel planning pass
    frozen = build_frozen_input(conn, dev_id, snapshot, demand_series, sim_run_id,
                                td_to_str_lag=td_to_str_lag)
    proposal = plan(frozen)
    if proposal.warnings:
        for w in proposal.warnings:
            logger.info(f"  {w}")

    # S-0850: derive date_cmp and date_cls from date_str via empirical lag curves
    temp_lots = timing_expansion(proposal.temp_lots, build_lag_curves, rng)

    # S-0820 (shell stage): discard temp lots with chronology violations post-expansion
    temp_lots, discarded_lots, guard_warnings = post_generation_chronology_guard(temp_lots)

    # S-0760: project BLDR/DIG/CMP/CLS for HC-held lots (runs after kernel — correct order)
    snapshot = hc_bldr_date_projector(conn, snapshot, demand_series,
                                      dev_id, run_start_date, td_to_str_lag,
                                      build_lag_curves=build_lag_curves, rng=rng)

    # Compute remaining demand for S-0770: deduct slots consumed by HC lot actual starts.
    # HC buildings draw on early demand positions (pre-hold) via the allocator, but their
    # actual starts land in the clamped BLDR year (e.g. 2028). That year's annual budget is
    # fully consumed by the HC buildings — deduct all demand slots in that year equal to the
    # HC start count. This prevents D-buildings from double-booking the same calendar year.
    # Deduction is applied month-by-month from the earliest month in the HC start year.
    has_tdh_proj_col = "date_td_hold_projected" in snapshot.columns
    has_tdp_col = "date_td_projected" in snapshot.columns
    hc_snap = (
        snapshot[
            (snapshot["date_td_hold_projected"].notna() if has_tdh_proj_col else False)
            & (snapshot["date_td_projected"].notna() if has_tdp_col else False)
            & snapshot["lot_source"].isin(["real", "pre"])
        ].copy()
        if has_tdh_proj_col and has_tdp_col
        else pd.DataFrame()
    )
    if not hc_snap.empty:
        hc_snap["_yr"] = pd.to_datetime(hc_snap["date_td_projected"]).dt.year
        hc_by_year = hc_snap.groupby("_yr").size().reset_index(name="hc_count")

        remaining_demand = demand_series.copy()
        for _, r in hc_by_year.iterrows():
            yr = int(r["_yr"])
            to_deduct = int(r["hc_count"])
            for idx in remaining_demand[remaining_demand["year"] == yr].index:
                if to_deduct <= 0:
                    break
                avail = int(remaining_demand.at[idx, "slots"])
                take = min(avail, to_deduct)
                remaining_demand.at[idx, "slots"] = avail - take
                to_deduct -= take

        remaining_demand = (
            remaining_demand[remaining_demand["slots"] > 0][["year", "month", "slots"]]
            .reset_index(drop=True)
        )
    else:
        remaining_demand = demand_series

    # S-0770: project BLDR/STR/CMP/CLS for D-status real lots (H-lots drain first per allocator)
    snapshot = d_bldr_date_projector(conn, snapshot, remaining_demand,
                                     dev_id, run_start_date, td_to_str_lag,
                                     build_lag_curves=build_lag_curves, rng=rng)
    for w in guard_warnings:
        logger.info(f"  {w}")
    if discarded_lots:
        logger.info(f"  S-0820: {len(discarded_lots)} temp lot(s) discarded for chronology violations.")

    # S-09
    temp_lots = builder_assignment(temp_lots, builder_splits)

    # S-10
    demand_derived_date_writer(conn, temp_lots)

    # S-11
    persistence_writer(conn, temp_lots, dev_id, sim_run_id, _proposal=proposal)

    # S-1050: write projected dates to real P lots at configured annual pace
    write_real_lot_projections(conn, dev_id, run_start_date, build_lag_curves, rng)

    # S-12
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

    # P-0050
    placeholder_rebuilder(conn, ent_group_id)

    # P-01
    locked = actual_date_applicator(conn, ent_group_id)

    # P-02
    sorted_queue, eligible_pool = dependency_resolver(conn, ent_group_id, locked)

    # P-03 through P-05: process eligible events until pool is empty
    resolved_events = []
    resolved_so_far = set(locked)

    while eligible_pool:
        # P-03
        ranked = constraint_urgency_ranker(conn, eligible_pool)
        if not ranked:
            break

        top_event = ranked[0]

        # P-04
        projected = delivery_date_assigner(conn, top_event, ent_group_id)
        if projected:
            resolved_events.append((top_event, projected))

        # P-05
        eligible_pool = eligibility_updater(conn, top_event, sorted_queue,
                                            eligible_pool, resolved_so_far)

    # P-06
    phase_date_propagator(conn, resolved_events)

    # P-07
    lot_date_propagator(conn, resolved_events)

    # S-12 (final refresh): rebuild ledger now that P-07 has written date_dev to lots
    ledger_aggregator(conn)

    post_run_phases = load_phase_delivery_snapshot(conn, ent_group_id)

    # P-08
    affected_devs = sync_flag_writer(conn, pre_run_phases, post_run_phases)

    return post_run_phases, affected_devs


def convergence_coordinator(ent_group_id: int, run_start_date: date = None,
                             max_iterations: int = 10,
                             rng_seed: int | None = None) -> int:
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

        # Load shared config once (does not change per iteration)
        builder_splits = load_builder_splits(conn)
        build_lag_curves = load_build_lag_curves(conn)

        # Inject default lag constants from community/global config into curves dict
        # so S-0850 and S-1050 can use them without signature changes.
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

        # S-0900 pre-pass: assign builder_id to real/pre lots not in MARKS (idempotent)
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

            # S-0950: assign is_spec to all NULL lots after S-1100 flushes sim lots
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
