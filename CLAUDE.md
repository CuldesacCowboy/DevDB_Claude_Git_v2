# DevDB -- Claude Code Reference
*Last updated: March 2026 (2026-03-30) | Architecture v20 | Decision Log: D-001 through D-151 | Next ID: D-152*

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
| React/FastAPI UI | In progress | React + FastAPI is the active UI. Streamlit was a prior prototype and is no longer active. D-149 is superseded. |

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

## API Contract -- FastAPI Routers

All routers mount under no global prefix (main.py uses bare app.include_router).
Each router declares its own prefix. Route = router prefix + endpoint path.

Note on schema prefix: most queries use bare table names relying on search_path=devdb
set in get_db_conn. The DELETE /phases/{phase_id}/lot-type endpoint explicitly uses
the devdb. prefix. Both work; bare names are the convention everywhere else.

---

### /phases -- phases.py

#### GET /phases/lot-types
- Tables: ref_lot_types
- Guards: none
- Returns: [{lot_type_id: int, lot_type_short: str}]

#### POST /phases
- Tables: sim_legal_instruments (read), sim_dev_phases (read MAX, INSERT)
- Guards: 422 if phase_name empty; 404 if instrument_id not found
- Returns: {phase_id: int, phase_name: str, sequence_number: int, dev_id: int, instrument_id: int}

#### PATCH /phases/{phase_id}/instrument
- Tables: delegated to phase_assignment_service (not visible in router)
- Guards: 422 if service returns not success
- Returns: {transaction: dict, needs_rerun: list[int], warnings: list[dict]}

#### DELETE /phases/{phase_id}
- Tables: sim_dev_phases, sim_lots, sim_phase_product_splits, sim_phase_builder_splits, sim_delivery_event_phases
- Guards: 404 if phase not found
- Returns: {success: bool, phase_id: int, lots_unassigned: int}

#### PATCH /phases/{phase_id}
Two modes dispatched by which field is present in body.

Name mode (body.phase_name provided):
- Tables: sim_dev_phases
- Guards: 422 if phase_name empty; 404 if phase not found (rowcount == 0)
- Returns: {success: bool, phase_id: int, phase_name: str}

Count mode (body.projected_count provided):
- Tables: sim_phase_product_splits
- Guards: 422 if neither field provided; 404 if no splits found for phase
- Returns: {success: bool, projected_count: int}

#### DELETE /phases/{phase_id}/lot-type/{lot_type_id} -- 204
- Tables: devdb.sim_phase_product_splits, devdb.sim_lots
- Guards:
  - 404 if no row in devdb.sim_phase_product_splits for (phase_id, lot_type_id)
  - 400 if projected_count != 0
  - 400 if COUNT of lot_source='real' rows in devdb.sim_lots > 0
- Returns: 204 No Content

#### PATCH /phases/{phase_id}/lot-type/{lot_type_id}/projected
- Tables: sim_phase_product_splits (SELECT/UPDATE/INSERT), sim_lots (aggregate SELECT)
- Guards: 422 if projected_count missing; 422 if projected_count < 0
- Behavior: upserts the split row (INSERT if not exists, UPDATE if exists)
- Returns: {phase_id: int, lot_type_id: int, projected_count: int, actual: int, total: int}
  - actual = COUNT of lot_source='real' rows in sim_lots for this phase+lot_type
  - total = GREATEST(projected_count, actual)

---

### /instruments -- instruments.py

#### POST /instruments
- Tables: developments (read), dim_development (bridge read), sim_legal_instruments (read MAX, INSERT)
- Guards:
  - 422 if instrument_name empty
  - 422 if instrument_type not in {Plat, Site Condo, Condo Declaration, Other}
  - 422 if dev_id has no marks_code (cannot bridge to legacy dev_id)
- Returns: {instrument_id: int, instrument_name: str, instrument_type: str, dev_id: int}
  - dev_id in response is the legacy dim_development.development_id, not the input developments.dev_id

#### PATCH /instruments/{instrument_id}
- Tables: sim_legal_instruments
- Guards: 422 if name empty; 404 if instrument not found (rowcount == 0)
- Returns: {instrument_id: int, instrument_name: str}

---

### /developments -- developments.py

