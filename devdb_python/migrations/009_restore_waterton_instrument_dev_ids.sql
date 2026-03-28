-- 009_restore_waterton_instrument_dev_ids.sql
-- Migration 006 performed a generic UPDATE joining sim_legal_instruments.dev_id =
-- developments.dev_id. Instruments 1-4 had CORRECT legacy dim_development.development_id
-- values (48, 49, 62) that collided with modern developments.dev_id values for unrelated
-- communities (The Range, Summerset Meadows North, Prairie Winds West). The generic join
-- incorrectly resolved them to those communities' legacy dev_ids (51, 52, 66).
--
-- This migration restores instruments 1-4 using explicit instrument_id → dev_id pairs
-- with NO join logic to avoid any integer-space collision.
--
-- Correct legacy dim_development.development_id values for Waterton Station instruments:
--   Instrument 1: Waterton Station Plat        → 48 (WS = Waterton Station SF)
--   Instrument 2: Waterton Pointe              → 49 (WT = Waterton Condos Pointe)
--   Instrument 3: Waterton Village             → 62 (WV = Waterton Condos Village)
--   Instrument 4: Waterton Station Site Condo  → 48 (WS = Waterton Station SF)

UPDATE devdb.sim_legal_instruments SET dev_id = 48 WHERE instrument_id = 1;
UPDATE devdb.sim_legal_instruments SET dev_id = 49 WHERE instrument_id = 2;
UPDATE devdb.sim_legal_instruments SET dev_id = 62 WHERE instrument_id = 3;
UPDATE devdb.sim_legal_instruments SET dev_id = 48 WHERE instrument_id = 4;
