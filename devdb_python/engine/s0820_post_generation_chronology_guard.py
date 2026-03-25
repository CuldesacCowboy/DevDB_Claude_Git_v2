# s0820_post_generation_chronology_guard.py
# S-0820: Discard temp lots with chronology violations after building group enforcement.
#
# Owns:   Checking date_cmp >= date_str and date_cls >= date_cmp on every temp lot.
#         Discarding (never correcting) any lot that fails either check.
#         Emitting a supply constraint warning when all lots for a phase_id are discarded.
# Not Own: Generating temp lots (S-0800). Enforcing building groups (S-0810).
#          Assigning builders (S-0900). Writing to DB (S-1100).
# Inputs:  temp_lots list from S-0810.
# Outputs: (clean_lots, discarded_lots, warnings)
#
# Rules:
#   - null date_cls is valid (lot may close beyond projection window). Never discard for null cls.
#   - Never blocks the run; warnings are informational only.
#   - Discarded lots get a 'violation' key added describing the failed check.
#   - A supply constraint warning is emitted for each phase_id whose entire lot set
#     is discarded (clean_lots has zero lots for that phase but temp_lots had at least one).

def post_generation_chronology_guard(temp_lots: list) -> tuple:
    """
    Check chronology on each temp lot. Discard lots that fail.

    Checks applied in order:
      1. date_cmp >= date_str  (completion must not precede start)
      2. date_cls >= date_cmp  (closing must not precede completion; null date_cls passes)

    Returns:
      (clean_lots, discarded_lots, warnings)
        clean_lots     -- list of lots that passed all checks
        discarded_lots -- list of lots that failed; each dict has 'violation' key added
        warnings       -- list of supply constraint warning strings for fully-cleared phases
    """
    if not temp_lots:
        return [], [], []

    clean_lots = []
    discarded_lots = []

    for lot in temp_lots:
        date_str = lot.get("date_str")
        date_cmp = lot.get("date_cmp")
        date_cls = lot.get("date_cls")

        violation = None
        if date_cmp is not None and date_str is not None and date_cmp < date_str:
            violation = f"date_cmp ({date_cmp}) < date_str ({date_str})"
        elif date_cls is not None and date_cmp is not None and date_cls < date_cmp:
            violation = f"date_cls ({date_cls}) < date_cmp ({date_cmp})"

        if violation:
            discarded = dict(lot)
            discarded["violation"] = violation
            discarded_lots.append(discarded)
            print(f"S-0820: Discarding lot phase_id={lot.get('phase_id')} "
                  f"lot_type_id={lot.get('lot_type_id')}: {violation}")
        else:
            clean_lots.append(lot)

    # Emit supply constraint warning for every phase_id fully cleared by discards.
    warnings = []
    if discarded_lots:
        all_phase_ids  = {lot["phase_id"] for lot in temp_lots}
        clean_phase_ids = {lot["phase_id"] for lot in clean_lots}
        cleared_phases = all_phase_ids - clean_phase_ids

        for phase_id in sorted(cleared_phases):
            msg = (f"SUPPLY CONSTRAINT WARNING: All temp lots for phase_id={phase_id} "
                   f"were discarded by S-0820 chronology guard.")
            warnings.append(msg)
            print(msg)

    return clean_lots, discarded_lots, warnings
