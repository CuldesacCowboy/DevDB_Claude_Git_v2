# routers/takedown_agreements.py
# TDA read and write endpoints (Slice A + Slice B).
# Contract: DevDB_TDA_API_Contract_v1.md

from datetime import date as date_type
from typing import Optional

import psycopg2.extras
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from api.deps import get_db_conn


# ---------------------------------------------------------------------------
# Request models (Slice B)
# ---------------------------------------------------------------------------

class CreateTdaRequest(BaseModel):
    tda_name: str
    ent_group_id: int
    anchor_date: Optional[date_type] = None


class CreateCheckpointRequest(BaseModel):
    checkpoint_name: Optional[str] = None
    checkpoint_date: Optional[date_type] = None
    lots_required_cumulative: int = 0


class AssignLotRequest(BaseModel):
    checkpoint_id: int


class UpdateDatesRequest(BaseModel):
    hc_projected_date: Optional[date_type] = None
    bldr_projected_date: Optional[date_type] = None


class UpdateLockRequest(BaseModel):
    hc_is_locked: Optional[bool] = None
    bldr_is_locked: Optional[bool] = None

router = APIRouter(tags=["takedown-agreements"])


@router.get("/entitlement-groups/{ent_group_id}/takedown-agreements")
def list_takedown_agreements(ent_group_id: int, conn=Depends(get_db_conn)):
    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
    try:
        # 1. Look up ent_group
        cur.execute(
            "SELECT ent_group_id, ent_group_name FROM devdb.sim_entitlement_groups WHERE ent_group_id = %s",
            (ent_group_id,),
        )
        eg = cur.fetchone()
        if eg is None:
            raise HTTPException(status_code=404, detail=f"Entitlement group {ent_group_id} not found.")

        # 2. All TDAs for this ent_group
        cur.execute(
            """
            SELECT tda_id, tda_name, status, anchor_date
            FROM devdb.sim_takedown_agreements
            WHERE ent_group_id = %s
            ORDER BY tda_id ASC
            """,
            (ent_group_id,),
        )
        tda_rows = list(cur.fetchall())

        if not tda_rows:
            return {
                "ent_group_id": eg["ent_group_id"],
                "ent_group_name": eg["ent_group_name"],
                "agreements": [],
            }

        tda_ids = [r["tda_id"] for r in tda_rows]

        # 3a. total_lots per tda_id
        cur.execute(
            """
            SELECT tda_id, COUNT(*) AS total_lots
            FROM devdb.sim_takedown_agreement_lots
            WHERE tda_id = ANY(%s)
            GROUP BY tda_id
            """,
            (tda_ids,),
        )
        total_lots_map = {r["tda_id"]: int(r["total_lots"]) for r in cur.fetchall()}

        # 3b. checkpoint_count per tda_id
        cur.execute(
            """
            SELECT tda_id, COUNT(*) AS checkpoint_count
            FROM devdb.sim_takedown_checkpoints
            WHERE tda_id = ANY(%s)
            GROUP BY tda_id
            """,
            (tda_ids,),
        )
        checkpoint_count_map = {r["tda_id"]: int(r["checkpoint_count"]) for r in cur.fetchall()}

        agreements = [
            {
                "tda_id": r["tda_id"],
                "tda_name": r["tda_name"],
                "status": r["status"],
                "anchor_date": r["anchor_date"].isoformat() if r["anchor_date"] else None,
                "total_lots": total_lots_map.get(r["tda_id"], 0),
                "checkpoint_count": checkpoint_count_map.get(r["tda_id"], 0),
            }
            for r in tda_rows
        ]

        return {
            "ent_group_id": eg["ent_group_id"],
            "ent_group_name": eg["ent_group_name"],
            "agreements": agreements,
        }
    finally:
        cur.close()


