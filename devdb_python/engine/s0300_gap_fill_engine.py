# s03_gap_fill_engine.py
# S-03: Fill missing date fields only where a true gap exists (D-084, D-085).
#
# Owns:     Assigning engine_filled dates to null date fields. Setting source tags.
# Not Own:  Validating date order (S-04). Applying actuals (S-02).
#           Any policy decision on valid sequences.
# Inputs:   Lot snapshot with actuals applied (from S-02).
#           phase_delivery_dates: optional {phase_id: date} from coordinator for no-anchor fallback.
# Outputs:  Lot snapshot with missing dates filled where true gaps exist.
#           Lots with only date_dev and no downstream dates returned unchanged (D-084).
#           Lots with zero milestone dates filled from phase delivery date (Scenario 7 fallback).
#
# Gap-fill rules (D-084, D-085):
#   date_td:  only if date_dev set AND at least one of date_str/date_cmp/date_cls exists
#   date_str: only if date_td set AND at least one of date_cmp/date_cls exists. Never on H lots.
#   date_cmp: only if date_str set AND date_cls already exists
#   date_cls: if date_cmp set (forward terminus -- no right anchor needed)
#
# H lot = date_td_hold set AND date_td null. Never fill date_str on H lots.
#
# No-anchor fallback (Scenario 7):
#   If a lot has zero milestone dates (date_ent/date_dev/date_td/date_td_hold/date_str/
#   date_cmp/date_cls all null), use the phase delivery date (date_dev_projected) as anchor.
#   Fill date_dev = anchor, then fill date_td/date_str/date_cmp/date_cls forward using
#   the same lag constants. Tag all filled dates engine_filled.
#   If no phase delivery date exists, log and leave unchanged.

import pandas as pd

# System default lags (days) -- used when no curve configured
DEFAULT_LAG_TD_FROM_DEV  = 30
DEFAULT_LAG_STR_FROM_TD  = 14
DEFAULT_LAG_CMP_FROM_STR = 270
DEFAULT_LAG_CLS_FROM_CMP = 45


