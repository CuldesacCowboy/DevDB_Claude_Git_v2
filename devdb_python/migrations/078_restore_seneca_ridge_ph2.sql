-- Migration 078: Restore Seneca Ridge ph. 2 and fix duplicate sim_ent_group_developments row.
--
-- Root cause: sim_ent_group_developments had 2 rows for (ent_group_id=9063, dev_id=27),
-- causing every phase to render twice in SetupView. User deleted what appeared to be a
-- duplicate ph. 2 record, but it was the only ph. 2 record — both display rows pointed
-- to the same DB row. Delete removed the real ph. 2 and unassigned its 50 SR* lots.
--
-- Fix:
--   1. Remove the duplicate sim_ent_group_developments row (keep one).
--   2. Re-insert sim_dev_phases row for ph. 2 (instrument_id=70097, seq=2).
--   3. Re-insert product split (lot_type_id=101, projected_count=50).
--   4. Re-assign the 50 SR* lots (lot_number LIKE 'SR%') back to the new phase.

-- Step 1: Remove duplicate sim_ent_group_developments row for Seneca Ridge.
DELETE FROM sim_ent_group_developments
WHERE ctid NOT IN (
    SELECT MIN(ctid)
    FROM sim_ent_group_developments
    WHERE ent_group_id = 9063 AND dev_id = 27
    GROUP BY ent_group_id, dev_id
)
AND ent_group_id = 9063 AND dev_id = 27;

-- Step 2: Re-insert ph. 2 (dev_id=27 = Seneca Ridge).
INSERT INTO sim_dev_phases (dev_id, instrument_id, phase_name, sequence_number, lot_count_projected)
VALUES (27, 70097, 'Seneca Ridge ph. 2', 2, 50);

-- Step 3 & 4 done via DO block so we can use the new phase_id.
DO $$
DECLARE
    new_phase_id INT;
BEGIN
    SELECT phase_id INTO new_phase_id
    FROM sim_dev_phases
    WHERE instrument_id = 70097 AND phase_name = 'Seneca Ridge ph. 2';

    -- Product split
    INSERT INTO sim_phase_product_splits (phase_id, lot_type_id, projected_count)
    VALUES (new_phase_id, 101, 50);

    -- Re-assign SR* lots
    UPDATE sim_lots
    SET phase_id = new_phase_id
    WHERE dev_id = 27
      AND phase_id IS NULL
      AND lot_number LIKE 'SR%';
END $$;
