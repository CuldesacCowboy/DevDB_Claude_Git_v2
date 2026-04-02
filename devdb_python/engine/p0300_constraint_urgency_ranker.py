"""
P-0300 constraint_urgency_ranker — Rank eligible delivery events by supply constraint urgency.

Reads:   sim_dev_phases.date_dev_demand_derived (DB)
Writes:  nothing — returns ranked list
Input:   conn: DBConnection, eligible_pool: list of delivery_event_ids
Rules:   Ranks by shortest runway: earliest date_dev_demand_derived across child phases.
         All child phases null demand_derived → rank that event last.
         Not Own: setting any dates, any table modification.
"""

from .connection import DBConnection


def constraint_urgency_ranker(conn: DBConnection, eligible_pool: list) -> list:
    """
    Rank eligible events by MIN(date_dev_demand_derived) across all child phases.
    Events with all-null demand_derived ranked last.
    Returns ranked list of delivery_event_ids, most urgent first.
    Read-only -- no table writes.
    """
    if not eligible_pool:
        return []

    ranked = []
    null_demand_events = []

    for event_id in eligible_pool:
        phases_df = conn.read_df(f"""
            SELECT dp.date_dev_demand_derived
            FROM sim_delivery_event_phases dep
            JOIN sim_dev_phases dp ON dep.phase_id = dp.phase_id
            WHERE dep.delivery_event_id = {event_id}
        """)

        if phases_df.empty or phases_df["date_dev_demand_derived"].isna().all():
            null_demand_events.append(event_id)
        else:
            min_date = phases_df["date_dev_demand_derived"].dropna().min()
            ranked.append((event_id, min_date))

    ranked.sort(key=lambda x: x[1])
    result = [e[0] for e in ranked] + null_demand_events

    print(f"P-03: Ranked {len(result)} eligible events. "
          f"{len(null_demand_events)} with null demand_derived ranked last.")
    return result
