"""
S-0205 building_group_sync — Propagate dates within building groups for real/pre lots.

Reads:   lot snapshot DataFrame (in-memory, post-S-0200)
Writes:  lot snapshot DataFrame (in-memory) + sim_lots (date_str, date_cmp, date_td)
Input:   lot_snapshot: DataFrame, conn: DBConnection
Rules:   For each building group, propagate MIN(date) to mates that are missing it.
         Columns synced: date_str, date_cmp, date_td.
         date_cls is NOT propagated (per-unit independent per D-012/D-075).
         Never overwrites date_str_source = 'manual'.
         Only operates on real and pre lots (sim lots have no building groups at this stage).
Not Own: Generating dates (S-0200), gap-filling (S-0300), sim lot generation (S-0800).
"""

import logging

import pandas as pd

from .connection import DBConnection

logger = logging.getLogger(__name__)

# Date columns propagated across building mates. date_cls excluded (per-unit per D-012/D-075).
_SYNC_COLS = ["date_str", "date_cmp", "date_td"]


def building_group_sync(conn: DBConnection, lot_snapshot: pd.DataFrame) -> pd.DataFrame:
    """
    Propagate MIN(date) within each building group to mates that are missing the date.

    Scope: real and pre lots with a building_group_id only.
    Returns updated snapshot. Persists changes to sim_lots for real/pre lots.
    """
    if lot_snapshot.empty:
        return lot_snapshot

    mask = (
        lot_snapshot["building_group_id"].notna()
        & lot_snapshot["lot_source"].isin(["real", "pre"])
    )
    if not mask.any():
        return lot_snapshot

    df = lot_snapshot.copy()
    updates: list[tuple] = []  # (lot_id, col, date_value)

    grouped_df = df[mask]

    for bg_id, grp in grouped_df.groupby("building_group_id"):
        for col in _SYNC_COLS:
            if col not in grp.columns:
                continue

            populated = grp[grp[col].notna()]
            if populated.empty:
                continue

            min_date = populated[col].min()

            # Build missing mask; for date_str also exclude manual-source rows
            if col == "date_str":
                src_col = "date_str_source"
                has_src = src_col in grp.columns
                missing = grp[col].isna() & (
                    ~has_src or grp[src_col].isna() | (grp[src_col] != "manual")
                )
            else:
                missing = grp[col].isna()

            for lot_id in grp.loc[missing, "lot_id"]:
                updates.append((int(lot_id), col, min_date))
                df.loc[df["lot_id"] == lot_id, col] = min_date
                if col == "date_str":
                    df.loc[df["lot_id"] == lot_id, "date_str_source"] = "building_sync"

    if not updates:
        return df

    logger.info(f"building_group_sync: Synced {len(updates)} date field(s) across building groups.")
    _persist(conn, updates, lot_snapshot)
    return df


def _persist(conn: DBConnection, updates: list, lot_snapshot: pd.DataFrame) -> None:
    """Write synced dates back to sim_lots for real/pre lots only."""
    real_ids = set(
        lot_snapshot.loc[lot_snapshot["lot_source"].isin(["real", "pre"]), "lot_id"]
        .dropna()
        .astype(int)
    )

    for col in _SYNC_COLS:
        pairs = []
        for lot_id, c, d in updates:
            if c != col or lot_id not in real_ids:
                continue
            d_str = d.date().isoformat() if hasattr(d, "date") else str(d)
            pairs.append((lot_id, d_str))
        if not pairs:
            continue

        if col == "date_str":
            conn.execute_values(
                """
                UPDATE sim_lots AS t
                SET date_str = v.d::DATE,
                    date_str_source = 'building_sync'
                FROM (VALUES %s) AS v(lot_id, d)
                WHERE t.lot_id = v.lot_id::bigint
                  AND t.lot_source IN ('real', 'pre')
                  AND t.date_str IS NULL
                  AND t.date_str_source IS DISTINCT FROM 'manual'
                """,
                pairs,
            )
        else:
            conn.execute_values(
                f"""
                UPDATE sim_lots AS t
                SET {col} = v.d::DATE
                FROM (VALUES %s) AS v(lot_id, d)
                WHERE t.lot_id = v.lot_id::bigint
                  AND t.lot_source IN ('real', 'pre')
                  AND t.{col} IS NULL
                """,
                pairs,
            )
