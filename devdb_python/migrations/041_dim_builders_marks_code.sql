-- 041_dim_builders_marks_code.sql
-- Add marks_company_code to dim_builders.
--
-- MARKS housemaster COMPANYCODE -> DevDB builder_id mapping:
--   001 -> JTB Homes (188)
--   050 -> Interra Homes (189)
--
-- This column is the join key used by import_housemaster_builder.py to
-- apply lot-level builder data from housemaster.csv into sim_lots.builder_id.

ALTER TABLE devdb.dim_builders
    ADD COLUMN IF NOT EXISTS marks_company_code VARCHAR(10);

UPDATE devdb.dim_builders SET marks_company_code = '001' WHERE builder_id = 188;
UPDATE devdb.dim_builders SET marks_company_code = '050' WHERE builder_id = 189;
