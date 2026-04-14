# routers/building_groups.py
# Building group management.
#
# building_type is derived at query time from COUNT(lots in group):
#   1 → villa, 2 → duplex, 3 → triplex, 4 → quad, N → N-plex
# unit_count is derived at query time from COUNT(lots in group).
# Neither is stored on sim_building_groups (migration 056 dropped both columns).
#
# Site-plan endpoints:
# GET  /building-groups/plan/{plan_id}       → list groups with lot positions for a plan
# POST /building-groups                      → create group from lot_ids (site-plan, auto-name)
# DELETE /building-groups/{id}              → remove a single group
# POST /building-groups/bulk-delete         → remove multiple groups
#
# Setup-view endpoints:
# GET  /building-groups/phase/{phase_id}    → buildings + lots for a phase (no plan required)
# POST /building-groups/setup               → create building with name and lot_ids
# PATCH /building-groups/{id}              → rename
# PATCH /building-groups/{id}/lots         → replace lot assignments

from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from api.deps import get_db_conn
from api.db import dict_cursor

router = APIRouter(prefix="/building-groups", tags=["building-groups"])


# ─── Helpers ─────────────────────────────────────────────────────────────────

def _unit_type_label(unit_count: int) -> str:
    """Derive building type label from number of units."""
    labels = {1: "villa", 2: "duplex", 3: "triplex", 4: "quad"}
    return labels.get(unit_count, f"{unit_count}-plex") if unit_count > 0 else "—"


# ─── Pydantic models ─────────────────────────────────────────────────────────

class CreateBuildingGroupRequest(BaseModel):
    lot_ids: List[int]
    dev_id: int
    plan_id: int   # used to return lot positions in the response


class SetupCreateRequest(BaseModel):
    phase_id: int
    building_name: str
    lot_ids: List[int] = []


class PatchBuildingGroupRequest(BaseModel):
    building_name: Optional[str] = None


class PatchLotsRequest(BaseModel):
    lot_ids: List[int]   # full replacement — lots not in this list are unassigned


class BulkDeleteRequest(BaseModel):
    building_group_ids: List[int]


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

    groups: dict[int, list] = {}
    for r in rows:
        gid = r["building_group_id"]
        groups.setdefault(gid, []).append(r)

    result = []
    for gid, g_rows in groups.items():
        first = g_rows[0]
        result.append({
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
                for r in g_rows
            ],
        })
    return result


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
        cur.execute(
            "SELECT COUNT(*) AS cnt FROM sim_building_groups WHERE dev_id = %s",
            (body.dev_id,),
        )
        count = cur.fetchone()["cnt"]
        building_name = f"Building {count + 1}"

        cur.execute(
            """
            INSERT INTO sim_building_groups (dev_id, building_name, created_at)
            VALUES (%s, %s, NOW())
            RETURNING building_group_id
            """,
            (body.dev_id, building_name),
        )
        new_id = cur.fetchone()["building_group_id"]

        cur.execute(
            "UPDATE sim_lots SET building_group_id = %s WHERE lot_id = ANY(%s)",
            (new_id, body.lot_ids),
        )

        conn.commit()

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

    unit_count = len(body.lot_ids)
    return {
        "building_group_id": new_id,
        "dev_id":            body.dev_id,
        "building_name":     building_name,
        "unit_count":        unit_count,
        "building_type":     _unit_type_label(unit_count),
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
    plus all unassigned lots in this phase.
    unit_count and building_type are derived from lot count (not stored).
    """
    with dict_cursor(conn) as cur:
        cur.execute("""
            SELECT bg.building_group_id, bg.building_name,
                   sl.lot_id, sl.lot_number, sl.lot_source, sl.dev_id,
                   d.marks_code AS dev_code2
            FROM sim_building_groups bg
            JOIN sim_lots sl ON sl.building_group_id = bg.building_group_id
            LEFT JOIN developments d ON d.dev_id = sl.dev_id
            WHERE sl.phase_id = %s AND sl.lot_source != 'sim'
            ORDER BY bg.building_name, sl.lot_number
        """, (phase_id,))
        rows = cur.fetchall()

        cur.execute("""
            SELECT sl.lot_id, sl.lot_number, sl.lot_source, sl.dev_id,
                   d.marks_code AS dev_code2
            FROM sim_lots sl
            LEFT JOIN developments d ON d.dev_id = sl.dev_id
            WHERE sl.phase_id = %s
              AND sl.lot_source != 'sim'
              AND sl.building_group_id IS NULL
            ORDER BY sl.lot_number
        """, (phase_id,))
        unassigned = [dict(r) for r in cur.fetchall()]

    buildings: dict[int, dict] = {}
    for r in rows:
        gid = r["building_group_id"]
        if gid not in buildings:
            buildings[gid] = {
                "building_group_id": gid,
                "building_name":     r["building_name"],
                "lots":              [],
            }
        buildings[gid]["lots"].append({
            "lot_id":     r["lot_id"],
            "lot_number": r["lot_number"],
            "lot_source": r["lot_source"],
            "dev_code":   r["dev_code2"],
        })

    # Derive unit_count and building_type from lot count
    for b in buildings.values():
        uc = len(b["lots"])
        b["unit_count"]    = uc
        b["building_type"] = _unit_type_label(uc)

    return {
        "buildings":  list(buildings.values()),
        "unassigned": unassigned,
    }


@router.post("/setup", status_code=201)
def create_building_setup(body: SetupCreateRequest, conn=Depends(get_db_conn)):
    """
    Create a building group with an explicit name, optionally assigning lots.
    building_type and unit_count are derived from lot assignments, not stored.
    """
    name = (body.building_name or "").strip()
    if not name:
        raise HTTPException(status_code=422, detail="building_name is required")

    with dict_cursor(conn) as cur:
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
            INSERT INTO sim_building_groups (dev_id, building_name, created_at)
            VALUES (%s, %s, NOW())
            RETURNING building_group_id
        """, (dev_id, name))
        new_id = cur.fetchone()["building_group_id"]

        if body.lot_ids:
            cur.execute(
                "UPDATE sim_lots SET building_group_id = %s WHERE lot_id = ANY(%s) AND phase_id = %s",
                (new_id, body.lot_ids, body.phase_id),
            )

        conn.commit()

    unit_count = len(body.lot_ids)
    return {
        "building_group_id": new_id,
        "building_name":     name,
        "unit_count":        unit_count,
        "building_type":     _unit_type_label(unit_count),
        "lot_ids":           body.lot_ids,
    }


@router.patch("/{building_group_id}")
def patch_building_group(building_group_id: int, body: PatchBuildingGroupRequest,
                         conn=Depends(get_db_conn)):
    """Rename a building group."""
    if body.building_name is None:
        raise HTTPException(status_code=422, detail="building_name required")
    name = body.building_name.strip()
    if not name:
        raise HTTPException(status_code=422, detail="building_name cannot be empty")

    with dict_cursor(conn) as cur:
        cur.execute(
            "UPDATE sim_building_groups SET building_name = %s WHERE building_group_id = %s",
            (name, building_group_id),
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
    unit_count is derived from the resulting lot count (not stored).
    """
    with dict_cursor(conn) as cur:
        cur.execute(
            "UPDATE sim_lots SET building_group_id = NULL WHERE building_group_id = %s",
            (building_group_id,),
        )
        if body.lot_ids:
            cur.execute(
                "UPDATE sim_lots SET building_group_id = %s WHERE lot_id = ANY(%s)",
                (building_group_id, body.lot_ids),
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
