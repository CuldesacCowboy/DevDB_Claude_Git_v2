"""
P-0800 sync_flag_writer — Identify developments whose delivery dates changed this run.

Reads:   sim_dev_phases (via pre/post dicts passed by coordinator)
Writes:  nothing — returns list of affected dev_ids
Input:   conn: DBConnection, pre_run_dates: dict {phase_id: date_dev_projected},
         post_run_dates: dict {phase_id: date_dev_projected}
Rules:   Compares pre-run and post-run date_dev_projected per phase.
         Returns dev_ids of phases where the projected date changed.
         Not Own: clearing needs_rerun, modifying any table.
"""

import pandas as pd

from .connection import DBConnection


def _dates_equal(a, b) -> bool:
    a_null = pd.isnull(a) if a is not None else True
    b_null = pd.isnull(b) if b is not None else True
    if a_null and b_null:
        return True
    if a_null != b_null:
        return False
    return a == b


def sync_flag_writer(conn: DBConnection, pre_run_dates: dict,
                     post_run_dates: dict) -> list:
    """
    Compare pre and post run date_dev_projected per phase.
    Returns list of dev_ids that have lots in changed phases.
    """
    changed_phases = [
        phase_id for phase_id, post_date in post_run_dates.items()
        if not _dates_equal(pre_run_dates.get(phase_id), post_date)
    ]

    if not changed_phases:
        print("P-08: No phase dates changed.")
        return []

    affected_df = conn.read_df(
        "SELECT DISTINCT dev_id FROM sim_lots WHERE phase_id = ANY(%s)",
        (list(changed_phases),),
    )

    if affected_df.empty:
        print(f"P-08: Changed phases {changed_phases} have no lots.")
        return []

    dev_ids = [int(r) for r in affected_df["dev_id"]]
    print(f"P-08: {len(dev_ids)} development(s) affected by "
          f"{len(changed_phases)} changed phase(s).")
    return dev_ids
