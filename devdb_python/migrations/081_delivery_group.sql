-- 081_delivery_group.sql
-- Add delivery_group column to sim_dev_phases.
-- A single uppercase letter (A-Z) that forces phases within the same
-- entitlement group to deliver simultaneously. Groups are community-scoped:
-- Group A in Austin Landings is independent of Group A in Stonewater.

ALTER TABLE sim_dev_phases
    ADD COLUMN IF NOT EXISTS delivery_group CHAR(1)
        CHECK (delivery_group ~ '^[A-Z]$');
