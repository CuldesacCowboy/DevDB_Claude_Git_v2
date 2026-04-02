# DevDB File Manifest

This manifest covers every file touched by git in the last 60 days (as of 2026-03-29).
Use it to orient quickly when editing: find the file, see what it owns and which tables it
touches before making changes. Keep this section updated when files are added or deleted.

---

#### Backend (devdb_python/api/)

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

### devdb_python/api/routers/entitlement_groups.py
- Owns: CRUD for sim_entitlement_groups; GET /{id}/lot-phase-view aggregating instruments/phases/lots; GET /{id}/split-check (phases with no product splits); GET /{id}/param-check (all devs with starts-target status — joins through dim_development)
- Imports: api.deps, api.models.lot_models, psycopg2.extras
- Imported by: api/main.py
- Tables: sim_entitlement_groups, developments, dim_development, sim_legal_instruments, sim_dev_phases, sim_lots, sim_phase_product_splits, ref_lot_types, sim_ent_group_developments, sim_dev_params
- Last commit: 2026-04-02

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

### devdb_python/api/routers/takedown_agreements.py
- Owns: TDA read and write endpoints (Slice A + Slice B); agreement list, checkpoint detail, lot assignment, HC/BLDR/DIG projected date editing; PATCH rename endpoint; sequence-based assignment_id (no MAX+1 race)
- Imports: api.deps, psycopg2.extras, pydantic, fastapi
- Imported by: api/main.py
- Tables: sim_takedown_agreements, sim_takedown_checkpoints, sim_takedown_lot_assignments, sim_lots, sim_entitlement_groups
- Last commit: 2026-04-02

### devdb_python/api/routers/phases.py
- Owns: Phase CRUD, lot-type split management; DELETE /{phase_id}/lot-type registered BEFORE DELETE /{phase_id} (route ordering is intentional)
- Imports: api.deps, api.models.phase_models, services.phase_assignment_service, psycopg2.extras
- Imported by: api/main.py
- Tables: sim_dev_phases, sim_legal_instruments, ref_lot_types, sim_phase_product_splits, sim_phase_builder_splits, sim_delivery_event_phases, sim_lots (devdb. prefix on DELETE lot-type queries)
- Last commit: 2026-04-02

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

### devdb_python/api/routers/phases.py (updated)
- Added: GET /{phase_id}/product-splits — returns all splits with lot type labels and actual counts
- Last commit: 2026-04-01

### devdb_python/api/routers/entitlement_groups.py (updated)
- Added: GET /{ent_group_id}/split-check — returns phases with no product splits (pre-run warning for D-100)
- Last commit: 2026-04-01

### devdb_python/api/routers/simulations.py
- Owns: POST /simulations/run — triggers convergence_coordinator for an ent_group_id; returns status, iterations, elapsed_ms, errors[]; looks up dev names for missing_params_devs via dim_development bridge
- Imports: engine.coordinator, fastapi, pydantic, time, traceback, psycopg2.extras
- Imported by: api/main.py
- Tables: dim_development, developments (for dev_name lookup on missing params)
- Last commit: 2026-04-02

### devdb_python/api/routers/ledger.py
- Owns: GET /ledger/{id} and /by-dev (monthly ledger by dev); GET /ledger/{id}/utilization (phase utilization bars); GET /ledger/{id}/lots (lot-level rows with pipeline dates + projected dates); joins through dim_development for dev_name
- Imports: api.deps, psycopg2.extras, fastapi
- Imported by: api/main.py
- Tables: v_sim_ledger_monthly, sim_ent_group_developments, dim_development, developments, sim_dev_phases, sim_lots, sim_legal_instruments, sim_phase_product_splits, ref_lot_types
- Last commit: 2026-04-02

### devdb_python/api/db.py
- Owns: Database utility helpers shared across routers; dict_cursor(conn) replaces repeated conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) boilerplate
- Imports: psycopg2.extras
- Imported by: all routers, services/ledger_service.py
- Tables: none
- Last commit: 2026-04-02

### devdb_python/api/sql_fragments.py
- Owns: Shared SQL fragment helpers; lot_status_sql(alias) returns the lot pipeline-status CASE expression (OUT > C > UC > H > U > D > E > P) for use in f-string queries
- Imports: none
- Imported by: routers/developments.py, routers/entitlement_groups.py, routers/ledger.py
- Tables: none
- Last commit: 2026-04-02

### devdb_python/services/ledger_service.py
- Owns: Ledger query logic extracted from routers/ledger.py; query_ledger_by_dev(conn, ent_group_id) — bounded date range, entitlement event overlay, synthetic start-date rows; _ledger_row() dict serializer
- Imports: api.db.dict_cursor
- Imported by: routers/ledger.py
- Tables: v_sim_ledger_monthly, sim_entitlement_groups, sim_ent_group_developments, sim_lots, sim_entitlement_events, dim_development, developments
- Last commit: 2026-04-02

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

