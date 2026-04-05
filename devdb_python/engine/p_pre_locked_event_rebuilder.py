"""
p_pre_locked_event_rebuilder — Pre-pipeline: rebuild locked delivery events.

Reads:   sim_dev_phases.date_dev_actual
         sim_ent_group_developments
         sim_delivery_events (date_dev_actual IS NOT NULL rows)
         sim_delivery_event_phases
         sim_delivery_event_predecessors
Writes:  sim_delivery_events (deletes locked rows, inserts rebuilt rows)
         sim_delivery_event_phases (deletes + inserts)
         sim_delivery_event_predecessors (deletes referencing locked events)
Input:   conn, ent_group_id
Rules:   Runs once per coordinator invocation, before P-0000.
         Deletes all locked delivery events for the community and recreates
         them by grouping phases with date_dev_actual by date — one event per
         unique locked date, is_auto_created=false.
         Auto-created events (date_dev_actual IS NULL) are untouched.
"""

import logging
from collections import defaultdict

logger = logging.getLogger(__name__)


def locked_event_rebuilder(conn, ent_group_id: int) -> int:
    """
    Delete all locked delivery events (date_dev_actual IS NOT NULL) for this
    community and rebuild them from sim_dev_phases.date_dev_actual.

    One delivery event per unique locked date.  All phases sharing that date
    are linked via sim_delivery_event_phases.  Events are marked
    is_auto_created=False (user-driven).

    Returns the number of new delivery events created.
    """
    # 1. Find existing locked event IDs for this community.
    event_df = conn.read_df(
        """
        SELECT delivery_event_id
        FROM sim_delivery_events
        WHERE ent_group_id = %s
          AND date_dev_actual IS NOT NULL
        """,
        (ent_group_id,),
    )
    locked_event_ids = [int(r) for r in event_df["delivery_event_id"]]

    if locked_event_ids:
        ids_tuple = tuple(locked_event_ids)
        # Delete predecessors referencing these events (both directions).
        conn.execute(
            """
            DELETE FROM sim_delivery_event_predecessors
            WHERE event_id = ANY(%s::bigint[])
               OR predecessor_event_id = ANY(%s::bigint[])
            """,
            (ids_tuple, ids_tuple),
        )
        # Delete event–phase links.
        conn.execute(
            "DELETE FROM sim_delivery_event_phases WHERE delivery_event_id = ANY(%s::bigint[])",
            (ids_tuple,),
        )
        # Delete the events themselves.
        conn.execute(
            "DELETE FROM sim_delivery_events WHERE delivery_event_id = ANY(%s::bigint[])",
            (ids_tuple,),
        )
        logger.info(
            f"  p_pre: deleted {len(locked_event_ids)} locked delivery event(s) "
            f"for ent_group_id={ent_group_id}."
        )

    # 2. Query all phases in this community that have date_dev_actual set.
    phases_df = conn.read_df(
        """
        SELECT sdp.phase_id, sdp.date_dev_actual
        FROM sim_dev_phases sdp
        JOIN sim_ent_group_developments segd ON segd.dev_id = sdp.dev_id
        WHERE segd.ent_group_id = %s
          AND sdp.date_dev_actual IS NOT NULL
        ORDER BY sdp.date_dev_actual, sdp.phase_id
        """,
        (ent_group_id,),
    )

    if phases_df.empty:
        logger.info(
            f"  p_pre: no locked phases for ent_group_id={ent_group_id}. Nothing created."
        )
        return 0

    # 3. Group phases by date_dev_actual → one event per unique date.
    date_to_phases: dict = defaultdict(list)
    for _, row in phases_df.iterrows():
        d = row["date_dev_actual"]
        if hasattr(d, "date"):
            d = d.date()
        date_to_phases[d].append(int(row["phase_id"]))

    # 4. Insert one delivery event per unique date, link phases.
    created = 0
    for locked_date, phase_ids in sorted(date_to_phases.items()):
        conn.execute(
            """
            INSERT INTO sim_delivery_events
                (ent_group_id, event_name, date_dev_actual, date_dev_projected,
                 is_auto_created, is_placeholder)
            VALUES (%s, %s, %s, %s, false, false)
            """,
            (
                ent_group_id,
                f"Locked delivery {locked_date.strftime('%Y-%m-%d')}",
                locked_date,
                locked_date,
            ),
        )
        new_id_df = conn.read_df("SELECT lastval() AS new_id")
        new_event_id = int(new_id_df.iloc[0]["new_id"])

        phase_rows = [
            {"delivery_event_id": new_event_id, "phase_id": pid}
            for pid in phase_ids
        ]
        conn.executemany_insert("sim_delivery_event_phases", phase_rows)

        logger.info(
            f"  p_pre: created event {new_event_id} for {locked_date} "
            f"with {len(phase_ids)} phase(s): {phase_ids}."
        )
        created += 1

    return created