All read/write operations share this response shape (via _row_to_dict):
{dev_id: int, dev_name: str, marks_code: str|null, in_marks: bool, county_id: int|null,
 county_name: str|null, state_id: int|null, municipality_id: int|null,
 community_id: int|null, community_name: str|null}

#### GET /developments
- Tables: developments, dim_county (LEFT JOIN), sim_entitlement_groups (LEFT JOIN for community_name)
- Guards: none
- Returns: list of development objects (shape above)

#### POST /developments
- Tables: developments (INSERT RETURNING), dim_county, sim_entitlement_groups (re-read for response)
- Guards: 422 if dev_name empty
- Returns: single development object (shape above)

#### GET /developments/{dev_id}
- Tables: developments, dim_county, sim_entitlement_groups
- Guards: 404 if dev_id not found
- Returns: single development object (shape above)

#### PATCH /developments/{dev_id}
- Updatable fields: dev_name, marks_code, in_marks, county_id, state_id, municipality_id,
  community_id (explicit null honoured via model_fields_set)
- Tables: developments (UPDATE), dim_county, sim_entitlement_groups (re-read for response)
- Guards: 422 if no fields provided; 422 if dev_name empty; 404 if not found (rowcount == 0)
- Returns: single development object (shape above, reflects updated values)

#### GET /developments/{dev_id}/lot-phase-view
- Tables: sim_dev_phases, sim_lots, dim_projection_groups, sim_phase_product_splits, ref_lot_types
- Guards: 404 if no phases found for dev_id
- Returns: DevLotPhaseViewResponse
  {dev_id: int, dev_name: str, unassigned: LotDetail[], phases: PhaseDetail[]}
  LotDetail: {lot_id: int, lot_number: str|null, lot_type_id: int, lot_source: str, status: str, has_actual_dates: bool}
  PhaseDetail: {phase_id: int, phase_name: str, sequence_number: int, dev_id: int,
                instrument_id: int|null, by_lot_type: LotTypeCount[], lots: LotDetail[]}
  LotTypeCount: {lot_type_id: int, lot_type_short: str|null, actual: int, projected: int, total: int}
  dev_name is hardcoded as "dev {dev_id}" -- not read from DB in this endpoint

---

### /entitlement-groups -- entitlement_groups.py

#### GET /entitlement-groups
- Tables: sim_entitlement_groups, developments, dim_development, sim_legal_instruments,
          sim_dev_phases, sim_lots, sim_phase_product_splits
- Guards: none
- Returns: [{ent_group_id: int, ent_group_name: str, real_count: int,
             projected_count: int, total_count: int}]
  - real_count = COUNT of lot_source='real' lots linked via community_id bridge
  - projected_count = SUM of sim_phase_product_splits.projected_count
  - total_count = SUM of GREATEST(real_count, projected_count) per phase

#### POST /entitlement-groups
- Tables: sim_entitlement_groups
- Guards: 422 if ent_group_name empty
- Returns: {ent_group_id: int, ent_group_name: str}

#### PATCH /entitlement-groups/{ent_group_id}
- Tables: sim_entitlement_groups
- Guards: 422 if ent_group_name empty; 404 if not found (rowcount == 0)
- Returns: {ent_group_id: int, ent_group_name: str}

#### GET /entitlement-groups/{ent_group_id}/lot-phase-view
- Tables: sim_entitlement_groups, developments, dim_development, sim_legal_instruments,
          sim_dev_phases, sim_lots, dim_projection_groups, ref_lot_types, sim_phase_product_splits
- Guards: 404 if ent_group not found
- Returns: EntGroupLotPhaseViewResponse
  {ent_group_id: int, ent_group_name: str, unassigned: LotDetail[],
   instruments: InstrumentDetail[], unassigned_phases: PhaseDetail[]}
  InstrumentDetail: {instrument_id: int, instrument_name: str, instrument_type: str,
                     dev_id: int, dev_name: str, phases: PhaseDetail[]}
  PhaseDetail (this endpoint only): includes display_order: int|null in addition to base fields
  Phases within each instrument are sorted: display_order ascending first,
  then auto-sorted by "ph. N" suffix pattern for null display_order entries.
  unassigned_phases = phases where instrument_id IS NULL

---

### /lots -- lots.py

