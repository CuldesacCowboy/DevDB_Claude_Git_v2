# routers/ledger.py
# Ledger endpoints -- monthly simulation results for an entitlement group.
# GET /{ent_group_id}        -- by development (summary)
# GET /{ent_group_id}/by-dev -- by development (alias, same query)

from fastapi import APIRouter, Depends, HTTPException

from api.db import dict_cursor
from api.deps import get_db_conn
from api.sql_fragments import lot_status_sql
from services.ledger_service import query_ledger_by_dev, query_ledger_weekly

router = APIRouter(prefix="/ledger", tags=["ledger"])

# _LEDGER_FILTER removed — ledger now uses a bounded date range instead so the
# spine is continuous with no gaps (months where all lots have closed and no new
# lots have been delivered would otherwise be silently dropped).


@router.get("/{ent_group_id}/utilization")
def get_utilization(ent_group_id: int, conn=Depends(get_db_conn)):
    """
    Return phase utilization for all phases in the entitlement group.
    utilization_pct = (real_count + sim_count) / projected_count.
    Phases with zero projected_count are returned with utilization_pct = null.
    """
    cur = dict_cursor(conn)
    try:
        cur.execute(
            """
            WITH phase_splits AS (
                SELECT phase_id, COALESCE(SUM(projected_count), 0)::int AS projected_count
                FROM sim_phase_product_splits
                GROUP BY phase_id
            )
            SELECT
                sdp.phase_id,
                sdp.phase_name,
                sdp.dev_id,
                d.dev_name,
                sli.instrument_name,
                COALESCE(ps.projected_count, 0)                              AS projected_count,
                COUNT(sl.lot_id) FILTER (WHERE sl.lot_source = 'sim')::int   AS sim_count,
                COUNT(sl.lot_id) FILTER (WHERE sl.lot_source = 'real')::int  AS real_count,
                COUNT(sl.lot_id)::int                                         AS total_count,
                COUNT(sl.lot_id) FILTER (WHERE sl.is_spec = TRUE)::int       AS spec_count,
                COUNT(sl.lot_id) FILTER (WHERE sl.is_spec = FALSE)::int      AS build_count,
                COUNT(sl.lot_id) FILTER (WHERE sl.is_spec IS NULL AND sl.lot_id IS NOT NULL)::int AS undet_count,
                CASE
                    WHEN COALESCE(ps.projected_count, 0) = 0 THEN NULL
                    ELSE ROUND(
                        COUNT(sl.lot_id)::numeric / ps.projected_count * 100, 1
                    )
                END AS utilization_pct
            FROM sim_dev_phases sdp
            JOIN sim_ent_group_developments segd ON sdp.dev_id = segd.dev_id
            JOIN developments d ON d.dev_id = sdp.dev_id
            JOIN sim_legal_instruments sli ON sdp.instrument_id = sli.instrument_id
            LEFT JOIN phase_splits ps ON ps.phase_id = sdp.phase_id
            LEFT JOIN sim_lots sl ON sl.phase_id = sdp.phase_id AND sl.excluded IS NOT TRUE
            WHERE segd.ent_group_id = %s
            GROUP BY sdp.phase_id, sdp.phase_name, sdp.dev_id, d.dev_name,
                     sli.instrument_name, sdp.sequence_number, ps.projected_count
            ORDER BY sdp.dev_id, sdp.sequence_number
            """,
            (ent_group_id,),
        )
        return [
            {
                "phase_id":        r["phase_id"],
                "phase_name":      r["phase_name"],
                "dev_id":          r["dev_id"],
                "dev_name":        r["dev_name"],
                "instrument_name": r["instrument_name"],
                "projected_count": r["projected_count"],
                "sim_count":       r["sim_count"],
                "real_count":      r["real_count"],
                "total_count":     r["total_count"],
                "spec_count":      r["spec_count"],
                "build_count":     r["build_count"],
                "undet_count":     r["undet_count"],
                "utilization_pct": float(r["utilization_pct"]) if r["utilization_pct"] is not None else None,
            }
            for r in cur.fetchall()
        ]
    finally:
        cur.close()


