// SitePlanView.jsx
// Main site plan page. Entitlement group picker + mode controls in toolbar.
// Right panel: phase boundary list + phase assignment when boundaries exist.

import { useState, useEffect, useRef, useCallback, useMemo, Component } from 'react'
import PdfCanvas from '../components/SitePlan/PdfCanvas'
import LotBank from '../components/SitePlan/LotBank'
import { useBoundaryManager } from '../hooks/useBoundaryManager'
import { useSitePlanState } from '../hooks/useSitePlanState'
import { useBuildingGroups } from '../hooks/useBuildingGroups'
import { Button } from '../components/Button'

class SitePlanErrorBoundary extends Component {
  constructor(props) { super(props); this.state = { error: null } }
  static getDerivedStateFromError(err) { return { error: err } }
  render() {
    if (this.state.error) {
      return (
        <div style={{ padding: 32, color: '#dc2626', fontFamily: 'monospace', fontSize: 12 }}>
          <div style={{ fontWeight: 700, marginBottom: 8, fontSize: 14 }}>Render error — check console for full stack</div>
          <pre style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>{String(this.state.error)}</pre>
          <button onClick={() => this.setState({ error: null })} style={{ marginTop: 16, padding: '4px 12px', fontSize: 12 }}>Dismiss</button>
        </div>
      )
    }
    return this.props.children
  }
}

const API = '/api'

const INSTRUMENT_COLORS = [
  '#3b82f6', '#10b981', '#f97316', '#8b5cf6', '#06b6d4',
  '#ec4899', '#84cc16', '#eab308', '#ef4444', '#6366f1',
]
const UNASSIGNED_COLOR = '#9ca3af'

// Single source of truth for each mode's display label, chip color, and canvas instruction.
const MODE_META = {
  trace:           { label: 'Trace Parcel',    color: '#2563eb', instruction: 'Click to place vertices · click first vertex to close · Esc to cancel' },
  edit:            { label: 'Edit Vertices',   color: '#374151', instruction: 'Drag vertices · click edge to add point · right-click to remove · Esc to exit' },
  split:           { label: 'Split Region',    color: '#7c3aed', instruction: 'Click any boundary edge to begin · draw across the region · click boundary edge to split · Esc to cancel' },
  'delete-phases': { label: 'Delete Phases',  color: '#b45309', instruction: 'Click a phase region to delete it · or use Delete All in the toolbar · Esc to exit' },
  'draw-building': { label: 'Draw Group',     color: '#0f766e', instruction: 'Click to add points · double-click or near first point to close · or click-and-drag for freehand · Esc to cancel' },
  'delete-building':{ label: 'Delete Groups', color: '#b45309', instruction: 'Click a building oval to select · right-click for quick delete · use toolbar to delete selected · Esc to exit' },
  place:           { label: 'Place Lots',     color: '#7c3aed', instruction: 'Click on the map to place the next lot · Esc to stop placing' },
}