---

#### Frontend (devdb_ui/src/)

### devdb_ui/src/main.jsx
- Owns: React DOM entry point, StrictMode wrapper
- Imports: react, react-dom, App.jsx
- Imported by: index.html
- Tables: none
- Last commit: 2026-03-26

### devdb_ui/src/App.jsx
- Owns: React Router shell with routes for LotPhaseView, SitePlanView, SimulationView
- Imports: react-router-dom (BrowserRouter, Routes, Route, NavLink), LotPhaseView, SitePlanView, SimulationView
- Imported by: main.jsx
- Tables: none
- Last commit: 2026-04-01

### devdb_ui/src/pages/SimulationView.jsx
- Owns: Simulation run trigger, monthly ledger view (by-dev), lot ledger tab (LotLedger with projected-date display in italic blue), phase utilization bars (UtilizationPanel), always-visible starts-target editor (SimParams), run-error warning banner, view toggle (Monthly Ledger / Lot List)
- Imports: react (useState, useEffect, useCallback)
- Imported by: App.jsx
- Tables: none (API calls via /api/simulations/run, /api/ledger, /api/entitlement-groups, /api/developments/{id}/sim-params)
- Last commit: 2026-04-02

### devdb_ui/src/pages/LotPhaseView.jsx
- Owns: Main lot-phase view orchestrator; tab shell (Developments / Legal Instruments); community picker sidebar; add instrument inline form (replaces modal — expands in page header matching TDA pattern)
- Imports: dnd-kit, react, hooks (useLotPhaseData, useDragHandler, usePhaseEqualization), components, CommunityDevelopmentsView
- Imported by: App.jsx
- Tables: none (API calls via /api/entitlement-groups, /api/developments, /api/instruments, /api/phases)
- Last commit: 2026-04-02

### devdb_ui/src/pages/CommunityDevelopmentsView.jsx
- Owns: Community-development assignment view; unassigned dev panel; community pills; alphabet slider; drag-to-create-community
- Imports: dnd-kit, react, Toast
- Imported by: LotPhaseView.jsx
- Tables: none (API calls via /api/entitlement-groups, /api/developments)
- Last commit: 2026-03-28

### devdb_ui/src/pages/TakedownAgreementsView.jsx
- Owns: Takedown agreement management view orchestrator; wires TdaNavBar, TdaPageHeader, UnassignedBank, TdaCard, CheckpointBand, TdaDragOverlay, ContextMenu; manages context menu state; threads dragLot for landing zone highlights; contextMenuItems is useMemo([contextMenu, detail, agreements, ...callbacks]); handleContextMenu is useCallback
- Imports: dnd-kit, react (useState, useCallback, useEffect, useMemo), useTdaData, useTdaDragHandler, LeftPanel, TdaPageHeader, CheckpointBand, TdaCard, TdaDragOverlay, TdaNavBar, ContextMenu
- Imported by: LotPhaseView.jsx (as tab)
- Tables: none (API calls via /api/takedown-agreements)
- Last commit: 2026-04-01

### devdb_ui/src/pages/SitePlanView.jsx
- Owns: Site plan page orchestrator; ent-group picker; plan creation (PDF upload); mode management (view/trace/edit/split/place/delete-phases); lot bank + positioning state (lotPositions, savedPositions, placeQueue, placeHistory, isDirty); granular undo: traceUndoSignal (increments to pop trace points in PdfCanvas), placeHistory stack ({lotId, prevPos}) for per-placement undo; delete-with-merge: handleDeleteBoundary finds best neighbor via shared-vertex count, calls mergeAdjacentPolygons before DELETE; normalizeSharedVertices called pre-save after every split; handleCleanupPolygons (toolbar "Clean Up" button); PhasePanel (inline — phase name primary, collapsible 28px strip, × delete per boundary); LotBank + PhasePanel collapse state; mode instruction overlay (floating pill); save/discard bar; point-in-polygon phase assignment on save; instrument colors in localStorage per ent-group
- Imports: react (useState, useEffect, useRef, useCallback, useMemo, Component), PdfCanvas, LotBank, splitPolygon (normalizeSharedVertices, mergeAdjacentPolygons)
- Imported by: App.jsx
- Tables: none (API calls via /api/site-plans, /api/phase-boundaries, /api/entitlement-groups, /api/lot-positions)
- Last commit: 2026-04-02

