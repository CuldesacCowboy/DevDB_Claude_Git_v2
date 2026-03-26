# create_sim_assignment_log.py
# Creates the sim_assignment_log table in the devdb schema.
# Idempotent -- safe to run multiple times (IF NOT EXISTS).
#
# Run:
#   cd devdb_python
#   python migrations/create_sim_assignment_log.py

import os
import sys

import psycopg2
from dotenv import load_dotenv

load_dotenv()

_DDL = """
CREATE TABLE IF NOT EXISTS sim_assignment_log (
    log_id         BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    action         TEXT NOT NULL,
    resource_type  TEXT NOT NULL,
    resource_id    BIGINT NOT NULL,
    from_owner_id  BIGINT NOT NULL,
    to_owner_id    BIGINT NOT NULL,
    changed_by     TEXT NOT NULL,
    changed_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    metadata       JSONB
);
"""


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
            cur.execute(_DDL)
            # Confirm table exists
            cur.execute(
                "SELECT EXISTS ("
                "  SELECT 1 FROM information_schema.tables"
                "  WHERE table_schema = 'devdb'"
                "  AND table_name = 'sim_assignment_log'"
                ")"
            )
            exists = cur.fetchone()[0]
        print(f"sim_assignment_log exists: {exists}")
        if not exists:
            print("ERROR: table was not created.", file=sys.stderr)
            sys.exit(1)
    finally:
        conn.close()


if __name__ == "__main__":
    run()
