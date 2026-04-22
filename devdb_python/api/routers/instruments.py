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


_SMALL_SAMPLE = 10

_LOT_TYPE_GROUP_EXPR = """
    CASE
        WHEN rlt.lot_type_short LIKE 'SF%%' THEN 'SF'
        WHEN rlt.lot_type_short LIKE 'CD%%' THEN 'CD'
        WHEN rlt.lot_type_short LIKE 'TH%%' THEN 'TH'
        WHEN rlt.lot_type_short IN ('Gateway', 'GW', 'GW-PG') THEN 'GW'
        ELSE 'Other'
    END
"""

_SPEC_FLAG_CTE = """
    WITH spec_flag AS (
        SELECT DISTINCT companycode, developmentcode, housenumber
        FROM devdb_ext.codetail
        WHERE conumber = '000'
    )
"""

def _h(value, lot_count, warning):
    return {"value": value, "lot_count": int(lot_count), "warning": warning}


@router.get("/{instrument_id}/spec-rate-hints", response_model=dict)
def get_spec_rate_hints(instrument_id: int, conn=Depends(get_db_conn)):
    """
    Return 7 spec-rate hints for this instrument.

    Computed (company-wide curves weighted to this instrument):
      computed_builder_1yr/2yr  — builder-split-weighted company spec rate (1yr / 2yr closed)
      computed_blt_1yr/2yr      — builder × lot-type weighted company spec rate (1yr / 2yr)

    Historical (direct from this instrument's own closed lots):
      historical_1yr / historical_2yr / historical_alltime

    Each hint: {value: float|null, lot_count: int, warning: str|null}
    Closed = settlement_date; spec = codetail conumber='000'.
    """
    from datetime import date, timedelta

    cur = dict_cursor(conn)
    try:
        cutoff_1yr = date.today() - timedelta(days=365)
        cutoff_2yr = date.today() - timedelta(days=730)

        # ── 1. Instrument builder splits → {companycode: normalised_share} ────
        cur.execute(
            """
            SELECT db.marks_company_code AS companycode, sibs.share
            FROM sim_instrument_builder_splits sibs
            JOIN dim_builders db ON db.builder_id = sibs.builder_id
            WHERE sibs.instrument_id = %s
              AND db.marks_company_code IS NOT NULL
            """,
            (instrument_id,),
        )
        split_rows = cur.fetchall()
        splits_raw = {r["companycode"]: float(r["share"]) for r in split_rows}
        split_total = sum(splits_raw.values())
        splits = ({cc: s / split_total for cc, s in splits_raw.items()}
                  if split_total > 0 else {})

        # ── 2. Instrument lot-type distribution → {group: fraction} ──────────
        cur.execute(
            f"""
            SELECT
                {_LOT_TYPE_GROUP_EXPR} AS lt_group,
                SUM(sps.projected_count) AS cnt
            FROM sim_phase_product_splits sps
            JOIN sim_dev_phases sdp ON sdp.phase_id = sps.phase_id
            JOIN ref_lot_types rlt ON rlt.lot_type_id = sps.lot_type_id
            WHERE sdp.instrument_id = %s
            GROUP BY lt_group
            """,
            (instrument_id,),
        )
        lt_raw = {r["lt_group"]: int(r["cnt"]) for r in cur.fetchall()}
        lt_total = sum(lt_raw.values())
        lt_dist = ({g: c / lt_total for g, c in lt_raw.items()}
                   if lt_total > 0 else {})

        # ── 3. Company-wide builder curves ────────────────────────────────────
        def _builder_curves(cutoff):
            cur.execute(
                f"""
                {_SPEC_FLAG_CTE}
                SELECT
                    hm.companycode,
                    COUNT(*) AS total,
                    COUNT(sf.companycode) AS spec_count
                FROM devdb_ext.housemaster hm
                LEFT JOIN spec_flag sf
                    ON sf.companycode    = hm.companycode
                    AND sf.developmentcode = hm.developmentcode
                    AND sf.housenumber   = hm.housenumber
                WHERE hm.settlement_date >= %s
                GROUP BY hm.companycode
                """,
                (cutoff,),
            )
            return {r["companycode"]: {"total": int(r["total"]),
                                       "spec":  int(r["spec_count"])}
                    for r in cur.fetchall()}

        # ── 4. Company-wide builder × lot-type curves ─────────────────────────
        def _blt_curves(cutoff):
            cur.execute(
                f"""
                {_SPEC_FLAG_CTE}
                SELECT
                    hm.companycode,
                    {_LOT_TYPE_GROUP_EXPR} AS lt_group,
                    COUNT(*) AS total,
                    COUNT(sf.companycode) AS spec_count
                FROM devdb_ext.housemaster hm
                JOIN sim_lots siml
                    ON  siml.lot_number ~ '^[A-Za-z]+[0-9]+$'
                    AND hm.developmentcode = REGEXP_REPLACE(siml.lot_number, '[0-9]+$', '')
                    AND hm.housenumber     = CAST(REGEXP_REPLACE(siml.lot_number, '^[A-Za-z]+', '') AS BIGINT)
                JOIN ref_lot_types rlt ON rlt.lot_type_id = siml.lot_type_id
                LEFT JOIN spec_flag sf
                    ON sf.companycode    = hm.companycode
                    AND sf.developmentcode = hm.developmentcode
                    AND sf.housenumber   = hm.housenumber
                WHERE hm.settlement_date >= %s
                GROUP BY hm.companycode, lt_group
                """,
                (cutoff,),
            )
            return {(r["companycode"], r["lt_group"]): {"total": int(r["total"]),
                                                         "spec":  int(r["spec_count"])}
                    for r in cur.fetchall()}

        # ── 5. Instrument historical hints ────────────────────────────────────
        def _instrument_history(cutoff):
            cur.execute(
                f"""
                {_SPEC_FLAG_CTE}
                SELECT COUNT(*) AS total, COUNT(sf.companycode) AS spec_count
                FROM devdb_ext.housemaster hm
                JOIN sim_lots siml
                    ON  siml.lot_number ~ '^[A-Za-z]+[0-9]+$'
                    AND hm.developmentcode = REGEXP_REPLACE(siml.lot_number, '[0-9]+$', '')
                    AND hm.housenumber     = CAST(REGEXP_REPLACE(siml.lot_number, '^[A-Za-z]+', '') AS BIGINT)
                JOIN sim_dev_phases sdp ON sdp.phase_id = siml.phase_id
                LEFT JOIN spec_flag sf
                    ON sf.companycode    = hm.companycode
                    AND sf.developmentcode = hm.developmentcode
                    AND sf.housenumber   = hm.housenumber
                WHERE sdp.instrument_id = %s
                  AND hm.settlement_date IS NOT NULL
                  AND (%s IS NULL OR hm.settlement_date >= %s)
                """,
                (instrument_id, cutoff, cutoff),
            )
            row = cur.fetchone()
            return (int(row["total"]), int(row["spec_count"])) if row else (0, 0)

        # ── 6. Compute hints ──────────────────────────────────────────────────
        def _make_hist_hint(total, spec_count):
            if total == 0:
                return _h(None, 0, "No closed lots found for this instrument in this window.")
            rate = round(spec_count / total, 4)
            warn = (f"Small sample ({total} lots — results may be unreliable)."
                    if total < _SMALL_SAMPLE else None)
            return _h(rate, total, warn)

        def _make_builder_hint(curves):
            if not splits:
                return _h(None, 0, "No builder splits configured for this instrument.")
            wsum = 0.0; wused = 0.0; lots = 0; missing = []
            for cc, share in splits.items():
                c = curves.get(cc)
                if not c or c["total"] == 0:
                    missing.append(cc); continue
                wsum  += share * (c["spec"] / c["total"])
                wused += share
                lots  += c["total"]
            if wused == 0:
                return _h(None, 0, "No company-wide closed-lot data found for any configured builder.")
            value = round(wsum / wused, 4)
            warns = []
            if missing:
                warns.append(f"No data for builder(s) {', '.join(missing)} "
                             f"(result covers {round(wused*100)}% of configured splits).")
            if lots < _SMALL_SAMPLE:
                warns.append(f"Small company-wide sample ({lots} lots).")
            return _h(value, lots, " ".join(warns) or None)

        def _make_blt_hint(curves):
            if not splits:
                return _h(None, 0, "No builder splits configured for this instrument.")
            if not lt_dist:
                return _h(None, 0, "No lot type distribution found for this instrument's phases.")
            wsum = 0.0; wused = 0.0; lots = 0
            missing = 0; total_combos = 0
            for cc, s_share in splits.items():
                for lt_group, lt_frac in lt_dist.items():
                    total_combos += 1
                    c = curves.get((cc, lt_group))
                    if not c or c["total"] == 0:
                        missing += 1; continue
                    w = s_share * lt_frac
                    wsum  += w * (c["spec"] / c["total"])
                    wused += w
                    lots  += c["total"]
            if wused == 0:
                return _h(None, 0, "No company-wide data for any builder × lot type combination.")
            value = round(wsum / wused, 4)
            warns = []
            if missing:
                warns.append(f"{missing}/{total_combos} builder×lot type combinations had no data "
                             f"(result covers {round(wused*100)}% of weight).")
            if lots < _SMALL_SAMPLE:
                warns.append(f"Small company-wide sample ({lots} lots).")
            return _h(value, lots, " ".join(warns) or None)

        bc1 = _builder_curves(cutoff_1yr)
        bc2 = _builder_curves(cutoff_2yr)
        blt1 = _blt_curves(cutoff_1yr)
        blt2 = _blt_curves(cutoff_2yr)
        h1   = _instrument_history(cutoff_1yr)
        h2   = _instrument_history(cutoff_2yr)
        hall = _instrument_history(None)

        return {
            "computed_builder_1yr": _make_builder_hint(bc1),
            "computed_builder_2yr": _make_builder_hint(bc2),
            "computed_blt_1yr":     _make_blt_hint(blt1),
            "computed_blt_2yr":     _make_blt_hint(blt2),
            "historical_1yr":       _make_hist_hint(*h1),
            "historical_2yr":       _make_hist_hint(*h2),
            "historical_alltime":   _make_hist_hint(*hall),
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
            cur.execute("DELETE FROM sim_phase_building_config WHERE phase_id = %s", (phase_id,))
            cur.execute("DELETE FROM sim_delivery_event_phases WHERE phase_id = %s", (phase_id,))

        cur.execute("DELETE FROM sim_dev_phases WHERE instrument_id = %s", (instrument_id,))
        cur.execute("DELETE FROM sim_instrument_builder_splits WHERE instrument_id = %s", (instrument_id,))
        cur.execute("DELETE FROM sim_legal_instruments WHERE instrument_id = %s", (instrument_id,))
        conn.commit()
        return {"success": True, "instrument_id": instrument_id, "phases_deleted": len(phase_ids)}
    except HTTPException:
        conn.rollback()
        raise
    except Exception as e:
        conn.rollback()
        raise HTTPException(status_code=500, detail=str(e))
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
