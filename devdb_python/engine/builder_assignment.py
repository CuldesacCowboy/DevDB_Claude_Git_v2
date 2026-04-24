"""
builder_assignment -- Assign builder_id to sim/temp lots using instrument builder splits.

Reads:   nothing (pure function)
Writes:  nothing (in-memory only)
Input:   temp_lots: list of dicts, builder_splits: dict {phase_id: [{builder_id, share}]}
Rules:   Applies sim_instrument_builder_splits proportionally across lots per phase.
         No splits for phase -> null builder_id, warn. Splits not summing to 1.0 -> normalize.
         D-098: share is DECIMAL -- always cast to float() before arithmetic.
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
    Pure function -- does not touch the DB. Input is not mutated.

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
