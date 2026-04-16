-- Migration 070: Add school_district_id to sim_lots.
--
-- Lot-level ruling exception — the top of the three-tier SD cascade.
-- County does NOT have a lot-level exception (plats are county-specific
-- legal instruments; lot-level county overrides are not needed).
--
-- Resolved SD for any lot:
--   COALESCE(l.school_district_id, ph.school_district_id, eg.school_district_id)
--
-- NULL = inherit from phase or community default.

ALTER TABLE devdb.sim_lots
    ADD COLUMN IF NOT EXISTS school_district_id INT REFERENCES devdb.ref_school_districts(sd_id);
