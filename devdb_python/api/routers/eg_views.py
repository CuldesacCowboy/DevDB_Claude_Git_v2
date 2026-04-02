# routers/eg_views.py
# Entitlement-group complex views and entitlement events CRUD.

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from api.deps import get_db_conn
from api.db import dict_cursor
from api.models.lot_models import EntGroupLotPhaseViewResponse
from services.eg_lot_phase_service import query_lot_phase_view


class EntitlementEventCreateRequest(BaseModel):
    dev_id: int
    event_date: str   # ISO date string
    lots_entitled: int
    notes: str | None = None


class EntitlementEventUpdateRequest(BaseModel):
    dev_id: int | None = None
    event_date: str | None = None
    lots_entitled: int | None = None
    notes: str | None = None


router = APIRouter(prefix="/entitlement-groups", tags=["entitlement-groups"])


@router.get("/{ent_group_id}/lot-phase-view", response_model=EntGroupLotPhaseViewResponse)
def ent_group_lot_phase_view(ent_group_id: int, conn=Depends(get_db_conn)):
    return query_lot_phase_view(ent_group_id, conn)


@router.get("/{ent_group_id}/entitlement-events")
def list_entitlement_events(ent_group_id: int, conn=Depends(get_db_conn)):
    """List all entitlement events for an entitlement group."""
    cur = dict_cursor(conn)
    try:
        cur.execute(
            """
            SELECT ee.event_id, ee.dev_id, d.dev_name,
                   ee.event_date, ee.lots_entitled, ee.notes
            FROM sim_entitlement_events ee
            JOIN dim_development dd ON dd.development_id = ee.dev_id
            JOIN developments d ON d.marks_code = dd.dev_code2
            WHERE ee.ent_group_id = %s
            ORDER BY ee.event_date, ee.dev_id
            """,
            (ent_group_id,),
        )
        return [
            {
                "event_id":      r["event_id"],
                "dev_id":        r["dev_id"],
                "dev_name":      r["dev_name"],
                "event_date":    r["event_date"].isoformat(),
                "lots_entitled": r["lots_entitled"],
                "notes":         r["notes"],
            }
            for r in cur.fetchall()
        ]
    finally:
        cur.close()


@router.post("/{ent_group_id}/entitlement-events", status_code=201)
def create_entitlement_event(
    ent_group_id: int,
    body: EntitlementEventCreateRequest,
    conn=Depends(get_db_conn),
):
    """Create a new entitlement event."""
    cur = dict_cursor(conn)
    try:
        cur.execute("SELECT COALESCE(MAX(event_id), 0) + 1 AS next_id FROM sim_entitlement_events")
        next_id = cur.fetchone()["next_id"]
        cur.execute(
            """
            INSERT INTO sim_entitlement_events
                (event_id, ent_group_id, dev_id, event_date, lots_entitled, notes)
            VALUES (%s, %s, %s, %s, %s, %s)
            RETURNING event_id, dev_id, event_date, lots_entitled, notes
            """,
            (next_id, ent_group_id, body.dev_id, body.event_date,
             body.lots_entitled, body.notes),
        )
        conn.commit()
        row = cur.fetchone()
        return {
            "event_id":      row["event_id"],
            "dev_id":        row["dev_id"],
            "event_date":    row["event_date"].isoformat(),
            "lots_entitled": row["lots_entitled"],
            "notes":         row["notes"],
        }
    finally:
        cur.close()


@router.patch("/{ent_group_id}/entitlement-events/{event_id}")
def update_entitlement_event(
    ent_group_id: int,
    event_id: int,
    body: EntitlementEventUpdateRequest,
    conn=Depends(get_db_conn),
):
    """Update fields on an entitlement event."""
    cur = dict_cursor(conn)
    try:
        updates = {}
        if body.dev_id is not None:        updates["dev_id"] = body.dev_id
        if body.event_date is not None:    updates["event_date"] = body.event_date
        if body.lots_entitled is not None: updates["lots_entitled"] = body.lots_entitled
        if body.notes is not None:         updates["notes"] = body.notes
        if not updates:
            raise HTTPException(status_code=422, detail="No fields to update")
        set_clause = ", ".join(f"{k} = %s" for k in updates)
        cur.execute(
            f"""
            UPDATE sim_entitlement_events
            SET {set_clause}
            WHERE event_id = %s AND ent_group_id = %s
            RETURNING event_id, dev_id, event_date, lots_entitled, notes
            """,
            (*updates.values(), event_id, ent_group_id),
        )
        conn.commit()
        row = cur.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Event not found")
        return {
            "event_id":      row["event_id"],
            "dev_id":        row["dev_id"],
            "event_date":    row["event_date"].isoformat(),
            "lots_entitled": row["lots_entitled"],
            "notes":         row["notes"],
        }
    finally:
        cur.close()


@router.delete("/{ent_group_id}/entitlement-events/{event_id}", status_code=204)
def delete_entitlement_event(
    ent_group_id: int,
    event_id: int,
    conn=Depends(get_db_conn),
):
    """Delete an entitlement event."""
    cur = conn.cursor()
    try:
        cur.execute(
            "DELETE FROM sim_entitlement_events WHERE event_id = %s AND ent_group_id = %s",
            (event_id, ent_group_id),
        )
        conn.commit()
    finally:
        cur.close()
