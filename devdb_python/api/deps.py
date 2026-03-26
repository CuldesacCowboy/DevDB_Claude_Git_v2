# deps.py
# FastAPI dependency providers.

import os
from typing import Generator

import psycopg2
from dotenv import load_dotenv

load_dotenv()

_PG_SCHEMA = "devdb"


def get_db_conn() -> Generator:
    """
    Yield a raw psycopg2 connection (autocommit=False).
    Services that need full transaction control receive this directly.
    Connection is closed when the request completes.
    """
    conn = psycopg2.connect(
        host="localhost",
        database="devdb",
        user=os.getenv("PG_USER", "postgres"),
        password=os.getenv("PG_PASSWORD", ""),
        port=int(os.getenv("PG_PORT", 5432)),
        options=f"-c search_path={_PG_SCHEMA}",
    )
    conn.autocommit = False
    try:
        yield conn
    finally:
        conn.close()
