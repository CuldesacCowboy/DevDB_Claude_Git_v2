"""
P-0700 lot_date_propagator — Write phase delivery date to sim_lots rows in affected phases.

Reads:   sim_delivery_event_phases (DB), sim_lots (DB)
Writes:  sim_lots.date_dev (DB, UPDATE)
Input:   conn: DBConnection, resolved_events: list of (event_id, date_dev_projected)
Rules:   Real lots with date_dev already set (P-01 actuals) are not overwritten (D-113).
         All other lots (sim + real with null date_dev) receive the projected date.
         Not Own: writing any other lot date field, writing to phase or event tables.
"""

import logging

from .connection import DBConnection

logger = logging.getLogger(__name__)


def lot_date_propagator(conn: DBConnection, resolved_events: list) -> None:
    """
    resolved_events: list of (event_id, date_dev_projected) tuples.
    Queries sim_delivery_event_phases to find child phases for each event,
    then writes date_dev to all lots in those phases.
    For real lots: only updates where date_dev is null
    (real lots with date_dev set got it from actual event via P-01).
    Writer module: writes sim_lots.date_dev only.
    """
    updated_phases = []
    for event_id, projected_date in resolved_events:
        if projected_date is None:
            continue
        phases_df = conn.read_df(
            "SELECT phase_id FROM sim_delivery_event_phases WHERE delivery_event_id = %s",
            (event_id,),
        )
        for _, r in phases_df.iterrows():
            updated_phases.append((int(r["phase_id"]), projected_date))

    for phase_id, projected_date in updated_phases:
        conn.execute(
            "UPDATE sim_lots SET date_dev = %s WHERE phase_id = %s AND lot_source = 'sim'",
            (projected_date, phase_id),
        )

        conn.execute(
            """
            UPDATE sim_lots
            SET date_dev = %s
            WHERE phase_id = %s
              AND lot_source = 'real'
              AND date_dev IS NULL
              AND date_str IS NULL
              AND date_cmp IS NULL
              AND date_cls IS NULL
            """,
            (projected_date, phase_id),
        )

    logger.info(f"P-07: Propagated date_dev for {len(updated_phases)} phases.")
