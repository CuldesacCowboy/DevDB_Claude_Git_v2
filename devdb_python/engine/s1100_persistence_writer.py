"""
S-1100 persistence_writer — Atomically replace sim temp lots for this development.

Reads:   sim_lots (schema probe only — SELECT * WHERE 1=0)
Writes:  sim_lots (DB, DELETE sim lots for dev + INSERT new temp lot rows)
Input:   conn: DBConnection, temp_lots: list of dicts, dev_id: int, sim_run_id: int
Rules:   Atomic delete+insert: deletes lot_source='sim' rows for dev_id, then inserts.
         lot_id is assigned by the sim_lots_id_seq sequence (migration 028).
         Never touches real lot rows. Previous temp lots preserved on failure.
         Not Own: modifying real lot rows, setting sim_run status.
"""

import logging

import pandas as pd
from .connection import DBConnection
from kernel.proposal import Proposal

logger = logging.getLogger(__name__)


def persistence_writer(conn: DBConnection, temp_lots: list,
                       dev_id: int, sim_run_id: int,
                       _proposal: Proposal = None) -> None:
    """
    Step 1: Delete all lot_source='sim' rows for this dev_id.
    Step 2: Insert new temp lot records tagged with sim_run_id.

    Never modifies real lots (lot_source='real').
    """
    if _proposal is None:
        raise TypeError(
            "persistence_writer requires a validated Proposal. "
            "Raw temp_lots are no longer accepted. "
            "Call plan() and pass the returned Proposal."
        )
    try:
        # Step 1: Delete previous sim lots for this development (idempotency guard D-086)
        conn.execute(
            "DELETE FROM sim_lots WHERE lot_source = 'sim' AND dev_id = %s",
            (dev_id,),
        )

        # Step 2: Insert new temp lots
        if temp_lots:
            # Get column order from the table schema (excluding lot_id — assigned by sequence)
            schema_df = conn.read_df(
                "SELECT * FROM sim_lots WHERE 1=0"
            )
            table_columns = [c for c in schema_df.columns if c != "lot_id"]

            # Columns that are NOT NULL DEFAULT FALSE in sim_lots (migration 012).
            # Sim lots are never locked; always write False rather than NULL.
            _LOCKED_COLS = frozenset({
                "date_ent_is_locked", "date_dev_is_locked", "date_td_hold_is_locked",
                "date_td_is_locked", "date_str_is_locked", "date_frm_is_locked",
                "date_cmp_is_locked", "date_cls_is_locked",
            })

            rows_to_insert = []
            for lot in temp_lots:
                row = {}
                for col in table_columns:
                    val = lot.get(col)
                    if val is None and col in _LOCKED_COLS:
                        val = False
                    row[col] = val
                row["sim_run_id"] = sim_run_id
                rows_to_insert.append(row)

            conn.executemany_insert("sim_lots", rows_to_insert)

        logger.info(f"S-11: Wrote {len(temp_lots)} temp lots for "
                    f"dev_id={dev_id}, sim_run_id={sim_run_id}.")

    except Exception as e:
        logger.warning(f"ERROR: Simulation write failed. Previous results preserved. Detail: {e}")
        raise
