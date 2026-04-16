# routers/tda_crud.py
# TDA CRUD: list, create, rename, detail view.

from typing import Optional
from datetime import date as date_type

import psycopg2.extras
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from api.deps import get_db_conn
from api.db import dict_cursor


class CreateTdaRequest(BaseModel):
    tda_name: str
    ent_group_id: int
    anchor_date: Optional[date_type] = None


class PatchTdaRequest(BaseModel):
    tda_name: Optional[str] = None
    status: Optional[str] = None
    anchor_date: Optional[date_type] = None


router = APIRouter(tags=["takedown-agreements"])


@router.get("/entitlement-groups/{ent_group_id}/tda-unassigned-lots")
def get_tda_unassigned_lots(ent_group_id: int, conn=Depends(get_db_conn)):
    """Real lots for this community not yet in any TDA."""
    cur = dict_cursor(conn)
    try:
        cur.execute(
            """
            SELECT DISTINCT l.lot_id, l.lot_number, l.building_group_id
            FROM devdb.sim_lots l
            JOIN devdb.sim_dev_phases p ON p.phase_id = l.phase_id
            JOIN devdb.developments d ON d.dev_id = p.dev_id
            WHERE d.community_id = %s
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
        return [
            {"lot_id": r["lot_id"], "lot_number": r["lot_number"], "building_group_id": r["building_group_id"]}
            for r in cur.fetchall()
        ]
    finally:
        cur.close()


@router.get("/entitlement-groups/{ent_group_id}/tda-overview")
def get_tda_overview(ent_group_id: int, conn=Depends(get_db_conn)):
    """All agreements for a community with per-checkpoint assigned counts.
    Returns enough data for the new standalone TakedownView without fetching full lot details."""
    cur = dict_cursor(conn)
    try:
        cur.execute(
            "SELECT ent_group_id, ent_group_name FROM devdb.sim_entitlement_groups WHERE ent_group_id = %s",
            (ent_group_id,),
        )
        eg = cur.fetchone()
        if eg is None:
            raise HTTPException(status_code=404, detail=f"Entitlement group {ent_group_id} not found.")

        cur.execute(
            """
            SELECT
                tda.tda_id,
                tda.tda_name,
                tda.status,
                tda.anchor_date,
                cp.checkpoint_id,
                cp.checkpoint_number,
                cp.checkpoint_date,
                cp.lots_required_cumulative,
                COUNT(a.assignment_id) AS lots_assigned
            FROM devdb.sim_takedown_agreements tda
            LEFT JOIN devdb.sim_takedown_checkpoints cp ON cp.tda_id = tda.tda_id
            LEFT JOIN devdb.sim_takedown_lot_assignments a ON a.checkpoint_id = cp.checkpoint_id
            WHERE tda.ent_group_id = %s
            GROUP BY tda.tda_id, tda.tda_name, tda.status, tda.anchor_date,
                     cp.checkpoint_id, cp.checkpoint_number, cp.checkpoint_date,
                     cp.lots_required_cumulative
            ORDER BY tda.tda_id ASC, cp.checkpoint_number ASC
            """,
            (ent_group_id,),
        )
        rows = cur.fetchall()

        # Group by tda_id; compute cumulative_assigned as running sum per agreement
        agreements_map: dict = {}
        for r in rows:
            tid = r["tda_id"]
            if tid not in agreements_map:
                agreements_map[tid] = {
                    "tda_id": tid,
                    "tda_name": r["tda_name"],
                    "status": r["status"],
                    "anchor_date": r["anchor_date"].isoformat() if r["anchor_date"] else None,
                    "checkpoints": [],
                    "_running_assigned": 0,
                }
            if r["checkpoint_id"] is not None:
                per_cp = int(r["lots_assigned"] or 0)
                agreements_map[tid]["_running_assigned"] += per_cp
                cumulative = agreements_map[tid]["_running_assigned"]
                agreements_map[tid]["checkpoints"].append({
                    "checkpoint_id": r["checkpoint_id"],
                    "checkpoint_number": r["checkpoint_number"],
                    "checkpoint_date": r["checkpoint_date"].isoformat() if r["checkpoint_date"] else None,
                    "lots_required_cumulative": r["lots_required_cumulative"],
                    "lots_assigned": per_cp,
                    "lots_assigned_cumulative": cumulative,
                })

        # Clean up helper key
        agreements = []
        for tda in agreements_map.values():
            tda.pop("_running_assigned")
            agreements.append(tda)

        return {
            "ent_group_id": eg["ent_group_id"],
            "ent_group_name": eg["ent_group_name"],
            "agreements": agreements,
        }
    finally:
        cur.close()


@router.get("/entitlement-groups/{ent_group_id}/takedown-agreements")
def list_takedown_agreements(ent_group_id: int, conn=Depends(get_db_conn)):
    cur = dict_cursor(conn)
    try:
        cur.execute(
            "SELECT ent_group_id, ent_group_name FROM devdb.sim_entitlement_groups WHERE ent_group_id = %s",
            (ent_group_id,),
        )
        eg = cur.fetchone()
        if eg is None:
            raise HTTPException(status_code=404, detail=f"Entitlement group {ent_group_id} not found.")

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
    cur = dict_cursor(conn)
    try:
        if not body.tda_name or not body.tda_name.strip():
            raise HTTPException(status_code=422, detail="tda_name must not be empty.")

        cur.execute(
            "SELECT ent_group_id FROM devdb.sim_entitlement_groups WHERE ent_group_id = %s",
            (body.ent_group_id,),
        )
        if cur.fetchone() is None:
            raise HTTPException(status_code=404, detail=f"Entitlement group {body.ent_group_id} not found.")

        cur.execute(
            """
            INSERT INTO devdb.sim_takedown_agreements
                (tda_name, ent_group_id, anchor_date, status, checkpoint_lead_days, created_at, updated_at)
            VALUES (%s, %s, %s, 'active', 16, now(), now())
            RETURNING tda_id, tda_name, status, anchor_date
            """,
            (body.tda_name.strip(), body.ent_group_id, body.anchor_date),
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


@router.patch("/takedown-agreements/{tda_id}")
def patch_takedown_agreement(tda_id: int, body: PatchTdaRequest, conn=Depends(get_db_conn)):
    cur = dict_cursor(conn)
    try:
        updates = []
        values = []
        if body.tda_name is not None:
            name = body.tda_name.strip()
            if not name:
                raise HTTPException(status_code=422, detail="Agreement name cannot be empty.")
            updates.append("tda_name = %s")
            values.append(name)
        if body.status is not None:
            allowed = {"active", "closed", "expired"}
            if body.status not in allowed:
                raise HTTPException(status_code=422, detail=f"status must be one of {sorted(allowed)}.")
            updates.append("status = %s")
            values.append(body.status)
        if body.anchor_date is not None or "anchor_date" in body.model_fields_set:
            updates.append("anchor_date = %s")
            values.append(body.anchor_date)
        if not updates:
            raise HTTPException(status_code=422, detail="No fields provided to update.")
        updates.append("updated_at = now()")
        values.append(tda_id)
        cur.execute(
            f"UPDATE devdb.sim_takedown_agreements SET {', '.join(updates)} WHERE tda_id = %s"
            " RETURNING tda_id, tda_name, status, anchor_date",
            values,
        )
        row = cur.fetchone()
        if row is None:
            raise HTTPException(status_code=404, detail=f"TDA {tda_id} not found.")
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
    cur = dict_cursor(conn)
    try:
        cur.execute(
            "SELECT tda_id, tda_name, status, anchor_date FROM devdb.sim_takedown_agreements WHERE tda_id = %s",
            (tda_id,),
        )
        tda = cur.fetchone()
        if tda is None:
            raise HTTPException(status_code=404, detail=f"Takedown agreement {tda_id} not found.")

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

        assignments_by_checkpoint: dict[int, list] = {r["checkpoint_id"]: [] for r in checkpoint_rows}
        if checkpoint_ids:
            cur.execute(
                """
                SELECT
                    a.assignment_id,
                    a.checkpoint_id,
                    a.lot_id,
                    l.lot_number,
                    l.building_group_id,
                    l.date_td_hold          AS hc_marks_date,
                    l.date_td_hold_projected AS hc_projected_date,
                    l.date_td_hold_is_locked AS hc_is_locked,
                    l.date_td               AS bldr_marks_date,
                    l.date_td_projected     AS bldr_projected_date,
                    l.date_td_is_locked     AS bldr_is_locked,
                    l.date_str              AS dig_marks_date,
                    l.date_str_projected    AS dig_projected_date,
                    l.date_str_is_locked    AS dig_is_locked
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
                        "dig_marks_date": row["dig_marks_date"].isoformat() if row["dig_marks_date"] else None,
                        "dig_projected_date": row["dig_projected_date"].isoformat() if row["dig_projected_date"] else None,
                        "dig_is_locked": bool(row["dig_is_locked"]),
                    }
                )

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
                JOIN devdb.developments d ON d.dev_id = p.dev_id
                WHERE d.community_id = %s
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
