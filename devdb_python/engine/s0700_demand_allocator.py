"""
S-0700 demand_allocator — Assign real unstarted lots to monthly demand slots.

Reads:   lot snapshot DataFrame (read-only)
Writes:  nothing — returns allocation DataFrames
Input:   lot_snapshot: DataFrame, demand_df: DataFrame
Rules:   Matches real lots in U/H/D status to monthly demand slots in order.
         Returns (allocated_df, unmet_demand_series).
         allocated_df: DataFrame {lot_id, assigned_year, assigned_month}.
         unmet_demand_series: list of (year, month, unmet_count).
         Building groups are treated as atomic units: when any lot in a group
         is allocated, all mates receive the same assigned month.
         Vectorized merge — no carry-forward, no fractional slots.
         Not Own: creating temp lots (S-0800), assigning builder (S-0900).
"""

import pandas as pd


def demand_allocator(lot_snapshot: pd.DataFrame, demand_df):
    """
    Assign real lots to demand slots via positional merge.
    Building groups are atomic: all mates are allocated to the same demand month.
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

    if available.empty:
        # No real lots to allocate; all demand is unmet.
        flat = demand_df.loc[demand_df.index.repeat(demand_df["slots"])][["year", "month"]].reset_index(drop=True)
        unmet_counts = flat.groupby(["year", "month"], sort=False).size().reset_index(name="count")
        unmet = [(int(r["year"]), int(r["month"]), int(r["count"]))
                 for _, r in unmet_counts.iterrows()]
        return empty_alloc, unmet

    # Step 2: Build ordered allocation units respecting building groups.
    # A unit is a list of lot_ids that must share the same assigned month.
    # Singletons (no building_group_id) → unit of size 1.
    # Groups → all available mates collected the first time the group is seen.
    seen_bg_ids: set = set()
    allocation_units: list[list[int]] = []

    has_bg_col = "building_group_id" in available.columns

    for _, row in available.iterrows():
        bg_id = row.get("building_group_id") if has_bg_col else None
        if pd.isna(bg_id) or bg_id is None:
            allocation_units.append([int(row["lot_id"])])
        else:
            bg_id = int(bg_id)
            if bg_id in seen_bg_ids:
                continue
            seen_bg_ids.add(bg_id)
            group_ids = (
                available[available["building_group_id"] == bg_id]["lot_id"]
                .astype(int)
                .tolist()
            )
            allocation_units.append(group_ids)

    # Step 3: Flatten demand into one row per slot.
    flat = (
        demand_df
        .loc[demand_df.index.repeat(demand_df["slots"])][["year", "month"]]
        .reset_index(drop=True)
    )

    # Step 4: Zip allocation units against demand slots.
    # Each unit of size N consumes N slots and all lots get the first slot's month.
    result_rows: list[dict] = []
    offset = 0

    for unit in allocation_units:
        if offset >= len(flat):
            break
        n = len(unit)
        first = flat.iloc[offset]
        year, month = int(first["year"]), int(first["month"])
        for lot_id in unit:
            result_rows.append({"lot_id": lot_id, "assigned_year": year, "assigned_month": month})
        # Consume slots up to the group size (may be fewer if demand is exhausted)
        offset += n

    allocated_df = (
        pd.DataFrame(result_rows)
        if result_rows
        else empty_alloc
    )

    # Step 5: Unmet -- demand slots remaining after all allocation units placed.
    unmet: list[tuple] = []
    if offset < len(flat):
        leftover = flat.iloc[offset:].copy()
        unmet_counts = leftover.groupby(["year", "month"], sort=False).size().reset_index(name="count")
        unmet = [(int(r["year"]), int(r["month"]), int(r["count"]))
                 for _, r in unmet_counts.iterrows()]

    return allocated_df, unmet
