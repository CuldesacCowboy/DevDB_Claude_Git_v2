"""
S-0050 marks_builder_sync — Apply MARKS builder assignments to real/pre lots.

Reads:   devdb_ext.housemaster (local clone of MARKS tzzM01_JTH_HOUSEMASTER1)
         devdb.dim_builders    (marks_company_code → builder_id mapping)
Writes:  sim_lots.builder_id
Input:   conn: DBConnection, ent_group_id: int
Rules:   Runs once per engine invocation, before the iteration loop and before
         S-0900 split assignment.
         Priority is preserved: builder_id_override always wins (never touched here).
         Only writes builder_id — the MARKS tier in the three-tier priority.
         Skips lots with MODELCODE = 'UNK' in housemaster.
         Skips lots whose lot_number does not match the standard alpha+numeric pattern.
         Idempotent: re-running overwrites builder_id with the same value from MARKS
         (MARKS is authoritative for lots it knows about).
         If devdb_ext.housemaster is empty or does not exist, logs a warning and returns 0.
Not Own: modifying builder_id_override, split percentages, or sim/temp lot builder logic.
"""

import logging

logger = logging.getLogger(__name__)


def marks_builder_sync(conn, ent_group_id: int) -> int:
    """
    Apply MARKS builder_id to real/pre lots in this entitlement group.

    Joins devdb_ext.housemaster to sim_lots via developmentcode + housenumber
    (extracted from lot_number), then through dim_builders on marks_company_code
    to resolve builder_id.

    Returns count of lots updated.
    """
    try:
        updated_df = conn.read_df(
            """
            SELECT sl.lot_id, db.builder_id AS marks_builder_id
            FROM sim_lots sl
            JOIN sim_ent_group_developments segd ON segd.dev_id = sl.dev_id
            JOIN devdb_ext.housemaster hm
                ON  hm.developmentcode = REGEXP_REPLACE(sl.lot_number, '[0-9]+$', '')
                AND hm.housenumber     = CAST(REGEXP_REPLACE(sl.lot_number, '^[A-Za-z]+', '') AS INT)
                AND (hm.modelcode IS NULL OR hm.modelcode <> 'UNK')
            JOIN dim_builders db ON db.marks_company_code = hm.companycode
            WHERE segd.ent_group_id = %s
              AND sl.lot_source IN ('real', 'pre')
              AND sl.excluded IS NOT TRUE
              AND sl.builder_id_override IS NULL
              AND sl.lot_number ~ '^[A-Za-z]+[0-9]+$'
              AND db.builder_id IS NOT NULL
            """,
            (ent_group_id,),
        )
    except Exception as exc:
        # Table may not exist yet (pre-migration) or housemaster may be empty.
        logger.warning(f"  S-0050: Could not read devdb_ext.housemaster — {exc}. Skipping MARKS builder sync.")
        return 0

    if updated_df.empty:
        logger.info("  S-0050: No MARKS builder assignments to apply.")
        return 0

    updates = [
        (int(row["marks_builder_id"]), int(row["lot_id"]))
        for _, row in updated_df.iterrows()
    ]

    conn.execute_values(
        """
        UPDATE sim_lots AS sl
        SET builder_id = v.builder_id,
            updated_at = NOW()
        FROM (VALUES %s) AS v(builder_id, lot_id)
        WHERE sl.lot_id = v.lot_id::bigint
        """,
        updates,
    )

    logger.info(f"  S-0050: Applied MARKS builder_id to {len(updates)} lot(s) "
                f"(ent_group_id={ent_group_id}).")
    return len(updates)
