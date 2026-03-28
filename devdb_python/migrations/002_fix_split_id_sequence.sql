-- 002_fix_split_id_sequence.sql
-- Applied manually 2026-03-27, now tracked.
-- sim_phase_product_splits.split_id needed a sequence default.
DO $outer$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'devdb'
        AND table_name = 'sim_phase_product_splits'
        AND column_name = 'split_id'
        AND column_default LIKE 'nextval%'
    ) THEN
        CREATE SEQUENCE IF NOT EXISTS
            devdb.sim_phase_product_splits_split_id_seq;
        ALTER TABLE devdb.sim_phase_product_splits
            ALTER COLUMN split_id SET DEFAULT
            nextval('devdb.sim_phase_product_splits_split_id_seq');
        PERFORM setval(
            'devdb.sim_phase_product_splits_split_id_seq',
            COALESCE(
                (SELECT MAX(split_id) FROM devdb.sim_phase_product_splits), 0
            ) + 1
        );
    END IF;
END $outer$;
