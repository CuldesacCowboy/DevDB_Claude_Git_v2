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
- Owns: CRUD for developments table; GET /{dev_id}/lot-phase-view sub-resource; PUT /{dev_id}/sim-params (upserts sim_dev_params — validates against developments, COALESCE seasonal_weight_set to 'balanced_2yr'); all dev_id lookups use developments directly (no dim_development bridge)
- Imports: api.deps, api.models.lot_models, psycopg2.extras, pydantic
- Imported by: api/main.py
- Tables: developments, dim_county, sim_entitlement_groups, sim_dev_phases, sim_lots, sim_phase_product_splits, ref_lot_types, sim_dev_params
- Last commit: 2026-04-14

### devdb_python/api/routers/eg_crud.py
- Owns: Entitlement-group list, create, patch (GET/POST/PATCH on /entitlement-groups); list includes is_test flag for test-mode community filtering; all joins use developments.dev_id directly (no dim_development bridge)
- Imports: api.deps, api.db, pydantic, fastapi
- Imported by: api/main.py
- Tables: sim_entitlement_groups, developments, sim_legal_instruments, sim_dev_phases, sim_lots, sim_phase_product_splits
- Last commit: 2026-04-14

### devdb_python/api/routers/eg_validation.py
- Owns: split-check, param-check, delivery-config GET/PUT (delivery_months integer[] replaces delivery_window_start/end; validates each month 1–12; max_deliveries_per_year, auto_schedule_enabled, default_cmp_lag_days, default_cls_lag_days, feed_starts_mode), ledger-config GET/PUT (propagates date_ent to sim_dev_phases + sim_lots; propagates date_plan_start to sim_dev_phases; date_ent truncated to first-of-month; earliest_delivery_date from sim_delivery_events COALESCE(actual, projected))
- Imports: api.deps, api.db, pydantic, fastapi
- Imported by: api/main.py
- Last commit: 2026-04-15
- Tables: sim_dev_phases, sim_legal_instruments, sim_ent_group_developments, sim_phase_product_splits, sim_dev_params, sim_entitlement_delivery_config, sim_entitlement_groups, sim_lots
- Last commit: 2026-04-14

### devdb_python/api/routers/eg_views.py
- Owns: lot-phase-view route only (delegates to eg_lot_phase_service); entitlement events CRUD removed — table dropped in migration 025
- Imports: api.deps, api.models.lot_models, services.eg_lot_phase_service, fastapi
- Imported by: api/main.py
- Tables: none directly (via service for lot-phase-view)
- Last commit: 2026-04-03

### devdb_python/api/routers/instruments.py
- Owns: POST and PATCH for sim_legal_instruments (create, rename, dev-id reassign, type edit, phase-order); INSERT uses RETURNING instrument_id (sequence-backed, no MAX query); PATCH /{id}/dev reassigns instrument to different dev_id; PATCH /{id}/type updates instrument_type (validates against allowed list: Plat, Site Condo, Traditional Condo, Metes & Bounds Splits, Other); PATCH /{id}/phase-order; POST /{id}/phase-order/auto-sort; validates dev_id against developments directly (no dim_development bridge); PATCH /{id}/spec-rate (saves spec_rate 0.0–1.0 to sim_legal_instruments); GET /{id}/spec-rate-hints (4 hints: 6mo spec/build, 2yr spec/build using conststart_date + companycode/lot_type_id weighting from codetail+housemaster)
- Imports: api.deps, api.db, pydantic, fastapi, re
- Imported by: api/main.py
- Tables: developments, sim_legal_instruments, sim_dev_phases, devdb_ext.housemaster, devdb_ext.codetail
- Last commit: 2026-04-15

### devdb_python/api/routers/lots.py
- Owns: PATCH /{id}/phase, PATCH /{id}/lot-type, DELETE /{id}/phase -- all delegating to lot_assignment_service
- Imports: api.deps, api.models.lot_models, services.lot_assignment_service
- Imported by: api/main.py
- Tables: delegated to lot_assignment_service
- Last commit: 2026-03-27

