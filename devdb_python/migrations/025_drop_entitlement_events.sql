-- Migration 025: Drop sim_entitlement_events table
-- Functionality replaced by phase-level date_ent (migration 023).
-- The group-level Entitlements Date is now written to sim_dev_phases.date_ent
-- and propagated to sim_lots.date_ent by the coordinator at run time.
-- All API endpoints for this table have been removed.

DROP TABLE IF EXISTS sim_entitlement_events;
