# routers/tda_assignments.py
# Lot assignment, pool management, and HC/BLDR/DIG date/lock editing for TDAs.

from typing import Optional
from datetime import date as date_type

import psycopg2.extras
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from api.deps import get_db_conn
from api.db import dict_cursor


class AssignLotRequest(BaseModel):
    checkpoint_id: int


class UpdateDatesRequest(BaseModel):
    hc_projected_date: Optional[date_type] = None
    bldr_projected_date: Optional[date_type] = None
    dig_projected_date: Optional[date_type] = None


class UpdateLockRequest(BaseModel):
    hc_is_locked: Optional[bool] = None
    bldr_is_locked: Optional[bool] = None
    dig_is_locked: Optional[bool] = None


class UpdateLotTdaDatesRequest(BaseModel):
    hc_projected_date: Optional[date_type] = None
    bldr_projected_date: Optional[date_type] = None


# Maps API field names (hc/bldr/dig) to sim_lots DB columns
_DATE_COL = {
    'hc_projected_date':   'date_td_hold_projected',
    'bldr_projected_date': 'date_td_projected',
    'dig_projected_date':  'date_str_projected',
}
_LOCK_COL = {
    'hc_is_locked':   'date_td_hold_is_locked',
    'bldr_is_locked': 'date_td_is_locked',
    'dig_is_locked':  'date_str_is_locked',
}

router = APIRouter(tags=["takedown-agreements"])


@router.patch("/takedown-agreements/{tda_id}/lots/{lot_id}/assign")
def assign_lot_to_checkpoint(tda_id: int, lot_id: int, body: AssignLotRequest, conn=Depends(get_db_conn)):
    cur = dict_cursor(conn)
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
                (checkpoint_id, lot_id, assigned_at)
            VALUES (%s, %s, now())
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


@router.delete("/takedown-agreements/{tda_id}/lots/{lot_id}/assign")
def unassign_lot_from_checkpoint(tda_id: int, lot_id: int, conn=Depends(get_db_conn)):
    cur = dict_cursor(conn)
    try:
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

        cur.execute(
            "DELETE FROM devdb.sim_takedown_lot_assignments WHERE assignment_id = %s",
            (assignment_id,),
        )

        # Lot stays in sim_takedown_agreement_lots (TDA pool) — it will appear
        # in the pool bank until explicitly removed to the global unassigned bank.

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


@router.post("/takedown-agreements/{tda_id}/lots/{lot_id}/pool")
def add_lot_to_pool(tda_id: int, lot_id: int, conn=Depends(get_db_conn)):
    cur = dict_cursor(conn)
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


@router.delete("/takedown-agreements/{tda_id}/lots/{lot_id}/pool")
def remove_lot_from_pool(tda_id: int, lot_id: int, conn=Depends(get_db_conn)):
    cur = dict_cursor(conn)
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


@router.patch("/tda-lot-assignments/{assignment_id}/dates")
def update_lot_assignment_dates(assignment_id: int, body: UpdateDatesRequest, conn=Depends(get_db_conn)):
    cur = dict_cursor(conn)
    try:
        api_updates = {}
        for api_key in ('hc_projected_date', 'bldr_projected_date', 'dig_projected_date'):
            if api_key in body.model_fields_set:
                api_updates[api_key] = getattr(body, api_key)
        if not api_updates:
            raise HTTPException(status_code=422, detail="At least one date field must be provided.")

        db_updates = {_DATE_COL[k]: v for k, v in api_updates.items()}

        cur.execute(
            "SELECT assignment_id, checkpoint_id, lot_id FROM devdb.sim_takedown_lot_assignments WHERE assignment_id = %s",
            (assignment_id,),
        )
        asgn = cur.fetchone()
        if asgn is None:
            raise HTTPException(status_code=404, detail=f"Assignment {assignment_id} not found.")

        lot_id = asgn["lot_id"]
        checkpoint_id = asgn["checkpoint_id"]

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

        set_parts = [f"{col} = %s" for col in db_updates] + ["updated_at = now()"]
        set_values = list(db_updates.values())
        set_clause = ", ".join(set_parts)

        cur.execute(
            f"UPDATE devdb.sim_lots SET {set_clause} WHERE lot_id = %s RETURNING lot_id",
            set_values + [lot_id],
        )
        updated_lot_ids = [row["lot_id"] for row in cur.fetchall()]

        if building_group_id is not None and tda_id is not None:
            cur.execute(
                f"""
                UPDATE devdb.sim_lots SET {set_clause}
                WHERE lot_id != %s
                  AND building_group_id = %s
                  AND lot_id IN (
                      SELECT lot_id FROM devdb.sim_takedown_agreement_lots WHERE tda_id = %s
                  )
                RETURNING lot_id
                """,
                set_values + [lot_id, building_group_id, tda_id],
            )
            updated_lot_ids += [row["lot_id"] for row in cur.fetchall()]

        for lid in updated_lot_ids:
            cur.execute(
                """
                INSERT INTO devdb.sim_assignment_log
                    (action, resource_type, resource_id, from_owner_id, to_owner_id,
                     changed_by, changed_at, metadata)
                VALUES ('update_tda_lot_date', 'lot', %s, 0, 0, 'ui', now(), %s)
                """,
                (lid, psycopg2.extras.Json({})),
            )

        conn.commit()
        return {"assignment_id": assignment_id, "updated_lot_ids": updated_lot_ids}

    except HTTPException:
        conn.rollback()
        raise
    except Exception:
        conn.rollback()
        raise
    finally:
        cur.close()


