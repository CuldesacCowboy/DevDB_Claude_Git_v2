# s01_lot_loader.py
# S-01: Load real lots for a projection group into an immutable snapshot.
#
# Owns:     Creating the immutable lot snapshot all downstream modules operate on.
# Not Own:  Validating dates, filling dates, applying actuals, creating temp lots,
#           any modification to lot data.
# Inputs:   sim_lots (real lots only), projection_group_id
# Outputs:  Immutable lot snapshot (pandas DataFrame).
# Failure:  No real lots -> return empty DataFrame and continue.

import pandas as pd
from .connection import DBConnection


def lot_loader(conn: DBConnection, projection_group_id: int) -> pd.DataFrame:
    """
    Load real lots for the given projection group.
    Returns immutable DataFrame snapshot.
    Never filters by date or derives status.
    """
    snapshot = conn.read_df(f"""
        SELECT *
        FROM sim_lots
        WHERE lot_source = 'real'
          AND projection_group_id = {projection_group_id}
    """)
    return snapshot
