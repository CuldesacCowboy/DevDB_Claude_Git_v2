-- Migration 074: TDA lot banks
-- Introduces sim_tda_lot_banks and sim_tda_lot_bank_members to define
-- phase-scoped eligible lot pools that can be shared across multiple TDAs.
-- Adds bank_id, lot_quota, and builder_id to sim_takedown_agreements.
-- Migrates existing TDA pools into 1:1 banks to preserve all existing data.

-- 1. Create sim_tda_lot_banks
CREATE TABLE IF NOT EXISTS devdb.sim_tda_lot_banks (
    bank_id      BIGINT NOT NULL,
    ent_group_id BIGINT NOT NULL
        REFERENCES devdb.sim_entitlement_groups(ent_group_id),
    bank_name    TEXT NOT NULL,
    notes        TEXT,
    created_at   TIMESTAMPTZ DEFAULT now(),
    updated_at   TIMESTAMPTZ DEFAULT now()
);

DO $$ BEGIN
    ALTER TABLE devdb.sim_tda_lot_banks
        ADD CONSTRAINT pk_sim_tda_lot_banks PRIMARY KEY (bank_id);
EXCEPTION WHEN duplicate_table OR duplicate_object OR invalid_table_definition THEN NULL; END $$;

DO $$ BEGIN
    CREATE SEQUENCE IF NOT EXISTS devdb.sim_tda_lot_banks_bank_id_seq START WITH 1000;
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'devdb' AND table_name = 'sim_tda_lot_banks'
          AND column_default LIKE '%sim_tda_lot_banks_bank_id_seq%'
    ) THEN
        ALTER TABLE devdb.sim_tda_lot_banks
            ALTER COLUMN bank_id SET DEFAULT nextval('devdb.sim_tda_lot_banks_bank_id_seq');
    END IF;
END $$;

-- 2. Create sim_tda_lot_bank_members
CREATE TABLE IF NOT EXISTS devdb.sim_tda_lot_bank_members (
    bank_id BIGINT NOT NULL REFERENCES devdb.sim_tda_lot_banks(bank_id),
    lot_id  BIGINT NOT NULL REFERENCES devdb.sim_lots(lot_id),
    PRIMARY KEY (bank_id, lot_id)
);

-- 3. Add new columns to sim_takedown_agreements
ALTER TABLE devdb.sim_takedown_agreements
    ADD COLUMN IF NOT EXISTS bank_id    BIGINT REFERENCES devdb.sim_tda_lot_banks(bank_id),
    ADD COLUMN IF NOT EXISTS lot_quota  INTEGER,
    ADD COLUMN IF NOT EXISTS builder_id INTEGER REFERENCES devdb.dim_builders(builder_id);

-- 4. Data migration: create one bank per existing TDA that has pool lots,
--    populate bank members from existing sim_takedown_agreement_lots,
--    and link each TDA to its new bank.
DO $$
DECLARE
    r          RECORD;
    new_bank_id BIGINT;
BEGIN
    FOR r IN
        SELECT tda.tda_id, tda.tda_name, tda.ent_group_id,
               COUNT(tal.lot_id) AS lot_count
        FROM devdb.sim_takedown_agreements tda
        JOIN devdb.sim_takedown_agreement_lots tal ON tal.tda_id = tda.tda_id
        WHERE tda.bank_id IS NULL  -- skip any that were already migrated
        GROUP BY tda.tda_id, tda.tda_name, tda.ent_group_id
        HAVING COUNT(tal.lot_id) > 0
    LOOP
        INSERT INTO devdb.sim_tda_lot_banks (ent_group_id, bank_name, created_at, updated_at)
        VALUES (r.ent_group_id, r.tda_name || ' Bank', now(), now())
        RETURNING bank_id INTO new_bank_id;

        INSERT INTO devdb.sim_tda_lot_bank_members (bank_id, lot_id)
        SELECT new_bank_id, lot_id
        FROM devdb.sim_takedown_agreement_lots
        WHERE tda_id = r.tda_id
        ON CONFLICT DO NOTHING;

        UPDATE devdb.sim_takedown_agreements
        SET bank_id   = new_bank_id,
            lot_quota = r.lot_count
        WHERE tda_id = r.tda_id;
    END LOOP;
END $$;
