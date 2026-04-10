# routers/building_groups.py
# Building group management.
#
# Site-plan endpoints (existing):
# GET  /building-groups/plan/{plan_id}       → list groups with lot positions for a plan
# POST /building-groups                      → create group from lot_ids (site-plan, auto-name)
# DELETE /building-groups/{id}              → remove a single group
# POST /building-groups/bulk-delete         → remove multiple groups
#
# Setup-view endpoints (new):
# GET  /building-groups/phase/{phase_id}    → buildings + lots for a phase (no plan required)
# POST /building-groups/setup               → create building with name, type, lot_ids
# PATCH /building-groups/{id}              → rename / retype
# PATCH /building-groups/{id}/lots         → replace lot assignments

from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from api.deps import get_db_conn
from api.db import dict_cursor

router = APIRouter(prefix="/building-groups", tags=["building-groups"])


# ─── Pydantic models ─────────────────────────────────────────────────────────

class CreateBuildingGroupRequest(BaseModel):
    lot_ids: List[int]
    dev_id: int
    plan_id: int   # used to return lot positions in the response


class SetupCreateRequest(BaseModel):
    phase_id: int
    building_name: str
    building_type: Optional[str] = None
    lot_ids: List[int] = []


class PatchBuildingGroupRequest(BaseModel):
    building_name: Optional[str] = None
    building_type: Optional[str] = None


class PatchLotsRequest(BaseModel):
    lot_ids: List[int]   # full replacement — lots not in this list are unassigned


class BulkDeleteRequest(BaseModel):
    building_group_ids: List[int]


# ─── Helpers ─────────────────────────────────────────────────────────────────

def _format_group(rows: list) -> dict:
    """Collapse per-lot rows for a single building group into one dict."""
    if not rows:
        return {}
    first = rows[0]
    return {
        "building_group_id": first["building_group_id"],
        "dev_id":            first["dev_id"],
        "building_name":     first["building_name"],
        "lots": [
            {
                "lot_id":     r["lot_id"],
                "lot_number": r["lot_number"],
                "x":          float(r["x"]),
                "y":          float(r["y"]),
            }
            for r in rows
        ],
    }


# ─── Endpoints ───────────────────────────────────────────────────────────────

@router.get("/plan/{plan_id}")
def get_building_groups_for_plan(plan_id: int, conn=Depends(get_db_conn)):
    """
    Return all building groups that have at least one lot positioned on this plan.
    Each group includes the normalized (x, y) positions of its lots on the plan.
    """
    with dict_cursor(conn) as cur:
        cur.execute(
            """
            SELECT
                bg.building_group_id,
                bg.dev_id,
                bg.building_name,
                sl.lot_id,
                sl.lot_number,
                lsp.x,
                lsp.y
            FROM sim_building_groups bg
            JOIN sim_lots sl
                ON sl.building_group_id = bg.building_group_id
            JOIN sim_lot_site_positions lsp
                ON lsp.lot_id = sl.lot_id AND lsp.plan_id = %s
            ORDER BY bg.building_group_id, sl.lot_id
            """,
            (plan_id,),
        )
        rows = cur.fetchall()

    # Group rows by building_group_id
    groups: dict[int, list] = {}
    for r in rows:
        gid = r["building_group_id"]
        groups.setdefault(gid, []).append(r)

    return [_format_group(g) for g in groups.values()]


