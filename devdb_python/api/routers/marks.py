# routers/marks.py
# MARKS lot management: sync dates, import unimported lots, promote pre→real.

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from typing import Optional

from api.deps import get_db_conn
from api.db import dict_cursor

router = APIRouter(prefix="/marks", tags=["marks"])

# ─── shared SQL helpers ───────────────────────────────────────────────────────

# Resolves the best date from schedhousedetail per row per activity code.
# Priority: actualfinishdate (if not inactive='Y') → rvearlyfinshdate → earlyfinishdate
_RESOLVE_DATE = """
    CASE
        WHEN s.actualfinishdate IS NOT NULL
             AND (s.inactive IS NULL OR UPPER(s.inactive) != 'Y')
        THEN s.actualfinishdate
        WHEN s.rvearlyfinshdate IS NOT NULL THEN s.rvearlyfinshdate
        ELSE s.earlyfinishdate
    END
"""

# Pivot schedhousedetail to one row per (developmentcode, housenumber) with resolved dates.
_PIVOT_CTE = f"""
    WITH resolved AS (
        SELECT developmentcode, housenumber, activitycode,
               {_RESOLVE_DATE} AS resolved_date
        FROM devdb.schedhousedetail s
    ),
    pivoted AS (
        SELECT developmentcode, housenumber,
            MAX(CASE WHEN activitycode = '135' THEN resolved_date END) AS date_td,
            MAX(CASE WHEN activitycode = '136' THEN resolved_date END) AS date_td_hold,
            MAX(CASE WHEN activitycode = 'A05' THEN resolved_date END) AS date_str,
            MAX(CASE WHEN activitycode = 'F15' THEN resolved_date END) AS date_frm,
            MAX(CASE WHEN activitycode = 'V86' THEN resolved_date END) AS date_cmp,
            MAX(CASE WHEN activitycode = 'V96' THEN resolved_date END) AS date_cls
        FROM resolved
        GROUP BY developmentcode, housenumber
    )
"""

# Join key from sim_lots.lot_number back to (developmentcode, housenumber).
# Handles standard letter-prefix lots (LM00000042 → 'LM', 42).
# Numeric-prefix lots (4300000001) fall through — dev_code = '', housenumber = 4300000001.
_LOT_JOIN = """
    REGEXP_REPLACE(sl.lot_number, '[^A-Za-z]', '', 'g') = p.developmentcode
    AND CAST(REGEXP_REPLACE(sl.lot_number, '[^0-9]', '', 'g') AS BIGINT) = p.housenumber
"""


def _iso(d):
    return d.isoformat() if d else None


# ─── GET /marks/dev-phases ───────────────────────────────────────────────────

@router.get("/dev-phases")
def get_dev_phases(dev_code: str, conn=Depends(get_db_conn)):
    """
    Return instruments and phases for the dev that owns a given MARKS dev_code.
    Used to populate assignment dropdowns in the import panel.
    """
    cur = dict_cursor(conn)
    try:
        # Resolve dev_id via marks_code → dim_development bridge
        cur.execute("""
            SELECT d.dev_id
            FROM devdb.developments d
            WHERE d.marks_code = %s
            LIMIT 1
        """, (dev_code,))
        dev_row = cur.fetchone()
        if not dev_row:
            return {"instruments": [], "phases": []}
        dev_id_modern = dev_row["dev_id"]

        # dim_development.development_id (legacy) needed for instrument FK
        cur.execute("""
            SELECT dd.development_id
            FROM devdb.dim_development dd
            JOIN devdb.developments d ON d.marks_code = dd.dev_code2
            WHERE d.dev_id = %s
            LIMIT 1
        """, (dev_id_modern,))
        dd_row = cur.fetchone()
        if not dd_row:
            return {"instruments": [], "phases": []}
        legacy_dev_id = dd_row["development_id"]

        cur.execute("""
            SELECT instrument_id, instrument_name, instrument_type
            FROM devdb.sim_legal_instruments
            WHERE dev_id = %s
            ORDER BY instrument_name
        """, (legacy_dev_id,))
        instruments = [dict(r) for r in cur.fetchall()]

        instrument_ids = [i["instrument_id"] for i in instruments]
        phases = []
        if instrument_ids:
            cur.execute("""
                SELECT phase_id, phase_name, instrument_id, sequence_number
                FROM devdb.sim_dev_phases
                WHERE instrument_id = ANY(%s)
                ORDER BY instrument_id, sequence_number, phase_name
            """, (instrument_ids,))
            phases = [dict(r) for r in cur.fetchall()]

        return {"instruments": instruments, "phases": phases}
    finally:
        cur.close()


