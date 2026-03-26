# kernel/proposal_validator.py
# ProposalValidator -- formal validation of a Proposal before it leaves the kernel.
#
# A Proposal that fails validation must never reach the shell.
# ProposalValidationError is raised for blocking failures.
# Non-blocking issues are returned in ValidationResult.warnings and merged into
# proposal.warnings by plan() before returning.

from dataclasses import dataclass, field


class ProposalValidationError(Exception):
    """Raised by plan() when the Proposal fails validation. Never reaches the shell."""
    def __init__(self, failures: list):
        self.failures = failures
        super().__init__(f"Proposal validation failed ({len(failures)} issue(s)): {failures}")


@dataclass
class ValidationResult:
    passed: bool
    failures: list = field(default_factory=list)  # blocking — non-empty means Proposal is rejected
    warnings: list = field(default_factory=list)  # non-blocking — merged into proposal.warnings


class ProposalValidator:
    """
    Validates a Proposal against its FrozenInput before plan() returns to the shell.
    All five checks run in order; the full failure list is always collected.
    """

    def validate(self, proposal, frozen_input) -> ValidationResult:
        failures = []
        warnings = []

        failures.extend(self._check_chronology(proposal))
        cap_failures, cap_warnings = self._check_capacity(proposal, frozen_input)
        failures.extend(cap_failures)
        warnings.extend(cap_warnings)
        failures.extend(self._check_fill_order(proposal, frozen_input))
        failures.extend(self._check_real_lot_immutability(proposal))
        failures.extend(self._check_sim_lot_sentinel(proposal))

        return ValidationResult(
            passed=len(failures) == 0,
            failures=failures,
            warnings=warnings,
        )

    # ──────────────────────────────────────────────────────────
    # Private checks
    # ──────────────────────────────────────────────────────────

    def _check_chronology(self, proposal) -> list:
        """
        For every temp lot: date_td <= date_str must hold where both dates are set.

        D-137 NOTE: date_dev and date_str are explicitly decoupled for sim lots.
        A phase may have a future delivery date while demand starts earlier.
        Checking date_dev <= date_td would produce false failures for valid proposals
        (e.g., a phase with date_dev=2027-07 serving a demand slot in 2026-11).
        Only date_td <= date_str is checked here as a blocking constraint.
        """
        failures = []
        for i, lot in enumerate(proposal.temp_lots):
            date_td  = lot.get("date_td")
            date_str = lot.get("date_str")
            if date_td is not None and date_str is not None:
                if date_td > date_str:
                    failures.append(
                        f"Chronology violation on temp lot {i} "
                        f"(phase_id={lot.get('phase_id')}): "
                        f"date_td={date_td} > date_str={date_str}"
                    )
        return failures

    def _check_capacity(self, proposal, frozen_input) -> tuple:
        """
        For each (phase_id, lot_type_id) in proposal.temp_lots: count must not
        exceed frozen_input.phase_capacity.available_slots for that combination.
          count > available_slots  -> failure (over-capacity)
          count == available_slots -> warning (fully committed / exhausted)
          count < available_slots  -> OK

        The exhausted-warning replaces the stdout-only capacity notice in S-0800.
        """
        failures = []
        warnings = []

        if not proposal.temp_lots or not frozen_input.phase_capacity:
            return failures, warnings

        capacity_map = {
            (int(pc["phase_id"]), int(pc["lot_type_id"])): int(pc["available_slots"])
            for pc in frozen_input.phase_capacity
        }

        counts = {}
        for lot in proposal.temp_lots:
            key = (int(lot["phase_id"]), int(lot["lot_type_id"]))
            counts[key] = counts.get(key, 0) + 1

        for (phase_id, lot_type_id), count in counts.items():
            cap = capacity_map.get((phase_id, lot_type_id))
            if cap is None:
                failures.append(
                    f"Capacity violation: phase_id={phase_id}, "
                    f"lot_type_id={lot_type_id} has {count} temp lot(s) "
                    f"but no entry in frozen_input.phase_capacity"
                )
            elif count > cap:
                failures.append(
                    f"Capacity violation: phase_id={phase_id}, "
                    f"lot_type_id={lot_type_id} has {count} temp lot(s) "
                    f"but available_slots={cap}"
                )
            elif count == cap:
                warnings.append(
                    f"[phase_id={phase_id}, lot_type_id={lot_type_id}] "
                    f"Capacity exhausted: all {cap} slots assigned. "
                    f"Any additional demand for this phase will go unmet. "
                    f"Increase lot_count in sim_phase_product_splits to absorb more demand."
                )

        return failures, warnings

    def _check_fill_order(self, proposal, frozen_input) -> list:
        """
        Temp lots must fill phases in the order they appear in frozen_input.phase_capacity
        (already sorted by sequence_number ASC, phase_id ASC by _load_phase_capacity).
        A later-ordered phase must not receive a temp lot before an earlier phase is
        exhausted.

        Implementation: rebuild the expected slot sequence by flattening phase_capacity
        (each phase repeated available_slots times), then verify the actual
        (phase_id, lot_type_id) sequence in proposal.temp_lots matches.
        Reports only the first violation.
        """
        if not proposal.temp_lots or not frozen_input.phase_capacity:
            return []

        expected_seq = []
        for pc in frozen_input.phase_capacity:
            for _ in range(int(pc["available_slots"])):
                expected_seq.append((int(pc["phase_id"]), int(pc["lot_type_id"])))

        actual_seq = [
            (int(lot["phase_id"]), int(lot["lot_type_id"]))
            for lot in proposal.temp_lots
        ]

        for i, (actual, expected) in enumerate(zip(actual_seq, expected_seq)):
            if actual != expected:
                return [
                    f"Fill order violation at slot {i}: expected "
                    f"phase_id={expected[0]}/lot_type_id={expected[1]}, "
                    f"got phase_id={actual[0]}/lot_type_id={actual[1]}"
                ]
        return []

    def _check_real_lot_immutability(self, proposal) -> list:
        """
        proposal.allocations_df must contain exactly the columns produced by S-0700:
          lot_id, assigned_year, assigned_month
        No extra columns (especially no date fields from the real lot) may appear.

        NOTE: The boundary spec uses 'assigned_demand_month' but S-0700 produces
        two separate columns: assigned_year and assigned_month. This check validates
        the actual S-0700 output schema.
        """
        expected = {"lot_id", "assigned_year", "assigned_month"}
        actual   = set(proposal.allocations_df.columns)

        extra = actual - expected
        if extra:
            return [
                f"Real lot immutability violation: unexpected column(s) in "
                f"allocations_df: {sorted(extra)}"
            ]
        missing = expected - actual
        if missing:
            return [
                f"Real lot immutability violation: missing expected column(s) in "
                f"allocations_df: {sorted(missing)}"
            ]
        return []

    def _check_sim_lot_sentinel(self, proposal) -> list:
        """
        Every temp lot must satisfy date_td == date_str (D-142 sentinel).
        S-0800 sets date_td = date_str at creation; S-0810 maintains it under
        building group enforcement. Failure here means a module broke the invariant.
        """
        failures = []
        for i, lot in enumerate(proposal.temp_lots):
            date_td  = lot.get("date_td")
            date_str = lot.get("date_str")
            if date_td != date_str:
                failures.append(
                    f"D-142 sentinel violation on temp lot {i} "
                    f"(phase_id={lot.get('phase_id')}): "
                    f"date_td={date_td} != date_str={date_str}"
                )
        return failures
