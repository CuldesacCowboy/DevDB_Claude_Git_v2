# DevDB -- Claude Code Reference
*Last updated: April 2026 (2026-04-23) | Architecture v20 | Decision Log: D-001 through D-168 | Next ID: D-169 | Migrations: 001–084*
<!-- session 2026-04-21b: building-group date invariant enforcement — S-0500 HC sync (MAX hold per group); S-0760/S-0770/S-0850 lag caching per group; S-1050 unconditional HC mate sync + D-lot exclusion; S-0770 extended to write all four projected dates; fixes Deer Creek TH 1/8/7 start pattern -->
<!-- session 2026-04-21: D-167 sim lot under-generation fix — kernel D-status exclusion + sim_floor_date gate removal + S-0800 deferred-start <= delivery; DC Meadows now 80/80 lots; 6/6 kernel tests pass -->
<!-- session 2026-04-20: HC scheduling horizon rule; S-0500 past-checkpoint skip; S-0760 HC/BLDR conflict resolution; LotLedger column sort; UI provenance styles + XX NNN lot format -->
<!-- session 2026-04-19b: MARKSConnection + sync_marks.py (D-166); coordinator domain-logic cleanup -->
<!-- session 2026-04-15: Abbey Farms pipeline fixed (5 cascading bugs); feed_starts_mode per-community toggle added -->

---

## Working Style

**Always use the Task list (`TaskCreate` / `TaskUpdate` / `TaskList`) for any multi-step task.** Create a task per discrete step at the start, mark each `in_progress` before starting and `completed` when done. This gives visible progress on longer implementations and keeps explanatory text minimal between steps. Don't wait for permission to use it — on any request that's more than a single edit, create tasks first.

---

## Current Build Status