# ─── GET /marks/summary ───────────────────────────────────────────────────────

@router.get("/summary")
def get_marks_summary(conn=Depends(get_db_conn)):
    """
    Per-MARKS-dev-code summary using marks_lot_registry as source of truth.
    Includes P-status lots with no schedhousedetail activity rows.
    """
    cur = dict_cursor(conn)
    try:
        cur.execute(f"""
            {_PIVOT_CTE}
            SELECT
                mlr.developmentcode,
                d.dev_name,
                d.dev_id        AS modern_dev_id,
                COUNT(*)                          AS total_marks,
                COUNT(sl_real.lot_id)             AS imported,
                COUNT(*) - COUNT(sl_real.lot_id)  AS unimported,
                COUNT(sl_pre.lot_id)              AS promotable
            FROM devdb.marks_lot_registry mlr
            LEFT JOIN devdb.developments d ON d.marks_code = mlr.developmentcode
            LEFT JOIN devdb.sim_lots sl_real
                ON sl_real.lot_number = mlr.lot_number
               AND sl_real.lot_source = 'real'
            LEFT JOIN devdb.sim_lots sl_pre
                ON sl_pre.lot_number = mlr.lot_number
               AND sl_pre.lot_source = 'pre'
            GROUP BY mlr.developmentcode, d.dev_name, d.dev_id
            ORDER BY unimported DESC, mlr.developmentcode
        """)
        return [
            {
                "dev_code":      r["developmentcode"],
                "dev_name":      r["dev_name"],
                "modern_dev_id": r["modern_dev_id"],
                "total_marks":   int(r["total_marks"]),
                "imported":      int(r["imported"]),
                "unimported":    int(r["unimported"]),
                "promotable":    int(r["promotable"]),
            }
            for r in cur.fetchall()
        ]
    finally:
        cur.close()


# ─── GET /marks/unimported ────────────────────────────────────────────────────

@router.get("/unimported")
def get_unimported(dev_code: str, conn=Depends(get_db_conn)):
    """
    Lots in marks_lot_registry for a dev code not yet in sim_lots (real or pre).
    Joins schedhousedetail for pipeline dates where available — lots with no
    activity rows appear with all-null dates (true P-status lots).
    """
    cur = dict_cursor(conn)
    try:
        cur.execute(f"""
            {_PIVOT_CTE}
            SELECT mlr.developmentcode, mlr.housenumber, mlr.lot_number, mlr.address1,
                   p.date_td, p.date_td_hold, p.date_str, p.date_frm, p.date_cmp, p.date_cls
            FROM devdb.marks_lot_registry mlr
            LEFT JOIN pivoted p
              ON p.developmentcode = mlr.developmentcode
             AND p.housenumber     = mlr.housenumber
            WHERE mlr.developmentcode = %s
              AND NOT EXISTS (
                  SELECT 1 FROM devdb.sim_lots sl
                  WHERE sl.lot_number = mlr.lot_number
                    AND sl.lot_source IN ('real', 'pre')
              )
            ORDER BY mlr.housenumber
        """, (dev_code,))
        return [
            {
                "dev_code":     r["developmentcode"],
                "housenumber":  r["housenumber"],
                "lot_number":   r["lot_number"],
                "address1":     r["address1"],
                "date_td":      _iso(r["date_td"]),
                "date_td_hold": _iso(r["date_td_hold"]),
                "date_str":     _iso(r["date_str"]),
                "date_frm":     _iso(r["date_frm"]),
                "date_cmp":     _iso(r["date_cmp"]),
                "date_cls":     _iso(r["date_cls"]),
            }
            for r in cur.fetchall()
        ]
    finally:
        cur.close()


# ─── GET /marks/promotable ────────────────────────────────────────────────────

