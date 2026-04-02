# DevDB Model Improvement Tasks
*From reality audit — 2026-04-01*

---

## Task 1 — Community-level ledger aggregation

**Fixes:** Audit finding #9. Ledger currently groups by projection_group_id only. Every planning
conversation is about communities (Waterton Station, Stonewater), not PGs. PG 307 and PG 317 are
both Waterton Station — users need combined monthly counts first, PG detail second.

### Sub-tasks
- [ ] 1a. Create `v_sim_ledger_monthly_by_dev` view — aggregates all PG rows within a dev_id per calendar month
- [ ] 1b. Add `GET /api/ledger/{ent_group_id}/by-dev` endpoint
- [ ] 1c. Update SimulationView: community summary table at top, PG detail tables collapsible below

### Decision point
> **D-T1-1:** What label should appear in the community summary table? Options:
> - (a) `dim_development.dev_name` — the legacy name (e.g. "Waterton Station")
> - (b) `sim_legal_instruments.instrument_name` — the plat/instrument name
> - (c) Something from the `developments` table
>
> *Awaiting user input before 1a.*

### Checkpoint
- [ ] CP-1: After 1c — run Waterton Station, confirm summary row shows combined STR across all 3 PGs

---

## Task 2 — Product-specific build lag

**Fixes:** Audit finding #1. `CMP_FROM_STR = 270 days` and `CLS_FROM_CMP = 45 days` are engine
constants applied to every lot. SF, villa, attached, and condo all get the same number.

### Sub-tasks
- [ ] 2a. Add `avg_build_days` (int) and `avg_close_lag_days` (int) to `sim_projection_params` — migration 017
- [ ] 2b. Update gap_fill_engine (S-03) to read these from projection_group params instead of constants
- [ ] 2c. Update temp_lot_generator (S-08) to use the same param-sourced lags
- [ ] 2d. Add input fields for both values in the SimulationView (or a future Setup tab)

### Decision points
> **D-T2-1:** Confirm default values when param is null:
> - `avg_build_days`: 180, 210, or 270?
> - `avg_close_lag_days`: 30, 45, or 60?
>
> **D-T2-2:** Should these be per projection group (SF PG gets 180, condo PG gets 300) or per
> entitlement group (one value covers all products in a community)?
> *Recommendation: per projection group. Costs one row per PG in sim_projection_params, which
> already exists at that grain.*
>
> *Awaiting user input on both before 2a.*

### Checkpoint
- [ ] CP-2: After 2c — run Waterton Station, verify CMP dates for SF lots differ from condo lots

---

## Task 3 — Starts target staleness warning

**Fixes:** Audit finding #2. `annual_starts_target` is a static number with no mechanism to force
review. A stale target silently produces wrong demand.

### Sub-tasks
- [ ] 3a. Add `pace_review_date` (date) to `sim_projection_params` — migration 018
- [ ] 3b. In SimulationView pre-run check, fetch projection params and flag any PG where
         `pace_review_date` is null or > 180 days ago
- [ ] 3c. Show warning: "Starts target for PG {id} last reviewed {date} — verify before running"

### Decision point
> **D-T3-1:** 180-day stale threshold — does this match your review cadence, or should it be
> 90 days (quarterly)?
>
> *No blocking decision — can implement with 180-day default and make it configurable later.*

### Checkpoint
- [ ] CP-3: After 3b — confirm warning appears for PGs with null or old review date

---

## Task 4 — Phase utilization visibility

**Fixes:** Audit finding #12. No output shows what percentage of a phase's projected capacity is
being used by the simulation. Under-utilized = demand risk. Over-utilized = supply risk.

### Sub-tasks
- [ ] 4a. Add `GET /api/phases/{phase_id}/utilization` endpoint — returns projected_count, sim_lot_count, real_lot_count, utilization_pct
- [ ] 4b. Add utilization summary to SimulationView below the ledger tables
         — color band: <70% yellow, >95% red, otherwise green

### Decision point
> **D-T4-1:** Should utilization warnings appear per-phase or rolled up to instrument/development
> level? Per-phase is more actionable; development-level is less noisy.
>
> *Recommendation: per-phase, collapsed by instrument (one instrument row expands to phases).*

### Checkpoint
- [ ] CP-4: After 4b — confirm Waterton Station phases show non-trivial utilization figures

---

## Task 5 — Seasonal weight sets

**Fixes:** Audit finding #3. One fixed seasonal curve (`SEASONAL_WEIGHTS_BALANCED_2YR`) applied to
all communities. DFW communities, mountain, and coastal markets have different seasonal shapes.