@router.patch("/tda-lot-assignments/{assignment_id}/lock")
def update_lot_assignment_lock(assignment_id: int, body: UpdateLockRequest, conn=Depends(get_db_conn)):
    cur = dict_cursor(conn)
    try:
        api_updates = {}
        for api_key in ('hc_is_locked', 'bldr_is_locked', 'dig_is_locked'):
            if getattr(body, api_key) is not None:
                api_updates[api_key] = getattr(body, api_key)
        if not api_updates:
            raise HTTPException(status_code=422, detail="At least one lock field must be provided.")

        db_updates = {_LOCK_COL[k]: v for k, v in api_updates.items()}

        cur.execute(
            "SELECT assignment_id, checkpoint_id, lot_id FROM devdb.sim_takedown_lot_assignments WHERE assignment_id = %s",
            (assignment_id,),
        )
        asgn = cur.fetchone()
        if asgn is None:
            raise HTTPException(status_code=404, detail=f"Assignment {assignment_id} not found.")

        lot_id = asgn["lot_id"]
        checkpoint_id = asgn["checkpoint_id"]

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

        set_parts = [f"{col} = %s" for col in db_updates] + ["updated_at = now()"]
        set_values = list(db_updates.values())
        set_clause = ", ".join(set_parts)

        cur.execute(
            f"UPDATE devdb.sim_lots SET {set_clause} WHERE lot_id = %s RETURNING lot_id",
            set_values + [lot_id],
        )
        updated_lot_ids = [row["lot_id"] for row in cur.fetchall()]

        if building_group_id is not None and tda_id is not None:
            cur.execute(
                f"""
                UPDATE devdb.sim_lots SET {set_clause}
                WHERE lot_id != %s
                  AND building_group_id = %s
                  AND lot_id IN (
                      SELECT lot_id FROM devdb.sim_takedown_agreement_lots WHERE tda_id = %s
                  )
                RETURNING lot_id
                """,
                set_values + [lot_id, building_group_id, tda_id],
            )
            updated_lot_ids += [row["lot_id"] for row in cur.fetchall()]

        for lid in updated_lot_ids:
            cur.execute(
                """
                INSERT INTO devdb.sim_assignment_log
                    (action, resource_type, resource_id, from_owner_id, to_owner_id,
                     changed_by, changed_at, metadata)
                VALUES ('update_tda_lot_lock', 'lot', %s, 0, 0, 'ui', now(), %s)
                """,
                (lid, psycopg2.extras.Json({})),
            )

        conn.commit()
        return {"assignment_id": assignment_id, "updated_lot_ids": updated_lot_ids}

    except HTTPException:
        conn.rollback()
        raise
    except Exception:
        conn.rollback()
        raise
    finally:
        cur.close()


@router.patch("/tda-lots/{lot_id}/dates")
def update_tda_lot_dates_direct(lot_id: int, body: UpdateLotTdaDatesRequest, conn=Depends(get_db_conn)):
    """Update HC and/or BLDR projected dates directly on sim_lots.
    Works for pool lots that have no assignment_id yet."""
    cur = dict_cursor(conn)
    try:
        updates = []
        values = []
        if "hc_projected_date" in body.model_fields_set:
            updates.append("date_td_hold_projected = %s")
            values.append(body.hc_projected_date)
        if "bldr_projected_date" in body.model_fields_set:
            updates.append("date_td_projected = %s")
            values.append(body.bldr_projected_date)
        if not updates:
            raise HTTPException(status_code=422, detail="No date fields provided.")
        updates.append("updated_at = now()")
        values.append(lot_id)
        cur.execute(
            f"UPDATE devdb.sim_lots SET {', '.join(updates)} WHERE lot_id = %s RETURNING lot_id",
            values,
        )
        if cur.fetchone() is None:
            raise HTTPException(status_code=404, detail=f"Lot {lot_id} not found.")
        conn.commit()
        return {"lot_id": lot_id}
    except HTTPException:
        conn.rollback()
        raise
    except Exception:
        conn.rollback()
        raise
    finally:
        cur.close()
