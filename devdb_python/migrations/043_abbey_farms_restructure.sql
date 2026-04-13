-- 043_abbey_farms_restructure.sql
--
-- Restructures Abbey Farms to match 2026-04-13 phasing plan (Nederveld C-205/C-300):
--   5 legal instruments across 4 developments
--   Phase 1 delivery bundle: SF ph.1 + TH ph.1 + GW West ph.1 = 2027-05-01
--
-- Target totals: 283 units
--   Abbey Farms Single Family      (dev 82)  = 136  (6 phases: 30/25/30/27/9/15)
--   Abbey Farms Townhomes          (dev 83)  =  52  (4 phases: 12/20/12/8)
--   Abbey Farms Gateway Homes West (dev 84)  =  40  (2 phases: 20/20)
--   Abbey Farms Gateway Homes East (dev 84)  =  31  (2 phases: 11/20)
--   Abbey Farms Ranch Condos       (dev 101) =  24  (1 phase:  24)

-- ─── 1. Rename development ────────────────────────────────────────────────────

UPDATE devdb.developments
SET dev_name = 'Abbey Farms (Ranch Condos)'
WHERE dev_id = 101;  -- was 'Abbey Farms (CD)'

-- ─── 2. Rename instruments ───────────────────────────────────────────────────

UPDATE devdb.sim_legal_instruments
SET instrument_name = 'Abbey Farms Single Family'
WHERE instrument_id = 7;  -- was 'Abbey Farms'

UPDATE devdb.sim_legal_instruments
SET instrument_name = 'Abbey Farms Gateway Homes West'
WHERE instrument_id = 5;  -- was 'Abbey Farms Gateway Homes'

-- ─── 3. Fix existing phases ──────────────────────────────────────────────────

-- SF: normalize phase names to consistent pattern
UPDATE devdb.sim_dev_phases SET phase_name = 'Abbey Farms SF ph. 1' WHERE phase_id = 150;
UPDATE devdb.sim_dev_phases SET phase_name = 'Abbey Farms SF ph. 2' WHERE phase_id = 151;
UPDATE devdb.sim_dev_phases SET phase_name = 'Abbey Farms SF ph. 3' WHERE phase_id = 153;
UPDATE devdb.sim_dev_phases SET phase_name = 'Abbey Farms SF ph. 4' WHERE phase_id = 152;
UPDATE devdb.sim_dev_phases SET phase_name = 'Abbey Farms SF ph. 5' WHERE phase_id = 154;
UPDATE devdb.sim_dev_phases SET phase_name = 'Abbey Farms SF ph. 6' WHERE phase_id = 155;

-- SF: update projected_counts for phases 4/5/6 (phasing plan counts)
UPDATE devdb.sim_phase_product_splits SET projected_count = 27 WHERE phase_id = 152;  -- was 30
UPDATE devdb.sim_phase_product_splits SET projected_count = 9  WHERE phase_id = 154;  -- was 30
UPDATE devdb.sim_phase_product_splits SET projected_count = 15 WHERE phase_id = 155;  -- was 30

-- TH ph. 1: normalize name
UPDATE devdb.sim_dev_phases
SET phase_name = 'Abbey Farms TH ph. 1'
WHERE phase_id = 157;  -- was 'Abbey Farms ph. 1 (TH)'

-- TH ph. 2: fix seq (3→2) and name (was 'Abbey Farms ph. 3 (TH)')
UPDATE devdb.sim_dev_phases
SET phase_name = 'Abbey Farms TH ph. 2', sequence_number = 2
WHERE phase_id = 160;

-- GW West ph. 1: fix name (was 'Abbey Farms Gateway ph. 2')
UPDATE devdb.sim_dev_phases
SET phase_name = 'Abbey Farms GW West ph. 1'
WHERE phase_id = 156;  -- seq 1 already correct

-- ─── 4. Create new instruments + phases (DO block to capture new IDs) ────────

DO $$
DECLARE
    v_gw_east_id INTEGER;
    v_ranch_id   INTEGER;
    v_ph_id      INTEGER;
BEGIN
    -- New instrument: Abbey Farms Gateway Homes East (same GW dev_id 84)
    INSERT INTO devdb.sim_legal_instruments (instrument_name, dev_id)
    VALUES ('Abbey Farms Gateway Homes East', 84)
    RETURNING instrument_id INTO v_gw_east_id;

    -- New instrument: Abbey Farms Ranch Condos (dev_id 101)
    INSERT INTO devdb.sim_legal_instruments (instrument_name, dev_id)
    VALUES ('Abbey Farms Ranch Condos', 101)
    RETURNING instrument_id INTO v_ranch_id;

    -- Move GW East phases from instrument 5 to new GW East instrument
    UPDATE devdb.sim_dev_phases
    SET instrument_id   = v_gw_east_id,
        phase_name      = 'Abbey Farms GW East ph. 1',
        sequence_number = 1
    WHERE phase_id = 159;  -- was seq 3, name 'Gateway ph. 1', 11 lots (split stays)

    UPDATE devdb.sim_dev_phases
    SET instrument_id   = v_gw_east_id,
        phase_name      = 'Abbey Farms GW East ph. 2',
        sequence_number = 2
    WHERE phase_id = 161;  -- was seq 5, name 'Gateway ph. 3', 20 lots (split stays)

    -- New TH ph. 3 (12 lots)
    INSERT INTO devdb.sim_dev_phases (phase_name, instrument_id, dev_id, sequence_number)
    VALUES ('Abbey Farms TH ph. 3', 9, 83, 3)
    RETURNING phase_id INTO v_ph_id;
    INSERT INTO devdb.sim_phase_product_splits (phase_id, lot_type_id, projected_count)
    VALUES (v_ph_id, 108, 12);

    -- New TH ph. 4 (8 lots)
    INSERT INTO devdb.sim_dev_phases (phase_name, instrument_id, dev_id, sequence_number)
    VALUES ('Abbey Farms TH ph. 4', 9, 83, 4)
    RETURNING phase_id INTO v_ph_id;
    INSERT INTO devdb.sim_phase_product_splits (phase_id, lot_type_id, projected_count)
    VALUES (v_ph_id, 108, 8);

    -- New GW West ph. 2 (20 lots)
    INSERT INTO devdb.sim_dev_phases (phase_name, instrument_id, dev_id, sequence_number)
    VALUES ('Abbey Farms GW West ph. 2', 5, 84, 2)
    RETURNING phase_id INTO v_ph_id;
    INSERT INTO devdb.sim_phase_product_splits (phase_id, lot_type_id, projected_count)
    VALUES (v_ph_id, 109, 20);

    -- New Ranch Condos ph. 1 (24 duplex units, lot_type 104)
    INSERT INTO devdb.sim_dev_phases (phase_name, instrument_id, dev_id, sequence_number)
    VALUES ('Abbey Farms Ranch Condos ph. 1', v_ranch_id, 101, 1)
    RETURNING phase_id INTO v_ph_id;
    INSERT INTO devdb.sim_phase_product_splits (phase_id, lot_type_id, projected_count)
    VALUES (v_ph_id, 104, 24);

END $$;

-- ─── 5. Set May 2027 date_dev_actual for Phase 1 bundle ──────────────────────

UPDATE devdb.sim_dev_phases SET date_dev_actual = '2027-05-01' WHERE phase_id = 150;  -- SF ph. 1
UPDATE devdb.sim_dev_phases SET date_dev_actual = '2027-05-01' WHERE phase_id = 157;  -- TH ph. 1
UPDATE devdb.sim_dev_phases SET date_dev_actual = '2027-05-01' WHERE phase_id = 156;  -- GW West ph. 1
