-- 031_global_settings.sql
-- Global simulation settings: build times, inventory floors, delivery defaults.
-- Single-row table (id=1 always). Community delivery config overrides where non-null.

CREATE TABLE IF NOT EXISTS devdb.sim_global_settings (
    id                      INTEGER PRIMARY KEY DEFAULT 1,
    delivery_months         INTEGER[],
    max_deliveries_per_year INTEGER  DEFAULT 1,
    default_cmp_lag_days    INTEGER  DEFAULT 270,
    default_cls_lag_days    INTEGER  DEFAULT 45,
    min_d_count             INTEGER,
    min_u_count             INTEGER,
    min_uc_count            INTEGER,
    min_c_count             INTEGER,
    updated_at              TIMESTAMPTZ DEFAULT NOW()
);

INSERT INTO devdb.sim_global_settings (id, default_cmp_lag_days, default_cls_lag_days, max_deliveries_per_year)
VALUES (1, 270, 45, 1)
ON CONFLICT DO NOTHING;
