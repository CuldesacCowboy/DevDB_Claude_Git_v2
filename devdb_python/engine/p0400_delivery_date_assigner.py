"""
P-0400 delivery_date_assigner — Assign date_dev_projected to the highest-priority event.

Reads:   sim_dev_phases, sim_delivery_event_phases, sim_delivery_event_predecessors,
         sim_entitlement_delivery_config (DB)
Writes:  sim_delivery_events.date_dev_projected (DB, UPDATE)
Input:   conn: DBConnection, delivery_event_id: int, ent_group_id: int
Rules:   Computes MIN(date_dev_demand_derived) across child phases; adjusts for window.
         Date can only move earlier, never later (D-115) — demand guard.
         Placeholder guard: never move date_dev_projected earlier than P-0000 wrote (D-141).
         Sequence constraint: projected date floored to MAX(predecessor date_dev_projected).
         Sequence constraint overrides the demand guard — phase ordering is absolute.
         MIN outside window → latest permissible month before MIN; if none, first permissible.
         Not Own: writing to phase or lot tables, ranking events.
"""

import logging
from datetime import date
from dateutil.relativedelta import relativedelta
from .connection import DBConnection

logger = logging.getLogger(__name__)


def delivery_date_assigner(conn: DBConnection, delivery_event_id: int,
                           ent_group_id: int):
    """
    Compute MIN(date_dev_demand_derived) across child phases of this event.
    Adjust to delivery window sourced from sim_entitlement_delivery_config.
    Write date_dev_projected to sim_delivery_events.
    Date can only move earlier than current value, never later.

    Writer module: writes sim_delivery_events.date_dev_projected.
    """
    import pandas as pd

    current_df = conn.read_df(
        "SELECT date_dev_projected, is_placeholder FROM sim_delivery_events WHERE delivery_event_id = %s",
        (delivery_event_id,),
    )
    current_projected = current_df.iloc[0]["date_dev_projected"] if not current_df.empty else None
    is_placeholder = bool(current_df.iloc[0]["is_placeholder"]) if not current_df.empty else False

    # Window from merged global + community config.
    from engine.config_loader import load_delivery_config
    cfg = load_delivery_config(conn, ent_group_id)
    raw_months = cfg["delivery_months"]
    if not raw_months:
        raise ValueError(
            f"P-04: delivery_months not configured for ent_group {ent_group_id}. "
            "Set delivery_months in global settings or community delivery config before running."
        )
    valid_months = frozenset(int(m) for m in raw_months)


    min_df = conn.read_df(
        """
        SELECT MIN(dp.date_dev_demand_derived) AS min_date
        FROM sim_delivery_event_phases dep
        JOIN sim_dev_phases dp ON dep.phase_id = dp.phase_id
        WHERE dep.delivery_event_id = %s
        """,
        (delivery_event_id,),
    )

    min_date = min_df.iloc[0]["min_date"] if not min_df.empty else None
    if min_date is None or pd.isnull(min_date):
        logger.info(f"P-04: Event {delivery_event_id} all child phases null demand_derived. Skipping.")
        return None

    # Normalize to Python date
    if hasattr(min_date, 'date'):
        min_date = min_date.date()

    if min_date.month in valid_months:
        projected = min_date.replace(day=1)
    else:
        projected = None
        check = min_date.replace(day=1)
        for _ in range(12):
            check = check - relativedelta(months=1)
            if check.month in valid_months:
                projected = check
                break
        if projected is None:
            projected = min_date.replace(month=min(valid_months), day=1)
            logger.warning(f"P-04: Supply constraint warning -- event {delivery_event_id} "
                           f"pulled to first permissible window month {projected}.")

    # Floor rule: projected must be >= the earliest permissible date, which is
    # the greater of (a) today's first-of-month and (b) the first eligible
    # window month of the year AFTER the last locked delivery event in this
    # entitlement group.  Rule (b) prevents a placeholder from landing in the
    # same calendar year as any locked event.
    today_first = date.today().replace(day=1)

    locked_df = conn.read_df(
        """
        SELECT MAX(date_dev_actual) AS last_locked
        FROM sim_delivery_events
        WHERE ent_group_id = %s
          AND date_dev_actual IS NOT NULL
        """,
        (ent_group_id,),
    )
    last_locked_raw = locked_df.iloc[0]["last_locked"] if not locked_df.empty else None
    if last_locked_raw is not None and not pd.isnull(last_locked_raw):
        last_locked = last_locked_raw.date() if hasattr(last_locked_raw, "date") else last_locked_raw
        locked_year_floor = date(last_locked.year + 1, min(valid_months), 1)
    else:
        locked_year_floor = today_first

    hard_floor = max(today_first, locked_year_floor)
    # Advance hard_floor to the nearest eligible window month if needed
    for _ in range(12):
        if hard_floor.month in valid_months:
            break
        hard_floor = hard_floor + relativedelta(months=1)

    if projected < hard_floor:
        logger.info(f"P-04: Floor applied -- event {delivery_event_id} "
                    f"clamped from {projected} to {hard_floor}.")
        projected = hard_floor

    # Never move date later -- unless current is a stale past date.
    # A past projected date has no operational meaning and must always be
    # correctable forward by the floor rule.
    cur = None
    if current_projected is not None:
        cur = current_projected
        if hasattr(cur, 'date'):
            cur = cur.date()
        if projected > cur and cur >= today_first:
            logger.info(f"P-04: Projected date {projected} is later than current "
                        f"{cur}. Keeping current.")
            projected = cur  # demand guard — predecessor floor may override below

    if cur is not None and is_placeholder and projected < cur:
        projected = cur  # never move placeholder earlier — P-00's lean date is authoritative

    # Predecessor sequence floor — absolute constraint; overrides demand/placeholder guards
    pred_floor_df = conn.read_df(
        """
        SELECT MAX(sde.date_dev_projected) AS max_pred_date
        FROM sim_delivery_event_predecessors sep
        JOIN sim_delivery_events sde ON sde.delivery_event_id = sep.predecessor_event_id
        WHERE sep.event_id = %s
        """,
        (delivery_event_id,),
    )
    if not pred_floor_df.empty:
        max_pred_raw = pred_floor_df.iloc[0]["max_pred_date"]
        if max_pred_raw is not None and not pd.isnull(max_pred_raw):
            pred_floor = max_pred_raw.date() if hasattr(max_pred_raw, "date") else max_pred_raw
            if projected < pred_floor:
                logger.info(f"P-04: Sequence constraint -- event {delivery_event_id} "
                            f"floored from {projected} to predecessor date {pred_floor}.")
                projected = pred_floor

    conn.execute(
        "UPDATE sim_delivery_events SET date_dev_projected = %s WHERE delivery_event_id = %s",
        (projected, delivery_event_id),
    )

    logger.info(f"P-04: Event {delivery_event_id} date_dev_projected = {projected}.")
    return projected