@router.get("/{ent_group_id}/lots")
def get_lots(ent_group_id: int, conn=Depends(get_db_conn)):
    """
    Return lot-level rows for all developments in the entitlement group.
    Status is derived from date fields (never stored).
    """
    _STATUS_SQL = lot_status_sql("sl")
    cur = dict_cursor(conn)
    try:
        cur.execute(
            f"""
            WITH overrides AS (
                SELECT lot_id,
                    MAX(CASE WHEN date_field = 'date_td_hold' THEN override_value END) AS ov_date_td_hold,
                    MAX(CASE WHEN date_field = 'date_td'      THEN override_value END) AS ov_date_td,
                    MAX(CASE WHEN date_field = 'date_str'     THEN override_value END) AS ov_date_str,
                    MAX(CASE WHEN date_field = 'date_frm'     THEN override_value END) AS ov_date_frm,
                    MAX(CASE WHEN date_field = 'date_cmp'     THEN override_value END) AS ov_date_cmp,
                    MAX(CASE WHEN date_field = 'date_cls'     THEN override_value END) AS ov_date_cls
                FROM sim_lot_date_overrides
                GROUP BY lot_id
            ),
            violations AS (
                SELECT lot_id,
                    array_agg(violation_type ORDER BY violation_type) AS violation_types
                FROM sim_lot_date_violations
                GROUP BY lot_id
            )
            SELECT
                sl.lot_id,
                sl.lot_number,
                sl.lot_source,
                sl.lot_type_id,
                rlt.lot_type_short,
                sdp.phase_name,
                sl.dev_id,
                d.dev_name,
                sl.building_group_id,
                {_STATUS_SQL}           AS status,
                sl.date_ent,
                sl.date_dev,
                sl.date_td_hold,
                sl.date_td_hold_projected,
                sl.date_td,
                sl.date_td_projected,
                sl.date_str,
                sl.date_frm,
                sl.date_cmp,
                sl.date_cls,
                sl.is_spec,
                sl.date_str_projected,
                sl.date_cmp_projected,
                sl.date_cls_projected,
                o.ov_date_td_hold,
                o.ov_date_td,
                o.ov_date_str,
                o.ov_date_frm,
                o.ov_date_cmp,
                o.ov_date_cls,
                v.violation_types,
                COALESCE(sdp.county_id, eg.county_id)                                              AS resolved_county_id,
                COALESCE(ph_c.county_name, comm_c.county_name)                                     AS resolved_county_name,
                COALESCE(sl.school_district_id, sdp.school_district_id, eg.school_district_id)    AS resolved_sd_id,
                COALESCE(lot_sd.district_name, ph_sd.district_name, comm_sd.district_name)        AS resolved_sd_name,
                (sl.school_district_id IS NOT NULL)                                                AS sd_is_lot_exception
            FROM sim_lots sl
            JOIN sim_dev_phases sdp ON sdp.phase_id = sl.phase_id
            JOIN developments d ON d.dev_id = sl.dev_id
            JOIN sim_ent_group_developments segd ON segd.dev_id = sl.dev_id AND segd.ent_group_id = %s
            JOIN sim_entitlement_groups eg ON eg.ent_group_id = segd.ent_group_id
            LEFT JOIN ref_lot_types rlt ON rlt.lot_type_id = sl.lot_type_id
            LEFT JOIN overrides o ON o.lot_id = sl.lot_id
            LEFT JOIN violations v ON v.lot_id = sl.lot_id
            LEFT JOIN devdb.ref_counties comm_c  ON comm_c.county_id  = eg.county_id
            LEFT JOIN devdb.ref_counties ph_c    ON ph_c.county_id    = sdp.county_id
            LEFT JOIN devdb.ref_school_districts comm_sd ON comm_sd.sd_id = eg.school_district_id
            LEFT JOIN devdb.ref_school_districts ph_sd   ON ph_sd.sd_id   = sdp.school_district_id
            LEFT JOIN devdb.ref_school_districts lot_sd  ON lot_sd.sd_id  = sl.school_district_id
            WHERE sl.excluded IS NOT TRUE
            ORDER BY d.dev_name, sdp.sequence_number, sl.lot_source ASC,
                     sl.lot_number NULLS LAST, sl.building_group_id ASC NULLS LAST
            """,
            (ent_group_id,),
        )

        def _d(v):
            return v.isoformat() if v else None

        return [
            {
                "lot_id":              r["lot_id"],
                "lot_number":          r["lot_number"],
                "lot_source":          r["lot_source"],
                "lot_type_short":      r["lot_type_short"],
                "phase_name":          r["phase_name"],
                "dev_id":              r["dev_id"],
                "dev_name":            r["dev_name"],
                "building_group_id":   r["building_group_id"],
                "status":              r["status"],
                "is_spec":             r["is_spec"],   # True=spec, False=build, None=undetermined
                "date_ent":            _d(r["date_ent"]),
                "date_dev":            _d(r["date_dev"]),
                "date_td_hold":           _d(r["date_td_hold"]),
                "date_td_hold_projected": _d(r["date_td_hold_projected"]),
                "date_td":                _d(r["date_td"]),
                "date_td_projected":      _d(r["date_td_projected"]),
                "date_str":            _d(r["date_str"]),
                "date_frm":            _d(r["date_frm"]),
                "date_cmp":            _d(r["date_cmp"]),
                "date_cls":            _d(r["date_cls"]),
                "date_str_projected":  _d(r["date_str_projected"]),
                "date_cmp_projected":  _d(r["date_cmp_projected"]),
                "date_cls_projected":  _d(r["date_cls_projected"]),
                "ov_date_td_hold":     _d(r["ov_date_td_hold"]),
                "ov_date_td":          _d(r["ov_date_td"]),
                "ov_date_str":         _d(r["ov_date_str"]),
                "ov_date_frm":         _d(r["ov_date_frm"]),
                "ov_date_cmp":         _d(r["ov_date_cmp"]),
                "ov_date_cls":         _d(r["ov_date_cls"]),
                "violations":          list(r["violation_types"]) if r["violation_types"] else [],
                "resolved_county_id":  r["resolved_county_id"],
                "resolved_county_name": r["resolved_county_name"],
                "resolved_sd_id":      r["resolved_sd_id"],
                "resolved_sd_name":    r["resolved_sd_name"],
                "sd_is_lot_exception": bool(r["sd_is_lot_exception"]),
            }
            for r in cur.fetchall()
        ]
    finally:
        cur.close()


