# routers/simulations.py
# Simulation run endpoint — triggers the convergence coordinator for an entitlement group.

import time
import traceback
from concurrent.futures import ThreadPoolExecutor, TimeoutError as FuturesTimeoutError

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from api.deps import get_db_conn
from api.db import dict_cursor
from engine.coordinator import convergence_coordinator

router = APIRouter(prefix="/simulations", tags=["simulations"])

_SIMULATION_TIMEOUT_S = 120  # seconds before returning 504

_executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix="sim_run")


class SimulationRunRequest(BaseModel):
    ent_group_id: int


class ResidualGap(BaseModel):
    tda_id: int
    tda_name: str
    checkpoint_id: int
    checkpoint_number: int
    checkpoint_date: str
    required: int
    projected: int
    gap: int


class SimulationRunResponse(BaseModel):
    status: str
    iterations: int
    elapsed_ms: int
    errors: list[str]
    tda_gaps: list[ResidualGap]


@router.post("/run", response_model=SimulationRunResponse)
def run_simulation(req: SimulationRunRequest, conn=Depends(get_db_conn)):
    """
    Trigger a full convergence run for the given entitlement group.
    Runs synchronously — typically completes in under 1 second.
    Times out after 120 seconds and returns HTTP 504.
    """
    t0 = time.monotonic()
    try:
        future = _executor.submit(convergence_coordinator, req.ent_group_id)
        try:
            iterations, missing_params_devs, residual_gaps = future.result(
                timeout=_SIMULATION_TIMEOUT_S
            )
        except FuturesTimeoutError:
            elapsed_ms = int((time.monotonic() - t0) * 1000)
            raise HTTPException(
                status_code=504,
                detail=f"Simulation timed out after {_SIMULATION_TIMEOUT_S}s "
                       f"(ent_group_id={req.ent_group_id})",
            )
        elapsed_ms = int((time.monotonic() - t0) * 1000)

        errors: list[str] = []
        cur = dict_cursor(conn)
        try:
            if missing_params_devs:
                ids = list(missing_params_devs)
                cur.execute(
                    "SELECT dev_id, dev_name FROM developments WHERE dev_id = ANY(%s) ORDER BY dev_name",
                    (ids,),
                )
                for r in cur.fetchall():
                    errors.append(
                        f"{r['dev_name']}: no starts target — add annual_starts_target in sim_dev_params to generate projected lots"
                    )

            # Enrich residual gaps with tda_name
            enriched_gaps: list[ResidualGap] = []
            if residual_gaps:
                tda_ids = list({g["tda_id"] for g in residual_gaps})
                cur.execute(
                    "SELECT tda_id, tda_name FROM devdb.sim_takedown_agreements WHERE tda_id = ANY(%s)",
                    (tda_ids,),
                )
                name_map = {r["tda_id"]: r["tda_name"] for r in cur.fetchall()}
                for g in residual_gaps:
                    enriched_gaps.append(ResidualGap(
                        tda_name=name_map.get(g["tda_id"], f"TDA {g['tda_id']}"),
                        **g,
                    ))
        finally:
            cur.close()

        return SimulationRunResponse(
            status="ok",
            iterations=iterations,
            elapsed_ms=elapsed_ms,
            errors=errors,
            tda_gaps=enriched_gaps,
        )
    except Exception as exc:
        elapsed_ms = int((time.monotonic() - t0) * 1000)
        print(traceback.format_exc())  # full trace to server terminal for debugging
        raise HTTPException(status_code=500, detail=str(exc)) from exc
