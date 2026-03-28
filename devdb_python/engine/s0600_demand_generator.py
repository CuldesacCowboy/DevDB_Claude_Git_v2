# s0600_demand_generator.py
# S-06: Compute monthly starts demand series from projection group params.
#
# Owns:     Translating annual_starts_target + seasonal weights into monthly
#           demand series. Applying max_starts_per_month cap.
# Not Own:  Reading or modifying lot data. Determining supply availability.
# Inputs:   sim_projection_params (via conn), run_start_date, projection_group_id.
# Outputs:  DataFrame [year, month, slots] -- integer slots summing exactly to
#           available_capacity, or (empty DataFrame, True) if no config found.
# Design:   Vectorized. No loops. No carry-forward. Integers only.
#           available_capacity = total_capacity - real lots not yet started.
#           Rounding residual absorbed by the largest-weight month.

import pandas as pd
from .connection import DBConnection

SEASONAL_WEIGHTS_BALANCED_2YR = {
    1: 0.060, 2: 0.065, 3: 0.085, 4: 0.095,
    5: 0.100, 6: 0.095, 7: 0.090, 8: 0.090,
    9: 0.085, 10: 0.080, 11: 0.070, 12: 0.085,
}


def demand_generator(conn: DBConnection, projection_group_id: int,
                     run_start_date, horizon_months: int = 360):
    """
    Generate monthly demand DataFrame for a projection group.
    Returns (demand_df, needs_config).
      demand_df:    DataFrame [year, month, slots] -- integers, sum == available_capacity.
      needs_config: True if no sim_projection_params row found.
    """
    from dateutil.relativedelta import relativedelta

    params_df = conn.read_df(f"""
        SELECT annual_starts_target, max_starts_per_month, seasonal_weight_set
        FROM sim_projection_params
        WHERE projection_group_id = {projection_group_id}
        LIMIT 1
    """)

    if params_df.empty:
        return pd.DataFrame(columns=["year", "month", "slots"]), True

    row = params_df.iloc[0]
    annual_target = float(row["annual_starts_target"])
    max_per_month = float(row["max_starts_per_month"]) if row["max_starts_per_month"] is not None else None
    weight_set = row["seasonal_weight_set"] or "balanced_2yr"

    if weight_set != "balanced_2yr":
        raise ValueError(
            f"PG {projection_group_id}: seasonal_weight_set='{weight_set}' is not supported. "
            f"Only 'balanced_2yr' is implemented. Update sim_projection_params."
        )

    # Step 1: available_capacity = total planned lots minus all real lots.
    # All real lots reduce capacity regardless of pipeline stage:
    #   - Unstarted real lots (date_str IS NULL): will absorb demand slots in S-07.
    #   - Started/closed real lots (date_str IS NOT NULL): phase slot already consumed
    #     historically; no sim lot can use it.
    # Both categories must be subtracted so demand never exceeds actual sim slot supply.
    avail_df = conn.read_df(f"""
        SELECT
            COALESCE(SUM(sps.projected_count), 0) AS total_capacity,
            COALESCE((
                SELECT COUNT(*)
                FROM sim_lots
                WHERE projection_group_id = {projection_group_id}
                  AND lot_source = 'real'
            ), 0) AS real_lots
        FROM sim_phase_product_splits sps
        JOIN sim_dev_phases sdp ON sps.phase_id = sdp.phase_id
        WHERE sdp.dev_id = (
            SELECT dev_id FROM dim_projection_groups
            WHERE projection_group_id = {projection_group_id}
        )
    """)
    total_capacity     = int(avail_df.iloc[0]["total_capacity"])
    real_lots          = int(avail_df.iloc[0]["real_lots"])
    available_capacity = max(0, total_capacity - real_lots)

    if available_capacity == 0:
        print(f"S-06: PG {projection_group_id} available_capacity=0. No demand generated.")
        return pd.DataFrame(columns=["year", "month", "slots"]), False

    # Step 2a: Demand starts no earlier than the last locked delivery date.
    locked_df = conn.read_df(f"""
        SELECT MAX(date_dev_actual) AS last_locked_date
        FROM sim_delivery_events
        WHERE ent_group_id = (
            SELECT ent_group_id FROM sim_ent_group_developments
            WHERE dev_id = (
                SELECT dev_id FROM dim_projection_groups
                WHERE projection_group_id = {projection_group_id}
            )
        )
        AND date_dev_actual IS NOT NULL
    """)
    last_locked = locked_df.iloc[0]["last_locked_date"]
    if last_locked is not None:
        ll = last_locked.date() if hasattr(last_locked, "date") else last_locked
        first_of_next_month = ll.replace(day=1) + relativedelta(months=1)
        demand_start = max(run_start_date, first_of_next_month)
    else:
        demand_start = run_start_date

    # Step 2b: Build month spine from demand_start
    months = []
    current = demand_start
    for _ in range(horizon_months):
        months.append((current.year, current.month))
        current = current + relativedelta(months=1)

    df = pd.DataFrame(months, columns=["year", "month"])
    df["weight"] = df["month"].map(SEASONAL_WEIGHTS_BALANCED_2YR)

    # Step 3: Compute per-month slots at the annual pace, apply max_per_month cap,
    # then round to integers. Do NOT renormalize across the full horizon -- that
    # crushes values to zero when available_capacity << horizon_months * annual_target/12.
    df["slots"] = (df["weight"] * annual_target).round().astype(int)
    if max_per_month is not None:
        df["slots"] = df["slots"].clip(upper=int(max_per_month))

    # Step 4: Truncate at available_capacity via cumsum filter, then cap the last
    # kept month so the series sums to exactly available_capacity.
    df["cumsum"] = df["slots"].cumsum()
    df = df[df["cumsum"].shift(1, fill_value=0) < available_capacity].copy()
    if not df.empty:
        slots_before_last = int(df["cumsum"].iloc[-1]) - int(df["slots"].iloc[-1])
        df.at[df.index[-1], "slots"] = available_capacity - slots_before_last

    # Step 5: Drop zero-slot months to keep output lean.
    df = df[df["slots"] > 0].reset_index(drop=True)

    print(f"S-06: PG {projection_group_id} demand={available_capacity} slots "
          f"across {len(df)} months "
          f"(total_capacity={total_capacity}, real_lots={real_lots}, "
          f"demand_start={demand_start}).")

    return df[["year", "month", "slots"]], False
