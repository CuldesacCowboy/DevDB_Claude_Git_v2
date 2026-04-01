# main.py
# FastAPI application entry point.
#
# Run:
#   cd devdb_python
#   uvicorn api.main:app --reload

import logging
import os
from contextlib import asynccontextmanager
from pathlib import Path

import psycopg2
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from dotenv import load_dotenv

from api.routers import developments, entitlement_groups, instruments, lots, phases, takedown_agreements, site_plans

load_dotenv()

logger = logging.getLogger("devdb.migrations")

_MIGRATIONS_DIR = Path(__file__).resolve().parent.parent / "migrations"


def _get_migration_version(filename: str) -> int | None:
    """Parse the leading integer from a migration filename (e.g. 003_... -> 3)."""
    stem = Path(filename).stem
    parts = stem.split("_", 1)
    try:
        return int(parts[0])
    except (ValueError, IndexError):
        return None


def _run_migrations() -> None:
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
            # Step 1: always run 000 to ensure the log table exists
            zero = _MIGRATIONS_DIR / "000_create_migrations_log.sql"
            if zero.exists():
                cur.execute(zero.read_text(encoding="utf-8"))

            # Step 2: load already-applied versions
            cur.execute("SELECT version FROM devdb.schema_migrations")
            applied = {row[0] for row in cur.fetchall()}

            # Step 3: collect numbered .sql files (skip 000 — already run above)
            sql_files = sorted(
                f for f in _MIGRATIONS_DIR.iterdir()
                if f.suffix == ".sql" and f.name != "000_create_migrations_log.sql"
            )

            for f in sql_files:
                version = _get_migration_version(f.name)
                if version is None:
                    continue
                if version in applied:
                    logger.info("Migration %s already applied — skipping", f.name)
                    continue

                logger.info("Applying migration %s ...", f.name)
                cur.execute(f.read_text(encoding="utf-8"))
                cur.execute(
                    "INSERT INTO devdb.schema_migrations (version, filename) VALUES (%s, %s)",
                    (version, f.name),
                )
                logger.info("Migration %s applied.", f.name)
    finally:
        conn.close()


@asynccontextmanager
async def lifespan(app: FastAPI):
    logging.basicConfig(level=logging.INFO)
    logger.info("Running schema migrations...")
    _run_migrations()
    logger.info("Migrations complete.")
    yield


app = FastAPI(title="DevDB API", version="0.1.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://localhost:5174",
        "http://localhost:5175",
        "http://localhost:5176",
    ],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(lots.router)
app.include_router(phases.router)
app.include_router(instruments.router)
app.include_router(developments.router)
app.include_router(entitlement_groups.router)
app.include_router(takedown_agreements.router)
app.include_router(site_plans.router)
