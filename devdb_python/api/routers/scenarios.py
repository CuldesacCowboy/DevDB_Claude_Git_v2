# routers/scenarios.py
# Scenario CRUD, run, and compare endpoints.

import json
import time
import traceback
from concurrent.futures import TimeoutError as FuturesTimeoutError
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel

from api.deps import get_db_conn
from api.db import dict_cursor

router = APIRouter(prefix="/scenarios", tags=["scenarios"])


# ─── Models ──────────────────────────────────────────────────────────────────

class ScenarioOverride(BaseModel):
    scope: str       # 'dev', 'instrument', 'ent_group'
    scope_id: int
    param_name: str
    param_value: object  # int, float, or list[int]


class ScenarioCreate(BaseModel):
    ent_group_id: int
    scenario_name: str
    description: Optional[str] = None
    overrides: list[ScenarioOverride] = []


class ScenarioPatch(BaseModel):
    scenario_name: Optional[str] = None
    description: Optional[str] = None
    overrides: Optional[list[ScenarioOverride]] = None


# ─── List ────────────────────────────────────────────────────────────────────

@router.get("/community/{ent_group_id}")
def list_scenarios(ent_group_id: int, conn=Depends(get_db_conn)):
    cur = dict_cursor(conn)
    try:
        cur.execute("""
            SELECT s.scenario_id, s.scenario_name, s.description,
                   s.created_at, s.updated_at, s.last_run_at,
                   COUNT(o.override_id) AS override_count,
                   (SELECT COUNT(*) FROM sim_scenario_results r WHERE r.scenario_id = s.scenario_id) > 0 AS has_results
            FROM sim_scenarios s
            LEFT JOIN sim_scenario_overrides o ON o.scenario_id = s.scenario_id
            WHERE s.ent_group_id = %s
            GROUP BY s.scenario_id
            ORDER BY s.created_at DESC
        """, (ent_group_id,))
        return [
            {
                "scenario_id": r["scenario_id"],
                "scenario_name": r["scenario_name"],
                "description": r["description"],
                "created_at": r["created_at"].isoformat() if r["created_at"] else None,
                "updated_at": r["updated_at"].isoformat() if r["updated_at"] else None,
                "last_run_at": r["last_run_at"].isoformat() if r["last_run_at"] else None,
                "override_count": r["override_count"],
                "has_results": bool(r["has_results"]),
            }
            for r in cur.fetchall()
        ]
    finally:
        cur.close()


# ─── Get ─────────────────────────────────────────────────────────────────────

@router.get("/{scenario_id}")
def get_scenario(scenario_id: int, conn=Depends(get_db_conn)):
    cur = dict_cursor(conn)
    try:
        cur.execute(
            "SELECT * FROM sim_scenarios WHERE scenario_id = %s", (scenario_id,)
        )
        row = cur.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Scenario not found")

        cur.execute(
            "SELECT * FROM sim_scenario_overrides WHERE scenario_id = %s ORDER BY scope, scope_id, param_name",
            (scenario_id,),
        )
        overrides = [
            {
                "override_id": o["override_id"],
                "scope": o["scope"],
                "scope_id": o["scope_id"],
                "param_name": o["param_name"],
                "param_value": o["param_value"],
            }
            for o in cur.fetchall()
        ]

        return {
            "scenario_id": row["scenario_id"],
            "ent_group_id": row["ent_group_id"],
            "scenario_name": row["scenario_name"],
            "description": row["description"],
            "created_at": row["created_at"].isoformat() if row["created_at"] else None,
            "last_run_at": row["last_run_at"].isoformat() if row["last_run_at"] else None,
            "overrides": overrides,
        }
    finally:
        cur.close()


# ─── Create ──────────────────────────────────────────────────────────────────

@router.post("", status_code=201)
def create_scenario(body: ScenarioCreate, conn=Depends(get_db_conn)):
    cur = dict_cursor(conn)
    try:
        cur.execute(
            """
            INSERT INTO sim_scenarios (ent_group_id, scenario_name, description)
            VALUES (%s, %s, %s)
            RETURNING scenario_id
            """,
            (body.ent_group_id, body.scenario_name.strip(), body.description),
        )
        scenario_id = cur.fetchone()["scenario_id"]

        for o in body.overrides:
            cur.execute(
                """
                INSERT INTO sim_scenario_overrides (scenario_id, scope, scope_id, param_name, param_value)
                VALUES (%s, %s, %s, %s, %s)
                """,
                (scenario_id, o.scope, o.scope_id, o.param_name, json.dumps(o.param_value)),
            )

        conn.commit()
        return {"scenario_id": scenario_id}
    except Exception:
        conn.rollback()
        raise
    finally:
        cur.close()


# ─── Patch ───────────────────────────────────────────────────────────────────

