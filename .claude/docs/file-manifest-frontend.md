# DevDB File Manifest — Frontend (devdb_ui/src/)

Load when working on: React components, pages, hooks, utilities, or the Vite build.

---

### devdb_ui/src/main.jsx
- Owns: React DOM entry point, StrictMode wrapper
- Imports: react, react-dom, App.jsx
- Imported by: index.html
- Tables: none
- Last commit: 2026-03-26

### devdb_ui/src/App.jsx
- Owns: React Router shell with routes for LotPhaseView, SitePlanView, SimulationView; shared selectedGroupId state lifted here and passed to all views so the last-selected community persists across navigation
- Imports: react-router-dom (BrowserRouter, Routes, Route, NavLink), LotPhaseView, SitePlanView, SimulationView
- Imported by: main.jsx
- Tables: none
- Last commit: 2026-04-04

### devdb_ui/src/pages/SimulationView.jsx
- Owns: Simulation run trigger, 4-tab view (Monthly Ledger, Lot List, Delivery Schedule, Phase Utilization); Monthly Ledger has Ledger/Graph sub-toggle (ledgerSubView state); LedgerGraph component: stacked AreaChart for P/E/D/H/U/UC/C inventory + BarChart for STR/CMP/CLS activity; UtilizationPanel in Phase Utilization tab; settings panel: LedgerConfigSection (Plan Start Date + Entitlements Date), StartsTargetsSection (annual_starts_target + max_starts_per_month per dev), DeliveryConfigSection (delivery scheduling params + build lag fallbacks + inventory floor tolerances). EntitlementEventsSection removed — sim_entitlement_events table dropped. selectedGroupId now lifted to App.jsx prop.
- Imports: react (useState, useEffect, useCallback, useMemo), recharts (AreaChart, BarChart, etc.), statusConfig (STATUS_CFG, STATUS_COLOR, StatusBadge)
- Imported by: App.jsx
- Tables: none (API calls via /api/simulations/run, /api/ledger, /api/entitlement-groups, /api/developments/{id}/sim-params)
- Last commit: 2026-04-03

### devdb_ui/src/pages/LotPhaseView.jsx
- Owns: Main lot-phase view orchestrator; tab shell (Developments / Legal Instruments); community picker sidebar; add instrument inline form (replaces modal — expands in page header matching TDA pattern). selectedGroupId now lifted to App.jsx prop.
- Imports: dnd-kit, react, hooks (useLotPhaseData, useDragHandler, usePhaseEqualization), components, CommunityDevelopmentsView
- Imported by: App.jsx
- Tables: none (API calls via /api/entitlement-groups, /api/developments, /api/instruments, /api/phases)
- Last commit: 2026-04-04

### devdb_ui/src/pages/CommunityDevelopmentsView.jsx
- Owns: Community-development assignment view; unassigned dev panel; community pills; alphabet slider; drag-to-create-community
- Imports: dnd-kit, react, Toast
- Imported by: LotPhaseView.jsx
- Tables: none (API calls via /api/entitlement-groups, /api/developments)
- Last commit: 2026-03-28

### devdb_ui/src/pages/TakedownAgreementsView.jsx
- Owns: Takedown agreement management view orchestrator; wires TdaNavBar, TdaPageHeader, UnassignedBank, TdaCard, CheckpointBand, TdaDragOverlay, ContextMenu; manages context menu state; threads dragLot for landing zone highlights; contextMenuItems is useMemo([contextMenu, detail, agreements, ...callbacks]); handleContextMenu is useCallback
- Imports: dnd-kit, react (useState, useCallback, useEffect, useMemo), useTdaData, useTdaDragHandler, LeftPanel, TdaPageHeader, CheckpointBand, TdaCard, TdaDragOverlay, TdaNavBar, ContextMenu
- Imported by: LotPhaseView.jsx (as tab)
- Tables: none (API calls via /api/takedown-agreements)
- Last commit: 2026-04-01

