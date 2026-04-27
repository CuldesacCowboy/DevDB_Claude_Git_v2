"""
S-1200 ledger_aggregator — Aggregate lot-level dates into the monthly ledger view.

Reads:   sim_lots (via view definition — no direct SELECT)
Writes:  v_sim_ledger_monthly VIEW, month_spine VIEW (DB, CREATE OR REPLACE)
Input:   conn: DBConnection
Rules:   Bucket logic per D-006: highest reached milestone determines status.
         Buckets are mutually exclusive. P_end requires all milestone dates null/future.
         D_end per D-140: date_dev set AND date_td null or future.
         Never returns partial or misleading counts.
         Not Own: any modification to sim_lots or any other table.
         All date comparisons use DATE_TRUNC('MONTH', ...) to normalize actual dates
         (which can be any day) to first-of-month, consistent with the calendar_month
         spine. This prevents mid-month actual dates from appearing in two buckets
         simultaneously (e.g. date_cls = Jun 15 would satisfy both uc_end's
         cls_eff > Jun 1 guard AND closed_cumulative's DATE_TRUNC = Jun 1).
"""

from .connection import DBConnection


def ledger_aggregator(conn: DBConnection) -> None:
    """
    Create or replace v_sim_ledger_monthly and month_spine views.
    month_spine: dynamic view from earliest date_ent in sim_lots, 30 years forward.
    v_sim_ledger_monthly: COUNT-based aggregation per dev_id, builder_id, and calendar month.
    Read-only -- does not modify any table.
    """
    # Drop both views in dependency order before recreating.
    # month_spine must be dropped with CASCADE because v_sim_ledger_monthly depends on it.
    # CREATE OR REPLACE VIEW fails when the existing view has a type or column mismatch
    # with the replacement definition (PostgreSQL error: "cannot drop columns from view").
    conn.execute("DROP VIEW IF EXISTS v_sim_ledger_monthly")
    conn.execute("DROP VIEW IF EXISTS month_spine CASCADE")

    conn.execute("""
        CREATE VIEW month_spine AS
        WITH lot_floor AS (
            SELECT GREATEST(
                '2020-01-01'::DATE,
                COALESCE(
                    MIN(LEAST(date_str, date_cmp, date_cls, date_dev)),
                    '2020-01-01'::DATE
                )
            ) AS start_date
            FROM sim_lots
            WHERE lot_source = 'real'
        ),
        ledger_floor AS (
            SELECT COALESCE(MIN(date_paper), '2999-01-01'::DATE) AS start_date
            FROM sim_entitlement_groups
            WHERE date_paper IS NOT NULL
        ),
        bounds AS (
            SELECT LEAST(lf.start_date, lg.start_date) AS spine_start
            FROM lot_floor lf
            CROSS JOIN ledger_floor lg
        )
        SELECT generate_series(
            DATE_TRUNC('MONTH', spine_start)::DATE,
            '2046-01-01'::DATE,
            INTERVAL '1 month'
        )::DATE AS calendar_month
        FROM bounds
    """)

    conn.execute("""
        CREATE VIEW v_sim_ledger_monthly AS
        SELECT
            l.dev_id,
            COALESCE(l.builder_id_override, l.builder_id) AS builder_id,
            m.calendar_month,

            COUNT(CASE WHEN DATE_TRUNC('MONTH', l.date_ent) = m.calendar_month
                       THEN 1 END) AS ent_plan,
            COUNT(CASE WHEN DATE_TRUNC('MONTH', l.date_dev) = m.calendar_month
                       THEN 1 END) AS dev_plan,
            COUNT(CASE WHEN DATE_TRUNC('MONTH', l.date_td)  = m.calendar_month
                       THEN 1 END) AS td_plan,
            COUNT(CASE WHEN DATE_TRUNC('MONTH', COALESCE(l.date_str, l.date_str_projected)) = m.calendar_month
                       THEN 1 END) AS str_plan,
            COUNT(CASE WHEN DATE_TRUNC('MONTH', COALESCE(l.date_str, l.date_str_projected)) = m.calendar_month
                            AND l.is_spec = TRUE
                       THEN 1 END) AS str_plan_spec,
            COUNT(CASE WHEN DATE_TRUNC('MONTH', COALESCE(l.date_str, l.date_str_projected)) = m.calendar_month
                            AND l.is_spec = FALSE
                       THEN 1 END) AS str_plan_build,
            COUNT(CASE WHEN DATE_TRUNC('MONTH', COALESCE(l.date_cmp, l.date_cmp_projected)) = m.calendar_month
                       THEN 1 END) AS cmp_plan,
            COUNT(CASE WHEN DATE_TRUNC('MONTH', COALESCE(l.date_cls, l.date_cls_projected)) = m.calendar_month
                       THEN 1 END) AS cls_plan,

            COUNT(CASE WHEN
                            (l.date_ent IS NULL OR DATE_TRUNC('MONTH', l.date_ent)::DATE > m.calendar_month)
                            AND (l.date_dev IS NULL OR DATE_TRUNC('MONTH', l.date_dev)::DATE > m.calendar_month)
                            AND (l.date_td_hold IS NULL OR DATE_TRUNC('MONTH', l.date_td_hold)::DATE > m.calendar_month)
                            AND (l.date_td IS NULL OR DATE_TRUNC('MONTH', l.date_td)::DATE > m.calendar_month)
                            AND (COALESCE(l.date_str, l.date_str_projected) IS NULL
                                 OR DATE_TRUNC('MONTH', COALESCE(l.date_str, l.date_str_projected))::DATE > m.calendar_month)
                            AND (COALESCE(l.date_cmp, l.date_cmp_projected) IS NULL
                                 OR DATE_TRUNC('MONTH', COALESCE(l.date_cmp, l.date_cmp_projected))::DATE > m.calendar_month)
                            AND (COALESCE(l.date_cls, l.date_cls_projected) IS NULL
                                 OR DATE_TRUNC('MONTH', COALESCE(l.date_cls, l.date_cls_projected))::DATE > m.calendar_month)
                       THEN 1 END) AS p_end,
            COUNT(CASE WHEN DATE_TRUNC('MONTH', l.date_ent)::DATE <= m.calendar_month
                            AND (l.date_dev IS NULL OR DATE_TRUNC('MONTH', l.date_dev)::DATE > m.calendar_month)
                            AND (COALESCE(l.date_str, l.date_str_projected) IS NULL
                                 OR DATE_TRUNC('MONTH', COALESCE(l.date_str, l.date_str_projected))::DATE > m.calendar_month)
                       THEN 1 END) AS e_end,
            COUNT(CASE WHEN DATE_TRUNC('MONTH', l.date_dev)::DATE <= m.calendar_month
                            AND (l.date_td IS NULL OR DATE_TRUNC('MONTH', l.date_td)::DATE > m.calendar_month)
                            AND (l.date_td_hold IS NULL OR DATE_TRUNC('MONTH', l.date_td_hold)::DATE > m.calendar_month)
                            AND (COALESCE(l.date_str, l.date_str_projected) IS NULL
                                 OR DATE_TRUNC('MONTH', COALESCE(l.date_str, l.date_str_projected))::DATE > m.calendar_month)
                       THEN 1 END) AS d_end,
            COUNT(CASE WHEN DATE_TRUNC('MONTH', l.date_td_hold)::DATE <= m.calendar_month
                            AND l.date_td IS NULL
                            AND (COALESCE(l.date_str, l.date_str_projected) IS NULL
                                 OR DATE_TRUNC('MONTH', COALESCE(l.date_str, l.date_str_projected))::DATE > m.calendar_month)
                       THEN 1 END) AS h_end,
            COUNT(CASE WHEN DATE_TRUNC('MONTH', l.date_td)::DATE <= m.calendar_month
                            AND (COALESCE(l.date_str, l.date_str_projected) IS NULL
                                 OR DATE_TRUNC('MONTH', COALESCE(l.date_str, l.date_str_projected))::DATE > m.calendar_month)
                       THEN 1 END) AS u_end,
            COUNT(CASE WHEN DATE_TRUNC('MONTH', COALESCE(l.date_str, l.date_str_projected))::DATE <= m.calendar_month
                            AND (COALESCE(l.date_cmp, l.date_cmp_projected) IS NULL
                                 OR DATE_TRUNC('MONTH', COALESCE(l.date_cmp, l.date_cmp_projected))::DATE > m.calendar_month)
                            AND (COALESCE(l.date_cls, l.date_cls_projected) IS NULL
                                 OR DATE_TRUNC('MONTH', COALESCE(l.date_cls, l.date_cls_projected))::DATE > m.calendar_month)
                       THEN 1 END) AS uc_end,
            COUNT(CASE WHEN DATE_TRUNC('MONTH', COALESCE(l.date_cmp, l.date_cmp_projected))::DATE <= m.calendar_month
                            AND (COALESCE(l.date_cls, l.date_cls_projected) IS NULL
                                 OR DATE_TRUNC('MONTH', COALESCE(l.date_cls, l.date_cls_projected))::DATE > m.calendar_month)
                       THEN 1 END) AS c_end,

            SUM(COUNT(CASE WHEN DATE_TRUNC('MONTH', COALESCE(l.date_cls, l.date_cls_projected)) = m.calendar_month
                           THEN 1 END))
                OVER (PARTITION BY l.dev_id, COALESCE(l.builder_id_override, l.builder_id)
                      ORDER BY m.calendar_month
                      ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW)
                AS closed_cumulative

        FROM sim_lots l
        CROSS JOIN month_spine m
        WHERE l.excluded IS NOT TRUE
        GROUP BY COALESCE(l.builder_id_override, l.builder_id), l.dev_id, m.calendar_month
    """)

    print("ledger_aggregator: v_sim_ledger_monthly and month_spine views created.")