@router.post("/takedown-agreements")
def create_takedown_agreement(body: CreateTdaRequest, conn=Depends(get_db_conn)):
    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
    try:
        if not body.tda_name or not body.tda_name.strip():
            raise HTTPException(status_code=422, detail="tda_name must not be empty.")

        # Verify ent_group exists
        cur.execute(
            "SELECT ent_group_id FROM devdb.sim_entitlement_groups WHERE ent_group_id = %s",
            (body.ent_group_id,),
        )
        if cur.fetchone() is None:
            raise HTTPException(status_code=404, detail=f"Entitlement group {body.ent_group_id} not found.")

        # Generate tda_id
        cur.execute("SELECT COALESCE(MAX(tda_id), 0) + 1 AS new_id FROM devdb.sim_takedown_agreements")
        new_id = int(cur.fetchone()["new_id"])

        cur.execute(
            """
            INSERT INTO devdb.sim_takedown_agreements
                (tda_id, tda_name, ent_group_id, anchor_date, status, checkpoint_lead_days, created_at, updated_at)
            VALUES (%s, %s, %s, %s, 'active', 16, now(), now())
            RETURNING tda_id, tda_name, status, anchor_date
            """,
            (new_id, body.tda_name.strip(), body.ent_group_id, body.anchor_date),
        )
        row = cur.fetchone()
        conn.commit()
        return {
            "tda_id": row["tda_id"],
            "tda_name": row["tda_name"],
            "status": row["status"],
            "anchor_date": row["anchor_date"].isoformat() if row["anchor_date"] else None,
        }
    except HTTPException:
        conn.rollback()
        raise
    except Exception:
        conn.rollback()
        raise
    finally:
        cur.close()


