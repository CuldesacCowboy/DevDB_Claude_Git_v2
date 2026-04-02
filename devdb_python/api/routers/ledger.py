# routers/ledger.py
# Ledger endpoints -- monthly simulation results for an entitlement group.
# GET /{ent_group_id}        -- by development (summary)
# GET /{ent_group_id}/by-dev -- by development (alias, same query)

import psycopg2.extras
from fastapi import APIRouter, Depends, HTTPException

from api.deps import get_db_conn

router = APIRouter(prefix="/ledger", tags=["ledger"])

_LEDGER_FILTER = """
    AND (
        v.ent_plan > 0 OR v.dev_plan > 0 OR v.td_plan > 0
        OR v.str_plan > 0 OR v.cmp_plan > 0 OR v.cls_plan > 0
        OR v.e_end > 0 OR v.d_end > 0 OR v.h_end > 0
        OR v.u_end > 0 OR v.uc_end > 0 OR v.c_end > 0
    )
"""


def _ledger_row(r) -> dict:
    return {
        "dev_id":            r["dev_id"],
        "dev_name":          r["dev_name"],
        "builder_id":        r["builder_id"],
        "calendar_month":    r["calendar_month"].isoformat() if r["calendar_month"] else None,
        "ent_plan":          r["ent_plan"],
        "dev_plan":          r["dev_plan"],
        "td_plan":           r["td_plan"],
        "str_plan":          r["str_plan"],
        "cmp_plan":          r["cmp_plan"],
        "cls_plan":          r["cls_plan"],
        "p_end":             r["p_end"],
        "e_end":             r["e_end"],
        "d_end":             r["d_end"],
        "h_end":             r["h_end"],
        "u_end":             r["u_end"],
        "uc_end":            r["uc_end"],
        "c_end":             r["c_end"],
        "closed_cumulative": r["closed_cumulative"],
    }


@router.get("/{ent_group_id}/utilization")
def get_utilization(ent_group_id: int, conn=Depends(get_db_conn)):
    """
    Return phase utilization for all phases in the entitlement group.
    utilization_pct = (real_count + sim_count) / projected_count.
    Phases with zero projected_count are returned with utilization_pct = null.
    """
    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
    try:
        cur.execute(
            """
            SELECT
                sdp.phase_id,
                sdp.phase_name,
                sdp.dev_id,
                d.dev_name,
                sli.instrument_name,
                COALESCE(SUM(sps.projected_count), 0)::int                              AS projected_count,
                COUNT(sl.lot_id) FILTER (WHERE sl.lot_source = 'sim')::int              AS sim_count,
                COUNT(sl.lot_id) FILTER (WHERE sl.lot_source = 'real')::int             AS real_count,
                (COUNT(sl.lot_id)::int)                                                  AS total_count,
                CASE
                    WHEN COALESCE(SUM(sps.projected_count), 0) = 0 THEN NULL
                    ELSE ROUND(
                        COUNT(sl.lot_id)::numeric / SUM(sps.projected_count) * 100, 1
                    )
                END AS utilization_pct
            FROM sim_dev_phases sdp
            JOIN sim_ent_group_developments segd ON sdp.dev_id = segd.dev_id
            JOIN dim_development dd ON dd.development_id = sdp.dev_id
            JOIN developments d ON d.marks_code = dd.dev_code2
            JOIN sim_legal_instruments sli ON sdp.instrument_id = sli.instrument_id
            LEFT JOIN sim_phase_product_splits sps ON sps.phase_id = sdp.phase_id
            LEFT JOIN sim_lots sl ON sl.phase_id = sdp.phase_id
            WHERE segd.ent_group_id = %s
            GROUP BY sdp.phase_id, sdp.phase_name, sdp.dev_id, d.dev_name,
                     sli.instrument_name, sdp.sequence_number
            ORDER BY sdp.dev_id, sdp.sequence_number
            """,
            (ent_group_id,),
        )
        return [
            {
                "phase_id":        r["phase_id"],
                "phase_name":      r["phase_name"],
                "dev_id":          r["dev_id"],
                "dev_name":        r["dev_name"],
                "instrument_name": r["instrument_name"],
                "projected_count": r["projected_count"],
                "sim_count":       r["sim_count"],
                "real_count":      r["real_count"],
                "total_count":     r["total_count"],
                "utilization_pct": float(r["utilization_pct"]) if r["utilization_pct"] is not None else None,
            }
            for r in cur.fetchall()
        ]
    finally:
        cur.close()