| Phase | Status | Notes |
|---|---|---|
| Architecture | Complete | v16 -- Architecture, Decision Log, Module Map, Scenario Pack all v16 |
| Databricks cleanup | Complete | v1/v2 tables dropped, devdb_sim schema dropped |
| Schema creation | Complete | 01_schema_create_v10.sql confirmed clean in Databricks -- 26 tables |
| Seed migration | Complete | ref_lot_types (25), sim_dev_phases (175 real + 5 synthetic), sim_dev_defaults (111 devs + 3 synthetic), dim_projection_groups (83 real + 3 synthetic), sim_lots (3139 real lots + synthetic fixtures) |
| Lot type migration | Complete | Superseded by D-095. ref_lot_types seeded with 25 rows (11 sub-types 101-111, 5 PG-level types 201-205). Old Access types 1-64 deactivated. No further migration needed. |
| Building group migration | Complete | sim_building_groups (239), sim_lots updated (528 of 3139 lots assigned) |
| Delivery event seed data | Complete | Fixture data removed -- ent_group 9001 (SCENARIO_TEST_Waterton_Station) deleted. Production delivery events DE-9010/9011/9012 remain under ent_group 9002 (Waterton Station). |
| TDA scenario fixtures | Complete | tda_id=9001, lot_ids 9001-9030, 3 checkpoints (Scenario 2) |
| HC scheduling horizon | Complete | scheduling_horizon_days flows through build_lag_curves to tda_preclear; past checkpoints skip HC assignment (gap recorded only); hc_bldr_date_projector clears date_td_hold_projected when demand path covers lot before hold date |
| schedhousedetail load | Complete | Originally 266,554 rows from CSV; now served via postgres_fdw from marks_mirror (271,603 rows, always fresh). |
| Engine modules | Complete | All starts and supply pipeline modules PASS. Convergence coordinator PASS. Engine modules renamed from numbered codes to descriptive names 2026-04-24 (D-168): execution order now defined by STARTS_SEQUENCE/SUPPLY_SEQUENCE metadata lists in coordinator.py. marks_builder_sync implemented 2026-04-15: reads devdb_ext.housemaster, applies MARKS builder_id to real/pre lots before builder_assignment split assignment. building_group_enforcer and post_gen_chronology_guard implemented 2026-03-25. placeholder_rebuilder fix 2026-04-14: phases with real entitled lots but no demand signal (available_capacity=0) now schedule correctly; pd.NaT normalized to None; `date_ent IS NOT NULL` check survives lot_date_propagator multi-iteration write-back. placeholder_rebuilder tier fixes 2026-04-15: (1) tier gate in active dict; (2) sort dev_phases by (tier, seq); (3) tier check in inner co-bundling loop; (4) feed_starts_mode bypass for aggressive batching. demand_allocator fix: empty lot_snapshot no longer short-circuits unmet demand. temp_lot_generator fix: deferred-start logic -- lots pre-delivery date spread at 1/month after delivery. frozen_input_builder: phase capacity sorted by (tier, seq, phase_id). Building group enforcement (2026-04-14): building_group_sync (real lot group sync), demand_allocator building-group-aware allocation, temp_lot_generator grouped sim lot generation with phase_building_config, building_group_enforcer, FrozenInput.phase_building_config field, migration 056 (sim_phase_building_config table). All 14/14 Pokemon tests and 6/6 kernel scenarios pass. TDA fixes 2026-04-18/19: tda_preclear NULL guards for checkpoint_number and lots_required_cumulative (crash fixes); tda_preclear DB+in-memory pre-clear extended to also wipe stale date_td_projected written by hc_bldr_date_projector so _available() sees clean lots each iteration; hc_bldr_date_projector new stage -- after demand_generator, runs demand allocator, writes date_td_projected for HC-held lots (first of allocated demand month); coordinator wired hc_bldr_date_projector between demand_generator and kernel pass. Building-group date invariant (2026-04-21): tda_preclear syncs MAX(date_td_hold_projected) to all group mates post-assign + extended pre-clear for group mates; hc_bldr_date_projector caches (lag_str_cmp, lag_cmp_cls) per building_group_id so all HC mates share identical CMP/CLS; d_bldr_date_projector extended to write all four projected dates (BLDR/STR/CMP/CLS) not just BLDR, also caches lag per group; timing_expansion adds bg_cls_lag cache alongside existing bg_cmp_lag so sim lots share CLS; real_lot_projections HC group-mate sync runs unconditionally (not gated on pace block) and now syncs BLDR too; real_lot_projections excludes D-status lots from pace model and pre-clear. |
| End-to-end run | Complete | Verified 2026-04-04. D-119 guard working: first auto event Nov 27 (last locked Oct 26). One delivery date per year per ent-group confirmed. D-139 cross-dev bundling confirmed (Jun 29: Pointe ph.4 + Village ph.4 + SC ph.2). D/U/UC at delivery counts coherent. |
| Delivery months architecture | Complete | Migration 030: delivery_window_start/end replaced with delivery_months integer[] on sim_entitlement_delivery_config. placeholder_rebuilder and delivery_date_assigner rewritten to use frozenset for valid_months. Supports arbitrary month sets (e.g. Nov-Dec only, or year-boundary windows). |
| Pokemon test suite | Complete | 14 Pokemon communities (Scenarios 1–14), all 14/14 passing. Converted from window_start/end to delivery_months arrays (migration 030 compatible). |
| Test mode UI toggle | Complete | TEST button in nav bar; exclusive filter — test mode shows only is_test communities, normal mode shows only non-test. Persisted to localStorage (devdb_show_test_communities). All three views (LotPhaseView, SitePlanView, SimulationView) respect the toggle. |
| Delivery month picker UI | Complete | SimulationView DeliveryConfigSection: 1×12 month grid (MonthGrid component), Select All, Clear, Apply Standard Window, Edit Standard Window. Standard window configurable and persisted to localStorage (devdb_delivery_standard_months). |
| MARKS data source | Complete | Migration 082: postgres_fdw replaces local devdb_ext tables with foreign tables pointing at marks_mirror DB (FinancialTracker's synced copy of MARKSystems MySQL). 10 devdb_ext tables + schedhousedetail now read live from marks_mirror. Zero code changes — all existing queries work unchanged. Migration 083: housenumber type mismatch fix (marks_mirror VARCHAR vs old INTEGER); engine/API queries updated to LPAD text comparison. |
| Delivery groups | Complete | Migration 081: delivery_group CHAR(1) A-Z on sim_dev_phases. P-0050: group enforcement pulls same-group phases into same event; group exclusivity rule blocks non-group phases from group dates; locked group dates pre-blocked. p_pre_locked: pulls unlocked group members into locked events. Admin API + PhaseTab + DeliveryScheduleTab all support delivery_group. |
| Weekly ledger | Complete | Real lot-date aggregation via generate_series week spine (Mon-Sun). GET /ledger/{id}/weekly endpoint. SimulationView weekly period mode with lazy loading. |
| FK cascade audit | Complete | Lot delete cascades sim_tda_lot_bank_members + sim_lot_date_overrides. Community delete cascades full TDA chain (leaf→parent). Delivery event delete cascades predecessor both directions. runBulk in LotPillGroup checks res.ok and surfaces errors. |
| Delivery schedule config | Complete | DeliveryScheduleTab: per-phase rows with inline editable Order (sequence_number), Tier (delivery_tier), Group (delivery_group A-Z), Date (projected/locked), Source (click to toggle lock). Sort buttons: Date/Instrument/Order/Tier/Group. Yellow "re-run" banner on config changes. |
| Rules Validator | Complete | SimulationView "Rules Validator" tab. 22 rules in 3 categories: Config Completeness (product splits, starts target, builder splits, delivery config, ledger dates); Delivery Rules (window, delivery-after-entitlement, max/yr, tier ordering with grid timeline, group simultaneous with group cards, group exclusivity, sequence ordering with instrument grid, all scheduled, locked honored); Engine Diagnostics (chronology, builder coverage, spec/build, building group sync, TDA fulfillment with checkpoint table, demand/capacity, convergence, pipeline monotonicity). Article-style expandable detail per rule: explanation, methodology, full data tables, visual diagrams (tier grid with staircase layout + common prefix stripping, sequence grid, pipeline diagram, group cards), written conclusions. Failed rules show fix directions + navigation buttons to correct page/tab. auto_schedule_enabled stripped (migration 084). S-0800 date_td clamped >= date_dev. P-0050 floors delivery dates to entitlement date. S-0500 HC under-assignment fix: projected_natural now counts lots with date_td_projected <= checkpoint instead of pace estimate. |
| Decision log | Current | D-162 added. Next ID: D-163. |
| React/FastAPI phase endpoints | Complete | Route ordering fixed — specific sub-routes now registered before catch-all /{phase_id}. DELETE /phases/{id}/lot-type and all phase endpoints visible in OpenAPI spec. |
| Session tooling | Complete | /start and /end Claude Code skills (.claude/skills/). Start_DevDB_Session.bat opens session windows via devdb_open_session_windows.ps1. Stop_DevDB.bat kills backend (uvicorn + detached python.exe), frontend (Vite), and Chrome DevDB windows. |
| Postgres migration | Complete | All 35 tables migrated from Databricks to local PostgreSQL 16 (devdb.devdb). migrate_to_postgres.py. 23.5s total. 266,554 schedhousedetail rows. Engine now runs against local Postgres. Run time 0.5s (was 7+ min on Databricks serverless). |
| Builder data | Complete | Three-tier priority: builder_id_override (user manual) > builder_id (MARKS via housemaster.csv import) > NULL (S-0900 assigns via splits). Migration 040: builder_id_override on sim_lots. Migration 041: marks_company_code on dim_builders. S-0900 extended to assign builder_id to real/pre lots with COALESCE(builder_id_override, builder_id) IS NULL before iteration loop. |
| Phase dev_id repair | Complete | Migrations 042-052. 042: fixed instruments+phases dev_id. 043: Abbey Farms restructure. 044: rebuilt sim_ent_group_developments. 045: rederived instrument dev_ids via bridge. 046: delivery_tier column. 047: Ranch Condos segd dual-row. 048: excluded lots from ledger view. 049: Valley Point instrument fix. 050: fixed sim_ent_group_developments to legacy ID space. 051: fixed sim_dev_phases.dev_id to legacy space (74 phases). 052: cleaned orphaned locked delivery event-phase links. |
| Dev ID space collapse | Complete | Migration 053: remapped dev_id in sim_legal_instruments, sim_dev_phases, sim_lots, sim_dev_params, sim_ent_group_developments from legacy dim_development.development_id to modern developments.dev_id. FK constraints added on all 5 tables. dim_development stays as historical reference only — no longer required for any join. All 15 router/service files updated to direct FK joins. Migration 054: moved Waterton Station Site Condo instrument (id=4) + 6 phases + 146 lots from Village dev (58) to SF dev (45). Waterton Station pipeline graph verified correct post-migration. |
| Convergence fix | Complete | Coordinator convergence check was keyed on delivery_event_id, which changes every iteration (P-0000 deletes+reinserts). Fixed to compare sorted lists of COALESCE(date_dev_actual, date_dev_projected)::text. Waterton Station (ent_group_id=9002) now converges in 1 iteration. |
| Historical delivery dates | Complete | 76 sim_dev_phases.date_dev_actual values imported from qrxPYM0C_03_Month.csv (LotsDeveloped > 0 in past months, matched to phases in sequence order). p_pre_locked_event_rebuilder derives delivery events automatically on next sim run. |
| React/FastAPI UI | In progress | React + FastAPI is the active UI. Streamlit was a prior prototype and is no longer active. D-149 is superseded. TDA pipeline dates (HC/BLDR/DIG) moved to sim_lots (migration 012). Global master controls, DIG module, reversible sorts, wider pills, text date input added. Simulation view: monthly ledger + lot ledger + delivery schedule audit tabs; sticky column headers on all three tables; phase utilization bars; always-visible starts-target editor; projected date display (italic blue) for real P lots; missing-params run warnings. Projection groups retired — dev_id is now the simulation grain. Empirical build lag curves replace constant lags. Real P lots receive projected STR/CMP/CLS dates via annual pace from sim_dev_params. Code-review polish complete: Error Boundary, shared API_BASE, FALLBACK_LOT_TYPES removed, traceback leak fixed, race-condition PKs fixed (migration 027 + all 4 routers). ConfigView 4-tab layout (Community / Development / Instrument / Phase): Community tab — ledger dates + delivery config (delivery_months MonthGrid, del/year) + County + SD inline dropdowns; Development tab — historical pace (YTD/last yr/2yr ago starts), unstarted lots, total projected, editable annual_starts_target + reactive supply label; Phase tab — full phase config spreadsheet with county/SD override columns. Bulk pre-MARKS lot creation: lot_source='pre' (pre-MARKS lots indistinguishable from real for assignment/sim purposes); BulkLotInsertModal with 2-step flow (counts per lot type → range editor + flat editable list); entry via '+' button on phase header in LotPhaseView and ConfigView Phase tab. SetupView: Community → Dev → Instrument → Phase tree with D/I/P/L subtotals, sortable communities, sticky sort header + summary row; hover-only add buttons; phase timestamps; lot type table per phase (Total/Active/Pending/Sim/Excl columns); lot pill expand with move/add/exclude actions; Buildings tab per phase; refactored from 1987-line SetupView.jsx into 5 focused files (SetupView + setupShared + PhaseRow + LotPillGroup + BuildingsTab). SetupView: DeliveryEventsSection removed — users never see delivery events; inline date_dev_actual field added to phase row header (teal badge, click-to-edit, PATCH /admin/phase/{id}). SetupView: instrument type editing — clickable badge dropdown in InstrumentRow (Plat / Site Condo / Traditional Condo / Metes & Bounds Splits / Other), PATCH /instruments/{id}/type; layout breathing room (wider container 1020px, indigo instrument rail, gray dev rail, more padding). Lot List: building group Bldg column (B1/B2/…), alternating teal/green row tints per group, 2px teal separator between groups; building_group_id added to /ledger/{id}/lots response; sort order updated (real before sim, then by building_group_id). Spec/build flag: is_spec BOOLEAN on sim_lots (TRUE=spec, FALSE=build, NULL=undetermined), spec_rate NUMERIC(5,4) on sim_legal_instruments (S-0950 assigns undetermined lots by instrument rate). SimulationView: spec/build filter on lot ledger, STR(S)/STR(B) lines on velocity chart, stacked STR bars, utilization panel breakdown; county/SD filter dropdowns on monthly ledger. ConfigView Instrument tab: editable spec_rate with 4 hint buttons (6mo/2yr weighted average from codetail). Builder splits moved from phase level to instrument level (migration 064, sim_instrument_builder_splits); ConfigView Instrument tab now has editable builder % columns; Phase tab solo/grouped toggle removed. County/SD three-tier cascade: community (ent_group) → phase override → lot SD exception (migrations 065-072). ref_school_districts has no county FK — SD and county are independent dimensions. 78 communities seeded with county+SD. Community status field (migration 073): manual entry, 7 values (Active/Prospective/Sold Out/Unlikely/Abandoned/OFFSITE/OTHER), seeded for all 78 communities; surfaced in ConfigView Community tab (colored dropdown), SetupView community row (pill badge), SimulationView picker ([status] label). TakedownView.jsx: standalone redesign — pill tabs to switch between TDAs per community (one AgreementCard visible at a time), expandable checkpoint slot list (▶/▼ per checkpoint row, one slot per required takedown filled with lot data or "— open slot —"), lot pool section shows only unassigned lots with checkbox bulk move/remove, Add Lots picker uses pill grid. POST /takedown-agreements/{tda_id}/lots/move: move lots between TDAs in same ent_group, clears source assignments and pool, adds to target pool. Historical 2023 TDA import (import_done_tab.py): reads Done tab from 2026 spreadsheet, creates closed TDAs for Graymoor/Hidden Shores/Stonewater SF/Stony Bluff/West Point/Woods of Albright. Stonewater Condos TDA 7042 split into 3 phase-based TDAs (Ph1=SC1-27, Ph2=SC28-50, Ph3=SC51-73). Lot ledger fix 2026-04-19: API now fetches date_td_projected and date_td_hold_projected from sim_lots; LotLedger.jsx projected cells now use those values (were hardcoded null). TakedownView MARKS footer tooltip corrected. |
| Site Plan module | In progress | PDF upload, parcel trace, rotation, phase boundary split/edit all complete. Phase assignment (side panel) complete. Shared-vertex drag with topology enforcement complete. Boundary coloring: stroke always dark, fill by instrument color (auto-assigned, user-overridable via color picker in right panel). Selected boundary draws on top (SVG sort). Phase panel regrouped by legal instrument. Instrument colors persisted in localStorage per ent-group. Stonewater instruments created (SF Plat=12, Condos=13); phases linked. Lot bank (left panel): 179 Stonewater lots loadable; drag-to-place, click-to-set loop with floating End Placing button and cursor tooltip, lot-on-map drag. Save/discard bar; point-in-polygon phase assignment on save; lots outside all polygons returned to bank. Migration 016: sim_lot_site_positions. UX refactor: collapsible LotBank + PhasePanel (28px strip when closed), phase name primary in boundary list, stronger selected highlight (#ede9fe + 4px bar + swatch ring), mode instructions moved to canvas overlay pill, toolbar cleanup (renamed Edit Vertices / Split Region), Phases panel header simplified. Topology invariants: normalizeSharedVertices (snaps near-coincident vertices across all boundaries, tol=2e-4) runs pre-save after every split; Clean Up toolbar button runs it on demand. Delete-with-merge: handleDeleteBoundary finds most-shared-vertex neighbor, calls mergeAdjacentPolygons before deleting. Vertex snap (snapToVertices) takes priority over edge snap in split mode — ensures splits anchored at corners stay exact. Granular undo: trace mode pops last point (traceUndoSignal counter prop), place mode undoes last lot placement (placeHistory stack). Undo button visible in trace and place modes. Rotation persistence: saved to localStorage per planId. Coordinate system: all boundary/lot coords stored in unrotated normalized space; rotation transform applied at render time (PDF.js CW convention). PhasePanel redesigned: removed boundary list, renamed to Phases, gray/black text by assignment state, click-to-select highlights region, X button unassigns polygon to unassigned bar, drag-drop between phases (swap/reassign) and to unassigned bar. Unassigned regions bar (right panel): collapsible, drag-to-assign, click-to-select for click-assign workflow. Building groups: toggle shows/hides dashed ovals; Draw Group tool (freehand + multi-point click, phase-scoped, confirmation panel); Delete Groups tool (click ovals to select, right-click context menu, toolbar delete N groups). Last community auto-restored from localStorage. Right-panel tabs: Phase Assignment + Unit Counts. Unit Counts: r/p/t by phase/lot-type; compressed/expanded toggle; instrument color swatches; editable p-values (teal style, blur/Enter saves); map overlay toggle ("Totals" / "Lot Types" buttons): Totals mode renders table card (header + single "Total" row), Lot Types mode renders table card with per-lot-type rows; both modes show phase name above card; P values in both modes rendered as green pill (fill #f0fdfa, stroke #0d9488, rx=3) matching right-pane P style; polygon label placement fixed (nearest lot to vertex avg, stays inside concave polygons); zoom scaling clamped (sqrt curve); + Add product type per phase; delete product type when p=0, r=0 with confirmation banner. PdfCanvas split: UnitCountsOverlay, BuildingGroupsLayer, LotMarkersLayer extracted (1675→1248 lines). |

**Update this table at the start of each Claude Code session to reflect actual current state.**

---

## What This System Does

DevDB tracks residential lot inventory through a development pipeline for JTB Homes. Each lot moves through a sequential pipeline from raw land entitlement through home closing. The system projects that pipeline forward to support sales planning, land acquisition, and operational scheduling.

**Technology stack:** Local Python simulation engine (devdb_python/engine/, pandas + psycopg2) + local PostgreSQL 16 (devdb.devdb schema) + Databricks for MARKsystems data source (schedhousedetail, one-time migration) + React frontend + FastAPI backend (active UI). Streamlit was a prior prototype and is no longer active.

---

## The Lot Pipeline

```
P (Paper) -> E (Entitled) -> D (Developed) -> U (Unstarted) -> UC (Under Construction) -> C (Completed) -> OUT (Closed)
```

Special state: **H (Held)** -- between D and U. Drains to U when released.

**Pipeline status is always derived from date fields -- never stored:**
```
date_cls populated              -> CLS
date_cmp populated, no cls      -> C
date_str populated, no cmp      -> UC
date_td_hold populated, no td   -> H
date_td populated, no str       -> U
date_dev populated, no td       -> D
date_ent populated, no dev      -> E
all null                        -> P
```

**MARKsystems activity code mapping:**
```
135  -> Takedown (D->U or H->U)
136  -> Hold date (D->H) -- maps to date_td_hold
A05  -> Start (U->UC) -- maps to date_str
F15  -> Frame (milestone only) -- maps to date_frm
V86  -> Completion (UC->C) -- maps to date_cmp
V96  -> Closing (C->OUT) -- maps to date_cls
```

**schedhousedetail date priority (per milestone):**
```
1. actualfinishdate  (if populated AND inactive IS NULL OR inactive != 'Y')
2. rvearlyfinshdate
3. earlyfinishdate
4. null
```

NOTE: inactive null guard is required. Spark evaluates null != 'Y' as null, not True.
Use resolve_marks_date() helper in 04_engine_starts_pipeline.py for all MARKsystems date priority logic.

**schedhousedetail join key:**
```python
_dev_code = REGEXP_EXTRACT(lot_number, r'^([A-Z]+)', 1)         # string
_lot_seq  = CAST(REGEXP_EXTRACT(lot_number, r'([0-9]+)$', 1) AS INT)
# Join: lots._dev_code = sched.developmentcode (STRING)
#   AND lots._lot_seq  = sched.housenumber (INT)
```

---

## Core Design Principles

1. **Lot-level simulation.** Every lot gets its own row in sim_lots with specific projected dates. Monthly aggregates are COUNT of lots with events in a given month -- no fractions, no carry.
2. **Two lot types.** lot_source = 'real' (from MARKsystems/homesite) or 'sim' (engine-generated).
3. **lot_source is immutable.** Never change lot_source after creation. Real lots are always real. No exceptions.
4. **MARKsystems owns milestone dates only.** Everything else is DevDB-native.
5. **Access database is retired.** Used for one-time seed only. DevDB owns all records from that point forward.
6. **Pipeline status is derived, never stored.**
7. **Builder is a split parameter, not a grain axis.** Projection group grain = Development x Lot Type x County x School District.
8. **Phases are legal instruments.** May contain multiple lot types. Never split phases by product type. Projection group assignment derived at lot level via lot_type_id.
9. **Full entitlement group runs only.** Any projection group simulation triggers a full entitlement group run. Partial runs forbidden.
10. **Deterministic pipeline modules.** Never write a single simulation loop. Never collapse modules.
11. **Databricks does not enforce constraints.** PRIMARY KEY and UNIQUE constraints are informational only. All migration insert steps must include delete guards (D-086).
12. **Parameter injection.** Modules needing config data (phase capacity, builder splits) receive it as parameters, not read from DB internally. Enables fixture-based testing.

---

## Pill Sizing Rule — NEVER VIOLATE

Every pill in this UI (phase pill, instrument container, development container) must always be content-sized. This is non-negotiable and applies to every feature, every fix, every session, forever.

Rules:
- NO fixed heights on any pill, container, or wrapper at any level of the hierarchy
- NO overflow: hidden on any pill or container (use overflow: visible)
- NO min-height or max-height that would clip content
- Every pill must grow and shrink naturally with its content at all times

This applies to ALL states:
  - When inline forms expand (add product type, add phase, delete confirm)
  - When lot-type blocks are added or removed
  - When projected counts change (more or fewer placeholder lot pills)
  - When lot pills are dragged in or out
  - When text wraps in headers

If you add a feature that expands content inside a pill and the pill does not grow to fit, the bug is ALWAYS a fixed height, overflow:hidden, or a max-height somewhere in the ancestor chain. Find it and remove it.

The equalization logic in usePhaseEqualization.js runs after paint to match row heights across siblings — that is fine and expected. But the pills themselves must always be naturally sized BEFORE equalization runs.

---

## Rules for Claude Code Sessions

- **After every file change:** `git add`, `git commit` with descriptive message, `git push`. Do not wait.
- **After every completed update:** tell the user which restarts are needed — frontend, backend, both, or neither — using this logic:
  - Frontend restart needed: any change to `devdb_ui/src/` files
  - Backend restart needed: any change to `devdb_python/api/` or `devdb_python/engine/` or `devdb_python/services/` files, or any new migration file in `devdb_python/migrations/`
  - Neither: changes only to docs, CLAUDE.md, scripts, or config files
- **Never `git push` alone** without staging and committing first.
- **Never write a single simulation loop.** 12 starts modules + 8 supply modules + coordinator.
- **All SQL for Databricks must be plain ASCII only.** No Unicode.
- **Check DevDB_Architecture_v20.docx, DevDB_Decision_Log_v20.docx, DevDB_Module_Map_v20.docx before any architectural decision.**
- **Check DevDB_Scenario_Pack_v20.docx before implementing any module.**
- **Check DevDB_Divergence_v20.docx for known divergences before writing any code.**
- **Update Current Build Status table** when a phase completes.
- **lot_source is immutable.** If you are writing code that changes lot_source, stop. That is wrong.
- **Before implementing any behavior:** which module owns it? Which modules must remain untouched?
- **gap_fill_engine true-gap rule (D-084, D-085):** A lot with only date_dev and no downstream dates must pass through gap_fill unchanged. Do not fill forward from a single anchor.
- **TDA fulfillment (D-087):** Both date_td and date_td_hold count toward checkpoint obligations.
- **Databricks constraints (D-086):** Never rely on PRIMARY KEY or UNIQUE to prevent duplicates. Always add delete guards to insert steps.
- **resolve_marks_date() (D-029):** Use this helper for all MARKsystems date priority logic. Never inline the priority logic.
- **sim_delivery_event_predecessors column name:** 'event_id' not 'delivery_event_id'.
- **Notebook edits go through Claude Code only.** Never edit notebooks directly in Databricks without committing from the Databricks Git panel immediately after.
- **Export notebooks before pulling.** Always export updated notebooks from Databricks to the local git folder before pulling new changes.
- **Messages to Claude Code must be a single uninterrupted code block.** This ensures the copy button in the upper right of the frame captures the entire message in one click. Never split a CC message across multiple blocks or prose sections.

---

## Schema Change Rules

- **Every DDL change must be a numbered migration file in `devdb_python/migrations/` before being applied to the database.** Never apply schema changes directly in psql without a corresponding migration file in the repo.
- Migration files are numbered sequentially: `000_`, `001_`, `002_`, etc.
- The auto-apply runner in `api/main.py` applies unapplied migrations on every backend startup. New files are picked up automatically.
- After creating a migration file, grep `devdb_python/` for all references to renamed or dropped columns and update every one before committing.

---

## Reference Docs

All task-specific knowledge extracted from CLAUDE.md. Read the relevant doc(s) when your task requires them.

| Doc | Path | Load when task involves |
|---|---|---|
| API Contract | `.claude/docs/api-contract.md` | FastAPI routers, endpoint contracts, Pydantic models |
| Engine Reference | `.claude/docs/engine-reference.md` | Simulation engine, coordinator, delivery scheduling, P-0000/S-0600, ledger, Databricks context |
| Schema Reference | `.claude/docs/schema-reference.md` | SQL queries, schema DDL, migrations, test fixtures, building groups |
| Decision Log | `.claude/docs/decision-log.md` | Any specific D-number, TDA/delivery/scheduling behavior, "why was X built this way?" |
| File Manifest — Frontend | `.claude/docs/file-manifest-frontend.md` | React pages, components, hooks, utils, Vite config |
| File Manifest — Backend | `.claude/docs/file-manifest-backend.md` | FastAPI routers, Pydantic models, services |
| File Manifest — Engine | `.claude/docs/file-manifest-engine.md` | Engine modules, coordinator, kernel, tests |
| File Manifest — Migrations | `.claude/docs/file-manifest-migrations.md` | Schema migrations |
| File Manifest — Config | `.claude/docs/file-manifest-config.md` | Session tooling, bat/ps1 scripts, skill files |

*Source of truth for Claude Code sessions. Full architecture: DevDB_Architecture_v20.docx. Decision rationale: DevDB_Decision_Log_v20.docx. Module ownership: DevDB_Module_Map_v20.docx. Truth cases: DevDB_Scenario_Pack_v20.docx. Divergence audit: DevDB_Divergence_v20.docx.*
