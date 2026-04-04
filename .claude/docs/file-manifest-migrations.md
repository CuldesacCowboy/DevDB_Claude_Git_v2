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

### devdb_python/migrations/016_lot_site_positions.sql
- Owns: Creates devdb.sim_lot_site_positions table (lot_id PK, plan_id, x, y DOUBLE PRECISION, updated_at); creates index on plan_id; wrapped in DO $$ IF NOT EXISTS guard
- Tables: sim_lot_site_positions (CREATE TABLE + INDEX)
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

### devdb_python/migrations/add_display_order.py (superseded)
- Owns: Superseded by 011_add_display_order.sql. Original standalone migration that added display_order to sim_dev_phases.
- Tables: sim_dev_phases
- Last commit: 2026-03-29
