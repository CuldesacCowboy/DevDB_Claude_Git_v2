-- 014_site_plans_scope_to_ent_group.sql
-- Rescope sim_site_plans from dev_id to ent_group_id.
-- Table was created in 013 and has no production data yet -- safe to recreate.

DROP TABLE IF EXISTS devdb.sim_site_plans;

CREATE TABLE devdb.sim_site_plans (
    plan_id       BIGSERIAL PRIMARY KEY,
    ent_group_id  BIGINT NOT NULL,
    file_path     TEXT NOT NULL,
    page_count    INT NOT NULL DEFAULT 1,
    active_page   INT NOT NULL DEFAULT 1,
    parcel_json   TEXT,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