### devdb_python/api/routers/tda_crud.py
- Owns: TDA list, create, rename, detail view (GET/POST/PATCH on /takedown-agreements); INSERT uses RETURNING tda_id (sequence-backed via migration 027, no MAX query); dev_id joins use developments directly (no dim_development bridge)
- Imports: api.deps, api.db, pydantic, fastapi
- Imported by: api/main.py
- Tables: sim_takedown_agreements, sim_takedown_checkpoints, sim_takedown_lot_assignments, sim_lots, sim_entitlement_groups, developments
- Last commit: 2026-04-14

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
- Owns: Phase CRUD, lot-type split management; GET /lot-types (all ref_lot_types for picker); POST /{phase_id}/lot-type/{lot_type_id} (add split with p=0, 409 if exists); DELETE /{phase_id}/lot-type/{lot_type_id} (requires p=0 AND r=0); PATCH /{phase_id}/lot-type/{lot_type_id}/projected; DELETE and PATCH routes registered BEFORE generic /{phase_id} (route ordering intentional); phase INSERT and split INSERT both use RETURNING (sequence-backed via migration 027, no MAX query); dev_code returned from developments.marks_code (no dim_development bridge); GET /{phase_id}/lots/{lot_type_id} includes is_spec field
- Imports: api.deps, api.models.phase_models, services.phase_assignment_service, psycopg2.extras
- Imported by: api/main.py
- Tables: sim_dev_phases, sim_legal_instruments, ref_lot_types, sim_phase_product_splits, sim_delivery_event_phases, sim_lots, developments
- Last commit: 2026-04-15

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
- Owns: Lot site-plan positioning endpoints; GET /lot-positions/plan/{plan_id} returns {positioned, bank}; POST /lot-positions/plan/{plan_id}/save bulk-upserts positions and applies phase assignments (client point-in-polygon); removes lots from plan when phase_id absent; dev_code from developments.marks_code (no dim_development bridge)
- Imports: api.deps, psycopg2.extras, pydantic, fastapi
- Imported by: api/main.py
- Tables: sim_lot_site_positions, sim_lots, sim_site_plans, sim_dev_phases, developments, sim_legal_instruments
- Last commit: 2026-04-14

### devdb_python/api/routers/admin.py
- Owns: GET /admin/phase-config (full phase hierarchy with lot counts, product splits, builder splits derived from instrument level for the phase config spreadsheet); PATCH /admin/phase/{phase_id} (lot_count_projected, date_dev_projected, date_dev_actual); PUT /admin/product-split/{phase_id}/{lot_type_id}; PUT /admin/builder-split/{instrument_id}/{builder_id} (upserts sim_instrument_builder_splits — instrument-level, not phase-level); GET /admin/community-config (ledger dates + delivery scheduling config per ent_group, builder splits derived from instrument level); GET /admin/dev-config (dev sim params + historical pace: starts_ytd/last_year/2yr_ago, unstarted_real, total_projected); GET /admin/setup-tree (full community → dev → instrument → phase tree with D/I/P/L subtotals and updated_at per phase); GET /admin/audit-data (all data for AuditView: global settings, communities with county_id/county_name/school_district_id/sd_name, phases, delivery events, dev params); all segd joins use developments.dev_id directly (no dim_development bridge)
- Imports: api.deps, api.db, pydantic, fastapi
- Imported by: api/main.py
- Tables: sim_entitlement_groups, sim_ent_group_developments, sim_legal_instruments, sim_dev_phases, sim_lots, sim_phase_product_splits, sim_instrument_builder_splits, ref_lot_types, dim_builders, sim_entitlement_delivery_config, sim_dev_params, developments, ref_counties, ref_school_districts
- Last commit: 2026-04-16

### devdb_python/api/routers/bulk_lots.py
- Owns: POST /bulk-lots/suggestions (infers dev lot-number prefix + max seq from existing lots, returns flat suggestion list for given phase + lot type counts); POST /bulk-lots/insert (inserts pre-MARKS lots as lot_source='pre', sequence-backed lot_id, validates no duplicate lot_numbers, maintains product splits, audit logs each insertion); dev_code from developments.marks_code (no dim_development bridge)
- Imports: api.deps, api.db, pydantic, fastapi, re, datetime
- Imported by: api/main.py
- Tables: sim_dev_phases, sim_legal_instruments, developments, sim_lots, ref_lot_types, sim_phase_product_splits, sim_assignment_log
- Last commit: 2026-04-14

