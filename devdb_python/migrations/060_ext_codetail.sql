-- Migration 059: Add devdb_ext.codetail table.
-- Local clone of MARKS codetail (option/cost detail per lot).
-- Source: ReferenceFiles/csv exports/codetail.csv
-- Loaded by: devdb_python/scripts/load_ext_codetail.py

CREATE TABLE IF NOT EXISTS devdb_ext.codetail (
    company_code      VARCHAR(20),
    development_code  VARCHAR(20)  NOT NULL,
    house_number      INT          NOT NULL,
    co_number         VARCHAR(20),
    add_delete_flag   VARCHAR(5),
    option_code       VARCHAR(20),
    option_category   VARCHAR(20),
    location          TEXT,
    quantity          NUMERIC,
    description       TEXT,
    sales_price       NUMERIC,
    imported_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ext_codetail_lot
    ON devdb_ext.codetail (development_code, house_number);
