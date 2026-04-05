# services/eg_lot_phase_service.py
# Query logic for the entitlement-group lot-phase view.
# Called by routers/eg_views.py.

import re

from fastapi import HTTPException

from api.db import dict_cursor
from api.models.lot_models import EntGroupLotPhaseViewResponse
from api.sql_fragments import lot_status_sql

_STATUS_SQL = lot_status_sql()


def _sort_phases_for_display(phases: list) -> list:
    """
    Sort an instrument's phase list for UI display.
    Phases with display_order set come first (ascending).
    Phases with display_order NULL fall back to auto-sort:
      alphabetical by prefix, then numeric by ph. N.
    display_order is a UI preference only — never touches sequence_number.
    """
    def _auto_key(p):
        name = (p.get("phase_name") or "").strip()
        m = re.search(r'\s+ph\.\s*(\d+)\s*$', name)
        prefix = name[: m.start()].strip() if m else name
        ph_num = int(m.group(1)) if m else 0
        return (prefix.lower(), ph_num)

    with_order = sorted(
        [p for p in phases if p.get("display_order") is not None],
        key=lambda p: p["display_order"],
    )
    without_order = sorted(
        [p for p in phases if p.get("display_order") is None],
        key=_auto_key,
    )
    return with_order + without_order


def query_lot_phase_view(ent_group_id: int, conn) -> EntGroupLotPhaseViewResponse:
    cur = dict_cursor(conn)
    try:
        cur.execute(
            "SELECT ent_group_id, ent_group_name FROM sim_entitlement_groups WHERE ent_group_id = %s",
            (ent_group_id,),
        )
        ent_group = cur.fetchone()
        if ent_group is None:
            raise HTTPException(status_code=404, detail=f"Entitlement group {ent_group_id} not found.")

        # Get dev_ids via sim_ent_group_developments — the authoritative source of truth
        # for which devs belong to an entitlement group. Using developments.community_id
        # was unreliable: community_id may not match ent_group_id for newer communities.
        cur.execute(
            """
            SELECT segd.dev_id, d.dev_name
            FROM sim_ent_group_developments segd
            JOIN dim_development dd ON dd.development_id = segd.dev_id
            JOIN developments d ON d.marks_code = dd.dev_code2
            WHERE segd.ent_group_id = %s
            """,
            (ent_group_id,),
        )
        dev_rows = cur.fetchall()
        dev_ids = [r["dev_id"] for r in dev_rows]
        dev_name_map = {r["dev_id"]: r["dev_name"] for r in dev_rows}

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

        # Load all phases for those devs.
        # display_order is a UI preference; sequence_number is the engine's ordering.
        # Python applies _sort_phases_for_display() after grouping by instrument.
        cur.execute(
            """
            SELECT phase_id, phase_name, sequence_number, dev_id,
                   instrument_id, display_order
            FROM sim_dev_phases
            WHERE dev_id = ANY(%s)
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
                    "dev_name": dev_name_map.get(i["dev_id"], f"dev {i['dev_id']}"),
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
                building_group_id,
                {_STATUS_SQL} AS status,
                (
                    (date_str IS NOT NULL OR date_cmp IS NOT NULL)
                    AND date_cls IS NULL
                ) AS has_actual_dates
            FROM sim_lots
            WHERE phase_id = ANY(%s) AND lot_source IN ('real', 'pre')
            ORDER BY lot_number ASC NULLS LAST
            """,
            (phase_ids,),
        )
        lots_raw = list(cur.fetchall())

        # Load lot type short names
        cur.execute("SELECT lot_type_id, lot_type_short FROM ref_lot_types")
        lot_type_shorts = {r["lot_type_id"]: r["lot_type_short"] for r in cur.fetchall()}

        # Load splits (projected capacities)
        cur.execute(
            """
            SELECT phase_id, lot_type_id, projected_count AS projected
            FROM sim_phase_product_splits
            WHERE phase_id = ANY(%s)
            """,
            (phase_ids,),
        )
        splits_raw = list(cur.fetchall())

        # Load unassigned real lots for this ent_group (phase_id IS NULL)
        cur.execute(
            f"""
            SELECT
                lot_id, lot_number, lot_type_id, lot_source,
                building_group_id,
                {_STATUS_SQL} AS status,
                (
                    (date_str IS NOT NULL OR date_cmp IS NOT NULL)
                    AND date_cls IS NULL
                ) AS has_actual_dates
            FROM sim_lots
            WHERE lot_source IN ('real', 'pre')
              AND phase_id IS NULL
              AND dev_id = ANY(%s)
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
                    "building_group_id": lot["building_group_id"],
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
                    "lot_type_short": lot_type_shorts.get(lt),
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
                "display_order": p.get("display_order"),  # UI pref only
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

        # Sort each instrument's phases for display (display_order → auto-sort fallback)
        for iid in phases_by_instrument:
            phases_by_instrument[iid] = _sort_phases_for_display(phases_by_instrument[iid])

        # Assemble instruments output — dev_name from developments table
        instruments_out = [
            {
                "instrument_id": i["instrument_id"],
                "instrument_name": i["instrument_name"],
                "instrument_type": i["instrument_type"],
                "dev_id": i["dev_id"],
                "dev_name": dev_name_map.get(i["dev_id"], f"dev {i['dev_id']}"),
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
                "building_group_id": r["building_group_id"],
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
