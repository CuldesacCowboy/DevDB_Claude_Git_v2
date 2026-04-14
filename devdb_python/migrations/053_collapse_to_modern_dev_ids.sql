-- Migration 053: Collapse to modern dev_id space
-- Replace all legacy dim_development.development_id values in simulation tables
-- with the corresponding modern developments.dev_id, then add FK constraints.
--
-- Bridge: dim_development.dev_code2 = developments.marks_code
-- The 5 legacy devs with no modern match (IDs 69, 111-113, 119) have zero rows
-- in any sim table, so no data loss occurs.
--
-- After this migration:
--   - sim_legal_instruments.dev_id → developments.dev_id (FK enforced)
--   - sim_dev_phases.dev_id        → developments.dev_id (FK enforced)
--   - sim_lots.dev_id              → developments.dev_id (FK enforced)
--   - sim_dev_params.dev_id        → developments.dev_id (FK enforced)
--   - sim_ent_group_developments.dev_id → developments.dev_id (FK enforced)
--
-- dim_development stays as a historical reference table; it is no longer
-- operationally required for any join in the application layer.

BEGIN;

SET search_path = devdb;

-- Build the mapping: legacy_id → modern_id
-- Primary: match via dev_code2 = marks_code (standard bridge).
-- Fallback: match via development_name for rows where dev_code2 is empty/null
--   (e.g. Schuring: legacy 95 → modern 90).
CREATE TEMP TABLE _dev_id_map AS
SELECT dd.development_id AS legacy_id, d.dev_id AS modern_id
FROM dim_development dd
JOIN developments d ON d.marks_code = dd.dev_code2
WHERE dd.development_id != d.dev_id

UNION

SELECT dd.development_id AS legacy_id, d.dev_id AS modern_id
FROM dim_development dd
JOIN developments d ON LOWER(d.dev_name) = LOWER(dd.development_name)
WHERE (dd.dev_code2 IS NULL OR dd.dev_code2 = '')
  AND dd.development_id != d.dev_id;

-- Remap sim_legal_instruments
UPDATE sim_legal_instruments sli
SET dev_id = m.modern_id
FROM _dev_id_map m
WHERE sli.dev_id = m.legacy_id;

-- Remap sim_dev_phases
UPDATE sim_dev_phases sdp
SET dev_id = m.modern_id
FROM _dev_id_map m
WHERE sdp.dev_id = m.legacy_id;

-- Remap sim_lots
UPDATE sim_lots sl
SET dev_id = m.modern_id
FROM _dev_id_map m
WHERE sl.dev_id = m.legacy_id;

-- Remap sim_dev_params
UPDATE sim_dev_params sdpar
SET dev_id = m.modern_id
FROM _dev_id_map m
WHERE sdpar.dev_id = m.legacy_id;

-- Remap sim_ent_group_developments
UPDATE sim_ent_group_developments segd
SET dev_id = m.modern_id
FROM _dev_id_map m
WHERE segd.dev_id = m.legacy_id;

-- Add FK constraints (with names so they can be dropped by name if ever needed)
ALTER TABLE sim_legal_instruments
    ADD CONSTRAINT fk_sli_dev_id
    FOREIGN KEY (dev_id) REFERENCES developments(dev_id);

ALTER TABLE sim_dev_phases
    ADD CONSTRAINT fk_sdp_dev_id
    FOREIGN KEY (dev_id) REFERENCES developments(dev_id);

ALTER TABLE sim_lots
    ADD CONSTRAINT fk_sl_dev_id
    FOREIGN KEY (dev_id) REFERENCES developments(dev_id);

ALTER TABLE sim_dev_params
    ADD CONSTRAINT fk_sdpar_dev_id
    FOREIGN KEY (dev_id) REFERENCES developments(dev_id);

ALTER TABLE sim_ent_group_developments
    ADD CONSTRAINT fk_segd_dev_id
    FOREIGN KEY (dev_id) REFERENCES developments(dev_id);

COMMIT;
