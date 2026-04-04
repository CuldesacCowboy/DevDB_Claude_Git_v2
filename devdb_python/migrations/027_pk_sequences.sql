-- 027_pk_sequences.sql
-- Add auto-increment sequences to tables whose PK generation used MAX(id)+1 in
-- application code — a pattern that races under concurrent requests.
-- Pattern matches 026_building_groups_sequence.sql: idempotent DO block,
-- setval to current max so existing seeded/fixture IDs are never reused.

DO $$
BEGIN

    -- ── sim_entitlement_groups.ent_group_id ─────────────────────────────────
    CREATE SEQUENCE IF NOT EXISTS devdb.sim_entitlement_groups_id_seq;
    PERFORM setval(
        'devdb.sim_entitlement_groups_id_seq',
        COALESCE((SELECT MAX(ent_group_id) FROM devdb.sim_entitlement_groups), 0) + 1,
        false
    );
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'devdb' AND table_name = 'sim_entitlement_groups'
          AND column_name = 'ent_group_id'
          AND (column_default LIKE 'nextval%' OR identity_generation IS NOT NULL)
    ) THEN
        ALTER TABLE devdb.sim_entitlement_groups
            ALTER COLUMN ent_group_id
            SET DEFAULT nextval('devdb.sim_entitlement_groups_id_seq');
    END IF;

    -- ── sim_legal_instruments.instrument_id ──────────────────────────────────
    CREATE SEQUENCE IF NOT EXISTS devdb.sim_legal_instruments_id_seq;
    PERFORM setval(
        'devdb.sim_legal_instruments_id_seq',
        COALESCE((SELECT MAX(instrument_id) FROM devdb.sim_legal_instruments), 0) + 1,
        false
    );
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'devdb' AND table_name = 'sim_legal_instruments'
          AND column_name = 'instrument_id'
          AND (column_default LIKE 'nextval%' OR identity_generation IS NOT NULL)
    ) THEN
        ALTER TABLE devdb.sim_legal_instruments
            ALTER COLUMN instrument_id
            SET DEFAULT nextval('devdb.sim_legal_instruments_id_seq');
    END IF;

    -- ── sim_dev_phases.phase_id ───────────────────────────────────────────────
    CREATE SEQUENCE IF NOT EXISTS devdb.sim_dev_phases_id_seq;
    PERFORM setval(
        'devdb.sim_dev_phases_id_seq',
        COALESCE((SELECT MAX(phase_id) FROM devdb.sim_dev_phases), 0) + 1,
        false
    );
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'devdb' AND table_name = 'sim_dev_phases'
          AND column_name = 'phase_id'
          AND (column_default LIKE 'nextval%' OR identity_generation IS NOT NULL)
    ) THEN
        ALTER TABLE devdb.sim_dev_phases
            ALTER COLUMN phase_id
            SET DEFAULT nextval('devdb.sim_dev_phases_id_seq');
    END IF;

    -- ── sim_phase_product_splits.split_id ─────────────────────────────────────
    CREATE SEQUENCE IF NOT EXISTS devdb.sim_phase_product_splits_id_seq;
    PERFORM setval(
        'devdb.sim_phase_product_splits_id_seq',
        COALESCE((SELECT MAX(split_id) FROM devdb.sim_phase_product_splits), 0) + 1,
        false
    );
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'devdb' AND table_name = 'sim_phase_product_splits'
          AND column_name = 'split_id'
          AND (column_default LIKE 'nextval%' OR identity_generation IS NOT NULL)
    ) THEN
        ALTER TABLE devdb.sim_phase_product_splits
            ALTER COLUMN split_id
            SET DEFAULT nextval('devdb.sim_phase_product_splits_id_seq');
    END IF;

    -- ── sim_takedown_agreements.tda_id ────────────────────────────────────────
    CREATE SEQUENCE IF NOT EXISTS devdb.sim_takedown_agreements_id_seq;
    PERFORM setval(
        'devdb.sim_takedown_agreements_id_seq',
        COALESCE((SELECT MAX(tda_id) FROM devdb.sim_takedown_agreements), 0) + 1,
        false
    );
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'devdb' AND table_name = 'sim_takedown_agreements'
          AND column_name = 'tda_id'
          AND (column_default LIKE 'nextval%' OR identity_generation IS NOT NULL)
    ) THEN
        ALTER TABLE devdb.sim_takedown_agreements
            ALTER COLUMN tda_id
            SET DEFAULT nextval('devdb.sim_takedown_agreements_id_seq');
    END IF;

END $$;