### devdb_python/api/routers/marks.py
- Owns: MARKS lot sync and import management; GET /marks/summary (per-dev-code totals from marks_lot_registry: total/imported/unimported/promotable); GET /marks/unimported (lots in marks_lot_registry not yet in sim_lots, with schedhousedetail dates); GET /marks/dev-phases (instruments + phases for a dev, used by import panel); POST /marks/sync (update pipeline dates on real lots from schedhousedetail, respects manual overrides); POST /marks/import (import selected MARKS lots as lot_source='real' with resolved dates); GET /marks/promotable (pre lots with matching schedhousedetail rows); POST /marks/promote (promotes lot_source='pre' → 'real', applies MARKS dates — intentional exception to lot_source immutability for pre→real workflow); dev_id resolution uses developments.marks_code directly (no dim_development bridge); lot join uses canonical reconstruction (developmentcode || LPAD(housenumber,8,'0') = lot_number) — works for both letter-prefix and numeric-prefix dev codes (e.g. 43 North)
- Imports: api.deps, api.db, pydantic, fastapi
- Imported by: api/main.py
- Tables: marks_lot_registry, schedhousedetail, sim_lots, developments
- Last commit: 2026-04-14

### devdb_python/api/routers/overrides.py
- Owns: Planning layer date overrides; GET /overrides (active overrides for ent_group); POST /overrides/preview (cascade preview — proposed date + downstream deltas without writing); POST /overrides/apply (write override(s) for a lot, cascade optional); DELETE /overrides/{lot_id}/{date_field}; POST /overrides/clear-batch (clear by override_ids or lot_ids); GET /overrides/reconciliation (overrides now within n_days of MARKS actual, suggesting they can be cleared); GET /overrides/export (CSV-ready list for ent_group)
- Imports: api.deps, api.db, pydantic, fastapi
- Imported by: api/main.py
- Tables: sim_lots, sim_lot_date_overrides
- Last commit: 2026-04-14

### devdb_python/api/routers/ref_data.py
- Owns: Reference data endpoints; GET /ref/counties (all counties ordered by name); GET /ref/school-districts (all school districts alphabetically — no county filtering; county and SD are independent dimensions since migration 072)
- Imports: api.deps, api.db, fastapi
- Imported by: api/main.py
- Tables: ref_counties, ref_school_districts
- Last commit: 2026-04-16

### devdb_python/api/routers/global_settings.py
- Owns: GET /global-settings (sim_global_settings row id=1); PUT /global-settings (update delivery_months, max_deliveries_per_year, default_cmp_lag_days, default_cls_lag_days, min_d/u/uc/c_count); community delivery config overrides these where non-null
- Imports: api.deps, api.db, pydantic, fastapi
- Imported by: api/main.py
- Tables: sim_global_settings
- Last commit: 2026-04-14

### devdb_python/api/routers/building_groups.py
- Owns: Building group management for both site-plan and setup contexts; GET /building-groups/plan/{plan_id} (groups + lot positions for a plan); POST /building-groups (create group from lot_ids, site-plan); DELETE /building-groups/{id}; POST /building-groups/bulk-delete; GET /building-groups/phase/{phase_id} (buildings + lots for a phase, no plan required); POST /building-groups/setup (create building with name/type/lot_ids); PATCH /building-groups/{id} (rename/retype); PATCH /building-groups/{id}/lots (replace lot assignments)
- Imports: api.deps, api.db, pydantic, fastapi
- Imported by: api/main.py
- Tables: sim_building_groups, sim_lot_site_positions, sim_lots
- Last commit: 2026-04-14