@router.post("")
def create_building_group(body: CreateBuildingGroupRequest, conn=Depends(get_db_conn)):
    """
    Create a new building group containing the given lots.
    building_name is auto-generated as 'Building N' where N = existing group count + 1.
    Returns the new group including lot positions on the specified plan.
    """
    if not body.lot_ids:
        raise HTTPException(status_code=422, detail="lot_ids cannot be empty")

    with dict_cursor(conn) as cur:
        # Auto-generate a name
        cur.execute(
            "SELECT COUNT(*) AS cnt FROM sim_building_groups WHERE dev_id = %s",
            (body.dev_id,),
        )
        count = cur.fetchone()["cnt"]
        building_name = f"Building {count + 1}"

        # Insert the new group
        cur.execute(
            """
            INSERT INTO sim_building_groups (dev_id, building_name, unit_count, created_at)
            VALUES (%s, %s, %s, NOW())
            RETURNING building_group_id
            """,
            (body.dev_id, building_name, len(body.lot_ids)),
        )
        new_id = cur.fetchone()["building_group_id"]

        # Assign lots to this group
        cur.execute(
            "UPDATE sim_lots SET building_group_id = %s WHERE lot_id = ANY(%s)",
            (new_id, body.lot_ids),
        )

        conn.commit()

        # Return the new group with lot positions on the given plan
        cur.execute(
            """
            SELECT sl.lot_id, sl.lot_number, lsp.x, lsp.y
            FROM sim_lots sl
            JOIN sim_lot_site_positions lsp
                ON lsp.lot_id = sl.lot_id AND lsp.plan_id = %s
            WHERE sl.building_group_id = %s
            ORDER BY sl.lot_id
            """,
            (body.plan_id, new_id),
        )
        lots = cur.fetchall()

    return {
        "building_group_id": new_id,
        "dev_id":            body.dev_id,
        "building_name":     building_name,
        "lots": [
            {"lot_id": r["lot_id"], "lot_number": r["lot_number"],
             "x": float(r["x"]), "y": float(r["y"])}
            for r in lots
        ],
    }


# ─── Setup-view endpoints ─────────────────────────────────────────────────────

@router.get("/phase/{phase_id}")
def get_buildings_for_phase(phase_id: int, conn=Depends(get_db_conn)):
    """
    Return all building groups that have at least one lot in this phase,
    plus all unassigned lots in this phase. No plan_id required.
    """
    with dict_cursor(conn) as cur:
        # Buildings with their lots
        cur.execute("""
            SELECT bg.building_group_id, bg.building_name, bg.building_type,
                   sl.lot_id, sl.lot_number, sl.lot_source, sl.dev_id,
                   dd.dev_code2
            FROM sim_building_groups bg
            JOIN sim_lots sl ON sl.building_group_id = bg.building_group_id
            LEFT JOIN dim_development dd ON dd.development_id = sl.dev_id
            WHERE sl.phase_id = %s AND sl.lot_source != 'sim'
            ORDER BY bg.building_name, sl.lot_number
        """, (phase_id,))
        rows = cur.fetchall()

        # Unassigned lots in this phase
        cur.execute("""
            SELECT sl.lot_id, sl.lot_number, sl.lot_source, sl.dev_id,
                   dd.dev_code2
            FROM sim_lots sl
            LEFT JOIN dim_development dd ON dd.development_id = sl.dev_id
            WHERE sl.phase_id = %s
              AND sl.lot_source != 'sim'
              AND sl.building_group_id IS NULL
            ORDER BY sl.lot_number
        """, (phase_id,))
        unassigned = [dict(r) for r in cur.fetchall()]

    # Collapse per-lot rows into per-building dicts
    buildings: dict[int, dict] = {}
    for r in rows:
        gid = r["building_group_id"]
        if gid not in buildings:
            buildings[gid] = {
                "building_group_id": gid,
                "building_name":     r["building_name"],
                "building_type":     r["building_type"],
                "lots": [],
            }
        buildings[gid]["lots"].append({
            "lot_id":     r["lot_id"],
            "lot_number": r["lot_number"],
            "lot_source": r["lot_source"],
            "dev_code":   r["dev_code2"],
        })

    return {
        "buildings":  list(buildings.values()),
        "unassigned": unassigned,
    }


@router.post("/setup", status_code=201)
def create_building_setup(body: SetupCreateRequest, conn=Depends(get_db_conn)):
    """
    Create a building group with an explicit name and type, optionally assigning lots.
    Used by the Setup view — no plan_id needed.
    """
    name = (body.building_name or "").strip()
    if not name:
        raise HTTPException(status_code=422, detail="building_name is required")

    with dict_cursor(conn) as cur:
        # Resolve dev_id from the phase (use first assigned lot, or phase.dev_id)
        cur.execute("""
            SELECT COALESCE(
                (SELECT sl.dev_id FROM sim_lots sl
                 WHERE sl.phase_id = %s AND sl.lot_source != 'sim' LIMIT 1),
                p.dev_id
            ) AS dev_id
            FROM sim_dev_phases p WHERE p.phase_id = %s
        """, (body.phase_id, body.phase_id))
        row = cur.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Phase not found")
        dev_id = row["dev_id"]

        cur.execute("""
            INSERT INTO sim_building_groups (dev_id, building_name, building_type, unit_count, created_at)
            VALUES (%s, %s, %s, %s, NOW())
            RETURNING building_group_id
        """, (dev_id, name, body.building_type, len(body.lot_ids) or None))
        new_id = cur.fetchone()["building_group_id"]

        if body.lot_ids:
            cur.execute(
                "UPDATE sim_lots SET building_group_id = %s WHERE lot_id = ANY(%s) AND phase_id = %s",
                (new_id, body.lot_ids, body.phase_id),
            )

        conn.commit()

    return {"building_group_id": new_id, "building_name": name,
            "building_type": body.building_type, "lot_ids": body.lot_ids}