@router.get("/takedown-agreements/{tda_id}/detail")
def get_takedown_agreement_detail(tda_id: int, conn=Depends(get_db_conn)):
    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
    try:
        # 1. Look up TDA
        cur.execute(
            "SELECT tda_id, tda_name, status, anchor_date FROM devdb.sim_takedown_agreements WHERE tda_id = %s",
            (tda_id,),
        )
        tda = cur.fetchone()
        if tda is None:
            raise HTTPException(status_code=404, detail=f"Takedown agreement {tda_id} not found.")

        # 2. Checkpoints ordered by checkpoint_number
        cur.execute(
            """
            SELECT checkpoint_id, checkpoint_number, checkpoint_name,
                   checkpoint_date, status, lots_required_cumulative
            FROM devdb.sim_takedown_checkpoints
            WHERE tda_id = %s
            ORDER BY checkpoint_number ASC
            """,
            (tda_id,),
        )
        checkpoint_rows = list(cur.fetchall())
        checkpoint_ids = [r["checkpoint_id"] for r in checkpoint_rows]

        # 3. All lot assignments for this TDA's checkpoints, joined to sim_lots
        assignments_by_checkpoint: dict[int, list] = {r["checkpoint_id"]: [] for r in checkpoint_rows}
        if checkpoint_ids:
            cur.execute(
                """
                SELECT
                    a.assignment_id,
                    a.checkpoint_id,
                    a.lot_id,
                    a.hc_projected_date,
                    a.hc_is_locked,
                    a.bldr_projected_date,
                    a.bldr_is_locked,
                    l.lot_number,
                    l.building_group_id,
                    l.date_str   AS hc_marks_date,
                    l.date_cmp   AS bldr_marks_date
                FROM devdb.sim_takedown_lot_assignments a
                JOIN devdb.sim_lots l ON l.lot_id = a.lot_id
                WHERE a.checkpoint_id = ANY(%s)
                ORDER BY a.assignment_id ASC
                """,
                (checkpoint_ids,),
            )
            for row in cur.fetchall():
                assignments_by_checkpoint[row["checkpoint_id"]].append(
                    {
                        "assignment_id": row["assignment_id"],
                        "lot_id": row["lot_id"],
                        "lot_number": row["lot_number"],
                        "building_group_id": row["building_group_id"],
                        "hc_marks_date": row["hc_marks_date"].isoformat() if row["hc_marks_date"] else None,
                        "hc_projected_date": row["hc_projected_date"].isoformat() if row["hc_projected_date"] else None,
                        "hc_is_locked": bool(row["hc_is_locked"]),
                        "bldr_marks_date": row["bldr_marks_date"].isoformat() if row["bldr_marks_date"] else None,
                        "bldr_projected_date": row["bldr_projected_date"].isoformat() if row["bldr_projected_date"] else None,
                        "bldr_is_locked": bool(row["bldr_is_locked"]),
                    }
                )

        # 4. Unassigned lots: all real lots in the entitlement group
        #    that are NOT yet linked to any TDA for this ent_group.
        #    Join path: sim_lots -> sim_dev_phases -> dim_development -> developments -> community_id = ent_group_id
        cur.execute(
            "SELECT ent_group_id FROM devdb.sim_takedown_agreements WHERE tda_id = %s",
            (tda_id,),
        )
        tda_eg_row = cur.fetchone()
        ent_group_id = tda_eg_row["ent_group_id"] if tda_eg_row else None

        if ent_group_id is not None:
            cur.execute(
                """
                SELECT DISTINCT l.lot_id, l.lot_number, l.building_group_id
                FROM devdb.sim_lots l
                JOIN devdb.sim_dev_phases p ON p.phase_id = l.phase_id
                JOIN devdb.dim_development dd ON dd.development_id = p.dev_id
                JOIN devdb.developments d ON d.marks_code = dd.dev_code2
                WHERE d.community_id = %s
                  AND d.marks_code IS NOT NULL
                  AND l.lot_source = 'real'
                  AND l.lot_id NOT IN (
                      SELECT tal.lot_id
                      FROM devdb.sim_takedown_agreement_lots tal
                      JOIN devdb.sim_takedown_agreements tda ON tda.tda_id = tal.tda_id
                      WHERE tda.ent_group_id = %s
                  )
                ORDER BY l.lot_number ASC
                """,
                (ent_group_id, ent_group_id),
            )
        else:
            cur.execute("SELECT 1 WHERE false")

        unassigned_lots = [
            {
                "lot_id": r["lot_id"],
                "lot_number": r["lot_number"],
                "building_group_id": r["building_group_id"],
            }
            for r in cur.fetchall()
        ]

        # 5. TDA pool lots: in sim_takedown_agreement_lots for THIS tda but not yet
        #    assigned to any checkpoint.
        cur.execute(
            """
            SELECT l.lot_id, l.lot_number, l.building_group_id
            FROM devdb.sim_takedown_agreement_lots tal
            JOIN devdb.sim_lots l ON l.lot_id = tal.lot_id
            WHERE tal.tda_id = %s
              AND tal.lot_id NOT IN (
                  SELECT a.lot_id
                  FROM devdb.sim_takedown_lot_assignments a
                  JOIN devdb.sim_takedown_checkpoints c ON c.checkpoint_id = a.checkpoint_id
                  WHERE c.tda_id = %s
              )
            ORDER BY l.lot_number ASC
            """,
            (tda_id, tda_id),
        )
        pool_lots = [
            {
                "lot_id": r["lot_id"],
                "lot_number": r["lot_number"],
                "building_group_id": r["building_group_id"],
            }
            for r in cur.fetchall()
        ]

        checkpoints = [
            {
                "checkpoint_id": r["checkpoint_id"],
                "checkpoint_number": r["checkpoint_number"],
                "checkpoint_name": r["checkpoint_name"],
                "checkpoint_date": r["checkpoint_date"].isoformat() if r["checkpoint_date"] else None,
                "status": r["status"],
                "lots_required_cumulative": r["lots_required_cumulative"],
                "lots": assignments_by_checkpoint.get(r["checkpoint_id"], []),
            }
            for r in checkpoint_rows
        ]

        return {
            "tda_id": tda["tda_id"],
            "tda_name": tda["tda_name"],
            "status": tda["status"],
            "anchor_date": tda["anchor_date"].isoformat() if tda["anchor_date"] else None,
            "checkpoints": checkpoints,
            "pool_lots": pool_lots,
            "unassigned_lots": unassigned_lots,
        }
    finally:
        cur.close()


