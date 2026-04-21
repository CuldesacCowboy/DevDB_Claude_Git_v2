# kernel/frozen_input.py
# FrozenInput -- immutable snapshot of all data the kernel needs to produce a Proposal.
# Assembled by the shell (coordinator) from DB reads before plan() is called.
# The kernel never queries the database; it reads only from this object.

from dataclasses import dataclass
from datetime import date as _date
from typing import Optional

import pandas as pd


@dataclass
class FrozenInput:
    lot_snapshot: pd.DataFrame   # real lots, post-actuals, post-gap-fill, post-TDA
    demand_series: object        # pd.DataFrame [year, month, slots] from S-0600;
                                 # may be empty list when no projection params (back-compat)
    phase_capacity: list         # list of dicts from _load_phase_capacity()
    building_group_memberships: dict  # {lot_id: building_group_id} for lots with a group
    tda_hold_lot_ids: set        # lot_ids where date_td_hold is set and date_td is null (H status)
    phase_building_config: dict  # {phase_id: [(building_count, units_per_building)]} for multi-family phases
    sim_run_id: int
    dev_id: int
    td_to_str_lag: int = 1       # months between BLDR date (date_td) and DIG date (date_str)
    sim_floor_date: Optional[_date] = None  # first month after last locked delivery event;
                                            # unmet demand slots before this date are dropped
                                            # before S-0800 (real lots absorb freely; sim lots cannot)
