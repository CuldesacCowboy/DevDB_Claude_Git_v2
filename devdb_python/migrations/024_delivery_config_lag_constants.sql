-- Migration 024: Add build lag fallback constants to sim_entitlement_delivery_config
-- Moves DEFAULT_CMP_LAG (270) and DEFAULT_CLS_LAG (45) from hardcoded coordinator
-- constants into the delivery config table so they are editable per group.

ALTER TABLE sim_entitlement_delivery_config
    ADD COLUMN IF NOT EXISTS default_cmp_lag_days INT,
    ADD COLUMN IF NOT EXISTS default_cls_lag_days INT;

-- Populate existing rows with the historic hardcoded defaults.
UPDATE sim_entitlement_delivery_config
SET default_cmp_lag_days = 270,
    default_cls_lag_days = 45;
