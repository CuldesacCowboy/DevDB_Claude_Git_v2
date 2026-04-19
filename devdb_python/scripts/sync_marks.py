"""
sync_marks.py -- Sync MARKS MySQL replica tables into devdb_ext (local Postgres).

Per D-166: MARKSConnection is never used in the engine hot path. Run this script
before a simulation session to pull fresh MARKS data. The engine reads devdb_ext
locally and runs at 0.5s regardless of network conditions.

Synced tables:
  schedhousedetail  (milestone dates -- used by S-0200)
  housemaster       (lot/builder mapping -- used by S-0050)

Usage:
  python sync_marks.py                   # sync both tables
  python sync_marks.py --tables sched    # schedhousedetail only
  python sync_marks.py --tables hm       # housemaster only
  python sync_marks.py --dry-run         # print counts, no writes

The script infers which columns to sync by intersecting the MySQL result columns
with the devdb_ext table columns in Postgres -- no hardcoded column lists.
"""

import argparse
import os
import sys
import time

import psycopg2
import psycopg2.extras
from dotenv import load_dotenv

load_dotenv(os.path.join(os.path.dirname(__file__), "..", ".env"))
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from engine.connection import MARKSConnection

PG = dict(
    dbname="devdb",
    user=os.getenv("PG_USER", "postgres"),
    password=os.getenv("PG_PASSWORD", ""),
    host="localhost",
    port=int(os.getenv("PG_PORT", 5432)),
)
CHUNK = 500


def _pg_columns(pg_conn, schema, table):
    cur = pg_conn.cursor()
    cur.execute(
        "SELECT column_name FROM information_schema.columns "
        "WHERE table_schema = %s AND table_name = %s ORDER BY ordinal_position",
        (schema, table),
    )
    cols = [r[0] for r in cur.fetchall()]
    cur.close()
    return cols


def sync_table(marks, pg_conn, mysql_table, pg_schema, pg_table,
               mysql_query, dry_run):
    """
    Pull mysql_table from MARKS into pg_schema.pg_table.
    Column intersection: uses whatever columns exist in both MySQL result and
    the Postgres table -- safe against schema drift in either direction.
    """
    print(f"\n  {mysql_table} -> {pg_schema}.{pg_table}")

    pg_cols = _pg_columns(pg_conn, pg_schema, pg_table)
    if not pg_cols:
        print(f"    ERROR: {pg_schema}.{pg_table} not found in Postgres -- skipping.")
        return 0

    t0 = time.time()
    df = marks.read_df(mysql_query)
    elapsed = time.time() - t0
    print(f"    Fetched {len(df):,} rows from MySQL in {elapsed:.1f}s")

    # Lowercase MySQL column names to match Postgres convention
    df.columns = [c.lower() for c in df.columns]

    # Use only columns present in both MySQL result and Postgres table (Postgres order)
    shared_cols = [c for c in pg_cols if c in df.columns]
    missing = set(pg_cols) - set(df.columns)
    extra = set(df.columns) - set(pg_cols)
    if missing:
        print(f"    NOTE: {len(missing)} Postgres column(s) not in MySQL result: {sorted(missing)[:5]}{'...' if len(missing) > 5 else ''}")
    if extra:
        print(f"    NOTE: {len(extra)} MySQL column(s) not in Postgres schema (ignored)")

    if dry_run:
        print(f"    DRY RUN -- no writes.")
        return len(df)

    cur = pg_conn.cursor()
    cur.execute(f"TRUNCATE {pg_schema}.{pg_table}")
    print(f"    Truncated {pg_schema}.{pg_table}")

    col_list = ", ".join(shared_cols)
    insert_sql = f"INSERT INTO {pg_schema}.{pg_table} ({col_list}) VALUES %s"
    rows = [tuple(row) for row in df[shared_cols].itertuples(index=False, name=None)]

    inserted = 0
    for i in range(0, len(rows), CHUNK):
        chunk = rows[i:i + CHUNK]
        psycopg2.extras.execute_values(cur, insert_sql, chunk, page_size=CHUNK)
        inserted += len(chunk)
        if len(rows) > CHUNK:
            print(f"    {inserted:,}/{len(rows):,} rows...", end="\r")
    if len(rows) > CHUNK:
        print()

    pg_conn.commit()
    cur.close()
    print(f"    Inserted {inserted:,} rows.")
    return inserted


TABLES = {
    "sched": {
        "mysql_table": "schedhousedetail",
        "pg_schema":   "devdb_ext",
        "pg_table":    "schedhousedetail",
        "mysql_query": "SELECT * FROM schedhousedetail",
    },
    "hm": {
        "mysql_table": "housemaster",
        "pg_schema":   "devdb_ext",
        "pg_table":    "housemaster",
        "mysql_query": "SELECT * FROM housemaster",
    },
}


def main():
    parser = argparse.ArgumentParser(
        description="Sync MARKS MySQL replica tables into devdb_ext (local Postgres)."
    )
    parser.add_argument(
        "--tables",
        nargs="+",
        choices=list(TABLES.keys()),
        default=list(TABLES.keys()),
        help="Tables to sync (default: all). Choices: sched, hm",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Fetch counts from MySQL but do not write to Postgres.",
    )
    args = parser.parse_args()

    print("MARKS -> devdb_ext sync")
    if args.dry_run:
        print("  (dry run)")

    try:
        marks = MARKSConnection()
    except Exception as e:
        print(f"\nERROR: Could not connect to MARKS MySQL replica.")
        print(f"  {e}")
        print("  Check network/VPN access to ms-replication-e.ihmsweb.com:3306")
        sys.exit(1)

    pg_conn = psycopg2.connect(**PG)

    t_total = time.time()
    totals = {}
    try:
        for key in args.tables:
            cfg = TABLES[key]
            n = sync_table(
                marks, pg_conn,
                mysql_table=cfg["mysql_table"],
                pg_schema=cfg["pg_schema"],
                pg_table=cfg["pg_table"],
                mysql_query=cfg["mysql_query"],
                dry_run=args.dry_run,
            )
            totals[key] = n
    finally:
        marks.close()
        pg_conn.close()

    elapsed = time.time() - t_total
    print(f"\nDone in {elapsed:.1f}s.")
    for key, n in totals.items():
        print(f"  {TABLES[key]['mysql_table']}: {n:,} rows")


if __name__ == "__main__":
    main()
