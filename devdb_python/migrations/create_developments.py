# create_developments.py
# Creates the developments table in the devdb schema.
# Also adds PRIMARY KEY constraints to dim_county, dim_state, dim_municipality
# if they are missing (those tables were migrated from Databricks without PKs per D-086).
# Idempotent -- safe to run multiple times (IF NOT EXISTS / DO NOTHING guards).
#
# Run:
#   cd devdb_python
#   python migrations/create_developments.py

import os
import sys

import psycopg2
from dotenv import load_dotenv

load_dotenv()

# Add PKs to dim tables that were migrated without constraints (D-086)
_ADD_PKS = [
    "ALTER TABLE dim_county ADD PRIMARY KEY (county_id)",
    "ALTER TABLE dim_state ADD PRIMARY KEY (state_id)",
    "ALTER TABLE dim_municipality ADD PRIMARY KEY (municipality_id)",
]

_DDL = """
CREATE TABLE IF NOT EXISTS developments (
    dev_id          SERIAL PRIMARY KEY,
    dev_name        TEXT NOT NULL,
    marks_code      CHAR(2) UNIQUE,
    in_marks        BOOLEAN NOT NULL DEFAULT false,
    county_id       BIGINT REFERENCES dim_county(county_id),
    state_id        BIGINT REFERENCES dim_state(state_id),
    municipality_id BIGINT REFERENCES dim_municipality(municipality_id),
    community_id    BIGINT REFERENCES sim_entitlement_groups(ent_group_id),
    created_at      TIMESTAMP DEFAULT NOW(),
    updated_at      TIMESTAMP DEFAULT NOW()
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
            # Add PKs to dim tables if not already present
            for stmt in _ADD_PKS:
                try:
                    cur.execute(stmt)
                    print(f"Applied: {stmt[:60]}")
                except psycopg2.errors.InvalidTableDefinition:
                    # PK already exists — skip
                    pass
                except Exception as e:
                    # duplicate_table or similar — log and continue
                    print(f"Skipped ({e.__class__.__name__}): {stmt[:60]}")

            cur.execute(_DDL)

            cur.execute(
                "SELECT EXISTS ("
                "  SELECT 1 FROM information_schema.tables"
                "  WHERE table_schema = 'devdb'"
                "  AND table_name = 'developments'"
                ")"
            )
            exists = cur.fetchone()[0]
        print(f"developments exists: {exists}")
        if not exists:
            print("ERROR: table was not created.", file=sys.stderr)
            sys.exit(1)
    finally:
        conn.close()


if __name__ == "__main__":
    run()
