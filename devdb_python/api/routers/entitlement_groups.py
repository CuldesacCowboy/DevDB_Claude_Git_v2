# routers/entitlement_groups.py
# Entitlement-group level read and write endpoints.

import re

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from api.deps import get_db_conn
from api.models.lot_models import EntGroupLotPhaseViewResponse
from api.sql_fragments import lot_status_sql


class EntGroupCreateRequest(BaseModel):
    ent_group_name: str


class EntGroupPatchRequest(BaseModel):
    ent_group_name: str


class DeliveryConfigPutRequest(BaseModel):
    min_unstarted_inventory: int | None = None  # legacy — maps to min_d_count
    min_p_count:  int | None = None
    min_e_count:  int | None = None
    min_d_count:  int | None = None
    min_u_count:  int | None = None
    min_uc_count: int | None = None
    min_c_count:  int | None = None


class LedgerConfigPutRequest(BaseModel):
    ledger_start_date: str | None = None   # ISO date string or null


class EntitlementEventCreateRequest(BaseModel):
    dev_id: int
    event_date: str   # ISO date string
    lots_entitled: int
    notes: str | None = None


class EntitlementEventUpdateRequest(BaseModel):
    dev_id: int | None = None
    event_date: str | None = None
    lots_entitled: int | None = None
    notes: str | None = None

router = APIRouter(prefix="/entitlement-groups", tags=["entitlement-groups"])


@router.get("", response_model=list[dict])
def list_entitlement_groups(conn=Depends(get_db_conn)):
    import psycopg2.extras
    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
    try:
        # r/p/t rollup per community using developments.community_id as source of truth.
        # Join path: developments → dim_development (bridge for legacy dev_id) →
        #   sim_legal_instruments → sim_dev_phases → sim_lots / sim_phase_product_splits.
        # total = SUM of GREATEST(real_count, projected_count) per phase.
        cur.execute(
            """
            SELECT
                eg.ent_group_id,
                eg.ent_group_name,
                COALESCE(SUM(pt.real_count), 0)::int          AS real_count,
                COALESCE(SUM(pt.projected_count), 0)::int     AS projected_count,
                COALESCE(SUM(
                    GREATEST(pt.real_count, pt.projected_count)
                ), 0)::int                                     AS total_count
            FROM sim_entitlement_groups eg
            LEFT JOIN (
                SELECT
                    d.community_id,
                    sdp.phase_id,
                    COUNT(sl.lot_id) FILTER (WHERE sl.lot_source = 'real') AS real_count,
                    COALESCE(SUM(spps.projected_count), 0)                   AS projected_count
                FROM developments d
                JOIN dim_development dd ON dd.dev_code2 = d.marks_code
                JOIN sim_legal_instruments li ON li.dev_id = dd.development_id
                JOIN sim_dev_phases sdp ON sdp.instrument_id = li.instrument_id
                LEFT JOIN sim_lots sl
                       ON sl.phase_id = sdp.phase_id AND sl.lot_source = 'real'
                LEFT JOIN sim_phase_product_splits spps ON spps.phase_id = sdp.phase_id
                WHERE d.community_id IS NOT NULL
                  AND d.marks_code IS NOT NULL
                GROUP BY d.community_id, sdp.phase_id
            ) pt ON pt.community_id = eg.ent_group_id
            GROUP BY eg.ent_group_id, eg.ent_group_name
            ORDER BY eg.ent_group_name
            """
        )
        return [
            {
                "ent_group_id": r["ent_group_id"],
                "ent_group_name": r["ent_group_name"],
                "real_count": int(r["real_count"]),
                "projected_count": int(r["projected_count"]),
                "total_count": int(r["total_count"]),
            }
            for r in cur.fetchall()
        ]
    finally:
        cur.close()


@router.post("", response_model=dict, status_code=201)
def create_entitlement_group(body: EntGroupCreateRequest, conn=Depends(get_db_conn)):
    import psycopg2.extras
    name = (body.ent_group_name or "").strip()
    if not name:
        raise HTTPException(status_code=422, detail="ent_group_name is required")
    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
    try:
        cur.execute("SELECT COALESCE(MAX(ent_group_id), 0) + 1 AS new_id FROM sim_entitlement_groups")
        new_id = int(cur.fetchone()["new_id"])
        cur.execute(
            "INSERT INTO sim_entitlement_groups (ent_group_id, ent_group_name) VALUES (%s, %s)",
            (new_id, name),
        )
        conn.commit()
        return {"ent_group_id": new_id, "ent_group_name": name}
    except Exception:
        conn.rollback()
        raise
    finally:
        cur.close()


