# routers/simulations.py
# Simulation run endpoint — triggers the convergence coordinator for an entitlement group.

import time
import traceback

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from api.deps import get_db_conn
from api.db import dict_cursor
from engine.coordinator import convergence_coordinator

router = APIRouter(prefix="/simulations", tags=["simulations"])


class SimulationRunRequest(BaseModel):
    ent_group_id: int


class SimulationRunResponse(BaseModel):
    status: str
    iterations: int
    elapsed_ms: int
    errors: list[str]


@router.post("/run", response_model=SimulationRunResponse)
def run_simulation(req: SimulationRunRequest, conn=Depends(get_db_conn)):
    """
    Trigger a full convergence run for the given entitlement group.
    Runs synchronously — typically completes in under 1 second.
    """
    t0 = time.monotonic()
    try:
        iterations, missing_params_devs = convergence_coordinator(req.ent_group_id)
        elapsed_ms = int((time.monotonic() - t0) * 1000)

        errors: list[str] = []
        if missing_params_devs:
            cur = dict_cursor(conn)
            try:
                ids = list(missing_params_devs)
                cur.execute(
                    """
                    SELECT dd.development_id, d.dev_name
                    FROM dim_development dd
                    JOIN developments d ON d.marks_code = dd.dev_code2
                    WHERE dd.development_id = ANY(%s)
                    ORDER BY d.dev_name
                    """,
                    (ids,),
                )
                for r in cur.fetchall():
                    errors.append(
                        f"{r['dev_name']}: no starts target — add annual_starts_target in sim_dev_params to generate projected lots"
                    )
            finally:
                cur.close()

        return SimulationRunResponse(
            status="ok",
            iterations=iterations,
            elapsed_ms=elapsed_ms,
            errors=errors,
        )
    except Exception as exc:
        elapsed_ms = int((time.monotonic() - t0) * 1000)
        detail = traceback.format_exc()
        raise HTTPException(status_code=500, detail=detail) from exc