# ---------------------------------------------------------------------------
# Endpoint: POST /takedown-agreements/{tda_id}/checkpoints
# ---------------------------------------------------------------------------

@router.post("/takedown-agreements/{tda_id}/checkpoints")
def create_checkpoint(tda_id: int, body: CreateCheckpointRequest, conn=Depends(get_db_conn)):
    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
    try:
        cur.execute(
            "SELECT tda_id FROM devdb.sim_takedown_agreements WHERE tda_id = %s",
            (tda_id,),
        )
        if cur.fetchone() is None:
            raise HTTPException(status_code=404, detail=f"TDA {tda_id} not found.")

        cur.execute(
            "SELECT COALESCE(MAX(checkpoint_number), 0) + 1 AS next_num FROM devdb.sim_takedown_checkpoints WHERE tda_id = %s",
            (tda_id,),
        )
        next_num = int(cur.fetchone()["next_num"])
        name = body.checkpoint_name.strip() if body.checkpoint_name else f"CP {next_num}"

        cur.execute(
            """
            INSERT INTO devdb.sim_takedown_checkpoints
                (tda_id, checkpoint_number, checkpoint_name, checkpoint_date,
                 lots_required_cumulative, status)
            VALUES (%s, %s, %s, %s, %s, 'pending')
            RETURNING checkpoint_id, checkpoint_number, checkpoint_name,
                      checkpoint_date, lots_required_cumulative, status
            """,
            (tda_id, next_num, name, body.checkpoint_date,
             body.lots_required_cumulative),
        )
        row = cur.fetchone()
        conn.commit()
        return {
            "checkpoint_id": row["checkpoint_id"],
            "checkpoint_number": row["checkpoint_number"],
            "checkpoint_name": row["checkpoint_name"],
            "checkpoint_date": row["checkpoint_date"].isoformat() if row["checkpoint_date"] else None,
            "lots_required_cumulative": row["lots_required_cumulative"],
            "status": row["status"],
        }
    except HTTPException:
        conn.rollback()
        raise
    except Exception:
        conn.rollback()
        raise
    finally:
        cur.close()


# ---------------------------------------------------------------------------
# Endpoint 3: PATCH /takedown-agreements/{tda_id}/lots/{lot_id}/assign
# ---------------------------------------------------------------------------

