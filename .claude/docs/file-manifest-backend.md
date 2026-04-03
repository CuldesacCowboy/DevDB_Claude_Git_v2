# DevDB File Manifest — Backend (devdb_python/api/)

Load when working on: FastAPI routers, Pydantic models, API endpoints, services, or backend logic.

---

### devdb_python/api/deps.py
- Owns: FastAPI dependency provider -- yields a psycopg2 connection per request with search_path=devdb
- Imports: psycopg2, dotenv
- Imported by: all routers (developments, entitlement_groups, instruments, lots, phases), services
- Tables: none (connection factory only)
- Last commit: 2026-03-26

### devdb_python/api/main.py
- Owns: FastAPI app init, CORS middleware, schema migration runner on startup, router registration
- Imports: psycopg2, fastapi, dotenv, all routers (developments, entitlement_groups, instruments, lots, phases, takedown_agreements, site_plans, phase_boundaries, lot_positions)
- Imported by: uvicorn (entry point)
- Tables: devdb.schema_migrations (reads/inserts applied versions)
- Last commit: 2026-04-02

### devdb_python/api/models/lot_models.py
- Owns: Pydantic request/response models for lot and phase-view endpoints
- Imports: pydantic
- Imported by: routers/lots.py, routers/developments.py, routers/entitlement_groups.py
- Tables: none
- Last commit: 2026-03-27

### devdb_python/api/models/phase_models.py
- Owns: Pydantic request/response models for phase endpoints
- Imports: pydantic
- Imported by: routers/phases.py
- Tables: none
- Last commit: 2026-03-28

### devdb_python/api/routers/developments.py
- Owns: CRUD for developments table; GET /{dev_id}/lot-phase-view sub-resource; PUT /{dev_id}/sim-params (upserts sim_dev_params — validates against dim_development, COALESCE seasonal_weight_set to 'balanced_2yr')
- Imports: api.deps, api.models.lot_models, psycopg2.extras, pydantic
- Imported by: api/main.py
- Tables: developments, dim_county, dim_development, sim_entitlement_groups, sim_dev_phases, sim_lots, sim_phase_product_splits, ref_lot_types, sim_dev_params
- Last commit: 2026-04-02

### devdb_python/api/routers/eg_crud.py
- Owns: Entitlement-group list, create, patch (GET/POST/PATCH on /entitlement-groups)
- Imports: api.deps, api.db, pydantic, fastapi
- Imported by: api/main.py
- Tables: sim_entitlement_groups, developments, dim_development, sim_legal_instruments, sim_dev_phases, sim_lots, sim_phase_product_splits
- Last commit: 2026-04-02

### devdb_python/api/routers/eg_validation.py
- Owns: split-check, param-check (now includes max_starts_per_month), delivery-config GET/PUT (now includes delivery_window_start/end, max_deliveries_per_year, auto_schedule_enabled, default_cmp_lag_days, default_cls_lag_days), ledger-config GET/PUT (now propagates date_ent to sim_dev_phases + sim_lots per-phase; propagates date_plan_start to sim_dev_phases; date_ent truncated to first-of-month)
- Imports: api.deps, api.db, pydantic, fastapi
- Imported by: api/main.py
- Tables: sim_dev_phases, sim_legal_instruments, sim_ent_group_developments, sim_phase_product_splits, sim_dev_params, sim_entitlement_delivery_config, sim_entitlement_groups, sim_lots
- Last commit: 2026-04-03

### devdb_python/api/routers/eg_views.py
- Owns: lot-phase-view route only (delegates to eg_lot_phase_service); entitlement events CRUD removed — table dropped in migration 025
- Imports: api.deps, api.models.lot_models, services.eg_lot_phase_service, fastapi
- Imported by: api/main.py
- Tables: none directly (via service for lot-phase-view)
- Last commit: 2026-04-03

### devdb_python/api/routers/instruments.py
- Owns: POST and PATCH for sim_legal_instruments (create, rename)
- Imports: api.deps, psycopg2.extras
- Imported by: api/main.py
- Tables: developments, dim_development, sim_legal_instruments
- Last commit: 2026-04-02

