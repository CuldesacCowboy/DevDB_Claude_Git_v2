"""
S-0300 gap_fill_engine — Fill missing date fields only where a true gap exists (D-084, D-085).

Reads:   lot snapshot DataFrame; phase_delivery_dates: {phase_id: date} optional
Writes:  lot snapshot DataFrame (date_td, date_str, date_cmp, date_cls, *_source columns)
Input:   lot_snapshot: DataFrame, phase_delivery_dates: dict = None
Rules:   True-gap-only per D-084/D-085. Never fill forward from a single anchor.
         date_td:  only if date_dev AND (date_str OR date_cmp OR date_cls) exist.
         date_str: only if date_td AND (date_cmp OR date_cls) exist. Never on H lots.
         date_cmp: only if date_str AND date_cls exist.
         date_cls: if date_cmp set (forward terminus — no right anchor needed).
         H lot = date_td_hold set AND date_td null. Fallback: use phase delivery date
         if lot has zero milestone dates (Scenario 7), tagged engine_filled.
         Not Own: validating order (S-04), applying actuals (S-02).
"""
# No-anchor fallback (Scenario 7):
#   If a lot has zero milestone dates (date_ent/date_dev/date_td/date_td_hold/date_str/
#   date_cmp/date_cls all null), use the phase delivery date (date_dev_projected) as anchor.
#   Fill date_dev = anchor, then fill date_td/date_str/date_cmp/date_cls forward using
#   the same lag constants. Tag all filled dates engine_filled.
#   If no phase delivery date exists, log and leave unchanged.

import pandas as pd

from .connection import DBConnection


def load_phase_delivery_dates(conn: DBConnection, dev_id: int) -> dict:
    """
    Load {phase_id: date} for all phases in this development.
    Used by the no-anchor fallback (Scenario 7): lots with zero milestone dates
    receive the phase delivery date as a gap-fill anchor.
    """
    df = conn.read_df(
        """
        SELECT DISTINCT sdp.phase_id, sdp.date_dev_projected
        FROM sim_dev_phases sdp
        WHERE sdp.dev_id = %s
          AND sdp.phase_id IN (
              SELECT DISTINCT phase_id FROM sim_lots
              WHERE dev_id = %s
                AND lot_source = 'real'
                AND excluded IS NOT TRUE
          )
        """,
        (dev_id, dev_id),
    )
    result = {}
    for _, r in df.iterrows():
        d = r["date_dev_projected"]
        if d is not None and hasattr(d, 'date'):
            d = d.date()
        result[int(r["phase_id"])] = d
    return result


# System default lags (days) -- used when no curve or param configured.
# STR_FROM_TD raised from 14 to 45: takedown closes on the lot, builder still
# needs permits pulled (2-6 wks depending on jurisdiction) before breaking ground.
DEFAULT_LAG_TD_FROM_DEV  = 30
DEFAULT_LAG_STR_FROM_TD  = 45
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
