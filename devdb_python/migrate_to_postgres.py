# migrate_to_postgres.py
# One-time migration: copy all DevDB tables from Databricks to local PostgreSQL.
#
# Run from devdb_python/:
#   python migrate_to_postgres.py
#
# Strategy:
#   - Read each table from Databricks via DBConnection
#   - TRUNCATE target table in Postgres (preserves structure + constraints)
#   - INSERT only columns that exist in the Postgres target
#   - Connection runs with autocommit=True throughout (no transaction toggling)
#
# Table order respects FK dependencies (parents before children).
# schedhousedetail last -- it is large (266k rows) and has no FK dependents.

import sys
import os
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import psycopg2
import psycopg2.extras
import pandas as pd
import numpy as np
from dotenv import load_dotenv

load_dotenv()

from engine.connection import DBConnection

_PG_SCHEMA = "devdb"
_CHUNK = 2000


def _get_pg_conn():
    conn = psycopg2.connect(
        host="localhost",
        database="devdb",
        user=os.getenv("PG_USER", "postgres"),
        password=os.getenv("PG_PASSWORD", ""),
        port=int(os.getenv("PG_PORT", 5432)),
        options=f"-c search_path={_PG_SCHEMA}",
    )
    conn.autocommit = True
    return conn


def _native(v):
    """Convert pandas/numpy types to Python-native for psycopg2."""
    if v is None:
        return None
    try:
        if pd.isna(v):
            return None
    except (TypeError, ValueError):
        pass
    if isinstance(v, pd.Timestamp):
        if v.hour == 0 and v.minute == 0 and v.second == 0:
            return v.date()
        return v.to_pydatetime()
    if isinstance(v, np.integer):
        return int(v)
    if isinstance(v, np.floating):
        return float(v)
    if isinstance(v, np.bool_):
        return bool(v)
    return v


def _get_pg_columns(cur, table: str) -> list:
    """Return list of column names that exist in the Postgres target table."""
    cur.execute(
        "SELECT column_name FROM information_schema.columns "
        "WHERE table_schema = %s AND table_name = %s ORDER BY ordinal_position",
        (_PG_SCHEMA, table),
    )
    return [r[0] for r in cur.fetchall()]


def _ensure_table(cur, table: str, df: pd.DataFrame) -> None:
    """
    Create table in Postgres from DataFrame schema if it doesn't exist.
    Used only for reference tables not defined in the schema file.
    """
    cur.execute(
        "SELECT 1 FROM information_schema.tables "
        "WHERE table_schema = %s AND table_name = %s",
        (_PG_SCHEMA, table),
    )
    if cur.fetchone():
        return

    type_map = {
        "int64": "BIGINT", "int32": "INTEGER", "Int64": "BIGINT",
        "float64": "DOUBLE PRECISION", "bool": "BOOLEAN",
        "object": "TEXT", "datetime64[ns]": "DATE",
        "boolean": "BOOLEAN",
    }
    col_defs = []
    for col, dtype in df.dtypes.items():
        pg_type = type_map.get(str(dtype), "TEXT")
        col_defs.append(f'"{col}" {pg_type}')
    ddl = (f"CREATE TABLE IF NOT EXISTS {_PG_SCHEMA}.{table} "
           f"({', '.join(col_defs)})")
    cur.execute(ddl)


