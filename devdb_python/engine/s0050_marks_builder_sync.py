"""
S-0050 marks_builder_sync — Apply MARKS builder assignments and spec flags to real/pre lots.

Reads:   devdb_ext.housemaster (local clone of MARKS tzzM01_JTH_HOUSEMASTER1)
         devdb_ext.codetail    (option/cost detail; conumber='000' = spec lot signal)
         devdb.dim_builders    (marks_company_code → builder_id mapping)
Writes:  sim_lots.builder_id
         sim_lots.is_spec
Input:   conn: DBConnection, ent_group_id: int
Rules:   Runs once per engine invocation, before the iteration loop and before
         S-0900 split assignment.
         Priority is preserved: builder_id_override always wins (never touched here).
         Only writes builder_id — the MARKS tier in the three-tier priority.
         Skips lots with MODELCODE = 'UNK' in housemaster.
         Skips lots whose lot_number does not match the standard alpha+numeric pattern.
         Idempotent: re-running overwrites builder_id with the same value from MARKS
         (MARKS is authoritative for lots it knows about).
         is_spec: set TRUE for lots with a codetail row where conumber='000' (spec signal).
                  set FALSE for housemaster lots with no such row (confirmed build).
                  Lots with no housemaster match remain NULL (undetermined → S-0950).
         If devdb_ext.housemaster is empty or does not exist, logs a warning and returns 0.
Not Own: modifying builder_id_override, split percentages, or sim/temp lot builder logic.
         S-0950 handles is_spec assignment for NULL lots.
"""

import logging

logger = logging.getLogger(__name__)


def marks_builder_sync(conn, ent_group_id: int) -> int:
    """
    Apply MARKS builder_id and is_spec to real/pre lots in this entitlement group.

    Pass 1 — builder_id:
      Joins devdb_ext.housemaster to sim_lots via developmentcode + housenumber
      (extracted from lot_number), then through dim_builders on marks_company_code
      to resolve builder_id.

    Pass 2 — is_spec:
      For lots matched in housemaster:
        TRUE  if a codetail row exists with conumber='000' (MARKS spec signal)
        FALSE if matched in housemaster but no such codetail row (confirmed build)
      Lots with no housemaster match are left NULL for S-0950.

    Returns count of lots updated (builder pass).
    """
    # ── Pass 1: builder_id ─────────────────────────────────────────────────────
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

    # ── Pass 2: is_spec via codetail conumber='000' ────────────────────────────
    try:
        spec_df = conn.read_df(
            """
            SELECT sl.lot_id,
                   (ct.conumber IS NOT NULL) AS is_spec
            FROM sim_lots sl
            JOIN sim_ent_group_developments segd ON segd.dev_id = sl.dev_id
            JOIN devdb_ext.housemaster hm
                ON  hm.developmentcode = REGEXP_REPLACE(sl.lot_number, '[0-9]+$', '')
                AND hm.housenumber     = CAST(REGEXP_REPLACE(sl.lot_number, '^[A-Za-z]+', '') AS INT)
            LEFT JOIN devdb_ext.codetail ct
                ON  ct.companycode     = hm.companycode
                AND ct.developmentcode = hm.developmentcode
                AND ct.housenumber     = hm.housenumber
                AND ct.conumber        = '000'
            WHERE segd.ent_group_id = %s
              AND sl.lot_source IN ('real', 'pre')
              AND sl.excluded IS NOT TRUE
              AND sl.lot_number ~ '^[A-Za-z]+[0-9]+$'
            """,
            (ent_group_id,),
        )
    except Exception as exc:
        logger.warning(f"  S-0050: Could not read devdb_ext.codetail — {exc}. Skipping is_spec sync.")
        return len(updates)

    if not spec_df.empty:
        spec_updates = [
            (bool(row["is_spec"]), int(row["lot_id"]))
            for _, row in spec_df.iterrows()
        ]
        conn.execute_values(
            """
            UPDATE sim_lots AS sl
            SET is_spec    = v.is_spec,
                updated_at = NOW()
            FROM (VALUES %s) AS v(is_spec, lot_id)
            WHERE sl.lot_id = v.lot_id::bigint
            """,
            spec_updates,
        )
        spec_count = spec_df["is_spec"].sum()
        logger.info(f"  S-0050: Set is_spec for {len(spec_updates)} lot(s) "
                    f"({int(spec_count)} spec, {len(spec_updates) - int(spec_count)} build) "
                    f"(ent_group_id={ent_group_id}).")

    return len(updates)
