-- 044_rebuild_ent_group_developments.sql
--
-- Rebuilds sim_ent_group_developments from developments.community_id (authoritative).
-- The original seeding of this table used shifted dev_ids, putting every community's
-- dev links ~5 positions off — matching the same bug fixed in migration 042 for
-- sim_legal_instruments and sim_dev_phases.
--
-- developments.community_id was seeded correctly and is the source of truth.
-- We delete all real-community entries and re-derive them.

-- ─── 1. Delete wrong links for real (non-test) communities ───────────────────

DELETE FROM devdb.sim_ent_group_developments
WHERE ent_group_id IN (
    SELECT ent_group_id FROM devdb.sim_entitlement_groups WHERE is_test = false
);

-- ─── 2. Rebuild from developments.community_id ───────────────────────────────
-- id has no sequence; assign via row_number starting above current max (9120)

INSERT INTO devdb.sim_ent_group_developments (id, ent_group_id, dev_id)
SELECT
    9200 + ROW_NUMBER() OVER (ORDER BY d.community_id, d.dev_id),
    d.community_id,
    d.dev_id
FROM devdb.developments d
WHERE d.community_id IS NOT NULL
  AND d.dev_id < 7000
  AND d.community_id IN (
      SELECT ent_group_id FROM devdb.sim_entitlement_groups WHERE is_test = false
  );
