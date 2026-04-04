# DevDB Follow-Up Polish
*Created: 2026-04-04 | Noticed during priority-refactor session*

---

## Status Summary

| # | Item | Status |
|---|---|---|
| 1 | Replace window.confirm() with inline confirmation | Complete |
| 2 | Surface boundary operation errors to user | Complete |
| 3 | Bulk-delete endpoint for boundaries | Complete |
| 4 | Move fetchOk to module level / utils | Complete |
| 5 | Move @keyframes spin to global CSS | Complete |

---

## Task 1 — Replace window.confirm() with Inline Confirmation

**Goal:** Remove the browser-native `confirm()` dialog from "Delete Community Boundary". Replace with the same inline banner/confirmation pattern used by delete-lot-type in SitePlanView.

**Scope:** `devdb_ui/src/pages/SitePlanView.jsx` — `handleDeleteCommunityBoundary`

### Sub-tasks
- [x] Add `pendingDeleteBoundary` boolean state to SitePlanView
- [x] When "Delete Community Boundary" is clicked, set state instead of calling `window.confirm()`
- [x] Render an inline confirmation banner (red, same style as delete-lot-type banner) when state is set
- [x] Confirm button triggers the actual delete; Cancel clears the state
- [x] Remove `window.confirm()` call entirely

### Notes
Completed 2026-04-04. Banner renders between toolbar and save/discard bar. Delete button calls `handleDeleteCommunityBoundary` directly (which resets the pending state before executing). Cancel calls `setPendingDeleteBoundary(false)`.

---

## Task 2 — Surface Boundary Operation Errors

**Goal:** `useBoundaryManager` silently swallows errors in delete, cleanup, phase assignment, swap, and unassign operations. The `setError` param is only wired to split and undo. All other catch blocks are `/* ignore */`.

**Scope:** `devdb_ui/src/hooks/useBoundaryManager.js`

### Sub-tasks
- [x] `handleDeleteBoundary` — call `setError` in catch; surface merge-then-delete failures
- [x] `handleDeleteAllBoundaries` — call `setError` in catch
- [x] `handleCleanupPolygons` — call `setError` in catch
- [x] `assignPhaseToBoundary` — call `setError` in catch; also surfaces non-2xx responses
- [x] `swapBoundaryAssignments` — call `setError` in catch
- [x] `unassignBoundary` — call `setError` in catch; also surfaces non-2xx responses
- [x] Verify `setError(null)` is called at the start of each operation so stale errors clear

### Notes
Completed 2026-04-04. All 6 catch blocks now call setError. assignPhaseToBoundary and unassignBoundary also surface non-2xx API responses (not just network errors).

---

## Task 3 — Bulk-Delete Endpoint for Boundaries

**Goal:** `handleDeleteAllBoundaries` fires one DELETE per boundary in parallel. For a plan with many boundaries this is a lot of round trips. Add a bulk-delete route matching the pattern building groups already uses (`/building-groups/bulk-delete`).

**Scope:** Backend router + `useBoundaryManager.js`

### Sub-tasks
- [x] Add `POST /phase-boundaries/bulk-delete` FastAPI route — accepts `{ boundary_ids: [...] }`, deletes all in one DB call
- [x] Update `handleDeleteAllBoundaries` in `useBoundaryManager.js` to use the bulk endpoint
- [x] Keep single-boundary DELETE route unchanged (used by split undo and individual deletes)
- [ ] Test with Waterton Station (large boundary count)

### Notes
Completed 2026-04-04. Route registered before /{boundary_id} per FastAPI ordering requirement. Frontend now sends one POST instead of N parallel DELETEs. Single-boundary DELETE untouched.

---

## Task 4 — Move fetchOk to Module Level

**Goal:** `fetchOk` is defined inside the `SimulationView` component body, recreating it on every render. Minor but worth cleaning up — either hoist to module level in SimulationView or move to a shared utils file if it gets reused elsewhere.

**Scope:** `devdb_ui/src/pages/SimulationView.jsx`

### Sub-tasks
- [x] Move `fetchOk` above the component function (module-level constant)
- [x] Confirm no closure dependencies on component state (it has none — pure fetch wrapper)
- [ ] If any other file adds a similar helper, consolidate into `src/utils/fetchOk.js`

### Notes
Completed 2026-04-04. Hoisted to module level above the SimulationView component. No closure deps confirmed.

---

## Task 5 — Move @keyframes spin to Global CSS

**Goal:** The spinner `@keyframes spin` is injected as an inline `<style>` tag inside the SimulationView render tree. Browsers deduplicate it, but the right home is the global stylesheet.

**Scope:** `devdb_ui/src/pages/SimulationView.jsx`, `devdb_ui/src/index.css`

### Sub-tasks
- [x] Add `@keyframes spin { to { transform: rotate(360deg) } }` to `src/index.css`
- [x] Remove the inline `<style>` tag from SimulationView render

### Notes
Completed 2026-04-04.

---

## Completion Log

| Date | Item | What was done |
|---|---|---|
| 2026-04-04 | Task 1 — window.confirm() | Added `pendingDeleteBoundary` state; inline red banner with Delete/Cancel; removed `window.confirm()` |
| 2026-04-04 | Task 2 — Boundary errors | Wired setError into all 6 silent catch blocks; setError(null) clears stale errors at start of each op |
| 2026-04-04 | Task 3 — Bulk-delete endpoint | POST /phase-boundaries/bulk-delete; handleDeleteAllBoundaries uses single request instead of N parallel DELETEs |
| 2026-04-04 | Task 4 — fetchOk hoist | Moved to module level above SimulationView component |
| 2026-04-04 | Task 5 — @keyframes spin | Moved to src/index.css; removed inline style tag |
