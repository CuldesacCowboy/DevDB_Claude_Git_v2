# coordinator.py
# Convergence coordinator -- wires starts pipeline and supply pipeline.
# Runs per entitlement group.
# The coordinator stays dumb: run A, run B, check, repeat.
# No logic, no exception handling, no domain knowledge here.
# Max iterations: 10 (safety limit only -- normal convergence is 2-3).

import random
from datetime import date, datetime, timedelta

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


# ── Build lag curve helpers ───────────────────────────────────────────────────

def _load_build_lag_curves(conn: DBConnection) -> dict:
    """
    Load sim_build_lag_curves into {(lag_type, lot_type_id): curve_dict}.
    lot_type_id=None rows are the default fallback.
    """
    df = conn.read_df("""
        SELECT lag_type, lot_type_id, p10, p25, p50, p75, p90
        FROM sim_build_lag_curves
    """)
    curves = {}
    for _, r in df.iterrows():
        lt_id = int(r["lot_type_id"]) if pd.notna(r["lot_type_id"]) else None
        curves[(r["lag_type"], lt_id)] = {
            "p10": int(r["p10"]), "p25": int(r["p25"]), "p50": int(r["p50"]),
            "p75": int(r["p75"]), "p90": int(r["p90"]),
        }
    return curves


def _sample_lag(rng: random.Random, curve: dict) -> int:
    """
    Sample lag days from a percentile curve using linear interpolation.
    Draws a uniform U from rng, interpolates over the 5 knots.
    """
    u = rng.random()
    knots = [
        (0.10, curve["p10"]),
        (0.25, curve["p25"]),
        (0.50, curve["p50"]),
        (0.75, curve["p75"]),
        (0.90, curve["p90"]),
    ]
    # Extrapolate below p10
    if u <= knots[0][0]:
        slope = (knots[1][1] - knots[0][1]) / (knots[1][0] - knots[0][0])
        return max(1, round(knots[0][1] - slope * (knots[0][0] - u)))
    # Extrapolate above p90
    if u >= knots[-1][0]:
        slope = (knots[-1][1] - knots[-2][1]) / (knots[-1][0] - knots[-2][0])
        return round(knots[-1][1] + slope * (u - knots[-1][0]))
    # Interpolate between knots
    for i in range(len(knots) - 1):
        lo_u, lo_v = knots[i]
        hi_u, hi_v = knots[i + 1]
        if lo_u <= u <= hi_u:
            frac = (u - lo_u) / (hi_u - lo_u)
            return round(lo_v + frac * (hi_v - lo_v))
    return curve["p50"]


def _apply_build_lag_curves(temp_lots: list, curves: dict, rng: random.Random) -> list:
    """
    Replace default constant lags on temp lots with sampled values from empirical curves.
    Applied after plan() returns, before builder_assignment.
    Modifies date_cmp and date_cls in place; preserves date_str (the anchor).
    Falls back to default lags when no curve available.
    """
    DEFAULT_CMP_LAG = 270
    DEFAULT_CLS_LAG = 45

    result = []
    for lot in temp_lots:
        lot = lot.copy()
        lot_type_id = lot.get("lot_type_id")
        date_str = lot.get("date_str")

        if date_str is None:
            result.append(lot)
            continue

        # Resolve str_to_cmp curve: prefer lot-type-specific, fall back to None (default)
        str_cmp_curve = (
            curves.get(("str_to_cmp", lot_type_id))
            or curves.get(("str_to_cmp", None))
        )
        cmp_cls_curve = (
            curves.get(("cmp_to_cls", lot_type_id))
            or curves.get(("cmp_to_cls", None))
        )

        lag_str_cmp = _sample_lag(rng, str_cmp_curve) if str_cmp_curve else DEFAULT_CMP_LAG
        date_cmp = date_str + timedelta(days=lag_str_cmp)

        lag_cmp_cls = _sample_lag(rng, cmp_cls_curve) if cmp_cls_curve else DEFAULT_CLS_LAG
        date_cls = date_cmp + timedelta(days=lag_cmp_cls)

        lot["date_cmp"] = date_cmp
        lot["date_cls"] = date_cls
        result.append(lot)

    return result


# ── Coordinator helpers ───────────────────────────────────────────────────────

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


