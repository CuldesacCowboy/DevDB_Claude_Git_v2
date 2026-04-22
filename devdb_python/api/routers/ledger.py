# routers/ledger.py
# Ledger endpoints -- monthly simulation results for an entitlement group.
# GET /{ent_group_id}        -- by development (summary)
# GET /{ent_group_id}/by-dev -- by development (alias, same query)

from fastapi import APIRouter, Depends, HTTPException

from api.db import dict_cursor
from api.deps import get_db_conn
from api.sql_fragments import lot_status_sql
from services.ledger_service import query_ledger_by_dev, query_ledger_weekly

router = APIRouter(prefix="/ledger", tags=["ledger"])

# _LEDGER_FILTER removed — ledger now uses a bounded date range instead so the
# spine is continuous with no gaps (months where all lots have closed and no new
# lots have been delivered would otherwise be silently dropped).


@router.get("/{ent_group_id}/utilization")
def get_utilization(ent_group_id: int, conn=Depends(get_db_conn)):
    """
    Return phase utilization for all phases in the entitlement group.
    utilization_pct = (real_count + sim_count) / projected_count.
    Phases with zero projected_count are returned with utilization_pct = null.
    """
    cur = dict_cursor(conn)
    try:
        cur.execute(
            """
            WITH phase_splits AS (
                SELECT phase_id, COALESCE(SUM(projected_count), 0)::int AS projected_count
                FROM sim_phase_product_splits
                GROUP BY phase_id
            )
            SELECT
                sdp.phase_id,
                sdp.phase_name,
                sdp.dev_id,
                d.dev_name,
                sli.instrument_name,
                COALESCE(ps.projected_count, 0)                              AS projected_count,
                COUNT(sl.lot_id) FILTER (WHERE sl.lot_source = 'sim')::int   AS sim_count,
                COUNT(sl.lot_id) FILTER (WHERE sl.lot_source = 'real')::int  AS real_count,
                COUNT(sl.lot_id)::int                                         AS total_count,
                COUNT(sl.lot_id) FILTER (WHERE sl.is_spec = TRUE)::int       AS spec_count,
                COUNT(sl.lot_id) FILTER (WHERE sl.is_spec = FALSE)::int      AS build_count,
                COUNT(sl.lot_id) FILTER (WHERE sl.is_spec IS NULL AND sl.lot_id IS NOT NULL)::int AS undet_count,
                CASE
                    WHEN COALESCE(ps.projected_count, 0) = 0 THEN NULL
                    ELSE ROUND(
                        COUNT(sl.lot_id)::numeric / ps.projected_count * 100, 1
                    )
                END AS utilization_pct
            FROM sim_dev_phases sdp
            JOIN sim_ent_group_developments segd ON sdp.dev_id = segd.dev_id
            JOIN developments d ON d.dev_id = sdp.dev_id
            JOIN sim_legal_instruments sli ON sdp.instrument_id = sli.instrument_id
            LEFT JOIN phase_splits ps ON ps.phase_id = sdp.phase_id
            LEFT JOIN sim_lots sl ON sl.phase_id = sdp.phase_id AND sl.excluded IS NOT TRUE
            WHERE segd.ent_group_id = %s
            GROUP BY sdp.phase_id, sdp.phase_name, sdp.dev_id, d.dev_name,
                     sli.instrument_name, sdp.sequence_number, ps.projected_count
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
                "spec_count":      r["spec_count"],
                "build_count":     r["build_count"],
                "undet_count":     r["undet_count"],
                "utilization_pct": float(r["utilization_pct"]) if r["utilization_pct"] is not None else None,
            }
            for r in cur.fetchall()
        ]
    finally:
        cur.close()


@router.get("/{ent_group_id}/lots")
def get_lots(ent_group_id: int, conn=Depends(get_db_conn)):
    """
    Return lot-level rows for all developments in the entitlement group.
    Status is derived from date fields (never stored).
    """
    _STATUS_SQL = lot_status_sql("sl")
    cur = dict_cursor(conn)
    try:
        cur.execute(
            f"""
            WITH overrides AS (
                SELECT lot_id,
                    MAX(CASE WHEN date_field = 'date_td_hold' THEN override_value END) AS ov_date_td_hold,
                    MAX(CASE WHEN date_field = 'date_td'      THEN override_value END) AS ov_date_td,
                    MAX(CASE WHEN date_field = 'date_str'     THEN override_value END) AS ov_date_str,
                    MAX(CASE WHEN date_field = 'date_frm'     THEN override_value END) AS ov_date_frm,
                    MAX(CASE WHEN date_field = 'date_cmp'     THEN override_value END) AS ov_date_cmp,
                    MAX(CASE WHEN date_field = 'date_cls'     THEN override_value END) AS ov_date_cls
                FROM sim_lot_date_overrides
                GROUP BY lot_id
            ),
            violations AS (
                SELECT lot_id,
                    array_agg(violation_type ORDER BY violation_type) AS violation_types
                FROM sim_lot_date_violations
                GROUP BY lot_id
            )
            SELECT
                sl.lot_id,
                sl.lot_number,
                sl.lot_source,
                sl.lot_type_id,
                rlt.lot_type_short,
                sdp.phase_name,
                sl.dev_id,
                d.dev_name,
                sl.building_group_id,
                {_STATUS_SQL}           AS status,
                sl.date_ent,
                sl.date_dev,
                sl.date_td_hold,
                sl.date_td_hold_projected,
                sl.date_td,
                sl.date_td_projected,
                sl.date_str,
                sl.date_frm,
                sl.date_cmp,
                sl.date_cls,
                sl.is_spec,
                sl.date_str_projected,
                sl.date_cmp_projected,
                sl.date_cls_projected,
                o.ov_date_td_hold,
                o.ov_date_td,
                o.ov_date_str,
                o.ov_date_frm,
                o.ov_date_cmp,
                o.ov_date_cls,
                v.violation_types,
                COALESCE(sdp.county_id, eg.county_id)                                              AS resolved_county_id,
                COALESCE(ph_c.county_name, comm_c.county_name)                                     AS resolved_county_name,
                COALESCE(sl.school_district_id, sdp.school_district_id, eg.school_district_id)    AS resolved_sd_id,
                COALESCE(lot_sd.district_name, ph_sd.district_name, comm_sd.district_name)        AS resolved_sd_name,
                (sl.school_district_id IS NOT NULL)                                                AS sd_is_lot_exception
            FROM sim_lots sl
            JOIN sim_dev_phases sdp ON sdp.phase_id = sl.phase_id
            JOIN developments d ON d.dev_id = sl.dev_id
            JOIN sim_ent_group_developments segd ON segd.dev_id = sl.dev_id AND segd.ent_group_id = %s
            JOIN sim_entitlement_groups eg ON eg.ent_group_id = segd.ent_group_id
            LEFT JOIN ref_lot_types rlt ON rlt.lot_type_id = sl.lot_type_id
            LEFT JOIN overrides o ON o.lot_id = sl.lot_id
            LEFT JOIN violations v ON v.lot_id = sl.lot_id
            LEFT JOIN devdb.ref_counties comm_c  ON comm_c.county_id  = eg.county_id
            LEFT JOIN devdb.ref_counties ph_c    ON ph_c.county_id    = sdp.county_id
            LEFT JOIN devdb.ref_school_districts comm_sd ON comm_sd.sd_id = eg.school_district_id
            LEFT JOIN devdb.ref_school_districts ph_sd   ON ph_sd.sd_id   = sdp.school_district_id
            LEFT JOIN devdb.ref_school_districts lot_sd  ON lot_sd.sd_id  = sl.school_district_id
            WHERE sl.excluded IS NOT TRUE
            ORDER BY d.dev_name, sdp.sequence_number, sl.lot_source ASC,
                     sl.lot_number NULLS LAST, sl.building_group_id ASC NULLS LAST
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
                "building_group_id":   r["building_group_id"],
                "status":              r["status"],
                "is_spec":             r["is_spec"],   # True=spec, False=build, None=undetermined
                "date_ent":            _d(r["date_ent"]),
                "date_dev":            _d(r["date_dev"]),
                "date_td_hold":           _d(r["date_td_hold"]),
                "date_td_hold_projected": _d(r["date_td_hold_projected"]),
                "date_td":                _d(r["date_td"]),
                "date_td_projected":      _d(r["date_td_projected"]),
                "date_str":            _d(r["date_str"]),
                "date_frm":            _d(r["date_frm"]),
                "date_cmp":            _d(r["date_cmp"]),
                "date_cls":            _d(r["date_cls"]),
                "date_str_projected":  _d(r["date_str_projected"]),
                "date_cmp_projected":  _d(r["date_cmp_projected"]),
                "date_cls_projected":  _d(r["date_cls_projected"]),
                "ov_date_td_hold":     _d(r["ov_date_td_hold"]),
                "ov_date_td":          _d(r["ov_date_td"]),
                "ov_date_str":         _d(r["ov_date_str"]),
                "ov_date_frm":         _d(r["ov_date_frm"]),
                "ov_date_cmp":         _d(r["ov_date_cmp"]),
                "ov_date_cls":         _d(r["ov_date_cls"]),
                "violations":          list(r["violation_types"]) if r["violation_types"] else [],
                "resolved_county_id":  r["resolved_county_id"],
                "resolved_county_name": r["resolved_county_name"],
                "resolved_sd_id":      r["resolved_sd_id"],
                "resolved_sd_name":    r["resolved_sd_name"],
                "sd_is_lot_exception": bool(r["sd_is_lot_exception"]),
            }
            for r in cur.fetchall()
        ]
    finally:
        cur.close()