@router.patch("/takedown-agreements/{tda_id}/lots/{lot_id}/assign")
def assign_lot_to_checkpoint(tda_id: int, lot_id: int, body: AssignLotRequest, conn=Depends(get_db_conn)):
    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
    try:
        checkpoint_id = body.checkpoint_id

        # 1. Ensure lot_id is linked to this tda_id in sim_takedown_agreement_lots;
        #    insert if not already present (lot comes from the global unassigned pool).
        cur.execute(
            "SELECT 1 FROM devdb.sim_takedown_agreement_lots WHERE tda_id = %s AND lot_id = %s",
            (tda_id, lot_id),
        )
        if cur.fetchone() is None:
            cur.execute(
                "INSERT INTO devdb.sim_takedown_agreement_lots (tda_id, lot_id) VALUES (%s, %s)",
                (tda_id, lot_id),
            )

        # 2. Check if lot is already assigned to a checkpoint in this TDA.
        #    If so, move it (UPDATE checkpoint_id) rather than inserting a new row,
        #    so that HC/BLDR projected dates and lock states are preserved.
        cur.execute(
            """
            SELECT a.assignment_id, a.checkpoint_id AS old_checkpoint_id
            FROM devdb.sim_takedown_lot_assignments a
            JOIN devdb.sim_takedown_checkpoints c ON c.checkpoint_id = a.checkpoint_id
            WHERE c.tda_id = %s AND a.lot_id = %s
            """,
            (tda_id, lot_id),
        )
        existing = cur.fetchone()
        if existing is not None:
            existing_assignment_id = existing["assignment_id"]
            old_checkpoint_id = existing["old_checkpoint_id"]
            cur.execute(
                "UPDATE devdb.sim_takedown_lot_assignments SET checkpoint_id = %s WHERE assignment_id = %s",
                (checkpoint_id, existing_assignment_id),
            )
            cur.execute(
                """
                INSERT INTO devdb.sim_assignment_log
                    (action, resource_type, resource_id, from_owner_id, to_owner_id,
                     changed_by, changed_at, metadata)
                VALUES ('move_lot_to_checkpoint', 'lot', %s, %s, %s, 'ui', now(), %s)
                """,
                (lot_id, old_checkpoint_id, checkpoint_id, psycopg2.extras.Json({})),
            )
            conn.commit()
            return {"assignment_id": existing_assignment_id, "lot_id": lot_id, "checkpoint_id": checkpoint_id}

        # 3. Verify checkpoint_id belongs to this tda_id
        cur.execute(
            "SELECT 1 FROM devdb.sim_takedown_checkpoints WHERE checkpoint_id = %s AND tda_id = %s",
            (checkpoint_id, tda_id),
        )
        if cur.fetchone() is None:
            raise HTTPException(status_code=422, detail=f"Checkpoint {checkpoint_id} does not belong to TDA {tda_id}.")

        # 4. INSERT into sim_takedown_lot_assignments — assignment_id uses sequence default
        cur.execute(
            """
            INSERT INTO devdb.sim_takedown_lot_assignments
                (checkpoint_id, lot_id, assigned_at, hc_is_locked, bldr_is_locked)
            VALUES (%s, %s, now(), false, false)
            RETURNING assignment_id
            """,
            (checkpoint_id, lot_id),
        )
        new_assignment_id = int(cur.fetchone()["assignment_id"])

        # 5. Audit log
        cur.execute(
            """
            INSERT INTO devdb.sim_assignment_log
                (action, resource_type, resource_id, from_owner_id, to_owner_id,
                 changed_by, changed_at, metadata)
            VALUES ('assign_lot_to_checkpoint', 'lot', %s, 0, %s, 'ui', now(), %s)
            """,
            (lot_id, checkpoint_id, psycopg2.extras.Json({})),
        )

        conn.commit()
        return {"assignment_id": new_assignment_id, "lot_id": lot_id, "checkpoint_id": checkpoint_id}

    except HTTPException:
        conn.rollback()
        raise
    except Exception:
        conn.rollback()
        raise
    finally:
        cur.close()


# ---------------------------------------------------------------------------
# Endpoint 4: DELETE /takedown-agreements/{tda_id}/lots/{lot_id}/assign
# ---------------------------------------------------------------------------

@router.delete("/takedown-agreements/{tda_id}/lots/{lot_id}/assign")
def unassign_lot_from_checkpoint(tda_id: int, lot_id: int, conn=Depends(get_db_conn)):
    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
    try:
        # 1. Look up assignment_id, confirm checkpoint belongs to this tda_id
        cur.execute(
            """
            SELECT a.assignment_id, a.checkpoint_id
            FROM devdb.sim_takedown_lot_assignments a
            JOIN devdb.sim_takedown_checkpoints c ON c.checkpoint_id = a.checkpoint_id
            WHERE c.tda_id = %s AND a.lot_id = %s
            """,
            (tda_id, lot_id),
        )
        row = cur.fetchone()
        if row is None:
            raise HTTPException(status_code=404, detail=f"No assignment found for lot {lot_id} in TDA {tda_id}.")

        assignment_id = row["assignment_id"]
        checkpoint_id = row["checkpoint_id"]

        # 2. DELETE the checkpoint assignment
        cur.execute(
            "DELETE FROM devdb.sim_takedown_lot_assignments WHERE assignment_id = %s",
            (assignment_id,),
        )

        # 3. Lot stays in sim_takedown_agreement_lots (TDA pool) — it will appear
        #    in the pool bank until explicitly removed to the global unassigned bank.

        # 4. Audit log
        cur.execute(
            """
            INSERT INTO devdb.sim_assignment_log
                (action, resource_type, resource_id, from_owner_id, to_owner_id,
                 changed_by, changed_at, metadata)
            VALUES ('unassign_lot_from_checkpoint', 'lot', %s, %s, 0, 'ui', now(), %s)
            """,
            (lot_id, checkpoint_id, psycopg2.extras.Json({})),
        )

        conn.commit()
        return {"lot_id": lot_id, "unassigned": True}

    except HTTPException:
        conn.rollback()
        raise
    except Exception:
        conn.rollback()
        raise
    finally:
        cur.close()


