# routers/phases.py
# Phase management endpoints.

import psycopg2.extras
from fastapi import APIRouter, Depends, HTTPException

from api.deps import get_db_conn
from api.models.phase_models import (
    PhaseInstrumentReassignRequest,
    PhaseInstrumentReassignResponse,
    PhaseUpdateRequest,
)
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


@router.patch("/{phase_id}", response_model=dict)
async def update_phase(
    phase_id: int,
    body: PhaseUpdateRequest,
    conn=Depends(get_db_conn),
):
    """Update phase attributes. Currently supports projected_count (sim_phase_product_splits.lot_count).
    For phases with multiple splits, the new total is distributed proportionally across all splits.
    """
    if body.projected_count is None:
        raise HTTPException(status_code=422, detail="No updatable field provided")

    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
    cur.execute(
        "SELECT split_id, lot_count FROM sim_phase_product_splits WHERE phase_id = %s",
        (phase_id,),
    )
    splits = cur.fetchall()
    if not splits:
        raise HTTPException(status_code=404, detail="No product splits found for phase")

    new_total = body.projected_count

    if len(splits) == 1:
        cur.execute(
            "UPDATE sim_phase_product_splits SET lot_count = %s WHERE split_id = %s",
            (new_total, splits[0]["split_id"]),
        )
    else:
        # Distribute new total proportionally across existing splits.
        # If current total is 0, distribute equally.
        current_total = sum(s["lot_count"] or 0 for s in splits)
        remainder = new_total
        for i, s in enumerate(splits):
            if i == len(splits) - 1:
                # Last split absorbs rounding remainder
                count = remainder
            elif current_total > 0:
                count = round(new_total * (s["lot_count"] or 0) / current_total)
            else:
                count = new_total // len(splits)
            cur.execute(
                "UPDATE sim_phase_product_splits SET lot_count = %s WHERE split_id = %s",
                (count, s["split_id"]),
            )
            remainder -= count

    conn.commit()
    return {"success": True, "projected_count": new_total}


@router.patch("/{phase_id}/lot-type/{lot_type_id}/projected", response_model=dict)
async def update_lot_type_projected(
    phase_id: int,
    lot_type_id: int,
    body: PhaseUpdateRequest,
    conn=Depends(get_db_conn),
):
    """Update projected count for a specific (phase_id, lot_type_id) split row."""
    if body.projected_count is None:
        raise HTTPException(status_code=422, detail="projected_count required")
    if body.projected_count < 0:
        raise HTTPException(status_code=422, detail="projected_count must be >= 0")

    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
    cur.execute(
        "SELECT split_id FROM sim_phase_product_splits WHERE phase_id = %s AND lot_type_id = %s",
        (phase_id, lot_type_id),
    )
    row = cur.fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="No split found for phase/lot_type")

    cur.execute(
        "UPDATE sim_phase_product_splits SET lot_count = %s WHERE split_id = %s",
        (body.projected_count, row["split_id"]),
    )

    # Return updated counts so the frontend can refresh without a full reload
    cur.execute(
        """
        SELECT
            %s::int                                                      AS phase_id,
            %s::int                                                      AS lot_type_id,
            %s::int                                                      AS projected_count,
            COUNT(l.lot_id) FILTER (WHERE l.lot_source = 'real')::int   AS actual,
            GREATEST(%s, COUNT(l.lot_id) FILTER (WHERE l.lot_source = 'real'))::int AS total
        FROM sim_lots l
        WHERE l.phase_id = %s AND l.lot_type_id = %s
        """,
        (phase_id, lot_type_id, body.projected_count, body.projected_count, phase_id, lot_type_id),
    )
    result = cur.fetchone()
    conn.commit()
    return {
        "phase_id": result["phase_id"],
        "lot_type_id": result["lot_type_id"],
        "projected_count": result["projected_count"],
        "actual": result["actual"],
        "total": result["total"],
    }
