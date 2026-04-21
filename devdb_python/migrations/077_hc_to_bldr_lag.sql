-- Migration 077: Replace per-TDA checkpoint_lead_days with community-level hc_to_bldr_lag_days.
-- This is the days of lead time between when the HC hold is issued and the builder takedown.
-- Follows the same global-default / community-override pattern as scheduling_horizon_days.

ALTER TABLE devdb.sim_global_settings
    ADD COLUMN IF NOT EXISTS hc_to_bldr_lag_days INTEGER;

ALTER TABLE devdb.sim_entitlement_delivery_config
    ADD COLUMN IF NOT EXISTS hc_to_bldr_lag_days INTEGER;

ALTER TABLE devdb.sim_takedown_agreements
    DROP COLUMN IF EXISTS checkpoint_lead_days;

-- Seed global default to 16 (matches the prior hardcoded _DEFAULT_LEAD_DAYS).
UPDATE devdb.sim_global_settings SET hc_to_bldr_lag_days = 16 WHERE id = 1;
