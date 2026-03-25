# kernel/planning_kernel.py
# plan() -- single entry point for the planning kernel.
#
# Owns:    Wiring S-0700 -> S-0800 -> S-0810 -> S-0820 in sequence.
#          Returning a validated Proposal to the shell.
# Not Own: DB queries. Persistence. Convergence loop. Builder assignment.
#          Any state outside of frozen_input.
#
# The kernel is pure: given the same FrozenInput it always returns the same Proposal.
# It does not query the database. It does not write to any table.

from .frozen_input import FrozenInput
from .proposal import Proposal
from engine.s0700_demand_allocator import demand_allocator
from engine.s0800_temp_lot_generator import temp_lot_generator
from engine.s0810_building_group_enforcer import building_group_enforcer
from engine.s0820_post_generation_chronology_guard import post_generation_chronology_guard


def plan(frozen_input: FrozenInput) -> Proposal:
    """
    Run the planning kernel against a frozen input snapshot.
    Returns a Proposal containing allocations, temp lots, discards, and warnings.
    No DB I/O. No side effects.
    """
    # S-0700: assign real lots to demand slots (U -> H -> D pull order)
    allocated_df, unmet_demand_series = demand_allocator(
        frozen_input.lot_snapshot,
        frozen_input.demand_series,
    )

    # S-0800: generate temp lots for each unmet demand slot
    temp_lots_raw = temp_lot_generator(
        unmet_demand_series,
        frozen_input.phase_capacity,
        frozen_input.lot_type_pg_map,
        frozen_input.sim_run_id,
        frozen_input.projection_group_id,
    )

    # S-0810: enforce building group date constraints on the temp lot batch
    temp_lots_enforced = building_group_enforcer(temp_lots_raw)

    # S-0820: discard temp lots with chronology violations; emit supply constraint warnings
    clean_lots, discarded_lots, guard_warnings = post_generation_chronology_guard(
        temp_lots_enforced
    )

    print(f"  Kernel PG {frozen_input.projection_group_id}: "
          f"allocations={len(allocated_df)}, temp_lots={len(clean_lots)}, "
          f"discarded={len(discarded_lots)}, warnings={len(guard_warnings)}")

    return Proposal(
        allocations_df=allocated_df,
        temp_lots=clean_lots,
        discarded_lots=discarded_lots,
        warnings=guard_warnings,
    )