### devdb_python/api/routers/lots.py
- Owns: PATCH /{id}/phase, PATCH /{id}/lot-type, DELETE /{id}/phase -- all delegating to lot_assignment_service
- Imports: api.deps, api.models.lot_models, services.lot_assignment_service
- Imported by: api/main.py
- Tables: delegated to lot_assignment_service
- Last commit: 2026-03-27

### devdb_python/api/routers/tda_crud.py
- Owns: TDA list, create, rename, detail view (GET/POST/PATCH on /takedown-agreements)
- Imports: api.deps, api.db, pydantic, fastapi
- Imported by: api/main.py
- Tables: sim_takedown_agreements, sim_takedown_checkpoints, sim_takedown_lot_assignments, sim_lots, sim_entitlement_groups
- Last commit: 2026-04-02

### devdb_python/api/routers/tda_checkpoints.py
- Owns: Checkpoint create (POST /takedown-agreements/{tda_id}/checkpoints)
- Imports: api.deps, api.db, pydantic, fastapi
- Imported by: api/main.py
- Tables: sim_takedown_agreements, sim_takedown_checkpoints
- Last commit: 2026-04-02

### devdb_python/api/routers/tda_assignments.py
- Owns: Lot assignment/unassignment, pool management, HC/BLDR/DIG date and lock editing with building-group fan-out
- Imports: api.deps, api.db, psycopg2.extras, pydantic, fastapi
- Imported by: api/main.py
- Tables: sim_takedown_agreement_lots, sim_takedown_lot_assignments, sim_takedown_checkpoints, sim_lots, sim_assignment_log
- Last commit: 2026-04-02

### devdb_python/api/routers/phases.py
- Owns: Phase CRUD, lot-type split management; GET /lot-types (all ref_lot_types for picker); POST /{phase_id}/lot-type/{lot_type_id} (add split with p=0, 409 if exists); DELETE /{phase_id}/lot-type/{lot_type_id} (requires p=0 AND r=0); PATCH /{phase_id}/lot-type/{lot_type_id}/projected; DELETE and PATCH routes registered BEFORE generic /{phase_id} (route ordering intentional)
- Imports: api.deps, api.models.phase_models, services.phase_assignment_service, psycopg2.extras
- Imported by: api/main.py
- Tables: sim_dev_phases, sim_legal_instruments, ref_lot_types, sim_phase_product_splits, sim_phase_builder_splits, sim_delivery_event_phases, sim_lots (devdb. prefix on lot-type queries)
- Last commit: 2026-04-04

### devdb_python/api/routers/site_plans.py
- Owns: Site plan CRUD; POST /site-plans (upload PDF); GET /site-plans/ent-group/{id}; GET /{plan_id}/file; PATCH /{plan_id}/parcel (saves parcel polygon, auto-seeds first boundary if none exists)
- Imports: api.deps, fastapi, pydantic
- Imported by: api/main.py
- Tables: sim_site_plans, sim_phase_boundaries
- Last commit: 2026-04-01

### devdb_python/api/routers/phase_boundaries.py
- Owns: Phase boundary CRUD + split endpoint; GET /plan/{plan_id}; POST; PATCH /{boundary_id} (polygon_json, label, phase_id — uses model_fields_set for null-safe unassign); DELETE; POST /split (delete original, insert two children)
- Imports: api.deps, fastapi, pydantic
- Imported by: api/main.py
- Tables: sim_phase_boundaries
- Last commit: 2026-04-01

### devdb_python/api/routers/lot_positions.py
- Owns: Lot site-plan positioning endpoints; GET /lot-positions/plan/{plan_id} returns {positioned, bank}; POST /lot-positions/plan/{plan_id}/save bulk-upserts positions and applies phase assignments (client point-in-polygon); removes lots from plan when phase_id absent
- Imports: api.deps, psycopg2.extras, pydantic, fastapi
- Imported by: api/main.py
- Tables: sim_lot_site_positions, sim_lots, sim_site_plans, sim_dev_phases, dim_development, developments, sim_legal_instruments
- Last commit: 2026-04-02

