# routers/overrides.py
# Production planning: lot date overrides for what-if simulation testing.
# Overrides win over MARKS actual dates in the engine. sim_lots stays as MARKS truth.

from datetime import date, timedelta
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel

from api.deps import get_db_conn
from api.db import dict_cursor

router = APIRouter(prefix="/overrides", tags=["overrides"])

# Pipeline order — downstream cascade direction
_PIPELINE = ['date_td_hold', 'date_td', 'date_str', 'date_frm', 'date_cmp', 'date_cls']

# Default lags (days) for P lots with no existing downstream dates (mirrors s0300)
_DEFAULT_LAGS = {
    ('date_td_hold', 'date_td'):   0,    # hold and takedown typically same day
    ('date_td',      'date_str'):  45,
    ('date_str',     'date_frm'):  30,
    ('date_str',     'date_cmp'):  270,
    ('date_frm',     'date_cmp'):  240,
    ('date_cmp',     'date_cls'):  45,
}

_LABEL = {
    'date_td_hold': 'HC',
    'date_td':      'BLDR',
    'date_str':     'DIG',
    'date_frm':     'FRM',
    'date_cmp':     'CMP',
    'date_cls':     'CLS',
}

def _iso(d):
    return d.isoformat() if d else None


def _downstream(field: str) -> list[str]:
    """Return all fields downstream of field in pipeline order."""
    idx = _PIPELINE.index(field)
    return _PIPELINE[idx + 1:]


def _load_effective_dates(cur, lot_id: int) -> dict:
    """Load current effective dates for a lot: COALESCE(override, marks)."""
    cur.execute("""
        SELECT
            sl.date_td_hold, sl.date_td, sl.date_str, sl.date_frm, sl.date_cmp, sl.date_cls,
            MAX(CASE WHEN o.date_field = 'date_td_hold' THEN o.override_value END) AS ov_date_td_hold,
            MAX(CASE WHEN o.date_field = 'date_td'      THEN o.override_value END) AS ov_date_td,
            MAX(CASE WHEN o.date_field = 'date_str'     THEN o.override_value END) AS ov_date_str,
            MAX(CASE WHEN o.date_field = 'date_frm'     THEN o.override_value END) AS ov_date_frm,
            MAX(CASE WHEN o.date_field = 'date_cmp'     THEN o.override_value END) AS ov_date_cmp,
            MAX(CASE WHEN o.date_field = 'date_cls'     THEN o.override_value END) AS ov_date_cls
        FROM devdb.sim_lots sl
        LEFT JOIN devdb.sim_lot_date_overrides o ON o.lot_id = sl.lot_id
        WHERE sl.lot_id = %s
        GROUP BY sl.lot_id, sl.date_td_hold, sl.date_td, sl.date_str,
                 sl.date_frm, sl.date_cmp, sl.date_cls
    """, (lot_id,))
    row = cur.fetchone()
    if not row:
        raise HTTPException(status_code=404, detail=f"Lot {lot_id} not found.")
    result = {}
    for f in _PIPELINE:
        ov = row[f"ov_{f}"]
        mk = row[f]
        result[f] = ov if ov is not None else mk   # effective = override ?? marks
        result[f"_marks_{f}"] = mk
        result[f"_override_{f}"] = ov
    return result


def _compute_cascade(effective: dict, field: str, new_value: date) -> list[dict]:
    """
    Compute cascade changes for all downstream fields.
    Returns list of {date_field, current_value, proposed_value, delta_days, source}.
    """
    current = effective[field]
    delta = (new_value - current).days if current else None

    changes = []
    prev_proposed = new_value

    for downstream in _downstream(field):
        cur_eff = effective[downstream]
        marks_val = effective[f"_marks_{downstream}"]

        if cur_eff and delta is not None:
            # Shift existing effective date by same delta
            proposed = cur_eff + timedelta(days=delta)
            source = 'shifted'
        else:
            # No existing date — use lag from previous proposed date
            # Find the lag from the previous field in the pipeline
            prev_field = _PIPELINE[_PIPELINE.index(downstream) - 1]
            lag = _DEFAULT_LAGS.get((prev_field, downstream), 0)
            proposed = prev_proposed + timedelta(days=lag)
            source = 'lag_default'

        changes.append({
            'date_field':     downstream,
            'label':          _LABEL[downstream],
            'current_value':  _iso(cur_eff),
            'marks_value':    _iso(marks_val),
            'proposed_value': _iso(proposed),
            'delta_days':     delta if source == 'shifted' else None,
            'source':         source,
        })
        prev_proposed = proposed

    return changes


# ─── POST /overrides/preview ──────────────────────────────────────────────────

class PreviewRequest(BaseModel):
    lot_id: int
    date_field: str
    override_value: date


