-- Migration 004: TDA schema additions
-- Adds ent_group_id to agreements, checkpoint_name + status to checkpoints,
-- and HC/BLDR projected date + lock fields to lot assignments.
-- HC/BLDR lock pattern is the TDA proof-of-concept for a future system-wide
-- locked-projected-date model (see CLAUDE.md D-151).

-- 1. Link takedown agreements to an entitlement group
ALTER TABLE devdb.sim_takedown_agreements
    ADD COLUMN IF NOT EXISTS ent_group_id BIGINT
        REFERENCES devdb.sim_entitlement_groups(ent_group_id);

-- 2. Add display name and status to checkpoints
ALTER TABLE devdb.sim_takedown_checkpoints
    ADD COLUMN IF NOT EXISTS checkpoint_name TEXT,
    ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'pending';

-- 3. Add HC and BLDR projected date + lock to lot assignments
ALTER TABLE devdb.sim_takedown_lot_assignments
    ADD COLUMN IF NOT EXISTS hc_projected_date   DATE,
    ADD COLUMN IF NOT EXISTS hc_is_locked        BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS bldr_projected_date DATE,
    ADD COLUMN IF NOT EXISTS bldr_is_locked      BOOLEAN NOT NULL DEFAULT FALSE;
