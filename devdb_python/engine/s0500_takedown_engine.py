"""
S-0500 takedown_engine — Enforce TDA checkpoint obligations for lots in the snapshot.

Reads:   sim_takedown_agreements, sim_takedown_checkpoints, sim_takedown_agreement_lots (DB)
Writes:  sim_lots.date_td_hold_projected (DB), lot snapshot DataFrame (date_td_hold_projected)
Input:   lot_snapshot: DataFrame, dev_id: int, conn: DBConnection
Rules:   Per D-087: COALESCE(date_td, date_td_projected) and COALESCE(date_td_hold,
         date_td_hold_projected) both count toward checkpoint fulfillment.
         Writes date_td_hold_projected only — never date_td or date_td_hold (actuals).
         Respects date_td_hold_is_locked: locked lots counted but not reassigned.
         Filters candidate lots by builder_id to match TDA's builder_id (null TDA = any).
         Excess push: pool lots with no str/td/any-hold/bldr-projected are spread across
         checkpoint hold dates in round-robin (sorted by date_dev asc) before next checkpoint.
         Clears stale date_td_hold_projected for active TDA lots (unlocked, builder-matched)
         before recomputing.
         Multi-TDA lots: if a lot is in multiple active TDAs, the first TDA processed claims it
         via _available(); subsequent TDAs see date_td_hold_projected set and skip it. Processing
         order follows tda_lot_map iteration (DB insertion order).
         Persists date_td_hold_projected changes to sim_lots in DB.
         Returns (updated_snapshot, residual_gaps). Never blocks run — records gaps.
         Not Own: setting date_td, date_td_hold (actuals), any other lot field.
"""

import logging
from datetime import date, timedelta
from collections import defaultdict

import pandas as pd
from .connection import DBConnection

logger = logging.getLogger(__name__)

_DEFAULT_LEAD_DAYS = 16


def _fulfills(lot: dict, cp_date) -> bool:
    """Return True if this lot counts toward checkpoint fulfillment on or before cp_date.
    D-087: COALESCE(date_td, date_td_projected) and COALESCE(date_td_hold, date_td_hold_projected)
    both satisfy independently — actual wins over projected for both paths.
    """
    td    = lot.get("date_td")
    td_p  = lot.get("date_td_projected")
    tdh   = lot.get("date_td_hold")
    tdh_p = lot.get("date_td_hold_projected")
    eff_td  = td  if (td  is not None and pd.notna(td))  else td_p
    eff_tdh = tdh if (tdh is not None and pd.notna(tdh)) else tdh_p
    td_ok  = eff_td  is not None and pd.notna(eff_td)  and pd.Timestamp(eff_td)  <= cp_date
    tdh_ok = eff_tdh is not None and pd.notna(eff_tdh) and pd.Timestamp(eff_tdh) <= cp_date
    return td_ok or tdh_ok


def _available(lot: dict) -> bool:
    """Return True if this lot is a valid candidate for a new HC hold assignment.
    Excludes lots with any date or lock — including date_td_projected (BLDR-path lots
    already satisfy _fulfills() and need no redundant HC hold assignment).
    """
    return (
        lot.get("date_dev") is not None and pd.notna(lot.get("date_dev"))
        and (lot.get("date_td")               is None or pd.isna(lot.get("date_td")))
        and (lot.get("date_td_projected")     is None or pd.isna(lot.get("date_td_projected")))
        and (lot.get("date_td_hold")           is None or pd.isna(lot.get("date_td_hold")))
        and (lot.get("date_td_hold_projected") is None or pd.isna(lot.get("date_td_hold_projected")))
        and (lot.get("date_str")               is None or pd.isna(lot.get("date_str")))
        and not lot.get("date_td_hold_is_locked", False)
    )