### devdb_python/api/routers/delivery_events.py
- Owns: Delivery event CRUD within an entitlement group; GET /entitlement-groups/{id}/delivery-events (list events with phase_ids, is_auto_created); plus create/patch/delete endpoints for manual event management; shares /entitlement-groups prefix with eg_crud/eg_validation/eg_views — route ordering matters
- Imports: api.deps, api.db, pydantic, fastapi
- Imported by: api/main.py
- Tables: sim_delivery_events, sim_delivery_event_phases
- Last commit: 2026-04-14

### devdb_python/api/routers/simulations.py
- Owns: POST /simulations/run — triggers convergence_coordinator for an ent_group_id; returns status, iterations, elapsed_ms, errors[]; looks up dev names for missing_params_devs via developments directly; on exception prints full traceback to server terminal and returns only str(exc) to client (no traceback leak)
- Imports: engine.coordinator, fastapi, pydantic, time, traceback, psycopg2.extras
- Imported by: api/main.py
- Tables: developments (for dev_name lookup on missing params)
- Last commit: 2026-04-14

### devdb_python/api/routers/ledger.py
- Owns: GET /ledger/{id} and /by-dev (monthly ledger by dev); GET /ledger/{id}/utilization (phase utilization bars + spec_count/build_count/undet_count per phase); GET /ledger/{id}/lots (lot-level rows with pipeline dates + projected dates + building_group_id + is_spec; ORDER BY real-before-sim then building_group_id ASC NULLS LAST so building groups are contiguous); GET /ledger/{id}/delivery-schedule (one row per event+dev: date, source, phases, units, D/U/UC inventory at delivery month)
- Imports: api.deps, psycopg2.extras, fastapi
- Imported by: api/main.py
- Tables: v_sim_ledger_monthly, sim_ent_group_developments, developments, sim_dev_phases, sim_delivery_events, sim_delivery_event_phases, sim_lots, sim_legal_instruments, sim_phase_product_splits, ref_lot_types
- Last commit: 2026-04-15

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
- Owns: query_lot_phase_view(ent_group_id, conn) — full lot-phase-view query logic extracted from eg_views.py; _sort_phases_for_display() helper; dev_id lookup uses sim_ent_group_developments (authoritative) not developments.community_id; lot queries include lot_source IN ('real','pre'); all joins use developments.dev_id directly (no dim_development bridge)
- Imports: api.db, api.models.lot_models, api.sql_fragments, fastapi, re
- Imported by: routers/eg_views.py
- Tables: sim_entitlement_groups, sim_ent_group_developments, developments, sim_legal_instruments, sim_dev_phases, sim_lots, ref_lot_types, sim_phase_product_splits
- Last commit: 2026-04-14

### devdb_python/services/lot_assignment_service.py
- Owns: Lot phase reassignment, lot-type change, lot unassignment with validation and audit logging; accepts lot_source IN ('real','pre') — rejects only 'sim' lots
- Imports: psycopg2.extras, dataclasses
- Imported by: routers/lots.py
- Tables: sim_lots, sim_dev_phases, sim_ent_group_developments, sim_phase_product_splits, ref_lot_types, dim_projection_groups, sim_assignment_log
- Last commit: 2026-04-05

### devdb_python/services/ledger_service.py
- Owns: Ledger query logic extracted from routers/ledger.py; query_ledger_by_dev(conn, ent_group_id) — bounded date range, synthetic start-date rows; _ledger_row() dict serializer includes str_plan_spec, str_plan_build, community_county_id, community_county_name, community_sd_id, community_sd_name. Entitlement event overlay removed (sim_entitlement_events dropped in migration 025). All joins use developments.dev_id directly (no dim_development bridge).
- Imports: api.db.dict_cursor
- Imported by: routers/ledger.py
- Tables: v_sim_ledger_monthly, sim_entitlement_groups, sim_ent_group_developments, sim_lots, developments, ref_counties, ref_school_districts
- Last commit: 2026-04-16

### devdb_python/services/phase_assignment_service.py
- Owns: Phase-to-instrument reassignment with entitlement group validation and audit logging
- Imports: psycopg2.extras, dataclasses
- Imported by: routers/phases.py
- Tables: sim_dev_phases, sim_legal_instruments, sim_ent_group_developments, sim_lots, dim_projection_groups, sim_assignment_log
- Last commit: 2026-03-26
