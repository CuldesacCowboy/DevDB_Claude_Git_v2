-- Migration 057: Add scheduling_horizon_days to global settings and community delivery config.
-- Controls the minimum scheduling horizon: the engine will not project any dates
-- prior to (today + scheduling_horizon_days). Global default = 14 days.
-- NULL on community row = inherit from global.

ALTER TABLE devdb.sim_global_settings
    ADD COLUMN IF NOT EXISTS scheduling_horizon_days INT;

UPDATE devdb.sim_global_settings
SET scheduling_horizon_days = 14
WHERE id = 1 AND scheduling_horizon_days IS NULL;

ALTER TABLE devdb.sim_entitlement_delivery_config
    ADD COLUMN IF NOT EXISTS scheduling_horizon_days INT;
