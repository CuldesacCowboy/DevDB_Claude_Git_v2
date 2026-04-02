# s01_lot_loader.py
# S-01: Load real lots for a development into an immutable snapshot.
#
# Owns:     Creating the immutable lot snapshot all downstream modules operate on.
# Not Own:  Validating dates, filling dates, applying actuals, creating temp lots,
#           any modification to lot data.
# Inputs:   sim_lots (real lots only), dev_id
# Outputs:  Immutable lot snapshot (pandas DataFrame).
# Failure:  No real lots -> return empty DataFrame and continue.

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
