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

import pandas as pd
from .connection import DBConnection
from kernel.proposal import Proposal


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
        conn.execute(f"""
            DELETE FROM sim_lots
            WHERE lot_source = 'sim'
              AND dev_id = {dev_id}
        """)

        # Step 2: Insert new temp lots
        if temp_lots:
            # Get column order from the table schema (excluding lot_id — assigned by sequence)
            schema_df = conn.read_df(
                "SELECT * FROM sim_lots WHERE 1=0"
            )
            table_columns = [c for c in schema_df.columns if c != "lot_id"]

            rows_to_insert = []
            for lot in temp_lots:
                row = {}
                for col in table_columns:
                    val = lot.get(col)
                    # _is_locked columns are NOT NULL DEFAULT FALSE; sim lots are never locked
                    if val is None and col.endswith("_is_locked"):
                        val = False
                    row[col] = val
                row["sim_run_id"] = sim_run_id
                rows_to_insert.append(row)

            conn.executemany_insert("sim_lots", rows_to_insert)

        print(f"S-11: Wrote {len(temp_lots)} temp lots for "
              f"dev_id={dev_id}, sim_run_id={sim_run_id}.")

    except Exception as e:
        print(f"ERROR: Simulation write failed. Previous results preserved. Detail: {e}")
        raise
