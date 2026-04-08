# routers/lots.py
# Lot management endpoints.

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from api.db import dict_cursor

from api.deps import get_db_conn
from api.models.lot_models import (
    ErrorResponse,
    LotPhaseReassignRequest,
    LotPhaseReassignResponse,
    LotTypeChangeRequest,
    LotTypeChangeResponse,
    LotUnassignResponse,
)
from services.lot_assignment_service import (
    change_lot_type,
    reassign_lot_to_phase,
    unassign_lot_from_phase,
)

router = APIRouter(prefix="/lots", tags=["lots"])


@router.patch(
    "/{lot_id}/phase",
    response_model=LotPhaseReassignResponse,
    responses={422: {"model": ErrorResponse}},
)
async def reassign_lot_phase(
    lot_id: int,
    body: LotPhaseReassignRequest,
    conn=Depends(get_db_conn),
):
    result = reassign_lot_to_phase(
        conn, lot_id, body.target_phase_id, body.changed_by
    )
    if not result.success:
        raise HTTPException(status_code=422, detail=result.error)
    return result


@router.patch(
    "/{lot_id}/lot-type",
    response_model=LotTypeChangeResponse,
    responses={422: {"model": ErrorResponse}},
)
async def change_lot_type_endpoint(
    lot_id: int,
    body: LotTypeChangeRequest,
    conn=Depends(get_db_conn),
):
    result = change_lot_type(conn, lot_id, body.lot_type_id, body.changed_by)
    if not result.success:
        raise HTTPException(status_code=422, detail=result.error)
    return result


@router.delete(
    "/{lot_id}/phase",
    response_model=LotUnassignResponse,
    responses={422: {"model": ErrorResponse}},
)
async def unassign_lot_phase(
    lot_id: int,
    changed_by: str = Query(default="user"),
    conn=Depends(get_db_conn),
):
    result = unassign_lot_from_phase(conn, lot_id, changed_by)
    if not result.success:
        raise HTTPException(status_code=422, detail=result.error)
    return LotUnassignResponse(
        transaction=result.transaction,
        needs_rerun=result.needs_rerun,
        warnings=result.warnings,
        from_phase_counts=result.phase_counts,
        building_group_lot_ids=result.building_group_lot_ids,
    )


@router.delete("/{lot_id}", response_model=dict)
async def delete_lot(lot_id: int, conn=Depends(get_db_conn)):
    """Hard-delete a pre-MARKS lot. Refuses real and sim lots."""
    cur = dict_cursor(conn)
    try:
        cur.execute(
            "SELECT lot_source FROM sim_lots WHERE lot_id = %s",
            (lot_id,),
        )
        row = cur.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail=f"Lot {lot_id} not found")
        if row["lot_source"] != "pre":
            raise HTTPException(
                status_code=422,
                detail="Only pre-MARKS lots (lot_source='pre') can be deleted",
            )
        cur.execute("DELETE FROM sim_lots WHERE lot_id = %s", (lot_id,))
        conn.commit()
        return {"lot_id": lot_id, "deleted": True}
    except HTTPException:
        conn.rollback()
        raise
    except Exception:
        conn.rollback()
        raise
    finally:
        cur.close()


class LotExcludeRequest(BaseModel):
    excluded: bool


@router.patch("/{lot_id}/excluded", response_model=dict)
async def set_lot_excluded(lot_id: int, body: LotExcludeRequest, conn=Depends(get_db_conn)):
    """Toggle the excluded flag on a lot. Excluded lots stay in the table but are
    invisible to the simulation, phase counts, and unstarted inventory."""
    cur = dict_cursor(conn)
    try:
        cur.execute(
            "UPDATE sim_lots SET excluded = %s, updated_at = NOW() "
            "WHERE lot_id = %s RETURNING lot_id, lot_number, lot_source, excluded",
            (body.excluded, lot_id),
        )
        row = cur.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail=f"Lot {lot_id} not found")
        conn.commit()
        return dict(row)
    except HTTPException:
        raise
    except Exception:
        conn.rollback()
        raise
    finally:
        cur.close()
