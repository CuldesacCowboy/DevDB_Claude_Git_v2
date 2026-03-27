# routers/developments.py
# Development-level CRUD endpoints plus lot-phase-view sub-resource.

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from api.deps import get_db_conn
from api.models.lot_models import DevLotPhaseViewResponse

router = APIRouter(prefix="/developments", tags=["developments"])


# ---------------------------------------------------------------------------
# Pydantic models
# ---------------------------------------------------------------------------

class DevelopmentCreateRequest(BaseModel):
    dev_name: str
    marks_code: str | None = None
    in_marks: bool = False
    county_id: int | None = None
    state_id: int | None = None
    municipality_id: int | None = None
    community_id: int | None = None


class DevelopmentPatchRequest(BaseModel):
    dev_name: str | None = None
    marks_code: str | None = None
    in_marks: bool | None = None
    county_id: int | None = None
    state_id: int | None = None
    municipality_id: int | None = None
    community_id: int | None = None


# ---------------------------------------------------------------------------
# Shared SQL helpers
# ---------------------------------------------------------------------------

_SELECT_SQL = """
    SELECT
        d.dev_id,
        d.dev_name,
        d.marks_code,
        d.in_marks,
        d.county_id,
        c.county_name,
        d.state_id,
        d.municipality_id,
        d.community_id,
        eg.ent_group_name AS community_name
    FROM developments d
    LEFT JOIN dim_county c ON c.county_id = d.county_id
    LEFT JOIN sim_entitlement_groups eg ON eg.ent_group_id = d.community_id
"""


def _row_to_dict(r) -> dict:
    return {
        "dev_id": r["dev_id"],
        "dev_name": r["dev_name"],
        "marks_code": r["marks_code"],
        "in_marks": r["in_marks"],
        "county_id": r["county_id"],
        "county_name": r["county_name"],
        "state_id": r["state_id"],
        "municipality_id": r["municipality_id"],
        "community_id": r["community_id"],
        "community_name": r["community_name"],
    }


# ---------------------------------------------------------------------------
# GET /developments  — list all
# ---------------------------------------------------------------------------

@router.get("", response_model=list[dict])
def list_developments(conn=Depends(get_db_conn)):
    import psycopg2.extras
    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
    try:
        cur.execute(_SELECT_SQL + " ORDER BY d.dev_name ASC")
        return [_row_to_dict(r) for r in cur.fetchall()]
    finally:
        cur.close()


# ---------------------------------------------------------------------------
# POST /developments  — create
# ---------------------------------------------------------------------------

@router.post("", response_model=dict, status_code=201)
def create_development(body: DevelopmentCreateRequest, conn=Depends(get_db_conn)):
    import psycopg2.extras
    name = (body.dev_name or "").strip()
    if not name:
        raise HTTPException(status_code=422, detail="dev_name is required")
    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
    try:
        cur.execute(
            """
            INSERT INTO developments
                (dev_name, marks_code, in_marks, county_id, state_id, municipality_id, community_id)
            VALUES (%s, %s, %s, %s, %s, %s, %s)
            RETURNING dev_id
            """,
            (
                name,
                body.marks_code or None,
                body.in_marks,
                body.county_id,
                body.state_id,
                body.municipality_id,
                body.community_id,
            ),
        )
        new_id = cur.fetchone()["dev_id"]
        conn.commit()

        cur.execute(_SELECT_SQL + " WHERE d.dev_id = %s", (new_id,))
        row = cur.fetchone()
        return _row_to_dict(row)
    except Exception:
        conn.rollback()
        raise
    finally:
        cur.close()


# ---------------------------------------------------------------------------
# GET /developments/{dev_id}  — single development
# ---------------------------------------------------------------------------

@router.get("/{dev_id}", response_model=dict)
def get_development(dev_id: int, conn=Depends(get_db_conn)):
    import psycopg2.extras
    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
    try:
        cur.execute(_SELECT_SQL + " WHERE d.dev_id = %s", (dev_id,))
        row = cur.fetchone()
        if row is None:
            raise HTTPException(status_code=404, detail=f"Development {dev_id} not found.")
        return _row_to_dict(row)
    finally:
        cur.close()


