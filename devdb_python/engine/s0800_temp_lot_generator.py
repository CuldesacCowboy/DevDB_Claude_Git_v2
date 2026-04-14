"""
S-0800 temp_lot_generator — Create simulated temp lots to fill unmet demand slots.

Reads:   nothing — pure computation
Writes:  nothing — returns temp lot records list (not yet persisted)
Input:   unmet_demand_series: list, phase_capacity: list, sim_run_id: int
Rules:   date_str = demand slot month always, independent of date_dev (D-137).
         date_td = date_str for all sim lots (D-142). Hard stop at phase capacity (D-068).
         date_cmp and date_cls are NOT set here — the shell timing expansion stage
         (coordinator._expand_timing) derives them after plan() returns using empirical
         build lag curves. This is the kernel boundary: the kernel owns assignment
         decisions; the shell owns timing derivation.
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
                       sim_run_id: int) -> list:
    """
    Generate temp lot records for each unmet demand slot.

    Phase assignment fills phases in capacity order (phase exhausted before next).
    date_str = date(year, month, 1) from the demand slot. Always.
    date_dev = phase delivery date for the assigned phase. Always.
    These fields are fully independent.

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

    # Per-phase deferred-slot counter: when a demand slot falls before a phase's
    # delivery date we cannot discard it (that creates sentinel deliveries) and
    # cannot use the raw slot date (that creates a start-before-dev violation).
    # Instead we defer: spread deferred lots at the same 1/month pace starting
    # the month after delivery.  This produces a pent-up-demand release that is
    # honest — lots were waiting for the phase to open and start in sequence.
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

        # Defer start if demand slot precedes phase delivery date.
        # Spread deferred lots at 1/month from the month after delivery so the
        # release matches normal absorption pace and no violation is created.
        delivery = slot["date_dev"]
        if delivery is not None and date_str < delivery:
            n_deferred = phase_deferred_count.get(phase_id, 0)
            date_str = _add_months_local(delivery, 1 + n_deferred)
            phase_deferred_count[phase_id] = n_deferred + 1

        # date_cmp and date_cls are intentionally absent here.
        # The shell timing expansion stage (coordinator._expand_timing) derives
        # them after plan() returns. Kernel boundary: assignment decisions only.
        temp_lots.append({
            "lot_id":          None,
            "dev_id":          dev_id,
            "phase_id":        phase_id,
            "builder_id":      None,
            "lot_source":      "sim",
            "lot_number":      None,
            "sim_run_id":      sim_run_id,
            "lot_type_id":     lot_type_id,
            "building_group_id": None,
            "date_ent":        None,
            "date_dev":        delivery,
            "date_td":         date_str,
            "date_td_hold":    None,
            "date_str":        date_str,
            "date_str_source": "engine_filled",
            "date_frm":        None,
            "created_at":      None,
            "updated_at":      None,
        })

    return temp_lots
