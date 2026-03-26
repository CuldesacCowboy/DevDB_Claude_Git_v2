# routers/entitlement_groups.py
# Entitlement-group level read endpoints.

from fastapi import APIRouter, Depends, HTTPException

from api.deps import get_db_conn
from api.models.lot_models import EntGroupLotPhaseViewResponse

router = APIRouter(prefix="/entitlement-groups", tags=["entitlement-groups"])

_STATUS_SQL = """\
    CASE
        WHEN date_cls IS NOT NULL                            THEN 'OUT'
        WHEN date_cmp IS NOT NULL                           THEN 'C'
        WHEN date_str IS NOT NULL                           THEN 'UC'
        WHEN date_td_hold IS NOT NULL AND date_td IS NULL   THEN 'H'
        WHEN date_td IS NOT NULL                            THEN 'U'
        WHEN date_dev IS NOT NULL                           THEN 'D'
        WHEN date_ent IS NOT NULL                           THEN 'E'
        ELSE 'P'
    END"""


@router.get("/{ent_group_id}/lot-phase-view", response_model=EntGroupLotPhaseViewResponse)
def ent_group_lot_phase_view(ent_group_id: int, conn=Depends(get_db_conn)):
    import psycopg2.extras

    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
    try:
        # Verify ent_group exists
        cur.execute(
            "SELECT ent_group_id, ent_group_name FROM sim_entitlement_groups WHERE ent_group_id = %s",
            (ent_group_id,),
        )
        ent_group = cur.fetchone()
        if ent_group is None:
            raise HTTPException(status_code=404, detail=f"Entitlement group {ent_group_id} not found.")

        # Get all dev_ids in the group
        cur.execute(
            "SELECT dev_id FROM sim_ent_group_developments WHERE ent_group_id = %s",
            (ent_group_id,),
        )
        dev_ids = [r["dev_id"] for r in cur.fetchall()]

        if not dev_ids:
            return EntGroupLotPhaseViewResponse(
                ent_group_id=ent_group_id,
                ent_group_name=ent_group["ent_group_name"],
                unassigned=[],
                instruments=[],
                unassigned_phases=[],
            )

        # Load instruments for all devs in the group
        cur.execute(
            """
            SELECT instrument_id, instrument_name, instrument_type, dev_id
            FROM sim_legal_instruments
            WHERE dev_id = ANY(%s)
            ORDER BY dev_id ASC, instrument_id ASC
            """,
            (dev_ids,),
        )
        instruments_raw = list(cur.fetchall())

        # Load all phases for those devs
        cur.execute(
            """
            SELECT phase_id, phase_name, sequence_number, dev_id, instrument_id
            FROM sim_dev_phases
            WHERE dev_id = ANY(%s)
            ORDER BY sequence_number ASC, phase_id ASC
            """,
            (dev_ids,),
        )
        phases_raw = list(cur.fetchall())
        phase_ids = [p["phase_id"] for p in phases_raw]

        if not phase_ids:
            instruments_out = [
                {
                    "instrument_id": i["instrument_id"],
                    "instrument_name": i["instrument_name"],
                    "instrument_type": i["instrument_type"],
                    "dev_id": i["dev_id"],
                    "dev_name": f"dev {i['dev_id']}",
                    "phases": [],
                }
                for i in instruments_raw
            ]
            return EntGroupLotPhaseViewResponse(
                ent_group_id=ent_group_id,
                ent_group_name=ent_group["ent_group_name"],
                unassigned=[],
                instruments=instruments_out,
                unassigned_phases=[],
            )

        # Load real lots in those phases
        cur.execute(
            f"""
            SELECT
                lot_id, lot_number, lot_type_id, lot_source, phase_id,
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

        # Load splits (projected capacities)
        cur.execute(
            """
            SELECT phase_id, lot_type_id, lot_count AS projected
            FROM sim_phase_product_splits
            WHERE phase_id = ANY(%s)
            """,
            (phase_ids,),
        )
        splits_raw = list(cur.fetchall())

        # Load unassigned real lots for this ent_group (phase_id IS NULL, linked via PG → dev_id)
        cur.execute(
            f"""
            SELECT
                lot_id, lot_number, lot_type_id, lot_source,
                {_STATUS_SQL} AS status,
                (
                    (date_str IS NOT NULL OR date_cmp IS NOT NULL)
                    AND date_cls IS NULL
                ) AS has_actual_dates
            FROM sim_lots
            WHERE lot_source = 'real'
              AND phase_id IS NULL
              AND projection_group_id IN (
                  SELECT projection_group_id
                  FROM dim_projection_groups
                  WHERE dev_id = ANY(%s)
              )
            ORDER BY lot_number ASC NULLS LAST
            """,
            (dev_ids,),
        )
        unassigned_raw = list(cur.fetchall())

        # Count actual real lots per (phase_id, lot_type_id)
        actuals: dict[tuple, int] = {}
        for lot in lots_raw:
            key = (lot["phase_id"], lot["lot_type_id"])
            actuals[key] = actuals.get(key, 0) + 1

        # Build lots list per phase
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

        # Build splits per phase
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
                    "total": max(actual, projected),
                }
            )

        def _build_phase(p: dict) -> dict:
            pid = p["phase_id"]
            return {
                "phase_id": pid,
                "phase_name": p["phase_name"],
                "sequence_number": p["sequence_number"],
                "dev_id": p["dev_id"],
                "instrument_id": p["instrument_id"],
                "by_lot_type": splits_by_phase.get(pid, []),
                "lots": lots_by_phase.get(pid, []),
            }

        # Group phases by instrument_id (None → unassigned_phases)
        phases_by_instrument: dict = {}
        for p in phases_raw:
            iid = p["instrument_id"]
            if iid not in phases_by_instrument:
                phases_by_instrument[iid] = []
            phases_by_instrument[iid].append(_build_phase(p))

        # Assemble instruments output
        instruments_out = [
            {
                "instrument_id": i["instrument_id"],
                "instrument_name": i["instrument_name"],
                "instrument_type": i["instrument_type"],
                "dev_id": i["dev_id"],
                "dev_name": f"dev {i['dev_id']}",
                "phases": phases_by_instrument.get(i["instrument_id"], []),
            }
            for i in instruments_raw
        ]

        unassigned_phases_out = phases_by_instrument.get(None, [])

        unassigned_out = [
            {
                "lot_id": r["lot_id"],
                "lot_number": r["lot_number"],
                "lot_type_id": r["lot_type_id"],
                "lot_source": r["lot_source"],
                "status": r["status"],
                "has_actual_dates": bool(r["has_actual_dates"]),
            }
            for r in unassigned_raw
        ]

        return EntGroupLotPhaseViewResponse(
            ent_group_id=ent_group_id,
            ent_group_name=ent_group["ent_group_name"],
            unassigned=unassigned_out,
            instruments=instruments_out,
            unassigned_phases=unassigned_phases_out,
        )

    finally:
        cur.close()
