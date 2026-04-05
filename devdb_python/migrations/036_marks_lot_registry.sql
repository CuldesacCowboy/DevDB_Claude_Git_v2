-- 036_marks_lot_registry.sql
-- Create marks_lot_registry: one row per distinct MARKS lot (deduplicated from OPTIONLOTMASTER).
-- This is the source of truth for "what lots exist in MARKS", including P-status lots
-- that have no schedhousedetail activity rows yet.

CREATE TABLE IF NOT EXISTS devdb.marks_lot_registry (
    developmentcode TEXT    NOT NULL,
    housenumber     INTEGER NOT NULL,
    lot_number      TEXT    NOT NULL,   -- computed: developmentcode || LPAD(housenumber::text,8,'0')
    address1        TEXT,
    PRIMARY KEY (developmentcode, housenumber)
);

CREATE INDEX IF NOT EXISTS idx_marks_lot_registry_lot_number
    ON devdb.marks_lot_registry (lot_number);
