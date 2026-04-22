# services/ledger_service.py
# Ledger query functions extracted from routers/ledger.py.
# These live in the service layer so they can be tested without the HTTP layer
# and reused if ledger data is needed from other contexts.

from api.db import dict_cursor


def query_ledger_by_dev(conn, ent_group_id: int) -> list:
    """Return monthly ledger rows aggregated by development for an entitlement group.

    Uses a bounded date range (ledger_start_date → last projected activity) so
    the spine is continuous with no gaps. Also overlays entitlement events onto
    ent_plan and prepends a synthetic ledger_start_date row when needed.

    Returns an empty list if the group has no lot activity.
    """
    cur = dict_cursor(conn)
    try:
        # ── Compute date range bounds ──────────────────────────────────────────
        # Start: ledger_start_date on the group, else the earliest month in the spine
        # End: latest projected/actual activity across all lots in the group
        cur.execute(
            """
            SELECT
                eg.date_paper,
                eg.county_id          AS community_county_id,
                eg.school_district_id AS community_sd_id,
                comm_c.county_name    AS community_county_name,
                comm_sd.district_name AS community_sd_name,
                DATE_TRUNC('MONTH', MAX(GREATEST(
                    COALESCE(sl.date_cls, sl.date_cls_projected, '2000-01-01'::DATE),
                    COALESCE(sl.date_cmp, sl.date_cmp_projected, '2000-01-01'::DATE),
                    COALESCE(sl.date_str, sl.date_str_projected, '2000-01-01'::DATE),
                    COALESCE(sl.date_td,                         '2000-01-01'::DATE),
                    COALESCE(sl.date_dev,                        '2000-01-01'::DATE)
                )))::DATE AS max_activity_month
            FROM sim_entitlement_groups eg
            JOIN sim_ent_group_developments egd ON egd.ent_group_id = eg.ent_group_id
            LEFT JOIN sim_lots sl ON sl.dev_id = egd.dev_id AND sl.excluded IS NOT TRUE
            LEFT JOIN devdb.ref_counties comm_c ON comm_c.county_id = eg.county_id
            LEFT JOIN devdb.ref_school_districts comm_sd ON comm_sd.sd_id = eg.school_district_id
            WHERE eg.ent_group_id = %s
            GROUP BY eg.date_paper, eg.county_id, eg.school_district_id,
                     comm_c.county_name, comm_sd.district_name
            """,
            (ent_group_id,),
        )
        bounds = cur.fetchone()
        if not bounds or bounds["max_activity_month"] is None:
            return []

        ledger_start          = bounds["date_paper"]
        max_month             = bounds["max_activity_month"]
        community_county_id   = bounds["community_county_id"]
        community_county_name = bounds["community_county_name"]
        community_sd_id       = bounds["community_sd_id"]
        community_sd_name     = bounds["community_sd_name"]

        # Main ledger rows — bounded range, no activity filter
        cur.execute(
            """
            SELECT
                v.dev_id,
                d.dev_name,
                v.builder_id,
                v.calendar_month,
                v.ent_plan, v.dev_plan, v.td_plan,
                v.str_plan, v.str_plan_spec, v.str_plan_build,
                v.cmp_plan, v.cls_plan,
                v.p_end, v.e_end, v.d_end, v.h_end,
                v.u_end, v.uc_end, v.c_end,
                v.closed_cumulative,
                eg.county_id          AS community_county_id,
                eg.school_district_id AS community_sd_id,
                comm_c.county_name    AS community_county_name,
                comm_sd.district_name AS community_sd_name
            FROM v_sim_ledger_monthly v
            JOIN developments d ON d.dev_id = v.dev_id
            JOIN sim_ent_group_developments segd ON segd.dev_id = v.dev_id AND segd.ent_group_id = %s
            JOIN sim_entitlement_groups eg ON eg.ent_group_id = segd.ent_group_id
            LEFT JOIN devdb.ref_counties comm_c ON comm_c.county_id = eg.county_id
            LEFT JOIN devdb.ref_school_districts comm_sd ON comm_sd.sd_id = eg.school_district_id
            WHERE v.dev_id IN (
                SELECT dev_id FROM sim_ent_group_developments
                WHERE ent_group_id = %s
            )
              AND v.calendar_month <= %s
              AND (%s IS NULL OR v.calendar_month >= %s)
            ORDER BY d.dev_name, v.calendar_month
            """,
            (ent_group_id, ent_group_id, max_month, ledger_start, ledger_start),
        )
        rows = [_ledger_row(r) for r in cur.fetchall()]

        # ent_plan is now sourced entirely from date_ent on sim_lots via the DB view.
        # The sim_entitlement_events overlay was the old per-dev counting mechanism
        # and is no longer used — the group-level Entitlements Date writes date_ent
        # directly to every lot, so the DB view already counts correctly.

        # Synthetic date_paper row per dev (if that month isn't present)
        cur.execute(
            """
            SELECT eg.date_paper,
                   egd.dev_id,
                   d.dev_name,
                   COUNT(sl.lot_id)::int AS total_lots
            FROM sim_entitlement_groups eg
            JOIN sim_ent_group_developments egd ON egd.ent_group_id = eg.ent_group_id
            JOIN developments d ON d.dev_id = egd.dev_id
            LEFT JOIN sim_lots sl ON sl.dev_id = egd.dev_id AND sl.excluded IS NOT TRUE
            WHERE eg.ent_group_id = %s
              AND eg.date_paper IS NOT NULL
            GROUP BY eg.date_paper, egd.dev_id, d.dev_name
            """,
            (ent_group_id,),
        )
        for r in cur.fetchall():
            start_iso = r["date_paper"].isoformat()
            dev_months = {row["calendar_month"] for row in rows if row["dev_id"] == r["dev_id"]}
            if start_iso not in dev_months:
                rows.append({
                    "dev_id": r["dev_id"],
                    "dev_name": r["dev_name"],
                    "builder_id": None,
                    "calendar_month": start_iso,
                    "ent_plan": 0, "dev_plan": 0, "td_plan": 0,
                    "str_plan": 0, "str_plan_spec": 0, "str_plan_build": 0,
                    "cmp_plan": 0, "cls_plan": 0,
                    "p_end": r["total_lots"], "e_end": 0, "d_end": 0, "h_end": 0,
                    "u_end": 0, "uc_end": 0, "c_end": 0,
                    "closed_cumulative": None,
                    "community_county_id":   community_county_id,
                    "community_county_name": community_county_name,
                    "community_sd_id":       community_sd_id,
                    "community_sd_name":     community_sd_name,
                })

        rows.sort(key=lambda r: (r["dev_id"], r["calendar_month"]))
        return rows
    finally:
        cur.close()


