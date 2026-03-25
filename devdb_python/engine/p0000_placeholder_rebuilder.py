# p00_placeholder_rebuilder.py
# P-00: Delete all placeholder delivery events for the entitlement group and
#   rebuild them from the current demand signal (date_dev_demand_derived).
#
# Owns:     Deleting placeholder events (date_dev_actual IS NULL).
#           Inserting new auto-scheduled delivery events and phase links.
# Not Own:  Touching locked events (date_dev_actual IS NOT NULL).
#           Writing to sim_lots or sim_dev_phases date fields.
#           Running if auto_schedule_enabled is False.
# Inputs:   conn, ent_group_id.
# Outputs:  List of new delivery_event_ids created.
# Failure:  No undelivered phases: return empty list, log.
#           All phases have no demand signal: schedule at earliest window dates.

import math
from datetime import date, timedelta
from collections import defaultdict
from .connection import DBConnection


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


# ---------------------------------------------------------------------------
# Main module
# ---------------------------------------------------------------------------

def _get_phase_lots(conn, phase_id: int):
    """Return list of lot_count values from sim_phase_product_splits for a phase."""
    df = conn.read_df(f"SELECT lot_count FROM sim_phase_product_splits WHERE phase_id = {phase_id}")
    if df.empty:
        return [0]
    return [int(x) for x in df["lot_count"] if x is not None]


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
               delivery_window_start, delivery_window_end
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
          AND sl.projection_group_id IN (
              SELECT DISTINCT dpg.projection_group_id
              FROM dim_projection_groups dpg
              JOIN sim_ent_group_developments egd
                   ON egd.dev_id = dpg.dev_id
              WHERE egd.ent_group_id = {ent_group_id}
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

    # Delivery window is ent-group level (D-135); annual_starts_target is still per-PG.
    pg_annual_df = conn.read_df(f"""
        SELECT DISTINCT l.phase_id, pp.annual_starts_target
        FROM sim_lots l
        JOIN sim_projection_params pp
             ON pp.projection_group_id = l.projection_group_id
        WHERE l.phase_id IN ({phase_ids_str})
    """)

    # All phases share the ent-group-level window (D-135)
    window_map = {p["phase_id"]: (window_start_default, window_end_default)
                  for p in undelivered}
    annual_target_map = {}  # phase_id -> annual_starts_target
    for _, r in pg_annual_df.iterrows():
        ph_id = int(r["phase_id"])
        t = r["annual_starts_target"]
        if t is not None:
            annual_target_map[ph_id] = float(t)

    # Attach window to each undelivered phase
    for p in undelivered:
        ws, we = window_map.get(p["phase_id"], (5, 11))
        p["window_start"] = ws
        p["window_end"] = we

    # ------------------------------------------------------------------
    # Step 4b: Compute latest viable delivery date per dev from locked
    #          event inventory exhaustion.
    #
    # Each locked phase depletes independently at its own PG's pace.
    # For each locked phase:
    #   monthly_pace    = annual_starts_target for that phase's PG / 12
    #   exhaustion_date = date_dev_actual + ceil(lot_count / monthly_pace) months
    #   latest_viable   = snap_to_window(exhaustion - 1 month)
    #
    # dev_latest_viable[dev_id] = earliest latest_viable across all locked
    # phases for that dev (most urgent phase drives the deadline).
    # ------------------------------------------------------------------
    dev_latest_viable = {}  # dev_id -> date

    if locked_phase_ids:
        locked_ids_str = ", ".join(str(p) for p in locked_phase_ids)

        # Per-phase: delivery date, lot_count, and annual_starts_target from PG.
        # Use a DISTINCT subquery on sim_lots to get one projection_group_id per
        # phase — avoids inflating lot_count by fanning out across every lot row.
        locked_phase_df = conn.read_df(f"""
            SELECT sdp.phase_id,
                   sdp.dev_id,
                   sde.date_dev_actual,
                   sps.lot_count,
                   pp.annual_starts_target
            FROM sim_delivery_events sde
            JOIN sim_delivery_event_phases dep
                 ON sde.delivery_event_id = dep.delivery_event_id
            JOIN sim_dev_phases sdp ON dep.phase_id = sdp.phase_id
            JOIN sim_phase_product_splits sps ON sps.phase_id = sdp.phase_id
            JOIN (
                SELECT DISTINCT phase_id, projection_group_id
                FROM sim_lots
            ) phase_pg ON phase_pg.phase_id = sdp.phase_id
            JOIN sim_projection_params pp
                 ON pp.projection_group_id = phase_pg.projection_group_id
            WHERE sde.ent_group_id = {ent_group_id}
              AND sde.date_dev_actual IS NOT NULL
        """)

        for _, r in locked_phase_df.iterrows():
            dev_id_r = int(r["dev_id"])
            ph_id_r  = int(r["phase_id"])
            d = r["date_dev_actual"]
            d = d.date() if hasattr(d, "date") else d
            lot_count = int(r["lot_count"])
            annual_target = r["annual_starts_target"]
            if annual_target is None or float(annual_target) <= 0:
                continue
            monthly_pace = float(annual_target) / 12.0
            months_to_exhaust = math.ceil(lot_count / monthly_pace)
            exhaustion_date = _add_months(d.replace(day=1), months_to_exhaust)
            lv = _add_months(exhaustion_date, -1)
            # Skip phases whose inventory is already exhausted
            if lv < today_first:
                print(f"P-00: Dev {dev_id_r} phase {ph_id_r}: lot_count={lot_count}, "
                      f"pace={monthly_pace:.1f}/mo, exhausts={exhaustion_date}, "
                      f"lv={lv} (expired — skipped)")
                continue
            # dev_latest_viable = earliest non-expired lv across locked phases (most urgent)
            if dev_id_r not in dev_latest_viable or lv < dev_latest_viable[dev_id_r]:
                dev_latest_viable[dev_id_r] = lv
            print(f"P-00: Dev {dev_id_r} phase {ph_id_r}: lot_count={lot_count}, "
                  f"pace={monthly_pace:.1f}/mo, exhausts={exhaustion_date}, "
                  f"lv={lv}")

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

    # Track scheduled state
    events_per_year: dict[int, int] = defaultdict(int)
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
            events_per_year[d.year] += 1
            if last_date is None or d > last_date:
                last_date = d
            if last_locked_date is None or d > last_locked_date:
                last_locked_date = d

    # No auto-scheduled event may land in the same year as (or before) the
    # last locked event.  Earliest valid year = last_locked_year + 1.
    last_locked_year: int | None = last_locked_date.year if last_locked_date else None

    def _constrain_date(ideal: date, ws: int, we: int) -> date:
        """Push ideal forward until max_per_year and min_gap are satisfied."""
        d = ideal
        for _ in range(500):  # safety limit
            # min_gap constraint
            if last_date is not None and min_gap > 0:
                min_ok = _add_months(last_date, min_gap)
                min_ok = min_ok.replace(day=1)
                if d < min_ok:
                    d = _next_window_month_from(min_ok, ws, we)
                    continue

            # max_per_year constraint
            if events_per_year[d.year] >= max_per_year:
                # Push to first window month of next year
                d = _first_window_month_in_year(d.year + 1, ws)
                continue

            break
        return d

    # Build per-dev state for cross-dev scheduling
    from collections import OrderedDict

    def _snap_to_window(d, ws, we):
        """Latest window month <= d. If d.month < ws, go to prior year we."""
        m = d.month
        if m > we:
            m = we
        if m < ws:
            return date(d.year - 1, we, 1)
        return date(d.year, m, 1)

    # Group undelivered phases by dev, sorted by sequence_number
    dev_phases = defaultdict(list)
    for phase in undelivered:
        dev_phases[phase["dev_id"]].append(phase)
    for dev_id in dev_phases:
        dev_phases[dev_id].sort(key=lambda p: p["sequence_number"])

    ws = window_start_default
    we = window_end_default

    # monthly pace per dev: average annual_starts_target across phases for that dev
    dev_monthly_pace = {}
    for dev_id, phases_list in dev_phases.items():
        targets = [annual_target_map[p["phase_id"]] for p in phases_list if p["phase_id"] in annual_target_map]
        if targets:
            dev_monthly_pace[dev_id] = (sum(targets) / len(targets)) / 12.0

    # Per-dev latest_viable: from locked exhaustion if available, else from first phase demand
    dev_lv = {}
    for dev_id in dev_phases:
        if dev_id in dev_latest_viable:
            dev_lv[dev_id] = _snap_to_window(dev_latest_viable[dev_id], ws, we)
        else:
            first_demand = dev_phases[dev_id][0]["demand_date"]
            if first_demand:
                dev_lv[dev_id] = _snap_to_window(first_demand, ws, we)
            else:
                dev_lv[dev_id] = date(last_locked_year + 1 if last_locked_year else today_first.year, ws, 1)

    last_event_year = last_locked_year if last_locked_year else (today_first.year - 1)
    events_to_create = []

    for _ in range(200):
        # Find devs with remaining phases
        active = {d: phases for d, phases in dev_phases.items() if phases}
        if not active:
            break

        # Apply D-119 floor to each dev's lv
        deadlines = {}
        for dev_id in active:
            lv_d = dev_lv[dev_id]
            if lv_d.year <= last_event_year:
                lv_d = date(last_event_year + 1, ws, 1)
            deadlines[dev_id] = lv_d

        # Most urgent dev drives the event date
        urgent_dev = min(deadlines, key=lambda d: deadlines[d])
        event_date = deadlines[urgent_dev]

        # All devs whose deadline <= event_date join this event
        joining = [d for d in active if deadlines[d] <= event_date]

        event_phase_ids = []
        for dev_id in joining:
            pace = dev_monthly_pace.get(dev_id, 1.0)
            next_allowed = date(event_date.year + 1, ws, 1)

            # Take next phase; batch if it can't bridge to next allowed year
            batch = [dev_phases[dev_id].pop(0)]
            while True:
                total_lots = sum(
                    sum(sps_lot_count for sps_lot_count in _get_phase_lots(conn, p["phase_id"]))
                    for p in batch
                )
                months_to_exhaust = math.ceil(total_lots / pace) if pace > 0 else 999
                exh = _add_months(event_date, months_to_exhaust)
                new_lv = _snap_to_window(_add_months(exh, -1), ws, we)
                if new_lv >= next_allowed:
                    break
                if not dev_phases[dev_id]:
                    break
                batch.append(dev_phases[dev_id].pop(0))

            total_lots = sum(
                sum(sps_lot_count for sps_lot_count in _get_phase_lots(conn, p["phase_id"]))
                for p in batch
            )
            months_to_exhaust = math.ceil(total_lots / pace) if pace > 0 else 999
            exh = _add_months(event_date, months_to_exhaust)
            dev_lv[dev_id] = _snap_to_window(_add_months(exh, -1), ws, we)

            for p in batch:
                event_phase_ids.append(p["phase_id"])

        events_to_create.append({"date": event_date, "phases": event_phase_ids})
        events_per_year[event_date.year] += 1
        last_date = event_date
        last_event_year = event_date.year

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
