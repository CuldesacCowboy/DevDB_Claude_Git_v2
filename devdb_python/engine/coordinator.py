# coordinator.py
# Convergence coordinator -- wires starts pipeline and supply pipeline.
# Runs per entitlement group.
# The coordinator stays dumb: run A, run B, check, repeat.
# No logic, no exception handling, no domain knowledge here.
# Max iterations: 10 (safety limit only -- normal convergence is 2-3).

from datetime import date, datetime

import pandas as pd

from .connection import PGConnection as DBConnection
from .s0100_lot_loader import lot_loader
from .s0200_date_actualizer import date_actualizer
from .s0300_gap_fill_engine import gap_fill_engine
from .s0400_chronology_validator import chronology_validator
from .s0500_takedown_engine import takedown_engine
from .s0600_demand_generator import demand_generator
from .s0900_builder_assignment import builder_assignment
from kernel import plan, FrozenInput
from kernel.frozen_input_builder import build_frozen_input
from .s1000_demand_derived_date_writer import demand_derived_date_writer
from .s1100_persistence_writer import persistence_writer
from .s1200_ledger_aggregator import ledger_aggregator
from .p0000_placeholder_rebuilder import placeholder_rebuilder
from .p0100_actual_date_applicator import actual_date_applicator
from .p0200_dependency_resolver import dependency_resolver
from .p0300_constraint_urgency_ranker import constraint_urgency_ranker
from .p0400_delivery_date_assigner import delivery_date_assigner
from .p0500_eligibility_updater import eligibility_updater
from .p0600_phase_date_propagator import phase_date_propagator
from .p0700_lot_date_propagator import lot_date_propagator
from .p0800_sync_flag_writer import sync_flag_writer


def _load_phase_capacity(conn: DBConnection, projection_group_id: int) -> list:
    """
    Load sim_phase_product_splits joined with date_dev_projected and real lot counts.
    Scoped to phases belonging to the development that owns this projection group
    (sdp.dev_id = dim_projection_groups.dev_id for this PG).
    Includes dev_id from sim_dev_phases so the coordinator can build the correct
    (dev_id, lot_type_id) -> projection_group_id map via dim_projection_groups.
    Returns list of dicts with phase_id, dev_id, lot_type_id, available_slots, date_dev.
    """
    df = conn.read_df(f"""
        SELECT
            sps.phase_id,
            sdp.dev_id,
            sps.lot_type_id,
            sps.lot_count,
            sdp.date_dev_projected,
            COALESCE(real.real_count, 0) AS real_lot_count
        FROM sim_phase_product_splits sps
        JOIN sim_dev_phases sdp ON sps.phase_id = sdp.phase_id
        LEFT JOIN (
            SELECT phase_id, lot_type_id, COUNT(*) AS real_count
            FROM sim_lots
            WHERE projection_group_id = {projection_group_id}
              AND lot_source = 'real'
            GROUP BY phase_id, lot_type_id
        ) real ON sps.phase_id = real.phase_id AND sps.lot_type_id = real.lot_type_id
        WHERE sdp.dev_id = (
            SELECT dev_id FROM dim_projection_groups
            WHERE projection_group_id = {projection_group_id}
        )
        ORDER BY sdp.sequence_number ASC, sdp.phase_id ASC
    """)

    result = []
    for _, row in df.iterrows():
        available = int(row["lot_count"]) - int(row["real_lot_count"])
        if available > 0:
            d = row["date_dev_projected"]
            if d is not None and hasattr(d, 'date'):
                d = d.date()
            result.append({
                "phase_id":      int(row["phase_id"]),
                "dev_id":        int(row["dev_id"]),
                "lot_type_id":   int(row["lot_type_id"]),
                "available_slots": available,
                "date_dev":      d,
            })
    return result


