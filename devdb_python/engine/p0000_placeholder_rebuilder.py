"""
P-0000 placeholder_rebuilder — Rebuild placeholder delivery events from demand signal.

Reads:   sim_delivery_events, sim_delivery_event_phases, sim_dev_phases,
         sim_entitlement_delivery_config (DB)
Writes:  sim_delivery_events, sim_delivery_event_phases,
         sim_delivery_event_predecessors (DB, DELETE + INSERT)
Input:   conn: DBConnection, ent_group_id: int
Rules:   Deletes all placeholder events (date_dev_actual IS NULL) for the ent_group.
         Inserts new auto-scheduled events per D-139 cross-dev bundling logic.
         After writing events, inserts predecessor rows between consecutive events
         per development (ordered by sequence_number) so P-0200/P-0400 enforce
         absolute intra-dev phase ordering (simultaneous OK; never out of order).
         No-ops if auto_schedule_enabled is False. Never touches locked events.
         No undelivered phases → return empty list.
         Phases with null demand + no lots are skipped unless they have real entitled lots
         OR configured product splits (supports all-sim communities on first run).
         Not Own: touching locked events, writing to sim_lots or sim_dev_phases date fields.
"""

import logging
import math
from datetime import date, timedelta
from collections import defaultdict
from .connection import DBConnection
from .seasonal_weights import effective_annual_pace

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Date helpers — all use valid_months: frozenset[int] instead of start/end range
# ---------------------------------------------------------------------------

def _add_months(d: date, n: int) -> date:
    """Add n months to a first-of-month date."""
    month = d.month + n
    year = d.year + (month - 1) // 12
    month = ((month - 1) % 12) + 1
    return d.replace(year=year, month=month, day=1)


def _lean_window_date(demand_date: date, valid_months: frozenset,
                      today_first: date) -> date:
    """
    Return the latest first-of-month date that:
    - Falls within valid_months
    - Is <= demand_date
    - Is >= today_first

    If no such date exists (demand already past all window months for its year,
    or demand month not in valid_months), return the next available window month
    >= today_first.
    """
    if demand_date is None:
        return _next_window_month_from(today_first, valid_months)

    d = demand_date.replace(day=1)

    # Walk back from demand month looking for latest window month >= today_first
    for _ in range(25):  # up to ~2 years back
        if d.month in valid_months:
            if d >= today_first:
                return d
            else:
                break  # valid window month but in the past — stop looking back
        # Step back one month
        if d.month == 1:
            d = d.replace(year=d.year - 1, month=12)
        else:
            d = d.replace(month=d.month - 1)

    # Demand is past or window doesn't cover demand month — schedule at next
    # available window month from today
    return _next_window_month_from(today_first, valid_months)


def _next_window_month_from(from_date: date, valid_months: frozenset) -> date:
    """Return the earliest first-of-month >= from_date within valid_months."""
    d = from_date.replace(day=1)
    for _ in range(25):
        if d.month in valid_months:
            return d
        if d.month == 12:
            d = d.replace(year=d.year + 1, month=1)
        else:
            d = d.replace(month=d.month + 1)
    # Fallback — should not reach here for reasonable window values
    return from_date.replace(day=1)


def _next_window_month_after(after_date: date, valid_months: frozenset) -> date:
    """Return the earliest first-of-month strictly after after_date in valid_months."""
    d = after_date.replace(day=1)
    if d.month == 12:
        d = d.replace(year=d.year + 1, month=1)
    else:
        d = d.replace(month=d.month + 1)
    return _next_window_month_from(d, valid_months)


def _first_window_month_in_year(year: int, valid_months: frozenset) -> date:
    """Return the first valid delivery month in the given year."""
    return date(year, min(valid_months), 1)


def _snap_to_window(d: date, valid_months: frozenset) -> date:
    """Latest first-of-month in valid_months that is <= d. Walks back up to 24 months."""
    m = d.month
    year = d.year
    for _ in range(24):
        if m in valid_months:
            return date(year, m, 1)
        m -= 1
        if m == 0:
            m = 12
            year -= 1
    return date(d.year, min(valid_months), 1)


def _months_between(d1: date, d2: date) -> int:
    """Months from d1 to d2, clamped to 0 if d2 <= d1."""
    return max(0, (d2.year - d1.year) * 12 + (d2.month - d1.month))


# ---------------------------------------------------------------------------
# Main module
# ---------------------------------------------------------------------------

def _get_phase_lots(conn, phase_id: int):
    """Return list of projected_count values from sim_phase_product_splits for a phase."""
    df = conn.read_df("SELECT projected_count FROM sim_phase_product_splits WHERE phase_id = %s", (phase_id,))
    if df.empty:
        return [0]
    return [int(x) for x in df["projected_count"] if x is not None]