def gap_fill_engine(lot_snapshot: pd.DataFrame,
                    phase_delivery_dates: dict = None) -> pd.DataFrame:
    """
    Fill missing dates only where a true gap exists between two known dates.
    A lot with only date_dev set and no downstream dates has no gap -- leave it.

    No-anchor fallback: if phase_delivery_dates is provided (dict of phase_id -> date),
    lots with zero milestone dates are filled from the phase delivery date (Scenario 7).
    Pure computation -- no DB access.
    """
    df = lot_snapshot.copy()

    # Normalize all date columns to pd.Timestamp (Databricks returns datetime.date;
    # Timedelta arithmetic produces pd.Timestamp -- normalize up front so comparisons
    # are consistent throughout this module and all downstream modules).
    _date_cols = [
        "date_ent", "date_dev", "date_td", "date_td_hold",
        "date_str", "date_frm", "date_cmp", "date_cls",
    ]
    for _col in _date_cols:
        if _col in df.columns:
            # utc=True handles tz-aware inputs (schedhousedetail returns TIMESTAMP Etc/UTC);
            # tz_localize(None) strips tz so all date columns are tz-naive datetime64[ns].
            df[_col] = (
                pd.to_datetime(df[_col], errors="coerce", utc=True)
                .dt.tz_localize(None)
            )

    # Compute predicates once against the initial snapshot state
    is_h_lot = df["date_td_hold"].notna() & df["date_td"].isna()

    has_downstream_of_dev = (
        df["date_str"].notna() | df["date_cmp"].notna() | df["date_cls"].notna()
    )
    has_downstream_of_td = df["date_cmp"].notna() | df["date_cls"].notna()

    # Fill date_td: date_dev set AND downstream date exists, not H lot
    mask_td = (
        df["date_td"].isna()
        & ~is_h_lot
        & df["date_dev"].notna()
        & has_downstream_of_dev
    )
    if mask_td.any():
        df.loc[mask_td, "date_td"] = (
            df.loc[mask_td, "date_dev"] + pd.Timedelta(days=DEFAULT_LAG_TD_FROM_DEV)
        )

    # Fill date_str: date_td set (including just-filled) AND downstream exists, not H lot
    mask_str = (
        df["date_str"].isna()
        & ~is_h_lot
        & df["date_td"].notna()
        & has_downstream_of_td
    )
    if mask_str.any():
        df.loc[mask_str, "date_str"] = (
            df.loc[mask_str, "date_td"] + pd.Timedelta(days=DEFAULT_LAG_STR_FROM_TD)
        )
        # Set source only where not already tagged (never overwrite 'actual' or 'manual')
        df.loc[mask_str & df["date_str_source"].isna(), "date_str_source"] = "engine_filled"

    # Fill date_cmp: date_str set (including just-filled) AND date_cls already exists
    mask_cmp = (
        df["date_cmp"].isna()
        & df["date_str"].notna()
        & df["date_cls"].notna()
    )
    if mask_cmp.any():
        df.loc[mask_cmp, "date_cmp"] = (
            df.loc[mask_cmp, "date_str"] + pd.Timedelta(days=DEFAULT_LAG_CMP_FROM_STR)
        )
        df.loc[mask_cmp & df["date_cmp_source"].isna(), "date_cmp_source"] = "engine_filled"

    # Fill date_cls: date_cmp set (including just-filled). Forward terminus -- no right anchor needed.
    mask_cls = df["date_cls"].isna() & df["date_cmp"].notna()
    if mask_cls.any():
        df.loc[mask_cls, "date_cls"] = (
            df.loc[mask_cls, "date_cmp"] + pd.Timedelta(days=DEFAULT_LAG_CLS_FROM_CMP)
        )
        df.loc[mask_cls & df["date_cls_source"].isna(), "date_cls_source"] = "engine_filled"

    # --- No-anchor fallback (Scenario 7) ---
    # Lots with zero milestone dates get all dates filled from the phase delivery date.
    # Only runs when the coordinator supplies phase_delivery_dates; pure computation otherwise.
    if phase_delivery_dates and "phase_id" in df.columns:
        _milestone_cols = [c for c in [
            "date_ent", "date_dev", "date_td", "date_td_hold",
            "date_str", "date_cmp", "date_cls",
        ] if c in df.columns]
        mask_no_anchor = df[_milestone_cols].isna().all(axis=1)

        if mask_no_anchor.any():
            _phase_ts = {
                int(k): pd.Timestamp(v)
                for k, v in phase_delivery_dates.items()
                if v is not None
            }
            # Map each no-anchor lot's phase_id to its delivery date
            _anchor = df.loc[mask_no_anchor, "phase_id"].map(
                lambda pid: _phase_ts.get(int(pid)) if pd.notna(pid) else None
            )
            # fill_mask: no-anchor lots that have a phase delivery date
            fill_mask = mask_no_anchor & _anchor.reindex(df.index).notna()

            if fill_mask.any():
                _anc = df.loc[fill_mask, "phase_id"].map(
                    lambda pid: _phase_ts.get(int(pid)) if pd.notna(pid) else None
                )
                _td  = _anc + pd.Timedelta(days=DEFAULT_LAG_TD_FROM_DEV)
                _str = _td  + pd.Timedelta(days=DEFAULT_LAG_STR_FROM_TD)
                _cmp = _str + pd.Timedelta(days=DEFAULT_LAG_CMP_FROM_STR)
                _cls = _cmp + pd.Timedelta(days=DEFAULT_LAG_CLS_FROM_CMP)

                df.loc[fill_mask, "date_dev"] = _anc.values
                df.loc[fill_mask, "date_td"]  = _td.values
                df.loc[fill_mask, "date_str"] = _str.values
                df.loc[fill_mask & df["date_str_source"].isna(), "date_str_source"] = "engine_filled"
                df.loc[fill_mask, "date_cmp"] = _cmp.values
                df.loc[fill_mask & df["date_cmp_source"].isna(), "date_cmp_source"] = "engine_filled"
                df.loc[fill_mask, "date_cls"] = _cls.values
                df.loc[fill_mask & df["date_cls_source"].isna(), "date_cls_source"] = "engine_filled"
                print(f"  S-03 no-anchor fallback: {fill_mask.sum()} lot(s) filled from "
                      f"phase delivery date (engine_filled).")

            no_phase_date = mask_no_anchor & ~fill_mask
            if no_phase_date.any():
                for _, r in df.loc[no_phase_date].iterrows():
                    print(f"  S-03 no-anchor fallback: lot_id={int(r['lot_id'])} "
                          f"phase_id={r.get('phase_id')} has no phase delivery date. Left unchanged.")

    return df
