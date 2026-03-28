-- 003_rename_lot_count_to_projected_count.sql
-- sim_phase_product_splits.lot_count is ambiguous. Rename to projected_count.
DO $outer$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'devdb'
        AND table_name = 'sim_phase_product_splits'
        AND column_name = 'lot_count'
    ) THEN
        ALTER TABLE devdb.sim_phase_product_splits
            RENAME COLUMN lot_count TO projected_count;
    END IF;
END $outer$;
