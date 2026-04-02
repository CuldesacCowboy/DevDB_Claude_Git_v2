"""
S-0100 lot_loader — Load real lots for a development into an immutable snapshot.

Reads:   sim_lots (DB, WHERE lot_source = 'real' AND dev_id = ?)
Writes:  lot snapshot DataFrame (read-only input for all downstream S modules)
Input:   conn: DBConnection, dev_id: int
Rules:   No date derivation. No status filtering. Empty snapshot on no real lots.
         Not Own: validating dates, filling dates, applying actuals, creating temp lots.
"""

import pandas as pd
from .connection import DBConnection


def lot_loader(conn: DBConnection, dev_id: int) -> pd.DataFrame:
    """
    Load real lots for the given development.
    Returns immutable DataFrame snapshot.
    Never filters by date or derives status.
    """
    snapshot = conn.read_df(f"""
        SELECT *
        FROM sim_lots
        WHERE lot_source = 'real'
          AND dev_id = {dev_id}
    """)
    return snapshot
