# DevDB File Manifest — Migrations (devdb_python/migrations/)

Load when working on: schema changes, adding columns, creating tables, or understanding migration history.

---

### devdb_python/migrations/000_create_migrations_log.sql
- Owns: Creates devdb.schema_migrations table; run unconditionally on every startup before others
- Tables: schema_migrations (CREATE IF NOT EXISTS)
- Last commit: 2026-03-27

### devdb_python/migrations/001_baseline.sql
- Owns: Initial 26-table schema (all sim_, ref_, dim_, developments tables)
- Tables: all core tables (CREATE)
- Last commit: 2026-03-27

### devdb_python/migrations/002_fix_split_id_sequence.sql
- Owns: Corrects split_id sequence on sim_phase_product_splits
- Tables: sim_phase_product_splits
- Last commit: 2026-03-27

### devdb_python/migrations/003_rename_lot_count_to_projected_count.sql
- Owns: Renames lot_count column to projected_count in sim_phase_product_splits
- Tables: sim_phase_product_splits
- Last commit: 2026-03-27

### devdb_python/migrations/004_tda_schema.sql
- Owns: Adds ent_group_id to sim_takedown_agreements; checkpoint_name/status to sim_takedown_checkpoints; HC/BLDR projected date and lock fields to sim_takedown_lot_assignments (D-151 lock pattern proof-of-concept)
- Tables: sim_takedown_agreements, sim_takedown_checkpoints, sim_takedown_lot_assignments
- Last commit: 2026-03-29

### devdb_python/migrations/005_tda_sequences.sql
- Owns: Adds SERIAL sequences to sim_takedown_checkpoints.checkpoint_id, sim_takedown_agreement_lots.id, sim_takedown_lot_assignments.assignment_id; advances each past current MAX to avoid collisions
- Tables: sim_takedown_checkpoints, sim_takedown_agreement_lots, sim_takedown_lot_assignments
- Last commit: 2026-03-29

### devdb_python/migrations/add_display_order.py
- Owns: Idempotent migration script adding display_order column to sim_dev_phases (UI display preference only -- never read by simulation engine; sequence_number remains the engine ordering column)
- Tables: sim_dev_phases
- Last commit: 2026-03-29

### devdb_python/migrations/006_fix_instrument_dev_ids.sql
- Owns: Corrects dev_id values in sim_legal_instruments using dim_development bridge
- Tables: sim_legal_instruments, dim_development
- Last commit: 2026-03-28

### devdb_python/migrations/007_backfill_ent_group_developments.sql
- Owns: Populates sim_ent_group_developments junction table from existing data
- Tables: sim_ent_group_developments, sim_entitlement_groups, developments
- Last commit: 2026-03-28

### devdb_python/migrations/008_fix_instrument_dev_ids_round2.sql
- Owns: Additional dev_id corrections in sim_legal_instruments (round 2)
- Tables: sim_legal_instruments, dim_development
- Last commit: 2026-03-28

### devdb_python/migrations/009_restore_waterton_instrument_dev_ids.sql
- Owns: Restores correct dev_ids for Waterton Station instruments
- Tables: sim_legal_instruments
- Last commit: 2026-03-28

### devdb_python/migrations/010_no_ddl_phase_endpoints.sql
- Owns: No-op marker recording addition of DELETE /phases/{id}/lot-type and DELETE /phases/{id} endpoints
- Tables: none (SELECT 1)
- Last commit: 2026-03-29

### devdb_python/migrations/011_add_display_order.sql
- Owns: Adds display_order column (INT NULL) to sim_dev_phases; idempotent (ADD COLUMN IF NOT EXISTS). Supersedes add_display_order.py.
- Tables: sim_dev_phases
- Last commit: 2026-03-30

### devdb_python/migrations/012_sim_lots_projected_lock_fields.sql
- Owns: Implements D-151/D-152 system-wide pattern — adds projected date and is_locked companion columns for all 7 pipeline dates to sim_lots; migrates HC/BLDR projected+lock data from sim_takedown_lot_assignments to sim_lots; drops the old columns from sim_takedown_lot_assignments
- Tables: sim_lots (ADD COLUMNS), sim_takedown_lot_assignments (UPDATE/DROP COLUMNS)
- Last commit: 2026-04-01

