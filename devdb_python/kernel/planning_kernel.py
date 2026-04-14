# kernel/planning_kernel.py
# plan() -- single entry point for the planning kernel.
#
# Owns:    Wiring S-0700 -> S-0800 -> S-0810 in sequence.
#          Returning a validated Proposal to the shell.
# Not Own: DB queries. Persistence. Convergence loop. Builder assignment.
#          Any state outside of frozen_input. Computing date_cmp or date_cls.
#          Chronology filtering of temp lots (S-0820 — shell stage, post timing expansion).
#
# The kernel is pure: given the same FrozenInput it always returns the same Proposal.
# It does not query the database. It does not write to any table.
#
# Kernel boundary (per BoundarySpec):
#   Proposal.temp_lots contains assignment decisions (date_str, date_td, date_dev).
#   date_cmp and date_cls are absent — derived by coordinator._expand_timing post-solve.
#   S-0820 chronology filtering runs in the shell after timing expansion.

from .frozen_input import FrozenInput
from .proposal import Proposal
from .proposal_validator import ProposalValidator, ProposalValidationError
from engine.s0700_demand_allocator import demand_allocator
from engine.s0800_temp_lot_generator import temp_lot_generator
from engine.s0810_building_group_enforcer import building_group_enforcer


def plan(frozen_input: FrozenInput) -> Proposal:
    """
    Run the planning kernel against a frozen input snapshot.
    Returns a Proposal containing allocations and temp lot assignment decisions.
    No DB I/O. No side effects. date_cmp/date_cls are absent from temp_lots —
    the shell derives them via _expand_timing after this returns.
    """
    # S-0700: assign real lots to demand slots (U -> H -> D pull order)
    allocated_df, unmet_demand_series = demand_allocator(
        frozen_input.lot_snapshot,
        frozen_input.demand_series,
    )

    # S-0800: generate temp lots for each unmet demand slot (assignment decisions only)
    temp_lots_raw = temp_lot_generator(
        unmet_demand_series,
        frozen_input.phase_capacity,
        frozen_input.sim_run_id,
        phase_building_config=frozen_input.phase_building_config,
    )

    # S-0810: enforce building group date_str coupling (date_cmp/date_cls not set here)
    temp_lots_enforced = building_group_enforcer(temp_lots_raw)

    proposal = Proposal(
        allocations_df=allocated_df,
        temp_lots=temp_lots_enforced,
        discarded_lots=[],
        warnings=[],
    )

    result = ProposalValidator().validate(proposal, frozen_input)
    if not result.passed:
        raise ProposalValidationError(result.failures)
    proposal.warnings = result.warnings

    print(f"  Kernel dev {frozen_input.dev_id}: "
          f"allocations={len(allocated_df)}, temp_lots={len(temp_lots_enforced)}")

    return proposal
