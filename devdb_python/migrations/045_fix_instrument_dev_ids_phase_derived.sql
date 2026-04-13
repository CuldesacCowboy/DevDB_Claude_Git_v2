-- 045_fix_instrument_dev_ids_phase_derived.sql
--
-- Corrects sim_legal_instruments.dev_id, which references dim_development.development_id
-- (legacy ID space), not developments.dev_id (modern ID space).
--
-- Root cause: migration 042 incorrectly used developments.dev_id values when updating
-- sim_legal_instruments.dev_id, breaking the join:
--   sim_legal_instruments.dev_id → dim_development.development_id → dim_development.dev_code2
--     → developments.marks_code → developments (for frontend modern_dev_id)
--
-- Fix: rederive each instrument's correct dim_development.development_id from its phases.
-- sim_dev_phases.dev_id is correct (references developments.dev_id, fixed by migration 042).
-- Bridge: developments.marks_code = dim_development.dev_code2 maps modern ↔ legacy IDs.
--
-- Result: all 58 wrong instruments corrected, including Abbey Farms, Waterton, all ~55
-- legacy instruments seeded by migration 037.

UPDATE devdb.sim_legal_instruments sli
SET dev_id = sub.correct_dim_dev_id
FROM (
    SELECT DISTINCT ON (p.instrument_id)
        p.instrument_id,
        dd.development_id AS correct_dim_dev_id
    FROM devdb.sim_dev_phases p
    JOIN devdb.developments d    ON d.dev_id      = p.dev_id
    JOIN devdb.dim_development dd ON dd.dev_code2  = d.marks_code
    ORDER BY p.instrument_id, p.phase_id
) sub
WHERE sli.instrument_id = sub.instrument_id
  AND sli.dev_id != sub.correct_dim_dev_id;
