# routers/lots.py
# Lot management endpoints.

from fastapi import APIRouter, Depends, HTTPException

from api.deps import get_db_conn
from api.models.lot_models import (
    ErrorResponse,
    LotPhaseReassignRequest,
    LotPhaseReassignResponse,
)
from services.lot_assignment_service import reassign_lot_to_phase

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
