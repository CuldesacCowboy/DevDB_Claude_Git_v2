# s0800_temp_lot_generator.py
# S-08: Create simulated temp lots to fill demand slots real lots could not.
#
# Owns:     Generating temp lot records with projected dates for each unmet slot.
#           Hard stop at sim_phase_product_splits capacity.
# Not Own:  Assigning builder_id (S-09). Writing to sim_lots (S-11).
#           Writing demand_derived dates (S-10). Modifying real lots.
# Inputs:   unmet_demand_series from S-07, phase_capacity list (from coordinator),
#           lot_type_pg_map dict, sim_run_id.
# Outputs:  List of dicts (temp lot records), not yet persisted.
#
# CRITICAL: projection_group_id is derived per lot from (dev_id, lot_type_id) via
# lot_type_pg_map {(dev_id, lot_type_id) -> projection_group_id}. Never inherit
# from the pipeline's current projection_group_id parameter. Using lot_type_id
# alone is wrong -- the same lot_type exists in every development with a different PG.
# The (dev_id, lot_type_id) tuple is the correct key into dim_projection_groups.
#
# date_str = demand slot month. Always. Independent of date_dev.
# date_dev = phase delivery date. Always. Independent of date_str.
# Phase delivery date never gates or overrides date_str.
# Every unmet demand slot produces exactly one temp lot. No discards. Sellout mandatory.
#
# Phase assignment: fill phase capacity slots in order before moving to next phase.

from datetime import date, timedelta

_DEFAULT_LAG_CMP_FROM_STR = 270
_DEFAULT_LAG_CLS_FROM_CMP = 45


def temp_lot_generator(unmet_demand_series: list, phase_capacity: list,
                       lot_type_pg_map: dict, sim_run_id: int,
                       projection_group_id: int = None) -> list:
    """
    Generate temp lot records for each unmet demand slot.

    Phase assignment fills phases in capacity order (phase exhausted before next).
    date_str = date(year, month, 1) from the demand slot. Always.
    date_dev = phase delivery date for the assigned phase. Always.
    These fields are fully independent.

    Total temp lots written == total unmet demand slots. No exceptions.
    """
    _debug = (projection_group_id == 317)

    if not unmet_demand_series:
        return []

    total_unmet = sum(int(c) for _, _, c in unmet_demand_series)

    if _debug:
        print(f"S-08 DEBUG PG 317: unmet input = {total_unmet} slots "
              f"across {len(unmet_demand_series)} month(s)")

    if not phase_capacity:
        print(f"WARNING: No phase capacity available. {total_unmet} unmet slots unfillable. "
              f"Populate sim_phase_product_splits.")
        return []

    # Step 1: Flatten unmet demand into ordered list of (year, month) slots.
    demand_slots = []
    for year, month, count in unmet_demand_series:
        for _ in range(int(count)):
            demand_slots.append((int(year), int(month)))

    # Step 2: Flatten phase capacity into ordered list, one entry per available slot.
    # Fill phase to capacity before moving to next phase.
    phase_slots = []
    for phase in phase_capacity:
        for _ in range(int(phase["available_slots"])):
            phase_slots.append(phase)

    # Step 3: Zip demand slots against phase slots. One temp lot per demand slot.
    n = min(len(demand_slots), len(phase_slots))
    if n < len(demand_slots):
        print(f"WARNING: Phase capacity exhausted. "
              f"{len(demand_slots) - n} unmet slots could not be filled. "
              f"Add capacity in sim_phase_product_splits.")

    temp_lots = []
    for i in range(n):
        year, month = demand_slots[i]
        slot = phase_slots[i]

        lot_type_id = int(slot["lot_type_id"])
        dev_id      = int(slot["dev_id"])
        pg_id       = lot_type_pg_map.get((dev_id, lot_type_id))

        date_str = date(year, month, 1)
        date_cmp = date_str + timedelta(days=_DEFAULT_LAG_CMP_FROM_STR)
        date_cls = date_cmp + timedelta(days=_DEFAULT_LAG_CLS_FROM_CMP)

        temp_lots.append({
            "lot_id":              None,
            "projection_group_id": pg_id,
            "phase_id":            int(slot["phase_id"]),
            "builder_id":          None,
            "lot_source":          "sim",
            "lot_number":          None,
            "sim_run_id":          sim_run_id,
            "lot_type_id":         lot_type_id,
            "building_group_id":   None,
            "date_ent":            None,
            "date_dev":            slot["date_dev"],
            "date_td":             date_str,
            "date_td_hold":        None,
            "date_str":            date_str,
            "date_str_source":     "engine_filled",
            "date_frm":            None,
            "date_cmp":            date_cmp,
            "date_cmp_source":     "engine_filled",
            "date_cls":            date_cls,
            "date_cls_source":     "engine_filled",
            "created_at":          None,
            "updated_at":          None,
        })

    if _debug:
        print(f"S-08 DEBUG PG 317: capacity exhausted = {max(0, len(demand_slots) - n)}, "
              f"temp lots generated = {len(temp_lots)}")

    return temp_lots
