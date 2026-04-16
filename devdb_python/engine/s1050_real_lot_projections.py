"""
S-1050 real_lot_projections — Write projected STR/CMP/CLS dates to real P lots.

Reads:   sim_lots (real P lots — no actual start, no takedown), sim_dev_params
Writes:  sim_lots.date_str_projected, date_cmp_projected, date_cls_projected
Input:   conn: DBConnection, dev_id: int, run_start_date: date,
         build_lag_curves: dict, rng: random.Random
Rules:   Generates a demand slot series at annual_starts_target pace from sim_dev_params.
         Independent of kernel capacity logic (which subtracts real lots from capacity).
         Clears stale projections on real lots before writing new ones (skips locked lots).
         date_str_projected → date_cmp_projected via str_to_cmp curve (per unit).
         date_cmp_projected → date_cls_projected via cmp_to_cls curve (per unit).
         Returns count of lots projected.
         Not Own: sim lot generation (S-08), demand allocation (S-07), MARKS dates (S-02).
"""

import logging
from datetime import date

import pandas as pd

from .connection import DBConnection
from .s0850_timing_expansion import curves_for, sample_lag

logger = logging.getLogger(__name__)


def write_real_lot_projections(
    conn: DBConnection,
    dev_id: int,
    run_start_date: date,
    build_lag_curves: dict,
    rng,
) -> int:
    """
    Write date_str_projected / date_cmp_projected / date_cls_projected to real
    P lots (no actual start date, no takedown date) for this dev.

    Returns number of lots projected.
    """
    from datetime import timedelta
    from dateutil.relativedelta import relativedelta

    conn.execute(
        """
        UPDATE sim_lots
        SET date_str_projected = NULL,
            date_cmp_projected = NULL,
            date_cls_projected = NULL
        WHERE lot_source = 'real'
          AND dev_id = %s
          AND date_str_is_locked IS NOT TRUE
          AND date_cmp_is_locked IS NOT TRUE
          AND date_cls_is_locked IS NOT TRUE
        """,
        (dev_id,),
    )

    p_lots_df = conn.read_df(
        """
        SELECT lot_id, lot_type_id
        FROM sim_lots
        WHERE lot_source = 'real'
          AND dev_id             = %s
          AND date_str           IS NULL
          AND date_td            IS NULL
          AND date_td_hold       IS NULL
          AND excluded           IS NOT TRUE
          AND date_str_is_locked IS NOT TRUE
        ORDER BY lot_id
        """,
        (dev_id,),
    )

    if p_lots_df.empty:
        return 0

    params_df = conn.read_df(
        """
        SELECT annual_starts_target, max_starts_per_month
        FROM sim_dev_params
        WHERE dev_id = %s
        LIMIT 1
        """,
        (dev_id,),
    )
    if params_df.empty:
        return 0

    annual_target = float(params_df.iloc[0]["annual_starts_target"])
    max_per_month_raw = params_df.iloc[0]["max_starts_per_month"]
    max_per_month = (
        float(max_per_month_raw)
        if max_per_month_raw is not None and pd.notna(max_per_month_raw)
        else None
    )
    monthly_rate = annual_target / 12.0

    n_needed = len(p_lots_df)
    date_slots: list[date] = []
    current = run_start_date.replace(day=1)
    while len(date_slots) < n_needed:
        slots_this_month = max(1, round(monthly_rate))
        if max_per_month is not None:
            slots_this_month = min(slots_this_month, int(max_per_month))
        for _ in range(slots_this_month):
            date_slots.append(current)
            if len(date_slots) >= n_needed:
                break
        current = current + relativedelta(months=1)

    if not date_slots:
        return 0

    DEFAULT_CMP_LAG = build_lag_curves.get("_default_cmp", 270)
    DEFAULT_CLS_LAG = build_lag_curves.get("_default_cls", 45)

    updates = []
    for i, (_, lot) in enumerate(p_lots_df.iterrows()):
        if i >= len(date_slots):
            break
        str_date = date_slots[i]
        lt_id = int(lot["lot_type_id"]) if pd.notna(lot["lot_type_id"]) else None

        str_cmp_curve = curves_for(build_lag_curves, "str_to_cmp", lt_id)
        cmp_cls_curve = curves_for(build_lag_curves, "cmp_to_cls", lt_id)

        lag_str_cmp = sample_lag(rng, str_cmp_curve) if str_cmp_curve else DEFAULT_CMP_LAG
        lag_cmp_cls = sample_lag(rng, cmp_cls_curve) if cmp_cls_curve else DEFAULT_CLS_LAG

        cmp_date = str_date + timedelta(days=lag_str_cmp)
        cls_date = cmp_date + timedelta(days=lag_cmp_cls)
        updates.append((int(lot["lot_id"]), str_date, cmp_date, cls_date))

    if not updates:
        return 0

    conn.execute_values(
        """
        UPDATE sim_lots AS sl
        SET date_str_projected = v.str_p::date,
            date_cmp_projected = v.cmp_p::date,
            date_cls_projected = v.cls_p::date
        FROM (VALUES %s) AS v(lot_id, str_p, cmp_p, cls_p)
        WHERE sl.lot_id = v.lot_id::bigint
        """,
        updates,
    )

    logger.info(f"  S-1050: Projected dates written to {len(updates)} real P lot(s) for dev {dev_id}.")
    return len(updates)
