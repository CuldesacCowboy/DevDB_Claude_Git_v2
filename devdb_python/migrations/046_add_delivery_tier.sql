-- Migration 046: Add delivery_tier to sim_dev_phases
-- A nullable integer that assigns a phase to a community-wide delivery tier.
-- Phases in tier N cannot be scheduled until ALL phases in tier N-1 are delivered.
-- NULL = no tier constraint (existing behavior, nothing breaks).

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'devdb'
          AND table_name   = 'sim_dev_phases'
          AND column_name  = 'delivery_tier'
    ) THEN
        ALTER TABLE sim_dev_phases ADD COLUMN delivery_tier INTEGER;
    END IF;
END $$;
