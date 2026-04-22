-- Migration 079: Fix Seneca Ridge marks_code from SR to SN.
-- SR belongs to Spring Ridge; Seneca Ridge lots use the SN dev code prefix.
UPDATE developments SET marks_code = 'SN' WHERE dev_id = 27 AND marks_code = 'SR';
UPDATE dim_development SET dev_code2 = 'SN'
WHERE dev_code2 = 'SR' AND development_name ILIKE '%seneca%';
