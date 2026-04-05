import { useState, useEffect, useRef, useCallback } from 'react'
import { API_BASE } from '../utils/api'

// ─── Sticky column geometry ───────────────────────────────────────────────────

const CW = { comm: 168, dev: 148, phase: 124 }
const LEFT = { comm: 0, dev: CW.comm, phase: CW.comm + CW.dev }
const PHASE_RIGHT_SHADOW = { boxShadow: '4px 0 8px -2px rgba(0,0,0,0.10)' }

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtDate(iso) {
  if (!iso) return ''
  return new Date(iso + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', year: '2-digit' })
}

// ─── EditableCell ─────────────────────────────────────────────────────────────

function EditableCell({
  value, type = 'number', onSave,
  display = null,   // optional format fn: raw -> display string
  placeholder = '—', width = 56, align = 'right',
  highlight = null, // 'lock' | 'warn' | null
  readOnly = false,
}) {
  const [editing, setEditing]   = useState(false)
  const [draft,   setDraft]     = useState('')
  const [saving,  setSaving]    = useState(false)
  const [error,   setError]     = useState(null)
  const inputRef = useRef()

  function startEdit() {
    if (readOnly || saving) return
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
      if (isNaN(parsed)) { setError('Invalid'); return }
    } else {
      parsed = raw   // date string YYYY-MM-DD
    }
    if (parsed === value || (parsed == null && value == null)) return
    setSaving(true); setError(null)
    try { await onSave(parsed) }
    catch (e) { setError(String(e).replace('Error: ', '')) }
    finally { setSaving(false) }
  }

  function onKeyDown(e) {
    if (e.key === 'Enter')  { e.preventDefault(); commit() }
    if (e.key === 'Escape') { setEditing(false) }
  }

  const displayed = display ? display(value) : (value != null ? String(value) : '')
  const bg = highlight === 'lock' ? '#f0fdf4'
           : highlight === 'warn' ? '#fef9c3'
           : saving ? '#fef3c7'
           : error  ? '#fef2f2'
           : 'transparent'
  const border = error   ? '1px solid #dc2626'
               : saving  ? '1px solid #d97706'
               : editing ? '1px solid #2563eb'
               : '1px solid transparent'

  return (
    <div onClick={startEdit} title={error ?? undefined} style={{
      width, minHeight: 22, textAlign: align,
      cursor: readOnly ? 'default' : 'text',
    }}>
      {editing ? (
        <input
          ref={inputRef}
          type={type === 'date' ? 'date' : 'number'}
          min={type === 'number' ? 0 : undefined}
          value={draft}
          onChange={e => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={onKeyDown}
          style={{
            width: '100%', padding: '1px 4px', fontSize: 12, textAlign: align,
            border: '1px solid #2563eb', borderRadius: 3, background: '#fff', outline: 'none',
          }}
        />
      ) : (
        <span style={{
          display: 'block', padding: '1px 4px', fontSize: 12, borderRadius: 3,
          background: bg, border,
          color: displayed ? '#111827' : '#d1d5db',
        }}>
          {displayed || placeholder}
          {highlight === 'lock' && displayed && (
            <span style={{ marginLeft: 4, fontSize: 10, color: '#16a34a' }}>⚿</span>
          )}
        </span>
      )}
    </div>
  )
}

// ─── BuilderSumBadge ──────────────────────────────────────────────────────────

function BuilderSumBadge({ splits, builders }) {
  const sum = builders.reduce((acc, b) => acc + (splits[b.builder_id] ?? 0), 0)
  const rounded = Math.round(sum * 10) / 10
  if (rounded === 0) return <span style={{ color: '#d1d5db', fontSize: 11 }}>—</span>
  const ok    = rounded === 100
  const over  = rounded > 100
  const color = ok ? '#16a34a' : over ? '#dc2626' : '#d97706'
  return (
    <span style={{ fontSize: 11, fontWeight: 600, color, padding: '1px 5px',
                   background: ok ? '#f0fdf4' : over ? '#fef2f2' : '#fef9c3',
                   borderRadius: 10, border: `1px solid ${color}33` }}>
      {rounded}%
    </span>
  )
}

// ─── FilterBar ────────────────────────────────────────────────────────────────

function FilterBar({ communities, devsByComm, filterComm, filterDev, onChange }) {
  function setComm(v) { onChange({ comm: v, dev: null }) }
  function setDev(v)  { onChange({ comm: filterComm, dev: v }) }
  function clear()    { onChange({ comm: null, dev: null }) }

  const devOptions = filterComm
    ? (devsByComm[filterComm] ?? [])
    : Object.values(devsByComm).flat()

  const activeCount = (filterComm ? 1 : 0) + (filterDev ? 1 : 0)

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14, flexWrap: 'wrap' }}>
      <span style={{ fontSize: 12, color: '#9ca3af', fontWeight: 500 }}>Filter</span>

      {/* Community */}
      <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
        <select value={filterComm ?? ''} onChange={e => setComm(e.target.value || null)}
          style={{ fontSize: 12, padding: '3px 24px 3px 8px', borderRadius: 4,
                   border: filterComm ? '1px solid #2563eb' : '1px solid #d1d5db',
                   background: filterComm ? '#eff6ff' : '#fff', color: filterComm ? '#1d4ed8' : '#374151',
                   appearance: 'none', cursor: 'pointer' }}>
          <option value="">All communities</option>
          {communities.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        {filterComm && (
          <button onClick={() => setComm(null)} style={{
            position: 'absolute', right: 6, fontSize: 13, lineHeight: 1,
            background: 'none', border: 'none', color: '#2563eb', cursor: 'pointer', padding: 0,
          }}>×</button>
        )}
      </div>

      {/* Development */}
      <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
        <select value={filterDev ?? ''} onChange={e => setDev(e.target.value || null)}
          style={{ fontSize: 12, padding: '3px 24px 3px 8px', borderRadius: 4,
                   border: filterDev ? '1px solid #2563eb' : '1px solid #d1d5db',
                   background: filterDev ? '#eff6ff' : '#fff', color: filterDev ? '#1d4ed8' : '#374151',
                   appearance: 'none', cursor: 'pointer' }}>
          <option value="">All developments</option>
          {devOptions.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
        </select>
        {filterDev && (
          <button onClick={() => setDev(null)} style={{
            position: 'absolute', right: 6, fontSize: 13, lineHeight: 1,
            background: 'none', border: 'none', color: '#2563eb', cursor: 'pointer', padding: 0,
          }}>×</button>
        )}
      </div>

      {activeCount > 0 && (
        <button onClick={clear} style={{
          fontSize: 11, color: '#6b7280', background: '#f3f4f6',
          border: '1px solid #e5e7eb', borderRadius: 4, padding: '3px 8px', cursor: 'pointer',
        }}>
          Clear all {activeCount > 1 ? `(${activeCount})` : ''}
        </button>
      )}

      <span style={{ marginLeft: 'auto', fontSize: 11, color: '#9ca3af' }}>
        Click any cell to edit · changes save automatically
      </span>
    </div>
  )
}

