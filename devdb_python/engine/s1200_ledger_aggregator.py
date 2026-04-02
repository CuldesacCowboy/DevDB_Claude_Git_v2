# s12_ledger_aggregator.py
# S-12: Aggregate lot-level dates into the monthly ledger view.
#
# Owns:     Creating v_sim_ledger_monthly and month_spine views.
# Not Own:  Any modification to sim_lots or any other table.
# Inputs:   conn (reads sim_lots via the view definition).
# Outputs:  v_sim_ledger_monthly view recreated (grouped by dev_id, builder_id).
# Failure:  Read-only view definition. If CREATE fails, surface error.
#           Never return partial or misleading counts.
# Bucket logic per D-006: highest reached milestone determines status.
# Buckets are mutually exclusive. P_end requires all milestone dates null/future.

from .connection import DBConnection


def ledger_aggregator(conn: DBConnection) -> None:
    """
    Create or replace v_sim_ledger_monthly and month_spine views.
    month_spine: dynamic view from earliest date_ent in sim_lots, 30 years forward.
    v_sim_ledger_monthly: COUNT-based aggregation per dev_id, builder_id, and calendar month.
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
            l.dev_id,
            l.builder_id,
            m.calendar_month,

            COUNT(CASE WHEN DATE_TRUNC('MONTH', l.date_ent) = m.calendar_month
                       THEN 1 END) AS ent_plan,
            COUNT(CASE WHEN DATE_TRUNC('MONTH', l.date_dev) = m.calendar_month
                       THEN 1 END) AS dev_plan,
            COUNT(CASE WHEN DATE_TRUNC('MONTH', l.date_td)  = m.calendar_month
                       THEN 1 END) AS td_plan,
            COUNT(CASE WHEN DATE_TRUNC('MONTH', COALESCE(l.date_str, l.date_str_projected)) = m.calendar_month
                       THEN 1 END) AS str_plan,
            COUNT(CASE WHEN DATE_TRUNC('MONTH', COALESCE(l.date_cmp, l.date_cmp_projected)) = m.calendar_month
                       THEN 1 END) AS cmp_plan,
            COUNT(CASE WHEN DATE_TRUNC('MONTH', COALESCE(l.date_cls, l.date_cls_projected)) = m.calendar_month
                       THEN 1 END) AS cls_plan,

            COUNT(CASE WHEN l.date_ent             IS NULL
                            AND l.date_dev         IS NULL
                            AND l.date_td          IS NULL
                            AND l.date_td_hold     IS NULL
                            AND l.date_str         IS NULL
                            AND l.date_cmp         IS NULL
                            AND l.date_cls         IS NULL
                            AND l.date_str_projected IS NULL
                            AND l.date_cmp_projected IS NULL
                            AND l.date_cls_projected IS NULL
                       THEN 1 END) AS p_end,
            COUNT(CASE WHEN l.date_ent <= m.calendar_month
                            AND (l.date_dev IS NULL OR l.date_dev > m.calendar_month)
                       THEN 1 END) AS e_end,
            COUNT(CASE WHEN l.date_dev <= m.calendar_month
                            AND (l.date_td IS NULL OR l.date_td > m.calendar_month)
                            AND (l.date_td_hold IS NULL OR l.date_td_hold > m.calendar_month)
                       THEN 1 END) AS d_end,
            COUNT(CASE WHEN l.date_td_hold <= m.calendar_month
                            AND l.date_td IS NULL
                            AND (COALESCE(l.date_str, l.date_str_projected) IS NULL
                                 OR COALESCE(l.date_str, l.date_str_projected) > m.calendar_month)
                       THEN 1 END) AS h_end,
            COUNT(CASE WHEN l.date_td <= m.calendar_month
                            AND (COALESCE(l.date_str, l.date_str_projected) IS NULL
                                 OR COALESCE(l.date_str, l.date_str_projected) > m.calendar_month)
                       THEN 1 END) AS u_end,
            COUNT(CASE WHEN COALESCE(l.date_str, l.date_str_projected) <= m.calendar_month
                            AND (COALESCE(l.date_cmp, l.date_cmp_projected) IS NULL
                                 OR COALESCE(l.date_cmp, l.date_cmp_projected) > m.calendar_month)
                       THEN 1 END) AS uc_end,
            COUNT(CASE WHEN COALESCE(l.date_cmp, l.date_cmp_projected) <= m.calendar_month
                            AND (COALESCE(l.date_cls, l.date_cls_projected) IS NULL
                                 OR COALESCE(l.date_cls, l.date_cls_projected) > m.calendar_month)
                       THEN 1 END) AS c_end,

            SUM(COUNT(CASE WHEN DATE_TRUNC('MONTH', COALESCE(l.date_cls, l.date_cls_projected)) = m.calendar_month
                           THEN 1 END))
                OVER (PARTITION BY l.dev_id, l.builder_id
                      ORDER BY m.calendar_month
                      ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW)
                AS closed_cumulative

        FROM sim_lots l
        CROSS JOIN month_spine m
        GROUP BY l.dev_id, l.builder_id, m.calendar_month
    """)

    print("S-12: v_sim_ledger_monthly and month_spine views created.")
