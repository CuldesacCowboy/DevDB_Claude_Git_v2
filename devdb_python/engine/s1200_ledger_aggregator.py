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
    conn.execute("""
        CREATE OR REPLACE VIEW month_spine AS
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
        CREATE OR REPLACE VIEW v_sim_ledger_monthly AS
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
        GROUP BY COALESCE(l.builder_id_override, l.builder_id), l.dev_id, m.calendar_month
    """)

    print("S-12: v_sim_ledger_monthly and month_spine views created.")
