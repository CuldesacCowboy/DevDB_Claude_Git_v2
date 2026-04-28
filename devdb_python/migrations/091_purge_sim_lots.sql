-- Migration 091: Purge sim lots from sim_lots and prevent future inserts.
-- Sim lots now live exclusively in sim_projection_lots.

DELETE FROM sim_lots WHERE lot_source = 'sim';

-- Prevent accidental regression: sim lots can no longer be inserted into sim_lots.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'chk_no_sim_lots'
    ) THEN
        ALTER TABLE sim_lots ADD CONSTRAINT chk_no_sim_lots
            CHECK (lot_source IN ('real', 'pre'));
    END IF;
END $$;
