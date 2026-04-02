-- Migration 019: Drop FK constraint on sim_dev_params.dev_id
--
-- sim_dev_params.dev_id is populated from dim_projection_groups.dev_id which is
-- dim_development.development_id space, NOT developments.dev_id (local Postgres).
-- The FK to developments was incorrect and blocks inserts for devs whose
-- dim_development.development_id != developments.dev_id (e.g. Spring Grove Farms).
-- Same pattern as migration 018 which dropped the FK on sim_lots.dev_id.

DO $$ BEGIN
    ALTER TABLE devdb.sim_dev_params DROP CONSTRAINT IF EXISTS sim_dev_params_dev_id_fkey;
EXCEPTION WHEN undefined_object THEN NULL; END $$;