@router.patch("/{building_group_id}")
def patch_building_group(building_group_id: int, body: PatchBuildingGroupRequest,
                         conn=Depends(get_db_conn)):
    """Rename and/or retype a building group."""
    if body.building_name is None and body.building_type is None:
        raise HTTPException(status_code=422, detail="Nothing to update")

    sets, params = [], []
    if body.building_name is not None:
        name = body.building_name.strip()
        if not name:
            raise HTTPException(status_code=422, detail="building_name cannot be empty")
        sets.append("building_name = %s"); params.append(name)
    if body.building_type is not None:
        sets.append("building_type = %s"); params.append(body.building_type)

    params.append(building_group_id)
    with dict_cursor(conn) as cur:
        cur.execute(
            f"UPDATE sim_building_groups SET {', '.join(sets)} WHERE building_group_id = %s",
            params,
        )
        if cur.rowcount == 0:
            raise HTTPException(status_code=404, detail="Building group not found")
        conn.commit()
    return {"building_group_id": building_group_id}


@router.patch("/{building_group_id}/lots")
def patch_building_lots(building_group_id: int, body: PatchLotsRequest,
                        conn=Depends(get_db_conn)):
    """
    Replace the lot assignments for a building group.
    Lots currently in the group but not in lot_ids are unassigned.
    Lots in lot_ids are assigned (removed from any prior group first).
    """
    with dict_cursor(conn) as cur:
        # Unassign any lots currently in this group
        cur.execute(
            "UPDATE sim_lots SET building_group_id = NULL WHERE building_group_id = %s",
            (building_group_id,),
        )
        if body.lot_ids:
            cur.execute(
                "UPDATE sim_lots SET building_group_id = %s WHERE lot_id = ANY(%s)",
                (building_group_id, body.lot_ids),
            )
            cur.execute(
                "UPDATE sim_building_groups SET unit_count = %s WHERE building_group_id = %s",
                (len(body.lot_ids), building_group_id),
            )
        conn.commit()
    return {"building_group_id": building_group_id, "lot_ids": body.lot_ids}


# NOTE: bulk-delete must be registered BEFORE /{building_group_id} so FastAPI
# does not treat the literal string "bulk-delete" as an integer path param.
@router.post("/bulk-delete")
def bulk_delete_building_groups(body: BulkDeleteRequest, conn=Depends(get_db_conn)):
    """Remove multiple building groups and clear lot assignments for all of them."""
    if not body.building_group_ids:
        return {"deleted": 0}

    with conn.cursor() as cur:
        cur.execute(
            "UPDATE sim_lots SET building_group_id = NULL WHERE building_group_id = ANY(%s)",
            (body.building_group_ids,),
        )
        cur.execute(
            "DELETE FROM sim_building_groups WHERE building_group_id = ANY(%s)",
            (body.building_group_ids,),
        )
        conn.commit()

    return {"deleted": len(body.building_group_ids)}


@router.delete("/{building_group_id}")
def delete_building_group(building_group_id: int, conn=Depends(get_db_conn)):
    """Remove a single building group and clear its lot assignments."""
    with conn.cursor() as cur:
        cur.execute(
            "UPDATE sim_lots SET building_group_id = NULL WHERE building_group_id = %s",
            (building_group_id,),
        )
        cur.execute(
            "DELETE FROM sim_building_groups WHERE building_group_id = %s",
            (building_group_id,),
        )
        conn.commit()

    return {"success": True, "building_group_id": building_group_id}