### devdb_python/migrations/013_site_plans.sql
- Owns: Creates sim_site_plans table for the site plan viewer module (plan_id PK, ent_group_id, pdf_filename, parcel_polygon_json, created_at)
- Tables: sim_site_plans (CREATE TABLE)
- Last commit: 2026-04-01

### devdb_python/migrations/014_site_plans_scope_to_ent_group.sql
- Owns: Drops and recreates sim_site_plans scoped to ent_group_id instead of dev_id; table had no production data at time of migration
- Tables: sim_site_plans (DROP + CREATE TABLE)
- Last commit: 2026-04-01

### devdb_python/migrations/015_phase_boundaries.sql
- Owns: Creates sim_phase_boundaries table for site plan phase subdivision; each row is a polygon region optionally linked to a sim_dev_phases record
- Tables: sim_phase_boundaries (CREATE TABLE)
- Last commit: 2026-04-01

### devdb_python/migrations/016_lot_site_positions.sql
- Owns: Creates devdb.sim_lot_site_positions table (lot_id PK, plan_id, x, y DOUBLE PRECISION, updated_at); creates index on plan_id; wrapped in DO $$ IF NOT EXISTS guard
- Tables: sim_lot_site_positions (CREATE TABLE + INDEX)
- Last commit: 2026-04-02

### devdb_python/migrations/017_dev_params_and_build_lag_curves.sql
- Owns: Creates sim_dev_params (dev_id grain, annual_starts_target, max_starts_per_month, seasonal_weight_set) and sim_build_lag_curves (empirical percentile curves str_to_cmp/cmp_to_cls per lot_type_id); projection group layer retired — hierarchy is now ent-group → dev → instrument → phase → lot
- Tables: sim_dev_params (CREATE + seed from sim_projection_params), sim_build_lag_curves (CREATE + seed from MARKsystems data)
- Last commit: 2026-04-02

### devdb_python/migrations/018_add_dev_id_to_sim_lots.sql
- Owns: Replaces projection_group_id with dev_id on sim_lots; drops FK/index on projection_group_id; adds dev_id populated from sim_dev_phases via phase_id
- Tables: sim_lots (DROP COLUMN projection_group_id, ADD COLUMN dev_id, UPDATE, ADD INDEX)
- Last commit: 2026-04-02

### devdb_python/migrations/019_fix_sim_dev_params_fk.sql
- Owns: Drops incorrect FK constraint on sim_dev_params.dev_id (was pointing to developments.dev_id space but should be dim_development.development_id space)
- Tables: sim_dev_params (DROP CONSTRAINT)
- Last commit: 2026-04-02

### devdb_python/migrations/020_min_unstarted_inventory.sql
- Owns: Adds min_unstarted_inventory column (INTEGER NULL) to sim_entitlement_delivery_config; P-00 uses this to schedule deliveries before full exhaustion to maintain a buffer
- Tables: sim_entitlement_delivery_config (ADD COLUMN IF NOT EXISTS)
- Last commit: 2026-04-02

### devdb_python/migrations/021_ledger_features.sql
- Owns: (1) Adds ledger_start_date (DATE NULL) to sim_entitlement_groups; (2) Creates sim_entitlement_events table (event_id, ent_group_id, dev_id, event_date, lots_entitled); (3) Adds per-status floor columns (min_p/e/d/u/uc/c_count) to sim_entitlement_delivery_config; migrates min_unstarted_inventory → min_d_count
- Tables: sim_entitlement_groups, sim_entitlement_events (CREATE), sim_entitlement_delivery_config (ADD COLUMNS)
- Last commit: 2026-04-02

### devdb_python/migrations/create_developments.py
- Owns: Standalone one-time migration — creates developments table; adds PKs to dim_county, dim_state, dim_municipality (migrated without constraints per D-086). Idempotent.
- Tables: developments (CREATE IF NOT EXISTS), dim_county, dim_state, dim_municipality (ALTER ADD PRIMARY KEY)
- Last commit: 2026-03-26

### devdb_python/migrations/create_sim_assignment_log.py
- Owns: Standalone one-time migration — creates sim_assignment_log table. Idempotent (IF NOT EXISTS).
- Tables: sim_assignment_log (CREATE IF NOT EXISTS)
- Last commit: 2026-03-26

### devdb_python/migrations/allow_null_phase_id.py
- Owns: Standalone one-time migration — drops NOT NULL constraint on sim_lots.phase_id to allow unassigned lots (phase_id = NULL).
- Tables: sim_lots (ALTER COLUMN phase_id DROP NOT NULL)
- Last commit: 2026-03-26

