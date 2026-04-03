"""
P-0000 placeholder_rebuilder — Rebuild placeholder delivery events from demand signal.

Reads:   sim_delivery_events, sim_delivery_event_phases, sim_dev_phases,
         sim_entitlement_delivery_config (DB)
Writes:  sim_delivery_events, sim_delivery_event_phases (DB, DELETE + INSERT)
Input:   conn: DBConnection, ent_group_id: int
Rules:   Deletes all placeholder events (date_dev_actual IS NULL) for the ent_group.
         Inserts new auto-scheduled events per D-139 cross-dev bundling logic.
         No-ops if auto_schedule_enabled is False. Never touches locked events.
         No undelivered phases → return empty list.
         Not Own: touching locked events, writing to sim_lots or sim_dev_phases date fields.
"""

import math
from datetime import date, timedelta
from collections import defaultdict
from .connection import DBConnection
from .seasonal_weights import effective_annual_pace


# ---------------------------------------------------------------------------
# Date helpers
# ---------------------------------------------------------------------------

def _add_months(d: date, n: int) -> date:
    """Add n months to a first-of-month date."""
    month = d.month + n
    year = d.year + (month - 1) // 12
    month = ((month - 1) % 12) + 1
    return d.replace(year=year, month=month, day=1)


def _lean_window_date(demand_date: date, window_start: int, window_end: int,
                      today_first: date) -> date:
    """
    Return the latest first-of-month date that:
    - Falls within [window_start, window_end] (inclusive month numbers)
    - Is <= demand_date
    - Is >= today_first

    If no such date exists (demand already past all window months for its year,
    or demand month precedes window), return the next available window month
    >= today_first.
    """
    if demand_date is None:
        return _next_window_month_from(today_first, window_start, window_end)

    d = demand_date.replace(day=1)

    # Walk back from demand month looking for latest window month >= today_first
    for _ in range(25):  # up to ~2 years back
        if window_start <= d.month <= window_end:
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
    return _next_window_month_from(today_first, window_start, window_end)


def _next_window_month_from(from_date: date, window_start: int,
                             window_end: int) -> date:
    """Return the earliest first-of-month >= from_date within the window."""
    d = from_date.replace(day=1)
    for _ in range(25):
        if window_start <= d.month <= window_end:
            return d
        if d.month == 12:
            d = d.replace(year=d.year + 1, month=1)
        else:
            d = d.replace(month=d.month + 1)
    # Fallback — should not reach here for reasonable window values
    return from_date.replace(day=1)


def _next_window_month_after(after_date: date, window_start: int,
                              window_end: int) -> date:
    """Return the earliest first-of-month strictly after after_date in window."""
    d = after_date.replace(day=1)
    if d.month == 12:
        d = d.replace(year=d.year + 1, month=1)
    else:
        d = d.replace(month=d.month + 1)
    return _next_window_month_from(d, window_start, window_end)


def _first_window_month_in_year(year: int, window_start: int) -> date:
    return date(year, window_start, 1)


def _snap_to_window(d: date, ws: int, we: int) -> date:
    """Latest first-of-month within [ws, we] that is <= d. If d.month < ws, go to prior year we."""
    m = d.month
    if m > we:
        m = we
    if m < ws:
        return date(d.year - 1, we, 1)
    return date(d.year, m, 1)


def _months_between(d1: date, d2: date) -> int:
    """Months from d1 to d2, clamped to 0 if d2 <= d1."""
    return max(0, (d2.year - d1.year) * 12 + (d2.month - d1.month))


# ---------------------------------------------------------------------------
# Main module
# ---------------------------------------------------------------------------

