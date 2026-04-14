-- 052_fix_orphaned_locked_delivery_events.sql
--
-- After migration 051 corrected sim_dev_phases.dev_id to legacy space,
-- some locked delivery events now reference phases that no longer belong
-- to the event's entitlement group.
--
-- Root cause: migration 042 assigned modern dev_ids to 122 phases. The
-- engine queried phases by ent_group->segd->dev_id, found wrong phases,
-- and created locked delivery events against them. Migration 051 fixed
-- the phase dev_ids, but the locked event-phase links still point to
-- phases from the wrong community.
--
-- Concrete example: locked event 10247 (Kettle Preserve) links to
-- phase 131 (Summit Pointe ph. 1). After migration 051 phase 131 has
-- dev_id=61 (Summit Pointe legacy), which does not appear in Kettle
-- Preserve's sim_ent_group_developments entries (dev_id=57). The link
-- is orphaned and blocks auto-scheduling of Kettle Preserve's real
-- phases (137, 138, 139).
--
-- Effect: locked events whose phases no longer belong to the group are
-- cleaned up; phases are returned to undelivered status so the next
-- simulation run auto-schedules them correctly.

-- ─── 1. Remove predecessor rows for affected locked events ───────────────────

DELETE FROM devdb.sim_delivery_event_predecessors
WHERE event_id IN (
    SELECT DISTINCT dep.delivery_event_id
    FROM devdb.sim_delivery_event_phases dep
    JOIN devdb.sim_delivery_events sde
         ON sde.delivery_event_id = dep.delivery_event_id
    JOIN devdb.sim_dev_phases sdp
         ON sdp.phase_id = dep.phase_id
    WHERE sde.date_dev_actual IS NOT NULL
      AND NOT EXISTS (
          SELECT 1
          FROM devdb.sim_ent_group_developments segd
          WHERE segd.ent_group_id = sde.ent_group_id
            AND segd.dev_id = sdp.dev_id
      )
)
OR predecessor_event_id IN (
    SELECT DISTINCT dep.delivery_event_id
    FROM devdb.sim_delivery_event_phases dep
    JOIN devdb.sim_delivery_events sde
         ON sde.delivery_event_id = dep.delivery_event_id
    JOIN devdb.sim_dev_phases sdp
         ON sdp.phase_id = dep.phase_id
    WHERE sde.date_dev_actual IS NOT NULL
      AND NOT EXISTS (
          SELECT 1
          FROM devdb.sim_ent_group_developments segd
          WHERE segd.ent_group_id = sde.ent_group_id
            AND segd.dev_id = sdp.dev_id
      )
);

-- ─── 2. Delete orphaned locked event-phase links ─────────────────────────────

DELETE FROM devdb.sim_delivery_event_phases
WHERE id IN (
    SELECT dep.id
    FROM devdb.sim_delivery_event_phases dep
    JOIN devdb.sim_delivery_events sde
         ON sde.delivery_event_id = dep.delivery_event_id
    JOIN devdb.sim_dev_phases sdp
         ON sdp.phase_id = dep.phase_id
    WHERE sde.date_dev_actual IS NOT NULL
      AND NOT EXISTS (
          SELECT 1
          FROM devdb.sim_ent_group_developments segd
          WHERE segd.ent_group_id = sde.ent_group_id
            AND segd.dev_id = sdp.dev_id
      )
);

-- ─── 3. Delete locked events that now have no phase links ────────────────────
-- These events existed solely because of the wrong phase links above.
-- Deleting them returns those phases to undelivered status so the engine
-- will auto-schedule them on the next simulation run.

DELETE FROM devdb.sim_delivery_events
WHERE date_dev_actual IS NOT NULL
  AND delivery_event_id NOT IN (
      SELECT DISTINCT delivery_event_id
      FROM devdb.sim_delivery_event_phases
  );
