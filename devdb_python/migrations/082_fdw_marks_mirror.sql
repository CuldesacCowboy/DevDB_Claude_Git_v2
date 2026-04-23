-- 082_fdw_marks_mirror.sql
-- Replace local devdb_ext tables with foreign tables pointing at marks_mirror DB.
--
-- marks_mirror is a full 219-table PostgreSQL mirror of MARKSystems MySQL,
-- maintained by marks_sync.py in the FinancialTracker project.
-- DevDB previously loaded a subset of these tables via one-off CSV imports.
-- This migration switches to live cross-database reads via postgres_fdw,
-- so devdb_ext always sees the latest synced data without manual reloads.

-- 1. Install the foreign-data-wrapper extension
CREATE EXTENSION IF NOT EXISTS postgres_fdw;

-- 2. Create foreign server pointing at marks_mirror on same host
DROP SERVER IF EXISTS marks_mirror_srv CASCADE;
CREATE SERVER marks_mirror_srv
    FOREIGN DATA WRAPPER postgres_fdw
    OPTIONS (host 'localhost', port '5432', dbname 'marks_mirror');

-- 3. User mapping (local postgres -> remote postgres, no password needed for localhost trust)
CREATE USER MAPPING IF NOT EXISTS FOR postgres
    SERVER marks_mirror_srv
    OPTIONS (user 'postgres');

-- 4. Drop local devdb_ext tables (data is now served from marks_mirror)
DROP TABLE IF EXISTS devdb_ext.categorymaster   CASCADE;
DROP TABLE IF EXISTS devdb_ext.codetail         CASCADE;
DROP TABLE IF EXISTS devdb_ext.companymaster    CASCADE;
DROP TABLE IF EXISTS devdb_ext.costcodemaster   CASCADE;
DROP TABLE IF EXISTS devdb_ext.gltrans          CASCADE;
DROP TABLE IF EXISTS devdb_ext.housecostdetail  CASCADE;
DROP TABLE IF EXISTS devdb_ext.housecostsummary CASCADE;
DROP TABLE IF EXISTS devdb_ext.housemaster      CASCADE;
DROP TABLE IF EXISTS devdb_ext.housestatuses    CASCADE;
DROP TABLE IF EXISTS devdb_ext.optionlotmaster  CASCADE;

-- 5. Import the 10 tables as foreign tables into devdb_ext schema
IMPORT FOREIGN SCHEMA public
    LIMIT TO (
        categorymaster,
        codetail,
        companymaster,
        costcodemaster,
        gltrans,
        housecostdetail,
        housecostsummary,
        housemaster,
        housestatuses,
        optionlotmaster
    )
    FROM SERVER marks_mirror_srv
    INTO devdb_ext;

-- 6. Replace local schedhousedetail (266k rows, stale CSV load) with foreign table.
--    Engine S-0200 reads FROM schedhousedetail (no schema prefix, resolves to devdb schema).
--    API marks router reads FROM devdb.schedhousedetail.
--    marks_mirror copy has ~5k more rows (fresher synced data).
DROP TABLE IF EXISTS devdb.schedhousedetail CASCADE;
IMPORT FOREIGN SCHEMA public
    LIMIT TO (schedhousedetail)
    FROM SERVER marks_mirror_srv
    INTO devdb;
