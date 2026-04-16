-- Migration 068: Add county_id and school_district_id to sim_entitlement_groups.
--
-- These are community-level defaults for the three-tier cascade:
--   county:          COALESCE(phase.county_id,   community.county_id)
--   school_district: COALESCE(lot.sd_id, phase.sd_id, community.sd_id)
--
-- NULL = not yet set (no default configured for this community).

ALTER TABLE devdb.sim_entitlement_groups
    ADD COLUMN IF NOT EXISTS county_id         INT REFERENCES devdb.ref_counties(county_id),
    ADD COLUMN IF NOT EXISTS school_district_id INT REFERENCES devdb.ref_school_districts(sd_id);
