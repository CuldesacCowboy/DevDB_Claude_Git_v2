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
                    "lots": [],
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

        # Fetch lots per TDA with checkpoint assignments, HC/BLDR dates, lot type, building group
        tda_ids = list(agreements_map.keys())
        if tda_ids:
            cur.execute(
                """
                SELECT
                    tal.tda_id,
                    l.lot_id,
                    l.lot_number,
                    l.lot_type_id,
                    rlt.lot_type_short,
                    l.building_group_id,
                    bg.building_name,
                    la.assignment_id,
                    la.checkpoint_id,
                    cp.checkpoint_number,
                    cp.checkpoint_date,
                    cp.lots_required_cumulative,
                    l.date_td_hold           AS hc_marks_date,
                    l.date_td_hold_projected AS hc_projected_date,
                    l.date_td_hold_is_locked AS hc_is_locked,
                    l.date_td                AS bldr_marks_date,
                    l.date_td_projected      AS bldr_projected_date,
                    l.date_td_is_locked      AS bldr_is_locked
                FROM devdb.sim_takedown_agreement_lots tal
                JOIN devdb.sim_lots l ON l.lot_id = tal.lot_id
                LEFT JOIN devdb.ref_lot_types rlt ON rlt.lot_type_id = l.lot_type_id
                LEFT JOIN devdb.sim_building_groups bg ON bg.building_group_id = l.building_group_id
                LEFT JOIN devdb.sim_takedown_lot_assignments la
                    ON la.lot_id = l.lot_id
                    AND la.checkpoint_id IN (
                        SELECT checkpoint_id FROM devdb.sim_takedown_checkpoints WHERE tda_id = tal.tda_id
                    )
                LEFT JOIN devdb.sim_takedown_checkpoints cp ON cp.checkpoint_id = la.checkpoint_id
                WHERE tal.tda_id = ANY(%s)
                ORDER BY tal.tda_id, l.lot_number
                """,
                (tda_ids,),
            )
            for r in cur.fetchall():
                tid = r["tda_id"]
                if tid in agreements_map:
                    agreements_map[tid]["lots"].append({
                        "lot_id": r["lot_id"],
                        "lot_number": r["lot_number"],
                        "lot_type_id": r["lot_type_id"],
                        "lot_type_short": r["lot_type_short"],
                        "building_group_id": r["building_group_id"],
                        "building_name": r["building_name"],
                        "assignment_id": r["assignment_id"],
                        "checkpoint_id": r["checkpoint_id"],
                        "checkpoint_number": r["checkpoint_number"],
                        "checkpoint_date": r["checkpoint_date"].isoformat() if r["checkpoint_date"] else None,
                        "lots_required_cumulative": r["lots_required_cumulative"],
                        "hc_marks_date": r["hc_marks_date"].isoformat() if r["hc_marks_date"] else None,
                        "hc_projected_date": r["hc_projected_date"].isoformat() if r["hc_projected_date"] else None,
                        "hc_is_locked": bool(r["hc_is_locked"]) if r["hc_is_locked"] is not None else False,
                        "bldr_marks_date": r["bldr_marks_date"].isoformat() if r["bldr_marks_date"] else None,
                        "bldr_projected_date": r["bldr_projected_date"].isoformat() if r["bldr_projected_date"] else None,
                        "bldr_is_locked": bool(r["bldr_is_locked"]) if r["bldr_is_locked"] is not None else False,
                    })

            # Checkpoint aggregate columns: taken_down_to_date, marks_plan, sim_plan
            # Count TDA lots (all pool lots) by date vs checkpoint_date
            checkpoint_ids_all = [
                cp["checkpoint_id"]
                for tda in agreements_map.values()
                for cp in tda["checkpoints"]
            ]
            if checkpoint_ids_all:
                cur.execute(
                    """
                    SELECT
                        cp.checkpoint_id,
                        COUNT(CASE WHEN l.date_td IS NOT NULL AND l.date_td <= CURRENT_DATE THEN 1 END)
                            AS taken_down_to_date,
                        COUNT(CASE WHEN l.date_td IS NOT NULL AND cp.checkpoint_date IS NOT NULL
                                        AND l.date_td <= cp.checkpoint_date THEN 1 END)
                            AS marks_plan,
                        COUNT(CASE WHEN cp.checkpoint_date IS NOT NULL
                                        AND COALESCE(l.date_td, l.date_td_projected) IS NOT NULL
                                        AND COALESCE(l.date_td, l.date_td_projected) <= cp.checkpoint_date THEN 1 END)
                            AS sim_plan
                    FROM devdb.sim_takedown_checkpoints cp
                    JOIN devdb.sim_takedown_agreement_lots tal ON tal.tda_id = cp.tda_id
                    JOIN devdb.sim_lots l ON l.lot_id = tal.lot_id
                    WHERE cp.checkpoint_id = ANY(%s)
                    GROUP BY cp.checkpoint_id
                    """,
                    (checkpoint_ids_all,),
                )
                agg_map = {r["checkpoint_id"]: r for r in cur.fetchall()}
                for tda in agreements_map.values():
                    for cp in tda["checkpoints"]:
                        agg = agg_map.get(cp["checkpoint_id"])
                        cp["taken_down_to_date"] = int(agg["taken_down_to_date"]) if agg else 0
                        cp["marks_plan"] = int(agg["marks_plan"]) if agg else 0
                        cp["sim_plan"] = int(agg["sim_plan"]) if agg else 0

        # Fetch lots not yet in any TDA for this community
        cur.execute(
            """
            SELECT DISTINCT l.lot_id, l.lot_number
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
            ORDER BY l.lot_number
            """,
            (ent_group_id, ent_group_id),
        )
        unassigned_lots = [{"lot_id": r["lot_id"], "lot_number": r["lot_number"]} for r in cur.fetchall()]

        # Clean up helper key
        agreements = []
        for tda in agreements_map.values():
            tda.pop("_running_assigned")
            agreements.append(tda)

        return {
            "ent_group_id": eg["ent_group_id"],
            "ent_group_name": eg["ent_group_name"],
            "agreements": agreements,
            "unassigned_lots": unassigned_lots,
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


@router.get("/entitlement-groups/{ent_group_id}/tda-monthly-ledger")
def get_tda_monthly_ledger(ent_group_id: int, conn=Depends(get_db_conn)):
    """Monthly ledger of takedown activity for all TDA lots in a community.
    Per month returns:
      - actual: lots taken down in that month (date_td <= today, in that month)
      - marks_plan: lots scheduled by MARKS in that month (date_td)
      - sim_plan: lots projected by simulation in that month (date_td_projected, only where date_td is null)
    """
    cur = dict_cursor(conn)
    try:
        cur.execute(
            "SELECT ent_group_id FROM devdb.sim_entitlement_groups WHERE ent_group_id = %s",
            (ent_group_id,),
        )
        if cur.fetchone() is None:
            raise HTTPException(status_code=404, detail=f"Entitlement group {ent_group_id} not found.")

        cur.execute(
            """
            SELECT
                TO_CHAR(DATE_TRUNC('month', l.date_td), 'YYYY-MM') AS month,
                COUNT(CASE WHEN l.date_td <= CURRENT_DATE THEN 1 END) AS actual,
                COUNT(1) AS marks_plan
            FROM devdb.sim_takedown_agreement_lots tal
            JOIN devdb.sim_takedown_agreements tda ON tda.tda_id = tal.tda_id
            JOIN devdb.sim_lots l ON l.lot_id = tal.lot_id
            WHERE tda.ent_group_id = %s
              AND l.date_td IS NOT NULL
            GROUP BY DATE_TRUNC('month', l.date_td)
            ORDER BY DATE_TRUNC('month', l.date_td)
            """,
            (ent_group_id,),
        )
        marks_rows = {r["month"]: {"actual": int(r["actual"]), "marks_plan": int(r["marks_plan"])} for r in cur.fetchall()}

        cur.execute(
            """
            SELECT
                TO_CHAR(DATE_TRUNC('month', l.date_td_projected), 'YYYY-MM') AS month,
                COUNT(1) AS sim_plan
            FROM devdb.sim_takedown_agreement_lots tal
            JOIN devdb.sim_takedown_agreements tda ON tda.tda_id = tal.tda_id
            JOIN devdb.sim_lots l ON l.lot_id = tal.lot_id
            WHERE tda.ent_group_id = %s
              AND l.date_td IS NULL
              AND l.date_td_projected IS NOT NULL
            GROUP BY DATE_TRUNC('month', l.date_td_projected)
            ORDER BY DATE_TRUNC('month', l.date_td_projected)
            """,
            (ent_group_id,),
        )
        sim_rows = {r["month"]: int(r["sim_plan"]) for r in cur.fetchall()}

        # Merge all months
        all_months = sorted(set(list(marks_rows.keys()) + list(sim_rows.keys())))
        ledger = []
        for m in all_months:
            mr = marks_rows.get(m, {"actual": 0, "marks_plan": 0})
            ledger.append({
                "month": m,
                "actual": mr["actual"],
                "marks_plan": mr["marks_plan"],
                "sim_plan": sim_rows.get(m, 0),
            })

        return {"ent_group_id": ent_group_id, "ledger": ledger}
    finally:
        cur.close()


@router.get("/tda-checklist")
def get_tda_checklist(show_test: bool = False, conn=Depends(get_db_conn)):
    """Master checklist: all TDA lot assignments across all (non-)test communities.
    Returns flat list sorted by checkpoint_date, community name, lot_number."""
    cur = dict_cursor(conn)
    try:
        cur.execute(
            """
            SELECT
                eg.ent_group_id,
                eg.ent_group_name,
                tda.tda_id,
                tda.tda_name,
                cp.checkpoint_id,
                cp.checkpoint_date,
                cp.lots_required_cumulative,
                l.lot_id,
                l.lot_number,
                rlt.lot_type_short,
                l.building_group_id,
                bg.building_name,
                l.date_td,
                l.date_td_projected,
                l.date_td_hold,
                l.date_td_hold_projected
            FROM devdb.sim_takedown_lot_assignments la
            JOIN devdb.sim_takedown_checkpoints cp ON cp.checkpoint_id = la.checkpoint_id
            JOIN devdb.sim_takedown_agreements tda ON tda.tda_id = cp.tda_id
            JOIN devdb.sim_entitlement_groups eg ON eg.ent_group_id = tda.ent_group_id
            JOIN devdb.sim_lots l ON l.lot_id = la.lot_id
            LEFT JOIN devdb.ref_lot_types rlt ON rlt.lot_type_id = l.lot_type_id
            LEFT JOIN devdb.sim_building_groups bg ON bg.building_group_id = l.building_group_id
            WHERE COALESCE(eg.is_test, FALSE) = %s
            ORDER BY cp.checkpoint_date NULLS LAST, eg.ent_group_name, l.lot_number
            """,
            (show_test,),
        )
        rows = cur.fetchall()

        items = []
        for r in rows:
            if r["date_td"] is not None:
                status = "closed"
                display_date = r["date_td"].isoformat()
            elif r["date_td_projected"] is not None:
                status = "projected"
                display_date = r["date_td_projected"].isoformat()
            else:
                status = "pending"
                display_date = None

            items.append({
                "ent_group_id":            r["ent_group_id"],
                "ent_group_name":          r["ent_group_name"],
                "tda_id":                  r["tda_id"],
                "tda_name":                r["tda_name"],
                "checkpoint_id":           r["checkpoint_id"],
                "checkpoint_date":         r["checkpoint_date"].isoformat() if r["checkpoint_date"] else None,
                "lots_required_cumulative": r["lots_required_cumulative"],
                "lot_id":                  r["lot_id"],
                "lot_number":              r["lot_number"],
                "lot_type_short":          r["lot_type_short"],
                "building_group_id":       r["building_group_id"],
                "building_name":           r["building_name"],
                "date_td":                 r["date_td"].isoformat() if r["date_td"] else None,
                "date_td_projected":       r["date_td_projected"].isoformat() if r["date_td_projected"] else None,
                "date_td_hold":            r["date_td_hold"].isoformat() if r["date_td_hold"] else None,
                "date_td_hold_projected":  r["date_td_hold_projected"].isoformat() if r["date_td_hold_projected"] else None,
                "status":                  status,
                "display_date":            display_date,
            })

        return {"items": items}
    finally:
        cur.close()


@router.post("/takedown-agreements/{tda_id}/auto-assign")
def auto_assign_checkpoints(tda_id: int, conn=Depends(get_db_conn)):
    """Assign each TDA lot to the earliest checkpoint whose date >= the lot's
    COALESCE(date_td, date_td_projected). Lots with no applicable date or no
    matching checkpoint remain unassigned. Existing assignments are cleared first."""
    cur = dict_cursor(conn)
    try:
        cur.execute(
            "SELECT tda_id FROM devdb.sim_takedown_agreements WHERE tda_id = %s",
            (tda_id,),
        )
        if cur.fetchone() is None:
            raise HTTPException(status_code=404, detail=f"TDA {tda_id} not found.")

        # Load checkpoints ordered by date ascending
        cur.execute(
            """
            SELECT checkpoint_id, checkpoint_date
            FROM devdb.sim_takedown_checkpoints
            WHERE tda_id = %s AND checkpoint_date IS NOT NULL
            ORDER BY checkpoint_date ASC
            """,
            (tda_id,),
        )
        checkpoints = list(cur.fetchall())

        if not checkpoints:
            return {"assigned": 0, "unassigned": 0, "message": "No dated checkpoints to assign to."}

        # Load all lots in TDA pool with their effective takedown date
        cur.execute(
            """
            SELECT l.lot_id,
                   COALESCE(l.date_td, l.date_td_projected) AS effective_td
            FROM devdb.sim_takedown_agreement_lots tal
            JOIN devdb.sim_lots l ON l.lot_id = tal.lot_id
            WHERE tal.tda_id = %s
            ORDER BY l.lot_id
            """,
            (tda_id,),
        )
        lots = list(cur.fetchall())

        # Clear all existing assignments for this TDA
        cur.execute(
            """
            DELETE FROM devdb.sim_takedown_lot_assignments
            WHERE checkpoint_id IN (
                SELECT checkpoint_id FROM devdb.sim_takedown_checkpoints WHERE tda_id = %s
            )
            """,
            (tda_id,),
        )

        assigned = 0
        unassigned = 0
        for lot in lots:
            td = lot["effective_td"]
            if td is None:
                unassigned += 1
                continue
            # Find first checkpoint whose date >= lot's effective_td
            target_cp = None
            for cp in checkpoints:
                if cp["checkpoint_date"] is not None and cp["checkpoint_date"] >= td:
                    target_cp = cp
                    break
            if target_cp is None:
                # No checkpoint covers this lot's date; assign to last checkpoint
                target_cp = checkpoints[-1]

            cur.execute(
                """
                INSERT INTO devdb.sim_takedown_lot_assignments
                    (checkpoint_id, lot_id, assigned_at)
                VALUES (%s, %s, now())
                ON CONFLICT DO NOTHING
                """,
                (target_cp["checkpoint_id"], lot["lot_id"]),
            )
            assigned += 1

        conn.commit()
        return {"tda_id": tda_id, "assigned": assigned, "unassigned": unassigned}

    except HTTPException:
        conn.rollback()
        raise
    except Exception:
        conn.rollback()
        raise
    finally:
        cur.close()
