"""
S-0760 lot_date_projector — Single-pass projected-date writer for all real lot states.

Consolidates former S-0760 (HC lots), S-0770 (D-status lots), and S-1050 (P-status lots)
into one module with enforced field ownership.  A single demand_allocator call covers
HC + D-status lots; a pace schedule covers P-status lots.

Field ownership — this module is the ONLY writer for all of these:
  date_td_projected       <- HC lots and D-status lots (demand-allocated)
  date_str_projected      <- D-status lots (td_projected + td_to_str_lag) and P-status lots (pace)
  date_cmp_projected      <- P-status lots only
  date_cls_projected      <- P-status lots only
  date_td_hold_projected  <- cleared (set NULL) where demand covers lot before hold date

Lot states handled in one pass (mutually exclusive populations):
  HC lots       date_td_hold or date_td_hold_projected set, no date_td, no date_str
  D-status lots date_dev set, no hold, no date_td, no date_str, lot_source real/pre
  P-status lots date_dev NULL, no date_str, no date_td, no hold, lot_source real/pre

Threading: takes and returns an updated lot_snapshot DataFrame so downstream
modules see consistent in-memory state without a DB round-trip.

Note: date_td_projected is pre-cleared by S-0500 each iteration before this module
runs, so no explicit clear is needed for that field here.
"""

import logging
import math
from datetime import date, timedelta

import pandas as pd
from dateutil.relativedelta import relativedelta

from .connection import DBConnection
from .s0700_demand_allocator import demand_allocator
from .s0850_timing_expansion import curves_for, sample_lag

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

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
    Fallback demand DataFrame when demand_series is empty (fully real community).
    Uses annual_starts_target from sim_dev_params; falls back to 1/month.
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


# ---------------------------------------------------------------------------
# Main entry point
# ---------------------------------------------------------------------------

