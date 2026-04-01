// SitePlanView.jsx
// Main site plan page. Entitlement group picker + mode controls in toolbar.
// Right panel: phase boundary list + phase assignment when boundaries exist.

import { useState, useEffect, useRef, useCallback, Component } from 'react'
import PdfCanvas from '../components/SitePlan/PdfCanvas'

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
            flat.push({ ...ph, dev_name: inst.dev_name, instrument_id: inst.instrument_id })
          }
        }
        for (const ph of (data.unassigned_phases || [])) {
          flat.push({ ...ph, dev_name: 'Unassigned', instrument_id: null })
        }
        setPhases(flat)
      })
      .catch(() => setPhases([]))
  }, [selectedGroupId])

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

  const onSplitConfirm = useCallback(async (originalBoundaryId, polyA, polyB) => {
    if (!plan) return
    const original = boundariesRef.current.find(b => b.boundary_id === originalBoundaryId)
    try {
      const res = await fetch(`${API}/phase-boundaries/split`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          plan_id: plan.plan_id,
          original_boundary_id: originalBoundaryId,
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

  // Assign one color per instrument_id; build phase_id → color map
  const instrumentColorMap = {}
  let colorIdx = 0
  for (const ph of phases) {
    if (ph.instrument_id != null && !(ph.instrument_id in instrumentColorMap)) {
      instrumentColorMap[ph.instrument_id] = INSTRUMENT_COLORS[colorIdx % INSTRUMENT_COLORS.length]
      colorIdx++
    }
  }
  const phaseColorMap = Object.fromEntries(
    phases.filter(p => p.instrument_id != null).map(p => [p.phase_id, instrumentColorMap[p.instrument_id]])
  )
  const selectedBoundary = selectedBoundaryId
    ? boundaries.find(b => b.boundary_id === selectedBoundaryId)
    : null

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

        {/* Undo — visible in all modes when there's something to undo */}
        {hasPlan && undoStack.length > 0 && mode !== 'trace' && (
          <button onClick={handleUndo} style={btn('#b45309', '#fffbeb', '#fde68a')}>
            ↩ Undo
          </button>
        )}

        {hasPlan && mode === 'view' && (
          <>
            <button onClick={() => setMode('trace')} style={btn('#2563eb', '#eff6ff', '#bfdbfe')}>
              {hasParcel ? 'Retrace Parcel' : 'Trace Parcel'}
            </button>
            {hasParcel && (
              <button onClick={() => setMode('edit')} style={btn('#374151', '#f9fafb', '#e5e7eb')}>
                Edit Parcel
              </button>
            )}
            <button onClick={() => { setMode('split'); setSelectedBoundaryId(null) }} style={btn('#7c3aed', '#f5f3ff', '#ddd6fe')}>
              Split Phases
            </button>
            {hasParcel && (
              <button onClick={clearParcel} style={btn('#dc2626', '#fef2f2', '#fecaca')}>
                Clear Parcel
              </button>
            )}
          </>
        )}

        {hasPlan && mode === 'trace' && (
          <>
            <span style={{ fontSize: 12, color: '#92400e', fontWeight: 500 }}>
              Click to place vertices · click first vertex or Close to finish
            </span>
            <button onClick={() => setMode('view')} style={btn('#374151', '#f9fafb', '#e5e7eb')}>Cancel</button>
          </>
        )}

        {hasPlan && mode === 'edit' && (
          <>
            <span style={{ fontSize: 12, color: '#1d4ed8', fontWeight: 500 }}>
              Drag vertices · click edge to add · right-click to delete
            </span>
            <button onClick={() => setMode('view')} style={btn('#1d4ed8', '#eff6ff', '#bfdbfe')}>Done Editing</button>
          </>
        )}

        {hasPlan && mode === 'split' && (
          <>
            <span style={{ fontSize: 12, color: '#6d28d9', fontWeight: 500 }}>
              Click a boundary edge to start · click to add vertices · last click on/past any boundary edge finalizes the split
            </span>
            <button onClick={() => { setMode('view'); setSelectedBoundaryId(null) }} style={btn('#374151', '#f9fafb', '#e5e7eb')}>Done</button>
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

      {/* Canvas + side panel */}
      <div style={{ flex: 1, overflow: 'hidden', display: 'flex' }}>

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
              onSplitConfirm={onSplitConfirm}
              onBoundaryUpdated={updated => setBoundaries(bs => bs.map(b => b.boundary_id === updated.boundary_id ? updated : b))}
              onVertexEditComplete={onVertexEditComplete}
            />
          )}
        </div>

        {/* Phase side panel — always visible when a plan is loaded */}
        {hasPlan && (
          <PhasePanel
            boundaries={boundaries}
            phases={phases}
            phaseMap={phaseMap}
            phaseColorMap={phaseColorMap}
            selectedBoundaryId={selectedBoundaryId}
            selectedBoundary={selectedBoundary}
            assignedPhaseIds={assignedPhaseIds}
            onSelectBoundary={id => setSelectedBoundaryId(prev => prev === id ? null : id)}
            onAssign={assignPhaseToSelected}
            onUnassign={unassignBoundary}
            mode={mode}
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

function PhasePanel({
  boundaries, phases, phaseMap, phaseColorMap,
  selectedBoundaryId, selectedBoundary, assignedPhaseIds,
  onSelectBoundary, onAssign, onUnassign, mode,
}) {
  // Group phases by dev_name for display
  const byDev = {}
  for (const ph of phases) {
    const key = ph.dev_name || 'Other'
    if (!byDev[key]) byDev[key] = []
    byDev[key].push(ph)
  }

  return (
    <div style={{
      width: 240, borderLeft: '1px solid #e5e7eb', background: '#fafafa',
      display: 'flex', flexDirection: 'column', flexShrink: 0, overflow: 'hidden',
    }}>
      {/* Panel header */}
      <div style={{ padding: '8px 12px', borderBottom: '1px solid #e5e7eb', background: '#fff', flexShrink: 0 }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: '#374151' }}>Phase Boundaries</div>
        <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 1 }}>
          {boundaries.length > 0
            ? `${boundaries.length} region${boundaries.length !== 1 ? 's' : ''} · ${assignedPhaseIds.size} assigned`
            : 'No regions yet'}
        </div>
      </div>

      {/* Empty state */}
      {boundaries.length === 0 && (
        <div style={{ padding: '16px 12px', fontSize: 11, color: '#9ca3af', lineHeight: 1.5 }}>
          Trace a parcel on the plan to create your first phase region, then use Split Phases to subdivide it.
        </div>
      )}

      {/* Boundary list */}
      <div style={{ borderBottom: '1px solid #e5e7eb', background: '#fff', flexShrink: 0 }}>
        {boundaries.map((b) => {
          const ap = b.phase_id ? phaseMap[b.phase_id] : null
          const isSel = b.boundary_id === selectedBoundaryId
          const swatchColor = (b.phase_id && phaseColorMap[b.phase_id]) || UNASSIGNED_COLOR
          return (
            <div
              key={b.boundary_id}
              onClick={() => onSelectBoundary(b.boundary_id)}
              style={{
                padding: '5px 12px 5px 9px', cursor: 'pointer',
                borderBottom: '1px solid #f3f4f6',
                background: isSel ? '#f5f3ff' : 'transparent',
                borderLeft: `3px solid ${isSel ? '#7c3aed' : 'transparent'}`,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <div style={{
                  width: 10, height: 10, borderRadius: 2, flexShrink: 0,
                  background: swatchColor,
                }} />
                <span style={{ fontSize: 11, color: '#374151', fontWeight: isSel ? 600 : 400 }}>
                  Region {i + 1}
                </span>
              </div>
              <div style={{ fontSize: 10, marginTop: 1, paddingLeft: 16, color: ap ? '#7c3aed' : '#d1d5db' }}>
                {ap ? ap.phase_name : 'Unassigned'}
              </div>
            </div>
          )
        })}
      </div>

      {/* Phase list header */}
      <div style={{ padding: '6px 12px 4px', borderBottom: '1px solid #e5e7eb', background: '#fff', flexShrink: 0 }}>
        <div style={{ fontSize: 11, fontWeight: 600, color: '#374151' }}>
          Phases
          {selectedBoundaryId
            ? <span style={{ color: '#7c3aed', fontWeight: 400 }}> — click to assign</span>
            : <span style={{ color: '#9ca3af', fontWeight: 400 }}> — select region first</span>}
        </div>
      </div>

      {/* Phase list */}
      <div style={{ flex: 1, overflowY: 'auto' }}>
        {phases.length === 0 && (
          <div style={{ padding: '12px', fontSize: 11, color: '#9ca3af' }}>No phases found</div>
        )}
        {Object.entries(byDev).map(([devName, devPhases]) => (
          <div key={devName}>
            <div style={{
              padding: '3px 12px', fontSize: 10, fontWeight: 600, color: '#9ca3af',
              background: '#f3f4f6', textTransform: 'uppercase', letterSpacing: '0.05em',
            }}>
              {devName}
            </div>
            {devPhases.map(ph => {
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
        ))}
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
