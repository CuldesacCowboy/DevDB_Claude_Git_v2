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

from .connection import PGConnection as DBConnection
from .s0050_marks_builder_sync import marks_builder_sync
from .s0100_lot_loader import lot_loader
from .s0200_date_actualizer import date_actualizer
from .s0205_building_group_sync import building_group_sync
from .s0250_lot_date_overrides import apply_lot_date_overrides
from .s0300_gap_fill_engine import gap_fill_engine, load_phase_delivery_dates
from .s0400_chronology_validator import chronology_validator, persist_violations
from .s0500_takedown_engine import takedown_engine
from .s0600_demand_generator import demand_generator
from .s0760_hc_bldr_date_projector import hc_bldr_date_projector
from .s0820_post_generation_chronology_guard import post_generation_chronology_guard
from .s0850_timing_expansion import load_build_lag_curves, timing_expansion
from .s0900_builder_assignment import builder_assignment, assign_real_lot_builders
from .s0950_spec_assignment import spec_assignment
from .s1000_demand_derived_date_writer import demand_derived_date_writer
from .s1050_real_lot_projections import write_real_lot_projections
from .s1100_persistence_writer import persistence_writer
from .s1200_ledger_aggregator import ledger_aggregator
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
    snapshot, residual_gaps = takedown_engine(conn, snapshot, dev_id)

    # S-06
    demand_series, needs_config = demand_generator(conn, dev_id, run_start_date)
    if needs_config:
        logger.warning(f"  WARNING: Dev {dev_id} has no sim_dev_params. No demand generated.")
        demand_series = pd.DataFrame(columns=["year", "month", "slots"])

    # S-0760
    snapshot = hc_bldr_date_projector(conn, snapshot, demand_series)

    # S-07 through S-0820: kernel planning pass
    frozen = build_frozen_input(conn, dev_id, snapshot, demand_series, sim_run_id)
    proposal = plan(frozen)
    if proposal.warnings:
        for w in proposal.warnings:
            logger.info(f"  {w}")

    # S-0850: derive date_cmp and date_cls from date_str via empirical lag curves
    temp_lots = timing_expansion(proposal.temp_lots, build_lag_curves, rng)

    # S-0820 (shell stage): discard temp lots with chronology violations post-expansion
    temp_lots, discarded_lots, guard_warnings = post_generation_chronology_guard(temp_lots)
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