### devdb_ui/src/components/SitePlan/PdfCanvas.jsx
- Owns: PDF rendering canvas; parcel trace mode (traceUndoSignal prop — increment pops last point); parcel edit mode (all vertices including phase boundaries, shared-vertex drag, snap-to-vertex); split mode (bestSplitSnap = vertex snap priority over edge snap; click-to-draw polyline, intersection auto-finalize); pan/zoom (CSS transform); normalized↔screen coordinate conversion; buildSharedGroup (Union-Find, SHARED_VERTEX_TOL=1e-5); findSnapForDrag; performSplit calls splitPolygon then onSplitConfirm; phaseColorMap prop (phase_id→color); boundary stroke always #1e293b, fill by assignment; PDF load error state + loading overlay
- Imports: pdfjs-dist, react, splitPolygon (distToSeg, snapToVertices, snapToBoundaries, findFirstBoundaryIntersection, splitPolygon, findBestSplit)
- Imported by: SitePlanView.jsx
- Tables: none (API calls via onParcelSaved, onSplitConfirm, onBoundaryUpdated props)
- Last commit: 2026-04-02

### devdb_ui/src/components/SitePlan/LotBank.jsx
- Owns: Left panel on the site plan page showing unpositioned lots grouped by legal instrument; lot pills are draggable (HTML5 DnD) and clickable (enters click-to-set loop); active placing lot highlighted with instrument color; groups use stable insertion order; collapsed prop renders 28px vertical strip with label + expand button
- Imports: react (useMemo)
- Imported by: SitePlanView.jsx
- Tables: none
- Last commit: 2026-04-02

### devdb_ui/src/components/SitePlan/splitPolygon.js
- Owns: Polygon split geometry utilities; distToSeg; segIntersect; snapToVertices (vertex-priority snap — exact corners, same return shape as snapToBoundaries); snapToBoundaries (snap cursor to boundary edge, normPoint via t-interpolation in normalized space); findFirstBoundaryIntersection (normPoint via u-interpolation); insertOnBoundary (projects input onto closest edge, detects existing vertex within 1e-6 to avoid duplicates); splitPolygon (insert start/end on ring, build two arcs + interior); findBestSplit (measures interior polyline length per polygon, returns best split target + clipped line); normalizeSharedVertices (snaps vertices within tol=2e-4 across all boundaries to identical positions — returns only changed entries); mergeAdjacentPolygons (removes shared boundary between two adjacent polygons and returns merged outer polygon — used by delete-with-merge)
- Imports: none
- Imported by: PdfCanvas.jsx, SitePlanView.jsx
- Tables: none
- Last commit: 2026-04-02

