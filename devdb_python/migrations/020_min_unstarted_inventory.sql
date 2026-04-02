-- Migration 020: Add min_unstarted_inventory to sim_entitlement_delivery_config
-- Stores the global minimum unstarted (U-status) lot count that must be maintained
-- across the entitlement group at all times. P-00 uses this to schedule deliveries
-- earlier than full exhaustion so the buffer is preserved.
-- NULL means no minimum (legacy behaviour, same as 0).

ALTER TABLE devdb.sim_entitlement_delivery_config
    ADD COLUMN IF NOT EXISTS min_unstarted_inventory INTEGER DEFAULT NULL;
