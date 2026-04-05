-- 035_lot_excluded_flag.sql
-- Add excluded flag to sim_lots.
-- excluded = true: lot is permanently in the system but invisible to the simulation,
-- phase counts, unstarted inventory, and delivery scheduling.
-- Can be toggled on/off by users at any time.

ALTER TABLE devdb.sim_lots
    ADD COLUMN IF NOT EXISTS excluded BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS idx_sim_lots_excluded
    ON devdb.sim_lots (excluded) WHERE excluded = TRUE;
