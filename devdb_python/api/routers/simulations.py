# routers/simulations.py
# Simulation run endpoint — triggers the convergence coordinator for an entitlement group.

import time
import traceback

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

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
def run_simulation(req: SimulationRunRequest):
    """
    Trigger a full convergence run for the given entitlement group.
    Runs synchronously — typically completes in under 1 second.
    """
    t0 = time.monotonic()
    try:
        iterations = convergence_coordinator(req.ent_group_id)
        elapsed_ms = int((time.monotonic() - t0) * 1000)
        return SimulationRunResponse(
            status="ok",
            iterations=iterations,
            elapsed_ms=elapsed_ms,
            errors=[],
        )
    except Exception as exc:
        elapsed_ms = int((time.monotonic() - t0) * 1000)
        detail = traceback.format_exc()
        raise HTTPException(status_code=500, detail=detail) from exc