// ─── Main view ────────────────────────────────────────────────────────────────

export default function ConfigView({ showTestCommunities }) {
  const [data,      setData]      = useState(null)
  const [loading,   setLoading]   = useState(true)
  const [loadError, setLoadError] = useState(null)
  const [filterComm, setFilterComm] = useState(null)   // ent_group_id string
  const [filterDev,  setFilterDev]  = useState(null)   // dev_id string

  const load = useCallback(() => {
    setLoading(true)
    fetch(`${API_BASE}/admin/phase-config`)
      .then(r => { if (!r.ok) throw new Error(r.status); return r.json() })
      .then(d => { setData(d); setLoadError(null) })
      .catch(e => setLoadError(String(e)))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => { load() }, [load])

  // ── Derived filter options ────────────────────────────────────────────────

  const allRows = data?.rows ?? []
  const testFilteredRows = allRows.filter(r => showTestCommunities ? r.is_test : !r.is_test)

  const communities = [...new Map(
    testFilteredRows.map(r => [r.ent_group_id, { id: String(r.ent_group_id), name: r.ent_group_name }])
  ).values()]

  const devsByComm = testFilteredRows.reduce((acc, r) => {
    const key = String(r.ent_group_id)
    if (!acc[key]) acc[key] = []
    if (!acc[key].find(d => d.id === String(r.dev_id))) {
      acc[key].push({ id: String(r.dev_id), name: r.dev_name })
    }
    return acc
  }, {})

  const rows = testFilteredRows.filter(r => {
    if (filterComm && String(r.ent_group_id) !== filterComm) return false
    if (filterDev  && String(r.dev_id)       !== filterDev)  return false
    return true
  })

  // ── Pre-compute community alternating band index ──────────────────────────

  const commBandIdx = {}
  let bandIdx = 0
  rows.forEach((r, i) => {
    if (i === 0 || r.ent_group_id !== rows[i - 1].ent_group_id) {
      commBandIdx[r.ent_group_id] ??= bandIdx++
    }
  })

  // ── Local state updaters ──────────────────────────────────────────────────

  function updateRow(phaseId, patch) {
    setData(prev => ({
      ...prev,
      rows: prev.rows.map(r => r.phase_id === phaseId ? { ...r, ...patch } : r),
    }))
  }
  function updateDevRows(devId, patch) {
    setData(prev => ({
      ...prev,
      rows: prev.rows.map(r => r.dev_id === devId ? { ...r, ...patch } : r),
    }))
  }

  // ── Save helpers ──────────────────────────────────────────────────────────

  async function savePhase(phaseId, field, value) {
    const res = await fetch(`${API_BASE}/admin/phase/${phaseId}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ [field]: value }),
    })
    if (!res.ok) throw new Error(await res.text())
    const updated = await res.json()
    updateRow(phaseId, updated)
  }

  async function saveProductSplit(phaseId, lotTypeId, count) {
    const res = await fetch(`${API_BASE}/admin/product-split/${phaseId}/${lotTypeId}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projected_count: count ?? 0 }),
    })
    if (!res.ok) throw new Error(await res.text())
    updateRow(phaseId, {
      product_splits: { ...rows.find(r => r.phase_id === phaseId)?.product_splits, [lotTypeId]: count ?? 0 },
    })
  }

  async function saveBuilderSplit(phaseId, builderId, share) {
    const res = await fetch(`${API_BASE}/admin/builder-split/${phaseId}/${builderId}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ share }),
    })
    if (!res.ok) throw new Error(await res.text())
    const row = allRows.find(r => r.phase_id === phaseId)
    const newSplits = { ...(row?.builder_splits ?? {}) }
    if (share == null) delete newSplits[builderId]
    else newSplits[builderId] = share
    updateRow(phaseId, { builder_splits: newSplits })
  }

  async function saveDevParams(devId, field, value) {
    const existingRow = allRows.find(r => r.dev_id === devId)
    const body = {
      annual_starts_target: field === 'annual_starts_target' ? value : (existingRow?.annual_starts_target ?? null),
      max_starts_per_month: field === 'max_starts_per_month' ? value : (existingRow?.max_starts_per_month ?? null),
    }
    const res = await fetch(`${API_BASE}/admin/dev-params/${devId}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (!res.ok) throw new Error(await res.text())
    const updated = await res.json()
    updateDevRows(devId, {
      annual_starts_target: updated.annual_starts_target,
      max_starts_per_month: updated.max_starts_per_month,
      params_status: 'ok',
    })
  }

  // ── Render ────────────────────────────────────────────────────────────────

  if (loading)   return <div style={{ padding: 24, color: '#6b7280', fontSize: 13 }}>Loading…</div>
  if (loadError) return <div style={{ padding: 24, color: '#dc2626', fontSize: 13 }}>{loadError}</div>

  const lotTypes = data?.lot_types ?? []
  const builders = data?.builders  ?? []

  const DOT  = { ok: '#16a34a', stale: '#d97706', missing: '#dc2626' }
  const BAND = ['#ffffff', '#f8faff']

  // Header style
  const thBase = {
    padding: '5px 6px', fontSize: 11, fontWeight: 600, color: '#6b7280',
    background: '#f3f4f6', whiteSpace: 'nowrap', borderBottom: '2px solid #e5e7eb',
    position: 'sticky', top: 0,
  }
  const thSticky = (left, extra = {}) => ({ ...thBase, left, zIndex: 5, ...extra })
  const thScroll = (extra = {})       => ({ ...thBase, zIndex: 2, textAlign: 'right', ...extra })
  const thGroup  = (extra = {})       => ({ ...thBase, zIndex: 2, textAlign: 'right',
                                            borderLeft: '2px solid #e5e7eb', ...extra })

  return (
    <div style={{ padding: '16px 20px', fontFamily: 'system-ui, sans-serif', fontSize: 13 }}>

      <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, marginBottom: 12 }}>
        <span style={{ fontSize: 15, fontWeight: 700, color: '#111827' }}>Phase Configuration</span>
        <button onClick={load} style={{ fontSize: 11, color: '#6b7280', background: 'none',
                                        border: '1px solid #e5e7eb', borderRadius: 4,
                                        padding: '2px 8px', cursor: 'pointer' }}>
          Refresh
        </button>
      </div>

      <FilterBar
        communities={communities}
        devsByComm={devsByComm}
        filterComm={filterComm}
        filterDev={filterDev}
        onChange={({ comm, dev }) => { setFilterComm(comm); setFilterDev(dev) }}
      />

      <div style={{ overflowX: 'auto', overflowY: 'auto',
                    maxHeight: 'calc(100vh - 148px)',
                    border: '1px solid #e5e7eb', borderRadius: 6 }}>
        <table style={{ borderCollapse: 'collapse', minWidth: 'max-content', width: '100%' }}>
          <thead>
            <tr>
              {/* Sticky hierarchy */}
              <th style={thSticky(LEFT.comm,  { width: CW.comm,  minWidth: CW.comm  })}>Community</th>
              <th style={thSticky(LEFT.dev,   { width: CW.dev,   minWidth: CW.dev   })}>Development</th>
              <th style={thSticky(LEFT.phase, { width: CW.phase, minWidth: CW.phase, ...PHASE_RIGHT_SHADOW })}>Phase</th>
              {/* Dev-level */}
              <th style={thGroup({ width: 62 })}>Starts/yr</th>
              <th style={thScroll({ width: 58 })}>Max/mo</th>
              {/* Phase units */}
              <th style={thGroup({ width: 56 })} title="Projected lot count (editable)">Proj</th>
              <th style={thScroll({ width: 44 })} title="Real lots currently in system">Real</th>
              <th style={thScroll({ width: 44 })} title="Sim lots from last run">Sim</th>
              {/* Phase dates */}
              <th style={thGroup({ width: 92 })} title="Projected development date">Dev Date</th>
              <th style={thScroll({ width: 94 })} title="Actual delivery date — when set, locks the phase">Actual</th>
              {/* Product splits */}
              {lotTypes.length > 0 && (
                <th style={thGroup({ width: 'auto', textAlign: 'center', color: '#374151' })}
                    colSpan={lotTypes.length}>
                  Product Mix (projected count)
                </th>
              )}
              {/* Builder splits */}
              {builders.length > 0 && (
                <>
                  <th style={thGroup({ width: 'auto', textAlign: 'center', color: '#374151' })}
                      colSpan={builders.length}>
                    Builder Splits (%)
                  </th>
                  <th style={thScroll({ width: 48 })} title="Sum of builder shares">Sum</th>
                </>
              )}
            </tr>
            {/* Sub-header row for dynamic columns */}
            {(lotTypes.length > 0 || builders.length > 0) && (
              <tr>
                <th style={{ ...thSticky(LEFT.comm),  background: '#f9fafb' }} />
                <th style={{ ...thSticky(LEFT.dev),   background: '#f9fafb' }} />
                <th style={{ ...thSticky(LEFT.phase, { ...PHASE_RIGHT_SHADOW }), background: '#f9fafb' }} />
                {/* dev cols placeholder */}
                <th style={{ ...thGroup(), background: '#f9fafb' }} />
                <th style={{ ...thScroll(), background: '#f9fafb' }} />
                {/* units placeholder */}
                <th style={{ ...thGroup(), background: '#f9fafb' }} />
                <th style={{ ...thScroll(), background: '#f9fafb' }} />
                <th style={{ ...thScroll(), background: '#f9fafb' }} />
                {/* date placeholders */}
                <th style={{ ...thGroup(), background: '#f9fafb' }} />
                <th style={{ ...thScroll(), background: '#f9fafb' }} />
                {/* lot type sub-headers */}
                {lotTypes.map((lt, i) => (
                  <th key={lt.lot_type_id} style={{
                    ...thScroll(), background: '#f9fafb', fontSize: 10, color: '#374151',
                    ...(i === 0 ? { borderLeft: '2px solid #e5e7eb' } : {}),
                  }}>
                    {lt.lot_type_short}
                  </th>
                ))}
                {/* builder sub-headers */}
                {builders.map((b, i) => (
                  <th key={b.builder_id} style={{
                    ...thScroll(), background: '#f9fafb', fontSize: 10, color: '#374151',
                    ...(i === 0 ? { borderLeft: '2px solid #e5e7eb' } : {}),
                  }}>
                    {b.builder_name}
                  </th>
                ))}
                {builders.length > 0 && <th style={{ ...thScroll(), background: '#f9fafb' }} />}
              </tr>
            )}
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr><td colSpan={99} style={{ padding: 24, fontSize: 12, color: '#9ca3af', textAlign: 'center' }}>
                No phases found.
              </td></tr>
            )}
            {rows.map((row, i) => {
              const prev          = rows[i - 1]
              const isFirstComm   = i === 0 || row.ent_group_id !== prev.ent_group_id
              const isFirstDev    = i === 0 || row.dev_id       !== prev.dev_id
              const bg            = BAND[(commBandIdx[row.ent_group_id] ?? 0) % 2]
              const topBorder     = isFirstDev  ? '2px solid #e5e7eb'
                                  : '1px solid #f0f0f0'

              const td = (extra = {}) => ({
                padding: '3px 6px', background: bg, borderTop: topBorder, verticalAlign: 'middle',
                ...extra,
              })
              const tdSticky = (left, extra = {}) => ({
                ...td(extra), position: 'sticky', left, zIndex: 1,
              })
              const tdGroup = (extra = {}) => ({
                ...td(extra), borderLeft: '2px solid #e9e9e9',
              })

              return (
                <tr key={row.phase_id}>
                  {/* Community */}
                  <td style={tdSticky(LEFT.comm)}>
                    <span style={{ fontSize: 12, color: isFirstComm ? '#374151' : '#d1d5db',
                                   fontWeight: isFirstComm ? 500 : 400 }}>
                      {isFirstComm ? row.ent_group_name : '·'}
                    </span>
                  </td>

                  {/* Development */}
                  <td style={tdSticky(LEFT.dev)}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                      {isFirstDev && (
                        <span title={row.params_status} style={{
                          width: 6, height: 6, borderRadius: '50%', flexShrink: 0,
                          background: DOT[row.params_status] ?? '#9ca3af', display: 'inline-block',
                        }} />
                      )}
                      <span style={{ fontSize: 12, color: isFirstDev ? '#374151' : '#d1d5db',
                                     fontWeight: isFirstDev ? 500 : 400,
                                     paddingLeft: isFirstDev ? 0 : 11 }}>
                        {isFirstDev ? row.dev_name : '·'}
                      </span>
                    </div>
                  </td>

                  {/* Phase */}
                  <td style={tdSticky(LEFT.phase, PHASE_RIGHT_SHADOW)}>
                    <span style={{ fontSize: 12, color: '#374151' }}>{row.phase_name}</span>
                  </td>

                  {/* Starts/yr — dev-level */}
                  <td style={tdGroup({ textAlign: 'right' })}>
                    {isFirstDev ? (
                      <EditableCell
                        value={row.annual_starts_target} width={54}
                        onSave={v => saveDevParams(row.dev_id, 'annual_starts_target', v)}
                        placeholder="—"
                      />
                    ) : (
                      <span style={{ display: 'block', fontSize: 12, color: '#d1d5db',
                                     textAlign: 'right', padding: '1px 4px' }}>·</span>
                    )}
                  </td>

                  {/* Max/mo — dev-level */}
                  <td style={td({ textAlign: 'right' })}>
                    {isFirstDev ? (
                      <EditableCell
                        value={row.max_starts_per_month} width={50}
                        onSave={v => saveDevParams(row.dev_id, 'max_starts_per_month', v)}
                        placeholder="—"
                      />
                    ) : (
                      <span style={{ display: 'block', fontSize: 12, color: '#d1d5db',
                                     textAlign: 'right', padding: '1px 4px' }}>·</span>
                    )}
                  </td>

                  {/* Projected lot count */}
                  <td style={tdGroup({ textAlign: 'right' })}>
                    <EditableCell
                      value={row.lot_count_projected} width={48}
                      onSave={v => savePhase(row.phase_id, 'lot_count_projected', v)}
                      placeholder="—"
                    />
                  </td>

                  {/* Real count (read-only) */}
                  <td style={td({ textAlign: 'right' })}>
                    <span style={{ fontSize: 12, color: row.real_count > 0 ? '#374151' : '#d1d5db',
                                   display: 'block', padding: '1px 4px' }}>
                      {row.real_count || '—'}
                    </span>
                  </td>

                  {/* Sim count (read-only) */}
                  <td style={td({ textAlign: 'right' })}>
                    <span style={{ fontSize: 12, color: row.sim_count > 0 ? '#6b7280' : '#d1d5db',
                                   display: 'block', padding: '1px 4px' }}>
                      {row.sim_count || '—'}
                    </span>
                  </td>

                  {/* Dev date (projected) */}
                  <td style={tdGroup({ textAlign: 'right' })}>
                    <EditableCell
                      value={row.date_dev_projected} type="date" width={86}
                      display={fmtDate}
                      onSave={v => savePhase(row.phase_id, 'date_dev_projected', v)}
                      placeholder="—"
                    />
                  </td>

                  {/* Actual delivery date (lock) */}
                  <td style={td({ textAlign: 'right' })}>
                    <EditableCell
                      value={row.date_dev_actual} type="date" width={88}
                      display={fmtDate}
                      highlight={row.date_dev_actual ? 'lock' : null}
                      onSave={v => savePhase(row.phase_id, 'date_dev_actual', v)}
                      placeholder="not locked"
                    />
                  </td>

                  {/* Product split columns */}
                  {lotTypes.map((lt, idx) => (
                    <td key={lt.lot_type_id}
                        style={td({ textAlign: 'right', ...(idx === 0 ? { borderLeft: '2px solid #e9e9e9' } : {}) })}>
                      <EditableCell
                        value={row.product_splits[lt.lot_type_id] ?? null} width={46}
                        onSave={v => saveProductSplit(row.phase_id, lt.lot_type_id, v)}
                        placeholder="0"
                      />
                    </td>
                  ))}

                  {/* Builder split columns */}
                  {builders.map((b, idx) => (
                    <td key={b.builder_id}
                        style={td({ textAlign: 'right', ...(idx === 0 ? { borderLeft: '2px solid #e9e9e9' } : {}) })}>
                      <EditableCell
                        value={row.builder_splits[b.builder_id] ?? null} width={54}
                        onSave={v => saveBuilderSplit(row.phase_id, b.builder_id, v)}
                        placeholder="0"
                      />
                    </td>
                  ))}

                  {/* Builder sum badge */}
                  {builders.length > 0 && (
                    <td style={td({ textAlign: 'center', padding: '3px 8px' })}>
                      <BuilderSumBadge splits={row.builder_splits} builders={builders} />
                    </td>
                  )}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {rows.length > 0 && (
        <div style={{ marginTop: 8, fontSize: 11, color: '#9ca3af' }}>
          {rows.length} phase{rows.length !== 1 ? 's' : ''}
          {(filterComm || filterDev) && ` (filtered from ${testFilteredRows.length})`}
          {' · '}⚿ = delivery date locked
        </div>
      )}
    </div>
  )
}
