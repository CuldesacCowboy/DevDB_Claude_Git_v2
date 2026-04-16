# routers/tda_checkpoints.py
# Checkpoint CRUD for takedown agreements.

from typing import Optional
from datetime import date as date_type

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from api.deps import get_db_conn
from api.db import dict_cursor


class CreateCheckpointRequest(BaseModel):
    checkpoint_name: Optional[str] = None
    checkpoint_date: Optional[date_type] = None
    lots_required_cumulative: int = 0


class PatchCheckpointRequest(BaseModel):
    checkpoint_date: Optional[date_type] = None
    lots_required_cumulative: Optional[int] = None


router = APIRouter(tags=["takedown-agreements"])


@router.post("/takedown-agreements/{tda_id}/checkpoints")
def create_checkpoint(tda_id: int, body: CreateCheckpointRequest, conn=Depends(get_db_conn)):
    cur = dict_cursor(conn)
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


@router.patch("/tda-checkpoints/{checkpoint_id}")
def patch_checkpoint(checkpoint_id: int, body: PatchCheckpointRequest, conn=Depends(get_db_conn)):
    """Edit checkpoint_date and/or lots_required_cumulative."""
    cur = dict_cursor(conn)
    try:
        updates = []
        values = []
        if "checkpoint_date" in body.model_fields_set:
            updates.append("checkpoint_date = %s")
            values.append(body.checkpoint_date)
        if body.lots_required_cumulative is not None:
            updates.append("lots_required_cumulative = %s")
            values.append(body.lots_required_cumulative)
        if not updates:
            raise HTTPException(status_code=422, detail="No fields provided to update.")
        values.append(checkpoint_id)
        cur.execute(
            f"UPDATE devdb.sim_takedown_checkpoints SET {', '.join(updates)} WHERE checkpoint_id = %s"
            " RETURNING checkpoint_id, checkpoint_number, checkpoint_date, lots_required_cumulative",
            values,
        )
        row = cur.fetchone()
        if row is None:
            raise HTTPException(status_code=404, detail=f"Checkpoint {checkpoint_id} not found.")
        conn.commit()
        return {
            "checkpoint_id": row["checkpoint_id"],
            "checkpoint_number": row["checkpoint_number"],
            "checkpoint_date": row["checkpoint_date"].isoformat() if row["checkpoint_date"] else None,
            "lots_required_cumulative": row["lots_required_cumulative"],
        }
    except HTTPException:
        conn.rollback()
        raise
    except Exception:
        conn.rollback()
        raise
    finally:
        cur.close()


@router.delete("/tda-checkpoints/{checkpoint_id}", status_code=204)
def delete_checkpoint(checkpoint_id: int, conn=Depends(get_db_conn)):
    """Delete a checkpoint and its lot assignments."""
    cur = dict_cursor(conn)
    try:
        cur.execute(
            "SELECT checkpoint_id FROM devdb.sim_takedown_checkpoints WHERE checkpoint_id = %s",
            (checkpoint_id,),
        )
        if cur.fetchone() is None:
            raise HTTPException(status_code=404, detail=f"Checkpoint {checkpoint_id} not found.")
        cur.execute(
            "DELETE FROM devdb.sim_takedown_lot_assignments WHERE checkpoint_id = %s",
            (checkpoint_id,),
        )
        cur.execute(
            "DELETE FROM devdb.sim_takedown_checkpoints WHERE checkpoint_id = %s",
            (checkpoint_id,),
        )
        conn.commit()
    except HTTPException:
        conn.rollback()
        raise
    except Exception:
        conn.rollback()
        raise
    finally:
        cur.close()
