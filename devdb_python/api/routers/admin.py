# routers/admin.py
# Phase configuration spreadsheet endpoints.
# Provides a single GET that returns all hierarchy + splits + params for the config grid,
# plus targeted PATCH/PUT endpoints for each editable cell type.

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from typing import Optional

from api.deps import get_db_conn
from api.db import dict_cursor

router = APIRouter(prefix="/admin", tags=["admin"])


# ─── GET ─────────────────────────────────────────────────────────────────────

@router.get("/phase-config")
def get_phase_config(conn=Depends(get_db_conn)):
    """
    Return all phases with hierarchy, lot counts, splits, and dev params
    for the phase configuration spreadsheet.
    """
    cur = dict_cursor(conn)
    try:
        # Active lot types (subtypes only: id 100-199)
        cur.execute("""
            SELECT lot_type_id, lot_type_short, lot_type_name
            FROM ref_lot_types
            WHERE active = true AND lot_type_id >= 100 AND lot_type_id < 200
            ORDER BY lot_type_id
        """)
        lot_types = [dict(r) for r in cur.fetchall()]

        # Active builders
        cur.execute("""
            SELECT builder_id, builder_name
            FROM dim_builders
            WHERE active = true
            ORDER BY builder_id
        """)
        builders = [dict(r) for r in cur.fetchall()]

        # Phase rows with full hierarchy
        cur.execute("""
            SELECT
                seg.ent_group_id,
                seg.ent_group_name,
                seg.is_test,
                segd.dev_id,
                d.dev_name,
                sdp.phase_id,
                sdp.phase_name,
                sdp.sequence_number,
                sdp.lot_count_projected,
                sdp.date_dev_projected,
                sdp.date_dev_actual,
                sp.annual_starts_target,
                sp.max_starts_per_month,
                CASE
                    WHEN sp.dev_id IS NULL THEN 'missing'
                    WHEN sp.updated_at < NOW() - INTERVAL '180 days' THEN 'stale'
                    ELSE 'ok'
                END AS params_status,
                COALESCE(lc.real_count,  0) AS real_count,
                COALESCE(lc.sim_count,   0) AS sim_count,
                COALESCE(lc.total_count, 0) AS lot_total
            FROM sim_entitlement_groups seg
            JOIN sim_ent_group_developments segd ON segd.ent_group_id = seg.ent_group_id
            JOIN sim_legal_instruments sli       ON sli.dev_id = segd.dev_id
            JOIN sim_dev_phases sdp              ON sdp.instrument_id = sli.instrument_id
            JOIN dim_development dd              ON dd.development_id = segd.dev_id
            JOIN developments d                  ON d.marks_code = dd.dev_code2
            LEFT JOIN sim_dev_params sp          ON sp.dev_id = segd.dev_id
            LEFT JOIN (
                SELECT phase_id,
                    COUNT(*) FILTER (WHERE lot_source = 'real') AS real_count,
                    COUNT(*) FILTER (WHERE lot_source = 'sim')  AS sim_count,
                    COUNT(*)                                     AS total_count
                FROM sim_lots
                GROUP BY phase_id
            ) lc ON lc.phase_id = sdp.phase_id
            ORDER BY seg.ent_group_name, d.dev_name, sdp.sequence_number
        """)
        phases = cur.fetchall()
        phase_ids = [r['phase_id'] for r in phases]

        # Product splits: phase_id -> {lot_type_id: projected_count}
        prod_map = {}
        if phase_ids:
            cur.execute("""
                SELECT phase_id, lot_type_id, projected_count
                FROM sim_phase_product_splits
                WHERE phase_id = ANY(%s)
            """, (phase_ids,))
            for r in cur.fetchall():
                prod_map.setdefault(r['phase_id'], {})[r['lot_type_id']] = r['projected_count']

        # Builder splits: phase_id -> {builder_id: share}
        bldr_map = {}
        if phase_ids:
            cur.execute("""
                SELECT phase_id, builder_id, share
                FROM sim_phase_builder_splits
                WHERE phase_id = ANY(%s)
            """, (phase_ids,))
            for r in cur.fetchall():
                bldr_map.setdefault(r['phase_id'], {})[r['builder_id']] = (
                    float(r['share']) if r['share'] is not None else None
                )

        rows = []
        for p in phases:
            pid = p['phase_id']
            rows.append({
                'ent_group_id':         p['ent_group_id'],
                'ent_group_name':       p['ent_group_name'],
                'is_test':              p['is_test'],
                'dev_id':               p['dev_id'],
                'dev_name':             p['dev_name'],
                'phase_id':             pid,
                'phase_name':           p['phase_name'],
                'sequence_number':      p['sequence_number'],
                'lot_count_projected':  p['lot_count_projected'],
                'date_dev_projected':   p['date_dev_projected'].isoformat()  if p['date_dev_projected']  else None,
                'date_dev_actual':      p['date_dev_actual'].isoformat()     if p['date_dev_actual']     else None,
                'annual_starts_target': p['annual_starts_target'],
                'max_starts_per_month': p['max_starts_per_month'],
                'params_status':        p['params_status'],
                'real_count':           p['real_count'],
                'sim_count':            p['sim_count'],
                'lot_total':            p['lot_total'],
                'product_splits':       prod_map.get(pid, {}),
                'builder_splits':       bldr_map.get(pid, {}),
            })

        return {'lot_types': lot_types, 'builders': builders, 'rows': rows}
    finally:
        cur.close()


