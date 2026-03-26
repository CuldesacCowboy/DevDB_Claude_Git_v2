# routers/phases.py
# Phase management endpoints.

from fastapi import APIRouter, Depends, HTTPException

from api.deps import get_db_conn
from api.models.phase_models import PhaseInstrumentReassignRequest, PhaseInstrumentReassignResponse
from services.phase_assignment_service import reassign_phase_to_instrument

router = APIRouter(prefix="/phases", tags=["phases"])


@router.patch(
    "/{phase_id}/instrument",
    response_model=PhaseInstrumentReassignResponse,
)
async def reassign_phase_instrument(
    phase_id: int,
    body: PhaseInstrumentReassignRequest,
    conn=Depends(get_db_conn),
):
    result = reassign_phase_to_instrument(
        conn, phase_id, body.target_instrument_id, body.changed_by
    )
    if not result.success:
        raise HTTPException(status_code=422, detail=result.error)
    return PhaseInstrumentReassignResponse(
        transaction=result.transaction,
        needs_rerun=result.needs_rerun,
        warnings=result.warnings,
    )