def _get_phase_lots(conn, phase_id: int):
    """Return list of projected_count values from sim_phase_product_splits for a phase."""
    df = conn.read_df(f"SELECT projected_count FROM sim_phase_product_splits WHERE phase_id = {phase_id}")
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
    config_df = conn.read_df(f"""
        SELECT auto_schedule_enabled, max_deliveries_per_year, min_gap_months,
               delivery_window_start, delivery_window_end,
               COALESCE(min_d_count, min_unstarted_inventory) AS min_d_count
        FROM sim_entitlement_delivery_config
        WHERE ent_group_id = {ent_group_id}
    """)

    if config_df.empty:
        print(f"P-00: No delivery config for ent_group_id={ent_group_id}. Skipping.")
        return []

    row = config_df.iloc[0]
    if not bool(row["auto_schedule_enabled"]):
        print(f"P-00: auto_schedule_enabled=False for ent_group_id={ent_group_id}. Skipping.")
        return []

    max_per_year = int(row["max_deliveries_per_year"] or 1)
    min_gap = int(row["min_gap_months"] or 0)
    window_start_default = int(row["delivery_window_start"] or 5)
    window_end_default   = int(row["delivery_window_end"]   or 11)
    min_buffer = int(row["min_d_count"] or 0)

    # ------------------------------------------------------------------
    # Step 2: Delete existing placeholder events
    # ------------------------------------------------------------------
    placeholder_df = conn.read_df(f"""
        SELECT delivery_event_id
        FROM sim_delivery_events
        WHERE ent_group_id = {ent_group_id}
          AND date_dev_actual IS NULL
    """)

    if not placeholder_df.empty:
        ids_str = ", ".join(str(int(x)) for x in placeholder_df["delivery_event_id"])

        conn.execute(f"""
            DELETE FROM sim_delivery_event_predecessors
            WHERE event_id IN ({ids_str})
               OR predecessor_event_id IN ({ids_str})
        """)
        conn.execute(f"""
            DELETE FROM sim_delivery_event_phases
            WHERE delivery_event_id IN ({ids_str})
        """)
        conn.execute(f"""
            DELETE FROM sim_delivery_events
            WHERE delivery_event_id IN ({ids_str})
        """)
        print(f"P-00: Deleted {len(placeholder_df)} placeholder event(s).")
    else:
        print("P-00: No placeholder events to delete.")

    # ------------------------------------------------------------------
    # Step 3: Collect undelivered phases
    # ------------------------------------------------------------------
    # Get all phases for this ent_group
    all_phases_df = conn.read_df(f"""
        SELECT sdp.phase_id, sdp.dev_id, sdp.date_dev_demand_derived,
               sdp.sequence_number
        FROM sim_dev_phases sdp
        JOIN sim_ent_group_developments egd
             ON egd.dev_id = sdp.dev_id
        WHERE egd.ent_group_id = {ent_group_id}
    """)

    if all_phases_df.empty:
        print(f"P-00: No phases found for ent_group_id={ent_group_id}.")
        return []

    # Phases covered by locked events
    locked_phases_df = conn.read_df(f"""
        SELECT DISTINCT dep.phase_id
        FROM sim_delivery_event_phases dep
        JOIN sim_delivery_events de
             ON de.delivery_event_id = dep.delivery_event_id
        WHERE de.ent_group_id = {ent_group_id}
          AND de.date_dev_actual IS NOT NULL
    """)
    locked_phase_ids = set(int(x) for x in locked_phases_df["phase_id"]) if not locked_phases_df.empty else set()

    undelivered = []
    for _, ph in all_phases_df.iterrows():
        ph_id = int(ph["phase_id"])
        if ph_id in locked_phase_ids:
            continue
        dev_id = int(ph["dev_id"])
        demand = ph["date_dev_demand_derived"]
        demand = demand.date() if hasattr(demand, "date") else demand
        undelivered.append({
            "phase_id": ph_id,
            "dev_id": dev_id,
            "demand_date": demand,
            "sequence_number": int(ph["sequence_number"]) if ph["sequence_number"] is not None else 9999,
        })

    if not undelivered:
        print(f"P-00: All phases are covered by locked events for ent_group_id={ent_group_id}.")
        return []

    # ------------------------------------------------------------------
    # Step 3b: Compute sellout date -- MAX(date_cls) across sim lots in
    # all PGs for this ent_group. Used to drop phases whose demand is
    # beyond the projection horizon.
    # ------------------------------------------------------------------
    sellout_df = conn.read_df(f"""
        SELECT MAX(sl.date_cls) AS sellout_date
        FROM sim_lots sl
        WHERE sl.lot_source = 'sim'
          AND sl.dev_id IN (
              SELECT dev_id FROM sim_ent_group_developments
              WHERE ent_group_id = {ent_group_id}
          )
    """)
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
        sim_count_df = conn.read_df(f"""
            SELECT COUNT(*) AS cnt
            FROM sim_lots
            WHERE phase_id = {ph_id} AND lot_source = 'sim'
        """)
        sim_count = int(sim_count_df.iloc[0]["cnt"]) if not sim_count_df.empty else 0

        # (a) Null demand with no sim lots -- no delivery needed
        if demand is None and sim_count == 0:
            print(f"P-00: Phase {ph_id} skipped -- null demand and no sim lots.")
            continue

        # (b) Demand past sellout horizon
        if demand is not None and sellout_date is not None and demand > sellout_date:
            print(f"P-00: Phase {ph_id} skipped -- demand {demand} is beyond sellout "
                  f"horizon {sellout_date}.")
            continue

        filtered.append(p)

    skipped = len(undelivered) - len(filtered)
    if skipped:
        print(f"P-00: {skipped} phase(s) skipped (null demand or beyond sellout). "
              f"{len(filtered)} phase(s) proceeding to schedule.")
    undelivered = filtered

    if not undelivered:
        print(f"P-00: No schedulable phases remain for ent_group_id={ent_group_id}.")
        return []

    # ------------------------------------------------------------------
    # Step 4: Get window parameters per phase (via phase -> PG mapping)
    # ------------------------------------------------------------------
    phase_ids_str = ", ".join(str(p["phase_id"]) for p in undelivered)

    # Delivery window is ent-group level (D-135); annual_starts_target is per-dev.
    pg_annual_df = conn.read_df(f"""
        SELECT DISTINCT sdp.phase_id, sdvp.annual_starts_target,
               COALESCE(sdvp.seasonal_weight_set, 'balanced_2yr') AS seasonal_weight_set
        FROM sim_dev_phases sdp
        JOIN sim_dev_params sdvp ON sdvp.dev_id = sdp.dev_id
        WHERE sdp.phase_id IN ({phase_ids_str})
    """)

    # All phases share the ent-group-level window (D-135)
    window_map = {p["phase_id"]: (window_start_default, window_end_default)
                  for p in undelivered}
    annual_target_map = {}  # phase_id -> effective monthly pace
    for _, r in pg_annual_df.iterrows():
        ph_id = int(r["phase_id"])
        t = r["annual_starts_target"]
        if t is not None:
            ws_name = r["seasonal_weight_set"]
            annual_target_map[ph_id] = effective_annual_pace(ws_name, float(t)) / 12.0

    # Attach window to each undelivered phase
    for p in undelivered:
        ws, we = window_map.get(p["phase_id"], (5, 11))
        p["window_start"] = ws
        p["window_end"] = we

    # ------------------------------------------------------------------
    # Step 4b: Load projected D-balance from DB.
    #
    # Includes ONLY real lots and sim lots from LOCKED delivery phases.
    # Auto-delivery sim lots are excluded here because:
    #   (a) they frequently have date_str < date_dev (demand pool assigned
    #       them pre-delivery slots) making them invisible to the D_end
    #       condition, and
    #   (b) _apply_delivery_to_balance() handles auto-delivery contributions
    #       with an accurate drain-delay model — including them in both
    #       places would double-count.
    # ------------------------------------------------------------------
    all_dev_ids_for_query = [int(d) for d in all_phases_df["dev_id"].unique()]
    d_balance: dict[int, dict[date, int]] = {d: {} for d in all_dev_ids_for_query}

    # Build lot-source filter: real lots always included; locked-phase sim
    # lots included so their confirmed D trajectory is captured accurately.
    if locked_phase_ids:
        _locked_phase_list = ", ".join(str(p) for p in sorted(locked_phase_ids))
        _lot_filter = (
            f"AND (sl.lot_source = 'real' "
            f"OR sl.phase_id IN ({_locked_phase_list}))"
        )
    else:
        _lot_filter = "AND sl.lot_source = 'real'"

    if all_dev_ids_for_query:
        dev_values = ", ".join(f"({d})" for d in all_dev_ids_for_query)
        d_proj_df = conn.read_df(f"""
            WITH future AS (
                SELECT generate_series(
                    DATE_TRUNC('MONTH', CURRENT_DATE)::DATE,
                    (DATE_TRUNC('MONTH', CURRENT_DATE) + INTERVAL '30 years')::DATE,
                    INTERVAL '1 month'
                )::DATE AS m
            ),
            devs (dev_id) AS (
                VALUES {dev_values}
            )
            SELECT devs.dev_id, f.m AS calendar_month,
                   COUNT(sl.lot_id) AS d_end
            FROM future f
            CROSS JOIN devs
            LEFT JOIN sim_lots sl
                ON  sl.dev_id = devs.dev_id
                AND sl.date_dev IS NOT NULL
                AND sl.date_dev <= f.m
                AND (sl.date_td     IS NULL OR sl.date_td     > f.m)
                AND (sl.date_td_hold IS NULL OR sl.date_td_hold > f.m)
                {_lot_filter}
            GROUP BY devs.dev_id, f.m
            ORDER BY devs.dev_id, f.m
        """)
        for _, dr in d_proj_df.iterrows():
            d_id = int(dr["dev_id"])
            m = dr["calendar_month"]
            m = m.date() if hasattr(m, "date") else m
            d_balance[d_id][m] = int(dr["d_end"])

    # Per-dev demand pool tracking.
    #
    # The demand allocator (S-0700/S-0800) assigns demand slots from a per-dev
    # pool starting at demand_start = first month after the last locked delivery.
    # Real lots and locked-phase sim lots consume the earliest slots; auto-delivery
    # sim lots get whatever is left.  If the pool has only advanced to, say,
    # August 2028 by the time a May 2030 delivery is scheduled, those lots sit
    # in D from May 2030 until August 2028 demand slots arrive — a 20-month delay.
    # _apply_delivery_to_balance must account for this "drain delay" so that P-0000
    # does not find false D-floor violations earlier than they will actually occur.

    # Per-dev last locked delivery date (scan floor — skip pre-delivery zeros).
    last_locked_per_dev: dict[int, date] = {}
    if locked_phase_ids:
        llpd_df = conn.read_df(f"""
            SELECT sdp.dev_id, MAX(sde.date_dev_actual) AS last_locked
            FROM sim_delivery_events sde
            JOIN sim_delivery_event_phases dep
                 ON dep.delivery_event_id = sde.delivery_event_id
            JOIN sim_dev_phases sdp ON sdp.phase_id = dep.phase_id
            WHERE sde.ent_group_id = {ent_group_id}
              AND sde.date_dev_actual IS NOT NULL
            GROUP BY sdp.dev_id
        """)
        for _, llr in llpd_df.iterrows():
            d_raw = llr["last_locked"]
            if d_raw is not None:
                d_val = d_raw.date() if hasattr(d_raw, "date") else d_raw
                last_locked_per_dev[int(llr["dev_id"])] = d_val

    # Compute per-dev demand pool state from DB.
    # demand_start = first month after each dev's last locked delivery.
    # demand_consumed = count of lots (real + locked-phase sim) with date_str
    # >= demand_start; represents how far the demand pool has advanced.
    global_demand_start_per_dev: dict[int, date] = {}
    for _dev in all_dev_ids_for_query:
        _ll = last_locked_per_dev.get(_dev)
        global_demand_start_per_dev[_dev] = _add_months(_ll, 1) if _ll else today_first

    demand_consumed: dict[int, int] = {}
    for _dev in all_dev_ids_for_query:
        _ds = global_demand_start_per_dev[_dev]
        _ds_str = _ds.strftime("%Y-%m-%d")
        if locked_phase_ids:
            _lp_str = ", ".join(str(p) for p in sorted(locked_phase_ids))
            _dc_filter = f"AND (lot_source = 'real' OR phase_id IN ({_lp_str}))"
        else:
            _dc_filter = "AND lot_source = 'real'"
        _dc_df = conn.read_df(f"""
            SELECT COUNT(*) AS cnt FROM sim_lots
            WHERE dev_id = {_dev}
              AND date_str IS NOT NULL
              AND date_str >= '{_ds_str}'::date
              {_dc_filter}
        """)
        demand_consumed[_dev] = int(_dc_df.iloc[0]["cnt"]) if not _dc_df.empty else 0
        print(f"P-00: Dev {_dev}: demand_start={_ds}, "
              f"demand_consumed={demand_consumed[_dev]}")

    def _compute_drain_delay(dev_id_key: int, delivery_m: date) -> int:
        """
        Months from delivery_m until the demand pool reaches this delivery's
        first lot.  If the pool is already past delivery_m, delay = 0
        (drain starts immediately).
        """
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
        """Add a delivery's D contribution to d_balance[dev_id_key].

        drain_delay: months from delivery_month before lots start leaving D.
        During the delay, all n_lots sit in D waiting for demand to arrive.
        After the delay, lots drain at monthly_pace lots/month.
        """
        if n_lots <= 0 or monthly_pace <= 0:
            return
        bal = d_balance.setdefault(dev_id_key, {})
        for k in range(500):
            m = _add_months(delivery_month, k)
            if k <= drain_delay:
                contrib = n_lots  # demand hasn't arrived yet; all lots in D
            else:
                drain_elapsed = k - drain_delay
                contrib = n_lots - min(n_lots, int(monthly_pace * drain_elapsed))
                if contrib <= 0:
                    break
            bal[m] = bal.get(m, 0) + contrib

    def _find_violation_month(dev_id_key: int, scan_floor: date) -> date | None:
        """First month after scan_floor where d_balance <= min_buffer (exhaustion)."""
        bal = d_balance.get(dev_id_key, {})
        for m in sorted(bal.keys()):
            if m <= scan_floor:
                continue
            if bal[m] <= min_buffer:
                return m
        return None

    def _dev_lv_from_balance(dev_id_key: int, scan_floor: date,
                              ws_: int, we_: int) -> date | None:
        """Latest viable window month before first D violation; None if no violation."""
        violation = _find_violation_month(dev_id_key, scan_floor)
        if violation is None:
            return None
        prev = _add_months(violation, -1)
        lv = _snap_to_window(prev, ws_, we_)
        if lv < today_first:
            lv = _next_window_month_from(today_first, ws_, we_)
        print(f"P-00: Dev {dev_id_key}: D-balance violation {violation}, lv={lv}")
        return lv

    # ------------------------------------------------------------------
    # Step 5: Schedule delivery events
    # ------------------------------------------------------------------
    # Sort: phases with demand date first (ascending), then null-demand last,
    # secondary sort by dev_id for stability
    undelivered.sort(key=lambda p: (
        p["demand_date"] is None,
        p["demand_date"] or date.max,
        p["dev_id"],
    ))

    # Track scheduled state.
    # delivery_date_per_year: one delivery date per calendar year per community.
    # Any number of phases can land on that date; the date itself is the constraint.
    # Locked events establish the date for their year; auto events snap to it.
    delivery_date_per_year: dict[int, date] = {}
    last_date: date | None = None

    # Account for locked events already scheduled this/prior years
    locked_dates_df = conn.read_df(f"""
        SELECT date_dev_actual
        FROM sim_delivery_events
        WHERE ent_group_id = {ent_group_id}
          AND date_dev_actual IS NOT NULL
    """)
    last_locked_date: date | None = None
    for _, r in locked_dates_df.iterrows():
        d = r["date_dev_actual"]
        if d is not None:
            d = d.date() if hasattr(d, "date") else d
            # Locked event establishes the delivery date for its year
            delivery_date_per_year[d.year] = d
            if last_date is None or d > last_date:
                last_date = d
            if last_locked_date is None or d > last_locked_date:
                last_locked_date = d

    def _constrain_date(ideal: date, ws: int, we: int) -> date:
        """
        Return the earliest valid delivery date >= ideal, respecting:
        - One delivery date per year (snap to existing date if year is taken)
        - min_gap months between consecutive delivery dates (new years only)

        max_per_year is no longer a count — any number of phases can land on
        the single allowed date for a given year.
        """
        d = ideal
        for _ in range(500):  # safety limit
            # If this year already has a delivery date (locked or auto),
            # snap to it — no further constraints apply.
            if d.year in delivery_date_per_year:
                return delivery_date_per_year[d.year]

            # New year: enforce min_gap from the last delivery date.
            if last_date is not None and min_gap > 0:
                min_ok = _add_months(last_date, min_gap)
                min_ok = min_ok.replace(day=1)
                if d < min_ok:
                    d = _next_window_month_from(min_ok, ws, we)
                    continue

            break
        return d

    # Build per-dev state for cross-dev scheduling
    from collections import OrderedDict  # noqa: F401

    # Group undelivered phases by dev, sorted by sequence_number
    dev_phases = defaultdict(list)
    for phase in undelivered:
        dev_phases[phase["dev_id"]].append(phase)
    for dev_id in dev_phases:
        dev_phases[dev_id].sort(key=lambda p: p["sequence_number"])

    ws = window_start_default
    we = window_end_default

    # monthly pace per dev: average effective monthly pace across phases for that dev
    dev_monthly_pace = {}
    for dev_id, phases_list in dev_phases.items():
        paces = [annual_target_map[p["phase_id"]] for p in phases_list if p["phase_id"] in annual_target_map]
        if paces:
            dev_monthly_pace[dev_id] = sum(paces) / len(paces)

    # Per-dev scan floor: start scanning after last locked delivery for this dev
    dev_scan_floor: dict[int, date] = {}
    for dev_id in dev_phases:
        dev_scan_floor[dev_id] = last_locked_per_dev.get(dev_id, today_first - timedelta(days=1))

    events_to_create = []

    for _ in range(200):
        # Find devs with remaining phases
        active = {d: phases for d, phases in dev_phases.items() if phases}
        if not active:
            break

        # Compute deadline per dev from live d_balance, then constrain via
        # _constrain_date (snaps to year's existing date or enforces min_gap).
        deadlines = {}
        for dev_id in active:
            lv_d = _dev_lv_from_balance(dev_id, dev_scan_floor[dev_id], ws, we)
            if lv_d is None:
                # No D-floor violation found in scan window — fall back to
                # demand_date signal; never schedule before today_first.
                first_demand = dev_phases[dev_id][0]["demand_date"]
                lv_d = (_snap_to_window(first_demand, ws, we) if first_demand
                        else _next_window_month_from(today_first, ws, we))
                if lv_d < today_first:
                    lv_d = _next_window_month_from(today_first, ws, we)
            lv_d = _constrain_date(lv_d, ws, we)
            deadlines[dev_id] = lv_d

        # Most urgent dev drives the event date
        urgent_dev = min(deadlines, key=lambda d: deadlines[d])
        event_date = deadlines[urgent_dev]

        # Warn if the constrained delivery lands at or after the D-floor
        # violation month — means the constraint cannot be satisfied given
        # current max_per_year / min_gap settings.
        violation_check = _find_violation_month(urgent_dev, dev_scan_floor[urgent_dev])
        if violation_check is not None and event_date >= violation_check:
            print(
                f"P-00: WARNING: Dev {urgent_dev}: next delivery {event_date} "
                f"cannot be moved before D-floor violation at {violation_check} "
                f"(max_deliveries_per_year={max_per_year}, "
                f"min_gap_months={min_gap}, min_d_count={min_buffer}). "
                f"D-balance floor will not be maintained."
            )

        # All devs whose deadline <= event_date join this event
        joining = [d for d in active if deadlines[d] <= event_date]

        event_phase_ids = []
        for dev_id in joining:
            pace = dev_monthly_pace.get(dev_id, 1.0)
            next_allowed = date(event_date.year + 1, ws, 1)

            # Always take the first queued phase, then apply its D contribution
            # incrementally so d_balance reflects this delivery going forward.
            # drain_delay: months from delivery until demand pool reaches these lots.
            batch = [dev_phases[dev_id].pop(0)]
            first_lots = sum(_get_phase_lots(conn, batch[0]["phase_id"]))
            _delay = _compute_drain_delay(dev_id, event_date)
            _apply_delivery_to_balance(dev_id, event_date, first_lots, pace, _delay)
            demand_consumed[dev_id] = demand_consumed.get(dev_id, 0) + first_lots
            print(f"P-00: Dev {dev_id}: delivery {event_date}, "
                  f"lots={first_lots}, drain_delay={_delay}mo, "
                  f"demand_consumed→{demand_consumed[dev_id]}")

            # Batch more phases if first phase alone can't bridge to next year
            # (D-139 batching rule).  Each extra phase's contribution is added
            # to d_balance incrementally — no undo needed.
            while True:
                next_v = _find_violation_month(dev_id, event_date)
                if next_v is None:
                    break  # no future violation — bridge is sufficient
                next_lv = _snap_to_window(_add_months(next_v, -1), ws, we)
                if next_lv >= next_allowed:
                    break  # batch bridges to next allowed year
                if not dev_phases[dev_id]:
                    break  # no more phases available
                extra = dev_phases[dev_id].pop(0)
                batch.append(extra)
                extra_lots = sum(_get_phase_lots(conn, extra["phase_id"]))
                _delay_extra = _compute_drain_delay(dev_id, event_date)
                _apply_delivery_to_balance(dev_id, event_date, extra_lots, pace, _delay_extra)
                demand_consumed[dev_id] = demand_consumed.get(dev_id, 0) + extra_lots

            # Advance scan floor so next scan starts after this delivery.
            dev_scan_floor[dev_id] = event_date

            for p in batch:
                event_phase_ids.append(p["phase_id"])

        events_to_create.append({"date": event_date, "phases": event_phase_ids})
        # Register this year's delivery date so subsequent auto phases snap to it
        if event_date.year not in delivery_date_per_year:
            delivery_date_per_year[event_date.year] = event_date
        last_date = event_date

    events_to_create.sort(key=lambda e: e["date"])

    # ------------------------------------------------------------------
    # Step 6: Write new events
    # ------------------------------------------------------------------
    # Get next available delivery_event_id
    max_id_df = conn.read_df("SELECT MAX(delivery_event_id) AS max_id FROM sim_delivery_events")
    next_id = int(max_id_df.iloc[0]["max_id"] or 0) + 1

    new_event_ids = []
    event_counter = 1

    for ev in events_to_create:
        event_id = next_id
        next_id += 1
        event_name = f"Auto-scheduled delivery {event_counter}"
        projected_date = ev["date"].strftime("%Y-%m-%d")

        # Use the window values from the first phase in the group
        first_phase_id = ev["phases"][0]
        ws, we = window_map.get(first_phase_id, (5, 11))

        conn.execute(f"""
            INSERT INTO sim_delivery_events
                (delivery_event_id, ent_group_id, event_name,
                 delivery_window_start, delivery_window_end,
                 date_dev_actual, date_dev_projected,
                 is_auto_created, is_placeholder,
                 created_at, updated_at)
            VALUES (
                {event_id}, {ent_group_id}, '{event_name}',
                {ws}, {we},
                NULL, '{projected_date}',
                TRUE, TRUE,
                current_timestamp, current_timestamp
            )
        """)

        for ph_id in ev["phases"]:
            phase_link_df = conn.read_df(
                "SELECT MAX(id) AS max_id FROM sim_delivery_event_phases"
            )
            next_link_id = int(phase_link_df.iloc[0]["max_id"] or 0) + 1
            conn.execute(f"""
                INSERT INTO sim_delivery_event_phases
                    (id, delivery_event_id, phase_id)
                VALUES ({next_link_id}, {event_id}, {ph_id})
            """)

        new_event_ids.append(event_id)
        event_counter += 1

    print(
        f"P-00: Created {len(new_event_ids)} placeholder delivery event(s) "
        f"for ent_group_id={ent_group_id}."
    )
    return new_event_ids
