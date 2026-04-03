# routers/building_groups.py
# Building group management for the site-plan view.
#
# GET  /building-groups/plan/{plan_id}       → list groups with lot positions for a plan
# POST /building-groups                      → create a new group from a list of lot_ids
# DELETE /building-groups/{id}              → remove a single group (clears lot assignments)
# POST /building-groups/bulk-delete         → remove multiple groups at once

from typing import List

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
