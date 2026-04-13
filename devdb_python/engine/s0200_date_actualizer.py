"""
S-0200 date_actualizer — Apply MARKsystems actual dates from schedhousedetail to lot snapshot.

Reads:   schedhousedetail (DB, filtered to dev_codes in snapshot, 266,554 rows)
Writes:  lot snapshot DataFrame (date_str, date_frm, date_cmp, date_cls, date_td,
         date_td_hold, and corresponding *_source columns)
Input:   lot_snapshot: DataFrame, conn: DBConnection
Rules:   Priority per D-029: actualfinishdate (inactive != 'Y') → rvearlyfinshdate →
         earlyfinishdate. Activity codes: 135→td, 136→td_hold, A05→str, F15→frm,
         V86→cmp, V96→cls. Never overwrite date_str_source = 'manual'.
         Not Own: filling nulls (S-03), validating order (S-04).
"""

import logging

import pandas as pd
from .connection import DBConnection

logger = logging.getLogger(__name__)

# Activity code -> (target date column, source tag column or None)
_ACT_MAP = {
    "135": ("date_td",      None),
    "136": ("date_td_hold", None),
    "A05": ("date_str",     "date_str_source"),
    "F15": ("date_frm",     None),
    "V86": ("date_cmp",     "date_cmp_source"),
    "V96": ("date_cls",     "date_cls_source"),
}


def _resolve_marks_date(row: pd.Series):
    """
    MARKsystems date priority per milestone row:
      actualfinishdate (if inactive != 'Y' -- null inactive means active)
      -> rvearlyfinshdate
      -> earlyfinishdate

    Null inactive guard is critical: Spark evaluates null != 'Y' as null (not True).
    Equivalent rule: only skip actualfinishdate when inactive is explicitly 'Y'.
    """
    actual = row["actualfinishdate"]
    inactive = row["inactive"]
    rv = row["rvearlyfinshdate"]
    early = row["earlyfinishdate"]

    inactive_upper = str(inactive).upper() if pd.notna(inactive) else None
    if pd.notna(actual) and inactive_upper != "Y":
        return actual
    if pd.notna(rv):
        return rv
    if pd.notna(early):
        return early
    return None


def _write_back_dates(conn: DBConnection, df: pd.DataFrame) -> None:
    """
    Persist S-02 resolved actual dates back to sim_lots for real lots.
    Writes date_td, date_td_hold, date_str, date_cmp, date_cls and their _source columns.
    One UPDATE per column using VALUES subquery -- single round-trip each.
    Only rows where S-02 resolved a non-null value are written.
    Never touches lot_source or any other column.
    """
    real = df[(df["lot_source"] == "real") & df["lot_id"].notna()].copy()
    if real.empty:
        return

    write_cols = [
        ("date_td",      None),
        ("date_td_hold", None),
        ("date_str",     "date_str_source"),
        ("date_cmp",     "date_cmp_source"),
        ("date_cls",     "date_cls_source"),
    ]
    written_lot_ids: set = set()

    for date_col, source_col in write_cols:
        subset = real[real[date_col].notna()][["lot_id", date_col]]
        if subset.empty:
            continue

        pairs = []
        for _, r in subset.iterrows():
            d = r[date_col]
            if hasattr(d, "date"):
                d = d.date()
            pairs.append((int(r["lot_id"]), str(d)))

        if source_col is None:
            conn.execute_values(
                f"""
                UPDATE sim_lots AS t
                SET {date_col} = v.d::DATE
                FROM (VALUES %s) AS v(lot_id, d)
                WHERE t.lot_id = v.lot_id::bigint
                  AND t.lot_source = 'real'
                  AND t.{date_col}_is_locked IS NOT TRUE
                """,
                pairs,
            )
        else:
            conn.execute_values(
                f"""
                UPDATE sim_lots AS t
                SET {date_col} = v.d::DATE, {source_col} = 'actual'
                FROM (VALUES %s) AS v(lot_id, d)
                WHERE t.lot_id = v.lot_id::bigint
                  AND t.lot_source = 'real'
                  AND t.{source_col} IS DISTINCT FROM 'manual'
                """,
                pairs,
            )
        written_lot_ids.update(lid for lid, _ in pairs)

    if written_lot_ids:
        logger.info(f"S-02: Persisted actual dates for {len(written_lot_ids)} real lot(s).")


