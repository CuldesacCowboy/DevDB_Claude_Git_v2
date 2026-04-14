-- 049_fix_valley_point_instrument.sql
-- Paw Paw Hazen Street ph. 1 and ph. 2 (phase_ids 143, 144) were incorrectly
-- linked to the "Hawthorne Meadows" instrument (instrument_id=70069, dev_id=84)
-- instead of the "Valley Point" instrument (instrument_id=70114, dev_id=79).
--
-- Effect: Abbey Farms split-check (ent_group_id=9003) was reporting these Valley
-- Point phases as missing product splits because the join traverses sli.dev_id,
-- and dev_id=84 (Hawthorne Meadows) is a member of Abbey Farms.

UPDATE devdb.sim_dev_phases
SET instrument_id = 70114   -- Valley Point instrument
WHERE phase_id IN (143, 144)
  AND instrument_id = 70069; -- was incorrectly Hawthorne Meadows
