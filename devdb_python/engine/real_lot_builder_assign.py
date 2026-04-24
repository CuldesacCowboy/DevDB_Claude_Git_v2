"""
real_lot_builder_assign -- Assign builder_id to real/pre lots with no committed builder.

Reads:   sim_lots (real/pre with COALESCE(builder_id_override, builder_id) IS NULL)
Writes:  sim_lots.builder_id
Input:   conn: DBConnection, ent_group_id: int, builder_splits: dict
Rules:   Uses the same proportional split logic as builder_assignment.
         Called once per engine run before the iteration loop.
         Idempotent: once written, the lot is no longer null and is skipped.
         Not Own: modifying split percentages.
"""

from collections import defaultdict
from .builder_assignment import _apply_splits_to_indices


def assign_real_lot_builders(conn, ent_group_id: int, builder_splits: dict) -> int:
    """
    Assign builder_id to real/pre lots in this ent_group that have no committed builder.

    A lot qualifies when COALESCE(builder_id_override, builder_id) IS NULL -- meaning
    neither the user nor MARKS has specified a builder.  The engine fills this gap
    using the same proportional split logic as builder_assignment().

    Writes to sim_lots.builder_id (the engine-assigns tier of the three-tier priority).
    Idempotent: lots written in a previous run are no longer null and are skipped.
    Returns count of lots updated.
    """
    df = conn.read_df("""
        SELECT sl.lot_id, sl.phase_id
        FROM sim_lots sl
        JOIN sim_dev_phases sdp ON sdp.phase_id = sl.phase_id
        JOIN sim_legal_instruments sli ON sli.instrument_id = sdp.instrument_id
        JOIN sim_ent_group_developments segd ON segd.dev_id = sli.dev_id
        WHERE segd.ent_group_id = %s
          AND sl.lot_source IN ('real', 'pre')
          AND sl.excluded IS NOT TRUE
          AND COALESCE(sl.builder_id_override, sl.builder_id) IS NULL
        ORDER BY sl.phase_id, sl.lot_id
    """, (ent_group_id,))

    if df.empty:
        return 0

    lots_by_phase = defaultdict(list)
    for _, row in df.iterrows():
        lots_by_phase[int(row["phase_id"])].append(int(row["lot_id"]))

    updates = []  # [(builder_id, lot_id), ...]
    for phase_id, lot_ids in lots_by_phase.items():
        splits = builder_splits.get(phase_id)
        if not splits:
            print(f"  real_lot_builder_assign: No builder splits for phase_id={phase_id}. "
                  f"{len(lot_ids)} real/pre lots remain unassigned.")
            continue

        assigned = _apply_splits_to_indices(lot_ids, splits, phase_id)
        for lot_id, builder_id in zip(lot_ids, assigned):
            updates.append((builder_id, lot_id))

    if not updates:
        return 0

    conn.execute_values(
        "UPDATE sim_lots AS sl SET builder_id = v.builder_id, updated_at = NOW() "
        "FROM (VALUES %s) AS v(builder_id, lot_id) "
        "WHERE sl.lot_id = v.lot_id",
        updates,
    )
    print(f"  real_lot_builder_assign: Assigned builder_id to {len(updates)} real/pre lots "
          f"(ent_group_id={ent_group_id}).")
    return len(updates)
