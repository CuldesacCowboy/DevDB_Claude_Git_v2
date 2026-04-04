# DevDB Priority Refactor Plan
*Created: 2026-04-03 | Based on external code review feedback*

---

## Status Summary

| # | Item | Status |
|---|---|---|
| 1 | Refactor SitePlanView state ownership | Not started |
| 2 | Unify design system | Not started |
| 3 | Reduce mode overload on Site Plan | Not started |
| 4 | Strengthen error handling | Not started |
| 5 | Rework Simulation settings UX | Not started |

---

## Task 1 — Refactor SitePlanView State Ownership

**Goal:** Break the monolithic state blob in `SitePlanView.jsx` into focused hooks, leaving the page as pure orchestration/render.

**Scope:** `devdb_ui/src/pages/SitePlanView.jsx`

### Sub-tasks
- [ ] Extract `useSitePlanState` hook — lot placement queue, placeHistory, isDirty, savedPositions, lotPositions
- [ ] Extract `useBoundaryManager` hook — polygon state, topology ops (normalize, merge, split), delete-with-merge logic
- [ ] Extract `useBuildingGroups` hook — buildingGroups, pendingBuildingGroup, bgContextMenu, draw/delete handlers
- [ ] Leave `SitePlanView.jsx` as orchestration only: mode state, panel collapse, right-panel tab, prop threading

### Notes
_Add implementation notes here as work progresses._

---

## Task 2 — Unify Design System

**Goal:** Eliminate hardcoded hex values, replicated style strings, and ad-hoc button markup. Establish shared primitives.

**Scope:** PdfCanvas.jsx, InstrumentContainer.jsx, PhaseColumn.jsx, and any component with inline hex colors or repeated Tailwind button strings.

### Sub-tasks
- [ ] Audit all hardcoded hex values in `PdfCanvas.jsx` — move to named constants or CSS vars
- [ ] Create shared `Button.jsx` component (variants: default, primary, danger, ghost)
- [ ] Extract green dashed inline editor style into a shared `InlineEditor.jsx` or Tailwind utility class — remove duplication between `InstrumentContainer` and `TdaCard`
- [ ] Define a panel chrome token (background colors `#F0EEE8` / `#F7F6F3`) in one place — `src/utils/designTokens.js` or Tailwind config
- [ ] Audit `SitePlanView.jsx` toolbar buttons and standardize to shared `Button` component

### Notes
_Add implementation notes here as work progresses._

---

## Task 3 — Reduce Mode Overload on Site Plan

**Goal:** Make the active mode always visible and self-explanatory. No mode submenu (power-user tool) — improve affordance instead.

**Scope:** `SitePlanView.jsx` toolbar, mode instruction overlay pill, `PdfCanvas.jsx`

### Sub-tasks
- [ ] Persistent mode label in toolbar — active mode name always shown (not just the overlay pill)
- [ ] Add keyboard shortcut hints to toolbar tooltips and mode overlay pill
- [ ] Review delete-phases / draw-building / delete-building toolbar grouping — consider visual separator between "geometry" tools and "content" tools
- [ ] Confirm mode overlay pill is always rendered when in a non-view mode (regression-proof it)

### Notes
_Add implementation notes here as work progresses._

---

## Task 4 — Strengthen Error Handling

**Goal:** No silent API failures. Users always know when a save, mutation, or run fails.

**Scope:** `SitePlanView.jsx`, `SimulationView.jsx`, all hooks that call `fetch`.

### Sub-tasks
- [ ] Create shared `useApiMutation` hook — wraps fetch, checks `res.ok`, surfaces errors to a toast or error state
- [ ] Audit all `fetch` calls in `SitePlanView.jsx` — add error paths to each (save boundaries, lot assignment, delete building group, etc.)
- [ ] Add save-failure state to the save/discard bar — show error message inline if save fails, keep bar open
- [ ] Audit `SimulationView.jsx` run trigger and ledger fetch — add visible error state, not just missing data
- [ ] Audit `useTdaData.js` and `useLotPhaseData.js` for any remaining fetch calls missing `res.ok` guards

### Notes
_Add implementation notes here as work progresses._

---

## Task 5 — Rework Simulation Settings UX

**Goal:** Validate inputs before run, lock settings during run, give clear run-state feedback.

**Scope:** `devdb_ui/src/pages/SimulationView.jsx` — settings panel, run trigger, loading state.

### Sub-tasks
- [ ] Add pre-run validation — check for missing required params (plan start date, at least one dev with starts target) before allowing run; show inline warnings
- [ ] Lock settings panel inputs during active run — disable fields + show visual lock state
- [ ] Improve run-in-progress feedback — progress indicator more prominent, settings panel clearly "frozen"
- [ ] Add run-result status banner — show last run timestamp, whether it succeeded or failed, any warnings returned from engine
- [ ] Review `DeliveryConfigSection` — confirm all fields have labels, units, and acceptable-range hints

### Notes
_Add implementation notes here as work progresses._

---

## Completion Log

| Date | Item | What was done |
|---|---|---|
| — | — | — |