@router.get("/{ent_group_id}/delivery-schedule")
def get_delivery_schedule(ent_group_id: int, conn=Depends(get_db_conn)):
    """
    Return one row per (delivery_event, development) with phases delivered,
    units, and D/U/UC inventory at the delivery month.
    """
    cur = dict_cursor(conn)
    try:
        cur.execute(
            """
            WITH event_phases AS (
                SELECT
                    sde.delivery_event_id,
                    sde.event_name,
                    COALESCE(sde.date_dev_actual, sde.date_dev_projected)::date AS delivery_date,
                    (sde.date_dev_actual IS NOT NULL)                            AS is_locked,
                    sdp.dev_id,
                    d.dev_name,
                    sdp.phase_id,
                    sdp.phase_name,
                    sdp.sequence_number
                FROM sim_delivery_events sde
                JOIN sim_delivery_event_phases dep ON dep.delivery_event_id = sde.delivery_event_id
                JOIN sim_dev_phases sdp            ON sdp.phase_id = dep.phase_id
                JOIN developments d               ON d.dev_id = sdp.dev_id
                WHERE sde.ent_group_id = %s
            ),
            excluded_counts AS (
                SELECT phase_id, COUNT(*)::int AS excluded_count
                FROM sim_lots
                WHERE phase_id IN (SELECT phase_id FROM event_phases)
                  AND excluded IS TRUE
                GROUP BY phase_id
            ),
            phase_units AS (
                SELECT spps.phase_id,
                    GREATEST(
                        COALESCE(SUM(spps.projected_count), 0)::int
                            - COALESCE(MAX(ec.excluded_count), 0),
                        0
                    ) AS units
                FROM sim_phase_product_splits spps
                LEFT JOIN excluded_counts ec ON ec.phase_id = spps.phase_id
                WHERE spps.phase_id IN (SELECT phase_id FROM event_phases)
                GROUP BY spps.phase_id
            ),
            event_dev AS (
                SELECT
                    ep.delivery_event_id,
                    ep.event_name,
                    ep.delivery_date,
                    ep.is_locked,
                    ep.dev_id,
                    ep.dev_name,
                    STRING_AGG(ep.phase_name, ', ' ORDER BY ep.sequence_number) AS phases,
                    COALESCE(SUM(pu.units), 0)::int                             AS units_delivered
                FROM event_phases ep
                LEFT JOIN phase_units pu ON pu.phase_id = ep.phase_id
                GROUP BY ep.delivery_event_id, ep.event_name, ep.delivery_date,
                         ep.is_locked, ep.dev_id, ep.dev_name
            ),
            inventory AS (
                SELECT dev_id, calendar_month,
                       SUM(d_end)::int   AS d_end,
                       SUM(h_end)::int   AS h_end,
                       SUM(u_end)::int   AS u_end
                FROM v_sim_ledger_monthly
                WHERE dev_id IN (
                    SELECT dev_id FROM sim_ent_group_developments WHERE ent_group_id = %s
                )
                GROUP BY dev_id, calendar_month
            )
            SELECT
                ed.delivery_event_id,
                ed.event_name,
                ed.delivery_date,
                ed.is_locked,
                ed.dev_id,
                ed.dev_name,
                ed.phases,
                ed.units_delivered,
                pre.d_end  AS d_pre,
                pre.h_end  AS h_pre,
                pre.u_end  AS u_pre,
                post.d_end AS d_post
            FROM event_dev ed
            LEFT JOIN inventory pre
                ON  pre.dev_id = ed.dev_id
                AND pre.calendar_month = (DATE_TRUNC('month', ed.delivery_date) - INTERVAL '1 month')::date
            LEFT JOIN inventory post
                ON  post.dev_id = ed.dev_id
                AND post.calendar_month = DATE_TRUNC('month', ed.delivery_date)::date
            ORDER BY ed.delivery_date NULLS LAST, ed.delivery_event_id, ed.dev_name
            """,
            (ent_group_id, ent_group_id),
        )

        def _d(v):
            return v.isoformat() if v else None

        return [
            {
                "delivery_event_id": r["delivery_event_id"],
                "event_name":        r["event_name"],
                "delivery_date":     _d(r["delivery_date"]),
                "is_locked":         bool(r["is_locked"]),
                "dev_id":            r["dev_id"],
                "dev_name":          r["dev_name"],
                "phases":            r["phases"],
                "units_delivered":   r["units_delivered"],
                "d_pre":             r["d_pre"],
                "h_pre":             r["h_pre"],
                "u_pre":             r["u_pre"],
                "d_post":            r["d_post"],
            }
            for r in cur.fetchall()
        ]
    finally:
        cur.close()


@router.get("/{ent_group_id}/weekly")
def get_ledger_weekly(ent_group_id: int, conn=Depends(get_db_conn)):
    """
    Return weekly ledger rows for all developments in the entitlement group.
    Each row covers one ISO week (Mon–Sun).  Event counts are lots whose
    effective date falls in that week; status counts are end-of-week snapshots.
    """
    return query_ledger_weekly(conn, ent_group_id)


@router.get("/{ent_group_id}/by-dev")
def get_ledger_by_dev(ent_group_id: int, conn=Depends(get_db_conn)):
    """
    Return monthly ledger rows aggregated by development.
    Only months with at least one non-zero count are returned.
    """
    return query_ledger_by_dev(conn, ent_group_id)


@router.get("/{ent_group_id}")
def get_ledger(ent_group_id: int, conn=Depends(get_db_conn)):
    """
    Return monthly ledger rows for all developments in the entitlement group.
    Rows are only returned for months that have at least one non-zero count.
    """
    rows = query_ledger_by_dev(conn, ent_group_id)
    if not rows:
        return []
    return rows
