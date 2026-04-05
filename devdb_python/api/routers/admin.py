# routers/admin.py
# Phase configuration spreadsheet endpoints.

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from typing import Optional

from api.deps import get_db_conn
from api.db import dict_cursor

router = APIRouter(prefix="/admin", tags=["admin"])


@router.get("/phase-config")
def get_phase_config(conn=Depends(get_db_conn)):
    """
    Return all phases with hierarchy, lot counts (per lot-type), splits, and dev params
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
                sli.instrument_id,
                sli.instrument_name,
                sdp.phase_id,
                sdp.phase_name,
                sdp.sequence_number,
                sdp.lot_count_projected,
                sdp.date_dev_projected,
                sdp.date_dev_actual
            FROM sim_entitlement_groups seg
            JOIN sim_ent_group_developments segd ON segd.ent_group_id = seg.ent_group_id
            JOIN sim_legal_instruments sli       ON sli.dev_id = segd.dev_id
            JOIN sim_dev_phases sdp              ON sdp.instrument_id = sli.instrument_id
            JOIN dim_development dd              ON dd.development_id = segd.dev_id
            JOIN developments d                  ON d.marks_code = dd.dev_code2
            ORDER BY seg.ent_group_name, d.dev_name, sli.instrument_name, sdp.sequence_number
        """)
        phases = cur.fetchall()
        phase_ids = [r['phase_id'] for r in phases]

        # Lot counts by (phase_id, lot_type_id) — real and sim separately
        lot_count_map = {}   # phase_id -> {lot_type_id: {real: N, sim: N}}
        if phase_ids:
            cur.execute("""
                SELECT phase_id, lot_type_id,
                    COUNT(*) FILTER (WHERE lot_source = 'real') AS real_count,
                    COUNT(*) FILTER (WHERE lot_source = 'sim')  AS sim_count
                FROM sim_lots
                WHERE phase_id = ANY(%s)
                GROUP BY phase_id, lot_type_id
            """, (phase_ids,))
            for r in cur.fetchall():
                lot_count_map.setdefault(r['phase_id'], {})[r['lot_type_id']] = {
                    'real': r['real_count'],
                    'sim':  r['sim_count'],
                }

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
            lc  = lot_count_map.get(pid, {})
            rows.append({
                'ent_group_id':        p['ent_group_id'],
                'ent_group_name':      p['ent_group_name'],
                'is_test':             p['is_test'],
                'dev_id':              p['dev_id'],
                'dev_name':            p['dev_name'],
                'instrument_id':       p['instrument_id'],
                'instrument_name':     p['instrument_name'],
                'phase_id':            pid,
                'phase_name':          p['phase_name'],
                'sequence_number':     p['sequence_number'],
                'lot_count_projected': p['lot_count_projected'],
                'date_dev_projected':  p['date_dev_projected'].isoformat() if p['date_dev_projected'] else None,
                'date_dev_actual':     p['date_dev_actual'].isoformat()    if p['date_dev_actual']    else None,
                'lot_type_counts':     lc,          # {lot_type_id: {real, sim}}
                'product_splits':      prod_map.get(pid, {}),
                'builder_splits':      bldr_map.get(pid, {}),
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
        return {'phase_id': phase_id}

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
            raise HTTPException(status_code=404, detail='Phase not found')
        conn.commit()
        return {
            'phase_id':            row['phase_id'],
            'lot_count_projected': row['lot_count_projected'],
            'date_dev_projected':  row['date_dev_projected'].isoformat() if row['date_dev_projected'] else None,
            'date_dev_actual':     row['date_dev_actual'].isoformat()    if row['date_dev_actual']    else None,
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
        raise HTTPException(status_code=422, detail='share must be 0–100')
    cur = dict_cursor(conn)
    try:
        if body.share is None:
            cur.execute(
                'DELETE FROM sim_phase_builder_splits WHERE phase_id = %s AND builder_id = %s',
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
