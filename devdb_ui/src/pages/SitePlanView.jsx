// SitePlanView.jsx
// Main site plan page. Entitlement group picker + mode controls in toolbar.
// Right panel: phase boundary list + phase assignment when boundaries exist.

import { useState, useEffect, useRef, useCallback, useMemo, Component } from 'react'
import PdfCanvas from '../components/SitePlan/PdfCanvas'
import LotBank from '../components/SitePlan/LotBank'

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

function SitePlanViewInner() {
  const [entGroups, setEntGroups]             = useState([])
  const [selectedGroupId, setSelectedGroupId] = useState('')
  const [plan, setPlan]                       = useState(null)
  const [loading, setLoading]                 = useState(false)
  const [uploading, setUploading]             = useState(false)
  const [error, setError]                     = useState(null)
  const [mode, setMode]                       = useState('view')
  const [boundaries, setBoundaries]           = useState([])
  const [selectedBoundaryId, setSelectedBoundaryId] = useState(null)
  const [phases, setPhases]                   = useState([])
  const [undoStack, setUndoStack]             = useState([])
  const [instrumentColors, setInstrumentColors] = useState({})  // {instrument_id: color}
  const [lotBankCollapsed, setLotBankCollapsed]       = useState(false)
  const [phasePanelCollapsed, setPhasePanelCollapsed] = useState(false)

  // Lot bank + positioning
  const [allLots, setAllLots]             = useState([])   // all real lots for this ent_group
  const [lotPositions, setLotPositions]   = useState({})   // {lot_id: {x,y}} — local (unsaved)
  const [savedPositions, setSavedPositions] = useState({}) // {lot_id: {x,y}} — last saved
  const [isDirty, setIsDirty]             = useState(false)
  const [placeQueue, setPlaceQueue]       = useState([])   // [{lot_id, lot_number,...}] click-to-set queue

  const fileInputRef  = useRef(null)
  const boundariesRef = useRef(boundaries)
  useEffect(() => { boundariesRef.current = boundaries }, [boundaries])

  // Load entitlement groups
  useEffect(() => {
    fetch(`${API}/entitlement-groups`)
      .then(r => r.json())
      .then(gs => setEntGroups(gs.sort((a, b) => a.ent_group_name.localeCompare(b.ent_group_name))))
      .catch(() => setError('Could not load entitlement groups'))
  }, [])

  // Load plan when group changes
  useEffect(() => {
    if (!selectedGroupId) {
      setPlan(null); setMode('view'); setBoundaries([]); setPhases([])
      setSelectedBoundaryId(null); setUndoStack([])
      return
    }
    setUndoStack([])
    setLoading(true)
    setError(null)
    fetch(`${API}/site-plans/ent-group/${selectedGroupId}`)
      .then(r => { if (r.status === 404) return null; if (!r.ok) throw new Error(); return r.json() })
      .then(data => { setPlan(data); setLoading(false) })
      .catch(() => { setError('Could not load site plan'); setLoading(false) })
  }, [selectedGroupId])

  // Load boundaries when plan changes
  useEffect(() => {
    if (!plan) { setBoundaries([]); setSelectedBoundaryId(null); return }
    fetch(`${API}/phase-boundaries/plan/${plan.plan_id}`)
      .then(r => r.ok ? r.json() : [])
      .then(bs => setBoundaries(bs))
      .catch(() => setBoundaries([]))
  }, [plan?.plan_id])

  // Load stored instrument colors when group changes
  useEffect(() => {
    if (!selectedGroupId) { setInstrumentColors({}); return }
    try {
      const stored = localStorage.getItem(`devdb_siteplan_colors_${selectedGroupId}`)
      setInstrumentColors(stored ? JSON.parse(stored) : {})
    } catch { setInstrumentColors({}) }
  }, [selectedGroupId])

  // Load phases for the side panel
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

  // Auto-assign colors for any instrument not yet in instrumentColors
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

  // Load lot positions when plan changes
  useEffect(() => {
    if (!plan) {
      setAllLots([]); setLotPositions({}); setSavedPositions({}); setIsDirty(false); setPlaceQueue([])
      return
    }
    fetch(`${API}/lot-positions/plan/${plan.plan_id}`)
      .then(r => r.ok ? r.json() : { positioned: [], bank: [] })
      .then(data => {
        const all = [...(data.positioned || []), ...(data.bank || [])]
        setAllLots(all)
        const pos = {}
        for (const l of (data.positioned || [])) pos[l.lot_id] = { x: l.x, y: l.y }
        setLotPositions(pos)
        setSavedPositions(pos)
        setIsDirty(false)
      })
      .catch(() => {})
  }, [plan?.plan_id])

  // ─── Point-in-polygon (ray casting, normalized coords) ─────────────────────
  function pointInPolygon(px, py, polygon) {
    let inside = false
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
      const xi = polygon[i].x, yi = polygon[i].y
      const xj = polygon[j].x, yj = polygon[j].y
      if (((yi > py) !== (yj > py)) && px < ((xj - xi) * (py - yi) / (yj - yi) + xi))
        inside = !inside
    }
    return inside
  }

  // Returns phase_id (may be null) if inside any boundary, or undefined if outside all.
  function findPhaseForPosition(x, y) {
    for (const b of boundaries) {
      const poly = JSON.parse(b.polygon_json)
      if (pointInPolygon(x, y, poly)) return b.phase_id  // null if unassigned boundary
    }
    return undefined  // outside all polygons
  }

  // ─── Lot placement handlers ─────────────────────────────────────────────────
  const handleLotDrop = useCallback((lotId, normPos) => {
    setLotPositions(prev => ({ ...prev, [lotId]: normPos }))
    setIsDirty(true)
  }, [])

  const handleLotMove = useCallback((lotId, normPos) => {
    setLotPositions(prev => ({ ...prev, [lotId]: normPos }))
    setIsDirty(true)
  }, [])

  // Called by PdfCanvas when user clicks in 'place' mode
  const handlePlaceLot = useCallback((normPos) => {
    setPlaceQueue(prev => {
      if (!prev.length) return prev
      const [current, ...rest] = prev
      setLotPositions(lp => ({ ...lp, [current.lot_id]: normPos }))
      setIsDirty(true)
      if (!rest.length) setMode('view')  // exhausted the queue
      return rest
    })
  }, [])

  function startPlaceFromLot(lot) {
    // Build queue starting from this lot, continuing through rest of bank in order
    const idx = bankLots.findIndex(l => l.lot_id === lot.lot_id)
    const queue = idx >= 0 ? [...bankLots.slice(idx), ...bankLots.slice(0, idx)] : bankLots
    setPlaceQueue(queue)
    setMode('place')
  }

  function endPlaceMode() {
    setPlaceQueue([])
    setMode('view')
  }

  // ─── Save / Discard ────────────────────────────────────────────────────────
  async function handleSaveLotPositions() {
    if (!plan) return
    const updates = [], removes = []
    for (const [lotIdStr, pos] of Object.entries(lotPositions)) {
      const lotId = Number(lotIdStr)
      const phase = findPhaseForPosition(pos.x, pos.y)
      // Always keep the lot at its position. If outside all polygons or inside an
      // unassigned polygon, phase_id is null — the lot stays on the map, unassigned.
      updates.push({ lot_id: lotId, x: pos.x, y: pos.y, phase_id: phase ?? null })
    }
    // Only remove lots the user explicitly took off the map (present in savedPositions
    // but absent from current lotPositions — i.e., dragged back to the bank).
    for (const lotIdStr of Object.keys(savedPositions)) {
      const lotId = Number(lotIdStr)
      if (!(lotId in lotPositions)) removes.push(lotId)
    }
    try {
      const res = await fetch(`${API}/lot-positions/plan/${plan.plan_id}/save`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ updates, removes: [...new Set(removes)] }),
      })
      if (res.ok) {
        const data = await res.json()
        const all = [...(data.positioned || []), ...(data.bank || [])]
        setAllLots(all)
        const pos = {}
        for (const l of (data.positioned || [])) pos[l.lot_id] = { x: l.x, y: l.y }
        setLotPositions(pos)
        setSavedPositions(pos)
        setIsDirty(false)
        setPlaceQueue([])
        setMode('view')
      }
    } catch { /* ignore */ }
  }

  function handleDiscardLotPositions() {
    setLotPositions(savedPositions)
    setIsDirty(false)
    setPlaceQueue([])
    setMode('view')
  }

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
    setBoundaries([])
    setSelectedBoundaryId(null)
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
        setBoundaries([])
        setSelectedBoundaryId(null)
        setMode('view')
      }
    } catch { /* ignore */ }
  }

  async function handleDeleteBoundary(boundaryId) {
    try {
      await fetch(`${API}/phase-boundaries/${boundaryId}`, { method: 'DELETE' })
      setBoundaries(bs => bs.filter(b => b.boundary_id !== boundaryId))
      setSelectedBoundaryId(prev => prev === boundaryId ? null : prev)
      setUndoStack([])  // delete-phase edits aren't undoable; clear stack to avoid stale undo
    } catch { /* ignore */ }
  }

  async function handleDeleteAllBoundaries() {
    if (!plan || !boundaries.length) return
    try {
      await Promise.all(boundaries.map(b =>
        fetch(`${API}/phase-boundaries/${b.boundary_id}`, { method: 'DELETE' })
      ))
      setBoundaries([])
      setSelectedBoundaryId(null)
      setUndoStack([])
      setMode('view')
    } catch { /* ignore */ }
  }

  async function handleDeleteCommunityBoundary() {
    if (!plan) return
    if (!window.confirm('Delete the community boundary and all phases? This cannot be undone.')) return
    try {
      // Delete all boundaries from DB
      await Promise.all(boundaries.map(b =>
        fetch(`${API}/phase-boundaries/${b.boundary_id}`, { method: 'DELETE' })
      ))
      // Clear parcel from DB
      await fetch(`${API}/site-plans/${plan.plan_id}/parcel`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ parcel_json: null }),
      })
      setPlan(p => ({ ...p, parcel_json: null }))
      setBoundaries([])
      setSelectedBoundaryId(null)
      setUndoStack([])
      setMode('view')
    } catch { /* ignore */ }
  }

  const onSplitConfirm = useCallback(async (originalBoundaryId, polyA, polyB) => {
    if (!plan) return
    const original = originalBoundaryId != null
      ? boundariesRef.current.find(b => b.boundary_id === originalBoundaryId)
      : null
    try {
      const res = await fetch(`${API}/phase-boundaries/split`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          plan_id: plan.plan_id,
          original_boundary_id: originalBoundaryId ?? null,
          polygon_a: JSON.stringify(polyA),
          polygon_b: JSON.stringify(polyB),
        }),
      })
      if (!res.ok) throw new Error('Split failed')
      const newPair = await res.json()  // [{boundary_id, ...}, {boundary_id, ...}]
      const fresh = await fetch(`${API}/phase-boundaries/plan/${plan.plan_id}`)
      setBoundaries(fresh.ok ? await fresh.json() : [])
      setSelectedBoundaryId(null)
      if (original) {
        setUndoStack(prev => [...prev.slice(-19), {
          type: 'split',
          deleted: original,
          addedIds: newPair.map(b => b.boundary_id),
        }])
      }
    } catch (err) { setError(err.message) }
  }, [plan?.plan_id])

  const onBoundarySelect = useCallback((id) => {
    setSelectedBoundaryId(prev => prev === id ? null : id)
  }, [])

  // Called by PdfCanvas before/after vertex edits — push undo entry
  const onVertexEditComplete = useCallback((oldStates) => {
    if (!oldStates?.length) return
    setUndoStack(prev => [...prev.slice(-19), { type: 'edit', oldStates }])
  }, [])

  async function handleUndo() {
    if (!undoStack.length || !plan) return
    const entry = undoStack[undoStack.length - 1]
    setUndoStack(prev => prev.slice(0, -1))
    setError(null)
    try {
      if (entry.type === 'split') {
        // Delete the two child boundaries, then re-create the original
        for (const id of entry.addedIds) {
          await fetch(`${API}/phase-boundaries/${id}`, { method: 'DELETE' })
        }
        await fetch(`${API}/phase-boundaries`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            plan_id: plan.plan_id,
            polygon_json: entry.deleted.polygon_json,
            label: entry.deleted.label ?? undefined,
            phase_id: entry.deleted.phase_id ?? undefined,
            split_order: entry.deleted.split_order,
          }),
        })
      } else if (entry.type === 'edit') {
        for (const { boundary_id, old_polygon_json } of entry.oldStates) {
          await fetch(`${API}/phase-boundaries/${boundary_id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ polygon_json: old_polygon_json }),
          })
        }
      }
      const fresh = await fetch(`${API}/phase-boundaries/plan/${plan.plan_id}`)
      setBoundaries(fresh.ok ? await fresh.json() : [])
      setSelectedBoundaryId(null)
    } catch (err) {
      setError('Undo failed: ' + err.message)
      setUndoStack(prev => [...prev, entry])  // re-push on failure
    }
  }

  async function assignPhaseToSelected(phaseId) {
    if (!selectedBoundaryId) return
    try {
      const res = await fetch(`${API}/phase-boundaries/${selectedBoundaryId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phase_id: phaseId }),
      })
      if (res.ok) {
        const updated = await res.json()
        setBoundaries(bs => bs.map(b => b.boundary_id === selectedBoundaryId ? updated : b))
      }
    } catch { /* ignore */ }
  }

  async function unassignBoundary(boundaryId) {
    try {
      const res = await fetch(`${API}/phase-boundaries/${boundaryId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phase_id: null }),
      })
      if (res.ok) {
        const updated = await res.json()
        setBoundaries(bs => bs.map(b => b.boundary_id === boundaryId ? updated : b))
      }
    } catch { /* ignore */ }
  }

  const initialParcel = plan?.parcel_json ? JSON.parse(plan.parcel_json) : null
  const pdfUrl        = plan ? `${API}/site-plans/${plan.plan_id}/file` : null
  const hasPlan       = !!plan
  const hasParcel     = !!(plan?.parcel_json)
  const hasBoundaries = boundaries.length > 0

  // Build maps for the side panel
  const phaseMap       = Object.fromEntries(phases.map(p => [p.phase_id, p]))
  const assignedPhaseIds = new Set(boundaries.filter(b => b.phase_id).map(b => b.phase_id))

  // Build phase_id → color map from instrument color state
  const phaseColorMap = Object.fromEntries(
    phases.filter(p => p.instrument_id != null && instrumentColors[p.instrument_id])
      .map(p => [p.phase_id, instrumentColors[p.instrument_id]])
  )
  const selectedBoundary = selectedBoundaryId
    ? boundaries.find(b => b.boundary_id === selectedBoundaryId)
    : null

  // Lot bank derived state
  const bankLots = useMemo(
    () => allLots.filter(l => !(l.lot_id in lotPositions)),
    [allLots, lotPositions]
  )
  const currentPlacingLot = placeQueue[0] || null

  // lot_id → color (by instrument)
  const lotColorMap = useMemo(() => {
    const m = {}
    for (const l of allLots) {
      if (l.instrument_id && instrumentColors[l.instrument_id])
        m[l.lot_id] = instrumentColors[l.instrument_id]
    }
    return m
  }, [allLots, instrumentColors])

  // lot_id → metadata for PdfCanvas
  const lotMeta = useMemo(() => {
    const m = {}
    for (const l of allLots) m[l.lot_id] = { lot_number: l.lot_number, instrument_id: l.instrument_id }
    return m
  }, [allLots])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: 'calc(100vh - 44px)' }}>

      {/* Toolbar */}
      <div style={{
        padding: '0 16px', borderBottom: '1px solid #e5e7eb',
        background: '#fff', height: 44,
        display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0,
      }}>
        <select
          value={selectedGroupId}
          onChange={e => { setSelectedGroupId(e.target.value); setMode('view'); setSelectedBoundaryId(null) }}
          style={{ fontSize: 13, padding: '4px 8px', borderRadius: 4, border: '1px solid #d1d5db', minWidth: 220 }}
        >
          <option value=''>Select project...</option>
          {entGroups.map(g => (
            <option key={g.ent_group_id} value={g.ent_group_id}>{g.ent_group_name}</option>
          ))}
        </select>

        {hasPlan && <div style={{ width: 1, height: 20, background: '#e5e7eb' }} />}

        {/* Undo — visible when there's something to undo and not tracing */}
        {hasPlan && undoStack.length > 0 && mode !== 'trace' && (
          <button onClick={handleUndo} style={btn('#b45309', '#fffbeb', '#fde68a')}>↩ Undo</button>
        )}

        {/* View mode tools */}
        {hasPlan && mode === 'view' && (
          <>
            <button onClick={() => setMode('trace')} style={btn('#2563eb', '#eff6ff', '#bfdbfe')}>
              {hasParcel ? 'Retrace Parcel' : 'Trace Parcel'}
            </button>
            {hasParcel && (
              <button onClick={() => setMode('edit')} style={btn('#374151', '#f9fafb', '#e5e7eb')}>
                Edit Vertices
              </button>
            )}
            <button onClick={() => { setMode('split'); setSelectedBoundaryId(null) }} style={btn('#7c3aed', '#f5f3ff', '#ddd6fe')}>
              Split Region
            </button>
            {hasBoundaries && (
              <button onClick={() => { setMode('delete-phases'); setSelectedBoundaryId(null) }} style={btn('#b45309', '#fffbeb', '#fde68a')}>
                Delete Phases
              </button>
            )}
            {hasParcel && (
              <button onClick={handleDeleteCommunityBoundary} style={btn('#dc2626', '#fef2f2', '#fecaca')}>
                Delete Community Boundary
              </button>
            )}
          </>
        )}

        {/* Active-mode exit buttons — instructions shown as canvas overlay instead */}
        {hasPlan && mode === 'trace' && (
          <button onClick={() => setMode('view')} style={btn('#374151', '#f9fafb', '#e5e7eb')}>Cancel</button>
        )}
        {hasPlan && mode === 'edit' && (
          <button onClick={() => setMode('view')} style={btn('#1d4ed8', '#eff6ff', '#bfdbfe')}>Done</button>
        )}
        {hasPlan && mode === 'split' && (
          <button onClick={() => { setMode('view'); setSelectedBoundaryId(null) }} style={btn('#374151', '#f9fafb', '#e5e7eb')}>Done</button>
        )}
        {hasPlan && mode === 'delete-phases' && (
          <>
            <button onClick={handleDeleteAllBoundaries} style={btn('#dc2626', '#fef2f2', '#fecaca')}>Delete All</button>
            <button onClick={() => setMode('view')} style={btn('#374151', '#f9fafb', '#e5e7eb')}>Done</button>
          </>
        )}

        {hasPlan && <div style={{ width: 1, height: 20, background: '#e5e7eb' }} />}

        {hasPlan && (
          <button onClick={() => fileInputRef.current?.click()} disabled={uploading} style={btnGray}>
            Replace PDF
          </button>
        )}

        {error && <span style={{ fontSize: 12, color: '#dc2626' }}>{error}</span>}
        <input ref={fileInputRef} type='file' accept='.pdf' style={{ display: 'none' }} onChange={handleFileChange} />
      </div>

      {/* Lot positions unsaved bar */}
      {isDirty && (
        <div style={{
          padding: '6px 16px', background: '#fffbeb', borderBottom: '1px solid #fde68a',
          display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0,
        }}>
          <span style={{ fontSize: 12, color: '#92400e', flex: 1 }}>
            Lot positions have unsaved changes
          </span>
          <button onClick={handleSaveLotPositions} style={btn('#15803d', '#f0fdf4', '#bbf7d0')}>Save</button>
          <button onClick={handleDiscardLotPositions} style={btn('#6b7280', '#f9fafb', '#e5e7eb')}>Discard</button>
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
              onBoundaryUpdated={updated => setBoundaries(bs => bs.map(b => b.boundary_id === updated.boundary_id ? updated : b))}
              onVertexEditComplete={onVertexEditComplete}
              lotPositions={lotPositions}
              lotMeta={lotMeta}
              lotColorMap={lotColorMap}
              placingLot={currentPlacingLot}
              onPlaceLot={handlePlaceLot}
              onLotDrop={handleLotDrop}
              onLotMove={handleLotMove}
            />
          )}

          {/* Mode instruction overlay — floats at top-center of canvas */}
          {hasPlan && mode !== 'view' && mode !== 'place' && (
            <div style={{
              position: 'absolute', top: 12, left: '50%', transform: 'translateX(-50%)',
              zIndex: 20, pointerEvents: 'none',
              background: 'rgba(15,23,42,0.80)', borderRadius: 20,
              padding: '5px 18px', backdropFilter: 'blur(4px)',
              whiteSpace: 'nowrap',
            }}>
              <span style={{ fontSize: 12, color: '#e2e8f0', fontWeight: 500 }}>
                {mode === 'trace'          && 'Click to place vertices · click first vertex to close'}
                {mode === 'edit'           && 'Drag vertices · click edge to add point · right-click to remove'}
                {mode === 'split'          && 'Click any boundary edge to begin · draw across the region · click any boundary edge to split'}
                {mode === 'delete-phases'  && 'Click a phase region to delete it · or use Delete All in the toolbar'}
              </span>
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

        {/* Phase side panel — collapsible */}
        {hasPlan && (
          <PhasePanel
            boundaries={boundaries}
            phases={phases}
            phaseMap={phaseMap}
            phaseColorMap={phaseColorMap}
            instrumentColors={instrumentColors}
            selectedBoundaryId={selectedBoundaryId}
            selectedBoundary={selectedBoundary}
            assignedPhaseIds={assignedPhaseIds}
            onSelectBoundary={id => setSelectedBoundaryId(prev => prev === id ? null : id)}
            onDeleteBoundary={handleDeleteBoundary}
            onAssign={assignPhaseToSelected}
            onUnassign={unassignBoundary}
            onInstrumentColorChange={handleInstrumentColorChange}
            mode={mode}
            collapsed={phasePanelCollapsed}
            onCollapseToggle={() => setPhasePanelCollapsed(v => !v)}
          />
        )}
      </div>
    </div>
  )
}

export default function SitePlanView() {
  return <SitePlanErrorBoundary><SitePlanViewInner /></SitePlanErrorBoundary>
}

// ─── Phase Side Panel ─────────────────────────────────────────────────────────

const panelCollapseBtn = {
  width: 20, height: 20, borderRadius: 4, border: '1px solid #e5e7eb',
  background: '#fff', cursor: 'pointer', display: 'flex',
  alignItems: 'center', justifyContent: 'center', fontSize: 13,
  color: '#9ca3af', flexShrink: 0, lineHeight: 1,
}

function PhasePanel({
  boundaries, phases, phaseMap, phaseColorMap,
  instrumentColors, selectedBoundaryId, selectedBoundary, assignedPhaseIds,
  onSelectBoundary, onDeleteBoundary, onAssign, onUnassign, onInstrumentColorChange, mode,
  collapsed, onCollapseToggle,
}) {
  // Group phases by instrument_id; unassigned (null) go into a separate list
  const byInstrument = []  // [{instrument_id, instrument_name, phases[]}]
  const instrSeen = {}
  const unassigned = []
  for (const ph of phases) {
    if (ph.instrument_id == null) { unassigned.push(ph); continue }
    if (!(ph.instrument_id in instrSeen)) {
      instrSeen[ph.instrument_id] = byInstrument.length
      byInstrument.push({ instrument_id: ph.instrument_id, instrument_name: ph.instrument_name || `Instrument ${ph.instrument_id}`, phases: [] })
    }
    byInstrument[instrSeen[ph.instrument_id]].phases.push(ph)
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
          {boundaries.length > 0 ? `Phases (${boundaries.length})` : 'Phases'}
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
      {/* Panel header */}
      <div style={{
        padding: '8px 12px', borderBottom: '1px solid #e5e7eb', background: '#fff',
        flexShrink: 0, display: 'flex', alignItems: 'flex-start', gap: 6,
      }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: '#374151' }}>Phases</div>
          <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 1 }}>
            {boundaries.length > 0
              ? `${boundaries.length} region${boundaries.length !== 1 ? 's' : ''} · ${assignedPhaseIds.size} assigned`
              : 'No regions yet'}
          </div>
        </div>
        {onCollapseToggle && (
          <button onClick={onCollapseToggle} title="Collapse panel" style={panelCollapseBtn}>›</button>
        )}
      </div>

      {/* Empty state */}
      {boundaries.length === 0 && (
        <div style={{ padding: '16px 12px', fontSize: 11, color: '#9ca3af', lineHeight: 1.5 }}>
          Trace a parcel on the plan to create your first phase region, then use Split Region to subdivide it.
        </div>
      )}

      {/* Boundary list — phase name is the primary label */}
      <div style={{ borderBottom: '1px solid #e5e7eb', background: '#fff', flexShrink: 0 }}>
        {boundaries.map((b, i) => {
          const ap = b.phase_id ? phaseMap[b.phase_id] : null
          const isSel = b.boundary_id === selectedBoundaryId
          const swatchColor = (b.phase_id && phaseColorMap[b.phase_id]) || UNASSIGNED_COLOR
          return (
            <div
              key={b.boundary_id}
              onClick={() => onSelectBoundary(b.boundary_id)}
              style={{
                padding: '5px 8px 5px 8px', cursor: 'pointer',
                borderBottom: '1px solid #f3f4f6',
                background: isSel ? '#ede9fe' : 'transparent',
                borderLeft: `4px solid ${isSel ? '#7c3aed' : 'transparent'}`,
                display: 'flex', alignItems: 'center', gap: 4,
              }}
            >
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <div style={{
                    width: 10, height: 10, borderRadius: 2, flexShrink: 0,
                    background: swatchColor,
                    outline: isSel ? '2px solid #c4b5fd' : 'none',
                    outlineOffset: 1,
                  }} />
                  <span style={{
                    fontSize: 11, fontWeight: isSel ? 700 : ap ? 500 : 400,
                    color: ap ? '#1e293b' : '#9ca3af',
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  }}>
                    {ap ? ap.phase_name : 'Unassigned'}
                  </span>
                </div>
                <div style={{ fontSize: 10, marginTop: 1, paddingLeft: 16, color: '#d1d5db' }}>
                  Region {i + 1}
                </div>
              </div>
              {onDeleteBoundary && (
                <button
                  onClick={e => { e.stopPropagation(); onDeleteBoundary(b.boundary_id) }}
                  title="Delete region"
                  style={{
                    flexShrink: 0, width: 18, height: 18, borderRadius: 3,
                    border: '1px solid #fecaca', background: '#fff5f5',
                    color: '#ef4444', cursor: 'pointer', fontSize: 12,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    lineHeight: 1, padding: 0,
                  }}
                >
                  ×
                </button>
              )}
            </div>
          )
        })}
      </div>

      {/* Phase assignment header */}
      <div style={{ padding: '6px 12px 4px', borderBottom: '1px solid #e5e7eb', background: '#fff', flexShrink: 0 }}>
        <div style={{ fontSize: 11, fontWeight: 600, color: '#374151' }}>
          Assign Phase
          {selectedBoundaryId
            ? <span style={{ color: '#7c3aed', fontWeight: 400 }}> — click to assign</span>
            : <span style={{ color: '#9ca3af', fontWeight: 400 }}> — select region first</span>}
        </div>
      </div>

      {/* Phase list — grouped by legal instrument */}
      <div style={{ flex: 1, overflowY: 'auto' }}>
        {phases.length === 0 && (
          <div style={{ padding: '12px', fontSize: 11, color: '#9ca3af' }}>No phases found</div>
        )}

        {byInstrument.map(({ instrument_id, instrument_name, phases: instrPhases }) => {
          const instrColor = instrumentColors[instrument_id] || UNASSIGNED_COLOR
          return (
            <div key={instrument_id}>
              {/* Instrument header with clickable color swatch */}
              <div style={{
                padding: '3px 8px 3px 10px', fontSize: 10, fontWeight: 600,
                background: '#f3f4f6', display: 'flex', alignItems: 'center', gap: 6,
              }}>
                <div
                  title="Click to change instrument color"
                  style={{ position: 'relative', width: 12, height: 12, borderRadius: 2, flexShrink: 0, background: instrColor, cursor: 'pointer', border: '1px solid rgba(0,0,0,0.2)' }}
                >
                  <input
                    type="color"
                    value={instrColor}
                    onChange={e => onInstrumentColorChange(instrument_id, e.target.value)}
                    style={{ position: 'absolute', inset: 0, opacity: 0, width: '100%', height: '100%', cursor: 'pointer', padding: 0, border: 'none' }}
                  />
                </div>
                <span style={{ color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.05em', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {instrument_name}
                </span>
              </div>
              {instrPhases.map(ph => {
                const isAssignedHere  = selectedBoundary?.phase_id === ph.phase_id
                const isAssignedElsew = assignedPhaseIds.has(ph.phase_id) && !isAssignedHere
                return (
                  <div
                    key={ph.phase_id}
                    onClick={() => {
                      if (!selectedBoundaryId) return
                      if (isAssignedHere) onUnassign(selectedBoundaryId)
                      else onAssign(ph.phase_id)
                    }}
                    style={{
                      padding: '4px 12px', display: 'flex', alignItems: 'center', gap: 4,
                      cursor: selectedBoundaryId ? 'pointer' : 'default',
                      background: isAssignedHere ? '#f5f3ff' : 'transparent',
                      opacity: isAssignedElsew ? 0.4 : 1,
                    }}
                  >
                    <span style={{
                      flex: 1, fontSize: 11,
                      color: isAssignedHere ? '#7c3aed' : '#374151',
                      fontWeight: isAssignedHere ? 600 : 400,
                    }}>
                      {ph.phase_name}
                    </span>
                    {isAssignedHere && <span style={{ fontSize: 10, color: '#7c3aed' }}>✓</span>}
                  </div>
                )
              })}
            </div>
          )
        })}

        {/* Unassigned phases (no instrument) */}
        {unassigned.length > 0 && (
          <div>
            <div style={{
              padding: '3px 12px', fontSize: 10, fontWeight: 600, color: '#9ca3af',
              background: '#f3f4f6', textTransform: 'uppercase', letterSpacing: '0.05em',
            }}>
              Unassigned
            </div>
            {unassigned.map(ph => {
              const isAssignedHere  = selectedBoundary?.phase_id === ph.phase_id
              const isAssignedElsew = assignedPhaseIds.has(ph.phase_id) && !isAssignedHere
              return (
                <div
                  key={ph.phase_id}
                  onClick={() => {
                    if (!selectedBoundaryId) return
                    if (isAssignedHere) onUnassign(selectedBoundaryId)
                    else onAssign(ph.phase_id)
                  }}
                  style={{
                    padding: '4px 12px', display: 'flex', alignItems: 'center', gap: 4,
                    cursor: selectedBoundaryId ? 'pointer' : 'default',
                    background: isAssignedHere ? '#f5f3ff' : 'transparent',
                    opacity: isAssignedElsew ? 0.4 : 1,
                  }}
                >
                  <span style={{ flex: 1, fontSize: 11, color: isAssignedHere ? '#7c3aed' : '#374151', fontWeight: isAssignedHere ? 600 : 400 }}>
                    {ph.phase_name}
                  </span>
                  {isAssignedHere && <span style={{ fontSize: 10, color: '#7c3aed' }}>✓</span>}
                </div>
              )
            })}
          </div>
        )}
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

function btn(color, bg, border) {
  return { fontSize: 12, padding: '4px 10px', borderRadius: 4, border: `1px solid ${border}`, color, background: bg, cursor: 'pointer', fontWeight: 500 }
}

const btnGray = { fontSize: 12, padding: '4px 10px', borderRadius: 4, border: '1px solid #d1d5db', color: '#374151', background: '#f9fafb', cursor: 'pointer' }
