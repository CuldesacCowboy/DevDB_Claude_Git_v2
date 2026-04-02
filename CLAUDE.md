# DevDB -- Claude Code Reference
*Last updated: April 2026 (2026-04-02) | Architecture v20 | Decision Log: D-001 through D-152 | Next ID: D-153*

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
| schedhousedetail load | Complete | 266,554 rows loaded from 3-part CSV export |
| Engine modules | Complete | S-0100 through S-0900 PASS. S-1000 through S-1200 PASS. P-01 through P-08 PASS. Convergence coordinator PASS. S-0050 NOT IMPLEMENTED. S-0810 and S-0820 implemented 2026-03-25. |
| End-to-end run | Complete | ent_group_id=9002 converges in 1 iteration, 0.4s. 299 sim lots (PG 307: 167, PG 317: 72, PG 321: 60). 11 delivery events (2 locked + 9 auto-placeholder). All 3 PGs continuous starts Nov 2026–sellout. OQ-002 resolved: Village PG 317 D_end non-flat (0–19), drains correctly. OQ-003 resolved: 9 auto-events correct for 3 devs per D-139 cross-dev bundling. OQ-004 resolved: Village/Pointe ph.3-5 all linked by P-00. Confirmed 2026-03-25. |
| Decision log | Current | D-151 added. Next ID: D-152. |
| React/FastAPI phase endpoints | Complete | Route ordering fixed — specific sub-routes now registered before catch-all /{phase_id}. DELETE /phases/{id}/lot-type and all phase endpoints visible in OpenAPI spec. |
| Session tooling | Complete | /start and /end Claude Code skills (.claude/skills/). Start_DevDB_Session.bat opens session windows via devdb_open_session_windows.ps1. Stop_DevDB.bat kills backend (uvicorn + detached python.exe), frontend (Vite), and Chrome DevDB windows. End_DevDB_Session.bat, devdb_run_claude.py, devdb_generate_handoff.py, Save_DevDB_Window_Positions.bat, devdb_save_window_positions.ps1 removed. |
| Postgres migration | Complete | All 35 tables migrated from Databricks to local PostgreSQL 16 (devdb.devdb). migrate_to_postgres.py. 23.5s total. 266,554 schedhousedetail rows. Engine now runs against local Postgres. Run time 0.5s (was 7+ min on Databricks serverless). |
| React/FastAPI UI | In progress | React + FastAPI is the active UI. Streamlit was a prior prototype and is no longer active. D-149 is superseded. TDA pipeline dates (HC/BLDR/DIG) moved to sim_lots (migration 012). Global master controls, DIG module, reversible sorts, wider pills, text date input added. |
| Site Plan module | In progress | PDF upload, parcel trace, rotation, phase boundary split/edit all complete. Phase assignment (side panel) complete. Shared-vertex drag with topology enforcement complete. Boundary coloring: stroke always dark, fill by instrument color (auto-assigned, user-overridable via color picker in right panel). Selected boundary draws on top (SVG sort). Phase panel regrouped by legal instrument. Instrument colors persisted in localStorage per ent-group. Stonewater instruments created (SF Plat=12, Condos=13); phases linked. Lot bank (left panel): 179 Stonewater lots loadable; drag-to-place, click-to-set loop with floating End Placing button and cursor tooltip, lot-on-map drag. Save/discard bar; point-in-polygon phase assignment on save; lots outside all polygons returned to bank. Migration 016: sim_lot_site_positions. |

**Update this table at the start of each Claude Code session to reflect actual current state.**

---

## What Is In Databricks Right Now

**main.devdb -- surviving reference tables (untouched):**
- curve_points, curve_points_normalized, curve_sets
- dim_builders, dim_community, dim_county, dim_development
- dim_internal_external, dim_lot_type, dim_municipality
- dim_projection_groups_v1_backup (migration reference only)
- dim_projection_status, dim_school_district, dim_state

**main.devdb -- new v10 tables:** All 26 tables created and populated. schedhousedetail loaded.

**Volumes:**
- DevDBv01_Locked_20260302_Exports -- Access export CSVs
- schedhousedetail source files -- MARKsystems export (3 parts, 266,554 rows)

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

## Entity Hierarchy

