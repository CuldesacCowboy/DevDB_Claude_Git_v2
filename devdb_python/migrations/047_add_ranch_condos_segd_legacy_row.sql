-- Migration 047: Add sim_ent_group_developments row for Ranch Condos legacy dim_development ID
--
-- Problem: Abbey Farms Ranch Condos has two ID spaces in conflict:
--   developments.dev_id = 101  (modern space, used by phases and the engine)
--   dim_development.development_id = 106  (legacy space, dev_code2 = 'AC', used by instruments)
--
-- The phase-config setup-tree query joins:
--   segd.dev_id -> dim_development.development_id  (legacy)
--   segd.dev_id -> sim_legal_instruments.dev_id    (legacy)
--   then bridges: dim_development.dev_code2 -> developments.marks_code  (to get dev_name)
--
-- The engine joins:
--   segd.dev_id -> sim_dev_phases.dev_id  (modern)
--
-- The existing segd row (dev_id=101) satisfies the engine but NOT the setup-tree query.
-- This migration adds a second segd row (dev_id=106) so the setup-tree JOIN succeeds.
-- The engine ignores dev_id=106 because no phases have dev_id=106.

INSERT INTO sim_ent_group_developments (id, ent_group_id, dev_id)
SELECT (SELECT COALESCE(MAX(id), 0) + 1 FROM sim_ent_group_developments), 9003, 106
WHERE NOT EXISTS (
    SELECT 1 FROM sim_ent_group_developments
    WHERE ent_group_id = 9003 AND dev_id = 106
);