@router.patch("/{ent_group_id}", response_model=dict)
def patch_entitlement_group(ent_group_id: int, body: EntGroupPatchRequest, conn=Depends(get_db_conn)):
    import psycopg2.extras
    name = (body.ent_group_name or "").strip()
    if not name:
        raise HTTPException(status_code=422, detail="ent_group_name cannot be empty")
    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
    try:
        cur.execute(
            "UPDATE sim_entitlement_groups SET ent_group_name = %s WHERE ent_group_id = %s",
            (name, ent_group_id),
        )
        if cur.rowcount == 0:
            conn.rollback()
            raise HTTPException(status_code=404, detail=f"Entitlement group {ent_group_id} not found.")
        conn.commit()
        return {"ent_group_id": ent_group_id, "ent_group_name": name}
    except HTTPException:
        raise
    except Exception:
        conn.rollback()
        raise
    finally:
        cur.close()


def _sort_phases_for_display(phases: list) -> list:
    """
    Sort an instrument's phase list for UI display.
    Phases with display_order set come first (ascending).
    Phases with display_order NULL fall back to auto-sort:
      alphabetical by prefix, then numeric by ph. N.
    display_order is a UI preference only -- never touches sequence_number.
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

_STATUS_SQL = lot_status_sql()


@router.get("/{ent_group_id}/split-check", response_model=list[dict])
def ent_group_split_check(ent_group_id: int, conn=Depends(get_db_conn)):
    """
    Return phases in this entitlement group that have no product splits configured.
    Used by SimulationView to warn before running — empty list means all phases are ready.
    """
    import psycopg2.extras
    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
    try:
        cur.execute(
            """
            SELECT
                sdp.phase_id,
                sdp.phase_name,
                sli.instrument_name
            FROM sim_dev_phases sdp
            JOIN sim_legal_instruments sli ON sdp.instrument_id = sli.instrument_id
            JOIN sim_ent_group_developments segd ON sli.dev_id = segd.dev_id
            WHERE segd.ent_group_id = %s
              AND NOT EXISTS (
                  SELECT 1 FROM sim_phase_product_splits spps
                  WHERE spps.phase_id = sdp.phase_id
              )
            ORDER BY sli.instrument_name, sdp.sequence_number
            """,
            (ent_group_id,),
        )
        return [
            {
                "phase_id": r["phase_id"],
                "phase_name": r["phase_name"],
                "instrument_name": r["instrument_name"],
            }
            for r in cur.fetchall()
        ]
    finally:
        cur.close()


@router.get("/{ent_group_id}/param-check", response_model=list[dict])
def ent_group_param_check(ent_group_id: int, conn=Depends(get_db_conn)):
    """
    Return ALL developments in this entitlement group with their current
    sim_dev_params. status = 'ok' | 'missing' | 'stale' (stale = >180 days).
    """
    import psycopg2.extras
    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
    try:
        cur.execute(
            """
            SELECT
                segd.dev_id,
                d.dev_name,
                sdp.annual_starts_target,
                sdp.updated_at,
                CASE
                    WHEN sdp.dev_id IS NULL THEN 'missing'
                    WHEN sdp.updated_at < NOW() - INTERVAL '180 days' THEN 'stale'
                    ELSE 'ok'
                END AS status
            FROM sim_ent_group_developments segd
            JOIN dim_development dd ON dd.development_id = segd.dev_id
            JOIN developments d ON d.marks_code = dd.dev_code2
            LEFT JOIN sim_dev_params sdp ON sdp.dev_id = segd.dev_id
            WHERE segd.ent_group_id = %s
            ORDER BY d.dev_name
            """,
            (ent_group_id,),
        )
        return [
            {
                "dev_id":               r["dev_id"],
                "dev_name":             r["dev_name"],
                "annual_starts_target": r["annual_starts_target"],
                "updated_at":           r["updated_at"].isoformat() if r["updated_at"] else None,
                "status":               r["status"],
            }
            for r in cur.fetchall()
        ]
    finally:
        cur.close()


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

        # Get legacy dev_ids and dev_name via developments.community_id.
        # Bridge: developments.marks_code = dim_development.dev_code2
        # dim_development.development_id is the legacy dev_id used in sim_legal_instruments
        # and sim_dev_phases.
        cur.execute(
            """
            SELECT dd.development_id AS dev_id, d.dev_name
            FROM developments d
            JOIN dim_development dd ON dd.dev_code2 = d.marks_code
            WHERE d.community_id = %s
              AND d.marks_code IS NOT NULL
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
            WHERE phase_id = ANY(%s) AND lot_source = 'real'
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
            WHERE lot_source = 'real'
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


