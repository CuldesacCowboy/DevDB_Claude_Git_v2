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
from datetime import date, datetime, timedelta, timezone

import pandas as pd

logger = logging.getLogger(__name__)

from .connection import PGConnection as DBConnection
from .s0100_lot_loader import lot_loader
from .s0200_date_actualizer import date_actualizer
from .s0300_gap_fill_engine import gap_fill_engine
from .s0400_chronology_validator import chronology_validator
from .s0500_takedown_engine import takedown_engine
from .s0600_demand_generator import demand_generator
from .s0820_post_generation_chronology_guard import post_generation_chronology_guard
from .s0900_builder_assignment import builder_assignment, assign_real_lot_builders
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
from .p_pre_locked_event_rebuilder import locked_event_rebuilder


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


def _expand_timing(temp_lots: list, curves: dict, rng: random.Random) -> list:
    """
    Shell timing expansion stage — derives date_cmp and date_cls from date_str
    using empirical build lag curves. Runs after plan() returns, before S-0820.

    Building groups share the same str_to_cmp lag (D-022): the lag is sampled once
    per group using the first unit's lot_type_id, then applied uniformly to all units
    in the group so they receive identical date_cmp. date_cls is derived per unit
    independently (D-012/D-075).

    Falls back to default constant lags when no empirical curve is available.
    Default lags are sourced from sim_entitlement_delivery_config (migration 024)
    and injected into the curves dict as _default_cmp / _default_cls keys.
    """
    DEFAULT_CMP_LAG = curves.get("_default_cmp", 270)
    DEFAULT_CLS_LAG = curves.get("_default_cls", 45)

    # Sample str_to_cmp lag once per building group (shared date_cmp, D-022).
    bg_cmp_lag: dict[int, int] = {}
    for lot in temp_lots:
        bg_id = lot.get("building_group_id")
        if bg_id is not None and bg_id not in bg_cmp_lag:
            curve = curves_for(curves, "str_to_cmp", lot.get("lot_type_id"))
            bg_cmp_lag[bg_id] = _sample_lag(rng, curve) if curve else DEFAULT_CMP_LAG

    result = []
    for lot in temp_lots:
        lot = lot.copy()
        date_str = lot.get("date_str")
        if date_str is None:
            result.append(lot)
            continue

        lot_type_id = lot.get("lot_type_id")
        bg_id = lot.get("building_group_id")

        # str_to_cmp: shared within building group, independent otherwise.
        if bg_id is not None:
            lag_str_cmp = bg_cmp_lag[bg_id]
        else:
            curve = curves_for(curves, "str_to_cmp", lot_type_id)
            lag_str_cmp = _sample_lag(rng, curve) if curve else DEFAULT_CMP_LAG

        date_cmp = date_str + timedelta(days=lag_str_cmp)

        # cmp_to_cls: always per unit (D-012/D-022/D-075).
        cmp_cls_curve = curves_for(curves, "cmp_to_cls", lot_type_id)
        lag_cmp_cls = _sample_lag(rng, cmp_cls_curve) if cmp_cls_curve else DEFAULT_CLS_LAG
        date_cls = date_cmp + timedelta(days=lag_cmp_cls)

        lot["date_cmp"] = date_cmp
        lot["date_cmp_source"] = "engine_filled"
        lot["date_cls"] = date_cls
        lot["date_cls_source"] = "engine_filled"
        result.append(lot)

    return result


