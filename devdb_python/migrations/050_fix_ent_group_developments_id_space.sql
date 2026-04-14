-- 050_fix_ent_group_developments_id_space.sql
--
-- Migration 044 contained a critical bug: it inserted developments.dev_id (the modern
-- ID space from the developments table) into sim_ent_group_developments.dev_id, which
-- must hold dim_development.development_id (the legacy MARKS ID space).
--
-- All admin/phase-config, audit, and simulation joins traverse:
--   sim_ent_group_developments.dev_id = sim_legal_instruments.dev_id   (legacy space)
--   sim_ent_group_developments.dev_id = dim_development.development_id (legacy space)
--
-- Because modern dev_id values (e.g. 64, 66, 67) are numerically equal to completely
-- different legacy development_ids, every community ended up with the wrong developments.
-- For example, Prairie Winds West received dev_ids 64/66/67 (modern IDs for its three
-- developments) which resolved as The Range Townhomes / Deer Creek Meadows / Kuipers
-- Meadow in the legacy ID space.
--
-- Fix: delete all real-community rows and rebuild using the correct legacy ID
-- (dim_development.development_id) bridged via dev_code2 = marks_code.

-- ─── 1. Delete wrong links for real (non-test) communities ───────────────────

DELETE FROM devdb.sim_ent_group_developments
WHERE ent_group_id IN (
    SELECT ent_group_id FROM devdb.sim_entitlement_groups WHERE is_test = false
);

-- ─── 2. Rebuild using dim_development.development_id (legacy ID space) ───────
-- id has no sequence; assign via row_number starting above current max (9306).

INSERT INTO devdb.sim_ent_group_developments (id, ent_group_id, dev_id)
SELECT
    9400 + ROW_NUMBER() OVER (ORDER BY d.community_id, dd.development_id),
    d.community_id,
    dd.development_id          -- legacy dim_development.development_id
FROM devdb.developments d
JOIN devdb.dim_development dd ON dd.dev_code2 = d.marks_code
WHERE d.community_id IS NOT NULL
  AND d.dev_id < 7000
  AND d.community_id IN (
      SELECT ent_group_id FROM devdb.sim_entitlement_groups WHERE is_test = false
  );