def migrate_table(cur, db_conn: DBConnection, table: str,
                  source_query: str = None) -> int:
    """
    Read table from Databricks, TRUNCATE + INSERT into Postgres.
    Only inserts columns that exist in the Postgres target.
    Returns number of rows migrated.
    """
    t0 = time.time()

    query = source_query or f"SELECT * FROM main.devdb.{table}"
    df = db_conn.read_df(query)
    row_count = len(df)

    # Ensure table exists (for reference tables not in schema)
    _ensure_table(cur, table, df)

    if row_count == 0:
        cur.execute(f"TRUNCATE TABLE {_PG_SCHEMA}.{table} CASCADE")
        print(f"  {table}: 0 rows")
        return 0

    # Filter to only columns that exist in Postgres target
    pg_cols = _get_pg_columns(cur, table)
    src_cols = [c for c in df.columns if c in pg_cols]
    df = df[src_cols]

    if not src_cols:
        print(f"  {table}: no matching columns -- skipped")
        return 0

    cur.execute(f"TRUNCATE TABLE {_PG_SCHEMA}.{table} CASCADE")

    col_list = ", ".join(f'"{c}"' for c in src_cols)
    insert_sql = f'INSERT INTO {_PG_SCHEMA}.{table} ({col_list}) VALUES %s'

    rows = [
        tuple(_native(v) for v in row)
        for row in df.itertuples(index=False, name=None)
    ]

    for i in range(0, len(rows), _CHUNK):
        psycopg2.extras.execute_values(cur, insert_sql, rows[i:i + _CHUNK],
                                       page_size=_CHUNK)

    elapsed = time.time() - t0
    print(f"  {table}: {row_count:,} rows ({elapsed:.1f}s)")
    return row_count


# ---------------------------------------------------------------------------
# Table migration order -- parents before children
# ---------------------------------------------------------------------------

MIGRATION_TABLES = [
    # Reference / dimension tables
    "dim_state",
    "dim_county",
    "dim_school_district",
    "dim_municipality",
    "dim_builders",
    "dim_internal_external",
    "dim_projection_status",
    "ref_lot_types",
    "dim_development",
    "dim_projection_groups",

    # Entitlement hierarchy
    "sim_entitlement_groups",
    "sim_entitlement_delivery_config",
    "sim_ent_group_developments",

    # Legal instruments and phases
    "sim_legal_instruments",
    "sim_dev_phases",
    "sim_phase_product_splits",
    "sim_phase_builder_splits",

    # Delivery events
    "sim_delivery_events",
    "sim_delivery_event_predecessors",
    "sim_delivery_event_phases",

    # Other sim tables
    "sim_building_groups",
    "sim_dev_defaults",
    "sim_projection_params",
    "sim_takedown_agreements",
    "sim_takedown_checkpoints",
    "sim_takedown_agreement_lots",

    # Lots (depends on everything above)
    "sim_lots",

    # schedhousedetail last -- largest table, no FK dependents
    "schedhousedetail",
]


def run_migration():
    total_t0 = time.time()
    print("DevDB Databricks -> PostgreSQL migration")
    print("=" * 50)

    db_conn = DBConnection()
    pg_conn = _get_pg_conn()
    cur = pg_conn.cursor()

    # Disable FK checks for the session (session_replication_role = replica)
    cur.execute("SET session_replication_role = 'replica'")
    print("FK checks disabled for migration duration.\n")

    totals = {}
    for table in MIGRATION_TABLES:
        try:
            n = migrate_table(cur, db_conn, table)
            totals[table] = n
        except Exception as e:
            print(f"  ERROR on {table}: {e}")
            # Roll back any partial state and get a fresh cursor
            pg_conn.autocommit = False
            try:
                pg_conn.rollback()
            except Exception:
                pass
            pg_conn.autocommit = True
            cur = pg_conn.cursor()
            cur.execute("SET session_replication_role = 'replica'")
            totals[table] = "ERROR"

    # Re-enable FK checks
    cur.execute("SET session_replication_role = 'origin'")
    print("\nFK checks re-enabled.")

    db_conn.close()
    pg_conn.close()

    elapsed = time.time() - total_t0
    print(f"\n{'=' * 50}")
    print(f"Migration complete in {elapsed:.1f}s")
    print(f"\nRow counts:")
    for t, n in totals.items():
        label = f"{n:,}" if isinstance(n, int) else str(n)
        print(f"  {t}: {label}")

    errors = [t for t, n in totals.items() if n == "ERROR"]
    if errors:
        print(f"\nERRORS on: {errors}")
        return False
    return True


if __name__ == "__main__":
    ok = run_migration()
    sys.exit(0 if ok else 1)
