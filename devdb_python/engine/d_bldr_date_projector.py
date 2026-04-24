"""
S-0770 d_bldr_date_projector — Write projected pipeline dates for D-status real lots.

Reads:   lot snapshot DataFrame, demand_series DataFrame (or sim_dev_params fallback)
Writes:  sim_lots.date_td_projected, date_str_projected, date_cmp_projected,
         date_cls_projected (DB); lot snapshot DataFrame (same columns)
Input:   conn: DBConnection, lot_snapshot: DataFrame, demand_series: DataFrame,
         dev_id: int, run_start_date: date,
         td_to_str_lag: int (months between BLDR date and DIG date, default 1),
         build_lag_curves: dict (str_to_cmp and cmp_to_cls empirical curves),
         rng: random.Random (for sampling lag curves)
Rules:   D-status lots are those with date_dev set, no date_td_hold, no date_td,
         no date_str, not locked.
         When demand_series is empty (available_capacity=0 — fully real community),
         falls back to a pace-based schedule derived from sim_dev_params.annual_starts_target.
         This ensures D-status lots get projected dates even when no sim slots remain.
         Runs demand_allocator to determine which demand month each D lot drains.
         H-lots are higher priority in the demand queue (demand_allocator handles this).
         Writes date_td_projected = demand_month_first - td_to_str_lag months (BLDR).
         Writes date_str_projected = demand_month_first (DIG/STR = BLDR + lag).
         Writes date_cmp_projected and date_cls_projected via empirical lag curves.
         Writing all four columns prevents S-1050's pace model from overwriting with
         incorrect dates that ignore when D lots actually become available.
         Never writes date_td (actual) — projected only.
         Lots locked via date_td_is_locked are skipped.
         Returns updated snapshot.
"""

import logging
import math
import random
from datetime import date, timedelta

import pandas as pd
from .connection import DBConnection
from .demand_allocator import demand_allocator
from .timing_expansion import curves_for, sample_lag

logger = logging.getLogger(__name__)


def _sub_months(d: date, n: int) -> date:
    m = d.month - n
    y = d.year + (m - 1) // 12
    m = ((m - 1) % 12) + 1
    return d.replace(year=y, month=m, day=1)


def _add_months(d: date, n: int) -> date:
    m = d.month + n
    y = d.year + (m - 1) // 12
    m = ((m - 1) % 12) + 1
    return d.replace(year=y, month=m, day=1)


def _pace_demand(conn: DBConnection, dev_id: int, run_start_date: date,
                 n_lots: int) -> pd.DataFrame:
    """
    Build a minimal pace-based demand DataFrame for projecting D-lot dates.
    Uses annual_starts_target from sim_dev_params; falls back to 1/month.
    Generates enough months to cover all n_lots.
    """
    df = conn.read_df(
        "SELECT annual_starts_target FROM sim_dev_params WHERE dev_id = %s",
        (dev_id,),
    )
    annual = int(df.iloc[0]["annual_starts_target"]) if not df.empty else 12
    slots_per_month = max(1, round(annual / 12))
    n_months = math.ceil(n_lots / slots_per_month) + 2  # small buffer

    rows = []
    d = run_start_date
    for _ in range(n_months):
        rows.append({"year": d.year, "month": d.month, "slots": slots_per_month})
        d = _add_months(d, 1)
    return pd.DataFrame(rows)


