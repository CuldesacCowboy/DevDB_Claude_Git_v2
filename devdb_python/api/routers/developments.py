# routers/developments.py
# Development-level CRUD endpoints plus lot-phase-view sub-resource.

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from api.deps import get_db_conn
from api.db import dict_cursor
from api.models.lot_models import DevLotPhaseViewResponse
from api.sql_fragments import lot_status_sql

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
    cur = dict_cursor(conn)
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
    name = (body.dev_name or "").strip()
    if not name:
        raise HTTPException(status_code=422, detail="dev_name is required")
    cur = dict_cursor(conn)
    try:
        # 1. Insert into developments.
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
        new_id = int(cur.fetchone()["dev_id"])

        # 2. Ensure a dim_development row exists (bridge for instruments/phases/sim engine).
        #    Use the real marks_code if provided, otherwise a synthetic code DEV{dev_id:06d}.
        marks_code = body.marks_code or None
        if marks_code:
            # Check if dim_development already has this code (imported from MARKsystems).
            cur.execute("SELECT development_id FROM dim_development WHERE dev_code2 = %s", (marks_code,))
            existing = cur.fetchone()
        else:
            existing = None

        if not existing:
            synthetic_code = marks_code or f"DEV{new_id:06d}"
            if not marks_code:
                # Store the synthetic code so the bridge always resolves.
                cur.execute("UPDATE developments SET marks_code = %s WHERE dev_id = %s",
                            (synthetic_code, new_id))
            cur.execute("SELECT COALESCE(MAX(development_id), 0) + 1 FROM dim_development")
            legacy_id = int(cur.fetchone()[0])
            cur.execute(
                """INSERT INTO dim_development (development_id, development_name, dev_code2, active)
                   VALUES (%s, %s, %s, true)""",
                (legacy_id, name, synthetic_code),
            )
        else:
            legacy_id = int(existing["development_id"])

        # 3. Link to community in sim_ent_group_developments if community_id supplied.
        if body.community_id:
            cur.execute("SELECT COALESCE(MAX(id), 0) + 1 FROM sim_ent_group_developments")
            next_link_id = int(cur.fetchone()[0])
            cur.execute(
                """INSERT INTO sim_ent_group_developments (id, ent_group_id, dev_id)
                   VALUES (%s, %s, %s)
                   ON CONFLICT DO NOTHING""",
                (next_link_id, body.community_id, new_id),
            )

        conn.commit()
        cur.execute(_SELECT_SQL + " WHERE d.dev_id = %s", (new_id,))
        row = cur.fetchone()
        return _row_to_dict(row)
    except Exception as e:
        conn.rollback()
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        cur.close()


# ---------------------------------------------------------------------------
# GET  /developments/{dev_id}/floating-lots
# PATCH /developments/{dev_id}/floating-lots/assign
# ---------------------------------------------------------------------------

@router.get("/{dev_id}/floating-lots", response_model=list[dict])
def get_floating_lots(dev_id: int, conn=Depends(get_db_conn)):
    """Real lots whose lot_number matches this dev's marks_code prefix
    but have no phase assignment (phase_id IS NULL)."""
    cur = dict_cursor(conn)
    try:
        cur.execute("SELECT marks_code FROM developments WHERE dev_id = %s", (dev_id,))
        row = cur.fetchone()
        if not row or not row["marks_code"]:
            return []
        marks_code = row["marks_code"]
        cur.execute(
            """
            SELECT sl.lot_id, sl.lot_number, sl.lot_source,
                   EXISTS (SELECT 1 FROM devdb.marks_lot_registry mlr
                           WHERE mlr.lot_number = sl.lot_number) AS in_registry
            FROM sim_lots sl
            WHERE sl.lot_number LIKE %s
              AND sl.lot_source = 'real'
              AND sl.phase_id IS NULL
              AND sl.excluded IS NOT TRUE
            ORDER BY sl.lot_number
            """,
            (marks_code + "%",),
        )
        return [dict(r) for r in cur.fetchall()]
    finally:
        cur.close()


class FloatingLotAssignRequest(BaseModel):
    lot_ids: list[int]
    phase_id: int


