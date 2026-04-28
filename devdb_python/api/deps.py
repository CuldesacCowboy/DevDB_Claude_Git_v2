# deps.py
# FastAPI dependency providers.

import os
from typing import Generator

import psycopg2
from dotenv import load_dotenv

load_dotenv()

_PG_SCHEMA = "devdb"


def flag_scenarios_stale(conn, ent_group_id: int):
    """Mark all scenarios for this community as stale after a structural change."""
    cur = conn.cursor()
    cur.execute(
        "UPDATE sim_scenarios SET is_stale = TRUE WHERE ent_group_id = %s AND is_stale IS NOT TRUE",
        (ent_group_id,),
    )
    cur.close()


def ent_group_for_dev(conn, dev_id: int) -> int | None:
    """Look up ent_group_id for a development."""
    cur = conn.cursor()
    cur.execute(
        "SELECT ent_group_id FROM sim_ent_group_developments WHERE dev_id = %s LIMIT 1",
        (dev_id,),
    )
    row = cur.fetchone()
    cur.close()
    return row[0] if row else None


def ent_group_for_phase(conn, phase_id: int) -> int | None:
    """Look up ent_group_id for a phase."""
    cur = conn.cursor()
    cur.execute(
        """SELECT segd.ent_group_id
           FROM sim_dev_phases p
           JOIN sim_ent_group_developments segd ON segd.dev_id = p.dev_id
           WHERE p.phase_id = %s LIMIT 1""",
        (phase_id,),
    )
    row = cur.fetchone()
    cur.close()
    return row[0] if row else None


def ent_group_for_instrument(conn, instrument_id: int) -> int | None:
    """Look up ent_group_id for an instrument."""
    cur = conn.cursor()
    cur.execute(
        """SELECT segd.ent_group_id
           FROM sim_legal_instruments i
           JOIN sim_ent_group_developments segd ON segd.dev_id = i.dev_id
           WHERE i.instrument_id = %s LIMIT 1""",
        (instrument_id,),
    )
    row = cur.fetchone()
    cur.close()
    return row[0] if row else None


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
