import { useState, useEffect, useRef, useCallback } from 'react'
import { API_BASE } from '../utils/api'

// ─── Sticky column geometry ───────────────────────────────────────────────────

const CW = { comm: 160, dev: 140, inst: 144, phase: 116 }
const LEFT = {
  comm:  0,
  dev:   CW.comm,
  inst:  CW.comm + CW.dev,
  phase: CW.comm + CW.dev + CW.inst,
}

const GRAIN_ORDER = ['community', 'dev', 'instrument', 'phase']
const GRAIN_COLS  = { community: 0, dev: 1, instrument: 2, phase: 3 }

// Returns which sticky columns are visible for a given grain
function stickyVisible(grain) {
  const n = GRAIN_COLS[grain]
  return { comm: true, dev: n >= 1, inst: n >= 2, phase: n >= 3 }
}

// Shadow on the rightmost visible sticky col
function shadowFor(grain) {
  const keys = ['comm', 'dev', 'inst', 'phase']
  const visible = stickyVisible(grain)
  const last = [...keys].reverse().find(k => visible[k])
  return last
}

// ─── Date helpers ─────────────────────────────────────────────────────────────

function fmtDate(iso) {
  if (!iso) return ''
  const [y, m, d] = iso.split('-')
  return `${parseInt(m)}/${parseInt(d)}/${y}`
}

// ─── Aggregation helpers ──────────────────────────────────────────────────────

function phaseMetrics(phases) {
  let projTotal = 0, realTotal = 0, simTotal = 0
  for (const r of phases) {
    projTotal += Object.values(r.product_splits  ?? {}).reduce((s, v) => s + (v  ?? 0), 0)
    realTotal += Object.values(r.lot_type_counts ?? {}).reduce((s, v) => s + (v.real ?? 0), 0)
    simTotal  += Object.values(r.lot_type_counts ?? {}).reduce((s, v) => s + (v.sim  ?? 0), 0)
  }
  return { projTotal, realTotal, simTotal }
}

function groupRows(rows, grain) {
  if (grain === 'phase') return rows

  const groups = []
  const seen   = new Map()

  for (const r of rows) {
    const key = grain === 'community'  ? `${r.ent_group_id}`
              : grain === 'dev'        ? `${r.ent_group_id}|${r.dev_id}`
              :                          `${r.ent_group_id}|${r.dev_id}|${r.instrument_id}`

    if (!seen.has(key)) {
      const g = {
        _key: key,
        ent_group_id: r.ent_group_id, ent_group_name: r.ent_group_name, is_test: r.is_test,
        dev_id: r.dev_id, dev_name: r.dev_name,
        instrument_id: r.instrument_id, instrument_name: r.instrument_name,
        phases: [], devIds: new Set(), instIds: new Set(),
      }
      seen.set(key, g)
      groups.push(g)
    }
    const g = seen.get(key)
    g.phases.push(r)
    g.devIds.add(r.dev_id)
    g.instIds.add(r.instrument_id)
  }

  return groups.map(g => ({
    ...g,
    devCount:   g.devIds.size,
    instCount:  g.instIds.size,
    phaseCount: g.phases.length,
    ...phaseMetrics(g.phases),
  }))
}

// ─── EditableCell ─────────────────────────────────────────────────────────────