@router.post("/preview")
def preview_override(body: PreviewRequest, conn=Depends(get_db_conn)):
    """Compute cascade preview without saving. Returns proposed changes for all downstream dates."""
    if body.date_field not in _PIPELINE:
        raise HTTPException(status_code=422, detail=f"Unknown date_field: {body.date_field}")
    cur = dict_cursor(conn)
    try:
        effective = _load_effective_dates(cur, body.lot_id)
        cascade = _compute_cascade(effective, body.date_field, body.override_value)
        current_val = effective[body.date_field]
        marks_val = effective[f"_marks_{body.date_field}"]
        return {
            'lot_id':       body.lot_id,
            'date_field':   body.date_field,
            'label':        _LABEL[body.date_field],
            'current_value': _iso(current_val),
            'marks_value':   _iso(marks_val),
            'override_value': _iso(body.override_value),
            'delta_days':    (body.override_value - current_val).days if current_val else None,
            'cascade':       cascade,
        }
    finally:
        cur.close()


# ─── POST /overrides/apply ────────────────────────────────────────────────────

class OverrideChange(BaseModel):
    date_field: str
    override_value: date
    note: Optional[str] = None
    created_by: Optional[str] = 'user'


class ApplyRequest(BaseModel):
    lot_id: int
    changes: list[OverrideChange]


@router.post("/apply")
def apply_overrides(body: ApplyRequest, conn=Depends(get_db_conn)):
    """Upsert override rows for a lot. Snapshots current MARKS date as marks_value."""
    if not body.changes:
        raise HTTPException(status_code=422, detail="No changes provided.")
    cur = dict_cursor(conn)
    try:
        # Load current MARKS dates for snapshot
        cur.execute(
            "SELECT date_td_hold, date_td, date_str, date_frm, date_cmp, date_cls "
            "FROM devdb.sim_lots WHERE lot_id = %s",
            (body.lot_id,)
        )
        lot = cur.fetchone()
        if not lot:
            raise HTTPException(status_code=404, detail=f"Lot {body.lot_id} not found.")

        applied = 0
        for ch in body.changes:
            if ch.date_field not in _PIPELINE:
                continue
            marks_val = lot[ch.date_field]
            cur.execute("""
                INSERT INTO devdb.sim_lot_date_overrides
                    (lot_id, date_field, override_value, marks_value, override_note, created_by, updated_at)
                VALUES (%s, %s, %s, %s, %s, %s, NOW())
                ON CONFLICT (lot_id, date_field) DO UPDATE
                    SET override_value = EXCLUDED.override_value,
                        marks_value    = EXCLUDED.marks_value,
                        override_note  = EXCLUDED.override_note,
                        created_by     = EXCLUDED.created_by,
                        updated_at     = NOW()
            """, (body.lot_id, ch.date_field, ch.override_value, marks_val,
                  ch.note, ch.created_by or 'user'))
            applied += cur.rowcount

        conn.commit()
        return {"applied": applied, "lot_id": body.lot_id}
    except HTTPException:
        conn.rollback()
        raise
    except Exception:
        conn.rollback()
        raise
    finally:
        cur.close()


# ─── DELETE /overrides/{lot_id}/{date_field} ──────────────────────────────────

@router.delete("/{lot_id}/{date_field}")
def clear_override(lot_id: int, date_field: str, conn=Depends(get_db_conn)):
    """Clear a single override for one lot + date field."""
    cur = dict_cursor(conn)
    try:
        cur.execute(
            "DELETE FROM devdb.sim_lot_date_overrides WHERE lot_id = %s AND date_field = %s",
            (lot_id, date_field)
        )
        deleted = cur.rowcount
        conn.commit()
        return {"deleted": deleted, "lot_id": lot_id, "date_field": date_field}
    except Exception:
        conn.rollback()
        raise
    finally:
        cur.close()


# ─── POST /overrides/clear-batch ─────────────────────────────────────────────

class ClearBatchRequest(BaseModel):
    override_ids: Optional[list[int]] = None
    lot_ids: Optional[list[int]] = None


@router.post("/clear-batch")
def clear_batch(body: ClearBatchRequest, conn=Depends(get_db_conn)):
    """Clear overrides by override_id list or lot_id list."""
    cur = dict_cursor(conn)
    try:
        deleted = 0
        if body.override_ids:
            cur.execute(
                "DELETE FROM devdb.sim_lot_date_overrides WHERE override_id = ANY(%s)",
                (body.override_ids,)
            )
            deleted += cur.rowcount
        if body.lot_ids:
            cur.execute(
                "DELETE FROM devdb.sim_lot_date_overrides WHERE lot_id = ANY(%s)",
                (body.lot_ids,)
            )
            deleted += cur.rowcount
        conn.commit()
        return {"deleted": deleted}
    except Exception:
        conn.rollback()
        raise
    finally:
        cur.close()


