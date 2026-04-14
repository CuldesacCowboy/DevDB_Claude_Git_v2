-- 048_exclude_lots_from_ledger_view.sql
-- Recreate v_sim_ledger_monthly to exclude lots flagged as excluded=true.
-- Previously excluded lots were counted in all state buckets (p/e/d/h/u/uc/c)
-- causing a permanent floor equal to the excluded lot count (e.g. 24 excluded
-- 43 North ph.1 lots produced a floor of 24 in d_end on the pipeline chart).
--
-- NOTE: Do NOT use a subquery (SELECT * FROM sim_lots WHERE excluded IS NOT TRUE)
-- as the FROM source. Postgres inlines SELECT * subqueries during view storage and
-- silently drops the WHERE clause. Use an explicit WHERE clause on the outer query.

CREATE OR REPLACE VIEW devdb.v_sim_ledger_monthly AS
SELECT
    l.dev_id,
    COALESCE(l.builder_id_override, l.builder_id) AS builder_id,
    m.calendar_month,
    count(
        CASE
            WHEN date_trunc('MONTH'::text, l.date_ent::timestamp with time zone) = m.calendar_month THEN 1
            ELSE NULL::integer
        END) AS ent_plan,
    count(
        CASE
            WHEN date_trunc('MONTH'::text, l.date_dev::timestamp with time zone) = m.calendar_month THEN 1
            ELSE NULL::integer
        END) AS dev_plan,
    count(
        CASE
            WHEN date_trunc('MONTH'::text, l.date_td::timestamp with time zone) = m.calendar_month THEN 1
            ELSE NULL::integer
        END) AS td_plan,
    count(
        CASE
            WHEN date_trunc('MONTH'::text, COALESCE(l.date_str, l.date_str_projected)::timestamp with time zone) = m.calendar_month THEN 1
            ELSE NULL::integer
        END) AS str_plan,
    count(
        CASE
            WHEN date_trunc('MONTH'::text, COALESCE(l.date_cmp, l.date_cmp_projected)::timestamp with time zone) = m.calendar_month THEN 1
            ELSE NULL::integer
        END) AS cmp_plan,
    count(
        CASE
            WHEN date_trunc('MONTH'::text, COALESCE(l.date_cls, l.date_cls_projected)::timestamp with time zone) = m.calendar_month THEN 1
            ELSE NULL::integer
        END) AS cls_plan,
    count(
        CASE
            WHEN (l.date_ent IS NULL OR date_trunc('MONTH'::text, l.date_ent::timestamp with time zone)::date > m.calendar_month)
             AND (l.date_dev IS NULL OR date_trunc('MONTH'::text, l.date_dev::timestamp with time zone)::date > m.calendar_month)
             AND (l.date_td_hold IS NULL OR date_trunc('MONTH'::text, l.date_td_hold::timestamp with time zone)::date > m.calendar_month)
             AND (l.date_td IS NULL OR date_trunc('MONTH'::text, l.date_td::timestamp with time zone)::date > m.calendar_month)
             AND (COALESCE(l.date_str, l.date_str_projected) IS NULL OR date_trunc('MONTH'::text, COALESCE(l.date_str, l.date_str_projected)::timestamp with time zone)::date > m.calendar_month)
             AND (COALESCE(l.date_cmp, l.date_cmp_projected) IS NULL OR date_trunc('MONTH'::text, COALESCE(l.date_cmp, l.date_cmp_projected)::timestamp with time zone)::date > m.calendar_month)
             AND (COALESCE(l.date_cls, l.date_cls_projected) IS NULL OR date_trunc('MONTH'::text, COALESCE(l.date_cls, l.date_cls_projected)::timestamp with time zone)::date > m.calendar_month)
            THEN 1
            ELSE NULL::integer
        END) AS p_end,
    count(
        CASE
            WHEN date_trunc('MONTH'::text, l.date_ent::timestamp with time zone)::date <= m.calendar_month
             AND (l.date_dev IS NULL OR date_trunc('MONTH'::text, l.date_dev::timestamp with time zone)::date > m.calendar_month)
             AND (COALESCE(l.date_str, l.date_str_projected) IS NULL OR date_trunc('MONTH'::text, COALESCE(l.date_str, l.date_str_projected)::timestamp with time zone)::date > m.calendar_month)
            THEN 1
            ELSE NULL::integer
        END) AS e_end,
    count(
        CASE
            WHEN date_trunc('MONTH'::text, l.date_dev::timestamp with time zone)::date <= m.calendar_month
             AND (l.date_td IS NULL OR date_trunc('MONTH'::text, l.date_td::timestamp with time zone)::date > m.calendar_month)
             AND (l.date_td_hold IS NULL OR date_trunc('MONTH'::text, l.date_td_hold::timestamp with time zone)::date > m.calendar_month)
             AND (COALESCE(l.date_str, l.date_str_projected) IS NULL OR date_trunc('MONTH'::text, COALESCE(l.date_str, l.date_str_projected)::timestamp with time zone)::date > m.calendar_month)
            THEN 1
            ELSE NULL::integer
        END) AS d_end,
    count(
        CASE
            WHEN date_trunc('MONTH'::text, l.date_td_hold::timestamp with time zone)::date <= m.calendar_month
             AND l.date_td IS NULL
             AND (COALESCE(l.date_str, l.date_str_projected) IS NULL OR date_trunc('MONTH'::text, COALESCE(l.date_str, l.date_str_projected)::timestamp with time zone)::date > m.calendar_month)
            THEN 1
            ELSE NULL::integer
        END) AS h_end,
    count(
        CASE
            WHEN date_trunc('MONTH'::text, l.date_td::timestamp with time zone)::date <= m.calendar_month
             AND (COALESCE(l.date_str, l.date_str_projected) IS NULL OR date_trunc('MONTH'::text, COALESCE(l.date_str, l.date_str_projected)::timestamp with time zone)::date > m.calendar_month)
            THEN 1
            ELSE NULL::integer
        END) AS u_end,
    count(
        CASE
            WHEN date_trunc('MONTH'::text, COALESCE(l.date_str, l.date_str_projected)::timestamp with time zone)::date <= m.calendar_month
             AND (COALESCE(l.date_cmp, l.date_cmp_projected) IS NULL OR date_trunc('MONTH'::text, COALESCE(l.date_cmp, l.date_cmp_projected)::timestamp with time zone)::date > m.calendar_month)
             AND (COALESCE(l.date_cls, l.date_cls_projected) IS NULL OR date_trunc('MONTH'::text, COALESCE(l.date_cls, l.date_cls_projected)::timestamp with time zone)::date > m.calendar_month)
            THEN 1
            ELSE NULL::integer
        END) AS uc_end,
    count(
        CASE
            WHEN date_trunc('MONTH'::text, COALESCE(l.date_cmp, l.date_cmp_projected)::timestamp with time zone)::date <= m.calendar_month
             AND (COALESCE(l.date_cls, l.date_cls_projected) IS NULL OR date_trunc('MONTH'::text, COALESCE(l.date_cls, l.date_cls_projected)::timestamp with time zone)::date > m.calendar_month)
            THEN 1
            ELSE NULL::integer
        END) AS c_end,
    sum(count(
        CASE
            WHEN date_trunc('MONTH'::text, COALESCE(l.date_cls, l.date_cls_projected)::timestamp with time zone) = m.calendar_month THEN 1
            ELSE NULL::integer
        END)) OVER (PARTITION BY l.dev_id, (COALESCE(l.builder_id_override, l.builder_id))
                    ORDER BY m.calendar_month
                    ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS closed_cumulative
FROM devdb.sim_lots l
CROSS JOIN devdb.month_spine m
WHERE l.excluded IS NOT TRUE
GROUP BY (COALESCE(l.builder_id_override, l.builder_id)), l.dev_id, m.calendar_month;
