"""
S-0900 builder_assignment — Assign builder_id to temp lots using phase builder splits.

Reads:   nothing — pure computation
Writes:  nothing — returns same list with builder_id assigned
Input:   temp_lots: list of dicts, builder_splits: dict {phase_id: [{builder_id, share}]}
Rules:   Applies sim_phase_builder_splits proportionally across temp lots per phase.
         No splits for phase → null builder_id, warn. Splits not summing to 1.0 → normalize.
         D-098: share is DECIMAL — always cast to float() before arithmetic.
         Not Own: modifying builder_id on real lots, modifying split percentages.
"""

import copy
from collections import defaultdict


def builder_assignment(temp_lots: list, builder_splits: dict) -> list:
    """
    Assign builder_id to each temp lot using phase builder split percentages.

    builder_splits: {phase_id: [{"builder_id": int, "share": float_or_Decimal}, ...]}
    Assignment is deterministic proportional -- each builder's allocation filled in order.
    Returns a new list with builder_id populated. Input is not mutated.
    Never touches real lots.
    """
    if not temp_lots:
        return temp_lots

    temp_lots = copy.deepcopy(temp_lots)

    # Group temp lot indices by phase_id
    lots_by_phase = defaultdict(list)
    for i, lot in enumerate(temp_lots):
        lots_by_phase[lot["phase_id"]].append(i)

    for phase_id, lot_indices in lots_by_phase.items():
        splits = builder_splits.get(phase_id)

        if not splits:
            print(f"  WARNING: No builder splits for phase_id={phase_id}. "
                  f"builder_id null for {len(lot_indices)} temp lots.")
            continue

        # Cast share to float (D-097/D-098: DECIMAL from Databricks raises TypeError)
        total = float(sum(float(s["share"]) for s in splits))
        if abs(total - 1.0) > 0.001:
            print(f"  WARNING: Builder splits for phase_id={phase_id} sum to {total:.4f}. "
                  f"Normalizing.")
            splits = [{"builder_id": s["builder_id"],
                       "share": float(s["share"]) / total} for s in splits]

        # Deterministic proportional assignment
        n = len(lot_indices)
        assigned = []
        for split in splits:
            count = round(float(split["share"]) * n)
            assigned.extend([split["builder_id"]] * count)

        # Trim/extend to exactly n using last builder
        while len(assigned) < n:
            assigned.append(splits[-1]["builder_id"])
        assigned = assigned[:n]

        for i, lot_idx in enumerate(lot_indices):
            temp_lots[lot_idx]["builder_id"] = assigned[i]

    return temp_lots