# ---------------------------------------------------------------------------
# PATCH /developments/{dev_id}  — partial update
# ---------------------------------------------------------------------------

@router.patch("/{dev_id}", response_model=dict)
def patch_development(dev_id: int, body: DevelopmentPatchRequest, conn=Depends(get_db_conn)):
    import psycopg2.extras

    # Build SET clause from non-None fields only
    updatable: dict[str, Any] = {}
    if body.dev_name is not None:
        name = body.dev_name.strip()
        if not name:
            raise HTTPException(status_code=422, detail="dev_name cannot be empty")
        updatable["dev_name"] = name
    if body.marks_code is not None:
        updatable["marks_code"] = body.marks_code or None
    if body.in_marks is not None:
        updatable["in_marks"] = body.in_marks
    if body.county_id is not None:
        updatable["county_id"] = body.county_id
    if body.state_id is not None:
        updatable["state_id"] = body.state_id
    if body.municipality_id is not None:
        updatable["municipality_id"] = body.municipality_id
    # community_id uses model_fields_set so an explicit null (unassign) is honoured.
    if "community_id" in body.model_fields_set:
        updatable["community_id"] = body.community_id  # may be None → SQL NULL

    if not updatable:
        raise HTTPException(status_code=422, detail="No fields provided to update")

    set_clause = ", ".join(f"{col} = %s" for col in updatable)
    values = list(updatable.values()) + [dev_id]

    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
    try:
        cur.execute(f"UPDATE developments SET {set_clause}, updated_at = NOW() WHERE dev_id = %s", values)
        if cur.rowcount == 0:
            conn.rollback()
            raise HTTPException(status_code=404, detail=f"Development {dev_id} not found.")
        conn.commit()

        cur.execute(_SELECT_SQL + " WHERE d.dev_id = %s", (dev_id,))
        return _row_to_dict(cur.fetchone())
    except HTTPException:
        raise
    except Exception:
        conn.rollback()
        raise
    finally:
        cur.close()


# ---------------------------------------------------------------------------
# GET /developments/{dev_id}/lot-phase-view  (pre-existing endpoint)
# ---------------------------------------------------------------------------

_STATUS_SQL = """
    CASE
        WHEN date_cls IS NOT NULL                            THEN 'OUT'
        WHEN date_cmp IS NOT NULL                           THEN 'C'
        WHEN date_str IS NOT NULL                           THEN 'UC'
        WHEN date_td_hold IS NOT NULL AND date_td IS NULL   THEN 'H'
        WHEN date_td IS NOT NULL                            THEN 'U'
        WHEN date_dev IS NOT NULL                           THEN 'D'
        WHEN date_ent IS NOT NULL                           THEN 'E'
        ELSE 'P'
    END
"""