@router.get("/{ent_group_id}/delivery-config")
def get_delivery_config(ent_group_id: int, conn=Depends(get_db_conn)):
    """Return delivery scheduling config and inventory floor tolerances."""
    import psycopg2.extras
    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
    try:
        cur.execute(
            """
            SELECT ent_group_id,
                   COALESCE(min_d_count, min_unstarted_inventory) AS min_d_count,
                   min_p_count, min_e_count, min_u_count, min_uc_count, min_c_count,
                   delivery_window_start, delivery_window_end,
                   max_deliveries_per_year, min_gap_months, auto_schedule_enabled
            FROM sim_entitlement_delivery_config
            WHERE ent_group_id = %s
            """,
            (ent_group_id,),
        )
        row = cur.fetchone()
        if not row:
            return {
                "ent_group_id": ent_group_id,
                "min_p_count": None, "min_e_count": None, "min_d_count": None,
                "min_u_count": None, "min_uc_count": None, "min_c_count": None,
                "delivery_window_start": None, "delivery_window_end": None,
                "max_deliveries_per_year": None, "min_gap_months": None,
                "auto_schedule_enabled": None,
            }
        return dict(row)
    finally:
        cur.close()


@router.put("/{ent_group_id}/delivery-config")
def put_delivery_config(
    ent_group_id: int,
    body: DeliveryConfigPutRequest,
    conn=Depends(get_db_conn),
):
    """Upsert delivery scheduling config and inventory floor tolerances."""
    import psycopg2.extras
    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
    try:
        # Resolve legacy field
        min_d = body.min_d_count if body.min_d_count is not None else body.min_unstarted_inventory
        cur.execute(
            """
            INSERT INTO sim_entitlement_delivery_config
                (ent_group_id, min_d_count, min_p_count, min_e_count,
                 min_u_count, min_uc_count, min_c_count, updated_at)
            VALUES (%s, %s, %s, %s, %s, %s, %s, current_timestamp)
            ON CONFLICT (ent_group_id) DO UPDATE
                SET min_d_count  = EXCLUDED.min_d_count,
                    min_p_count  = EXCLUDED.min_p_count,
                    min_e_count  = EXCLUDED.min_e_count,
                    min_u_count  = EXCLUDED.min_u_count,
                    min_uc_count = EXCLUDED.min_uc_count,
                    min_c_count  = EXCLUDED.min_c_count,
                    updated_at   = current_timestamp
            RETURNING ent_group_id, min_d_count, min_p_count, min_e_count,
                      min_u_count, min_uc_count, min_c_count
            """,
            (
                ent_group_id,
                min_d,
                body.min_p_count,
                body.min_e_count,
                body.min_u_count,
                body.min_uc_count,
                body.min_c_count,
            ),
        )
        conn.commit()
        return dict(cur.fetchone())
    finally:
        cur.close()


@router.get("/{ent_group_id}/ledger-config")
def get_ledger_config(ent_group_id: int, conn=Depends(get_db_conn)):
    """Return ledger_start_date for the entitlement group."""
    import psycopg2.extras
    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
    try:
        cur.execute(
            "SELECT ent_group_id, ledger_start_date FROM sim_entitlement_groups WHERE ent_group_id = %s",
            (ent_group_id,),
        )
        row = cur.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Entitlement group not found")
        return {
            "ent_group_id": row["ent_group_id"],
            "ledger_start_date": row["ledger_start_date"].isoformat() if row["ledger_start_date"] else None,
        }
    finally:
        cur.close()


@router.put("/{ent_group_id}/ledger-config")
def put_ledger_config(
    ent_group_id: int,
    body: LedgerConfigPutRequest,
    conn=Depends(get_db_conn),
):
    """Set ledger_start_date on the entitlement group."""
    import psycopg2.extras
    from datetime import date
    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
    try:
        if body.ledger_start_date is not None:
            try:
                date.fromisoformat(body.ledger_start_date)
            except ValueError:
                raise HTTPException(status_code=422, detail="ledger_start_date must be YYYY-MM-DD")
        cur.execute(
            """
            UPDATE sim_entitlement_groups
            SET ledger_start_date = %s
            WHERE ent_group_id = %s
            RETURNING ent_group_id, ledger_start_date
            """,
            (body.ledger_start_date, ent_group_id),
        )
        conn.commit()
        row = cur.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Entitlement group not found")
        return {
            "ent_group_id": row["ent_group_id"],
            "ledger_start_date": row["ledger_start_date"].isoformat() if row["ledger_start_date"] else None,
        }
    finally:
        cur.close()