def date_actualizer(conn: DBConnection, lot_snapshot: pd.DataFrame) -> pd.DataFrame:
    """
    Apply MARKsystems actual dates to lot snapshot from schedhousedetail.

    Join key: marks_lot_registry (lot_number → developmentcode + housenumber).
    Replaces the old regex approach which failed for numeric dev codes (e.g. '43').

    Only rows for dev_codes present in the snapshot are pulled from schedhousedetail.
    Never overwrites date_str_source = 'manual'.
    Persists resolved dates back to sim_lots for real lots (_write_back_dates).
    """
    if lot_snapshot.empty:
        return lot_snapshot

    df = lot_snapshot.copy()

    # Map real lot_number → (developmentcode, housenumber) via marks_lot_registry.
    # The old regex approach ('^([A-Z]+)') silently dropped lots whose lot numbers start
    # with digits, e.g. '4300000002' for 43 North (dev code '43').
    # marks_lot_registry is the authoritative mapping for all real MARKS lots.
    real_lot_numbers = df.loc[df["lot_source"] == "real", "lot_number"].dropna().unique().tolist()
    if real_lot_numbers:
        mlr = conn.read_df(
            "SELECT DISTINCT lot_number, developmentcode AS _dev_code, housenumber AS _lot_seq "
            "FROM marks_lot_registry WHERE lot_number = ANY(%s)",
            (real_lot_numbers,),
        )
        mlr["_lot_seq"] = pd.to_numeric(mlr["_lot_seq"], errors="coerce").astype("Int64")
        df = df.merge(mlr[["lot_number", "_dev_code", "_lot_seq"]], on="lot_number", how="left")
    else:
        df["_dev_code"] = pd.NA
        df["_lot_seq"] = pd.NA

    dev_codes = df["_dev_code"].dropna().unique().tolist()
    if not dev_codes:
        df.drop(columns=["_dev_code", "_lot_seq"], inplace=True)
        return df

    act_codes = list(_ACT_MAP.keys())

    # Pull only relevant rows server-side — ANY(%s) avoids dynamic IN-list construction
    sched_raw = conn.read_df(
        """
        SELECT developmentcode, housenumber, activitycode,
               actualfinishdate, rvearlyfinshdate, earlyfinishdate, inactive
        FROM schedhousedetail
        WHERE developmentcode = ANY(%s)
          AND activitycode    = ANY(%s)
        """,
        (dev_codes, act_codes),
    )

    if sched_raw.empty:
        df.drop(columns=["_dev_code", "_lot_seq"], inplace=True)
        return df

    # Apply date priority per row, drop rows with no resolved date
    sched_raw["resolved_date"] = sched_raw.apply(_resolve_marks_date, axis=1)
    sched_raw = sched_raw[sched_raw["resolved_date"].notna()].copy()

    if sched_raw.empty:
        df.drop(columns=["_dev_code", "_lot_seq"], inplace=True)
        return df

    sched_raw["housenumber"] = (
        pd.to_numeric(sched_raw["housenumber"], errors="coerce").astype("Int64")
    )

    # For each activity code: MAX resolved_date per (devcode, housenumber), merge onto snapshot
    for act_code, (date_col, source_col) in _ACT_MAP.items():
        act_rows = sched_raw[sched_raw["activitycode"] == act_code]
        if act_rows.empty:
            continue

        act_max = (
            act_rows
            .groupby(["developmentcode", "housenumber"])["resolved_date"]
            .max()
            .reset_index()
            .rename(columns={
                "resolved_date": f"_a_{act_code}",
                "developmentcode": "_adev",
                "housenumber": "_aseq",
            })
        )

        df = df.merge(
            act_max,
            left_on=["_dev_code", "_lot_seq"],
            right_on=["_adev", "_aseq"],
            how="left",
        )
        df.drop(columns=["_adev", "_aseq"], inplace=True)

        merged_col = f"_a_{act_code}"
        if merged_col not in df.columns:
            continue

        mask = df[merged_col].notna()

        # Special rule: never overwrite date_str_source = 'manual'
        if date_col == "date_str":
            mask = mask & (
                df["date_str_source"].isna() | (df["date_str_source"] != "manual")
            )

        df.loc[mask, date_col] = df.loc[mask, merged_col]

        if source_col is not None:
            df.loc[mask, source_col] = "actual"

        df.drop(columns=[merged_col], inplace=True)

    df.drop(columns=["_dev_code", "_lot_seq"], inplace=True)

    # Persist resolved actual dates back to sim_lots for real lots (bug fix: was in-memory only)
    _write_back_dates(conn, df)

    return df
