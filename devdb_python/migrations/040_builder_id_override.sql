-- 040_builder_id_override.sql
-- Add builder_id_override to sim_lots.
--
-- Priority hierarchy for effective builder on any lot:
--   1. builder_id_override  (user-set manual override -- always wins)
--   2. builder_id           (seeded from MARKS/original data)
--   3. NULL                 (sim engine assigns via S-0900 using phase splits)
--
-- COALESCE(builder_id_override, builder_id) = effective builder for display/reporting.
-- S-0900 assigns builder_id to sim lots (temp lot generation) AND to real/pre lots where
-- COALESCE(builder_id_override, builder_id) IS NULL (assign_real_lot_builders pre-pass).

-- Ensure dim_builders has a primary key so FK references work.
-- (IF NOT EXISTS is not valid for ADD CONSTRAINT; use DO block to guard.)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'pk_dim_builders' AND conrelid = 'devdb.dim_builders'::regclass
    ) THEN
        ALTER TABLE devdb.dim_builders ADD CONSTRAINT pk_dim_builders PRIMARY KEY (builder_id);
    END IF;
END
$$;

ALTER TABLE devdb.sim_lots
    ADD COLUMN IF NOT EXISTS builder_id_override INTEGER
        REFERENCES devdb.dim_builders(builder_id);
