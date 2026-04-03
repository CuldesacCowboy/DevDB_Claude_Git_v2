// SitePlanView.jsx
// Main site plan page. Entitlement group picker + mode controls in toolbar.
// Right panel: phase boundary list + phase assignment when boundaries exist.

import { useState, useEffect, useRef, useCallback, useMemo, Component } from 'react'
import PdfCanvas from '../components/SitePlan/PdfCanvas'
import LotBank from '../components/SitePlan/LotBank'
import { normalizeSharedVertices, mergeAdjacentPolygons } from '../components/SitePlan/splitPolygon'

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
  const [selectedGroupId, setSelectedGroupId] = useState(() => {
    try { return localStorage.getItem('devdb_siteplan_last_group') || '' } catch { return '' }
  })
  const [plan, setPlan]                       = useState(null)
  const [loading, setLoading]                 = useState(false)
  const [uploading, setUploading]             = useState(false)
  const [error, setError]                     = useState(null)
  const [mode, setMode]                       = useState('view')
  const [boundaries, setBoundaries]           = useState([])
  const [selectedBoundaryId, setSelectedBoundaryId] = useState(null)
  const [phases, setPhases]                   = useState([])
  const [undoStack, setUndoStack]             = useState([])
  const [traceUndoSignal, setTraceUndoSignal] = useState(0)   // increment → PdfCanvas pops last trace point
  const [placeHistory, setPlaceHistory]       = useState([])  // [{lotId, prevPos}] for undo in place mode
  const [instrumentColors, setInstrumentColors] = useState({})  // {instrument_id: color}
  const [lotBankCollapsed, setLotBankCollapsed]             = useState(false)
  const [phasePanelCollapsed, setPhasePanelCollapsed]       = useState(false)
  const [unassignedBarCollapsed, setUnassignedBarCollapsed] = useState(false)

  // Right panel tab + unit counts
  const [rightPanelTab, setRightPanelTab]             = useState('assignment')  // 'assignment' | 'unit-counts'
  const [unitCountsSubtotal, setUnitCountsSubtotal]   = useState(false)         // false=totals on map, true=by-type on map
  const [editProjected, setEditProjected]             = useState(null)           // {phase_id, lot_type_id, value, sx, sy}

  // Building groups
  const [showBuildingGroups, setShowBuildingGroups] = useState(() => {
    try { return localStorage.getItem('devdb_siteplan_show_bg') === 'true' } catch { return false }
  })
  const [buildingGroups, setBuildingGroups]                   = useState([])
  const [selectedBgIds, setSelectedBgIds]                     = useState(new Set())
  const [pendingBuildingGroup, setPendingBuildingGroup]       = useState(null) // {lots, polygon}
  const [bgContextMenu, setBgContextMenu]                     = useState(null) // {x,y,id}

  // Lot bank + positioning
  const [allLots, setAllLots]             = useState([])   // all real lots for this ent_group
  const [lotPositions, setLotPositions]   = useState({})   // {lot_id: {x,y}} — local (unsaved)
  const [savedPositions, setSavedPositions] = useState({}) // {lot_id: {x,y}} — last saved
  const [isDirty, setIsDirty]             = useState(false)
  const [placeQueue, setPlaceQueue]       = useState([])   // [{lot_id, lot_number,...}] click-to-set queue

  const fileInputRef      = useRef(null)
  const boundariesRef     = useRef(boundaries)
  const lotPositionsRef   = useRef(lotPositions)
  useEffect(() => { boundariesRef.current   = boundaries   }, [boundaries])
  useEffect(() => { lotPositionsRef.current = lotPositions }, [lotPositions])

  // Persist last selected community
  useEffect(() => {
    if (selectedGroupId) {
      try { localStorage.setItem('devdb_siteplan_last_group', selectedGroupId) } catch {}
    }
  }, [selectedGroupId])

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

  // Load building groups when plan changes or toggle turns on
  useEffect(() => {
    if (!plan || !showBuildingGroups) { setBuildingGroups([]); return }
    fetch(`${API}/building-groups/plan/${plan.plan_id}`)
      .then(r => r.ok ? r.json() : [])
      .then(setBuildingGroups)
      .catch(() => setBuildingGroups([]))
  }, [plan?.plan_id, showBuildingGroups])

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
    const prevPos = lotPositionsRef.current[lotId] || null
    setPlaceHistory(h => [...h, { lotId, prevPos }])
    setLotPositions(prev => ({ ...prev, [lotId]: normPos }))
    setIsDirty(true)
  }, [])

  const handleLotMove = useCallback((lotId, normPos) => {
    const prevPos = lotPositionsRef.current[lotId] || null
    setPlaceHistory(h => [...h, { lotId, prevPos }])
    setLotPositions(prev => ({ ...prev, [lotId]: normPos }))
    setIsDirty(true)
  }, [])

  // Called by PdfCanvas when user clicks in 'place' mode
  const handlePlaceLot = useCallback((normPos) => {
    setPlaceQueue(prev => {
      if (!prev.length) return prev
      const [current, ...rest] = prev
      const prevPos = lotPositionsRef.current[current.lot_id] || null
      setPlaceHistory(h => [...h, { lotId: current.lot_id, prevPos }])
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
        setPlaceHistory([])
        setMode('view')
      }
    } catch { /* ignore */ }
  }

  function handleDiscardLotPositions() {
    setLotPositions(savedPositions)
    setIsDirty(false)
    setPlaceQueue([])
    setPlaceHistory([])
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
    const current = boundariesRef.current
    const toDelete = current.find(b => b.boundary_id === boundaryId)
    if (!toDelete) return

    try {
      // Find the best neighbor to absorb the deleted polygon's area.
      // "Best" = most shared vertices (longest shared boundary).
      const poly1 = JSON.parse(toDelete.polygon_json)
      let bestNeighbor = null, bestShared = 0
      for (const b of current) {
        if (b.boundary_id === boundaryId) continue
        const poly2 = JSON.parse(b.polygon_json)
        const shared = poly1.filter(p1 =>
          poly2.some(p2 => Math.hypot(p1.x - p2.x, p1.y - p2.y) < 2e-4)
        ).length
        if (shared > bestShared) { bestShared = shared; bestNeighbor = b }
      }

      if (bestNeighbor && bestShared >= 2) {
        const poly2 = JSON.parse(bestNeighbor.polygon_json)
        const merged = mergeAdjacentPolygons(poly1, poly2)
        if (merged) {
          await fetch(`${API}/phase-boundaries/${bestNeighbor.boundary_id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ polygon_json: JSON.stringify(merged) }),
          })
        }
      }

      await fetch(`${API}/phase-boundaries/${boundaryId}`, { method: 'DELETE' })
      const fresh = await fetch(`${API}/phase-boundaries/plan/${plan.plan_id}`)
      setBoundaries(fresh.ok ? await fresh.json() : current.filter(b => b.boundary_id !== boundaryId))
      setSelectedBoundaryId(prev => prev === boundaryId ? null : prev)
      setUndoStack([])
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

    // Normalize shared vertices between the two new polygons before persisting
    // to eliminate any floating-point micro-gaps from the split geometry.
    const synthetic = [
      { boundary_id: '_a', polygon_json: JSON.stringify(polyA) },
      { boundary_id: '_b', polygon_json: JSON.stringify(polyB) },
    ]
    const normChanges = normalizeSharedVertices(synthetic)
    const normMap = Object.fromEntries(normChanges.map(n => [n.boundary_id, JSON.parse(n.polygon_json)]))
    const finalPolyA = normMap['_a'] || polyA
    const finalPolyB = normMap['_b'] || polyB

    try {
      const res = await fetch(`${API}/phase-boundaries/split`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          plan_id: plan.plan_id,
          original_boundary_id: originalBoundaryId ?? null,
          polygon_a: JSON.stringify(finalPolyA),
          polygon_b: JSON.stringify(finalPolyB),
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

  function handlePlaceUndo() {
    setPlaceHistory(h => {
      if (!h.length) return h
      const { lotId, prevPos } = h[h.length - 1]
      if (prevPos === null) {
        setLotPositions(lp => { const next = { ...lp }; delete next[lotId]; return next })
      } else {
        setLotPositions(lp => ({ ...lp, [lotId]: prevPos }))
      }
      return h.slice(0, -1)
    })
  }

  async function handleUndo() {
    if (mode === 'trace') {
      setTraceUndoSignal(s => s + 1)
      return
    }
    if (mode === 'place') {
      handlePlaceUndo()
      return
    }
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

  async function handleCleanupPolygons() {
    if (!plan || !boundaries.length) return
    const modified = normalizeSharedVertices(boundaries)
    if (!modified.length) return
    try {
      await Promise.all(modified.map(m =>
        fetch(`${API}/phase-boundaries/${m.boundary_id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ polygon_json: m.polygon_json }),
        })
      ))
      const fresh = await fetch(`${API}/phase-boundaries/plan/${plan.plan_id}`)
      setBoundaries(fresh.ok ? await fresh.json() : boundaries)
    } catch { /* ignore */ }
  }

  // ─── Unit counts helpers ────────────────────────────────────────────────────

  async function handleProjectedCountChange(phaseId, lotTypeId, newValue) {
    const res = await fetch(`${API}/phases/${phaseId}/lot-type/${lotTypeId}/projected`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projected_count: newValue }),
    })
    if (res.ok) {
      const data = await res.json()  // {phase_id, lot_type_id, projected_count, actual, total}
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
    }
  }

  // ─── Building group helpers ─────────────────────────────────────────────────

  async function loadBuildingGroups() {
    if (!plan) return
    const res = await fetch(`${API}/building-groups/plan/${plan.plan_id}`)
    if (res.ok) setBuildingGroups(await res.json())
  }

  function toggleShowBuildingGroups() {
    setShowBuildingGroups(prev => {
      const next = !prev
      try { localStorage.setItem('devdb_siteplan_show_bg', String(next)) } catch {}
      if (!next) {
        setBuildingGroups([])
        setSelectedBgIds(new Set())
        setPendingBuildingGroup(null)
        setBgContextMenu(null)
        if (mode === 'draw-building' || mode === 'delete-building') setMode('view')
      }
      return next
    })
  }

  // Called by PdfCanvas when user finishes drawing a building group polygon.
  // Detects which positioned lots are inside, within the same phase, and not already grouped.
  const handleBuildingGroupDrawn = useCallback((polygon) => {
    if (!polygon || polygon.length < 3) return

    // Determine the phase context from the first polygon point
    const firstPhaseId = findPhaseForPosition(polygon[0].x, polygon[0].y)

    // Collect lot_ids already assigned to any building group
    const assignedLotIds = new Set()
    for (const bg of buildingGroups) {
      for (const l of bg.lots) assignedLotIds.add(l.lot_id)
    }

    // Filter positioned lots: inside polygon + matching phase + not already grouped
    const insideLots = []
    for (const [lotIdStr, pos] of Object.entries(lotPositions)) {
      const lotId = Number(lotIdStr)
      if (assignedLotIds.has(lotId)) continue
      if (!pointInPolygon(pos.x, pos.y, polygon)) continue
      // Phase filter: only include lots whose position falls in the same phase as first click
      const lotPhase = findPhaseForPosition(pos.x, pos.y)
      if (firstPhaseId !== undefined && lotPhase !== firstPhaseId) continue
      const meta = allLots.find(l => l.lot_id === lotId)
      if (meta) insideLots.push({ lot_id: lotId, lot_number: meta.lot_number, phase_id: meta.phase_id })
    }

    if (!insideLots.length) {
      // Nothing to group — stay in draw mode so user can try again
      return
    }

    setPendingBuildingGroup({ lots: insideLots, polygon, phaseId: firstPhaseId })
  }, [buildingGroups, lotPositions, allLots, boundaries]) // eslint-disable-line react-hooks/exhaustive-deps

  async function handleBuildingGroupConfirm() {
    if (!pendingBuildingGroup || !plan) return
    const { lots } = pendingBuildingGroup

    // Resolve dev_id from any lot's phase
    const firstLot = allLots.find(l => l.lot_id === lots[0].lot_id)
    const phaseInfo = phases.find(p => p.phase_id === firstLot?.phase_id)
    const devId = phaseInfo?.dev_id ?? 0  // 0 as last resort; NOT NULL constraint in DB

    try {
      const res = await fetch(`${API}/building-groups`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lot_ids: lots.map(l => l.lot_id), dev_id: devId, plan_id: plan.plan_id }),
      })
      if (res.ok) {
        setPendingBuildingGroup(null)
        setMode('view')
        await loadBuildingGroups()
      }
    } catch { /* ignore */ }
  }

  function handleBuildingGroupCancel() {
    setPendingBuildingGroup(null)
    setMode('view')
  }

  const handleBuildingGroupSelect = useCallback((id) => {
    setSelectedBgIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  async function handleDeleteSelectedBuildingGroups() {
    const ids = [...selectedBgIds]
    if (!ids.length) return
    try {
      const res = await fetch(`${API}/building-groups/bulk-delete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ building_group_ids: ids }),
      })
      if (res.ok) {
        setSelectedBgIds(new Set())
        setMode('view')
        await loadBuildingGroups()
      }
    } catch { /* ignore */ }
  }

  async function handleDeleteSingleBuildingGroup(id) {
    try {
      const res = await fetch(`${API}/building-groups/${id}`, { method: 'DELETE' })
      if (res.ok) {
        setSelectedBgIds(prev => { const next = new Set(prev); next.delete(id); return next })
        setBgContextMenu(null)
        await loadBuildingGroups()
      }
    } catch { /* ignore */ }
  }

  const handleBuildingGroupContextMenu = useCallback((id, x, y) => {
    setBgContextMenu({ id, x, y })
  }, [])

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

  async function assignPhaseToBoundary(boundaryId, phaseId) {
    try {
      const res = await fetch(`${API}/phase-boundaries/${boundaryId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phase_id: phaseId }),
      })
      if (res.ok) {
        const updated = await res.json()
        setBoundaries(bs => bs.map(b => b.boundary_id === boundaryId ? updated : b))
      }
    } catch { /* ignore */ }
  }

  async function swapBoundaryAssignments(draggedBoundaryId, draggedPhaseId, targetBoundaryId, targetPhaseId) {
    try {
      // Unassign target first to avoid any unique-constraint conflict
      await fetch(`${API}/phase-boundaries/${targetBoundaryId}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phase_id: null }),
      })
      await fetch(`${API}/phase-boundaries/${draggedBoundaryId}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phase_id: targetPhaseId }),
      })
      await fetch(`${API}/phase-boundaries/${targetBoundaryId}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phase_id: draggedPhaseId }),
      })
      const fresh = await fetch(`${API}/phase-boundaries/plan/${plan.plan_id}`)
      if (fresh.ok) setBoundaries(await fresh.json())
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
  // selectedBoundaryId, but only when that boundary has no phase assigned (for click-to-assign flow)
  const unassignedSelectedBoundaryId = selectedBoundaryId
    && boundaries.find(b => b.boundary_id === selectedBoundaryId)?.phase_id == null
    ? selectedBoundaryId : null

  // phase_id → boundary_id (for drag-to-unassign)
  const phaseToBoundaryId = useMemo(() => {
    const m = {}
    for (const b of boundaries) if (b.phase_id) m[b.phase_id] = b.boundary_id
    return m
  }, [boundaries])

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

        {/* Undo — visible in trace mode (pops last point), place mode (reverts last placement),
                  or when undoStack has entries in other modes */}
        {hasPlan && (mode === 'trace' || (mode === 'place' && placeHistory.length > 0) || (undoStack.length > 0 && mode !== 'trace' && mode !== 'place')) && (
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
            {hasBoundaries && (
              <button onClick={handleCleanupPolygons} style={btn('#374151', '#f9fafb', '#e5e7eb')} title="Snap near-coincident vertices to exact shared positions">
                Clean Up
              </button>
            )}
            {hasParcel && (
              <button onClick={handleDeleteCommunityBoundary} style={btn('#dc2626', '#fef2f2', '#fecaca')}>
                Delete Community Boundary
              </button>
            )}

            {/* Building group tools (only shown when toggle is ON) */}
            {hasPlan && <div style={{ width: 1, height: 20, background: '#e5e7eb' }} />}
            <button
              onClick={toggleShowBuildingGroups}
              style={showBuildingGroups
                ? btn('#0d9488', '#f0fdfa', '#99f6e4')
                : btn('#374151', '#f9fafb', '#e5e7eb')}
              title={showBuildingGroups ? 'Hide building groups' : 'Show building groups'}
            >
              {showBuildingGroups ? '⬡ Groups ON' : '⬡ Groups'}
            </button>
            {showBuildingGroups && (
              <>
                <button
                  onClick={() => { setPendingBuildingGroup(null); setMode('draw-building') }}
                  style={btn('#0f766e', '#f0fdfa', '#5eead4')}
                  title="Draw a boundary around lots to group them into a building"
                >
                  Draw Group
                </button>
                <button
                  onClick={() => { setSelectedBgIds(new Set()); setMode('delete-building') }}
                  style={btn('#b45309', '#fffbeb', '#fde68a')}
                  title="Click building ovals to select and delete groups"
                >
                  Delete Groups
                </button>
              </>
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
        {hasPlan && mode === 'draw-building' && (
          <button onClick={() => { setPendingBuildingGroup(null); setMode('view') }} style={btn('#374151', '#f9fafb', '#e5e7eb')}>Cancel</button>
        )}
        {hasPlan && mode === 'delete-building' && (
          <>
            {selectedBgIds.size > 0 && (
              <button onClick={handleDeleteSelectedBuildingGroups} style={btn('#dc2626', '#fef2f2', '#fecaca')}>
                Delete {selectedBgIds.size} group{selectedBgIds.size !== 1 ? 's' : ''}
              </button>
            )}
            <button onClick={() => { setSelectedBgIds(new Set()); setMode('view') }} style={btn('#374151', '#f9fafb', '#e5e7eb')}>Done</button>
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
                {mode === 'trace'           && 'Click to place vertices · click first vertex to close'}
                {mode === 'edit'            && 'Drag vertices · click edge to add point · right-click to remove'}
                {mode === 'split'           && 'Click any boundary edge to begin · draw across the region · click any boundary edge to split'}
                {mode === 'delete-phases'   && 'Click a phase region to delete it · or use Delete All in the toolbar'}
                {mode === 'draw-building'   && 'Click to add points · double-click or near first point to close · or click-and-drag for freehand'}
                {mode === 'delete-building' && 'Click a building oval to select · right-click for quick delete · use toolbar to delete selected'}
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
              />
            )}
          </div>
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

function btn(color, bg, border) {
  return { fontSize: 12, padding: '4px 10px', borderRadius: 4, border: `1px solid ${border}`, color, background: bg, cursor: 'pointer', fontWeight: 500 }
}

const btnGray = { fontSize: 12, padding: '4px 10px', borderRadius: 4, border: '1px solid #d1d5db', color: '#374151', background: '#f9fafb', cursor: 'pointer' }

// ─── Unit Counts Panel ────────────────────────────────────────────────────────

function UnitCountsPanel({ phases, unitCountsSubtotal, onToggleSubtotal, onProjectedCountChange }) {
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

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden', minWidth: 256 }}>
      {/* Toggle: controls what the map polygons show */}
      <div style={{ padding: '8px 10px', borderBottom: '1px solid #e5e7eb', background: '#f8fafc', display: 'flex', gap: 6, flexShrink: 0 }}>
        <button
          onClick={() => onToggleSubtotal(false)}
          style={{
            flex: 1, padding: '4px 6px', borderRadius: 5, fontSize: 11, cursor: 'pointer', fontWeight: !unitCountsSubtotal ? 600 : 400,
            border: `1px solid ${!unitCountsSubtotal ? '#0d9488' : '#d1d5db'}`,
            background: !unitCountsSubtotal ? '#f0fdfa' : '#fff',
            color: !unitCountsSubtotal ? '#0f766e' : '#6b7280',
          }}
        >
          Totals on map
        </button>
        <button
          onClick={() => onToggleSubtotal(true)}
          style={{
            flex: 1, padding: '4px 6px', borderRadius: 5, fontSize: 11, cursor: 'pointer', fontWeight: unitCountsSubtotal ? 600 : 400,
            border: `1px solid ${unitCountsSubtotal ? '#0d9488' : '#d1d5db'}`,
            background: unitCountsSubtotal ? '#f0fdfa' : '#fff',
            color: unitCountsSubtotal ? '#0f766e' : '#6b7280',
          }}
        >
          By type on map
        </button>
      </div>

      {/* Scrollable phase list */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '6px 0' }}>
        {byInstrument.map(inst => (
          <div key={inst.instrument_id} style={{ marginBottom: 4 }}>
            <div style={{
              padding: '4px 10px', fontSize: 10, fontWeight: 700, color: '#374151', letterSpacing: '0.04em',
              background: '#f1f5f9', borderTop: '1px solid #e5e7eb', borderBottom: '1px solid #e5e7eb',
              display: 'flex', alignItems: 'baseline', gap: 6,
            }}>
              {inst.instrument_name}
              {inst.dev_name && <span style={{ fontWeight: 400, color: '#9ca3af', fontSize: 10 }}>{inst.dev_name}</span>}
            </div>
            {inst.phases.map(ph => (
              <PhaseUnitBlock key={ph.phase_id} phase={ph} onProjectedCountChange={onProjectedCountChange} />
            ))}
          </div>
        ))}
        {noInstrumentPhases.length > 0 && (
          <div>
            <div style={{
              padding: '4px 10px', fontSize: 10, fontWeight: 700, color: '#9ca3af',
              background: '#f1f5f9', borderTop: '1px solid #e5e7eb', borderBottom: '1px solid #e5e7eb',
            }}>
              Unassigned phases
            </div>
            {noInstrumentPhases.map(ph => (
              <PhaseUnitBlock key={ph.phase_id} phase={ph} onProjectedCountChange={onProjectedCountChange} />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function PhaseUnitBlock({ phase, onProjectedCountChange }) {
  const byLt = phase.by_lot_type || []
  const totalR = byLt.reduce((s, lt) => s + (lt.actual || 0), 0)
  const totalP = byLt.reduce((s, lt) => s + (lt.projected || 0), 0)
  const totalT = byLt.reduce((s, lt) => s + (lt.total || 0), 0)

  return (
    <div style={{ padding: '6px 10px', borderBottom: '1px solid #f1f5f9' }}>
      <div style={{ fontSize: 11, fontWeight: 600, color: '#1e293b', marginBottom: byLt.length ? 5 : 0 }}>
        {phase.phase_name}
      </div>
      {!byLt.length ? (
        <div style={{ fontSize: 10, color: '#9ca3af' }}>No product types</div>
      ) : (
        <>
          {/* Column headers */}
          <div style={{ display: 'grid', gridTemplateColumns: '56px 1fr 1fr 1fr', gap: 2, marginBottom: 3 }}>
            <div style={{ fontSize: 9, color: '#94a3b8', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em' }}>Type</div>
            <div style={{ fontSize: 9, color: '#64748b', fontWeight: 700, textAlign: 'center', textTransform: 'uppercase', letterSpacing: '0.04em' }}>r</div>
            <div style={{ fontSize: 9, color: '#0f766e', fontWeight: 700, textAlign: 'center', textTransform: 'uppercase', letterSpacing: '0.04em' }}>p</div>
            <div style={{ fontSize: 9, color: '#374151', fontWeight: 700, textAlign: 'center', textTransform: 'uppercase', letterSpacing: '0.04em' }}>t</div>
          </div>
          {/* Lot type rows */}
          {byLt.map(lt => (
            <div key={lt.lot_type_id} style={{ display: 'grid', gridTemplateColumns: '56px 1fr 1fr 1fr', gap: 2, marginBottom: 2, alignItems: 'center' }}>
              <div style={{ fontSize: 11, color: '#475569' }}>{lt.lot_type_short}</div>
              <div style={{ fontSize: 11, color: '#64748b', textAlign: 'center' }}>{lt.actual ?? 0}</div>
              <div style={{ textAlign: 'center' }}>
                <ProjectedInput
                  value={lt.projected ?? 0}
                  onSave={v => onProjectedCountChange(phase.phase_id, lt.lot_type_id, v)}
                />
              </div>
              <div style={{ fontSize: 11, color: '#1e293b', textAlign: 'center', fontWeight: 600 }}>{lt.total ?? 0}</div>
            </div>
          ))}
          {/* Total row (only shown when multiple lot types) */}
          {byLt.length > 1 && (
            <div style={{ display: 'grid', gridTemplateColumns: '56px 1fr 1fr 1fr', gap: 2, marginTop: 3, paddingTop: 3, borderTop: '1px solid #e2e8f0', alignItems: 'center' }}>
              <div style={{ fontSize: 9, color: '#94a3b8', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em' }}>Total</div>
              <div style={{ fontSize: 11, color: '#64748b', textAlign: 'center', fontWeight: 600 }}>{totalR}</div>
              <div style={{ fontSize: 11, color: '#0f766e', textAlign: 'center', fontWeight: 600 }}>{totalP}</div>
              <div style={{ fontSize: 11, color: '#1e293b', textAlign: 'center', fontWeight: 700 }}>{totalT}</div>
            </div>
          )}
        </>
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
