-- Migration 017: sim_dev_params (replaces sim_projection_params at dev grain)
-- and sim_build_lag_curves (empirical percentile curves from real MARKsystems data).
--
-- Decision: projection group layer retired. Hierarchy is now:
--   entitlement group -> development -> legal instrument -> phase -> lot.
-- sim_projection_params is NOT dropped — retained as a historical reference.

-- ── 1. sim_dev_params ────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS devdb.sim_dev_params (
    dev_id               INT          PRIMARY KEY REFERENCES devdb.developments(dev_id),
    annual_starts_target INT,
    max_starts_per_month INT,
    seasonal_weight_set  TEXT         NOT NULL DEFAULT 'balanced_2yr',
    updated_at           TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_by           TEXT
);

-- Migrate from sim_projection_params (aggregate to dev grain via dim_projection_groups).
-- annual_starts_target = SUM across PGs so combined dev pace is preserved.
INSERT INTO devdb.sim_dev_params
    (dev_id, annual_starts_target, max_starts_per_month, seasonal_weight_set, updated_at)
SELECT
    dpg.dev_id,
    SUM(spp.annual_starts_target)::int          AS annual_starts_target,
    MAX(spp.max_starts_per_month)::int          AS max_starts_per_month,
    COALESCE(MAX(spp.seasonal_weight_set), 'balanced_2yr') AS seasonal_weight_set,
    MAX(spp.updated_at)                         AS updated_at
FROM devdb.sim_projection_params spp
JOIN devdb.dim_projection_groups dpg ON dpg.projection_group_id = spp.projection_group_id
GROUP BY dpg.dev_id
ON CONFLICT (dev_id) DO UPDATE SET
    annual_starts_target = EXCLUDED.annual_starts_target,
    max_starts_per_month = EXCLUDED.max_starts_per_month,
    seasonal_weight_set  = EXCLUDED.seasonal_weight_set,
    updated_at           = EXCLUDED.updated_at;

-- ── 2. sim_build_lag_curves ──────────────────────────────────────────────────
-- Percentile-based empirical curves derived from real MARKsystems lots.
-- lag_type:    'str_to_cmp' or 'cmp_to_cls'
-- lot_type_id: NULL = default fallback (used when no lot-type-specific curve found)
-- Percentiles in calendar days.

CREATE TABLE IF NOT EXISTS devdb.sim_build_lag_curves (
    curve_id     SERIAL       PRIMARY KEY,
    curve_name   TEXT         NOT NULL,
    lag_type     TEXT         NOT NULL CHECK (lag_type IN ('str_to_cmp', 'cmp_to_cls')),
    lot_type_id  INT          REFERENCES devdb.ref_lot_types(lot_type_id),
    p10          INT          NOT NULL,
    p25          INT          NOT NULL,
    p50          INT          NOT NULL,
    p75          INT          NOT NULL,
    p90          INT          NOT NULL,
    sample_count INT,
    notes        TEXT,
    created_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    UNIQUE (lag_type, lot_type_id)
);

-- Seed: STR→CMP curves (construction duration)
-- SF (lot_type_id=101): derived from 28 real SF lots
--   p10=142, p25=150, p50=166, p75=183, p90=198, avg=168 days
INSERT INTO devdb.sim_build_lag_curves
    (curve_name, lag_type, lot_type_id, p10, p25, p50, p75, p90, sample_count, notes)
VALUES
    ('sf_str_to_cmp', 'str_to_cmp', 101, 142, 150, 166, 183, 198, 28,
     'Derived from 28 real SF lots in sim_lots'),
    -- CD (lot_type_id=111): derived from 33 real condo lots
    -- p10=140, p25=145, p50=162, p75=183, p90=191, avg=165 days
    ('cd_str_to_cmp', 'str_to_cmp', 111, 140, 145, 162, 183, 191, 33,
     'Derived from 33 real condo lots in sim_lots'),
    -- Default fallback STR→CMP (average of SF and CD distributions)
    ('default_str_to_cmp', 'str_to_cmp', NULL, 141, 148, 164, 183, 195, NULL,
     'Default fallback — average of SF and CD empirical curves')
ON CONFLICT (lag_type, lot_type_id) DO NOTHING;

-- Seed: CMP→CLS curves (completion to closing)
-- SF (lot_type_id=101): derived from 28 real SF lots
--   avg=47d, p50=31d, p90=110d, min=1d, max=175d (right-skewed; pre-sold spec)
--   p10 and p25 estimated from distribution shape
INSERT INTO devdb.sim_build_lag_curves
    (curve_name, lag_type, lot_type_id, p10, p25, p50, p75, p90, sample_count, notes)
VALUES
    ('sf_cmp_to_cls', 'cmp_to_cls', 101, 6, 15, 31, 68, 110, 28,
     'Derived from 28 real SF lots. Right-skewed: most pre-sold, some linger.'),
    -- CD (lot_type_id=111): derived from 33 real condo lots
    -- avg=125d, p50=104d, p90=260d, min=2d, max=485d (very wide — unit inventory)
    ('cd_cmp_to_cls', 'cmp_to_cls', 111, 12, 45, 104, 178, 260, 33,
     'Derived from 33 real condo lots. Wide spread: unit-by-unit absorption.'),
    -- Default fallback CMP→CLS
    ('default_cmp_to_cls', 'cmp_to_cls', NULL, 8, 20, 45, 90, 150, NULL,
     'Default fallback — conservative mid-point between SF and CD close patterns')
ON CONFLICT (lag_type, lot_type_id) DO NOTHING;
