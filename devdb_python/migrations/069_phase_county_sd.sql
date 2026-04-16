-- Migration 069: Add county_id and school_district_id to sim_dev_phases.
--
-- Phase-level exceptions in the three-tier cascade. NULL = inherit from
-- the community default (sim_entitlement_groups).
--
-- county_id:          overrides community default for this phase
-- school_district_id: overrides community default for this phase;
--                     still trumped by lot-level sd on sim_lots

ALTER TABLE devdb.sim_dev_phases
    ADD COLUMN IF NOT EXISTS county_id          INT REFERENCES devdb.ref_counties(county_id),
    ADD COLUMN IF NOT EXISTS school_district_id INT REFERENCES devdb.ref_school_districts(sd_id);
