-- 087_fdw_readonly_role.sql
-- Create a restricted role for FDW access to marks_mirror.
-- Only the 11 tables DevDB actually reads are granted SELECT.
-- This prevents DevDB from querying sensitive MARKS tables
-- (AP invoices, vendor data, employee info, GL details).

-- Run on marks_mirror database (not devdb):
-- psql -U postgres -d marks_mirror -f this_file.sql

DO $$
BEGIN
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'devdb_reader') THEN
        CREATE ROLE devdb_reader LOGIN;
    END IF;
END $$;

-- Revoke all default access
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM devdb_reader;

-- Grant SELECT on only the tables DevDB uses
GRANT SELECT ON categorymaster    TO devdb_reader;
GRANT SELECT ON codetail          TO devdb_reader;
GRANT SELECT ON companymaster     TO devdb_reader;
GRANT SELECT ON costcodemaster    TO devdb_reader;
GRANT SELECT ON gltrans           TO devdb_reader;
GRANT SELECT ON housecostdetail   TO devdb_reader;
GRANT SELECT ON housecostsummary  TO devdb_reader;
GRANT SELECT ON housemaster       TO devdb_reader;
GRANT SELECT ON housestatuses     TO devdb_reader;
GRANT SELECT ON optionlotmaster   TO devdb_reader;
GRANT SELECT ON schedhousedetail  TO devdb_reader;
