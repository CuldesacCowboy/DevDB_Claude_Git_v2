"""
S-0760 hc_bldr_date_projector — Write projected pipeline dates for HC-held lots.

Reads:   lot snapshot DataFrame, demand_series DataFrame (or sim_dev_params fallback)
Writes:  sim_lots.date_td_projected, date_str_projected, date_cmp_projected,
         date_cls_projected (DB); lot snapshot DataFrame (same columns)
Input:   conn: DBConnection, lot_snapshot: DataFrame, demand_series: DataFrame,
         dev_id: int, run_start_date: date,
         td_to_str_lag: int (months between BLDR date and DIG date, default 1),
         build_lag_curves: dict (str_to_cmp and cmp_to_cls empirical curves),
         rng: random.Random (for sampling lag curves)
Rules:   HC lots are those with date_td_hold OR date_td_hold_projected set,
         no date_td, no date_str, not locked.
         When demand_series is empty (available_capacity=0 — fully real community),
         falls back to a pace-based schedule derived from sim_dev_params.annual_starts_target.
         Runs demand_allocator to determine which demand month each HC lot drains.
         BLDR date (date_td_projected) is clamped to first month on/after hold date.
         DIG  date (date_str_projected) = BLDR + td_to_str_lag months.
         CMP  date (date_cmp_projected) derived from DIG via str_to_cmp lag curve.
         CLS  date (date_cls_projected) derived from CMP via cmp_to_cls lag curve.
         Writing these four columns also overwrites any stale pace-based values
         that S-1050 may have written in a prior run before the lot gained its
         HC hold assignment (S-1050 skips HC lots — it cannot self-correct stale data).
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
from .s0700_demand_allocator import demand_allocator
from .s0850_timing_expansion import curves_for, sample_lag

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
    Build a minimal pace-based demand DataFrame for projecting HC-lot dates.
    Uses annual_starts_target from sim_dev_params; falls back to 1/month.
    Generates enough months to cover all n_lots.
    """
    df = conn.read_df(
        "SELECT annual_starts_target FROM sim_dev_params WHERE dev_id = %s",
        (dev_id,),
    )
    annual = int(df.iloc[0]["annual_starts_target"]) if not df.empty else 12
    slots_per_month = max(1, round(annual / 12))
    n_months = math.ceil(n_lots / slots_per_month) + 2

    rows = []
    d = run_start_date
    for _ in range(n_months):
        rows.append({"year": d.year, "month": d.month, "slots": slots_per_month})
        d = _add_months(d, 1)
    return pd.DataFrame(rows)