function SitePlanViewInner({ selectedGroupId: _selectedGroupIdProp, setSelectedGroupId: _setSelectedGroupIdProp }) {
  // ─── Page-level state ───────────────────────────────────────────────────────
  const [entGroups, setEntGroups]             = useState([])
  const selectedGroupId    = _selectedGroupIdProp    ?? ''
  const setSelectedGroupId = _setSelectedGroupIdProp ?? (() => {})
  const [plan, setPlan]                       = useState(null)
  const [loading, setLoading]                 = useState(false)
  const [uploading, setUploading]             = useState(false)
  const [error, setError]                     = useState(null)
  const [mode, setMode]                       = useState('view')
  const [traceUndoSignal, setTraceUndoSignal] = useState(0)
  const [instrumentColors, setInstrumentColors] = useState({})
  const [phases, setPhases]                   = useState([])
  const [allLotTypes, setAllLotTypes]         = useState([])
  const [lotBankCollapsed, setLotBankCollapsed]             = useState(false)
  const [phasePanelCollapsed, setPhasePanelCollapsed]       = useState(false)
  const [unassignedBarCollapsed, setUnassignedBarCollapsed] = useState(false)
  const [rightPanelTab, setRightPanelTab]             = useState('assignment')
  const [unitCountsSubtotal, setUnitCountsSubtotal]   = useState(false)
  const [editProjected, setEditProjected]             = useState(null)
  const [pendingDeleteLotType, setPendingDeleteLotType]     = useState(null)
  const [pendingDeleteBoundary, setPendingDeleteBoundary]   = useState(false)

  const fileInputRef = useRef(null)

  // ─── Domain hooks ───────────────────────────────────────────────────────────
  const boundaryMgr = useBoundaryManager({ planId: plan?.plan_id, setMode, setError })
  const sitePlan    = useSitePlanState({ planId: plan?.plan_id, boundaries: boundaryMgr.boundaries, setMode })
  const bgGroups    = useBuildingGroups({
    plan,
    lotPositions: sitePlan.lotPositions,
    allLots: sitePlan.allLots,
    boundaries: boundaryMgr.boundaries,
    phases,
    mode,
    setMode,
  })

  const {
    boundaries, selectedBoundaryId, setSelectedBoundaryId, undoStack,
    handleDeleteBoundary, handleDeleteAllBoundaries, clearBoundaries,
    onSplitConfirm, onBoundarySelect, onVertexEditComplete, handleBoundaryUndo,
    handleCleanupPolygons, assignPhaseToBoundary, swapBoundaryAssignments, unassignBoundary,
  } = boundaryMgr

  const {
    allLots, lotPositions, isDirty, placeQueue, placeHistory,
    bankLots, currentPlacingLot, lotMeta,
    loadError,
    saveError, savePending, clearSaveError,
    handleLotDrop, handleLotMove, handlePlaceLot, startPlaceFromLot, endPlaceMode,
    handleSaveLotPositions, handleDiscardLotPositions, handlePlaceUndo,
  } = sitePlan

  const {
    buildingGroups, selectedBgIds, setSelectedBgIds,
    pendingBuildingGroup, clearPendingBuildingGroup, bgContextMenu, setBgContextMenu,
    showBuildingGroups, toggleShowBuildingGroups,
    handleBuildingGroupDrawn, handleBuildingGroupConfirm, handleBuildingGroupCancel,
    handleBuildingGroupSelect, handleDeleteSelectedBuildingGroups,
    handleDeleteSingleBuildingGroup, handleBuildingGroupContextMenu,
  } = bgGroups

  // ─── Data loading ───────────────────────────────────────────────────────────

  useEffect(() => {
    fetch(`${API}/entitlement-groups`)
      .then(r => r.json())
      .then(gs => setEntGroups(gs.sort((a, b) => a.ent_group_name.localeCompare(b.ent_group_name))))
      .catch(() => setError('Could not load entitlement groups'))
  }, [])

  useEffect(() => {
    fetch(`${API}/phases/lot-types`)
      .then(r => r.ok ? r.json() : [])
      .then(setAllLotTypes)
      .catch(() => setError('Could not load lot types'))
  }, [])

  useEffect(() => {
    if (!selectedGroupId) {
      setPlan(null); setMode('view'); setPhases([])
      return
    }
    setLoading(true)
    setError(null)
    fetch(`${API}/site-plans/ent-group/${selectedGroupId}`)
      .then(r => { if (r.status === 404) return null; if (!r.ok) throw new Error(); return r.json() })
      .then(data => { setPlan(data); setLoading(false) })
      .catch(() => { setError('Could not load site plan'); setLoading(false) })
  }, [selectedGroupId])

  useEffect(() => {
    if (!selectedGroupId) { setInstrumentColors({}); return }
    try {
      const stored = localStorage.getItem(`devdb_siteplan_colors_${selectedGroupId}`)
      setInstrumentColors(stored ? JSON.parse(stored) : {})
    } catch { setInstrumentColors({}) }
  }, [selectedGroupId])

  useEffect(() => {
    if (!selectedGroupId) { setPhases([]); return }
    fetch(`${API}/entitlement-groups/${selectedGroupId}/lot-phase-view`)
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (!data) { setPhases([]); return }
        const flat = []
        for (const inst of (data.instruments || [])) {
          for (const ph of (inst.phases || [])) {
            flat.push({ ...ph, dev_name: inst.dev_name, instrument_id: inst.instrument_id, instrument_name: inst.instrument_name })
          }
        }
        for (const ph of (data.unassigned_phases || [])) {
          flat.push({ ...ph, dev_name: 'Unassigned', instrument_id: null })
        }
        setPhases(flat)
      })
      .catch(() => setPhases([]))
  }, [selectedGroupId])

  useEffect(() => {
    if (!selectedGroupId || !phases.length) return
    const ids = [...new Set(phases.filter(p => p.instrument_id != null).map(p => p.instrument_id))]
    setInstrumentColors(prev => {
      const next = { ...prev }
      let changed = false
      let idx = Object.keys(next).length
      for (const iid of ids) {
        if (!(iid in next)) {
          next[iid] = INSTRUMENT_COLORS[idx % INSTRUMENT_COLORS.length]
          idx++
          changed = true
        }
      }
      if (changed) {
        try { localStorage.setItem(`devdb_siteplan_colors_${selectedGroupId}`, JSON.stringify(next)) } catch {}
      }
      return changed ? next : prev
    })
  }, [phases, selectedGroupId])

  const handleInstrumentColorChange = useCallback((instrumentId, color) => {
    setInstrumentColors(prev => {
      const next = { ...prev, [instrumentId]: color }
      try { localStorage.setItem(`devdb_siteplan_colors_${selectedGroupId}`, JSON.stringify(next)) } catch {}
      return next
    })
  }, [selectedGroupId])

  // ─── Plan management ────────────────────────────────────────────────────────

  async function handleFileChange(e) {
    const file = e.target.files?.[0]
    if (!file) return
    await doUpload(file)
    e.target.value = ''
  }

  async function doUpload(file) {
    setUploading(true)
    setError(null)
    setMode('view')
    clearBoundaries()
    try {
      const form = new FormData()
      form.append('file', file)
      const res = await fetch(`${API}/site-plans?ent_group_id=${selectedGroupId}`, { method: 'POST', body: form })
      if (!res.ok) { const b = await res.json().catch(() => ({})); throw new Error(b.detail || 'Upload failed') }
      setPlan(await res.json())
    } catch (err) { setError(err.message) }
    finally { setUploading(false) }
  }

  async function clearParcel() {
    if (!plan) return
    try {
      const res = await fetch(`${API}/site-plans/${plan.plan_id}/parcel`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ parcel_json: null }),
      })
      if (res.ok) {
        setPlan(p => ({ ...p, parcel_json: null }))
        clearBoundaries()
        setMode('view')
      }
    } catch { /* ignore */ }
  }

  async function handleDeleteCommunityBoundary() {
    if (!plan) return
    setPendingDeleteBoundary(false)
    try {
      await handleDeleteAllBoundaries()
      const res = await fetch(`${API}/site-plans/${plan.plan_id}/parcel`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ parcel_json: null }),
      })
      if (res.ok) setPlan(p => ({ ...p, parcel_json: null }))
    } catch { /* ignore */ }
  }

  // ─── Undo coordinator (trace / place / boundary) ───────────────────────────

  async function handleUndo() {
    if (mode === 'trace') { setTraceUndoSignal(s => s + 1); return }
    if (mode === 'place') { handlePlaceUndo(); return }
    await handleBoundaryUndo()
  }

  // ─── Escape to exit any active mode ────────────────────────────────────────

  useEffect(() => {
    function onKeyDown(e) {
      if (e.key !== 'Escape') return
      // Don't steal Escape from input/textarea elements
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') return
      if (mode === 'trace')          { setMode('view'); return }
      if (mode === 'edit')           { setMode('view'); return }
      if (mode === 'split')          { setMode('view'); setSelectedBoundaryId(null); return }
      if (mode === 'delete-phases')  { setMode('view'); return }
      if (mode === 'draw-building')  { handleBuildingGroupCancel(); return }
      if (mode === 'delete-building'){ setSelectedBgIds(new Set()); setMode('view'); return }
      if (mode === 'place')          { endPlaceMode(); return }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [mode, handleBuildingGroupCancel, setSelectedBgIds, endPlaceMode, setSelectedBoundaryId])

  // ─── Unit counts ────────────────────────────────────────────────────────────

  async function handleProjectedCountChange(phaseId, lotTypeId, newValue) {
    const res = await fetch(`${API}/phases/${phaseId}/lot-type/${lotTypeId}/projected`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projected_count: newValue }),
    })
    if (res.ok) {
      const data = await res.json()
      setPhases(prev => prev.map(ph => {
        if (ph.phase_id !== phaseId) return ph
        return {
          ...ph,
          by_lot_type: (ph.by_lot_type || []).map(lt => {
            if (lt.lot_type_id !== lotTypeId) return lt
            return { ...lt, projected: data.projected_count, actual: data.actual, total: data.total }
          }),
        }
      }))
      if (newValue === 0 && (data.actual || 0) === 0) {
        const ph = phases.find(p => p.phase_id === phaseId)
        const lt = (ph?.by_lot_type || []).find(l => l.lot_type_id === lotTypeId)
        setPendingDeleteLotType({
          phase_id: phaseId,
          lot_type_id: lotTypeId,
          lot_type_short: lt?.lot_type_short || String(lotTypeId),
          phase_name: ph?.phase_name || String(phaseId),
        })
      }
    }
  }

  async function handleAddLotType(phaseId, lotTypeId) {
    const res = await fetch(`${API}/phases/${phaseId}/lot-type/${lotTypeId}`, { method: 'POST' })
    if (res.ok) {
      const data = await res.json()
      setPhases(prev => prev.map(ph => {
        if (ph.phase_id !== phaseId) return ph
        const already = (ph.by_lot_type || []).some(lt => lt.lot_type_id === lotTypeId)
        if (already) return ph
        return {
          ...ph,
          by_lot_type: [...(ph.by_lot_type || []), {
            lot_type_id: data.lot_type_id,
            lot_type_short: data.lot_type_short,
            actual: 0,
            projected: 0,
            total: 0,
          }],
        }
      }))
    }
  }

  async function handleDeleteLotType(phaseId, lotTypeId) {
    const res = await fetch(`${API}/phases/${phaseId}/lot-type/${lotTypeId}`, { method: 'DELETE' })
    if (res.ok || res.status === 204) {
      setPhases(prev => prev.map(ph => {
        if (ph.phase_id !== phaseId) return ph
        return { ...ph, by_lot_type: (ph.by_lot_type || []).filter(lt => lt.lot_type_id !== lotTypeId) }
      }))
    }
    setPendingDeleteLotType(null)
  }

  // ─── Derived state ──────────────────────────────────────────────────────────

  const initialParcel = plan?.parcel_json ? JSON.parse(plan.parcel_json) : null
  const pdfUrl        = plan ? `${API}/site-plans/${plan.plan_id}/file` : null
  const hasPlan       = !!plan
  const hasParcel     = !!(plan?.parcel_json)
  const hasBoundaries = boundaries.length > 0

  const phaseMap         = Object.fromEntries(phases.map(p => [p.phase_id, p]))
  const assignedPhaseIds = new Set(boundaries.filter(b => b.phase_id).map(b => b.phase_id))
  const unassignedSelectedBoundaryId = selectedBoundaryId
    && boundaries.find(b => b.boundary_id === selectedBoundaryId)?.phase_id == null
    ? selectedBoundaryId : null

  const phaseToBoundaryId = useMemo(() => {
    const m = {}
    for (const b of boundaries) if (b.phase_id) m[b.phase_id] = b.boundary_id
    return m
  }, [boundaries])

  const phaseColorMap = Object.fromEntries(
    phases.filter(p => p.instrument_id != null && instrumentColors[p.instrument_id])
      .map(p => [p.phase_id, instrumentColors[p.instrument_id]])
  )

  const lotColorMap = useMemo(() => {
    const m = {}
    for (const l of allLots) {
      if (l.instrument_id && instrumentColors[l.instrument_id])
        m[l.lot_id] = instrumentColors[l.instrument_id]
    }
    return m
  }, [allLots, instrumentColors])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: 'calc(100vh - 44px)' }}>

      {/* Toolbar */}
      <div style={{
        padding: '0 16px', borderBottom: '1px solid #e5e7eb',
        background: '#fff', height: 44,
        display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0,
      }}>
        <select
          value={selectedGroupId ?? ''}
          onChange={e => { setSelectedGroupId(e.target.value ? Number(e.target.value) : null); setMode('view'); setSelectedBoundaryId(null) }}
          style={{ fontSize: 13, padding: '4px 8px', borderRadius: 4, border: '1px solid #d1d5db', minWidth: 220 }}
        >
          <option value=''>Select project...</option>
          {entGroups.map(g => (
            <option key={g.ent_group_id} value={g.ent_group_id}>{g.ent_group_name}</option>
          ))}
        </select>

        {hasPlan && <div style={{ width: 1, height: 20, background: '#e5e7eb' }} />}

        {/* Undo — visible in trace mode (pops last point), place mode (reverts last placement),
                  or when undoStack has entries in other modes */}
        {hasPlan && (mode === 'trace' || (mode === 'place' && placeHistory.length > 0) || (undoStack.length > 0 && mode !== 'trace' && mode !== 'place')) && (
          <Button variant="warning" onClick={handleUndo}>↩ Undo</Button>
        )}

        {/* View mode tools */}
        {hasPlan && mode === 'view' && (
          <>
            <Button variant="primary" onClick={() => setMode('trace')}>
              {hasParcel ? 'Retrace Parcel' : 'Trace Parcel'}
            </Button>
            {hasParcel && (
              <Button variant="default" onClick={() => setMode('edit')}>
                Edit Vertices
              </Button>
            )}
            <Button variant="purple" onClick={() => { setMode('split'); setSelectedBoundaryId(null) }}>
              Split Region
            </Button>

            {/* Separator: geometry tools above / manage+delete tools below */}
            {(hasBoundaries || hasParcel) && <div style={{ width: 1, height: 20, background: '#e5e7eb' }} />}

            {hasBoundaries && (
              <Button variant="warning" onClick={() => { setMode('delete-phases'); setSelectedBoundaryId(null) }}>
                Delete Phases
              </Button>
            )}
            {hasBoundaries && (
              <Button variant="default" onClick={handleCleanupPolygons} title="Snap near-coincident vertices to exact shared positions">
                Clean Up
              </Button>
            )}
            {hasParcel && (
              <Button variant="danger" onClick={() => setPendingDeleteBoundary(true)}>
                Delete Community Boundary
              </Button>
            )}

            {/* Building group tools (only shown when toggle is ON) */}
            {hasPlan && <div style={{ width: 1, height: 20, background: '#e5e7eb' }} />}
            <Button
              variant={showBuildingGroups ? 'teal' : 'default'}
              onClick={toggleShowBuildingGroups}
              title={showBuildingGroups ? 'Hide building groups' : 'Show building groups'}
            >
              {showBuildingGroups ? '⬡ Groups ON' : '⬡ Groups'}
            </Button>
            {showBuildingGroups && (
              <>
                <Button
                  variant="tealOn"
                  onClick={() => { clearPendingBuildingGroup(); setMode('draw-building') }}
                  title="Draw a boundary around lots to group them into a building"
                >
                  Draw Group
                </Button>
                <Button
                  variant="warning"
                  onClick={() => { setSelectedBgIds(new Set()); setMode('delete-building') }}
                  title="Click building ovals to select and delete groups"
                >
                  Delete Groups
                </Button>
              </>
            )}
          </>
        )}

        {/* Active-mode: label chip + exit buttons — instruction detail shown as canvas overlay */}
        {hasPlan && mode !== 'view' && MODE_META[mode] && (
          <span style={{
            fontSize: 11, fontWeight: 600, padding: '2px 9px', borderRadius: 10,
            background: MODE_META[mode].color + '18',
            color: MODE_META[mode].color,
            border: `1px solid ${MODE_META[mode].color}44`,
            whiteSpace: 'nowrap', letterSpacing: '0.01em',
          }}>
            {MODE_META[mode].label}
          </span>
        )}
        {hasPlan && mode === 'trace' && (
          <Button variant="default" onClick={() => setMode('view')}>Cancel</Button>
        )}
        {hasPlan && mode === 'edit' && (
          <Button variant="primary" onClick={() => setMode('view')}>Done</Button>
        )}
        {hasPlan && mode === 'split' && (
          <Button variant="default" onClick={() => { setMode('view'); setSelectedBoundaryId(null) }}>Done</Button>
        )}
        {hasPlan && mode === 'delete-phases' && (
          <>
            <Button variant="danger" onClick={handleDeleteAllBoundaries}>Delete All</Button>
            <Button variant="default" onClick={() => setMode('view')}>Done</Button>
          </>
        )}
        {hasPlan && mode === 'draw-building' && (
          <Button variant="default" onClick={handleBuildingGroupCancel}>Cancel</Button>
        )}
        {hasPlan && mode === 'delete-building' && (
          <>
            {selectedBgIds.size > 0 && (
              <Button variant="danger" onClick={handleDeleteSelectedBuildingGroups}>
                Delete {selectedBgIds.size} group{selectedBgIds.size !== 1 ? 's' : ''}
              </Button>
            )}
            <Button variant="default" onClick={() => { setSelectedBgIds(new Set()); setMode('view') }}>Done</Button>
          </>
        )}

        {hasPlan && <div style={{ width: 1, height: 20, background: '#e5e7eb' }} />}

        {hasPlan && (
          <Button variant="default" onClick={() => fileInputRef.current?.click()} disabled={uploading}>
            Replace PDF
          </Button>
        )}

        {error && <span style={{ fontSize: 12, color: '#dc2626' }}>{error}</span>}
        <input ref={fileInputRef} type='file' accept='.pdf' style={{ display: 'none' }} onChange={handleFileChange} />
      </div>

      {/* Delete community boundary confirmation banner */}
      {pendingDeleteBoundary && (
        <div style={{
          padding: '6px 16px',
          background: '#fef2f2',
          borderBottom: '1px solid #fecaca',
          display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0,
        }}>
          <span style={{ fontSize: 12, color: '#dc2626', flex: 1 }}>
            Delete the community boundary and all phases? This cannot be undone.
          </span>
          <Button variant="danger" onClick={handleDeleteCommunityBoundary} style={{ fontSize: 11 }}>
            Delete
          </Button>
          <Button variant="default" onClick={() => setPendingDeleteBoundary(false)} style={{ fontSize: 11 }}>
            Cancel
          </Button>
        </div>
      )}

      {/* Lot positions unsaved bar — stays open on save failure */}
      {(isDirty || saveError) && (
        <div style={{
          padding: '6px 16px',
          background: saveError ? '#fef2f2' : '#fffbeb',
          borderBottom: `1px solid ${saveError ? '#fecaca' : '#fde68a'}`,
          display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0,
        }}>
          {saveError ? (
            <span style={{ fontSize: 12, color: '#dc2626', flex: 1 }}>
              Save failed: {saveError}
            </span>
          ) : (
            <span style={{ fontSize: 12, color: '#92400e', flex: 1 }}>
              Lot positions have unsaved changes
            </span>
          )}
          {saveError && (
            <Button variant="default" onClick={clearSaveError} style={{ fontSize: 11 }}>Dismiss</Button>
          )}
          <Button variant="success" onClick={handleSaveLotPositions} disabled={savePending}>
            {savePending ? 'Saving…' : 'Save'}
          </Button>
          <Button variant="default" onClick={handleDiscardLotPositions} disabled={savePending}>Discard</Button>
        </div>
      )}

      {/* Canvas + panels */}
      <div style={{ flex: 1, overflow: 'hidden', display: 'flex' }}>

        {/* Lot bank — left panel, collapsible */}
        {hasPlan && (
          <LotBank
            lots={bankLots}
            instrumentColors={instrumentColors}
            placingLotId={currentPlacingLot?.lot_id ?? null}
            onLotDragStart={(e, lot) => e.dataTransfer.setData('lot_id', String(lot.lot_id))}
            onLotClick={startPlaceFromLot}
            collapsed={lotBankCollapsed}
            onCollapseToggle={() => setLotBankCollapsed(v => !v)}
            loadError={loadError}
          />
        )}

        {/* Canvas area */}
        <div style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
          {!selectedGroupId && <Placeholder>Select a project to view its site plan</Placeholder>}
          {selectedGroupId && loading && <Placeholder>Loading...</Placeholder>}

          {selectedGroupId && !loading && !plan && (
            <DropZone onUpload={doUpload} onBrowse={() => fileInputRef.current?.click()} uploading={uploading} />
          )}

          {plan && pdfUrl && (
            <PdfCanvas
              key={pdfUrl}
              pdfUrl={pdfUrl}
              planId={plan.plan_id}
              initialParcel={initialParcel}
              mode={mode}
              onModeChange={setMode}
              onParcelSaved={points => setPlan(p => ({ ...p, parcel_json: JSON.stringify(points) }))}
              boundaries={boundaries}
              selectedBoundaryId={selectedBoundaryId}
              phaseColorMap={phaseColorMap}
              onBoundarySelect={onBoundarySelect}
              onBoundaryDelete={handleDeleteBoundary}
              onSplitConfirm={onSplitConfirm}
              onBoundaryUpdated={updated => boundaryMgr.setBoundaries(bs => bs.map(b => b.boundary_id === updated.boundary_id ? updated : b))}
              onVertexEditComplete={onVertexEditComplete}
              traceUndoSignal={traceUndoSignal}
              lotPositions={lotPositions}
              lotMeta={lotMeta}
              lotColorMap={lotColorMap}
              placingLot={currentPlacingLot}
              onPlaceLot={handlePlaceLot}
              onLotDrop={handleLotDrop}
              onLotMove={handleLotMove}
              buildingGroups={buildingGroups}
              showBuildingGroups={showBuildingGroups}
              selectedBgIds={selectedBgIds}
              onBuildingGroupDrawn={handleBuildingGroupDrawn}
              onBuildingGroupSelect={handleBuildingGroupSelect}
              onBuildingGroupContextMenu={handleBuildingGroupContextMenu}
              rightPanelTab={rightPanelTab}
              unitCountsSubtotal={unitCountsSubtotal}
              phasesData={phases}
              onEditProjected={(phase_id, lot_type_id, value, sx, sy) =>
                setEditProjected({ phase_id, lot_type_id, value, sx, sy })
              }
              onError={setError}
            />
          )}

          {/* Mode instruction overlay — floats at top-center of canvas */}
          {hasPlan && mode !== 'view' && MODE_META[mode] && (
            <div style={{
              position: 'absolute', top: 12, left: '50%', transform: 'translateX(-50%)',
              zIndex: 20, pointerEvents: 'none',
              background: 'rgba(15,23,42,0.82)', borderRadius: 20,
              padding: '5px 18px', backdropFilter: 'blur(4px)',
              whiteSpace: 'nowrap',
            }}>
              <span style={{ fontSize: 12, color: '#e2e8f0', fontWeight: 500 }}>
                {MODE_META[mode].instruction}
              </span>
            </div>
          )}

          {/* Building group confirmation panel */}
          {pendingBuildingGroup && (
            <div style={{
              position: 'absolute', top: 16, right: 16, zIndex: 40,
              background: 'rgba(15,23,42,0.93)', borderRadius: 10, padding: '12px 16px',
              display: 'flex', flexDirection: 'column', gap: 10, backdropFilter: 'blur(4px)',
              maxWidth: 240, boxShadow: '0 4px 20px rgba(0,0,0,0.5)',
            }}>
              <div style={{ fontSize: 12, color: '#99f6e4', fontWeight: 600 }}>
                New building — {pendingBuildingGroup.lots.length} unit{pendingBuildingGroup.lots.length !== 1 ? 's' : ''}
              </div>
              <div style={{ fontSize: 11, color: '#94a3b8', lineHeight: 1.5 }}>
                {pendingBuildingGroup.lots.map(l => l.lot_number).join(' · ')}
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  onClick={handleBuildingGroupConfirm}
                  style={{ flex: 1, padding: '6px 0', borderRadius: 6, border: 'none',
                    background: '#0d9488', color: '#fff', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}
                >
                  ✓ Create
                </button>
                <button
                  onClick={handleBuildingGroupCancel}
                  style={{ flex: 1, padding: '6px 0', borderRadius: 6, border: '1px solid #475569',
                    background: 'transparent', color: '#94a3b8', fontSize: 12, cursor: 'pointer' }}
                >
                  ✗ Cancel
                </button>
              </div>
            </div>
          )}

          {/* Building group right-click context menu */}
          {bgContextMenu && (
            <div
              style={{
                position: 'absolute', left: bgContextMenu.x, top: bgContextMenu.y, zIndex: 50,
                background: '#1e293b', borderRadius: 8, border: '1px solid #334155',
                boxShadow: '0 4px 16px rgba(0,0,0,0.5)', minWidth: 190, overflow: 'hidden',
              }}
              onMouseLeave={() => setBgContextMenu(null)}
            >
              <button
                onClick={() => handleDeleteSingleBuildingGroup(bgContextMenu.id)}
                style={{ display: 'block', width: '100%', padding: '9px 14px', border: 'none',
                  background: 'transparent', color: '#fca5a5', fontSize: 12, textAlign: 'left',
                  cursor: 'pointer' }}
                onMouseEnter={e => { e.currentTarget.style.background = '#374151' }}
                onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}
              >
                Delete this building group
              </button>
              {selectedBgIds.size > 1 && selectedBgIds.has(bgContextMenu.id) && (
                <button
                  onClick={() => { setBgContextMenu(null); handleDeleteSelectedBuildingGroups() }}
                  style={{ display: 'block', width: '100%', padding: '9px 14px', border: 'none',
                    borderTop: '1px solid #334155',
                    background: 'transparent', color: '#fca5a5', fontSize: 12, textAlign: 'left',
                    cursor: 'pointer' }}
                  onMouseEnter={e => { e.currentTarget.style.background = '#374151' }}
                  onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}
                >
                  Delete all {selectedBgIds.size} selected groups
                </button>
              )}
              <button
                onClick={() => setBgContextMenu(null)}
                style={{ display: 'block', width: '100%', padding: '9px 14px', border: 'none',
                  borderTop: '1px solid #334155',
                  background: 'transparent', color: '#94a3b8', fontSize: 12, textAlign: 'left',
                  cursor: 'pointer' }}
                onMouseEnter={e => { e.currentTarget.style.background = '#374151' }}
                onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}
              >
                Cancel
              </button>
            </div>
          )}

          {/* Floating projected-count editor — opens when user clicks a p-value on the map */}
          {editProjected && (
            <div
              style={{
                position: 'absolute',
                left: Math.min(editProjected.sx + 8, window.innerWidth - 180),
                top: Math.max(8, editProjected.sy - 52),
                zIndex: 60,
                background: '#fff',
                borderRadius: 8,
                boxShadow: '0 4px 20px rgba(0,0,0,0.28)',
                padding: '10px 12px',
                border: '2px solid #0d9488',
                display: 'flex', flexDirection: 'column', gap: 6,
                minWidth: 148,
              }}
            >
              <div style={{ fontSize: 11, color: '#64748b', fontWeight: 500 }}>Projected count (p)</div>
              <ProjectedInput
                value={editProjected.value}
                onSave={async (v) => {
                  setEditProjected(null)
                  await handleProjectedCountChange(editProjected.phase_id, editProjected.lot_type_id, v)
                }}
                onCancel={() => setEditProjected(null)}
                autoFocus
              />
            </div>
          )}

          {/* Floating overlay for click-to-set mode */}
          {mode === 'place' && currentPlacingLot && (
            <div style={{
              position: 'absolute', bottom: 20, right: 20, zIndex: 30,
              background: 'rgba(15,23,42,0.88)', borderRadius: 8, padding: '10px 14px',
              display: 'flex', flexDirection: 'column', gap: 8, backdropFilter: 'blur(4px)',
            }}>
              <div style={{ fontSize: 11, color: '#94a3b8' }}>
                Click the map to set position
              </div>
              <div style={{ fontSize: 13, color: '#f1f5f9', fontWeight: 600 }}>
                {currentPlacingLot.lot_number}
              </div>
              <div style={{ fontSize: 10, color: '#64748b' }}>
                {placeQueue.length} lot{placeQueue.length !== 1 ? 's' : ''} remaining
              </div>
              <button
                onClick={endPlaceMode}
                style={{
                  marginTop: 2, padding: '5px 10px', borderRadius: 5, fontSize: 11,
                  background: '#334155', color: '#f1f5f9', border: '1px solid #475569',
                  cursor: 'pointer', fontWeight: 500,
                }}
              >
                End Placing
              </button>
            </div>
          )}
        </div>

        {/* Right panel — tabbed: Phase Assignment | Unit Counts */}
        {hasPlan && (
          <div style={{ display: 'flex', flexDirection: 'column', flexShrink: 0, height: '100%', overflow: 'hidden', background: '#fff', borderLeft: '1px solid #e5e7eb' }}>

            {/* Tab bar */}
            <div style={{ display: 'flex', flexShrink: 0, borderBottom: '1px solid #e5e7eb', background: '#f8fafc' }}>
              {[['assignment', 'Phase Assignment'], ['unit-counts', 'Unit Counts']].map(([key, label]) => (
                <button
                  key={key}
                  onClick={() => setRightPanelTab(key)}
                  style={{
                    flex: 1, padding: '7px 6px', border: 'none', borderBottom: rightPanelTab === key ? '2px solid #2563eb' : '2px solid transparent',
                    background: 'transparent', fontSize: 12, fontWeight: rightPanelTab === key ? 600 : 400,
                    color: rightPanelTab === key ? '#1d4ed8' : '#6b7280', cursor: 'pointer',
                    transition: 'color 0.15s',
                  }}
                >
                  {label}
                </button>
              ))}
            </div>

            {/* Assignment tab content */}
            {rightPanelTab === 'assignment' && (
              <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
                <PhasePanel
                  phases={phases}
                  phaseColorMap={phaseColorMap}
                  phaseToBoundaryId={phaseToBoundaryId}
                  instrumentColors={instrumentColors}
                  selectedBoundaryId={selectedBoundaryId}
                  unassignedSelectedBoundaryId={unassignedSelectedBoundaryId}
                  assignedPhaseIds={assignedPhaseIds}
                  onSelectBoundary={id => setSelectedBoundaryId(prev => prev === id ? null : id)}
                  onAssignBoundaryToPhase={assignPhaseToBoundary}
                  onUnassign={unassignBoundary}
                  onSwapBoundaries={swapBoundaryAssignments}
                  onInstrumentColorChange={handleInstrumentColorChange}
                  collapsed={phasePanelCollapsed}
                  onCollapseToggle={() => setPhasePanelCollapsed(v => !v)}
                />
                <UnassignedRegionsBar
                  boundaries={boundaries}
                  selectedBoundaryId={selectedBoundaryId}
                  onSelectBoundary={id => setSelectedBoundaryId(prev => prev === id ? null : id)}
                  onUnassignBoundary={unassignBoundary}
                  collapsed={unassignedBarCollapsed}
                  onCollapseToggle={() => setUnassignedBarCollapsed(v => !v)}
                />
              </div>
            )}

            {/* Unit counts tab content */}
            {rightPanelTab === 'unit-counts' && (
              <UnitCountsPanel
                phases={phases}
                unitCountsSubtotal={unitCountsSubtotal}
                onToggleSubtotal={setUnitCountsSubtotal}
                onProjectedCountChange={handleProjectedCountChange}
                instrumentColors={instrumentColors}
                onInstrumentColorChange={handleInstrumentColorChange}
                allLotTypes={allLotTypes}
                onAddLotType={handleAddLotType}
                onDeleteLotType={handleDeleteLotType}
                pendingDeleteLotType={pendingDeleteLotType}
                onClearPendingDelete={() => setPendingDeleteLotType(null)}
              />
            )}
          </div>
        )}
      </div>
    </div>
  )
}

