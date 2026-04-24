"""
S-1000 demand_derived_date_writer — Write MIN(date_str) per phase to sim_dev_phases.

Reads:   nothing — uses temp_lots list from S-0800/S-0810/S-0820
Writes:  sim_dev_phases.date_dev_demand_derived (DB, UPDATE)
Input:   conn: DBConnection, temp_lots: list of dicts
Rules:   Computes MIN(date_str) per phase_id across temp lots.
         Never writes null; skips lots with null date_str.
         Empty temp lots → no-op.
         Not Own: any other field on sim_dev_phases, any lot table modification.
"""

import logging
from collections import defaultdict
from .connection import DBConnection

logger = logging.getLogger(__name__)


def demand_derived_date_writer(conn: DBConnection, temp_lots: list) -> None:
    """
    Compute MIN(date_str) per phase_id from temp lots.
    Write result to sim_dev_phases.date_dev_demand_derived.
    Only writes where result is non-null.
    Writer module: writes sim_dev_phases.date_dev_demand_derived.
    """
    if not temp_lots:
        return

    phase_min: dict = defaultdict(lambda: None)
    for lot in temp_lots:
        phase_id = lot.get("phase_id")
        date_str = lot.get("date_str")
        if phase_id is None or date_str is None:
            continue
        if phase_min[phase_id] is None or date_str < phase_min[phase_id]:
            phase_min[phase_id] = date_str

    if not phase_min:
        return

    for phase_id, derived_date in phase_min.items():
        if derived_date is None:
            continue
        conn.execute(
            """
            UPDATE sim_dev_phases
            SET date_dev_demand_derived = %s
            WHERE phase_id = %s
              AND (date_dev_demand_derived IS NULL
                   OR date_dev_demand_derived != %s)
            """,
            (derived_date, phase_id, derived_date),
        )

    logger.info(f"S-10: Wrote date_dev_demand_derived for {len(phase_min)} phase(s).")
