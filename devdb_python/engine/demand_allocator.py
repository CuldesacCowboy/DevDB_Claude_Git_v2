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
         HC lots respect hold dates: an HC lot is only assigned to a demand
         month at or after its hold release date. Earlier demand months are
         skipped (left for sim lots or unfilled). This prevents phantom demand
         consumption where HC lots claim early slots they can't actually fill.
         Vectorized merge — no carry-forward, no fractional slots.
         Not Own: creating temp lots (S-0800), assigning builder (S-0900).
"""

from datetime import date

import pandas as pd


def demand_allocator(lot_snapshot: pd.DataFrame, demand_df):
    """
    Assign real lots to demand slots via positional merge.
    Building groups are atomic: all mates are allocated to the same demand month.
    HC lots respect hold dates: assigned only to demand months >= hold release month.
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
    # H includes both actual date_td_hold and engine-projected date_td_hold_projected
    # so that TDA-committed lots drain before plain D lots (D-164 drain-HC-first).
    has_tdh_proj = "date_td_hold_projected" in lot_snapshot.columns

    u_mask = lot_snapshot["date_td"].notna() & lot_snapshot["date_str"].isna()
    h_mask = (
        (
            lot_snapshot["date_td_hold"].notna()
            | (lot_snapshot["date_td_hold_projected"].notna() if has_tdh_proj else False)
        )
        & lot_snapshot["date_td"].isna()
        & lot_snapshot["date_str"].isna()
    )
    d_mask = (
        lot_snapshot["date_dev"].notna()
        & lot_snapshot["date_td"].isna()
        & lot_snapshot["date_td_hold"].isna()
        & (lot_snapshot["date_td_hold_projected"].isna() if has_tdh_proj else True)
        & lot_snapshot["date_str"].isna()
    )

    # H lots sorted by effective hold date: actual wins, fall back to projected
    h_lots = lot_snapshot[h_mask].copy()
    if has_tdh_proj:
        h_lots["_eff_hold"] = h_lots["date_td_hold"].combine_first(
            h_lots["date_td_hold_projected"]
        )
    else:
        h_lots["_eff_hold"] = h_lots["date_td_hold"]
    h_lots = h_lots.sort_values("_eff_hold").drop(columns=["_eff_hold"])

    available = pd.concat([
        lot_snapshot[u_mask].sort_values("date_td"),
        h_lots,
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
    # Each unit also carries an optional earliest_month (from HC hold dates).
    seen_bg_ids: set = set()
    allocation_units: list[tuple[list[int], date | None]] = []  # (lot_ids, earliest_month)

    has_bg_col = "building_group_id" in available.columns

    def _hold_release(row) -> date | None:
        """Return the hold release month (first-of-month after hold date), or None."""
        hold = row.get("date_td_hold")
        if hold is None or pd.isna(hold):
            hold = row.get("date_td_hold_projected") if has_tdh_proj else None
        if hold is None or pd.isna(hold):
            return None
        hold = pd.Timestamp(hold)
        # Release month = first of next month after hold date
        m = hold.month + 1
        y = hold.year + (m - 1) // 12
        m = ((m - 1) % 12) + 1
        return date(y, m, 1)

    for _, row in available.iterrows():
        bg_id = row.get("building_group_id") if has_bg_col else None
        if pd.isna(bg_id) or bg_id is None:
            allocation_units.append(([int(row["lot_id"])], _hold_release(row)))
        else:
            bg_id = int(bg_id)
            if bg_id in seen_bg_ids:
                continue
            seen_bg_ids.add(bg_id)
            mates = available[available["building_group_id"] == bg_id]
            group_ids = mates["lot_id"].astype(int).tolist()
            # Group earliest = latest hold among mates (all must wait for slowest)
            group_holds = [_hold_release(r) for _, r in mates.iterrows()]
            group_holds = [h for h in group_holds if h is not None]
            earliest = max(group_holds) if group_holds else None
            allocation_units.append((group_ids, earliest))

    # Step 3: Flatten demand into one row per slot.
    flat = (
        demand_df
        .loc[demand_df.index.repeat(demand_df["slots"])][["year", "month"]]
        .reset_index(drop=True)
    )

    # Step 4: Assign allocation units to demand slots.
    # U/D lots (no hold date) take the next available slot positionally.
    # HC lots (has hold date) skip forward to the first demand slot at or after
    # their hold release month. This prevents phantom demand consumption where
    # HC lots claim early slots they can't actually fill.
    result_rows: list[dict] = []
    offset = 0

    for unit_ids, earliest_month in allocation_units:
        if offset >= len(flat):
            break
        n = len(unit_ids)

        # For HC lots: advance to first demand slot >= hold release month
        start = offset
        if earliest_month is not None:
            ey, em = earliest_month.year, earliest_month.month
            while start < len(flat):
                sy, sm = int(flat.iloc[start]["year"]), int(flat.iloc[start]["month"])
                if (sy, sm) >= (ey, em):
                    break
                start += 1
            if start >= len(flat):
                continue  # no demand slots available after hold release

        first = flat.iloc[start]
        year, month = int(first["year"]), int(first["month"])
        for lot_id in unit_ids:
            result_rows.append({"lot_id": lot_id, "assigned_year": year, "assigned_month": month})
        # Consume slots: for positional (U/D), advance offset past consumed slots.
        # For HC lots that skipped ahead, advance offset to after the HC slots
        # only if that's further than where we were.
        offset = max(offset, start) + n

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
