-- Migration 054: Move Waterton Station Site Condo instrument to SF dev
-- Instrument 4 ("Waterton Station Site Condo", site_condo) was incorrectly
-- assigned to Waterton Condos (Village) dev_id=58. Move it and all its phases
-- and lots to Waterton Station (SF) dev_id=45.

BEGIN;

SET search_path = devdb;

-- Move the instrument itself
UPDATE sim_legal_instruments
SET dev_id = 45
WHERE instrument_id = 4;

-- Move all phases under that instrument
UPDATE sim_dev_phases
SET dev_id = 45
WHERE instrument_id = 4;

-- Move all lots whose phase belongs to that instrument
UPDATE sim_lots
SET dev_id = 45
WHERE phase_id IN (
    SELECT phase_id FROM sim_dev_phases WHERE instrument_id = 4
);

COMMIT;