```
sim_entitlement_groups
  sim_entitlement_delivery_config  (one row per group)
  sim_ent_group_developments       (junction to tbdDEVdev)

  tbdDEVdev
    sim_dev_defaults

    sim_delivery_events            (belongs to entitlement group, NOT individual development)
      sim_delivery_event_predecessors  (column: event_id, NOT delivery_event_id)
      sim_delivery_event_phases    (junction to sim_dev_phases)

    sim_legal_instruments
      sim_dev_phases
        sim_phase_product_splits
        sim_phase_builder_splits
        sim_lots
```

---

## Schema -- Core Tables

### sim_lots
```sql
lot_id                BIGINT PK        -- no IDENTITY; assigned by persistence_writer via MAX+offset (D-086)
projection_group_id   BIGINT FK
phase_id              BIGINT FK        -- -> sim_dev_phases
builder_id            INT
lot_source            STRING           -- 'real' or 'sim' -- IMMUTABLE AFTER CREATION
lot_number            STRING           -- hHSTidCode1 for real; null for sim
sim_run_id            BIGINT FK NULLABLE
lot_type_id           INT FK           -- -> ref_lot_types; determines projection group
building_group_id     BIGINT FK NULLABLE
date_ent              DATE
date_dev              DATE             -- set by lot_date_propagator from delivery event
date_td               DATE
date_td_hold          DATE             -- engine fills for TDA gap-fill only
date_str              DATE
date_str_source       STRING           -- 'actual','revised','scheduled','engine_filled','manual'
date_frm              DATE             -- informational only
date_cmp              DATE
date_cmp_source       STRING
date_cls              DATE
date_cls_source       STRING
created_at            TIMESTAMP
updated_at            TIMESTAMP
```

### sim_delivery_event_predecessors
```sql
id                    BIGINT PK
event_id              BIGINT           -- NOTE: column is 'event_id' not 'delivery_event_id'
predecessor_event_id  BIGINT
```

### sim_takedown_agreements
```sql
tda_id                BIGINT PK
tda_name              STRING
agreement_date        DATE
anchor_type           STRING
anchor_date           DATE
status                STRING           -- 'active', 'archived'
checkpoint_lead_days  INT              -- default 16; days before checkpoint to schedule hold
notes                 STRING
created_at            TIMESTAMP
updated_at            TIMESTAMP
```

---

## Gap-Fill Rules (D-084, D-085 -- CRITICAL)

gap_fill_engine fills a missing date **only when a known date exists on both sides of it** -- a true gap. A lot with only `date_dev` set and no downstream dates has **no gap**. It is a D-status lot waiting for allocation. gap_fill must NOT fill date_td, date_str, date_cmp, or date_cls on such a lot.

**Specific rules:**
- Fill `date_td`: only if `date_dev` is set AND at least one of `date_str`, `date_cmp`, `date_cls` already exists
- Fill `date_str`: only if `date_td` is set AND at least one of `date_cmp`, `date_cls` exists. Never on H lots.
- Fill `date_cmp`: only if `date_str` is set AND `date_cls` exists
- Fill `date_cls`: if `date_cmp` is set (forward terminus -- no right anchor needed)

**Fallback:** If lot has no anchor date at all, use phase delivery date as fallback and fill forward from there (tag engine_filled). This is the no-anchor exception only.

---

## TDA Rules (D-087)

Both `date_td` AND `date_td_hold` count toward checkpoint fulfillment. A lot is considered taken down if either is set and <= checkpoint_date. The engine only writes `date_td_hold` -- never `date_td`. Hold date = checkpoint_date - checkpoint_lead_days (default 16).

---

## Simulation Engine Rules

**Building group enforcement:**
- All units sharing building_group_id get identical date_str and date_cmp
- date_cls is projected independently per unit (same or different outcome -- both valid, D-075)
- Engine treats building group as one starts slot

**Delivery date assignment:**
- All child phases null demand_derived: skip event; leave projected null
- MIN outside window: latest permissible month before MIN; if none, first permissible + warning
- Dates only move earlier

**Curves:**
- str_to_cmp and cmp_to_cls draw from configured curve when set
- System default lag is last resort only

**Orphaned real lots:**
- Status source_deleted: flag; set needs_rerun; block simulation until user resolves
- Never automatically change lot_source or remove lots

**Temp lot cap:**
- Hard stop at sim_phase_product_splits capacity
- No automatic extension; flag gap; ledger shows it

