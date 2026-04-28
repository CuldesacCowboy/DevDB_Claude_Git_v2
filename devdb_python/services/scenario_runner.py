"""
scenario_runner -- Run a simulation scenario with parameter overrides (read-only).

Flow: load overrides → run engine in scenario mode → write lot-level results
      to sim_projection_lots + aggregated results to sim_scenario_results.
      Never touches sim_lots or any base table.
"""

import logging
from datetime import date

from engine.connection import PGConnection
from engine.coordinator import convergence_coordinator
from engine.ledger_aggregator import compute_scenario_ledger

logger = logging.getLogger(__name__)


def run_scenario(scenario_id: int) -> dict:
    """
    Execute a scenario run (read-only):
    1. Load overrides from sim_scenario_overrides
    2. Build overrides dict for coordinator
    3. Run convergence_coordinator in scenario mode (returns temp_lots, no DB writes)
    4. Write lot-level results to sim_projection_lots (scenario projection)
    5. Compute aggregated ledger and write to sim_scenario_results
    6. Update last_run_at

    Returns dict with scenario_id and lot count.
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

    logger.info(f"scenario_runner: Running scenario {scenario_id} for ent_group {ent_group_id} "
                f"with {len(overrides_df)} override(s)")

    # ── 2. Build overrides dict ──────────────────────────────────────────
    overrides = _build_overrides_dict(overrides_df)

    # ── 3. Get community dev_ids ─────────────────────────────────────────
    dev_ids_df = conn.read_df(
        "SELECT dev_id FROM sim_ent_group_developments WHERE ent_group_id = %s",
        (ent_group_id,),
    )
    dev_ids = [int(d) for d in dev_ids_df["dev_id"]]

    # ── 4. Run engine with overrides (full convergence loop) ────────────
    # Pass _scenario_id so the coordinator creates a scenario projection
    overrides["_scenario_id"] = scenario_id
    result = convergence_coordinator(ent_group_id, overrides=overrides)

    if isinstance(result, tuple):
        iterations = result[0]
    else:
        iterations = result

    # ── 5. Read scenario lots from projection ────────────────────────────
    proj_df = conn.read_df(
        "SELECT projection_id FROM sim_projections WHERE ent_group_id = %s AND projection_type = 'scenario' AND scenario_id = %s ORDER BY created_at DESC LIMIT 1",
        (ent_group_id, scenario_id),
    )
    if proj_df.empty:
        raise RuntimeError(f"No projection found for scenario {scenario_id}")
    proj_id = int(proj_df.iloc[0]["projection_id"])

    lot_count_df = conn.read_df(
        "SELECT COUNT(*) as n FROM sim_projection_lots WHERE projection_id = %s",
        (proj_id,),
    )
    lot_count = int(lot_count_df.iloc[0]["n"])
    logger.info(f"scenario_runner: Scenario projection {proj_id} has {lot_count} lots")

    # ── 6. Compute aggregated ledger → sim_scenario_results ──────────────
    # Read scenario lots as dicts for compute_scenario_ledger
    scenario_lots_df = conn.read_df(
        "SELECT * FROM sim_projection_lots WHERE projection_id = %s",
        (proj_id,),
    )
    scenario_lots = scenario_lots_df.to_dict("records") if not scenario_lots_df.empty else []
    ledger_rows = compute_scenario_ledger(conn, scenario_lots, dev_ids)
    _write_aggregated_results(conn, scenario_id, ledger_rows)
    logger.info(f"scenario_runner: Wrote {len(ledger_rows)} ledger rows for scenario {scenario_id}")

    # ── 7. Update last_run_at and clear stale flag ──────────────────────
    conn.execute(
        "UPDATE sim_scenarios SET last_run_at = NOW(), is_stale = FALSE WHERE scenario_id = %s",
        (scenario_id,),
    )

    return {"scenario_id": scenario_id, "iterations": iterations, "lots": lot_count}


def _build_overrides_dict(overrides_df) -> dict:
    """Convert sim_scenario_overrides rows into nested dict for coordinator."""
    result = {"dev": {}, "ent_group": {}, "instrument": {}}
    for _, row in overrides_df.iterrows():
        scope = row["scope"]
        scope_id = int(row["scope_id"])
        param = row["param_name"]
        value = row["param_value"]
        if scope == "dev":
            result["dev"].setdefault(scope_id, {})[param] = value
        elif scope == "ent_group":
            result["ent_group"][param] = value
        elif scope == "instrument":
            result["instrument"].setdefault(scope_id, {})[param] = value
    return result



def _write_aggregated_results(conn, scenario_id: int, ledger_rows: list):
    """Write aggregated ledger rows to sim_scenario_results."""
    conn.execute(
        "DELETE FROM sim_scenario_results WHERE scenario_id = %s", (scenario_id,)
    )
    if not ledger_rows:
        return

    rows = []
    for r in ledger_rows:
        rows.append((
            scenario_id,
            r["dev_id"],
            r["calendar_month"],
            r.get("ent_plan", 0),
            r.get("dev_plan", 0),
            r.get("td_plan", 0),
            r.get("str_plan", 0),
            r.get("str_plan_spec", 0),
            r.get("str_plan_build", 0),
            r.get("cmp_plan", 0),
            r.get("cls_plan", 0),
            r.get("p_end", 0),
            r.get("e_end", 0),
            r.get("d_end", 0),
            r.get("h_end", 0),
            r.get("u_end", 0),
            r.get("uc_end", 0),
            r.get("c_end", 0),
            r.get("closed_cumulative", 0),
        ))

    conn.execute_values(
        """
        INSERT INTO sim_scenario_results (
            scenario_id, dev_id, calendar_month,
            ent_plan, dev_plan, td_plan, str_plan, str_plan_spec, str_plan_build,
            cmp_plan, cls_plan,
            p_end, e_end, d_end, h_end, u_end, uc_end, c_end, closed_cumulative
        ) VALUES %s
        """,
        rows,
    )