All three endpoints delegate entirely to service functions in lot_assignment_service.
Table access is inside the services, not visible in the router.
Guards are driven by result.success from the service.

Shared sub-types (defined in api/models/lot_models.py):
- TransactionDetail: {action: str, lot_id: int, lot_number: str|null, from_phase_id: int, to_phase_id: int}
- Warning: {code: str, message: str}
- PhaseCountDetail: {phase_id: int, by_lot_type: LotTypeCount[]}
- LotTypeCount: {lot_type_id: int, lot_type_short: str|null, actual: int, projected: int, total: int}

#### PATCH /lots/{lot_id}/phase
- Service: lot_assignment_service.reassign_lot_to_phase
- Guards: 422 if not result.success
- Returns: {transaction: TransactionDetail, needs_rerun: int[], warnings: Warning[],
            phase_counts: {from_phase: PhaseCountDetail, to_phase: PhaseCountDetail}}

#### PATCH /lots/{lot_id}/lot-type
- Service: lot_assignment_service.change_lot_type
- Guards: 422 if not result.success
- Returns: {lot_id: int, phase_id: int, old_lot_type_id: int, new_lot_type_id: int,
            phase_counts: {phase: PhaseCountDetail}}

#### DELETE /lots/{lot_id}/phase
- Service: lot_assignment_service.unassign_lot_from_phase
- Guards: 422 if not result.success
- Returns: {transaction: TransactionDetail, needs_rerun: int[], warnings: Warning[],
            from_phase_counts: PhaseCountDetail}


---

## File Manifest

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
- Imports: psycopg2, fastapi, dotenv, all six routers
- Imported by: uvicorn (entry point)
- Tables: devdb.schema_migrations (reads/inserts applied versions)
- Last commit: 2026-03-28

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
- Owns: CRUD for developments table; GET /{dev_id}/lot-phase-view sub-resource
- Imports: api.deps, api.models.lot_models, psycopg2.extras
- Imported by: api/main.py
- Tables: developments, dim_county, sim_entitlement_groups, sim_dev_phases, sim_lots, dim_projection_groups, sim_phase_product_splits, ref_lot_types
- Last commit: 2026-03-27

### devdb_python/api/routers/entitlement_groups.py
- Owns: CRUD for sim_entitlement_groups; GET /{id}/lot-phase-view aggregating instruments/phases/lots
- Imports: api.deps, api.models.lot_models, psycopg2.extras
- Imported by: api/main.py
- Tables: sim_entitlement_groups, developments, dim_development, sim_legal_instruments, sim_dev_phases, sim_lots, sim_phase_product_splits, ref_lot_types, dim_projection_groups
- Last commit: 2026-03-27

### devdb_python/api/routers/instruments.py
- Owns: POST and PATCH for sim_legal_instruments (create, rename)
- Imports: api.deps, psycopg2.extras
- Imported by: api/main.py
- Tables: developments, dim_development, sim_legal_instruments
- Last commit: 2026-03-28

### devdb_python/api/routers/lots.py
- Owns: PATCH /{id}/phase, PATCH /{id}/lot-type, DELETE /{id}/phase -- all delegating to lot_assignment_service
- Imports: api.deps, api.models.lot_models, services.lot_assignment_service
- Imported by: api/main.py
- Tables: delegated to lot_assignment_service
- Last commit: 2026-03-27

### devdb_python/api/routers/takedown_agreements.py
- Owns: TDA read and write endpoints (Slice A + Slice B); agreement list, checkpoint detail, lot assignment, HC/BLDR projected date editing
- Imports: api.deps, psycopg2.extras, pydantic, fastapi
- Imported by: api/main.py
- Tables: sim_takedown_agreements, sim_takedown_checkpoints, sim_takedown_lot_assignments, sim_lots, sim_entitlement_groups
- Last commit: 2026-03-29

### devdb_python/api/routers/phases.py
- Owns: Phase CRUD, lot-type split management; DELETE /{phase_id}/lot-type registered BEFORE DELETE /{phase_id} (route ordering is intentional)
- Imports: api.deps, api.models.phase_models, services.phase_assignment_service, psycopg2.extras
- Imported by: api/main.py
- Tables: sim_dev_phases, sim_legal_instruments, ref_lot_types, sim_phase_product_splits, sim_phase_builder_splits, sim_delivery_event_phases, sim_lots (devdb. prefix on DELETE lot-type queries)
- Last commit: 2026-03-29

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
- Owns: React Router shell with tab navigation between LotPhaseView and TakedownAgreementsView
- Imports: react-router-dom (BrowserRouter, Routes, Route, NavLink)
- Imported by: main.jsx
- Tables: none
- Last commit: 2026-03-29

