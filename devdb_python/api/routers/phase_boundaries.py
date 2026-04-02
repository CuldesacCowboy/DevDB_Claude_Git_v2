# routers/phase_boundaries.py
# Phase boundary CRUD and split endpoints for the site plan module.

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from api.deps import get_db_conn

router = APIRouter(prefix="/phase-boundaries", tags=["phase-boundaries"])

_SELECT = "SELECT boundary_id, plan_id, phase_id, polygon_json, label, split_order"


class BoundaryResponse(BaseModel):
    boundary_id: int
    plan_id: int
    phase_id: Optional[int] = None
    polygon_json: str
    label: Optional[str] = None
    split_order: int


class BoundaryCreateRequest(BaseModel):
    plan_id: int
    polygon_json: str
    label: Optional[str] = None
    phase_id: Optional[int] = None
    split_order: int = 0


class BoundaryPatchRequest(BaseModel):
    polygon_json: Optional[str] = None
    label: Optional[str] = None
    phase_id: Optional[int] = None


class SplitRequest(BaseModel):
    plan_id: int
    original_boundary_id: Optional[int] = None  # null = first split from parcel (no existing boundary to replace)
    polygon_a: str   # JSON string — [{x,y}] for child polygon A
    polygon_b: str   # JSON string — [{x,y}] for child polygon B


def _row(row) -> BoundaryResponse:
    return BoundaryResponse(
        boundary_id=row[0], plan_id=row[1], phase_id=row[2],
        polygon_json=row[3], label=row[4], split_order=row[5],
    )


@router.get("/plan/{plan_id}", response_model=list[BoundaryResponse])
def list_boundaries(plan_id: int, conn=Depends(get_db_conn)):
    with conn.cursor() as cur:
        cur.execute(
            f"{_SELECT} FROM sim_phase_boundaries WHERE plan_id = %s ORDER BY split_order, boundary_id",
            (plan_id,),
        )
        return [_row(r) for r in cur.fetchall()]


@router.post("", response_model=BoundaryResponse)
def create_boundary(body: BoundaryCreateRequest, conn=Depends(get_db_conn)):
    with conn.cursor() as cur:
        cur.execute(
            f"""
            INSERT INTO sim_phase_boundaries (plan_id, phase_id, polygon_json, label, split_order)
            VALUES (%s, %s, %s, %s, %s)
            RETURNING {_SELECT.replace('SELECT ', '')}
            """,
            (body.plan_id, body.phase_id, body.polygon_json, body.label, body.split_order),
        )
        row = cur.fetchone()
        conn.commit()
    return _row(row)


@router.patch("/{boundary_id}", response_model=BoundaryResponse)
def update_boundary(boundary_id: int, body: BoundaryPatchRequest, conn=Depends(get_db_conn)):
    with conn.cursor() as cur:
        fields, vals = [], []
        provided = body.model_fields_set
        if "polygon_json" in provided and body.polygon_json is not None:
            fields.append("polygon_json = %s"); vals.append(body.polygon_json)
        if "label" in provided:
            fields.append("label = %s"); vals.append(body.label)
        if "phase_id" in provided:
            fields.append("phase_id = %s"); vals.append(body.phase_id)
        if not fields:
            raise HTTPException(status_code=422, detail="No fields to update")
        fields.append("updated_at = now()")
        vals.append(boundary_id)
        cur.execute(
            f"UPDATE sim_phase_boundaries SET {', '.join(fields)} WHERE boundary_id = %s "
            f"RETURNING {_SELECT.replace('SELECT ', '')}",
            vals,
        )
        row = cur.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Boundary not found")
        conn.commit()
    return _row(row)


@router.delete("/{boundary_id}", status_code=204)
def delete_boundary(boundary_id: int, conn=Depends(get_db_conn)):
    with conn.cursor() as cur:
        cur.execute("DELETE FROM sim_phase_boundaries WHERE boundary_id = %s RETURNING boundary_id", (boundary_id,))
        if not cur.fetchone():
            raise HTTPException(status_code=404, detail="Boundary not found")
        conn.commit()


@router.post("/split", response_model=list[BoundaryResponse])
def split_boundary(body: SplitRequest, conn=Depends(get_db_conn)):
    """
    Replace original_boundary_id with two child polygons (polygon_a and polygon_b).
    When original_boundary_id is None, creates two new boundaries from the parcel
    without deleting anything (first-split case).
    Returns the two newly created boundaries.
    """
    with conn.cursor() as cur:
        if body.original_boundary_id is not None:
            # Verify original exists
            cur.execute(
                f"{_SELECT} FROM sim_phase_boundaries WHERE boundary_id = %s",
                (body.original_boundary_id,),
            )
            original = cur.fetchone()
            if not original:
                raise HTTPException(status_code=404, detail="Original boundary not found")

        # Determine next split_order
        cur.execute(
            "SELECT COALESCE(MAX(split_order), 0) FROM sim_phase_boundaries WHERE plan_id = %s",
            (body.plan_id,),
        )
        next_order = cur.fetchone()[0] + 1

        if body.original_boundary_id is not None:
            # Delete original
            cur.execute("DELETE FROM sim_phase_boundaries WHERE boundary_id = %s", (body.original_boundary_id,))

        # Insert two children
        rows = []
        for poly in (body.polygon_a, body.polygon_b):
            cur.execute(
                f"""
                INSERT INTO sim_phase_boundaries (plan_id, polygon_json, split_order)
                VALUES (%s, %s, %s)
                RETURNING {_SELECT.replace('SELECT ', '')}
                """,
                (body.plan_id, poly, next_order),
            )
            rows.append(_row(cur.fetchone()))
            next_order += 1

        conn.commit()
    return rows
