-- 001_baseline.sql
-- Full schema baseline reconstructed from live database 2026-03-27.
-- Covers all DDL applied prior to the migration discipline system.
-- Safe to re-run: all statements use IF NOT EXISTS guards.
-- Schema: devdb

-- ============================================================
-- SEQUENCES
-- ============================================================

CREATE SEQUENCE IF NOT EXISTS devdb.developments_dev_id_seq
    START WITH 1 INCREMENT BY 1 NO MINVALUE NO MAXVALUE CACHE 1;

CREATE SEQUENCE IF NOT EXISTS devdb.sim_phase_product_splits_split_id_seq
    START WITH 1 INCREMENT BY 1 NO MINVALUE NO MAXVALUE CACHE 1;

-- ============================================================
-- INDEPENDENT DIMENSION / REFERENCE TABLES
-- (no foreign key dependencies)
-- ============================================================

CREATE TABLE IF NOT EXISTS devdb.dim_state (
    state_id    BIGINT NOT NULL,
    state_name  TEXT,
    state_abbr  TEXT,
    active      BOOLEAN
);

CREATE TABLE IF NOT EXISTS devdb.dim_county (
    county_id   BIGINT NOT NULL,
    state_id    BIGINT,
    county_name TEXT,
    active      BOOLEAN
);

CREATE TABLE IF NOT EXISTS devdb.dim_municipality (
    municipality_id   BIGINT NOT NULL,
    municipality_name TEXT,
    active            BOOLEAN
);

CREATE TABLE IF NOT EXISTS devdb.dim_builders (
    builder_id   BIGINT,
    builder_name TEXT,
    active       BOOLEAN
);

CREATE TABLE IF NOT EXISTS devdb.dim_projection_status (
    projection_status_id    BIGINT,
    projection_status_name  TEXT,
    projection_status_short TEXT
);

CREATE TABLE IF NOT EXISTS devdb.dim_internal_external (
    internal_external_id    BIGINT,
    internal_external_name  TEXT,
    internal_external_short TEXT
);

CREATE TABLE IF NOT EXISTS devdb.dim_school_district (
    school_district_id      BIGINT,
    school_district_name    TEXT,
    school_district_code    TEXT,
    school_district_quality TEXT,
    active                  BOOLEAN
);

CREATE TABLE IF NOT EXISTS devdb.dim_development (
    development_id              BIGINT,
    municipality_id             DOUBLE PRECISION,
    county_id                   BIGINT,
    development_name            TEXT,
    development_name_marketing  TEXT,
    dev_code                    TEXT,
    dev_code2                   TEXT,
    dev_source                  TEXT,
    active                      BOOLEAN
);

CREATE TABLE IF NOT EXISTS devdb.ref_lot_types (
    lot_type_id         INTEGER NOT NULL,
    lot_type_name       TEXT,
    lot_type_short      TEXT,
    proj_lot_type_group_id INTEGER,
    lot_type_group_id   INTEGER,
    units_per_building  INTEGER,
    active              BOOLEAN
);

CREATE TABLE IF NOT EXISTS devdb.month_spine (
    calendar_month DATE
);

CREATE TABLE IF NOT EXISTS devdb.schedhousedetail (
    developmentcode   TEXT,
    housenumber       INTEGER,
    activitycode      TEXT,
    actualfinishdate  DATE,
    rvearlyfinshdate  DATE,
    earlyfinishdate   DATE,
    inactive          TEXT
);

-- ============================================================
-- CORE ENTITLEMENT / PROJECTION TABLES
-- ============================================================

