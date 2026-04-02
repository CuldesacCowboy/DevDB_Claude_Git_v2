"""
P-0600 phase_date_propagator — Write resolved delivery event date to child phases.

Reads:   sim_delivery_event_phases (DB)
Writes:  sim_dev_phases.date_dev_projected (DB, UPDATE, unconditional per D-123)
Input:   conn: DBConnection, resolved_events: list of (delivery_event_id, date_dev_projected)
Rules:   Writes date_dev_projected unconditionally to all child phases (D-123).
         Event has no child phases → log and skip.
         Not Own: writing date_dev_demand_derived, writing date_dev_actual, writing to lot tables.
"""

from .connection import DBConnection


def phase_date_propagator(conn: DBConnection, resolved_events: list) -> None:
    """
    resolved_events: list of (delivery_event_id, date_dev_projected) tuples.
    Writes date_dev_projected to all child sim_dev_phases rows.
    Always overwrites -- stale values are replaced regardless of direction.
    Writer module: writes sim_dev_phases.date_dev_projected.
    """
    for event_id, projected_date in resolved_events:
        if projected_date is None:
            continue

        child_phases_df = conn.read_df(f"""
            SELECT phase_id
            FROM sim_delivery_event_phases
            WHERE delivery_event_id = {event_id}
        """)

        if child_phases_df.empty:
            print(f"P-06: Event {event_id} has no child phases. Skipping.")
            continue

        phase_ids_str = ", ".join(str(int(p)) for p in child_phases_df["phase_id"])

        conn.execute(f"""
            UPDATE sim_dev_phases
            SET date_dev_projected = '{projected_date}'
            WHERE phase_id IN ({phase_ids_str})
        """)

    print(f"P-06: Propagated dates for {len(resolved_events)} resolved events.")
