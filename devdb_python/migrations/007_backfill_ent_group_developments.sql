-- 007_backfill_ent_group_developments.sql
-- sim_ent_group_developments was only populated for Waterton Station (synthetic
-- test fixtures). All other communities are linked via developments.community_id
-- but have no junction rows, causing the phase-to-instrument assignment
-- validation to reject all moves with "not in the same entitlement group".
--
-- This migration inserts missing rows for every (community_id, dev_id) pair
-- that exists in developments (bridged to dim_development for the legacy dev_id)
-- but is not yet represented in sim_ent_group_developments.
--
-- ID assignment: MAX(id) + row_number(), safe because autocommit=True in the
-- migration runner and no concurrent writes occur during startup.

INSERT INTO devdb.sim_ent_group_developments (id, ent_group_id, dev_id)
SELECT
    (SELECT COALESCE(MAX(id), 0) FROM devdb.sim_ent_group_developments)
        + ROW_NUMBER() OVER (ORDER BY d.community_id, dd.development_id) AS id,
    d.community_id  AS ent_group_id,
    dd.development_id AS dev_id
FROM devdb.developments d
JOIN devdb.dim_development dd ON dd.dev_code2 = d.marks_code
WHERE d.community_id IS NOT NULL
  AND d.marks_code IS NOT NULL
  AND NOT EXISTS (
      SELECT 1
      FROM devdb.sim_ent_group_developments egd
      WHERE egd.ent_group_id = d.community_id
        AND egd.dev_id       = dd.development_id
  );
