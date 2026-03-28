# routers/instruments.py
# Instrument-level endpoints.

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from api.deps import get_db_conn

router = APIRouter(prefix="/instruments", tags=["instruments"])

VALID_INSTRUMENT_TYPES = {"Plat", "Site Condo", "Condo Declaration", "Other"}


class InstrumentCreateRequest(BaseModel):
    instrument_name: str
    instrument_type: str
    dev_id: int


@router.post("", response_model=dict, status_code=201)
def create_instrument(body: InstrumentCreateRequest, conn=Depends(get_db_conn)):
    import psycopg2.extras

    name = (body.instrument_name or "").strip()
    if not name:
        raise HTTPException(status_code=422, detail="instrument_name is required")
    if body.instrument_type not in VALID_INSTRUMENT_TYPES:
        raise HTTPException(
            status_code=422,
            detail=f"instrument_type must be one of: {', '.join(sorted(VALID_INSTRUMENT_TYPES))}",
        )

    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
    try:
        # Resolve modern developments.dev_id → legacy dim_development.development_id.
        # sim_legal_instruments.dev_id must hold the legacy ID used by the simulation
        # engine and lot-phase-view queries. Bridge: developments.marks_code = dim_development.dev_code2.
        cur.execute(
            """
            SELECT dd.development_id AS legacy_dev_id
            FROM developments d
            JOIN dim_development dd ON dd.dev_code2 = d.marks_code
            WHERE d.dev_id = %s
              AND d.marks_code IS NOT NULL
            """,
            (body.dev_id,),
        )
        row = cur.fetchone()
        if row is None:
            raise HTTPException(
                status_code=422,
                detail=f"Development {body.dev_id} has no MARKsystems code and cannot be linked to a legal instrument",
            )
        legacy_dev_id = int(row["legacy_dev_id"])

        cur.execute(
            "SELECT COALESCE(MAX(instrument_id), 0) + 1 AS new_id FROM sim_legal_instruments"
        )
        new_id = int(cur.fetchone()["new_id"])
        cur.execute(
            """
            INSERT INTO sim_legal_instruments (instrument_id, instrument_name, instrument_type, dev_id)
            VALUES (%s, %s, %s, %s)
            """,
            (new_id, name, body.instrument_type, legacy_dev_id),
        )
        conn.commit()
        return {
            "instrument_id": new_id,
            "instrument_name": name,
            "instrument_type": body.instrument_type,
            "dev_id": legacy_dev_id,
        }
    except Exception:
        conn.rollback()
        raise
    finally:
        cur.close()