def _build_lot_type_pg_map(conn: DBConnection, phase_capacity: list) -> dict:
    """
    Build {(dev_id, phase_lot_type_id): projection_group_id} via the correct join:
      sim_phase_product_splits.lot_type_id
        -> ref_lot_types.proj_lot_type_group_id  (bridges phase type to PG type)
        -> dim_projection_groups.lot_type_id -> projection_group_id

    Phase lot types (e.g. 101=SF) and PG lot types (e.g. 201=SF-PG) are distinct
    but share the same proj_lot_type_group_id in ref_lot_types. A flat
    (dev_id, lot_type_id) lookup against dim_projection_groups would fail because
    dim_projection_groups carries the PG-level type, not the phase-level type.

    Key is (dev_id, phase_lot_type_id) so the same phase lot type in different
    developments resolves to distinct projection groups.
    """
    if not phase_capacity:
        return {}

    pairs = {(pc["dev_id"], pc["lot_type_id"]) for pc in phase_capacity}
    conditions = " OR ".join(
        f"(sdp.dev_id = {dev_id} AND sps.lot_type_id = {lt_id})"
        for dev_id, lt_id in pairs
    )
    df = conn.read_df(f"""
        SELECT DISTINCT sdp.dev_id, sps.lot_type_id AS phase_lot_type_id,
               dpg.projection_group_id
        FROM sim_dev_phases sdp
        JOIN sim_phase_product_splits sps ON sdp.phase_id = sps.phase_id
        JOIN ref_lot_types rlt_phase ON sps.lot_type_id = rlt_phase.lot_type_id
        JOIN dim_projection_groups dpg ON sdp.dev_id = dpg.dev_id
        JOIN ref_lot_types rlt_pg
          ON dpg.lot_type_id = rlt_pg.lot_type_id
          AND rlt_phase.proj_lot_type_group_id = rlt_pg.proj_lot_type_group_id
        WHERE {conditions}
    """)

    return {
        (int(r["dev_id"]), int(r["phase_lot_type_id"])): int(r["projection_group_id"])
        for _, r in df.iterrows()
    }


def _load_builder_splits(conn: DBConnection) -> dict:
    """
    Load sim_phase_builder_splits as {phase_id: [{builder_id, share}, ...]}.
    """
    df = conn.read_df("""
        SELECT phase_id, builder_id, share
        FROM sim_phase_builder_splits
    """)
    splits = {}
    for _, r in df.iterrows():
        pid = int(r["phase_id"])
        if pid not in splits:
            splits[pid] = []
        splits[pid].append({"builder_id": int(r["builder_id"]),
                             "share": r["share"]})
    return splits


def _load_phase_delivery_dates(conn: DBConnection, projection_group_id: int) -> dict:
    """
    Load {phase_id: date} for all phases associated with lots in this projection group.
    Used by S-03 no-anchor fallback (Scenario 7): lots with zero milestone dates
    get date_dev = phase delivery date as anchor.
    """
    df = conn.read_df(f"""
        SELECT DISTINCT sdp.phase_id, sdp.date_dev_projected
        FROM sim_dev_phases sdp
        WHERE sdp.phase_id IN (
            SELECT DISTINCT phase_id FROM sim_lots
            WHERE projection_group_id = {projection_group_id}
              AND lot_source = 'real'
        )
    """)
    result = {}
    for _, r in df.iterrows():
        d = r["date_dev_projected"]
        if d is not None and hasattr(d, 'date'):
            d = d.date()
        result[int(r["phase_id"])] = d
    return result


def _persist_violations(conn: DBConnection, violations_df, projection_group_id: int,
                        sim_run_id: int) -> None:
    """
    Clear stale violations for this projection group, then write current violations
    from S-04 to sim_lot_date_violations.
    resolution = 'pending' for all new rows (Path A/B UI resolution deferred).
    """
    # Clear stale violations scoped to this projection group's lots
    conn.execute(f"""
        DELETE FROM sim_lot_date_violations
        WHERE lot_id IN (
            SELECT lot_id FROM sim_lots
            WHERE projection_group_id = {projection_group_id}
        )
    """)

    if violations_df is None or (hasattr(violations_df, 'empty') and violations_df.empty):
        return

    max_id_df = conn.read_df(
        "SELECT COALESCE(MAX(violation_id), 0) AS max_id FROM sim_lot_date_violations"
    )
    max_vid = int(max_id_df.iloc[0]["max_id"])
    now = datetime.utcnow()

    rows = []
    for i, (_, vrow) in enumerate(violations_df.iterrows()):
        ev = vrow["date_value_early"]
        lv = vrow["date_value_late"]
        rows.append({
            "violation_id":     max_vid + i + 1,
            "sim_run_id":       sim_run_id,
            "lot_id":           int(vrow["lot_id"]),
            "violation_type":   vrow["violation_type"],
            "date_field_early": vrow["date_field_early"],
            "date_value_early": ev.date() if hasattr(ev, 'date') and callable(ev.date) else ev,
            "date_field_late":  vrow["date_field_late"],
            "date_value_late":  lv.date() if hasattr(lv, 'date') and callable(lv.date) else lv,
            "resolution":       "pending",
            "created_at":       now,
        })

    conn.executemany_insert("sim_lot_date_violations", rows)
    print(f"  S-04: Persisted {len(rows)} violation(s) for PG {projection_group_id} "
          f"(sim_run_id={sim_run_id}).")


