# routers/phases.py
# Phase management endpoints.

from fastapi import APIRouter, Depends, HTTPException, Response

from api.deps import get_db_conn
from api.db import dict_cursor
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
    cur = dict_cursor(conn)
    try:
        cur.execute(
            "SELECT lot_type_id, lot_type_short FROM ref_lot_types WHERE active = TRUE ORDER BY lot_type_id"
        )
        return [{"lot_type_id": r["lot_type_id"], "lot_type_short": r["lot_type_short"]}
                for r in cur.fetchall()]
    finally:
        cur.close()


@router.get("/{phase_id}/product-splits", response_model=list[dict])
async def get_product_splits(phase_id: int, conn=Depends(get_db_conn)):
    """Return all product splits for a phase with lot type labels."""
    cur = dict_cursor(conn)
    try:
        cur.execute(
            """
            SELECT
                sps.split_id,
                sps.phase_id,
                sps.lot_type_id,
                rlt.lot_type_short,
                sps.projected_count,
                COALESCE(real.real_count, 0)::int AS actual
            FROM sim_phase_product_splits sps
            JOIN ref_lot_types rlt ON sps.lot_type_id = rlt.lot_type_id
            LEFT JOIN (
                SELECT lot_type_id, COUNT(*) AS real_count
                FROM sim_lots
                WHERE phase_id = %s AND lot_source = 'real'
                GROUP BY lot_type_id
            ) real ON sps.lot_type_id = real.lot_type_id
            WHERE sps.phase_id = %s
            ORDER BY rlt.lot_type_id
            """,
            (phase_id, phase_id),
        )
        return [
            {
                "split_id": r["split_id"],
                "phase_id": r["phase_id"],
                "lot_type_id": r["lot_type_id"],
                "lot_type_short": r["lot_type_short"],
                "projected_count": r["projected_count"],
                "actual": r["actual"],
            }
            for r in cur.fetchall()
        ]
    finally:
        cur.close()


@router.post("", response_model=dict, status_code=201)
async def create_phase(body: PhaseCreateRequest, conn=Depends(get_db_conn)):
    """Create a new empty phase and attach it to the given instrument."""
    name = (body.phase_name or "").strip()
    if not name:
        raise HTTPException(status_code=422, detail="phase_name is required")

    cur = dict_cursor(conn)
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

        # Lock the instrument row to serialise concurrent phase inserts,
        # then compute sequence_number as MAX+1 within the same transaction.
        cur.execute(
            "SELECT instrument_id FROM sim_legal_instruments WHERE instrument_id = %s FOR UPDATE",
            (body.instrument_id,),
        )

        cur.execute(
            """
            INSERT INTO sim_dev_phases (phase_name, sequence_number, dev_id, instrument_id)
            VALUES (
                %s,
                (SELECT COALESCE(MAX(sequence_number), 0) + 1
                 FROM sim_dev_phases WHERE instrument_id = %s),
                %s, %s
            ) RETURNING phase_id, sequence_number
            """,
            (name, body.instrument_id, dev_id, body.instrument_id),
        )
        row = cur.fetchone()
        new_phase_id = int(row["phase_id"])
        next_seq = int(row["sequence_number"])
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


@router.post("/{phase_id}/lot-type/{lot_type_id}", response_model=dict, status_code=201)
async def add_lot_type_to_phase(
    phase_id: int,
    lot_type_id: int,
    conn=Depends(get_db_conn),
):
    """Add a new lot-type split (projected_count=0) to a phase. 409 if already present."""
    cur = dict_cursor(conn)
    try:
        cur.execute(
            "SELECT split_id FROM devdb.sim_phase_product_splits WHERE phase_id = %s AND lot_type_id = %s",
            (phase_id, lot_type_id),
        )
        if cur.fetchone():
            raise HTTPException(status_code=409, detail="Lot type already assigned to this phase")

        cur.execute("SELECT lot_type_short FROM devdb.ref_lot_types WHERE lot_type_id = %s", (lot_type_id,))
        lt_row = cur.fetchone()
        if not lt_row:
            raise HTTPException(status_code=404, detail="Lot type not found")

        cur.execute(
            """
            INSERT INTO devdb.sim_phase_product_splits (phase_id, lot_type_id, projected_count)
            VALUES (%s, %s, 0)
            RETURNING split_id
            """,
            (phase_id, lot_type_id),
        )
        split_id = cur.fetchone()["split_id"]
        conn.commit()
        return {
            "split_id": split_id,
            "phase_id": phase_id,
            "lot_type_id": lot_type_id,
            "lot_type_short": lt_row["lot_type_short"],
            "projected_count": 0,
            "actual": 0,
            "total": 0,
        }
    except HTTPException:
        conn.rollback()
        raise
    except Exception:
        conn.rollback()
        raise
    finally:
        cur.close()