@router.get("/promotable")
def get_promotable(dev_code: Optional[str] = None, conn=Depends(get_db_conn)):
    """
    Pre lots that now have a matching schedhousedetail record.
    Optionally scoped to a single dev_code.
    Returns the pre lot details plus the MARKS dates that would be applied on promotion.
    """
    cur = dict_cursor(conn)
    try:
        where_dev = "AND p.developmentcode = %s" if dev_code else ""
        params = (dev_code,) if dev_code else ()
        cur.execute(f"""
            {_PIVOT_CTE}
            SELECT sl.lot_id, sl.lot_number, sl.phase_id, sl.lot_type_id, sl.dev_id,
                   p.developmentcode, p.housenumber,
                   p.date_td, p.date_td_hold, p.date_str, p.date_frm, p.date_cmp, p.date_cls
            FROM devdb.sim_lots sl
            JOIN pivoted p
              ON REGEXP_REPLACE(sl.lot_number, '[^A-Za-z]', '', 'g') = p.developmentcode
             AND CAST(REGEXP_REPLACE(sl.lot_number, '[^0-9]', '', 'g') AS BIGINT) = p.housenumber
            WHERE sl.lot_source = 'pre'
            {where_dev}
            ORDER BY p.developmentcode, p.housenumber
        """, params)
        return [
            {
                "lot_id":       r["lot_id"],
                "lot_number":   r["lot_number"],
                "phase_id":     r["phase_id"],
                "lot_type_id":  r["lot_type_id"],
                "dev_id":       r["dev_id"],
                "dev_code":     r["developmentcode"],
                "housenumber":  r["housenumber"],
                "date_td":      _iso(r["date_td"]),
                "date_td_hold": _iso(r["date_td_hold"]),
                "date_str":     _iso(r["date_str"]),
                "date_frm":     _iso(r["date_frm"]),
                "date_cmp":     _iso(r["date_cmp"]),
                "date_cls":     _iso(r["date_cls"]),
            }
            for r in cur.fetchall()
        ]
    finally:
        cur.close()


# ─── POST /marks/sync ─────────────────────────────────────────────────────────

class SyncRequest(BaseModel):
    dev_code: Optional[str] = None   # null = sync all devs


@router.post("/sync")
def sync_marks_dates(body: SyncRequest, conn=Depends(get_db_conn)):
    """
    Update pipeline dates on existing lot_source='real' lots from schedhousedetail.
    Respects date_str_source='manual' — never overwrites manually set dates.
    Scoped to a single dev_code, or global if dev_code is null.
    """
    cur = dict_cursor(conn)
    try:
        dev_filter = "AND REGEXP_REPLACE(sl.lot_number, '[^A-Za-z]', '', 'g') = %(dev_code)s" \
                     if body.dev_code else ""
        cur.execute(f"""
            {_PIVOT_CTE}
            UPDATE devdb.sim_lots sl
            SET
                date_td       = CASE WHEN sl.date_td_is_locked      IS TRUE THEN sl.date_td      ELSE p.date_td      END,
                date_td_hold  = CASE WHEN sl.date_td_hold_is_locked IS TRUE THEN sl.date_td_hold ELSE p.date_td_hold END,
                date_str      = CASE WHEN sl.date_str_source = 'manual' THEN sl.date_str ELSE p.date_str END,
                date_frm      = p.date_frm,
                date_cmp      = CASE WHEN sl.date_cmp_source = 'manual' THEN sl.date_cmp ELSE p.date_cmp END,
                date_cls      = CASE WHEN sl.date_cls_source = 'manual' THEN sl.date_cls ELSE p.date_cls END,
                date_str_source = CASE WHEN sl.date_str_source = 'manual' THEN 'manual'
                                       WHEN p.date_str IS NOT NULL         THEN 'marks'
                                       ELSE sl.date_str_source             END,
                date_cmp_source = CASE WHEN sl.date_cmp_source = 'manual' THEN 'manual'
                                       WHEN p.date_cmp IS NOT NULL         THEN 'marks'
                                       ELSE sl.date_cmp_source             END,
                date_cls_source = CASE WHEN sl.date_cls_source = 'manual' THEN 'manual'
                                       WHEN p.date_cls IS NOT NULL         THEN 'marks'
                                       ELSE sl.date_cls_source             END,
                updated_at    = NOW()
            FROM pivoted p
            WHERE {_LOT_JOIN}
              AND sl.lot_source = 'real'
              {dev_filter}
        """, {"dev_code": body.dev_code})
        updated = cur.rowcount
        conn.commit()
        return {"updated": updated, "dev_code": body.dev_code}
    except Exception:
        conn.rollback()
        raise
    finally:
        cur.close()


# ─── POST /marks/import ───────────────────────────────────────────────────────

class ImportLot(BaseModel):
    dev_code: str
    housenumber: int


class ImportRequest(BaseModel):
    lots: list[ImportLot]
    lot_type_id: int
    phase_id: Optional[int] = None
    dev_id: Optional[int] = None    # legacy dim_development.development_id


