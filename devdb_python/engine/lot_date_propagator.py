"""
P-0700 lot_date_propagator — Write phase delivery date to lots in affected phases.

Reads:   sim_delivery_event_phases (DB)
Writes:  sim_projection_lots.date_dev (DB, UPDATE for sim lots via projection_id),
         sim_lots.date_dev (DB, UPDATE for real lots only)
Input:   conn: DBConnection, resolved_events: list, projection_id: int
Rules:   Real lots with date_dev already set (P-01 actuals) are not overwritten (D-113).
         Sim lots are updated in sim_projection_lots via projection_id.
         Not Own: writing any other lot date field, writing to phase or event tables.
"""

import logging

from .connection import DBConnection

logger = logging.getLogger(__name__)


def lot_date_propagator(conn: DBConnection, resolved_events: list,
                        projection_id: int = None) -> None:
    """
    resolved_events: list of (event_id, date_dev_projected) tuples.
    Queries sim_delivery_event_phases to find child phases for each event,
    then writes date_dev to projection lots and real lots.
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
        # Sim lots: write to projection table
        if projection_id is not None:
            conn.execute(
                "UPDATE sim_projection_lots SET date_dev = %s WHERE phase_id = %s AND projection_id = %s",
                (projected_date, phase_id, projection_id),
            )

        # Real lots: always write to sim_lots
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

    logger.info(f"lot_date_propagator: Propagated date_dev for {len(updated_phases)} phases.")
