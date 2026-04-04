# routers/instruments.py
# Instrument-level endpoints.

import re

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from typing import List

from api.deps import get_db_conn
from api.db import dict_cursor

router = APIRouter(prefix="/instruments", tags=["instruments"])

VALID_INSTRUMENT_TYPES = {"Plat", "Site Condo", "Other"}


class InstrumentCreateRequest(BaseModel):
    instrument_name: str
    instrument_type: str
    dev_id: int


class InstrumentRenameRequest(BaseModel):
    name: str


class PhaseOrderRequest(BaseModel):
    phase_ids: List[int]
    changed_by: str = "user"


class InstrumentDevRequest(BaseModel):
    dev_id: int


@router.post("", response_model=dict, status_code=201)
def create_instrument(body: InstrumentCreateRequest, conn=Depends(get_db_conn)):

    name = (body.instrument_name or "").strip()
    if not name:
        raise HTTPException(status_code=422, detail="instrument_name is required")
    if body.instrument_type not in VALID_INSTRUMENT_TYPES:
        raise HTTPException(
            status_code=422,
            detail=f"instrument_type must be one of: {', '.join(sorted(VALID_INSTRUMENT_TYPES))}",
        )

    cur = dict_cursor(conn)
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


@router.patch("/{instrument_id}", response_model=dict)
def rename_instrument(
    instrument_id: int,
    body: InstrumentRenameRequest,
    conn=Depends(get_db_conn),
):
    """Rename a legal instrument."""
    name = (body.name or "").strip()
    if not name:
        raise HTTPException(status_code=422, detail="name cannot be empty")
    cur = dict_cursor(conn)
    try:
        cur.execute(
            "UPDATE sim_legal_instruments SET instrument_name = %s WHERE instrument_id = %s",
            (name, instrument_id),
        )
        if cur.rowcount == 0:
            conn.rollback()
            raise HTTPException(status_code=404, detail=f"Instrument {instrument_id} not found")
        conn.commit()
        return {"instrument_id": instrument_id, "instrument_name": name}
    except HTTPException:
        raise
    except Exception:
        conn.rollback()
        raise
    finally:
        cur.close()


@router.patch("/{instrument_id}/dev", response_model=dict)
def update_instrument_dev(
    instrument_id: int,
    body: InstrumentDevRequest,
    conn=Depends(get_db_conn),
):
    """Reassign a legal instrument to a different developer (changes dev_id)."""
    cur = dict_cursor(conn)
    try:
        cur.execute(
            "UPDATE sim_legal_instruments SET dev_id = %s WHERE instrument_id = %s",
            (body.dev_id, instrument_id),
        )
        if cur.rowcount == 0:
            conn.rollback()
            raise HTTPException(status_code=404, detail=f"Instrument {instrument_id} not found")
        conn.commit()
        return {"instrument_id": instrument_id, "dev_id": body.dev_id}
    except HTTPException:
        raise
    except Exception:
        conn.rollback()
        raise
    finally:
        cur.close()


@router.patch("/{instrument_id}/phase-order", response_model=dict)
def update_phase_order(
    instrument_id: int,
    body: PhaseOrderRequest,
    conn=Depends(get_db_conn),
):
    """Persist a user-defined phase display order by writing display_order to sim_dev_phases."""

    cur = dict_cursor(conn)
    try:
        for i, phase_id in enumerate(body.phase_ids):
            cur.execute(
                "UPDATE sim_dev_phases SET display_order = %s WHERE phase_id = %s AND instrument_id = %s",
                (i, phase_id, instrument_id),
            )
        conn.commit()
        return {"instrument_id": instrument_id, "phase_order": body.phase_ids}
    except Exception:
        conn.rollback()
        raise
    finally:
        cur.close()


@router.post("/{instrument_id}/phase-order/auto-sort", response_model=dict)
def auto_sort_phases(instrument_id: int, conn=Depends(get_db_conn)):
    """Auto-sort phases alphabetically by prefix, then numerically by ph. N suffix.
    Writes the result to display_order on sim_dev_phases and returns the ordered phase_ids."""

    cur = dict_cursor(conn)
    try:
        cur.execute(
            "SELECT phase_id, phase_name FROM sim_dev_phases WHERE instrument_id = %s",
            (instrument_id,),
        )
        phases = cur.fetchall()
        if not phases:
            raise HTTPException(
                status_code=404,
                detail=f"Instrument {instrument_id} not found or has no phases",
            )

        def sort_key(p):
            name = p["phase_name"]
            idx = name.rfind(" ph.")
            if idx == -1:
                return (name.lower(), 0)
            prefix = name[:idx].lower()
            rest = name[idx + 4:].strip()
            m = re.search(r"\d+", rest)
            return (prefix, int(m.group()) if m else 0)

        sorted_phases = sorted(phases, key=sort_key)
        phase_ids = [p["phase_id"] for p in sorted_phases]

        for i, phase_id in enumerate(phase_ids):
            cur.execute(
                "UPDATE sim_dev_phases SET display_order = %s WHERE phase_id = %s",
                (i, phase_id),
            )
        conn.commit()
        return {"phase_order": phase_ids}
    except HTTPException:
        raise
    except Exception:
        conn.rollback()
        raise
    finally:
        cur.close()
