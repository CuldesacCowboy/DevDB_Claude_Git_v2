-- Migration 010: No DDL change
-- Records the addition of two new FastAPI endpoints:
--   DELETE /phases/{phase_id}/lot-type/{lot_type_id}
--   DELETE /phases/{phase_id}
-- No schema changes. Applied automatically by api/main.py on startup.
SELECT 1;
