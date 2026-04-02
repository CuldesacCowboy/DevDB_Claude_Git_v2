"""
P-0100 actual_date_applicator — Apply actual delivery dates from locked events to lots.

Reads:   sim_delivery_events, sim_delivery_event_phases, sim_dev_phases (DB)
Writes:  sim_lots.date_dev (DB, UPDATE), sim_dev_phases.date_dev_projected (DB, UPDATE)
Input:   conn: DBConnection, ent_group_id: int
Rules:   Propagates date_dev_actual from locked events to all lots in child phases.
         Writes date_dev_actual to sim_dev_phases.date_dev_projected for locked phases
         so S-0800 gets the correct floor date (D-125).
         Earlier actual dates win when multiple locked events share a phase (D-112).
         Returns list of locked delivery_event_ids for P-0200.
         Not Own: setting projected dates on auto-scheduled events, touching events
         where date_dev_actual is null.
"""
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
