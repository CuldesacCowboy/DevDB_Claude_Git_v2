-- Migration 076: Remove lot_quota from sim_takedown_agreements.
-- The column was intended to cap engine HC-hold assignments but is redundant —
-- checkpoint lots_required_cumulative already defines the total obligation.
-- Having it caused some TDAs to under-schedule HC dates (e.g. quota=16 with
-- cumulative requirement of 24 prevented 8 lots from ever getting HC dates).

ALTER TABLE devdb.sim_takedown_agreements DROP COLUMN IF EXISTS lot_quota;
