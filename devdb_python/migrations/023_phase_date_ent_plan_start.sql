-- Migration 023: Add date_ent and date_plan_start to sim_dev_phases
-- date_ent: phase-level entitlement date; lots inherit from their phase
-- date_plan_start: phase-level planning start anchor (renamed from "First Paper Lots")
-- Both are propagated downward from the group-level values on save.

ALTER TABLE sim_dev_phases
    ADD COLUMN IF NOT EXISTS date_ent        DATE,
    ADD COLUMN IF NOT EXISTS date_plan_start DATE;

-- Populate from existing group-level values so running groups keep their dates.
-- Joins through instruments → ent_group_developments → entitlement_groups.
UPDATE sim_dev_phases sdp
SET date_ent = seg.date_ent_actual
FROM sim_legal_instruments sli
JOIN sim_ent_group_developments egd ON egd.dev_id   = sli.dev_id
JOIN sim_entitlement_groups     seg ON seg.ent_group_id = egd.ent_group_id
WHERE sdp.instrument_id       = sli.instrument_id
  AND seg.date_ent_actual IS NOT NULL;

UPDATE sim_dev_phases sdp
SET date_plan_start = seg.date_paper
FROM sim_legal_instruments sli
JOIN sim_ent_group_developments egd ON egd.dev_id       = sli.dev_id
JOIN sim_entitlement_groups     seg ON seg.ent_group_id = egd.ent_group_id
WHERE sdp.instrument_id    = sli.instrument_id
  AND seg.date_paper IS NOT NULL;
