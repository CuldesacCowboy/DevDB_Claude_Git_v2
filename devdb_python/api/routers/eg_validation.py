# routers/eg_validation.py
# Entitlement-group validation, delivery-config, and ledger-config endpoints.

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from api.deps import get_db_conn
from api.db import dict_cursor


class DeliveryConfigPutRequest(BaseModel):
    # Inventory floor tolerances
    min_unstarted_inventory: int | None = None  # legacy — maps to min_d_count
    min_p_count:  int | None = None
    min_e_count:  int | None = None
    min_d_count:  int | None = None
    min_u_count:  int | None = None
    min_uc_count: int | None = None
    min_c_count:  int | None = None
    # Delivery scheduling
    delivery_window_start:   int | None = None
    delivery_window_end:     int | None = None
    max_deliveries_per_year: int | None = None
    auto_schedule_enabled:   bool | None = None
    # Build lag fallback constants
    default_cmp_lag_days: int | None = None
    default_cls_lag_days: int | None = None


class LedgerConfigPutRequest(BaseModel):
    date_paper: str | None = None   # ISO date string or null — "Plan Start Date" anchor
    date_ent:   str | None = None   # ISO date string or null — propagated to all phases/lots


router = APIRouter(prefix="/entitlement-groups", tags=["entitlement-groups"])


