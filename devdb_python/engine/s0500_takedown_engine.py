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
         HC is a last resort: for each future checkpoint, effective_gap = required -
         actual_fulfilled - projected_natural (where projected_natural = min(eligible_unstarted,
         round(monthly_rate × months_to_checkpoint))). HC is only assigned to lots that demand
         pace genuinely cannot reach before the deadline; the rest flow D→U naturally.
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
                    scheduling_horizon_days: int = 0,
                    hc_to_bldr_lag_days: int = 16):
    """
    Enforce TDA checkpoint obligations.
    Writes date_td_hold_projected only — never actuals.
    HC hold dates are floored to today + scheduling_horizon_days.
    hc_to_bldr_lag_days: days before checkpoint date that HC holds are scheduled.
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
    # Also clears building-group mates of TDA lots so the post-assign sync
    # (below) always writes a fresh unified hold date each run.
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
    # Clear synced hold dates from building-group mates (non-TDA lots that received
    # a hold in the previous run's building-group sync step).
    conn.execute(
        """
        UPDATE sim_lots
        SET date_td_hold_projected = NULL
        WHERE dev_id = %s
          AND date_td_hold IS NULL
          AND date_td_hold_is_locked IS NOT TRUE
          AND date_td_hold_projected IS NOT NULL
          AND building_group_id IN (
              SELECT DISTINCT sl2.building_group_id
              FROM sim_lots sl2
              JOIN sim_takedown_agreement_lots tal ON tal.lot_id = sl2.lot_id
              JOIN sim_takedown_agreements ta ON ta.tda_id = tal.tda_id
              WHERE ta.status = 'active'
                AND sl2.building_group_id IS NOT NULL
                AND sl2.dev_id = %s
          )
        """,
        (dev_id, dev_id),
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

    # Load pace from sim_dev_params so we can project how much natural demand will
    # satisfy each checkpoint before assigning HC holds.  HC is a last resort —
    # if demand at the configured annual pace will cover the checkpoint obligation
    # naturally, no HC hold should be written.
    _params_df = conn.read_df(
        "SELECT annual_starts_target FROM sim_dev_params WHERE dev_id = %s LIMIT 1",
        (dev_id,),
    )
    monthly_rate = (float(_params_df.iloc[0]["annual_starts_target"]) / 12.0
                    if not _params_df.empty else 1.0)

    for tda_id, covered_lot_ids in tda_lot_map.items():
        # Load TDA config including builder_id
        tda_row = conn.read_df(
            """
            SELECT tda_id, anchor_date, status, builder_id
            FROM sim_takedown_agreements
            WHERE tda_id = %s
            """,
            (tda_id,),
        )
        if tda_row.empty:
            continue

        lead = hc_to_bldr_lag_days
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
                # Past checkpoint, not met on time.  Check if it has been caught up
                # since the deadline — late is still late, but if the cumulative
                # obligation has since been satisfied, life goes on: no residual gap.
                count_now = sum(
                    1 for lot in tda_snapshot_lots.values()
                    if _fulfills(lot, pd.Timestamp(today))
                )
                if count_now >= required:
                    logger.info(
                        f"  TDA {tda_id} CP{cp_num}: Met Late "
                        f"({count_taken}/{required} by deadline, {count_now} by today)"
                    )
                else:
                    logger.warning(
                        f"  TDA {tda_id} CP{cp_num}: Failed (past, gap={gap}, "
                        f"still only {count_now} by today)"
                    )
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

            available = sorted(
                (lot for lot in tda_snapshot_lots.values() if _available(lot)),
                key=lambda l: (
                    pd.Timestamp(l["date_dev"]) if l.get("date_dev") is not None and pd.notna(l.get("date_dev"))
                    else pd.Timestamp.max
                ),
            )

            # Count lots that already have a projected takedown date on or before
            # the checkpoint.  These are the ones demand has already "claimed" via
            # S-0760/S-0770 — they will fulfill the checkpoint without HC.
            # The old pace-based estimate (monthly_rate * months) was too optimistic:
            # it assumed demand would cover N lots, but their projected dates often
            # landed after the checkpoint, leaving it unmet.
            projected_natural = 0
            for lot in tda_snapshot_lots.values():
                if _available(lot):
                    td_proj = lot.get("date_td_projected")
                    if td_proj is not None and pd.notna(td_proj):
                        if pd.Timestamp(td_proj) <= cp_date:
                            projected_natural += 1
            effective_gap = max(0, gap - projected_natural)

            scheduled = 0
            for lot in available:
                if scheduled >= effective_gap:
                    break
                lid = int(lot["lot_id"])
                _assign_hold(lid, hold_date)
                count_taken += 1
                scheduled   += 1

            if effective_gap == 0:
                logger.info(
                    f"  TDA {tda_id} CP{cp_num}: Demand covers gap "
                    f"(gap={gap}, projected_natural={projected_natural}) — no HC assigned"
                )
            elif scheduled >= effective_gap:
                logger.info(
                    f"  TDA {tda_id} CP{cp_num}: Managed "
                    f"({scheduled} HC scheduled, hold {hold_date})"
                )
            else:
                residual = effective_gap - scheduled
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

        # No excess push: HC is a last resort.  Lots not needed to fill a genuine
        # demand-gap checkpoint are left to flow naturally D→U via demand.  Forcing
        # them into H when demand would cover them produces misleading projections.

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

    # ── Building-group HC sync ────────────────────────────────────────────────
    # Invariant: all lots in a building share the same HC hold date.
    # S-0500 assigns holds lot-by-lot from TDA checkpoints; different lots in
    # the same building may land on different checkpoints and get different hold
    # dates (e.g. B1 DT1/2/3 → Dec 2026 checkpoint, DT4 → Dec 2027 checkpoint).
    # Propagate MAX(date_td_hold_projected) to all group mates so no unit shows
    # a different HC date.
    conn.execute(
        """
        UPDATE sim_lots sl
        SET date_td_hold_projected = agg.max_hold,
            updated_at = NOW()
        FROM (
            SELECT building_group_id, MAX(date_td_hold_projected) AS max_hold
            FROM sim_lots
            WHERE dev_id = %s
              AND building_group_id IS NOT NULL
              AND date_td_hold_projected IS NOT NULL
              AND date_td_hold IS NULL
              AND date_td_hold_is_locked IS NOT TRUE
            GROUP BY building_group_id
        ) agg
        WHERE sl.building_group_id = agg.building_group_id
          AND sl.dev_id = %s
          AND sl.date_td_hold IS NULL
          AND sl.date_td_hold_is_locked IS NOT TRUE
          AND (sl.date_td_hold_projected IS NULL
               OR sl.date_td_hold_projected != agg.max_hold)
        """,
        (dev_id, dev_id),
    )
    # Mirror the unified hold into the in-memory snapshot
    bg_max_hold: dict[int, object] = {}
    for lid, lot in lots_dict.items():
        raw_bg = lot.get("building_group_id")
        if raw_bg is None or pd.isna(raw_bg):
            continue
        raw_hold = lot.get("date_td_hold_projected")
        if raw_hold is None or pd.isna(raw_hold):
            continue
        bg_id = int(raw_bg)
        if bg_id not in bg_max_hold or pd.Timestamp(raw_hold) > pd.Timestamp(bg_max_hold[bg_id]):
            bg_max_hold[bg_id] = raw_hold
    for lid, lot in lots_dict.items():
        raw_bg = lot.get("building_group_id")
        if raw_bg is None or pd.isna(raw_bg):
            continue
        bg_id = int(raw_bg)
        if bg_id not in bg_max_hold:
            continue
        if lot.get("date_td_hold_is_locked"):
            continue
        if lot.get("date_td_hold") is not None and pd.notna(lot.get("date_td_hold")):
            continue
        lots_dict[lid]["date_td_hold_projected"] = bg_max_hold[bg_id]
    if bg_max_hold:
        logger.info(f"  S-0500: Synced HC hold date within {len(bg_max_hold)} building group(s).")

    updated_df = pd.DataFrame(list(lots_dict.values()))
    updated_df = updated_df[lot_snapshot.columns.tolist()]
    return updated_df, residual_gaps
