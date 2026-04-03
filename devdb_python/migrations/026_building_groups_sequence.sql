-- 026_building_groups_sequence.sql
-- Add auto-increment sequence to sim_building_groups.building_group_id so the
-- site-plan building-group tool can INSERT new rows without specifying an ID.

DO $$
BEGIN
    -- Create sequence if it does not already exist
    CREATE SEQUENCE IF NOT EXISTS devdb.sim_building_groups_id_seq;

    -- Advance the sequence past the current max to avoid collisions with
    -- the 239 real building groups already seeded from Access.
    PERFORM setval(
        'devdb.sim_building_groups_id_seq',
        COALESCE((SELECT MAX(building_group_id) FROM devdb.sim_building_groups), 0) + 1,
        false   -- false = next call returns this value (not this value + 1)
    );

    -- Attach the sequence as the column default only if not already set
    IF NOT EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'devdb'
          AND table_name   = 'sim_building_groups'
          AND column_name  = 'building_group_id'
          AND column_default LIKE 'nextval%'
    ) THEN
        ALTER TABLE devdb.sim_building_groups
            ALTER COLUMN building_group_id
            SET DEFAULT nextval('devdb.sim_building_groups_id_seq');
    END IF;
END $$;
