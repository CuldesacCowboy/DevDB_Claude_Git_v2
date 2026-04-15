# routers/instruments.py
# Instrument-level endpoints.

import re

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from typing import List

from api.deps import get_db_conn
from api.db import dict_cursor

router = APIRouter(prefix="/instruments", tags=["instruments"])

VALID_INSTRUMENT_TYPES = {"Plat", "Site Condo", "Traditional Condo", "Metes & Bounds Splits", "Other"}


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


class InstrumentTypeRequest(BaseModel):
    instrument_type: str


class SpecRateRequest(BaseModel):
    spec_rate: float | None  # NULL clears the rate


@router.get("", response_model=list[dict])
def list_instruments(conn=Depends(get_db_conn)):
    """Return all instruments. modern_dev_id = developments.dev_id for frontend joins."""
    cur = dict_cursor(conn)
    try:
        cur.execute("""
            SELECT sli.instrument_id, sli.instrument_name, sli.instrument_type,
                   sli.dev_id, sli.spec_rate
            FROM sim_legal_instruments sli
            ORDER BY sli.instrument_name
        """)
        return [dict(r) for r in cur.fetchall()]
    finally:
        cur.close()


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
        cur.execute("SELECT dev_id FROM developments WHERE dev_id = %s", (body.dev_id,))
        if cur.fetchone() is None:
            raise HTTPException(
                status_code=422,
                detail=f"Development {body.dev_id} not found.",
            )

        cur.execute(
            """
            INSERT INTO sim_legal_instruments (instrument_name, instrument_type, dev_id)
            VALUES (%s, %s, %s) RETURNING instrument_id
            """,
            (name, body.instrument_type, body.dev_id),
        )
        new_id = int(cur.fetchone()["instrument_id"])
        conn.commit()
        return {
            "instrument_id": new_id,
            "instrument_name": name,
            "instrument_type": body.instrument_type,
            "dev_id": body.dev_id,
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


@router.patch("/{instrument_id}/type", response_model=dict)
def update_instrument_type(
    instrument_id: int,
    body: InstrumentTypeRequest,
    conn=Depends(get_db_conn),
):
    """Change the instrument type (Plat / Site Condo / Other)."""
    if body.instrument_type not in VALID_INSTRUMENT_TYPES:
        raise HTTPException(
            status_code=422,
            detail=f"instrument_type must be one of: {', '.join(sorted(VALID_INSTRUMENT_TYPES))}",
        )
    cur = dict_cursor(conn)
    try:
        cur.execute(
            "UPDATE sim_legal_instruments SET instrument_type = %s WHERE instrument_id = %s",
            (body.instrument_type, instrument_id),
        )
        if cur.rowcount == 0:
            conn.rollback()
            raise HTTPException(status_code=404, detail=f"Instrument {instrument_id} not found")
        conn.commit()
        return {"instrument_id": instrument_id, "instrument_type": body.instrument_type}
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


@router.patch("/{instrument_id}/spec-rate", response_model=dict)
def update_spec_rate(
    instrument_id: int,
    body: SpecRateRequest,
    conn=Depends(get_db_conn),
):
    """Set or clear the spec_rate for an instrument (0.0–1.0, or null to clear)."""
    rate = body.spec_rate
    if rate is not None and not (0.0 <= rate <= 1.0):
        raise HTTPException(status_code=422, detail="spec_rate must be between 0.0 and 1.0")
    cur = dict_cursor(conn)
    try:
        cur.execute(
            "UPDATE sim_legal_instruments SET spec_rate = %s WHERE instrument_id = %s",
            (rate, instrument_id),
        )
        if cur.rowcount == 0:
            conn.rollback()
            raise HTTPException(status_code=404, detail=f"Instrument {instrument_id} not found")
        conn.commit()
        return {"instrument_id": instrument_id, "spec_rate": rate}
    except HTTPException:
        raise
    except Exception:
        conn.rollback()
        raise
    finally:
        cur.close()


@router.get("/{instrument_id}/spec-rate-hints", response_model=dict)
def get_spec_rate_hints(instrument_id: int, conn=Depends(get_db_conn)):
    """
    Return 4 spec-rate hint values for this instrument, derived from MARKS
    external data (devdb_ext tables) — no simulation dependency.

    Algorithm:
      1. Find the (companycode, lot_type_id) distribution within this instrument's phases.
         Each (companycode, lot_type_id) pair is weighted as a fraction of total
         instrument lots.
      2. For each pair, compute the company-wide spec rate over the last 6 months
         and last 2 years using codetail (conumber='000' = spec) vs. housemaster
         (all lots = denominator), scoped to that (companycode, lot_type_id).
      3. Weighted-average over pairs to produce hint_6mo and hint_2yr.
      4. Repeat steps 2-3 using only companycode (ignoring lot_type_id) to produce
         hint_builder_6mo and hint_builder_2yr.

    Returns:
      {
        hint_6mo: float | null,
        hint_2yr: float | null,
        hint_builder_6mo: float | null,
        hint_builder_2yr: float | null,
        instrument_lot_count: int,
        data_note: str
      }
    """
    cur = dict_cursor(conn)
    try:
        # ── Step 1: instrument's (companycode, lot_type_id) weights ──────────────
        cur.execute(
            """
            SELECT hm.companycode,
                   sl.lot_type_id,
                   COUNT(*)::float AS cnt
            FROM sim_lots sl
            JOIN sim_dev_phases sdp ON sdp.phase_id = sl.phase_id
            JOIN devdb_ext.housemaster hm
                ON  hm.developmentcode = REGEXP_REPLACE(sl.lot_number, '[0-9]+$', '')
                AND hm.housenumber     = CAST(REGEXP_REPLACE(sl.lot_number, '^[A-Za-z]+', '') AS BIGINT)
            WHERE sdp.instrument_id = %s
              AND sl.lot_source IN ('real', 'pre')
              AND sl.excluded IS NOT TRUE
              AND sl.lot_number ~ '^[A-Za-z]+[0-9]+$'
            GROUP BY hm.companycode, sl.lot_type_id
            """,
            (instrument_id,),
        )
        weight_rows = cur.fetchall()

        if not weight_rows:
            return {
                "hint_6mo": None,
                "hint_2yr": None,
                "hint_builder_6mo": None,
                "hint_builder_2yr": None,
                "instrument_lot_count": 0,
                "data_note": "No MARKS-matched lots found for this instrument.",
            }

        total_lots = sum(r["cnt"] for r in weight_rows)
        weights = [
            {
                "companycode": r["companycode"],
                "lot_type_id": r["lot_type_id"],
                "weight": r["cnt"] / total_lots,
            }
            for r in weight_rows
        ]

        # ── Step 2+3: 6mo and 2yr hints weighted by (companycode, lot_type_id) ──
        def weighted_hint(months: int, by_builder_only: bool) -> float | None:
            total_w = 0.0
            weighted_rate_sum = 0.0
            for w in weights:
                cc = w["companycode"]
                lt = w["lot_type_id"]
                weight = w["weight"]

                if by_builder_only:
                    cur.execute(
                        """
                        SELECT
                            COUNT(DISTINCT hm.developmentcode || ':' || hm.housenumber::text)::float AS total_lots,
                            COUNT(DISTINCT CASE WHEN ct.conumber IS NOT NULL
                                               THEN hm.developmentcode || ':' || hm.housenumber::text END)::float AS spec_lots
                        FROM devdb_ext.housemaster hm
                        LEFT JOIN devdb_ext.codetail ct
                            ON  ct.companycode     = hm.companycode
                            AND ct.developmentcode = hm.developmentcode
                            AND ct.housenumber     = hm.housenumber
                            AND ct.conumber        = '000'
                        WHERE hm.companycode = %s
                          AND hm.conststart_date >= NOW() - (%s || ' months')::INTERVAL
                        """,
                        (cc, months),
                    )
                else:
                    cur.execute(
                        """
                        SELECT
                            COUNT(DISTINCT hm.developmentcode || ':' || hm.housenumber::text)::float AS total_lots,
                            COUNT(DISTINCT CASE WHEN ct.conumber IS NOT NULL
                                               THEN hm.developmentcode || ':' || hm.housenumber::text END)::float AS spec_lots
                        FROM sim_lots sl_ref
                        JOIN sim_dev_phases sdp_ref ON sdp_ref.phase_id = sl_ref.phase_id
                        JOIN devdb_ext.housemaster hm
                            ON  hm.developmentcode = REGEXP_REPLACE(sl_ref.lot_number, '[0-9]+$', '')
                            AND hm.housenumber     = CAST(REGEXP_REPLACE(sl_ref.lot_number, '^[A-Za-z]+', '') AS BIGINT)
                        LEFT JOIN devdb_ext.codetail ct
                            ON  ct.companycode     = hm.companycode
                            AND ct.developmentcode = hm.developmentcode
                            AND ct.housenumber     = hm.housenumber
                            AND ct.conumber        = '000'
                        WHERE hm.companycode = %s
                          AND sl_ref.lot_type_id = %s
                          AND sl_ref.lot_number ~ '^[A-Za-z]+[0-9]+$'
                          AND hm.conststart_date >= NOW() - (%s || ' months')::INTERVAL
                        """,
                        (cc, lt, months),
                    )

                row = cur.fetchone()
                denom = row["total_lots"] if row else 0.0
                if not denom:
                    continue
                rate = (row["spec_lots"] or 0.0) / denom
                weighted_rate_sum += rate * weight
                total_w += weight

            return round(weighted_rate_sum / total_w, 4) if total_w > 0 else None

        hint_6mo          = weighted_hint(6,  by_builder_only=False)
        hint_2yr          = weighted_hint(24, by_builder_only=False)
        hint_builder_6mo  = weighted_hint(6,  by_builder_only=True)
        hint_builder_2yr  = weighted_hint(24, by_builder_only=True)

        return {
            "hint_6mo":          hint_6mo,
            "hint_2yr":          hint_2yr,
            "hint_builder_6mo":  hint_builder_6mo,
            "hint_builder_2yr":  hint_builder_2yr,
            "instrument_lot_count": int(total_lots),
            "data_note": None,
        }
    finally:
        cur.close()


@router.delete("/{instrument_id}", response_model=dict)
def delete_instrument(instrument_id: int, conn=Depends(get_db_conn)):
    """Delete an instrument and cascade-delete all its phases.
    Lots are unassigned (phase_id set to NULL) not deleted."""
    cur = dict_cursor(conn)
    try:
        cur.execute(
            "SELECT instrument_id FROM sim_legal_instruments WHERE instrument_id = %s",
            (instrument_id,),
        )
        if not cur.fetchone():
            raise HTTPException(status_code=404, detail=f"Instrument {instrument_id} not found")

        cur.execute("SELECT phase_id FROM sim_dev_phases WHERE instrument_id = %s", (instrument_id,))
        phase_ids = [r["phase_id"] for r in cur.fetchall()]

        for phase_id in phase_ids:
            cur.execute("UPDATE sim_lots SET phase_id = NULL WHERE phase_id = %s", (phase_id,))
            cur.execute("DELETE FROM sim_phase_product_splits WHERE phase_id = %s", (phase_id,))
            cur.execute("DELETE FROM sim_phase_builder_splits WHERE phase_id = %s", (phase_id,))
            cur.execute("DELETE FROM sim_delivery_event_phases WHERE phase_id = %s", (phase_id,))

        cur.execute("DELETE FROM sim_dev_phases WHERE instrument_id = %s", (instrument_id,))
        cur.execute("DELETE FROM sim_legal_instruments WHERE instrument_id = %s", (instrument_id,))
        conn.commit()
        return {"success": True, "instrument_id": instrument_id, "phases_deleted": len(phase_ids)}
    except HTTPException:
        conn.rollback()
        raise
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