@router.get("/{ent_group_id}/split-check", response_model=list[dict])
def ent_group_split_check(ent_group_id: int, conn=Depends(get_db_conn)):
    """Return phases in this entitlement group that have no product splits configured."""
    cur = dict_cursor(conn)
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
    cur = dict_cursor(conn)
    try:
        cur.execute(
            """
            SELECT
                segd.dev_id,
                d.dev_name,
                sdp.annual_starts_target,
                sdp.max_starts_per_month,
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
                "max_starts_per_month": r["max_starts_per_month"],
                "updated_at":           r["updated_at"].isoformat() if r["updated_at"] else None,
                "status":               r["status"],
            }
            for r in cur.fetchall()
        ]
    finally:
        cur.close()


@router.get("/{ent_group_id}/delivery-config")
def get_delivery_config(ent_group_id: int, conn=Depends(get_db_conn)):
    """Return delivery scheduling config, inventory floor tolerances, and lag constants."""
    cur = dict_cursor(conn)
    try:
        cur.execute(
            """
            SELECT ent_group_id,
                   COALESCE(min_d_count, min_unstarted_inventory) AS min_d_count,
                   min_p_count, min_e_count, min_u_count, min_uc_count, min_c_count,
                   delivery_window_start, delivery_window_end,
                   max_deliveries_per_year, min_gap_months, auto_schedule_enabled,
                   default_cmp_lag_days, default_cls_lag_days
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
                "default_cmp_lag_days": None, "default_cls_lag_days": None,
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
    """Upsert delivery scheduling config, inventory floor tolerances, and lag constants."""
    cur = dict_cursor(conn)
    try:
        min_d = body.min_d_count if body.min_d_count is not None else body.min_unstarted_inventory
        cur.execute(
            """
            INSERT INTO sim_entitlement_delivery_config
                (ent_group_id, min_d_count, min_p_count, min_e_count,
                 min_u_count, min_uc_count, min_c_count,
                 delivery_window_start, delivery_window_end,
                 max_deliveries_per_year, auto_schedule_enabled,
                 default_cmp_lag_days, default_cls_lag_days,
                 updated_at)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, current_timestamp)
            ON CONFLICT (ent_group_id) DO UPDATE
                SET min_d_count              = COALESCE(EXCLUDED.min_d_count,              sim_entitlement_delivery_config.min_d_count),
                    min_p_count              = COALESCE(EXCLUDED.min_p_count,              sim_entitlement_delivery_config.min_p_count),
                    min_e_count              = COALESCE(EXCLUDED.min_e_count,              sim_entitlement_delivery_config.min_e_count),
                    min_u_count              = COALESCE(EXCLUDED.min_u_count,              sim_entitlement_delivery_config.min_u_count),
                    min_uc_count             = COALESCE(EXCLUDED.min_uc_count,             sim_entitlement_delivery_config.min_uc_count),
                    min_c_count              = COALESCE(EXCLUDED.min_c_count,              sim_entitlement_delivery_config.min_c_count),
                    delivery_window_start    = COALESCE(EXCLUDED.delivery_window_start,    sim_entitlement_delivery_config.delivery_window_start),
                    delivery_window_end      = COALESCE(EXCLUDED.delivery_window_end,      sim_entitlement_delivery_config.delivery_window_end),
                    max_deliveries_per_year  = COALESCE(EXCLUDED.max_deliveries_per_year,  sim_entitlement_delivery_config.max_deliveries_per_year),
                    auto_schedule_enabled    = COALESCE(EXCLUDED.auto_schedule_enabled,    sim_entitlement_delivery_config.auto_schedule_enabled),
                    default_cmp_lag_days     = COALESCE(EXCLUDED.default_cmp_lag_days,     sim_entitlement_delivery_config.default_cmp_lag_days),
                    default_cls_lag_days     = COALESCE(EXCLUDED.default_cls_lag_days,     sim_entitlement_delivery_config.default_cls_lag_days),
                    updated_at               = current_timestamp
            RETURNING ent_group_id, min_d_count, min_p_count, min_e_count,
                      min_u_count, min_uc_count, min_c_count,
                      delivery_window_start, delivery_window_end,
                      max_deliveries_per_year, auto_schedule_enabled,
                      default_cmp_lag_days, default_cls_lag_days
            """,
            (
                ent_group_id,
                min_d,
                body.min_p_count,
                body.min_e_count,
                body.min_u_count,
                body.min_uc_count,
                body.min_c_count,
                body.delivery_window_start,
                body.delivery_window_end,
                body.max_deliveries_per_year,
                body.auto_schedule_enabled,
                body.default_cmp_lag_days,
                body.default_cls_lag_days,
            ),
        )
        conn.commit()
        return dict(cur.fetchone())
    finally:
        cur.close()


@router.get("/{ent_group_id}/ledger-config")
def get_ledger_config(ent_group_id: int, conn=Depends(get_db_conn)):
    """Return date_paper (Plan Start Date) and date_ent_actual (Entitlements Date) for the group."""
    cur = dict_cursor(conn)
    try:
        cur.execute(
            "SELECT ent_group_id, date_paper, date_ent_actual FROM sim_entitlement_groups WHERE ent_group_id = %s",
            (ent_group_id,),
        )
        row = cur.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Entitlement group not found")
        return {
            "ent_group_id": row["ent_group_id"],
            "date_paper":   row["date_paper"].isoformat()      if row["date_paper"]      else None,
            "date_ent":     row["date_ent_actual"].isoformat() if row["date_ent_actual"] else None,
        }
    finally:
        cur.close()


@router.put("/{ent_group_id}/ledger-config")
def put_ledger_config(
    ent_group_id: int,
    body: LedgerConfigPutRequest,
    conn=Depends(get_db_conn),
):
    """Set date_paper (Plan Start Date) and/or date_ent (Entitlements Date) on the group.

    date_paper is stored on sim_entitlement_groups and written to sim_dev_phases.date_plan_start
    for all phases in all devs of the group.

    date_ent is stored on sim_entitlement_groups (legacy) and written to sim_dev_phases.date_ent
    (truncated to first of month) for all phases in all devs of the group. Lots then inherit
    date_ent from their phase at simulation run time (coordinator stamps sim_lots.date_ent per
    phase). This write also immediately stamps sim_lots.date_ent so the ledger is current
    without requiring a re-run.

    Passing null for either field clears it from the group, all phases, and all lots.
    """
    from datetime import date
    cur = dict_cursor(conn)
    try:
        for field, val in [("date_paper", body.date_paper), ("date_ent", body.date_ent)]:
            if val is not None:
                try:
                    date.fromisoformat(val)
                except ValueError:
                    raise HTTPException(status_code=422, detail=f"{field} must be YYYY-MM-DD")

        # Truncate date_ent to first of month so the ledger spine never has a mid-month gap.
        date_ent_trunc = None
        if body.date_ent:
            d = date.fromisoformat(body.date_ent)
            date_ent_trunc = d.replace(day=1).isoformat()

        # 1. Write group-level fields (date_ent_actual kept as legacy read field).
        cur.execute(
            """
            UPDATE sim_entitlement_groups
            SET date_paper      = %s,
                date_ent_actual = %s
            WHERE ent_group_id = %s
            RETURNING ent_group_id, date_paper, date_ent_actual
            """,
            (body.date_paper, date_ent_trunc, ent_group_id),
        )
        row = cur.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Entitlement group not found")

        # 2. Propagate date_ent to all phases in all devs of the group.
        cur.execute(
            """
            UPDATE sim_dev_phases sdp
            SET date_ent = %s
            FROM sim_legal_instruments sli
            JOIN sim_ent_group_developments egd ON egd.dev_id = sli.dev_id
            WHERE sdp.instrument_id = sli.instrument_id
              AND egd.ent_group_id  = %s
            """,
            (date_ent_trunc, ent_group_id),
        )

        # 3. Propagate date_plan_start (= date_paper) to all phases.
        cur.execute(
            """
            UPDATE sim_dev_phases sdp
            SET date_plan_start = %s
            FROM sim_legal_instruments sli
            JOIN sim_ent_group_developments egd ON egd.dev_id = sli.dev_id
            WHERE sdp.instrument_id = sli.instrument_id
              AND egd.ent_group_id  = %s
            """,
            (body.date_paper, ent_group_id),
        )

        # 4. Stamp sim_lots.date_ent from each lot's phase (or null if phase date is null).
        #    This keeps the ledger current without requiring a re-run.
        cur.execute(
            """
            UPDATE sim_lots sl
            SET date_ent = sdp.date_ent
            FROM sim_dev_phases sdp
            JOIN sim_legal_instruments sli ON sli.instrument_id = sdp.instrument_id
            JOIN sim_ent_group_developments egd ON egd.dev_id = sli.dev_id
            WHERE sl.phase_id     = sdp.phase_id
              AND egd.ent_group_id = %s
            """,
            (ent_group_id,),
        )
        lots_updated = cur.rowcount

        conn.commit()
        return {
            "ent_group_id":  row["ent_group_id"],
            "date_paper":    row["date_paper"].isoformat()      if row["date_paper"]      else None,
            "date_ent":      row["date_ent_actual"].isoformat() if row["date_ent_actual"] else None,
            "lots_entitled": lots_updated,
        }
    finally:
        cur.close()