**Auto-delivery scheduling:**
- Lean rule: deliver at latest_viable = exhaustion_date - 1 month, where exhaustion_date = previous_delivery + ceil(capacity / monthly_pace). Falls back to demand_date when no locked anchor exists (D-130, Revisit).
- Phases with null demand and zero sim lots are skipped (D-117). Phases beyond sellout horizon are skipped (D-118).
- No auto-scheduled event in same year as last locked event (D-119).
- Multi-phase grouping when single phase insufficient; all phases share same delivery date
- Predecessor forcing when needed; flag visibly

**Chronology violation resolution (Scenario 6):**
- Path A (batch-revise): clear offending date, re-fill from anchor using curve. Log as engine_corrected.
- Path B (keep): run proceeds with violation intact. Log as kept_as_is.
- User chooses path via UI prompt. Engine never silently fixes violations.

---

## Ledger View

v_sim_ledger_monthly: COUNT-based only. No arithmetic on lot values.
Output: ENT_plan, DEV_plan, TD_plan, STR_plan, CMP_plan, CLS_plan, P_end through C_end.
Builder sub-grouping via GROUP BY builder_id.
Runs against local Postgres via PGConnection. No USE CATALOG required.

---

## Scenario Pack

10 truth cases in DevDB_Scenario_Pack_v17.docx. Review before implementing any module.

| # | Scenario | Key modules |
|---|---|---|
| 1 | Multi-Product Convergence | Convergence coordinator, delivery_date_assigner |
| 2 | TDA Gap-Fill Insufficient Inventory | takedown_engine (D-087) |
| 3 | Building Group Mixed Close Dates | gap_fill_engine, demand_allocator |
| 4 | Real vs. Temp Competition | demand_allocator, persistence_writer |
| 5 | Happy Path Baseline | Full pipeline |
| 6 | Chronology Violation | chronology_validator |
| 7 | Gap-Fill No Anchor | gap_fill_engine |
| 8 | Locked Actuals | actual_date_applicator |
| 9 | Placeholder Auto-Scheduling | Auto-scheduler |
| 10 | Persistence Rollback | persistence_writer |

---

## Key Decisions for Coding

