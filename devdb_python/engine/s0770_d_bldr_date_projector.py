"""
S-0770 d_bldr_date_projector — Write date_td_projected for D-status real lots.

Reads:   lot snapshot DataFrame, demand_series DataFrame
Writes:  sim_lots.date_td_projected (DB), lot snapshot DataFrame (date_td_projected)
Input:   conn: DBConnection, lot_snapshot: DataFrame, demand_series: DataFrame,
         td_to_str_lag: int (months between BLDR date and DIG date, default 1)
Rules:   D-status lots are those with date_dev set, no date_td_hold, no date_td,
         no date_str, not locked.
         Runs demand_allocator to determine which demand month each D lot drains.
         H-lots are higher priority in the demand queue (demand_allocator handles this).
         Writes date_td_projected = demand_month_first - td_to_str_lag months.
         Never writes date_td (actual) — projected only.
         Lots locked via date_td_is_locked are skipped.
         Returns updated snapshot.
"""

import logging
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


def d_bldr_date_projector(conn: DBConnection, lot_snapshot: pd.DataFrame,
                           demand_series, td_to_str_lag: int = 1) -> pd.DataFrame:
    """
    Assign date_td_projected to D-status real lots based on demand allocation order.
    H-lots are already higher priority in the allocator — their demand slots are
    consumed first, leaving D-lots to fill the remaining queue in order.
    date_td_projected = first_of_demand_month - td_to_str_lag months.
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

    # Run demand allocator over full snapshot — H-lots drain before D-lots automatically
    allocated_df, _ = demand_allocator(lot_snapshot, demand_series)

    if allocated_df.empty:
        return lot_snapshot

    # Filter to D-status lots only
    d_allocations = allocated_df[allocated_df["lot_id"].astype(int).isin(d_lot_ids)]
    if d_allocations.empty:
        return lot_snapshot

    # Build {lot_id: date} map — apply td_to_str_lag offset
    d_dates: dict[int, date] = {}
    for _, row in d_allocations.iterrows():
        demand_month_first = date(int(row["assigned_year"]), int(row["assigned_month"]), 1)
        d_dates[int(row["lot_id"])] = _sub_months(demand_month_first, td_to_str_lag)

    # Persist to DB
    updates = [(d, lid) for lid, d in d_dates.items()]
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
    logger.info(f"  S-0770: Wrote date_td_projected for {len(updates)} D-status lot(s).")

    # Update snapshot in memory
    df = lot_snapshot.copy()
    for lid, proj_date in d_dates.items():
        df.loc[df["lot_id"].astype(int) == lid, "date_td_projected"] = pd.Timestamp(proj_date)

    return df
