# routers/eg_crud.py
# Entitlement-group list, create, patch.

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from api.deps import get_db_conn
from api.db import dict_cursor


class EntGroupCreateRequest(BaseModel):
    ent_group_name: str


class EntGroupPatchRequest(BaseModel):
    ent_group_name: str


router = APIRouter(prefix="/entitlement-groups", tags=["entitlement-groups"])


@router.get("", response_model=list[dict])
def list_entitlement_groups(conn=Depends(get_db_conn)):
    cur = dict_cursor(conn)
    try:
        # r/p/t rollup per community using developments.community_id as source of truth.
        # Join path: developments → dim_development (bridge for legacy dev_id) →
        #   sim_legal_instruments → sim_dev_phases → sim_lots / sim_phase_product_splits.
        # total = SUM of GREATEST(real_count, projected_count) per phase.
        cur.execute(
            """
            SELECT
                eg.ent_group_id,
                eg.ent_group_name,
                COALESCE(SUM(pt.real_count), 0)::int          AS real_count,
                COALESCE(SUM(pt.projected_count), 0)::int     AS projected_count,
                COALESCE(SUM(
                    GREATEST(pt.real_count, pt.projected_count)
                ), 0)::int                                     AS total_count
            FROM sim_entitlement_groups eg
            LEFT JOIN (
                SELECT
                    d.community_id,
                    sdp.phase_id,
                    COUNT(sl.lot_id) FILTER (WHERE sl.lot_source = 'real') AS real_count,
                    COALESCE(SUM(spps.projected_count), 0)                   AS projected_count
                FROM developments d
                JOIN dim_development dd ON dd.dev_code2 = d.marks_code
                JOIN sim_legal_instruments li ON li.dev_id = dd.development_id
                JOIN sim_dev_phases sdp ON sdp.instrument_id = li.instrument_id
                LEFT JOIN sim_lots sl
                       ON sl.phase_id = sdp.phase_id AND sl.lot_source = 'real'
                LEFT JOIN sim_phase_product_splits spps ON spps.phase_id = sdp.phase_id
                WHERE d.community_id IS NOT NULL
                  AND d.marks_code IS NOT NULL
                GROUP BY d.community_id, sdp.phase_id
            ) pt ON pt.community_id = eg.ent_group_id
            GROUP BY eg.ent_group_id, eg.ent_group_name
            ORDER BY eg.ent_group_name
            """
        )
        return [
            {
                "ent_group_id": r["ent_group_id"],
                "ent_group_name": r["ent_group_name"],
                "real_count": int(r["real_count"]),
                "projected_count": int(r["projected_count"]),
                "total_count": int(r["total_count"]),
            }
            for r in cur.fetchall()
        ]
    finally:
        cur.close()


@router.post("", response_model=dict, status_code=201)
def create_entitlement_group(body: EntGroupCreateRequest, conn=Depends(get_db_conn)):
    name = (body.ent_group_name or "").strip()
    if not name:
        raise HTTPException(status_code=422, detail="ent_group_name is required")
    cur = dict_cursor(conn)
    try:
        cur.execute(
            "INSERT INTO sim_entitlement_groups (ent_group_name) VALUES (%s) RETURNING ent_group_id",
            (name,),
        )
        new_id = int(cur.fetchone()["ent_group_id"])
        conn.commit()
        return {"ent_group_id": new_id, "ent_group_name": name}
    except Exception:
        conn.rollback()
        raise
    finally:
        cur.close()


@router.patch("/{ent_group_id}", response_model=dict)
def patch_entitlement_group(ent_group_id: int, body: EntGroupPatchRequest, conn=Depends(get_db_conn)):
    name = (body.ent_group_name or "").strip()
    if not name:
        raise HTTPException(status_code=422, detail="ent_group_name cannot be empty")
    cur = dict_cursor(conn)
    try:
        cur.execute(
            "UPDATE sim_entitlement_groups SET ent_group_name = %s WHERE ent_group_id = %s",
            (name, ent_group_id),
        )
        if cur.rowcount == 0:
            conn.rollback()
            raise HTTPException(status_code=404, detail=f"Entitlement group {ent_group_id} not found.")
        conn.commit()
        return {"ent_group_id": ent_group_id, "ent_group_name": name}
    except HTTPException:
        raise
    except Exception:
        conn.rollback()
        raise
    finally:
        cur.close()