- **D-087** -- TDA checkpoint fulfillment counts both date_td and date_td_hold. Both satisfy the contractual obligation.
- **D-101** -- All-purpose clusters not available in this Databricks workspace (serverless-only). All simulation runs must go through the Jobs API, not interactive cluster attachment.
- **D-102** -- Simulation engine migrated to local Python package (devdb_python/engine/). PGConnection is active; DBConnection retained for one-time migration only.
- **D-103** -- Local PostgreSQL 16 is the simulation database. All 28 tables migrated from Databricks. Engine runs at 0.5s (was 7+ min). Databricks is now a historical data source only.
- **D-104** -- Postgres migration pattern: autocommit=True throughout, session_replication_role=replica, execute_values in 2000-row chunks, column filtering for schema divergence.
- **D-105** -- Lot type to PG map keyed by (dev_id, phase_lot_type_id) tuple via bridge join through ref_lot_types.proj_lot_type_group_id. Direct dim_projection_groups lookup by phase lot_type_id always fails (PG-level vs phase-level type IDs are different).
- **D-106** -- pg_hba.conf uses trust auth for 127.0.0.1/32 and ::1/128. PG_PASSWORD is empty string. localhost-only, no external exposure.
- **D-107** -- UI target was React + FastAPI. Revised by D-149.
- **D-149** -- React + FastAPI downgraded to long-term possible idea. Streamlit is the active UI. No committed timeline.
- **D-108** -- S-02 (date_actualizer) is the exclusive module that writes actual milestone dates from schedhousedetail back to sim_lots. resolve_marks_date() priority applies. No other module reads schedhousedetail.
- **D-109** -- Lot Inventory section reads end-of-period lot counts from v_sim_ledger_monthly, not directly from sim_lots.
- **D-110** -- v_sim_ledger_monthly D_end bucket: date_dev <= calendar_month AND (date_td IS NULL OR date_td > calendar_month) AND (date_td_hold IS NULL OR date_td_hold > calendar_month). Prior date_str guard was wrong once sim lots set date_td = date_str — it excluded all sim lots from D_end.
- **D-111** -- month_spine start date uses GREATEST('2020-01-01', COALESCE(MIN(LEAST(date_str, date_cmp, date_cls, date_dev)), '2020-01-01')) over real lots only. Fixed end '2046-01-01'.
- **D-112** -- P-01 earliest-date-wins: UPDATE includes AND (date_dev IS NULL OR date_dev > actual_date). Earlier actual dates win when multiple locked events share a phase.
- **D-113** -- P-07 real lot guard: AND date_dev IS NULL AND date_str IS NULL AND date_cmp IS NULL AND date_cls IS NULL. No blanket cleanup step. P-01 actuals on closed lots are legitimate and must not be cleared.
- **D-114** -- Fixture ent_group_id=9001 deleted from production database. Fixture data must never coexist with production data in the same database instance.
- **D-115** -- P-04 "never move later" guard applies only when cur >= today_first. Past projected dates are stale and always correctable forward.
- **D-117** -- P-00 skips phases with null demand and zero sim lots. No delivery event created.
- **D-118** -- P-00 skips phases with demand past sellout horizon (MAX(date_cls) across all sim lots for the ent_group).
- **D-119** -- No auto-scheduled delivery event may be dated in the same year as the last locked event. Floor = date(last_locked_year + 1, delivery_window_start, 1). delivery_window_start/end live in sim_entitlement_delivery_config (D-135).
- **D-120** -- A phase may only belong to one delivery event. Many-to-one enforced by data cleanup and UI constraint.
- **D-121** -- main.devdb. prefix removed from all 17 engine modules. Postgres uses search_path=devdb.
- **D-123** -- P-06 writes date_dev_projected unconditionally (removed "only update if earlier" guard).
- **D-124** -- Phase structure for Waterton Station ent_group 9002 corrected. Village: 5 phases. Pointe: 5 phases. WS SF: 2 plat + 6 site condo phases.
- **D-125** -- P-01 writes date_dev_actual to sim_dev_phases.date_dev_projected for all child phases of locked events so S-08's delivery floor fires on first run.
- **D-126** -- Site Condo phases use lot_type_id 101 (Single Family), not 111 (Condo). Waterton Court SC is SF product.
- **D-127** -- Delivery event phase links corrected for ent_group 9002. DE-9010: WS SF ph.1 + Village ph.1 + Pointe ph.1. DE-9011: WS Plat ph.2 + SC ph.1 + Village ph.2 + Pointe ph.2.
- **D-128** -- REVOKED by D-137. See D-137.
- **D-129** -- S-08 built slot pool in round-robin order across co-delivering phases. Superseded by D-137 rewrite — phases now fill sequentially.
- **D-130** -- P-00 lean rule: exhaustion_date = previous_delivery + (capacity / monthly_pace); latest_viable = exhaustion_date - 1 month. REVISIT: currently over-delivers buffer.
- **D-132** -- Module IDs changed to 4-digit format. Starts pipeline: S-0100 increments. Supply pipeline: P-0000/P-0100 increments.
- **D-133** -- S-0810 building_group_enforcer and S-0820 post_generation_chronology_guard added between S-0800 and S-0900. Not yet implemented.
- **D-134** -- BUG-007 building group enforcement deferred. Implement S-0810 during WT-CD/WV-CD condo PG setup.
- **D-135** -- delivery_window_start and delivery_window_end moved to sim_entitlement_delivery_config. Removed from sim_projection_params. All PGs in an ent_group share one delivery window.
- **D-136** -- S-0050 run_context_builder added as first starts pipeline module. Queries all parameter tables once per run. Not yet implemented.
- **D-137** -- D-128 REVOKED. date_str = demand slot month always, independent of date_dev. Every unmet demand slot produces exactly one temp lot. Sellout mandatory.
- **D-138** -- demand_start = first day of month after MAX(date_dev_actual) across locked delivery events for the ent_group. Falls back to run_start_date if no locked events.
- **D-139** -- P-0000 cross-dev scheduling: placeholder events scheduled by computing per-phase inventory exhaustion per dev, finding most urgent deadline across all devs in ent_group, bundling all devs whose deadline <= that date into one event. Expired locked phases (lv < today) excluded. Phases batched within a dev when single phase can't bridge to next allowable year. Each locked phase tracked independently — capacity and pace never aggregated across phases or PGs.
- **D-140** -- D_end bucket corrected: a lot is in D status at end of month when date_dev IS NOT NULL AND date_dev <= calendar_month AND (date_td IS NULL OR date_td > calendar_month). Previous date_str guard was wrong once sim lots got date_td = date_str (D-142).
- **D-141** -- P-0400 placeholder guard: for placeholder events, P-0400 must never move date_dev_projected earlier than what P-0000 wrote. P-0000's lean exhaustion date is authoritative. P-04 checks is_placeholder on the event and returns current if projected < cur.
- **D-142** -- S-0800 sim lot date_td: every sim lot gets date_td = date_str at creation. Sim lots never have TDAs. date_td = date_str for all sim lots regardless of product type.
- **D-143** -- P-0000 phase sort: phases sorted by sequence_number ascending, not demand_date. Demand dates are a signal only; sequence_number is the authoritative delivery order within a dev.
- **D-100** -- sim_phase_product_splits must be populated for every phase before simulation. If no rows exist for a projection group's phases, temp lot generation produces zero lots silently. User workflow dependency: populate splits via Setup Tools UI before running simulation.
- **D-099** -- Row(**kwargs) is banned in createDataFrame. Row stores fields alphabetically; createDataFrame with StructType maps by position -- always misaligns fields. Use a list of plain dicts (maps by name). Applies everywhere in the pipeline.
- **D-098** -- sim_phase_builder_splits.share is DECIMAL(10,4) in Databricks. Python raises TypeError when mixing decimal.Decimal with float literals. Always cast to float() before arithmetic: float(sum(...)), float(s["share"]) / total, round(float(split["share"]) * n).
- **D-086** -- lot_id on sim_lots has no IDENTITY property (Revisit). persistence_writer assigns lot_id via MAX(lot_id) + offset. Databricks Delta Lake does not enforce PRIMARY KEY/UNIQUE constraints -- all inserts need delete guards.
- **D-085** -- gap_fill_engine true-gap rule corrected: downstream-date guards added per D-084.
- **D-084** -- gap_fill_engine: true-gap-only rule. A lot with only date_dev set has no gap. Do not fill forward.
- **D-074** -- lot_source is immutable. No exceptions.
- **D-073** -- Orphaned real lots: manual resolution required before run.
- **D-068** -- Temp lot cap: hard stop at phase capacity.
- **D-058** -- Full entitlement group runs only. Partial runs forbidden.
- **D-057** -- Phases are legal instruments. Not split by product type.
- **D-053** -- All four docs regenerated together. No patch edits.
- **D-038** -- Engine is deterministic pipeline. Never collapse.
- **D-029** -- schedhousedetail date priority: null inactive = active (not 'Y'). Use resolve_marks_date() helper.
- **D-025** -- One active TDA per lot. Hard constraint.
- **D-022** -- Building group: shared date_str/date_cmp, independent date_cls, one starts slot.
- **D-012** -- date_cls independent per unit. Matching is not a failure condition.
- **D-006** -- Pipeline status derived from dates, never stored.

