"""
S-0760 hc_bldr_date_projector — Write date_td_projected for HC-held lots.

Reads:   lot snapshot DataFrame, demand_series DataFrame
Writes:  sim_lots.date_td_projected (DB), lot snapshot DataFrame (date_td_projected)
Input:   conn: DBConnection, lot_snapshot: DataFrame, demand_series: DataFrame
Rules:   HC lots are those with date_td_hold OR date_td_hold_projected set,
         no date_td, no date_str, not locked.
         Runs demand_allocator to determine which demand month each HC lot drains.
         Writes date_td_projected = first of that month for each allocated HC lot.
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


def hc_bldr_date_projector(conn: DBConnection, lot_snapshot: pd.DataFrame, demand_series) -> pd.DataFrame:
    """
    Assign date_td_projected to HC-held lots based on demand allocation order.
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

    # Run demand allocator over full snapshot — it handles U/H/D priority ordering
    allocated_df, _ = demand_allocator(lot_snapshot, demand_series)

    if allocated_df.empty:
        return lot_snapshot

    # Filter to HC lots only
    hc_allocations = allocated_df[allocated_df["lot_id"].astype(int).isin(hc_lot_ids)]
    if hc_allocations.empty:
        return lot_snapshot

    # Build {lot_id: date} map
    hc_dates: dict[int, date] = {
        int(row["lot_id"]): date(int(row["assigned_year"]), int(row["assigned_month"]), 1)
        for _, row in hc_allocations.iterrows()
    }

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

    # Update snapshot in memory
    df = lot_snapshot.copy()
    for lid, proj_date in hc_dates.items():
        df.loc[df["lot_id"].astype(int) == lid, "date_td_projected"] = pd.Timestamp(proj_date)

    return df
