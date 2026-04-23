-- 083_fdw_type_casts.sql
-- No-op: type cast fixes handled in Python code (S-0050, instruments router).
--
-- marks_mirror stores housenumber as VARCHAR(8) zero-padded (e.g. '00000123')
-- whereas DevDB's old local tables had housenumber as INTEGER.
-- Rather than ALTER FOREIGN TABLE (which fails on empty-string rows),
-- the engine and API queries were updated to use LPAD() text comparison
-- instead of CAST(... AS INT).
SELECT 1;
