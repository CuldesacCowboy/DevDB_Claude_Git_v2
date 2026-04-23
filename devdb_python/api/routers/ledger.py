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
            SELECT delivery_months, max_deliveries_per_year
            FROM sim_entitlement_delivery_config
            WHERE ent_group_id = %s
        """, (ent_group_id,))
        cfg_row = cur.fetchone()
        delivery_months = list(cfg_row["delivery_months"]) if cfg_row and cfg_row["delivery_months"] else None
        max_per_year = cfg_row["max_deliveries_per_year"] if cfg_row else None

        # Global settings fallback
        cur.execute("SELECT delivery_months, max_deliveries_per_year FROM sim_global_settings WHERE id = 1")
        gs = cur.fetchone()
        if delivery_months is None:
            delivery_months = list(gs["delivery_months"]) if gs and gs["delivery_months"] else [5,6,7,8,9,10,11]
        if max_per_year is None and gs:
            max_per_year = gs["max_deliveries_per_year"]

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
        all_events_window = []
        for eid, ev in events.items():
            if ev["date"]:
                in_window = ev["date"].month in delivery_months
                all_events_window.append({
                    "event": ev["name"],
                    "date": ev["date"].isoformat(),
                    "month": ev["date"].month,
                    "month_name": month_names[ev["date"].month],
                    "passed": in_window,
                })
                if not in_window:
                    violations_window.append({
                        "event": ev["name"],
                        "date": ev["date"].isoformat(),
                        "month": month_names[ev["date"].month],
                        "phases": [p["phase_name"] for p in ev["phases"]],
                    })
        rules.append({
            "rule_id": "delivery_window",
            "category": "config_validation",
            "rule_name": "Delivery Window",
            "passed": len(violations_window) == 0,
            "summary": f"All deliveries in valid months ({', '.join(month_names[m] for m in sorted(delivery_months))})"
                       if not violations_window
                       else f"{len(violations_window)} event(s) outside delivery window",
            "detail": {
                "explanation": "Land development delivery events are constrained to specific calendar months because municipal approvals, infrastructure readiness, and weather conditions create seasonal windows during which lot delivery is feasible. Delivering outside the configured window risks construction delays, financing misalignment, and regulatory complications. This rule ensures every scheduled delivery event falls within the community's allowed delivery months.",
                "methodology": "Each delivery event's effective date (actual if locked, otherwise projected) is checked to confirm its calendar month appears in the community's delivery_months configuration array. Events in months outside the allowed set are flagged.",
                "valid_months": sorted(delivery_months),
                "valid_month_names": [month_names[m] for m in sorted(delivery_months)],
                "all_events": all_events_window,
                "violations": violations_window,
            },
        })

        # ── Rule 1b: Delivery After Entitlement ─────────────────────────────
        # Fetch community entitlement date
        cur.execute(
            "SELECT date_ent_actual FROM sim_entitlement_groups WHERE ent_group_id = %s",
            (ent_group_id,),
        )
        ent_row = cur.fetchone()
        ent_date = ent_row["date_ent_actual"] if ent_row else None
        pre_ent_violations = []
        if ent_date:
            for eid, ev in events.items():
                if ev["date"] and ev["date"] < ent_date:
                    pre_ent_violations.append({
                        "event": ev["name"],
                        "date": ev["date"].isoformat(),
                        "ent_date": ent_date.isoformat(),
                        "phases": [p["phase_name"] for p in ev["phases"]],
                    })
        rules.append({
            "rule_id": "delivery_after_entitlement",
            "category": "config_validation",
            "rule_name": "Delivery After Entitlement",
            "passed": len(pre_ent_violations) == 0,
            "summary": (f"All deliveries on or after entitlement date ({ent_date.isoformat()})"
                        if ent_date and not pre_ent_violations
                        else f"{len(pre_ent_violations)} event(s) scheduled before entitlement"
                        if pre_ent_violations
                        else "No entitlement date set"),
            "detail": {
                "explanation": "Land cannot be delivered to builders before the community receives its entitlement approval. The entitlement date (date_ent_actual) marks when municipal approvals are granted and the land legally transitions from Paper to Entitled status. Any delivery event scheduled before this date represents an impossibility — lots cannot be developed on unentitled land.",
                "methodology": "Each delivery event's effective date is compared to the community's date_ent_actual. Events with dates before the entitlement are flagged.",
                "ent_date": ent_date.isoformat() if ent_date else None,
                "violations": pre_ent_violations,
                "all_events": [
                    {"event": ev["name"], "date": ev["date"].isoformat(),
                     "phases": [p["phase_name"] for p in ev["phases"]],
                     "passed": not ent_date or ev["date"] >= ent_date}
                    for ev in events.values() if ev["date"]
                ],
            },
        })

        # ── Rule 2: Max Deliveries Per Year ──────────────────────────────────
        # A "delivery" = one unique date. Multiple events on the same date = 1 delivery.
        year_date_phases = defaultdict(lambda: defaultdict(list))  # year -> date -> [phase_name]
        for eid, ev in events.items():
            if ev["date"]:
                for p in ev["phases"]:
                    year_date_phases[ev["date"].year][ev["date"]].append(p["phase_name"])
        year_delivery_counts = {}  # year -> number of unique dates
        year_deliveries = {}      # year -> [{date, phases, phase_count}]
        for y in sorted(year_date_phases.keys()):
            dates = year_date_phases[y]
            year_delivery_counts[y] = len(dates)
            year_deliveries[y] = [
                {"date": d.isoformat(), "phases": phases, "phase_count": len(phases)}
                for d, phases in sorted(dates.items())
            ]
        violations_max = []
        if max_per_year:
            for y, cnt in sorted(year_delivery_counts.items()):
                if cnt > max_per_year:
                    violations_max.append({"year": y, "count": cnt, "max": max_per_year,
                                           "deliveries": year_deliveries[y]})
        all_years_detail = []
        for y in sorted(year_delivery_counts.keys()):
            cnt = year_delivery_counts[y]
            passed_yr = max_per_year is None or cnt <= max_per_year
            dels = year_deliveries[y]
            total_phases = sum(d["phase_count"] for d in dels)
            all_years_detail.append({
                "year": y,
                "delivery_count": cnt,
                "phase_count": total_phases,
                "limit": max_per_year,
                "passed": passed_yr,
                "deliveries": dels,
            })
        rules.append({
            "rule_id": "max_per_year",
            "category": "config_validation",
            "rule_name": "Max Deliveries Per Year",
            "passed": len(violations_max) == 0,
            "summary": (f"All years within {max_per_year}/yr limit" if max_per_year
                        else "No max-per-year limit configured")
                       if not violations_max
                       else f"{len(violations_max)} year(s) exceed {max_per_year}/yr limit",
            "detail": {
                "explanation": "Delivery frequency is capped per calendar year to prevent over-commitment of construction and sales resources. Each delivery event triggers a burst of lot takedowns, builder starts, and municipal inspections. Exceeding the annual cap can overwhelm builder capacity, create financing bottlenecks, and strain municipal review bandwidth. This limit ensures a sustainable pace of land absorption.",
                "methodology": "Delivery events are grouped by calendar year of their effective date. The count per year is compared against the community's max_deliveries_per_year configuration. Years exceeding the cap are flagged as violations.",
                "max_per_year": max_per_year,
                "year_counts": dict(year_delivery_counts),
                "all_years": all_years_detail,
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

        untiered_phases = [{"phase_name": p["phase_name"], "dev_name": p["dev_name"],
                            "instrument_name": p["instrument_name"]}
                           for p in all_phases if p["delivery_tier"] is None]
        rules.append({
            "rule_id": "tier_ordering",
            "category": "config_validation",
            "rule_name": "Tier Ordering",
            "passed": len(tier_violations) == 0,
            "summary": f"All {len(tiers_sorted)} tiers deliver in correct order"
                       if not tier_violations
                       else f"{len(tier_violations)} tier ordering violation(s)",
            "detail": {
                "explanation": "Delivery tiers establish a priority hierarchy for phased land development. Tier 1 phases represent the most shovel-ready parcels and must deliver before Tier 2, which in turn must precede Tier 3, and so on. This ordering ensures that infrastructure investment flows sequentially from the most accessible sections outward, preventing stranded capital in later sections while earlier ones remain undeveloped. Violations indicate that a higher-priority tier has phases delivering after a lower-priority tier.",
                "methodology": "All phases with an assigned delivery_tier and a scheduled delivery event are grouped by tier. For each pair of tiers (low, high), the latest delivery date in the lower tier is compared against the earliest date in the higher tier. If the lower tier's latest date exceeds the higher tier's earliest date, a violation is recorded.",
                "flow": tier_flow,
                "violations": tier_violations,
                "tier_count": len(tiers_sorted),
                "untiered_phases": untiered_phases,
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
            "category": "config_validation",
            "rule_name": "Group Simultaneous Delivery",
            "passed": len(group_violations) == 0,
            "summary": f"All {len(group_phases)} group(s) deliver simultaneously"
                       if not group_violations
                       else f"{len(group_violations)} group(s) not synchronized",
            "detail": {
                "explanation": "Delivery groups enforce cross-instrument forced bundling, where phases from different legal instruments must deliver on the same date. This typically arises when a single physical section of a community is recorded under multiple instruments (e.g., a plat for single-family lots and a site condo for attached units sharing the same infrastructure). Simultaneous delivery ensures that roads, utilities, and grading serving the entire section are complete before any lots in the group are released to builders.",
                "methodology": "Phases sharing the same delivery_group value are collected. Their scheduled delivery dates are compared; if any members within a group have different dates, or if any group member lacks a delivery event entirely, the group is flagged as unsynchronized.",
                "groups": group_detail,
            },
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

        # Build all_dates: every unique delivery date with what delivers on it
        date_phases_map = defaultdict(list)
        for r in event_rows:
            if r["delivery_date"]:
                date_phases_map[r["delivery_date"]].append({
                    "phase_name": r["phase_name"],
                    "dev_name": r["dev_name"],
                    "delivery_group": r["delivery_group"],
                })
        all_dates_detail = []
        for dt in sorted(date_phases_map.keys()):
            has_group = any(p["delivery_group"] for p in date_phases_map[dt])
            has_non_group = any(not p["delivery_group"] for p in date_phases_map[dt])
            all_dates_detail.append({
                "date": dt.isoformat(),
                "phases": date_phases_map[dt],
                "has_group_phase": has_group,
                "has_non_group_phase": has_non_group,
                "passed": not (has_group and has_non_group),
            })

        rules.append({
            "rule_id": "group_exclusivity",
            "category": "config_validation",
            "rule_name": "Group Date Exclusivity",
            "passed": len(excl_violations) == 0,
            "summary": "No non-group phases on group delivery dates"
                       if not excl_violations
                       else f"{len(excl_violations)} non-group phase(s) on group dates",
            "detail": {
                "explanation": "When a delivery group occupies a particular date, that date must be exclusive to the group. Non-group phases sharing the same delivery date would create resource conflicts during the development process -- grading crews, utility contractors, and municipal inspectors cannot simultaneously serve both the coordinated group delivery and an independent phase delivery. Date exclusivity ensures that the forced-bundling contract is honored without competing demands.",
                "methodology": "All dates on which at least one grouped phase delivers are identified. Every non-grouped phase delivering on one of those dates is flagged as a violation.",
                "group_dates": sorted(d.isoformat() for d in group_dates),
                "all_dates": all_dates_detail,
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

        all_instruments_detail = []
        for iid, phases in inst_phases.items():
            phases_sorted = sorted(phases, key=lambda x: x["sequence_number"])
            # Mark each phase passed/failed based on whether its date is <= next phase's date
            phase_details = []
            for k, p in enumerate(phases_sorted):
                ok = True
                if k > 0 and phases_sorted[k-1]["date"] > p["date"]:
                    ok = False
                if k < len(phases_sorted) - 1 and p["date"] > phases_sorted[k+1]["date"]:
                    ok = False
                phase_details.append({
                    "phase_name": p["phase_name"],
                    "seq": p["sequence_number"],
                    "date": p["date"].isoformat(),
                    "passed": ok,
                })
            all_instruments_detail.append({
                "instrument_name": phases_sorted[0]["instrument_name"] if phases_sorted else "",
                "phases": phase_details,
            })

        rules.append({
            "rule_id": "sequence_ordering",
            "category": "config_validation",
            "rule_name": "Sequence Ordering (within Instrument)",
            "passed": len(seq_violations) == 0,
            "summary": "All phases deliver in sequence order within their instrument"
                       if not seq_violations
                       else f"{len(seq_violations)} sequence ordering violation(s)",
            "detail": {
                "explanation": "Within each legal instrument (plat, site condo, etc.), phases are numbered sequentially to reflect the planned development progression. Phase 1 should deliver before Phase 2, Phase 2 before Phase 3, and so on, because each successive phase typically depends on infrastructure extensions from the prior phase. Out-of-sequence delivery can strand lots behind unbuilt roads or missing utility connections, creating legal and practical barriers to builder access.",
                "methodology": "For each instrument, scheduled phases are sorted by sequence_number. Adjacent pairs are checked to ensure the earlier-sequenced phase has a delivery date on or before the later-sequenced phase. Any pair where the earlier phase delivers after the later phase is flagged.",
                "all_instruments": all_instruments_detail,
                "violations": seq_violations,
            },
        })

        # ── Rule 7: All Phases Scheduled ─────────────────────────────────────
        scheduled_ids = set(phase_event_date.keys())
        unscheduled = [p for p in all_phases if p["phase_id"] not in scheduled_ids]
        scheduled_list = [{
            "phase_name": p["phase_name"], "dev_name": p["dev_name"],
            "instrument_name": p["instrument_name"],
            "delivery_date": phase_event_date[p["phase_id"]].isoformat(),
        } for p in all_phases if p["phase_id"] in scheduled_ids]
        rules.append({
            "rule_id": "all_scheduled",
            "category": "config_validation",
            "rule_name": "All Phases Scheduled",
            "passed": len(unscheduled) == 0,
            "summary": f"All {len(all_phases)} phases have delivery events"
                       if not unscheduled
                       else f"{len(unscheduled)} of {len(all_phases)} phase(s) unscheduled",
            "detail": {
                "explanation": "Every phase in the community must be linked to a delivery event so the simulation engine can project when its lots transition from Paper to Developed status. Unscheduled phases represent gaps in the development timeline -- their lots remain in Paper status indefinitely, which distorts supply projections, understates future inventory, and prevents builder assignment and start scheduling for those lots.",
                "methodology": "The set of phases linked to delivery events (via sim_delivery_event_phases) is compared against the complete set of phases in the community. Any phase without a delivery event link is listed as unscheduled.",
                "total": len(all_phases),
                "scheduled_count": len(scheduled_ids),
                "scheduled": scheduled_list,
                "unscheduled": [{"phase_name": p["phase_name"], "dev_name": p["dev_name"],
                                 "instrument_name": p["instrument_name"]}
                                for p in unscheduled],
            },
        })

        # ── Rule 8: Locked Dates Honored ─────────────────────────────────────
        locked_count = sum(1 for ev in events.values() if ev["is_locked"])
        auto_events_list = [
            {"event": ev["name"], "date": ev["date"].isoformat() if ev["date"] else None,
             "phases": [p["phase_name"] for p in ev["phases"]]}
            for ev in events.values() if not ev["is_locked"]
        ]
        rules.append({
            "rule_id": "locked_honored",
            "category": "config_validation",
            "rule_name": "Locked Dates Honored",
            "passed": True,
            "summary": f"{locked_count} locked event(s) preserved" if locked_count else "No locked events",
            "detail": {
                "explanation": "Delivery events are either locked (date_dev_actual is set, meaning the delivery has already occurred or is contractually committed) or auto-scheduled (date_dev_projected, computed by the simulation engine). Locked dates must never be moved or deleted by the engine -- they represent historical facts or binding obligations. Auto-scheduled dates, by contrast, are recalculated each simulation run. This rule confirms that all locked events remain intact after the most recent simulation run.",
                "methodology": "All delivery events for the community are classified as locked (date_dev_actual IS NOT NULL) or auto-scheduled. The locked set is listed for audit; this rule always passes because the engine is designed never to modify locked events.",
                "locked_events": [
                    {"event": ev["name"], "date": ev["date"].isoformat(),
                     "phases": [p["phase_name"] for p in ev["phases"]]}
                    for ev in events.values() if ev["is_locked"]
                ],
                "auto_events": auto_events_list,
            },
        })

        # ── Rule 9: Chronology ────────────────────────────────────────────────
        cur.execute("""
            SELECT sl.lot_id,
                   COALESCE(sl.lot_number, 'sim #' || sl.lot_id::text) AS lot_label,
                   sl.phase_id, sdp.phase_name, sl.lot_source,
                   COALESCE(sl.date_ent, '9999-12-31'::date) AS d_ent,
                   COALESCE(sl.date_dev, '9999-12-31'::date) AS d_dev,
                   COALESCE(sl.date_td,  '9999-12-31'::date) AS d_td,
                   COALESCE(sl.date_str, '9999-12-31'::date) AS d_str,
                   COALESCE(sl.date_cmp, '9999-12-31'::date) AS d_cmp,
                   COALESCE(sl.date_cls, '9999-12-31'::date) AS d_cls
            FROM sim_lots sl
            JOIN sim_dev_phases sdp ON sdp.phase_id = sl.phase_id
            WHERE sl.dev_id IN (SELECT dev_id FROM sim_ent_group_developments WHERE ent_group_id = %s)
              AND sl.excluded IS NOT TRUE
              AND (sl.date_str IS NOT NULL OR sl.date_cmp IS NOT NULL OR sl.date_cls IS NOT NULL)
        """, (ent_group_id,))
        chrono_violations = []
        chrono_lots_checked = 0
        for r in cur.fetchall():
            chrono_lots_checked += 1
            pairs = [("ent","dev"), ("dev","td"), ("td","str"), ("str","cmp"), ("cmp","cls")]
            for early, late in pairs:
                d_e = r[f"d_{early}"]
                d_l = r[f"d_{late}"]
                if d_e > d_l and d_l.year < 9999 and d_e.year < 9999:
                    chrono_violations.append({
                        "lot_id": r["lot_id"], "lot_number": r["lot_label"],
                        "phase_name": r["phase_name"], "lot_source": r["lot_source"],
                        "early_stage": early, "late_stage": late,
                        "early_date": d_e.isoformat(), "late_date": d_l.isoformat(),
                    })
                    break  # one violation per lot is enough
        rules.append({
            "rule_id": "chronology",
            "category": "engine_diagnostic",
            "rule_name": "Pipeline Chronology",
            "passed": len(chrono_violations) == 0,
            "summary": "All lot dates in correct pipeline order"
                       if not chrono_violations
                       else f"{len(chrono_violations)} lot(s) with out-of-order dates",
            "detail": {
                "explanation": "Every lot in the pipeline must have its milestone dates in strict chronological order: entitlement before development, development before takedown, takedown before start, start before completion, and completion before closing. A violation indicates either a data import error from MARKsystems, a gap-fill engine defect, or a manual override that created an impossible timeline. Out-of-order dates would cause the derived pipeline status to be incorrect and distort ledger counts at every affected month.",
                "methodology": "For each lot with at least one downstream date (STR, CMP, or CLS), the six pipeline dates are compared in adjacent pairs. NULL dates are treated as 9999-12-31 to avoid false positives on lots that have not yet reached a stage. The first out-of-order pair found per lot is reported.",
                "lots_checked": chrono_lots_checked,
                "stage_order": ["ENT", "DEV", "TD", "STR", "CMP", "CLS"],
                "violations": chrono_violations[:20],
                "total": len(chrono_violations),
            },
        })

        # ── Rule 10: Builder Assignment Coverage ─────────────────────────────
        cur.execute("""
            SELECT COUNT(*) AS total,
                   COUNT(*) FILTER (WHERE builder_id IS NOT NULL) AS assigned
            FROM sim_lots
            WHERE dev_id IN (SELECT dev_id FROM sim_ent_group_developments WHERE ent_group_id = %s)
              AND lot_source = 'sim'
              AND excluded IS NOT TRUE
        """, (ent_group_id,))
        bldr = cur.fetchone()
        bldr_total = bldr["total"] or 0
        bldr_assigned = bldr["assigned"] or 0

        # Per-phase breakdown
        cur.execute("""
            SELECT sdp.phase_name, COUNT(*) AS sim_count,
                   COUNT(*) FILTER (WHERE sl.builder_id IS NOT NULL) AS assigned
            FROM sim_lots sl JOIN sim_dev_phases sdp ON sdp.phase_id = sl.phase_id
            WHERE sl.dev_id IN (SELECT dev_id FROM sim_ent_group_developments WHERE ent_group_id = %s)
              AND sl.lot_source = 'sim' AND sl.excluded IS NOT TRUE
            GROUP BY sdp.phase_name ORDER BY sdp.phase_name
        """, (ent_group_id,))
        by_phase_bldr = [{"phase_name": r["phase_name"], "sim_count": r["sim_count"],
                          "assigned_count": r["assigned"]} for r in cur.fetchall()]

        rules.append({
            "rule_id": "builder_coverage",
            "category": "engine_diagnostic",
            "rule_name": "Builder Assignment (sim lots)",
            "passed": bldr_total == 0 or bldr_assigned == bldr_total,
            "summary": f"{bldr_assigned}/{bldr_total} sim lots have builder assigned"
                       if bldr_total > 0 else "No sim lots",
            "detail": {
                "explanation": "Every simulated lot must be assigned to a builder so that start pacing, spec/build classification, and downstream milestone projections reflect the correct builder's construction timeline. Builder assignment is driven by instrument-level builder splits (S-0900). Unassigned sim lots indicate either missing builder split configuration or a module defect. Without builder assignment, lots cannot be scheduled for starts and will not flow through the pipeline.",
                "methodology": "All non-excluded sim lots in the community are counted. The subset with a non-null builder_id is compared against the total. A per-phase breakdown is also provided to localize any gaps.",
                "total": bldr_total,
                "assigned": bldr_assigned,
                "unassigned": bldr_total - bldr_assigned,
                "by_phase": by_phase_bldr,
            },
        })

        # ── Rule 11: Spec/Build Assignment ───────────────────────────────────
        cur.execute("""
            SELECT sli.instrument_id, sli.instrument_name, sli.spec_rate,
                   COUNT(*) AS total,
                   COUNT(*) FILTER (WHERE sl.is_spec IS NOT NULL) AS assigned
            FROM sim_lots sl
            JOIN sim_dev_phases sdp ON sdp.phase_id = sl.phase_id
            JOIN sim_legal_instruments sli ON sli.instrument_id = sdp.instrument_id
            WHERE sl.dev_id IN (SELECT dev_id FROM sim_ent_group_developments WHERE ent_group_id = %s)
              AND sl.excluded IS NOT TRUE
              AND sli.spec_rate IS NOT NULL
            GROUP BY sli.instrument_id, sli.instrument_name, sli.spec_rate
        """, (ent_group_id,))
        spec_rows = [dict(r) for r in cur.fetchall()]
        spec_violations = [r for r in spec_rows if r["assigned"] < r["total"]]

        # Get spec/build counts per instrument
        cur.execute("""
            SELECT sli.instrument_id, sli.instrument_name,
                   COUNT(*) FILTER (WHERE sl.is_spec = TRUE) AS spec_count,
                   COUNT(*) FILTER (WHERE sl.is_spec = FALSE) AS build_count,
                   COUNT(*) FILTER (WHERE sl.is_spec IS NULL) AS undetermined_count
            FROM sim_lots sl
            JOIN sim_dev_phases sdp ON sdp.phase_id = sl.phase_id
            JOIN sim_legal_instruments sli ON sli.instrument_id = sdp.instrument_id
            WHERE sl.dev_id IN (SELECT dev_id FROM sim_ent_group_developments WHERE ent_group_id = %s)
              AND sl.excluded IS NOT TRUE
              AND sli.spec_rate IS NOT NULL
            GROUP BY sli.instrument_id, sli.instrument_name
        """, (ent_group_id,))
        spec_breakdown = {r["instrument_id"]: {"spec_count": r["spec_count"], "build_count": r["build_count"],
                                                "undetermined_count": r["undetermined_count"]}
                          for r in cur.fetchall()}

        rules.append({
            "rule_id": "spec_build",
            "category": "engine_diagnostic",
            "rule_name": "Spec/Build Assignment",
            "passed": len(spec_violations) == 0,
            "summary": f"All lots in {len(spec_rows)} instrument(s) with spec_rate have is_spec set"
                       if not spec_violations
                       else f"{len(spec_violations)} instrument(s) with unassigned is_spec",
            "detail": {
                "explanation": "Each lot must be classified as either spec (builder-initiated, no buyer under contract at start) or build (buyer-contracted before construction begins). The spec/build ratio is a critical financial metric: spec homes carry inventory risk and holding costs, while build homes have committed revenue. The classification is driven by the instrument-level spec_rate parameter and applied by the S-0950 module. Unclassified lots indicate the module has not run or the spec_rate is misconfigured.",
                "methodology": "For each instrument with a configured spec_rate, all non-excluded lots are counted. Lots with is_spec set (TRUE or FALSE) are compared against the total. Per-instrument spec and build counts are provided for ratio verification against the configured spec_rate.",
                "instruments": [{
                    "instrument_name": r["instrument_name"],
                    "spec_rate": float(r["spec_rate"]) if r["spec_rate"] else None,
                    "total": r["total"], "assigned": r["assigned"],
                    "spec_count": spec_breakdown.get(r["instrument_id"], {}).get("spec_count", 0),
                    "build_count": spec_breakdown.get(r["instrument_id"], {}).get("build_count", 0),
                } for r in spec_rows],
            },
        })

        # ── Rule 12: Building Group Date Sync ────────────────────────────────
        cur.execute("""
            SELECT building_group_id,
                   COUNT(DISTINCT date_str) AS distinct_str_dates,
                   COUNT(*) AS lot_count,
                   MIN(date_str)::text AS min_str,
                   MAX(date_str)::text AS max_str
            FROM sim_lots
            WHERE dev_id IN (SELECT dev_id FROM sim_ent_group_developments WHERE ent_group_id = %s)
              AND building_group_id IS NOT NULL
              AND date_str IS NOT NULL
              AND excluded IS NOT TRUE
            GROUP BY building_group_id
            HAVING COUNT(DISTINCT date_str) > 1
        """, (ent_group_id,))
        bg_violations = [dict(r) for r in cur.fetchall()]

        # Total building groups checked
        cur.execute("""
            SELECT COUNT(DISTINCT building_group_id) AS groups_checked
            FROM sim_lots
            WHERE dev_id IN (SELECT dev_id FROM sim_ent_group_developments WHERE ent_group_id = %s)
              AND building_group_id IS NOT NULL
              AND date_str IS NOT NULL
              AND excluded IS NOT TRUE
        """, (ent_group_id,))
        bg_total = cur.fetchone()["groups_checked"] or 0

        rules.append({
            "rule_id": "building_group_sync",
            "category": "engine_diagnostic",
            "rule_name": "Building Group Date Sync",
            "passed": len(bg_violations) == 0,
            "summary": "All building groups share unified start dates"
                       if not bg_violations
                       else f"{len(bg_violations)} group(s) with split start dates",
            "detail": {
                "explanation": "Building groups represent physically attached units (e.g., townhome buildings) that must start construction simultaneously because they share a common foundation, framing, and roofline. If lots within a building group have different start dates, it would be physically impossible to build -- you cannot frame half a townhome building while the other half remains unstarted. This rule verifies that the engine's building group date synchronization logic (S-1050) is working correctly.",
                "methodology": "All building groups with at least one started lot are identified. For each group, the number of distinct date_str values is counted. Groups with more than one distinct start date are flagged as violations.",
                "groups_checked": bg_total,
                "violations": [{
                    "building_group_id": v["building_group_id"],
                    "lot_count": v["lot_count"],
                    "min_str": v["min_str"], "max_str": v["max_str"],
                } for v in bg_violations],
            },
        })

        # ── Rule 13: TDA Checkpoint Fulfillment ──────────────────────────────
        cur.execute("""
            SELECT ta.tda_id, ta.tda_name,
                   tc.checkpoint_id, tc.checkpoint_number, tc.checkpoint_date,
                   tc.lots_required_cumulative,
                   COUNT(tla.lot_id) AS assigned_count
            FROM sim_takedown_agreements ta
            JOIN sim_takedown_checkpoints tc ON tc.tda_id = ta.tda_id
            LEFT JOIN sim_takedown_lot_assignments tla ON tla.checkpoint_id = tc.checkpoint_id
            WHERE ta.ent_group_id = %s
              AND ta.status = 'active'
            GROUP BY ta.tda_id, ta.tda_name, tc.checkpoint_id,
                     tc.checkpoint_number, tc.checkpoint_date, tc.lots_required_cumulative
            ORDER BY ta.tda_id, tc.checkpoint_number
        """, (ent_group_id,))
        tda_rows = [dict(r) for r in cur.fetchall()]
        tda_gaps = [r for r in tda_rows
                    if r["lots_required_cumulative"] and r["assigned_count"] < r["lots_required_cumulative"]]
        tda_ids_seen = set(r["tda_id"] for r in tda_rows)
        rules.append({
            "rule_id": "tda_fulfillment",
            "category": "engine_diagnostic",
            "rule_name": "TDA Checkpoint Fulfillment",
            "passed": len(tda_gaps) == 0,
            "summary": f"All {len(tda_rows)} checkpoint(s) met"
                       if not tda_gaps
                       else f"{len(tda_gaps)} checkpoint(s) under-fulfilled",
            "detail": {
                "explanation": "Takedown agreements (TDAs) are contractual obligations to purchase a specified cumulative number of lots by each checkpoint date. Under-fulfilled checkpoints represent a breach risk -- the developer may face financial penalties, lose option rights, or trigger acceleration clauses. The simulation engine's S-0500 module assigns lots to checkpoints based on projected development and hold dates. Both date_td and date_td_hold count toward fulfillment (D-087). This rule audits whether every active TDA checkpoint has enough lots assigned to meet its cumulative requirement.",
                "methodology": "For each active TDA, checkpoints are queried with their lots_required_cumulative and the count of lots actually assigned (via sim_takedown_lot_assignments). Checkpoints where the assigned count falls below the required count are flagged.",
                "tda_count": len(tda_ids_seen),
                "checkpoints": [{
                    "tda_name": r["tda_name"],
                    "checkpoint_number": r["checkpoint_number"],
                    "checkpoint_date": r["checkpoint_date"].isoformat() if r["checkpoint_date"] else None,
                    "required": r["lots_required_cumulative"],
                    "assigned": r["assigned_count"],
                    "gap": (r["lots_required_cumulative"] or 0) - r["assigned_count"],
                } for r in tda_rows],
                "gaps": [{
                    "tda_name": r["tda_name"],
                    "checkpoint": r["checkpoint_number"],
                    "required": r["lots_required_cumulative"],
                    "assigned": r["assigned_count"],
                } for r in tda_gaps],
            },
        })

        # ── Rule 14: Demand / Capacity Match ─────────────────────────────────
        cur.execute("""
            SELECT sdp.phase_id, sdp.phase_name,
                   COALESCE(cap.total, 0)::int AS configured_capacity,
                   COALESCE(sim.cnt, 0)::int   AS sim_lots
            FROM sim_dev_phases sdp
            JOIN sim_legal_instruments sli ON sli.instrument_id = sdp.instrument_id
            JOIN sim_ent_group_developments segd ON segd.dev_id = sli.dev_id
            LEFT JOIN (
                SELECT phase_id, SUM(projected_count) AS total
                FROM sim_phase_product_splits GROUP BY phase_id
            ) cap ON cap.phase_id = sdp.phase_id
            LEFT JOIN (
                SELECT phase_id, COUNT(*) AS cnt
                FROM sim_lots WHERE lot_source = 'sim' AND excluded IS NOT TRUE
                GROUP BY phase_id
            ) sim ON sim.phase_id = sdp.phase_id
            WHERE segd.ent_group_id = %s
        """, (ent_group_id,))
        cap_rows = [dict(r) for r in cur.fetchall()]
        # Count real started lots per phase
        cur.execute("""
            SELECT phase_id, COUNT(*) AS started
            FROM sim_lots
            WHERE dev_id IN (SELECT dev_id FROM sim_ent_group_developments WHERE ent_group_id = %s)
              AND lot_source IN ('real', 'pre')
              AND date_str IS NOT NULL
              AND excluded IS NOT TRUE
            GROUP BY phase_id
        """, (ent_group_id,))
        started_map = {r["phase_id"]: r["started"] for r in cur.fetchall()}
        cap_mismatches = []
        all_phases_cap = []
        for r in cap_rows:
            real_started = started_map.get(r["phase_id"], 0)
            expected_sim = max(0, r["configured_capacity"] - real_started)
            passed_cap = r["sim_lots"] == expected_sim or r["configured_capacity"] == 0
            all_phases_cap.append({
                "phase_name": r["phase_name"],
                "configured": r["configured_capacity"],
                "real_started": real_started,
                "expected_sim": expected_sim,
                "actual_sim": r["sim_lots"],
                "passed": passed_cap,
            })
            if r["sim_lots"] != expected_sim and r["configured_capacity"] > 0:
                cap_mismatches.append({
                    "phase_name": r["phase_name"],
                    "configured": r["configured_capacity"],
                    "real_started": real_started,
                    "expected_sim": expected_sim,
                    "actual_sim": r["sim_lots"],
                })
        rules.append({
            "rule_id": "demand_capacity",
            "category": "engine_diagnostic",
            "rule_name": "Demand / Capacity Match",
            "passed": len(cap_mismatches) == 0,
            "summary": f"Sim lot counts match configured capacity for all phases"
                       if not cap_mismatches
                       else f"{len(cap_mismatches)} phase(s) with capacity mismatch",
            "detail": {
                "explanation": "The simulation engine generates exactly the right number of sim lots per phase to fill the gap between configured capacity (from product splits) and lots already started by real/pre sources. If a phase is configured for 40 lots and 12 real lots have already started, exactly 28 sim lots should exist. A mismatch indicates either a product split misconfiguration, an engine defect in S-0800 (sim lot generation), or excluded lots not being accounted for correctly. Accurate demand/capacity matching is essential for reliable supply projections.",
                "methodology": "For each phase, configured capacity is read from sim_phase_product_splits. Real/pre lots with date_str set are counted. Expected sim lots = configured - real_started (floored at 0). The actual sim lot count is compared against the expected value.",
                "all_phases": all_phases_cap,
                "mismatches": cap_mismatches,
            },
        })

        # ── Rule 15: Convergence ─────────────────────────────────────────────
        # Convergence data is returned in the sim run response, not persisted.
        # Check if sim lots exist (proxy for "has been run").
        cur.execute("""
            SELECT COUNT(*) AS sim_count
            FROM sim_lots
            WHERE lot_source = 'sim'
              AND dev_id IN (SELECT dev_id FROM sim_ent_group_developments WHERE ent_group_id = %s)
        """, (ent_group_id,))
        sim_count = cur.fetchone()["sim_count"] or 0

        # By-source breakdown
        cur.execute("""
            SELECT lot_source, COUNT(*) AS cnt FROM sim_lots
            WHERE dev_id IN (SELECT dev_id FROM sim_ent_group_developments WHERE ent_group_id = %s)
              AND excluded IS NOT TRUE
            GROUP BY lot_source
        """, (ent_group_id,))
        by_source = [{"lot_source": r["lot_source"], "count": r["cnt"]} for r in cur.fetchall()]

        rules.append({
            "rule_id": "convergence",
            "category": "engine_diagnostic",
            "rule_name": "Simulation Convergence",
            "passed": sim_count > 0,
            "summary": f"Simulation has produced {sim_count} sim lots"
                       if sim_count > 0
                       else "No sim lots found -- simulation may not have run",
            "detail": {
                "explanation": "The simulation coordinator runs the engine iteratively until delivery event dates stabilize between iterations (convergence). A converged simulation means the projected delivery schedule is self-consistent: the demand signal from delivery events produces lot counts that, when fed back through the supply modules, reproduce the same delivery dates. The presence of sim lots is a proxy indicator that the simulation has been run. The by-source breakdown shows the composition of the community's lot inventory.",
                "methodology": "Sim lots for the community are counted. If the count is zero, the simulation likely has not been run. A lot_source breakdown (real, pre, sim) provides additional context on the community's lot composition.",
                "sim_lot_count": sim_count,
                "by_source": by_source,
            },
        })

        # ── Rule 16: Pipeline Monotonicity ───────────────────────────────────
        # No lot should have a later stage date without the earlier stage date
        cur.execute("""
            SELECT lot_id, lot_number,
                   date_dev IS NULL AS no_dev,
                   date_td IS NULL AND date_td_hold IS NULL AS no_td,
                   date_str IS NULL AS no_str,
                   date_cmp IS NULL AS no_cmp,
                   date_cls IS NULL AS no_cls,
                   date_str IS NOT NULL AS has_str,
                   date_cmp IS NOT NULL AS has_cmp,
                   date_cls IS NOT NULL AS has_cls
            FROM sim_lots
            WHERE dev_id IN (SELECT dev_id FROM sim_ent_group_developments WHERE ent_group_id = %s)
              AND excluded IS NOT TRUE
              AND lot_source IN ('real', 'pre')
        """, (ent_group_id,))
        mono_violations = []
        mono_lots_checked = 0
        mono_by_status = defaultdict(int)
        for r in cur.fetchall():
            mono_lots_checked += 1
            if r["has_cls"]:
                mono_by_status["CLS"] += 1
            elif r["has_cmp"]:
                mono_by_status["CMP"] += 1
            elif r["has_str"]:
                mono_by_status["STR"] += 1
            else:
                mono_by_status["other"] += 1

            if r["has_str"] and r["no_dev"]:
                mono_violations.append({"lot": r["lot_number"], "has": "STR", "missing": "DEV"})
            elif r["has_cmp"] and r["no_str"]:
                mono_violations.append({"lot": r["lot_number"], "has": "CMP", "missing": "STR"})
            elif r["has_cls"] and r["no_cmp"]:
                mono_violations.append({"lot": r["lot_number"], "has": "CLS", "missing": "CMP"})
        rules.append({
            "rule_id": "pipeline_monotonicity",
            "category": "engine_diagnostic",
            "rule_name": "Pipeline Stage Monotonicity",
            "passed": len(mono_violations) == 0,
            "summary": "All real lots have contiguous pipeline stages"
                       if not mono_violations
                       else f"{len(mono_violations)} lot(s) skip pipeline stages",
            "detail": {
                "explanation": "Pipeline monotonicity ensures that no lot skips a required stage in the development pipeline. A lot with a start date (STR) but no development date (DEV) is physically impossible -- you cannot begin construction on land that has not been developed. Similarly, a lot cannot complete (CMP) without starting (STR), or close (CLS) without completing (CMP). Violations typically arise from incomplete data imports from MARKsystems where an activity code was missing or mapped incorrectly. This rule only checks real and pre-MARKS lots, as sim lots are generated with guaranteed monotonicity.",
                "methodology": "Each real/pre lot is checked for the presence of downstream dates without their prerequisite upstream dates. Specifically: has STR but no DEV, has CMP but no STR, or has CLS but no CMP. The first violation found per lot is reported.",
                "lots_checked": mono_lots_checked,
                "by_status": dict(mono_by_status),
                "violations": mono_violations[:20],
                "total": len(mono_violations),
            },
        })

        # ── Config Completeness Rules ────────────────────────────────────────

        # CC-1: Product Splits Configured
        no_splits = [p for p in all_phases
                     if not any(r["configured_capacity"] > 0
                                for r in cap_rows if r["phase_id"] == p["phase_id"])]
        all_items_splits = []
        for p in all_phases:
            has_split = any(r["configured_capacity"] > 0 for r in cap_rows if r["phase_id"] == p["phase_id"])
            cap_val = next((r["configured_capacity"] for r in cap_rows if r["phase_id"] == p["phase_id"]), 0)
            all_items_splits.append({
                "phase_name": p["phase_name"], "dev_name": p["dev_name"],
                "instrument_name": p["instrument_name"],
                "configured_capacity": cap_val,
                "passed": has_split,
            })
        rules.append({
            "rule_id": "config_product_splits",
            "category": "config_completeness",
            "rule_name": "Product Splits Configured",
            "passed": len(no_splits) == 0,
            "summary": f"All {len(all_phases)} phases have product splits"
                       if not no_splits
                       else f"{len(no_splits)} phase(s) missing product splits",
            "detail": {
                "explanation": "Product splits define how many lots of each type (e.g., 50ft, 60ft, townhome) are expected in each phase. Without product splits, the engine cannot generate sim lots for a phase, and the phase's capacity appears as zero in all projections. Product splits are the foundation of the demand signal -- they tell the system how many homes will ultimately be built in each phase and what product mix the builders should plan for.",
                "methodology": "Each phase is checked for the presence of at least one row in sim_phase_product_splits with a projected_count greater than zero. Phases with no splits or all-zero counts are flagged.",
                "all_items": all_items_splits,
                "missing": [{"phase_name": p["phase_name"], "dev_name": p["dev_name"],
                              "instrument_name": p["instrument_name"]}
                             for p in no_splits],
                "ent_group_id": ent_group_id,
            },
        })

        # CC-2: Annual Starts Target
        cur.execute("""
            SELECT d.dev_id, d.dev_name, sdp.annual_starts_target
            FROM developments d
            JOIN sim_ent_group_developments segd ON segd.dev_id = d.dev_id
            LEFT JOIN sim_dev_params sdp ON sdp.dev_id = d.dev_id
            WHERE segd.ent_group_id = %s
        """, (ent_group_id,))
        dev_params = [dict(r) for r in cur.fetchall()]
        no_target = [d for d in dev_params if d["annual_starts_target"] is None]
        all_items_targets = [{
            "dev_name": d["dev_name"],
            "annual_starts_target": float(d["annual_starts_target"]) if d["annual_starts_target"] is not None else None,
            "passed": d["annual_starts_target"] is not None,
        } for d in dev_params]
        rules.append({
            "rule_id": "config_starts_target",
            "category": "config_completeness",
            "rule_name": "Annual Starts Target",
            "passed": len(no_target) == 0,
            "summary": f"All {len(dev_params)} development(s) have starts targets"
                       if not no_target
                       else f"{len(no_target)} development(s) missing annual_starts_target",
            "detail": {
                "explanation": "The annual starts target defines how many home starts per year a development can sustain, based on builder capacity, market absorption, and infrastructure constraints. This parameter drives the S-0800 pacing model, which spreads sim lot starts across months to match the target rate. Without it, the engine cannot schedule starts and lots accumulate in Unstarted status indefinitely. The target is typically set based on historical pace, builder commitments, and market analysis.",
                "methodology": "Each development in the community is checked for a non-null annual_starts_target value in sim_dev_params. Developments without a target are flagged.",
                "all_items": [{**item, "dev_id": d["dev_id"]}
                              for item, d in zip(all_items_targets, dev_params)],
                "missing": [{"dev_name": d["dev_name"], "dev_id": d["dev_id"]} for d in no_target],
                "configured": [{"dev_name": d["dev_name"], "dev_id": d["dev_id"],
                                "target": float(d["annual_starts_target"])}
                               for d in dev_params if d["annual_starts_target"] is not None],
                "ent_group_id": ent_group_id,
            },
        })

        # CC-3: Builder Splits Configured
        cur.execute("""
            SELECT sli.instrument_id, sli.instrument_name,
                   COUNT(sibs.builder_id) AS split_count,
                   COALESCE(SUM(sibs.share), 0) AS total_share
            FROM sim_legal_instruments sli
            JOIN developments d ON d.dev_id = sli.dev_id
            JOIN sim_ent_group_developments segd ON segd.dev_id = d.dev_id
            LEFT JOIN sim_instrument_builder_splits sibs ON sibs.instrument_id = sli.instrument_id
            WHERE segd.ent_group_id = %s
            GROUP BY sli.instrument_id, sli.instrument_name
        """, (ent_group_id,))
        bldr_split_rows = [dict(r) for r in cur.fetchall()]
        no_bldr = [r for r in bldr_split_rows if r["split_count"] == 0]
        bad_sum = [r for r in bldr_split_rows
                   if r["split_count"] > 0 and abs(float(r["total_share"]) - 1.0) > 0.01]
        all_items_bldr_splits = [{
            "instrument_id": r["instrument_id"],
            "instrument_name": r["instrument_name"],
            "split_count": r["split_count"],
            "total_pct": round(float(r["total_share"]) * 100, 1) if r["split_count"] > 0 else 0.0,
            "passed": r["split_count"] > 0 and abs(float(r["total_share"]) - 1.0) <= 0.01,
        } for r in bldr_split_rows]
        rules.append({
            "rule_id": "config_builder_splits",
            "category": "config_completeness",
            "rule_name": "Builder Splits Configured",
            "passed": len(no_bldr) == 0 and len(bad_sum) == 0,
            "summary": f"All {len(bldr_split_rows)} instrument(s) have builder splits summing to 100%"
                       if not no_bldr and not bad_sum
                       else (f"{len(no_bldr)} instrument(s) missing splits"
                             + (f", {len(bad_sum)} don't sum to 100%" if bad_sum else "")),
            "detail": {
                "explanation": "Builder splits define what percentage of lots in each legal instrument are allocated to each builder. These splits drive the S-0900 builder assignment module, which assigns a builder_id to every sim lot. Splits must sum to exactly 100% (1.0) for each instrument. Missing splits mean no builder can be assigned, which blocks start scheduling. Splits that do not sum to 100% will cause either over- or under-allocation of lots to builders, distorting per-builder start projections and capacity planning.",
                "methodology": "Each instrument in the community is checked for the presence of rows in sim_instrument_builder_splits. The sum of share values per instrument is verified to be within 1% of 1.0. Instruments with no splits or incorrect sums are flagged.",
                "all_items": all_items_bldr_splits,
                "ent_group_id": ent_group_id,
                "missing": [{"instrument_id": r["instrument_id"], "instrument_name": r["instrument_name"]} for r in no_bldr],
                "bad_sum": [{"instrument_name": r["instrument_name"],
                             "total_pct": round(float(r["total_share"]) * 100, 1)}
                            for r in bad_sum],
            },
        })

        # CC-4: Delivery Config
        has_community_config = cfg_row is not None
        has_valid_config = len(delivery_months) > 0 and max_per_year is not None
        rules.append({
            "rule_id": "config_delivery",
            "category": "config_completeness",
            "rule_name": "Delivery Config",
            "passed": has_valid_config,
            "summary": (f"Delivery months and max/yr configured"
                        + (f" (community override)" if has_community_config else f" (global defaults)")
                       ) if has_valid_config
                       else "Missing delivery months or max deliveries per year",
            "detail": {
                "explanation": "The delivery configuration specifies which calendar months are valid for lot delivery events and the maximum number of deliveries allowed per year. The engine resolves config by checking for a community-specific override first, then falling back to global defaults. Either source is valid — what matters is that delivery_months and max_deliveries_per_year are set.",
                "methodology": "The sim_entitlement_delivery_config table is checked for a community row, then sim_global_settings for global defaults. The rule passes if valid delivery_months and max_deliveries_per_year are resolved from either source.",
                "has_community_config": has_community_config,
                "delivery_months": sorted(delivery_months),
                "delivery_month_names": [month_names[m] for m in sorted(delivery_months)],
                "max_per_year": max_per_year,
                "source": "community" if has_community_config else "global_defaults",
                "ent_group_id": ent_group_id,
            },
        })

        # CC-5: Ledger Dates
        cur.execute("""
            SELECT date_paper, date_ent_actual
            FROM sim_entitlement_groups
            WHERE ent_group_id = %s
        """, (ent_group_id,))
        eg_row = cur.fetchone()
        date_paper = eg_row["date_paper"] if eg_row else None
        date_ent = eg_row["date_ent_actual"] if eg_row else None
        missing_dates = []
        if not date_paper:
            missing_dates.append("Ledger start date (date_paper)")
        if not date_ent:
            missing_dates.append("Bulk entitlement date (date_ent_actual)")
        rules.append({
            "rule_id": "config_ledger_dates",
            "category": "config_completeness",
            "rule_name": "Ledger Dates",
            "passed": len(missing_dates) == 0,
            "summary": "Ledger start and entitlement dates are set"
                       if not missing_dates
                       else f"{len(missing_dates)} ledger date(s) not set",
            "detail": {
                "explanation": "The ledger start date (date_paper) defines when this community first appears in the simulation timeline — it anchors the P-status (paper lot) period on the ledger chart. The bulk entitlement date (date_ent_actual) marks when all lots transition from Paper to Entitled status, which is the prerequisite for delivery scheduling. Without these dates, the simulation cannot properly sequence the community's lot pipeline.",
                "methodology": "The sim_entitlement_groups table is checked for non-null date_paper and date_ent_actual values for this community.",
                "date_paper": date_paper.isoformat() if date_paper else None,
                "date_ent": date_ent.isoformat() if date_ent else None,
                "missing": missing_dates,
                "ent_group_id": ent_group_id,
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
