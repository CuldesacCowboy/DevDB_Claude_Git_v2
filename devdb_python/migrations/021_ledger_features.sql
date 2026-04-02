-- Migration 021: Ledger features
-- 1. ledger_start_date on sim_entitlement_groups
-- 2. sim_entitlement_events table
-- 3. Per-status inventory floor tolerances on sim_entitlement_delivery_config

-- ----------------------------------------------------------------
-- Req 1: Ledger start date
-- ----------------------------------------------------------------
ALTER TABLE devdb.sim_entitlement_groups
    ADD COLUMN IF NOT EXISTS ledger_start_date DATE DEFAULT NULL;

-- ----------------------------------------------------------------
-- Req 2: Entitlement events (MAX+1 ID per D-086)
-- ----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS devdb.sim_entitlement_events (
    event_id      BIGINT      NOT NULL,
    ent_group_id  BIGINT      NOT NULL,
    dev_id        INTEGER     NOT NULL,
    event_date    DATE        NOT NULL,
    lots_entitled INTEGER     NOT NULL DEFAULT 0,
    notes         TEXT,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT pk_sim_entitlement_events PRIMARY KEY (event_id)
);

DO $$ BEGIN
    ALTER TABLE devdb.sim_entitlement_events
        ADD CONSTRAINT fk_entitlement_events_group
        FOREIGN KEY (ent_group_id)
        REFERENCES devdb.sim_entitlement_groups(ent_group_id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ----------------------------------------------------------------
-- Req 3: Per-status floor tolerances
-- ----------------------------------------------------------------
ALTER TABLE devdb.sim_entitlement_delivery_config
    ADD COLUMN IF NOT EXISTS min_p_count  INTEGER DEFAULT NULL,
    ADD COLUMN IF NOT EXISTS min_e_count  INTEGER DEFAULT NULL,
    ADD COLUMN IF NOT EXISTS min_d_count  INTEGER DEFAULT NULL,
    ADD COLUMN IF NOT EXISTS min_u_count  INTEGER DEFAULT NULL,
    ADD COLUMN IF NOT EXISTS min_uc_count INTEGER DEFAULT NULL,
    ADD COLUMN IF NOT EXISTS min_c_count  INTEGER DEFAULT NULL;

-- Migrate: user re-assigned min_unstarted_inventory → D-status floor
UPDATE devdb.sim_entitlement_delivery_config
SET min_d_count = min_unstarted_inventory
WHERE min_unstarted_inventory IS NOT NULL
  AND min_d_count IS NULL;
