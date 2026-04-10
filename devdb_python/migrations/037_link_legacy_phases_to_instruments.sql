-- Migration 037: Link legacy phases (instrument_id=NULL) to sim_legal_instruments.
--
-- Root cause: the original seed migration created sim_dev_phases rows with a direct
-- dev_id reference but no instrument_id. The current UI architecture requires every
-- phase to be linked via instrument_id → sim_legal_instruments → dev_id chain.
-- Phases without an instrument link are invisible in the UI.
--
-- Fix: for each affected dev_id:
--   1. Use the existing instrument if one already exists for that dev.
--   2. Otherwise, create a new instrument — name from dim_development (legacy) or
--      developments (modern) table, falling back to the phase name.
--   3. Set instrument_id on all orphaned phases for that dev.
--
-- Test phases (dev_id >= 9000) are skipped intentionally — they are test fixtures
-- and their orphaned state is expected.

DO $$
DECLARE
    rec        RECORD;
    instr_id   INT;
    new_name   TEXT;
BEGIN
    FOR rec IN (
        SELECT DISTINCT p.dev_id,
               COALESCE(dd.development_name, d.dev_name, p.phase_name) AS dev_label
        FROM   devdb.sim_dev_phases p
        LEFT JOIN devdb.dim_development dd ON dd.development_id = p.dev_id
        LEFT JOIN devdb.developments    d  ON d.dev_id          = p.dev_id
        WHERE  p.instrument_id IS NULL
          AND  p.dev_id < 9000          -- skip test fixtures
        ORDER  BY COALESCE(dd.development_name, d.dev_name)
    ) LOOP
        -- Prefer an existing instrument for this dev
        SELECT instrument_id
        INTO   instr_id
        FROM   devdb.sim_legal_instruments
        WHERE  dev_id = rec.dev_id
        ORDER  BY instrument_id
        LIMIT  1;

        -- Create one if none exists
        IF instr_id IS NULL THEN
            new_name := COALESCE(rec.dev_label, 'Unknown');
            INSERT INTO devdb.sim_legal_instruments
                   (instrument_name, instrument_type, dev_id)
            VALUES (new_name, 'Plat', rec.dev_id)
            RETURNING instrument_id INTO instr_id;
        END IF;

        -- Link all orphaned phases for this dev
        UPDATE devdb.sim_dev_phases
        SET    instrument_id = instr_id
        WHERE  dev_id        = rec.dev_id
          AND  instrument_id IS NULL;

    END LOOP;
END $$;
