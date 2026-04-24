"""
tda_hc_enforcer -- Enforce HC holds for TDA lots whose BLDR date exceeds checkpoint deadline.

Runs after tda_checkpoint_assigner. For each lot assigned to a checkpoint where
the lot's effective BLDR date is after the checkpoint deadline, writes an HC hold
date = checkpoint_date - hc_to_bldr_lag_days.

Only applies to lots with sim-generated dates (no MARKS actuals).
Also runs building-group HC sync: all lots in a building share MAX hold date.
"""

import logging
from datetime import date, timedelta
from collections import defaultdict

import pandas as pd
from .connection import DBConnection

logger = logging.getLogger(__name__)


def _effective_bldr_date(lot: dict):
    """Effective projected date for sorting."""
    for key in ("date_td", "date_td_projected", "date_td_hold", "date_td_hold_projected", "date_str", "date_dev"):
        v = lot.get(key)
        if v is not None and pd.notna(v):
            return pd.Timestamp(v)
    return pd.Timestamp.max


def _has_marks_actual(lot: dict) -> bool:
    """True if lot has MARKS-sourced actual takedown date."""
    return lot.get("date_td") is not None and pd.notna(lot.get("date_td"))


def tda_hc_enforcer(conn: DBConnection, lot_snapshot: pd.DataFrame, dev_id: int,
                     hc_to_bldr_lag_days: int = 16):
    """
    For each lot assigned to a checkpoint whose BLDR date > checkpoint deadline,
    write HC hold = checkpoint_date - lag. Only for sim-generated dates.
    Returns updated snapshot.
    """
    if lot_snapshot.empty:
        return lot_snapshot

    snapshot_lot_ids = lot_snapshot["lot_id"].dropna().astype(int).tolist()
    if not snapshot_lot_ids:
        return lot_snapshot

    # Load all checkpoint assignments for lots in this snapshot
    assignments = conn.read_df(
        """
        SELECT tla.lot_id, tla.checkpoint_id,
               tc.checkpoint_date, tc.checkpoint_number, tc.tda_id
        FROM sim_takedown_lot_assignments tla
        JOIN sim_takedown_checkpoints tc ON tc.checkpoint_id = tla.checkpoint_id
        WHERE tla.lot_id = ANY(%s)
        """,
        (snapshot_lot_ids,),
    )
    if assignments.empty:
        return lot_snapshot

    df = lot_snapshot.copy()
    lots_dict = {int(row["lot_id"]): row.to_dict() for _, row in df.iterrows()}
    updated_lot_ids = {}  # lot_id -> hold_date
    hc_floor = date.today() + timedelta(days=14)  # scheduling horizon floor

    for _, asgn in assignments.iterrows():
        lid = int(asgn["lot_id"])
        if lid not in lots_dict:
            continue
        lot = lots_dict[lid]

        cp_date = asgn["checkpoint_date"]
        if cp_date is None or pd.isna(cp_date):
            continue
        cp_ts = pd.Timestamp(cp_date)

        # Skip lots with MARKS actual dates
        if _has_marks_actual(lot):
            continue

        # Skip locked lots
        if lot.get("date_td_hold_is_locked"):
            continue

        # Check if lot's BLDR date exceeds checkpoint deadline
        bldr = _effective_bldr_date(lot)
        if bldr <= cp_ts:
            continue  # lot will fulfill checkpoint naturally

        # Assign HC hold
        hold_date = max((cp_ts - timedelta(days=hc_to_bldr_lag_days)).date(), hc_floor)
        lots_dict[lid]["date_td_hold_projected"] = hold_date
        updated_lot_ids[lid] = hold_date

        cp_num = int(asgn["checkpoint_number"]) if asgn["checkpoint_number"] is not None and pd.notna(asgn["checkpoint_number"]) else "?"
        logger.info(
            f"  tda_hc_enforcer: lot {lid} CP{cp_num} HC hold {hold_date} "
            f"(BLDR {bldr.date()} > CP {cp_ts.date()})"
        )

    # Persist
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
        logger.info(f"  tda_hc_enforcer: Wrote HC holds for {len(updates)} lot(s).")

    # Building-group HC sync: propagate MAX hold to all group mates
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

    # Mirror in memory
    bg_max_hold = {}
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
        logger.info(f"  tda_hc_enforcer: Synced HC hold within {len(bg_max_hold)} building group(s).")

    updated_df = pd.DataFrame(list(lots_dict.values()))
    updated_df = updated_df[lot_snapshot.columns.tolist()]
    return updated_df
