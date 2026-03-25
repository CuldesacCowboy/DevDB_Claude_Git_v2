# p07_lot_date_propagator.py
# P-07: Write phase delivery date to all sim_lots rows in affected phases.
#
# Owns:     Writing date_dev to sim_lots rows where phase_id matches updated phase.
# Not Own:  Writing any other lot date field. Writing to phase or event tables.
# Inputs:   conn, list of (phase_id, date_dev_projected) tuples from P-06.
# Outputs:  date_dev updated on lots in affected phases.
# Failure:  Real lots with date_dev already set (from P-01 actual): do not overwrite.
#           All other lots: overwrite with new projected date.

from .connection import DBConnection


def lot_date_propagator(conn: DBConnection, updated_phases: list) -> None:
    """
    updated_phases: list of (phase_id, date_dev_projected) tuples.
    Writes date_dev to all sim lots in each phase.
    For real lots: only updates where date_dev is null
    (real lots with date_dev set got it from actual event via P-01).
    Writer module: writes sim_lots.date_dev only.
    """
    for phase_id, projected_date in updated_phases:
        if projected_date is None:
            continue

        conn.execute(f"""
            UPDATE sim_lots
            SET date_dev = '{projected_date}'
            WHERE phase_id = {phase_id}
              AND lot_source = 'sim'
        """)

        conn.execute(f"""
            UPDATE sim_lots
            SET date_dev = '{projected_date}'
            WHERE phase_id = {phase_id}
              AND lot_source = 'real'
              AND date_dev IS NULL
              AND date_str IS NULL
              AND date_cmp IS NULL
              AND date_cls IS NULL
        """)

    print(f"P-07: Propagated date_dev for {len(updated_phases)} phases.")
