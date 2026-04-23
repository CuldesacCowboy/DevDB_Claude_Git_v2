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
                seg.county_id           AS community_county_id,
                seg.school_district_id  AS community_sd_id,
                comm_c.county_name      AS community_county_name,
                comm_sd.district_name   AS community_sd_name,
                segd.dev_id,
                d.dev_name,
                sli.instrument_id,
                sli.instrument_name,
                sli.spec_rate,
                sdp.phase_id,
                sdp.phase_name,
                sdp.sequence_number,
                sdp.lot_count_projected,
                sdp.date_dev_projected,
                sdp.date_dev_actual,
                sdp.delivery_tier,
                sdp.delivery_group,
                sdp.updated_at,
                sdp.county_id           AS phase_county_id,
                sdp.school_district_id  AS phase_sd_id,
                ph_c.county_name        AS phase_county_name,
                ph_sd.district_name     AS phase_sd_name
            FROM sim_entitlement_groups seg
            JOIN sim_ent_group_developments segd ON segd.ent_group_id = seg.ent_group_id
            JOIN developments d                  ON d.dev_id = segd.dev_id
            JOIN sim_legal_instruments sli       ON sli.dev_id = d.dev_id
            JOIN sim_dev_phases sdp              ON sdp.instrument_id = sli.instrument_id
            LEFT JOIN devdb.ref_counties comm_c     ON comm_c.county_id = seg.county_id
            LEFT JOIN devdb.ref_school_districts comm_sd ON comm_sd.sd_id = seg.school_district_id
            LEFT JOIN devdb.ref_counties ph_c       ON ph_c.county_id = sdp.county_id
            LEFT JOIN devdb.ref_school_districts ph_sd   ON ph_sd.sd_id = sdp.school_district_id
            ORDER BY seg.ent_group_name, d.dev_name, sli.instrument_name, sdp.sequence_number
        """)
        phases = cur.fetchall()
        phase_ids = [r['phase_id'] for r in phases]
        dev_ids = list({r['dev_id'] for r in phases})

        # Lot counts by (phase_id, lot_type_id) — marks/pre/sim separately.
        # "marks" = lot_source='real' WITH a marks_lot_registry entry (actively in MARKS).
        # "pre"   = lot_source='pre' OR lot_source='real' with no registry entry (orphaned).
        lot_count_map = {}   # phase_id -> {lot_type_id: {marks: N, pre: N, sim: N}}
        if phase_ids:
            cur.execute("""
                SELECT phase_id, lot_type_id,
                    COUNT(*) FILTER (
                        WHERE lot_source = 'real' AND excluded IS NOT TRUE
                          AND EXISTS (SELECT 1 FROM devdb.marks_lot_registry mlr
                                      WHERE mlr.lot_number = sl.lot_number)
                    ) AS marks_count,
                    COUNT(*) FILTER (
                        WHERE excluded IS NOT TRUE
                          AND (lot_source = 'pre'
                               OR (lot_source = 'real'
                                   AND NOT EXISTS (SELECT 1 FROM devdb.marks_lot_registry mlr
                                                   WHERE mlr.lot_number = sl.lot_number)))
                    ) AS pre_count,
                    COUNT(*) FILTER (WHERE lot_source = 'sim' AND excluded IS NOT TRUE) AS sim_count,
                    COUNT(*) FILTER (WHERE excluded IS TRUE AND lot_source != 'sim') AS excl_count
                FROM sim_lots sl
                WHERE phase_id = ANY(%s)
                GROUP BY phase_id, lot_type_id
            """, (phase_ids,))
            for r in cur.fetchall():
                lot_count_map.setdefault(r['phase_id'], {})[r['lot_type_id']] = {
                    'marks': r['marks_count'],
                    'pre':   r['pre_count'],
                    'sim':   r['sim_count'],
                    'excl':  r['excl_count'],
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

        # Dev params: annual_starts_target per dev_id
        dev_params_map = {}  # dev_id -> annual_starts_target (float or None)
        if dev_ids:
            cur.execute("""
                SELECT dev_id, annual_starts_target
                FROM sim_dev_params
                WHERE dev_id = ANY(%s)
            """, (dev_ids,))
            for r in cur.fetchall():
                dev_params_map[r['dev_id']] = (
                    float(r['annual_starts_target']) if r['annual_starts_target'] is not None else None
                )

        # Unique devs per community (populated while assembling phases below)
        dev_comm_map = {}  # ent_group_id -> {dev_id -> {dev_id, dev_name, annual_starts_target}}

        # Builder splits (configured): instrument_id -> {builder_id: share}
        # Expanded to phase rows via instrument_id on each phase.
        instrument_ids = list({r['instrument_id'] for r in phases})
        bldr_map = {}  # instrument_id -> {builder_id: share}
        if instrument_ids:
            cur.execute("""
                SELECT instrument_id, builder_id, share
                FROM sim_instrument_builder_splits
                WHERE instrument_id = ANY(%s)
            """, (instrument_ids,))
            for r in cur.fetchall():
                bldr_map.setdefault(r['instrument_id'], {})[r['builder_id']] = (
                    float(r['share']) if r['share'] is not None else None
                )

        # Actual builder counts per phase: use effective builder (override > marks > null)
        # Only real/pre lots, non-excluded. Null effective builder counted separately.
        actual_bldr_map = {}   # phase_id -> {builder_id_or_None: count}
        if phase_ids:
            cur.execute("""
                SELECT
                    phase_id,
                    COALESCE(builder_id_override, builder_id) AS eff_builder_id,
                    COUNT(*) AS cnt
                FROM sim_lots
                WHERE phase_id = ANY(%s)
                  AND lot_source IN ('real', 'pre')
                  AND excluded IS NOT TRUE
                GROUP BY phase_id, COALESCE(builder_id_override, builder_id)
            """, (phase_ids,))
            for r in cur.fetchall():
                actual_bldr_map.setdefault(r['phase_id'], {})[r['eff_builder_id']] = int(r['cnt'])

        # Scheduling hint: earliest real lot date per phase.
        # Primary: MIN(date_str, date_td) — delivery must precede starts.
        # Fallback: MIN(date_ent, date_td_hold) - 1 month — used when no lots
        # have started yet (P/E/D/H status) so the hint is still visible.
        hint_map = {}  # phase_id -> ISO date string
        if phase_ids:
            cur.execute("""
                SELECT phase_id,
                       COALESCE(
                           MIN(primary_d),
                           (MIN(fallback_d) - INTERVAL '1 month')::DATE
                       ) AS hint_date
                FROM (
                    SELECT phase_id, date_str AS primary_d, NULL::DATE AS fallback_d
                    FROM sim_lots
                    WHERE lot_source = 'real' AND phase_id = ANY(%s) AND date_str IS NOT NULL
                    UNION ALL
                    SELECT phase_id, date_td, NULL::DATE
                    FROM sim_lots
                    WHERE lot_source = 'real' AND phase_id = ANY(%s) AND date_td IS NOT NULL
                    UNION ALL
                    SELECT phase_id, NULL::DATE, date_ent
                    FROM sim_lots
                    WHERE lot_source = 'real' AND phase_id = ANY(%s) AND date_ent IS NOT NULL
                    UNION ALL
                    SELECT phase_id, NULL::DATE, date_td_hold
                    FROM sim_lots
                    WHERE lot_source = 'real' AND phase_id = ANY(%s) AND date_td_hold IS NOT NULL
                ) t
                GROUP BY phase_id
            """, (phase_ids, phase_ids, phase_ids, phase_ids))
            for r in cur.fetchall():
                if r['hint_date']:
                    hint_map[r['phase_id']] = r['hint_date'].isoformat()

        rows = []
        for p in phases:
            pid = p['phase_id']
            lc  = lot_count_map.get(pid, {})
            rows.append({
                'ent_group_id':           p['ent_group_id'],
                'ent_group_name':         p['ent_group_name'],
                'is_test':                p['is_test'],
                'community_county_id':    p['community_county_id'],
                'community_county_name':  p['community_county_name'],
                'community_sd_id':        p['community_sd_id'],
                'community_sd_name':      p['community_sd_name'],
                'dev_id':                 p['dev_id'],
                'dev_name':               p['dev_name'],
                'instrument_id':          p['instrument_id'],
                'instrument_name':        p['instrument_name'],
                'spec_rate':              float(p['spec_rate']) if p['spec_rate'] is not None else None,
                'phase_id':               pid,
                'phase_name':             p['phase_name'],
                'sequence_number':        p['sequence_number'],
                'lot_count_projected':    p['lot_count_projected'],
                'date_dev_projected':     p['date_dev_projected'].isoformat() if p['date_dev_projected'] else None,
                'date_dev_actual':        p['date_dev_actual'].isoformat()    if p['date_dev_actual']    else None,
                'delivery_tier':          p['delivery_tier'],
                'delivery_group':         p['delivery_group'],
                'updated_at':             p['updated_at'].isoformat()         if p['updated_at']         else None,
                'hint_date':              hint_map.get(pid),
                'phase_county_id':        p['phase_county_id'],
                'phase_county_name':      p['phase_county_name'],
                'phase_sd_id':            p['phase_sd_id'],
                'phase_sd_name':          p['phase_sd_name'],
                'lot_type_counts':        lc,
                'product_splits':         prod_map.get(pid, {}),
                'builder_splits':         bldr_map.get(p['instrument_id'], {}),
                'actual_builder_counts':  actual_bldr_map.get(pid, {}),  # {builder_id: count, None: count_unassigned}
            })

        return {'lot_types': lot_types, 'builders': builders, 'rows': rows}
    finally:
        cur.close()


# ─── Phase fields ─────────────────────────────────────────────────────────────

class PhasePatchRequest(BaseModel):
    sequence_number:     Optional[int] = None
    lot_count_projected: Optional[int] = None
    date_dev_projected:  Optional[str] = None
    date_dev_actual:     Optional[str] = None
    delivery_tier:       Optional[int] = None
    delivery_group:      Optional[str] = None
    county_id:           Optional[int] = None
    school_district_id:  Optional[int] = None


@router.patch("/phase/{phase_id}")
def patch_phase(phase_id: int, body: PhasePatchRequest, conn=Depends(get_db_conn)):
    """Partially update phase fields. Fields absent from request are untouched.
    Passing null for a date field explicitly clears it (date_dev_actual null = unlock)."""
    provided = body.model_fields_set
    if not provided:
        return {'phase_id': phase_id}

    clauses, params = [], []
    if 'sequence_number' in provided:
        clauses.append("sequence_number = %s")
        params.append(body.sequence_number)
    if 'lot_count_projected' in provided:
        clauses.append("lot_count_projected = %s")
        params.append(body.lot_count_projected)
    if 'date_dev_projected' in provided:
        clauses.append("date_dev_projected = %s::date")
        params.append(body.date_dev_projected)
    if 'date_dev_actual' in provided:
        clauses.append("date_dev_actual = %s::date")
        params.append(body.date_dev_actual)
    if 'delivery_tier' in provided:
        clauses.append("delivery_tier = %s")
        params.append(body.delivery_tier)
    if 'delivery_group' in provided:
        val = (body.delivery_group or '').strip().upper() or None
        if val and (len(val) != 1 or not val.isalpha()):
            raise HTTPException(status_code=422, detail='delivery_group must be a single letter A-Z')
        clauses.append("delivery_group = %s")
        params.append(val)
    if 'county_id' in provided:
        clauses.append("county_id = %s")
        params.append(body.county_id)
    if 'school_district_id' in provided:
        clauses.append("school_district_id = %s")
        params.append(body.school_district_id)

    params.append(phase_id)
    cur = dict_cursor(conn)
    try:
        cur.execute(
            f"UPDATE sim_dev_phases SET {', '.join(clauses)} "
            f"WHERE phase_id = %s "
            f"RETURNING phase_id, sequence_number, lot_count_projected, date_dev_projected, date_dev_actual, "
            f"          delivery_tier, delivery_group, county_id, school_district_id",
            params,
        )
        row = cur.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail='Phase not found')
        conn.commit()
        return {
            'phase_id':            row['phase_id'],
            'sequence_number':     row['sequence_number'],
            'lot_count_projected': row['lot_count_projected'],
            'date_dev_projected':  row['date_dev_projected'].isoformat() if row['date_dev_projected'] else None,
            'date_dev_actual':     row['date_dev_actual'].isoformat()    if row['date_dev_actual']    else None,
            'delivery_tier':       row['delivery_tier'],
            'delivery_group':      row['delivery_group'],
            'county_id':           row['county_id'],
            'school_district_id':  row['school_district_id'],
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
    share: Optional[float]   # 0–100; null = clear this builder from the instrument


@router.put("/builder-split/{instrument_id}/{builder_id}")
def upsert_builder_split(
    instrument_id: int, builder_id: int, body: BuilderSplitRequest, conn=Depends(get_db_conn)
):
    if body.share is not None and not (0 <= body.share <= 100):
        raise HTTPException(status_code=422, detail='share must be 0–100')
    cur = dict_cursor(conn)
    try:
        if body.share is None:
            cur.execute(
                'DELETE FROM sim_instrument_builder_splits WHERE instrument_id = %s AND builder_id = %s',
                (instrument_id, builder_id),
            )
        else:
            cur.execute(
                """
                INSERT INTO sim_instrument_builder_splits (instrument_id, builder_id, share)
                VALUES (%s, %s, %s)
                ON CONFLICT (instrument_id, builder_id) DO UPDATE SET share = EXCLUDED.share
                """,
                (instrument_id, builder_id, body.share),
            )
        conn.commit()
        return {'instrument_id': instrument_id, 'builder_id': builder_id, 'share': body.share}
    finally:
        cur.close()


# ─── Lot school-district ruling exception ────────────────────────────────────

class LotSdPatchRequest(BaseModel):
    school_district_id: Optional[int] = None   # None = clear exception


@router.patch("/lot/{lot_id}/school-district")
def patch_lot_school_district(lot_id: int, body: LotSdPatchRequest, conn=Depends(get_db_conn)):
    """Set or clear the lot-level school district ruling exception on sim_lots."""
    cur = dict_cursor(conn)
    try:
        cur.execute(
            "UPDATE sim_lots SET school_district_id = %s WHERE lot_id = %s "
            "RETURNING lot_id, school_district_id",
            (body.school_district_id, lot_id),
        )
        row = cur.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail=f"Lot {lot_id} not found")
        conn.commit()
        return {"lot_id": row["lot_id"], "school_district_id": row["school_district_id"]}
    except HTTPException:
        raise
    except Exception:
        conn.rollback()
        raise
    finally:
        cur.close()


# ─── Community config tab ─────────────────────────────────────────────────────

@router.get("/community-config")
def get_community_config(conn=Depends(get_db_conn)):
    """All communities with ledger dates and delivery scheduling config."""
    cur = dict_cursor(conn)
    try:
        cur.execute("""
            SELECT
                seg.ent_group_id, seg.ent_group_name, seg.is_test, seg.status,
                seg.date_paper, seg.date_ent_actual,
                seg.county_id, c.county_name,
                seg.school_district_id, sd.district_name AS sd_name,
                edc.delivery_months,
                edc.max_deliveries_per_year
            FROM sim_entitlement_groups seg
            LEFT JOIN sim_entitlement_delivery_config edc
                   ON edc.ent_group_id = seg.ent_group_id
            LEFT JOIN devdb.ref_counties c  ON c.county_id = seg.county_id
            LEFT JOIN devdb.ref_school_districts sd ON sd.sd_id = seg.school_district_id
            ORDER BY seg.ent_group_name
        """)
        rows = []
        for r in cur.fetchall():
            rows.append({
                'ent_group_id':            r['ent_group_id'],
                'ent_group_name':          r['ent_group_name'],
                'is_test':                 r['is_test'],
                'status':                  r['status'],
                'date_paper':              r['date_paper'].isoformat()      if r['date_paper']      else None,
                'date_ent':                r['date_ent_actual'].isoformat() if r['date_ent_actual'] else None,
                'county_id':               r['county_id'],
                'county_name':             r['county_name'],
                'school_district_id':      r['school_district_id'],
                'sd_name':                 r['sd_name'],
                'delivery_months':         list(r['delivery_months']) if r['delivery_months'] is not None else None,
                'max_deliveries_per_year': r['max_deliveries_per_year'],
            })
        return rows
    finally:
        cur.close()


# ─── Development config tab ───────────────────────────────────────────────────

@router.get("/dev-config")
def get_dev_config(conn=Depends(get_db_conn)):
    """
    All developments with sim params plus informational context:
    - total_projected: sum of product_splits projected_count across all phases
    - unstarted_real:  real lots with no date_str and no date_cls (still in pipeline)
    - starts_last_year, starts_2yr_ago, starts_ytd: historical actual starts by year
    """
    cur = dict_cursor(conn)
    try:
        cur.execute("""
            SELECT
                seg.ent_group_id, seg.ent_group_name, seg.is_test, seg.status,
                segd.dev_id, d.dev_name,
                sdp.annual_starts_target, sdp.max_starts_per_month,

                -- Historical starts from real lots
                COALESCE(ls.starts_ytd,      0) AS starts_ytd,
                COALESCE(ls.starts_last_year, 0) AS starts_last_year,
                COALESCE(ls.starts_2yr_ago,   0) AS starts_2yr_ago,
                COALESCE(ls.unstarted_real,   0) AS unstarted_real,

                -- Total projected lots (sum of product_splits across all phases)
                COALESCE(proj.total_projected, 0) AS total_projected

            FROM sim_entitlement_groups seg
            JOIN sim_ent_group_developments segd ON segd.ent_group_id = seg.ent_group_id
            JOIN developments d ON d.dev_id = segd.dev_id
            LEFT JOIN sim_dev_params sdp ON sdp.dev_id = segd.dev_id

            LEFT JOIN (
                SELECT
                    dev_id,
                    COUNT(*) FILTER (WHERE EXTRACT(YEAR FROM date_str) = EXTRACT(YEAR FROM CURRENT_DATE))     AS starts_ytd,
                    COUNT(*) FILTER (WHERE EXTRACT(YEAR FROM date_str) = EXTRACT(YEAR FROM CURRENT_DATE) - 1) AS starts_last_year,
                    COUNT(*) FILTER (WHERE EXTRACT(YEAR FROM date_str) = EXTRACT(YEAR FROM CURRENT_DATE) - 2) AS starts_2yr_ago,
                    COUNT(*) FILTER (WHERE date_str IS NULL AND date_cls IS NULL)                             AS unstarted_real
                FROM sim_lots
                WHERE lot_source IN ('real', 'pre')
                  AND excluded IS NOT TRUE
                GROUP BY dev_id
            ) ls ON ls.dev_id = segd.dev_id

            LEFT JOIN (
                SELECT sli.dev_id, SUM(spps.projected_count) AS total_projected
                FROM sim_phase_product_splits spps
                JOIN sim_dev_phases sdph ON sdph.phase_id = spps.phase_id
                JOIN sim_legal_instruments sli ON sli.instrument_id = sdph.instrument_id
                GROUP BY sli.dev_id
            ) proj ON proj.dev_id = segd.dev_id

            ORDER BY seg.ent_group_name, d.dev_name
        """)
        rows = []
        for r in cur.fetchall():
            rows.append({
                'ent_group_id':         r['ent_group_id'],
                'ent_group_name':       r['ent_group_name'],
                'is_test':              r['is_test'],
                'status':               r['status'],
                'dev_id':               r['dev_id'],
                'dev_name':             r['dev_name'],
                'annual_starts_target': float(r['annual_starts_target']) if r['annual_starts_target'] is not None else None,
                'max_starts_per_month': float(r['max_starts_per_month']) if r['max_starts_per_month'] is not None else None,
                'starts_ytd':           int(r['starts_ytd']),
                'starts_last_year':     int(r['starts_last_year']),
                'starts_2yr_ago':       int(r['starts_2yr_ago']),
                'unstarted_real':       int(r['unstarted_real']),
                'total_projected':      int(r['total_projected']),
            })
        return rows
    finally:
        cur.close()


# ─── Audit data ───────────────────────────────────────────────────────────────

@router.get("/audit-data")
def get_audit_data(conn=Depends(get_db_conn)):
    """
    All data needed for the config audit view in a single fetch:
    global delivery months, all communities with delivery config,
    phases (splits + lot counts), and delivery events.
    """
    cur = dict_cursor(conn)
    try:
        # Global settings
        cur.execute("SELECT delivery_months, max_deliveries_per_year FROM sim_global_settings WHERE id = 1")
        gs = cur.fetchone()
        global_months      = list(gs['delivery_months']) if gs and gs['delivery_months'] else [5,6,7,8,9,10,11]
        global_max_per_year = gs['max_deliveries_per_year'] if gs else None

        # Active builders
        cur.execute("SELECT builder_id, builder_name FROM dim_builders WHERE active = true ORDER BY builder_id")
        builders = [dict(r) for r in cur.fetchall()]

        # Communities with delivery config
        cur.execute("""
            SELECT
                seg.ent_group_id, seg.ent_group_name, seg.is_test, seg.status,
                seg.county_id, seg.school_district_id,
                c.county_name, sd.district_name AS sd_name,
                edc.delivery_months,
                edc.max_deliveries_per_year
            FROM sim_entitlement_groups seg
            LEFT JOIN sim_entitlement_delivery_config edc
                   ON edc.ent_group_id = seg.ent_group_id
            LEFT JOIN devdb.ref_counties c   ON c.county_id = seg.county_id
            LEFT JOIN devdb.ref_school_districts sd ON sd.sd_id = seg.school_district_id
            ORDER BY seg.ent_group_name
        """)
        comm_map = {}
        for r in cur.fetchall():
            comm_map[r['ent_group_id']] = {
                'ent_group_id':            r['ent_group_id'],
                'ent_group_name':          r['ent_group_name'],
                'is_test':                 r['is_test'],
                'status':                  r['status'],
                'county_id':               r['county_id'],
                'county_name':             r['county_name'],
                'school_district_id':      r['school_district_id'],
                'sd_name':                 r['sd_name'],
                'delivery_months':         list(r['delivery_months']) if r['delivery_months'] is not None else None,
                'max_deliveries_per_year': r['max_deliveries_per_year'],
                'phases':                  [],
                'delivery_events':         [],
            }

        # All phases with hierarchy
        cur.execute("""
            SELECT
                seg.ent_group_id,
                segd.dev_id,
                d.dev_name,
                sli.instrument_id,
                sli.instrument_name,
                sli.spec_rate,
                sdp.phase_id,
                sdp.phase_name,
                sdp.sequence_number,
                sdp.delivery_tier,
                sdp.delivery_group,
                sdp.date_dev_actual
            FROM sim_entitlement_groups seg
            JOIN sim_ent_group_developments segd ON segd.ent_group_id = seg.ent_group_id
            JOIN developments d                  ON d.dev_id = segd.dev_id
            JOIN sim_legal_instruments sli        ON sli.dev_id = d.dev_id
            JOIN sim_dev_phases sdp               ON sdp.instrument_id = sli.instrument_id
            ORDER BY seg.ent_group_name, d.dev_name, sli.instrument_name, sdp.sequence_number
        """)
        phases     = cur.fetchall()
        phase_ids  = [r['phase_id'] for r in phases]
        dev_ids    = list({r['dev_id'] for r in phases})

        # Dev params: annual_starts_target per dev_id
        dev_params_map = {}
        if dev_ids:
            cur.execute("""
                SELECT dev_id, annual_starts_target
                FROM sim_dev_params
                WHERE dev_id = ANY(%s)
            """, (dev_ids,))
            for r in cur.fetchall():
                dev_params_map[r['dev_id']] = float(r['annual_starts_target']) if r['annual_starts_target'] is not None else None

        dev_comm_map = {}  # egid -> {dev_id -> dev dict}

        # Real+pre lot counts per phase
        real_pre_map = {}
        if phase_ids:
            cur.execute("""
                SELECT phase_id,
                    COUNT(*) FILTER (WHERE excluded IS NOT TRUE AND lot_source IN ('real','pre')) AS real_pre_count
                FROM sim_lots
                WHERE phase_id = ANY(%s)
                GROUP BY phase_id
            """, (phase_ids,))
            for r in cur.fetchall():
                real_pre_map[r['phase_id']] = int(r['real_pre_count'])

        # Product split totals per phase
        prod_total_map = {}
        if phase_ids:
            cur.execute("""
                SELECT phase_id, SUM(projected_count) AS total
                FROM sim_phase_product_splits
                WHERE phase_id = ANY(%s)
                GROUP BY phase_id
            """, (phase_ids,))
            for r in cur.fetchall():
                prod_total_map[r['phase_id']] = int(r['total']) if r['total'] else 0

        # Builder splits per instrument (expanded to phases via instrument_id)
        instrument_ids_cc = list({r['instrument_id'] for r in phases})
        bldr_map = {}  # instrument_id -> {builder_id: share}
        if instrument_ids_cc:
            cur.execute("""
                SELECT instrument_id, builder_id, share
                FROM sim_instrument_builder_splits
                WHERE instrument_id = ANY(%s)
            """, (instrument_ids_cc,))
            for r in cur.fetchall():
                bldr_map.setdefault(r['instrument_id'], {})[r['builder_id']] = (
                    float(r['share']) if r['share'] is not None else None
                )

        # All delivery events with phase assignments
        cur.execute("""
            SELECT
                de.delivery_event_id, de.ent_group_id, de.event_name,
                de.date_dev_actual, de.date_dev_projected, de.is_auto_created,
                ARRAY_AGG(dep.phase_id ORDER BY dep.phase_id)
                    FILTER (WHERE dep.phase_id IS NOT NULL) AS phase_ids
            FROM sim_delivery_events de
            LEFT JOIN sim_delivery_event_phases dep ON dep.delivery_event_id = de.delivery_event_id
            GROUP BY de.delivery_event_id, de.ent_group_id, de.event_name,
                     de.date_dev_actual, de.date_dev_projected, de.is_auto_created
            ORDER BY de.ent_group_id, de.date_dev_actual NULLS LAST, de.date_dev_projected NULLS LAST
        """)
        for r in cur.fetchall():
            egid = r['ent_group_id']
            if egid not in comm_map:
                continue
            comm_map[egid]['delivery_events'].append({
                'delivery_event_id':  r['delivery_event_id'],
                'event_name':         r['event_name'],
                'date_dev_actual':    r['date_dev_actual'].isoformat()    if r['date_dev_actual']    else None,
                'date_dev_projected': r['date_dev_projected'].isoformat() if r['date_dev_projected'] else None,
                'is_auto_created':    r['is_auto_created'],
                'phase_ids':          list(r['phase_ids']) if r['phase_ids'] else [],
            })

        # Covered phases per community
        covered_phases = {
            egid: set(pid for ev in comm['delivery_events'] for pid in ev['phase_ids'])
            for egid, comm in comm_map.items()
        }

        # Assemble phases into communities
        for p in phases:
            pid   = p['phase_id']
            egid  = p['ent_group_id']
            dev_id = p['dev_id']
            if egid not in comm_map:
                continue
            bs     = bldr_map.get(p['instrument_id'], {})
            bs_sum = round(sum(v for v in bs.values() if v is not None) * 100, 1) if bs else None
            comm_map[egid]['phases'].append({
                'phase_id':            pid,
                'phase_name':          p['phase_name'],
                'dev_id':              dev_id,
                'dev_name':            p['dev_name'],
                'instrument_id':       p['instrument_id'],
                'instrument_name':     p['instrument_name'],
                'sequence_number':     p['sequence_number'],
                'spec_rate':           float(p['spec_rate']) if p['spec_rate'] is not None else None,
                'delivery_tier':       p['delivery_tier'],
                'delivery_group':      p['delivery_group'],
                'date_dev_actual':     p['date_dev_actual'].isoformat() if p['date_dev_actual'] else None,
                'real_pre_lots':       real_pre_map.get(pid, 0),
                'product_split_total': prod_total_map.get(pid, 0),
                'builder_splits':      bs,
                'builder_split_sum':   bs_sum,
                'in_delivery_event':   pid in covered_phases.get(egid, set()),
            })
            # Track unique devs per community
            dev_comm_map.setdefault(egid, {}).setdefault(dev_id, {
                'dev_id':                dev_id,
                'dev_name':              p['dev_name'],
                'annual_starts_target':  dev_params_map.get(dev_id),
            })

        # Add developments list to each community
        for egid, devs in dev_comm_map.items():
            if egid in comm_map:
                comm_map[egid]['developments'] = list(devs.values())
        # Ensure communities with no phases still have an empty list
        for comm in comm_map.values():
            comm.setdefault('developments', [])

        return {
            'global_months':       global_months,
            'global_max_per_year': global_max_per_year,
            'builders':            builders,
            'communities':         list(comm_map.values()),
        }
    finally:
        cur.close()