def hc_bldr_date_projector(conn: DBConnection, lot_snapshot: pd.DataFrame,
                            demand_series, dev_id: int, run_start_date: date,
                            td_to_str_lag: int = 1,
                            build_lag_curves: dict | None = None,
                            rng: random.Random | None = None) -> pd.DataFrame:
    """
    Assign projected pipeline dates to HC-held lots based on demand allocation order.
    BLDR = first_of_demand_month - td_to_str_lag (clamped to >= hold date).
    DIG  = BLDR + td_to_str_lag.  CMP/CLS derived via lag curves.
    Falls back to pace-based demand when demand_series is empty.
    Returns updated snapshot.
    """
    if lot_snapshot.empty:
        return lot_snapshot

    has_tdh_proj = "date_td_hold_projected" in lot_snapshot.columns

    # Identify HC lots: hold date set, no td actual, no start, not locked
    hc_mask = (
        (
            lot_snapshot["date_td_hold"].notna()
            | (lot_snapshot["date_td_hold_projected"].notna() if has_tdh_proj else False)
        )
        & lot_snapshot["date_td"].isna()
        & lot_snapshot["date_str"].isna()
        & (~lot_snapshot.get("date_td_is_locked", pd.Series(False, index=lot_snapshot.index)).fillna(False).astype(bool))
    )

    hc_lot_ids = set(lot_snapshot.loc[hc_mask, "lot_id"].astype(int).tolist())
    if not hc_lot_ids:
        return lot_snapshot

    # Use demand_series if non-empty; otherwise fall back to pace-based schedule
    is_empty = (
        (isinstance(demand_series, pd.DataFrame) and demand_series.empty)
        or (isinstance(demand_series, list) and not demand_series)
    )
    effective_demand = (
        _pace_demand(conn, dev_id, run_start_date, len(hc_lot_ids))
        if is_empty
        else demand_series
    )
    if is_empty:
        logger.info(f"  S-0760: demand_series empty for dev {dev_id} — using pace fallback.")

    # Run demand allocator over full snapshot — it handles U/H/D priority ordering
    allocated_df, _ = demand_allocator(lot_snapshot, effective_demand)

    if allocated_df.empty:
        return lot_snapshot

    # Filter to HC lots only
    hc_allocations = allocated_df[allocated_df["lot_id"].astype(int).isin(hc_lot_ids)]
    if hc_allocations.empty:
        return lot_snapshot

    # Build snapshot index for hold-date lookup (used in clamping and clearing below)
    snap_idx = {int(r["lot_id"]): r for _, r in lot_snapshot.iterrows()}

    def _hold_date_for(lid: int):
        snap = snap_idx.get(lid, {})
        raw_hold = snap.get("date_td_hold")
        raw_hold_proj = snap.get("date_td_hold_projected")
        h = (raw_hold if (raw_hold is not None and pd.notna(raw_hold))
             else raw_hold_proj if (raw_hold_proj is not None and pd.notna(raw_hold_proj))
             else None)
        return h

    # Build lag curve defaults from build_lag_curves (same fallbacks as S-1050).
    _curves = build_lag_curves or {}
    DEFAULT_CMP_LAG = _curves.get("_default_cmp", 270)
    DEFAULT_CLS_LAG = _curves.get("_default_cls", 45)
    _rng = rng or random.Random()

    # Build {lot_id: (bldr, str, cmp, cls)} map.
    # BLDR date is clamped to first month on/after the lot's HC hold date.
    # When multiple lots share the same hold_floor (common for a checkpoint batch),
    # they are spread 1 month apart rather than all landing on the same date.
    # STR  = BLDR + td_to_str_lag months.
    # CMP/CLS derived via empirical lag curves (same logic as S-1050).
    # Writing all four columns here overwrites any stale pace-based values that
    # S-1050 may have left from a prior run before the lot gained its HC hold
    # assignment (S-1050 skips HC lots and cannot self-correct stale data).
    hc_dates: dict[int, date] = {}
    hc_str_dates: dict[int, date] = {}
    hc_cmp_dates: dict[int, date] = {}
    hc_cls_dates: dict[int, date] = {}

    # Tracks the next available bldr_date for each hold_floor bucket so that lots
    # clamped to the same checkpoint spread 1/month instead of piling up.
    hold_floor_next: dict[date, date] = {}

    lot_type_idx = {int(r["lot_id"]): r.get("lot_type_id") for _, r in lot_snapshot.iterrows()
                    if pd.notna(r.get("lot_type_id"))}

    for _, row in hc_allocations.iterrows():
        lid = int(row["lot_id"])
        demand_month_first = date(int(row["assigned_year"]), int(row["assigned_month"]), 1)
        bldr_date = _sub_months(demand_month_first, td_to_str_lag)

        hold = _hold_date_for(lid)
        if hold is not None:
            hold_ts = pd.Timestamp(hold)
            # First day of month that is >= hold date
            hold_floor = (date(hold_ts.year, hold_ts.month, 1)
                          if hold_ts.day == 1
                          else _add_months(date(hold_ts.year, hold_ts.month, 1), 1))
            if bldr_date < hold_floor:
                # Spread clamped lots: each successive lot in the same checkpoint
                # batch gets a bldr_date 1 month later than the previous.
                next_avail = hold_floor_next.get(hold_floor, hold_floor)
                bldr_date = next_avail
                hold_floor_next[hold_floor] = _add_months(next_avail, 1)

        str_date = _add_months(bldr_date, td_to_str_lag) if td_to_str_lag else bldr_date

        lt_id = lot_type_idx.get(lid)
        lt_id = int(lt_id) if lt_id is not None and pd.notna(lt_id) else None
        str_cmp_curve = curves_for(_curves, "str_to_cmp", lt_id)
        cmp_cls_curve = curves_for(_curves, "cmp_to_cls", lt_id)
        lag_str_cmp = sample_lag(_rng, str_cmp_curve) if str_cmp_curve else DEFAULT_CMP_LAG
        lag_cmp_cls = sample_lag(_rng, cmp_cls_curve) if cmp_cls_curve else DEFAULT_CLS_LAG
        cmp_date = str_date + timedelta(days=lag_str_cmp)
        cls_date = cmp_date + timedelta(days=lag_cmp_cls)

        hc_dates[lid]     = bldr_date
        hc_str_dates[lid] = str_date
        hc_cmp_dates[lid] = cmp_date
        hc_cls_dates[lid] = cls_date

    # Persist to DB — write BLDR, DIG, CMP, CLS projected dates.
    updates = [(hc_dates[lid], hc_str_dates[lid],
                hc_cmp_dates[lid], hc_cls_dates[lid], lid) for lid in hc_dates]
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
        f"  S-0760: Wrote BLDR/DIG/CMP/CLS projected dates for {len(updates)} HC lot(s)."
    )

    # Clear date_td_hold_projected for lots where bldr date still precedes the hold date.
    # With the clamp above this should never fire in normal operation, but keep as a safety net.
    clear_hold_ids = []
    for lid, bldr_date in hc_dates.items():
        hold = _hold_date_for(lid)
        if hold is not None and pd.Timestamp(bldr_date) < pd.Timestamp(hold):
            clear_hold_ids.append(lid)

    if clear_hold_ids:
        conn.execute_values(
            """
            UPDATE sim_lots AS sl
            SET date_td_hold_projected = NULL,
                updated_at = NOW()
            FROM (VALUES %s) AS v(lot_id)
            WHERE sl.lot_id = v.lot_id::bigint
              AND sl.date_td_hold IS NULL
              AND sl.date_td_hold_is_locked IS NOT TRUE
            """,
            [(lid,) for lid in clear_hold_ids],
        )
        logger.info(
            f"  S-0760: Cleared date_td_hold_projected for {len(clear_hold_ids)} lot(s) "
            "covered by demand before hold date."
        )

    # Update snapshot in memory
    df = lot_snapshot.copy()
    for col in ("date_str_projected", "date_cmp_projected", "date_cls_projected"):
        if col not in df.columns:
            df[col] = pd.NaT
    for lid in hc_dates:
        mask = df["lot_id"].astype(int) == lid
        df.loc[mask, "date_td_projected"]  = pd.Timestamp(hc_dates[lid])
        df.loc[mask, "date_str_projected"] = pd.Timestamp(hc_str_dates[lid])
        df.loc[mask, "date_cmp_projected"] = pd.Timestamp(hc_cmp_dates[lid])
        df.loc[mask, "date_cls_projected"] = pd.Timestamp(hc_cls_dates[lid])
    for lid in clear_hold_ids:
        df.loc[df["lot_id"].astype(int) == lid, "date_td_hold_projected"] = pd.NaT

    return df
