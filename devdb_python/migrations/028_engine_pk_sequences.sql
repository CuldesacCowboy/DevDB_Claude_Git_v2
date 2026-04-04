-- 028_engine_pk_sequences.sql
-- Add auto-increment sequences to four engine-owned tables whose PK generation
-- still used MAX(id)+1 in application code (race condition under concurrent runs).
-- Pattern matches 027_pk_sequences.sql: idempotent DO block, setval to current
-- MAX so existing seeded/fixture IDs are never reused.

DO $$
BEGIN

    -- ── sim_lots.lot_id ──────────────────────────────────────────────────────
    CREATE SEQUENCE IF NOT EXISTS devdb.sim_lots_id_seq;
    PERFORM setval(
        'devdb.sim_lots_id_seq',
        COALESCE((SELECT MAX(lot_id) FROM devdb.sim_lots), 0) + 1,
        false
    );
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'devdb' AND table_name = 'sim_lots'
          AND column_name = 'lot_id'
          AND (column_default LIKE 'nextval%' OR identity_generation IS NOT NULL)
    ) THEN
        ALTER TABLE devdb.sim_lots
            ALTER COLUMN lot_id
            SET DEFAULT nextval('devdb.sim_lots_id_seq');
    END IF;

    -- ── sim_lot_date_violations.violation_id ─────────────────────────────────
    CREATE SEQUENCE IF NOT EXISTS devdb.sim_lot_date_violations_id_seq;
    PERFORM setval(
        'devdb.sim_lot_date_violations_id_seq',
        COALESCE((SELECT MAX(violation_id) FROM devdb.sim_lot_date_violations), 0) + 1,
        false
    );
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'devdb' AND table_name = 'sim_lot_date_violations'
          AND column_name = 'violation_id'
          AND (column_default LIKE 'nextval%' OR identity_generation IS NOT NULL)
    ) THEN
        ALTER TABLE devdb.sim_lot_date_violations
            ALTER COLUMN violation_id
            SET DEFAULT nextval('devdb.sim_lot_date_violations_id_seq');
    END IF;

    -- ── sim_delivery_events.delivery_event_id ────────────────────────────────
    CREATE SEQUENCE IF NOT EXISTS devdb.sim_delivery_events_id_seq;
    PERFORM setval(
        'devdb.sim_delivery_events_id_seq',
        COALESCE((SELECT MAX(delivery_event_id) FROM devdb.sim_delivery_events), 0) + 1,
        false
    );
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'devdb' AND table_name = 'sim_delivery_events'
          AND column_name = 'delivery_event_id'
          AND (column_default LIKE 'nextval%' OR identity_generation IS NOT NULL)
    ) THEN
        ALTER TABLE devdb.sim_delivery_events
            ALTER COLUMN delivery_event_id
            SET DEFAULT nextval('devdb.sim_delivery_events_id_seq');
    END IF;

    -- ── sim_delivery_event_phases.id ─────────────────────────────────────────
    CREATE SEQUENCE IF NOT EXISTS devdb.sim_delivery_event_phases_id_seq;
    PERFORM setval(
        'devdb.sim_delivery_event_phases_id_seq',
        COALESCE((SELECT MAX(id) FROM devdb.sim_delivery_event_phases), 0) + 1,
        false
    );
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'devdb' AND table_name = 'sim_delivery_event_phases'
          AND column_name = 'id'
          AND (column_default LIKE 'nextval%' OR identity_generation IS NOT NULL)
    ) THEN
        ALTER TABLE devdb.sim_delivery_event_phases
            ALTER COLUMN id
            SET DEFAULT nextval('devdb.sim_delivery_event_phases_id_seq');
    END IF;

END $$;
