-- 085_is_spec_source.sql
-- Track provenance of is_spec flag: 'marks' (S-0050 codetail), 'engine' (spec_assignment), 'manual' (user override).

ALTER TABLE sim_lots ADD COLUMN IF NOT EXISTS is_spec_source TEXT;

-- Backfill: real/pre lots with is_spec set are from marks_builder_sync (S-0050).
-- Sim lots with is_spec set are from spec_assignment.
UPDATE sim_lots SET is_spec_source = 'marks'  WHERE is_spec IS NOT NULL AND lot_source IN ('real', 'pre');
UPDATE sim_lots SET is_spec_source = 'engine' WHERE is_spec IS NOT NULL AND lot_source = 'sim';
