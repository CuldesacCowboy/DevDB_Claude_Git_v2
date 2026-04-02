-- Migration 018: Replace projection_group_id with dev_id on sim_lots.
-- Projection groups are retired as a simulation grain. The hierarchy is now:
--   entitlement group -> development -> legal instrument -> phase -> lot.
-- sim_lots.dev_id is populated from sim_dev_phases via phase_id.
-- The FK constraint and index on projection_group_id are dropped first.
-- Views that reference projection_group_id are dropped via CASCADE;
-- ledger_aggregator recreates them on next run using dev_id.

-- ── 1. Add dev_id column ─────────────────────────────────────────────────────

ALTER TABLE devdb.sim_lots ADD COLUMN IF NOT EXISTS dev_id INTEGER;

-- ── 2. Populate from sim_dev_phases ─────────────────────────────────────────

UPDATE devdb.sim_lots sl
SET dev_id = sdp.dev_id
FROM devdb.sim_dev_phases sdp
WHERE sl.phase_id = sdp.phase_id;

-- ── 3. Add FK to developments ────────────────────────────────────────────────

DO $$ BEGIN
    ALTER TABLE devdb.sim_lots
        ADD CONSTRAINT fk_sim_lots_dev
        FOREIGN KEY (dev_id) REFERENCES devdb.developments(dev_id);
EXCEPTION WHEN duplicate_table OR duplicate_object OR invalid_table_definition THEN NULL; END $$;

-- ── 4. Add index for dev-scoped queries ─────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_sim_lots_dev_source
    ON devdb.sim_lots (dev_id, lot_source);

-- ── 5. Drop old FK constraint and index on projection_group_id ───────────────

DO $$ BEGIN
    ALTER TABLE devdb.sim_lots DROP CONSTRAINT IF EXISTS fk_sim_lots_projection_group;
EXCEPTION WHEN undefined_object THEN NULL; END $$;

DROP INDEX IF EXISTS devdb.idx_sim_lots_pg_source;

-- ── 6. Drop projection_group_id (CASCADE drops any dependent views) ──────────

ALTER TABLE devdb.sim_lots DROP COLUMN IF EXISTS projection_group_id CASCADE;