def d_bldr_date_projector(conn: DBConnection, lot_snapshot: pd.DataFrame,
                           demand_series, dev_id: int, run_start_date: date,
                           td_to_str_lag: int = 1,
                           build_lag_curves: dict | None = None,
                           rng: random.Random | None = None) -> pd.DataFrame:
    """
    Assign projected pipeline dates to D-status real lots based on demand allocation.
    H-lots are already higher priority in the allocator — their demand slots are
    consumed first, leaving D-lots to fill the remaining queue in order.
    date_td_projected  = demand_month_first - td_to_str_lag months (BLDR).
    date_str_projected = demand_month_first (STR = BLDR + lag).
    date_cmp_projected / date_cls_projected derived via empirical lag curves.
    Falls back to pace-based demand when demand_series is empty.
    Returns updated snapshot.
    """
    if lot_snapshot.empty:
        return lot_snapshot

    has_tdh_proj = "date_td_hold_projected" in lot_snapshot.columns

    # Identify D-status lots: date_dev set, no hold, no td actual, no start, not locked
    d_mask = (
        lot_snapshot["date_dev"].notna()
        & lot_snapshot["date_td_hold"].isna()
        & (~(lot_snapshot["date_td_hold_projected"].notna() if has_tdh_proj else False))
        & lot_snapshot["date_td"].isna()
        & lot_snapshot["date_str"].isna()
        & lot_snapshot["lot_source"].isin(["real", "pre"])
        & (~lot_snapshot.get("date_td_is_locked", pd.Series(False, index=lot_snapshot.index)).fillna(False).astype(bool))
    )

    d_lot_ids = set(lot_snapshot.loc[d_mask, "lot_id"].astype(int).tolist())
    if not d_lot_ids:
        return lot_snapshot

    # Use demand_series if non-empty; otherwise fall back to pace-based schedule
    is_empty = (
        (isinstance(demand_series, pd.DataFrame) and demand_series.empty)
        or (isinstance(demand_series, list) and not demand_series)
    )
    effective_demand = (
        _pace_demand(conn, dev_id, run_start_date, len(d_lot_ids))
        if is_empty
        else demand_series
    )
    if is_empty:
        logger.info(f"  S-0770: demand_series empty for dev {dev_id} — using pace fallback.")

    # Run demand allocator over full snapshot — H-lots drain before D-lots automatically
    allocated_df, _ = demand_allocator(lot_snapshot, effective_demand)

    if allocated_df.empty:
        return lot_snapshot

    # Filter to D-status lots only
    d_allocations = allocated_df[allocated_df["lot_id"].astype(int).isin(d_lot_ids)]
    if d_allocations.empty:
        return lot_snapshot

    # Build lag curve defaults (same fallbacks as S-0760 / S-1050).
    _curves = build_lag_curves or {}
    DEFAULT_CMP_LAG = _curves.get("_default_cmp", 270)
    DEFAULT_CLS_LAG = _curves.get("_default_cls", 45)
    _rng = rng or random.Random()

    lot_type_idx = {int(r["lot_id"]): r.get("lot_type_id") for _, r in lot_snapshot.iterrows()
                    if pd.notna(r.get("lot_type_id"))}

    # Build {lot_id: (bldr, str, cmp, cls)} map — apply td_to_str_lag offset for BLDR.
    # STR = demand_month_first (= BLDR + lag); CMP/CLS from empirical curves.
    # Cache one sampled lag pair per building group so all mates share identical dates.
    d_bldr:  dict[int, date] = {}
    d_str:   dict[int, date] = {}
    d_cmp:   dict[int, date] = {}
    d_cls:   dict[int, date] = {}

    # lot_id → building_group_id for D-status lots (from snapshot)
    d_bg_idx: dict[int, int | None] = {}
    for _, r in lot_snapshot.iterrows():
        lid = int(r["lot_id"])
        if lid in d_lot_ids:
            raw_bg = r.get("building_group_id")
            d_bg_idx[lid] = int(raw_bg) if raw_bg is not None and pd.notna(raw_bg) else None

    bg_lag_cache: dict[int, tuple[int, int]] = {}

    for _, row in d_allocations.iterrows():
        lid = int(row["lot_id"])
        demand_month_first = date(int(row["assigned_year"]), int(row["assigned_month"]), 1)
        bldr_date = _sub_months(demand_month_first, td_to_str_lag)
        str_date  = demand_month_first  # = BLDR + td_to_str_lag

        lt_id = lot_type_idx.get(lid)
        lt_id = int(lt_id) if lt_id is not None and pd.notna(lt_id) else None
        bg_id = d_bg_idx.get(lid)
        if bg_id is not None and bg_id in bg_lag_cache:
            lag_str_cmp, lag_cmp_cls = bg_lag_cache[bg_id]
        else:
            str_cmp_curve = curves_for(_curves, "str_to_cmp", lt_id)
            cmp_cls_curve = curves_for(_curves, "cmp_to_cls", lt_id)
            lag_str_cmp = sample_lag(_rng, str_cmp_curve) if str_cmp_curve else DEFAULT_CMP_LAG
            lag_cmp_cls = sample_lag(_rng, cmp_cls_curve) if cmp_cls_curve else DEFAULT_CLS_LAG
            if bg_id is not None:
                bg_lag_cache[bg_id] = (lag_str_cmp, lag_cmp_cls)
        cmp_date = str_date + timedelta(days=lag_str_cmp)
        cls_date = cmp_date + timedelta(days=lag_cmp_cls)

        d_bldr[lid] = bldr_date
        d_str[lid]  = str_date
        d_cmp[lid]  = cmp_date
        d_cls[lid]  = cls_date

    # Persist all four projected pipeline dates to DB.
    updates = [(d_bldr[lid], d_str[lid], d_cmp[lid], d_cls[lid], lid) for lid in d_bldr]
    conn.execute_values(
        """
        UPDATE sim_lots AS sl
        SET date_td_projected  = v.bldr_date::date,
            date_str_projected = v.str_date::date,
            date_cmp_projected = v.cmp_date::date,
            date_cls_projected = v.cls_date::date,
            updated_at = NOW()
        FROM (VALUES %s) AS v(bldr_date, str_date, cmp_date, cls_date, lot_id)
        WHERE sl.lot_id = v.lot_id::bigint
          AND sl.date_td IS NULL
          AND sl.date_td_is_locked IS NOT TRUE
        """,
        updates,
    )
    logger.info(
        f"  S-0770: Wrote BLDR/STR/CMP/CLS projected dates for {len(updates)} D-status lot(s)."
    )

    # Update snapshot in memory
    df = lot_snapshot.copy()
    for col in ("date_str_projected", "date_cmp_projected", "date_cls_projected"):
        if col not in df.columns:
            df[col] = pd.NaT
    for lid in d_bldr:
        mask = df["lot_id"].astype(int) == lid
        df.loc[mask, "date_td_projected"]  = pd.Timestamp(d_bldr[lid])
        df.loc[mask, "date_str_projected"] = pd.Timestamp(d_str[lid])
        df.loc[mask, "date_cmp_projected"] = pd.Timestamp(d_cmp[lid])
        df.loc[mask, "date_cls_projected"] = pd.Timestamp(d_cls[lid])

    return df