Flagged Revisit before go-live:
- **D-031** -- MARKsystems sync automation (currently manual CSV)
- **D-034** -- Lot type hierarchy flattening
- **D-086** -- lot_id IDENTITY column behavior

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

If you add a feature that expands content inside a pill and the pill does not grow to fit, the bug is ALWAYS a fixed height, overflow:hidden, or max-height somewhere in the ancestor chain. Find it and remove it.

The equalization logic in usePhaseEqualization.js runs after paint to match row heights across siblings — that is fine and expected. But the pills themselves must always be naturally sized BEFORE equalization runs.

---

## Rules for Claude Code Sessions

- **After every file change:** `git add`, `git commit` with descriptive message, `git push`. Do not wait.
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

## Decision Log — D-152

D-152: Pipeline dates (HC/BLDR/DIG) moved from sim_takedown_lot_assignments to sim_lots

HC (date_td_hold), BLDR (date_td), and DIG (date_str) projected dates and lock flags now
live on sim_lots as part of the D-151 system-wide companion-field pattern. All 7 pipeline
dates (ent, dev, td_hold, td, str, frm, cmp, cls) now have _projected and _is_locked
companions on sim_lots.

Previously HC/BLDR projected dates lived on sim_takedown_lot_assignments. This caused data
loss when a lot was dragged between checkpoints, because the assignment row was replaced.
Moving to sim_lots ensures projected dates and lock flags follow the lot regardless of
checkpoint or TDA membership.

MARKS date source corrections also applied: HC MARKS = date_td_hold (was incorrectly mapped
to date_str), BLDR MARKS = date_td (was incorrectly mapped to date_cmp).

Migration 012 handles the schema changes and data migration. The API fan-out for building-group
lots now targets sim_lots WHERE building_group_id matches AND lot_id IN
(SELECT lot_id FROM sim_takedown_agreement_lots WHERE tda_id = %s).