def _write_real_lot_projections(
    conn: DBConnection,
    dev_id: int,
    run_start_date: date,
    build_lag_curves: dict,
    rng: random.Random,
) -> int:
    """
    Write date_str_projected / date_cmp_projected / date_cls_projected to real
    P lots (no actual start date, no takedown date) for this dev.

    Generates its own demand series at the annual pace from sim_dev_params —
    independent of the sim-lot capacity logic (which subtracts real lots from
    capacity and can return empty demand when all slots are occupied by real lots).
    Clears stale projections on real lots before writing new ones.
    Returns number of lots projected.
    """
    from dateutil.relativedelta import relativedelta

    # 1. Clear all projected dates on real lots for this dev, skipping locked lots.
    conn.execute(
        """
        UPDATE sim_lots
        SET date_str_projected = NULL,
            date_cmp_projected = NULL,
            date_cls_projected = NULL
        WHERE lot_source = 'real'
          AND dev_id = %s
          AND date_str_is_locked IS NOT TRUE
          AND date_cmp_is_locked IS NOT TRUE
          AND date_cls_is_locked IS NOT TRUE
        """,
        (dev_id,),
    )

    # 2. Real P lots: no actual start, takedown, or hold date — ordered by lot_id.
    #    Exclude lots where the projected start is locked (retain their existing projection).
    p_lots_df = conn.read_df(
        """
        SELECT lot_id, lot_type_id
        FROM sim_lots
        WHERE lot_source = 'real'
          AND dev_id             = %s
          AND date_str           IS NULL
          AND date_td            IS NULL
          AND date_td_hold       IS NULL
          AND excluded           IS NOT TRUE
          AND date_str_is_locked IS NOT TRUE
        ORDER BY lot_id
        """,
        (dev_id,),
    )

    if p_lots_df.empty:
        return 0

    # 3. Get annual_starts_target from sim_dev_params.
    params_df = conn.read_df(
        """
        SELECT annual_starts_target, max_starts_per_month
        FROM sim_dev_params
        WHERE dev_id = %s
        LIMIT 1
        """,
        (dev_id,),
    )
    if params_df.empty:
        return 0

    annual_target = float(params_df.iloc[0]["annual_starts_target"])
    max_per_month_raw = params_df.iloc[0]["max_starts_per_month"]
    max_per_month = float(max_per_month_raw) if max_per_month_raw is not None and pd.notna(max_per_month_raw) else None
    monthly_rate = annual_target / 12.0

    # 4. Build demand slots starting from run_start_date until all P lots are covered.
    n_needed = len(p_lots_df)
    date_slots: list[date] = []
    current = run_start_date.replace(day=1)
    while len(date_slots) < n_needed:
        slots_this_month = max(1, round(monthly_rate))
        if max_per_month is not None:
            slots_this_month = min(slots_this_month, int(max_per_month))
        for _ in range(slots_this_month):
            date_slots.append(current)
            if len(date_slots) >= n_needed:
                break
        current = current + relativedelta(months=1)

    if not date_slots:
        return 0

    # 5. Assign projected dates to P lots (as many as demand allows).
    updates = []
    for i, (_, lot) in enumerate(p_lots_df.iterrows()):
        if i >= len(date_slots):
            break
        str_date = date_slots[i]
        lt_id = int(lot["lot_type_id"]) if pd.notna(lot["lot_type_id"]) else None

        str_cmp_curve = curves_for(build_lag_curves, "str_to_cmp", lt_id)
        cmp_cls_curve = curves_for(build_lag_curves, "cmp_to_cls", lt_id)

        DEFAULT_CMP_LAG = build_lag_curves.get("_default_cmp", 270)
        DEFAULT_CLS_LAG = build_lag_curves.get("_default_cls", 45)
        lag_str_cmp = _sample_lag(rng, str_cmp_curve) if str_cmp_curve else DEFAULT_CMP_LAG
        lag_cmp_cls = _sample_lag(rng, cmp_cls_curve) if cmp_cls_curve else DEFAULT_CLS_LAG

        cmp_date = str_date + timedelta(days=lag_str_cmp)
        cls_date = cmp_date + timedelta(days=lag_cmp_cls)
        updates.append((int(lot["lot_id"]), str_date, cmp_date, cls_date))

    if not updates:
        return 0

    # 6. Bulk UPDATE via execute_values.
    conn.execute_values(
        """
        UPDATE sim_lots AS sl
        SET date_str_projected = v.str_p::date,
            date_cmp_projected = v.cmp_p::date,
            date_cls_projected = v.cls_p::date
        FROM (VALUES %s) AS v(lot_id, str_p, cmp_p, cls_p)
        WHERE sl.lot_id = v.lot_id::bigint
        """,
        updates,
    )

    logger.info(f"  Projected dates written to {len(updates)} real P lot(s) for dev {dev_id}.")
    return len(updates)


