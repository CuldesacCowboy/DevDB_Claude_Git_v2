-- 013_site_plans.sql
-- Creates sim_site_plans table for the site plan viewer module.
-- One plan per development (enforced by the API, not a DB constraint).

CREATE TABLE IF NOT EXISTS devdb.sim_site_plans (
    plan_id     BIGSERIAL PRIMARY KEY,
    dev_id      BIGINT NOT NULL,
    file_path   TEXT NOT NULL,
    page_count  INT NOT NULL DEFAULT 1,
    active_page INT NOT NULL DEFAULT 1,
    parcel_json TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
