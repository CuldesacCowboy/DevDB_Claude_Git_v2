"""
scenario_runner -- Run a simulation scenario with parameter overrides.

Flow: backup sim_lots → apply overrides → run engine → capture ledger → restore everything.
Uses the same convergence_coordinator as base runs. No engine modifications needed.
"""

import json
import logging
from datetime import date

from engine.connection import PGConnection
from engine.coordinator import convergence_coordinator
from engine.ledger_aggregator import ledger_aggregator

logger = logging.getLogger(__name__)


def run_scenario(scenario_id: int) -> dict:
    """
    Execute a scenario run:
    1. Load overrides from sim_scenario_overrides
    2. Backup sim_lots (lot_source='sim') for community devs
    3. Save original parameter values
    4. Apply overrides to DB
    5. Run convergence_coordinator
    6. Capture v_sim_ledger_monthly → sim_scenario_results
    7. Restore sim_lots + original params
    8. Rebuild ledger view

    Returns dict with iterations, elapsed info.
    """
    conn = PGConnection()
    try:
        return _run_scenario_impl(conn, scenario_id)
    finally:
        conn.close()


def _run_scenario_impl(conn, scenario_id: int) -> dict:
    # ── 1. Load scenario ─────────────────────────────────────────────────
    scenario_df = conn.read_df(
        "SELECT scenario_id, ent_group_id FROM sim_scenarios WHERE scenario_id = %s",
        (scenario_id,),
    )
    if scenario_df.empty:
        raise ValueError(f"Scenario {scenario_id} not found")
    ent_group_id = int(scenario_df.iloc[0]["ent_group_id"])

    overrides_df = conn.read_df(
        "SELECT scope, scope_id, param_name, param_value FROM sim_scenario_overrides WHERE scenario_id = %s",
        (scenario_id,),
    )
    overrides = []
    for _, row in overrides_df.iterrows():
        overrides.append({
            "scope": row["scope"],
            "scope_id": int(row["scope_id"]),
            "param_name": row["param_name"],
            "param_value": row["param_value"],  # already parsed from JSONB
        })

    logger.info(f"scenario_runner: Running scenario {scenario_id} for ent_group {ent_group_id} with {len(overrides)} override(s)")

    # ── 2. Get community dev_ids ─────────────────────────────────────────
    dev_ids_df = conn.read_df(
        "SELECT dev_id FROM sim_ent_group_developments WHERE ent_group_id = %s",
        (ent_group_id,),
    )
    dev_ids = [int(d) for d in dev_ids_df["dev_id"]]

    # ── 3. Backup sim lots ───────────────────────────────────────────────
    if dev_ids:
        backup_df = conn.read_df(
            """
            SELECT * FROM sim_lots
            WHERE lot_source = 'sim' AND dev_id = ANY(%s)
            """,
            (dev_ids,),
        )
    else:
        backup_df = None
    backup_count = len(backup_df) if backup_df is not None and not backup_df.empty else 0
    logger.info(f"scenario_runner: Backed up {backup_count} sim lots")

    # ── 4. Save original param values ────────────────────────────────────
    originals = []
    for ov in overrides:
        orig = _read_original(conn, ov)
        originals.append({"override": ov, "original_value": orig})

    # ── 5. Apply overrides ───────────────────────────────────────────────
    for ov in overrides:
        _apply_override(conn, ov)
    logger.info(f"scenario_runner: Applied {len(overrides)} override(s)")

    iterations = 0
    try:
        # ── 6. Run engine ────────────────────────────────────────────────
        result = convergence_coordinator(ent_group_id)
        iterations = result[0] if isinstance(result, tuple) else result

        # ── 7. Capture ledger → sim_scenario_results ─────────────────────
        _capture_results(conn, scenario_id, ent_group_id)
        logger.info(f"scenario_runner: Captured results for scenario {scenario_id}")

    finally:
        # ── 8. Restore sim lots ──────────────────────────────────────────
        if dev_ids:
            conn.execute(
                "DELETE FROM sim_lots WHERE lot_source = 'sim' AND dev_id = ANY(%s)",
                (dev_ids,),
            )
            if backup_df is not None and not backup_df.empty:
                cols = backup_df.columns.tolist()
                rows = [tuple(row) for _, row in backup_df.iterrows()]
                placeholders = ", ".join(["%s"] * len(cols))
                col_str = ", ".join(cols)
                for row in rows:
                    conn.execute(
                        f"INSERT INTO sim_lots ({col_str}) VALUES ({placeholders})",
                        row,
                    )
            logger.info(f"scenario_runner: Restored {backup_count} sim lots")

        # ── 9. Restore original params ───────────────────────────────────
        for entry in originals:
            _restore_original(conn, entry["override"], entry["original_value"])
        logger.info(f"scenario_runner: Restored {len(originals)} original param value(s)")

        # ── 10. Rebuild ledger view ──────────────────────────────────────
        ledger_aggregator(conn)
        logger.info("scenario_runner: Ledger view rebuilt")

    # ── 11. Update last_run_at ───────────────────────────────────────────
    conn.execute(
        "UPDATE sim_scenarios SET last_run_at = NOW() WHERE scenario_id = %s",
        (scenario_id,),
    )

    return {"iterations": iterations, "scenario_id": scenario_id}


