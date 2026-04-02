# s12_ledger_aggregator.py
# S-12: Aggregate lot-level dates into the monthly ledger view.
#
# Owns:     Creating v_sim_ledger_monthly and month_spine views.
# Not Own:  Any modification to sim_lots or any other table.
# Inputs:   conn (reads sim_lots via the view definition).
# Outputs:  v_sim_ledger_monthly and month_spine views recreated in Databricks.
# Failure:  Read-only view definition. If CREATE fails, surface error.
#           Never return partial or misleading counts.
# Bucket logic per D-006: highest reached milestone determines status.
# Buckets are mutually exclusive. P_end requires all milestone dates null/future.

from .connection import DBConnection


def ledger_aggregator(conn: DBConnection) -> None:
    """
    Create or replace v_sim_ledger_monthly and month_spine views.
    month_spine: dynamic view from earliest date_ent in sim_lots, 30 years forward.
    v_sim_ledger_monthly: COUNT-based aggregation per projection_group_id,
    builder_id, and calendar month.
    Read-only -- does not modify any table.
    """
    conn.execute("""
        CREATE OR REPLACE VIEW month_spine AS
        WITH bounds AS (
            SELECT GREATEST(
                '2020-01-01'::DATE,
                COALESCE(
                    MIN(LEAST(date_str, date_cmp, date_cls, date_dev)),
                    '2020-01-01'::DATE
                )
            ) AS spine_start
            FROM sim_lots
            WHERE lot_source = 'real'
        )
        SELECT generate_series(
            DATE_TRUNC('MONTH', spine_start)::DATE,
            '2046-01-01'::DATE,
            INTERVAL '1 month'
        )::DATE AS calendar_month
        FROM bounds
    """)

    conn.execute("""
        CREATE OR REPLACE VIEW v_sim_ledger_monthly AS
        SELECT
            l.projection_group_id,
            l.builder_id,
            m.calendar_month,

            COUNT(CASE WHEN DATE_TRUNC('MONTH', l.date_ent) = m.calendar_month
                       THEN 1 END) AS ENT_plan,
            COUNT(CASE WHEN DATE_TRUNC('MONTH', l.date_dev) = m.calendar_month
                       THEN 1 END) AS DEV_plan,
            COUNT(CASE WHEN DATE_TRUNC('MONTH', l.date_td)  = m.calendar_month
                       THEN 1 END) AS TD_plan,
            COUNT(CASE WHEN DATE_TRUNC('MONTH', l.date_str) = m.calendar_month
                       THEN 1 END) AS STR_plan,
            COUNT(CASE WHEN DATE_TRUNC('MONTH', l.date_cmp) = m.calendar_month
                       THEN 1 END) AS CMP_plan,
            COUNT(CASE WHEN DATE_TRUNC('MONTH', l.date_cls) = m.calendar_month
                       THEN 1 END) AS CLS_plan,

            COUNT(CASE WHEN l.date_ent      IS NULL
                            AND l.date_dev  IS NULL
                            AND l.date_td      IS NULL
                            AND l.date_td_hold IS NULL
                            AND l.date_str  IS NULL
                            AND l.date_cmp  IS NULL
                            AND l.date_cls  IS NULL
                       THEN 1 END) AS P_end,
            COUNT(CASE WHEN l.date_ent <= m.calendar_month
                            AND (l.date_dev IS NULL OR l.date_dev > m.calendar_month)
                       THEN 1 END) AS E_end,
            COUNT(CASE WHEN l.date_dev <= m.calendar_month
                            AND (l.date_td IS NULL OR l.date_td > m.calendar_month)
                            AND (l.date_td_hold IS NULL OR l.date_td_hold > m.calendar_month)
                       THEN 1 END) AS D_end,
            COUNT(CASE WHEN l.date_td_hold <= m.calendar_month
                            AND l.date_td IS NULL
                            AND (l.date_str IS NULL OR l.date_str > m.calendar_month)
                       THEN 1 END) AS H_end,
            COUNT(CASE WHEN l.date_td <= m.calendar_month
                            AND (l.date_str IS NULL OR l.date_str > m.calendar_month)
                       THEN 1 END) AS U_end,
            COUNT(CASE WHEN l.date_str <= m.calendar_month
                            AND (l.date_cmp IS NULL OR l.date_cmp > m.calendar_month)
                       THEN 1 END) AS UC_end,
            COUNT(CASE WHEN l.date_cmp <= m.calendar_month
                            AND (l.date_cls IS NULL OR l.date_cls > m.calendar_month)
                       THEN 1 END) AS C_end,

            SUM(COUNT(CASE WHEN DATE_TRUNC('MONTH', l.date_cls) = m.calendar_month
                           THEN 1 END))
                OVER (PARTITION BY l.projection_group_id, l.builder_id
                      ORDER BY m.calendar_month
                      ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW)
                AS closed_cumulative

        FROM sim_lots l
        CROSS JOIN month_spine m
        GROUP BY l.projection_group_id, l.builder_id, m.calendar_month
    """)

    conn.execute("""
        CREATE OR REPLACE VIEW v_sim_ledger_monthly_by_dev AS
        WITH base AS (
            SELECT
                d.dev_id,
                d.dev_name,
                v.calendar_month,
                SUM(v.ent_plan)  AS ent_plan,
                SUM(v.dev_plan)  AS dev_plan,
                SUM(v.td_plan)   AS td_plan,
                SUM(v.str_plan)  AS str_plan,
                SUM(v.cmp_plan)  AS cmp_plan,
                SUM(v.cls_plan)  AS cls_plan,
                SUM(v.p_end)     AS p_end,
                SUM(v.e_end)     AS e_end,
                SUM(v.d_end)     AS d_end,
                SUM(v.h_end)     AS h_end,
                SUM(v.u_end)     AS u_end,
                SUM(v.uc_end)    AS uc_end,
                SUM(v.c_end)     AS c_end
            FROM v_sim_ledger_monthly v
            JOIN dim_projection_groups dpg ON v.projection_group_id = dpg.projection_group_id
            JOIN developments d ON dpg.dev_id = d.dev_id
            GROUP BY d.dev_id, d.dev_name, v.calendar_month
        )
        SELECT
            dev_id,
            dev_name,
            calendar_month,
            ent_plan, dev_plan, td_plan, str_plan, cmp_plan, cls_plan,
            p_end, e_end, d_end, h_end, u_end, uc_end, c_end,
            SUM(cls_plan) OVER (
                PARTITION BY dev_id
                ORDER BY calendar_month
                ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
            ) AS closed_cumulative
        FROM base
    """)

    print("S-12: v_sim_ledger_monthly, v_sim_ledger_monthly_by_dev, and month_spine views created.")
