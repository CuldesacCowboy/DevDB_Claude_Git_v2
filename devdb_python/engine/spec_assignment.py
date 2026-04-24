"""
S-0950 spec_assignment — Assign is_spec to undetermined lots using instrument spec_rate.

Reads:   sim_lots.is_spec (NULL = undetermined; TRUE/FALSE already set by S-0050)
         sim_legal_instruments.spec_rate (user-configured fraction, e.g. 0.30 = 30% spec)
Writes:  sim_lots.is_spec (NULL → TRUE or FALSE for undetermined lots)
Input:   conn: DBConnection, ent_group_id: int
Rules:   Runs once per engine invocation, after S-0900 builder assignment.
         Only touches lots where is_spec IS NULL.
         spec_rate applies to ALL lot sources (real pre-lots with no MARKS match, sim lots).
         Assignment is deterministic: lots are ordered by lot_id within each instrument;
         the first floor(spec_rate × count) lots get TRUE, the remainder get FALSE.
         If an instrument has no spec_rate set (NULL), its NULL lots remain NULL.
         Idempotent: re-running re-assigns from the current spec_rate.
Not Own: lots where is_spec IS NOT NULL (already set by MARKS via S-0050).
         builder_id assignment (S-0900). Split percentages.
"""

import logging
import math

logger = logging.getLogger(__name__)


def spec_assignment(conn, ent_group_id: int) -> int:
    """
    Assign is_spec to undetermined lots for this entitlement group.

    For each instrument with a spec_rate, collects its undetermined lots ordered
    by lot_id and assigns TRUE to the first floor(rate × count) lots and FALSE
    to the rest. Deterministic and idempotent.

    Returns count of lots assigned.
    """
    # Fetch undetermined lots grouped by instrument, ordered by lot_id.
    undetermined_df = conn.read_df(
        """
        SELECT sl.lot_id,
               sl.lot_source,
               sdp.instrument_id,
               sli.spec_rate
        FROM sim_lots sl
        JOIN sim_ent_group_developments segd ON segd.dev_id = sl.dev_id
        JOIN sim_dev_phases sdp ON sdp.phase_id = sl.phase_id
        JOIN sim_legal_instruments sli ON sli.instrument_id = sdp.instrument_id
        WHERE segd.ent_group_id = %s
          AND sl.is_spec IS NULL
          AND sli.spec_rate IS NOT NULL
          AND sl.excluded IS NOT TRUE
        ORDER BY sdp.instrument_id, sl.lot_id
        """,
        (ent_group_id,),
    )

    if undetermined_df.empty:
        logger.info("  spec_assignment: No undetermined lots to assign is_spec.")
        return 0

    assignments = []  # list of (is_spec: bool, lot_id: int)

    for instrument_id, group in undetermined_df.groupby("instrument_id", sort=False):
        spec_rate = float(group.iloc[0]["spec_rate"])
        lot_ids = group["lot_id"].tolist()
        n = len(lot_ids)
        n_spec = math.floor(spec_rate * n)

        for i, lot_id in enumerate(lot_ids):
            assignments.append((i < n_spec, int(lot_id)))

    if not assignments:
        logger.info("  spec_assignment: No assignments produced.")
        return 0

    conn.execute_values(
        """
        UPDATE sim_lots AS sl
        SET is_spec    = v.is_spec,
            updated_at = NOW()
        FROM (VALUES %s) AS v(is_spec, lot_id)
        WHERE sl.lot_id = v.lot_id::bigint
          AND sl.is_spec IS NULL
        """,
        assignments,
    )

    n_spec_total = sum(1 for is_spec, _ in assignments if is_spec)
    logger.info(
        f"  spec_assignment: Assigned is_spec to {len(assignments)} lot(s) "
        f"({n_spec_total} spec, {len(assignments) - n_spec_total} build) "
        f"(ent_group_id={ent_group_id})."
    )
    return len(assignments)
