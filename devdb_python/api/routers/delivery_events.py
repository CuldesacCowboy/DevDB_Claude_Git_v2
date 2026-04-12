# routers/delivery_events.py
# CRUD for delivery events and phase assignments within an entitlement group.

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from api.deps import get_db_conn
from api.db import dict_cursor

router = APIRouter(prefix="/entitlement-groups", tags=["delivery-events"])


def _d(v):
    return v.isoformat() if v else None


# ─── List ─────────────────────────────────────────────────────────────────────

@router.get("/{ent_group_id}/delivery-events", response_model=list[dict])
def list_delivery_events(ent_group_id: int, conn=Depends(get_db_conn)):
    """List all delivery events for a community with their assigned phase IDs."""
    cur = dict_cursor(conn)
    try:
        cur.execute("""
            SELECT
                sde.delivery_event_id,
                sde.event_name,
                sde.date_dev_actual,
                sde.date_dev_projected,
                sde.is_auto_created,
                COALESCE(
                    ARRAY_AGG(dep.phase_id ORDER BY dep.phase_id) FILTER (WHERE dep.phase_id IS NOT NULL),
                    '{}'::bigint[]
                ) AS phase_ids
            FROM sim_delivery_events sde
            LEFT JOIN sim_delivery_event_phases dep ON dep.delivery_event_id = sde.delivery_event_id
            WHERE sde.ent_group_id = %s
            GROUP BY sde.delivery_event_id, sde.event_name, sde.date_dev_actual,
                     sde.date_dev_projected, sde.is_auto_created
            ORDER BY COALESCE(sde.date_dev_actual, sde.date_dev_projected) NULLS LAST,
                     sde.delivery_event_id
        """, (ent_group_id,))
        return [
            {
                "delivery_event_id": r["delivery_event_id"],
                "event_name":        r["event_name"] or "",
                "date_dev_actual":   _d(r["date_dev_actual"]),
                "date_dev_projected": _d(r["date_dev_projected"]),
                "is_auto_created":   bool(r["is_auto_created"]),
                "phase_ids":         [int(p) for p in r["phase_ids"]],
            }
            for r in cur.fetchall()
        ]
    finally:
        cur.close()


# ─── Create ───────────────────────────────────────────────────────────────────

class DeliveryEventCreateRequest(BaseModel):
    event_name: str
    date_dev_actual: str | None = None    # ISO date string


@router.post("/{ent_group_id}/delivery-events", response_model=dict, status_code=201)
def create_delivery_event(ent_group_id: int, body: DeliveryEventCreateRequest, conn=Depends(get_db_conn)):
    name = (body.event_name or "").strip()
    if not name:
        raise HTTPException(status_code=422, detail="event_name is required")
    cur = dict_cursor(conn)
    try:
        cur.execute(
            """
            INSERT INTO sim_delivery_events
                (ent_group_id, event_name, date_dev_actual, is_auto_created, is_placeholder)
            VALUES (%s, %s, %s::date, false, false)
            RETURNING delivery_event_id, event_name, date_dev_actual, date_dev_projected
            """,
            (ent_group_id, name, body.date_dev_actual),
        )
        r = cur.fetchone()
        conn.commit()
        return {
            "delivery_event_id": r["delivery_event_id"],
            "event_name":        r["event_name"],
            "date_dev_actual":   _d(r["date_dev_actual"]),
            "date_dev_projected": _d(r["date_dev_projected"]),
            "is_auto_created":   False,
            "phase_ids":         [],
        }
    except Exception:
        conn.rollback()
        raise
    finally:
        cur.close()


# ─── Patch ────────────────────────────────────────────────────────────────────

class DeliveryEventPatchRequest(BaseModel):
    event_name: str | None = None
    date_dev_actual: str | None = None    # ISO date string, or "" to clear