function EditableCell({ value, type = 'number', onSave, placeholder = '—', width = 52, align = 'right' }) {
  const [editing, setEditing] = useState(false)
  const [draft,   setDraft]   = useState('')
  const [saving,  setSaving]  = useState(false)
  const [error,   setError]   = useState(null)
  const inputRef = useRef()

  function startEdit() {
    if (saving) return
    setDraft(value != null ? String(value) : '')
    setEditing(true)
    requestAnimationFrame(() => inputRef.current?.focus())
  }

  async function commit() {
    setEditing(false)
    const raw = draft.trim()
    let parsed
    if (raw === '') {
      parsed = null
    } else if (type === 'number') {
      parsed = Number(raw)
      if (isNaN(parsed)) { setError('!'); return }
    } else {
      parsed = raw
    }
    if (parsed === value || (parsed == null && value == null)) return
    setSaving(true); setError(null)
    try { await onSave(parsed) }
    catch (e) { setError(String(e).slice(0, 40)) }
    finally { setSaving(false) }
  }

  function onKeyDown(e) {
    if (e.key === 'Enter')  { e.preventDefault(); commit() }
    if (e.key === 'Escape') { setEditing(false) }
  }

  const display = type === 'date' ? fmtDate(value) : (value != null ? String(value) : '')

  return (
    <div onClick={startEdit} title={error ?? undefined}
         style={{ width, minHeight: 20, textAlign: align, cursor: 'text' }}>
      {editing ? (
        <input
          ref={inputRef}
          type={type === 'date' ? 'date' : 'number'}
          min={type === 'number' ? 0 : undefined}
          value={draft}
          onChange={e => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={onKeyDown}
          style={{ width: '100%', padding: '1px 4px', fontSize: 12, textAlign: align,
                   border: '1px solid #2563eb', borderRadius: 3,
                   background: '#fff', outline: 'none' }}
        />
      ) : (
        <span style={{
          display: 'block', padding: '1px 4px', fontSize: 12, borderRadius: 3,
          background: error ? '#fef2f2' : saving ? '#fef3c7' : 'transparent',
          border: error ? '1px solid #fca5a5' : '1px solid transparent',
          color: display ? (error ? '#dc2626' : '#111827') : '#d1d5db',
        }}>
          {error ? `⚠ ${error}` : (display || placeholder)}
        </span>
      )}
    </div>
  )
}

// ─── LockButton ───────────────────────────────────────────────────────────────

function LockButton({ locked, disabled, onToggle }) {
  const [busy, setBusy] = useState(false)

  async function handle() {
    if (disabled || busy) return
    setBusy(true)
    try { await onToggle(!locked) }
    finally { setBusy(false) }
  }

  return (
    <button
      onClick={handle}
      disabled={disabled || busy}
      title={disabled ? 'Set a dev date first' : locked ? 'Locked — click to unlock' : 'Unlocked — click to lock'}
      style={{
        padding: '2px 8px', fontSize: 11, borderRadius: 4, cursor: disabled ? 'not-allowed' : 'pointer',
        border: locked ? '1px solid #16a34a' : '1px solid #d1d5db',
        background: locked ? '#f0fdf4' : busy ? '#f9fafb' : '#fff',
        color: locked ? '#16a34a' : '#9ca3af',
        fontWeight: locked ? 600 : 400,
        transition: 'all 0.15s',
        minWidth: 64,
      }}
    >
      {busy ? '…' : locked ? '⚿ Locked' : 'Unlocked'}
    </button>
  )
}

// ─── BuilderSumBadge ──────────────────────────────────────────────────────────

function BuilderSumBadge({ splits, builders }) {
  const sum = builders.reduce((acc, b) => acc + (splits[b.builder_id] ?? 0), 0)
  const r   = Math.round(sum * 10) / 10
  if (r === 0) return <span style={{ color: '#d1d5db', fontSize: 11 }}>—</span>
  const ok    = r === 100
  const over  = r > 100
  const color = ok ? '#16a34a' : over ? '#dc2626' : '#d97706'
  return (
    <span style={{ fontSize: 11, fontWeight: 600, color,
                   padding: '1px 6px', borderRadius: 10,
                   background: ok ? '#f0fdf4' : over ? '#fef2f2' : '#fef9c3',
                   border: `1px solid ${color}44` }}>
      {r}%
    </span>
  )
}

// ─── FilterBar ────────────────────────────────────────────────────────────────

function FilterBar({ communities, devsByComm, filterComm, filterDev, onChange, rowCount, totalLabel }) {
  const devOptions = filterComm ? (devsByComm[filterComm] ?? [])
                                : Object.values(devsByComm).flat()
  const active = (filterComm ? 1 : 0) + (filterDev ? 1 : 0)

  const selStyle = (on) => ({
    fontSize: 12, padding: '3px 24px 3px 8px', borderRadius: 4,
    border: on ? '1px solid #2563eb' : '1px solid #d1d5db',
    background: on ? '#eff6ff' : '#fff',
    color: on ? '#1d4ed8' : '#374151',
    appearance: 'none', cursor: 'pointer',
  })

  function Wrap({ val, onClear, children }) {
    return (
      <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
        {children}
        {val && (
          <button onClick={onClear} style={{
            position: 'absolute', right: 6, fontSize: 13, lineHeight: 1,
            background: 'none', border: 'none', color: '#2563eb', cursor: 'pointer', padding: 0,
          }}>×</button>
        )}
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
      <span style={{ fontSize: 12, color: '#9ca3af', fontWeight: 500 }}>Filter</span>

      <Wrap val={filterComm} onClear={() => onChange({ comm: null, dev: null })}>
        <select value={filterComm ?? ''} style={selStyle(!!filterComm)}
          onChange={e => onChange({ comm: e.target.value || null, dev: null })}>
          <option value="">All communities</option>
          {communities.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </Wrap>

      <Wrap val={filterDev} onClear={() => onChange({ comm: filterComm, dev: null })}>
        <select value={filterDev ?? ''} style={selStyle(!!filterDev)}
          onChange={e => onChange({ comm: filterComm, dev: e.target.value || null })}>
          <option value="">All developments</option>
          {devOptions.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
        </select>
      </Wrap>

      {active > 0 && (
        <button onClick={() => onChange({ comm: null, dev: null })} style={{
          fontSize: 11, color: '#6b7280', background: '#f3f4f6',
          border: '1px solid #e5e7eb', borderRadius: 4,
          padding: '3px 8px', cursor: 'pointer',
        }}>Clear all</button>
      )}

      <span style={{ marginLeft: 'auto', fontSize: 11, color: '#9ca3af' }}>
        {totalLabel}
        {' · '}click any cell to edit
      </span>
    </div>
  )
}

// ─── GrainHeader helpers ──────────────────────────────────────────────────────

function GrainTh({ label, grain, activeGrain, onSetGrain, style }) {
  const isActive  = grain === activeGrain
  const isPast    = GRAIN_ORDER.indexOf(grain) < GRAIN_ORDER.indexOf(activeGrain)
  return (
    <th
      onClick={() => onSetGrain(grain)}
      style={{
        ...style,
        cursor: 'pointer',
        userSelect: 'none',
        color:      isActive ? '#2563eb' : '#6b7280',
        borderBottom: isActive
          ? '2px solid #2563eb'
          : '2px solid #e5e7eb',
      }}
      title={isActive ? `Viewing at ${label} grain` : `Collapse to ${label} grain`}
    >
      <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
        {label}
        {isActive && <span style={{ fontSize: 9, opacity: 0.7 }}>▾</span>}
        {!isActive && !isPast && <span style={{ fontSize: 9, opacity: 0.45 }}>▸</span>}
      </span>
    </th>
  )
}

// ─── Aggregate stat cell ──────────────────────────────────────────────────────

function StatCell({ val, style }) {
  return (
    <span style={{
      display: 'block', padding: '1px 4px', fontSize: 12, textAlign: 'right',
      color: val > 0 ? '#374151' : '#d1d5db',
      ...style,
    }}>
      {val > 0 ? val : '—'}
    </span>
  )
}

// ─── Main view ────────────────────────────────────────────────────────────────

export default function ConfigView({ showTestCommunities }) {
  const [data,       setData]       = useState(null)
  const [loading,    setLoading]    = useState(true)
  const [loadError,  setLoadError]  = useState(null)
  const [filterComm, setFilterComm] = useState(null)
  const [filterDev,  setFilterDev]  = useState(null)
  const [showSplits, setShowSplits] = useState(true)
  const [grain,      setGrain]      = useState('phase')

  const load = useCallback(() => {
    setLoading(true)
    fetch(`${API_BASE}/admin/phase-config`)
      .then(r => { if (!r.ok) throw new Error(r.status); return r.json() })
      .then(d  => { setData(d); setLoadError(null) })
      .catch(e  => setLoadError(String(e)))
      .finally(()  => setLoading(false))
  }, [])

  useEffect(() => { load() }, [load])

  // ── Derived data ───────────────────────────────────────────────────────────

  const allRows  = data?.rows ?? []
  const testRows = allRows.filter(r => showTestCommunities ? r.is_test : !r.is_test)

  const communities = [...new Map(
    testRows.map(r => [r.ent_group_id, { id: String(r.ent_group_id), name: r.ent_group_name }])
  ).values()]

  const devsByComm = testRows.reduce((acc, r) => {
    const k = String(r.ent_group_id)
    if (!acc[k]) acc[k] = []
    if (!acc[k].find(d => d.id === String(r.dev_id)))
      acc[k].push({ id: String(r.dev_id), name: r.dev_name })
    return acc
  }, {})

  const filteredPhaseRows = testRows.filter(r => {
    if (filterComm && String(r.ent_group_id) !== filterComm) return false
    if (filterDev  && String(r.dev_id)       !== filterDev)  return false
    return true
  })

  const displayRows = groupRows(filteredPhaseRows, grain)

  // Band by community
  const commBandIdx = {}
  let bandN = 0
  displayRows.forEach(r => {
    if (commBandIdx[r.ent_group_id] === undefined) commBandIdx[r.ent_group_id] = bandN++
  })

  const totalLabel = (() => {
    const n = displayRows.length
    if (grain === 'phase')      return `${n} phase${n !== 1 ? 's' : ''}`
    if (grain === 'instrument') return `${n} instrument${n !== 1 ? 's' : ''}`
    if (grain === 'dev')        return `${n} development${n !== 1 ? 's' : ''}`
    return `${n} communit${n !== 1 ? 'ies' : 'y'}`
  })()

  // ── Local state updaters ───────────────────────────────────────────────────

  function patchRow(phaseId, patch) {
    setData(prev => ({ ...prev, rows: prev.rows.map(r => r.phase_id === phaseId ? { ...r, ...patch } : r) }))
  }

  // ── Save helpers ───────────────────────────────────────────────────────────

  async function savePhaseField(phaseId, field, value) {
    const res = await fetch(`${API_BASE}/admin/phase/${phaseId}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ [field]: value }),
    })
    if (!res.ok) throw new Error(await res.text())
    patchRow(phaseId, await res.json())
  }

  async function toggleLock(row, shouldLock) {
    const date_dev_actual = shouldLock ? row.date_dev_projected : null
    const res = await fetch(`${API_BASE}/admin/phase/${row.phase_id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ date_dev_actual }),
    })
    if (!res.ok) throw new Error(await res.text())
    patchRow(row.phase_id, await res.json())
  }

  async function saveProductSplit(phaseId, lotTypeId, count) {
    const res = await fetch(`${API_BASE}/admin/product-split/${phaseId}/${lotTypeId}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projected_count: count ?? 0 }),
    })
    if (!res.ok) throw new Error(await res.text())
    const row = allRows.find(r => r.phase_id === phaseId)
    patchRow(phaseId, { product_splits: { ...(row?.product_splits ?? {}), [lotTypeId]: count ?? 0 } })
  }

  async function saveBuilderSplit(phaseId, builderId, share) {
    const res = await fetch(`${API_BASE}/admin/builder-split/${phaseId}/${builderId}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ share }),
    })
    if (!res.ok) throw new Error(await res.text())
    const row = allRows.find(r => r.phase_id === phaseId)
    const newSplits = { ...(row?.builder_splits ?? {}) }
    if (share == null) delete newSplits[builderId]; else newSplits[builderId] = share
    patchRow(phaseId, { builder_splits: newSplits })
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  if (loading)   return <div style={{ padding: 24, color: '#6b7280', fontSize: 13 }}>Loading…</div>
  if (loadError) return <div style={{ padding: 24, color: '#dc2626', fontSize: 13 }}>{loadError}</div>

  const lotTypes = data?.lot_types ?? []
  const builders = data?.builders  ?? []

  const BAND = ['#ffffff', '#f8faff']
  const vis  = stickyVisible(grain)
  const shadowCol = shadowFor(grain)

  // Shared style builders
  const thBase = {
    padding: '5px 7px', fontSize: 11, fontWeight: 600,
    background: '#f3f4f6', whiteSpace: 'nowrap',
    position: 'sticky', top: 0,
  }
  const thS  = (left, w, extra = {}) => ({ ...thBase, left, zIndex: 5, width: w, minWidth: w, ...extra })
  const thR  = (extra = {}) => ({ ...thBase, zIndex: 2, color: '#6b7280', textAlign: 'right',
                                   borderBottom: '2px solid #e5e7eb', ...extra })
  const thGR = (extra = {}) => ({ ...thR(extra), borderLeft: '2px solid #e0e0e0' })

  const SHADOW = { boxShadow: '4px 0 8px -2px rgba(0,0,0,0.10)' }

  return (
    <div style={{ padding: '14px 20px', fontFamily: 'system-ui, sans-serif', fontSize: 13 }}>

      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
        <span style={{ fontSize: 15, fontWeight: 700, color: '#111827' }}>Phase Configuration</span>
        <button onClick={load} style={{
          fontSize: 11, color: '#6b7280', background: 'none',
          border: '1px solid #e5e7eb', borderRadius: 4, padding: '2px 8px', cursor: 'pointer',
        }}>Refresh</button>
        {grain === 'phase' && (
          <button onClick={() => setShowSplits(v => !v)} style={{
            fontSize: 11, padding: '2px 10px', borderRadius: 4, cursor: 'pointer',
            border: showSplits ? '1px solid #2563eb' : '1px solid #d1d5db',
            background: showSplits ? '#eff6ff' : '#fff',
            color: showSplits ? '#1d4ed8' : '#6b7280',
          }}>
            {showSplits ? 'Hide' : 'Show'} product splits
          </button>
        )}
      </div>

      <FilterBar
        communities={communities} devsByComm={devsByComm}
        filterComm={filterComm} filterDev={filterDev}
        onChange={({ comm, dev }) => { setFilterComm(comm); setFilterDev(dev) }}
        rowCount={displayRows.length} totalLabel={totalLabel}
      />

      <div style={{ overflowX: 'auto', overflowY: 'auto',
                    maxHeight: 'calc(100vh - 152px)',
                    border: '1px solid #e5e7eb', borderRadius: 6 }}>
        <table style={{ borderCollapse: 'collapse', minWidth: 'max-content', width: '100%' }}>
          <thead>
            <tr>
              {/* Grain hierarchy headers — always render all 4, but only show visible ones */}
              <GrainTh label="Community"   grain="community"  activeGrain={grain} onSetGrain={setGrain}
                style={thS(LEFT.comm, CW.comm, shadowCol === 'comm' ? SHADOW : {})} />
              {vis.dev && (
                <GrainTh label="Development" grain="dev"       activeGrain={grain} onSetGrain={setGrain}
                  style={thS(LEFT.dev, CW.dev, shadowCol === 'dev' ? SHADOW : {})} />
              )}
              {vis.inst && (
                <GrainTh label="Instrument"  grain="instrument" activeGrain={grain} onSetGrain={setGrain}
                  style={thS(LEFT.inst, CW.inst, shadowCol === 'inst' ? SHADOW : {})} />
              )}
              {vis.phase && (
                <GrainTh label="Phase"       grain="phase"      activeGrain={grain} onSetGrain={setGrain}
                  style={thS(LEFT.phase, CW.phase, shadowCol === 'phase' ? SHADOW : {})} />
              )}

              {/* ── Community grain columns ── */}
              {grain === 'community' && <>
                <th style={thGR({ width: 52 })} title="Distinct developments">Devs</th>
                <th style={thR({  width: 52 })} title="Total phases">Phases</th>
                <th style={thGR({ width: 52 })} title="Sum of projected counts">Proj</th>
                <th style={thR({  width: 44 })} title="Real lots">Real</th>
                <th style={thR({  width: 44 })} title="Sim lots from last run">Sim</th>
              </>}

              {/* ── Dev grain columns ── */}
              {grain === 'dev' && <>
                <th style={thGR({ width: 52 })} title="Total phases">Phases</th>
                <th style={thGR({ width: 52 })} title="Sum of projected counts">Proj</th>
                <th style={thR({  width: 44 })} title="Real lots">Real</th>
                <th style={thR({  width: 44 })} title="Sim lots from last run">Sim</th>
              </>}

              {/* ── Instrument grain columns ── */}
              {grain === 'instrument' && <>
                <th style={thGR({ width: 52 })} title="Total phases">Phases</th>
                <th style={thGR({ width: 52 })} title="Sum of projected counts">Proj</th>
                <th style={thR({  width: 44 })} title="Real lots">Real</th>
                <th style={thR({  width: 44 })} title="Sim lots from last run">Sim</th>
              </>}

              {/* ── Phase grain columns ── */}
              {grain === 'phase' && <>
                <th style={thGR({ width: 52 })} title="Sum of projected counts across all lot types">Proj</th>
                <th style={thR({  width: 44 })} title="Real lots in system">Real</th>
                <th style={thR({  width: 44 })} title="Sim lots from last run">Sim</th>
                <th style={thGR({ width: 90 })}>Dev Date</th>
                <th style={thR({  width: 84 })}>Lock</th>
                {showSplits && lotTypes.map((lt, i) => (
                  <th key={lt.lot_type_id} style={{
                    ...thR({ width: 68 }),
                    ...(i === 0 ? { borderLeft: '2px solid #e0e0e0' } : {}),
                  }} title={lt.lot_type_name}>
                    {lt.lot_type_short}
                  </th>
                ))}
                {builders.map((b, i) => (
                  <th key={b.builder_id} style={{
                    ...thR({ width: 66 }),
                    ...(i === 0 ? { borderLeft: '2px solid #e0e0e0' } : {}),
                  }}>
                    {b.builder_name}
                  </th>
                ))}
                {builders.length > 0 && (
                  <th style={thR({ width: 52 })} title="Sum of builder shares">%</th>
                )}
              </>}
            </tr>
          </thead>
          <tbody>
            {displayRows.length === 0 && (
              <tr><td colSpan={99} style={{ padding: 24, fontSize: 12, color: '#9ca3af', textAlign: 'center' }}>
                No data matches the current filter.
              </td></tr>
            )}

            {displayRows.map((row, i) => {
              const prev        = displayRows[i - 1]
              const isFirstComm = i === 0 || row.ent_group_id  !== prev?.ent_group_id
              const isFirstDev  = i === 0 || row.dev_id        !== prev?.dev_id || isFirstComm
              const isFirstInst = i === 0 || row.instrument_id !== prev?.instrument_id || isFirstDev
              const bg          = BAND[(commBandIdx[row.ent_group_id] ?? 0) % 2]

              const topBorder =
                isFirstComm ? '2px solid #e5e7eb' :
                isFirstDev  ? '2px solid #e5e7eb' :
                isFirstInst ? '1px solid #e9e9e9' :
                              '1px solid #f3f4f6'

              const tdB = (extra = {}) => ({
                padding: '4px 6px', background: bg, borderTop: topBorder,
                verticalAlign: 'middle', ...extra,
              })
              const tdS = (left, extra = {}) => ({
                ...tdB(extra), position: 'sticky', left, zIndex: 1,
              })
              const tdG = (extra = {}) => ({ ...tdB(extra), borderLeft: '2px solid #ebebeb' })

              const dimText = (show, text) => (
                <span style={{ fontSize: 12, color: show ? '#374151' : '#d1d5db',
                               fontWeight: show ? 500 : 400, display: 'block', paddingLeft: show ? 0 : 11 }}>
                  {show ? text : '·'}
                </span>
              )

              // ── Phase grain: use existing per-phase data ───────────────────
              if (grain === 'phase') {
                const ltc = row.lot_type_counts ?? {}
                const ps  = row.product_splits  ?? {}
                const projTotal = Object.values(ps).reduce((s, v) => s + (v ?? 0), 0)
                const realTotal = Object.values(ltc).reduce((s, v) => s + (v.real ?? 0), 0)
                const simTotal  = Object.values(ltc).reduce((s, v) => s + (v.sim  ?? 0), 0)
                const isLocked  = !!row.date_dev_actual
                const canLock   = !!row.date_dev_projected

                const numCell = (val) => (
                  <span style={{ fontSize: 12, display: 'block', padding: '1px 4px', textAlign: 'right',
                                 color: val > 0 ? '#374151' : '#d1d5db' }}>
                    {val > 0 ? val : '—'}
                  </span>
                )

                return (
                  <tr key={row.phase_id}>
                    <td style={tdS(LEFT.comm,  shadowCol === 'comm'  ? { ...SHADOW, zIndex: 2 } : {})}>
                      {dimText(isFirstComm, row.ent_group_name)}
                    </td>
                    <td style={tdS(LEFT.dev,   shadowCol === 'dev'   ? { ...SHADOW, zIndex: 2 } : {})}>
                      {dimText(isFirstDev, row.dev_name)}
                    </td>
                    <td style={tdS(LEFT.inst,  shadowCol === 'inst'  ? { ...SHADOW, zIndex: 2 } : {})}>
                      {dimText(isFirstInst, row.instrument_name ?? '—')}
                    </td>
                    <td style={tdS(LEFT.phase, shadowCol === 'phase' ? { ...SHADOW, zIndex: 2 } : {})}>
                      <span style={{ fontSize: 12, color: '#374151' }}>{row.phase_name}</span>
                    </td>
                    <td style={tdG({ textAlign: 'right' })}>{numCell(projTotal)}</td>
                    <td style={tdB({ textAlign: 'right' })}>{numCell(realTotal)}</td>
                    <td style={tdB({ textAlign: 'right' })}>{numCell(simTotal)}</td>
                    <td style={tdG({ textAlign: 'right' })}>
                      <EditableCell
                        value={row.date_dev_projected} type="date" width={84}
                        onSave={v => savePhaseField(row.phase_id, 'date_dev_projected', v)}
                        placeholder="—"
                      />
                    </td>
                    <td style={tdB({ textAlign: 'center' })}>
                      <LockButton
                        locked={isLocked} disabled={!canLock}
                        onToggle={shouldLock => toggleLock(row, shouldLock)}
                      />
                    </td>
                    {showSplits && lotTypes.map((lt, idx) => {
                      const projVal  = ps[lt.lot_type_id] ?? null
                      const ltCounts = ltc[lt.lot_type_id] ?? { real: 0, sim: 0 }
                      return (
                        <td key={lt.lot_type_id} style={{
                          ...tdB({ textAlign: 'right', padding: '3px 6px' }),
                          ...(idx === 0 ? { borderLeft: '2px solid #ebebeb' } : {}),
                        }}>
                          <EditableCell
                            value={projVal} width={56} placeholder="0"
                            onSave={v => saveProductSplit(row.phase_id, lt.lot_type_id, v)}
                          />
                          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 6,
                                        marginTop: 2, paddingRight: 4 }}>
                            <span style={{ fontSize: 10, color: ltCounts.real > 0 ? '#6b7280' : '#e5e7eb' }}
                                  title="Real lots">R:{ltCounts.real}</span>
                            <span style={{ fontSize: 10, color: ltCounts.sim  > 0 ? '#9ca3af' : '#e5e7eb' }}
                                  title="Sim lots">S:{ltCounts.sim}</span>
                          </div>
                        </td>
                      )
                    })}
                    {builders.map((b, idx) => (
                      <td key={b.builder_id} style={{
                        ...tdB({ textAlign: 'right' }),
                        ...(idx === 0 ? { borderLeft: '2px solid #ebebeb' } : {}),
                      }}>
                        <EditableCell
                          value={row.builder_splits[b.builder_id] ?? null} width={58} placeholder="0"
                          onSave={v => saveBuilderSplit(row.phase_id, b.builder_id, v)}
                        />
                      </td>
                    ))}
                    {builders.length > 0 && (
                      <td style={tdB({ textAlign: 'center', padding: '4px 8px' })}>
                        <BuilderSumBadge splits={row.builder_splits} builders={builders} />
                      </td>
                    )}
                  </tr>
                )
              }

              // ── Coarser grains: aggregated read-only rows ─────────────────
              const rowKey = row._key ?? `${row.ent_group_id}-${i}`

              return (
                <tr key={rowKey}>
                  {/* Community sticky col — always visible */}
                  <td style={tdS(LEFT.comm, shadowCol === 'comm' ? { ...SHADOW, zIndex: 2 } : {})}>
                    {dimText(isFirstComm, row.ent_group_name)}
                  </td>

                  {/* Dev col */}
                  {vis.dev && (
                    <td style={tdS(LEFT.dev, shadowCol === 'dev' ? { ...SHADOW, zIndex: 2 } : {})}>
                      {dimText(isFirstDev, row.dev_name)}
                    </td>
                  )}

                  {/* Instrument col */}
                  {vis.inst && (
                    <td style={tdS(LEFT.inst, shadowCol === 'inst' ? { ...SHADOW, zIndex: 2 } : {})}>
                      {dimText(isFirstInst, row.instrument_name ?? '—')}
                    </td>
                  )}

                  {/* Community grain metric cells */}
                  {grain === 'community' && <>
                    <td style={tdG({ textAlign: 'right' })}><StatCell val={row.devCount} /></td>
                    <td style={tdB({ textAlign: 'right' })}><StatCell val={row.phaseCount} /></td>
                    <td style={tdG({ textAlign: 'right' })}><StatCell val={row.projTotal} /></td>
                    <td style={tdB({ textAlign: 'right' })}><StatCell val={row.realTotal} /></td>
                    <td style={tdB({ textAlign: 'right' })}><StatCell val={row.simTotal} /></td>
                  </>}

                  {/* Dev grain metric cells */}
                  {grain === 'dev' && <>
                    <td style={tdG({ textAlign: 'right' })}><StatCell val={row.phaseCount} /></td>
                    <td style={tdG({ textAlign: 'right' })}><StatCell val={row.projTotal} /></td>
                    <td style={tdB({ textAlign: 'right' })}><StatCell val={row.realTotal} /></td>
                    <td style={tdB({ textAlign: 'right' })}><StatCell val={row.simTotal} /></td>
                  </>}

                  {/* Instrument grain metric cells */}
                  {grain === 'instrument' && <>
                    <td style={tdG({ textAlign: 'right' })}><StatCell val={row.phaseCount} /></td>
                    <td style={tdG({ textAlign: 'right' })}><StatCell val={row.projTotal} /></td>
                    <td style={tdB({ textAlign: 'right' })}><StatCell val={row.realTotal} /></td>
                    <td style={tdB({ textAlign: 'right' })}><StatCell val={row.simTotal} /></td>
                  </>}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