### devdb_ui/src/pages/SitePlanView.jsx
- Owns: Site plan page orchestrator; ent-group picker (auto-restores last community from localStorage); plan creation (PDF upload); mode management (view/trace/edit/split/place/delete-phases/draw-building/delete-building); lot bank + positioning state (lotPositions, savedPositions, placeQueue, placeHistory, isDirty); granular undo: traceUndoSignal (increments to pop trace points in PdfCanvas), placeHistory stack ({lotId, prevPos}) for per-placement undo; delete-with-merge: handleDeleteBoundary finds best neighbor via shared-vertex count, calls mergeAdjacentPolygons before DELETE; normalizeSharedVertices called pre-save after every split; handleCleanupPolygons (toolbar "Clean Up" button); PhasePanel (inline — redesigned: no boundary list, gray/black text by assignment, click-to-select highlights region, X unassigns, drag-drop swap/reassign/unassign); UnassignedRegionsBar (right panel, collapsible); LotBank + PhasePanel collapse state; mode instruction overlay (floating pill); save/discard bar; point-in-polygon phase assignment on save; instrument colors in localStorage per ent-group; building groups: showBuildingGroups toggle (persisted to localStorage), buildingGroups state loaded from /api/building-groups/plan/{id}, draw-building mode (handleBuildingGroupDrawn — pointInPolygon + phase scoping + excludes already-grouped lots), pendingBuildingGroup confirmation panel, delete-building mode (selectedBgIds set, handleDeleteSelectedBuildingGroups, handleDeleteSingleBuildingGroup), bgContextMenu (right-click context menu); right-panel tabs (rightPanelTab: 'assignment'|'unit-counts'); Unit Counts tab: UnitCountsPanel + PhaseUnitBlock components; handleProjectedCountChange (PATCH + instant setPhases update + p=0,r=0 → pendingDeleteLotType); handleAddLotType (POST /phases/{id}/lot-type/{id}); handleDeleteLotType (DELETE); allLotTypes loaded from /phases/lot-types; lotMeta now includes phase_id for PdfCanvas centroid fix; map overlay toggle buttons renamed "Totals" / "Lot Types"
- Imports: react (useState, useEffect, useRef, useCallback, useMemo, Component), PdfCanvas, LotBank, splitPolygon (normalizeSharedVertices, mergeAdjacentPolygons)
- Imported by: App.jsx
- Tables: none (API calls via /api/site-plans, /api/phase-boundaries, /api/entitlement-groups, /api/lot-positions, /api/building-groups, /api/phases)
- Last commit: 2026-04-03

### devdb_ui/src/components/SitePlan/PdfCanvas.jsx
- Owns: PDF rendering canvas orchestrator; parcel trace mode (traceUndoSignal prop — increment pops last point); parcel edit mode (all vertices including phase boundaries, shared-vertex drag, snap-to-vertex); split mode (bestSplitSnap = vertex snap priority over edge snap; click-to-draw polyline, intersection auto-finalize); pan/zoom (CSS transform); normalized↔screen coordinate conversion (rotation-aware: coords stored in unrotated space, applyRotationToNorm/unapplyRotationFromNorm for CW PDF.js convention); rotation persistence (localStorage per planId); buildSharedGroup (Union-Find, SHARED_VERTEX_TOL=1e-5); findSnapForDrag; performSplit calls splitPolygon then onSplitConfirm; phaseColorMap prop (phase_id→color); boundary stroke always #1e293b, fill by assignment; PDF load error state + loading overlay; building group draw/delete event handlers (delegates rendering to BuildingGroupsLayer); findBgAtPoint uses computeBgEllipse from BuildingGroupsLayer; hit-test lot markers (findLotAtPoint, lot drag state); composes BuildingGroupsLayer, UnitCountsOverlay, LotMarkersLayer as SVG children
- Imports: pdfjs-dist, react, splitPolygon (distToSeg, snapToVertices, snapToBoundaries, findFirstBoundaryIntersection, splitPolygon, findBestSplit), UnitCountsOverlay, BuildingGroupsLayer (+ computeBgEllipse), LotMarkersLayer
- Imported by: SitePlanView.jsx
- Tables: none (API calls via onParcelSaved, onSplitConfirm, onBoundaryUpdated props)
- Last commit: 2026-04-04

