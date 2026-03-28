-- 008_fix_instrument_dev_ids_round2.sql
-- Instruments 8 and 9 were created while the backend was still running the old
-- code (before the fix in instruments.py was live), so their dev_id was saved as
-- the modern developments.dev_id rather than the legacy dim_development.development_id.
--
-- Generic re-run of the migration 006 UPDATE is unsafe: legacy dev_ids stored in
-- sim_legal_instruments can collide with modern dev_ids in developments (they share
-- the same integer space), so a generic join would incorrectly re-resolve already-
-- corrected instruments. This migration targets only the two known bad rows by
-- instrument_id.
--
-- Instrument 8: dev_id 101 (modern Abbey Farms CD) → 106 (legacy Abbey Farms AC)
-- Instrument 9: dev_id 83  (modern Abbey Farms TH) → 88  (legacy Abbey Farms AH)

UPDATE devdb.sim_legal_instruments i
SET dev_id = dd.development_id
FROM devdb.developments d
JOIN devdb.dim_development dd ON dd.dev_code2 = d.marks_code
WHERE i.instrument_id IN (8, 9)
  AND d.dev_id = i.dev_id
  AND d.marks_code IS NOT NULL;