def placeholder_rebuilder(conn: DBConnection, ent_group_id: int) -> list:
    """
    Delete all placeholder delivery events for the entitlement group and
    rebuild them using the current demand signal.

    Returns list of new delivery_event_ids created.
    """
    today_first = date.today().replace(day=1)

    # ------------------------------------------------------------------
    # Step 1: Check auto_schedule flag
    # ------------------------------------------------------------------
    from engine.config_loader import load_delivery_config
    cfg = load_delivery_config(conn, ent_group_id)

    if not cfg["auto_schedule_enabled"]:
        logger.info(f"P-00: auto_schedule_enabled=False for ent_group_id={ent_group_id}. Skipping.")
        return []

    max_per_year     = cfg["max_deliveries_per_year"]
    min_gap          = cfg["min_gap_months"]
    raw_months       = cfg["delivery_months"]
    valid_months_default = frozenset(int(m) for m in raw_months) if raw_months else frozenset([5,6,7,8,9,10,11])
    min_buffer       = cfg["min_d_count"]
    feed_starts_mode = cfg["feed_starts_mode"]

    # ------------------------------------------------------------------
    # Step 2: Delete existing placeholder events
    # ------------------------------------------------------------------
    placeholder_df = conn.read_df(
        """
        SELECT delivery_event_id
        FROM sim_delivery_events
        WHERE ent_group_id = %s
          AND date_dev_actual IS NULL
        """,
        (ent_group_id,),
    )

    if not placeholder_df.empty:
        placeholder_ids = placeholder_df["delivery_event_id"].astype(int).tolist()

        conn.execute(
            """
            DELETE FROM sim_delivery_event_predecessors
            WHERE event_id = ANY(%s)
               OR predecessor_event_id = ANY(%s)
            """,
            (placeholder_ids, placeholder_ids),
        )
        conn.execute(
            "DELETE FROM sim_delivery_event_phases WHERE delivery_event_id = ANY(%s)",
            (placeholder_ids,),
        )
        conn.execute(
            "DELETE FROM sim_delivery_events WHERE delivery_event_id = ANY(%s)",
            (placeholder_ids,),
        )
        logger.info(f"P-00: Deleted {len(placeholder_df)} placeholder event(s).")
    else:
        logger.info("P-00: No placeholder events to delete.")

    # ------------------------------------------------------------------
    # Step 3: Collect undelivered phases
    # ------------------------------------------------------------------
    # Get all phases for this ent_group
    all_phases_df = conn.read_df(
        """
        SELECT sdp.phase_id, sdp.dev_id, sdp.date_dev_demand_derived,
               sdp.sequence_number, sdp.delivery_tier
        FROM sim_dev_phases sdp
        JOIN sim_ent_group_developments egd
             ON egd.dev_id = sdp.dev_id
        WHERE egd.ent_group_id = %s
        """,
        (ent_group_id,),
    )

    if all_phases_df.empty:
        logger.info(f"P-00: No phases found for ent_group_id={ent_group_id}.")
        return []

    # Phases covered by locked events
    locked_phases_df = conn.read_df(
        """
        SELECT DISTINCT dep.phase_id
        FROM sim_delivery_event_phases dep
        JOIN sim_delivery_events de
             ON de.delivery_event_id = dep.delivery_event_id
        WHERE de.ent_group_id = %s
          AND de.date_dev_actual IS NOT NULL
        """,
        (ent_group_id,),
    )
    locked_phase_ids = set(int(x) for x in locked_phases_df["phase_id"]) if not locked_phases_df.empty else set()

    undelivered = []
    for _, ph in all_phases_df.iterrows():
        ph_id = int(ph["phase_id"])
        if ph_id in locked_phase_ids:
            continue
        dev_id = int(ph["dev_id"])
        demand = ph["date_dev_demand_derived"]
        demand = demand.date() if hasattr(demand, "date") else demand
        # Normalize pd.NaT (pandas null for DATE columns) to Python None so
        # downstream checks like `demand is None` behave correctly.
        try:
            import pandas as pd
            if demand is not None and pd.isnull(demand):
                demand = None
        except (TypeError, ValueError):
            pass
        undelivered.append({
            "phase_id": ph_id,
            "dev_id": dev_id,
            "demand_date": demand,
            "sequence_number": int(ph["sequence_number"]) if ph["sequence_number"] is not None else 9999,
            "delivery_tier": int(ph["delivery_tier"]) if ph["delivery_tier"] is not None else None,
        })

    if not undelivered:
        logger.info(f"P-00: All phases are covered by locked events for ent_group_id={ent_group_id}.")
        return []

    # ------------------------------------------------------------------
    # Step 3b: Compute sellout date -- MAX(date_cls) across sim lots in
    # all PGs for this ent_group. Used to drop phases whose demand is
    # beyond the projection horizon.
    # ------------------------------------------------------------------
    sellout_df = conn.read_df(
        """
        SELECT MAX(sl.date_cls) AS sellout_date
        FROM sim_lots sl
        WHERE sl.lot_source = 'sim'
          AND sl.dev_id IN (
              SELECT dev_id FROM sim_ent_group_developments
              WHERE ent_group_id = %s
          )
        """,
        (ent_group_id,),
    )
    import pandas as pd
    sellout_raw = sellout_df.iloc[0]["sellout_date"] if not sellout_df.empty else None
    if sellout_raw is not None and not pd.isnull(sellout_raw):
        sellout_date = sellout_raw.date() if hasattr(sellout_raw, "date") else sellout_raw
    else:
        sellout_date = None

    # ------------------------------------------------------------------
    # Step 3c: Filter undelivered phases -- skip phases that have:
    #   (a) null demand_date AND zero sim lots  (no signal, no inventory)
    #   (b) demand_date past sellout horizon     (beyond projection end)
    # ------------------------------------------------------------------
    filtered = []
    for p in undelivered:
        ph_id = p["phase_id"]
        demand = p["demand_date"]

        # Check sim lot count for this phase
        sim_count_df = conn.read_df(
            "SELECT COUNT(*) AS cnt FROM sim_lots WHERE phase_id = %s AND lot_source = 'sim'",
            (ph_id,),
        )
        sim_count = int(sim_count_df.iloc[0]["cnt"]) if not sim_count_df.empty else 0

        # (a) Null demand with no sim lots -- check real entitled lots, then configured
        # product splits, before skipping.
        # Use date_ent IS NOT NULL (not date_dev IS NULL) so the check survives
        # across iterations: P-07 writes date_dev to real lots when a placeholder
        # event is created, so date_dev IS NULL would return 0 on the second
        # iteration and incorrectly skip the phase after the events are deleted.
        if demand is None and sim_count == 0:
            real_pending_df = conn.read_df(
                """
                SELECT COUNT(*) AS cnt FROM sim_lots
                WHERE phase_id = %s
                  AND lot_source = 'real'
                  AND date_ent IS NOT NULL
                  AND excluded IS NOT TRUE
                """,
                (ph_id,),
            )
            real_pending = int(real_pending_df.iloc[0]["cnt"]) if not real_pending_df.empty else 0
            if real_pending == 0:
                # Last resort: phase has configured product splits (all-sim community,
                # first run — no lots exist yet but capacity is planned).
                splits_df = conn.read_df(
                    """
                    SELECT COALESCE(SUM(projected_count), 0) AS total
                    FROM sim_phase_product_splits
                    WHERE phase_id = %s
                    """,
                    (ph_id,),
                )
                configured_capacity = int(splits_df.iloc[0]["total"]) if not splits_df.empty else 0
                if configured_capacity == 0:
                    logger.info(f"P-00: Phase {ph_id} skipped -- null demand, no lots, no configured capacity.")
                    continue
                logger.info(f"P-00: Phase {ph_id} has {configured_capacity} configured lot(s) in splits -- proceeding to schedule.")
            else:
                logger.info(f"P-00: Phase {ph_id} has {real_pending} real entitled lot(s) -- proceeding to schedule.")

        # (b) Demand past sellout horizon
        if demand is not None and sellout_date is not None and demand > sellout_date:
            logger.info(f"P-00: Phase {ph_id} skipped -- demand {demand} is beyond sellout "
                        f"horizon {sellout_date}.")
            continue

        filtered.append(p)

    skipped = len(undelivered) - len(filtered)
    if skipped:
        logger.info(f"P-00: {skipped} phase(s) skipped (null demand or beyond sellout). "
                    f"{len(filtered)} phase(s) proceeding to schedule.")
    undelivered = filtered

    if not undelivered:
        logger.info(f"P-00: No schedulable phases remain for ent_group_id={ent_group_id}.")
        return []

    # ------------------------------------------------------------------
    # Step 4: Get annual pace per phase (delivery window is ent-group level)
    # ------------------------------------------------------------------
    undelivered_phase_ids = [p["phase_id"] for p in undelivered]

    pg_annual_df = conn.read_df(
        """
        SELECT DISTINCT sdp.phase_id, sdvp.annual_starts_target,
               COALESCE(sdvp.seasonal_weight_set, 'balanced_2yr') AS seasonal_weight_set
        FROM sim_dev_phases sdp
        JOIN sim_dev_params sdvp ON sdvp.dev_id = sdp.dev_id
        WHERE sdp.phase_id = ANY(%s)
        """,
        (undelivered_phase_ids,),
    )

    # All phases share the ent-group-level valid_months (D-135)
    annual_target_map = {}  # phase_id -> effective monthly pace
    for _, r in pg_annual_df.iterrows():
        ph_id = int(r["phase_id"])
        t = r["annual_starts_target"]
        if t is not None:
            ws_name = r["seasonal_weight_set"]
            annual_target_map[ph_id] = effective_annual_pace(ws_name, float(t)) / 12.0

    # Attach valid_months to each undelivered phase (same for all — D-135)
    for p in undelivered:
        p["valid_months"] = valid_months_default

    # ------------------------------------------------------------------
    # Step 4b: Load projected D-balance from DB.
    # ------------------------------------------------------------------
    all_dev_ids_for_query = [int(d) for d in all_phases_df["dev_id"].unique()]
    d_balance: dict[int, dict[date, int]] = {d: {} for d in all_dev_ids_for_query}

    if all_dev_ids_for_query:
        if locked_phase_ids:
            _lot_filter_sql = "AND (sl.lot_source = 'real' OR sl.phase_id = ANY(%s))"
            _lot_filter_params = [list(locked_phase_ids)]
        else:
            _lot_filter_sql = "AND sl.lot_source = 'real'"
            _lot_filter_params = []

        d_proj_df = conn.read_df(
            f"""
            WITH future AS (
                SELECT generate_series(
                    DATE_TRUNC('MONTH', CURRENT_DATE)::DATE,
                    (DATE_TRUNC('MONTH', CURRENT_DATE) + INTERVAL '30 years')::DATE,
                    INTERVAL '1 month'
                )::DATE AS m
            )
            SELECT sl_devs.dev_id, f.m AS calendar_month,
                   COUNT(sl.lot_id) AS d_end
            FROM future f
            CROSS JOIN (SELECT UNNEST(%s::int[]) AS dev_id) AS sl_devs
            LEFT JOIN sim_lots sl
                ON  sl.dev_id = sl_devs.dev_id
                AND sl.date_dev IS NOT NULL
                AND sl.date_dev <= f.m
                AND (sl.date_td     IS NULL OR sl.date_td     > f.m)
                AND (sl.date_td_hold IS NULL OR sl.date_td_hold > f.m)
                {_lot_filter_sql}
            GROUP BY sl_devs.dev_id, f.m
            ORDER BY sl_devs.dev_id, f.m
            """,
            [all_dev_ids_for_query] + _lot_filter_params,
        )
        for _, dr in d_proj_df.iterrows():
            d_id = int(dr["dev_id"])
            m = dr["calendar_month"]
            m = m.date() if hasattr(m, "date") else m
            d_balance[d_id][m] = int(dr["d_end"])

    # Per-dev last locked delivery date
    last_locked_per_dev: dict[int, date] = {}
    if locked_phase_ids:
        llpd_df = conn.read_df("""
            SELECT sdp.dev_id, MAX(sde.date_dev_actual) AS last_locked
            FROM sim_delivery_events sde
            JOIN sim_delivery_event_phases dep
                 ON dep.delivery_event_id = sde.delivery_event_id
            JOIN sim_dev_phases sdp ON sdp.phase_id = dep.phase_id
            WHERE sde.ent_group_id = %s
              AND sde.date_dev_actual IS NOT NULL
            GROUP BY sdp.dev_id
        """, (ent_group_id,))
        for _, llr in llpd_df.iterrows():
            d_raw = llr["last_locked"]
            if d_raw is not None:
                d_val = d_raw.date() if hasattr(d_raw, "date") else d_raw
                last_locked_per_dev[int(llr["dev_id"])] = d_val

    global_demand_start_per_dev: dict[int, date] = {}
    for _dev in all_dev_ids_for_query:
        _ll = last_locked_per_dev.get(_dev)
        global_demand_start_per_dev[_dev] = _add_months(_ll, 1) if _ll else today_first

    demand_consumed: dict[int, int] = {}
    for _dev in all_dev_ids_for_query:
        _ds = global_demand_start_per_dev[_dev]
        if locked_phase_ids:
            _dc_filter_sql = "AND (lot_source = 'real' OR phase_id = ANY(%s))"
            _dc_params = (_dev, _ds, list(locked_phase_ids))
        else:
            _dc_filter_sql = "AND lot_source = 'real'"
            _dc_params = (_dev, _ds)
        _dc_df = conn.read_df(
            f"""
            SELECT COUNT(*) AS cnt FROM sim_lots
            WHERE dev_id = %s
              AND date_str IS NOT NULL
              AND date_str >= %s
              {_dc_filter_sql}
            """,
            _dc_params,
        )
        demand_consumed[_dev] = int(_dc_df.iloc[0]["cnt"]) if not _dc_df.empty else 0
        logger.info(f"P-00: Dev {_dev}: demand_start={_ds}, "
                    f"demand_consumed={demand_consumed[_dev]}")

    def _compute_drain_delay(dev_id_key: int, delivery_m: date) -> int:
        pace = dev_monthly_pace.get(dev_id_key, 1.0)
        if pace <= 0:
            return 0
        consumed = demand_consumed.get(dev_id_key, 0)
        pool_months = int(consumed / pace)
        ds = global_demand_start_per_dev.get(dev_id_key, today_first)
        pool_pos = _add_months(ds, pool_months)
        return _months_between(delivery_m, pool_pos)

    def _apply_delivery_to_balance(dev_id_key: int, delivery_month: date,
                                    n_lots: int, monthly_pace: float,
                                    drain_delay: int = 0) -> None:
        if n_lots <= 0 or monthly_pace <= 0:
            return
        bal = d_balance.setdefault(dev_id_key, {})
        for k in range(500):
            m = _add_months(delivery_month, k)
            if k <= drain_delay:
                contrib = n_lots
            else:
                drain_elapsed = k - drain_delay
                contrib = n_lots - min(n_lots, int(monthly_pace * drain_elapsed))
                if contrib <= 0:
                    break
            bal[m] = bal.get(m, 0) + contrib

    def _find_violation_month(dev_id_key: int, scan_floor: date) -> date | None:
        bal = d_balance.get(dev_id_key, {})
        for m in sorted(bal.keys()):
            if m <= scan_floor:
                continue
            if bal[m] <= min_buffer:
                return m
        return None

    def _dev_lv_from_balance(dev_id_key: int, scan_floor: date,
                              vm: frozenset) -> date | None:
        violation = _find_violation_month(dev_id_key, scan_floor)
        if violation is None:
            return None
        prev = _add_months(violation, -1)
        lv = _snap_to_window(prev, vm)
        if lv < today_first:
            lv = _next_window_month_from(today_first, vm)
        logger.info(f"P-00: Dev {dev_id_key}: D-balance violation {violation}, lv={lv}")
        return lv

    # ------------------------------------------------------------------
    # Step 5: Schedule delivery events
    # ------------------------------------------------------------------
    undelivered.sort(key=lambda p: (
        p["demand_date"] is None,
        p["demand_date"] or date.max,
        p["dev_id"],
    ))

    delivery_date_per_year: dict[int, date] = {}
    last_date: date | None = None

    locked_dates_df = conn.read_df("""
        SELECT date_dev_actual
        FROM sim_delivery_events
        WHERE ent_group_id = %s
          AND date_dev_actual IS NOT NULL
    """, (ent_group_id,))
    last_locked_date: date | None = None
    for _, r in locked_dates_df.iterrows():
        d = r["date_dev_actual"]
        if d is not None:
            d = d.date() if hasattr(d, "date") else d
            delivery_date_per_year[d.year] = d
            if last_date is None or d > last_date:
                last_date = d
            if last_locked_date is None or d > last_locked_date:
                last_locked_date = d

    def _constrain_date(ideal: date, vm: frozenset) -> date:
        d = ideal
        for _ in range(500):
            if d.year in delivery_date_per_year:
                return delivery_date_per_year[d.year]

            if last_date is not None and min_gap > 0:
                min_ok = _add_months(last_date, min_gap)
                min_ok = min_ok.replace(day=1)
                if d < min_ok:
                    d = _next_window_month_from(min_ok, vm)
                    continue

            break
        return d

    dev_phases = defaultdict(list)
    for phase in undelivered:
        dev_phases[phase["dev_id"]].append(phase)
    for dev_id in dev_phases:
        # Sort by (tier, sequence_number) so lower-tier phases always pop first,
        # even when a higher-tier phase has a lower sequence_number (e.g. two
        # independent product lines within the same dev where seq numbers reset).
        dev_phases[dev_id].sort(key=lambda p: (
            p["delivery_tier"] if p["delivery_tier"] is not None else 0,
            p["sequence_number"],
        ))

    valid_months = valid_months_default

    # monthly pace per dev: average effective monthly pace across phases for that dev
    dev_monthly_pace = {}
    for dev_id, phases_list in dev_phases.items():
        paces = [annual_target_map[p["phase_id"]] for p in phases_list if p["phase_id"] in annual_target_map]
        if paces:
            dev_monthly_pace[dev_id] = sum(paces) / len(paces)

    dev_scan_floor: dict[int, date] = {}
    for dev_id in dev_phases:
        dev_scan_floor[dev_id] = last_locked_per_dev.get(dev_id, today_first - timedelta(days=1))

    # Tracks lot count of the most-recently-scheduled delivery per dev within
    # this P-00 run — used by the lv_d=None fallback to compute exhaustion date.
    dev_last_delivery_lots: dict[int, int] = {}

    events_to_create = []

    for _ in range(200):
        # Gate by delivery_tier: tier-N phases may not be scheduled until all
        # tier-(N-1) phases (across ALL devs) have been assigned to events.
        # Phases with no tier (None) are always schedulable.
        # feed_starts_mode=True disables this gate so all devs compete by
        # D-balance urgency. Tier ordering is still enforced through predecessor
        # links (Step 7b) so no actual tier violation occurs.
        if feed_starts_mode:
            active = {d: phases for d, phases in dev_phases.items() if phases}
        else:
            _remaining_tiers = {
                phases[0]["delivery_tier"]
                for phases in dev_phases.values()
                if phases and phases[0]["delivery_tier"] is not None
            }
            _min_tier = min(_remaining_tiers) if _remaining_tiers else None

            active = {
                d: phases for d, phases in dev_phases.items()
                if phases and (
                    phases[0]["delivery_tier"] is None
                    or _min_tier is None
                    or phases[0]["delivery_tier"] <= _min_tier
                )
            }
        if not active:
            break

        deadlines = {}
        for dev_id in active:
            lv_d = _dev_lv_from_balance(dev_id, dev_scan_floor[dev_id], valid_months)
            if lv_d is None:
                first_demand = dev_phases[dev_id][0]["demand_date"]
                if first_demand:
                    lv_d = _snap_to_window(first_demand, valid_months)
                    if lv_d < today_first:
                        lv_d = _next_window_month_from(today_first, valid_months)
                else:
                    # No demand signal and no D-balance violation found.
                    # Permanent D-status lots (no takedown date) can mask the
                    # violation signal by keeping the balance above 0 forever.
                    # If a delivery was already scheduled for this dev in this
                    # run, compute the lean date from the exhaustion formula
                    # (batch_lots / monthly_pace) instead of defaulting to today.
                    _last_sched = dev_scan_floor.get(dev_id, today_first)
                    _last_lots = dev_last_delivery_lots.get(dev_id, 0)
                    _pace = dev_monthly_pace.get(dev_id, 1.0)
                    if _last_sched >= today_first and _last_lots > 0 and _pace > 0:
                        _months_exhaust = math.ceil(_last_lots / _pace)
                        _exhaust = _add_months(_last_sched, _months_exhaust)
                        lv_d = _snap_to_window(_add_months(_exhaust, -1), valid_months)
                        if lv_d < today_first:
                            lv_d = _next_window_month_from(today_first, valid_months)
                        logger.info(f"P-00: Dev {dev_id}: exhaustion fallback — "
                                    f"last_delivery={_last_sched}, lots={_last_lots}, "
                                    f"pace={_pace:.2f}/mo, exhaust={_exhaust}, lv_d={lv_d}")
                    else:
                        lv_d = _next_window_month_from(today_first, valid_months)
            lv_d = _constrain_date(lv_d, valid_months)
            deadlines[dev_id] = lv_d

        urgent_dev = min(deadlines, key=lambda d: deadlines[d])
        event_date = deadlines[urgent_dev]

        violation_check = _find_violation_month(urgent_dev, dev_scan_floor[urgent_dev])
        if violation_check is not None and event_date >= violation_check:
            logger.warning(
                f"P-00: WARNING: Dev {urgent_dev}: next delivery {event_date} "
                f"cannot be moved before D-floor violation at {violation_check} "
                f"(max_deliveries_per_year={max_per_year}, "
                f"min_gap_months={min_gap}, min_d_count={min_buffer}). "
                f"D-balance floor will not be maintained."
            )

        joining = [d for d in active if deadlines[d] <= event_date]

        event_phase_ids = []
        for dev_id in joining:
            pace = dev_monthly_pace.get(dev_id, 1.0)
            next_allowed = date(event_date.year + 1, min(valid_months), 1)

            batch = [dev_phases[dev_id].pop(0)]
            first_lots = sum(_get_phase_lots(conn, batch[0]["phase_id"]))
            _delay = _compute_drain_delay(dev_id, event_date)
            _apply_delivery_to_balance(dev_id, event_date, first_lots, pace, _delay)
            demand_consumed[dev_id] = demand_consumed.get(dev_id, 0) + first_lots
            logger.info(f"P-00: Dev {dev_id}: delivery {event_date}, "
                        f"lots={first_lots}, drain_delay={_delay}mo, "
                        f"demand_consumed->{demand_consumed[dev_id]}")

            _batch_tier = batch[0]["delivery_tier"]
            while True:
                next_v = _find_violation_month(dev_id, event_date)
                if next_v is None:
                    break
                next_lv = _snap_to_window(_add_months(next_v, -1), valid_months)
                if next_lv >= next_allowed:
                    break
                if not dev_phases[dev_id]:
                    break
                # Never co-bundle a higher-tier phase into this event — tier
                # ordering must be preserved across events, not just within a dev.
                # feed_starts_mode disables this check: aggressive batching allows
                # higher-tier phases into the same event when inventory demands it.
                _next_tier = dev_phases[dev_id][0]["delivery_tier"]
                if not feed_starts_mode and _batch_tier is not None and _next_tier is not None and _next_tier > _batch_tier:
                    break
                extra = dev_phases[dev_id].pop(0)
                batch.append(extra)
                extra_lots = sum(_get_phase_lots(conn, extra["phase_id"]))
                _delay_extra = _compute_drain_delay(dev_id, event_date)
                _apply_delivery_to_balance(dev_id, event_date, extra_lots, pace, _delay_extra)
                demand_consumed[dev_id] = demand_consumed.get(dev_id, 0) + extra_lots

            dev_scan_floor[dev_id] = event_date
            dev_last_delivery_lots[dev_id] = sum(
                sum(_get_phase_lots(conn, p["phase_id"])) for p in batch
            )

            for p in batch:
                event_phase_ids.append(p["phase_id"])

        events_to_create.append({"date": event_date, "phases": event_phase_ids})
        if event_date.year not in delivery_date_per_year:
            delivery_date_per_year[event_date.year] = event_date
        last_date = event_date

    events_to_create.sort(key=lambda e: e["date"])

    # ------------------------------------------------------------------
    # Step 6: Write new events
    # ------------------------------------------------------------------
    new_event_ids = []
    event_counter = 1

    for ev in events_to_create:
        seq_df = conn.read_df(
            "SELECT nextval('devdb.sim_delivery_events_id_seq') AS next_id"
        )
        event_id = int(seq_df.iloc[0]["next_id"])

        event_name = f"Auto-scheduled delivery {event_counter}"
        projected_date = ev["date"].strftime("%Y-%m-%d")
        months_list = sorted(list(valid_months))

        conn.execute(
            """
            INSERT INTO sim_delivery_events
                (delivery_event_id, ent_group_id, event_name,
                 delivery_months,
                 date_dev_actual, date_dev_projected,
                 is_auto_created, is_placeholder,
                 created_at, updated_at)
            VALUES (
                %s, %s, %s,
                %s,
                NULL, %s,
                TRUE, TRUE,
                current_timestamp, current_timestamp
            )
            """,
            (event_id, ent_group_id, event_name, months_list, projected_date),
        )

        for ph_id in ev["phases"]:
            link_seq_df = conn.read_df(
                "SELECT nextval('devdb.sim_delivery_event_phases_id_seq') AS next_id"
            )
            next_link_id = int(link_seq_df.iloc[0]["next_id"])
            conn.execute(
                """
                INSERT INTO sim_delivery_event_phases
                    (id, delivery_event_id, phase_id)
                VALUES (%s, %s, %s)
                """,
                (next_link_id, event_id, ph_id),
            )

        new_event_ids.append(event_id)
        event_counter += 1

    logger.info(
        f"P-00: Created {len(new_event_ids)} placeholder delivery event(s) "
        f"for ent_group_id={ent_group_id}."
    )

    # ------------------------------------------------------------------
    # Step 7: Generate intra-dev sequence predecessor rows
    # ------------------------------------------------------------------
    # Within each development, phases must deliver in sequence_number order
    # (simultaneous is fine; earlier sequence must never follow later sequence).
    # events_to_create is already in chronological order and phases within each
    # event were popped in sequence_number order — so creation order == sequence
    # order per dev. Write predecessor rows between consecutive events per dev
    # so P-0200/P-0400 enforce this as an absolute constraint.
    phase_dev_map = {
        int(r["phase_id"]): int(r["dev_id"])
        for _, r in all_phases_df.iterrows()
    }

    dev_event_sequence: dict[int, list[int]] = defaultdict(list)
    for ev_dict, event_id in zip(events_to_create, new_event_ids):
        devs_seen: set[int] = set()
        for ph_id in ev_dict["phases"]:
            dev_id = phase_dev_map.get(ph_id)
            if dev_id is not None and dev_id not in devs_seen:
                dev_event_sequence[dev_id].append(event_id)
                devs_seen.add(dev_id)

    pred_count = 0
    for dev_id, event_ids in dev_event_sequence.items():
        for i in range(1, len(event_ids)):
            conn.execute(
                """
                INSERT INTO sim_delivery_event_predecessors
                    (event_id, predecessor_event_id)
                VALUES (%s, %s)
                """,
                (event_ids[i], event_ids[i - 1]),
            )
            pred_count += 1

    if pred_count:
        logger.info(f"P-00: Created {pred_count} intra-dev sequence predecessor row(s).")

    # ------------------------------------------------------------------
    # Step 7c: Locked-anchor predecessors
    # ------------------------------------------------------------------
    # When earlier phases in a dev are locked and later phases are
    # placeholders, Step 7 above creates no predecessor (only new events
    # are in dev_event_sequence).  This leaves the first placeholder free
    # to schedule before the locked event — wrong ordering and causes
    # non-convergence.  Fix: anchor the first placeholder event per dev
    # to the locked event with the highest phase sequence_number for that dev.
    if locked_phase_ids and dev_event_sequence:
        anchor_df = conn.read_df(
            """
            SELECT sdp.dev_id, dep.delivery_event_id,
                   MAX(sdp.sequence_number) AS max_seq
            FROM sim_delivery_event_phases dep
            JOIN sim_delivery_events sde
                 ON sde.delivery_event_id = dep.delivery_event_id
            JOIN sim_dev_phases sdp ON sdp.phase_id = dep.phase_id
            WHERE sde.ent_group_id = %s
              AND sde.date_dev_actual IS NOT NULL
            GROUP BY sdp.dev_id, dep.delivery_event_id
            """,
            (ent_group_id,),
        )

        # For each dev: locked event with the highest phase sequence_number
        dev_anchor: dict[int, tuple[int, int]] = {}  # dev_id → (event_id, max_seq)
        for _, r in anchor_df.iterrows():
            dev_id = int(r["dev_id"])
            ev_id = int(r["delivery_event_id"])
            seq = int(r["max_seq"]) if r["max_seq"] is not None else 0
            if dev_id not in dev_anchor or seq > dev_anchor[dev_id][1]:
                dev_anchor[dev_id] = (ev_id, seq)

        anchor_pred_count = 0
        for dev_id, placeholder_event_ids in dev_event_sequence.items():
            if dev_id not in dev_anchor or not placeholder_event_ids:
                continue
            anchor_ev_id, _ = dev_anchor[dev_id]
            first_placeholder = placeholder_event_ids[0]
            conn.execute(
                """
                INSERT INTO sim_delivery_event_predecessors
                    (event_id, predecessor_event_id)
                VALUES (%s, %s)
                """,
                (first_placeholder, anchor_ev_id),
            )
            anchor_pred_count += 1
            logger.info(
                f"P-00: Dev {dev_id}: anchor predecessor "
                f"event {first_placeholder} → locked event {anchor_ev_id}."
            )

        if anchor_pred_count:
            logger.info(f"P-00: Created {anchor_pred_count} locked-anchor predecessor row(s).")

    # ------------------------------------------------------------------
    # Step 7b: Cross-tier predecessors (strict)
    # ------------------------------------------------------------------
    # A phase with delivery_tier = N cannot be scheduled until ALL phases
    # with delivery_tier = N-1 are delivered.  Enforce by adding predecessor
    # rows: every tier-N event must list every tier-(N-1) event as a
    # predecessor.  Phases with delivery_tier = NULL are unaffected.
    tier_df = conn.read_df(
        """
        SELECT sdp.phase_id, sdp.delivery_tier
        FROM sim_dev_phases sdp
        JOIN sim_ent_group_developments egd ON egd.dev_id = sdp.dev_id
        WHERE egd.ent_group_id = %s
          AND sdp.delivery_tier IS NOT NULL
        """,
        (ent_group_id,),
    )

    if not tier_df.empty:
        phase_tier_map = {
            int(r["phase_id"]): int(r["delivery_tier"])
            for _, r in tier_df.iterrows()
        }

        # Build event_id -> set of tiers from phases in that event
        event_tiers: dict[int, set[int]] = {}

        # New placeholder events (created this run)
        for ev_dict, ev_id in zip(events_to_create, new_event_ids):
            tiers = set()
            for ph_id in ev_dict["phases"]:
                t = phase_tier_map.get(ph_id)
                if t is not None:
                    tiers.add(t)
            if tiers:
                event_tiers[ev_id] = tiers

        # Locked events
        if locked_phase_ids:
            locked_ev_df = conn.read_df(
                """
                SELECT dep.delivery_event_id, dep.phase_id
                FROM sim_delivery_event_phases dep
                JOIN sim_delivery_events sde
                     ON sde.delivery_event_id = dep.delivery_event_id
                WHERE sde.ent_group_id = %s
                  AND sde.date_dev_actual IS NOT NULL
                """,
                (ent_group_id,),
            )
            for _, r in locked_ev_df.iterrows():
                ev_id = int(r["delivery_event_id"])
                ph_id = int(r["phase_id"])
                t = phase_tier_map.get(ph_id)
                if t is not None:
                    event_tiers.setdefault(ev_id, set()).add(t)

        # Group events by tier
        tier_to_events: dict[int, list[int]] = defaultdict(list)
        for ev_id, tiers in event_tiers.items():
            for t in tiers:
                tier_to_events[t].append(ev_id)

        # Insert: every tier-N event must come after every tier-(N-1) event
        tier_pred_count = 0
        tier_pairs_written: set[tuple[int, int]] = set()

        for tier_n in sorted(tier_to_events.keys()):
            tier_n1 = tier_n - 1
            if tier_n1 not in tier_to_events:
                continue
            for ev_n in tier_to_events[tier_n]:
                for ev_n1 in tier_to_events[tier_n1]:
                    if ev_n == ev_n1:
                        continue
                    pair = (ev_n, ev_n1)
                    if pair in tier_pairs_written:
                        continue
                    tier_pairs_written.add(pair)
                    conn.execute(
                        """
                        INSERT INTO sim_delivery_event_predecessors
                            (event_id, predecessor_event_id)
                        VALUES (%s, %s)
                        """,
                        (ev_n, ev_n1),
                    )
                    tier_pred_count += 1

        if tier_pred_count:
            logger.info(f"P-00: Created {tier_pred_count} cross-tier predecessor row(s).")

    return new_event_ids
