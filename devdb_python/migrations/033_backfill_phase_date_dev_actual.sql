-- Migration 033: Backfill sim_dev_phases.date_dev_actual from existing locked delivery events
-- Phases linked to delivery events where date_dev_actual IS NOT NULL inherit that date.
-- This is a one-time sync so the Configure page reflects locks already entered via
-- the Simulation page before phase-level locking existed (migration 032).

UPDATE devdb.sim_dev_phases sdp
SET date_dev_actual = sde.date_dev_actual
FROM devdb.sim_delivery_event_phases dep
JOIN devdb.sim_delivery_events sde ON sde.delivery_event_id = dep.delivery_event_id
WHERE dep.phase_id = sdp.phase_id
  AND sde.date_dev_actual IS NOT NULL
  AND sdp.date_dev_actual IS NULL;
