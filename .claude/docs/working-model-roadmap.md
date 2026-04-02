# DevDB — Working Model Roadmap
*Created: 2026-04-01 | Goal: end-to-end simulation run from UI with visible results*

---

## What "Working Model" Means

A user can:
1. Select an entitlement group
2. Verify or set product splits (required before any run — D-100)
3. Click **Run Simulation**
4. See the monthly ledger output in the UI

Everything else (site plan, TDA, lot dragging) is supporting detail. This roadmap ignores detail work and drives straight to that goal.

---

## Current State Summary

| Layer | Status |
|---|---|
| Engine (all 14 modules) | **PASS** — runs in 0.5s |
| PostgreSQL (35 tables) | **Complete** |
| FastAPI routers | Partial — phases, lots, TDA, site plan done; **no run endpoint** |
| React UI | Partial — LotPhaseView, TDA, Site Plan done; **no run trigger, no ledger view** |
| S-0050 run_context_builder | **NOT IMPLEMENTED** — deferred per D-136; not blocking |

The engine works. The database is ready. The only gap is connecting them to the UI.

---

## Task 1 — Simulation Run API Endpoint

**Goal:** expose a single endpoint that triggers the convergence coordinator and returns a result.

### Sub-steps
1. Create `devdb_python/api/routers/simulations.py`
   - `POST /api/simulations/run` — accepts `{ "ent_group_id": int }`
   - Imports and calls `convergence_coordinator.run(ent_group_id)`
   - Returns `{ "status": "ok" | "error", "iterations": int, "elapsed_ms": int, "errors": [] }`
2. Register the router in `api/main.py`
3. Add error wrapping — catch engine exceptions, return HTTP 500 with message body (never crash the server)
4. Test with `ent_group_id=9002` (Waterton Station) via curl or browser — confirm 200 and convergence in 1 iteration

**Files touched:** `routers/simulations.py` (new), `api/main.py`
**Blocks:** Tasks 3 and 4

---

## Task 2 — Product Splits Verification and UI Edit

**Goal:** satisfy D-100. `sim_phase_product_splits` must be populated for every phase before simulation. Without this, temp lot generation silently produces zero lots.

### Sub-steps
1. Add `GET /api/phases/{phase_id}/product-splits` — returns current split rows
2. Add `PUT /api/phases/{phase_id}/product-splits` — accepts array of `{ lot_type_id, capacity, pct }` rows; replaces all splits for that phase atomically
3. In `LotPhaseView`, add an inline **Splits** editor on each phase pill (collapsed by default, expand on click)
   - Show current capacity and lot type percentages
   - Allow editing inline; save button posts to PUT endpoint
   - Show a warning indicator on any phase with no splits configured
4. Verify Waterton Station phases all have splits — fix any gaps directly in the DB if faster

**Files touched:** `routers/phases.py`, `LotPhaseView.jsx`, `phase_models.py`
**Blocks:** Task 3 (results are meaningless if splits are wrong)

---

## Task 3 — Ledger Results API Endpoint

**Goal:** expose monthly ledger data so the React UI can display it.

### Sub-steps
1. Add `GET /api/ledger/{ent_group_id}` in a new `routers/ledger.py`
   - Queries `v_sim_ledger_monthly` filtered by ent_group_id
   - Returns array of `{ calendar_month, projection_group_id, ent_plan, dev_plan, td_plan, str_plan, cmp_plan, cls_plan, p_end, e_end, d_end, u_end, uc_end, c_end }`
2. Register in `api/main.py`
3. Test endpoint directly with ent_group_id=9002 — confirm monthly rows exist after a simulation run

**Files touched:** `routers/ledger.py` (new), `api/main.py`
**Blocks:** Task 4

---

## Task 4 — Simulation Control Panel (React)

**Goal:** a visible Run button and ledger display in the UI.

### Sub-steps
1. Add a **Simulation** tab to `App.jsx` (alongside Developments / Legal Instruments / TDA / Site Plan)
2. Create `devdb_ui/src/pages/SimulationView.jsx`
   - Community/entitlement group picker at top (reuse existing picker pattern)
   - **Run Simulation** button — POST to `/api/simulations/run`, disable during run, show spinner
   - Status line: last run timestamp, iterations, elapsed time, any errors
3. Add **Ledger section** below the run controls
   - Fetch from `GET /api/ledger/{ent_group_id}` after a successful run (or on load if prior run exists)
   - Display as a table: rows = calendar months, columns = pipeline stage end-of-period counts (P_end through C_end) plus event columns (STR_plan, CMP_plan, CLS_plan)
   - Group rows by projection_group_id with a header row per group
4. No charts yet — plain HTML table is sufficient for a working model
5. Confirm full cycle: pick group → click Run → table populates with Waterton Station results

**Files touched:** `App.jsx`, `SimulationView.jsx` (new)
**Depends on:** Tasks 1, 2, 3

---

## Task 5 — Smoke Test and Stabilization

**Goal:** end-to-end verification before declaring working model complete.

### Sub-steps
1. Run full cycle for `ent_group_id=9002` from the UI — confirm ledger populates
2. Confirm lot counts in ledger match known good values:
   - 299 sim lots total (PG 307: 167, PG 317: 72, PG 321: 60)
   - 11 delivery events (2 locked + 9 auto-placeholder)
   - All 3 PGs show continuous starts Nov 2026 through sellout
3. Check for any console errors or API 500s — fix before declaring done
4. Commit and push all changes with a `working-model: end-to-end simulation from UI complete` message

---

## Out of Scope for Working Model

These are real features but do not block the working model. Defer until Tasks 1–5 are complete.

- Site plan lot bank and boundary refinements
- S-0050 run_context_builder (D-136)
- TDA pipeline date UI improvements
- Ledger charts / visualizations
- Chronology violation UI prompt (Scenario 6, Path A/B)
- MARKsystems sync automation (D-031)

---

## Execution Order

```
Task 1 (Run endpoint)
  → Task 2 (Product splits — parallel-safe with Task 1 if needed)
    → Task 3 (Ledger endpoint)
      → Task 4 (React UI)
        → Task 5 (Smoke test)
```

Tasks 1 and 2 are independent and can be done in the same session. Task 3 needs the run endpoint working so results exist in the view to test against.