### devdb_ui/src/pages/LotPhaseView.jsx
- Owns: Main lot-phase view orchestrator; tab shell (Developments / Legal Instruments); community picker sidebar; add instrument modal
- Imports: dnd-kit, react, hooks (useLotPhaseData, useDragHandler, usePhaseEqualization), components, CommunityDevelopmentsView
- Imported by: App.jsx
- Tables: none (API calls via /api/entitlement-groups, /api/developments, /api/instruments, /api/phases)
- Last commit: 2026-03-30

### devdb_ui/src/pages/CommunityDevelopmentsView.jsx
- Owns: Community-development assignment view; unassigned dev panel; community pills; alphabet slider; drag-to-create-community
- Imports: dnd-kit, react, Toast
- Imported by: LotPhaseView.jsx
- Tables: none (API calls via /api/entitlement-groups, /api/developments)
- Last commit: 2026-03-28

### devdb_ui/src/pages/TakedownAgreementsView.jsx
- Owns: Takedown agreement management view; checkpoint bands; lot assignment drag-drop; lock toggles; projected date editing
- Imports: dnd-kit, react, useTdaData
- Imported by: App.jsx
- Tables: none (API calls via /api/takedown-agreements)
- Last commit: 2026-03-28

### devdb_ui/src/components/InstrumentContainer.jsx
- Owns: Draggable/droppable legal instrument card with phase columns, aggregate lot-type totals, inline rename
- Imports: dnd-kit, react, PhaseColumn, computeCols
- Imported by: LotPhaseView.jsx
- Tables: none
- Last commit: 2026-03-29

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
- Owns: Development-level wrapper for all instruments; equalized row heights; aggregate counts
- Imports: dnd-kit, react, InstrumentContainer
- Imported by: LotPhaseView.jsx
- Tables: none
- Last commit: 2026-03-29

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
- Owns: Data fetching for TDA view -- agreement list, checkpoint detail, lot assignments; HC/BLDR projected date and lock state management
- Imports: react (useState, useEffect, useCallback)
- Imported by: TakedownAgreementsView.jsx
- Tables: none (API calls via /api/takedown-agreements)
- Last commit: 2026-03-29

### devdb_ui/src/utils/computeCols.js
- Owns: Optimal column-count calculation for instrument band given available width and phase count
- Imports: none
- Imported by: InstrumentContainer.jsx
- Tables: none
- Last commit: 2026-03-27

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
- Owns: Convergence coordinator -- runs starts pipeline then supply pipeline per ent_group; loops until convergence (max 10)
- Imports: engine modules s0100-s1200, p0000-p0800, kernel.plan, kernel.FrozenInput
- Imported by: tests/test_coordinator.py
- Tables: reads/writes via all pipeline modules
- Last commit: 2026-03-27

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
- Last commit: 2026-03-25

### devdb_python/engine/p0000_placeholder_rebuilder.py
- Owns: P-0000 -- rebuilds placeholder delivery events per D-139 cross-dev scheduling lean rule
- Imported by: coordinator.py
- Tables: sim_delivery_events, sim_delivery_event_phases, sim_dev_phases (SELECT/INSERT/UPDATE)
- Last commit: 2026-03-27

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
- Owns: Primary source of truth for Claude Code sessions -- architecture decisions, module map, API contract, file manifest
- Last commit: 2026-03-30

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
- Owns: /start skill — reads CLAUDE.md and acknowledges today's task at session start
- Last commit: 2026-03-30

### .claude/skills/end/SKILL.md
- Owns: /end skill — updates CLAUDE.md, commits, pushes
- Last commit: 2026-03-30

### 01_schema_create_postgres.sql
- Owns: Reference copy of the full PostgreSQL schema DDL (not run by migration runner -- archival only)
- Tables: all core tables (CREATE reference)
- Last commit: 2026-03-25