# ---------------------------------------------------------------------------
# Entitlement events CRUD
# ---------------------------------------------------------------------------

@router.get("/{ent_group_id}/entitlement-events")
def list_entitlement_events(ent_group_id: int, conn=Depends(get_db_conn)):
    """List all entitlement events for an entitlement group."""
    import psycopg2.extras
    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
    try:
        cur.execute(
            """
            SELECT ee.event_id, ee.dev_id, d.dev_name,
                   ee.event_date, ee.lots_entitled, ee.notes
            FROM sim_entitlement_events ee
            JOIN dim_development dd ON dd.development_id = ee.dev_id
            JOIN developments d ON d.marks_code = dd.dev_code2
            WHERE ee.ent_group_id = %s
            ORDER BY ee.event_date, ee.dev_id
            """,
            (ent_group_id,),
        )
        return [
            {
                "event_id":      r["event_id"],
                "dev_id":        r["dev_id"],
                "dev_name":      r["dev_name"],
                "event_date":    r["event_date"].isoformat(),
                "lots_entitled": r["lots_entitled"],
                "notes":         r["notes"],
            }
            for r in cur.fetchall()
        ]
    finally:
        cur.close()


@router.post("/{ent_group_id}/entitlement-events", status_code=201)
def create_entitlement_event(
    ent_group_id: int,
    body: EntitlementEventCreateRequest,
    conn=Depends(get_db_conn),
):
    """Create a new entitlement event."""
    import psycopg2.extras
    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
    try:
        cur.execute("SELECT COALESCE(MAX(event_id), 0) + 1 AS next_id FROM sim_entitlement_events")
        next_id = cur.fetchone()["next_id"]
        cur.execute(
            """
            INSERT INTO sim_entitlement_events
                (event_id, ent_group_id, dev_id, event_date, lots_entitled, notes)
            VALUES (%s, %s, %s, %s, %s, %s)
            RETURNING event_id, dev_id, event_date, lots_entitled, notes
            """,
            (next_id, ent_group_id, body.dev_id, body.event_date,
             body.lots_entitled, body.notes),
        )
        conn.commit()
        row = cur.fetchone()
        return {
            "event_id":      row["event_id"],
            "dev_id":        row["dev_id"],
            "event_date":    row["event_date"].isoformat(),
            "lots_entitled": row["lots_entitled"],
            "notes":         row["notes"],
        }
    finally:
        cur.close()


@router.patch("/{ent_group_id}/entitlement-events/{event_id}")
def update_entitlement_event(
    ent_group_id: int,
    event_id: int,
    body: EntitlementEventUpdateRequest,
    conn=Depends(get_db_conn),
):
    """Update fields on an entitlement event."""
    import psycopg2.extras
    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
    try:
        updates = {}
        if body.dev_id is not None:        updates["dev_id"] = body.dev_id
        if body.event_date is not None:    updates["event_date"] = body.event_date
        if body.lots_entitled is not None: updates["lots_entitled"] = body.lots_entitled
        if body.notes is not None:         updates["notes"] = body.notes
        if not updates:
            raise HTTPException(status_code=422, detail="No fields to update")
        set_clause = ", ".join(f"{k} = %s" for k in updates)
        cur.execute(
            f"""
            UPDATE sim_entitlement_events
            SET {set_clause}
            WHERE event_id = %s AND ent_group_id = %s
            RETURNING event_id, dev_id, event_date, lots_entitled, notes
            """,
            (*updates.values(), event_id, ent_group_id),
        )
        conn.commit()
        row = cur.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Event not found")
        return {
            "event_id":      row["event_id"],
            "dev_id":        row["dev_id"],
            "event_date":    row["event_date"].isoformat(),
            "lots_entitled": row["lots_entitled"],
            "notes":         row["notes"],
        }
    finally:
        cur.close()


@router.delete("/{ent_group_id}/entitlement-events/{event_id}", status_code=204)
def delete_entitlement_event(
    ent_group_id: int,
    event_id: int,
    conn=Depends(get_db_conn),
):
    """Delete an entitlement event."""
    cur = conn.cursor()
    try:
        cur.execute(
            "DELETE FROM sim_entitlement_events WHERE event_id = %s AND ent_group_id = %s",
            (event_id, ent_group_id),
        )
        conn.commit()
    finally:
        cur.close()
