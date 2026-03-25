# p01_actual_date_applicator.py
# P-01: Apply actual delivery dates from sim_delivery_events to all lots
#   under those events. Lock those events.
#
# Owns:     Propagating date_dev_actual from sim_delivery_events to all lots in
#           child phases where date_dev_actual is set. Marking events as locked.
#           Writing date_dev_actual to sim_dev_phases.date_dev_projected for
#           child phases of locked events (so _load_phase_capacity feeds S-08
#           the correct floor date for locked phases).
# Not Own:  Setting projected dates on auto-scheduled events. Computing demand-derived dates.
#           Touching events where date_dev_actual is null.
# Inputs:   conn, ent_group_id.
# Outputs:  date_dev updated on lots under actual-dated events.
#           Locked event list (list of delivery_event_id) returned for P-02.
# Failure:  Event with actual date but no child phases: log and skip.
#           Actual delivery date is ground truth -- overwrites manual date_dev.

from .connection import DBConnection


def actual_date_applicator(conn: DBConnection, ent_group_id: int) -> list:
    """
    Find all delivery events in this entitlement group with date_dev_actual set.
    For each: update date_dev on all lots in child phases to the actual date.
    Return list of locked delivery_event_ids for dependency_resolver.

    Writer module: writes sim_lots.date_dev and sim_dev_phases.date_dev_projected.
    """
    actual_events_df = conn.read_df(f"""
        SELECT delivery_event_id, date_dev_actual
        FROM sim_delivery_events
        WHERE ent_group_id = {ent_group_id}
          AND date_dev_actual IS NOT NULL
    """)

    locked_event_ids = []

    for _, event in actual_events_df.iterrows():
        event_id = int(event["delivery_event_id"])
        actual_date = event["date_dev_actual"]

        child_phases_df = conn.read_df(f"""
            SELECT phase_id
            FROM sim_delivery_event_phases
            WHERE delivery_event_id = {event_id}
        """)

        if child_phases_df.empty:
            print(f"P-01: Event {event_id} has actual date but no child phases. Skipping.")
            locked_event_ids.append(event_id)
            continue

        phase_ids_str = ", ".join(str(int(p)) for p in child_phases_df["phase_id"])

        conn.execute(f"""
            UPDATE sim_lots
            SET date_dev = '{actual_date}'
            WHERE phase_id IN ({phase_ids_str})
              AND (date_dev IS NULL OR date_dev > '{actual_date}')
        """)

        # Write actual date to sim_dev_phases.date_dev_projected so
        # _load_phase_capacity feeds S-08 the correct floor date for locked phases.
        conn.execute(f"""
            UPDATE sim_dev_phases
            SET date_dev_projected = '{actual_date}'
            WHERE phase_id IN ({phase_ids_str})
        """)

        locked_event_ids.append(event_id)

    print(f"P-01: Locked {len(locked_event_ids)} events for ent_group_id={ent_group_id}.")
    return locked_event_ids