@router.get("/{phase_id}/lot-type/{lot_type_id}/lots")
async def get_lots_for_lot_type(
    phase_id: int,
    lot_type_id: int,
    conn=Depends(get_db_conn),
):
    """Return individual lots for a (phase_id, lot_type_id) pair, ordered by source then lot_id."""
    cur = dict_cursor(conn)
    try:
        cur.execute(
            """
            SELECT sl.lot_id, sl.lot_number, sl.lot_source, sl.excluded,
                EXISTS (
                    SELECT 1 FROM devdb.marks_lot_registry mlr
                    WHERE mlr.lot_number = sl.lot_number
                ) AS in_registry
            FROM sim_lots sl
            WHERE sl.phase_id = %s AND sl.lot_type_id = %s
            ORDER BY
                sl.excluded,
                CASE sl.lot_source WHEN 'real' THEN 1 WHEN 'pre' THEN 2 ELSE 3 END,
                sl.lot_id
            """,
            (phase_id, lot_type_id),
        )
        return [
            {
                "lot_id": r["lot_id"],
                "lot_number": r["lot_number"],
                "lot_source": r["lot_source"],
                "in_registry": bool(r["in_registry"]),
                "excluded": bool(r["excluded"]),
            }
            for r in cur.fetchall()
        ]
    finally:
        cur.close()


@router.delete("/{phase_id}/lot-type/{lot_type_id}", status_code=204)
async def delete_lot_type_from_phase(
    phase_id: int,
    lot_type_id: int,
    conn=Depends(get_db_conn),
):
    """Remove a (phase_id, lot_type_id) split and any sim lots for it.

    Requires projected_count = 0 AND actual (real lots) = 0.
    Returns 204 No Content on success.
    """
    cur = dict_cursor(conn)
    try:
        # 1. Verify the lot type exists on this phase
        cur.execute(
            "SELECT split_id, projected_count FROM devdb.sim_phase_product_splits"
            " WHERE phase_id = %s AND lot_type_id = %s",
            (phase_id, lot_type_id),
        )
        split = cur.fetchone()
        if not split:
            raise HTTPException(
                status_code=404,
                detail=f"Lot type {lot_type_id} not found on phase {phase_id}",
            )

        # 2. Refuse if projected_count != 0
        if (split["projected_count"] or 0) != 0:
            raise HTTPException(
                status_code=400,
                detail="Cannot delete lot type: projected_count is not 0",
            )

        # 3. Refuse if actual (real) lots exist
        cur.execute(
            "SELECT COUNT(*) AS actual FROM devdb.sim_lots"
            " WHERE phase_id = %s AND lot_type_id = %s AND lot_source = 'real'",
            (phase_id, lot_type_id),
        )
        actual = int(cur.fetchone()["actual"])
        if actual != 0:
            raise HTTPException(
                status_code=400,
                detail=f"Cannot delete lot type: {actual} actual lot(s) exist",
            )

        # 4. Delete all non-real lots for this phase + lot type
        cur.execute(
            "DELETE FROM devdb.sim_lots"
            " WHERE phase_id = %s AND lot_type_id = %s AND lot_source != 'real'",
            (phase_id, lot_type_id),
        )

        # 5. Delete the split row
        cur.execute(
            "DELETE FROM devdb.sim_phase_product_splits WHERE phase_id = %s AND lot_type_id = %s",
            (phase_id, lot_type_id),
        )

        conn.commit()
        return Response(status_code=204)
    except HTTPException:
        conn.rollback()
        raise
    except Exception:
        conn.rollback()
        raise
    finally:
        cur.close()


@router.patch("/{phase_id}/lot-type/{lot_type_id}/projected/delta", response_model=dict)
async def adjust_projected_delta(
    phase_id: int,
    lot_type_id: int,
    body: PhaseUpdateRequest,
    conn=Depends(get_db_conn),
):
    """Adjust projected_count by body.projected_count as a signed delta (floors at 0).
    Upserts the split row if it does not yet exist."""
    if body.projected_count is None:
        raise HTTPException(status_code=422, detail="projected_count (delta) required")
    delta = body.projected_count
    cur = dict_cursor(conn)
    try:
        cur.execute(
            """
            INSERT INTO sim_phase_product_splits (phase_id, lot_type_id, projected_count)
            VALUES (%s, %s, GREATEST(0, %s))
            ON CONFLICT (phase_id, lot_type_id) DO UPDATE
                SET projected_count = GREATEST(0, sim_phase_product_splits.projected_count + %s)
            RETURNING projected_count
            """,
            (phase_id, lot_type_id, max(0, delta), delta),
        )
        new_count = cur.fetchone()["projected_count"]
        conn.commit()
        return {"phase_id": phase_id, "lot_type_id": lot_type_id, "projected_count": new_count}
    except Exception:
        conn.rollback()
        raise
    finally:
        cur.close()


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

    cur = dict_cursor(conn)
    cur.execute(
        "SELECT split_id FROM sim_phase_product_splits WHERE phase_id = %s AND lot_type_id = %s",
        (phase_id, lot_type_id),
    )
    row = cur.fetchone()
    if not row:
        # New product type on this phase — insert a new split row.
        cur.execute(
            "INSERT INTO sim_phase_product_splits (phase_id, lot_type_id, projected_count)"
            " VALUES (%s, %s, %s)",
            (phase_id, lot_type_id, body.projected_count),
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


@router.delete("/{phase_id}", response_model=dict)
async def delete_phase(phase_id: int, conn=Depends(get_db_conn)):
    """Delete a phase: unassign all lots, remove splits, then delete the phase row."""
    cur = dict_cursor(conn)
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

    cur = dict_cursor(conn)

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
        before_last = len(splits) - 1
        for i, s in enumerate(splits):
            if i == before_last:
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
