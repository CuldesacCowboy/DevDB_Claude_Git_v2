-- 051_fix_phase_dev_ids_to_legacy.sql
--
-- sim_dev_phases.dev_id must hold dim_development.development_id (legacy ID space).
-- This is the same space as sim_legal_instruments.dev_id (fixed by migration 045),
-- sim_ent_group_developments.dev_id (fixed by migration 050), and sim_dev_params.dev_id.
-- The phases API (phases.py) explicitly derives dev_id from the instrument when creating
-- new phases, confirming legacy is the intended space.
--
-- Migration 042 hardcoded dev_id values for phases that were inconsistently modern
-- (developments.dev_id) rather than legacy (dim_development.development_id). Since
-- instruments are the authoritative anchor and already carry correct legacy IDs
-- (after migration 045), we derive each phase's correct dev_id from its instrument.
--
-- Effect: 74 phases corrected. Engine queries (WHERE sdp.dev_id = segd.dev_id) will
-- now correctly resolve phases for each development.

UPDATE devdb.sim_dev_phases sdp
SET dev_id = sli.dev_id
FROM devdb.sim_legal_instruments sli
WHERE sdp.instrument_id = sli.instrument_id
  AND sdp.dev_id != sli.dev_id;
