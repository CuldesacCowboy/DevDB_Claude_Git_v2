# DevDB Decision Log

Task-specific reference. Load when: investigating why something was built a certain way, debugging TDA/delivery/scheduling behavior, or any question about a specific D-number decision. D-001 through D-165 | Next ID: D-166

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
- **D-154** -- (previously last entry — see below)
- **D-158** -- Ranch Condos segd dual-row pattern: `sim_ent_group_developments` holds two rows for Abbey Farms Ranch Condos — dev_id=101 (modern developments space, used by engine `egd.dev_id = sdp.dev_id` join) and dev_id=106 (legacy dim_development space, used by setup-tree `sli.dev_id = segd.dev_id` and `dd.development_id = segd.dev_id` joins). Neither row is wrong; they serve different join paths. Migration 047.
- **D-159** -- TDA lot bank: phase-scoped eligible lot pools (`sim_tda_lot_banks` + `sim_tda_lot_bank_members`) shared across multiple TDAs. Banks define which lots are eligible for a phase; `sim_takedown_agreement_lots` records which lots are actually committed to each TDA. Enables dual-builder (e.g. JTB + Interra sharing a pool) and no-builder scenarios. Bank membership enforced at pool-add time in tda_assignments.py. Constraint: D-025 (one active TDA per lot) unchanged.
- **D-160** -- builder_id on TDA: `sim_takedown_agreements.builder_id` (FK to `dim_builders`, nullable) records the legal counterparty. Separate from `sim_instrument_builder_splits` (simulation parameters). Null = no legal builder counterparty (e.g., externally developed projects). Added in migration 074.
- **D-161** -- lot_quota on TDA: `sim_takedown_agreements.lot_quota` stores the contractual lot quantity from the purchase agreement, independent of how many lots are actually in the pool. Enables tracking of over/under commitment. Added in migration 074.
- **D-162** -- Stonewater TDA rebuild: replaced 5 legacy TDAs (7041, 7054, 7055, 7056, 7059) with 10 properly structured TDAs split by builder and phase. 7 lot banks created (one per phase). Closed phases seeded with pool lots. Active phases (SF Ph3, SF Ph4, Condos Ph3) left with empty pools for user population.
- **D-163** -- S-0500 writes date_td_hold_projected, not date_td_hold. Fulfillment counting uses COALESCE(actual, projected) for both td and td_hold. S-0500 persists assignments via execute_values and clears stale date_td_hold_projected at run start for unlocked lots in active TDA pools.
- **D-164** -- S-0500 builder-routing: candidate lots filtered by resolved builder_id (COALESCE(builder_id_override, builder_id)) matching TDA's builder_id. Null builder_id on TDA = no filter. Excess push: remaining pool lots with no td/hold/str pushed to HC just before next unsatisfied checkpoint after gap fill.
- **D-165** -- Residual gaps surface through coordinator to API: run_starts_pipeline returns (temp_lots, needs_config, residual_gaps); convergence_coordinator returns (iterations, missing_params_devs, residual_gaps); /simulations/run response includes tda_gaps: list[ResidualGap] with tda_id, checkpoint_id, checkpoint_number, checkpoint_date, required, projected, gap.
- **D-157** -- SetupView load() r.ok guard: all four `fetch().then(r => r.json())` calls now check `r.ok` first and throw with the status code. Previously a 500 from `/admin/phase-config` with a valid JSON body (FastAPI error format) silently set `cfg.rows = undefined`, causing `setPhases([])` to wipe all phase state on every onRefresh(). Frontend restart needed.
- **D-156** -- Delivery tiers: `delivery_tier INTEGER NULL` on `sim_dev_phases` (migration 046). Strict cross-tier rule: ALL tier N-1 phases must be delivered before ANY tier N phase. Enforced by P-0000 Step 7b writing cross-tier predecessor rows in `sim_delivery_event_predecessors`. UI: indigo tier badge in PhaseRow, click-to-edit. Backend: `delivery_tier` in PATCH /admin/phase/{id} and in /admin/phase-config response.
- **D-155** -- S-0050 run_context_builder formally deferred. D-136 specified it as a first-pass module to query all parameter tables once per run and build a context object. In practice, the coordinator already pre-loads shared config (_load_builder_splits, _load_build_lag_curves) and injects it into the pipeline. Per-dev params (demand_generator, s0600) are loaded inside their respective modules and are fast local PG queries. The overhead of the current pattern is negligible at 0.5s total run time. Implementing S-0050 would require refactoring all module signatures to accept a context object — high churn, no measurable benefit at current scale. Defer until run time exceeds 5s or module count exceeds 20. S-0050 remains on the module map as NOT IMPLEMENTED.
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

## Decision Log -- D-165

D-165: Residual gaps surface through coordinator to API

`run_starts_pipeline` now returns `(temp_lots, needs_config, residual_gaps)`. The convergence
coordinator collects gaps across all dev_ids each iteration, retaining only the final
(converged) iteration's gaps. `convergence_coordinator` returns
`(iterations, missing_params_devs, residual_gaps)`. The `/simulations/run` API response now
includes `tda_gaps: list[ResidualGap]` alongside `errors`. Each gap entry includes tda_id,
checkpoint_id, checkpoint_number, checkpoint_date, required, projected, gap.

