-- Migration 055: Add feed_starts_mode to sim_entitlement_delivery_config.
--
-- feed_starts_mode = FALSE (default): tier gate is active. Tier-N phases are
--   not scheduled until all tier-(N-1) phases have been assigned. Inventory may
--   run dry between tiers.
-- feed_starts_mode = TRUE: tier gate is removed from the scheduling loop. All
--   devs compete by D-balance urgency. Aggressive batching ensures starts are
--   always fed. Tier ordering still enforced through predecessor links (P-02).

ALTER TABLE devdb.sim_entitlement_delivery_config
    ADD COLUMN IF NOT EXISTS feed_starts_mode BOOLEAN NOT NULL DEFAULT FALSE;