def _load_phase_delivery_dates(conn: DBConnection, dev_id: int) -> dict:
    """
    Load {phase_id: date} for all phases in this development.
    Used by S-03 no-anchor fallback (Scenario 7): lots with zero milestone dates
    get date_dev = phase delivery date as anchor.
    """
    df = conn.read_df(f"""
        SELECT DISTINCT sdp.phase_id, sdp.date_dev_projected
        FROM sim_dev_phases sdp
        WHERE sdp.dev_id = {dev_id}
          AND sdp.phase_id IN (
              SELECT DISTINCT phase_id FROM sim_lots
              WHERE dev_id = {dev_id}
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


def _persist_violations(conn: DBConnection, violations_df, dev_id: int,
                        sim_run_id: int) -> None:
    """
    Clear stale violations for this development, then write current violations
    from S-04 to sim_lot_date_violations.
    resolution = 'pending' for all new rows (Path A/B UI resolution deferred).
    """
    conn.execute(f"""
        DELETE FROM sim_lot_date_violations
        WHERE lot_id IN (
            SELECT lot_id FROM sim_lots
            WHERE dev_id = {dev_id}
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
    print(f"  S-04: Persisted {len(rows)} violation(s) for dev {dev_id} "
          f"(sim_run_id={sim_run_id}).")


def run_starts_pipeline(conn: DBConnection, dev_id: int,
                        sim_run_id: int, run_start_date: date,
                        builder_splits: dict,
                        build_lag_curves: dict,
                        rng: random.Random) -> tuple[list, bool]:
    """
    Run all 12 starts pipeline modules in order for one development.
    Coordinator calls this once per dev per iteration.
    Returns temp_lots list.
    """
    # S-01
    snapshot = lot_loader(conn, dev_id)

    # S-02
    snapshot = date_actualizer(conn, snapshot)

    # S-03 (load phase delivery dates for no-anchor fallback, Scenario 7)
    phase_delivery_dates = _load_phase_delivery_dates(conn, dev_id)
    snapshot = gap_fill_engine(snapshot, phase_delivery_dates)

    # S-04
    snapshot, violations, has_violations = chronology_validator(snapshot)
    if has_violations:
        vcount = len(violations) if hasattr(violations, '__len__') else violations.shape[0]
        print(f"  WARNING: {vcount} chronology violations in dev {dev_id}. Run continues.")
    _persist_violations(conn, violations, dev_id, sim_run_id)

    # S-05
    snapshot, residual_gaps = takedown_engine(conn, snapshot, dev_id)

    # S-06
    demand_series, needs_config = demand_generator(conn, dev_id, run_start_date)
    if needs_config:
        print(f"  WARNING: Dev {dev_id} has no sim_dev_params. No demand generated.")
        demand_series = pd.DataFrame(columns=["year", "month", "slots"])

    # S-07 through S-0820: kernel planning pass
    frozen = build_frozen_input(
        conn, dev_id, snapshot, demand_series, sim_run_id
    )

    proposal = plan(frozen)
    if proposal.warnings:
        for w in proposal.warnings:
            print(f"  {w}")

    # Apply empirical build lag curves to temp lots (replaces constant lags)
    temp_lots = _apply_build_lag_curves(proposal.temp_lots, build_lag_curves, rng)

    # S-09
    temp_lots = builder_assignment(temp_lots, builder_splits)

    # S-10
    demand_derived_date_writer(conn, temp_lots)

    # S-11
    persistence_writer(conn, temp_lots, dev_id, sim_run_id,
                       _proposal=proposal)

    # S-12
    ledger_aggregator(conn)

    return temp_lots, needs_config


def run_supply_pipeline(conn: DBConnection, ent_group_id: int) -> tuple:
    """
    Run all 8 supply pipeline modules in order for the entitlement group.
    Returns (post_run_phases dict, affected_dev_ids list).
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
    affected_devs = sync_flag_writer(conn, pre_run_phases, post_run_phases)

    return post_run_phases, affected_devs


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
        # Get all developments for this entitlement group
        dev_df = conn.read_df(f"""
            SELECT dev_id
            FROM sim_ent_group_developments
            WHERE ent_group_id = {ent_group_id}
            ORDER BY dev_id
        """)

        if dev_df.empty:
            print(f"No developments found for ent_group_id={ent_group_id}. Aborting.")
            return 0, set()

        dev_ids = [int(r) for r in dev_df["dev_id"]]
        print(f"Convergence coordinator: ent_group_id={ent_group_id}, "
              f"{len(dev_ids)} development(s): {dev_ids}")

        # Load shared config once (does not change per iteration)
        builder_splits = _load_builder_splits(conn)
        build_lag_curves = _load_build_lag_curves(conn)

        # Seeded RNG: sim_run_id is date-based (YYYYMMDD), giving reproducibility
        # within a day. Each ent_group run gets its own seed.
        rng = random.Random(sim_run_id * 1000 + ent_group_id)

        missing_params_devs: set[int] = set()

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

            # Step 1: Run starts pipeline for ALL developments
            for dev_id in dev_ids:
                print(f"  Running starts pipeline for dev {dev_id}...")
                _, needs_config = run_starts_pipeline(conn, dev_id, sim_run_id, run_start_date,
                                    builder_splits, build_lag_curves, rng)
                if needs_config:
                    missing_params_devs.add(dev_id)

            # Step 2: Run supply pipeline
            print(f"  Running supply pipeline for ent_group_id={ent_group_id}...")
            _, affected_devs = run_supply_pipeline(conn, ent_group_id)

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
                return iteration, missing_params_devs

            print(f"  {len(changed)} delivery event date(s) changed: {changed}. Re-running.")

    print(f"WARNING: Max iterations ({max_iterations}) reached without convergence.")
    return max_iterations, missing_params_devs
