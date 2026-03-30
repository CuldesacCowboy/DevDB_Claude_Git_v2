# add_display_order.py
# Add display_order column to sim_dev_phases.
# Idempotent -- safe to run multiple times.
#
# display_order is a UI display preference ONLY.
# It must NEVER be read by the simulation engine.
# sequence_number (engine ordering) is completely untouched.
#
# NULL = no explicit ordering set. Display falls back to
# auto-sort (alphabetical by prefix, then numeric by ph. N).
#
# Run:
#   cd devdb_python
#   python migrations/add_display_order.py

import os
import sys

import psycopg2
from dotenv import load_dotenv

load_dotenv()


def run() -> None:
    conn = psycopg2.connect(
        host="localhost",
        database="devdb",
        user=os.getenv("PG_USER", "postgres"),
        password=os.getenv("PG_PASSWORD", ""),
        port=int(os.getenv("PG_PORT", 5432)),
        options="-c search_path=devdb",
    )
    conn.autocommit = True
    try:
        with conn.cursor() as cur:
            # Idempotent check
            cur.execute(
                """
                SELECT column_name
                FROM information_schema.columns
                WHERE table_schema = 'devdb'
                  AND table_name   = 'sim_dev_phases'
                  AND column_name  = 'display_order'
                """
            )
            if cur.fetchone():
                print("display_order already exists on sim_dev_phases -- nothing to do.")
                return

            cur.execute(
                "ALTER TABLE sim_dev_phases ADD COLUMN display_order INT NULL"
            )

            # Verify
            cur.execute(
                """
                SELECT column_name, data_type, is_nullable
                FROM information_schema.columns
                WHERE table_schema = 'devdb'
                  AND table_name   = 'sim_dev_phases'
                  AND column_name  = 'display_order'
                """
            )
            row = cur.fetchone()
            if row is None:
                print("ERROR: column was not created.", file=sys.stderr)
                sys.exit(1)
            print(f"Added column: {row}")
    finally:
        conn.close()


if __name__ == "__main__":
    run()
