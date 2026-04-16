"""
S-0400 chronology_validator — Detect date ordering violations before simulation proceeds.

Reads:   lot snapshot DataFrame (read-only)
Writes:  nothing — returns snapshot unchanged
Input:   lot_snapshot: DataFrame
Rules:   Checks date_ent <= date_dev <= date_td <= date_str <= date_cmp <= date_cls.
         Returns (lot_snapshot_unchanged, violations_df, has_violations: bool).
         Read-only — never modifies lot data. Validator error treated as blocking.
         Not Own: fixing violations (user resolves via UI per Scenario 6).
"""

from datetime import datetime, timezone

import pandas as pd

from .connection import DBConnection


def persist_violations(conn: DBConnection, violations_df, dev_id: int,
                       sim_run_id: int) -> None:
    """
    Clear stale violations for this development, then write current violations
    from S-04 to sim_lot_date_violations.
    resolution = 'pending' for all new rows (Path A/B UI resolution deferred).
    """
    conn.execute(
        """
        DELETE FROM sim_lot_date_violations
        WHERE lot_id IN (
            SELECT lot_id FROM sim_lots
            WHERE dev_id = %s
        )
        """,
        (dev_id,),
    )

    if violations_df is None or (hasattr(violations_df, 'empty') and violations_df.empty):
        return

    now = datetime.now(timezone.utc)

    rows = []
    for _, vrow in violations_df.iterrows():
        ev = vrow["date_value_early"]
        lv = vrow["date_value_late"]
        rows.append({
            "sim_run_id":       sim_run_id,
            "lot_id":           int(vrow["lot_id"]),
            "violation_type":   vrow["violation_type"],
            "date_field_early": vrow["date_field_early"],
            "date_value_early": ev.date() if hasattr(ev, 'date') and callable(ev.date) else ev,
            "date_field_late":  vrow["date_field_late"],
            "date_value_late":  lv.date() if hasattr(lv, 'date') and callable(lv.date) else lv,
            "resolution":       "pending",
            "created_at":       now,
        })

    conn.executemany_insert("sim_lot_date_violations", rows)


def chronology_validator(lot_snapshot: pd.DataFrame):
    """
    Check date ordering on all lots in snapshot.
    Returns (lot_snapshot_unchanged, violations_df, has_violations bool).
    lot_snapshot is returned unchanged -- this module never modifies lots.
    """
    checks = [
        ("date_ent",  "date_dev",  "ent_after_dev"),
        ("date_dev",  "date_td",   "dev_after_td"),
        ("date_td",   "date_str",  "td_after_str"),
        ("date_str",  "date_cmp",  "str_after_cmp"),
        ("date_cmp",  "date_cls",  "cmp_after_cls"),
    ]

    frames = []
    for early_col, late_col, violation_type in checks:
        mask = (
            lot_snapshot[early_col].notna()
            & lot_snapshot[late_col].notna()
            & (lot_snapshot[early_col] > lot_snapshot[late_col])
        )
        if not mask.any():
            continue
        vf = lot_snapshot.loc[mask, ["lot_id"]].copy()
        vf["violation_type"]    = violation_type
        vf["date_field_early"]  = early_col
        vf["date_value_early"]  = lot_snapshot.loc[mask, early_col].values
        vf["date_field_late"]   = late_col
        vf["date_value_late"]   = lot_snapshot.loc[mask, late_col].values
        vf["resolution"]        = "pending"
        frames.append(vf)

    if frames:
        violations_df = pd.concat(frames, ignore_index=True)
    else:
        violations_df = pd.DataFrame(columns=[
            "lot_id", "violation_type", "date_field_early", "date_value_early",
            "date_field_late", "date_value_late", "resolution",
        ])

    has_violations = len(violations_df) > 0
    return lot_snapshot, violations_df, has_violations