@router.patch("/{scenario_id}")
def patch_scenario(scenario_id: int, body: ScenarioPatch, conn=Depends(get_db_conn)):
    cur = dict_cursor(conn)
    try:
        if body.scenario_name is not None or body.description is not None:
            clauses, params = [], []
            if body.scenario_name is not None:
                clauses.append("scenario_name = %s")
                params.append(body.scenario_name.strip())
            if body.description is not None:
                clauses.append("description = %s")
                params.append(body.description)
            clauses.append("updated_at = NOW()")
            params.append(scenario_id)
            cur.execute(
                f"UPDATE sim_scenarios SET {', '.join(clauses)} WHERE scenario_id = %s",
                params,
            )

        if body.overrides is not None:
            cur.execute(
                "DELETE FROM sim_scenario_overrides WHERE scenario_id = %s",
                (scenario_id,),
            )
            for o in body.overrides:
                cur.execute(
                    """
                    INSERT INTO sim_scenario_overrides (scenario_id, scope, scope_id, param_name, param_value)
                    VALUES (%s, %s, %s, %s, %s)
                    """,
                    (scenario_id, o.scope, o.scope_id, o.param_name, json.dumps(o.param_value)),
                )

        conn.commit()
        return {"scenario_id": scenario_id}
    except Exception:
        conn.rollback()
        raise
    finally:
        cur.close()


# ─── Delete ──────────────────────────────────────────────────────────────────

@router.delete("/{scenario_id}", status_code=204)
def delete_scenario(scenario_id: int, conn=Depends(get_db_conn)):
    cur = dict_cursor(conn)
    try:
        cur.execute("DELETE FROM sim_scenarios WHERE scenario_id = %s RETURNING scenario_id", (scenario_id,))
        if not cur.fetchone():
            raise HTTPException(status_code=404, detail="Scenario not found")
        conn.commit()
    except HTTPException:
        conn.rollback()
        raise
    except Exception:
        conn.rollback()
        raise
    finally:
        cur.close()


# ─── Run ─────────────────────────────────────────────────────────────────

# Share the executor with simulations.py to prevent concurrent sim_lots access
from api.routers.simulations import _executor, _SIMULATION_TIMEOUT_S


@router.post("/{scenario_id}/run")
def run_scenario_endpoint(scenario_id: int, conn=Depends(get_db_conn)):
    """Run a scenario: backup → apply overrides → engine → capture → restore."""
    import time
    from services.scenario_runner import run_scenario

    t0 = time.monotonic()
    try:
        future = _executor.submit(run_scenario, scenario_id)
        try:
            result = future.result(timeout=_SIMULATION_TIMEOUT_S)
        except FuturesTimeoutError:
            raise HTTPException(status_code=504, detail=f"Scenario run timed out after {_SIMULATION_TIMEOUT_S}s")
        elapsed_ms = int((time.monotonic() - t0) * 1000)
        return {
            "status": "ok",
            "scenario_id": scenario_id,
            "iterations": result.get("iterations", 0),
            "elapsed_ms": elapsed_ms,
        }
    except HTTPException:
        raise
    except Exception as exc:
        import traceback
        print(traceback.format_exc())
        raise HTTPException(status_code=500, detail=str(exc)) from exc


# ─── Compare ─────────────────────────────────────────────────────────────────

@router.get("/compare/{ent_group_id}")
def compare_scenarios(
    ent_group_id: int,
    scenario_ids: str = Query(..., description="Comma-separated scenario IDs"),
    conn=Depends(get_db_conn),
):
    """Return base ledger + scenario results for comparison."""
    from services.ledger_service import query_ledger_by_dev

    cur = dict_cursor(conn)
    try:
        # Base ledger
        base_rows = query_ledger_by_dev(conn, ent_group_id)

        # Scenario results
        ids = [int(x.strip()) for x in scenario_ids.split(",") if x.strip()]
        scenarios = {}
        for sid in ids:
            cur.execute(
                "SELECT scenario_name FROM sim_scenarios WHERE scenario_id = %s",
                (sid,),
            )
            s_row = cur.fetchone()
            if not s_row:
                continue

            cur.execute("""
                SELECT dev_id, calendar_month,
                       ent_plan, dev_plan, td_plan, str_plan, str_plan_spec, str_plan_build,
                       cmp_plan, cls_plan,
                       p_end, e_end, d_end, h_end, u_end, uc_end, c_end, closed_cumulative
                FROM sim_scenario_results
                WHERE scenario_id = %s
                ORDER BY dev_id, calendar_month
            """, (sid,))

            s_rows = []
            for r in cur.fetchall():
                s_rows.append({
                    "dev_id": r["dev_id"],
                    "calendar_month": r["calendar_month"].isoformat() if r["calendar_month"] else None,
                    "ent_plan": r["ent_plan"], "dev_plan": r["dev_plan"],
                    "td_plan": r["td_plan"], "str_plan": r["str_plan"],
                    "str_plan_spec": r["str_plan_spec"], "str_plan_build": r["str_plan_build"],
                    "cmp_plan": r["cmp_plan"], "cls_plan": r["cls_plan"],
                    "p_end": r["p_end"], "e_end": r["e_end"], "d_end": r["d_end"],
                    "h_end": r["h_end"], "u_end": r["u_end"], "uc_end": r["uc_end"],
                    "c_end": r["c_end"], "closed_cumulative": r["closed_cumulative"],
                })

            scenarios[str(sid)] = {
                "scenario_name": s_row["scenario_name"],
                "rows": s_rows,
            }

        return {"base": base_rows, "scenarios": scenarios}
    finally:
        cur.close()