# ─── GET /overrides ───────────────────────────────────────────────────────────

@router.get("")
def list_overrides(
    ent_group_id: Optional[int] = Query(None),
    dev_id: Optional[int] = Query(None),
    conn=Depends(get_db_conn),
):
    """List all active overrides, optionally scoped to an ent_group or dev."""
    cur = dict_cursor(conn)
    try:
        where_parts = []
        params = []
        if ent_group_id:
            where_parts.append("""
                sl.dev_id IN (
                    SELECT dev_id FROM devdb.sim_ent_group_developments
                    WHERE ent_group_id = %s
                )
            """)
            params.append(ent_group_id)
        if dev_id:
            where_parts.append("sl.dev_id = %s")
            params.append(dev_id)
        where_sql = ("WHERE " + " AND ".join(where_parts)) if where_parts else ""

        cur.execute(f"""
            SELECT
                o.override_id,
                o.lot_id,
                sl.lot_number,
                sl.dev_id,
                d.dev_name,
                sdp.phase_name,
                o.date_field,
                o.override_value,
                o.marks_value,
                sl.date_td_hold AS cur_date_td_hold,
                sl.date_td      AS cur_date_td,
                sl.date_str     AS cur_date_str,
                sl.date_frm     AS cur_date_frm,
                sl.date_cmp     AS cur_date_cmp,
                sl.date_cls     AS cur_date_cls,
                o.override_note,
                o.created_by,
                o.created_at,
                o.updated_at
            FROM devdb.sim_lot_date_overrides o
            JOIN devdb.sim_lots sl ON sl.lot_id = o.lot_id
            LEFT JOIN devdb.sim_dev_phases sdp ON sdp.phase_id = sl.phase_id
            LEFT JOIN devdb.developments d ON d.dev_id = sl.dev_id
            {where_sql}
            ORDER BY d.dev_name, sl.lot_number, o.date_field
        """, params)

        rows = cur.fetchall()
        return [
            {
                "override_id":   r["override_id"],
                "lot_id":        r["lot_id"],
                "lot_number":    r["lot_number"],
                "dev_id":        r["dev_id"],
                "dev_name":      r["dev_name"],
                "phase_name":    r["phase_name"],
                "date_field":    r["date_field"],
                "label":         _LABEL.get(r["date_field"], r["date_field"]),
                "override_value": _iso(r["override_value"]),
                "marks_value":   _iso(r["marks_value"]),
                "current_marks": _iso(r[f"cur_{r['date_field']}"]),
                "override_note": r["override_note"],
                "created_by":    r["created_by"],
                "created_at":    r["created_at"].isoformat() if r["created_at"] else None,
                "updated_at":    r["updated_at"].isoformat() if r["updated_at"] else None,
            }
            for r in rows
        ]
    finally:
        cur.close()


# ─── GET /overrides/reconciliation ───────────────────────────────────────────