# ---------------------------------------------------------------------------
# Endpoint: POST /takedown-agreements/{tda_id}/lots/{lot_id}/pool
# Add a lot to the TDA pool (sim_takedown_agreement_lots) without assigning
# it to a checkpoint.
# ---------------------------------------------------------------------------

@router.post("/takedown-agreements/{tda_id}/lots/{lot_id}/pool")
def add_lot_to_pool(tda_id: int, lot_id: int, conn=Depends(get_db_conn)):
    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
    try:
        cur.execute(
            "SELECT tda_id FROM devdb.sim_takedown_agreements WHERE tda_id = %s",
            (tda_id,),
        )
        if cur.fetchone() is None:
            raise HTTPException(status_code=404, detail=f"TDA {tda_id} not found.")

        cur.execute(
            "SELECT 1 FROM devdb.sim_lots WHERE lot_id = %s",
            (lot_id,),
        )
        if cur.fetchone() is None:
            raise HTTPException(status_code=404, detail=f"Lot {lot_id} not found.")

        # Idempotent insert
        cur.execute(
            "SELECT 1 FROM devdb.sim_takedown_agreement_lots WHERE tda_id = %s AND lot_id = %s",
            (tda_id, lot_id),
        )
        if cur.fetchone() is None:
            cur.execute(
                "INSERT INTO devdb.sim_takedown_agreement_lots (tda_id, lot_id) VALUES (%s, %s)",
                (tda_id, lot_id),
            )

        conn.commit()
        return {"lot_id": lot_id, "tda_id": tda_id, "in_pool": True}
    except HTTPException:
        conn.rollback()
        raise
    except Exception:
        conn.rollback()
        raise
    finally:
        cur.close()


# ---------------------------------------------------------------------------
# Endpoint: DELETE /takedown-agreements/{tda_id}/lots/{lot_id}/pool
# Remove a lot from the TDA pool entirely — also clears any checkpoint
# assignment, returning the lot to the global unassigned bank.
# ---------------------------------------------------------------------------

@router.delete("/takedown-agreements/{tda_id}/lots/{lot_id}/pool")
def remove_lot_from_pool(tda_id: int, lot_id: int, conn=Depends(get_db_conn)):
    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
    try:
        # Clear any checkpoint assignment first (may or may not exist)
        cur.execute(
            """
            DELETE FROM devdb.sim_takedown_lot_assignments
            WHERE lot_id = %s
              AND checkpoint_id IN (
                  SELECT checkpoint_id FROM devdb.sim_takedown_checkpoints WHERE tda_id = %s
              )
            """,
            (lot_id, tda_id),
        )
        # Remove from TDA pool
        cur.execute(
            "DELETE FROM devdb.sim_takedown_agreement_lots WHERE tda_id = %s AND lot_id = %s",
            (tda_id, lot_id),
        )

        conn.commit()
        return {"lot_id": lot_id, "tda_id": tda_id, "in_pool": False}
    except HTTPException:
        conn.rollback()
        raise
    except Exception:
        conn.rollback()
        raise
    finally:
        cur.close()


# ---------------------------------------------------------------------------
# Endpoint 5: PATCH /tda-lot-assignments/{assignment_id}/dates
# ---------------------------------------------------------------------------

