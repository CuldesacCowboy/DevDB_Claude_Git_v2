# routers/phases.py
# Phase management endpoints.

import psycopg2.extras
from fastapi import APIRouter, Depends, HTTPException

from api.deps import get_db_conn
from api.models.phase_models import (
    PhaseCreateRequest,
    PhaseInstrumentReassignRequest,
    PhaseInstrumentReassignResponse,
    PhaseUpdateRequest,
)
from services.phase_assignment_service import reassign_phase_to_instrument

router = APIRouter(prefix="/phases", tags=["phases"])


@router.get("/lot-types", response_model=list[dict])
async def list_lot_types(conn=Depends(get_db_conn)):
    """Return all lot types for the add-product-type dropdown."""
    import psycopg2.extras
    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
    try:
        cur.execute(
            "SELECT lot_type_id, lot_type_short FROM ref_lot_types ORDER BY lot_type_id"
        )
        return [{"lot_type_id": r["lot_type_id"], "lot_type_short": r["lot_type_short"]}
                for r in cur.fetchall()]
    finally:
        cur.close()


@router.post("", response_model=dict, status_code=201)
async def create_phase(body: PhaseCreateRequest, conn=Depends(get_db_conn)):
    """Create a new empty phase and attach it to the given instrument."""
    import psycopg2.extras
    name = (body.phase_name or "").strip()
    if not name:
        raise HTTPException(status_code=422, detail="phase_name is required")

    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
    try:
        # Verify instrument exists and get its dev_id
        cur.execute(
            "SELECT instrument_id, dev_id FROM sim_legal_instruments WHERE instrument_id = %s",
            (body.instrument_id,),
        )
        instr = cur.fetchone()
        if not instr:
            raise HTTPException(status_code=404, detail=f"Instrument {body.instrument_id} not found")

        dev_id = int(instr["dev_id"])

        # Compute next phase_id and sequence_number
        cur.execute("SELECT COALESCE(MAX(phase_id), 0) + 1 AS new_id FROM sim_dev_phases")
        new_phase_id = int(cur.fetchone()["new_id"])

        cur.execute(
            "SELECT COALESCE(MAX(sequence_number), 0) + 1 AS next_seq FROM sim_dev_phases"
            " WHERE instrument_id = %s",
            (body.instrument_id,),
        )
        next_seq = int(cur.fetchone()["next_seq"])

        cur.execute(
            """
            INSERT INTO sim_dev_phases (phase_id, phase_name, sequence_number, dev_id, instrument_id)
            VALUES (%s, %s, %s, %s, %s)
            """,
            (new_phase_id, name, next_seq, dev_id, body.instrument_id),
        )
        conn.commit()
        return {
            "phase_id": new_phase_id,
            "phase_name": name,
            "sequence_number": next_seq,
            "dev_id": dev_id,
            "instrument_id": body.instrument_id,
        }
    except HTTPException:
        conn.rollback()
        raise
    except Exception:
        conn.rollback()
        raise
    finally:
        cur.close()


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


@router.delete("/{phase_id}", response_model=dict)
async def delete_phase(phase_id: int, conn=Depends(get_db_conn)):
    """Delete a phase: unassign all lots, remove splits, then delete the phase row."""
    import psycopg2.extras
    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
    try:
        # Verify phase exists and get its name for the response
        cur.execute(
            "SELECT phase_name FROM sim_dev_phases WHERE phase_id = %s",
            (phase_id,),
        )
        row = cur.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail=f"Phase {phase_id} not found")

        # Count lots that will be unassigned
        cur.execute(
            "SELECT COUNT(*) AS lot_count FROM sim_lots WHERE phase_id = %s",
            (phase_id,),
        )
        lot_count = int(cur.fetchone()["lot_count"])

        # Unassign all lots from this phase
        cur.execute(
            "UPDATE sim_lots SET phase_id = NULL WHERE phase_id = %s",
            (phase_id,),
        )
        # Remove product and builder splits
        cur.execute("DELETE FROM sim_phase_product_splits WHERE phase_id = %s", (phase_id,))
        cur.execute("DELETE FROM sim_phase_builder_splits WHERE phase_id = %s", (phase_id,))
        # Remove delivery event phase links
        cur.execute("DELETE FROM sim_delivery_event_phases WHERE phase_id = %s", (phase_id,))
        # Delete the phase itself
        cur.execute("DELETE FROM sim_dev_phases WHERE phase_id = %s", (phase_id,))

        conn.commit()
        return {"success": True, "phase_id": phase_id, "lots_unassigned": lot_count}
    except HTTPException:
        conn.rollback()
        raise
    except Exception:
        conn.rollback()
        raise
    finally:
        cur.close()


@router.patch("/{phase_id}", response_model=dict)
async def update_phase(
    phase_id: int,
    body: PhaseUpdateRequest,
    conn=Depends(get_db_conn),
):
    """Update phase attributes: phase_name (sim_dev_phases) or projected_count
    (sim_phase_product_splits, distributed proportionally across splits).
    """
    if body.projected_count is None and not body.phase_name:
        raise HTTPException(status_code=422, detail="No updatable field provided")

    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)

    # Handle phase_name rename
    if body.phase_name is not None:
        name = body.phase_name.strip()
        if not name:
            raise HTTPException(status_code=422, detail="phase_name cannot be empty")
        cur.execute(
            "UPDATE sim_dev_phases SET phase_name = %s WHERE phase_id = %s",
            (name, phase_id),
        )
        if cur.rowcount == 0:
            conn.rollback()
            raise HTTPException(status_code=404, detail=f"Phase {phase_id} not found")
        conn.commit()
        return {"success": True, "phase_id": phase_id, "phase_name": name}

    # Handle projected_count update
    cur.execute(
        "SELECT split_id, projected_count FROM sim_phase_product_splits WHERE phase_id = %s",
        (phase_id,),
    )
    splits = cur.fetchall()
    if not splits:
        raise HTTPException(status_code=404, detail="No product splits found for phase")

    new_total = body.projected_count

    if len(splits) == 1:
        cur.execute(
            "UPDATE sim_phase_product_splits SET projected_count = %s WHERE split_id = %s",
            (new_total, splits[0]["split_id"]),
        )
    else:
        # Distribute new total proportionally across existing splits.
        # If current total is 0, distribute equally.
        current_total = sum(s["projected_count"] or 0 for s in splits)
        remainder = new_total
        for i, s in enumerate(splits):
            if i == len(splits) - 1:
                # Last split absorbs rounding remainder
                count = remainder
            elif current_total > 0:
                count = round(new_total * (s["projected_count"] or 0) / current_total)
            else:
                count = new_total // len(splits)
            cur.execute(
                "UPDATE sim_phase_product_splits SET projected_count = %s WHERE split_id = %s",
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
        # New product type on this phase — insert a new split row.
        cur.execute(
            "SELECT COALESCE(MAX(split_id), 0) + 1 AS new_id FROM sim_phase_product_splits"
        )
        new_split_id = int(cur.fetchone()["new_id"])
        cur.execute(
            "INSERT INTO sim_phase_product_splits (split_id, phase_id, lot_type_id, projected_count)"
            " VALUES (%s, %s, %s, %s)",
            (new_split_id, phase_id, lot_type_id, body.projected_count),
        )
    else:
        cur.execute(
            "UPDATE sim_phase_product_splits SET projected_count = %s WHERE split_id = %s",
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