@router.get("/{ent_group_id}/delivery-schedule")
def get_delivery_schedule(ent_group_id: int, conn=Depends(get_db_conn)):
    """
    Return one row per phase with delivery event info (if scheduled),
    phase delivery config fields (order, tier, group), units, and
    D/H/U inventory at the delivery month.
    Unscheduled phases appear at the bottom with null delivery fields.
    """
    cur = dict_cursor(conn)
    try:
        cur.execute(
            """
            WITH all_phases AS (
                SELECT
                    sdp.phase_id,
                    sdp.phase_name,
                    sdp.sequence_number,
                    sdp.delivery_tier,
                    sdp.delivery_group,
                    sdp.date_dev_projected,
                    sdp.date_dev_actual,
                    sli.instrument_id,
                    sli.instrument_name,
                    d.dev_id,
                    d.dev_name
                FROM sim_dev_phases sdp
                JOIN sim_legal_instruments sli ON sli.instrument_id = sdp.instrument_id
                JOIN developments d            ON d.dev_id = sli.dev_id
                JOIN sim_ent_group_developments segd ON segd.dev_id = d.dev_id
                WHERE segd.ent_group_id = %s
            ),
            event_link AS (
                SELECT
                    dep.phase_id,
                    sde.delivery_event_id,
                    sde.event_name,
                    COALESCE(sde.date_dev_actual, sde.date_dev_projected)::date AS delivery_date,
                    (sde.date_dev_actual IS NOT NULL)                            AS is_locked
                FROM sim_delivery_events sde
                JOIN sim_delivery_event_phases dep ON dep.delivery_event_id = sde.delivery_event_id
                WHERE sde.ent_group_id = %s
            ),
            phase_units AS (
                SELECT spps.phase_id,
                    GREATEST(
                        COALESCE(SUM(spps.projected_count), 0)::int
                            - COALESCE(
                                (SELECT COUNT(*)::int FROM sim_lots
                                 WHERE phase_id = spps.phase_id AND excluded IS TRUE), 0),
                        0
                    ) AS units
                FROM sim_phase_product_splits spps
                WHERE spps.phase_id IN (SELECT phase_id FROM all_phases)
                GROUP BY spps.phase_id
            ),
            inventory AS (
                SELECT dev_id, calendar_month,
                       SUM(d_end)::int AS d_end,
                       SUM(h_end)::int AS h_end,
                       SUM(u_end)::int AS u_end
                FROM v_sim_ledger_monthly
                WHERE dev_id IN (
                    SELECT dev_id FROM sim_ent_group_developments WHERE ent_group_id = %s
                )
                GROUP BY dev_id, calendar_month
            )
            SELECT
                ap.*,
                el.delivery_event_id,
                el.event_name,
                el.delivery_date,
                el.is_locked,
                COALESCE(pu.units, 0)::int AS units,
                pre.d_end  AS d_pre,
                pre.h_end  AS h_pre,
                pre.u_end  AS u_pre,
                post.d_end AS d_post
            FROM all_phases ap
            LEFT JOIN event_link el  ON el.phase_id = ap.phase_id
            LEFT JOIN phase_units pu ON pu.phase_id = ap.phase_id
            LEFT JOIN inventory pre
                ON  pre.dev_id = ap.dev_id
                AND pre.calendar_month = (DATE_TRUNC('month', el.delivery_date) - INTERVAL '1 month')::date
            LEFT JOIN inventory post
                ON  post.dev_id = ap.dev_id
                AND post.calendar_month = DATE_TRUNC('month', el.delivery_date)::date
            ORDER BY el.delivery_date NULLS LAST,
                     el.delivery_event_id NULLS LAST,
                     ap.dev_name, ap.instrument_name, ap.sequence_number
            """,
            (ent_group_id, ent_group_id, ent_group_id),
        )

        def _d(v):
            return v.isoformat() if v else None

        return [
            {
                "phase_id":           r["phase_id"],
                "phase_name":         r["phase_name"],
                "sequence_number":    r["sequence_number"],
                "delivery_tier":      r["delivery_tier"],
                "delivery_group":     r["delivery_group"],
                "date_dev_projected": _d(r["date_dev_projected"]),
                "date_dev_actual":    _d(r["date_dev_actual"]),
                "instrument_id":      r["instrument_id"],
                "instrument_name":    r["instrument_name"],
                "dev_id":             r["dev_id"],
                "dev_name":           r["dev_name"],
                "delivery_event_id":  r["delivery_event_id"],
                "event_name":         r["event_name"],
                "delivery_date":      _d(r["delivery_date"]),
                "is_locked":          bool(r["is_locked"]) if r["is_locked"] is not None else False,
                "units":              r["units"],
                "d_pre":              r["d_pre"],
                "h_pre":              r["h_pre"],
                "u_pre":              r["u_pre"],
                "d_post":             r["d_post"],
            }
            for r in cur.fetchall()
        ]
    finally:
        cur.close()