@router.patch("/{ent_group_id}/delivery-events/{event_id}", response_model=dict)
def patch_delivery_event(ent_group_id: int, event_id: int, body: DeliveryEventPatchRequest, conn=Depends(get_db_conn)):
    cur = dict_cursor(conn)
    try:
        cur.execute(
            "SELECT delivery_event_id FROM sim_delivery_events WHERE delivery_event_id = %s AND ent_group_id = %s",
            (event_id, ent_group_id),
        )
        if not cur.fetchone():
            raise HTTPException(status_code=404, detail=f"Delivery event {event_id} not found")

        updates = {}
        if body.event_name is not None:
            name = body.event_name.strip()
            if not name:
                raise HTTPException(status_code=422, detail="event_name cannot be empty")
            updates["event_name"] = name
        if body.date_dev_actual is not None:
            updates["date_dev_actual"] = body.date_dev_actual or None

        if not updates:
            raise HTTPException(status_code=422, detail="No fields to update")

        set_clause = ", ".join(f"{k} = %s" for k in updates)
        set_clause += ", updated_at = NOW()"
        values = list(updates.values()) + [event_id]
        cur.execute(f"UPDATE sim_delivery_events SET {set_clause} WHERE delivery_event_id = %s", values)
        conn.commit()
        return {"delivery_event_id": event_id, **updates}
    except HTTPException:
        conn.rollback()
        raise
    except Exception:
        conn.rollback()
        raise
    finally:
        cur.close()


# ─── Delete ───────────────────────────────────────────────────────────────────

@router.delete("/{ent_group_id}/delivery-events/{event_id}", response_model=dict)
def delete_delivery_event(ent_group_id: int, event_id: int, conn=Depends(get_db_conn)):
    cur = dict_cursor(conn)
    try:
        cur.execute(
            "SELECT delivery_event_id FROM sim_delivery_events WHERE delivery_event_id = %s AND ent_group_id = %s",
            (event_id, ent_group_id),
        )
        if not cur.fetchone():
            raise HTTPException(status_code=404, detail=f"Delivery event {event_id} not found")
        cur.execute("DELETE FROM sim_delivery_event_phases WHERE delivery_event_id = %s", (event_id,))
        cur.execute("DELETE FROM sim_delivery_events WHERE delivery_event_id = %s", (event_id,))
        conn.commit()
        return {"success": True, "delivery_event_id": event_id}
    except HTTPException:
        conn.rollback()
        raise
    except Exception:
        conn.rollback()
        raise
    finally:
        cur.close()


# ─── Phase assignment ─────────────────────────────────────────────────────────

@router.post("/{ent_group_id}/delivery-events/{event_id}/phases/{phase_id}", response_model=dict, status_code=201)
def assign_phase(ent_group_id: int, event_id: int, phase_id: int, conn=Depends(get_db_conn)):
    cur = dict_cursor(conn)
    try:
        cur.execute(
            "SELECT delivery_event_id FROM sim_delivery_events WHERE delivery_event_id = %s AND ent_group_id = %s",
            (event_id, ent_group_id),
        )
        if not cur.fetchone():
            raise HTTPException(status_code=404, detail=f"Delivery event {event_id} not found")
        # Upsert — already assigned is a no-op
        cur.execute(
            "SELECT 1 FROM sim_delivery_event_phases WHERE delivery_event_id = %s AND phase_id = %s",
            (event_id, phase_id),
        )
        if not cur.fetchone():
            cur.execute(
                "INSERT INTO sim_delivery_event_phases (delivery_event_id, phase_id) VALUES (%s, %s)",
                (event_id, phase_id),
            )
        conn.commit()
        return {"delivery_event_id": event_id, "phase_id": phase_id}
    except HTTPException:
        conn.rollback()
        raise
    except Exception:
        conn.rollback()
        raise
    finally:
        cur.close()


@router.delete("/{ent_group_id}/delivery-events/{event_id}/phases/{phase_id}", response_model=dict)
def unassign_phase(ent_group_id: int, event_id: int, phase_id: int, conn=Depends(get_db_conn)):
    cur = dict_cursor(conn)
    try:
        cur.execute(
            "DELETE FROM sim_delivery_event_phases WHERE delivery_event_id = %s AND phase_id = %s",
            (event_id, phase_id),
        )
        conn.commit()
        return {"delivery_event_id": event_id, "phase_id": phase_id}
    except Exception:
        conn.rollback()
        raise
    finally:
        cur.close()
