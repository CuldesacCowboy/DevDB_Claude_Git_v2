"""
S-0810 building_group_enforcer — Enforce building group constraints on temp lot batch.

Reads:   nothing — pure computation on temp_lots list
Writes:  nothing — returns new temp_lots list with constraints applied
Input:   temp_lots: list of dicts from S-0800
Rules:   All units in a group get date_str = MIN(date_str) across the group (D-022).
         date_td = date_str (D-142). Lots without building_group_id pass through.
         Not Own: generating temp lots (S-0800), assigning builders (S-0900),
         writing to sim_lots (S-1100), computing date_cmp or date_cls.
"""
# date_cmp and date_cls are NOT set here — they are derived by the shell timing
# expansion stage (coordinator._expand_timing) after plan() returns. That stage
# is responsible for enforcing building-group shared date_cmp (D-022) by applying
# the same sampled lag to all units in a group.
#
# This module's sole responsibility: date_str and date_td coupling within groups.
#
#   - Lots with building_group_id = None pass through unchanged.
#   - No building groups in batch -> all pass through unchanged.
#   - Input dicts are never mutated; returns a new list of new dicts.


def building_group_enforcer(temp_lots: list) -> list:
    """
    Enforce building group date constraints on the temp lot batch.

    For each building_group_id present in the batch:
      - date_str = MIN(date_str) across all units in that group
      - date_td  = shared_str  (D-142)

    date_cmp and date_cls are derived by the shell after the proposal is returned.
    Lots with building_group_id = None are copied unchanged.
    Returns a new list; no input dict is mutated.
    """
    if not temp_lots:
        return []

    # Compute MIN(date_str) per building_group_id across the batch.
    bg_min_str = {}
    for lot in temp_lots:
        bg_id = lot.get("building_group_id")
        if bg_id is None:
            continue
        ds = lot["date_str"]
        if bg_id not in bg_min_str or ds < bg_min_str[bg_id]:
            bg_min_str[bg_id] = ds

    if not bg_min_str:
        # No building groups in this batch -- return shallow copies, nothing to enforce.
        return [dict(lot) for lot in temp_lots]

    result = []
    for lot in temp_lots:
        bg_id = lot.get("building_group_id")
        if bg_id is None or bg_id not in bg_min_str:
            result.append(dict(lot))
            continue

        shared_str = bg_min_str[bg_id]

        new_lot = dict(lot)
        new_lot["date_str"] = shared_str
        new_lot["date_td"]  = shared_str    # D-142
        # date_cmp and date_cls are derived by shell timing expansion post-solve.
        result.append(new_lot)

    return result
