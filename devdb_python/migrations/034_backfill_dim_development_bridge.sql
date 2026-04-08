-- 034_backfill_dim_development_bridge.sql
-- 1. Widen developments.marks_code from CHAR(2) to TEXT so synthetic codes fit.
-- 2. Backfill dim_development rows for devs missing a bridge.
-- 3. Backfill sim_ent_group_developments links for devs with community_id but no link row.

-- Step 1: widen the column (idempotent — TEXT has no max length, re-running is safe).
ALTER TABLE devdb.developments ALTER COLUMN marks_code TYPE TEXT;

-- Step 2: backfill dim_development rows where the bridge is missing.
DO $$
DECLARE
    r          RECORD;
    legacy_id  BIGINT;
    syn_code   TEXT;
BEGIN
    FOR r IN
        SELECT d.dev_id, d.dev_name, d.marks_code
        FROM devdb.developments d
        WHERE NOT EXISTS (
            SELECT 1 FROM devdb.dim_development dd
            WHERE dd.dev_code2 = d.marks_code
              AND d.marks_code IS NOT NULL
        )
    LOOP
        syn_code := COALESCE(r.marks_code, 'DEV' || LPAD(r.dev_id::text, 6, '0'));

        IF r.marks_code IS NULL THEN
            UPDATE devdb.developments SET marks_code = syn_code WHERE dev_id = r.dev_id;
        END IF;

        SELECT COALESCE(MAX(development_id), 0) + 1 INTO legacy_id FROM devdb.dim_development;

        INSERT INTO devdb.dim_development (development_id, development_name, dev_code2, active)
        VALUES (legacy_id, r.dev_name, syn_code, true);

        RAISE NOTICE 'Backfilled dim_development for dev_id=% code=%', r.dev_id, syn_code;
    END LOOP;
END $$;

-- Step 3: backfill sim_ent_group_developments for devs with community_id but no link row.
DO $$
DECLARE
    r         RECORD;
    link_id   BIGINT;
    legacy_id BIGINT;
BEGIN
    FOR r IN
        SELECT d.dev_id, d.community_id, d.marks_code
        FROM devdb.developments d
        WHERE d.community_id IS NOT NULL
          AND d.marks_code IS NOT NULL
          AND NOT EXISTS (
              SELECT 1
              FROM devdb.sim_ent_group_developments segd
              JOIN devdb.dim_development dd ON dd.development_id = segd.dev_id
              WHERE dd.dev_code2 = d.marks_code
                AND segd.ent_group_id = d.community_id
          )
    LOOP
        SELECT dd.development_id INTO legacy_id
        FROM devdb.dim_development dd
        WHERE dd.dev_code2 = r.marks_code;

        IF legacy_id IS NOT NULL THEN
            SELECT COALESCE(MAX(id), 0) + 1 INTO link_id FROM devdb.sim_ent_group_developments;
            INSERT INTO devdb.sim_ent_group_developments (id, ent_group_id, dev_id)
            VALUES (link_id, r.community_id, legacy_id);
            RAISE NOTICE 'Backfilled sim_ent_group_developments dev_id=% ent_group_id=%', r.dev_id, r.community_id;
        END IF;
    END LOOP;
END $$;