def takedown_engine(conn: DBConnection, lot_snapshot: pd.DataFrame, dev_id: int,
                    scheduling_horizon_days: int = 0):
    """
    Enforce TDA checkpoint obligations.
    Writes date_td_hold_projected only — never actuals.
    HC hold dates are floored to today + scheduling_horizon_days.
    Returns (updated_snapshot, residual_gaps).
    """
    if lot_snapshot.empty:
        return lot_snapshot, []

    hc_floor = date.today() + timedelta(days=scheduling_horizon_days)

    snapshot_lot_ids = lot_snapshot["lot_id"].dropna().astype(int).tolist()
    if not snapshot_lot_ids:
        return lot_snapshot, []

    # ── Pre-clear stale projected dates for this dev's active TDA lots ─────────
    # Each run recomputes from scratch so stale values from prior runs don't
    # interfere. Also clears date_td_projected written by S-0760 so that
    # _available() sees a clean lot and HC re-assignment works correctly on
    # every iteration. Locked lots and lots with actual dates are preserved.
    conn.execute(
        """
        UPDATE sim_lots
        SET date_td_hold_projected = NULL,
            date_td_projected = CASE
                WHEN date_td IS NULL AND date_td_is_locked IS NOT TRUE THEN NULL
                ELSE date_td_projected
            END
        WHERE dev_id = %s
          AND date_td_hold IS NULL
          AND date_td_hold_is_locked IS NOT TRUE
          AND lot_id IN (
              SELECT tal.lot_id
              FROM sim_takedown_agreement_lots tal
              JOIN sim_takedown_agreements ta ON ta.tda_id = tal.tda_id
              JOIN sim_lots l ON l.lot_id = tal.lot_id
              WHERE ta.status = 'active'
                AND (ta.builder_id IS NULL
                     OR COALESCE(l.builder_id_override, l.builder_id) = ta.builder_id)
          )
        """,
        (dev_id,),
    )

    # ── Find active TDA agreements covering lots in this snapshot ─────────────
    tda_lots = conn.read_df(
        """
        SELECT tal.tda_id, tal.lot_id
        FROM sim_takedown_agreement_lots tal
        JOIN sim_takedown_agreements ta ON tal.tda_id = ta.tda_id
        WHERE ta.status = 'active'
          AND tal.lot_id = ANY(%s)
        """,
        (snapshot_lot_ids,),
    )

    if tda_lots.empty:
        return lot_snapshot, []

    tda_lot_map = defaultdict(set)
    for _, row in tda_lots.iterrows():
        tda_lot_map[int(row["tda_id"])].add(int(row["lot_id"]))

    df = lot_snapshot.copy()
    lots_dict = {int(row["lot_id"]): row.to_dict() for _, row in df.iterrows()}

    # Mirror the DB pre-clear in the in-memory snapshot so subsequent logic
    # operates on a clean slate (no stale projected hold dates from prior runs).
    for lid, lot in lots_dict.items():
        if lot.get("date_td_hold_is_locked"):
            continue
        if lot.get("date_td_hold") is not None and pd.notna(lot.get("date_td_hold")):
            continue
        lots_dict[lid]["date_td_hold_projected"] = None
        # Also clear stale date_td_projected written by S-0760 (mirrors DB pre-clear)
        if (lot.get("date_td") is None or pd.isna(lot.get("date_td"))) and not lot.get("date_td_is_locked"):
            lots_dict[lid]["date_td_projected"] = None

    # lot_id → new hold date assigned this run (for batch DB persistence)
    updated_lot_ids: dict[int, object] = {}

    residual_gaps = []

    for tda_id, covered_lot_ids in tda_lot_map.items():
        # Load TDA config including builder_id
        tda_row = conn.read_df(
            """
            SELECT tda_id, anchor_date, status, checkpoint_lead_days, builder_id
            FROM sim_takedown_agreements
            WHERE tda_id = %s
            """,
            (tda_id,),
        )
        if tda_row.empty:
            continue

        raw_lead = tda_row.iloc[0]["checkpoint_lead_days"]
        lead = _DEFAULT_LEAD_DAYS if (raw_lead is None or pd.isna(raw_lead)) else int(raw_lead)
        raw_builder = tda_row.iloc[0]["builder_id"]
        tda_builder_id = (
            None if (raw_builder is None or pd.isna(raw_builder))
            else int(raw_builder)
        )
        # Load checkpoints in order
        checkpoints = conn.read_df(
            """
            SELECT checkpoint_id, checkpoint_number, lots_required_cumulative, checkpoint_date
            FROM sim_takedown_checkpoints
            WHERE tda_id = %s
            ORDER BY checkpoint_date ASC NULLS LAST, checkpoint_number ASC
            """,
            (tda_id,),
        )
        if checkpoints.empty:
            continue

        # Build per-TDA lot dict filtered by resolved builder_id match
        tda_snapshot_lots = {}
        for lid in covered_lot_ids:
            if lid not in lots_dict:
                continue
            lot = lots_dict[lid]
            if tda_builder_id is not None:
                # Three-tier priority: override > marks/engine-assigned
                raw_ov = lot.get("builder_id_override")
                raw_b  = lot.get("builder_id")
                resolved = (
                    raw_ov if (raw_ov is not None and pd.notna(raw_ov))
                    else raw_b
                )
                if resolved is None or pd.isna(resolved):
                    continue  # builder not yet assigned — cannot route
                if int(resolved) != tda_builder_id:
                    continue  # wrong builder
            tda_snapshot_lots[lid] = lot

        if not tda_snapshot_lots:
            logger.warning(
                f"  TDA {tda_id}: no snapshot lots match builder_id={tda_builder_id}. Skipping."
            )
            continue

        def _assign_hold(lid, hold_date):
            lots_dict[lid]["date_td_hold_projected"] = hold_date
            updated_lot_ids[lid] = hold_date

        hc_assigned_this_run = 0

        # Track the first unsatisfied checkpoint's hold date for the excess push
        first_unsatisfied_hold: object = None

        for _, cp in checkpoints.iterrows():
            if cp["checkpoint_date"] is None or pd.isna(cp["checkpoint_date"]):
                logger.warning(
                    f"  TDA {tda_id} CP{int(cp['checkpoint_number'])}: "
                    "skipping — no checkpoint_date set"
                )
                continue
            cp_id    = int(cp["checkpoint_id"])
            raw_num  = cp["checkpoint_number"]
            cp_num   = int(raw_num) if (raw_num is not None and pd.notna(raw_num)) else cp_id
            cp_date  = pd.Timestamp(cp["checkpoint_date"])
            raw_req  = cp["lots_required_cumulative"]
            if raw_req is None or pd.isna(raw_req):
                logger.warning(
                    f"  TDA {tda_id} CP{cp_num}: "
                    "skipping — lots_required_cumulative is NULL"
                )
                continue
            required = int(raw_req)
            today    = date.today()
            is_past  = cp_date.date() < today

            count_taken = sum(
                1 for lot in tda_snapshot_lots.values() if _fulfills(lot, cp_date)
            )

            if count_taken >= required:
                logger.info(f"  TDA {tda_id} CP{cp_num}: Met ({count_taken}/{required})")
                continue

            gap = required - count_taken

            if is_past:
                # Past unmet checkpoint — obligation was missed; no HC assignment possible.
                # Record the gap for visibility and move on.
                logger.warning(f"  TDA {tda_id} CP{cp_num}: Failed (past, gap={gap})")
                residual_gaps.append({
                    "tda_id":            tda_id,
                    "checkpoint_id":     cp_id,
                    "checkpoint_number": cp_num,
                    "checkpoint_date":   str(cp_date.date()),
                    "required":          required,
                    "projected":         count_taken,
                    "gap":               gap,
                })
                continue

            # Future unmet checkpoint — assign HC hold dates.
            hold_date = max((cp_date - timedelta(days=lead)).date(), hc_floor)

            if first_unsatisfied_hold is None:
                first_unsatisfied_hold = hold_date

            available = sorted(
                (lot for lot in tda_snapshot_lots.values() if _available(lot)),
                key=lambda l: (
                    pd.Timestamp(l["date_dev"]) if l.get("date_dev") is not None and pd.notna(l.get("date_dev"))
                    else pd.Timestamp.max
                ),
            )

            effective_gap = gap

            scheduled = 0
            for lot in available:
                if scheduled >= effective_gap:
                    break
                lid = int(lot["lot_id"])
                _assign_hold(lid, hold_date)
                count_taken += 1
                scheduled   += 1
                hc_assigned_this_run += 1

            if scheduled >= gap:
                logger.info(
                    f"  TDA {tda_id} CP{cp_num}: Managed "
                    f"({scheduled} scheduled, hold {hold_date})"
                )
            else:
                residual = gap - scheduled
                logger.warning(f"  TDA {tda_id} CP{cp_num}: At Risk (gap={residual})")
                residual_gaps.append({
                    "tda_id":            tda_id,
                    "checkpoint_id":     cp_id,
                    "checkpoint_number": cp_num,
                    "checkpoint_date":   str(cp_date.date()),
                    "required":          required,
                    "projected":         count_taken,
                    "gap":               residual,
                })

        # ── Excess push ───────────────────────────────────────────────────────
        # Pool lots with no td/hold/str that weren't scheduled above are spread
        # across checkpoint hold dates in round-robin order so excess absorption
        # tracks the checkpoint cadence rather than piling on a single date.
        today = date.today()
        cp_hold_dates = []
        for _, cp in checkpoints.iterrows():
            if cp["checkpoint_date"] is None or pd.isna(cp["checkpoint_date"]):
                continue
            if pd.Timestamp(cp["checkpoint_date"]).date() < today:
                continue  # past checkpoints excluded from excess push
            n = (pd.Timestamp(cp["checkpoint_date"]) - timedelta(days=lead)).date()
            cp_hold_dates.append(max(n, hc_floor))
        if not cp_hold_dates:
            continue  # no dated checkpoints — nothing to push excess lots toward
        if first_unsatisfied_hold is not None:
            # Start cycling from the first unsatisfied checkpoint
            start_idx = next(
                (i for i, d in enumerate(cp_hold_dates) if d == first_unsatisfied_hold),
                0,
            )
            cp_hold_dates = cp_hold_dates[start_idx:] + cp_hold_dates[:start_idx]
        # If all satisfied, cycle across all hold dates (starting from first)

        excess_lots = sorted(
            (lot for lot in tda_snapshot_lots.values()
             if int(lot["lot_id"]) not in updated_lot_ids and _available(lot)),
            key=lambda l: (
                pd.Timestamp(l["date_dev"]) if l.get("date_dev") is not None and pd.notna(l.get("date_dev"))
                else pd.Timestamp.max
            ),
        )
        excess_budget = max(0, (hc_budget - hc_assigned_this_run)) if hc_budget is not None else len(excess_lots)
        excess_count = 0
        for i, lot in enumerate(excess_lots):
            if excess_count >= excess_budget:
                break
            hold_date = cp_hold_dates[i % len(cp_hold_dates)]
            lid = int(lot["lot_id"])
            _assign_hold(lid, hold_date)
            excess_count += 1

        if excess_count:
            logger.info(
                f"  TDA {tda_id}: excess push → {excess_count} lot(s) spread across {len(cp_hold_dates)} checkpoint hold date(s)"
            )

    # ── Persist date_td_hold_projected to DB ──────────────────────────────────
    if updated_lot_ids:
        updates = [(hold_date, lot_id) for lot_id, hold_date in updated_lot_ids.items()]
        conn.execute_values(
            """
            UPDATE sim_lots AS sl
            SET date_td_hold_projected = v.hold_date::date,
                updated_at = NOW()
            FROM (VALUES %s) AS v(hold_date, lot_id)
            WHERE sl.lot_id = v.lot_id::bigint
              AND sl.date_td_hold_is_locked IS NOT TRUE
            """,
            updates,
        )
        logger.info(f"  S-0500: Persisted date_td_hold_projected to {len(updates)} lot(s).")

    updated_df = pd.DataFrame(list(lots_dict.values()))
    updated_df = updated_df[lot_snapshot.columns.tolist()]
    return updated_df, residual_gaps
