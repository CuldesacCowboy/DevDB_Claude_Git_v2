# DevDB Refactoring Gameplan
*Created: 2026-04-02 | Last updated: 2026-04-02*

---

## Phase 1 — Quick Wins ✅ COMPLETE (2026-04-02)


| # | Task | Files | Status |
|---|---|---|---|
| 1.1 | Remove dead `hideOutdatedWarning` constant; enable needs-rerun banner | `LotPhaseView.jsx` | ✅ Done |
| 1.2 | Extract `lot_status_sql()` to `api/sql_fragments.py` | `developments.py`, `entitlement_groups.py`, `ledger.py` | ✅ Done |
| 1.3 | Create `dict_cursor()` helper in `api/db.py`; eliminate 48 RealDictCursor boilerplate calls across all 8 routers | All routers | ✅ Done |
| 1.4 | Extract `_query_ledger_by_dev` to `services/ledger_service.py` | `ledger.py` → 140 lines (was 366) | ✅ Done |

**Result:** 4 commits, 15 files touched, ~280 net lines removed. New modules: `api/db.py`, `api/sql_fragments.py`, `services/ledger_service.py`.

---

## Phase 2 — Structural Splits ✅ COMPLETE (2026-04-02)

### 2.1 Split `takedown_agreements.py` (916 lines) ✅ Done

**Problem:** One file handles TDA CRUD, checkpoint CRUD, lot assignment, date/lock editing, and building-group fan-out. Four distinct domains.

**Target split:**

**Result:** `tda_crud.py` (369), `tda_checkpoints.py` (70), `tda_assignments.py` (435). All mounted under `/takedown-agreements`. No API contract changes.

---

### 2.2 Split `entitlement_groups.py` (767 lines) ✅ Done

**Problem:** CRUD, split-check, param-check, lot-phase-view (complex 500-line function), delivery config, ledger config, and entitlement events — all in one file.

**Target split:**

**Result:** `eg_crud.py` (120), `eg_validation.py` (238), `eg_views.py` (158), `services/eg_lot_phase_service.py` (281). `_sort_phases_for_display()` moved to service. No API contract changes.

---

## Phase 3 — Frontend Patterns

### 3.1 `useApiMutation()` React hook ✅ Done

**Result:** `useApiMutation.js` (69 lines) exports `{ mutate, mutateMany, mutationStatus }`.
`useTdaData.js` 360 → 231 lines (−129). All 10 mutations converted. `useDragHandler.js` uses a different pattern — left as-is.

---

### 3.2 React context providers for master controls ✅ Done

**Result:** Master controls live in `TakedownAgreementsView` (not LotPhaseView — gameplan had wrong scope).
`CheckpointControlContext.js` (17 lines) + `useCheckpointControls()`. Provider wraps TakedownAgreementsView return with memoized value. CheckpointBand removed 8 props from signature; reads from context instead.

---

### 3.3 Decompose `SitePlanView.jsx` (1127 lines)

**Problem:** One component owns: PDF canvas state, lot positioning, undo stacks, boundary drawing, mode toggles, phase panel, lot bank, save/discard bar. 14 useState calls, 20+ useEffect blocks.

**Target split:**

| New component | Owns |
|---|---|
| `SitePlanToolbar.jsx` | Mode controls, file upload, action buttons |
| `SitePlanSaveBar.jsx` | Save/discard bar + dirty state |
| `useSitePlanLots.js` | lotPositions, savedPositions, placeQueue, isDirty state + save/discard logic |
| `useSitePlanMode.js` | mode transitions, mode instruction text |

**Note:** `PdfCanvas.jsx` already owns canvas drawing — don't touch it.

---

### 3.4 Decompose `SimulationView.jsx` (950 lines)

**Problem:** Simulation trigger, monthly ledger, lot ledger, utilization bars, param editor, and run-error banner all in one component with complex state interdependencies.

**Target split:**

| New component | Owns |
|---|---|
| `SimRunPanel.jsx` | Run button, error banner, missing-params warning |
| `LedgerTable.jsx` | Monthly ledger rows, column toggle, sort |
| `UtilizationPanel.jsx` | (already exists as inline — extract to file) |
| `useSimulationData.js` | All fetch logic (ledger, utilization, lot list, run trigger) |

---

## Phase 4 — Engine Layer (Low Priority)

### 4.1 Module docstrings and I/O contracts ✅ Done

**Result:** All 24 engine modules (s0100–s1200, p0000–p0800, coordinator.py) converted from `#` comment headers to `"""` module-level docstrings with Reads/Writes/Input/Rules format. Includes Not Own boundaries and D-xxx references.

---

### 4.2 Parameterized queries in engine modules

**Problem:** `p0000_placeholder_rebuilder.py` and several engine modules construct SQL with f-strings and bare Python int values (`f"WHERE phase_id = {phase_id}"`). Low SQL injection risk since values are ints, but inconsistent with the router layer which uses `%s` parameterization throughout.

**Target:** Update `PGConnection.read_df()` to accept a `params` argument; convert all engine SQL to `%s` placeholder style.

**Files:** `p0000_placeholder_rebuilder.py`, `coordinator.py`, and any `s0*`/`p0*` modules using f-string SQL

---

## Priority Order for Remaining Work

1. **2.1** Split `takedown_agreements.py` — highest line-count, clearest domain boundaries
2. **2.2** Split `entitlement_groups.py` — second highest, includes extractable service
3. **3.1** `useApiMutation()` hook — small file, high leverage (cleans up useTdaData)
4. **3.2** Context providers — medium effort, reduces prop drilling significantly
5. **3.3** Decompose `SitePlanView.jsx` — large effort, do when adding new canvas features
6. **3.4** Decompose `SimulationView.jsx` — do when adding new simulation UI features
7. **4.1** Engine docstrings — low risk, do opportunistically
8. **4.2** Engine parameterized queries — do during next engine work session