### devdb_ui/src/components/SitePlan/UnitCountsOverlay.jsx
- Owns: SVG overlay rendering r/p/t table cards per phase boundary in unit-counts panel mode; Totals mode (single "Total" row) and By-type mode (per-lot-type rows + optional total row); P values in green pill (fill #f0fdfa, stroke #0d9488, rx=3); visual center via nearest lot to vertex avg; darkenHex() utility; onEditProjected click handler
- Imports: none
- Imported by: PdfCanvas.jsx
- Tables: none
- Last commit: 2026-04-04

### devdb_ui/src/components/SitePlan/BuildingGroupsLayer.jsx
- Owns: SVG overlay rendering building group ellipses (dashed teal ovals, hover/select states) and draw-group preview (freehand + multi-point, snap ring, fill preview); exports computeBgEllipse(bg, normToScreen) used by PdfCanvas hit-testing (findBgAtPoint)
- Imports: none
- Imported by: PdfCanvas.jsx
- Tables: none
- Last commit: 2026-04-04

### devdb_ui/src/components/SitePlan/LotMarkersLayer.jsx
- Owns: SVG overlay rendering lot position markers (colored circles with lot-number labels, drag ghost) and place-mode cursor tooltip (lotLabel helper)
- Imports: none
- Imported by: PdfCanvas.jsx
- Tables: none
- Last commit: 2026-04-04

### devdb_ui/src/components/SitePlan/LotBank.jsx
- Owns: Left panel on the site plan page showing unpositioned lots grouped by legal instrument; lot pills are draggable (HTML5 DnD) and clickable (enters click-to-set loop); active placing lot highlighted with instrument color; groups use stable insertion order; collapsed prop renders 28px vertical strip with label + expand button
- Imports: react (useMemo)
- Imported by: SitePlanView.jsx
- Tables: none
- Last commit: 2026-04-02

### devdb_ui/src/components/SitePlan/splitPolygon.js
- Owns: Polygon split geometry utilities; distToSeg; segIntersect; snapToVertices (vertex-priority snap — exact corners, same return shape as snapToBoundaries); snapToBoundaries (snap cursor to boundary edge, normPoint via t-interpolation in normalized space); findFirstBoundaryIntersection (normPoint via u-interpolation); insertOnBoundary (projects input onto closest edge, detects existing vertex within 1e-6 to avoid duplicates); splitPolygon (insert start/end on ring, build two arcs + interior); findBestSplit (measures interior polyline length per polygon, returns best split target + clipped line); normalizeSharedVertices (snaps vertices within tol=2e-4 across all boundaries to identical positions — returns only changed entries); mergeAdjacentPolygons (removes shared boundary between two adjacent polygons and returns merged outer polygon — used by delete-with-merge)
- Imports: none
- Imported by: PdfCanvas.jsx, SitePlanView.jsx
- Tables: none
- Last commit: 2026-04-02

### devdb_ui/src/components/InstrumentContainer.jsx
- Owns: Draggable/droppable legal instrument card with phase columns, aggregate lot-type totals, inline rename; warm neutral card chrome (#F0EEE8 header, #F7F6F3 body) matching TDA aesthetic; green dashed inline name edit (#3B6D11/#EAF3DE)
- Imports: dnd-kit, react, PhaseColumn, computeCols
- Imported by: LotPhaseView.jsx
- Tables: none
- Last commit: 2026-04-01

### devdb_ui/src/components/PhaseColumn.jsx
- Owns: Phase card with per-lot-type split rows, inline name edit, add product type form, delete confirm, auto-delete lot type on 0/0/0
- Imports: dnd-kit, react, LotCard, LotTypePill
- Imported by: InstrumentContainer.jsx
- Tables: none (API calls via /api/phases)
- Last commit: 2026-03-29

### devdb_ui/src/components/LotTypePill.jsx
- Owns: Lot-type product split card with editable projected count and droppable lot grid
- Imports: dnd-kit (useDroppable), react, LotCard
- Imported by: PhaseColumn.jsx
- Tables: none
- Last commit: 2026-03-29

### devdb_ui/src/components/LotCard.jsx
- Owns: Draggable lot pill (icon mode) and list-view card (lot number + status); updated to use unified pipeline status visual identity system (shape + color per status)
- Imports: dnd-kit (useDraggable), statusConfig
- Imported by: LotTypePill.jsx, UnassignedColumn.jsx
- Tables: none
- Last commit: 2026-04-04

### devdb_ui/src/components/ProjectionGroupContainer.jsx
- Owns: Development-level wrapper for all instruments; equalized row heights; aggregate counts; warm neutral card chrome (#F0EEE8 header, #F7F6F3 body) matching TDA aesthetic
- Imports: dnd-kit, react, InstrumentContainer
- Imported by: LotPhaseView.jsx
- Tables: none
- Last commit: 2026-04-01

### devdb_ui/src/components/UnassignedColumn.jsx
- Owns: Sticky panel of lots with phase_id = NULL; droppable for unassign operations
- Imports: dnd-kit (useDroppable), LotCard
- Imported by: LotPhaseView.jsx
- Tables: none
- Last commit: 2026-03-27

### devdb_ui/src/components/Toast.jsx
- Owns: Auto-dismiss toast notification component
- Imports: react (useEffect)
- Imported by: LotPhaseView.jsx, CommunityDevelopmentsView.jsx
- Tables: none
- Last commit: 2026-03-26

### devdb_ui/src/components/CheckpointBand.jsx
- Owns: Checkpoint band row; EditableNumber (with onEditingChange callback), show/hide lots, expanded/condensed view toggles, select-all checkbox for bulk drag, landing zone highlight (isValidDrop), right-click context menu passthrough; localDate/localTotal sync from props guarded by editingDate/editingTotal flags; date input is controlled (value+onChange, no key workaround)
- Imports: react, dnd-kit (useDroppable), LotPill, StitchConnector, PlaceholderPill, CheckpointTimeline, tdaUtils
- Imported by: TakedownAgreementsView.jsx
- Tables: none
- Last commit: 2026-04-01

### devdb_ui/src/components/CheckpointTimeline.jsx
- Owns: Checkpoint timeline visualization extracted from TakedownAgreementsView
- Imports: react
- Imported by: TakedownAgreementsView.jsx
- Tables: none
- Last commit: 2026-03-31

### devdb_ui/src/components/LeftPanel.jsx
- Owns: UnassignedBank only (TdaPoolBank and OtherTdaTile removed -- pool moved into TdaCard, nav replaced by TdaNavBar); landing zone highlight via dragLot prop; onContextMenu on lot pills
- Imports: react, dnd-kit (useDraggable, useDroppable), tdaUtils (parseLot)
- Imported by: TakedownAgreementsView.jsx
- Tables: none
- Last commit: 2026-04-01

### devdb_ui/src/components/LotPill.jsx
- Owns: Assigned lot pill (expanded + condensed modes); PlaceholderPill (expanded + condensed); StitchConnector; LockIcon; LockBtn; ProjectedDateField; isSelected highlight; onContextMenu passthrough
- Imports: dnd-kit (useDraggable), react, tdaUtils (fmt, shortLot, parseLot)
- Imported by: CheckpointBand.jsx
- Tables: none
- Last commit: 2026-04-01

### devdb_ui/src/components/TdaCard.jsx
- Owns: TDA card shell; EditableTdaName (green dashed inline editor, PATCH on save); PoolSection (inline In Agreement droppable with pool lot pills, landing zone highlight); add-checkpoint form
- Imports: react, dnd-kit (useDraggable, useDroppable), tdaUtils (parseLot)
- Imported by: TakedownAgreementsView.jsx
- Tables: none
- Last commit: 2026-04-01

### devdb_ui/src/components/TdaDragOverlay.jsx
- Owns: Drag overlay component for TDA view; renders floating pill during drag
- Imports: dnd-kit, react, LotPill
- Imported by: TakedownAgreementsView.jsx
- Tables: none
- Last commit: 2026-03-31

### devdb_ui/src/components/TdaPageHeader.jsx
- Owns: Page header (community name, mutation status, New Agreement form); select dropdown removed -- navigation now in TdaNavBar
- Imports: react
- Imported by: TakedownAgreementsView.jsx
- Tables: none
- Last commit: 2026-04-01

### devdb_ui/src/components/TdaNavBar.jsx
- Owns: Horizontal TDA navigation bar; clickable pills (name + lot count) for all community agreements; active pill highlighted green; replaces OtherTdaTile left-panel section
- Imports: react
- Imported by: TakedownAgreementsView.jsx
- Tables: none
- Last commit: 2026-04-01

### devdb_ui/src/components/ContextMenu.jsx
- Owns: Right-click context menu; backdrop overlay; keyboard Escape to close; viewport clamping; renders action items from caller
- Imports: react (useEffect)
- Imported by: TakedownAgreementsView.jsx
- Tables: none
- Last commit: 2026-04-01

### devdb_ui/src/hooks/useLotPhaseData.js
- Owns: Data fetching and caching for entitlement group lot-phase view (instruments, phases, lots)
- Imports: react (useState, useEffect, useCallback, useMemo)
- Imported by: LotPhaseView.jsx
- Tables: none (GET /api/entitlement-groups/{id}/lot-phase-view)
- Last commit: 2026-03-28

### devdb_ui/src/hooks/useDragHandler.js
- Owns: Centralized drag-drop state machine for lots, phases, instruments with API mutation dispatch
- Imports: dnd-kit (sensors, arrayMove), react
- Imported by: LotPhaseView.jsx
- Tables: none (API calls via /api/lots, /api/phases)
- Last commit: 2026-03-28

### devdb_ui/src/hooks/usePhaseEqualization.js
- Owns: Per-row phase container height equalization after paint; solo-dev detection for column widths
- Imports: react (useState, useRef, useLayoutEffect)
- Imported by: LotPhaseView.jsx
- Tables: none
- Last commit: 2026-03-29

### devdb_ui/src/hooks/useTdaData.js
- Owns: Data fetching for TDA view -- agreement list, checkpoint detail, lot assignments; HC/BLDR projected date and lock state management; all TDA mutations including renameTda (PATCH /takedown-agreements/{id}); res.ok checks on all mutations; AbortController cleanup on fetchAgreements and fetchDetail useEffects
- Imports: react (useState, useEffect, useCallback), src/config.js
- Imported by: TakedownAgreementsView.jsx
- Tables: none (API calls via /api/takedown-agreements)
- Last commit: 2026-04-01

### devdb_ui/src/hooks/useTdaDragHandler.js
- Owns: Drag orchestration for TDA view; manages dnd-kit sensors, drag state, drop dispatch; selectedAssignedLotIds for checkpoint lot multi-select; toggleAssignedCheckpointSelection for header select-all; pool-lot other-tda branch uses Promise.all for parallel moves
- Imports: dnd-kit, react
- Imported by: TakedownAgreementsView.jsx
- Tables: none
- Last commit: 2026-04-01

### devdb_ui/src/config.js
- Owns: Centralized API base URL and frontend config constants
- Imports: none
- Imported by: useTdaData.js and other hooks/components needing API base URL
- Tables: none
- Last commit: 2026-03-31

### devdb_ui/src/utils/computeCols.js
- Owns: Optimal column-count calculation for instrument band given available width and phase count
- Imports: none
- Imported by: InstrumentContainer.jsx
- Tables: none
- Last commit: 2026-03-27

### devdb_ui/src/utils/tdaUtils.js
- Owns: TDA domain utility functions extracted from TakedownAgreementsView (formatting, status helpers, etc.)
- Imports: none
- Imported by: TakedownAgreementsView.jsx and TDA components
- Tables: none
- Last commit: 2026-03-31

### devdb_ui/src/utils/tdaContextMenu.js
- Owns: Context menu policy for TDA view — pure helper: (type, lotIds, detail, agreements, callbacks) → items[]; extracted from TakedownAgreementsView to keep the page as orchestration/wiring only
- Imports: none
- Imported by: TakedownAgreementsView.jsx
- Tables: none
- Last commit: 2026-04-01

### devdb_ui/src/utils/statusConfig.jsx
- Owns: Unified pipeline status visual identity system — shape + color per pipeline status (P/E/D/H/U/UC/C/OUT); exports STATUS_CFG, STATUS_ORDER, STATUS_COLOR, StatusBadge component
- Imports: react (JSX)
- Imported by: LotCard.jsx, SimulationView.jsx
- Tables: none
- Last commit: 2026-04-03

### devdb_ui/src/utils/layoutEngine.js
- Owns: DELETED -- replaced by computeCols.js (CSS-first approach)
- Imports: n/a
- Imported by: n/a
- Tables: none
- Last commit: 2026-03-27

### devdb_ui/vite.config.js
- Owns: Vite build config; React + Tailwind plugins; /api proxy to localhost:8765 with path rewrite stripping /api prefix
- Imports: vite, @vitejs/plugin-react, @tailwindcss/vite
- Imported by: build process
- Tables: none
- Last commit: 2026-03-26
