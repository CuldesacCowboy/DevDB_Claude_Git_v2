"""
S-0600 demand_generator — Compute monthly starts demand series from development params.

Reads:   sim_dev_params (DB, WHERE dev_id = ?)
Writes:  nothing — returns demand DataFrame
Input:   conn: DBConnection, dev_id: int, run_start_date: date, lot_snapshot: DataFrame
Rules:   Translates annual_starts_target + seasonal weights into monthly demand slots.
         Applies max_starts_per_month cap. available_capacity = total_capacity - real lots.
         Demand starts from run_start_date with no floor on locked delivery dates — lot
         availability (P/E status lots excluded from kernel pool) enforces supply timing.
         Vectorized — no loops, no carry-forward, integers only.
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

    # Step 1: available_capacity = total planned lots minus real lots that have already
    # started (date_str IS NOT NULL).
    #
    # Started/closed real lots: slot consumed historically; no sim lot can use it.
    # Unstarted real lots (P/D/H/U status, date_str IS NULL): will absorb demand slots
    #   in S-0700 just like sim lots would. We must generate demand for them too, so they
    #   are NOT subtracted here. If they were subtracted, the demand series would be too
    #   short — S-0700 would allocate those real lots to slots that were never generated,
    #   starving later phases of sim-slot demand.
    avail_df = conn.read_df(
        """
        SELECT
            COALESCE(SUM(sps.projected_count), 0) AS total_capacity,
            COALESCE((
                SELECT COUNT(*)
                FROM sim_lots
                WHERE dev_id = %s
                  AND lot_source = 'real'
                  AND date_str IS NOT NULL
            ), 0) AS real_started_lots
        FROM sim_phase_product_splits sps
        JOIN sim_dev_phases sdp ON sps.phase_id = sdp.phase_id
        WHERE sdp.dev_id = %s
        """,
        (dev_id, dev_id),
    )
    total_capacity     = int(avail_df.iloc[0]["total_capacity"])
    real_started_lots  = int(avail_df.iloc[0]["real_started_lots"])
    available_capacity = max(0, total_capacity - real_started_lots)

    if available_capacity == 0:
        logger.info(f"S-06: Dev {dev_id} available_capacity=0. No demand generated.")
        return pd.DataFrame(columns=["year", "month", "slots"]), False

    # Step 2: Build month spine from run_start_date.
    # Lot availability naturally enforces the supply constraint: a lot whose phase
    # has not yet delivered (P/E status) is not in the kernel's available pool and
    # cannot absorb a demand slot. No artificial demand floor is needed here — the
    # P-pipeline (locked delivery events) controls when lots become available.
    demand_start = run_start_date

    # Build month spine from demand_start
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
               f"(total_capacity={total_capacity}, real_started_lots={real_started_lots}, "
               f"demand_start={demand_start}).")

    return df[["year", "month", "slots"]], False
