-- 084_drop_auto_schedule_enabled.sql
-- Remove auto_schedule_enabled column from sim_entitlement_delivery_config.
-- The column was a gate that disabled P-0050 entirely when false.
-- It added no value beyond what locked dates and community status already provide.
-- All communities now always auto-schedule delivery events.

ALTER TABLE sim_entitlement_delivery_config
    DROP COLUMN IF EXISTS auto_schedule_enabled;
