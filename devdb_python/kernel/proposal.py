# kernel/proposal.py
# Proposal -- the kernel's output.
# Contains all planning decisions for one projection group run.
# Returned by plan(). Never mutated after creation.

from dataclasses import dataclass, field

import pandas as pd


@dataclass
class Proposal:
    allocations_df: pd.DataFrame  # real lot assignments: lot_id, assigned_year, assigned_month
    temp_lots: list               # one dict per unmet demand slot; validated, clean
    discarded_lots: list          # lots discarded by S-0820 chronology guard
    warnings: list                # non-blocking warning strings (supply constraint, etc.)
