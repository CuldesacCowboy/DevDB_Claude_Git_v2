"""
S-0820 post_generation_chronology_guard — Discard temp lots with chronology violations.

Reads:   nothing — pure computation on temp_lots list
Writes:  nothing — returns (clean_lots, discarded_lots, warnings)
Input:   temp_lots: list of dicts from S-0810
Rules:   Checks date_cmp >= date_str and date_cls >= date_cmp on every temp lot.
         Discards (never corrects) any lot that fails either check.
         null date_cls is valid — never discard for null cls.
         Emits supply constraint warning when all lots for a phase_id are discarded.
         Never blocks the run; warnings are informational only.
         Not Own: generating temp lots (S-0800), enforcing building groups (S-0810),
         assigning builders (S-0900), writing to DB (S-1100).
"""
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
            print(f"post_gen_chronology_guard: Discarding lot phase_id={lot.get('phase_id')} "
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
