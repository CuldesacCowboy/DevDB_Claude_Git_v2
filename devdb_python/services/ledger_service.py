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
