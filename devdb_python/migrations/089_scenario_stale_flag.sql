-- Migration 089: Add is_stale flag to sim_scenarios
-- When structure changes (phases, lots, instruments, product splits), all
-- scenarios for that community are flagged stale. Frontend shows a yellow badge.

ALTER TABLE sim_scenarios ADD COLUMN IF NOT EXISTS is_stale BOOLEAN DEFAULT FALSE;
