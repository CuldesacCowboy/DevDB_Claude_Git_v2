# s0810_building_group_enforcer.py
# S-0810: Enforce building group constraints on temp lot batch.
#
# Owns:   For each building_group_id, collapse all units to MIN(date_str).
#         Recompute date_cmp and date_cls from the shared date_str.
#         Set date_td = date_str (D-142).
# Not Own: Generating temp lots (S-0800). Assigning builders (S-0900).
#          Writing to sim_lots (S-1100).
# Inputs:  temp_lots list of dicts from S-0800.
# Outputs: New list of dicts with building group constraints enforced.
#
# Rules:
#   - All units in a building group get date_str = MIN(date_str) across the group.
#   - date_cmp = shared date_str + LAG_CMP_FROM_STR (same lag as S-0800 uses).
#   - date_td  = shared date_str (D-142: sim lots always have date_td = date_str).
#   - date_cls is recomputed per unit from the shared date_cmp (D-022/D-075:
#     independent per unit; with a uniform date_cmp all units compute the same
#     date_cls, but the computation remains per-unit, not a shared copy).
#   - Lots with building_group_id = None pass through unchanged.
#   - No building groups in batch -> all pass through unchanged.
#   - Input dicts are never mutated; returns a new list of new dicts.
#
# Lags are imported directly from s0800_temp_lot_generator to guarantee that
# S-0810 and S-0800 are always in sync. No independent hardcoding (D-133).

from datetime import timedelta

from .s0800_temp_lot_generator import _DEFAULT_LAG_CMP_FROM_STR, _DEFAULT_LAG_CLS_FROM_CMP


def building_group_enforcer(temp_lots: list) -> list:
    """
    Enforce building group date constraints on the temp lot batch.

    For each building_group_id present in the batch:
      - date_str = MIN(date_str) across all units in that group
      - date_cmp = shared_str + 270 days  (sourced from S-0800 constant)
      - date_td  = shared_str             (D-142)
      - date_cls = shared_cmp + 45 days, computed per unit (D-022/D-075)

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
        shared_cmp = shared_str + timedelta(days=_DEFAULT_LAG_CMP_FROM_STR)
        per_unit_cls = shared_cmp + timedelta(days=_DEFAULT_LAG_CLS_FROM_CMP)

        new_lot = dict(lot)
        new_lot["date_str"] = shared_str
        new_lot["date_td"]  = shared_str    # D-142
        new_lot["date_cmp"] = shared_cmp
        new_lot["date_cls"] = per_unit_cls
        result.append(new_lot)

    return result