def curves_for(curves: dict, lag_type: str, lot_type_id) -> dict | None:
    """Return the best-matching curve for a lag_type + lot_type_id."""
    return curves.get((lag_type, lot_type_id)) or curves.get((lag_type, None))


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
    df = conn.read_df(
        """
        SELECT DISTINCT sdp.phase_id, sdp.date_dev_projected
        FROM sim_dev_phases sdp
        WHERE sdp.dev_id = %s
          AND sdp.phase_id IN (
              SELECT DISTINCT phase_id FROM sim_lots
              WHERE dev_id = %s
                AND lot_source = 'real'
                AND excluded IS NOT TRUE
          )
        """,
        (dev_id, dev_id),
    )
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
    conn.execute(
        """
        DELETE FROM sim_lot_date_violations
        WHERE lot_id IN (
            SELECT lot_id FROM sim_lots
            WHERE dev_id = %s
        )
        """,
        (dev_id,),
    )

    if violations_df is None or (hasattr(violations_df, 'empty') and violations_df.empty):
        return

    now = datetime.now(timezone.utc)

    rows = []
    for _, vrow in violations_df.iterrows():
        ev = vrow["date_value_early"]
        lv = vrow["date_value_late"]
        rows.append({
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
    logger.info(f"  S-04: Persisted {len(rows)} violation(s) for dev {dev_id} "
               f"(sim_run_id={sim_run_id}).")


_OVERRIDE_FIELDS = ['date_td_hold', 'date_td', 'date_str', 'date_frm', 'date_cmp', 'date_cls']


def _apply_lot_date_overrides(conn: DBConnection, snapshot: pd.DataFrame) -> pd.DataFrame:
    """
    Apply active planning overrides from sim_lot_date_overrides to the lot snapshot.
    Called between S-02 and S-03 so overrides win over MARKS actuals in the engine.
    sim_lots in the DB is unchanged — overrides only affect the in-memory snapshot.
    """
    if snapshot.empty:
        return snapshot
    lot_ids = snapshot['lot_id'].dropna().astype(int).tolist()
    if not lot_ids:
        return snapshot
    ov_df = conn.read_df(
        "SELECT lot_id, date_field, override_value FROM sim_lot_date_overrides WHERE lot_id = ANY(%s)",
        (lot_ids,),
    )
    if ov_df.empty:
        return snapshot
    df = snapshot.copy()
    for _, row in ov_df.iterrows():
        lot_id = int(row['lot_id'])
        field = row['date_field']
        value = row['override_value']
        if field not in _OVERRIDE_FIELDS:
            continue
        mask = df['lot_id'] == lot_id
        if field in df.columns:
            df.loc[mask, field] = value
    logger.info(f"  Overrides applied: {len(ov_df)} field(s) across {ov_df['lot_id'].nunique()} lot(s).")
    return df


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

    # Override application: manager-entered planning dates win over MARKS actuals.
    # Applied after S-02 so MARKS is still written back to sim_lots (ground truth),
    # but the engine operates on the override values from this point forward.
    snapshot = _apply_lot_date_overrides(conn, snapshot)

    # S-03 (load phase delivery dates for no-anchor fallback, Scenario 7)
    phase_delivery_dates = _load_phase_delivery_dates(conn, dev_id)
    snapshot = gap_fill_engine(snapshot, phase_delivery_dates)

    # S-04
    snapshot, violations, has_violations = chronology_validator(snapshot)
    if has_violations:
        vcount = len(violations) if hasattr(violations, '__len__') else violations.shape[0]
        logger.warning(f"  WARNING: {vcount} chronology violations in dev {dev_id}. Run continues.")
    _persist_violations(conn, violations, dev_id, sim_run_id)

    # S-05
    snapshot, residual_gaps = takedown_engine(conn, snapshot, dev_id)

    # S-06
    demand_series, needs_config = demand_generator(conn, dev_id, run_start_date)
    if needs_config:
        logger.warning(f"  WARNING: Dev {dev_id} has no sim_dev_params. No demand generated.")
        demand_series = pd.DataFrame(columns=["year", "month", "slots"])

    # S-07 through S-0820: kernel planning pass
    frozen = build_frozen_input(
        conn, dev_id, snapshot, demand_series, sim_run_id
    )

    proposal = plan(frozen)
    if proposal.warnings:
        for w in proposal.warnings:
            logger.info(f"  {w}")

    # Shell timing expansion: derive date_cmp and date_cls from assignment anchors.
    # Building groups get a shared date_cmp lag (D-022); date_cls is per unit (D-012).
    temp_lots = _expand_timing(proposal.temp_lots, build_lag_curves, rng)

    # S-0820 (shell stage): discard temp lots with chronology violations post-expansion.
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
    persistence_writer(conn, temp_lots, dev_id, sim_run_id,
                       _proposal=proposal)

    # Write projected dates to real P lots at the configured annual pace
    _write_real_lot_projections(conn, dev_id, run_start_date, build_lag_curves, rng)

    # S-12
    ledger_aggregator(conn)

    return temp_lots, needs_config


def run_supply_pipeline(conn: DBConnection, ent_group_id: int) -> tuple:
    """
    Run all 8 supply pipeline modules in order for the entitlement group.
    Returns (post_run_phases dict, affected_dev_ids list).
    """
    # P-pre: rebuild locked delivery events from sim_dev_phases.date_dev_actual
    locked_event_rebuilder(conn, ent_group_id)

    # Snapshot pre-run delivery dates -- scoped to phases in this ent_group
    pre_df = conn.read_df(
        """
        SELECT DISTINCT sdp.phase_id, sdp.date_dev_projected
        FROM sim_dev_phases sdp
        JOIN sim_delivery_event_phases dep ON sdp.phase_id = dep.phase_id
        JOIN sim_delivery_events sde ON dep.delivery_event_id = sde.delivery_event_id
        WHERE sde.ent_group_id = %s
        """,
        (ent_group_id,),
    )
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
        phases_df = conn.read_df(
            "SELECT phase_id FROM sim_delivery_event_phases WHERE delivery_event_id = %s",
            (event_id,),
        )
        for _, r in phases_df.iterrows():
            child_phases.append((int(r["phase_id"]), projected))
    lot_date_propagator(conn, child_phases)

    # S-12 (final refresh): rebuild ledger view now that P-07 has written
    # date_dev to sim lots; the view built at end of starts pipeline was stale
    ledger_aggregator(conn)

    # P-08 -- scoped to same phases as pre-run snapshot
    post_df = conn.read_df(
        """
        SELECT DISTINCT sdp.phase_id, sdp.date_dev_projected
        FROM sim_dev_phases sdp
        JOIN sim_delivery_event_phases dep ON sdp.phase_id = dep.phase_id
        JOIN sim_delivery_events sde ON dep.delivery_event_id = sde.delivery_event_id
        WHERE sde.ent_group_id = %s
        """,
        (ent_group_id,),
    )
    post_run_phases = {int(r["phase_id"]): r["date_dev_projected"]
                       for _, r in post_df.iterrows()}
    affected_devs = sync_flag_writer(conn, pre_run_phases, post_run_phases)

    return post_run_phases, affected_devs


def convergence_coordinator(ent_group_id: int, run_start_date: date = None,
                             max_iterations: int = 10,
                             rng_seed: int | None = None) -> int:
    """
    Run starts and supply pipelines iteratively until delivery dates stabilize.
    Returns number of iterations to convergence.

    rng_seed: explicit seed for the random number generator (test-time control).
              Default None uses a date-based seed (YYYYMMDD * 1000 + ent_group_id)
              for within-day reproducibility.
    """
    if run_start_date is None:
        run_start_date = date.today().replace(day=1)

    sim_run_id = int(date.today().strftime("%Y%m%d"))

    with DBConnection() as conn:
        # Get all developments for this entitlement group
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
        builder_splits = _load_builder_splits(conn)
        build_lag_curves = _load_build_lag_curves(conn)

        # Load build lag fallback constants from merged global + community config.
        # Injected into build_lag_curves dict so _expand_timing and
        # _write_real_lot_projections can use them without signature changes.
        from engine.config_loader import load_delivery_config
        _cfg = load_delivery_config(conn, ent_group_id)
        build_lag_curves["_default_cmp"] = _cfg["default_cmp_lag_days"]
        build_lag_curves["_default_cls"] = _cfg["default_cls_lag_days"]

        # S-0900 pre-pass: assign builder_id to real/pre lots with no committed builder.
        # Runs once per engine run (idempotent — already-assigned lots are skipped).
        assign_real_lot_builders(conn, ent_group_id, builder_splits)

        # Seeded RNG: date-based by default (YYYYMMDD), giving reproducibility
        # within a day. Pass rng_seed explicitly for test-time control.
        _seed = rng_seed if rng_seed is not None else sim_run_id * 1000 + ent_group_id
        rng = random.Random(_seed)

        missing_params_devs: set[int] = set()

        for iteration in range(1, max_iterations + 1):
            logger.info(f"\n--- Iteration {iteration} ---")

            # Snapshot delivery event projected dates before this iteration
            pre_df = conn.read_df(
                """
                SELECT delivery_event_id, date_dev_projected
                FROM sim_delivery_events
                WHERE ent_group_id = %s
                """,
                (ent_group_id,),
            )
            pre_iter_dates = {int(r["delivery_event_id"]): r["date_dev_projected"]
                              for _, r in pre_df.iterrows()}

            # Step 1: Run starts pipeline for ALL developments
            for dev_id in dev_ids:
                logger.info(f"  Running starts pipeline for dev {dev_id}...")
                _, needs_config = run_starts_pipeline(conn, dev_id, sim_run_id, run_start_date,
                                    builder_splits, build_lag_curves, rng)
                if needs_config:
                    missing_params_devs.add(dev_id)
                # Re-stamp date_ent on all lots for this dev from their phase.
                # s1100 inserts fresh sim lots with date_ent=None; this restores
                # the phase-level Entitlements Date (migration 023).
                # Lots in phases with no date_ent set remain NULL.
                conn.execute(
                    """
                    UPDATE sim_lots sl
                    SET date_ent = sdp.date_ent
                    FROM sim_dev_phases sdp
                    WHERE sl.phase_id = sdp.phase_id
                      AND sl.dev_id   = %s
                      AND sdp.date_ent IS NOT NULL
                    """,
                    (dev_id,),
                )

            # Step 2: Run supply pipeline
            logger.info(f"  Running supply pipeline for ent_group_id={ent_group_id}...")
            _, affected_devs = run_supply_pipeline(conn, ent_group_id)

            # Step 3: Check if any delivery event projected dates changed
            post_df = conn.read_df(
                """
                SELECT delivery_event_id, date_dev_projected
                FROM sim_delivery_events
                WHERE ent_group_id = %s
                """,
                (ent_group_id,),
            )
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
                logger.info(f"\nConvergence reached after {iteration} iteration(s).")
                return iteration, missing_params_devs

            logger.info(f"  {len(changed)} delivery event date(s) changed: {changed}. Re-running.")

    logger.warning(f"WARNING: Max iterations ({max_iterations}) reached without convergence.")
    return max_iterations, missing_params_devs
