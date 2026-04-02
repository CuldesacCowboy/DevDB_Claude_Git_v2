# p08_sync_flag_writer.py
# P-08: Identify developments whose phase delivery dates changed during this
#   supply pipeline run.
#
# Owns:     Comparing pre-run and post-run date_dev_projected. Returning
#           the set of affected dev_ids for the coordinator.
# Not Own:  Clearing needs_rerun. Modifying any other table.
# Inputs:   conn, pre_run_dates dict {phase_id: date_dev_projected},
#           post_run_dates dict {phase_id: date_dev_projected}.
# Outputs:  List of affected dev_ids.

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

    phase_ids_str = ", ".join(str(p) for p in changed_phases)

    affected_df = conn.read_df(f"""
        SELECT DISTINCT dev_id
        FROM sim_lots
        WHERE phase_id IN ({phase_ids_str})
    """)

    if affected_df.empty:
        print(f"P-08: Changed phases {changed_phases} have no lots.")
        return []

    dev_ids = [int(r) for r in affected_df["dev_id"]]
    print(f"P-08: {len(dev_ids)} development(s) affected by "
          f"{len(changed_phases)} changed phase(s).")
    return dev_ids
