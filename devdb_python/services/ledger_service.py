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
                DATE_TRUNC('MONTH', MAX(GREATEST(
                    COALESCE(sl.date_cls, sl.date_cls_projected, '2000-01-01'::DATE),
                    COALESCE(sl.date_cmp, sl.date_cmp_projected, '2000-01-01'::DATE),
                    COALESCE(sl.date_str, sl.date_str_projected, '2000-01-01'::DATE),
                    COALESCE(sl.date_td,                         '2000-01-01'::DATE),
                    COALESCE(sl.date_dev,                        '2000-01-01'::DATE)
                )))::DATE AS max_activity_month
            FROM sim_entitlement_groups eg
            JOIN sim_ent_group_developments egd ON egd.ent_group_id = eg.ent_group_id
            LEFT JOIN sim_lots sl ON sl.dev_id = egd.dev_id
            WHERE eg.ent_group_id = %s
            GROUP BY eg.date_paper
            """,
            (ent_group_id,),
        )
        bounds = cur.fetchone()
        if not bounds or bounds["max_activity_month"] is None:
            return []

        ledger_start = bounds["date_paper"]
        max_month    = bounds["max_activity_month"]

        # Also consider entitlement event dates for the end bound
        cur.execute(
            "SELECT MAX(event_date) AS max_ev FROM sim_entitlement_events WHERE ent_group_id = %s",
            (ent_group_id,),
        )
        ev_max = cur.fetchone()["max_ev"]
        if ev_max:
            from datetime import date
            ev_month = ev_max.replace(day=1) if hasattr(ev_max, 'replace') else date.fromisoformat(str(ev_max)).replace(day=1)
            if ev_month > max_month:
                max_month = ev_month

        # Main ledger rows — bounded range, no activity filter
        cur.execute(
            """
            SELECT
                v.dev_id,
                d.dev_name,
                v.builder_id,
                v.calendar_month,
                v.ent_plan, v.dev_plan, v.td_plan,
                v.str_plan, v.cmp_plan, v.cls_plan,
                v.p_end, v.e_end, v.d_end, v.h_end,
                v.u_end, v.uc_end, v.c_end,
                v.closed_cumulative
            FROM v_sim_ledger_monthly v
            JOIN dim_development dd ON dd.development_id = v.dev_id
            JOIN developments d ON d.marks_code = dd.dev_code2
            WHERE v.dev_id IN (
                SELECT dev_id FROM sim_ent_group_developments
                WHERE ent_group_id = %s
            )
              AND v.calendar_month <= %s
              AND (%s IS NULL OR v.calendar_month >= %s)
            ORDER BY d.dev_name, v.calendar_month
            """,
            (ent_group_id, max_month, ledger_start, ledger_start),
        )
        rows = [_ledger_row(r) for r in cur.fetchall()]

        # Overlay entitlement events onto ent_plan
        cur.execute(
            """
            SELECT dev_id, DATE_TRUNC('MONTH', event_date)::DATE AS month,
                   SUM(lots_entitled) AS cnt
            FROM sim_entitlement_events
            WHERE ent_group_id = %s
            GROUP BY dev_id, DATE_TRUNC('MONTH', event_date)::DATE
            """,
            (ent_group_id,),
        )
        ent_overlay: dict[tuple, int] = {
            (r["dev_id"], r["month"].isoformat()): int(r["cnt"])
            for r in cur.fetchall()
        }
        for row in rows:
            key = (row["dev_id"], row["calendar_month"])
            if key in ent_overlay:
                row["ent_plan"] = (row["ent_plan"] or 0) + ent_overlay.pop(key)
        # Remaining overlay months not yet in the ledger — inject as sparse rows
        for (dev_id, month_iso), cnt in ent_overlay.items():
            cur.execute(
                """
                SELECT d.dev_name
                FROM dim_development dd
                JOIN developments d ON d.marks_code = dd.dev_code2
                WHERE dd.development_id = %s
                """,
                (dev_id,),
            )
            name_row = cur.fetchone()
            rows.append({
                "dev_id": dev_id,
                "dev_name": name_row["dev_name"] if name_row else str(dev_id),
                "builder_id": None,
                "calendar_month": month_iso,
                "ent_plan": cnt, "dev_plan": 0, "td_plan": 0,
                "str_plan": 0, "cmp_plan": 0, "cls_plan": 0,
                "p_end": 0, "e_end": 0, "d_end": 0, "h_end": 0,
                "u_end": 0, "uc_end": 0, "c_end": 0,
                "closed_cumulative": None,
            })

        # Synthetic date_paper row per dev (if that month isn't present)
        cur.execute(
            """
            SELECT eg.date_paper,
                   egd.dev_id,
                   d.dev_name,
                   COUNT(sl.lot_id)::int AS total_lots
            FROM sim_entitlement_groups eg
            JOIN sim_ent_group_developments egd ON egd.ent_group_id = eg.ent_group_id
            JOIN dim_development dd ON dd.development_id = egd.dev_id
            JOIN developments d ON d.marks_code = dd.dev_code2
            LEFT JOIN sim_lots sl ON sl.dev_id = egd.dev_id
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
                    "str_plan": 0, "cmp_plan": 0, "cls_plan": 0,
                    "p_end": r["total_lots"], "e_end": 0, "d_end": 0, "h_end": 0,
                    "u_end": 0, "uc_end": 0, "c_end": 0,
                    "closed_cumulative": None,
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
    }