### Sub-tasks
- [ ] 5a. Add `seasonal_weight_set` varchar to `sim_projection_params` — migration 019
- [ ] 5b. Define 3 named presets in the engine:
         `balanced` (current), `spring_heavy` (peak Mar–May), `fall_heavy` (peak Sep–Nov)
- [ ] 5c. Engine reads preset name from param; falls back to `balanced` if null
- [ ] 5d. Add dropdown to SimulationView (or Setup tab) to select preset per PG

### Decision points
> **D-T5-1:** Are `balanced`, `spring_heavy`, and `fall_heavy` the right preset names and shapes
> for JTB's markets? Or do you want to define the monthly weight distributions explicitly?
>
> **D-T5-2:** Which preset should Waterton Station use?
>
> *Awaiting user input before 5b.*

### Checkpoint
- [ ] CP-5: After 5c — run two PGs with different weight sets, confirm STR_plan columns differ in seasonal shape

---

## Task 6 — TD→STR gap-fill default (14 days → configurable)

**Fixes:** Audit finding #4. `STR_FROM_TD = 14 days` assumes a builder can pull permits and start
within two weeks of takedown. Realistic minimum is 30–45 days.

### Sub-tasks
- [ ] 6a. Add `td_to_str_lag_days` (int) to `sim_projection_params` — fold into migration 017 or 019
- [ ] 6b. Update gap_fill_engine (S-03) to use param value; default 45 if null
- [ ] 6c. Re-run and verify chronology violations don't spike (shorter gaps = more violations)

### Decision point
> **D-T6-1:** Confirm 45-day default is appropriate, or specify a different number.
>
> *No blocking decision — 45 is a safe default.*

### Checkpoint
- [ ] CP-6: After 6b — check that gap-filled STR dates on real lots with only TD set are now 45+ days out

---

## Task 7 — H lot allocation filter in demand allocator

**Fixes:** Audit finding #7. S-07 treats H (Held) lots as second-priority demand, ahead of D lots.
But H lots are in TDA hold and cannot start until the checkpoint date. Allocating them to a demand
slot before their checkpoint releases is incorrect.

### Sub-tasks
- [ ] 7a. Pass TDA checkpoint dates into S-07 (currently S-07 is clean of TDA logic)
- [ ] 7b. Filter: H lot can only be allocated to a demand slot where `slot_date >= checkpoint_date`
- [ ] 7c. If no eligible slot, H lot falls to the back of the queue (treated as D lot)

### Decision point
> **D-T7-1:** This requires S-07 to receive TDA data, which today it does not touch.
> Architecture options:
> - (a) Pass `{lot_id: earliest_available_date}` dict into S-07 as a parameter (clean, no module coupling)
> - (b) Have S-05 write `earliest_available_date` to sim_lots, which S-07 reads
>
> *Recommendation: (a). S-07 stays clean; S-05 passes the dict alongside the snapshot.*
>
> *Awaiting user confirmation of approach before 7a.*

### Checkpoint
- [ ] CP-7: After 7b — H lots with far-out checkpoints should appear in later months' demand slots

---

## Task 8 — Builder splits versioned by date

**Fixes:** Audit finding #8. `sim_phase_builder_splits` stores one static share per builder per
phase. Allocations change between phases based on performance.

### Sub-tasks
- [ ] 8a. Add `valid_from` (date, nullable) to `sim_phase_builder_splits` — migration 020
- [ ] 8b. Update builder_assignment (S-09) to filter splits by `valid_from <= date_str` (or null = always valid)
- [ ] 8c. UI: allow adding a future-dated split row in the splits editor

### Decision point
> **D-T8-1:** Should `valid_from` be required when there are multiple rows for the same
> (phase_id, builder_id), or remain optional?
>
> *No blocking decision — optional is safer and backwards-compatible.*

### Checkpoint
- [ ] CP-8: After 8b — lots with date_str before/after a split transition date get different builder assignments

---

## Task 9 — Cancellation rate modifier

**Fixes:** Audit finding #5. No cancellation model. Closings are projected as if every contract
closes. Real cancellation rates: 10–20% normal market, 30%+ downturn.

### Sub-tasks
- [ ] 9a. Add `cancel_rate_pct` (decimal, 0.00–1.00) to `sim_projection_params` — fold into later migration
- [ ] 9b. In demand_generator (S-06), gross up `annual_starts_target` by `1 / (1 - cancel_rate_pct)`
         so that net closings still meet the target
