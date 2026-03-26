# routers/developments.py
# Development-level read endpoints.

from fastapi import APIRouter, Depends, HTTPException

from api.deps import get_db_conn
from api.models.lot_models import DevLotPhaseViewResponse

router = APIRouter(prefix="/developments", tags=["developments"])

_STATUS_SQL = """
    CASE
        WHEN date_cls IS NOT NULL                            THEN 'OUT'
        WHEN date_cmp IS NOT NULL                           THEN 'C'
        WHEN date_str IS NOT NULL                           THEN 'UC'
        WHEN date_td_hold IS NOT NULL AND date_td IS NULL   THEN 'H'
        WHEN date_td IS NOT NULL                            THEN 'U'
        WHEN date_dev IS NOT NULL                           THEN 'D'
        WHEN date_ent IS NOT NULL                           THEN 'E'
        ELSE 'P'
    END
"""


@router.get("/{dev_id}/lot-phase-view", response_model=DevLotPhaseViewResponse)
def lot_phase_view(dev_id: int, conn=Depends(get_db_conn)):
    import psycopg2.extras

    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
    try:
        # Verify dev exists (at least one phase)
        cur.execute(
            "SELECT COUNT(*) AS n FROM sim_dev_phases WHERE dev_id = %s", (dev_id,)
        )
        if cur.fetchone()["n"] == 0:
            raise HTTPException(status_code=404, detail=f"dev_id {dev_id} not found.")

        # Load phases ordered by sequence_number, phase_id
        cur.execute(
            """
            SELECT phase_id, phase_name, sequence_number
            FROM sim_dev_phases
            WHERE dev_id = %s
            ORDER BY sequence_number ASC, phase_id ASC
            """,
            (dev_id,),
        )
        phases_raw = list(cur.fetchall())
        phase_ids = [p["phase_id"] for p in phases_raw]

        if not phase_ids:
            return DevLotPhaseViewResponse(
                dev_id=dev_id, dev_name=f"dev {dev_id}", phases=[]
            )

        # Load lots (real only) with derived status
        cur.execute(
            f"""
            SELECT
                lot_id,
                lot_number,
                lot_type_id,
                lot_source,
                phase_id,
                {_STATUS_SQL} AS status,
                (
                    (date_str IS NOT NULL OR date_cmp IS NOT NULL)
                    AND date_cls IS NULL
                ) AS has_actual_dates
            FROM sim_lots
            WHERE phase_id = ANY(%s) AND lot_source = 'real'
            ORDER BY lot_number ASC NULLS LAST
            """,
            (phase_ids,),
        )
        lots_raw = list(cur.fetchall())

        # Load splits (counts per phase × lot_type)
        cur.execute(
            """
            SELECT phase_id, lot_type_id, lot_count AS projected
            FROM sim_phase_product_splits
            WHERE phase_id = ANY(%s)
            """,
            (phase_ids,),
        )
        splits_raw = list(cur.fetchall())

        # Count actual real lots per (phase_id, lot_type_id)
        actuals: dict[tuple, int] = {}
        for lot in lots_raw:
            key = (lot["phase_id"], lot["lot_type_id"])
            actuals[key] = actuals.get(key, 0) + 1

        # Build phase details
        lots_by_phase: dict[int, list] = {p["phase_id"]: [] for p in phases_raw}
        for lot in lots_raw:
            lots_by_phase[lot["phase_id"]].append(
                {
                    "lot_id": lot["lot_id"],
                    "lot_number": lot["lot_number"],
                    "lot_type_id": lot["lot_type_id"],
                    "lot_source": lot["lot_source"],
                    "status": lot["status"],
                    "has_actual_dates": bool(lot["has_actual_dates"]),
                }
            )

        splits_by_phase: dict[int, list] = {p["phase_id"]: [] for p in phases_raw}
        for s in splits_raw:
            pid, lt = s["phase_id"], s["lot_type_id"]
            actual = actuals.get((pid, lt), 0)
            projected = s["projected"]
            splits_by_phase[pid].append(
                {
                    "lot_type_id": lt,
                    "actual": actual,
                    "projected": projected,
                    "total": actual + projected,
                }
            )

        phases_out = []
        for p in phases_raw:
            pid = p["phase_id"]
            phases_out.append(
                {
                    "phase_id": pid,
                    "phase_name": p["phase_name"],
                    "sequence_number": p["sequence_number"],
                    "by_lot_type": splits_by_phase.get(pid, []),
                    "lots": lots_by_phase.get(pid, []),
                }
            )

        return DevLotPhaseViewResponse(
            dev_id=dev_id,
            dev_name=f"dev {dev_id}",
            phases=phases_out,
        )

    finally:
        cur.close()
