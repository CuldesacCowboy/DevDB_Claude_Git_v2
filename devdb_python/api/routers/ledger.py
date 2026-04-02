# routers/ledger.py
# Ledger endpoint — returns monthly simulation results for an entitlement group.

import psycopg2.extras
from fastapi import APIRouter, Depends, HTTPException

from api.deps import get_db_conn

router = APIRouter(prefix="/ledger", tags=["ledger"])


@router.get("/{ent_group_id}")
def get_ledger(ent_group_id: int, conn=Depends(get_db_conn)):
    """
    Return monthly ledger rows for all projection groups in the entitlement group.
    Rows are only returned for months that have at least one non-zero count.
    """
    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
    try:
        cur.execute(
            """
            SELECT
                v.projection_group_id,
                v.builder_id,
                v.calendar_month,
                v.ent_plan,
                v.dev_plan,
                v.td_plan,
                v.str_plan,
                v.cmp_plan,
                v.cls_plan,
                v.p_end,
                v.e_end,
                v.d_end,
                v.h_end,
                v.u_end,
                v.uc_end,
                v.c_end,
                v.closed_cumulative
            FROM v_sim_ledger_monthly v
            WHERE v.projection_group_id IN (
                SELECT dpg.projection_group_id
                FROM dim_projection_groups dpg
                JOIN sim_ent_group_developments segd ON dpg.dev_id = segd.dev_id
                WHERE segd.ent_group_id = %s
            )
            AND (
                v.ent_plan > 0 OR v.dev_plan > 0 OR v.td_plan > 0
                OR v.str_plan > 0 OR v.cmp_plan > 0 OR v.cls_plan > 0
                OR v.e_end > 0 OR v.d_end > 0 OR v.h_end > 0
                OR v.u_end > 0 OR v.uc_end > 0 OR v.c_end > 0
            )
            ORDER BY v.projection_group_id, v.builder_id, v.calendar_month
            """,
            (ent_group_id,),
        )
        rows = cur.fetchall()
        if not rows:
            # Not a hard error — may just mean no simulation has been run yet
            return []
        return [
            {
                "projection_group_id": r["projection_group_id"],
                "builder_id": r["builder_id"],
                "calendar_month": r["calendar_month"].isoformat() if r["calendar_month"] else None,
                "ent_plan": r["ent_plan"],
                "dev_plan": r["dev_plan"],
                "td_plan": r["td_plan"],
                "str_plan": r["str_plan"],
                "cmp_plan": r["cmp_plan"],
                "cls_plan": r["cls_plan"],
                "p_end": r["p_end"],
                "e_end": r["e_end"],
                "d_end": r["d_end"],
                "h_end": r["h_end"],
                "u_end": r["u_end"],
                "uc_end": r["uc_end"],
                "c_end": r["c_end"],
                "closed_cumulative": r["closed_cumulative"],
            }
            for r in rows
        ]
    finally:
        cur.close()