def lot_date_projector(
    conn: DBConnection,
    lot_snapshot: pd.DataFrame,
    demand_series,
    dev_id: int,
    run_start_date: date,
    td_to_str_lag: int,
    build_lag_curves: dict,
    rng,
) -> pd.DataFrame:
    """
    Project future dates for all real lots that lack actuals.
    Returns updated snapshot.

    HC + D-status lots: demand_allocator assigns demand months; BLDR = demand_month -
    td_to_str_lag; DIG = demand_month.

    P-status lots: pace-based schedule from run_start_date; STR/CMP/CLS via empirical curves.
    """
    if lot_snapshot.empty:
        return lot_snapshot

    has_tdh_proj = "date_td_hold_projected" in lot_snapshot.columns

    # ── Identify mutually exclusive lot populations ───────────────────────────

    # HC lots: hold date (actual or projected), no td actual, no start, not locked
    hc_mask = (
        (
            lot_snapshot["date_td_hold"].notna()
            | (lot_snapshot["date_td_hold_projected"].notna() if has_tdh_proj else False)
        )
        & lot_snapshot["date_td"].isna()
        & lot_snapshot["date_str"].isna()
        & (~lot_snapshot.get(
            "date_td_is_locked", pd.Series(False, index=lot_snapshot.index)
        ).fillna(False).astype(bool))
    )
    hc_lot_ids = set(lot_snapshot.loc[hc_mask, "lot_id"].astype(int).tolist())

    # D-status lots: date_dev set, no hold (actual or projected), no td, no str, real/pre
    d_mask = (
        lot_snapshot["date_dev"].notna()
        & lot_snapshot["date_td_hold"].isna()
        & (~(lot_snapshot["date_td_hold_projected"].notna() if has_tdh_proj else False))
        & lot_snapshot["date_td"].isna()
        & lot_snapshot["date_str"].isna()
        & lot_snapshot["lot_source"].isin(["real", "pre"])
        & (~lot_snapshot.get(
            "date_td_is_locked", pd.Series(False, index=lot_snapshot.index)
        ).fillna(False).astype(bool))
    )
    d_lot_ids = set(lot_snapshot.loc[d_mask, "lot_id"].astype(int).tolist())

    # P-status lots: no date_dev, no date_str, no td, no hold, real/pre, not locked
    p_mask = (
        lot_snapshot["date_dev"].isna()
        & lot_snapshot["date_td_hold"].isna()
        & (~(lot_snapshot["date_td_hold_projected"].notna() if has_tdh_proj else False))
        & lot_snapshot["date_td"].isna()
        & lot_snapshot["date_str"].isna()
        & lot_snapshot["lot_source"].isin(["real", "pre"])
        & (~lot_snapshot.get(
            "date_str_is_locked", pd.Series(False, index=lot_snapshot.index)
        ).fillna(False).astype(bool))
    )
    p_lot_ids = set(lot_snapshot.loc[p_mask, "lot_id"].astype(int).tolist())

    if not hc_lot_ids and not d_lot_ids and not p_lot_ids:
        return lot_snapshot

    logger.info(
        f"  S-0760: dev {dev_id} — "
        f"HC={len(hc_lot_ids)}, D={len(d_lot_ids)}, P={len(p_lot_ids)} lots to project."
    )

    # ── Stale-clear owned fields before writing ───────────────────────────────
    # date_td_projected is pre-cleared by S-0500 each iteration.
    # date_str/cmp/cls_projected may carry stale values from prior iterations.
    stale_ids = list(hc_lot_ids | d_lot_ids | p_lot_ids)
    conn.execute_values(
        """
        UPDATE sim_lots AS sl
        SET date_str_projected = NULL,
            date_cmp_projected = NULL,
            date_cls_projected = NULL
        FROM (VALUES %s) AS v(lot_id)
        WHERE sl.lot_id = v.lot_id::bigint
          AND sl.date_str_is_locked IS NOT TRUE
          AND sl.date_cmp_is_locked IS NOT TRUE
          AND sl.date_cls_is_locked IS NOT TRUE
        """,
        [(lid,) for lid in stale_ids],
    )

    # Working copy of snapshot — updated incrementally below
    df = lot_snapshot.copy()

    # ── HC + D-status lots: demand-allocation-based projection ───────────────

    demand_lot_ids = hc_lot_ids | d_lot_ids
    if demand_lot_ids:
        is_empty = (
            (isinstance(demand_series, pd.DataFrame) and demand_series.empty)
            or (isinstance(demand_series, list) and not demand_series)
        )
        effective_demand = (
            _pace_demand(conn, dev_id, run_start_date, len(demand_lot_ids))
            if is_empty
            else demand_series
        )
        if is_empty:
            logger.info(f"  S-0760: demand_series empty for dev {dev_id} — using pace fallback.")

        # Single allocator call: H-lots drain before D-lots automatically (allocator priority)
        allocated_df, _ = demand_allocator(lot_snapshot, effective_demand)

        if not allocated_df.empty:
            # ── HC lots: date_td_projected ────────────────────────────────────
            hc_allocs = allocated_df[allocated_df["lot_id"].astype(int).isin(hc_lot_ids)]
            hc_dates: dict[int, date] = {}
            for _, row in hc_allocs.iterrows():
                lid = int(row["lot_id"])
                demand_m = date(int(row["assigned_year"]), int(row["assigned_month"]), 1)
                hc_dates[lid] = _sub_months(demand_m, td_to_str_lag)

            if hc_dates:
                conn.execute_values(
                    """
                    UPDATE sim_lots AS sl
                    SET date_td_projected = v.proj::date,
                        updated_at = NOW()
                    FROM (VALUES %s) AS v(proj, lot_id)
                    WHERE sl.lot_id = v.lot_id::bigint
                      AND sl.date_td IS NULL
                      AND sl.date_td_is_locked IS NOT TRUE
                    """,
                    [(d, lid) for lid, d in hc_dates.items()],
                )

                # Clear date_td_hold_projected where demand covers before hold date
                snap_idx = {int(r["lot_id"]): r for _, r in lot_snapshot.iterrows()}
                clear_hold_ids = []
                for lid, bldr_date in hc_dates.items():
                    snap = snap_idx.get(lid, {})
                    raw_hold      = snap.get("date_td_hold")
                    raw_hold_proj = snap.get("date_td_hold_projected")
                    hold = (
                        raw_hold      if (raw_hold is not None and pd.notna(raw_hold))
                        else raw_hold_proj if (raw_hold_proj is not None and pd.notna(raw_hold_proj))
                        else None
                    )
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
                        f"  S-0760: Cleared date_td_hold_projected for {len(clear_hold_ids)} "
                        "HC lot(s) covered by demand before hold date."
                    )

                # Update snapshot in memory
                for lid, proj_date in hc_dates.items():
                    df.loc[df["lot_id"].astype(int) == lid, "date_td_projected"] = pd.Timestamp(proj_date)
                for lid in clear_hold_ids:
                    df.loc[df["lot_id"].astype(int) == lid, "date_td_hold_projected"] = pd.NaT

                logger.info(f"  S-0760: Wrote date_td_projected for {len(hc_dates)} HC lot(s).")

            # ── D-status lots: date_td_projected + date_str_projected ─────────
            d_allocs = allocated_df[allocated_df["lot_id"].astype(int).isin(d_lot_ids)]
            # {lot_id: (bldr_date, dig_date)}
            d_dates: dict[int, tuple[date, date]] = {}
            for _, row in d_allocs.iterrows():
                lid     = int(row["lot_id"])
                demand_m = date(int(row["assigned_year"]), int(row["assigned_month"]), 1)
                bldr    = _sub_months(demand_m, td_to_str_lag)
                dig     = demand_m   # DIG = demand slot month (BLDR + lag)
                d_dates[lid] = (bldr, dig)

            if d_dates:
                conn.execute_values(
                    """
                    UPDATE sim_lots AS sl
                    SET date_td_projected  = v.bldr::date,
                        date_str_projected = v.dig::date,
                        updated_at = NOW()
                    FROM (VALUES %s) AS v(bldr, dig, lot_id)
                    WHERE sl.lot_id = v.lot_id::bigint
                      AND sl.date_td IS NULL
                      AND sl.date_td_is_locked IS NOT TRUE
                    """,
                    [(bldr, dig, lid) for lid, (bldr, dig) in d_dates.items()],
                )

                for lid, (bldr, dig) in d_dates.items():
                    mask = df["lot_id"].astype(int) == lid
                    df.loc[mask, "date_td_projected"]  = pd.Timestamp(bldr)
                    df.loc[mask, "date_str_projected"] = pd.Timestamp(dig)

                logger.info(
                    f"  S-0760: Wrote date_td_projected + date_str_projected "
                    f"for {len(d_dates)} D-status lot(s)."
                )

    # ── P-status lots: pace-based STR/CMP/CLS projection ─────────────────────

    if p_lot_ids:
        p_lots_df = lot_snapshot[lot_snapshot["lot_id"].astype(int).isin(p_lot_ids)][
            ["lot_id", "lot_type_id"]
        ].copy()

        params_df = conn.read_df(
            """
            SELECT annual_starts_target, max_starts_per_month
            FROM sim_dev_params
            WHERE dev_id = %s
            LIMIT 1
            """,
            (dev_id,),
        )
        if not params_df.empty:
            annual_target   = float(params_df.iloc[0]["annual_starts_target"])
            max_pm_raw      = params_df.iloc[0]["max_starts_per_month"]
            max_per_month   = (
                float(max_pm_raw)
                if max_pm_raw is not None and pd.notna(max_pm_raw)
                else None
            )
            monthly_rate    = annual_target / 12.0

            n_needed   = len(p_lots_df)
            date_slots: list[date] = []
            current = run_start_date.replace(day=1)
            while len(date_slots) < n_needed:
                slots_this = max(1, round(monthly_rate))
                if max_per_month is not None:
                    slots_this = min(slots_this, int(max_per_month))
                for _ in range(slots_this):
                    date_slots.append(current)
                    if len(date_slots) >= n_needed:
                        break
                current = current + relativedelta(months=1)

            DEFAULT_CMP_LAG = build_lag_curves.get("_default_cmp", 270)
            DEFAULT_CLS_LAG = build_lag_curves.get("_default_cls", 45)

            p_updates = []
            for i, (_, lot) in enumerate(p_lots_df.iterrows()):
                if i >= len(date_slots):
                    break
                str_date = date_slots[i]
                lt_id    = int(lot["lot_type_id"]) if pd.notna(lot["lot_type_id"]) else None

                str_cmp_curve = curves_for(build_lag_curves, "str_to_cmp", lt_id)
                cmp_cls_curve = curves_for(build_lag_curves, "cmp_to_cls", lt_id)

                lag_str_cmp = sample_lag(rng, str_cmp_curve) if str_cmp_curve else DEFAULT_CMP_LAG
                lag_cmp_cls = sample_lag(rng, cmp_cls_curve) if cmp_cls_curve else DEFAULT_CLS_LAG

                cmp_date = str_date + timedelta(days=lag_str_cmp)
                cls_date = cmp_date + timedelta(days=lag_cmp_cls)
                p_updates.append((int(lot["lot_id"]), str_date, cmp_date, cls_date))

            if p_updates:
                conn.execute_values(
                    """
                    UPDATE sim_lots AS sl
                    SET date_str_projected = v.str_p::date,
                        date_cmp_projected = v.cmp_p::date,
                        date_cls_projected = v.cls_p::date
                    FROM (VALUES %s) AS v(lot_id, str_p, cmp_p, cls_p)
                    WHERE sl.lot_id = v.lot_id::bigint
                    """,
                    p_updates,
                )

                for lid, str_d, cmp_d, cls_d in p_updates:
                    mask = df["lot_id"].astype(int) == lid
                    df.loc[mask, "date_str_projected"] = pd.Timestamp(str_d)
                    df.loc[mask, "date_cmp_projected"] = pd.Timestamp(cmp_d)
                    df.loc[mask, "date_cls_projected"] = pd.Timestamp(cls_d)

                logger.info(
                    f"  S-0760: Wrote pace-based STR/CMP/CLS for {len(p_updates)} P-status lot(s)."
                )

    return df