def query_ledger_weekly(conn, ent_group_id: int) -> list:
    """Return weekly ledger rows for an entitlement group.

    Each row covers one ISO week (Mon–Sun).  Event counts reflect lots whose
    effective date falls within that week; status counts are snapshots at the
    week-end (Sunday).  Effective date = COALESCE(actual, projected) following
    the same logic as v_sim_ledger_monthly.
    """
    cur = dict_cursor(conn)
    try:
        # ── Compute date range bounds (same as monthly) ────────────────────
        cur.execute(
            """
            SELECT
                eg.date_paper,
                DATE_TRUNC('MONTH', MAX(GREATEST(
                    COALESCE(sl.date_cls, sl.date_cls_projected, '2000-01-01'::DATE),
                    COALESCE(sl.date_cmp, sl.date_cmp_projected, '2000-01-01'::DATE),
                    COALESCE(sl.date_str, sl.date_str_projected, '2000-01-01'::DATE),
                    COALESCE(sl.date_td,                         '2000-01-01'::DATE),
                    COALESCE(sl.date_dev,                        '2000-01-01'::DATE)
                )))::DATE AS max_activity_month
            FROM sim_entitlement_groups eg
            JOIN sim_ent_group_developments egd ON egd.ent_group_id = eg.ent_group_id
            LEFT JOIN sim_lots sl ON sl.dev_id = egd.dev_id AND sl.excluded IS NOT TRUE
            WHERE eg.ent_group_id = %s
            GROUP BY eg.date_paper
            """,
            (ent_group_id,),
        )
        bounds = cur.fetchone()
        if not bounds or bounds["max_activity_month"] is None or not bounds["date_paper"]:
            return []

        ledger_start = bounds["date_paper"]
        max_month    = bounds["max_activity_month"]

        cur.execute(
            """
            WITH bounds AS (
                -- week spine: Mon of ledger_start week through Mon of week containing
                -- the last day of max_activity_month (+ 1 week overshoot is fine)
                SELECT
                    DATE_TRUNC('week', %(start)s::date)::date AS spine_start,
                    DATE_TRUNC('week', %(max)s::date + INTERVAL '1 month')::date AS spine_end
            ),
            week_spine AS (
                SELECT generate_series(
                    (SELECT spine_start FROM bounds),
                    (SELECT spine_end   FROM bounds),
                    '7 days'::interval
                )::date AS week_start
            ),
            lots AS (
                SELECT
                    sl.dev_id,
                    COALESCE(sl.builder_id_override, sl.builder_id) AS builder_id,
                    sl.date_ent,
                    sl.date_dev,
                    sl.date_td_hold,
                    sl.date_td,
                    sl.is_spec,
                    COALESCE(sl.date_str, sl.date_str_projected) AS eff_str,
                    COALESCE(sl.date_cmp, sl.date_cmp_projected) AS eff_cmp,
                    COALESCE(sl.date_cls, sl.date_cls_projected) AS eff_cls
                FROM sim_lots sl
                JOIN sim_ent_group_developments segd ON segd.dev_id = sl.dev_id
                WHERE segd.ent_group_id = %(eg)s
                  AND sl.excluded IS NOT TRUE
            ),
            weekly AS (
                SELECT
                    ws.week_start,
                    l.dev_id,
                    l.builder_id,
                    -- Event counts: effective date falls within this Mon–Sun week
                    COUNT(*) FILTER (WHERE l.date_ent >= ws.week_start AND l.date_ent < ws.week_start + 7) AS ent_plan,
                    COUNT(*) FILTER (WHERE l.date_dev >= ws.week_start AND l.date_dev < ws.week_start + 7) AS dev_plan,
                    COUNT(*) FILTER (WHERE l.date_td  >= ws.week_start AND l.date_td  < ws.week_start + 7) AS td_plan,
                    COUNT(*) FILTER (WHERE l.eff_str  >= ws.week_start AND l.eff_str  < ws.week_start + 7) AS str_plan,
                    COUNT(*) FILTER (WHERE l.eff_str  >= ws.week_start AND l.eff_str  < ws.week_start + 7
                                      AND l.is_spec = TRUE)  AS str_plan_spec,
                    COUNT(*) FILTER (WHERE l.eff_str  >= ws.week_start AND l.eff_str  < ws.week_start + 7
                                      AND l.is_spec = FALSE) AS str_plan_build,
                    COUNT(*) FILTER (WHERE l.eff_cmp  >= ws.week_start AND l.eff_cmp  < ws.week_start + 7) AS cmp_plan,
                    COUNT(*) FILTER (WHERE l.eff_cls  >= ws.week_start AND l.eff_cls  < ws.week_start + 7) AS cls_plan,
                    -- Status snapshots at week-end (Sunday = week_start + 6 days)
                    -- P: no effective date has occurred yet
                    COUNT(*) FILTER (WHERE
                        (l.date_ent    IS NULL OR l.date_ent    > ws.week_start + 6)
                        AND (l.date_dev IS NULL OR l.date_dev   > ws.week_start + 6)
                        AND (l.date_td_hold IS NULL OR l.date_td_hold > ws.week_start + 6)
                        AND (l.date_td IS NULL OR l.date_td     > ws.week_start + 6)
                        AND (l.eff_str IS NULL OR l.eff_str     > ws.week_start + 6)
                        AND (l.eff_cmp IS NULL OR l.eff_cmp     > ws.week_start + 6)
                        AND (l.eff_cls IS NULL OR l.eff_cls     > ws.week_start + 6)
                    ) AS p_end,
                    -- E: entitled, not yet developed
                    COUNT(*) FILTER (WHERE
                        l.date_ent <= ws.week_start + 6
                        AND (l.date_dev IS NULL OR l.date_dev > ws.week_start + 6)
                        AND (l.eff_str  IS NULL OR l.eff_str  > ws.week_start + 6)
                    ) AS e_end,
                    -- D: developed, not yet taken down or held
                    COUNT(*) FILTER (WHERE
                        l.date_dev <= ws.week_start + 6
                        AND (l.date_td      IS NULL OR l.date_td      > ws.week_start + 6)
                        AND (l.date_td_hold IS NULL OR l.date_td_hold > ws.week_start + 6)
                        AND (l.eff_str      IS NULL OR l.eff_str      > ws.week_start + 6)
                    ) AS d_end,
                    -- H: hold date set, no takedown yet
                    COUNT(*) FILTER (WHERE
                        l.date_td_hold <= ws.week_start + 6
                        AND l.date_td IS NULL
                        AND (l.eff_str IS NULL OR l.eff_str > ws.week_start + 6)
                    ) AS h_end,
                    -- U: taken down, not yet started
                    COUNT(*) FILTER (WHERE
                        l.date_td <= ws.week_start + 6
                        AND (l.eff_str IS NULL OR l.eff_str > ws.week_start + 6)
                    ) AS u_end,
                    -- UC: started, not yet completed
                    COUNT(*) FILTER (WHERE
                        l.eff_str <= ws.week_start + 6
                        AND (l.eff_cmp IS NULL OR l.eff_cmp > ws.week_start + 6)
                        AND (l.eff_cls IS NULL OR l.eff_cls > ws.week_start + 6)
                    ) AS uc_end,
                    -- C: completed, not yet closed
                    COUNT(*) FILTER (WHERE
                        l.eff_cmp <= ws.week_start + 6
                        AND (l.eff_cls IS NULL OR l.eff_cls > ws.week_start + 6)
                    ) AS c_end
                FROM week_spine ws
                CROSS JOIN lots l
                GROUP BY ws.week_start, l.dev_id, l.builder_id
            )
            SELECT *,
                SUM(cls_plan) OVER (
                    PARTITION BY dev_id, builder_id
                    ORDER BY week_start
                    ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
                ) AS closed_cumulative
            FROM weekly
            ORDER BY week_start, dev_id
            """,
            {"start": ledger_start, "max": max_month, "eg": ent_group_id},
        )

        rows = []
        for r in cur.fetchall():
            week_iso = r["week_start"].isoformat() if r["week_start"] else None
            if week_iso and week_iso < ledger_start.isoformat():
                continue  # trim weeks before ledger start
            rows.append({
                "dev_id":            r["dev_id"],
                "dev_name":          None,   # joined below
                "builder_id":        r["builder_id"],
                "calendar_month":    week_iso,
                "ent_plan":          r["ent_plan"],
                "dev_plan":          r["dev_plan"],
                "td_plan":           r["td_plan"],
                "str_plan":          r["str_plan"],
                "str_plan_spec":     r["str_plan_spec"],
                "str_plan_build":    r["str_plan_build"],
                "cmp_plan":          r["cmp_plan"],
                "cls_plan":          r["cls_plan"],
                "p_end":             r["p_end"],
                "e_end":             r["e_end"],
                "d_end":             r["d_end"],
                "h_end":             r["h_end"],
                "u_end":             r["u_end"],
                "uc_end":            r["uc_end"],
                "c_end":             r["c_end"],
                "closed_cumulative": r["closed_cumulative"],
                "community_county_id":   None,
                "community_county_name": None,
                "community_sd_id":       None,
                "community_sd_name":     None,
            })

        # Attach dev_name and community metadata
        if rows:
            cur.execute(
                """
                SELECT egd.dev_id, d.dev_name,
                       eg.county_id          AS community_county_id,
                       eg.school_district_id AS community_sd_id,
                       comm_c.county_name    AS community_county_name,
                       comm_sd.district_name AS community_sd_name
                FROM sim_ent_group_developments egd
                JOIN developments d ON d.dev_id = egd.dev_id
                JOIN sim_entitlement_groups eg ON eg.ent_group_id = egd.ent_group_id
                LEFT JOIN devdb.ref_counties comm_c ON comm_c.county_id = eg.county_id
                LEFT JOIN devdb.ref_school_districts comm_sd ON comm_sd.sd_id = eg.school_district_id
                WHERE egd.ent_group_id = %s
                """,
                (ent_group_id,),
            )
            meta = {r["dev_id"]: r for r in cur.fetchall()}
            for row in rows:
                m = meta.get(row["dev_id"])
                if m:
                    row["dev_name"]             = m["dev_name"]
                    row["community_county_id"]   = m["community_county_id"]
                    row["community_county_name"] = m["community_county_name"]
                    row["community_sd_id"]        = m["community_sd_id"]
                    row["community_sd_name"]      = m["community_sd_name"]

        return rows
    finally:
        cur.close()


def _ledger_row(r) -> dict:
    return {
        "dev_id":            r["dev_id"],
        "dev_name":          r["dev_name"],
        "builder_id":        r["builder_id"],
        "calendar_month":    r["calendar_month"].isoformat() if r["calendar_month"] else None,
        "ent_plan":          r["ent_plan"],
        "dev_plan":          r["dev_plan"],
        "td_plan":           r["td_plan"],
        "str_plan":          r["str_plan"],
        "str_plan_spec":     r["str_plan_spec"],
        "str_plan_build":    r["str_plan_build"],
        "cmp_plan":          r["cmp_plan"],
        "cls_plan":          r["cls_plan"],
        "p_end":             r["p_end"],
        "e_end":             r["e_end"],
        "d_end":             r["d_end"],
        "h_end":             r["h_end"],
        "u_end":             r["u_end"],
        "uc_end":            r["uc_end"],
        "c_end":             r["c_end"],
        "closed_cumulative":      r["closed_cumulative"],
        "community_county_id":    r["community_county_id"],
        "community_county_name":  r["community_county_name"],
        "community_sd_id":        r["community_sd_id"],
        "community_sd_name":      r["community_sd_name"],
    }
