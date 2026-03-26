# allow_null_phase_id.py
# Relax the NOT NULL constraint on sim_lots.phase_id so that lots can be
# unassigned (phase_id = NULL) without belonging to a specific phase.
#
# Run:
#   cd devdb_python
#   python migrations/allow_null_phase_id.py

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
            cur.execute(
                "ALTER TABLE sim_lots ALTER COLUMN phase_id DROP NOT NULL"
            )
            # Verify
            cur.execute(
                """
                SELECT is_nullable
                FROM information_schema.columns
                WHERE table_schema = 'devdb'
                  AND table_name = 'sim_lots'
                  AND column_name = 'phase_id'
                """
            )
            nullable = cur.fetchone()[0]
        print(f"sim_lots.phase_id is_nullable: {nullable}")
        if nullable != "YES":
            print("ERROR: constraint not dropped.", file=sys.stderr)
            sys.exit(1)
    finally:
        conn.close()


if __name__ == "__main__":
    run()
