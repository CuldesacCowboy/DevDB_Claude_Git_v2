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
- Owns: React Router shell with routes for LotPhaseView, SitePlanView, SimulationView; shared selectedGroupId state lifted here; showTestCommunities state (localStorage devdb_show_test_communities) lifted here; TEST button in nav bar — exclusive toggle (test mode = only is_test communities, normal = only non-test)
- Imports: react-router-dom (BrowserRouter, Routes, Route, NavLink), LotPhaseView, SitePlanView, SimulationView
- Imported by: main.jsx
- Tables: none
- Last commit: 2026-04-04

### devdb_ui/src/pages/SimulationView.jsx
- Owns: Simulation run trigger, 4-tab view (Monthly Ledger, Lot List, Delivery Schedule, Phase Utilization); DeliveryConfigSection: MonthGrid component (1×12 clickable month buttons), Select All, Clear, Apply Standard Window, Edit Standard Window (inline amber editor, localStorage devdb_delivery_standard_months); feed_starts_mode checkbox (amber) — aggressive batching toggle that bypasses tier gate in P-0000; showTestCommunities prop filters community picker. selectedGroupId lifted to App.jsx. Pipeline chart: sawtooth stacked area with D and H layers, delivery pin markers, rich tooltips, gridlines. Scheduling date hints on ledger dates and phase delivery date. Phase badges: fixed columns for vertical alignment. Lot ledger (LotLedger component): OverrideDateCell on pipeline date columns; OverridesPanel tab; SyncReconciliationModal post-run; building group visualization — Bldg column (B1/B2/… teal labels), alternating teal/green row tint per group, 2px teal top separator between groups; bgLabelMap computed per phase from building_group_id; CSV export includes Bldg column. Spec/build: specFilter dropdown ('all'|'spec'|'build'|'undet') on lot ledger; Spec column header (teal) with S/B/— cell rendering; STR(S) teal dashed line and STR(B) gray dashed line on velocity panel; stacked STR(S)+STR(B) bars on closings panel; utilization panel shows "12S 28B 5?" breakdown when any spec lots exist. County/SD filter dropdowns on monthly ledger (countyFilter, sdFilter state; countyOptions/sdOptions memos derived from byDev; filteredByDev memo; dropdowns only shown when >1 unique value). LocationSection in community settings modal (PATCH /entitlement-groups/{id}).
- Imports: react (useState, useEffect, useCallback, useMemo), recharts (AreaChart, BarChart, etc.), statusConfig (STATUS_CFG, STATUS_COLOR, StatusBadge), config (API_BASE), hooks/useOverrides, components/overrides/OverrideDateCell, OverridesPanel, SyncReconciliationModal, SimSettings (LocationSection)
- Imported by: App.jsx
- Tables: none (API calls via /api/simulations/run, /api/ledger, /api/entitlement-groups, /api/developments/{id}/sim-params, /api/overrides/*, /api/ref/counties, /api/ref/school-districts)
- Last commit: 2026-04-16

### devdb_ui/src/pages/LotPhaseView.jsx
- Owns: Main lot-phase view orchestrator; tab shell (Developments / Legal Instruments); community picker filtered by showTestCommunities prop (is_test exclusive). selectedGroupId lifted to App.jsx.
- Imports: dnd-kit, react, hooks (useLotPhaseData, useDragHandler, usePhaseEqualization), components, CommunityDevelopmentsView
- Imported by: App.jsx
- Tables: none (API calls via /api/entitlement-groups, /api/developments, /api/instruments, /api/phases)
- Last commit: 2026-04-04

### devdb_ui/src/pages/SetupView.jsx
- Owns: Setup tree page — Community → Development → Instrument → Phase hierarchy; sortable community list; sticky sort header + summary row; D/I/P/L subtotal columns at each level; hover-only add buttons on tree rows; ExpandAllContext + LotRefreshContext providers; CommunityRow, DevRow, InstrumentRow components; delegates phase detail to PhaseRow; DeliveryEventsSection removed (delivery events never surfaced to user); instrument type badge in InstrumentRow is a click-to-edit select (Plat / Site Condo / Traditional Condo / Metes & Bounds Splits / Other — PATCH /instruments/{id}/type on change); wider container (maxWidth 1020px), indigo left rail on instrument rows (faint indigo background), gray left rail on dev rows, community cards with more internal padding
- Imports: react (useState, useEffect, useContext, useRef, createContext), API_BASE from config, setupShared (all shared atoms), PhaseRow
- Imported by: App.jsx (via /setup route)
- Tables: none (API calls via /admin/setup-tree, /phases, /instruments, /developments, /entitlement-groups, PATCH /instruments/{id}/type)
- Last commit: 2026-04-13

### devdb_ui/src/components/setup/setupShared.jsx
- Owns: All shared hooks, utilities, and UI atoms for the Setup tree; exports LotRefreshContext, ExpandAllContext, useLocalOpen, SUB (column widths), SUB_LABELS, phaseTotal, fmtRelative, SubCell, SortHeader, formatLotNum, lotSeqStr, formatLotNumPadded, ChevronIcon, InlineEdit, EditableCount, AddForm, useAddForm, ROW (padding 5px), AddButton; ROW padding increased 3→5px
- Imports: react (useState, useEffect, useRef, useCallback, createContext, useContext)
- Imported by: SetupView.jsx, PhaseRow.jsx, LotPillGroup.jsx, BuildingsTab.jsx
- Tables: none
- Last commit: 2026-04-14

### devdb_ui/src/components/setup/PhaseRow.jsx
- Owns: PhaseRow (expandable phase header with Lots/Buildings tab bar) and LotTypeRow (one table row + lot pill detail expand); lot type table: Product/Total/Active/Pending/Sim/Excl columns; inline lot pill expand via LotPillGroup; silent re-fetch on LotRefreshContext tick; inline delivery date badge in phase header (teal 'del. date', click-to-edit date input, blur/Enter saves, PATCH /admin/phase/{id} with date_dev_actual); county/SD read-only badges (amber border = phase override, gray = inherited from community, ↗ suffix when inherited); Ranch Condos phases fixed (disappearing phase bug)
- Imports: react (useState, useEffect, useRef, useContext, useCallback), API_BASE, setupShared (multiple), LotPillGroup, BuildingsTab
- Imported by: SetupView.jsx
- Tables: none (API calls via /phases/{id}/lot-type/{ltId}/lots, /phases/{id}/lot-type/{ltId}/projected, DELETE /phases/{id}/lot-type/{ltId}, PATCH /admin/phase/{id})
- Last commit: 2026-04-16

### devdb_ui/src/components/setup/LotPillGroup.jsx
- Owns: LotPillGroup (pill grid with add-pre-lots panel); MovableLotPill (drag-to-move, exclude/un-exclude actions); AddPreLotsPanel (bulk pre-lot creation inline); exports LOT_PILL, LotPill, LotPillGroup
- Imports: react (useState), API_BASE, formatLotNum/formatLotNumPadded/lotSeqStr from setupShared
- Imported by: PhaseRow.jsx
- Tables: none (API calls via /lots/{id}/move, /lots/{id}/exclude, /bulk-lots/suggestions, /bulk-lots/insert)
- Last commit: 2026-04-10

### devdb_ui/src/components/setup/BuildingsTab.jsx
- Owns: BuildingsTab — building list per phase; create/rename/retype/delete buildings; assign lots to buildings; BUILDING_TYPES color map; TypePill, LotChip internal components
- Imports: react (useState, useEffect), API_BASE, formatLotNumPadded/InlineEdit from setupShared
- Imported by: PhaseRow.jsx
- Tables: none (API calls via /phases/{id}/buildings, /buildings/{id})
- Last commit: 2026-04-10

### devdb_ui/src/pages/ConfigView.jsx
- Owns: 4-tab configuration view (Community / Development / Instrument / Phase); Community tab — editable ledger dates (date_paper, date_ent), auto_schedule_enabled checkbox, MonthCell (12-button inline delivery month picker, All/None, "using global" when null), del/year, County dropdown, School District dropdown; Development tab — historical pace context (starts YTD/last yr/2yr ago, unstarted lots, total projected, 2yr avg pace), StartsCell (editable annual_starts_target + reactive supply label: ≈ X.x yrs green/≈ N mo amber/exhausted red), editable max_starts_per_month; Instrument tab — editable spec_rate (SpecRateCell with 4 hint buttons, 6mo/2yr weighted average from codetail) + editable builder split % per builder (instrument-level, not phase-level; 2-builder auto-complement; actual committed lot counts displayed); Phase tab — phase config spreadsheet with '+' button per row opening BulkLotInsertModal (builder split columns removed — moved to Instrument tab); data loaded via parallel Promise.all on mount from /admin/community-config, /admin/dev-config, /admin/phase-config; patchComm supports 'ledger', 'delivery', and 'location' (county_id, school_district_id via PATCH /entitlement-groups/{id}) kinds
- Imports: react (useState, useEffect, useRef, useCallback), BulkLotInsertModal
- Imported by: App.jsx (via /configure route)
- Tables: none (API calls via /admin/audit-data, /admin/dev-config, /admin/phase-config, PATCH /admin/phase/{id}, PUT /admin/product-split, PUT /admin/builder-split/{instrument_id}/{builder_id}, PATCH /instruments/{id}/spec-rate, GET /instruments/{id}/spec-rate-hints, PUT /entitlement-groups/{id}/delivery-config, PUT /entitlement-groups/{id}/ledger-config, PATCH /entitlement-groups/{id}, PUT /developments/{id}/sim-params, POST /bulk-lots/suggestions, POST /bulk-lots/insert)
- Last commit: 2026-04-16

### devdb_ui/src/components/config/CommunityTab.jsx
- Owns: Community tab spreadsheet for ConfigView; columns: community name, Ledger Start, Bulk Ent. Date, County (dropdown), School District (dropdown), Auto Schedule, Delivery Months, Del/Year; County and SD are independent dropdowns (full SD list shown regardless of county since migration 072); saving county clears SD; 'location' kind saved via PATCH /entitlement-groups/{id}
- Imports: react (useState, useRef, useEffect), EditableCell, configShared (MonthCell, TableShell, BAND), config (API_BASE)
- Imported by: ConfigView.jsx
- Tables: none (API calls via /ref/counties, /ref/school-districts, PATCH /entitlement-groups/{id})
- Last commit: 2026-04-16

### devdb_ui/src/components/config/PhaseTab.jsx
- Owns: Phase config spreadsheet for ConfigView; county/SD override columns (amber = phase override, gray = inherited from community); SD dropdown shows all school districts (no county filtering since migration 072)
- Imports: react (useState, useEffect), EditableCell, configShared, config (API_BASE)
- Imported by: ConfigView.jsx
- Tables: none (API calls via /admin/phase-config, PATCH /admin/phase/{id}, /ref/counties, /ref/school-districts)
- Last commit: 2026-04-16

### devdb_ui/src/components/simulation/LotLedger.jsx
- Owns: Lot-level ledger table component; SD column with click-to-edit inline select (amber underline when sd_is_lot_exception=true); SD dropdown fetches all school districts (no county filter since migration 072); onRefreshLots callback after SD save
- Imports: react (useState, useRef), config (API_BASE)
- Imported by: SimulationView.jsx
- Tables: none (API calls via /ref/school-districts, PATCH /admin/lot/{id}/school-district)
- Last commit: 2026-04-16

### devdb_ui/src/components/simulation/SimSettings.jsx
- Owns: Simulation community settings modal components; LocationSection (county + SD dropdowns for ent_group community-level assignment); StartsTargetsSection; SD list fetched once on mount (no county filtering since migration 072)
- Imports: react (useState, useEffect), config (API_BASE)
- Imported by: SimulationView.jsx
- Tables: none (API calls via /ref/counties, /ref/school-districts, /admin/community-config/{id}, PATCH /entitlement-groups/{id})
- Last commit: 2026-04-16

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
- Owns: Site plan page orchestrator; ent-group picker filtered by showTestCommunities prop; all boundary/lot/building-group state; mode management; save/discard bar; Unit Counts tab; PhasePanel; UnassignedRegionsBar. (See prior notes for full feature list.)
- Imports: react (useState, useEffect, useRef, useCallback, useMemo, Component), PdfCanvas, LotBank, splitPolygon (normalizeSharedVertices, mergeAdjacentPolygons)
- Imported by: App.jsx
- Tables: none (API calls via /api/site-plans, /api/phase-boundaries, /api/entitlement-groups, /api/lot-positions, /api/building-groups, /api/phases)
- Last commit: 2026-04-14

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

### devdb_ui/src/components/BulkLotInsertModal.jsx
- Owns: 2-step modal for bulk pre-MARKS lot creation; step 1 — count inputs per lot type; step 2 — range editor (prefix + start seq rebuilds flat list) + individually editable flat list with PRE badge per lot; calls POST /bulk-lots/suggestions then POST /bulk-lots/insert
- Imports: react (useState, useRef), config.js
- Imported by: PhaseColumn.jsx, ConfigView.jsx
- Tables: none (API calls via /bulk-lots/suggestions, /bulk-lots/insert)
- Last commit: 2026-04-05

### devdb_ui/src/components/InstrumentContainer.jsx
- Owns: Draggable/droppable legal instrument card with phase columns, aggregate lot-type totals, inline rename; warm neutral card chrome (#F0EEE8 header, #F7F6F3 body) matching TDA aesthetic; green dashed inline name edit (#3B6D11/#EAF3DE)
- Imports: dnd-kit, react, PhaseColumn, computeCols
- Imported by: LotPhaseView.jsx
- Tables: none
- Last commit: 2026-04-01

### devdb_ui/src/components/PhaseColumn.jsx
- Owns: Phase card with per-lot-type split rows, inline name edit, add product type form, delete confirm, auto-delete lot type on 0/0/0; '+' button in header opens BulkLotInsertModal
- Imports: dnd-kit, react, LotCard, LotTypePill, BulkLotInsertModal
- Imported by: InstrumentContainer.jsx
- Tables: none (API calls via /api/phases)
- Last commit: 2026-04-05

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
- Owns: Assigned lot pill (expanded + condensed modes); PlaceholderPill (expanded + condensed); StitchConnector; LockIcon; LockBtn; ProjectedDateField; isSelected highlight; onContextMenu passthrough; condensed view: 8px teal "S" badge above seq number when assignment.is_spec === true
- Imports: dnd-kit (useDraggable), react, tdaUtils (fmt, shortLot, parseLot)
- Imported by: CheckpointBand.jsx
- Tables: none
- Last commit: 2026-04-15

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
- Owns: Centralized API base URL via VITE_API_BASE env var with /api fallback (`import.meta.env.VITE_API_BASE ?? '/api'`); single source of truth — utils/api.js deleted and all importers consolidated here
- Imports: none
- Imported by: all hooks and pages that need API_BASE (useTdaData.js, useOverrides.js, OverrideEntryPopover.jsx, SimulationView.jsx, ConfigView.jsx, SitePlanView.jsx, AuditView.jsx, PlanningView.jsx, useBoundaryManager.js, useBuildingGroups.js, useSitePlanState.js, and others)
- Tables: none
- Last commit: 2026-03-31

### devdb_ui/src/utils/api.js
- Owns: DELETED — consolidated into config.js (2026-04-14)
- Imports: n/a
- Imported by: n/a
- Tables: none
- Last commit: 2026-04-14

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

### devdb_ui/src/hooks/useOverrides.js
- Owns: All override CRUD for SimulationView; fetchOverrides, previewOverride (cascade preview without writing), applyOverrides (write + refetch), clearOverride (single field), clearBatch (by override_ids or lot_ids), fetchReconciliation (overrides near MARKS actual), exportOverrides; imports API_BASE from src/config.js
- Imports: react (useState, useCallback), src/config.js
- Imported by: SimulationView.jsx
- Tables: none (API calls via /api/overrides, /api/overrides/preview, /api/overrides/apply, /api/overrides/reconciliation, /api/overrides/export)
- Last commit: 2026-04-14

### devdb_ui/src/components/overrides/OverrideDateCell.jsx
- Owns: Pipeline date cell with override indicator (amber = active override); click opens OverrideEntryPopover; displays overrideValue || marksValue, falls back to projectedValue (italic); disabled prop suppresses interaction
- Imports: react (useState), OverrideEntryPopover
- Imported by: SimulationView.jsx
- Tables: none
- Last commit: 2026-04-14

### devdb_ui/src/components/overrides/OverrideEntryPopover.jsx
- Owns: Date entry popover for overrides; fetches cascade preview from /api/overrides/preview on date change; shows downstream delta per field (+Nd / -Nd); checkbox selection for cascade inclusion; Apply / Clear buttons; closes on outside click; imports API_BASE from src/config.js
- Imports: react (useState, useEffect, useRef), src/config.js
- Imported by: OverrideDateCell.jsx
- Tables: none (API calls via /api/overrides/preview on input change)
- Last commit: 2026-04-14

### devdb_ui/src/components/overrides/OverridesPanel.jsx
- Owns: Full list of active overrides grouped by lot; shows override_value vs current_marks delta (+Nd / -Nd); per-field clear button; Clear All, Export, Check Reconciliation actions; no imports (pure render)
- Imports: none
- Imported by: SimulationView.jsx
- Tables: none
- Last commit: 2026-04-14

### devdb_ui/src/components/overrides/SyncReconciliationModal.jsx
- Owns: Post-sync modal when reconciliation finds overrides within n_days of MARKS; checkbox list of reconcilable overrides; Clear Selected / Dismiss; no imports (pure render)
- Imports: react (useState)
- Imported by: SimulationView.jsx
- Tables: none
- Last commit: 2026-04-14

### devdb_ui/src/pages/AuditView.jsx
- Owns: Config audit page — surfaces compliance issues between phase config, builder splits, delivery month constraints, and delivery event coverage
- Imports: react (useState, useEffect, useMemo), config (API_BASE)
- Imported by: App.jsx (via /audit route)
- Tables: none (API calls via /api/*)
- Last commit: 2026-04-14

### devdb_ui/src/pages/PlanningView.jsx
- Owns: Production planning workbench — override MARKS dates per lot to test schedule changes before entering into ITK; uses override system
- Imports: react (useState, useEffect, useCallback), config (API_BASE), useOverrides, OverrideDateCell, OverridesPanel, SyncReconciliationModal
- Imported by: App.jsx
- Tables: none (API calls via /api/overrides/*)
- Last commit: 2026-04-14

### devdb_ui/src/hooks/useBoundaryManager.js
- Owns: Phase boundary state and topology operations for SitePlanView; manages boundaries, selectedBoundaryId, undoStack; handles split, merge, delete, cleanup, phase assignment, undo
- Imports: react (useState, useEffect, useRef, useCallback), splitPolygon (normalizeSharedVertices, mergeAdjacentPolygons), config (API_BASE)
- Imported by: SitePlanView.jsx
- Tables: none (API calls via /api/phase-boundaries)
- Last commit: 2026-04-14

### devdb_ui/src/hooks/useBuildingGroups.js
- Owns: Building group state and operations for SitePlanView; manages buildingGroups, selectedBgIds, pendingBuildingGroup, bgContextMenu, showBuildingGroups
- Imports: react (useState, useEffect, useCallback), config (API_BASE)
- Imported by: SitePlanView.jsx
- Tables: none (API calls via /api/building-groups)
- Last commit: 2026-04-14

### devdb_ui/src/hooks/useSitePlanState.js
- Owns: Lot positioning and placement state for SitePlanView; manages allLots, lotPositions, savedPositions, isDirty, placeQueue, placeHistory
- Imports: react (useState, useEffect, useRef, useCallback, useMemo), config (API_BASE)
- Imported by: SitePlanView.jsx
- Tables: none (API calls via /api/lot-positions)
- Last commit: 2026-04-14

### devdb_ui/vite.config.js
- Owns: Vite build config; React + Tailwind plugins; /api proxy to localhost:8765 with path rewrite stripping /api prefix
- Imports: vite, @vitejs/plugin-react, @tailwindcss/vite
- Imported by: build process
- Tables: none
- Last commit: 2026-03-26