CREATE TABLE IF NOT EXISTS devdb.sim_entitlement_groups (
    ent_group_id         BIGINT NOT NULL,
    ent_group_name       TEXT,
    date_ent_actual      DATE,
    date_ent_projected   DATE,
    lot_count_authorized INTEGER,
    notes                TEXT,
    created_at           TIMESTAMPTZ,
    updated_at           TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS devdb.dim_projection_groups (
    projection_group_id BIGINT NOT NULL,
    dev_id              INTEGER NOT NULL,
    lot_type_id         INTEGER NOT NULL,
    county_id           INTEGER NOT NULL,
    school_district_id  INTEGER NOT NULL,
    needs_rerun         BOOLEAN,
    created_at          TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS devdb.sim_legal_instruments (
    instrument_id   BIGINT NOT NULL,
    dev_id          INTEGER NOT NULL,
    instrument_name TEXT,
    instrument_type TEXT,
    recorded_date   DATE,
    notes           TEXT,
    created_at      TIMESTAMPTZ,
    updated_at      TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS devdb.sim_building_groups (
    building_group_id BIGINT NOT NULL,
    dev_id            INTEGER NOT NULL,
    building_name     TEXT,
    building_type     TEXT,
    unit_count        INTEGER,
    notes             TEXT,
    created_at        TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS devdb.sim_takedown_agreements (
    tda_id               BIGINT NOT NULL,
    tda_name             TEXT,
    agreement_date       DATE,
    anchor_type          TEXT,
    anchor_date          DATE,
    status               TEXT,
    checkpoint_lead_days INTEGER,
    notes                TEXT,
    created_at           TIMESTAMPTZ,
    updated_at           TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS devdb.sync_orphaned_lots (
    orphan_id      BIGINT NOT NULL,
    developmentcode TEXT,
    housenumber    INTEGER,
    derived_key    TEXT,
    status         TEXT,
    first_seen_at  TIMESTAMPTZ,
    sync_count     INTEGER,
    flagged        BOOLEAN,
    resolved_at    TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS devdb.sim_lot_date_violations (
    violation_id     BIGINT NOT NULL,
    sim_run_id       BIGINT NOT NULL,
    lot_id           BIGINT NOT NULL,
    violation_type   TEXT,
    date_field_early TEXT,
    date_value_early DATE,
    date_field_late  TEXT,
    date_value_late  DATE,
    resolution       TEXT,
    created_at       TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS devdb.sim_runs (
    sim_run_id          BIGINT NOT NULL,
    projection_group_id BIGINT NOT NULL,
    run_timestamp       TIMESTAMPTZ,
    run_by              TEXT,
    params_json         TEXT,
    status              TEXT,
    notes               TEXT
);

-- sim_assignment_log uses IDENTITY (applied by create_sim_assignment_log.py)
CREATE TABLE IF NOT EXISTS devdb.sim_assignment_log (
    log_id        BIGINT GENERATED ALWAYS AS IDENTITY,
    action        TEXT NOT NULL,
    resource_type TEXT NOT NULL,
    resource_id   BIGINT NOT NULL,
    from_owner_id BIGINT NOT NULL,
    to_owner_id   BIGINT NOT NULL,
    changed_by    TEXT NOT NULL,
    changed_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    metadata      JSONB
);

-- ============================================================
-- TABLES DEPENDENT ON sim_entitlement_groups
-- ============================================================

CREATE TABLE IF NOT EXISTS devdb.sim_ent_group_developments (
    id           BIGINT NOT NULL,
    ent_group_id BIGINT NOT NULL,
    dev_id       INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS devdb.sim_entitlement_delivery_config (
    ent_group_id           BIGINT NOT NULL,
    max_deliveries_per_year INTEGER,
    min_gap_months          INTEGER,
    auto_schedule_enabled   BOOLEAN,
    updated_at              TIMESTAMPTZ,
    updated_by              TEXT,
    delivery_window_start   INTEGER,
    delivery_window_end     INTEGER
);

CREATE TABLE IF NOT EXISTS devdb.sim_delivery_events (
    delivery_event_id          BIGINT NOT NULL,
    ent_group_id               BIGINT NOT NULL,
    event_name                 TEXT,
    predecessor_type           TEXT,
    delivery_window_start      INTEGER,
    delivery_window_end        INTEGER,
    date_dev_actual            DATE,
    date_dev_projected         DATE,
    is_auto_created            BOOLEAN,
    is_placeholder             BOOLEAN,
    placeholder_cadence_months INTEGER,
    notes                      TEXT,
    created_at                 TIMESTAMPTZ,
    updated_at                 TIMESTAMPTZ
);

-- ============================================================
-- TABLES DEPENDENT ON sim_legal_instruments
-- ============================================================

CREATE TABLE IF NOT EXISTS devdb.sim_dev_phases (
    phase_id              BIGINT NOT NULL,
    instrument_id         BIGINT,
    dev_id                INTEGER NOT NULL,
    source_dvp_id         INTEGER,
    phase_name            TEXT,
    sequence_number       INTEGER,
    lot_count_projected   INTEGER,
    date_dev_demand_derived DATE,
    date_dev_projected    DATE,
    developer_override    INTEGER,
    inex_override         INTEGER,
    notes                 TEXT,
    created_at            TIMESTAMPTZ,
    updated_at            TIMESTAMPTZ,
    display_order         INTEGER
);

-- ============================================================
-- TABLES DEPENDENT ON ref_lot_types
-- ============================================================

CREATE TABLE IF NOT EXISTS devdb.sim_dev_defaults (
    dev_id             INTEGER NOT NULL,
    default_lot_type_id INTEGER,
    default_county_id  INTEGER,
    default_school_id  INTEGER
);

-- ============================================================
-- TABLES DEPENDENT ON dim_projection_groups
-- ============================================================

CREATE TABLE IF NOT EXISTS devdb.sim_projection_actuals (
    actual_id           BIGINT NOT NULL,
    projection_group_id BIGINT NOT NULL,
    builder_id          INTEGER,
    actual_year         INTEGER,
    actual_month        INTEGER,
    actual_starts       INTEGER,
    actual_closings     INTEGER,
    updated_at          TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS devdb.sim_projection_params (
    projection_group_id    BIGINT NOT NULL,
    annual_starts_target   INTEGER,
    max_starts_per_month   INTEGER,
    seasonal_weight_set    TEXT,
    custom_weights_json    TEXT,
    str_to_cmp_curve_id    INTEGER,
    cmp_to_cls_curve_id    INTEGER,
    updated_at             TIMESTAMPTZ,
    updated_by             TEXT
);

CREATE TABLE IF NOT EXISTS devdb.sim_snapshots (
    snapshot_id         BIGINT NOT NULL,
    projection_group_id BIGINT NOT NULL,
    snapshot_name       TEXT,
    snapshot_type       TEXT,
    snapshot_date       DATE,
    notes               TEXT,
    created_by          TEXT,
    created_at          TIMESTAMPTZ,
    params_json         TEXT,
    ledger_json         TEXT
);

-- ============================================================
-- TABLES DEPENDENT ON sim_delivery_events + sim_dev_phases
-- ============================================================

CREATE TABLE IF NOT EXISTS devdb.sim_delivery_event_phases (
    id                BIGINT NOT NULL,
    delivery_event_id BIGINT NOT NULL,
    phase_id          BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS devdb.sim_delivery_event_predecessors (
    id                   BIGINT NOT NULL,
    event_id             BIGINT NOT NULL,
    predecessor_event_id BIGINT NOT NULL
);

-- ============================================================
-- TABLES DEPENDENT ON ref_lot_types + sim_dev_phases + dim_projection_groups
-- ============================================================

CREATE TABLE IF NOT EXISTS devdb.sim_lots (
    lot_id              BIGINT NOT NULL,
    projection_group_id BIGINT NOT NULL,
    phase_id            BIGINT,
    builder_id          INTEGER,
    lot_source          TEXT NOT NULL,
    lot_number          TEXT,
    sim_run_id          BIGINT,
    lot_type_id         INTEGER NOT NULL,
    building_group_id   BIGINT,
    date_ent            DATE,
    date_dev            DATE,
    date_td             DATE,
    date_td_hold        DATE,
    date_str            DATE,
    date_str_source     TEXT,
    date_frm            DATE,
    date_cmp            DATE,
    date_cmp_source     TEXT,
    date_cls            DATE,
    date_cls_source     TEXT,
    created_at          TIMESTAMPTZ,
    updated_at          TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS devdb.sim_phase_builder_splits (
    split_id  BIGINT NOT NULL,
    phase_id  BIGINT NOT NULL,
    builder_id INTEGER,
    share     NUMERIC
);

CREATE TABLE IF NOT EXISTS devdb.sim_phase_product_splits (
    split_id    BIGINT NOT NULL DEFAULT nextval('devdb.sim_phase_product_splits_split_id_seq'),
    phase_id    BIGINT NOT NULL,
    lot_type_id INTEGER NOT NULL,
    lot_count   INTEGER
);

-- ============================================================
-- TABLES DEPENDENT ON sim_takedown_agreements
-- ============================================================

CREATE TABLE IF NOT EXISTS devdb.sim_takedown_agreement_lots (
    id     BIGINT NOT NULL,
    tda_id BIGINT NOT NULL,
    lot_id BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS devdb.sim_takedown_checkpoints (
    checkpoint_id             BIGINT NOT NULL,
    tda_id                    BIGINT NOT NULL,
    checkpoint_number         INTEGER,
    lots_required_cumulative  INTEGER,
    days_offset_from_anchor   INTEGER,
    anchor_date_ref           DATE,
    checkpoint_date           DATE,
    notes                     TEXT
);

-- ============================================================
-- TABLES DEPENDENT ON sim_takedown_checkpoints
-- ============================================================

CREATE TABLE IF NOT EXISTS devdb.sim_takedown_lot_assignments (
    assignment_id BIGINT NOT NULL,
    checkpoint_id BIGINT NOT NULL,
    lot_id        BIGINT NOT NULL,
    assigned_at   TIMESTAMPTZ
);

-- ============================================================
-- TABLES DEPENDENT ON sim_snapshots
-- ============================================================

CREATE TABLE IF NOT EXISTS devdb.sim_snapshot_lots (
    snapshot_lot_id     BIGINT NOT NULL,
    snapshot_id         BIGINT NOT NULL,
    lot_id              BIGINT,
    projection_group_id BIGINT,
    phase_id            BIGINT,
    builder_id          INTEGER,
    lot_source          TEXT,
    lot_number          TEXT,
    sim_run_id          BIGINT,
    lot_type_id         INTEGER,
    building_group_id   BIGINT,
    date_ent            DATE,
    date_dev            DATE,
    date_td             DATE,
    date_td_hold        DATE,
    date_str            DATE,
    date_str_source     TEXT,
    date_frm            DATE,
    date_cmp            DATE,
    date_cmp_source     TEXT,
    date_cls            DATE,
    date_cls_source     TEXT,
    created_at          TIMESTAMPTZ,
    updated_at          TIMESTAMPTZ
);

-- ============================================================
-- developments TABLE
-- (added post-Databricks migration, depends on dim_county/state/municipality/sim_entitlement_groups)
-- ============================================================

CREATE TABLE IF NOT EXISTS devdb.developments (
    dev_id          INTEGER NOT NULL DEFAULT nextval('devdb.developments_dev_id_seq'),
    dev_name        TEXT NOT NULL,
    marks_code      CHAR(2),
    in_marks        BOOLEAN NOT NULL DEFAULT false,
    county_id       BIGINT,
    state_id        BIGINT,
    municipality_id BIGINT,
    community_id    BIGINT,
    created_at      TIMESTAMP DEFAULT now(),
    updated_at      TIMESTAMP DEFAULT now()
);

-- ============================================================
-- PRIMARY KEY CONSTRAINTS
-- (ALTER TABLE ... ADD CONSTRAINT IF NOT EXISTS requires PG 9.5+)
-- ============================================================

DO $$ BEGIN
    ALTER TABLE devdb.dim_state ADD CONSTRAINT dim_state_pkey PRIMARY KEY (state_id);
EXCEPTION WHEN duplicate_table OR duplicate_object OR invalid_table_definition THEN NULL; END $$;

DO $$ BEGIN
    ALTER TABLE devdb.dim_county ADD CONSTRAINT dim_county_pkey PRIMARY KEY (county_id);
EXCEPTION WHEN duplicate_table OR duplicate_object OR invalid_table_definition THEN NULL; END $$;

DO $$ BEGIN
    ALTER TABLE devdb.dim_municipality ADD CONSTRAINT dim_municipality_pkey PRIMARY KEY (municipality_id);
EXCEPTION WHEN duplicate_table OR duplicate_object OR invalid_table_definition THEN NULL; END $$;

DO $$ BEGIN
    ALTER TABLE devdb.ref_lot_types ADD CONSTRAINT pk_ref_lot_types PRIMARY KEY (lot_type_id);
EXCEPTION WHEN duplicate_table OR duplicate_object OR invalid_table_definition THEN NULL; END $$;

DO $$ BEGIN
    ALTER TABLE devdb.sim_entitlement_groups ADD CONSTRAINT pk_sim_entitlement_groups PRIMARY KEY (ent_group_id);
EXCEPTION WHEN duplicate_table OR duplicate_object OR invalid_table_definition THEN NULL; END $$;

DO $$ BEGIN
    ALTER TABLE devdb.dim_projection_groups ADD CONSTRAINT pk_dim_projection_groups PRIMARY KEY (projection_group_id);
EXCEPTION WHEN duplicate_table OR duplicate_object OR invalid_table_definition THEN NULL; END $$;

DO $$ BEGIN
    ALTER TABLE devdb.sim_legal_instruments ADD CONSTRAINT pk_sim_legal_instruments PRIMARY KEY (instrument_id);
EXCEPTION WHEN duplicate_table OR duplicate_object OR invalid_table_definition THEN NULL; END $$;

DO $$ BEGIN
    ALTER TABLE devdb.sim_building_groups ADD CONSTRAINT pk_sim_building_groups PRIMARY KEY (building_group_id);
EXCEPTION WHEN duplicate_table OR duplicate_object OR invalid_table_definition THEN NULL; END $$;

DO $$ BEGIN
    ALTER TABLE devdb.sim_takedown_agreements ADD CONSTRAINT pk_sim_takedown_agreements PRIMARY KEY (tda_id);
EXCEPTION WHEN duplicate_table OR duplicate_object OR invalid_table_definition THEN NULL; END $$;

DO $$ BEGIN
    ALTER TABLE devdb.sync_orphaned_lots ADD CONSTRAINT pk_sync_orphaned_lots PRIMARY KEY (orphan_id);
EXCEPTION WHEN duplicate_table OR duplicate_object OR invalid_table_definition THEN NULL; END $$;

DO $$ BEGIN
    ALTER TABLE devdb.sim_lot_date_violations ADD CONSTRAINT pk_sim_lot_date_violations PRIMARY KEY (violation_id);
EXCEPTION WHEN duplicate_table OR duplicate_object OR invalid_table_definition THEN NULL; END $$;

DO $$ BEGIN
    ALTER TABLE devdb.sim_runs ADD CONSTRAINT pk_sim_runs PRIMARY KEY (sim_run_id);
EXCEPTION WHEN duplicate_table OR duplicate_object OR invalid_table_definition THEN NULL; END $$;

DO $$ BEGIN
    ALTER TABLE devdb.sim_assignment_log ADD CONSTRAINT sim_assignment_log_pkey PRIMARY KEY (log_id);
EXCEPTION WHEN duplicate_table OR duplicate_object OR invalid_table_definition THEN NULL; END $$;

DO $$ BEGIN
    ALTER TABLE devdb.sim_ent_group_developments ADD CONSTRAINT pk_sim_ent_group_developments PRIMARY KEY (id);
EXCEPTION WHEN duplicate_table OR duplicate_object OR invalid_table_definition THEN NULL; END $$;

DO $$ BEGIN
    ALTER TABLE devdb.sim_entitlement_delivery_config ADD CONSTRAINT pk_sim_entitlement_delivery_config PRIMARY KEY (ent_group_id);
EXCEPTION WHEN duplicate_table OR duplicate_object OR invalid_table_definition THEN NULL; END $$;

DO $$ BEGIN
    ALTER TABLE devdb.sim_delivery_events ADD CONSTRAINT pk_sim_delivery_events PRIMARY KEY (delivery_event_id);
EXCEPTION WHEN duplicate_table OR duplicate_object OR invalid_table_definition THEN NULL; END $$;

DO $$ BEGIN
    ALTER TABLE devdb.sim_dev_phases ADD CONSTRAINT pk_sim_dev_phases PRIMARY KEY (phase_id);
EXCEPTION WHEN duplicate_table OR duplicate_object OR invalid_table_definition THEN NULL; END $$;

DO $$ BEGIN
    ALTER TABLE devdb.sim_dev_defaults ADD CONSTRAINT pk_sim_dev_defaults PRIMARY KEY (dev_id);
EXCEPTION WHEN duplicate_table OR duplicate_object OR invalid_table_definition THEN NULL; END $$;

DO $$ BEGIN
    ALTER TABLE devdb.sim_projection_actuals ADD CONSTRAINT pk_sim_projection_actuals PRIMARY KEY (actual_id);
EXCEPTION WHEN duplicate_table OR duplicate_object OR invalid_table_definition THEN NULL; END $$;

DO $$ BEGIN
    ALTER TABLE devdb.sim_projection_params ADD CONSTRAINT pk_sim_projection_params PRIMARY KEY (projection_group_id);
EXCEPTION WHEN duplicate_table OR duplicate_object OR invalid_table_definition THEN NULL; END $$;

DO $$ BEGIN
    ALTER TABLE devdb.sim_snapshots ADD CONSTRAINT pk_sim_snapshots PRIMARY KEY (snapshot_id);
EXCEPTION WHEN duplicate_table OR duplicate_object OR invalid_table_definition THEN NULL; END $$;

DO $$ BEGIN
    ALTER TABLE devdb.sim_delivery_event_phases ADD CONSTRAINT pk_sim_delivery_event_phases PRIMARY KEY (id);
EXCEPTION WHEN duplicate_table OR duplicate_object OR invalid_table_definition THEN NULL; END $$;

DO $$ BEGIN
    ALTER TABLE devdb.sim_delivery_event_predecessors ADD CONSTRAINT pk_sim_delivery_event_predecessors PRIMARY KEY (id);
EXCEPTION WHEN duplicate_table OR duplicate_object OR invalid_table_definition THEN NULL; END $$;

DO $$ BEGIN
    ALTER TABLE devdb.sim_lots ADD CONSTRAINT pk_sim_lots PRIMARY KEY (lot_id);
EXCEPTION WHEN duplicate_table OR duplicate_object OR invalid_table_definition THEN NULL; END $$;

DO $$ BEGIN
    ALTER TABLE devdb.sim_phase_builder_splits ADD CONSTRAINT pk_sim_phase_builder_splits PRIMARY KEY (split_id);
EXCEPTION WHEN duplicate_table OR duplicate_object OR invalid_table_definition THEN NULL; END $$;

DO $$ BEGIN
    ALTER TABLE devdb.sim_phase_product_splits ADD CONSTRAINT pk_sim_phase_product_splits PRIMARY KEY (split_id);
EXCEPTION WHEN duplicate_table OR duplicate_object OR invalid_table_definition THEN NULL; END $$;

DO $$ BEGIN
    ALTER TABLE devdb.sim_takedown_agreement_lots ADD CONSTRAINT pk_sim_takedown_agreement_lots PRIMARY KEY (id);
EXCEPTION WHEN duplicate_table OR duplicate_object OR invalid_table_definition THEN NULL; END $$;

DO $$ BEGIN
    ALTER TABLE devdb.sim_takedown_checkpoints ADD CONSTRAINT pk_sim_takedown_checkpoints PRIMARY KEY (checkpoint_id);
EXCEPTION WHEN duplicate_table OR duplicate_object OR invalid_table_definition THEN NULL; END $$;

DO $$ BEGIN
    ALTER TABLE devdb.sim_takedown_lot_assignments ADD CONSTRAINT pk_sim_takedown_lot_assignments PRIMARY KEY (assignment_id);
EXCEPTION WHEN duplicate_table OR duplicate_object OR invalid_table_definition THEN NULL; END $$;

DO $$ BEGIN
    ALTER TABLE devdb.sim_snapshot_lots ADD CONSTRAINT pk_sim_snapshot_lots PRIMARY KEY (snapshot_lot_id);
EXCEPTION WHEN duplicate_table OR duplicate_object OR invalid_table_definition THEN NULL; END $$;

DO $$ BEGIN
    ALTER TABLE devdb.developments ADD CONSTRAINT developments_pkey PRIMARY KEY (dev_id);
EXCEPTION WHEN duplicate_table OR duplicate_object OR invalid_table_definition THEN NULL; END $$;

-- ============================================================
-- UNIQUE CONSTRAINTS
-- ============================================================

DO $$ BEGIN
    ALTER TABLE devdb.developments ADD CONSTRAINT developments_marks_code_unique UNIQUE (marks_code);
EXCEPTION WHEN duplicate_table OR duplicate_object OR invalid_table_definition THEN NULL; END $$;

DO $$ BEGIN
    ALTER TABLE devdb.sim_phase_product_splits
        ADD CONSTRAINT uq_sim_phase_product_splits_phase_lottype UNIQUE (phase_id, lot_type_id);
EXCEPTION WHEN duplicate_table OR duplicate_object OR invalid_table_definition THEN NULL; END $$;

-- ============================================================
-- FOREIGN KEY CONSTRAINTS
-- ============================================================

DO $$ BEGIN
    ALTER TABLE devdb.developments
        ADD CONSTRAINT developments_county_id_fkey FOREIGN KEY (county_id) REFERENCES devdb.dim_county(county_id);
EXCEPTION WHEN duplicate_table OR duplicate_object OR invalid_table_definition THEN NULL; END $$;

DO $$ BEGIN
    ALTER TABLE devdb.developments
        ADD CONSTRAINT developments_state_id_fkey FOREIGN KEY (state_id) REFERENCES devdb.dim_state(state_id);
EXCEPTION WHEN duplicate_table OR duplicate_object OR invalid_table_definition THEN NULL; END $$;

DO $$ BEGIN
    ALTER TABLE devdb.developments
        ADD CONSTRAINT developments_municipality_id_fkey FOREIGN KEY (municipality_id) REFERENCES devdb.dim_municipality(municipality_id);
EXCEPTION WHEN duplicate_table OR duplicate_object OR invalid_table_definition THEN NULL; END $$;

DO $$ BEGIN
    ALTER TABLE devdb.developments
        ADD CONSTRAINT developments_community_id_fkey FOREIGN KEY (community_id) REFERENCES devdb.sim_entitlement_groups(ent_group_id);
EXCEPTION WHEN duplicate_table OR duplicate_object OR invalid_table_definition THEN NULL; END $$;

DO $$ BEGIN
    ALTER TABLE devdb.sim_ent_group_developments
        ADD CONSTRAINT fk_sim_entgrpdev_ent_group FOREIGN KEY (ent_group_id) REFERENCES devdb.sim_entitlement_groups(ent_group_id);
EXCEPTION WHEN duplicate_table OR duplicate_object OR invalid_table_definition THEN NULL; END $$;

DO $$ BEGIN
    ALTER TABLE devdb.sim_entitlement_delivery_config
        ADD CONSTRAINT fk_sim_entdlvcfg_ent_group FOREIGN KEY (ent_group_id) REFERENCES devdb.sim_entitlement_groups(ent_group_id);
EXCEPTION WHEN duplicate_table OR duplicate_object OR invalid_table_definition THEN NULL; END $$;

DO $$ BEGIN
    ALTER TABLE devdb.sim_delivery_events
        ADD CONSTRAINT fk_sim_delivevt_ent_group FOREIGN KEY (ent_group_id) REFERENCES devdb.sim_entitlement_groups(ent_group_id);
EXCEPTION WHEN duplicate_table OR duplicate_object OR invalid_table_definition THEN NULL; END $$;

DO $$ BEGIN
    ALTER TABLE devdb.sim_dev_phases
        ADD CONSTRAINT fk_sim_devphase_instrument FOREIGN KEY (instrument_id) REFERENCES devdb.sim_legal_instruments(instrument_id);
EXCEPTION WHEN duplicate_table OR duplicate_object OR invalid_table_definition THEN NULL; END $$;

DO $$ BEGIN
    ALTER TABLE devdb.sim_dev_defaults
        ADD CONSTRAINT fk_sim_devdef_lot_type FOREIGN KEY (default_lot_type_id) REFERENCES devdb.ref_lot_types(lot_type_id);
EXCEPTION WHEN duplicate_table OR duplicate_object OR invalid_table_definition THEN NULL; END $$;

DO $$ BEGIN
    ALTER TABLE devdb.sim_runs
        ADD CONSTRAINT fk_sim_runs_proj_group FOREIGN KEY (projection_group_id) REFERENCES devdb.dim_projection_groups(projection_group_id);
EXCEPTION WHEN duplicate_table OR duplicate_object OR invalid_table_definition THEN NULL; END $$;

DO $$ BEGIN
    ALTER TABLE devdb.sim_projection_actuals
        ADD CONSTRAINT fk_sim_projactuals_proj_group FOREIGN KEY (projection_group_id) REFERENCES devdb.dim_projection_groups(projection_group_id);
EXCEPTION WHEN duplicate_table OR duplicate_object OR invalid_table_definition THEN NULL; END $$;

DO $$ BEGIN
    ALTER TABLE devdb.sim_projection_params
        ADD CONSTRAINT fk_sim_projparams_proj_group FOREIGN KEY (projection_group_id) REFERENCES devdb.dim_projection_groups(projection_group_id);
EXCEPTION WHEN duplicate_table OR duplicate_object OR invalid_table_definition THEN NULL; END $$;

DO $$ BEGIN
    ALTER TABLE devdb.sim_snapshots
        ADD CONSTRAINT fk_sim_snapshots_proj_group FOREIGN KEY (projection_group_id) REFERENCES devdb.dim_projection_groups(projection_group_id);
EXCEPTION WHEN duplicate_table OR duplicate_object OR invalid_table_definition THEN NULL; END $$;

DO $$ BEGIN
    ALTER TABLE devdb.sim_delivery_event_phases
        ADD CONSTRAINT fk_sim_delivevtphase_event FOREIGN KEY (delivery_event_id) REFERENCES devdb.sim_delivery_events(delivery_event_id);
EXCEPTION WHEN duplicate_table OR duplicate_object OR invalid_table_definition THEN NULL; END $$;

DO $$ BEGIN
    ALTER TABLE devdb.sim_delivery_event_phases
        ADD CONSTRAINT fk_sim_delivevtphase_phase FOREIGN KEY (phase_id) REFERENCES devdb.sim_dev_phases(phase_id);
EXCEPTION WHEN duplicate_table OR duplicate_object OR invalid_table_definition THEN NULL; END $$;

DO $$ BEGIN
    ALTER TABLE devdb.sim_delivery_event_predecessors
        ADD CONSTRAINT fk_sim_delivevtpred_event FOREIGN KEY (event_id) REFERENCES devdb.sim_delivery_events(delivery_event_id);
EXCEPTION WHEN duplicate_table OR duplicate_object OR invalid_table_definition THEN NULL; END $$;

DO $$ BEGIN
    ALTER TABLE devdb.sim_delivery_event_predecessors
        ADD CONSTRAINT fk_sim_delivevtpred_predecessor FOREIGN KEY (predecessor_event_id) REFERENCES devdb.sim_delivery_events(delivery_event_id);
EXCEPTION WHEN duplicate_table OR duplicate_object OR invalid_table_definition THEN NULL; END $$;

DO $$ BEGIN
    ALTER TABLE devdb.sim_lots
        ADD CONSTRAINT fk_sim_lots_projection_group FOREIGN KEY (projection_group_id) REFERENCES devdb.dim_projection_groups(projection_group_id);
EXCEPTION WHEN duplicate_table OR duplicate_object OR invalid_table_definition THEN NULL; END $$;

DO $$ BEGIN
    ALTER TABLE devdb.sim_lots
        ADD CONSTRAINT fk_sim_lots_phase FOREIGN KEY (phase_id) REFERENCES devdb.sim_dev_phases(phase_id);
EXCEPTION WHEN duplicate_table OR duplicate_object OR invalid_table_definition THEN NULL; END $$;

DO $$ BEGIN
    ALTER TABLE devdb.sim_lots
        ADD CONSTRAINT fk_sim_lots_lot_type FOREIGN KEY (lot_type_id) REFERENCES devdb.ref_lot_types(lot_type_id);
EXCEPTION WHEN duplicate_table OR duplicate_object OR invalid_table_definition THEN NULL; END $$;

DO $$ BEGIN
    ALTER TABLE devdb.sim_phase_builder_splits
        ADD CONSTRAINT fk_sim_phasebldr_phase FOREIGN KEY (phase_id) REFERENCES devdb.sim_dev_phases(phase_id);
EXCEPTION WHEN duplicate_table OR duplicate_object OR invalid_table_definition THEN NULL; END $$;

DO $$ BEGIN
    ALTER TABLE devdb.sim_phase_product_splits
        ADD CONSTRAINT fk_sim_phaseprod_phase FOREIGN KEY (phase_id) REFERENCES devdb.sim_dev_phases(phase_id);
EXCEPTION WHEN duplicate_table OR duplicate_object OR invalid_table_definition THEN NULL; END $$;

DO $$ BEGIN
    ALTER TABLE devdb.sim_phase_product_splits
        ADD CONSTRAINT fk_sim_phaseprod_lot_type FOREIGN KEY (lot_type_id) REFERENCES devdb.ref_lot_types(lot_type_id);
EXCEPTION WHEN duplicate_table OR duplicate_object OR invalid_table_definition THEN NULL; END $$;

DO $$ BEGIN
    ALTER TABLE devdb.sim_takedown_agreement_lots
        ADD CONSTRAINT fk_sim_tdagrplots_tda FOREIGN KEY (tda_id) REFERENCES devdb.sim_takedown_agreements(tda_id);
EXCEPTION WHEN duplicate_table OR duplicate_object OR invalid_table_definition THEN NULL; END $$;

DO $$ BEGIN
    ALTER TABLE devdb.sim_takedown_checkpoints
        ADD CONSTRAINT fk_sim_tdachkpt_tda FOREIGN KEY (tda_id) REFERENCES devdb.sim_takedown_agreements(tda_id);
EXCEPTION WHEN duplicate_table OR duplicate_object OR invalid_table_definition THEN NULL; END $$;

DO $$ BEGIN
    ALTER TABLE devdb.sim_takedown_lot_assignments
        ADD CONSTRAINT fk_sim_tdalotasgn_checkpoint FOREIGN KEY (checkpoint_id) REFERENCES devdb.sim_takedown_checkpoints(checkpoint_id);
EXCEPTION WHEN duplicate_table OR duplicate_object OR invalid_table_definition THEN NULL; END $$;

DO $$ BEGIN
    ALTER TABLE devdb.sim_snapshot_lots
        ADD CONSTRAINT fk_sim_snaplots_snapshot FOREIGN KEY (snapshot_id) REFERENCES devdb.sim_snapshots(snapshot_id);
EXCEPTION WHEN duplicate_table OR duplicate_object OR invalid_table_definition THEN NULL; END $$;

-- ============================================================
-- INDEXES (non-PK / non-UQ)
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_sched_devcode_act
    ON devdb.schedhousedetail (developmentcode, activitycode);

CREATE INDEX IF NOT EXISTS idx_sim_lots_pg_source
    ON devdb.sim_lots (projection_group_id, lot_source);

CREATE INDEX IF NOT EXISTS idx_sim_lots_phase
    ON devdb.sim_lots (phase_id);

-- ============================================================
-- VIEW
-- ============================================================

CREATE OR REPLACE VIEW devdb.v_sim_ledger_monthly AS
SELECT
    l.projection_group_id,
    l.builder_id,
    m.calendar_month,
    COUNT(CASE WHEN date_trunc('month', l.date_ent::timestamptz) = m.calendar_month THEN 1 END) AS ent_plan,
    COUNT(CASE WHEN date_trunc('month', l.date_dev::timestamptz) = m.calendar_month THEN 1 END) AS dev_plan,
    COUNT(CASE WHEN date_trunc('month', l.date_td::timestamptz) = m.calendar_month THEN 1 END)  AS td_plan,
    COUNT(CASE WHEN date_trunc('month', l.date_str::timestamptz) = m.calendar_month THEN 1 END) AS str_plan,
    COUNT(CASE WHEN date_trunc('month', l.date_cmp::timestamptz) = m.calendar_month THEN 1 END) AS cmp_plan,
    COUNT(CASE WHEN date_trunc('month', l.date_cls::timestamptz) = m.calendar_month THEN 1 END) AS cls_plan,
    COUNT(CASE WHEN l.date_ent IS NULL AND l.date_dev IS NULL AND l.date_td IS NULL
                    AND l.date_td_hold IS NULL AND l.date_str IS NULL
                    AND l.date_cmp IS NULL AND l.date_cls IS NULL THEN 1 END) AS p_end,
    COUNT(CASE WHEN l.date_ent <= m.calendar_month
                    AND (l.date_dev IS NULL OR l.date_dev > m.calendar_month) THEN 1 END) AS e_end,
    COUNT(CASE WHEN l.date_dev <= m.calendar_month
                    AND (l.date_td IS NULL OR l.date_td > m.calendar_month)
                    AND (l.date_td_hold IS NULL OR l.date_td_hold > m.calendar_month) THEN 1 END) AS d_end,
    COUNT(CASE WHEN l.date_td_hold <= m.calendar_month AND l.date_td IS NULL
                    AND (l.date_str IS NULL OR l.date_str > m.calendar_month) THEN 1 END) AS h_end,
    COUNT(CASE WHEN l.date_td <= m.calendar_month
                    AND (l.date_str IS NULL OR l.date_str > m.calendar_month) THEN 1 END) AS u_end,
    COUNT(CASE WHEN l.date_str <= m.calendar_month
                    AND (l.date_cmp IS NULL OR l.date_cmp > m.calendar_month) THEN 1 END) AS uc_end,
    COUNT(CASE WHEN l.date_cmp <= m.calendar_month
                    AND (l.date_cls IS NULL OR l.date_cls > m.calendar_month) THEN 1 END) AS c_end,
    SUM(COUNT(CASE WHEN date_trunc('month', l.date_cls::timestamptz) = m.calendar_month THEN 1 END))
        OVER (PARTITION BY l.projection_group_id, l.builder_id
              ORDER BY m.calendar_month
              ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS closed_cumulative
FROM devdb.sim_lots l
CROSS JOIN devdb.month_spine m
GROUP BY l.projection_group_id, l.builder_id, m.calendar_month;
