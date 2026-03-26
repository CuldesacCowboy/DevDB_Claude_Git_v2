# scripts/backfill_community_id.py
# Backfills developments.community_id from sim_ent_group_developments via tbdDEVdev.
# Uses marks_code as the join key between developments and tbdDEVdev.
# Idempotent — safe to run multiple times (UPDATE is a no-op when already set to same value).
#
# Run:
#   cd devdb_python
#   python scripts/backfill_community_id.py

import os
import sys

import psycopg2
from dotenv import load_dotenv

load_dotenv()

_SQL = """
UPDATE devdb.developments d
SET community_id = egd.ent_group_id
FROM devdb.sim_ent_group_developments egd
JOIN devdb.dim_development dd ON dd.development_id = egd.dev_id
WHERE d.marks_code = dd.dev_code2
  AND (d.community_id IS DISTINCT FROM egd.ent_group_id)
"""


def run() -> None:
    conn = psycopg2.connect(
        host="localhost",
        database="devdb",
        user=os.getenv("PG_USER", "postgres"),
        password=os.getenv("PG_PASSWORD", ""),
        port=int(os.getenv("PG_PORT", 5432)),
    )
    conn.autocommit = True
    try:
        with conn.cursor() as cur:
            cur.execute(_SQL)
            updated = cur.rowcount
            print(f"Rows updated: {updated}")

            # Verify Waterton Station devs got community_id = 9002
            cur.execute(
                """
                SELECT dev_name, marks_code, community_id
                FROM devdb.developments
                WHERE marks_code IN ('WS', 'WV', 'WT')
                ORDER BY marks_code
                """
            )
            rows = cur.fetchall()
            print("\nWaterton Station spot-check:")
            for r in rows:
                print(f"  {r[1]:>4}  {r[0]:<30}  community_id={r[2]}")
    finally:
        conn.close()


if __name__ == "__main__":
    run()
