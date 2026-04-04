-- Migration 029: Add is_test flag to sim_entitlement_groups.
-- Marks Pokemon test communities so API/UI list endpoints can filter them out.
-- Engine is unaware of this flag — it runs test communities identically to real ones.

ALTER TABLE devdb.sim_entitlement_groups
    ADD COLUMN IF NOT EXISTS is_test BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS idx_sim_entgrp_is_test
    ON devdb.sim_entitlement_groups (is_test)
    WHERE is_test = TRUE;