@router.post("/import", status_code=201)
def import_marks_lots(body: ImportRequest, conn=Depends(get_db_conn)):
    """
    Import selected MARKS lots as lot_source='real'.
    Applies resolved pipeline dates from schedhousedetail.
    lot_number format: {dev_code}{housenumber:08d}
    """
    if not body.lots:
        raise HTTPException(status_code=422, detail="No lots provided")

    cur = dict_cursor(conn)
    try:
        # Build lot_number list for the insert
        pairs = [(lot.dev_code, lot.housenumber) for lot in body.lots]

        # Fetch resolved dates for all requested lots in one query using unnest
        dev_codes   = [lot.dev_code   for lot in body.lots]
        housenumbers = [lot.housenumber for lot in body.lots]
        cur.execute(f"""
            {_PIVOT_CTE}
            SELECT p.developmentcode, p.housenumber,
                   p.date_td, p.date_td_hold, p.date_str, p.date_frm, p.date_cmp, p.date_cls
            FROM pivoted p
            WHERE (p.developmentcode, p.housenumber) IN (
                SELECT * FROM unnest(%s::text[], %s::int[])
            )
        """, (dev_codes, housenumbers))
        dates_by_key = {}
        for r in cur.fetchall():
            dates_by_key[(r["developmentcode"], r["housenumber"])] = r

        # Resolve dev_id: look up from lot's dev_code if not provided
        def get_dev_id(dev_code):
            if body.dev_id:
                return body.dev_id
            cur.execute(
                "SELECT development_id FROM devdb.dim_development WHERE dev_code2 = %s",
                (dev_code,)
            )
            row = cur.fetchone()
            return int(row["development_id"]) if row else None

        inserted = 0
        for lot in body.lots:
            key = (lot.dev_code, lot.housenumber)
            d = dates_by_key.get(key, {})
            lot_number = f"{lot.dev_code}{str(lot.housenumber).zfill(8)}"
            dev_id = get_dev_id(lot.dev_code)

            cur.execute("""
                INSERT INTO devdb.sim_lots
                    (lot_number, lot_source, lot_type_id, phase_id, dev_id,
                     date_td, date_td_hold, date_str, date_frm, date_cmp, date_cls)
                VALUES (%s, 'real', %s, %s, %s, %s, %s, %s, %s, %s, %s)
                ON CONFLICT DO NOTHING
            """, (
                lot_number, body.lot_type_id, body.phase_id, dev_id,
                d.get("date_td"), d.get("date_td_hold"), d.get("date_str"),
                d.get("date_frm"), d.get("date_cmp"), d.get("date_cls"),
            ))
            inserted += cur.rowcount

        conn.commit()
        return {"inserted": inserted}
    except Exception:
        conn.rollback()
        raise
    finally:
        cur.close()


# ─── POST /marks/promote ──────────────────────────────────────────────────────

class PromoteRequest(BaseModel):
    lot_ids: list[int]


@router.post("/promote")
def promote_pre_lots(body: PromoteRequest, conn=Depends(get_db_conn)):
    """
    Promote lot_source='pre' lots to 'real' and apply their matching MARKS dates.
    Respects date_str_source='manual'.
    """
    if not body.lot_ids:
        raise HTTPException(status_code=422, detail="No lot_ids provided")

    cur = dict_cursor(conn)
    try:
        cur.execute(f"""
            {_PIVOT_CTE}
            UPDATE devdb.sim_lots sl
            SET
                lot_source    = 'real',
                date_td       = CASE WHEN sl.date_td_is_locked      IS TRUE THEN sl.date_td      ELSE p.date_td      END,
                date_td_hold  = CASE WHEN sl.date_td_hold_is_locked IS TRUE THEN sl.date_td_hold ELSE p.date_td_hold END,
                date_str      = CASE WHEN sl.date_str_source = 'manual' THEN sl.date_str ELSE p.date_str END,
                date_frm      = p.date_frm,
                date_cmp      = CASE WHEN sl.date_cmp_source = 'manual' THEN sl.date_cmp ELSE p.date_cmp END,
                date_cls      = CASE WHEN sl.date_cls_source = 'manual' THEN sl.date_cls ELSE p.date_cls END,
                updated_at    = NOW()
            FROM pivoted p
            WHERE {_LOT_JOIN}
              AND sl.lot_source = 'pre'
              AND sl.lot_id = ANY(%s)
        """, (body.lot_ids,))
        promoted = cur.rowcount
        conn.commit()
        return {"promoted": promoted}
    except Exception:
        conn.rollback()
        raise
    finally:
        cur.close()
