"""
P-0200 dependency_resolver — Topologically sort delivery events; produce eligible pool.

Reads:   sim_delivery_event_predecessors (DB, column: event_id not delivery_event_id)
Writes:  nothing — returns sorted queue and eligible pool
Input:   conn: DBConnection, ent_group_id: int, locked_event_ids: list
Rules:   Reads sim_delivery_event_predecessors to sort by dependency order.
         Removes locked events from queue. Identifies events with no unresolved predecessors.
         Dependency cycle → hard error, surface to user, do not break cycle.
         Not Own: setting any dates, ranking events, any table modification.
"""

import logging
from collections import defaultdict
from .connection import DBConnection

logger = logging.getLogger(__name__)


def dependency_resolver(conn: DBConnection, ent_group_id: int,
                        locked_event_ids: list) -> tuple:
    """
    Topologically sort delivery events for this entitlement group.
    Remove locked events from queue.
    Return (sorted_queue, eligible_pool) where:
      sorted_queue: list of delivery_event_id in dependency order
      eligible_pool: list of delivery_event_id with no unresolved predecessors

    Read-only module -- no table writes.
    """
    all_events_df = conn.read_df(
        "SELECT delivery_event_id FROM sim_delivery_events WHERE ent_group_id = %s",
        (ent_group_id,),
    )
    all_event_ids = set(int(r) for r in all_events_df["delivery_event_id"])
    locked_set = set(locked_event_ids)
    queue = all_event_ids - locked_set

    if not queue:
        logger.info(f"P-02: No unresolved events for ent_group_id={ent_group_id}.")
        return [], []

    queue_list = list(queue)
    predecessors_df = conn.read_df(
        """
        SELECT event_id, predecessor_event_id
        FROM sim_delivery_event_predecessors
        WHERE event_id = ANY(%s)
        """,
        (queue_list,),
    )

    unresolved_preds = defaultdict(set)
    for _, row in predecessors_df.iterrows():
        pred = int(row["predecessor_event_id"])
        if pred not in locked_set:
            unresolved_preds[int(row["event_id"])].add(pred)

    sorted_queue = []
    no_preds = [e for e in queue if len(unresolved_preds[e]) == 0]
    eligible_pool = list(no_preds)
    remaining = queue - set(no_preds)

    process = list(no_preds)

    while process:
        current = process.pop(0)
        sorted_queue.append(current)
        for event_id in list(remaining):
            unresolved_preds[event_id].discard(current)
            if len(unresolved_preds[event_id]) == 0:
                process.append(event_id)
                remaining.discard(event_id)

    if remaining:
        raise ValueError(
            f"P-02: Dependency cycle detected in delivery events for "
            f"ent_group_id={ent_group_id}. "
            f"Unresolvable events: {remaining}. "
            f"Project configuration is invalid."
        )

    logger.info(f"P-02: {len(sorted_queue)} events in queue, "
               f"{len(eligible_pool)} initially eligible.")
    return sorted_queue, eligible_pool
