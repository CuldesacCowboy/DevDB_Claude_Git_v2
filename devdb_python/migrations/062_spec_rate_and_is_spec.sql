-- Migration 062: Add spec_rate to sim_legal_instruments and is_spec to sim_lots.
--
-- spec_rate NUMERIC(5,4) — user-configurable spec fraction for the instrument
--   (NULL = not set; applies only to is_spec IS NULL lots via S-0950)
-- is_spec BOOLEAN — per-lot flag populated from MARKS codetail (conumber='000')
--   for real/pre lots; assigned by S-0950 for sim/undetermined lots.

ALTER TABLE sim_legal_instruments
    ADD COLUMN IF NOT EXISTS spec_rate NUMERIC(5,4);

ALTER TABLE sim_lots
    ADD COLUMN IF NOT EXISTS is_spec BOOLEAN;
