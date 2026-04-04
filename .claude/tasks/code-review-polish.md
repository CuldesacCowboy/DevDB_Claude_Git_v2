# DevDB Code Review — Polish Tasks
*Created: 2026-04-04 | Source: Senior developer audit*

---

## Status Summary

| # | Item | Severity | Status |
|---|---|---|---|
| 1 | Surface lot positions load failure | High | Complete |
| 2 | Surface PdfCanvas save failures to user | High | Complete |
| 3 | Instrument order / dev_id persistence decision | Medium | Complete |
| 4 | Add top-level React Error Boundary | Medium | Complete |
| 5 | Replace FALLBACK_LOT_TYPES with API data | Medium | Complete |
| 6 | Extract `const API` to shared config | Low | Complete |
| 7 | Fix traceback leak in simulations router | Low | Complete |
| 8 | Fix race-condition PKs (phases, TDA, ent groups) | High | Not started |
| 9 | Split PdfCanvas.jsx into smaller files | Low | Not started |

---

## Task 1 — Surface Lot Positions Load Failure

**File:** `devdb_ui/src/hooks/useSitePlanState.js:43`

**Goal:** The `GET /lot-positions/plan/{id}` fetch on community select has `.catch(() => {})` — silent failure. If the API is down or returns an error, the lot bank silently shows empty. User has no indication anything went wrong and may think the bank is legitimately empty, then start working on top of a broken state.

### Sub-tasks
- [ ] Add `loadError` state (or reuse `saveError` pattern) to `useSitePlanState`
- [ ] Set error in `.catch()` on initial lot positions load
- [ ] Surface the error in SitePlanView — a red banner in the lot bank panel is sufficient
- [ ] Clear error when planId changes (fresh load attempt)

### Notes
_Add implementation notes here as work progresses._

---

## Task 2 — Surface PdfCanvas Save Failures to User

**File:** `devdb_ui/src/components/SitePlan/PdfCanvas.jsx:371, 606, 612`

**Goal:** Three operations — parcel save, vertex edit save, and boundary polygon save — all use `.catch(console.error)`. The error goes to the browser DevTools console but nowhere the user can see it. If any of these silently fail, the user thinks their geometry is persisted when it isn't. `PdfCanvas` already receives a `setError` prop — these should use it.

### Sub-tasks
- [ ] Parcel trace save (line ~371) — replace `.catch(console.error)` with `.catch(err => setError(...))`
- [ ] Vertex edit save (line ~606) — same
- [ ] Boundary polygon save (line ~612) — same
- [ ] Verify `setError` prop is already passed to PdfCanvas from SitePlanView (it is)

### Notes
_Add implementation notes here as work progresses._

---

## Task 3 — Instrument Order / Dev-ID Persistence Decision

**File:** `devdb_ui/src/hooks/useDragHandler.js:537, 547`

**Goal:** Two TODO comments mark drag operations that update local UI state but never persist to the backend:
1. Dragging instruments to reorder them (visual order in LotPhaseView)
2. Dragging a phase from one developer column to another (changes dev_id)

These are silent no-ops on refresh — the user's reordering is lost. Decision needed: implement backend persistence, or remove/disable the drag affordance so the UI doesn't mislead users.

### Sub-tasks
- [ ] Decision: implement persistence OR lock the UI
- [ ] If implement: add backend endpoints + wire drag handlers
- [ ] If lock: remove drag capability from instrument headers in LotPhaseView

### Notes
This is the only task that requires a product decision before implementation. Check with user.

---

## Task 4 — Add Top-Level React Error Boundary

**File:** `devdb_ui/src/App.jsx` (new component: `devdb_ui/src/components/ErrorBoundary.jsx`)

**Goal:** There is no React Error Boundary anywhere in the app. An unhandled JS error in any component (e.g., a `JSON.parse` crash on corrupted polygon data) will take down the entire application with a white screen and no user-facing message. A single boundary at the App level with a "Something went wrong — reload" fallback contains failures to the specific view rather than killing everything.

### Sub-tasks
- [ ] Create `src/components/ErrorBoundary.jsx` (class component — required by React for error boundaries)
- [ ] Wrap view rendering in `App.jsx` with `<ErrorBoundary>`
- [ ] Show a minimal fallback UI with a reload button

### Notes
Error boundaries must be class components in React — hooks cannot catch render errors.

---

## Task 5 — Replace FALLBACK_LOT_TYPES with API Data

**File:** `devdb_ui/src/components/PhaseColumn.jsx:10-22`

**Goal:** The "Add product type" picker falls back to a hardcoded list of lot type IDs when `knownLotTypes` hasn't loaded:
```js
const FALLBACK_LOT_TYPES = [
  { lot_type_id: 101, lot_type_short: 'SF' },
  ...
]
```
These IDs match the seed data today. If lot types ever change in the DB, the fallback picker silently shows stale options. The `/api/lot-types` endpoint already exists and is used by `LotPhaseView`. The fallback should either come from the API or be an empty disabled state — not hardcoded constants.

### Sub-tasks
- [ ] Determine how `knownLotTypes` is passed to `PhaseColumn` — trace prop chain
- [ ] If `knownLotTypes` can be empty on first render (loading state), show disabled picker instead of fallback
- [ ] Remove `FALLBACK_LOT_TYPES` constant entirely

