# s11_persistence_writer.py
# S-11: Atomically replace previous sim temp lots with new ones for this development.
#
# Owns:     Inserting new temp lot rows. Deleting temp lots from previous runs for
#           this development.
# Not Own:  Modifying real lot rows. Setting sim_run status. Snapshots.
# Inputs:   Final temp lot records (list of dicts), dev_id, sim_run_id, conn.
# Outputs:  Rows written to sim_lots with lot_source='sim' and sim_run_id set.
# Failure:  Surface error. Never touch real lots. Previous temp lots preserved on failure.
# D-086: lot_id has no IDENTITY. Assigned via MAX(lot_id) + offset. Delta Lake does
#   not enforce PRIMARY KEY/UNIQUE -- delete guard ensures idempotency.

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
            max_id_df = conn.read_df(
                "SELECT COALESCE(MAX(lot_id), 0) AS max_id FROM sim_lots"
            )
            max_lot_id = int(max_id_df.iloc[0]["max_id"])

            # Get column order from the table schema
            schema_df = conn.read_df(
                "SELECT * FROM sim_lots WHERE 1=0"
            )
            table_columns = list(schema_df.columns)

            rows_to_insert = []
            for i, lot in enumerate(temp_lots):
                row = {}
                for col in table_columns:
                    val = lot.get(col)
                    # _is_locked columns are NOT NULL DEFAULT FALSE; sim lots are never locked
                    if val is None and col.endswith("_is_locked"):
                        val = False
                    row[col] = val
                row["lot_id"] = max_lot_id + i + 1
                row["sim_run_id"] = sim_run_id
                rows_to_insert.append(row)

            conn.executemany_insert("sim_lots", rows_to_insert)

        print(f"S-11: Wrote {len(temp_lots)} temp lots for "
              f"dev_id={dev_id}, sim_run_id={sim_run_id}.")

    except Exception as e:
        print(f"ERROR: Simulation write failed. Previous results preserved. Detail: {e}")
        raise
