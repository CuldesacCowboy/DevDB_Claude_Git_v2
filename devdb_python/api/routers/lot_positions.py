# routers/lot_positions.py
# Lot-on-site-plan positioning: read positions, bulk save with phase assignment.
#
# GET  /lot-positions/plan/{plan_id}       → {positioned, bank}
# POST /lot-positions/plan/{plan_id}/save  → bulk upsert positions + phase updates

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from api.deps import get_db_conn
from api.db import dict_cursor

router = APIRouter(prefix="/lot-positions", tags=["lot-positions"])


# ─── Pydantic models ─────────────────────────────────────────────────────────

class LotPositionUpdate(BaseModel):
    lot_id: int
    x: float
    y: float
    phase_id: Optional[int] = None


class SavePositionsRequest(BaseModel):
    updates: list[LotPositionUpdate] = []
    removes: list[int] = []          # lot_ids to remove from plan (outside all polygons)


# ─── Helpers ─────────────────────────────────────────────────────────────────

def _ent_group_id_for_plan(cur, plan_id: int) -> int:
    cur.execute(
        "SELECT ent_group_id FROM devdb.sim_site_plans WHERE plan_id = %s",
        (plan_id,),
    )
    row = cur.fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Plan not found")
    return row["ent_group_id"]


def _fetch_lots(cur, plan_id: int, ent_group_id: int) -> list[dict]:
    """
    All real lots for this ent_group, joined to current site positions.

    Uses a union CTE so that lots whose phase_id was cleared to NULL (placed in an
    unassigned polygon) are still returned — they remain findable via the position
    record even when the normal community-chain JOIN produces no match.
    """
    cur.execute(
        """
        WITH community_lot_ids AS (
            -- Lots reachable through the full community chain (phase_id not null)
            SELECT sl.lot_id
            FROM devdb.sim_lots sl
            JOIN devdb.sim_dev_phases sdp ON sdp.phase_id = sl.phase_id
            JOIN devdb.developments d     ON d.dev_id = sdp.dev_id
            WHERE sl.lot_source = 'real'
              AND d.community_id = %s
            UNION
            -- Also include any lot currently positioned on this plan (phase may be NULL)
            SELECT lsp.lot_id
            FROM devdb.sim_lot_site_positions lsp
            WHERE lsp.plan_id = %s
        )
        SELECT
            sl.lot_id,
            sl.lot_number,
            sl.phase_id,
            sdp.instrument_id,
            sdp.phase_name,
            li.instrument_name,
            lsp.x,
            lsp.y
        FROM community_lot_ids cli
        JOIN devdb.sim_lots sl              ON sl.lot_id = cli.lot_id
        LEFT JOIN devdb.sim_dev_phases sdp  ON sdp.phase_id = sl.phase_id
        LEFT JOIN devdb.sim_legal_instruments li ON li.instrument_id = sdp.instrument_id
        LEFT JOIN devdb.sim_lot_site_positions lsp
               ON lsp.lot_id = sl.lot_id AND lsp.plan_id = %s
        ORDER BY sl.lot_number
        """,
        (ent_group_id, plan_id, plan_id),
    )
    return cur.fetchall()


def _format_lot(r: dict) -> dict:
    return {
        "lot_id":          r["lot_id"],
        "lot_number":      r["lot_number"],
        "phase_id":        r["phase_id"],
        "phase_name":      r["phase_name"],
        "instrument_id":   r["instrument_id"],
        "instrument_name": r["instrument_name"],
    }


def _split_rows(rows: list[dict]) -> tuple[list[dict], list[dict]]:
    """Split rows into positioned (have x/y) and bank (no x/y)."""
    positioned, bank = [], []
    for r in rows:
        if r["x"] is not None:
            positioned.append({**_format_lot(r), "x": float(r["x"]), "y": float(r["y"])})
        else:
            bank.append(_format_lot(r))
    return positioned, bank


# ─── Endpoints ───────────────────────────────────────────────────────────────

@router.get("/plan/{plan_id}")
def get_lot_positions(plan_id: int, conn=Depends(get_db_conn)):
    cur = dict_cursor(conn)
    try:
        ent_group_id = _ent_group_id_for_plan(cur, plan_id)
        rows = _fetch_lots(cur, plan_id, ent_group_id)
        positioned, bank = _split_rows(rows)
        return {"plan_id": plan_id, "positioned": positioned, "bank": bank}
    finally:
        cur.close()


@router.post("/plan/{plan_id}/save")
def save_lot_positions(
    plan_id: int, body: SavePositionsRequest, conn=Depends(get_db_conn)
):
    cur = dict_cursor(conn)
    try:
        ent_group_id = _ent_group_id_for_plan(cur, plan_id)

        # Remove position records for lots explicitly taken off the map.
        # Do NOT clear phase_id — the lot returns to the bank with its assignment intact,
        # and the community-chain query can still find it.
        if body.removes:
            cur.execute(
                "DELETE FROM devdb.sim_lot_site_positions WHERE lot_id = ANY(%s) AND plan_id = %s",
                (body.removes, plan_id),
            )

        # Upsert positions and apply phase assignments determined by spatial containment.
        for u in body.updates:
            cur.execute(
                """
                INSERT INTO devdb.sim_lot_site_positions (lot_id, plan_id, x, y, updated_at)
                VALUES (%s, %s, %s, %s, NOW())
                ON CONFLICT (lot_id) DO UPDATE SET
                    plan_id    = EXCLUDED.plan_id,
                    x          = EXCLUDED.x,
                    y          = EXCLUDED.y,
                    updated_at = NOW()
                """,
                (u.lot_id, plan_id, u.x, u.y),
            )
            # Always update phase — computed by client point-in-polygon.
            # phase_id = None means inside unassigned polygon; we clear the old assignment.
            cur.execute(
                "UPDATE devdb.sim_lots SET phase_id = %s WHERE lot_id = %s",
                (u.phase_id, u.lot_id),
            )

        conn.commit()

        # Return fresh state
        rows = _fetch_lots(cur, plan_id, ent_group_id)
        positioned, bank = _split_rows(rows)
        return {"plan_id": plan_id, "positioned": positioned, "bank": bank}

    except HTTPException:
        raise
    except Exception:
        conn.rollback()
        raise
    finally:
        cur.close()