@router.patch("/tda-lot-assignments/{assignment_id}/dates")
def update_lot_assignment_dates(assignment_id: int, body: UpdateDatesRequest, conn=Depends(get_db_conn)):
    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
    try:
        # Validate at least one field explicitly provided (null clears the field)
        updates = {}
        if "hc_projected_date" in body.model_fields_set:
            updates["hc_projected_date"] = body.hc_projected_date
        if "bldr_projected_date" in body.model_fields_set:
            updates["bldr_projected_date"] = body.bldr_projected_date
        if not updates:
            raise HTTPException(status_code=422, detail="At least one date field must be provided.")

        # 1. Look up the assignment row
        cur.execute(
            """
            SELECT a.assignment_id, a.checkpoint_id, a.lot_id,
                   a.hc_projected_date, a.bldr_projected_date
            FROM devdb.sim_takedown_lot_assignments a
            WHERE a.assignment_id = %s
            """,
            (assignment_id,),
        )
        asgn = cur.fetchone()
        if asgn is None:
            raise HTTPException(status_code=404, detail=f"Assignment {assignment_id} not found.")

        lot_id = asgn["lot_id"]
        checkpoint_id = asgn["checkpoint_id"]

        # 2. Look up building_group_id and tda_id
        cur.execute(
            "SELECT building_group_id FROM devdb.sim_lots WHERE lot_id = %s",
            (lot_id,),
        )
        lot_row = cur.fetchone()
        building_group_id = lot_row["building_group_id"] if lot_row else None

        cur.execute(
            "SELECT tda_id FROM devdb.sim_takedown_checkpoints WHERE checkpoint_id = %s",
            (checkpoint_id,),
        )
        cp_row = cur.fetchone()
        tda_id = cp_row["tda_id"] if cp_row else None

        # 3. Build SET clause
        set_parts = [f"{col} = %s" for col in updates]
        set_values = list(updates.values())
        set_clause = ", ".join(set_parts)

        # 4. UPDATE the target assignment row first — collect it as the first updated id
        cur.execute(
            f"UPDATE devdb.sim_takedown_lot_assignments SET {set_clause} WHERE assignment_id = %s RETURNING assignment_id",
            set_values + [assignment_id],
        )
        updated_ids = [row["assignment_id"] for row in cur.fetchall()]

        # 5. Fan-out to building group mates within the same TDA
        if building_group_id is not None and tda_id is not None:
            cur.execute(
                f"""
                UPDATE devdb.sim_takedown_lot_assignments SET {set_clause}
                WHERE assignment_id != %s
                  AND lot_id IN (
                      SELECT lot_id FROM devdb.sim_lots WHERE building_group_id = %s
                  )
                  AND checkpoint_id IN (
                      SELECT checkpoint_id FROM devdb.sim_takedown_checkpoints WHERE tda_id = %s
                  )
                RETURNING assignment_id
                """,
                set_values + [assignment_id, building_group_id, tda_id],
            )
            updated_ids += [row["assignment_id"] for row in cur.fetchall()]

        # 6. Audit log — one entry per updated assignment_id
        for aid in updated_ids:
            cur.execute(
                """
                INSERT INTO devdb.sim_assignment_log
                    (action, resource_type, resource_id, from_owner_id, to_owner_id,
                     changed_by, changed_at, metadata)
                VALUES ('update_tda_lot_date', 'tda_assignment', %s, 0, 0, 'ui', now(), %s)
                """,
                (aid, psycopg2.extras.Json({})),
            )

        conn.commit()

        return {
            "assignment_id": assignment_id,
            "updated_assignment_ids": updated_ids,
            "hc_projected_date": updates.get("hc_projected_date", asgn["hc_projected_date"]),
            "bldr_projected_date": updates.get("bldr_projected_date", asgn["bldr_projected_date"]),
        }

    except HTTPException:
        conn.rollback()
        raise
    except Exception:
        conn.rollback()
        raise
    finally:
        cur.close()