### devdb_python/migrations/022_rename_ledger_start_to_date_paper.sql
- Owns: Renames ledger_start_date → date_paper on sim_entitlement_groups; idempotent DO block
- Tables: sim_entitlement_groups (ALTER COLUMN RENAME)
- Last commit: 2026-04-03

### devdb_python/migrations/023_phase_date_ent_plan_start.sql
- Owns: Adds date_ent and date_plan_start (DATE NULL) to sim_dev_phases; populates from existing group-level values (date_ent_actual → phases, date_paper → phases)
- Tables: sim_dev_phases (ADD COLUMNS + UPDATE)
- Last commit: 2026-04-03

### devdb_python/migrations/024_delivery_config_lag_constants.sql
- Owns: Adds default_cmp_lag_days and default_cls_lag_days (INT NULL) to sim_entitlement_delivery_config; populates existing rows with historic defaults (270/45). Moves hardcoded coordinator constants to DB.
- Tables: sim_entitlement_delivery_config (ADD COLUMNS + UPDATE)
- Last commit: 2026-04-03

### devdb_python/migrations/025_drop_entitlement_events.sql
- Owns: Drops sim_entitlement_events table — functionality replaced by phase-level date_ent (migration 023)
- Tables: sim_entitlement_events (DROP TABLE)
- Last commit: 2026-04-03

### devdb_python/migrations/026_building_groups_sequence.sql
- Owns: Adds auto-increment sequence to sim_building_groups.building_group_id (idempotent DO block; setval to current MAX so existing IDs never reused)
- Tables: sim_building_groups
- Last commit: 2026-04-02

### devdb_python/migrations/027_pk_sequences.sql
- Owns: Adds auto-increment sequences to 5 tables whose PKs were generated via SELECT MAX(id)+1 in application code (race condition under concurrent requests). Idempotent DO block. Tables: sim_entitlement_groups, sim_legal_instruments, sim_dev_phases, sim_phase_product_splits, sim_takedown_agreements. Pattern: CREATE SEQUENCE IF NOT EXISTS, setval to MAX+1, ALTER TABLE SET DEFAULT nextval() guarded by IF NOT EXISTS.
- Tables: sim_entitlement_groups, sim_legal_instruments, sim_dev_phases, sim_phase_product_splits, sim_takedown_agreements
- Last commit: 2026-04-04

### devdb_python/migrations/028_engine_pk_sequences.sql
- Owns: Adds auto-increment sequences to 4 engine-owned tables still using MAX(id)+1: sim_lots.lot_id, sim_lot_date_violations.violation_id, sim_delivery_events.delivery_event_id, sim_delivery_event_phases.id. Same idempotent pattern as 027.
- Tables: sim_lots, sim_lot_date_violations, sim_delivery_events, sim_delivery_event_phases
- Last commit: 2026-04-04

### devdb_python/migrations/029_is_test_flag.sql
- Owns: Adds is_test boolean (DEFAULT FALSE) to sim_entitlement_groups; marks all existing test/Pokemon fixture groups (ent_group_id IN (7001..7014, 9001, 9002) pattern or is_test already set)
- Tables: sim_entitlement_groups (ADD COLUMN IF NOT EXISTS)
- Last commit: 2026-04-04

### devdb_python/migrations/030_delivery_months.sql
- Owns: Drops delivery_window_start and delivery_window_end from sim_entitlement_delivery_config and sim_delivery_events; adds delivery_months integer[] to sim_entitlement_delivery_config; migrates existing rows using generate_series (handles year-boundary wrap where start > end)
- Tables: sim_entitlement_delivery_config (ADD COLUMN, DROP COLUMNS), sim_delivery_events (DROP COLUMNS)
- Last commit: 2026-04-04

### devdb_python/migrations/031_global_settings.sql
- Owns: Creates sim_global_settings (single-row id=1 table) for global simulation defaults — build times, inventory floors, delivery defaults; community delivery config overrides where non-null
- Tables: sim_global_settings (CREATE TABLE)
- Last commit: 2026-04-05

