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
    """Hard-delete a pre-MARKS lot or an unregistered real lot (not in marks_lot_registry).
    Refuses sim lots and real lots that exist in marks_lot_registry."""
    cur = dict_cursor(conn)
    try:
        cur.execute(
            """
            SELECT sl.lot_source,
                   EXISTS (SELECT 1 FROM devdb.marks_lot_registry mlr
                           WHERE mlr.lot_number = sl.lot_number) AS in_registry
            FROM sim_lots sl
            WHERE sl.lot_id = %s
            """,
            (lot_id,),
        )
        row = cur.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail=f"Lot {lot_id} not found")
        if row["lot_source"] == "sim":
            raise HTTPException(status_code=422, detail="Sim lots cannot be deleted")
        if row["lot_source"] == "real" and row["in_registry"]:
            raise HTTPException(
                status_code=422,
                detail="This lot exists in MARKS — use Release to return it to the MARKS bank instead of deleting it",
            )
        # Remove FK-dependent rows before deleting the lot itself.
        cur.execute("DELETE FROM sim_tda_lot_bank_members WHERE lot_id = %s", (lot_id,))
        cur.execute("DELETE FROM sim_lot_date_overrides   WHERE lot_id = %s", (lot_id,))
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


class LotBuilderOverrideRequest(BaseModel):
    builder_id: int | None  # null clears the override; int sets it


@router.patch("/{lot_id}/builder", response_model=dict)
async def set_lot_builder_override(lot_id: int, body: LotBuilderOverrideRequest, conn=Depends(get_db_conn)):
    """Set or clear the builder override for a lot.
    Priority: builder_id_override > builder_id (MARKS-seeded) > NULL (engine assigns via splits).
    """
    cur = dict_cursor(conn)
    try:
        if body.builder_id is not None:
            cur.execute("SELECT builder_id FROM dim_builders WHERE builder_id = %s AND active = true", (body.builder_id,))
            if not cur.fetchone():
                raise HTTPException(status_code=422, detail=f"Builder {body.builder_id} not found or inactive")
        cur.execute(
            "UPDATE sim_lots SET builder_id_override = %s, updated_at = NOW() "
            "WHERE lot_id = %s RETURNING lot_id, lot_number, builder_id, builder_id_override",
            (body.builder_id, lot_id),
        )
        row = cur.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail=f"Lot {lot_id} not found")
        conn.commit()
        return {**dict(row), "effective_builder_id": row["builder_id_override"] if row["builder_id_override"] is not None else row["builder_id"]}
    except HTTPException:
        raise
    except Exception:
        conn.rollback()
        raise
    finally:
        cur.close()


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


class BulkReleaseRequest(BaseModel):
    lot_ids: list[int]


@router.patch("/bulk-release", response_model=dict)
async def bulk_release_lots(body: BulkReleaseRequest, conn=Depends(get_db_conn)):
    """Release real lots back to the MARKS import bank.
    Sets dev_id=NULL and phase_id=NULL. Only lot_source='real' lots are affected.
    Sim and pre lots are silently skipped.
    """
    if not body.lot_ids:
        return {"released": 0, "skipped": 0}
    cur = dict_cursor(conn)
    try:
        cur.execute(
            """
            UPDATE sim_lots
            SET dev_id = NULL, phase_id = NULL, updated_at = NOW()
            WHERE lot_id = ANY(%s)
              AND lot_source = 'real'
              AND excluded = FALSE
            """,
            (body.lot_ids,),
        )
        released = cur.rowcount
        skipped = len(body.lot_ids) - released
        conn.commit()
        return {"released": released, "skipped": skipped}
    except Exception as e:
        conn.rollback()
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        cur.close()


@router.get("/search")
def search_lots(q: str = Query(..., min_length=1), exclude_tda: int = Query(None), conn=Depends(get_db_conn)):
    """Search real lots by lot_number prefix across all communities.
    Optionally exclude lots already in a given TDA (exclude_tda=tda_id)."""
    cur = dict_cursor(conn)
    try:
        if exclude_tda is not None:
            cur.execute(
                """
                SELECT l.lot_id, l.lot_number
                FROM devdb.sim_lots l
                WHERE l.lot_source = 'real'
                  AND l.lot_number ILIKE %s
                  AND l.lot_id NOT IN (
                      SELECT lot_id FROM devdb.sim_takedown_agreement_lots WHERE tda_id = %s
                  )
                ORDER BY l.lot_number
                LIMIT 100
                """,
                (q.upper() + '%', exclude_tda),
            )
        else:
            cur.execute(
                """
                SELECT l.lot_id, l.lot_number
                FROM devdb.sim_lots l
                WHERE l.lot_source = 'real'
                  AND l.lot_number ILIKE %s
                ORDER BY l.lot_number
                LIMIT 100
                """,
                (q.upper() + '%',),
            )
        return [{"lot_id": r["lot_id"], "lot_number": r["lot_number"]} for r in cur.fetchall()]
    finally:
        cur.close()
