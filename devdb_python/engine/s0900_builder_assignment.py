"""
S-0900 builder_assignment — Assign builder_id to lots using phase builder splits.

Reads:   sim_lots (assign_real_lot_builders only)
Writes:  sim_lots.builder_id (assign_real_lot_builders only)
Input:   temp_lots: list of dicts, builder_splits: dict {phase_id: [{builder_id, share}]}
Rules:   Applies sim_phase_builder_splits proportionally across lots per phase.
         No splits for phase → null builder_id, warn. Splits not summing to 1.0 → normalize.
         D-098: share is DECIMAL — always cast to float() before arithmetic.
         builder_assignment()         — pure function, assigns sim/temp lots in memory.
         assign_real_lot_builders()   — DB function, assigns real/pre lots with no committed
                                        builder (COALESCE(builder_id_override, builder_id) IS NULL).
                                        Writes to builder_id. Called once per engine run before
                                        the iteration loop. Idempotent: once written, the lot is
                                        no longer null and is skipped on subsequent runs.
         Not Own: modifying split percentages.
"""

import copy
from collections import defaultdict


def _apply_splits_to_indices(indices: list, splits: list, phase_id: int) -> list:
    """
    Proportional builder assignment for a list of slot indices.
    Returns list of builder_ids (same length as indices), deterministic order.
    splits: [{"builder_id": int, "share": float}, ...]
    """
    total = float(sum(float(s["share"]) for s in splits))
    if abs(total - 1.0) > 0.001:
        print(f"  WARNING: Builder splits for phase_id={phase_id} sum to {total:.4f}. Normalizing.")
        splits = [{"builder_id": s["builder_id"],
                   "share": float(s["share"]) / total} for s in splits]

    n = len(indices)
    assigned = []
    for split in splits:
        count = round(float(split["share"]) * n)
        assigned.extend([split["builder_id"]] * count)

    while len(assigned) < n:
        assigned.append(splits[-1]["builder_id"])
    return assigned[:n]


def builder_assignment(temp_lots: list, builder_splits: dict) -> list:
    """
    Assign builder_id to each temp (sim) lot using phase builder split percentages.
    Pure function — does not touch the DB. Input is not mutated.

    builder_splits: {phase_id: [{"builder_id": int, "share": float_or_Decimal}, ...]}
    """
    if not temp_lots:
        return temp_lots

    temp_lots = copy.deepcopy(temp_lots)

    lots_by_phase = defaultdict(list)
    for i, lot in enumerate(temp_lots):
        lots_by_phase[lot["phase_id"]].append(i)

    for phase_id, lot_indices in lots_by_phase.items():
        splits = builder_splits.get(phase_id)
        if not splits:
            print(f"  WARNING: No builder splits for phase_id={phase_id}. "
                  f"builder_id null for {len(lot_indices)} temp lots.")
            continue

        assigned = _apply_splits_to_indices(lot_indices, splits, phase_id)
        for i, lot_idx in enumerate(lot_indices):
            temp_lots[lot_idx]["builder_id"] = assigned[i]

    return temp_lots


def assign_real_lot_builders(conn, ent_group_id: int, builder_splits: dict) -> int:
    """
    Assign builder_id to real/pre lots in this ent_group that have no committed builder.

    A lot qualifies when COALESCE(builder_id_override, builder_id) IS NULL — meaning
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
            print(f"  S-0900: No builder splits for phase_id={phase_id}. "
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
    print(f"  S-0900: Assigned builder_id to {len(updates)} real/pre lots "
          f"(ent_group_id={ent_group_id}).")
    return len(updates)
