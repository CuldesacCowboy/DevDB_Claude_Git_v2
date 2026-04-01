-- Migration 012: Add projected/locked companion fields to sim_lots
-- Implements the D-151 system-wide pattern for all pipeline dates.
-- Every pipeline date gets: date_X (MARKS actual, existing) +
--   date_X_projected (user-managed) + date_X_is_locked (lock flag).
-- Also migrates HC/BLDR projected dates from sim_takedown_lot_assignments
-- to sim_lots and drops the old columns from the assignments table.

-- ── 1. Add all new projected and lock columns ─────────────────────

ALTER TABLE devdb.sim_lots
    ADD COLUMN IF NOT EXISTS date_ent_projected     DATE,
    ADD COLUMN IF NOT EXISTS date_ent_is_locked     BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS date_dev_is_locked     BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS date_td_hold_projected DATE,
    ADD COLUMN IF NOT EXISTS date_td_hold_is_locked BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS date_td_projected      DATE,
    ADD COLUMN IF NOT EXISTS date_td_is_locked      BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS date_str_projected     DATE,
    ADD COLUMN IF NOT EXISTS date_str_is_locked     BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS date_frm_projected     DATE,
    ADD COLUMN IF NOT EXISTS date_frm_is_locked     BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS date_cmp_projected     DATE,
    ADD COLUMN IF NOT EXISTS date_cmp_is_locked     BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS date_cls_projected     DATE,
    ADD COLUMN IF NOT EXISTS date_cls_is_locked     BOOLEAN NOT NULL DEFAULT FALSE;

-- ── 2. Migrate HC/BLDR projected dates and lock flags ────────────
-- HC (date_td_hold) = developer -> holding company (D->H, activity 136)
-- BLDR (date_td)    = developer -> builder        (D->U, activity 135)
-- D-025: one active TDA per lot. DISTINCT ON picks latest assignment per lot.

UPDATE devdb.sim_lots l
SET
    date_td_hold_projected = a.hc_projected_date,
    date_td_hold_is_locked = COALESCE(a.hc_is_locked, FALSE),
    date_td_projected      = a.bldr_projected_date,
    date_td_is_locked      = COALESCE(a.bldr_is_locked, FALSE)
FROM (
    SELECT DISTINCT ON (lot_id)
        lot_id,
        hc_projected_date,
        hc_is_locked,
        bldr_projected_date,
        bldr_is_locked
    FROM devdb.sim_takedown_lot_assignments
    WHERE hc_projected_date IS NOT NULL
       OR hc_is_locked = TRUE
       OR bldr_projected_date IS NOT NULL
       OR bldr_is_locked = TRUE
    ORDER BY lot_id, assignment_id DESC
) a
WHERE l.lot_id = a.lot_id;

-- ── 3. Drop migrated columns from sim_takedown_lot_assignments ────

ALTER TABLE devdb.sim_takedown_lot_assignments
    DROP COLUMN IF EXISTS hc_projected_date,
    DROP COLUMN IF EXISTS hc_is_locked,
    DROP COLUMN IF EXISTS bldr_projected_date,
    DROP COLUMN IF EXISTS bldr_is_locked;