@router.get("/{dev_id}/lot-phase-view", response_model=DevLotPhaseViewResponse)
def lot_phase_view(dev_id: int, conn=Depends(get_db_conn)):
    import psycopg2.extras

    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
    try:
        # Verify dev exists (at least one phase)
        cur.execute(
            "SELECT COUNT(*) AS n FROM sim_dev_phases WHERE dev_id = %s", (dev_id,)
        )
        if cur.fetchone()["n"] == 0:
            raise HTTPException(status_code=404, detail=f"dev_id {dev_id} not found.")

        # Load phases ordered by sequence_number, phase_id
        cur.execute(
            """
            SELECT phase_id, phase_name, sequence_number, instrument_id
            FROM sim_dev_phases
            WHERE dev_id = %s
            ORDER BY sequence_number ASC, phase_id ASC
            """,
            (dev_id,),
        )
        phases_raw = list(cur.fetchall())
        phase_ids = [p["phase_id"] for p in phases_raw]

        if not phase_ids:
            return DevLotPhaseViewResponse(
                dev_id=dev_id, dev_name=f"dev {dev_id}", unassigned=[], phases=[]
            )

        # Load unassigned real lots (phase_id IS NULL, belonging to this dev via PG)
        cur.execute(
            f"""
            SELECT
                lot_id,
                lot_number,
                lot_type_id,
                lot_source,
                {_STATUS_SQL} AS status,
                (
                    (date_str IS NOT NULL OR date_cmp IS NOT NULL)
                    AND date_cls IS NULL
                ) AS has_actual_dates
            FROM sim_lots
            WHERE lot_source = 'real'
              AND phase_id IS NULL
              AND projection_group_id IN (
                  SELECT projection_group_id
                  FROM dim_projection_groups
                  WHERE dev_id = %s
              )
            ORDER BY lot_number ASC NULLS LAST
            """,
            (dev_id,),
        )
        unassigned_raw = list(cur.fetchall())
        unassigned_out = [
            {
                "lot_id": r["lot_id"],
                "lot_number": r["lot_number"],
                "lot_type_id": r["lot_type_id"],
                "lot_source": r["lot_source"],
                "status": r["status"],
                "has_actual_dates": bool(r["has_actual_dates"]),
            }
            for r in unassigned_raw
        ]

        # Load lots (real only) with derived status
        cur.execute(
            f"""
            SELECT
                lot_id,
                lot_number,
                lot_type_id,
                lot_source,
                phase_id,
                {_STATUS_SQL} AS status,
                (
                    (date_str IS NOT NULL OR date_cmp IS NOT NULL)
                    AND date_cls IS NULL
                ) AS has_actual_dates
            FROM sim_lots
            WHERE phase_id = ANY(%s) AND lot_source = 'real'
            ORDER BY lot_number ASC NULLS LAST
            """,
            (phase_ids,),
        )
        lots_raw = list(cur.fetchall())

        # Load splits (counts per phase × lot_type), including display name
        cur.execute(
            """
            SELECT s.phase_id, s.lot_type_id, s.lot_count AS projected,
                   r.lot_type_short
            FROM sim_phase_product_splits s
            JOIN ref_lot_types r ON r.lot_type_id = s.lot_type_id
            WHERE s.phase_id = ANY(%s)
            """,
            (phase_ids,),
        )
        splits_raw = list(cur.fetchall())

        # Count actual real lots per (phase_id, lot_type_id)
        actuals: dict[tuple, int] = {}
        for lot in lots_raw:
            key = (lot["phase_id"], lot["lot_type_id"])
            actuals[key] = actuals.get(key, 0) + 1

        # Build phase details
        lots_by_phase: dict[int, list] = {p["phase_id"]: [] for p in phases_raw}
        for lot in lots_raw:
            lots_by_phase[lot["phase_id"]].append(
                {
                    "lot_id": lot["lot_id"],
                    "lot_number": lot["lot_number"],
                    "lot_type_id": lot["lot_type_id"],
                    "lot_source": lot["lot_source"],
                    "status": lot["status"],
                    "has_actual_dates": bool(lot["has_actual_dates"]),
                }
            )

        splits_by_phase: dict[int, list] = {p["phase_id"]: [] for p in phases_raw}
        for s in splits_raw:
            pid, lt = s["phase_id"], s["lot_type_id"]
            actual = actuals.get((pid, lt), 0)
            projected = s["projected"]
            splits_by_phase[pid].append(
                {
                    "lot_type_id": lt,
                    "lot_type_short": s["lot_type_short"],
                    "actual": actual,
                    "projected": projected,
                    "total": max(actual, projected),
                }
            )

        phases_out = []
        for p in phases_raw:
            pid = p["phase_id"]
            phases_out.append(
                {
                    "phase_id": pid,
                    "phase_name": p["phase_name"],
                    "sequence_number": p["sequence_number"],
                    "dev_id": dev_id,
                    "instrument_id": p["instrument_id"],
                    "by_lot_type": splits_by_phase.get(pid, []),
                    "lots": lots_by_phase.get(pid, []),
                }
            )

        return DevLotPhaseViewResponse(
            dev_id=dev_id,
            dev_name=f"dev {dev_id}",
            unassigned=unassigned_out,
            phases=phases_out,
        )

    finally:
        cur.close()
