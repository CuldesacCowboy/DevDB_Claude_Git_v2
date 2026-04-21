"""
S-0600 demand_generator — Compute monthly starts demand series from development params.

Reads:   sim_dev_params (DB, WHERE dev_id = ?)
Writes:  nothing — returns demand DataFrame
Input:   conn: DBConnection, dev_id: int, run_start_date: date, lot_snapshot: DataFrame
Rules:   Translates annual_starts_target + seasonal weights into monthly demand slots.
         Applies max_starts_per_month cap. available_capacity = total_capacity - real
         lots not yet started. Vectorized — no loops, no carry-forward, integers only.
         Returns (demand_df, missing_params: bool).
         Not Own: reading lot data directly, determining supply availability.
"""

import logging

import pandas as pd
from .connection import DBConnection
from .seasonal_weights import WEIGHT_SETS, SUPPORTED_WEIGHT_SETS

logger = logging.getLogger(__name__)


def demand_generator(conn: DBConnection, dev_id: int,
                     run_start_date, horizon_months: int = 360):
    """
    Generate monthly demand DataFrame for a development.
    Returns (demand_df, needs_config).
      demand_df:    DataFrame [year, month, slots] -- integers, sum == available_capacity.
      needs_config: True if no sim_dev_params row found.
    """
    from dateutil.relativedelta import relativedelta

    params_df = conn.read_df(
        """
        SELECT annual_starts_target, max_starts_per_month, seasonal_weight_set
        FROM sim_dev_params
        WHERE dev_id = %s
        LIMIT 1
        """,
        (dev_id,),
    )

    if params_df.empty:
        return pd.DataFrame(columns=["year", "month", "slots"]), True

    row = params_df.iloc[0]
    annual_target = float(row["annual_starts_target"])
    max_per_month = float(row["max_starts_per_month"]) if row["max_starts_per_month"] is not None else None
    weight_set = row["seasonal_weight_set"] or "balanced_2yr"

    if weight_set not in SUPPORTED_WEIGHT_SETS:
        raise ValueError(
            f"Dev {dev_id}: seasonal_weight_set='{weight_set}' is not supported. "
            f"Supported sets: {sorted(SUPPORTED_WEIGHT_SETS)}. Update sim_dev_params."
        )

    # Step 1: available_capacity = total planned lots minus all real lots.
    # All real lots reduce capacity regardless of pipeline stage:
    #   - Unstarted real lots (date_str IS NULL): will absorb demand slots in S-07.
    #   - Started/closed real lots (date_str IS NOT NULL): phase slot already consumed
    #     historically; no sim lot can use it.
    # Both categories must be subtracted so demand never exceeds actual sim slot supply.
    avail_df = conn.read_df(
        """
        SELECT
            COALESCE(SUM(sps.projected_count), 0) AS total_capacity,
            COALESCE((
                SELECT COUNT(*)
                FROM sim_lots
                WHERE dev_id = %s
                  AND lot_source = 'real'
            ), 0) AS real_lots
        FROM sim_phase_product_splits sps
        JOIN sim_dev_phases sdp ON sps.phase_id = sdp.phase_id
        WHERE sdp.dev_id = %s
        """,
        (dev_id, dev_id),
    )
    total_capacity     = int(avail_df.iloc[0]["total_capacity"])
    real_lots          = int(avail_df.iloc[0]["real_lots"])
    available_capacity = max(0, total_capacity - real_lots)

    if available_capacity == 0:
        logger.info(f"S-06: Dev {dev_id} available_capacity=0. No demand generated.")
        return pd.DataFrame(columns=["year", "month", "slots"]), False

    # Step 2a: Demand starts no earlier than the last locked delivery date.
    locked_df = conn.read_df(
        """
        SELECT MAX(date_dev_actual) AS last_locked_date
        FROM sim_delivery_events
        WHERE ent_group_id = (
            SELECT ent_group_id FROM sim_ent_group_developments
            WHERE dev_id = %s
            LIMIT 1
        )
        AND date_dev_actual IS NOT NULL
        """,
        (dev_id,),
    )
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
    df["weight"] = df["month"].map(WEIGHT_SETS[weight_set])

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

    logger.info(f"S-06: Dev {dev_id} demand={available_capacity} slots "
               f"across {len(df)} months "
               f"(total_capacity={total_capacity}, real_lots={real_lots}, "
               f"demand_start={demand_start}).")

    return df[["year", "month", "slots"]], False
