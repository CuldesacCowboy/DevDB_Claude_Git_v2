-- 006_fix_instrument_dev_ids.sql
-- sim_legal_instruments.dev_id must hold dim_development.development_id
-- (the legacy MARKsystems ID), but all existing instruments were saved with
-- developments.dev_id (the modern UI ID) due to a missing resolution step in
-- the POST endpoint.
--
-- Bridge: developments.marks_code = dim_development.dev_code2
-- Only updates rows where the bridge resolution exists (marks_code IS NOT NULL).

UPDATE devdb.sim_legal_instruments i
SET dev_id = dd.development_id
FROM devdb.developments d
JOIN devdb.dim_development dd ON dd.dev_code2 = d.marks_code
WHERE i.dev_id = d.dev_id
  AND d.marks_code IS NOT NULL;
