"""
S-0800 temp_lot_generator — Create simulated temp lots to fill unmet demand slots.

Reads:   nothing — pure computation
Writes:  nothing — returns temp lot records list (not yet persisted)
Input:   unmet_demand_series: list, phase_capacity: list, sim_run_id: int,
         phase_building_config: dict (optional) {phase_id: [(building_count, units_per_building)]}
Rules:   date_str = demand slot month always, independent of date_dev (D-137).
         date_td = date_str - td_to_str_lag months (D-142 revised: lag now configurable
         per community, default 1 month). Hard stop at phase capacity (D-068).
         date_cmp and date_cls are NOT set here — the shell timing expansion stage
         (coordinator._expand_timing) derives them after plan() returns using empirical
         build lag curves. This is the kernel boundary: the kernel owns assignment
         decisions; the shell owns timing derivation.
         Building groups: when phase_building_config is provided for a phase, lots are
         generated in groups (all units in a building share date_str). Synthetic
         building_group_ids are assigned using negative integers (no DB FK required).
         Not Own: assigning builder_id (S-0900), writing to sim_lots (S-1100),
         writing demand_derived dates (S-1000), modifying real lots,
         computing date_cmp or date_cls.
"""
# date_dev = phase delivery date. Always. Independent of date_str.
# Phase delivery date never gates or overrides date_str.
# Every unmet demand slot produces exactly one temp lot. No discards. Sellout mandatory.
#
# Phase assignment: fill phase capacity slots in order before moving to next phase.

from datetime import date

# Default lag constants — exported for reference only. The shell timing expansion
# in coordinator._expand_timing uses these as fallbacks when no empirical curve
# is available. S-0800 itself does not use these in lot creation.
_DEFAULT_LAG_CMP_FROM_STR = 270
_DEFAULT_LAG_CLS_FROM_CMP = 45


def temp_lot_generator(unmet_demand_series: list, phase_capacity: list,
                       sim_run_id: int,
                       phase_building_config: dict | None = None,
                       td_to_str_lag: int = 1) -> list:
    """
    Generate temp lot records for each unmet demand slot.

    Phase assignment fills phases in capacity order (phase exhausted before next).
    date_str = date(year, month, 1) from the demand slot. Always.
    date_dev = phase delivery date for the assigned phase. Always.
    These fields are fully independent.

    When phase_building_config is provided for a phase, lots are grouped into buildings.
    All units in a building share the same date_str (first demand slot in the group).
    Synthetic building_group_id values are negative integers (no FK constraint needed).

    Total temp lots written == total unmet demand slots. No exceptions.
    """
    if not unmet_demand_series:
        return []

    total_unmet = sum(int(c) for _, _, c in unmet_demand_series)

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
    phase_slots = []
    for phase in phase_capacity:
        for _ in range(int(phase["available_slots"])):
            phase_slots.append(phase)

    n = min(len(demand_slots), len(phase_slots))
    if n < len(demand_slots):
        print(f"WARNING: Phase capacity exhausted. "
              f"{len(demand_slots) - n} unmet slots could not be filled. "
              f"Add capacity in sim_phase_product_splits.")

    # Step 3: Build per-phase building template from config.
    # Template is an ordered list of group sizes for each building in the phase.
    # E.g., 6 duplexes + 2 quads → [2, 2, 2, 2, 2, 2, 4, 4]
    bg_templates: dict[int, list[int]] = {}
    if phase_building_config:
        for phase_id, rows in phase_building_config.items():
            template = []
            for building_count, units_per_building in rows:
                for _ in range(int(building_count)):
                    template.append(int(units_per_building))
            if template:
                bg_templates[int(phase_id)] = template

    # Per-phase state for building group progression.
    bg_state: dict[int, dict] = {}  # phase_id → {template_idx, slots_in_building}
    bg_first_date: dict[tuple, date] = {}  # (phase_id, building_idx) → shared date_str
    next_bg_id = -1  # Negative counters for synthetic group IDs (no DB FK needed)
    bg_id_map: dict[tuple, int] = {}  # (phase_id, building_idx) → synthetic bg_id

    # Per-phase deferred-slot counter: when a demand slot < phase delivery date,
    # defer start to 1/month after delivery at pace of 1 per slot.
    phase_deferred_count: dict[int, int] = {}

    def _add_months_local(d: date, n: int) -> date:
        m = d.month + n
        y = d.year + (m - 1) // 12
        m = ((m - 1) % 12) + 1
        return d.replace(year=y, month=m, day=1)

    temp_lots = []
    for i in range(n):
        year, month = demand_slots[i]
        slot = phase_slots[i]

        lot_type_id = int(slot["lot_type_id"])
        dev_id      = int(slot["dev_id"])
        phase_id    = int(slot["phase_id"])

        date_str = date(year, month, 1)

        # Defer start if demand slot is on or before phase delivery date (D-167).
        # date_str <= delivery defers delivery-month slots to delivery+1 so sim lots
        # never start in the same month land is delivered.
        delivery = slot["date_dev"]
        if delivery is not None and date_str <= delivery:
            n_deferred = phase_deferred_count.get(phase_id, 0)
            date_str = _add_months_local(delivery, 1 + n_deferred)
            phase_deferred_count[phase_id] = n_deferred + 1

        # Resolve building group for this lot.
        bg_id = None
        if phase_id in bg_templates:
            template = bg_templates[phase_id]
            if phase_id not in bg_state:
                bg_state[phase_id] = {"template_idx": 0, "slots_in_building": 0}
            state = bg_state[phase_id]

            if state["template_idx"] < len(template):
                building_idx = state["template_idx"]
                building_key = (phase_id, building_idx)

                if building_key not in bg_id_map:
                    bg_id_map[building_key] = next_bg_id
                    next_bg_id -= 1
                    bg_first_date[building_key] = date_str  # First slot sets the shared date

                # All lots in this building share the first slot's date_str
                date_str = bg_first_date[building_key]
                bg_id = bg_id_map[building_key]

                state["slots_in_building"] += 1
                if state["slots_in_building"] >= template[building_idx]:
                    state["template_idx"] += 1
                    state["slots_in_building"] = 0

        date_td = _add_months_local(date_str, -td_to_str_lag) if td_to_str_lag else date_str

        temp_lots.append({
            "lot_id":            None,
            "dev_id":            dev_id,
            "phase_id":          phase_id,
            "builder_id":        None,
            "lot_source":        "sim",
            "lot_number":        None,
            "sim_run_id":        sim_run_id,
            "lot_type_id":       lot_type_id,
            "building_group_id": bg_id,
            "date_ent":          None,
            "date_dev":          delivery,
            "date_td":           date_td,
            "date_td_hold":      None,
            "date_str":          date_str,
            "date_str_source":   "engine_filled",
            "date_frm":          None,
            "created_at":        None,
            "updated_at":        None,
        })

    return temp_lots
