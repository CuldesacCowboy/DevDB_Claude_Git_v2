# p08_sync_flag_writer.py
# P-08: Set needs_rerun flags on projection groups whose phase delivery
#   dates changed during this supply pipeline run.
#
# Owns:     Comparing pre-run and post-run date_dev_projected. Setting needs_rerun
#           on dim_projection_groups for changed phases.
# Not Own:  Clearing needs_rerun (persistence_writer). Modifying any other table.
# Inputs:   conn, pre_run_dates dict {phase_id: date_dev_projected},
#           post_run_dates dict {phase_id: date_dev_projected}.
# Outputs:  needs_rerun flags set on affected dim_projection_groups rows.
# Failure:  Cannot identify projection group from phase: log and skip.
#           Never clear a needs_rerun flag already set.

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
    For any phase where the date changed, find the projection group(s)
    that have lots in that phase and set needs_rerun = true.
    Never clears needs_rerun.
    Writer module: writes dim_projection_groups.needs_rerun.
    """
    changed_phases = [
        phase_id for phase_id, post_date in post_run_dates.items()
        if not _dates_equal(pre_run_dates.get(phase_id), post_date)
    ]

    if not changed_phases:
        print("P-08: No phase dates changed. No needs_rerun flags set.")
        return []

    phase_ids_str = ", ".join(str(p) for p in changed_phases)

    affected_df = conn.read_df(f"""
        SELECT DISTINCT projection_group_id
        FROM sim_lots
        WHERE phase_id IN ({phase_ids_str})
    """)

    if affected_df.empty:
        print(f"P-08: Changed phases {changed_phases} have no lots. "
              f"Cannot identify projection groups.")
        return []

    pg_ids = [int(r) for r in affected_df["projection_group_id"]]
    pg_ids_str = ", ".join(str(p) for p in pg_ids)

    conn.execute(f"""
        UPDATE dim_projection_groups
        SET needs_rerun = true
        WHERE projection_group_id IN ({pg_ids_str})
    """)

    print(f"P-08: Set needs_rerun on {len(pg_ids)} projection groups "
          f"for {len(changed_phases)} changed phases.")
    return pg_ids
