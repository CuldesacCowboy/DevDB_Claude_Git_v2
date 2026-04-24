# DevDB Engine Reference

Task-specific reference. Load when working on: simulation engine, coordinator, delivery scheduling, ledger, placeholder_rebuilder/demand_generator, or Databricks historical context.

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

## MARKS Data Flow (D-166)

The engine reads MARKS data from `devdb_ext` (local Postgres), never from MySQL directly.

| Layer | What it is | Who uses it |
|---|---|---|
| `MARKSConnection` | Live MySQL read-only connector | `sync_marks.py` only |
| `devdb_ext.schedhousedetail` | Local Postgres clone (266K rows) | date_actualizer |
| `devdb_ext.housemaster` | Local Postgres clone | marks_builder_sync |

**Sync:** Run `python scripts/sync_marks.py` before a session to pull fresh data.
Full DELETE+INSERT per table. Takes ~10–30s. On-demand only — no scheduled sync.

**Rule:** Never open `MARKSConnection` inside an engine module or coordinator.
Only sync scripts may use it. All engine modules use `PGConnection` against `devdb_ext`.

---

## Gap-Fill Rules (D-084, D-085 -- CRITICAL)

gap_fill_engine fills a missing date **only when a known date exists on both sides of it** -- a true gap. A lot with only `date_dev` set and no downstream dates has **no gap**. It is a D-status lot waiting for allocation. gap_fill must NOT fill date_td, date_str, date_cmp, or date_cls on such a lot.

**Specific rules (gap_fill_engine):**
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

## Build Sequence -- Engine First, Inside Out

Do not build top-down from the orchestration layer. Do not ask Claude Code to "build DevDB from these docs." Build the engine from the inside out in bounded slices, each tested before the next begins.

### Required order

1. **Schema creation and seed migration** -- create all v10 tables in Databricks; validate seed data is clean before any module work begins
2. **Starts pipeline modules 1-4** -- lot_loader, date_actualizer, gap_fill_engine, chronology_validator -- test hard against Scenario 5 (happy path) and Scenario 6 (chronology violation) before proceeding
3. **Starts pipeline modules 5-12** -- tda_preclear, demand_generator, demand_allocator, temp_lot_generator, builder_assignment, demand_derived_date_writer, persistence_writer, ledger_aggregator -- test against Scenarios 2, 3, 4, 7, 10
4. **Supply pipeline (10 modules)** -- locked_event_rebuilder, placeholder_rebuilder, actual_date_applicator through sync_flag_writer -- test against Scenarios 8, 9 before wiring to starts pipeline
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
| marks_builder_sync | PASS | Applies MARKS builder_id and is_spec to real/pre lots. |
| lot_loader | PASS | Tested against real lots |
| date_actualizer | PASS | Full schedhousedetail join. resolve_marks_date() helper. |
| building_group_sync | PASS | Propagates MIN dates within building groups for real/pre lots. |
| lot_date_overrides | PASS | Applies user overrides from sim_lot_date_overrides. |
| gap_fill_engine | PASS | True-gap rule (D-084, D-085). Fills only where bookend dates exist. |
| chronology_validator | PASS | Detects violations, snapshot unchanged |
| tda_preclear | PASS | Full TDA checkpoint enforcement per D-087. |
| demand_generator | PASS | Vectorized. demand_start = first of month after last locked delivery (D-138). Capacity-capped. |
| demand_allocator | PASS | Vectorized positional merge. No carry-forward. No fractional slots. |
| hc_bldr_date_projector | PASS | Writes projected dates for HC-held lots. |
| d_bldr_date_projector | PASS | Writes projected dates for D-status real lots. |
| temp_lot_generator | PASS | date_str = demand slot month always (D-137). date_dev = phase delivery. Sellout mandatory. |
| building_group_enforcer | PASS | D-133/D-134. MIN(date_str) per group, lags imported from temp_lot_generator. |
| post_gen_chronology_guard | PASS | D-133. Discards violating lots; warns on fully-cleared phases. |
| timing_expansion | PASS | Empirical lag curves for date_cmp/date_cls from date_str. |
| builder_assignment | PASS | Builder splits passed as parameter (sim lots). |
| real_lot_builder_assign | PASS | DB pre-pass assigns builder_id to real/pre lots. |
| spec_assignment | PASS | Assigns is_spec by instrument spec_rate. |
| demand_derived_date_writer | PASS | Writes MIN(date_str) per phase to sim_dev_phases |
| real_lot_projections | PASS | Projected dates for real P lots at annual pace. |
| persistence_writer | PASS | Explicit lot_id via MAX+offset (D-086). Atomic delete+insert. |
| ledger_aggregator | PASS | CREATE OR REPLACE VIEW. Runs against local Postgres via PGConnection. |

### Supply Pipeline
| Module | Status | Notes |
|---|---|---|
| locked_event_rebuilder | PASS | Rebuilds delivery events from date_dev_actual. |
| placeholder_rebuilder | PASS | Cross-dev scheduling lean rule (D-139). |
| actual_date_applicator | PASS | Tested against synthetic Waterton Station fixtures (ent_group_id=9001) |
| dependency_resolver | PASS | Uses 'event_id' column on sim_delivery_event_predecessors |
| constraint_urgency_ranker | PASS | |
| delivery_date_assigner | PASS | |
| eligibility_updater | PASS | Uses 'event_id' column on sim_delivery_event_predecessors |
| phase_date_propagator | PASS | |
| lot_date_propagator | PASS | Only updates sim lots and real lots where date_dev is null |
| sync_flag_writer | PASS | |

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

## Two Dev_ID Spaces — CRITICAL for Ad-Hoc SQL

There are **two distinct dev_id spaces** in this system. Conflating them produces wrong community assignments.

| Space | Primary table | Example: Waterton SF | Used by |
|---|---|---|---|
| **Legacy** | `dim_development.development_id` | 48 | All simulation tables: `sim_ent_group_developments`, `sim_dev_phases`, `sim_dev_params`, `sim_delivery_events`, `sim_lots` |
| **Modern** | `developments.dev_id` | 45 | API endpoints, React UI, `dim_projection_groups` |

**Collision example:** Legacy ID 45 = Chase Farms. Modern ID 45 = Waterton Station SF. A raw SQL join of `developments.dev_id` directly to `sim_ent_group_developments.dev_id` maps Waterton SF → Chase Farms's simulation data. This is **not a data bug** — it is a query authoring error.

**Correct join pattern (modern → simulation):**
```sql
SELECT d.dev_name, segd.ent_group_id, sdp.*
FROM developments d
JOIN dim_development dd ON dd.dev_code2 = d.marks_code   -- bridge via marks_code
JOIN sim_ent_group_developments segd ON segd.dev_id = dd.development_id
LEFT JOIN sim_dev_params sdp ON sdp.dev_id = dd.development_id
WHERE d.marks_code = 'WS';  -- or filter by d.dev_name
```

**Why the Setup page is correct:** The API bridges through `dim_development` (via `dev_code2 = marks_code`) before joining simulation tables. The correct join is already baked into the API layer.

**Migration 050** rebuilt `sim_ent_group_developments` using legacy IDs via this exact bridge. `sim_dev_params` also uses legacy IDs exclusively — confirmed no entries exist under modern IDs for any Waterton development.
