-- 040_builder_id_override.sql
-- Add builder_id_override to sim_lots.
--
-- Priority hierarchy for effective builder on any lot:
--   1. builder_id_override  (user-set manual override -- always wins)
--   2. builder_id           (seeded from MARKS/original data)
--   3. NULL                 (sim engine assigns via S-0900 using phase splits)
--
-- COALESCE(builder_id_override, builder_id) = effective builder for display/reporting.
-- S-0900 writes only to builder_id on sim lots; real lots are never touched by the engine.

-- Ensure dim_builders has a primary key so FK references work.
ALTER TABLE devdb.dim_builders
    ADD CONSTRAINT IF NOT EXISTS pk_dim_builders PRIMARY KEY (builder_id);

ALTER TABLE devdb.sim_lots
    ADD COLUMN IF NOT EXISTS builder_id_override INTEGER
        REFERENCES devdb.dim_builders(builder_id);