@router.get("/{ent_group_id}/phase-delivery-config")
def get_phase_delivery_config(ent_group_id: int, conn=Depends(get_db_conn)):
    """
    Return per-phase delivery configuration for the community:
    sequence_number, delivery_tier, delivery_group, dates, and source status.
    Used by the Delivery Schedule tab's phase config panel.
    """
    cur = dict_cursor(conn)
    try:
        cur.execute(
            """
            SELECT
                sdp.phase_id,
                sdp.phase_name,
                sdp.sequence_number,
                sdp.delivery_tier,
                sdp.delivery_group,
                sdp.date_dev_projected,
                sdp.date_dev_actual,
                sli.instrument_id,
                sli.instrument_name,
                d.dev_id,
                d.dev_name
            FROM sim_dev_phases sdp
            JOIN sim_legal_instruments sli ON sli.instrument_id = sdp.instrument_id
            JOIN developments d ON d.dev_id = sli.dev_id
            JOIN sim_ent_group_developments segd ON segd.dev_id = d.dev_id
            WHERE segd.ent_group_id = %s
            ORDER BY d.dev_name, sli.instrument_name, sdp.sequence_number
            """,
            (ent_group_id,),
        )

        def _d(v):
            return v.isoformat() if v else None

        return [
            {
                "phase_id":          r["phase_id"],
                "phase_name":        r["phase_name"],
                "sequence_number":   r["sequence_number"],
                "delivery_tier":     r["delivery_tier"],
                "delivery_group":    r["delivery_group"],
                "date_dev_projected": _d(r["date_dev_projected"]),
                "date_dev_actual":   _d(r["date_dev_actual"]),
                "instrument_id":     r["instrument_id"],
                "instrument_name":   r["instrument_name"],
                "dev_id":            r["dev_id"],
                "dev_name":          r["dev_name"],
            }
            for r in cur.fetchall()
        ]
    finally:
        cur.close()


