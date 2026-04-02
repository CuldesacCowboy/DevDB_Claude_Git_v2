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