# ── Override helpers ─────────────────────────────────────────────────────────

def _read_original(conn, ov: dict):
    """Read the current value of the parameter being overridden."""
    scope, scope_id, param = ov["scope"], ov["scope_id"], ov["param_name"]

    if scope == "dev":
        df = conn.read_df(
            f"SELECT {param} FROM sim_dev_params WHERE dev_id = %s", (scope_id,)
        )
        if df.empty:
            return None
        val = df.iloc[0][param]
        return None if val is None else val

    elif scope == "instrument":
        df = conn.read_df(
            f"SELECT {param} FROM sim_legal_instruments WHERE instrument_id = %s", (scope_id,)
        )
        if df.empty:
            return None
        val = df.iloc[0][param]
        return None if val is None else val

    elif scope == "ent_group":
        df = conn.read_df(
            f"SELECT {param} FROM sim_entitlement_delivery_config WHERE ent_group_id = %s", (scope_id,)
        )
        if df.empty:
            return None
        val = df.iloc[0][param]
        return None if val is None else val

    return None


def _apply_override(conn, ov: dict):
    """Write the override value to the appropriate DB table."""
    scope, scope_id, param = ov["scope"], ov["scope_id"], ov["param_name"]
    value = ov["param_value"]

    if scope == "dev":
        if param == "annual_starts_target":
            conn.execute(
                "UPDATE sim_dev_params SET annual_starts_target = %s WHERE dev_id = %s",
                (value, scope_id),
            )
        elif param == "max_starts_per_month":
            conn.execute(
                "UPDATE sim_dev_params SET max_starts_per_month = %s WHERE dev_id = %s",
                (value, scope_id),
            )

    elif scope == "instrument":
        if param == "spec_rate":
            conn.execute(
                "UPDATE sim_legal_instruments SET spec_rate = %s WHERE instrument_id = %s",
                (value, scope_id),
            )

    elif scope == "ent_group":
        if param == "max_deliveries_per_year":
            conn.execute(
                "UPDATE sim_entitlement_delivery_config SET max_deliveries_per_year = %s WHERE ent_group_id = %s",
                (value, scope_id),
            )
        elif param == "delivery_months":
            conn.execute(
                "UPDATE sim_entitlement_delivery_config SET delivery_months = %s::int[] WHERE ent_group_id = %s",
                (value, scope_id),
            )


def _restore_original(conn, ov: dict, original_value):
    """Write back the original value."""
    ov_copy = dict(ov)
    ov_copy["param_value"] = original_value
    _apply_override(conn, ov_copy)


def _capture_results(conn, scenario_id: int, ent_group_id: int):
    """Snapshot the current v_sim_ledger_monthly into sim_scenario_results."""
    conn.execute(
        "DELETE FROM sim_scenario_results WHERE scenario_id = %s", (scenario_id,)
    )
    conn.execute(
        """
        INSERT INTO sim_scenario_results (
            scenario_id, dev_id, calendar_month,
            ent_plan, dev_plan, td_plan, str_plan, str_plan_spec, str_plan_build,
            cmp_plan, cls_plan,
            p_end, e_end, d_end, h_end, u_end, uc_end, c_end, closed_cumulative
        )
        SELECT
            %s, v.dev_id, v.calendar_month,
            COALESCE(SUM(v.ent_plan), 0), COALESCE(SUM(v.dev_plan), 0),
            COALESCE(SUM(v.td_plan), 0), COALESCE(SUM(v.str_plan), 0),
            COALESCE(SUM(v.str_plan_spec), 0), COALESCE(SUM(v.str_plan_build), 0),
            COALESCE(SUM(v.cmp_plan), 0), COALESCE(SUM(v.cls_plan), 0),
            COALESCE(SUM(v.p_end), 0), COALESCE(SUM(v.e_end), 0),
            COALESCE(SUM(v.d_end), 0), COALESCE(SUM(v.h_end), 0),
            COALESCE(SUM(v.u_end), 0), COALESCE(SUM(v.uc_end), 0),
            COALESCE(SUM(v.c_end), 0), COALESCE(SUM(v.closed_cumulative), 0)
        FROM v_sim_ledger_monthly v
        JOIN sim_ent_group_developments segd ON segd.dev_id = v.dev_id
        WHERE segd.ent_group_id = %s
        GROUP BY v.dev_id, v.calendar_month
        """,
        (scenario_id, ent_group_id),
    )