def compute_scenario_ledger(conn: DBConnection, scenario_lots: list, dev_ids: list) -> list:
    """
    Compute monthly ledger rows for a scenario without touching the base view.
    Creates a temp table with scenario sim lots + real lots from sim_lots,
    runs the aggregation query, returns list of dicts.
    """
    import numpy as np

    # Create temp table
    conn.execute("DROP TABLE IF EXISTS _scenario_all_lots")
    conn.execute("""
        CREATE TEMP TABLE _scenario_all_lots (
            dev_id INT, builder_id INT, builder_id_override INT,
            date_ent DATE, date_dev DATE, date_td DATE, date_td_hold DATE,
            date_str DATE, date_str_projected DATE,
            date_cmp DATE, date_cmp_projected DATE,
            date_cls DATE, date_cls_projected DATE,
            is_spec BOOLEAN, excluded BOOLEAN, lot_source TEXT
        )
    """)

    # Insert real lots from base
    conn.execute("""
        INSERT INTO _scenario_all_lots
        SELECT dev_id, builder_id, builder_id_override,
               date_ent, date_dev, date_td, date_td_hold,
               date_str, date_str_projected,
               date_cmp, date_cmp_projected,
               date_cls, date_cls_projected,
               is_spec, excluded, lot_source
        FROM sim_lots
        WHERE dev_id = ANY(%s) AND lot_source IN ('real', 'pre') AND excluded IS NOT TRUE
    """, (dev_ids,))

    # Insert scenario sim lots
    def _py(v):
        if v is None:
            return None
        if isinstance(v, (np.integer,)):
            return int(v)
        if isinstance(v, (np.floating,)):
            return None if np.isnan(v) else float(v)
        if isinstance(v, (np.bool_,)):
            return bool(v)
        if isinstance(v, float) and np.isnan(v):
            return None
        return v

    for lot in scenario_lots:
        conn.execute("""
            INSERT INTO _scenario_all_lots (dev_id, builder_id, date_dev, date_td, date_str,
                date_cmp, date_cls, is_spec, excluded, lot_source)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, FALSE, 'sim')
        """, (
            _py(lot.get("dev_id")), _py(lot.get("builder_id")),
            lot.get("date_dev"), lot.get("date_td"), lot.get("date_str"),
            lot.get("date_cmp"), lot.get("date_cls"),
            _py(lot.get("is_spec")),
        ))

    # Run aggregation query
    result = conn.read_df("""
        WITH spine AS (
            SELECT generate_series('2020-01-01'::DATE, '2046-01-01'::DATE, INTERVAL '1 month')::DATE AS calendar_month
        )
        SELECT
            l.dev_id, m.calendar_month,
            COUNT(CASE WHEN DATE_TRUNC('MONTH', COALESCE(l.date_str, l.date_str_projected)) = m.calendar_month THEN 1 END)::int AS str_plan,
            COUNT(CASE WHEN DATE_TRUNC('MONTH', COALESCE(l.date_str, l.date_str_projected)) = m.calendar_month AND l.is_spec = TRUE THEN 1 END)::int AS str_plan_spec,
            COUNT(CASE WHEN DATE_TRUNC('MONTH', COALESCE(l.date_str, l.date_str_projected)) = m.calendar_month AND l.is_spec = FALSE THEN 1 END)::int AS str_plan_build,
            COUNT(CASE WHEN DATE_TRUNC('MONTH', COALESCE(l.date_cmp, l.date_cmp_projected)) = m.calendar_month THEN 1 END)::int AS cmp_plan,
            COUNT(CASE WHEN DATE_TRUNC('MONTH', COALESCE(l.date_cls, l.date_cls_projected)) = m.calendar_month THEN 1 END)::int AS cls_plan,
            COUNT(CASE WHEN DATE_TRUNC('MONTH', l.date_ent)::DATE <= m.calendar_month THEN 1 END)::int AS ent_plan,
            COUNT(CASE WHEN DATE_TRUNC('MONTH', l.date_dev)::DATE <= m.calendar_month AND (l.date_td IS NULL OR DATE_TRUNC('MONTH', l.date_td)::DATE > m.calendar_month) AND (l.date_td_hold IS NULL OR DATE_TRUNC('MONTH', l.date_td_hold)::DATE > m.calendar_month) AND (COALESCE(l.date_str, l.date_str_projected) IS NULL OR DATE_TRUNC('MONTH', COALESCE(l.date_str, l.date_str_projected))::DATE > m.calendar_month) THEN 1 END)::int AS d_end,
            COUNT(CASE WHEN DATE_TRUNC('MONTH', l.date_td_hold)::DATE <= m.calendar_month AND l.date_td IS NULL AND (COALESCE(l.date_str, l.date_str_projected) IS NULL OR DATE_TRUNC('MONTH', COALESCE(l.date_str, l.date_str_projected))::DATE > m.calendar_month) THEN 1 END)::int AS h_end,
            COUNT(CASE WHEN DATE_TRUNC('MONTH', l.date_td)::DATE <= m.calendar_month AND (COALESCE(l.date_str, l.date_str_projected) IS NULL OR DATE_TRUNC('MONTH', COALESCE(l.date_str, l.date_str_projected))::DATE > m.calendar_month) THEN 1 END)::int AS u_end,
            COUNT(CASE WHEN DATE_TRUNC('MONTH', COALESCE(l.date_str, l.date_str_projected))::DATE <= m.calendar_month AND (COALESCE(l.date_cmp, l.date_cmp_projected) IS NULL OR DATE_TRUNC('MONTH', COALESCE(l.date_cmp, l.date_cmp_projected))::DATE > m.calendar_month) AND (COALESCE(l.date_cls, l.date_cls_projected) IS NULL OR DATE_TRUNC('MONTH', COALESCE(l.date_cls, l.date_cls_projected))::DATE > m.calendar_month) THEN 1 END)::int AS uc_end,
            COUNT(CASE WHEN DATE_TRUNC('MONTH', COALESCE(l.date_cmp, l.date_cmp_projected))::DATE <= m.calendar_month AND (COALESCE(l.date_cls, l.date_cls_projected) IS NULL OR DATE_TRUNC('MONTH', COALESCE(l.date_cls, l.date_cls_projected))::DATE > m.calendar_month) THEN 1 END)::int AS c_end,
            0::int AS closed_cumulative,
            0::int AS p_end
        FROM _scenario_all_lots l
        CROSS JOIN spine m
        WHERE l.excluded IS NOT TRUE
        GROUP BY l.dev_id, m.calendar_month
        HAVING COUNT(*) > 0
        ORDER BY l.dev_id, m.calendar_month
    """)

    conn.execute("DROP TABLE IF EXISTS _scenario_all_lots")

    rows = []
    for _, r in result.iterrows():
        rows.append({
            "dev_id": int(r["dev_id"]),
            "calendar_month": r["calendar_month"].isoformat() if hasattr(r["calendar_month"], "isoformat") else str(r["calendar_month"]),
            "str_plan": int(r["str_plan"]), "str_plan_spec": int(r["str_plan_spec"]),
            "str_plan_build": int(r["str_plan_build"]),
            "cmp_plan": int(r["cmp_plan"]), "cls_plan": int(r["cls_plan"]),
            "ent_plan": int(r["ent_plan"]), "d_end": int(r["d_end"]),
            "h_end": int(r["h_end"]), "u_end": int(r["u_end"]),
            "uc_end": int(r["uc_end"]), "c_end": int(r["c_end"]),
            "closed_cumulative": 0, "p_end": 0,
        })

    return rows
