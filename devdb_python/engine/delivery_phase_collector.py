"""
delivery_phase_collector -- Load and filter phases for delivery scheduling.

Owns: loading undelivered phases, filtering by demand/lots/splits,
      identifying locked group dates, deleting stale placeholder events.
"""

import logging
from datetime import date
from collections import defaultdict
from .connection import DBConnection

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Internal helper
# ---------------------------------------------------------------------------

def get_phase_lots(conn, phase_id: int):
    """Return list of projected_count values from sim_phase_product_splits for a phase."""
    df = conn.read_df("SELECT projected_count FROM sim_phase_product_splits WHERE phase_id = %s", (phase_id,))
    if df.empty:
        return [0]
    return [int(x) for x in df["projected_count"] if x is not None]


# ---------------------------------------------------------------------------
# Step 2 — Delete existing placeholder events
# ---------------------------------------------------------------------------

def delete_placeholder_events(conn, ent_group_id: int) -> None:
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
        logger.info("placeholder_rebuilder: No placeholder events to delete.")
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
    logger.info(f"placeholder_rebuilder: Deleted {len(placeholder_ids)} placeholder event(s).")


# ---------------------------------------------------------------------------
# Step 3 — Collect schedulable phases
# ---------------------------------------------------------------------------

def collect_schedulable_phases(conn, ent_group_id: int, today_first: date) -> dict | None:
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
               sdp.sequence_number, sdp.delivery_tier, sdp.delivery_group
        FROM sim_dev_phases sdp
        JOIN sim_ent_group_developments egd
             ON egd.dev_id = sdp.dev_id
        WHERE egd.ent_group_id = %s
        """,
        (ent_group_id,),
    )
    if all_phases_df.empty:
        logger.info(f"placeholder_rebuilder: No phases found for ent_group_id={ent_group_id}.")
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
        dg = ph["delivery_group"] if "delivery_group" in ph.index else None
        if dg is not None and hasattr(dg, "strip"):
            dg = dg.strip() or None
        undelivered.append({
            "phase_id": ph_id,
            "dev_id": dev_id,
            "demand_date": demand,
            "sequence_number": int(ph["sequence_number"]) if ph["sequence_number"] is not None else 9999,
            "delivery_tier": int(ph["delivery_tier"]) if ph["delivery_tier"] is not None else None,
            "delivery_group": dg,
        })

    if not undelivered:
        logger.info(f"placeholder_rebuilder: All phases covered by locked events for ent_group_id={ent_group_id}.")
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
                    logger.info(f"placeholder_rebuilder: Phase {ph_id} skipped -- null demand, no lots, no configured capacity.")
                    continue
                logger.info(f"placeholder_rebuilder: Phase {ph_id} has {configured_capacity} configured lot(s) in splits -- proceeding to schedule.")
            else:
                logger.info(f"placeholder_rebuilder: Phase {ph_id} has {real_pending} real entitled lot(s) -- proceeding to schedule.")

        if demand is not None and sellout_date is not None and demand > sellout_date:
            logger.info(f"placeholder_rebuilder: Phase {ph_id} skipped -- demand {demand} beyond sellout {sellout_date}.")
            continue

        filtered.append(p)

    skipped = len(undelivered) - len(filtered)
    if skipped:
        logger.info(f"placeholder_rebuilder: {skipped} phase(s) skipped. {len(filtered)} proceeding to schedule.")
    undelivered = filtered

    if not undelivered:
        logger.info(f"placeholder_rebuilder: No schedulable phases remain for ent_group_id={ent_group_id}.")
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
        f"placeholder_rebuilder: {len(phases_with_sim_lots)}/{len(placeholder_phase_ids)} placeholder "
        f"phase(s) have prior-iteration sim lots — balance-driven mode active for those phases."
    )

    # Step 3e: Collect locked group dates — dates blocked by locked events
    # that contain at least one grouped phase. No other phases may deliver
    # on these dates (group exclusivity rule).
    locked_group_dates = set()
    if not locked_phases_df.empty:
        locked_events_df = conn.read_df(
            """
            SELECT DISTINCT
                COALESCE(sde.date_dev_actual, sde.date_dev_projected)::date AS delivery_date
            FROM sim_delivery_events sde
            JOIN sim_delivery_event_phases dep ON dep.delivery_event_id = sde.delivery_event_id
            JOIN sim_dev_phases sdp ON sdp.phase_id = dep.phase_id
            WHERE sde.ent_group_id = %s
              AND sde.date_dev_actual IS NOT NULL
              AND sdp.delivery_group IS NOT NULL
            """,
            (ent_group_id,),
        )
        for _, row in locked_events_df.iterrows():
            d = row["delivery_date"]
            if hasattr(d, "date"):
                d = d.date()
            locked_group_dates.add(d)
        if locked_group_dates:
            logger.info(f"placeholder_rebuilder: Locked group dates (blocked for other deliveries): {sorted(locked_group_dates)}")

    return {
        "undelivered": undelivered,
        "locked_phase_ids": locked_phase_ids,
        "all_phases_df": all_phases_df,
        "phases_with_sim_lots": phases_with_sim_lots,
        "locked_group_dates": locked_group_dates,
    }
