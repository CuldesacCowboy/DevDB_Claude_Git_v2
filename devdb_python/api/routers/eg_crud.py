# routers/eg_crud.py
# Entitlement-group list, create, patch.

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from typing import Optional

from api.deps import get_db_conn
from api.db import dict_cursor


class EntGroupCreateRequest(BaseModel):
    ent_group_name: str


class EntGroupPatchRequest(BaseModel):
    ent_group_name:     Optional[str] = None
    county_id:          Optional[int] = None
    school_district_id: Optional[int] = None
    status:             Optional[str] = None


router = APIRouter(prefix="/entitlement-groups", tags=["entitlement-groups"])


@router.get("", response_model=list[dict])
def list_entitlement_groups(conn=Depends(get_db_conn)):
    cur = dict_cursor(conn)
    try:
        # r/p/t rollup per community using developments.community_id as source of truth.
        # Join path: developments → sim_legal_instruments → sim_dev_phases → sim_lots / sim_phase_product_splits.
        # total = SUM of GREATEST(real_count, projected_count) per phase.
        cur.execute(
            """
            SELECT
                eg.ent_group_id,
                eg.ent_group_name,
                COALESCE(eg.is_test, FALSE)                   AS is_test,
                eg.status,
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
                JOIN sim_legal_instruments li ON li.dev_id = d.dev_id
                JOIN sim_dev_phases sdp ON sdp.instrument_id = li.instrument_id
                LEFT JOIN sim_lots sl
                       ON sl.phase_id = sdp.phase_id AND sl.lot_source = 'real'
                      AND sl.excluded IS NOT TRUE
                LEFT JOIN sim_phase_product_splits spps ON spps.phase_id = sdp.phase_id
                WHERE d.community_id IS NOT NULL
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
                "is_test": bool(r["is_test"]),
                "status": r["status"],
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


@router.delete("/{ent_group_id}", response_model=dict)
def delete_entitlement_group(ent_group_id: int, conn=Depends(get_db_conn)):
    """Delete a community and cascade-delete all devs, instruments, and phases.
    Lots are unassigned (phase_id NULL) not deleted. Delivery events are also removed."""
    cur = dict_cursor(conn)
    try:
        cur.execute(
            "SELECT ent_group_id FROM sim_entitlement_groups WHERE ent_group_id = %s",
            (ent_group_id,),
        )
        if not cur.fetchone():
            raise HTTPException(status_code=404, detail=f"Community {ent_group_id} not found")

        # Find all developments in this community
        cur.execute(
            "SELECT dev_id FROM developments WHERE community_id = %s",
            (ent_group_id,),
        )
        dev_ids = [r["dev_id"] for r in cur.fetchall()]

        for dev_id in dev_ids:
            cur.execute(
                "SELECT instrument_id FROM sim_legal_instruments WHERE dev_id = %s",
                (dev_id,),
            )
            instr_ids = [r["instrument_id"] for r in cur.fetchall()]
            for instr_id in instr_ids:
                cur.execute("SELECT phase_id FROM sim_dev_phases WHERE instrument_id = %s", (instr_id,))
                phase_ids = [r["phase_id"] for r in cur.fetchall()]
                for phase_id in phase_ids:
                    cur.execute("UPDATE sim_lots SET phase_id = NULL WHERE phase_id = %s", (phase_id,))
                    cur.execute("DELETE FROM sim_phase_product_splits WHERE phase_id = %s", (phase_id,))
                    cur.execute("DELETE FROM sim_phase_builder_splits WHERE phase_id = %s", (phase_id,))
                    cur.execute("DELETE FROM sim_delivery_event_phases WHERE phase_id = %s", (phase_id,))
                cur.execute("DELETE FROM sim_dev_phases WHERE instrument_id = %s", (instr_id,))
            if instr_ids:
                cur.execute("DELETE FROM sim_legal_instruments WHERE instrument_id = ANY(%s)", (instr_ids,))

        if dev_ids:
            cur.execute("DELETE FROM developments WHERE dev_id = ANY(%s)", (dev_ids,))

        # Remove delivery events and config for this group
        cur.execute("DELETE FROM sim_entitlement_delivery_config WHERE ent_group_id = %s", (ent_group_id,))
        cur.execute("""
            DELETE FROM sim_delivery_events WHERE ent_group_id = %s
        """, (ent_group_id,))
        cur.execute("DELETE FROM sim_ent_group_developments WHERE ent_group_id = %s", (ent_group_id,))
        cur.execute("DELETE FROM sim_entitlement_groups WHERE ent_group_id = %s", (ent_group_id,))
        conn.commit()
        return {"success": True, "ent_group_id": ent_group_id, "devs_deleted": len(dev_ids)}
    except HTTPException:
        conn.rollback()
        raise
    except Exception:
        conn.rollback()
        raise
    finally:
        cur.close()


@router.patch("/{ent_group_id}", response_model=dict)
def patch_entitlement_group(ent_group_id: int, body: EntGroupPatchRequest, conn=Depends(get_db_conn)):
    provided = body.model_fields_set
    if not provided:
        return {"ent_group_id": ent_group_id}

    clauses, params = [], []
    if "ent_group_name" in provided:
        name = (body.ent_group_name or "").strip()
        if not name:
            raise HTTPException(status_code=422, detail="ent_group_name cannot be empty")
        clauses.append("ent_group_name = %s")
        params.append(name)
    if "county_id" in provided:
        clauses.append("county_id = %s")
        params.append(body.county_id)
    if "school_district_id" in provided:
        clauses.append("school_district_id = %s")
        params.append(body.school_district_id)
    if "status" in provided:
        clauses.append("status = %s")
        params.append(body.status)

    params.append(ent_group_id)
    cur = dict_cursor(conn)
    try:
        cur.execute(
            f"UPDATE sim_entitlement_groups SET {', '.join(clauses)} "
            f"WHERE ent_group_id = %s "
            f"RETURNING ent_group_id, ent_group_name, county_id, school_district_id, status",
            params,
        )
        row = cur.fetchone()
        if not row:
            conn.rollback()
            raise HTTPException(status_code=404, detail=f"Entitlement group {ent_group_id} not found.")
        conn.commit()
        return {
            "ent_group_id":        row["ent_group_id"],
            "ent_group_name":      row["ent_group_name"],
            "county_id":           row["county_id"],
            "school_district_id":  row["school_district_id"],
            "status":              row["status"],
        }
    except HTTPException:
        raise
    except Exception:
        conn.rollback()
        raise
    finally:
        cur.close()
