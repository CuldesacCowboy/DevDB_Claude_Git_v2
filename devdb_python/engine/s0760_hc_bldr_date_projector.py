"""
S-0760 hc_bldr_date_projector — Write date_td_projected for HC-held lots.

Reads:   lot snapshot DataFrame, demand_series DataFrame (or sim_dev_params fallback)
Writes:  sim_lots.date_td_projected (DB), lot snapshot DataFrame (date_td_projected)
Input:   conn: DBConnection, lot_snapshot: DataFrame, demand_series: DataFrame,
         dev_id: int, run_start_date: date,
         td_to_str_lag: int (months between BLDR date and DIG date, default 1)
Rules:   HC lots are those with date_td_hold OR date_td_hold_projected set,
         no date_td, no date_str, not locked.
         When demand_series is empty (available_capacity=0 — fully real community),
         falls back to a pace-based schedule derived from sim_dev_params.annual_starts_target.
         Runs demand_allocator to determine which demand month each HC lot drains.
         Writes date_td_projected = demand_month_first - td_to_str_lag months.
         Never writes date_td (actual) — projected only.
         Lots locked via date_td_is_locked are skipped.
         Returns updated snapshot.
"""

import logging
import math
from datetime import date

import pandas as pd
from .connection import DBConnection
from .s0700_demand_allocator import demand_allocator

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
                            td_to_str_lag: int = 1) -> pd.DataFrame:
    """
    Assign date_td_projected to HC-held lots based on demand allocation order.
    date_td_projected = first_of_demand_month - td_to_str_lag months.
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

    # Build {lot_id: date} map — apply td_to_str_lag offset, then clamp to hold date.
    # BLDR date must never precede the lot's HC hold date — the lot cannot be taken
    # down before it is released from hold.  If the demand-derived date is earlier,
    # advance to the first full month on or after the hold date.
    hc_dates: dict[int, date] = {}
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
                bldr_date = hold_floor

        hc_dates[lid] = bldr_date

    # Persist to DB
    updates = [(d, lid) for lid, d in hc_dates.items()]
    conn.execute_values(
        """
        UPDATE sim_lots AS sl
        SET date_td_projected = v.projected_date::date,
            updated_at = NOW()
        FROM (VALUES %s) AS v(projected_date, lot_id)
        WHERE sl.lot_id = v.lot_id::bigint
          AND sl.date_td IS NULL
          AND sl.date_td_is_locked IS NOT TRUE
        """,
        updates,
    )
    logger.info(f"  S-0760: Wrote date_td_projected for {len(updates)} HC lot(s).")

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
    for lid, proj_date in hc_dates.items():
        df.loc[df["lot_id"].astype(int) == lid, "date_td_projected"] = pd.Timestamp(proj_date)
    for lid in clear_hold_ids:
        df.loc[df["lot_id"].astype(int) == lid, "date_td_hold_projected"] = pd.NaT

    return df
