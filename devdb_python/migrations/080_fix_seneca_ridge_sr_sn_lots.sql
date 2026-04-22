-- Migration 080: Correct Seneca Ridge lot assignments after marks_code fix (SR→SN).
-- SR* lots belonged to Spring Ridge; they were incorrectly linked to Seneca Ridge (dev_id=27)
-- because Seneca Ridge formerly had marks_code='SR'. Now that Seneca Ridge uses 'SN',
-- SR* lots must be released (dev_id=NULL, phase_id=NULL) so they surface in Spring Ridge's
-- MARKS import bank. SN* orphaned lots are assigned to Seneca Ridge ph.2.

-- 1. Release SR* lots from Seneca Ridge.
UPDATE sim_lots SET dev_id = NULL, phase_id = NULL
WHERE lot_number LIKE 'SR%' AND dev_id = 27;

-- 2. Assign orphaned SN* lots (dev_id=27, no phase) to Seneca Ridge ph.2.
UPDATE sim_lots SET phase_id = (
    SELECT phase_id FROM sim_dev_phases
    WHERE instrument_id = 70097 AND phase_name = 'Seneca Ridge ph. 2'
)
WHERE dev_id = 27 AND phase_id IS NULL AND lot_number LIKE 'SN%';

-- 3. Correct ph.2 projected count to match actual SN lot count (38).
UPDATE sim_dev_phases SET lot_count_projected = 38
WHERE instrument_id = 70097 AND phase_name = 'Seneca Ridge ph. 2';

UPDATE sim_phase_product_splits SET projected_count = 38
WHERE phase_id = (
    SELECT phase_id FROM sim_dev_phases
    WHERE instrument_id = 70097 AND phase_name = 'Seneca Ridge ph. 2'
) AND lot_type_id = 101;
