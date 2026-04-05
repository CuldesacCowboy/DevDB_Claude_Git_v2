-- Migration 032: Phase config spreadsheet schema changes
-- 1. date_dev_actual on sim_dev_phases — when set, locks the delivery date
-- 2. Unique constraint on sim_phase_builder_splits(phase_id, builder_id) for ON CONFLICT upserts
-- 3. Sequence for sim_phase_builder_splits.split_id (race-free inserts)

ALTER TABLE sim_dev_phases
    ADD COLUMN IF NOT EXISTS date_dev_actual DATE;

DO $$ BEGIN
    ALTER TABLE devdb.sim_phase_builder_splits
        ADD CONSTRAINT uq_phase_builder_splits UNIQUE (phase_id, builder_id);
EXCEPTION WHEN duplicate_table OR duplicate_object OR invalid_table_definition THEN NULL; END $$;

DO $$ BEGIN
    CREATE SEQUENCE IF NOT EXISTS devdb.sim_phase_builder_splits_split_id_seq;
    PERFORM setval(
        'devdb.sim_phase_builder_splits_split_id_seq',
        COALESCE((SELECT MAX(split_id) FROM devdb.sim_phase_builder_splits), 0) + 1,
        false
    );
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'devdb' AND table_name = 'sim_phase_builder_splits'
          AND column_default LIKE '%sim_phase_builder_splits_split_id_seq%'
    ) THEN
        ALTER TABLE devdb.sim_phase_builder_splits
            ALTER COLUMN split_id SET DEFAULT nextval('devdb.sim_phase_builder_splits_split_id_seq');
    END IF;
END $$;
