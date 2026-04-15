-- Migration 058: Create devdb_ext schema and housemaster table.
--
-- devdb_ext is the local clone schema for external company data sources
-- (MARKS, SQL Server, ITK, etc.). Tables here are populated by import scripts
-- today; a sync engine will replace those scripts later once the full scope
-- of required tables is known.
--
-- housemaster mirrors tzzM01_JTH_HOUSEMASTER1 from the MARKS Access database.
-- The simulation engine reads this table in S-0050 to apply lot-level builder
-- assignments from MARKS on every simulation run.

CREATE SCHEMA IF NOT EXISTS devdb_ext;

CREATE TABLE IF NOT EXISTS devdb_ext.housemaster (
    development_code  VARCHAR(20)  NOT NULL,
    house_number      INT          NOT NULL,
    company_code      VARCHAR(20),
    model_code        VARCHAR(20),
    imported_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    PRIMARY KEY (development_code, house_number)
);