### devdb_python/api/routers/simulations.py
- Owns: POST /simulations/run — triggers convergence_coordinator for an ent_group_id; returns status, iterations, elapsed_ms, errors[]; looks up dev names for missing_params_devs via dim_development bridge
- Imports: engine.coordinator, fastapi, pydantic, time, traceback, psycopg2.extras
- Imported by: api/main.py
- Tables: dim_development, developments (for dev_name lookup on missing params)
- Last commit: 2026-04-02

### devdb_python/api/routers/ledger.py
- Owns: GET /ledger/{id} and /by-dev (monthly ledger by dev); GET /ledger/{id}/utilization (phase utilization bars); GET /ledger/{id}/lots (lot-level rows with pipeline dates + projected dates); GET /ledger/{id}/delivery-schedule (one row per event+dev: date, source, phases, units, D/U/UC inventory at delivery month)
- Imports: api.deps, psycopg2.extras, fastapi
- Imported by: api/main.py
- Tables: v_sim_ledger_monthly, sim_ent_group_developments, dim_development, developments, sim_dev_phases, sim_delivery_events, sim_delivery_event_phases, sim_lots, sim_legal_instruments, sim_phase_product_splits, ref_lot_types
- Last commit: 2026-04-03

### devdb_python/api/db.py
- Owns: Database utility helpers shared across routers; dict_cursor(conn) replaces repeated conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) boilerplate
- Imports: psycopg2.extras
- Imported by: all routers, services/ledger_service.py
- Tables: none
- Last commit: 2026-04-02

### devdb_python/api/sql_fragments.py
- Owns: Shared SQL fragment helpers; lot_status_sql(alias) returns the lot pipeline-status CASE expression (OUT > C > UC > H > U > D > E > P) for use in f-string queries
- Imports: none
- Imported by: routers/developments.py, services/eg_lot_phase_service.py, routers/ledger.py
- Tables: none
- Last commit: 2026-04-02

### devdb_python/services/eg_lot_phase_service.py
- Owns: query_lot_phase_view(ent_group_id, conn) — full lot-phase-view query logic extracted from eg_views.py; _sort_phases_for_display() helper
- Imports: api.db, api.models.lot_models, api.sql_fragments, fastapi, re
- Imported by: routers/eg_views.py
- Tables: sim_entitlement_groups, developments, dim_development, sim_legal_instruments, sim_dev_phases, sim_lots, ref_lot_types, sim_phase_product_splits
- Last commit: 2026-04-02

### devdb_python/services/ledger_service.py
- Owns: Ledger query logic extracted from routers/ledger.py; query_ledger_by_dev(conn, ent_group_id) — bounded date range, synthetic start-date rows; _ledger_row() dict serializer. Entitlement event overlay removed (sim_entitlement_events dropped in migration 025).
- Imports: api.db.dict_cursor
- Imported by: routers/ledger.py
- Tables: v_sim_ledger_monthly, sim_entitlement_groups, sim_ent_group_developments, sim_lots, dim_development, developments
- Last commit: 2026-04-03

### devdb_python/services/lot_assignment_service.py
- Owns: Lot phase reassignment, lot-type change, lot unassignment with validation and audit logging
- Imports: psycopg2.extras, dataclasses
- Imported by: routers/lots.py
- Tables: sim_lots, sim_dev_phases, sim_ent_group_developments, sim_phase_product_splits, ref_lot_types, dim_projection_groups, sim_assignment_log
- Last commit: 2026-03-27

### devdb_python/services/phase_assignment_service.py
- Owns: Phase-to-instrument reassignment with entitlement group validation and audit logging
- Imports: psycopg2.extras, dataclasses
- Imported by: routers/phases.py
- Tables: sim_dev_phases, sim_legal_instruments, sim_ent_group_developments, sim_lots, dim_projection_groups, sim_assignment_log
- Last commit: 2026-03-26
