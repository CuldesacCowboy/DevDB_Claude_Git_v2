-- 015_phase_boundaries.sql
-- Creates sim_phase_boundaries table for site plan phase subdivision.
-- Each row is a polygon region on a site plan, optionally linked to a sim_dev_phases record.

CREATE TABLE IF NOT EXISTS devdb.sim_phase_boundaries (
    boundary_id   BIGSERIAL PRIMARY KEY,
    plan_id       BIGINT NOT NULL,
    phase_id      BIGINT,           -- nullable; FK to sim_dev_phases when assigned
    polygon_json  TEXT NOT NULL,    -- JSON array of {x,y} normalized (0-1) coordinates
    label         TEXT,             -- display label; shown on the plan overlay
    split_order   INT NOT NULL DEFAULT 0,  -- auto-increments with each split operation
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
