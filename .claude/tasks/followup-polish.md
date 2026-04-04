# DevDB Follow-Up Polish
*Created: 2026-04-04 | Noticed during priority-refactor session*

---

## Status Summary

| # | Item | Status |
|---|---|---|
| 1 | Replace window.confirm() with inline confirmation | Not started |
| 2 | Surface boundary operation errors to user | Not started |
| 3 | Bulk-delete endpoint for boundaries | Not started |
| 4 | Move fetchOk to module level / utils | Not started |
| 5 | Move @keyframes spin to global CSS | Not started |

---

## Task 1 — Replace window.confirm() with Inline Confirmation

**Goal:** Remove the browser-native `confirm()` dialog from "Delete Community Boundary". Replace with the same inline banner/confirmation pattern used by delete-lot-type in SitePlanView.

**Scope:** `devdb_ui/src/pages/SitePlanView.jsx` — `handleDeleteCommunityBoundary`

### Sub-tasks
- [ ] Add `pendingDeleteBoundary` boolean state to SitePlanView
- [ ] When "Delete Community Boundary" is clicked, set state instead of calling `window.confirm()`
- [ ] Render an inline confirmation banner (red, same style as delete-lot-type banner) when state is set
- [ ] Confirm button triggers the actual delete; Cancel clears the state
- [ ] Remove `window.confirm()` call entirely

### Notes
_Add implementation notes here as work progresses._

---

## Task 2 — Surface Boundary Operation Errors

**Goal:** `useBoundaryManager` silently swallows errors in delete, cleanup, phase assignment, swap, and unassign operations. The `setError` param is only wired to split and undo. All other catch blocks are `/* ignore */`.

**Scope:** `devdb_ui/src/hooks/useBoundaryManager.js`

### Sub-tasks
- [ ] `handleDeleteBoundary` — call `setError` in catch; surface merge-then-delete failures
- [ ] `handleDeleteAllBoundaries` — call `setError` in catch
- [ ] `handleCleanupPolygons` — call `setError` in catch
- [ ] `assignPhaseToBoundary` — call `setError` in catch
- [ ] `swapBoundaryAssignments` — call `setError` in catch
- [ ] `unassignBoundary` — call `setError` in catch
- [ ] Verify `setError(null)` is called at the start of each operation so stale errors clear

### Notes
_Add implementation notes here as work progresses._

---

## Task 3 — Bulk-Delete Endpoint for Boundaries

**Goal:** `handleDeleteAllBoundaries` fires one DELETE per boundary in parallel. For a plan with many boundaries this is a lot of round trips. Add a bulk-delete route matching the pattern building groups already uses (`/building-groups/bulk-delete`).

**Scope:** Backend router + `useBoundaryManager.js`

### Sub-tasks
- [ ] Add `POST /phase-boundaries/bulk-delete` FastAPI route — accepts `{ boundary_ids: [...] }`, deletes all in one DB call
- [ ] Update `handleDeleteAllBoundaries` in `useBoundaryManager.js` to use the bulk endpoint
- [ ] Keep single-boundary DELETE route unchanged (used by split undo and individual deletes)
- [ ] Test with Waterton Station (large boundary count)

### Notes
_Add implementation notes here as work progresses._

---

## Task 4 — Move fetchOk to Module Level

**Goal:** `fetchOk` is defined inside the `SimulationView` component body, recreating it on every render. Minor but worth cleaning up — either hoist to module level in SimulationView or move to a shared utils file if it gets reused elsewhere.

**Scope:** `devdb_ui/src/pages/SimulationView.jsx`

### Sub-tasks
- [ ] Move `fetchOk` above the component function (module-level constant)
- [ ] Confirm no closure dependencies on component state (it has none — pure fetch wrapper)
- [ ] If any other file adds a similar helper, consolidate into `src/utils/fetchOk.js`

### Notes
_Add implementation notes here as work progresses._

---

## Task 5 — Move @keyframes spin to Global CSS

**Goal:** The spinner `@keyframes spin` is injected as an inline `<style>` tag inside the SimulationView render tree. Browsers deduplicate it, but the right home is the global stylesheet.

**Scope:** `devdb_ui/src/pages/SimulationView.jsx`, `devdb_ui/src/index.css`

### Sub-tasks
- [ ] Add `@keyframes spin { to { transform: rotate(360deg) } }` to `src/index.css`
- [ ] Remove the inline `<style>` tag from SimulationView render

### Notes
_Add implementation notes here as work progresses._

---

## Completion Log

| Date | Item | What was done |
|---|---|---|