export default function SitePlanView({ selectedGroupId, setSelectedGroupId }) {
  return <SitePlanErrorBoundary><SitePlanViewInner selectedGroupId={selectedGroupId} setSelectedGroupId={setSelectedGroupId} /></SitePlanErrorBoundary>
}

// ─── Phase Side Panel ─────────────────────────────────────────────────────────

const panelCollapseBtn = {
  width: 20, height: 20, borderRadius: 4, border: '1px solid #e5e7eb',
  background: '#fff', cursor: 'pointer', display: 'flex',
  alignItems: 'center', justifyContent: 'center', fontSize: 13,
  color: '#9ca3af', flexShrink: 0, lineHeight: 1,
}

function PhasePanel({
  phases, phaseColorMap, phaseToBoundaryId,
  instrumentColors, selectedBoundaryId, unassignedSelectedBoundaryId, assignedPhaseIds,
  onSelectBoundary, onAssignBoundaryToPhase, onUnassign, onSwapBoundaries,
  onInstrumentColorChange, collapsed, onCollapseToggle,
}) {
  const [dropTargetPhaseId, setDropTargetPhaseId] = useState(null)

  // Group phases by instrument_id; no-instrument phases go last
  const byInstrument = []
  const instrSeen = {}
  const noInstrumentPhases = []
  for (const ph of phases) {
    if (ph.instrument_id == null) { noInstrumentPhases.push(ph); continue }
    if (!(ph.instrument_id in instrSeen)) {
      instrSeen[ph.instrument_id] = byInstrument.length
      byInstrument.push({ instrument_id: ph.instrument_id, instrument_name: ph.instrument_name || `Instrument ${ph.instrument_id}`, phases: [] })
    }
    byInstrument[instrSeen[ph.instrument_id]].phases.push(ph)
  }

  function handlePhaseDragStart(e, ph) {
    const bId = phaseToBoundaryId?.[ph.phase_id]
    if (!bId) { e.preventDefault(); return }
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('devdb_drag_type', 'assigned_phase')
    e.dataTransfer.setData('devdb_boundary_id', String(bId))
    e.dataTransfer.setData('devdb_phase_id', String(ph.phase_id))
  }

  function handlePhaseDragOver(e, ph) {
    const hasDragData = Array.from(e.dataTransfer.types).includes('devdb_drag_type')
    if (!hasDragData) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    setDropTargetPhaseId(ph.phase_id)
  }

  function handlePhaseDrop(e, ph) {
    e.preventDefault()
    setDropTargetPhaseId(null)
    const dragType   = e.dataTransfer.getData('devdb_drag_type')
    const boundaryId = parseInt(e.dataTransfer.getData('devdb_boundary_id'), 10)
    if (!boundaryId) return
    const hasRegion = assignedPhaseIds.has(ph.phase_id)
    if (dragType === 'unassigned_boundary') {
      if (!hasRegion) onAssignBoundaryToPhase(boundaryId, ph.phase_id)
    } else if (dragType === 'assigned_phase') {
      const draggedPhaseId = parseInt(e.dataTransfer.getData('devdb_phase_id'), 10)
      if (ph.phase_id === draggedPhaseId) return
      if (hasRegion) {
        onSwapBoundaries(boundaryId, draggedPhaseId, phaseToBoundaryId[ph.phase_id], ph.phase_id)
      } else {
        onAssignBoundaryToPhase(boundaryId, ph.phase_id)
      }
    }
  }

  function renderPhaseRow(ph) {
    const hasRegion  = assignedPhaseIds.has(ph.phase_id)
    const isSel      = hasRegion && phaseToBoundaryId[ph.phase_id] === selectedBoundaryId
    const isDrop     = dropTargetPhaseId === ph.phase_id
    const instrColor = ph.instrument_id ? (instrumentColors[ph.instrument_id] || UNASSIGNED_COLOR) : UNASSIGNED_COLOR

    return (
      <div
        key={ph.phase_id}
        draggable={hasRegion}
        onDragStart={e => handlePhaseDragStart(e, ph)}
        onDragEnd={() => setDropTargetPhaseId(null)}
        onDragOver={e => handlePhaseDragOver(e, ph)}
        onDragLeave={() => setDropTargetPhaseId(null)}
        onDrop={e => handlePhaseDrop(e, ph)}
        onClick={() => {
          if (hasRegion) {
            onSelectBoundary(phaseToBoundaryId[ph.phase_id])
          } else if (unassignedSelectedBoundaryId) {
            onAssignBoundaryToPhase(unassignedSelectedBoundaryId, ph.phase_id)
          }
        }}
        style={{
          padding: '4px 8px 4px 12px', display: 'flex', alignItems: 'center', gap: 4,
          cursor: hasRegion ? 'grab' : unassignedSelectedBoundaryId ? 'pointer' : 'default',
          background: isDrop ? '#ede9fe' : isSel ? '#f5f3ff' : 'transparent',
          borderLeft: `3px solid ${isSel ? '#7c3aed' : 'transparent'}`,
          outline: isDrop ? '2px solid #c4b5fd' : 'none',
          outlineOffset: -2,
        }}
      >
        {/* Color swatch — shows instrument color when assigned */}
        <div style={{
          width: 8, height: 8, borderRadius: 2, flexShrink: 0,
          background: hasRegion ? instrColor : 'transparent',
          border: hasRegion ? 'none' : '1px solid #d1d5db',
        }} />
        <span style={{
          flex: 1, fontSize: 11, minWidth: 0,
          color: hasRegion ? '#111827' : '#9ca3af',
          fontWeight: isSel ? 600 : 400,
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>
          {ph.phase_name}
        </span>
        {hasRegion && (
          <button
            onClick={e => { e.stopPropagation(); onUnassign(phaseToBoundaryId[ph.phase_id]) }}
            title="Unassign region"
            style={{
              flexShrink: 0, width: 16, height: 16, borderRadius: 3,
              border: '1px solid #fecaca', background: '#fff5f5',
              color: '#ef4444', cursor: 'pointer', fontSize: 11,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              lineHeight: 1, padding: 0,
            }}
          >
            ×
          </button>
        )}
      </div>
    )
  }

  // ── Collapsed strip ──────────────────────────────────────────────────────────
  if (collapsed) {
    return (
      <div style={{
        width: 28, borderLeft: '1px solid #e5e7eb', background: '#fafafa',
        display: 'flex', flexDirection: 'column', alignItems: 'center',
        flexShrink: 0, padding: '8px 0', gap: 10,
      }}>
        <button onClick={onCollapseToggle} title="Show Phases" style={panelCollapseBtn}>‹</button>
        <span style={{
          fontSize: 10, color: '#9ca3af', fontWeight: 600,
          writingMode: 'vertical-rl', letterSpacing: '0.06em',
          textTransform: 'uppercase', userSelect: 'none',
        }}>
          Phases
        </span>
      </div>
    )
  }

  // ── Expanded panel ───────────────────────────────────────────────────────────
  return (
    <div style={{
      width: 240, borderLeft: '1px solid #e5e7eb', background: '#fafafa',
      display: 'flex', flexDirection: 'column', flexShrink: 0, overflow: 'hidden',
    }}>
      {/* Header */}
      <div style={{
        padding: '8px 12px', borderBottom: '1px solid #e5e7eb', background: '#fff',
        flexShrink: 0, display: 'flex', alignItems: 'flex-start', gap: 6,
      }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: '#374151' }}>Phases</div>
          <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 1 }}>
            {assignedPhaseIds.size > 0
              ? `${assignedPhaseIds.size} of ${phases.length} assigned`
              : `${phases.length} phase${phases.length !== 1 ? 's' : ''} · none assigned`}
          </div>
        </div>
        {onCollapseToggle && (
          <button onClick={onCollapseToggle} title="Collapse panel" style={panelCollapseBtn}>›</button>
        )}
      </div>

      {/* Hint when an unassigned region is selected */}
      {unassignedSelectedBoundaryId && (
        <div style={{
          padding: '5px 12px', background: '#f5f3ff', borderBottom: '1px solid #e5e7eb',
          fontSize: 11, color: '#7c3aed', flexShrink: 0,
        }}>
          Click a phase to assign selected region
        </div>
      )}

      {/* Phase list */}
      <div style={{ flex: 1, overflowY: 'auto' }}>
        {phases.length === 0 && (
          <div style={{ padding: '12px', fontSize: 11, color: '#9ca3af' }}>No phases found</div>
        )}

        {byInstrument.map(({ instrument_id, instrument_name, phases: instrPhases }) => {
          const instrColor = instrumentColors[instrument_id] || UNASSIGNED_COLOR
          return (
            <div key={instrument_id}>
              <div style={{
                padding: '3px 8px 3px 10px', fontSize: 10, fontWeight: 600,
                background: '#f3f4f6', display: 'flex', alignItems: 'center', gap: 6,
              }}>
                <div title="Click to change instrument color"
                  style={{ position: 'relative', width: 12, height: 12, borderRadius: 2, flexShrink: 0, background: instrColor, cursor: 'pointer', border: '1px solid rgba(0,0,0,0.2)' }}
                >
                  <input type="color" value={instrColor}
                    onChange={e => onInstrumentColorChange(instrument_id, e.target.value)}
                    style={{ position: 'absolute', inset: 0, opacity: 0, width: '100%', height: '100%', cursor: 'pointer', padding: 0, border: 'none' }}
                  />
                </div>
                <span style={{ color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.05em', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {instrument_name}
                </span>
              </div>
              {instrPhases.map(ph => renderPhaseRow(ph))}
            </div>
          )
        })}

        {noInstrumentPhases.length > 0 && (
          <div>
            <div style={{
              padding: '3px 12px', fontSize: 10, fontWeight: 600, color: '#9ca3af',
              background: '#f3f4f6', textTransform: 'uppercase', letterSpacing: '0.05em',
            }}>
              No Instrument
            </div>
            {noInstrumentPhases.map(ph => renderPhaseRow(ph))}
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Unassigned Regions Bar ───────────────────────────────────────────────────

function UnassignedRegionsBar({
  boundaries, selectedBoundaryId, onSelectBoundary, onUnassignBoundary,
  collapsed, onCollapseToggle,
}) {
  const [isBarDragOver, setIsBarDragOver] = useState(false)

  const unassigned = boundaries.filter(b => b.phase_id == null)

  if (collapsed) {
    return (
      <div style={{
        width: 28, borderLeft: '1px solid #e5e7eb', background: '#f9fafb',
        display: 'flex', flexDirection: 'column', alignItems: 'center',
        flexShrink: 0, padding: '8px 0', gap: 10,
      }}>
        <button onClick={onCollapseToggle} title="Show Unassigned Regions" style={panelCollapseBtn}>‹</button>
        <span style={{
          fontSize: 10, color: '#9ca3af', fontWeight: 600,
          writingMode: 'vertical-rl', letterSpacing: '0.06em',
          textTransform: 'uppercase', userSelect: 'none',
        }}>
          {unassigned.length > 0 ? `Unassigned (${unassigned.length})` : 'Unassigned'}
        </span>
      </div>
    )
  }

  function handleBarDragOver(e) {
    const types = Array.from(e.dataTransfer.types)
    if (types.includes('devdb_drag_type')) {
      e.preventDefault()
      e.dataTransfer.dropEffect = 'move'
      setIsBarDragOver(true)
    }
  }

  function handleBarDrop(e) {
    e.preventDefault()
    setIsBarDragOver(false)
    const dragType = e.dataTransfer.getData('devdb_drag_type')
    if (dragType === 'assigned_phase') {
      const boundaryId = parseInt(e.dataTransfer.getData('devdb_boundary_id'), 10)
      if (boundaryId) onUnassignBoundary(boundaryId)
    }
  }

  return (
    <div
      onDragOver={handleBarDragOver}
      onDragLeave={() => setIsBarDragOver(false)}
      onDrop={handleBarDrop}
      style={{
        width: 180, borderLeft: '1px solid #e5e7eb', background: isBarDragOver ? '#f5f3ff' : '#f9fafb',
        display: 'flex', flexDirection: 'column', flexShrink: 0, overflow: 'hidden',
        outline: isBarDragOver ? '2px solid #c4b5fd' : 'none', outlineOffset: -2,
        transition: 'background 0.1s',
      }}
    >
      {/* Header */}
      <div style={{
        padding: '8px 10px', borderBottom: '1px solid #e5e7eb', background: '#fff',
        flexShrink: 0, display: 'flex', alignItems: 'flex-start', gap: 6,
      }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: '#374151' }}>Unassigned</div>
          <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 1 }}>
            {unassigned.length > 0
              ? `${unassigned.length} region${unassigned.length !== 1 ? 's' : ''} · drag to phase`
              : 'No unassigned regions'}
          </div>
        </div>
        <button onClick={onCollapseToggle} title="Collapse" style={panelCollapseBtn}>›</button>
      </div>

      {/* Instruction when drag-over */}
      {isBarDragOver && (
        <div style={{
          padding: '6px 10px', background: '#ede9fe', fontSize: 11,
          color: '#7c3aed', fontWeight: 500, flexShrink: 0,
        }}>
          Drop to unassign region
        </div>
      )}

      {/* Unassigned boundary list */}
      <div style={{ flex: 1, overflowY: 'auto' }}>
        {unassigned.length === 0 && !isBarDragOver && (
          <div style={{ padding: '12px 10px', fontSize: 11, color: '#9ca3af', lineHeight: 1.5 }}>
            All regions assigned.{'\n'}Drag a phase here to unassign it.
          </div>
        )}
        {unassigned.map((b, i) => {
          const isSel = b.boundary_id === selectedBoundaryId
          return (
            <div
              key={b.boundary_id}
              draggable
              onDragStart={e => {
                e.dataTransfer.effectAllowed = 'move'
                e.dataTransfer.setData('devdb_drag_type', 'unassigned_boundary')
                e.dataTransfer.setData('devdb_boundary_id', String(b.boundary_id))
              }}
              onClick={() => onSelectBoundary(b.boundary_id)}
              title="Drag to a phase to assign"
              style={{
                padding: '5px 10px', cursor: 'grab', userSelect: 'none',
                borderBottom: '1px solid #f3f4f6',
                background: isSel ? '#ede9fe' : 'transparent',
                borderLeft: `4px solid ${isSel ? '#7c3aed' : 'transparent'}`,
                display: 'flex', alignItems: 'center', gap: 6,
              }}
            >
              <div style={{
                width: 10, height: 10, borderRadius: 2, flexShrink: 0,
                background: UNASSIGNED_COLOR,
                outline: isSel ? '2px solid #c4b5fd' : 'none', outlineOffset: 1,
              }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 11, fontWeight: isSel ? 700 : 400, color: '#6b7280' }}>
                  Region {boundaries.indexOf(b) + 1}
                </div>
                <div style={{ fontSize: 9, color: '#d1d5db', marginTop: 1 }}>drag to assign</div>
              </div>
              <span style={{ fontSize: 10, color: '#d1d5db', flexShrink: 0 }}>⠿</span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function DropZone({ onUpload, onBrowse, uploading }) {
  return (
    <div
      style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', background: '#f9fafb' }}
      onDragOver={e => e.preventDefault()}
      onDrop={e => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f?.type === 'application/pdf') onUpload(f) }}
    >
      <div style={{ border: '2px dashed #d1d5db', borderRadius: 12, padding: '48px 64px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12, background: '#fff' }}>
        <span style={{ fontSize: 14, color: '#6b7280' }}>No site plan uploaded for this project</span>
        <span style={{ fontSize: 12, color: '#9ca3af' }}>Drag and drop a PDF here, or</span>
        <button
          onClick={onBrowse}
          disabled={uploading}
          style={{ fontSize: 13, padding: '8px 20px', borderRadius: 6, border: '1px solid #2563eb', color: '#2563eb', cursor: uploading ? 'default' : 'pointer', background: '#fff', fontWeight: 500 }}
        >
          {uploading ? 'Uploading...' : 'Upload PDF'}
        </button>
      </div>
    </div>
  )
}

function Placeholder({ children }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: '#9ca3af', fontSize: 14, background: '#f9fafb' }}>
      {children}
    </div>
  )
}

// ─── Unit Counts Panel ────────────────────────────────────────────────────────

function UnitCountsPanel({
  phases, unitCountsSubtotal, onToggleSubtotal, onProjectedCountChange,
  instrumentColors = {}, onInstrumentColorChange,
  allLotTypes = [], onAddLotType, onDeleteLotType,
  pendingDeleteLotType, onClearPendingDelete,
}) {
  const [expanded, setExpanded] = useState(false)

  // Group phases by instrument (same logic as PhasePanel)
  const byInstrument = []
  const instrSeen = {}
  const noInstrumentPhases = []
  for (const ph of phases) {
    if (ph.instrument_id == null) { noInstrumentPhases.push(ph); continue }
    if (!(ph.instrument_id in instrSeen)) {
      instrSeen[ph.instrument_id] = byInstrument.length
      byInstrument.push({
        instrument_id: ph.instrument_id,
        instrument_name: ph.instrument_name || `Instrument ${ph.instrument_id}`,
        dev_name: ph.dev_name,
        phases: [],
      })
    }
    byInstrument[instrSeen[ph.instrument_id]].phases.push(ph)
  }

  const panelW = expanded ? 320 : 256

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden', minWidth: panelW, width: panelW, transition: 'width 0.15s' }}>

      {/* Controls row */}
      <div style={{ padding: '6px 10px', borderBottom: '1px solid #e5e7eb', background: '#f8fafc', display: 'flex', gap: 5, flexShrink: 0, alignItems: 'center' }}>
        {/* Map overlay toggle */}
        <button onClick={() => onToggleSubtotal(false)} style={{
          flex: 1, padding: '4px 4px', borderRadius: 5, fontSize: 10, cursor: 'pointer', fontWeight: !unitCountsSubtotal ? 600 : 400,
          border: `1px solid ${!unitCountsSubtotal ? '#0d9488' : '#d1d5db'}`,
          background: !unitCountsSubtotal ? '#f0fdfa' : '#fff',
          color: !unitCountsSubtotal ? '#0f766e' : '#6b7280',
        }}>Totals</button>
        <button onClick={() => onToggleSubtotal(true)} style={{
          flex: 1, padding: '4px 4px', borderRadius: 5, fontSize: 10, cursor: 'pointer', fontWeight: unitCountsSubtotal ? 600 : 400,
          border: `1px solid ${unitCountsSubtotal ? '#0d9488' : '#d1d5db'}`,
          background: unitCountsSubtotal ? '#f0fdfa' : '#fff',
          color: unitCountsSubtotal ? '#0f766e' : '#6b7280',
        }}>Lot Types</button>
        {/* Expanded/compressed view toggle */}
        <button onClick={() => setExpanded(v => !v)} title={expanded ? 'Compact view' : 'Expanded view'} style={{
          padding: '4px 7px', borderRadius: 5, fontSize: 10, cursor: 'pointer', flexShrink: 0,
          border: `1px solid ${expanded ? '#6366f1' : '#d1d5db'}`,
          background: expanded ? '#eef2ff' : '#fff',
          color: expanded ? '#4338ca' : '#6b7280', fontWeight: expanded ? 600 : 400,
        }}>{expanded ? '⊟' : '⊞'}</button>
      </div>

      {/* Pending delete lot type banner */}
      {pendingDeleteLotType && (
        <div style={{
          padding: '7px 10px', background: '#fef9c3', borderBottom: '1px solid #fde68a',
          display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0,
        }}>
          <div style={{ flex: 1, fontSize: 11, color: '#92400e', lineHeight: 1.4 }}>
            <strong>{pendingDeleteLotType.lot_type_short}</strong> has no units in{' '}
            <strong>{pendingDeleteLotType.phase_name}</strong>. Remove product type?
          </div>
          <button onClick={() => onDeleteLotType(pendingDeleteLotType.phase_id, pendingDeleteLotType.lot_type_id)}
            style={{ fontSize: 11, padding: '3px 8px', borderRadius: 4, border: '1px solid #f59e0b', background: '#fffbeb', color: '#92400e', cursor: 'pointer', fontWeight: 600, flexShrink: 0 }}>
            Remove
          </button>
          <button onClick={onClearPendingDelete}
            style={{ fontSize: 11, padding: '3px 8px', borderRadius: 4, border: '1px solid #e5e7eb', background: '#fff', color: '#6b7280', cursor: 'pointer', flexShrink: 0 }}>
            Keep
          </button>
        </div>
      )}

      {/* Scrollable phase list */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '6px 0' }}>
        {byInstrument.map(inst => {
          const instrColor = instrumentColors[inst.instrument_id] || UNASSIGNED_COLOR
          return (
            <div key={inst.instrument_id} style={{ marginBottom: 4 }}>
              <div style={{
                padding: '4px 10px', fontSize: 10, fontWeight: 700, color: '#374151', letterSpacing: '0.04em',
                background: '#f1f5f9', borderTop: '1px solid #e5e7eb', borderBottom: '1px solid #e5e7eb',
                display: 'flex', alignItems: 'center', gap: 6,
              }}>
                {/* Color swatch with picker — mirrors Phase Assignment tab */}
                <div title="Click to change instrument color" style={{ position: 'relative', width: 12, height: 12, borderRadius: 2, flexShrink: 0, background: instrColor, cursor: 'pointer', border: '1px solid rgba(0,0,0,0.2)' }}>
                  <input type="color" value={instrColor}
                    onChange={e => onInstrumentColorChange?.(inst.instrument_id, e.target.value)}
                    style={{ position: 'absolute', inset: 0, opacity: 0, width: '100%', height: '100%', cursor: 'pointer', padding: 0, border: 'none' }}
                  />
                </div>
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
                  {inst.instrument_name}
                </span>
                {inst.dev_name && <span style={{ fontWeight: 400, color: '#9ca3af', fontSize: 10, flexShrink: 0 }}>{inst.dev_name}</span>}
              </div>
              {inst.phases.map(ph => (
                <PhaseUnitBlock key={ph.phase_id} phase={ph} expanded={expanded}
                  allLotTypes={allLotTypes}
                  onProjectedCountChange={onProjectedCountChange}
                  onAddLotType={onAddLotType}
                  pendingDeleteLotTypeId={pendingDeleteLotType?.phase_id === ph.phase_id ? pendingDeleteLotType?.lot_type_id : null}
                />
              ))}
            </div>
          )
        })}
        {noInstrumentPhases.length > 0 && (
          <div>
            <div style={{
              padding: '4px 10px', fontSize: 10, fontWeight: 700, color: '#9ca3af',
              background: '#f1f5f9', borderTop: '1px solid #e5e7eb', borderBottom: '1px solid #e5e7eb',
            }}>
              Unassigned phases
            </div>
            {noInstrumentPhases.map(ph => (
              <PhaseUnitBlock key={ph.phase_id} phase={ph} expanded={expanded}
                allLotTypes={allLotTypes}
                onProjectedCountChange={onProjectedCountChange}
                onAddLotType={onAddLotType}
                pendingDeleteLotTypeId={pendingDeleteLotType?.phase_id === ph.phase_id ? pendingDeleteLotType?.lot_type_id : null}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function PhaseUnitBlock({ phase, expanded, allLotTypes, onProjectedCountChange, onAddLotType, pendingDeleteLotTypeId }) {
  const [showAddPicker, setShowAddPicker] = useState(false)
  const byLt = phase.by_lot_type || []
  const totalR = byLt.reduce((s, lt) => s + (lt.actual || 0), 0)
  const totalP = byLt.reduce((s, lt) => s + (lt.projected || 0), 0)
  const totalT = byLt.reduce((s, lt) => s + (lt.total || 0), 0)

  // Lot types not yet on this phase (for the add picker)
  const existingIds = new Set(byLt.map(lt => lt.lot_type_id))
  const availableTypes = allLotTypes.filter(lt => !existingIds.has(lt.lot_type_id))

  const pad  = expanded ? '8px 12px' : '6px 10px'
  const colT = expanded ? '72px' : '56px'
  const cols = `${colT} 1fr 1fr 1fr`

  return (
    <div style={{ padding: pad, borderBottom: '1px solid #f1f5f9' }}>
      <div style={{ fontSize: expanded ? 12 : 11, fontWeight: 600, color: '#1e293b', marginBottom: byLt.length ? 5 : 2 }}>
        {phase.phase_name}
      </div>
      {!byLt.length ? (
        <div style={{ fontSize: 10, color: '#9ca3af', marginBottom: 4 }}>No product types</div>
      ) : (
        <>
          {/* Column headers */}
          <div style={{ display: 'grid', gridTemplateColumns: cols, gap: 2, marginBottom: expanded ? 4 : 3 }}>
            <div style={{ fontSize: 9, color: '#94a3b8', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em' }}>Type</div>
            <div style={{ fontSize: 9, color: '#64748b', fontWeight: 700, textAlign: 'center', textTransform: 'uppercase', letterSpacing: '0.04em' }}>R</div>
            <div style={{ fontSize: 9, color: '#0f766e', fontWeight: 700, textAlign: 'center', textTransform: 'uppercase', letterSpacing: '0.04em' }}>P</div>
            <div style={{ fontSize: 9, color: '#374151', fontWeight: 700, textAlign: 'center', textTransform: 'uppercase', letterSpacing: '0.04em' }}>T</div>
          </div>
          {/* Lot type rows */}
          {byLt.map(lt => {
            const isPendingDelete = lt.lot_type_id === pendingDeleteLotTypeId
            return (
              <div key={lt.lot_type_id}
                style={{
                  display: 'grid', gridTemplateColumns: cols, gap: 2,
                  marginBottom: expanded ? 3 : 2, alignItems: 'center',
                  background: isPendingDelete ? '#fef9c3' : 'transparent',
                  borderRadius: isPendingDelete ? 3 : 0,
                  padding: isPendingDelete ? '1px 2px' : 0,
                }}>
                <div style={{ fontSize: expanded ? 12 : 11, color: '#475569' }}>{lt.lot_type_short}</div>
                <div style={{ fontSize: expanded ? 12 : 11, color: '#64748b', textAlign: 'center' }}>{lt.actual ?? 0}</div>
                <div style={{ textAlign: 'center' }}>
                  <ProjectedInput
                    value={lt.projected ?? 0}
                    onSave={v => onProjectedCountChange(phase.phase_id, lt.lot_type_id, v)}
                  />
                </div>
                <div style={{ fontSize: expanded ? 12 : 11, color: '#1e293b', textAlign: 'center', fontWeight: 600 }}>{lt.total ?? 0}</div>
              </div>
            )
          })}
          {/* Total row (only shown when multiple lot types) */}
          {byLt.length > 1 && (
            <div style={{ display: 'grid', gridTemplateColumns: cols, gap: 2, marginTop: 3, paddingTop: 3, borderTop: '1px solid #e2e8f0', alignItems: 'center' }}>
              <div style={{ fontSize: 9, color: '#94a3b8', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em' }}>Total</div>
              <div style={{ fontSize: expanded ? 12 : 11, color: '#64748b', textAlign: 'center', fontWeight: 600 }}>{totalR}</div>
              <div style={{ fontSize: expanded ? 12 : 11, color: '#0f766e', textAlign: 'center', fontWeight: 600 }}>{totalP}</div>
              <div style={{ fontSize: expanded ? 12 : 11, color: '#1e293b', textAlign: 'center', fontWeight: 700 }}>{totalT}</div>
            </div>
          )}
        </>
      )}
      {/* Add product type */}
      {!showAddPicker ? (
        <button onClick={() => setShowAddPicker(true)}
          style={{ marginTop: 4, fontSize: 10, color: '#6366f1', background: 'none', border: 'none', cursor: 'pointer', padding: '2px 0', fontWeight: 500 }}>
          + Add product type
        </button>
      ) : (
        <div style={{ marginTop: 4, display: 'flex', gap: 4, alignItems: 'center' }}>
          {availableTypes.length === 0 ? (
            <span style={{ fontSize: 10, color: '#9ca3af' }}>All types assigned</span>
          ) : (
            <select
              autoFocus
              defaultValue=""
              onChange={e => {
                const id = parseInt(e.target.value, 10)
                if (id) { onAddLotType?.(phase.phase_id, id); setShowAddPicker(false) }
              }}
              onBlur={() => setShowAddPicker(false)}
              style={{ fontSize: 11, borderRadius: 4, border: '1px solid #6366f1', padding: '2px 4px', color: '#374151' }}
            >
              <option value="">Select type...</option>
              {availableTypes.map(lt => (
                <option key={lt.lot_type_id} value={lt.lot_type_id}>{lt.lot_type_short}</option>
              ))}
            </select>
          )}
          <button onClick={() => setShowAddPicker(false)}
            style={{ fontSize: 10, color: '#9ca3af', background: 'none', border: 'none', cursor: 'pointer' }}>×</button>
        </div>
      )}
    </div>
  )
}

// Shared editable projected-count input used in both UnitCountsPanel and the floating map editor.
function ProjectedInput({ value, onSave, onCancel, autoFocus }) {
  const [local, setLocal] = useState(String(value ?? 0))
  // Sync when parent value changes (another editor may have saved the same field)
  useEffect(() => { setLocal(String(value ?? 0)) }, [value])

  function commit() {
    const n = parseInt(local, 10)
    if (!isNaN(n) && n >= 0 && n !== value) onSave(n)
    else setLocal(String(value ?? 0))
  }

  return (
    <input
      type="number"
      value={local}
      min={0}
      autoFocus={autoFocus}
      onChange={e => setLocal(e.target.value)}
      onBlur={commit}
      onKeyDown={e => {
        if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur() }
        if (e.key === 'Escape') { setLocal(String(value ?? 0)); onCancel?.(); e.currentTarget.blur() }
      }}
      style={{
        width: autoFocus ? 72 : 34, textAlign: 'center', fontSize: autoFocus ? 14 : 11,
        border: '1px solid #0d9488', borderRadius: 4, padding: autoFocus ? '4px 6px' : '1px 2px',
        color: '#0f766e', fontWeight: 600, background: '#f0fdfa', outline: 'none',
      }}
    />
  )
}