- [ ] 9c. Label in ledger UI: "Starts include {cancel_rate_pct}% cancellation buffer"

### Decision points
> **D-T9-1:** Is the right model:
> - (a) Gross up starts demand (build more to net the same closings) — simplest
> - (b) Actually model some UC lots reverting to U status — architecturally heavier, more realistic
>
> **D-T9-2:** What is JTB's actual cancellation rate by product type currently?
>
> *Awaiting user input before 9a. This task can be deferred until Tasks 1–6 are stable.*

### Checkpoint
- [ ] CP-9: After 9b — STR_plan count is visibly higher than CLS_plan by the cancellation margin

---

## Task 10 — Delivery window per development

**Fixes:** Audit finding #11. One delivery window per entitlement group forces all developments to
share the same window even if their infrastructure schedules differ.

### Sub-tasks
- [ ] 10a. Add `delivery_window_start` and `delivery_window_end` to `sim_dev_defaults` or a new
          `sim_dev_delivery_config` table — migration 021
- [ ] 10b. Update P-00 and P-04 to look up window at the development level, fall back to ent-group config if null
- [ ] 10c. UI: expose per-dev window in Setup tab (future)

### Decision point
> **D-T10-1:** Add to existing `sim_dev_defaults` (simpler) or create a new
> `sim_dev_delivery_config` table (cleaner separation)?
>
> *Recommendation: add to `sim_dev_defaults` since it already exists at that grain.*
>
> *Awaiting user confirmation before 10a.*

### Checkpoint
- [ ] CP-10: After 10b — two developments in same ent group can have different window months and get different delivery dates

---

## Task 11 — Sellout scenario toggle

**Fixes:** Audit finding #6. The ledger presents one deterministic path. Users cannot see a
downside scenario without manually editing params.

### Sub-tasks
- [ ] 11a. Add `scenario_pace_multiplier` (decimal, default 1.0) to SimulationView run controls
- [ ] 11b. Pass multiplier into S-06 demand_generator to scale annual_starts_target
- [ ] 11c. Label ledger clearly: "Base scenario (100% pace)" or "Conservative scenario (75% pace)"
- [ ] 11d. Do not persist multiplier to DB — it's a run-time toggle only

### Decision point
> **D-T11-1:** Should the multiplier appear as a slider (0.5–1.5) or as a named dropdown
> (Optimistic / Base / Conservative)?
>
> *Recommendation: named dropdown — less likely to be misused.*

### Checkpoint
- [ ] CP-11: After 11b — running at 75% pace produces proportionally fewer STR_plan and later sellout

---

## Task 12 — Building group permit-level view

**Fixes:** Audit finding #10. A 4-unit condo building shows as 4 starts in STR_plan. For permit
reporting, it is 1 start (1 permit pull).

### Sub-tasks
- [ ] 12a. Create `v_sim_ledger_monthly_permits` view — collapses building_group_id to 1 row per group per month; standalone lots count as 1 each
- [ ] 12b. Add `GET /api/ledger/{ent_group_id}/permits` endpoint
- [ ] 12c. Add toggle in SimulationView: "Units view / Permits view" on the ledger table

### Decision point
> **D-T12-1:** Should permits view affect all columns or only the STR_plan column?
> (Other milestones like CMP and CLS are still unit-level even in a building group context.)
>
> *Recommendation: permits view affects STR_plan and UC_end only.*

### Checkpoint
- [ ] CP-12: After 12c — a condo building group shows 1 in STR_plan (permits view) vs. N (units view)

---

## Execution order

```
Task 1  (community ledger)          ← start here, no blocking decisions
Task 4  (phase utilization)         ← builds on Task 1 UI
Task 6  (TD→STR lag default)        ← engine-only, fast
Task 3  (staleness warning)         ← UI-only, fast
Task 2  (build lag per PG)          ← needs D-T2-1 and D-T2-2 answered
Task 5  (seasonal weights)          ← needs D-T5-1 and D-T5-2 answered
Task 7  (H lot filter)              ← needs D-T7-1 answered
Task 8  (builder splits versioned)  ← low risk, self-contained
Task 10 (delivery window per dev)   ← needs D-T10-1 answered
Task 11 (scenario toggle)           ← needs D-T11-1 answered
Task 9  (cancellation model)        ← needs D-T9-1 and D-T9-2 answered
Task 12 (permit view)               ← needs D-T12-1 answered
```
