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

### 3.1 `useApiMutation()` React hook

**Problem:** `useTdaData.js` has 8 `useCallback` mutations (lines ~104–302) that all repeat the same fetch/setError/refetch lifecycle. Any change to error handling (e.g., adding retry, changing error extraction from `body.detail`) requires updating 8 places.

**Target:**
```javascript
// src/hooks/useApiMutation.js
export function useApiMutation(url, options = {}) {
  // handles: fetch, res.ok check, body.detail error, onSuccess callback
}
```

**Callers to update:** `useTdaData.js` (8 mutations), potentially `useDragHandler.js` (5 mutations)

---

### 3.2 React context providers for master controls

**Problem:** `LotPhaseView.jsx` passes ~10 master control flags (`masterShowLots`, `masterCondensed`, `masterDateDir`, etc.) down through `InstrumentContainer` → `PhaseColumn` → children. `CheckpointBand` receives 16 props. Many are forwarded without local use.

**Target:**
```javascript
// src/contexts/LotPhaseControlContext.js
const LotPhaseControlContext = createContext()
// Provider wraps the instrument list; components useContext() instead of receiving props
```

**Files affected:** `LotPhaseView.jsx`, `InstrumentContainer.jsx`, `PhaseColumn.jsx`, `CheckpointBand.jsx`, `LotTypePill.jsx`

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

### 4.1 Module docstrings and I/O contracts

**Problem:** Engine modules have no top-level docstring declaring inputs, outputs, and which tables they write. Hard to onboard or debug without reading the coordinator.

**Target:** Add to each `s0*.py` and `p0*.py`:
```python
"""
Module: S-0300 gap_fill_engine
Reads:  sim_lots (SELECT)
Writes: sim_lots (UPDATE date_td, date_str, date_cmp, date_cls)
Input:  FrozenInput with lots DataFrame
Rules:  True-gap-only per D-084/D-085. Never fills forward from single anchor.
"""
```

**Files:** All 15 engine modules

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