---

## Decision Log — D-151

D-151: TDA lock pattern — proof of concept for system-wide locked projected dates

The TDA form introduces HC/BLDR projected dates with per-field lock flags on
sim_takedown_lot_assignments. A LOCKED projected date behaves like a MARKsystems
actual: the engine treats it as a fixed anchor and simulates around it without
overwriting. An UNLOCKED projected date is freely assignable or overwritable by
the engine.

This is the first implementation of this pattern. The long-term intent is to
apply it system-wide: every date field on sim_lots (date_str, date_td, date_dev,
date_cmp, date_cls) will gain a companion is_locked flag, replacing the current
two-track model of actuals vs projected. That system-wide change is deferred and
requires its own design session before any sim_lots schema work begins.

For building group lots: when the user locks/edits an HC or BLDR date on any
unit, the API must fan out the write to all other sim_takedown_lot_assignments
rows sharing the same building_group_id within the same tda_id, in a single
atomic transaction.

---

## Building Group Mapping Status

Complete for 14 developments (585 lots): SC, CR, DT, JC, PC, RF, RP, TC, WP, WV, VI, WC, WT, WA.
No mapping required: HC, MC, BF, TD, TI.
Source: building_group_mapping_consolidated.csv

---

## Synthetic Test Fixtures (IDs >= 9001)

All synthetic fixture IDs use 9001+ to avoid collision with real data.

| Table | Synthetic IDs | Purpose |
|---|---|---|
| sim_entitlement_groups | ent_group_id=9001 | Waterton Station supply pipeline test |
| sim_delivery_events | 9001, 9002, 9003 | DE-01, DE-02, DE-03 |
| sim_dev_phases | 9001-9005 | WS SF ph1/ph2, WT Condo ph1/ph2, WV Condo ph1 |
| sim_dev_defaults | dev_id 9001-9003 | WS, WT, WV synthetic devs |
| dim_projection_groups | PG 165, 166, 167 | Synthetic PGs for WS/WT/WV |
| sim_ent_group_developments | id 9001-9003 | Links ent 9001 to devs 9001-9003 |
| sim_takedown_agreements | tda_id=9001 | WT-TDA-001 Scenario 2 |
| sim_takedown_checkpoints | 9001-9003 | CP1/CP2/CP3 |
| sim_lots | lot_id 9001-9030 | 30 TDA fixture lots |
| sim_takedown_agreement_lots | id 9001-9030 | TDA lot assignments |

Cleanup: DELETE WHERE id >= 9001 (or ent_group_id = 9001 etc.) for each table in dependency order.

---

*Source of truth for Claude Code sessions. Full architecture: DevDB_Architecture_v20.docx. Decision rationale: DevDB_Decision_Log_v20.docx. Module ownership: DevDB_Module_Map_v20.docx. Truth cases: DevDB_Scenario_Pack_v20.docx. Divergence audit: DevDB_Divergence_v20.docx.*

---

## Build Sequence -- Engine First, Inside Out

Do not build top-down from the orchestration layer. Do not ask Claude Code to "build DevDB from these docs." Build the engine from the inside out in bounded slices, each tested before the next begins.

### Required order

1. **Schema creation and seed migration** -- create all v10 tables in Databricks; validate seed data is clean before any module work begins
2. **Starts pipeline modules 1-4** -- lot_loader, date_actualizer, gap_fill_engine, chronology_validator -- test hard against Scenario 5 (happy path) and Scenario 6 (chronology violation) before proceeding
3. **Starts pipeline modules 5-12** -- takedown_engine, demand_generator, demand_allocator, temp_lot_generator, builder_assignment, demand_derived_date_writer, persistence_writer, ledger_aggregator -- test against Scenarios 2, 3, 4, 7, 10
4. **Supply pipeline (8 modules)** -- actual_date_applicator through sync_flag_writer -- test against Scenarios 8, 9 before wiring to starts pipeline
5. **Convergence coordinator** -- only after both pipelines are independently verified; test against Scenarios 1 and 4
6. **Streamlit UI** -- reads from v_sim_ledger_monthly; built last

### Hard rule

**Do not wire the convergence coordinator until both pipelines are independently tested and passing their relevant scenarios.**

### Per-module discipline

For each module, before writing any code:
- Read the module's entry in DevDB_Module_Map_v20.docx
- Identify which scenarios in DevDB_Scenario_Pack_v20.docx test this module
- Confirm which tables this module is and is not permitted to write to
- If the behavior you are about to implement is not described in the module map, stop and ask which module owns it

