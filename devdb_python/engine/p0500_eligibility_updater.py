# p05_eligibility_updater.py
# P-05: After a delivery event is resolved, unlock events whose predecessor
#   conditions are now satisfied.
#
# Owns:     Checking whether newly resolved event satisfies predecessor conditions
#           for waiting events. Adding newly eligible events to pool.
# Not Own:  Setting any dates. Any table modification.
# Inputs:   conn, resolved_event_id, sorted_queue, eligible_pool, resolved_so_far.
# Outputs:  Updated eligible_pool.
# Failure:  Event cannot be evaluated: leave in queue.

from .connection import DBConnection


def eligibility_updater(conn: DBConnection, resolved_event_id: int,
                        sorted_queue: list, eligible_pool: list,
                        resolved_so_far: set) -> list:
    """
    After resolving an event, check if any waiting events now have all
    predecessors resolved and can be added to the eligible pool.
    Returns updated eligible_pool.
    Read-only -- no table writes.
    """
    resolved_so_far.add(resolved_event_id)
    remaining_queue = [e for e in sorted_queue
                       if e not in resolved_so_far
                       and e not in eligible_pool]

    newly_eligible = []
    for event_id in remaining_queue:
        preds_df = conn.read_df(f"""
            SELECT predecessor_event_id
            FROM sim_delivery_event_predecessors
            WHERE event_id = {event_id}
        """)
        pred_ids = set(int(p) for p in preds_df["predecessor_event_id"]) if not preds_df.empty else set()
        if pred_ids.issubset(resolved_so_far):
            newly_eligible.append(event_id)

    updated_pool = [e for e in eligible_pool if e != resolved_event_id] + newly_eligible

    if newly_eligible:
        print(f"P-05: {len(newly_eligible)} newly eligible events after "
              f"resolving event {resolved_event_id}: {newly_eligible}")

    return updated_pool
