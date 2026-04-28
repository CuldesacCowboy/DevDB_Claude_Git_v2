"""
S-1100 persistence_writer — Write sim temp lots to projection storage.

Reads:   nothing
Writes:  sim_projection_lots (DB, DELETE + INSERT for this dev_id/projection_id)
Input:   conn: DBConnection, temp_lots: list of dicts, dev_id: int, sim_run_id: int,
         projection_context: ProjectionContext
Rules:   Atomic delete+insert within the projection. Never touches sim_lots.
         Not Own: modifying real lot rows, setting sim_run status.
"""

import logging

from .connection import DBConnection
from kernel.proposal import Proposal

logger = logging.getLogger(__name__)


def persistence_writer(conn: DBConnection, temp_lots: list,
                       dev_id: int, sim_run_id: int,
                       _proposal: Proposal = None,
                       projection_context=None) -> None:
    """
    Delete previous projection lots for this dev_id, insert new ones.
    Requires projection_context with a valid projection_id.
    Never writes to sim_lots.
    """
    if _proposal is None:
        raise TypeError(
            "persistence_writer requires a validated Proposal. "
            "Raw temp_lots are no longer accepted. "
            "Call plan() and pass the returned Proposal."
        )
    if projection_context is None:
        raise TypeError(
            "persistence_writer requires a ProjectionContext. "
            "The coordinator must create a projection before calling persistence_writer."
        )
    try:
        proj_id = projection_context.projection_id

        # Step 1: Delete previous projection lots for this development
        conn.execute(
            "DELETE FROM sim_projection_lots WHERE projection_id = %s AND dev_id = %s",
            (proj_id, dev_id),
        )

        # Step 2: Insert new temp lots into projection storage
        if temp_lots:
            _PROJ_COLS = [
                "dev_id", "phase_id", "lot_type_id", "building_group_id",
                "sim_run_id", "builder_id", "is_spec", "is_spec_source",
                "date_ent", "date_dev", "date_td_hold", "date_td",
                "date_str", "date_cmp", "date_cls",
                "date_str_source", "date_cmp_source", "date_cls_source",
                "excluded",
            ]
            proj_rows = []
            for lot in temp_lots:
                row = {"projection_id": proj_id}
                for col in _PROJ_COLS:
                    val = lot.get(col)
                    if val is None and col == "excluded":
                        val = False
                    row[col] = val
                row["sim_run_id"] = sim_run_id
                proj_rows.append(row)
            conn.executemany_insert("sim_projection_lots", proj_rows)

        # Step 3: Stamp date_ent from sim_dev_phases onto newly-inserted lots.
        conn.execute(
            """
            UPDATE sim_projection_lots spl
            SET date_ent = sdp.date_ent
            FROM sim_dev_phases sdp
            WHERE spl.phase_id = sdp.phase_id
              AND spl.projection_id = %s
              AND spl.dev_id = %s
              AND sdp.date_ent IS NOT NULL
            """,
            (proj_id, dev_id),
        )

        logger.info(f"persistence_writer: Wrote {len(temp_lots)} projection lots for "
                    f"dev_id={dev_id}, projection_id={proj_id}.")

    except Exception as e:
        logger.warning(f"ERROR: Simulation write failed. Previous results preserved. Detail: {e}")
        raise
