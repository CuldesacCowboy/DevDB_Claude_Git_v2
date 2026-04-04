# connection.py
# Database connection wrappers.
# DBConnection  -- Databricks SQL connector (migration source, legacy)
# PGConnection  -- local PostgreSQL (simulation engine target)
#
# Required env vars for Databricks:
#   DATABRICKS_HOST      -- e.g. adb-xxxx.azuredatabricks.net
#   DATABRICKS_TOKEN     -- personal access token
#   DATABRICKS_HTTP_PATH -- SQL warehouse http_path (has default)
#
# Required env vars for Postgres:
#   PG_USER     -- default: postgres
#   PG_PASSWORD -- default: (empty)
#   PG_PORT     -- default: 5432

import os
import pandas as pd
import psycopg2
import psycopg2.extras
from databricks import sql
from dotenv import load_dotenv

load_dotenv()

_DEFAULT_HTTP_PATH = "/sql/1.0/warehouses/7228fe0366c2e8a0"
_PG_SCHEMA = "devdb"


def _native(v):
    """Convert pandas/numpy types to Python-native types for DB writes."""
    if v is None:
        return None
    try:
        if pd.isna(v):
            return None
    except (TypeError, ValueError):
        pass
    if isinstance(v, pd.Timestamp):
        return v.date()
    if hasattr(v, "item"):  # numpy scalars
        return v.item()
    return v


class DBConnection:
    """
    Provides read_df, execute, and executemany_insert against Databricks.
    Use as a context manager to ensure the connection is closed.

        with DBConnection() as conn:
            df = conn.read_df("SELECT * FROM main.devdb.sim_lots LIMIT 5")
    """

    def __init__(self):
        host = os.environ["DATABRICKS_HOST"]
        http_path = os.environ.get("DATABRICKS_HTTP_PATH", _DEFAULT_HTTP_PATH)
        token = os.environ["DATABRICKS_TOKEN"]

        self._conn = sql.connect(
            server_hostname=host,
            http_path=http_path,
            access_token=token,
            catalog="main",
            schema="devdb",
        )

    def read_df(self, query: str) -> pd.DataFrame:
        """Execute a SELECT query and return results as a pandas DataFrame."""
        with self._conn.cursor() as cursor:
            cursor.execute(query)
            if cursor.description is None:
                return pd.DataFrame()
            columns = [desc[0] for desc in cursor.description]
            rows = cursor.fetchall()
            return pd.DataFrame(rows, columns=columns)

    def execute(self, query: str) -> None:
        """Execute a DML or DDL statement (UPDATE, DELETE, INSERT, CREATE VIEW)."""
        with self._conn.cursor() as cursor:
            cursor.execute(query)

    def executemany_insert(self, table: str, rows: list) -> int:
        """
        Bulk insert a list of dicts into table.
        Column order taken from first row's keys.
        Returns number of rows inserted.
        Converts pandas/numpy types to Python-native before insert.
        """
        if not rows:
            return 0
        columns = list(rows[0].keys())
        placeholders = ", ".join(["?"] * len(columns))
        col_list = ", ".join(columns)
        query = f"INSERT INTO {table} ({col_list}) VALUES ({placeholders})"
        params = [tuple(_native(row.get(c)) for c in columns) for row in rows]
        with self._conn.cursor() as cursor:
            cursor.executemany(query, params)
        return len(rows)

    def close(self) -> None:
        self._conn.close()

    def __enter__(self):
        return self

    def __exit__(self, *args):
        self.close()


class PGConnection:
    """
    Provides read_df, execute, and executemany_insert against local PostgreSQL.
    Drop-in replacement for DBConnection -- identical interface.
    All queries use the devdb schema; callers use unqualified table names.

        with PGConnection() as conn:
            df = conn.read_df("SELECT * FROM sim_lots LIMIT 5")
    """

    def __init__(self):
        self._conn = psycopg2.connect(
            host="localhost",
            database="devdb",
            user=os.getenv("PG_USER", "postgres"),
            password=os.getenv("PG_PASSWORD", ""),
            port=int(os.getenv("PG_PORT", 5432)),
            options=f"-c search_path={_PG_SCHEMA}",
        )
        self._conn.autocommit = False

    def read_df(self, query: str, params=None) -> pd.DataFrame:
        """Execute a SELECT query and return results as a pandas DataFrame.

        Use %s placeholders and pass params to avoid f-string SQL injection.
        Example: conn.read_df("SELECT * FROM sim_lots WHERE dev_id = %s", (dev_id,))
        """
        query = query.replace("main.devdb.", "")
        with self._conn.cursor() as cur:
            cur.execute(query, params)
            if cur.description is None:
                return pd.DataFrame()
            columns = [desc[0] for desc in cur.description]
            rows = cur.fetchall()
        return pd.DataFrame(rows, columns=columns)

    def execute(self, query: str, params=None) -> int:
        """Execute a DML or DDL statement. Returns rowcount.

        Use %s placeholders and pass params to avoid f-string SQL injection.
        Example: conn.execute("UPDATE sim_lots SET x = %s WHERE dev_id = %s", (val, dev_id))
        """
        query = query.replace("main.devdb.", "")
        with self._conn.cursor() as cur:
            cur.execute(query, params)
            rowcount = cur.rowcount
        self._conn.commit()
        return rowcount

    def executemany_insert(self, table: str, rows: list) -> int:
        """
        Bulk insert a list of dicts into table using psycopg2 execute_values.
        Significantly faster than row-by-row inserts for large batches.
        Returns number of rows inserted.
        """
        if not rows:
            return 0
        table = table.replace("main.devdb.", "")
        columns = list(rows[0].keys())
        col_list = ", ".join(columns)
        query = f"INSERT INTO {table} ({col_list}) VALUES %s"
        params = [tuple(_native(row.get(c)) for c in columns) for row in rows]
        with self._conn.cursor() as cur:
            psycopg2.extras.execute_values(cur, query, params, page_size=500)
        self._conn.commit()
        return len(rows)

    def close(self) -> None:
        self._conn.close()

    def __enter__(self):
        return self

    def __exit__(self, *args):
        self.close()
