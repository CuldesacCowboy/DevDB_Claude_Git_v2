# s02_date_actualizer.py
# S-02: Apply MARKsystems actual dates from schedhousedetail to lot snapshot.
#
# Owns:     Applying schedhousedetail actual dates using priority hierarchy:
#             actualfinishdate (if inactive != 'Y') -> rvearlyfinshdate -> earlyfinishdate
# Not Own:  Filling null dates (S-03). Validating date order (S-04).
#           Any date not from schedhousedetail.
# Inputs:   Lot snapshot from S-01, schedhousedetail (via conn, filtered server-side).
# Outputs:  Updated lot snapshot with actual dates applied. Source tags set.
# Failure:  No matching record -> leave dates unchanged.
#           inactive = 'Y' on actualfinishdate -> skip, fall to rvearlyfinshdate.
#           Never overwrite date_str_source = 'manual'.
#
# NOTE: schedhousedetail has 266,554 rows. The JOIN is performed server-side by
# filtering to dev_codes present in the snapshot before pulling into pandas.

import pandas as pd
from .connection import DBConnection

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

        values_sql = ", ".join(f"({lid}, '{d}'::DATE)" for lid, d in pairs)
        set_clause = f"{date_col} = v.d" if source_col is None else f"{date_col} = v.d, {source_col} = 'actual'"
        conn.execute(f"""
            UPDATE sim_lots AS t
            SET {set_clause}
            FROM (VALUES {values_sql}) AS v(lot_id, d)
            WHERE t.lot_id = v.lot_id
              AND t.lot_source = 'real'
        """)
        written_lot_ids.update(lid for lid, _ in pairs)

    if written_lot_ids:
        print(f"S-02: Persisted actual dates for {len(written_lot_ids)} real lot(s).")


def date_actualizer(conn: DBConnection, lot_snapshot: pd.DataFrame) -> pd.DataFrame:
    """
    Apply MARKsystems actual dates to lot snapshot from schedhousedetail.

    Join key:
      REGEXP_EXTRACT(lot_number, '^([A-Z]+)', 1) = developmentcode
      CAST(REGEXP_EXTRACT(lot_number, '([0-9]+)$', 1) AS INT) = housenumber

    Only rows for dev_codes present in the snapshot are pulled from Databricks.
    Never overwrites date_str_source = 'manual'.
    Persists resolved dates back to sim_lots for real lots (_write_back_dates).
    """
    if lot_snapshot.empty:
        return lot_snapshot

    df = lot_snapshot.copy()

    # Extract dev_code and lot_seq from lot_number (e.g. 'WT00000074' -> 'WT', 74)
    df["_dev_code"] = df["lot_number"].str.extract(r"^([A-Z]+)", expand=False)
    df["_lot_seq"] = (
        df["lot_number"]
        .str.extract(r"([0-9]+)$", expand=False)
        .pipe(pd.to_numeric, errors="coerce")
        .astype("Int64")
    )

    dev_codes = df["_dev_code"].dropna().unique().tolist()
    if not dev_codes:
        df.drop(columns=["_dev_code", "_lot_seq"], inplace=True)
        return df

    dev_codes_sql = ", ".join(f"'{dc}'" for dc in dev_codes)
    act_codes_sql = ", ".join(f"'{c}'" for c in _ACT_MAP)

    # Pull only relevant rows server-side
    sched_raw = conn.read_df(f"""
        SELECT developmentcode, housenumber, activitycode,
               actualfinishdate, rvearlyfinshdate, earlyfinishdate, inactive
        FROM schedhousedetail
        WHERE developmentcode IN ({dev_codes_sql})
          AND activitycode IN ({act_codes_sql})
    """)

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