# ---------------------------------------------------------------------------
# Endpoint 6: PATCH /tda-lot-assignments/{assignment_id}/lock
# ---------------------------------------------------------------------------

@router.patch("/tda-lot-assignments/{assignment_id}/lock")
def update_lot_assignment_lock(assignment_id: int, body: UpdateLockRequest, conn=Depends(get_db_conn)):
    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
    try:
        # Validate at least one field provided
        updates = {}
        if body.hc_is_locked is not None:
            updates["hc_is_locked"] = body.hc_is_locked
        if body.bldr_is_locked is not None:
            updates["bldr_is_locked"] = body.bldr_is_locked
        if not updates:
            raise HTTPException(status_code=422, detail="At least one lock field must be provided.")

        # 1. Look up the assignment row
        cur.execute(
            """
            SELECT a.assignment_id, a.checkpoint_id, a.lot_id,
                   a.hc_is_locked, a.bldr_is_locked
            FROM devdb.sim_takedown_lot_assignments a
            WHERE a.assignment_id = %s
            """,
            (assignment_id,),
        )
        asgn = cur.fetchone()
        if asgn is None:
            raise HTTPException(status_code=404, detail=f"Assignment {assignment_id} not found.")

        lot_id = asgn["lot_id"]
        checkpoint_id = asgn["checkpoint_id"]

        # 2. Look up building_group_id and tda_id
        cur.execute(
            "SELECT building_group_id FROM devdb.sim_lots WHERE lot_id = %s",
            (lot_id,),
        )
        lot_row = cur.fetchone()
        building_group_id = lot_row["building_group_id"] if lot_row else None

        cur.execute(
            "SELECT tda_id FROM devdb.sim_takedown_checkpoints WHERE checkpoint_id = %s",
            (checkpoint_id,),
        )
        cp_row = cur.fetchone()
        tda_id = cp_row["tda_id"] if cp_row else None

        # 3. Build SET clause
        set_parts = [f"{col} = %s" for col in updates]
        set_values = list(updates.values())
        set_clause = ", ".join(set_parts)

        # 4. UPDATE the target assignment row
        cur.execute(
            f"UPDATE devdb.sim_takedown_lot_assignments SET {set_clause} WHERE assignment_id = %s RETURNING assignment_id",
            set_values + [assignment_id],
        )
        updated_ids = [row["assignment_id"] for row in cur.fetchall()]

        # 5. Fan-out to building group mates within the same TDA
        if building_group_id is not None and tda_id is not None:
            cur.execute(
                f"""
                UPDATE devdb.sim_takedown_lot_assignments SET {set_clause}
                WHERE assignment_id != %s
                  AND lot_id IN (
                      SELECT lot_id FROM devdb.sim_lots WHERE building_group_id = %s
                  )
                  AND checkpoint_id IN (
                      SELECT checkpoint_id FROM devdb.sim_takedown_checkpoints WHERE tda_id = %s
                  )
                RETURNING assignment_id
                """,
                set_values + [assignment_id, building_group_id, tda_id],
            )
            updated_ids += [row["assignment_id"] for row in cur.fetchall()]

        # 6. Audit log — one entry per updated assignment_id
        for aid in updated_ids:
            cur.execute(
                """
                INSERT INTO devdb.sim_assignment_log
                    (action, resource_type, resource_id, from_owner_id, to_owner_id,
                     changed_by, changed_at, metadata)
                VALUES ('update_tda_lot_lock', 'tda_assignment', %s, 0, 0, 'ui', now(), %s)
                """,
                (aid, psycopg2.extras.Json({})),
            )

        conn.commit()

        return {
            "assignment_id": assignment_id,
            "updated_assignment_ids": updated_ids,
            "hc_is_locked": updates.get("hc_is_locked", bool(asgn["hc_is_locked"])),
            "bldr_is_locked": updates.get("bldr_is_locked", bool(asgn["bldr_is_locked"])),
        }

    except HTTPException:
        conn.rollback()
        raise
    except Exception:
        conn.rollback()
        raise
    finally:
        cur.close()
