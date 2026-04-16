-- Migration 072: Drop county_id from ref_school_districts.
--
-- School districts commonly span multiple counties, so a single county_id FK
-- over-restricts SD dropdown filtering and is architecturally incorrect.
-- County and SD are now fully independent dimensions on communities and phases.

ALTER TABLE devdb.ref_school_districts DROP COLUMN IF EXISTS county_id;