### Notes
`knownLotTypes` is passed as a prop from `LotPhaseView` which fetches from `/api/lot-types`. The fallback is only shown when that prop is null/empty — which shouldn't happen in normal use. The real fix is: show a loading/disabled state during initial load, remove the hardcoded fallback.

---

## Task 6 — Extract `const API` to Shared Config

**File:** `useBoundaryManager.js:9`, `useBuildingGroups.js:8`, `useSitePlanState.js:8`, `SitePlanView.jsx`, `SimulationView.jsx`, and others

**Goal:** `const API = '/api'` is copy-pasted into every hook and page file. When the proxy path changes (e.g., for a different dev port or deployment), every file needs updating. Move to a single `src/utils/api.js` export.

### Sub-tasks
- [ ] Create `src/utils/api.js` with `export const API_BASE = '/api'`
- [ ] Find all `const API = '/api'` declarations across the codebase
- [ ] Replace each with `import { API_BASE } from '../utils/api'` and update usage

### Notes
Simple mechanical refactor. No behavior change.

---

## Task 7 — Fix Traceback Leak in Simulations Router

**File:** `devdb_python/api/routers/simulations.py:69-70`

**Goal:** When a simulation run throws an exception, the full Python traceback is returned in the HTTP response body:
```python
detail = traceback.format_exc()
raise HTTPException(status_code=500, detail=detail)
```
This is currently displayed verbatim in the SimulationView error card. Intentionally useful in a solo dev tool, but leaks file paths and internal structure. The fix: print the traceback to server stdout (for the terminal window) and return a clean message to the client.

### Sub-tasks
- [ ] Print traceback to server stdout using `print(traceback.format_exc())`
- [ ] Return `detail=str(exc)` (just the exception message, not the full trace) to client
- [ ] Verify SimulationView error card still shows a useful message

### Notes
The terminal window already shows uvicorn request logs. Full traceback there is fine and useful.

---

## Task 8 — Fix Race-Condition PKs (Phases, TDA, Ent Groups)

**Files:**
- `devdb_python/api/routers/phases.py:96-97`
- `devdb_python/api/routers/tda_crud.py:150-151`
- `devdb_python/api/routers/eg_crud.py:83-84`

**Goal:** All three use `SELECT COALESCE(MAX(id), 0) + 1` to generate PKs before INSERT. Two concurrent requests will both read the same MAX, produce the same next ID, and one will fail with a unique constraint violation → 500. The fix is to let PostgreSQL generate the ID using `SERIAL` or `GENERATED ALWAYS AS IDENTITY`, but this requires care because these tables have manually-assigned IDs in the seed data (synthetic fixtures use IDs like 9001).

### Sub-tasks
- [ ] Audit current max IDs in each table to understand the ID space in use
- [ ] For each table: add a sequence starting above the current max, or switch column to SERIAL
- [ ] Requires a migration file for each column change
- [ ] Update INSERT statements to remove manual ID injection (use RETURNING id)
- [ ] Verify synthetic fixture IDs (9001+) still work after sequence introduction

### Notes
Most complex task on this list — touches schema + migration + router code. The real-world risk is low (single user, no concurrent requests in practice) but it's a correctness bug.

---

## Task 9 — Split PdfCanvas.jsx into Smaller Files

**File:** `devdb_ui/src/components/SitePlan/PdfCanvas.jsx` (~1400 lines)

**Goal:** PdfCanvas handles PDF rendering, parcel tracing, vertex editing, split mode, building group drawing, lot placement overlay, and label rendering — all in one component with mode-specific blocks scattered through a massive event handler. This is a maintainability issue: any change requires navigating the full file, and mode behaviors are visually interleaved rather than separated.

### Sub-tasks
- [ ] Identify natural seams (mode-specific SVG overlays, lot placement layer, label layer)
- [ ] Extract each into a sub-component in `src/components/SitePlan/`
- [ ] PdfCanvas becomes an orchestrator that renders the PDF canvas + composes the overlays
- [ ] No behavior change — pure structural refactor

### Notes
Largest task on the list. Low risk if done carefully (no logic changes). Recommend doing after all other tasks are stable.

---

## Completion Log

| Date | Item | What was done |
|---|---|---|
| 2026-04-04 | Task 1 — Lot positions load failure | Added loadError state to useSitePlanState; surfaced in LotBank panel; empty-state suppressed when error present |
| 2026-04-04 | Task 2 — PdfCanvas save failures | Added onError prop to PdfCanvas; 3 .catch(console.error) replaced; failures now appear in SitePlanView toolbar |
| 2026-04-04 | Task 3 — Instrument persistence | Reorder → localStorage per entGroupId; dev-id move → PATCH /instruments/{id}/dev + optimistic update |
| 2026-04-04 | Task 4 — Error Boundary | ErrorBoundary.jsx class component; wraps Routes in App.jsx; shows error message + Try again button |
| 2026-04-04 | Task 5 — FALLBACK_LOT_TYPES | Constant removed; picker uses knownLotTypes exclusively; disabled with "Loading..." when empty |
| 2026-04-04 | Task 6 — Shared API_BASE | src/utils/api.js created; 5 duplicate const API declarations removed across hooks + pages |
| 2026-04-04 | Task 7 — Traceback leak | Full trace now prints to server stdout; client receives str(exc) only |