# ─── Phase fields ─────────────────────────────────────────────────────────────

class PhasePatchRequest(BaseModel):
    lot_count_projected: Optional[int] = None
    date_dev_projected:  Optional[str] = None
    date_dev_actual:     Optional[str] = None


@router.patch("/phase/{phase_id}")
def patch_phase(phase_id: int, body: PhasePatchRequest, conn=Depends(get_db_conn)):
    """Partially update phase fields. Fields absent from request are untouched.
    Passing null for a date field explicitly clears it (date_dev_actual null = unlock)."""
    provided = body.model_fields_set
    if not provided:
        return {"phase_id": phase_id}

    clauses, params = [], []
    if 'lot_count_projected' in provided:
        clauses.append("lot_count_projected = %s")
        params.append(body.lot_count_projected)
    if 'date_dev_projected' in provided:
        clauses.append("date_dev_projected = %s::date")
        params.append(body.date_dev_projected)
    if 'date_dev_actual' in provided:
        clauses.append("date_dev_actual = %s::date")
        params.append(body.date_dev_actual)

    params.append(phase_id)
    cur = dict_cursor(conn)
    try:
        cur.execute(
            f"UPDATE sim_dev_phases SET {', '.join(clauses)} "
            f"WHERE phase_id = %s "
            f"RETURNING phase_id, lot_count_projected, date_dev_projected, date_dev_actual",
            params,
        )
        row = cur.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Phase not found")
        conn.commit()
        return {
            'phase_id':             row['phase_id'],
            'lot_count_projected':  row['lot_count_projected'],
            'date_dev_projected':   row['date_dev_projected'].isoformat()  if row['date_dev_projected']  else None,
            'date_dev_actual':      row['date_dev_actual'].isoformat()     if row['date_dev_actual']     else None,
        }
    finally:
        cur.close()


# ─── Product splits ───────────────────────────────────────────────────────────

class ProductSplitRequest(BaseModel):
    projected_count: int


@router.put("/product-split/{phase_id}/{lot_type_id}")
def upsert_product_split(
    phase_id: int, lot_type_id: int, body: ProductSplitRequest, conn=Depends(get_db_conn)
):
    cur = dict_cursor(conn)
    try:
        cur.execute(
            """
            INSERT INTO sim_phase_product_splits (phase_id, lot_type_id, projected_count)
            VALUES (%s, %s, %s)
            ON CONFLICT (phase_id, lot_type_id) DO UPDATE
                SET projected_count = EXCLUDED.projected_count
            RETURNING phase_id, lot_type_id, projected_count
            """,
            (phase_id, lot_type_id, body.projected_count),
        )
        conn.commit()
        return dict(cur.fetchone())
    finally:
        cur.close()


# ─── Builder splits ───────────────────────────────────────────────────────────

class BuilderSplitRequest(BaseModel):
    share: Optional[float]   # 0–100; null = clear this builder from the phase


@router.put("/builder-split/{phase_id}/{builder_id}")
def upsert_builder_split(
    phase_id: int, builder_id: int, body: BuilderSplitRequest, conn=Depends(get_db_conn)
):
    if body.share is not None and not (0 <= body.share <= 100):
        raise HTTPException(status_code=422, detail="share must be 0–100")
    cur = dict_cursor(conn)
    try:
        if body.share is None:
            cur.execute(
                "DELETE FROM sim_phase_builder_splits WHERE phase_id = %s AND builder_id = %s",
                (phase_id, builder_id),
            )
        else:
            cur.execute(
                """
                INSERT INTO sim_phase_builder_splits (phase_id, builder_id, share)
                VALUES (%s, %s, %s)
                ON CONFLICT (phase_id, builder_id) DO UPDATE SET share = EXCLUDED.share
                """,
                (phase_id, builder_id, body.share),
            )
        conn.commit()
        return {'phase_id': phase_id, 'builder_id': builder_id, 'share': body.share}
    finally:
        cur.close()


# ─── Dev params ───────────────────────────────────────────────────────────────

class DevParamsRequest(BaseModel):
    annual_starts_target: Optional[int]
    max_starts_per_month: Optional[int]


@router.put("/dev-params/{dev_id}")
def upsert_dev_params(dev_id: int, body: DevParamsRequest, conn=Depends(get_db_conn)):
    cur = dict_cursor(conn)
    try:
        cur.execute(
            """
            INSERT INTO sim_dev_params (dev_id, annual_starts_target, max_starts_per_month, updated_at)
            VALUES (%s, %s, %s, NOW())
            ON CONFLICT (dev_id) DO UPDATE
                SET annual_starts_target = COALESCE(EXCLUDED.annual_starts_target, sim_dev_params.annual_starts_target),
                    max_starts_per_month = EXCLUDED.max_starts_per_month,
                    updated_at           = NOW()
            RETURNING dev_id, annual_starts_target, max_starts_per_month
            """,
            (dev_id, body.annual_starts_target, body.max_starts_per_month),
        )
        conn.commit()
        return dict(cur.fetchone())
    finally:
        cur.close()