---

## Engine Module Status

### Starts Pipeline
| Module | Status | Notes |
|---|---|---|
| S-0050 run_context_builder | NOT IMPLEMENTED | D-136. Spec: query all param tables once, build context object. |
| S-0100 lot_loader | PASS | Tested against real lots |
| S-0200 date_actualizer | PASS | Full schedhousedetail join. resolve_marks_date() helper. |
| S-0300 gap_fill_engine | PASS | True-gap rule (D-084, D-085). Fills only where bookend dates exist. |
| S-0400 chronology_validator | PASS | Detects violations, snapshot unchanged |
| S-0500 takedown_engine | PASS | Full implementation per D-087. |
| S-0600 demand_generator | PASS | Vectorized. demand_start = first of month after last locked delivery (D-138). Capacity-capped. |
| S-0700 demand_allocator | PASS | Vectorized positional merge. No carry-forward. No fractional slots. |
| S-0800 temp_lot_generator | PASS | date_str = demand slot month always (D-137). date_dev = phase delivery. Sellout mandatory. |
| S-0810 building_group_enforcer | PASS | D-133/D-134. MIN(date_str) per group, lags imported from S-0800. |
| S-0820 post_generation_chronology_guard | PASS | D-133. Discards violating lots; warns on fully-cleared phases. |
| S-0900 builder_assignment | PASS | Builder splits passed as parameter |
| S-1000 demand_derived_date_writer | PASS | Writes MIN(date_str) per phase to sim_dev_phases |
| S-1100 persistence_writer | PASS | Explicit lot_id via MAX+offset (D-086). Atomic delete+insert. |
| S-1200 ledger_aggregator | PASS | CREATE OR REPLACE VIEW. Runs against local Postgres via PGConnection. |

### Supply Pipeline
| Module | Status | Notes |
|---|---|---|
| P-01 actual_date_applicator | PASS | Tested against synthetic Waterton Station fixtures (ent_group_id=9001) |
| P-02 dependency_resolver | PASS | Uses 'event_id' column on sim_delivery_event_predecessors |
| P-03 constraint_urgency_ranker | PASS | |
| P-04 delivery_date_assigner | PASS | |
| P-05 eligibility_updater | PASS | Uses 'event_id' column on sim_delivery_event_predecessors |
| P-06 phase_date_propagator | PASS | |
| P-07 lot_date_propagator | PASS | Only updates sim lots and real lots where date_dev is null |
| P-08 sync_flag_writer | PASS | |

### Convergence Coordinator
| Module | Status | Notes |
|---|---|---|
| 06_convergence_coordinator | PASS | Wires both pipelines. Converges correctly. Full end-to-end test pending sim_projection_params population. |

### Key implementation notes
- schedhousedetail loaded: 266,554 rows, developmentcode is STRING
- resolve_marks_date() helper centralizes MARKsystems date priority including null inactive guard
- sim_delivery_event_predecessors uses 'event_id' column (not 'delivery_event_id')
- lot_id on sim_lots has no IDENTITY; persistence_writer uses MAX(lot_id) + offset (D-086)
- Databricks Delta Lake does not enforce PRIMARY KEY/UNIQUE -- all inserts need delete guards
- ledger_aggregator uses CREATE OR REPLACE VIEW via PGConnection -- no USE CATALOG needed
- %run cells in 06_convergence_coordinator must be in their own dedicated cells (no other code)
- All test fixtures use IDs >= 9001 to avoid collision with real data; fixture cleanup must run before ent_group_id=9002 production runs
- sim_phase_builder_splits.share is DECIMAL in Databricks -- always cast to float() before arithmetic with float literals (D-097 fix)
- persistence_writer uses list of plain dicts, not Row(**kwargs), for createDataFrame -- Row maps alphabetically, dicts map by name
- TDA fixture: tda_id=9001, lot_ids 9001-9030, Scenario 2 verified
- Violation resolution paths (Path A / Path B per Scenario 6) not yet implemented in UI


---

## Reference Docs

Sections extracted from CLAUDE.md to reduce startup context. Read these when the task requires them.

| Doc | Path | When to read |
|---|---|---|
| File Manifest | `.claude/docs/file-manifest.md` | When writing or modifying files |
| API Contract | `.claude/docs/api-contract.md` | When working on FastAPI routers or endpoint contracts |
