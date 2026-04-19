-- Migration 075: Add td_to_str_lag to community delivery config and global settings.
--
-- td_to_str_lag INTEGER — configurable lag (months) between BLDR date (date_td, U status)
-- and DIG date (date_str, UC status). Applied by S-0760, S-0770, and S-0800.
-- Community setting overrides global; global default = 1 month.
--
-- Resolution order: community row → global row → hardcoded default (1)

ALTER TABLE devdb.sim_entitlement_delivery_config
    ADD COLUMN IF NOT EXISTS td_to_str_lag INTEGER;

ALTER TABLE devdb.sim_global_settings
    ADD COLUMN IF NOT EXISTS td_to_str_lag INTEGER;

UPDATE devdb.sim_global_settings
SET td_to_str_lag = 1
WHERE id = 1
  AND td_to_str_lag IS NULL;
