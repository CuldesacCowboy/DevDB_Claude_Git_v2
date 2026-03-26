# routers/lots.py
# Lot management endpoints.

from fastapi import APIRouter, Depends, HTTPException, Query

from api.deps import get_db_conn
from api.models.lot_models import (
    ErrorResponse,
    LotPhaseReassignRequest,
    LotPhaseReassignResponse,
    LotUnassignResponse,
)
from services.lot_assignment_service import reassign_lot_to_phase, unassign_lot_from_phase

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
    )