def _query_ledger_by_dev(conn, ent_group_id: int) -> list:
    """Shared query for both ledger endpoints (dev-level, builder-level rows)."""
    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
    try:
        cur.execute(
            f"""
            SELECT
                v.dev_id,
                d.dev_name,
                v.builder_id,
                v.calendar_month,
                v.ent_plan, v.dev_plan, v.td_plan,
                v.str_plan, v.cmp_plan, v.cls_plan,
                v.p_end, v.e_end, v.d_end, v.h_end,
                v.u_end, v.uc_end, v.c_end,
                v.closed_cumulative
            FROM v_sim_ledger_monthly v
            JOIN dim_development dd ON dd.development_id = v.dev_id
            JOIN developments d ON d.marks_code = dd.dev_code2
            WHERE v.dev_id IN (
                SELECT dev_id FROM sim_ent_group_developments
                WHERE ent_group_id = %s
            )
            {_LEDGER_FILTER}
            ORDER BY d.dev_name, v.calendar_month
            """,
            (ent_group_id,),
        )
        return [_ledger_row(r) for r in cur.fetchall()]
    finally:
        cur.close()


@router.get("/{ent_group_id}/lots")
def get_lots(ent_group_id: int, conn=Depends(get_db_conn)):
    """
    Return lot-level rows for all developments in the entitlement group.
    Status is derived from date fields (never stored).
    """
    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
    _STATUS_SQL = """
        CASE
            WHEN sl.date_cls IS NOT NULL                                   THEN 'OUT'
            WHEN sl.date_cmp IS NOT NULL                                   THEN 'C'
            WHEN sl.date_str IS NOT NULL                                   THEN 'UC'
            WHEN sl.date_td_hold IS NOT NULL AND sl.date_td IS NULL        THEN 'H'
            WHEN sl.date_td IS NOT NULL                                    THEN 'U'
            WHEN sl.date_dev IS NOT NULL                                   THEN 'D'
            WHEN sl.date_ent IS NOT NULL                                   THEN 'E'
            ELSE 'P'
        END
    """
    try:
        cur.execute(
            f"""
            SELECT
                sl.lot_id,
                sl.lot_number,
                sl.lot_source,
                sl.lot_type_id,
                rlt.lot_type_short,
                sdp.phase_name,
                sl.dev_id,
                d.dev_name,
                {_STATUS_SQL}           AS status,
                sl.date_ent,
                sl.date_dev,
                sl.date_td_hold,
                sl.date_td,
                sl.date_str,
                sl.date_cmp,
                sl.date_cls,
                sl.date_str_projected,
                sl.date_cmp_projected,
                sl.date_cls_projected
            FROM sim_lots sl
            JOIN sim_dev_phases sdp ON sdp.phase_id = sl.phase_id
            JOIN dim_development dd ON dd.development_id = sl.dev_id
            JOIN developments d ON d.marks_code = dd.dev_code2
            LEFT JOIN ref_lot_types rlt ON rlt.lot_type_id = sl.lot_type_id
            WHERE sl.dev_id IN (
                SELECT dev_id FROM sim_ent_group_developments
                WHERE ent_group_id = %s
            )
            ORDER BY d.dev_name, sdp.sequence_number, sl.lot_number NULLS LAST
            """,
            (ent_group_id,),
        )

        def _d(v):
            return v.isoformat() if v else None

        return [
            {
                "lot_id":              r["lot_id"],
                "lot_number":          r["lot_number"],
                "lot_source":          r["lot_source"],
                "lot_type_short":      r["lot_type_short"],
                "phase_name":          r["phase_name"],
                "dev_id":              r["dev_id"],
                "dev_name":            r["dev_name"],
                "status":              r["status"],
                "date_ent":            _d(r["date_ent"]),
                "date_dev":            _d(r["date_dev"]),
                "date_td_hold":        _d(r["date_td_hold"]),
                "date_td":             _d(r["date_td"]),
                "date_str":            _d(r["date_str"]),
                "date_cmp":            _d(r["date_cmp"]),
                "date_cls":            _d(r["date_cls"]),
                "date_str_projected":  _d(r["date_str_projected"]),
                "date_cmp_projected":  _d(r["date_cmp_projected"]),
                "date_cls_projected":  _d(r["date_cls_projected"]),
            }
            for r in cur.fetchall()
        ]
    finally:
        cur.close()


@router.get("/{ent_group_id}/by-dev")
def get_ledger_by_dev(ent_group_id: int, conn=Depends(get_db_conn)):
    """
    Return monthly ledger rows aggregated by development.
    Only months with at least one non-zero count are returned.
    """
    return _query_ledger_by_dev(conn, ent_group_id)


@router.get("/{ent_group_id}")
def get_ledger(ent_group_id: int, conn=Depends(get_db_conn)):
    """
    Return monthly ledger rows for all developments in the entitlement group.
    Rows are only returned for months that have at least one non-zero count.
    """
    rows = _query_ledger_by_dev(conn, ent_group_id)
    if not rows:
        return []
    return rows
