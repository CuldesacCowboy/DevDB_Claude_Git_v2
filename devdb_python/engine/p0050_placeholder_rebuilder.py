"""
P-0050 placeholder_rebuilder — Rebuild placeholder delivery events from demand signal.

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
from .date_window_helpers import (
    add_months, lean_window_date, next_window_month_from, next_window_month_after,
    first_window_month_in_year, snap_to_window, months_between,
)

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Internal helper
# ---------------------------------------------------------------------------

def _get_phase_lots(conn, phase_id: int):
    """Return list of projected_count values from sim_phase_product_splits for a phase."""
    df = conn.read_df("SELECT projected_count FROM sim_phase_product_splits WHERE phase_id = %s", (phase_id,))
    if df.empty:
        return [0]
    return [int(x) for x in df["projected_count"] if x is not None]


# ---------------------------------------------------------------------------
# Step 2 — Delete existing placeholder events
# ---------------------------------------------------------------------------

def _delete_placeholder_events(conn, ent_group_id: int) -> None:
    """Delete all placeholder (non-locked) delivery events and their links."""
    placeholder_df = conn.read_df(
        """
        SELECT delivery_event_id
        FROM sim_delivery_events
        WHERE ent_group_id = %s
          AND date_dev_actual IS NULL
        """,
        (ent_group_id,),
    )
    if placeholder_df.empty:
        logger.info("P-00: No placeholder events to delete.")
        return

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
    logger.info(f"P-00: Deleted {len(placeholder_ids)} placeholder event(s).")


# ---------------------------------------------------------------------------
# Step 3 — Collect schedulable phases
# ---------------------------------------------------------------------------

def _collect_schedulable_phases(conn, ent_group_id: int, today_first: date) -> dict | None:
    """
    Load all undelivered phases for the entitlement group, filter to those with
    a demand signal or real lots, and return the data needed by the scheduling loop.

    Returns None if there is nothing to schedule (caller should return []).
    Returns a dict with keys:
        undelivered       list of phase dicts
        locked_phase_ids  set[int]
        all_phases_df     DataFrame (all phases in group, including locked)
        phases_with_sim_lots  set[int]  (phases already have prior-iteration sim lots)
    """
    import pandas as pd

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
        return None

    # Phases already covered by locked (actual) events
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

    # Build undelivered list (phases not yet covered by a locked event)
    undelivered = []
    for _, ph in all_phases_df.iterrows():
        ph_id = int(ph["phase_id"])
        if ph_id in locked_phase_ids:
            continue
        dev_id = int(ph["dev_id"])
        demand = ph["date_dev_demand_derived"]
        demand = demand.date() if hasattr(demand, "date") else demand
        try:
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
        logger.info(f"P-00: All phases covered by locked events for ent_group_id={ent_group_id}.")
        return None

    # Step 3b: Sellout date — MAX(date_cls) across sim lots for this ent_group
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
    sellout_raw = sellout_df.iloc[0]["sellout_date"] if not sellout_df.empty else None
    if sellout_raw is not None and not pd.isnull(sellout_raw):
        sellout_date = sellout_raw.date() if hasattr(sellout_raw, "date") else sellout_raw
    else:
        sellout_date = None

    # Step 3c: Filter phases with no signal and those past sellout horizon
    filtered = []
    for p in undelivered:
        ph_id = p["phase_id"]
        demand = p["demand_date"]

        sim_count_df = conn.read_df(
            "SELECT COUNT(*) AS cnt FROM sim_lots WHERE phase_id = %s AND lot_source = 'sim'",
            (ph_id,),
        )
        sim_count = int(sim_count_df.iloc[0]["cnt"]) if not sim_count_df.empty else 0

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

        if demand is not None and sellout_date is not None and demand > sellout_date:
            logger.info(f"P-00: Phase {ph_id} skipped -- demand {demand} beyond sellout {sellout_date}.")
            continue

        filtered.append(p)

    skipped = len(undelivered) - len(filtered)
    if skipped:
        logger.info(f"P-00: {skipped} phase(s) skipped. {len(filtered)} proceeding to schedule.")
    undelivered = filtered

    if not undelivered:
        logger.info(f"P-00: No schedulable phases remain for ent_group_id={ent_group_id}.")
        return None

    # Step 3d: Which placeholder phases already have sim lots from the prior iteration?
    # These use balance-driven drain instead of pace estimation.
    placeholder_phase_ids = [p["phase_id"] for p in undelivered]
    if placeholder_phase_ids:
        sim_lots_check_df = conn.read_df(
            "SELECT DISTINCT phase_id FROM sim_lots WHERE lot_source = 'sim' AND phase_id = ANY(%s)",
            (placeholder_phase_ids,),
        )
        phases_with_sim_lots = (
            set(int(x) for x in sim_lots_check_df["phase_id"])
            if not sim_lots_check_df.empty else set()
        )
    else:
        phases_with_sim_lots = set()

    logger.info(
        f"P-00: {len(phases_with_sim_lots)}/{len(placeholder_phase_ids)} placeholder "
        f"phase(s) have prior-iteration sim lots — balance-driven mode active for those phases."
    )

    return {
        "undelivered": undelivered,
        "locked_phase_ids": locked_phase_ids,
        "all_phases_df": all_phases_df,
        "phases_with_sim_lots": phases_with_sim_lots,
    }


# ---------------------------------------------------------------------------
# Steps 4+5 — Compute delivery schedule
# ---------------------------------------------------------------------------

def _run_scheduling_loop(
    conn,
    cfg: dict,
    undelivered: list,
    locked_phase_ids: set,
    all_phases_df,
    phases_with_sim_lots: set,
    today_first: date,
) -> list:
    """
    Build the D-balance model and run the iterative delivery scheduling loop.

    Returns events_to_create: list of {"date": date, "phases": [phase_id, ...]}
    in chronological order.
    """
    import pandas as pd

    max_per_year     = cfg["max_deliveries_per_year"]
    min_gap          = cfg["min_gap_months"]
    raw_months       = cfg["delivery_months"]
    valid_months     = frozenset(int(m) for m in raw_months) if raw_months else frozenset([5,6,7,8,9,10,11])
    min_buffer       = cfg["min_d_count"]
    feed_starts_mode = cfg["feed_starts_mode"]

    # Annual pace per phase
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
    annual_target_map = {}
    for _, r in pg_annual_df.iterrows():
        ph_id = int(r["phase_id"])
        t = r["annual_starts_target"]
        if t is not None:
            ws_name = r["seasonal_weight_set"]
            annual_target_map[ph_id] = effective_annual_pace(ws_name, float(t)) / 12.0

    for p in undelivered:
        p["valid_months"] = valid_months

    # Build D-balance from DB
    all_dev_ids = [int(d) for d in all_phases_df["dev_id"].unique()]
    d_balance: dict[int, dict[date, int]] = {d: {} for d in all_dev_ids}

    if all_dev_ids:
        if locked_phase_ids:
            lot_filter_sql    = "AND (sl.lot_source = 'real' OR sl.phase_id = ANY(%s))"
            lot_filter_params = [list(locked_phase_ids)]
        else:
            lot_filter_sql    = "AND sl.lot_source = 'real'"
            lot_filter_params = []

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
                {lot_filter_sql}
            GROUP BY sl_devs.dev_id, f.m
            ORDER BY sl_devs.dev_id, f.m
            """,
            [all_dev_ids] + lot_filter_params,
        )
        for _, dr in d_proj_df.iterrows():
            d_id = int(dr["dev_id"])
            m = dr["calendar_month"]
            m = m.date() if hasattr(m, "date") else m
            d_balance[d_id][m] = int(dr["d_end"])

    # Last locked delivery date per dev
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
        """, (cfg["ent_group_id"],))
        for _, llr in llpd_df.iterrows():
            d_raw = llr["last_locked"]
            if d_raw is not None:
                d_val = d_raw.date() if hasattr(d_raw, "date") else d_raw
                last_locked_per_dev[int(llr["dev_id"])] = d_val

    global_demand_start_per_dev: dict[int, date] = {}
    for dev in all_dev_ids:
        ll = last_locked_per_dev.get(dev)
        global_demand_start_per_dev[dev] = add_months(ll, 1) if ll else today_first

    demand_consumed: dict[int, int] = {}
    for dev in all_dev_ids:
        ds = global_demand_start_per_dev[dev]
        if locked_phase_ids:
            dc_filter_sql    = "AND (lot_source = 'real' OR phase_id = ANY(%s))"
            dc_params        = (dev, ds, list(locked_phase_ids))
        else:
            dc_filter_sql    = "AND lot_source = 'real'"
            dc_params        = (dev, ds)
        dc_df = conn.read_df(
            f"""
            SELECT COUNT(*) AS cnt FROM sim_lots
            WHERE dev_id = %s
              AND date_str IS NOT NULL
              AND date_str >= %s
              {dc_filter_sql}
            """,
            dc_params,
        )
        demand_consumed[dev] = int(dc_df.iloc[0]["cnt"]) if not dc_df.empty else 0
        logger.info(f"P-00: Dev {dev}: demand_start={ds}, demand_consumed={demand_consumed[dev]}")

    # Organise phases by dev, sorted by (tier, seq)
    dev_phases = defaultdict(list)
    for phase in undelivered:
        dev_phases[phase["dev_id"]].append(phase)
    for dev_id in dev_phases:
        dev_phases[dev_id].sort(key=lambda p: (
            p["delivery_tier"] if p["delivery_tier"] is not None else 0,
            p["sequence_number"],
        ))

    dev_monthly_pace: dict[int, float] = {}
    for dev_id, phases_list in dev_phases.items():
        paces = [annual_target_map[p["phase_id"]] for p in phases_list if p["phase_id"] in annual_target_map]
        if paces:
            dev_monthly_pace[dev_id] = sum(paces) / len(paces)

    dev_scan_floor: dict[int, date] = {}
    for dev_id in dev_phases:
        dev_scan_floor[dev_id] = last_locked_per_dev.get(dev_id, today_first - timedelta(days=1))

    # Initialise prior-locked delivery dates for max_per_year / min_gap enforcement
    delivery_date_per_year: dict[int, date] = {}
    last_date: date | None = None

    locked_dates_df = conn.read_df("""
        SELECT date_dev_actual
        FROM sim_delivery_events
        WHERE ent_group_id = %s
          AND date_dev_actual IS NOT NULL
    """, (cfg["ent_group_id"],))
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

    dev_last_delivery_lots: dict[int, int] = {}

    # Initialize from locked delivery lot counts so the exhaustion fallback
    # correctly predicts when locked-phase lots drain.  Without this, last_lots
    # stays 0 and the fallback falls through to next_window_month_from(today),
    # which then gets pushed out by min_gap — causing phases to be scheduled
    # far later than the D-balance actually requires.
    if last_locked_per_dev:
        for _dev_id, _locked_date in last_locked_per_dev.items():
            _cnt_df = conn.read_df(
                """
                SELECT COUNT(sl.lot_id) AS cnt
                FROM sim_lots sl
                JOIN sim_delivery_event_phases dep ON dep.phase_id = sl.phase_id
                JOIN sim_delivery_events sde
                     ON sde.delivery_event_id = dep.delivery_event_id
                WHERE sde.ent_group_id = %s
                  AND sde.date_dev_actual = %s
                  AND sl.dev_id = %s
                """,
                (cfg["ent_group_id"], _locked_date, _dev_id),
            )
            _cnt = int(_cnt_df.iloc[0]["cnt"]) if not _cnt_df.empty else 0
            if _cnt > 0:
                dev_last_delivery_lots[_dev_id] = _cnt
                logger.info(
                    f"P-00: Dev {_dev_id}: last_locked_lots={_cnt} "
                    f"(delivery {_locked_date}, initialized for exhaustion fallback)"
                )

    # ── Closures used by the scheduling loop ─────────────────────────────────

    def _compute_drain_delay(dev_id_key: int, delivery_m: date) -> int:
        pace = dev_monthly_pace.get(dev_id_key, 1.0)
        if pace <= 0:
            return 0
        consumed = demand_consumed.get(dev_id_key, 0)
        pool_months = int(consumed / pace)
        ds = global_demand_start_per_dev.get(dev_id_key, today_first)
        pool_pos = add_months(ds, pool_months)
        return months_between(delivery_m, pool_pos)

    def _apply_delivery_to_balance(dev_id_key: int, delivery_month: date,
                                    n_lots: int, monthly_pace: float,
                                    drain_delay: int = 0) -> None:
        if n_lots <= 0 or monthly_pace <= 0:
            return
        bal = d_balance.setdefault(dev_id_key, {})
        for k in range(500):
            m = add_months(delivery_month, k)
            if k <= drain_delay:
                contrib = n_lots
            else:
                drain_elapsed = k - drain_delay
                contrib = n_lots - min(n_lots, int(monthly_pace * drain_elapsed))
                if contrib <= 0:
                    break
            bal[m] = bal.get(m, 0) + contrib

    def _apply_delivery_to_balance_from_sim_lots(dev_id_key: int,
                                                  delivery_month: date,
                                                  phase_id: int) -> None:
        """Balance-driven variant: use actual date_td offsets from prior-iteration sim lots."""
        sim_df = conn.read_df(
            """
            SELECT date_dev, date_td FROM sim_lots
            WHERE phase_id = %s AND lot_source = 'sim' AND date_dev IS NOT NULL
            """,
            (phase_id,),
        )
        if sim_df.empty:
            return
        drain_hist: dict[int, int] = defaultdict(int)
        permanent = 0
        for _, row in sim_df.iterrows():
            old_dev = row["date_dev"]
            if hasattr(old_dev, "date"):
                old_dev = old_dev.date()
            old_dev = old_dev.replace(day=1)
            td = row["date_td"]
            if td is None or pd.isnull(td):
                permanent += 1
            else:
                if hasattr(td, "date"):
                    td = td.date()
                offset = months_between(old_dev, td)
                drain_hist[offset] += 1
        bal = d_balance.setdefault(dev_id_key, {})
        still_in_d = len(sim_df)
        for k in range(500):
            if still_in_d <= 0:
                break
            m = add_months(delivery_month, k)
            bal[m] = bal.get(m, 0) + still_in_d
            still_in_d -= drain_hist.get(k, 0)

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
        prev = add_months(violation, -1)
        lv = snap_to_window(prev, vm)
        if lv < today_first:
            lv = next_window_month_from(today_first, vm)
        logger.info(f"P-00: Dev {dev_id_key}: D-balance violation {violation}, lv={lv}")
        return lv

    def _constrain_date(ideal: date, vm: frozenset) -> date:
        d = ideal
        for _ in range(500):
            if d.year in delivery_date_per_year:
                return delivery_date_per_year[d.year]
            if last_date is not None and min_gap > 0:
                min_ok = add_months(last_date, min_gap).replace(day=1)
                if d < min_ok:
                    d = next_window_month_from(min_ok, vm)
                    continue
            break
        return d

    # ── Main scheduling loop ──────────────────────────────────────────────────

    undelivered.sort(key=lambda p: (
        p["demand_date"] is None,
        p["demand_date"] or date.max,
        p["dev_id"],
    ))

    events_to_create = []

    for _ in range(200):
        # Tier gate: tier-N phases not eligible until all tier-(N-1) phases scheduled.
        # feed_starts_mode bypasses this for aggressive batching.
        if feed_starts_mode:
            active = {d: phases for d, phases in dev_phases.items() if phases}
        else:
            remaining_tiers = {
                phases[0]["delivery_tier"]
                for phases in dev_phases.values()
                if phases and phases[0]["delivery_tier"] is not None
            }
            min_tier = min(remaining_tiers) if remaining_tiers else None
            active = {
                d: phases for d, phases in dev_phases.items()
                if phases and (
                    phases[0]["delivery_tier"] is None
                    or min_tier is None
                    or phases[0]["delivery_tier"] <= min_tier
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
                    lv_d = snap_to_window(first_demand, valid_months)
                    if lv_d < today_first:
                        lv_d = next_window_month_from(today_first, valid_months)
                else:
                    last_sched = dev_scan_floor.get(dev_id, today_first)
                    last_lots  = dev_last_delivery_lots.get(dev_id, 0)
                    pace       = dev_monthly_pace.get(dev_id, 1.0)
                    if last_sched >= today_first and last_lots > 0 and pace > 0:
                        months_exhaust = math.ceil(last_lots / pace)
                        exhaust = add_months(last_sched, months_exhaust)
                        lv_d = snap_to_window(add_months(exhaust, -1), valid_months)
                        if lv_d < today_first:
                            lv_d = next_window_month_from(today_first, valid_months)
                        logger.info(
                            f"P-00: Dev {dev_id}: exhaustion fallback — "
                            f"last_delivery={last_sched}, lots={last_lots}, "
                            f"pace={pace:.2f}/mo, exhaust={exhaust}, lv_d={lv_d}"
                        )
                    else:
                        lv_d = next_window_month_from(today_first, valid_months)
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
            pace         = dev_monthly_pace.get(dev_id, 1.0)
            next_allowed = date(event_date.year + 1, min(valid_months), 1)

            batch      = [dev_phases[dev_id].pop(0)]
            first_lots = sum(_get_phase_lots(conn, batch[0]["phase_id"]))
            if batch[0]["phase_id"] in phases_with_sim_lots:
                _apply_delivery_to_balance_from_sim_lots(dev_id, event_date, batch[0]["phase_id"])
                logger.info(f"P-00: Dev {dev_id}: delivery {event_date}, lots={first_lots} (balance-driven drain)")
            else:
                delay = _compute_drain_delay(dev_id, event_date)
                _apply_delivery_to_balance(dev_id, event_date, first_lots, pace, delay)
                demand_consumed[dev_id] = demand_consumed.get(dev_id, 0) + first_lots
                logger.info(
                    f"P-00: Dev {dev_id}: delivery {event_date}, lots={first_lots}, "
                    f"drain_delay={delay}mo (pace-est), demand_consumed->{demand_consumed[dev_id]}"
                )

            batch_tier = batch[0]["delivery_tier"]
            while True:
                next_v = _find_violation_month(dev_id, event_date)
                if next_v is None:
                    break
                next_lv = snap_to_window(add_months(next_v, -1), valid_months)
                if next_lv >= next_allowed:
                    break
                if not dev_phases[dev_id]:
                    break
                next_tier = dev_phases[dev_id][0]["delivery_tier"]
                if (not feed_starts_mode
                        and batch_tier is not None
                        and next_tier is not None
                        and next_tier > batch_tier):
                    break
                extra      = dev_phases[dev_id].pop(0)
                extra_lots = sum(_get_phase_lots(conn, extra["phase_id"]))
                if extra["phase_id"] in phases_with_sim_lots:
                    _apply_delivery_to_balance_from_sim_lots(dev_id, event_date, extra["phase_id"])
                else:
                    delay_extra = _compute_drain_delay(dev_id, event_date)
                    _apply_delivery_to_balance(dev_id, event_date, extra_lots, pace, delay_extra)
                    demand_consumed[dev_id] = demand_consumed.get(dev_id, 0) + extra_lots
                batch.append(extra)

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
    return events_to_create


# ---------------------------------------------------------------------------
# Step 6 — Write new delivery events
# ---------------------------------------------------------------------------

def _write_new_events(conn, ent_group_id: int, events_to_create: list,
                      valid_months: frozenset) -> list:
    """Insert delivery events and their phase links. Returns list of new event IDs."""
    new_event_ids = []
    months_list   = sorted(list(valid_months))

    for i, ev in enumerate(events_to_create, start=1):
        seq_df    = conn.read_df("SELECT nextval('devdb.sim_delivery_events_id_seq') AS next_id")
        event_id  = int(seq_df.iloc[0]["next_id"])
        event_name     = f"Auto-scheduled delivery {i}"
        projected_date = ev["date"].strftime("%Y-%m-%d")

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
            link_seq_df  = conn.read_df("SELECT nextval('devdb.sim_delivery_event_phases_id_seq') AS next_id")
            next_link_id = int(link_seq_df.iloc[0]["next_id"])
            conn.execute(
                "INSERT INTO sim_delivery_event_phases (id, delivery_event_id, phase_id) VALUES (%s, %s, %s)",
                (next_link_id, event_id, ph_id),
            )
        new_event_ids.append(event_id)

    logger.info(
        f"P-00: Created {len(new_event_ids)} placeholder delivery event(s) "
        f"for ent_group_id={ent_group_id}."
    )
    return new_event_ids


# ---------------------------------------------------------------------------
# Step 7 — Write predecessor links (intra-dev sequence + tier enforcement)
# ---------------------------------------------------------------------------

def _write_predecessor_links(conn, ent_group_id: int, events_to_create: list,
                              new_event_ids: list, all_phases_df, locked_phase_ids: set) -> None:
    """
    Write sim_delivery_event_predecessors rows for:
      7   — intra-dev sequence (consecutive placeholder events per dev)
      7c  — locked-anchor predecessors (first placeholder anchored to latest locked event per dev)
      7b  — cross-tier predecessors (tier-N events must follow all tier-(N-1) events)
    """
    phase_dev_map = {
        int(r["phase_id"]): int(r["dev_id"])
        for _, r in all_phases_df.iterrows()
    }

    # Step 7: Intra-dev sequence
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
                "INSERT INTO sim_delivery_event_predecessors (event_id, predecessor_event_id) VALUES (%s, %s)",
                (event_ids[i], event_ids[i - 1]),
            )
            pred_count += 1
    if pred_count:
        logger.info(f"P-00: Created {pred_count} intra-dev sequence predecessor row(s).")

    # Step 7c: Locked-anchor predecessors
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
        dev_anchor: dict[int, tuple[int, int]] = {}
        for _, r in anchor_df.iterrows():
            dev_id = int(r["dev_id"])
            ev_id  = int(r["delivery_event_id"])
            seq    = int(r["max_seq"]) if r["max_seq"] is not None else 0
            if dev_id not in dev_anchor or seq > dev_anchor[dev_id][1]:
                dev_anchor[dev_id] = (ev_id, seq)

        anchor_pred_count = 0
        for dev_id, placeholder_event_ids in dev_event_sequence.items():
            if dev_id not in dev_anchor or not placeholder_event_ids:
                continue
            anchor_ev_id, _ = dev_anchor[dev_id]
            first_placeholder = placeholder_event_ids[0]
            conn.execute(
                "INSERT INTO sim_delivery_event_predecessors (event_id, predecessor_event_id) VALUES (%s, %s)",
                (first_placeholder, anchor_ev_id),
            )
            anchor_pred_count += 1
            logger.info(f"P-00: Dev {dev_id}: anchor predecessor event {first_placeholder} → locked event {anchor_ev_id}.")
        if anchor_pred_count:
            logger.info(f"P-00: Created {anchor_pred_count} locked-anchor predecessor row(s).")

    # Step 7b: Cross-tier predecessors
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
    if tier_df.empty:
        return

    phase_tier_map = {int(r["phase_id"]): int(r["delivery_tier"]) for _, r in tier_df.iterrows()}
    event_tiers: dict[int, set[int]] = {}

    for ev_dict, ev_id in zip(events_to_create, new_event_ids):
        tiers = {phase_tier_map[ph] for ph in ev_dict["phases"] if ph in phase_tier_map}
        if tiers:
            event_tiers[ev_id] = tiers

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
            t     = phase_tier_map.get(int(r["phase_id"]))
            if t is not None:
                event_tiers.setdefault(ev_id, set()).add(t)

    tier_to_events: dict[int, list[int]] = defaultdict(list)
    for ev_id, tiers in event_tiers.items():
        for t in tiers:
            tier_to_events[t].append(ev_id)

    tier_pred_count  = 0
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
                    "INSERT INTO sim_delivery_event_predecessors (event_id, predecessor_event_id) VALUES (%s, %s)",
                    (ev_n, ev_n1),
                )
                tier_pred_count += 1
    if tier_pred_count:
        logger.info(f"P-00: Created {tier_pred_count} cross-tier predecessor row(s).")


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

def placeholder_rebuilder(conn: DBConnection, ent_group_id: int) -> list:
    """
    Delete all placeholder delivery events for the entitlement group and
    rebuild them using the current demand signal.

    Returns list of new delivery_event_ids created.
    """
    today_first = date.today().replace(day=1)

    # Step 1: Check auto_schedule flag
    from engine.config_loader import load_delivery_config
    cfg = load_delivery_config(conn, ent_group_id)
    if not cfg["auto_schedule_enabled"]:
        logger.info(f"P-00: auto_schedule_enabled=False for ent_group_id={ent_group_id}. Skipping.")
        return []

    # Attach ent_group_id to cfg so sub-functions can use it without a separate param
    cfg["ent_group_id"] = ent_group_id

    # Step 2: Clear existing placeholder events
    _delete_placeholder_events(conn, ent_group_id)

    # Step 3: Collect phases that need delivery events
    phase_data = _collect_schedulable_phases(conn, ent_group_id, today_first)
    if phase_data is None:
        return []

    undelivered          = phase_data["undelivered"]
    locked_phase_ids     = phase_data["locked_phase_ids"]
    all_phases_df        = phase_data["all_phases_df"]
    phases_with_sim_lots = phase_data["phases_with_sim_lots"]

    # Steps 4+5: Build D-balance and run scheduling loop
    events_to_create = _run_scheduling_loop(
        conn, cfg, undelivered, locked_phase_ids,
        all_phases_df, phases_with_sim_lots, today_first,
    )

    if not events_to_create:
        logger.info(f"P-00: No events to create for ent_group_id={ent_group_id}.")
        return []

    # Step 6: Persist delivery events and phase links
    raw_months   = cfg["delivery_months"]
    valid_months = frozenset(int(m) for m in raw_months) if raw_months else frozenset([5,6,7,8,9,10,11])
    new_event_ids = _write_new_events(conn, ent_group_id, events_to_create, valid_months)

    # Step 7: Write predecessor links (intra-dev sequence + tier enforcement)
    _write_predecessor_links(
        conn, ent_group_id, events_to_create, new_event_ids,
        all_phases_df, locked_phase_ids,
    )

    return new_event_ids