def run_starts_pipeline(conn: DBConnection, projection_group_id: int,
                        sim_run_id: int, run_start_date: date,
                        builder_splits: dict) -> list:
    """
    Run all 12 starts pipeline modules in order for one projection group.
    Coordinator calls this once per PG per iteration.
    Returns temp_lots list.
    """
    # S-01
    snapshot = lot_loader(conn, projection_group_id)

    # S-02
    snapshot = date_actualizer(conn, snapshot)

    # S-03 (load phase delivery dates for no-anchor fallback, Scenario 7)
    phase_delivery_dates = _load_phase_delivery_dates(conn, projection_group_id)
    snapshot = gap_fill_engine(snapshot, phase_delivery_dates)

    # S-04
    snapshot, violations, has_violations = chronology_validator(snapshot)
    if has_violations:
        vcount = len(violations) if hasattr(violations, '__len__') else violations.shape[0]
        print(f"  WARNING: {vcount} chronology violations in PG {projection_group_id}. Run continues.")
    _persist_violations(conn, violations, projection_group_id, sim_run_id)

    # S-05
    snapshot, residual_gaps = takedown_engine(conn, snapshot, projection_group_id)

    # S-06
    demand_series, needs_config = demand_generator(conn, projection_group_id, run_start_date)
    if needs_config:
        print(f"  WARNING: PG {projection_group_id} has no sim_projection_params. No demand generated.")
        demand_series = []

    # S-07 through S-0820: kernel planning pass
    frozen = build_frozen_input(
        conn, projection_group_id, snapshot, demand_series, sim_run_id
    )

    proposal = plan(frozen)
    if proposal.warnings:
        for w in proposal.warnings:
            print(f"  {w}")

    # Resume shell — S-0900 receives proposal.temp_lots
    temp_lots = proposal.temp_lots

    # S-09
    temp_lots = builder_assignment(temp_lots, builder_splits)

    # S-10
    demand_derived_date_writer(conn, temp_lots)

    # S-11
    persistence_writer(conn, temp_lots, projection_group_id, sim_run_id,
                       _proposal=proposal)

    # S-12
    ledger_aggregator(conn)

    return temp_lots


def run_supply_pipeline(conn: DBConnection, ent_group_id: int) -> tuple:
    """
    Run all 8 supply pipeline modules in order for the entitlement group.
    Returns (post_run_phases dict, affected_pg_ids list).
    """
    # Snapshot pre-run delivery dates -- scoped to phases in this ent_group
    pre_df = conn.read_df(f"""
        SELECT DISTINCT sdp.phase_id, sdp.date_dev_projected
        FROM sim_dev_phases sdp
        JOIN sim_delivery_event_phases dep ON sdp.phase_id = dep.phase_id
        JOIN sim_delivery_events sde ON dep.delivery_event_id = sde.delivery_event_id
        WHERE sde.ent_group_id = {ent_group_id}
    """)
    pre_run_phases = {int(r["phase_id"]): r["date_dev_projected"]
                      for _, r in pre_df.iterrows()}

    # P-00
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
    child_phases = []
    for event_id, projected in resolved_events:
        phases_df = conn.read_df(f"""
            SELECT phase_id FROM sim_delivery_event_phases
            WHERE delivery_event_id = {event_id}
        """)
        for _, r in phases_df.iterrows():
            child_phases.append((int(r["phase_id"]), projected))
    lot_date_propagator(conn, child_phases)

    # S-12 (final refresh): rebuild ledger view now that P-07 has written
    # date_dev to sim lots; the view built at end of starts pipeline was stale
    ledger_aggregator(conn)

    # P-08 -- scoped to same phases as pre-run snapshot
    post_df = conn.read_df(f"""
        SELECT DISTINCT sdp.phase_id, sdp.date_dev_projected
        FROM sim_dev_phases sdp
        JOIN sim_delivery_event_phases dep ON sdp.phase_id = dep.phase_id
        JOIN sim_delivery_events sde ON dep.delivery_event_id = sde.delivery_event_id
        WHERE sde.ent_group_id = {ent_group_id}
    """)
    post_run_phases = {int(r["phase_id"]): r["date_dev_projected"]
                       for _, r in post_df.iterrows()}
    affected_pgs = sync_flag_writer(conn, pre_run_phases, post_run_phases)

    return post_run_phases, affected_pgs


