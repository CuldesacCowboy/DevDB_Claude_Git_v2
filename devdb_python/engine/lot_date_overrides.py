"""
S-0250 lot_date_overrides — Apply planning overrides from sim_lot_date_overrides to snapshot.

Reads:   sim_lot_date_overrides (SELECT by lot_id)
Writes:  nothing — returns modified snapshot (in-memory only; sim_lots unchanged)
Input:   conn: DBConnection, snapshot: DataFrame
Rules:   Called between S-02 and S-03 so overrides win over MARKS actuals in the engine.
         Only the 6 pipeline date fields (date_td_hold through date_cls) are overridable.
         sim_lots in the DB is never touched — overrides only affect the in-memory snapshot.
         Not Own: writing overrides to DB, MARKS date actualisation (S-02).
"""

import logging

import pandas as pd

from .connection import DBConnection

logger = logging.getLogger(__name__)

_OVERRIDE_FIELDS = ['date_td_hold', 'date_td', 'date_str', 'date_frm', 'date_cmp', 'date_cls']


def apply_lot_date_overrides(conn: DBConnection, snapshot: pd.DataFrame) -> pd.DataFrame:
    """
    Apply active planning overrides from sim_lot_date_overrides to the lot snapshot.
    Returns a modified copy; sim_lots in the DB is unchanged.
    """
    if snapshot.empty:
        return snapshot
    lot_ids = snapshot['lot_id'].dropna().astype(int).tolist()
    if not lot_ids:
        return snapshot
    ov_df = conn.read_df(
        "SELECT lot_id, date_field, override_value FROM sim_lot_date_overrides WHERE lot_id = ANY(%s)",
        (lot_ids,),
    )
    if ov_df.empty:
        return snapshot
    df = snapshot.copy()
    for _, row in ov_df.iterrows():
        lot_id = int(row['lot_id'])
        field = row['date_field']
        value = row['override_value']
        if field not in _OVERRIDE_FIELDS:
            continue
        mask = df['lot_id'] == lot_id
        if field in df.columns:
            df.loc[mask, field] = value
    logger.info(f"  lot_date_overrides: Overrides applied: {len(ov_df)} field(s) across {ov_df['lot_id'].nunique()} lot(s).")
    return df
