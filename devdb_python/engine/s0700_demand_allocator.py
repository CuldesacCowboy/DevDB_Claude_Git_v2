"""
S-0700 demand_allocator — Assign real unstarted lots to monthly demand slots.

Reads:   lot snapshot DataFrame (read-only)
Writes:  nothing — returns allocation DataFrames
Input:   lot_snapshot: DataFrame, demand_df: DataFrame
Rules:   Matches real lots in U/H/D status to monthly demand slots in order.
         Returns (allocated_df, unmet_demand_series).
         allocated_df: DataFrame {lot_id, assigned_year, assigned_month}.
         unmet_demand_series: list of (year, month, unmet_count).
         Vectorized merge — no carry-forward, no fractional slots.
         Not Own: creating temp lots (S-0800), assigning builder (S-0900).
"""

import pandas as pd


def demand_allocator(lot_snapshot: pd.DataFrame, demand_df):
    """
    Assign real lots to demand slots via positional merge.
    demand_df: DataFrame [year, month, slots] from S-06.
    Returns (allocated_df, unmet_demand_series).
    """
    empty_alloc = pd.DataFrame(columns=["lot_id", "assigned_year", "assigned_month"])

    if isinstance(demand_df, pd.DataFrame) and demand_df.empty:
        return empty_alloc, []
    if isinstance(demand_df, list) and not demand_df:
        return empty_alloc, []

    # Back-compat: accept legacy list-of-tuples from callers not yet updated.
    if isinstance(demand_df, list):
        if not demand_df:
            return empty_alloc, []
        demand_df = pd.DataFrame(demand_df, columns=["year", "month", "slots"])
        demand_df["slots"] = demand_df["slots"].apply(lambda x: max(0, int(round(x))))
        demand_df = demand_df[demand_df["slots"] > 0].reset_index(drop=True)

    # Step 1: Available lots -- U, then H, then D (pull order).
    u_mask = lot_snapshot["date_td"].notna() & lot_snapshot["date_str"].isna()
    h_mask = (
        lot_snapshot["date_td_hold"].notna()
        & lot_snapshot["date_td"].isna()
        & lot_snapshot["date_str"].isna()
    )
    d_mask = (
        lot_snapshot["date_dev"].notna()
        & lot_snapshot["date_td"].isna()
        & lot_snapshot["date_td_hold"].isna()
        & lot_snapshot["date_str"].isna()
    )
    available = pd.concat([
        lot_snapshot[u_mask].sort_values("date_td"),
        lot_snapshot[h_mask].sort_values("date_td_hold"),
        lot_snapshot[d_mask].sort_values("date_dev"),
    ], ignore_index=True)
    lot_ids = available["lot_id"].tolist()

    # Step 2: Flatten demand into one row per slot.
    flat = demand_df.loc[demand_df.index.repeat(demand_df["slots"])][["year", "month"]].reset_index(drop=True)

    # Step 3: Positional zip -- lot_ids against flat assignment list.
    n_fill = min(len(lot_ids), len(flat))
    allocated_df = flat.iloc[:n_fill].copy()
    allocated_df.insert(0, "lot_id", lot_ids[:n_fill])
    allocated_df.columns = ["lot_id", "assigned_year", "assigned_month"]

    # Step 4: Unmet -- real only when lot_ids exhausted before flat list.
    unmet = []
    if len(lot_ids) < len(flat):
        leftover = flat.iloc[n_fill:].copy()
        unmet_counts = leftover.groupby(["year", "month"], sort=False).size().reset_index(name="count")
        unmet = [(int(r["year"]), int(r["month"]), int(r["count"]))
                 for _, r in unmet_counts.iterrows()]

    return allocated_df, unmet