@router.get("/{ent_group_id}/rules-validation")
def get_rules_validation(ent_group_id: int, conn=Depends(get_db_conn)):
    """
    Validate simulation rules against current delivery schedule and phase config.
    Returns a list of rule checks with pass/fail, summary, and rich detail.
    """
    cur = dict_cursor(conn)
    try:
        # ── Gather data ──────────────────────────────────────────────────────
        # Delivery events with phases
        cur.execute("""
            SELECT
                sde.delivery_event_id,
                COALESCE(sde.date_dev_actual, sde.date_dev_projected)::date AS delivery_date,
                sde.date_dev_actual IS NOT NULL AS is_locked,
                sde.event_name,
                dep.phase_id,
                sdp.phase_name,
                sdp.sequence_number,
                sdp.delivery_tier,
                sdp.delivery_group,
                sdp.instrument_id,
                sli.instrument_name,
                d.dev_id,
                d.dev_name
            FROM sim_delivery_events sde
            JOIN sim_delivery_event_phases dep ON dep.delivery_event_id = sde.delivery_event_id
            JOIN sim_dev_phases sdp ON sdp.phase_id = dep.phase_id
            JOIN sim_legal_instruments sli ON sli.instrument_id = sdp.instrument_id
            JOIN developments d ON d.dev_id = sli.dev_id
            WHERE sde.ent_group_id = %s
            ORDER BY delivery_date NULLS LAST, sde.delivery_event_id, sdp.sequence_number
        """, (ent_group_id,))
        event_rows = [dict(r) for r in cur.fetchall()]

        # Delivery config
        cur.execute("""
            SELECT delivery_months, max_deliveries_per_year, auto_schedule_enabled
            FROM sim_entitlement_delivery_config
            WHERE ent_group_id = %s
        """, (ent_group_id,))
        cfg_row = cur.fetchone()
        delivery_months = list(cfg_row["delivery_months"]) if cfg_row and cfg_row["delivery_months"] else None
        max_per_year = cfg_row["max_deliveries_per_year"] if cfg_row else None
        auto_sched = bool(cfg_row["auto_schedule_enabled"]) if cfg_row else False

        # Global settings fallback
        if delivery_months is None:
            cur.execute("SELECT delivery_months FROM sim_global_settings WHERE id = 1")
            gs = cur.fetchone()
            delivery_months = list(gs["delivery_months"]) if gs and gs["delivery_months"] else [5,6,7,8,9,10,11]

        # All phases in community (including unscheduled)
        cur.execute("""
            SELECT sdp.phase_id, sdp.phase_name, sdp.sequence_number,
                   sdp.delivery_tier, sdp.delivery_group,
                   sdp.instrument_id, sli.instrument_name,
                   d.dev_id, d.dev_name
            FROM sim_dev_phases sdp
            JOIN sim_legal_instruments sli ON sli.instrument_id = sdp.instrument_id
            JOIN developments d ON d.dev_id = sli.dev_id
            JOIN sim_ent_group_developments segd ON segd.dev_id = d.dev_id
            WHERE segd.ent_group_id = %s
            ORDER BY d.dev_name, sli.instrument_name, sdp.sequence_number
        """, (ent_group_id,))
        all_phases = [dict(r) for r in cur.fetchall()]

        rules = []

        # ── Build event map ──────────────────────────────────────────────────
        from collections import defaultdict
        events = defaultdict(lambda: {"phases": [], "date": None, "is_locked": False, "name": ""})
        for r in event_rows:
            eid = r["delivery_event_id"]
            events[eid]["date"] = r["delivery_date"]
            events[eid]["is_locked"] = r["is_locked"]
            events[eid]["name"] = r["event_name"]
            events[eid]["phases"].append(r)

        # Phase -> event date map
        phase_event_date = {}
        for r in event_rows:
            phase_event_date[r["phase_id"]] = r["delivery_date"]

        month_names = ["", "Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"]

        # ── Rule 1: Delivery Window ──────────────────────────────────────────
        violations_window = []
        for eid, ev in events.items():
            if ev["date"] and ev["date"].month not in delivery_months:
                violations_window.append({
                    "event": ev["name"],
                    "date": ev["date"].isoformat(),
                    "month": month_names[ev["date"].month],
                    "phases": [p["phase_name"] for p in ev["phases"]],
                })
        rules.append({
            "rule_id": "delivery_window",
            "rule_name": "Delivery Window",
            "passed": len(violations_window) == 0,
            "summary": f"All deliveries in valid months ({', '.join(month_names[m] for m in sorted(delivery_months))})"
                       if not violations_window
                       else f"{len(violations_window)} event(s) outside delivery window",
            "detail": {
                "valid_months": sorted(delivery_months),
                "valid_month_names": [month_names[m] for m in sorted(delivery_months)],
                "violations": violations_window,
            },
        })

        # ── Rule 2: Max Deliveries Per Year ──────────────────────────────────
        year_counts = defaultdict(int)
        year_events = defaultdict(list)
        for eid, ev in events.items():
            if ev["date"]:
                y = ev["date"].year
                year_counts[y] += 1
                year_events[y].append({"event": ev["name"], "date": ev["date"].isoformat()})
        violations_max = []
        if max_per_year:
            for y, cnt in sorted(year_counts.items()):
                if cnt > max_per_year:
                    violations_max.append({"year": y, "count": cnt, "max": max_per_year,
                                           "events": year_events[y]})
        rules.append({
            "rule_id": "max_per_year",
            "rule_name": "Max Deliveries Per Year",
            "passed": len(violations_max) == 0,
            "summary": f"All years within {max_per_year}/yr limit"
                       if not violations_max
                       else f"{len(violations_max)} year(s) exceed {max_per_year}/yr limit",
            "detail": {
                "max_per_year": max_per_year,
                "year_counts": dict(year_counts),
                "violations": violations_max,
            },
        })

        # ── Rule 3: Tier Ordering ────────────────────────────────────────────
        # Within a community, lower-tier phases should deliver on or before higher-tier phases.
        tier_phases = []
        for p in all_phases:
            if p["delivery_tier"] is not None and p["phase_id"] in phase_event_date:
                tier_phases.append({
                    "phase_id": p["phase_id"],
                    "phase_name": p["phase_name"],
                    "dev_name": p["dev_name"],
                    "instrument_name": p["instrument_name"],
                    "tier": p["delivery_tier"],
                    "date": phase_event_date[p["phase_id"]],
                })
        tier_phases.sort(key=lambda x: (x["tier"], x["date"]))

        tier_violations = []
        # Check: for each pair where tier_a < tier_b, date_a should be <= date_b
        tier_map = defaultdict(list)  # tier -> list of (date, phase_name)
        for tp in tier_phases:
            tier_map[tp["tier"]].append(tp)

        tiers_sorted = sorted(tier_map.keys())
        for i in range(len(tiers_sorted)):
            for j in range(i + 1, len(tiers_sorted)):
                t_low, t_high = tiers_sorted[i], tiers_sorted[j]
                max_low = max(tp["date"] for tp in tier_map[t_low])
                min_high = min(tp["date"] for tp in tier_map[t_high])
                if max_low > min_high:
                    tier_violations.append({
                        "tier_low": t_low, "tier_high": t_high,
                        "latest_low": max_low.isoformat(),
                        "earliest_high": min_high.isoformat(),
                    })

        # Build flow for visualization
        tier_flow = []
        for t in tiers_sorted:
            phases_in_tier = tier_map[t]
            dates = sorted(set(tp["date"].isoformat() for tp in phases_in_tier))
            tier_flow.append({
                "tier": t,
                "phases": [{"phase_name": tp["phase_name"], "dev_name": tp["dev_name"],
                            "date": tp["date"].isoformat()} for tp in phases_in_tier],
                "dates": dates,
            })

        rules.append({
            "rule_id": "tier_ordering",
            "rule_name": "Tier Ordering",
            "passed": len(tier_violations) == 0,
            "summary": f"All {len(tiers_sorted)} tiers deliver in correct order"
                       if not tier_violations
                       else f"{len(tier_violations)} tier ordering violation(s)",
            "detail": {
                "flow": tier_flow,
                "violations": tier_violations,
                "tier_count": len(tiers_sorted),
            },
        })

        # ── Rule 4: Group Simultaneous Delivery ──────────────────────────────
        group_phases = defaultdict(list)
        for p in all_phases:
            if p["delivery_group"] and p["phase_id"] in phase_event_date:
                group_phases[p["delivery_group"]].append({
                    "phase_id": p["phase_id"],
                    "phase_name": p["phase_name"],
                    "dev_name": p["dev_name"],
                    "date": phase_event_date[p["phase_id"]],
                })

        group_violations = []
        group_detail = []
        for grp in sorted(group_phases.keys()):
            members = group_phases[grp]
            dates = set(m["date"] for m in members)
            ok = len(dates) <= 1
            group_detail.append({
                "group": grp,
                "passed": ok,
                "date": members[0]["date"].isoformat() if ok and members else None,
                "members": [{"phase_name": m["phase_name"], "dev_name": m["dev_name"],
                             "date": m["date"].isoformat()} for m in members],
            })
            if not ok:
                group_violations.append(grp)

        # Unscheduled group members
        for p in all_phases:
            if p["delivery_group"] and p["phase_id"] not in phase_event_date:
                for gd in group_detail:
                    if gd["group"] == p["delivery_group"]:
                        gd["members"].append({
                            "phase_name": p["phase_name"], "dev_name": p["dev_name"],
                            "date": None,
                        })
                        gd["passed"] = False
                        if p["delivery_group"] not in group_violations:
                            group_violations.append(p["delivery_group"])

        rules.append({
            "rule_id": "group_simultaneous",
            "rule_name": "Group Simultaneous Delivery",
            "passed": len(group_violations) == 0,
            "summary": f"All {len(group_phases)} group(s) deliver simultaneously"
                       if not group_violations
                       else f"{len(group_violations)} group(s) not synchronized",
            "detail": { "groups": group_detail },
        })

        # ── Rule 5: Group Exclusivity ────────────────────────────────────────
        # On dates where a group delivers, no non-group phases should deliver.
        group_dates = set()
        for grp, members in group_phases.items():
            for m in members:
                group_dates.add(m["date"])

        excl_violations = []
        for r in event_rows:
            if r["delivery_date"] in group_dates and not r["delivery_group"]:
                excl_violations.append({
                    "phase_name": r["phase_name"],
                    "dev_name": r["dev_name"],
                    "date": r["delivery_date"].isoformat(),
                })

        rules.append({
            "rule_id": "group_exclusivity",
            "rule_name": "Group Date Exclusivity",
            "passed": len(excl_violations) == 0,
            "summary": "No non-group phases on group delivery dates"
                       if not excl_violations
                       else f"{len(excl_violations)} non-group phase(s) on group dates",
            "detail": {
                "group_dates": sorted(d.isoformat() for d in group_dates),
                "violations": excl_violations,
            },
        })

        # ── Rule 6: Sequence Ordering Within Instrument ──────────────────────
        seq_violations = []
        inst_phases = defaultdict(list)
        for p in all_phases:
            if p["phase_id"] in phase_event_date:
                inst_phases[p["instrument_id"]].append({
                    "phase_name": p["phase_name"],
                    "instrument_name": p["instrument_name"],
                    "sequence_number": p["sequence_number"] or 9999,
                    "date": phase_event_date[p["phase_id"]],
                })
        for iid, phases in inst_phases.items():
            phases.sort(key=lambda x: x["sequence_number"])
            for k in range(len(phases) - 1):
                if phases[k]["date"] > phases[k+1]["date"]:
                    seq_violations.append({
                        "instrument": phases[k]["instrument_name"],
                        "earlier_phase": phases[k]["phase_name"],
                        "earlier_seq": phases[k]["sequence_number"],
                        "earlier_date": phases[k]["date"].isoformat(),
                        "later_phase": phases[k+1]["phase_name"],
                        "later_seq": phases[k+1]["sequence_number"],
                        "later_date": phases[k+1]["date"].isoformat(),
                    })

        rules.append({
            "rule_id": "sequence_ordering",
            "rule_name": "Sequence Ordering (within Instrument)",
            "passed": len(seq_violations) == 0,
            "summary": "All phases deliver in sequence order within their instrument"
                       if not seq_violations
                       else f"{len(seq_violations)} sequence ordering violation(s)",
            "detail": { "violations": seq_violations },
        })

        # ── Rule 7: All Phases Scheduled ─────────────────────────────────────
        scheduled_ids = set(phase_event_date.keys())
        unscheduled = [p for p in all_phases if p["phase_id"] not in scheduled_ids]
        rules.append({
            "rule_id": "all_scheduled",
            "rule_name": "All Phases Scheduled",
            "passed": len(unscheduled) == 0,
            "summary": f"All {len(all_phases)} phases have delivery events"
                       if not unscheduled
                       else f"{len(unscheduled)} of {len(all_phases)} phase(s) unscheduled",
            "detail": {
                "total": len(all_phases),
                "scheduled": len(scheduled_ids),
                "unscheduled": [{"phase_name": p["phase_name"], "dev_name": p["dev_name"],
                                 "instrument_name": p["instrument_name"]}
                                for p in unscheduled],
            },
        })

        # ── Rule 8: Locked Dates Honored ─────────────────────────────────────
        locked_count = sum(1 for ev in events.values() if ev["is_locked"])
        rules.append({
            "rule_id": "locked_honored",
            "rule_name": "Locked Dates Honored",
            "passed": True,
            "summary": f"{locked_count} locked event(s) preserved" if locked_count else "No locked events",
            "detail": {
                "locked_events": [
                    {"event": ev["name"], "date": ev["date"].isoformat(),
                     "phases": [p["phase_name"] for p in ev["phases"]]}
                    for ev in events.values() if ev["is_locked"]
                ],
            },
        })

        return rules
    finally:
        cur.close()


@router.get("/{ent_group_id}/weekly")
def get_ledger_weekly(ent_group_id: int, conn=Depends(get_db_conn)):
    """
    Return weekly ledger rows for all developments in the entitlement group.
    Each row covers one ISO week (Mon–Sun).  Event counts are lots whose
    effective date falls in that week; status counts are end-of-week snapshots.
    """
    return query_ledger_weekly(conn, ent_group_id)


@router.get("/{ent_group_id}/by-dev")
def get_ledger_by_dev(ent_group_id: int, conn=Depends(get_db_conn)):
    """
    Return monthly ledger rows aggregated by development.
    Only months with at least one non-zero count are returned.
    """
    return query_ledger_by_dev(conn, ent_group_id)


@router.get("/{ent_group_id}")
def get_ledger(ent_group_id: int, conn=Depends(get_db_conn)):
    """
    Return monthly ledger rows for all developments in the entitlement group.
    Rows are only returned for months that have at least one non-zero count.
    """
    rows = query_ledger_by_dev(conn, ent_group_id)
    if not rows:
        return []
    return rows