### devdb_ui/src/components/InstrumentContainer.jsx
- Owns: Draggable/droppable legal instrument card with phase columns, aggregate lot-type totals, inline rename; warm neutral card chrome (#F0EEE8 header, #F7F6F3 body) matching TDA aesthetic; green dashed inline name edit (#3B6D11/#EAF3DE)
- Imports: dnd-kit, react, PhaseColumn, computeCols
- Imported by: LotPhaseView.jsx
- Tables: none
- Last commit: 2026-04-01

### devdb_ui/src/components/PhaseColumn.jsx
- Owns: Phase card with per-lot-type split rows, inline name edit, add product type form, delete confirm, auto-delete lot type on 0/0/0
- Imports: dnd-kit, react, LotCard, LotTypePill
- Imported by: InstrumentContainer.jsx
- Tables: none (API calls via /api/phases)
- Last commit: 2026-03-29

### devdb_ui/src/components/LotTypePill.jsx
- Owns: Lot-type product split card with editable projected count and droppable lot grid
- Imports: dnd-kit (useDroppable), react, LotCard
- Imported by: PhaseColumn.jsx
- Tables: none
- Last commit: 2026-03-29

### devdb_ui/src/components/LotCard.jsx
- Owns: Draggable lot pill (icon mode) and list-view card (lot number + status)
- Imports: dnd-kit (useDraggable)
- Imported by: LotTypePill.jsx, UnassignedColumn.jsx
- Tables: none
- Last commit: 2026-03-27

### devdb_ui/src/components/ProjectionGroupContainer.jsx
- Owns: Development-level wrapper for all instruments; equalized row heights; aggregate counts; warm neutral card chrome (#F0EEE8 header, #F7F6F3 body) matching TDA aesthetic
- Imports: dnd-kit, react, InstrumentContainer
- Imported by: LotPhaseView.jsx
- Tables: none
- Last commit: 2026-04-01

### devdb_ui/src/components/UnassignedColumn.jsx
- Owns: Sticky panel of lots with phase_id = NULL; droppable for unassign operations
- Imports: dnd-kit (useDroppable), LotCard
- Imported by: LotPhaseView.jsx
- Tables: none
- Last commit: 2026-03-27

### devdb_ui/src/components/Toast.jsx
- Owns: Auto-dismiss toast notification component
- Imports: react (useEffect)
- Imported by: LotPhaseView.jsx, CommunityDevelopmentsView.jsx
- Tables: none
- Last commit: 2026-03-26

### devdb_ui/src/components/CheckpointBand.jsx
- Owns: Checkpoint band row; EditableNumber (with onEditingChange callback), show/hide lots, expanded/condensed view toggles, select-all checkbox for bulk drag, landing zone highlight (isValidDrop), right-click context menu passthrough; localDate/localTotal sync from props guarded by editingDate/editingTotal flags; date input is controlled (value+onChange, no key workaround)
- Imports: react, dnd-kit (useDroppable), LotPill, StitchConnector, PlaceholderPill, CheckpointTimeline, tdaUtils
- Imported by: TakedownAgreementsView.jsx
- Tables: none
- Last commit: 2026-04-01

### devdb_ui/src/components/CheckpointTimeline.jsx
- Owns: Checkpoint timeline visualization extracted from TakedownAgreementsView
- Imports: react
- Imported by: TakedownAgreementsView.jsx
- Tables: none
- Last commit: 2026-03-31

### devdb_ui/src/components/LeftPanel.jsx
- Owns: UnassignedBank only (TdaPoolBank and OtherTdaTile removed -- pool moved into TdaCard, nav replaced by TdaNavBar); landing zone highlight via dragLot prop; onContextMenu on lot pills
- Imports: react, dnd-kit (useDraggable, useDroppable), tdaUtils (parseLot)
- Imported by: TakedownAgreementsView.jsx
- Tables: none
- Last commit: 2026-04-01

### devdb_ui/src/components/LotPill.jsx
- Owns: Assigned lot pill (expanded + condensed modes); PlaceholderPill (expanded + condensed); StitchConnector; LockIcon; LockBtn; ProjectedDateField; isSelected highlight; onContextMenu passthrough
- Imports: dnd-kit (useDraggable), react, tdaUtils (fmt, shortLot, parseLot)
- Imported by: CheckpointBand.jsx
- Tables: none
- Last commit: 2026-04-01

### devdb_ui/src/components/TdaCard.jsx
- Owns: TDA card shell; EditableTdaName (green dashed inline editor, PATCH on save); PoolSection (inline In Agreement droppable with pool lot pills, landing zone highlight); add-checkpoint form
- Imports: react, dnd-kit (useDraggable, useDroppable), tdaUtils (parseLot)
- Imported by: TakedownAgreementsView.jsx
- Tables: none
- Last commit: 2026-04-01

### devdb_ui/src/components/TdaDragOverlay.jsx
- Owns: Drag overlay component for TDA view; renders floating pill during drag
- Imports: dnd-kit, react, LotPill
- Imported by: TakedownAgreementsView.jsx
- Tables: none
- Last commit: 2026-03-31

### devdb_ui/src/components/TdaPageHeader.jsx
- Owns: Page header (community name, mutation status, New Agreement form); select dropdown removed -- navigation now in TdaNavBar
- Imports: react
- Imported by: TakedownAgreementsView.jsx
- Tables: none
- Last commit: 2026-04-01

### devdb_ui/src/components/TdaNavBar.jsx
- Owns: Horizontal TDA navigation bar; clickable pills (name + lot count) for all community agreements; active pill highlighted green; replaces OtherTdaTile left-panel section
- Imports: react
- Imported by: TakedownAgreementsView.jsx
- Tables: none
- Last commit: 2026-04-01

### devdb_ui/src/components/ContextMenu.jsx
- Owns: Right-click context menu; backdrop overlay; keyboard Escape to close; viewport clamping; renders action items from caller
- Imports: react (useEffect)
- Imported by: TakedownAgreementsView.jsx
- Tables: none
- Last commit: 2026-04-01

### devdb_ui/src/hooks/useLotPhaseData.js
- Owns: Data fetching and caching for entitlement group lot-phase view (instruments, phases, lots)
- Imports: react (useState, useEffect, useCallback, useMemo)
- Imported by: LotPhaseView.jsx
- Tables: none (GET /api/entitlement-groups/{id}/lot-phase-view)
- Last commit: 2026-03-28

### devdb_ui/src/hooks/useDragHandler.js
- Owns: Centralized drag-drop state machine for lots, phases, instruments with API mutation dispatch
- Imports: dnd-kit (sensors, arrayMove), react
- Imported by: LotPhaseView.jsx
- Tables: none (API calls via /api/lots, /api/phases)
- Last commit: 2026-03-28

### devdb_ui/src/hooks/usePhaseEqualization.js
- Owns: Per-row phase container height equalization after paint; solo-dev detection for column widths
- Imports: react (useState, useRef, useLayoutEffect)
- Imported by: LotPhaseView.jsx
- Tables: none
- Last commit: 2026-03-29

### devdb_ui/src/hooks/useTdaData.js
- Owns: Data fetching for TDA view -- agreement list, checkpoint detail, lot assignments; HC/BLDR projected date and lock state management; all TDA mutations including renameTda (PATCH /takedown-agreements/{id}); res.ok checks on all mutations; AbortController cleanup on fetchAgreements and fetchDetail useEffects
- Imports: react (useState, useEffect, useCallback), src/config.js
- Imported by: TakedownAgreementsView.jsx
- Tables: none (API calls via /api/takedown-agreements)
- Last commit: 2026-04-01

### devdb_ui/src/hooks/useTdaDragHandler.js
- Owns: Drag orchestration for TDA view; manages dnd-kit sensors, drag state, drop dispatch; selectedAssignedLotIds for checkpoint lot multi-select; toggleAssignedCheckpointSelection for header select-all; pool-lot other-tda branch uses Promise.all for parallel moves
- Imports: dnd-kit, react
- Imported by: TakedownAgreementsView.jsx
- Tables: none
- Last commit: 2026-04-01

### devdb_ui/src/config.js
- Owns: Centralized API base URL and frontend config constants
- Imports: none
- Imported by: useTdaData.js and other hooks/components needing API base URL
- Tables: none
- Last commit: 2026-03-31

### devdb_ui/src/utils/computeCols.js
- Owns: Optimal column-count calculation for instrument band given available width and phase count
- Imports: none
- Imported by: InstrumentContainer.jsx
- Tables: none
- Last commit: 2026-03-27

### devdb_ui/src/utils/tdaUtils.js
- Owns: TDA domain utility functions extracted from TakedownAgreementsView (formatting, status helpers, etc.)
- Imports: none
- Imported by: TakedownAgreementsView.jsx and TDA components
- Tables: none
- Last commit: 2026-03-31

### devdb_ui/src/utils/tdaContextMenu.js
- Owns: Context menu policy for TDA view — pure helper: (type, lotIds, detail, agreements, callbacks) → items[]; extracted from TakedownAgreementsView to keep the page as orchestration/wiring only
- Imports: none
- Imported by: TakedownAgreementsView.jsx
- Tables: none
- Last commit: 2026-04-01

### devdb_ui/src/utils/layoutEngine.js
- Owns: DELETED -- replaced by computeCols.js (CSS-first approach)
- Imports: n/a
- Imported by: n/a
- Tables: none
- Last commit: 2026-03-27

### devdb_ui/vite.config.js
- Owns: Vite build config; React + Tailwind plugins; /api proxy to localhost:8765 with path rewrite stripping /api prefix
- Imports: vite, @vitejs/plugin-react, @tailwindcss/vite
- Imported by: build process
- Tables: none
- Last commit: 2026-03-26

---

#### Migrations (devdb_python/migrations/)

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

### devdb_python/migrations/020_min_unstarted_inventory.sql
- Owns: Adds min_unstarted_inventory column (INTEGER NULL) to sim_entitlement_delivery_config; P-00 uses this to schedule deliveries before full exhaustion to maintain a buffer
- Tables: sim_entitlement_delivery_config (ADD COLUMN IF NOT EXISTS)
- Last commit: 2026-04-02

### devdb_python/migrations/021_ledger_features.sql
- Owns: (1) Adds ledger_start_date (DATE NULL) to sim_entitlement_groups; (2) Creates sim_entitlement_events table (event_id, ent_group_id, dev_id, event_date, lots_entitled); (3) Adds per-status floor columns (min_p/e/d/u/uc/c_count) to sim_entitlement_delivery_config; migrates min_unstarted_inventory → min_d_count
- Tables: sim_entitlement_groups, sim_entitlement_events (CREATE), sim_entitlement_delivery_config (ADD COLUMNS)
- Last commit: 2026-04-02

### devdb_python/migrations/016_lot_site_positions.sql
- Owns: Creates devdb.sim_lot_site_positions table (lot_id PK, plan_id, x, y DOUBLE PRECISION, updated_at); creates index on plan_id; wrapped in DO $$ IF NOT EXISTS guard
- Tables: sim_lot_site_positions (CREATE TABLE + INDEX)
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

### devdb_python/migrations/add_display_order.py
- Owns: Superseded by 011_add_display_order.sql. Original standalone migration that added display_order to sim_dev_phases.
- Tables: sim_dev_phases
- Last commit: 2026-03-29

---

#### Engine (devdb_python/engine/)

### devdb_python/engine/connection.py
- Owns: PGConnection wrapper -- connects to local Postgres with search_path=devdb; used by all engine modules
- Imports: psycopg2, dotenv
- Imported by: coordinator.py, all engine modules
- Tables: none (connection factory)
- Last commit: 2026-03-25

### devdb_python/engine/coordinator.py
- Owns: Convergence coordinator — runs starts pipeline then supply pipeline per ent_group; loops until convergence (max 10); _write_real_lot_projections writes date_str/cmp/cls_projected to real P lots at annual pace from sim_dev_params (independent of sim-lot capacity); returns (iterations, missing_params_devs)
- Imports: engine modules s0100-s1200, p0000-p0800, kernel.plan, kernel.FrozenInput, psycopg2.extras, dateutil.relativedelta
- Imported by: routers/simulations.py, tests/test_coordinator.py
- Tables: reads/writes via all pipeline modules; sim_lots (projected date columns), sim_dev_params
- Last commit: 2026-04-02

### devdb_python/engine/s0100_lot_loader.py
- Owns: S-0100 -- loads real lots for ent_group from sim_lots into a DataFrame
- Imported by: coordinator.py
- Tables: sim_lots (SELECT real lots for ent_group)
- Last commit: 2026-03-25

### devdb_python/engine/s0200_date_actualizer.py
- Owns: S-0200 -- applies MARKsystems actual milestone dates to real lots via schedhousedetail join; uses resolve_marks_date() priority
- Imported by: coordinator.py
- Tables: sim_lots (UPDATE date_* fields), schedhousedetail (SELECT)
- Last commit: 2026-03-25

### devdb_python/engine/s0300_gap_fill_engine.py
- Owns: S-0300 -- fills true-gap missing dates (requires anchor on both sides per D-084/D-085)
- Imported by: coordinator.py
- Tables: sim_lots (UPDATE date_* fields in-memory DataFrame)
- Last commit: 2026-03-25

### devdb_python/engine/s0400_chronology_validator.py
- Owns: S-0400 -- detects date ordering violations; returns violation list without modifying lots
- Imported by: coordinator.py
- Tables: sim_lots (SELECT read-only)
- Last commit: 2026-03-25

### devdb_python/engine/s0500_takedown_engine.py
- Owns: S-0500 -- TDA gap-fill; writes date_td_hold per D-087 using checkpoint_lead_days
- Imported by: coordinator.py
- Tables: sim_lots (UPDATE date_td_hold), sim_takedown_agreements, sim_takedown_checkpoints, sim_takedown_agreement_lots
- Last commit: 2026-03-25

### devdb_python/engine/s0600_demand_generator.py
- Owns: S-0600 -- generates monthly demand series for each phase; vectorized; capacity-capped per D-138
- Imported by: coordinator.py
- Tables: sim_dev_phases, sim_phase_product_splits, sim_lots (SELECT)
- Last commit: 2026-03-27

### devdb_python/engine/s0700_demand_allocator.py
- Owns: S-0700 -- allocates demand slots to real/sim lots; positional merge; no carry-forward
- Imported by: kernel/planning_kernel.py
- Tables: none (pure DataFrame transform)
- Last commit: 2026-03-25

### devdb_python/engine/s0800_temp_lot_generator.py
- Owns: S-0800 -- generates sim lots for unmet demand; date_str = demand slot month; date_td = date_str per D-137/D-142
- Imported by: kernel/planning_kernel.py
- Tables: none (builds DataFrame; persistence is in s1100)
- Last commit: 2026-03-25

### devdb_python/engine/s0810_building_group_enforcer.py
- Owns: S-0810 -- enforces MIN(date_str) per building_group_id across sim lots per D-133
- Imported by: kernel/planning_kernel.py
- Tables: none (pure DataFrame transform)
- Last commit: 2026-03-25

### devdb_python/engine/s0820_post_generation_chronology_guard.py
- Owns: S-0820 -- discards sim lots with chronology violations post-generation; warns on fully-cleared phases
- Imported by: kernel/planning_kernel.py
- Tables: none (pure DataFrame filter)
- Last commit: 2026-03-25

### devdb_python/engine/s0900_builder_assignment.py
- Owns: S-0900 -- assigns builder_id to sim lots from sim_phase_builder_splits; builder splits passed as parameter
- Imported by: coordinator.py
- Tables: sim_phase_builder_splits (read parameter; no direct DB query)
- Last commit: 2026-03-25

### devdb_python/engine/s1000_demand_derived_date_writer.py
- Owns: S-1000 -- writes MIN(date_str) per phase to sim_dev_phases.date_dev_projected
- Imported by: coordinator.py
- Tables: sim_dev_phases (UPDATE date_dev_projected)
- Last commit: 2026-03-25

### devdb_python/engine/s1100_persistence_writer.py
- Owns: S-1100 -- atomic DELETE+INSERT of sim lots; assigns lot_id via MAX(lot_id)+offset per D-086
- Imported by: coordinator.py
- Tables: sim_lots (DELETE sim rows, INSERT new sim rows)
- Last commit: 2026-03-26

### devdb_python/engine/s1200_ledger_aggregator.py
- Owns: S-1200 -- creates/replaces v_sim_ledger_monthly view; COUNT-based pipeline stage counts
- Imported by: coordinator.py
- Tables: v_sim_ledger_monthly (CREATE OR REPLACE VIEW over sim_lots)
- Last commit: 2026-04-02

### devdb_python/engine/p0000_placeholder_rebuilder.py
- Owns: P-0000 -- rebuilds placeholder delivery events per D-139 cross-dev scheduling lean rule; D-balance floor enforcement using min_d_count/per-status floors from sim_entitlement_delivery_config
- Imported by: coordinator.py
- Tables: sim_delivery_events, sim_delivery_event_phases, sim_dev_phases, sim_entitlement_delivery_config (SELECT/INSERT/UPDATE)
- Last commit: 2026-04-02

### devdb_python/engine/p0100_actual_date_applicator.py
- Owns: P-0100 -- applies locked delivery event dates to sim_dev_phases.date_dev_projected per D-112/D-125
- Imported by: coordinator.py
- Tables: sim_dev_phases (UPDATE), sim_delivery_events, sim_delivery_event_phases (SELECT)
- Last commit: 2026-03-25

### devdb_python/engine/p0200_dependency_resolver.py
- Owns: P-0200 -- resolves delivery event predecessor chains; uses event_id column (not delivery_event_id)
- Imported by: coordinator.py
- Tables: sim_delivery_events, sim_delivery_event_predecessors (SELECT)
- Last commit: 2026-03-25

### devdb_python/engine/p0300_constraint_urgency_ranker.py
- Owns: P-0300 -- ranks phases by delivery urgency based on inventory exhaustion
- Imported by: coordinator.py
- Tables: sim_dev_phases, sim_lots, sim_phase_product_splits (SELECT)
- Last commit: 2026-03-25

### devdb_python/engine/p0400_delivery_date_assigner.py
- Owns: P-0400 -- assigns delivery dates to placeholder events; never moves placeholder earlier than P-0000 wrote per D-141
- Imported by: coordinator.py
- Tables: sim_delivery_events (UPDATE), sim_dev_phases (SELECT)
- Last commit: 2026-03-25

### devdb_python/engine/p0500_eligibility_updater.py
- Owns: P-0500 -- updates phase delivery eligibility flags after date assignment; uses event_id column
- Imported by: coordinator.py
- Tables: sim_delivery_events, sim_delivery_event_predecessors (SELECT/UPDATE)
- Last commit: 2026-03-25

### devdb_python/engine/p0600_phase_date_propagator.py
- Owns: P-0600 -- propagates delivery event dates to child phases' date_dev_projected unconditionally per D-123
- Imported by: coordinator.py
- Tables: sim_dev_phases (UPDATE), sim_delivery_event_phases, sim_delivery_events (SELECT)
- Last commit: 2026-03-25

### devdb_python/engine/p0700_lot_date_propagator.py
- Owns: P-0700 -- propagates phase date_dev_projected to sim lots and real lots where date_dev IS NULL per D-113
- Imported by: coordinator.py
- Tables: sim_lots (UPDATE date_dev)
- Last commit: 2026-03-25

### devdb_python/engine/p0800_sync_flag_writer.py
- Owns: P-0800 -- writes needs_rerun and sync status flags to sim_dev_phases
- Imported by: coordinator.py
- Tables: sim_dev_phases (UPDATE)
- Last commit: 2026-03-25

---

#### Kernel (devdb_python/kernel/)

### devdb_python/kernel/frozen_input.py
- Owns: FrozenInput dataclass -- immutable snapshot of all data the planning kernel needs; assembled by coordinator before plan() call
- Imports: dataclasses, pandas
- Imported by: coordinator.py, kernel/planning_kernel.py, kernel/frozen_input_builder.py
- Tables: none (pure dataclass)
- Last commit: 2026-03-25

### devdb_python/kernel/frozen_input_builder.py
- Owns: Builds FrozenInput from database queries; all DB access for kernel inputs is here
- Imports: engine.connection, frozen_input
- Imported by: coordinator.py
- Tables: sim_lots, sim_dev_phases, sim_phase_product_splits, sim_entitlement_delivery_config (SELECT)
- Last commit: 2026-03-27

### devdb_python/kernel/planning_kernel.py
- Owns: plan() entry point -- wires S-0700 through S-0820 sequentially; pure function (no DB access)
- Imports: frozen_input, proposal, proposal_validator, s0700, s0800, s0810, s0820
- Imported by: coordinator.py
- Tables: none (pure transform)
- Last commit: 2026-03-26

### devdb_python/kernel/proposal.py
- Owns: Proposal dataclass -- output of plan(); holds generated sim lots DataFrame and warnings
- Imports: dataclasses, pandas
- Imported by: planning_kernel.py, coordinator.py
- Tables: none
- Last commit: 2026-03-25

### devdb_python/kernel/proposal_validator.py
- Owns: Validates a Proposal against business rules before coordinator accepts it
- Imports: proposal, frozen_input
- Imported by: planning_kernel.py
- Tables: none (pure validation)
- Last commit: 2026-03-27

---

#### Tests (devdb_python/tests/)

### devdb_python/tests/test_s01_s04.py
- Owns: Tests for starts pipeline S-0100 through S-0400 (lot_loader, date_actualizer, gap_fill_engine, chronology_validator)
- Imports: engine modules s0100-s0400, pytest
- Tables: sim_lots, schedhousedetail (via test fixtures)
- Last commit: 2026-03-25

### devdb_python/tests/test_s05_s08.py
- Owns: Tests for S-0500 through S-0800 (takedown_engine, demand_generator, demand_allocator, temp_lot_generator)
- Imports: engine modules s0500-s0800, pytest
- Tables: sim_lots, sim_takedown_*, sim_dev_phases, sim_phase_product_splits (via fixtures)
- Last commit: 2026-03-27

### devdb_python/tests/test_s0810_s0820.py
- Owns: Tests for S-0810 (building_group_enforcer) and S-0820 (post_generation_chronology_guard)
- Imports: s0810, s0820, pytest
- Tables: none (DataFrame-only tests)
- Last commit: 2026-03-25

### devdb_python/tests/test_s09_s12.py
- Owns: Tests for S-0900 through S-1200 (builder_assignment, demand_derived_date_writer, persistence_writer, ledger_aggregator)
- Imports: engine modules s0900-s1200, pytest
- Tables: sim_lots, sim_dev_phases, sim_phase_builder_splits (via fixtures)
- Last commit: 2026-03-25

### devdb_python/tests/test_p01_p08.py
- Owns: Tests for supply pipeline P-0100 through P-0800
- Imports: engine modules p0100-p0800, pytest
- Tables: sim_delivery_events, sim_dev_phases, sim_lots (via fixtures)
- Last commit: 2026-03-25

### devdb_python/tests/test_coordinator.py
- Owns: End-to-end convergence test for coordinator (ent_group_id=9002)
- Imports: engine.coordinator, pytest
- Tables: all (runs full pipeline against local Postgres)
- Last commit: 2026-03-25

### devdb_python/tests/test_kernel_scenarios.py
- Owns: Scenario-pack tests for planning kernel (FrozenInput fixtures, Scenario 1-10 truth cases)
- Imports: kernel.planning_kernel, kernel.frozen_input, pytest
- Tables: none (pure DataFrame fixtures)
- Last commit: 2026-03-26

---

#### Docs / Config (root level and misc)

### CLAUDE.md
- Owns: Primary session bootstrap — architecture rules, decision log, build status. File manifest and API contract extracted to .claude/docs/
- Last commit: 2026-04-01

### .claude/docs/file-manifest.md
- Owns: File manifest — every file touched by git in the last 60 days; Owns/Imports/Tables/Last-commit per file
- Last commit: 2026-04-01

### .claude/docs/api-contract.md
- Owns: FastAPI router contracts — all endpoints, tables, guards, response shapes
- Last commit: 2026-04-01

### devdb_python/requirements.txt
- Owns: Python dependency list (fastapi, uvicorn, psycopg2, pandas, python-dotenv, pydantic, pytest)
- Last commit: 2026-03-26

### devdb_python/migrate_to_postgres.py
- Owns: One-time migration script from Databricks to local PostgreSQL 16; not run in normal operation
- Tables: all 35 tables (reads from Databricks, inserts to local Postgres)
- Last commit: 2026-03-25

### devdb_python/scripts/seed_developments.py
- Owns: One-time seed script populating the developments table from dim_development bridge
- Tables: developments (INSERT), dim_development (SELECT)
- Last commit: 2026-03-26

### devdb_python/scripts/backfill_community_id.py
- Owns: One-time script backfilling community_id on developments from sim_ent_group_developments
- Tables: developments (UPDATE), sim_ent_group_developments (SELECT)
- Last commit: 2026-03-26

### Start_DevDB.bat
- Owns: Windows batch file to start both uvicorn backend and Vite frontend in one command
- Last commit: 2026-03-28

### Stop_DevDB.bat
- Owns: Windows batch file to stop backend (uvicorn + detached python.exe on port 8765), frontend (Vite), and Chrome DevDB windows; uses PowerShell + taskkill /F /T
- Last commit: 2026-03-30

### Start_DevDB_Session.bat
- Owns: Session startup bat — opens DevDB session windows via devdb_open_session_windows.ps1
- Last commit: 2026-03-30

### devdb_open_session_windows.ps1
- Owns: PowerShell script that opens all DevDB session windows (backend terminal, frontend terminal, browser, Claude Code terminal snapped to right half of right screen)
- Last commit: 2026-03-30

### .claude/skills/start/SKILL.md
- Owns: /start skill — reads CLAUDE.md and selected reference docs based on task; acknowledges today's task
- Last commit: 2026-04-01

### .claude/skills/end/SKILL.md
- Owns: /end skill — updates CLAUDE.md and .claude/docs/file-manifest.md, commits, pushes
- Last commit: 2026-04-01

### 01_schema_create_postgres.sql
- Owns: Reference copy of the full PostgreSQL schema DDL (not run by migration runner -- archival only)
- Tables: all core tables (CREATE reference)
- Last commit: 2026-03-25
