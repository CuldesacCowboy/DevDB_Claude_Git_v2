"""
placeholder_rebuilder -- Rebuild placeholder delivery events from demand signal.

Thin orchestrator that delegates to:
  delivery_phase_collector  -- load/filter phases, delete stale events
  delivery_scheduler        -- D-balance scheduling loop
  delivery_event_writer     -- persist events + predecessor links to DB
"""

import logging
from datetime import date

from .connection import DBConnection
from .delivery_phase_collector import (
    delete_placeholder_events,
    collect_schedulable_phases,
)
from .delivery_scheduler import run_scheduling_loop
from .delivery_event_writer import write_new_events, write_predecessor_links

logger = logging.getLogger(__name__)


def placeholder_rebuilder(conn: DBConnection, ent_group_id: int) -> list:
    """
    Delete all placeholder delivery events for the entitlement group and
    rebuild them using the current demand signal.

    Returns list of new delivery_event_ids created.
    """
    today_first = date.today().replace(day=1)

    # Floor delivery dates to community entitlement date
    ent_df = conn.read_df(
        "SELECT date_ent_actual FROM sim_entitlement_groups WHERE ent_group_id = %s",
        (ent_group_id,),
    )
    if not ent_df.empty and ent_df.iloc[0]["date_ent_actual"] is not None:
        ent_date = ent_df.iloc[0]["date_ent_actual"]
        if hasattr(ent_date, "date"):
            ent_date = ent_date.date()
        ent_first = ent_date.replace(day=1)
        if ent_first > today_first:
            logger.info(f"placeholder_rebuilder: Entitlement floor {ent_first} > today {today_first}")
            today_first = ent_first

    # Load delivery config
    from engine.config_loader import load_delivery_config
    cfg = load_delivery_config(conn, ent_group_id)
    cfg["ent_group_id"] = ent_group_id

    # Clear existing placeholder events
    delete_placeholder_events(conn, ent_group_id)

    # Collect phases that need delivery events
    phase_data = collect_schedulable_phases(conn, ent_group_id, today_first)
    if phase_data is None:
        return []

    # Run D-balance scheduling loop
    events_to_create = run_scheduling_loop(
        conn, cfg,
        phase_data["undelivered"],
        phase_data["locked_phase_ids"],
        phase_data["all_phases_df"],
        phase_data["phases_with_sim_lots"],
        today_first,
        locked_group_dates=phase_data.get("locked_group_dates", set()),
    )

    if not events_to_create:
        logger.info(f"placeholder_rebuilder: No events to create for ent_group_id={ent_group_id}.")
        return []

    # Persist delivery events and phase links
    raw_months = cfg["delivery_months"]
    valid_months = frozenset(int(m) for m in raw_months) if raw_months else frozenset([5,6,7,8,9,10,11])
    new_event_ids = write_new_events(conn, ent_group_id, events_to_create, valid_months)

    # Write predecessor links
    write_predecessor_links(
        conn, ent_group_id, events_to_create, new_event_ids,
        phase_data["all_phases_df"], phase_data["locked_phase_ids"],
    )

    return new_event_ids
