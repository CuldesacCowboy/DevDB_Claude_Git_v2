-- Migration 090: Ephemeral projection tables
-- sim_projections: one row per projection (base run or scenario run)
-- sim_projection_lots: sim lots belonging to a projection, mirrors sim_lots columns
--
-- This replaces the pattern of writing sim lots into sim_lots (lot_source='sim').
-- Multiple projections coexist: one current base + N scenario projections.

CREATE TABLE IF NOT EXISTS sim_projections (
    projection_id   SERIAL PRIMARY KEY,
    ent_group_id    INT NOT NULL,
    projection_type TEXT NOT NULL CHECK (projection_type IN ('base', 'scenario')),
    scenario_id     INT REFERENCES sim_scenarios(scenario_id) ON DELETE CASCADE,
    sim_run_id      INT,
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    is_current      BOOLEAN DEFAULT FALSE
);

-- Only one "current" base projection per ent_group
CREATE UNIQUE INDEX IF NOT EXISTS idx_proj_current_base
    ON sim_projections(ent_group_id)
    WHERE projection_type = 'base' AND is_current = TRUE;

CREATE TABLE IF NOT EXISTS sim_projection_lots (
    projection_lot_id BIGSERIAL PRIMARY KEY,
    projection_id     INT NOT NULL REFERENCES sim_projections(projection_id) ON DELETE CASCADE,
    dev_id            INT,
    phase_id          INT,
    lot_type_id       INT,
    building_group_id INT,
    sim_run_id        INT,
    builder_id        INT,
    is_spec           BOOLEAN,
    is_spec_source    TEXT,
    date_ent          DATE,
    date_dev          DATE,
    date_td_hold      DATE,
    date_td           DATE,
    date_str          DATE,
    date_cmp          DATE,
    date_cls          DATE,
    date_str_source   TEXT,
    date_cmp_source   TEXT,
    date_cls_source   TEXT,
    excluded          BOOLEAN DEFAULT FALSE
);

CREATE INDEX IF NOT EXISTS idx_proj_lots_proj ON sim_projection_lots(projection_id);
CREATE INDEX IF NOT EXISTS idx_proj_lots_dev ON sim_projection_lots(dev_id);
CREATE INDEX IF NOT EXISTS idx_proj_lots_dev_proj ON sim_projection_lots(dev_id, projection_id);
CREATE INDEX IF NOT EXISTS idx_proj_lots_phase ON sim_projection_lots(phase_id);
