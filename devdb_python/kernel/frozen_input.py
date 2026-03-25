# kernel/frozen_input.py
# FrozenInput -- immutable snapshot of all data the kernel needs to produce a Proposal.
# Assembled by the shell (coordinator) from DB reads before plan() is called.
# The kernel never queries the database; it reads only from this object.

from dataclasses import dataclass

import pandas as pd


@dataclass
class FrozenInput:
    lot_snapshot: pd.DataFrame   # real lots, post-actuals, post-gap-fill, post-TDA
    demand_series: object        # pd.DataFrame [year, month, slots] from S-0600;
                                 # may be empty list when no projection params (back-compat)
    phase_capacity: list         # list of dicts from _load_phase_capacity()
    lot_type_pg_map: dict        # {(dev_id, lot_type_id): projection_group_id}
    building_group_memberships: dict  # {lot_id: building_group_id} for lots with a group
    tda_hold_lot_ids: set        # lot_ids where date_td_hold is set and date_td is null (H status)
    sim_run_id: int
    projection_group_id: int