@router.patch("/{dev_id}/floating-lots/assign", response_model=dict)
def assign_floating_lots(dev_id: int, body: FloatingLotAssignRequest, conn=Depends(get_db_conn)):
    """Assign floating lots (no phase) to a phase within this dev.
    Sets both dev_id and phase_id on the selected lots."""
    if not body.lot_ids:
        return {"assigned": 0}
    cur = dict_cursor(conn)
    try:
        # Verify phase belongs to this dev
        cur.execute(
            """
            SELECT sdp.phase_id FROM sim_dev_phases sdp
            JOIN sim_legal_instruments sli ON sli.instrument_id = sdp.instrument_id
            WHERE sdp.phase_id = %s AND sli.dev_id = %s
            """,
            (body.phase_id, dev_id),
        )
        if not cur.fetchone():
            raise HTTPException(status_code=422, detail="Phase does not belong to this development")
        cur.execute(
            """
            UPDATE sim_lots
            SET dev_id = %s, phase_id = %s, updated_at = NOW()
            WHERE lot_id = ANY(%s)
              AND lot_source = 'real'
              AND phase_id IS NULL
            """,
            (dev_id, body.phase_id, body.lot_ids),
        )
        assigned = cur.rowcount
        conn.commit()
        return {"assigned": assigned}
    except HTTPException:
        conn.rollback()
        raise
    except Exception as e:
        conn.rollback()
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        cur.close()


# ---------------------------------------------------------------------------
# DELETE /developments/{dev_id}  — cascade delete
# ---------------------------------------------------------------------------

@router.delete("/{dev_id}", response_model=dict)
def delete_development(dev_id: int, conn=Depends(get_db_conn)):
    """Delete a development and cascade-delete all its instruments and phases.
    Lots are unassigned (phase_id NULL) not deleted."""
    cur = dict_cursor(conn)
    try:
        cur.execute("SELECT dev_id FROM developments WHERE dev_id = %s", (dev_id,))
        if not cur.fetchone():
            raise HTTPException(status_code=404, detail=f"Development {dev_id} not found")

        # Find all instruments for this dev
        cur.execute(
            "SELECT instrument_id FROM sim_legal_instruments WHERE dev_id = %s",
            (dev_id,),
        )
        instr_ids = [r["instrument_id"] for r in cur.fetchall()]

        for instr_id in instr_ids:
            cur.execute("SELECT phase_id FROM sim_dev_phases WHERE instrument_id = %s", (instr_id,))
            phase_ids = [r["phase_id"] for r in cur.fetchall()]
            for phase_id in phase_ids:
                cur.execute("UPDATE sim_lots SET phase_id = NULL WHERE phase_id = %s", (phase_id,))
                cur.execute("DELETE FROM sim_phase_product_splits WHERE phase_id = %s", (phase_id,))
                cur.execute("DELETE FROM sim_phase_building_config WHERE phase_id = %s", (phase_id,))
                cur.execute("DELETE FROM sim_delivery_event_phases WHERE phase_id = %s", (phase_id,))
            cur.execute("DELETE FROM sim_dev_phases WHERE instrument_id = %s", (instr_id,))
        if instr_ids:
            cur.execute("DELETE FROM sim_instrument_builder_splits WHERE instrument_id = ANY(%s)", (instr_ids,))
        cur.execute("DELETE FROM sim_legal_instruments WHERE instrument_id = ANY(%s)", (instr_ids or [-1],))

        # Remove from ent group dev mapping, sim_dev_params, and clear sim_lots.dev_id
        cur.execute("DELETE FROM sim_ent_group_developments WHERE dev_id = %s", (dev_id,))
        cur.execute("DELETE FROM sim_dev_params WHERE dev_id = %s", (dev_id,))
        cur.execute("UPDATE sim_lots SET dev_id = NULL WHERE dev_id = %s", (dev_id,))

        # Verify no FK references remain before final delete
        cur.execute("SELECT COUNT(*) AS n FROM sim_ent_group_developments WHERE dev_id = %s", (dev_id,))
        remaining = cur.fetchone()["n"]
        if remaining:
            raise HTTPException(status_code=500, detail=f"segd still has {remaining} row(s) for dev {dev_id} after delete")

        cur.execute("DELETE FROM developments WHERE dev_id = %s", (dev_id,))
        conn.commit()
        return {"success": True, "dev_id": dev_id, "instruments_deleted": len(instr_ids)}
    except HTTPException:
        conn.rollback()
        raise
    except Exception as e:
        conn.rollback()
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        cur.close()


# ---------------------------------------------------------------------------
# GET /developments/{dev_id}  — single development
# ---------------------------------------------------------------------------