@router.get("/reconciliation")
def reconciliation(
    ent_group_id: int = Query(...),
    n_days: int = Query(7),
    conn=Depends(get_db_conn),
):
    """
    After a sync, find overrides where the current MARKS date is within n_days
    of the override value. These are candidates for clearing.
    """
    cur = dict_cursor(conn)
    try:
        cur.execute("""
            SELECT
                o.override_id,
                o.lot_id,
                sl.lot_number,
                d.dev_name,
                sdp.phase_name,
                o.date_field,
                o.override_value,
                o.marks_value,
                o.override_note,
                CASE o.date_field
                    WHEN 'date_td_hold' THEN sl.date_td_hold
                    WHEN 'date_td'      THEN sl.date_td
                    WHEN 'date_str'     THEN sl.date_str
                    WHEN 'date_frm'     THEN sl.date_frm
                    WHEN 'date_cmp'     THEN sl.date_cmp
                    WHEN 'date_cls'     THEN sl.date_cls
                END AS current_marks,
                ABS(
                    CASE o.date_field
                        WHEN 'date_td_hold' THEN sl.date_td_hold
                        WHEN 'date_td'      THEN sl.date_td
                        WHEN 'date_str'     THEN sl.date_str
                        WHEN 'date_frm'     THEN sl.date_frm
                        WHEN 'date_cmp'     THEN sl.date_cmp
                        WHEN 'date_cls'     THEN sl.date_cls
                    END - o.override_value
                ) AS delta_days
            FROM devdb.sim_lot_date_overrides o
            JOIN devdb.sim_lots sl ON sl.lot_id = o.lot_id
            LEFT JOIN devdb.sim_dev_phases sdp ON sdp.phase_id = sl.phase_id
            LEFT JOIN devdb.developments d ON d.dev_id = sl.dev_id
            WHERE sl.dev_id IN (
                SELECT dev_id FROM devdb.sim_ent_group_developments
                WHERE ent_group_id = %s
            )
            AND CASE o.date_field
                WHEN 'date_td_hold' THEN sl.date_td_hold
                WHEN 'date_td'      THEN sl.date_td
                WHEN 'date_str'     THEN sl.date_str
                WHEN 'date_frm'     THEN sl.date_frm
                WHEN 'date_cmp'     THEN sl.date_cmp
                WHEN 'date_cls'     THEN sl.date_cls
            END IS NOT NULL
            AND ABS(
                CASE o.date_field
                    WHEN 'date_td_hold' THEN sl.date_td_hold
                    WHEN 'date_td'      THEN sl.date_td
                    WHEN 'date_str'     THEN sl.date_str
                    WHEN 'date_frm'     THEN sl.date_frm
                    WHEN 'date_cmp'     THEN sl.date_cmp
                    WHEN 'date_cls'     THEN sl.date_cls
                END - o.override_value
            ) <= %s
            ORDER BY delta_days, d.dev_name, sl.lot_number
        """, (ent_group_id, n_days))

        rows = cur.fetchall()
        return [
            {
                "override_id":    r["override_id"],
                "lot_id":         r["lot_id"],
                "lot_number":     r["lot_number"],
                "dev_name":       r["dev_name"],
                "phase_name":     r["phase_name"],
                "date_field":     r["date_field"],
                "label":          _LABEL.get(r["date_field"], r["date_field"]),
                "override_value": _iso(r["override_value"]),
                "current_marks":  _iso(r["current_marks"]),
                "delta_days":     int(r["delta_days"]) if r["delta_days"] is not None else None,
                "override_note":  r["override_note"],
            }
            for r in rows
        ]
    finally:
        cur.close()


# ─── GET /overrides/export ────────────────────────────────────────────────────

@router.get("/export")
def export_overrides(ent_group_id: int = Query(...), conn=Depends(get_db_conn)):
    """
    Export all active overrides as a structured delta list for ITK/scheduler input.
    Shows: lot, field, current MARKS value, override value, delta days, note.
    """
    cur = dict_cursor(conn)
    try:
        cur.execute("""
            SELECT
                sl.lot_number,
                d.dev_name,
                sdp.phase_name,
                o.date_field,
                o.override_value,
                o.marks_value,
                CASE o.date_field
                    WHEN 'date_td_hold' THEN sl.date_td_hold
                    WHEN 'date_td'      THEN sl.date_td
                    WHEN 'date_str'     THEN sl.date_str
                    WHEN 'date_frm'     THEN sl.date_frm
                    WHEN 'date_cmp'     THEN sl.date_cmp
                    WHEN 'date_cls'     THEN sl.date_cls
                END AS current_marks,
                o.override_note,
                o.created_by,
                o.updated_at
            FROM devdb.sim_lot_date_overrides o
            JOIN devdb.sim_lots sl ON sl.lot_id = o.lot_id
            LEFT JOIN devdb.sim_dev_phases sdp ON sdp.phase_id = sl.phase_id
            LEFT JOIN devdb.developments d ON d.dev_id = sl.dev_id
            WHERE sl.dev_id IN (
                SELECT dev_id FROM devdb.sim_ent_group_developments
                WHERE ent_group_id = %s
            )
            ORDER BY d.dev_name, sl.lot_number,
                ARRAY_POSITION(ARRAY['date_td_hold','date_td','date_str','date_frm','date_cmp','date_cls'], o.date_field)
        """, (ent_group_id,))

        rows = cur.fetchall()
        return [
            {
                "lot_number":     r["lot_number"],
                "dev_name":       r["dev_name"],
                "phase_name":     r["phase_name"],
                "date_field":     r["date_field"],
                "label":          _LABEL.get(r["date_field"], r["date_field"]),
                "marks_activity": {"date_td_hold":"136","date_td":"135","date_str":"A05",
                                   "date_frm":"F15","date_cmp":"V86","date_cls":"V96"}.get(r["date_field"]),
                "current_marks":  _iso(r["current_marks"]),
                "override_value": _iso(r["override_value"]),
                "delta_days":     (r["override_value"] - r["current_marks"]).days
                                  if r["override_value"] and r["current_marks"] else None,
                "override_note":  r["override_note"],
                "created_by":     r["created_by"],
                "updated_at":     r["updated_at"].isoformat() if r["updated_at"] else None,
            }
            for r in rows
        ]
    finally:
        cur.close()