def convergence_coordinator(ent_group_id: int, run_start_date: date = None,
                             max_iterations: int = 10) -> int:
    """
    Run starts and supply pipelines iteratively until delivery dates stabilize.
    Returns number of iterations to convergence.
    """
    if run_start_date is None:
        run_start_date = date.today().replace(day=1)

    sim_run_id = int(date.today().strftime("%Y%m%d"))

    with DBConnection() as conn:
        # Get all projection groups for this entitlement group
        pg_df = conn.read_df(f"""
            SELECT DISTINCT dpg.projection_group_id
            FROM sim_ent_group_developments segd
            JOIN dim_projection_groups dpg ON segd.dev_id = dpg.dev_id
            WHERE segd.ent_group_id = {ent_group_id}
        """)

        if pg_df.empty:
            print(f"No projection groups found for ent_group_id={ent_group_id}. Aborting.")
            return 0

        projection_group_ids = [int(r) for r in pg_df["projection_group_id"]]
        print(f"Convergence coordinator: ent_group_id={ent_group_id}, "
              f"{len(projection_group_ids)} projection groups: {projection_group_ids}")

        # Load shared config once (does not change per iteration)
        builder_splits = _load_builder_splits(conn)

        for iteration in range(1, max_iterations + 1):
            print(f"\n--- Iteration {iteration} ---")

            # Snapshot delivery event projected dates before this iteration
            pre_df = conn.read_df(f"""
                SELECT delivery_event_id, date_dev_projected
                FROM sim_delivery_events
                WHERE ent_group_id = {ent_group_id}
            """)
            pre_iter_dates = {int(r["delivery_event_id"]): r["date_dev_projected"]
                              for _, r in pre_df.iterrows()}

            # Step 1: Run starts pipeline for ALL projection groups
            for pg_id in projection_group_ids:
                print(f"  Running starts pipeline for PG {pg_id}...")
                run_starts_pipeline(conn, pg_id, sim_run_id, run_start_date,
                                    builder_splits)

            # Step 2: Run supply pipeline
            print(f"  Running supply pipeline for ent_group_id={ent_group_id}...")
            _, affected_pgs = run_supply_pipeline(conn, ent_group_id)

            # Step 3: Check if any delivery event projected dates changed
            post_df = conn.read_df(f"""
                SELECT delivery_event_id, date_dev_projected
                FROM sim_delivery_events
                WHERE ent_group_id = {ent_group_id}
            """)
            post_iter_dates = {int(r["delivery_event_id"]): r["date_dev_projected"]
                               for _, r in post_df.iterrows()}

            def _dates_equal(a, b) -> bool:
                a_null = pd.isnull(a) if a is not None else True
                b_null = pd.isnull(b) if b is not None else True
                if a_null and b_null:
                    return True
                if a_null != b_null:
                    return False
                return a == b

            changed = [
                eid for eid, post_date in post_iter_dates.items()
                if not _dates_equal(pre_iter_dates.get(eid), post_date)
            ]

            if not changed:
                print(f"\nConvergence reached after {iteration} iteration(s).")
                return iteration

            print(f"  {len(changed)} delivery event date(s) changed: {changed}. Re-running.")

    print(f"WARNING: Max iterations ({max_iterations}) reached without convergence.")
    return max_iterations
