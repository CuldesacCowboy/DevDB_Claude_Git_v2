-- 011_add_display_order.sql
-- Add display_order column to sim_dev_phases (idempotent).
-- display_order is a UI display preference ONLY -- never read by the simulation engine.
-- NULL = no explicit order set; UI falls back to auto-sort (alphabetical by prefix, numeric by ph. N).
-- sequence_number remains the engine ordering column and is never touched here.

ALTER TABLE sim_dev_phases
  ADD COLUMN IF NOT EXISTS display_order INT NULL;
