# routers/portfolio.py
# Portfolio dashboard — company-wide aggregate endpoints.

from fastapi import APIRouter, Depends, Query
from typing import Optional

from api.deps import get_db_conn
from api.db import dict_cursor

router = APIRouter(prefix="/portfolio", tags=["portfolio"])


@router.get("/summary")
def get_portfolio_summary(
    status: Optional[str] = Query(None, description="Comma-separated status filter: Active,Prospective,..."),
    conn=Depends(get_db_conn),
):
    """
    Company-wide portfolio summary: communities, monthly aggregates,
    builder capacity, and status counts.
    """
    cur = dict_cursor(conn)
    try:
        status_list = [s.strip() for s in status.split(",")] if status else None

        # ── Status counts ────────────────────────────────────────────────
        cur.execute("""
            SELECT status, COUNT(*) AS cnt
            FROM sim_entitlement_groups
            WHERE is_test IS NOT TRUE
            GROUP BY status
            ORDER BY status
        """)
        status_counts = {r["status"] or "Unknown": r["cnt"] for r in cur.fetchall()}

        # ── Communities with dev-level rollups ────────────────────────────
        cur.execute("""
            SELECT
                seg.ent_group_id,
                seg.ent_group_name,
                seg.status,
                COALESCE(SUM(sdp.annual_starts_target), 0)::int AS annual_starts_target,
                COALESCE(ls.starts_ytd, 0)::int AS starts_ytd,
                COALESCE(ls.starts_last_year, 0)::int AS starts_last_year,
                COALESCE(ls.unstarted_real, 0)::int AS unstarted_real,
                COALESCE(proj.total_projected, 0)::int AS total_projected,
                COALESCE(lc.real_count, 0)::int AS real_count
            FROM sim_entitlement_groups seg
            LEFT JOIN sim_ent_group_developments segd ON segd.ent_group_id = seg.ent_group_id
            LEFT JOIN sim_dev_params sdp ON sdp.dev_id = segd.dev_id
            LEFT JOIN (
                SELECT d.community_id AS ent_group_id,
                    COUNT(*) FILTER (WHERE sl.date_str IS NOT NULL
                                      AND EXTRACT(YEAR FROM sl.date_str) = EXTRACT(YEAR FROM CURRENT_DATE))::int AS starts_ytd,
                    COUNT(*) FILTER (WHERE sl.date_str IS NOT NULL
                                      AND EXTRACT(YEAR FROM sl.date_str) = EXTRACT(YEAR FROM CURRENT_DATE) - 1)::int AS starts_last_year,
                    COUNT(*) FILTER (WHERE sl.date_str IS NULL AND sl.date_cls IS NULL)::int AS unstarted_real
                FROM sim_lots sl
                JOIN developments d ON d.dev_id = sl.dev_id
                WHERE sl.lot_source IN ('real', 'pre') AND sl.excluded IS NOT TRUE
                GROUP BY d.community_id
            ) ls ON ls.ent_group_id = seg.ent_group_id
            LEFT JOIN (
                SELECT segd2.ent_group_id, SUM(spps.projected_count)::int AS total_projected
                FROM sim_phase_product_splits spps
                JOIN sim_dev_phases sdph ON sdph.phase_id = spps.phase_id
                JOIN sim_legal_instruments sli ON sli.instrument_id = sdph.instrument_id
                JOIN sim_ent_group_developments segd2 ON segd2.dev_id = sli.dev_id
                GROUP BY segd2.ent_group_id
            ) proj ON proj.ent_group_id = seg.ent_group_id
            LEFT JOIN (
                SELECT segd3.ent_group_id,
                    COUNT(*) FILTER (WHERE sl2.lot_source = 'real' AND sl2.excluded IS NOT TRUE)::int AS real_count
                FROM sim_lots sl2
                JOIN sim_ent_group_developments segd3 ON segd3.dev_id = sl2.dev_id
                GROUP BY segd3.ent_group_id
            ) lc ON lc.ent_group_id = seg.ent_group_id
            WHERE seg.is_test IS NOT TRUE
            GROUP BY seg.ent_group_id, seg.ent_group_name, seg.status,
                     ls.starts_ytd, ls.starts_last_year, ls.unstarted_real,
                     proj.total_projected, lc.real_count
            ORDER BY seg.ent_group_name
        """)
        all_communities = []
        for r in cur.fetchall():
            all_communities.append({
                "ent_group_id": r["ent_group_id"],
                "ent_group_name": r["ent_group_name"],
                "status": r["status"],
                "annual_starts_target": r["annual_starts_target"],
                "starts_ytd": r["starts_ytd"],
                "starts_last_year": r["starts_last_year"],
                "unstarted_real": r["unstarted_real"],
                "total_projected": r["total_projected"],
                "real_count": r["real_count"],
            })

        # Filter communities by status
        if status_list:
            communities = [c for c in all_communities if c["status"] in status_list]
        else:
            communities = all_communities

        filtered_ids = [c["ent_group_id"] for c in communities]

        # ── Monthly aggregate ────────────────────────────────────────────
        if filtered_ids:
            cur.execute("""
                SELECT v.calendar_month,
                    SUM(v.str_plan)::int AS str_plan,
                    SUM(v.str_plan_spec)::int AS str_plan_spec,
                    SUM(v.str_plan_build)::int AS str_plan_build,
                    SUM(v.cmp_plan)::int AS cmp_plan,
                    SUM(v.cls_plan)::int AS cls_plan,
                    SUM(v.p_end)::int AS p_end,
                    SUM(v.e_end)::int AS e_end,
                    SUM(v.d_end)::int AS d_end,
                    SUM(v.h_end)::int AS h_end,
                    SUM(v.u_end)::int AS u_end,
                    SUM(v.uc_end)::int AS uc_end,
                    SUM(v.c_end)::int AS c_end,
                    SUM(v.closed_cumulative)::int AS closed_cumulative
                FROM v_sim_ledger_monthly v
                JOIN sim_ent_group_developments segd ON segd.dev_id = v.dev_id
                WHERE segd.ent_group_id = ANY(%s)
                GROUP BY v.calendar_month
                ORDER BY v.calendar_month
            """, (filtered_ids,))
            monthly = [
                {
                    "calendar_month": r["calendar_month"].isoformat() if r["calendar_month"] else None,
                    "str_plan": r["str_plan"], "str_plan_spec": r["str_plan_spec"],
                    "str_plan_build": r["str_plan_build"],
                    "cmp_plan": r["cmp_plan"], "cls_plan": r["cls_plan"],
                    "p_end": r["p_end"], "e_end": r["e_end"], "d_end": r["d_end"],
                    "h_end": r["h_end"], "u_end": r["u_end"], "uc_end": r["uc_end"],
                    "c_end": r["c_end"], "closed_cumulative": r["closed_cumulative"],
                }
                for r in cur.fetchall()
            ]
        else:
            monthly = []

        # ── Builder summary ──────────────────────────────────────────────
        if filtered_ids:
            cur.execute("""
                SELECT db.builder_id, db.builder_name,
                    COUNT(sl.lot_id)::int AS total_lots,
                    COUNT(sl.lot_id) FILTER (WHERE sl.date_str IS NOT NULL)::int AS started,
                    COUNT(sl.lot_id) FILTER (WHERE sl.date_str IS NULL)::int AS pipeline,
                    COUNT(DISTINCT segd.ent_group_id)::int AS communities
                FROM v_sim_ledger_combined sl
                JOIN dim_builders db ON db.builder_id = COALESCE(sl.builder_id_override, sl.builder_id)
                JOIN sim_ent_group_developments segd ON segd.dev_id = sl.dev_id
                WHERE sl.excluded IS NOT TRUE
                  AND segd.ent_group_id = ANY(%s)
                  AND db.active = true
                GROUP BY db.builder_id, db.builder_name
                ORDER BY total_lots DESC
            """, (filtered_ids,))
            builders = [
                {
                    "builder_id": r["builder_id"],
                    "builder_name": r["builder_name"],
                    "total_lots": r["total_lots"],
                    "started": r["started"],
                    "pipeline": r["pipeline"],
                    "communities": r["communities"],
                }
                for r in cur.fetchall()
            ]
        else:
            builders = []

        return {
            "communities": communities,
            "monthly_aggregate": monthly,
            "builder_summary": builders,
            "status_counts": status_counts,
        }
    finally:
        cur.close()
