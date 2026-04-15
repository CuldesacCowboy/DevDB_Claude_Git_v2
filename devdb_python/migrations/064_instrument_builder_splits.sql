-- Migration 064: Move builder splits from phase level to instrument level.
-- Creates sim_instrument_builder_splits, migrates existing phase-level data, drops sim_phase_builder_splits.

CREATE TABLE IF NOT EXISTS devdb.sim_instrument_builder_splits (
    split_id      BIGINT NOT NULL,
    instrument_id BIGINT NOT NULL,
    builder_id    INTEGER,
    share         NUMERIC
);

DO $$ BEGIN
    ALTER TABLE devdb.sim_instrument_builder_splits
        ADD CONSTRAINT pk_sim_instrument_builder_splits PRIMARY KEY (split_id);
EXCEPTION WHEN duplicate_table OR duplicate_object OR invalid_table_definition THEN NULL; END $$;

DO $$ BEGIN
    ALTER TABLE devdb.sim_instrument_builder_splits
        ADD CONSTRAINT uq_instrument_builder_splits UNIQUE (instrument_id, builder_id);
EXCEPTION WHEN duplicate_table OR duplicate_object OR invalid_table_definition THEN NULL; END $$;

DO $$ BEGIN
    ALTER TABLE devdb.sim_instrument_builder_splits
        ADD CONSTRAINT fk_instbldr_instrument FOREIGN KEY (instrument_id)
            REFERENCES devdb.sim_legal_instruments(instrument_id);
EXCEPTION WHEN duplicate_table OR duplicate_object OR invalid_table_definition THEN NULL; END $$;

-- Sequence for split_id auto-increment
DO $$ BEGIN
    CREATE SEQUENCE IF NOT EXISTS devdb.sim_instrument_builder_splits_split_id_seq;
    PERFORM setval(
        'devdb.sim_instrument_builder_splits_split_id_seq',
        COALESCE((SELECT MAX(split_id) FROM devdb.sim_phase_builder_splits), 0) + 1,
        false
    );
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'devdb' AND table_name = 'sim_instrument_builder_splits'
          AND column_default LIKE '%sim_instrument_builder_splits_split_id_seq%'
    ) THEN
        ALTER TABLE devdb.sim_instrument_builder_splits
            ALTER COLUMN split_id SET DEFAULT nextval('devdb.sim_instrument_builder_splits_split_id_seq');
    END IF;
END $$;

-- Migrate existing data: one row per (instrument_id, builder_id), pick the first phase's share if duplicates.
INSERT INTO devdb.sim_instrument_builder_splits (instrument_id, builder_id, share)
SELECT DISTINCT ON (sdp.instrument_id, spbs.builder_id)
    sdp.instrument_id,
    spbs.builder_id,
    spbs.share
FROM devdb.sim_phase_builder_splits spbs
JOIN devdb.sim_dev_phases sdp ON sdp.phase_id = spbs.phase_id
ORDER BY sdp.instrument_id, spbs.builder_id, sdp.phase_id
ON CONFLICT (instrument_id, builder_id) DO NOTHING;

-- Drop old table (data fully migrated above)
DROP TABLE IF EXISTS devdb.sim_phase_builder_splits;