### devdb_python/migrations/032_phase_config_spreadsheet.sql
- Owns: Adds date_dev_actual to sim_dev_phases (locks delivery date when set); adds UNIQUE constraint on sim_phase_builder_splits(phase_id, builder_id) for ON CONFLICT upserts; adds sequence for sim_phase_builder_splits.split_id
- Tables: sim_dev_phases (ADD COLUMN), sim_phase_builder_splits (ADD CONSTRAINT, ADD SEQUENCE)
- Last commit: 2026-04-05

### devdb_python/migrations/033_backfill_phase_date_dev_actual.sql
- Owns: One-time backfill — sets sim_dev_phases.date_dev_actual from existing locked delivery events so Configure page reflects locks entered before phase-level locking existed
- Tables: sim_dev_phases (UPDATE from sim_delivery_events/sim_delivery_event_phases)
- Last commit: 2026-04-05

### devdb_python/migrations/034_backfill_dim_development_bridge.sql
- Owns: Widens developments.marks_code from CHAR(2) to TEXT; backfills dim_development rows for devs missing a bridge; backfills sim_ent_group_developments links for devs with community_id but no link row
- Tables: developments (ALTER COLUMN), dim_development (INSERT), sim_ent_group_developments (INSERT)
- Last commit: 2026-04-08

### devdb_python/migrations/035_lot_excluded_flag.sql
- Owns: Adds excluded boolean (DEFAULT FALSE) to sim_lots; excluded lots are invisible to simulation, phase counts, unstarted inventory, and delivery scheduling; user-togglable
- Tables: sim_lots (ADD COLUMN IF NOT EXISTS)
- Last commit: 2026-04-08

### devdb_python/migrations/036_marks_lot_registry.sql
- Owns: Creates marks_lot_registry — one row per distinct MARKS lot deduped from OPTIONLOTMASTER; source of truth for "what lots exist in MARKS" including P-status lots with no schedhousedetail activity
- Tables: marks_lot_registry (CREATE TABLE IF NOT EXISTS)
- Last commit: 2026-04-08

### devdb_python/migrations/037_link_legacy_phases_to_instruments.sql
- Owns: Links legacy phases (instrument_id=NULL) to sim_legal_instruments; creates synthetic instruments per dev for orphaned phases so all phases are visible in the UI's instrument-based hierarchy
- Tables: sim_legal_instruments (INSERT), sim_dev_phases (UPDATE instrument_id)
- Last commit: 2026-04-08

### devdb_python/migrations/038_predecessor_sequence.sql
- Owns: Adds auto-increment sequence to sim_delivery_event_predecessors.id so P-0000 Step 7 can INSERT predecessor rows without supplying explicit IDs; seeds sequence above existing MAX
- Tables: sim_delivery_event_predecessors (ADD SEQUENCE + SET DEFAULT)
- Last commit: 2026-04-10

### devdb_python/migrations/039_lot_date_overrides.sql
- Owns: Planning layer — manager-entered date overrides for production meeting what-if testing; one row per lot per date field; override wins over MARKS in simulation; cleared manually or via batch reconciliation
- Tables: sim_lot_date_overrides (CREATE TABLE IF NOT EXISTS)
- Last commit: 2026-04-10

### devdb_python/migrations/040_builder_id_override.sql
- Owns: Adds builder_id_override INTEGER to sim_lots (tier 1 of three-tier builder priority: override > MARKS builder_id > NULL); ensures pk_dim_builders PK exists via DO block guard; FK references dim_builders
- Tables: sim_lots (ADD COLUMN builder_id_override), dim_builders (ADD CONSTRAINT pk_dim_builders)
- Last commit: 2026-04-12

### devdb_python/migrations/041_dim_builders_marks_code.sql
- Owns: Adds marks_company_code VARCHAR(10) to dim_builders; seeds COMPANYCODE 001→builder_id 188 (JTB Homes) and 050→builder_id 189 (Interra Homes)
- Tables: dim_builders (ADD COLUMN marks_company_code, UPDATE 2 rows)
- Last commit: 2026-04-12

### devdb_python/migrations/042_fix_phase_dev_id_assignments.sql
- Owns: Corrects sim_legal_instruments.dev_id and sim_dev_phases.dev_id for 37 instruments and ~73 phases that were mis-assigned during original seeding; instrument_name is the authoritative anchor for correct dev_id; phase dev_id updated to match its instrument
- Tables: sim_legal_instruments (UPDATE dev_id, 37 rows), sim_dev_phases (UPDATE dev_id, ~73 rows)
- Last commit: 2026-04-13