@router.get("/{dev_id}", response_model=dict)
def get_development(dev_id: int, conn=Depends(get_db_conn)):
    cur = dict_cursor(conn)
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

    cur = dict_cursor(conn)
    try:
        cur.execute(f"UPDATE developments SET {set_clause}, updated_at = NOW() WHERE dev_id = %s", values)
        if cur.rowcount == 0:
            conn.rollback()
            raise HTTPException(status_code=404, detail=f"Development {dev_id} not found.")

        # Keep dim_development name in sync if dev_name changed (reference table only — not operational).
        if "dev_name" in updatable:
            cur.execute("SELECT dev_name, marks_code FROM developments WHERE dev_id = %s", (dev_id,))
            dev_row = cur.fetchone()
            if dev_row and dev_row["marks_code"]:
                cur.execute(
                    "UPDATE dim_development SET development_name = %s WHERE dev_code2 = %s",
                    (dev_row["dev_name"], dev_row["marks_code"]),
                )

        conn.commit()
        cur.execute(_SELECT_SQL + " WHERE d.dev_id = %s", (dev_id,))
        return _row_to_dict(cur.fetchone())
    except HTTPException:
        raise
    except Exception as e:
        conn.rollback()
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        cur.close()


# ---------------------------------------------------------------------------
# PUT /developments/{dev_id}/sim-params  — upsert sim_dev_params row
# ---------------------------------------------------------------------------

class SimParamsPutRequest(BaseModel):
    annual_starts_target: int | None = None
    max_starts_per_month: int | None = None
    seasonal_weight_set: str | None = None


@router.put("/{dev_id}/sim-params", response_model=dict)
def upsert_sim_params(dev_id: int, body: SimParamsPutRequest, conn=Depends(get_db_conn)):
    cur = dict_cursor(conn)
    try:
        cur.execute(
            "SELECT dev_id FROM developments WHERE dev_id = %s", (dev_id,)
        )
        if cur.fetchone() is None:
            raise HTTPException(status_code=404, detail=f"Development {dev_id} not found.")
        if body.annual_starts_target is not None and body.annual_starts_target < 1:
            raise HTTPException(status_code=422, detail="annual_starts_target must be >= 1")

        # All fields are optional — use COALESCE so each field can be saved independently.
        # For INSERT (new row), annual_starts_target is required; return error if missing.
        cur.execute(
            "SELECT annual_starts_target FROM sim_dev_params WHERE dev_id = %s", (dev_id,)
        )
        existing = cur.fetchone()
        if existing is None and body.annual_starts_target is None:
            raise HTTPException(status_code=422, detail="annual_starts_target is required when creating params for the first time")

        cur.execute(
            """
            INSERT INTO sim_dev_params (dev_id, annual_starts_target, max_starts_per_month, seasonal_weight_set, updated_at)
            VALUES (%s, %s, %s, COALESCE(%s, 'balanced_2yr'), NOW())
            ON CONFLICT (dev_id) DO UPDATE
                SET annual_starts_target = COALESCE(EXCLUDED.annual_starts_target, sim_dev_params.annual_starts_target),
                    max_starts_per_month  = COALESCE(EXCLUDED.max_starts_per_month, sim_dev_params.max_starts_per_month),
                    seasonal_weight_set   = COALESCE(EXCLUDED.seasonal_weight_set,  sim_dev_params.seasonal_weight_set),
                    updated_at            = NOW()
            RETURNING dev_id, annual_starts_target, max_starts_per_month, seasonal_weight_set, updated_at
            """,
            (dev_id, body.annual_starts_target, body.max_starts_per_month, body.seasonal_weight_set),
        )
        row = cur.fetchone()
        conn.commit()
        return {
            "dev_id": row["dev_id"],
            "annual_starts_target": row["annual_starts_target"],
            "max_starts_per_month": row["max_starts_per_month"],
            "seasonal_weight_set": row["seasonal_weight_set"],
            "updated_at": row["updated_at"].isoformat() if row["updated_at"] else None,
        }
    except HTTPException:
        raise
    except Exception as e:
        conn.rollback()
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        cur.close()


# ---------------------------------------------------------------------------
# GET /developments/{dev_id}/lot-phase-view  (pre-existing endpoint)
# ---------------------------------------------------------------------------

_STATUS_SQL = lot_status_sql()


@router.get("/{dev_id}/lot-phase-view", response_model=DevLotPhaseViewResponse)
def lot_phase_view(dev_id: int, conn=Depends(get_db_conn)):

    cur = dict_cursor(conn)
    try:
        # Verify dev exists and load dev_name
        cur.execute(
            "SELECT dev_name FROM developments WHERE dev_id = %s", (dev_id,)
        )
        dev_row = cur.fetchone()
        if dev_row is None:
            raise HTTPException(status_code=404, detail=f"dev_id {dev_id} not found.")
        dev_name = dev_row["dev_name"]

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
                dev_id=dev_id, dev_name=dev_name, unassigned=[], phases=[]
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
              AND dev_id = %s
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
            SELECT s.phase_id, s.lot_type_id, s.projected_count AS projected,
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
            dev_name=dev_name,
            unassigned=unassigned_out,
            phases=phases_out,
        )

    finally:
        cur.close()
