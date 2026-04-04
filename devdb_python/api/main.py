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

from api.routers import developments, eg_crud, eg_validation, eg_views, instruments, lots, phases, tda_crud, tda_checkpoints, tda_assignments, site_plans, phase_boundaries, lot_positions, simulations, ledger, building_groups

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
    conn.autocommit = False
    try:
        # Step 1: always run 000 to ensure the log table exists (DDL — auto-commits in PG)
        zero = _MIGRATIONS_DIR / "000_create_migrations_log.sql"
        if zero.exists():
            conn.autocommit = True
            with conn.cursor() as cur:
                cur.execute(zero.read_text(encoding="utf-8"))
            conn.autocommit = False

        # Step 2: load already-applied versions
        with conn.cursor() as cur:
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
            try:
                with conn.cursor() as cur:
                    cur.execute(f.read_text(encoding="utf-8"))
                    cur.execute(
                        "INSERT INTO devdb.schema_migrations (version, filename) VALUES (%s, %s)",
                        (version, f.name),
                    )
                conn.commit()
                logger.info("Migration %s applied.", f.name)
            except Exception:
                conn.rollback()
                logger.exception("Migration %s FAILED — rolled back.", f.name)
                raise
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
app.include_router(eg_crud.router)
app.include_router(eg_validation.router)
app.include_router(eg_views.router)
app.include_router(tda_crud.router)
app.include_router(tda_checkpoints.router)
app.include_router(tda_assignments.router)
app.include_router(site_plans.router)
app.include_router(phase_boundaries.router)
app.include_router(lot_positions.router)
app.include_router(simulations.router)
app.include_router(ledger.router)
app.include_router(building_groups.router)