---

## Decision Log -- D-164

D-164: S-0500 builder-routing and excess push

S-0500 now filters candidate lots by resolved builder_id
(`COALESCE(builder_id_override, builder_id)`) matching the TDA's `builder_id`. Null
`builder_id` on TDA = no filter (any builder). This routes lots to the correct TDA in
dual-builder phases (e.g. JTB lots to JTB TDA, Interra lots to Interra TDA).
Additionally: after filling checkpoint gaps, any remaining pool lots with no td/hold/str
are pushed to HC just before the next unsatisfied checkpoint (excess push). This makes the
TDA a floor on absorption — excess committed lots never sit idle.

---

## Decision Log -- D-163

D-163: S-0500 writes date_td_hold_projected, not date_td_hold

Engine assigns hold dates to `date_td_hold_projected` (sim-computed projection) not to
`date_td_hold` (actual, reserved for real events recorded from MARKS or user). Fulfillment
counting uses `COALESCE(actual, projected)` for both td and td_hold, matching the pattern
used by every other pipeline date. Previous code wrote to `date_td_hold` and the change
was never persisted to DB. S-0500 now also persists assignments via `execute_values` at
the end of each run, and clears stale `date_td_hold_projected` values at run start (for
unlocked lots in active TDA pools).

---

## Decision Log -- D-162

D-162: Stonewater TDA rebuild

Replaced 5 legacy TDAs (7041, 7054, 7055, 7056, 7059) with 10 properly structured TDAs
split by builder and phase. 7 lot banks created (one per phase). Closed phases seeded with
pool lots. Active phases (SF Ph3, SF Ph4, Condos Ph3) left with empty pools for user
population.

---

## Decision Log -- D-161

D-161: lot_quota on TDA

`sim_takedown_agreements.lot_quota` stores the contractual lot quantity from the purchase
agreement, independent of how many lots are actually in the pool. Enables tracking of
over/under commitment. Added in migration 074.

---

## Decision Log -- D-160

D-160: builder_id on TDA

`sim_takedown_agreements.builder_id` (FK to `dim_builders`, nullable) records the legal
counterparty. Separate from `sim_instrument_builder_splits` (simulation parameters).
Null = no legal builder counterparty (e.g., externally developed projects). Added in
migration 074.

---

## Decision Log -- D-159

D-159: TDA lot bank

Phase-scoped eligible lot pools (`sim_tda_lot_banks` + `sim_tda_lot_bank_members`) shared
across multiple TDAs. Banks define which lots are eligible for a phase;
`sim_takedown_agreement_lots` records which lots are actually committed to each TDA.
Enables dual-builder (e.g. JTB + Interra sharing a pool) and no-builder scenarios. Bank
membership enforced at pool-add time in tda_assignments.py. Constraint: D-025 (one active
TDA per lot) unchanged.

---

## Decision Log -- D-154

D-154: P-0000 effective monthly pace mirrors S-0600 rounding via seasonal_weights.py

S-0600 computes monthly slots as round(weight * annual_starts_target). The true
annual output is sum(round(w * target)) — not annual_starts_target itself. With
balanced_2yr weights, targets 8–16 all produce exactly 12 slots/year due to rounding.
P-0000's pace estimate of annual_starts_target/12 was wrong for any target that is
not an exact multiple of 12 (e.g., target=10 and target=14 both produce 12/yr, but
P-0000 modeled them at 0.833/mo and 1.167/mo respectively — both wrong).

Fix: new shared module seasonal_weights.py contains WEIGHT_SETS dict and
effective_annual_pace(weight_set_name, annual_starts_target) -> float. Both S-0600
and P-0000 import from it. P-0000's annual_target_map now stores effective monthly
pace (effective_annual_pace / 12) instead of raw annual_starts_target, and the
/12 division in dev_monthly_pace is removed. Works correctly for all target values.

---

## Decision Log -- D-153

D-153: annual_starts_target for dev 48 corrected from 14 to 12 in sim_dev_params

Root cause of over-early SC deliveries in Waterton Station: S-0600 demand_generator
computes monthly slots as round(weight * annual_starts_target). With the
balanced_2yr weight set and annual_starts_target=14, every month rounds to exactly
1 slot (highest weight 0.100 * 14 = 1.40 → 1; lowest 0.060 * 14 = 0.84 → 1).
Total output = 12 slots/year regardless of the 14 parameter.

P-0000 used monthly_pace = annual_starts_target / 12 = 1.167/month, but the actual
simulation drain rate was 1.0/month. This caused P-0000 to model SC phase exhaustion
~17% earlier than reality (22.3 months vs 26 months for a 26-lot phase), scheduling
deliveries 3-4 months early. The error compounded across successive SC phases, producing
growing D-at-delivery inventory (27 → 31 → 35 → 39 lots at each SC delivery).

Fix: UPDATE sim_dev_params SET annual_starts_target = 12 WHERE dev_id = 48.
This aligns P-0000's drain estimate with actual simulation output. S-0600 behavior
is unchanged — both 14 and 12 produce 12 slots/year with the balanced_2yr weights.

---

## Decision Log -- D-152

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

## Decision Log -- D-151

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
