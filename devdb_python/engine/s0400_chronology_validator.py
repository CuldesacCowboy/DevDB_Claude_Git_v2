# s04_chronology_validator.py
# S-04: Detect date ordering violations before simulation proceeds.
#
# Owns:     Checking date_ent <= date_dev <= date_td <= date_str <= date_cmp <= date_cls.
#           Logging violations. Setting blocking flag.
# Not Own:  Fixing violations. Filling dates. Any modification to lot data.
# Inputs:   Gap-filled lot snapshot (from S-03).
# Outputs:  (lot_snapshot_unchanged, violations_df, has_violations bool).
# Failure:  Read-only module. If validator errors, treat as blocking condition.

import pandas as pd


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
