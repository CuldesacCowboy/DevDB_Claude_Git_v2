// setup/LotPillGroup.jsx
// Lot pill display, selection, and bulk-action panel.
// Includes: LOT_PILL constants, LotPill, MovableLotPill, AddPreLotsPanel, LotPillGroup.

import { useState } from 'react'
import { API_BASE } from '../../config'
import { formatLotNum, formatLotNumPadded, lotSeqStr } from './setupShared'
import { stripPrefix } from '../simulation/simShared'

export const LOT_PILL = {
  marks: { bg: '#eff6ff', text: '#1d4ed8', border: '#bfdbfe' },
  pre:   { bg: '#fffbeb', text: '#92400e', border: '#fde68a' },
  sim:   { bg: '#f3f4f6', text: '#9ca3af', border: '#e5e7eb' },
}

// Resolve pill style from lot data: orphaned real (no registry match) → pre/amber
function pillStyle(lot) {
  if (lot.lot_source === 'sim') return LOT_PILL.sim
  if (lot.lot_source === 'real' && lot.in_registry) return LOT_PILL.marks
  return LOT_PILL.pre
}

export function LotPill({ label, source }) {
  const s = LOT_PILL[source] ?? LOT_PILL.sim
  return (
    <span style={{
      display: 'inline-block',
      padding: '1px 7px', borderRadius: 10, fontSize: 11,
      background: s.bg, color: s.text,
      border: `1px solid ${s.border}`,
      whiteSpace: 'nowrap',
    }}>
      {label}
    </span>
  )
}

// Selectable lot pill — click to select/deselect, shift+click for range
function MovableLotPill({ lot, selected, onSelect, maxDigits = 1 }) {
  const s = lot.excluded
    ? { bg: '#f9fafb', text: '#9ca3af', border: '#e5e7eb' }
    : pillStyle(lot)
  const label = formatLotNumPadded(lot.lot_number, maxDigits, lot.dev_code ?? '') || `#${lot.lot_id}`
  return (
    <span
      onClick={onSelect}
      style={{
        display: 'inline-flex', alignItems: 'center',
        padding: '1px 7px', borderRadius: 10, fontSize: 11,
        fontFamily: 'monospace',
        background: selected ? s.border : s.bg,
        color: s.text,
        border: `1px solid ${selected ? s.text : s.border}`,
        outline: selected ? `2px solid ${s.border}` : 'none',
        outlineOffset: 1,
        whiteSpace: 'nowrap', cursor: 'pointer', userSelect: 'none',
        textDecoration: lot.excluded ? 'line-through' : 'none',
      }}>
      {label}
    </span>
  )
}

// ─── Add Pre-MARKS lots panel (2-step: count → review) ───────────────────────

function AddPreLotsPanel({ phaseId, ltId, onAdded }) {
  const [open, setOpen]       = useState(false)
  const [step, setStep]       = useState('count')
  const [count, setCount]     = useState(5)
  const [rows, setRows]       = useState([])
  const [prefix, setPrefix]   = useState('')
  const [startSeq, setStartSeq] = useState(1)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving]   = useState(false)
  const [error, setError]     = useState(null)

  const pre = LOT_PILL.pre

  function rebuildNums(r, p, s) {
    return r.map((row, i) => ({ ...row, lot_number: `${(p || '').toUpperCase()}${s + i}` }))
  }

  async function fetchSuggestions() {
    setLoading(true); setError(null)
    try {
      const res = await fetch(`${API_BASE}/bulk-lots/suggestions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phase_id: phaseId, requests: [{ lot_type_id: ltId, count }] }),
      })
      const data = await res.json()
      if (!res.ok) { setError(data.detail ?? 'Failed'); return }
      setPrefix(data.prefix); setStartSeq(data.next_seq)
      setRows(data.suggestions.map(r => ({ ...r, lot_number: formatLotNum(r.lot_number) || r.lot_number })))
      setStep('review')
    } catch { setError('Network error') }
    finally { setLoading(false) }
  }

  async function handleInsert() {
    setSaving(true); setError(null)
    try {
      const lots = rows.map(r => ({ lot_number: r.lot_number.trim(), lot_type_id: ltId, phase_id: phaseId }))
      const res = await fetch(`${API_BASE}/bulk-lots/insert`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lots }),
      })
      const data = await res.json()
      if (!res.ok) { setError(data.detail ?? 'Failed'); return }
      onAdded(data.inserted.map(l => ({ ...l, lot_source: 'pre', in_registry: false })))
      reset()
    } catch { setError('Network error') }
    finally { setSaving(false) }
  }

  function reset() { setOpen(false); setStep('count'); setCount(5); setRows([]); setError(null) }

  const INP = { fontSize: 11, padding: '2px 5px', borderRadius: 3, border: '1px solid #d1d5db' }
  const BTN = (extra = {}) => ({
    fontSize: 11, padding: '2px 8px', borderRadius: 3, cursor: 'pointer',
    border: '1px solid #d1d5db', background: '#fff', ...extra,
  })

  if (!open) return (
    <button onClick={() => setOpen(true)} style={{
      display: 'inline-flex', alignItems: 'center', gap: 3,
      padding: '1px 7px', borderRadius: 10, fontSize: 11,
      background: 'none', color: pre.text, border: `1px dashed ${pre.border}`, cursor: 'pointer',
    }}>+ Pre-MARKS</button>
  )

  if (step === 'count') return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 11, color: '#6b7280' }}>How many?</span>
        {[5, 10, 20, 50].map(n => (
          <button key={n} onClick={() => setCount(n)} style={BTN({
            background: count === n ? pre.bg : '#fff',
            borderColor: count === n ? pre.border : '#d1d5db',
            color: count === n ? pre.text : '#374151',
            fontWeight: count === n ? 600 : 400,
          })}>{n}</button>
        ))}
        <input type="number" min={1} value={count}
          onChange={e => setCount(Math.max(1, parseInt(e.target.value) || 1))}
          style={{ ...INP, width: 50 }} />
        <button onClick={fetchSuggestions} disabled={loading || count < 1}
          style={BTN({ background: pre.bg, color: pre.text, borderColor: pre.border })}>
          {loading ? '…' : 'Preview →'}
        </button>
        <button onClick={reset} style={BTN({ color: '#9ca3af' })}>✕</button>
      </div>
      {error && <span style={{ fontSize: 11, color: '#ef4444' }}>{error}</span>}
    </div>
  )

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 11, color: '#6b7280' }}>Prefix</span>
        <input value={prefix} onChange={e => {
          const p = e.target.value.toUpperCase()
          setPrefix(p); setRows(prev => rebuildNums(prev, p, startSeq))
        }} style={{ ...INP, width: 52 }} />
        <span style={{ fontSize: 11, color: '#6b7280' }}>Start #</span>
        <input type="number" min={1} value={startSeq} onChange={e => {
          const s = Math.max(1, parseInt(e.target.value) || 1)
          setStartSeq(s); setRows(prev => rebuildNums(prev, prefix, s))
        }} style={{ ...INP, width: 60 }} />
        <button onClick={handleInsert} disabled={saving}
          style={BTN({ background: '#f0fdf4', color: '#15803d', borderColor: '#86efac' })}>
          {saving ? '…' : `Add ${rows.length}`}
        </button>
        <button onClick={() => setStep('count')} style={BTN({ color: '#6b7280' })}>← Back</button>
        <button onClick={reset} style={BTN({ color: '#9ca3af' })}>✕</button>
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3 }}>
        {rows.map((r, i) => (
          <input key={i} value={r.lot_number}
            onChange={e => setRows(prev => prev.map((row, j) => j === i ? { ...row, lot_number: e.target.value } : row))}
            style={{
              width: 80, fontSize: 11, padding: '1px 5px', borderRadius: 10, textAlign: 'center',
              background: pre.bg, color: pre.text, border: `1px solid ${pre.border}`,
            }} />
        ))}
      </div>
      {error && <span style={{ fontSize: 11, color: '#ef4444' }}>{error}</span>}
    </div>
  )
}

// ─── LotPillGroup ─────────────────────────────────────────────────────────────

const GROUP_LABEL_COLOR = { marks: '#1d4ed8', pre: '#92400e', sim: '#9ca3af' }

export function LotPillGroup({ lots, targetPhases, onMoveLot, phaseId, ltId, onLotAdded, lotTypes, onLotsRemoved, onLotsUpdated, onRefresh, commName }) {
  const [selectedIds, setSelectedIds] = useState(new Set())
  const [lastClickedId, setLastClickedId] = useState(null)
  const [actionMode, setActionMode] = useState(null)  // null | 'move' | 'type' | 'delete' | 'exclude'
  const [bulkSaving, setBulkSaving] = useState(false)
  const [bulkError, setBulkError] = useState(null)
  const [excludedOpen, setExcludedOpen] = useState(false)

  const allLots = lots ?? []

  // Ordered selectable lots (non-sim, active first then excluded)
  const ordered = [
    ...allLots.filter(l => !l.excluded && l.lot_source === 'real' && l.in_registry),
    ...allLots.filter(l => !l.excluded && !(l.lot_source === 'real' && l.in_registry) && l.lot_source !== 'sim'),
    ...allLots.filter(l => l.excluded && l.lot_source !== 'sim'),
  ]

  function handlePillClick(lot, e) {
    const id = lot.lot_id
    if (e.shiftKey && lastClickedId !== null) {
      const ids = ordered.map(l => l.lot_id)
      const a = ids.indexOf(lastClickedId), b = ids.indexOf(id)
      if (a !== -1 && b !== -1) {
        const lo = Math.min(a, b), hi = Math.max(a, b)
        setSelectedIds(prev => { const n = new Set(prev); ids.slice(lo, hi + 1).forEach(i => n.add(i)); return n })
      }
    } else {
      setLastClickedId(id)
      setSelectedIds(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n })
    }
    setActionMode(null)
  }

  function selectAll() { setSelectedIds(new Set(ordered.map(l => l.lot_id))) }
  function deselectAll() { setSelectedIds(new Set()); setLastClickedId(null); setActionMode(null); setBulkError(null) }

  async function runBulk(ids, apiFn, onDone) {
    setBulkSaving(true); setBulkError(null)
    try {
      await Promise.all(ids.map(apiFn))
      await onDone()
    } catch { setBulkError('Operation failed') }
    finally { setBulkSaving(false) }
  }

  function adjustDelta(pid, lid, delta) {
    return fetch(`${API_BASE}/phases/${pid}/lot-type/${lid}/projected/delta`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projected_count: delta }),
    })
  }

  async function handleBulkMove(targetPhaseId) {
    const ids = [...selectedIds]; const N = ids.length
    await runBulk(ids, id => fetch(`${API_BASE}/lots/${id}/phase`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ target_phase_id: targetPhaseId, changed_by: 'setup' }),
    }), async () => {
      await Promise.all([adjustDelta(phaseId, ltId, -N), adjustDelta(targetPhaseId, ltId, N)])
      onLotsRemoved(ids); deselectAll()
    })
  }

  async function handleBulkChangeType(newLtId) {
    const ids = [...selectedIds]; const N = ids.length
    await runBulk(ids, id => fetch(`${API_BASE}/lots/${id}/lot-type`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ lot_type_id: newLtId, changed_by: 'setup' }),
    }), async () => {
      await Promise.all([adjustDelta(phaseId, ltId, -N), adjustDelta(phaseId, newLtId, N)])
      onLotsRemoved(ids); deselectAll(); onRefresh()
    })
  }

  async function handleBulkDelete() {
    const ids = [...selectedIds].filter(id => allLots.find(l => l.lot_id === id)?.lot_source === 'pre')
    if (!ids.length) return
    await runBulk(ids, id => fetch(`${API_BASE}/lots/${id}`, { method: 'DELETE' }),
      () => { onLotsRemoved(ids); deselectAll() })
  }

  async function handleBulkExclude(excluded) {
    const ids = [...selectedIds].filter(id => {
      const lot = allLots.find(l => l.lot_id === id)
      return lot && Boolean(lot.excluded) !== excluded
    })
    if (!ids.length) return
    await runBulk(ids, id => fetch(`${API_BASE}/lots/${id}/excluded`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ excluded }),
    }), async () => { onLotsUpdated(ids, { excluded }); deselectAll() })
  }

  async function handleBulkRelease() {
    const ids = [...selectedIds].filter(id => {
      const lot = allLots.find(l => l.lot_id === id)
      return lot && lot.lot_source === 'real' && !lot.excluded
    })
    if (!ids.length) return
    setBulkSaving(true); setBulkError(null)
    try {
      const res = await fetch(`${API_BASE}/lots/bulk-release`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lot_ids: ids }),
      })
      if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.detail ?? 'Release failed') }
      onLotsRemoved(ids); deselectAll()
    } catch (e) {
      setBulkError(e.message)
    } finally {
      setBulkSaving(false)
    }
  }

  const hasSelection = selectedIds.size > 0
  const hasPreSelected = [...selectedIds].some(id => allLots.find(l => l.lot_id === id)?.lot_source === 'pre')
  const deleteCount = [...selectedIds].filter(id => allLots.find(l => l.lot_id === id)?.lot_source === 'pre').length
  const hasNonExcludedSelected = [...selectedIds].some(id => { const l = allLots.find(l => l.lot_id === id); return l && !l.excluded })
  const hasExcludedSelected = [...selectedIds].some(id => { const l = allLots.find(l => l.lot_id === id); return l && l.excluded })
  const hasRealNonExcludedSelected = [...selectedIds].some(id => { const l = allLots.find(l => l.lot_id === id); return l && l.lot_source === 'real' && !l.excluded })

  const ABTN = (extra = {}) => ({
    fontSize: 11, padding: '1px 6px', borderRadius: 3, cursor: 'pointer',
    background: 'none', border: '1px solid #e5e7eb', color: '#6b7280', ...extra,
  })

  // Max digit count across all non-sim lot numbers → uniform pill width
  const digitLengths = allLots
    .filter(l => l.lot_number)
    .map(l => lotSeqStr(l.lot_number, l.dev_code ?? '').length)
  const maxDigits = digitLengths.length > 0 ? Math.max(...digitLengths) : 1

  const byLotNumber = (a, b) => (a.lot_number ?? '').localeCompare(b.lot_number ?? '', undefined, { numeric: true })

  const groups = [
    { key: 'marks', label: 'Active',  items: allLots.filter(l => !l.excluded && l.lot_source === 'real' && l.in_registry).sort(byLotNumber) },
    { key: 'pre',   label: 'Pending', items: allLots.filter(l => !l.excluded && (l.lot_source === 'pre' || (l.lot_source === 'real' && !l.in_registry))).sort(byLotNumber) },
    { key: 'sim',   label: 'Sim',     items: allLots.filter(l => !l.excluded && l.lot_source === 'sim').sort(byLotNumber) },
  ].filter(g => g.items.length > 0)

  const excludedLots = allLots.filter(l => l.excluded && l.lot_source !== 'sim').sort(byLotNumber)
  const activeCount = ordered.length - excludedLots.length

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>

      {/* ── Action bar ── */}
      {(ordered.length > 0 || hasSelection) && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap', paddingBottom: 4, borderBottom: '1px solid #f3f4f6' }}>
          <span style={{ fontSize: 11, color: '#9ca3af' }}>
            {hasSelection ? `${selectedIds.size} selected` : `${activeCount} lot${activeCount !== 1 ? 's' : ''}`}
          </span>
          <button onClick={selectAll}  style={ABTN()}>All</button>
          <button onClick={deselectAll} style={ABTN()}>None</button>
          {hasSelection && <>
            <span style={{ color: '#e5e7eb' }}>|</span>

            {/* Move */}
            {actionMode !== 'move' ? (
              <button onClick={() => setActionMode('move')} disabled={bulkSaving} style={ABTN({ color: '#374151' })}>→ Move</button>
            ) : (
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}>
                <select defaultValue="" onChange={e => e.target.value && handleBulkMove(parseInt(e.target.value))}
                  disabled={bulkSaving}
                  style={{ fontSize: 11, padding: '1px 3px', borderRadius: 3, border: '1px solid #d1d5db' }}>
                  <option value="">Phase…</option>
                  {targetPhases.map(p => <option key={p.phase_id} value={p.phase_id}>{stripPrefix(p.instrument_name, commName)} · {stripPrefix(p.phase_name, commName)}</option>)}
                </select>
                <button onClick={() => setActionMode(null)} style={ABTN()}>✕</button>
              </span>
            )}

            {/* Change type */}
            {actionMode !== 'type' ? (
              <button onClick={() => setActionMode('type')} disabled={bulkSaving} style={ABTN({ color: '#374151' })}>⟳ Type</button>
            ) : (
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}>
                <select defaultValue="" onChange={e => e.target.value && handleBulkChangeType(parseInt(e.target.value))}
                  disabled={bulkSaving}
                  style={{ fontSize: 11, padding: '1px 3px', borderRadius: 3, border: '1px solid #d1d5db' }}>
                  <option value="">Type…</option>
                  {(lotTypes ?? []).filter(lt => lt.lot_type_id !== ltId).map(lt => (
                    <option key={lt.lot_type_id} value={lt.lot_type_id}>{lt.lot_type_short}</option>
                  ))}
                </select>
                <button onClick={() => setActionMode(null)} style={ABTN()}>✕</button>
              </span>
            )}

            {/* Delete */}
            {actionMode !== 'delete' ? (
              <button onClick={() => hasPreSelected && setActionMode('delete')}
                disabled={!hasPreSelected || bulkSaving}
                title={!hasPreSelected ? 'Only Pre-MARKS lots can be deleted' : undefined}
                style={ABTN({ color: hasPreSelected ? '#dc2626' : '#d1d5db', borderColor: hasPreSelected ? '#fca5a5' : '#e5e7eb' })}>
                × Delete
              </button>
            ) : (
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                <span style={{ fontSize: 11, color: '#dc2626' }}>Delete {deleteCount} lot{deleteCount !== 1 ? 's' : ''}?</span>
                <button onClick={handleBulkDelete} disabled={bulkSaving}
                  style={ABTN({ background: '#fef2f2', color: '#dc2626', borderColor: '#fca5a5' })}>
                  {bulkSaving ? '…' : 'Confirm'}
                </button>
                <button onClick={() => setActionMode(null)} style={ABTN()}>Cancel</button>
              </span>
            )}

            <span style={{ color: '#e5e7eb' }}>|</span>

            {/* Exclude / Un-exclude */}
            {hasNonExcludedSelected && (
              <button onClick={() => handleBulkExclude(true)} disabled={bulkSaving}
                style={ABTN({ color: '#6b7280' })}>
                Exclude
              </button>
            )}
            {hasExcludedSelected && (
              <button onClick={() => handleBulkExclude(false)} disabled={bulkSaving}
                style={ABTN({ color: '#2563eb', borderColor: '#bfdbfe' })}>
                Un-exclude
              </button>
            )}

            {/* Release to MARKS bank — only for real (active) lots */}
            {actionMode !== 'release' ? (
              hasRealNonExcludedSelected && (
                <button onClick={() => setActionMode('release')} disabled={bulkSaving}
                  title="Remove from this community — lots return to the MARKS unassigned bank"
                  style={ABTN({ color: '#b45309', borderColor: '#fcd34d' })}>
                  ↑ Release
                </button>
              )
            ) : (
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                <span style={{ fontSize: 11, color: '#b45309' }}>Release to MARKS bank?</span>
                <button onClick={handleBulkRelease} disabled={bulkSaving}
                  style={ABTN({ background: '#fffbeb', color: '#b45309', borderColor: '#fcd34d' })}>
                  {bulkSaving ? '…' : 'Confirm'}
                </button>
                <button onClick={() => setActionMode(null)} style={ABTN()}>Cancel</button>
              </span>
            )}

            {bulkError && <span style={{ fontSize: 11, color: '#ef4444' }}>{bulkError}</span>}
          </>}
        </div>
      )}

      {/* ── Pill groups ── */}
      {groups.map(g => (
        <div key={g.key} style={{ display: 'flex', alignItems: 'flex-start', gap: 6 }}>
          <span style={{
            fontSize: 10, color: GROUP_LABEL_COLOR[g.key] ?? '#9ca3af',
            width: 70, paddingTop: 3, textAlign: 'right', flexShrink: 0,
            fontWeight: g.key !== 'sim' ? 600 : 400,
          }}>{g.label}</span>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3 }}>
            {g.items.map(l =>
              l.lot_source === 'sim' ? (
                <LotPill key={l.lot_id} label="sim" source="sim" />
              ) : (
                <MovableLotPill
                  key={l.lot_id}
                  lot={l}
                  maxDigits={maxDigits}
                  selected={selectedIds.has(l.lot_id)}
                  onSelect={e => handlePillClick(l, e)}
                />
              )
            )}
          </div>
        </div>
      ))}

      {/* ── Excluded section ── */}
      {excludedLots.length > 0 && (
        <div>
          <button
            onClick={() => setExcludedOpen(o => !o)}
            style={{
              display: 'flex', alignItems: 'center', gap: 4,
              background: 'none', border: 'none', cursor: 'pointer', padding: '2px 0',
            }}>
            <span style={{ width: 70, flexShrink: 0 }} />
            <span style={{
              fontSize: 10, color: '#9ca3af', display: 'flex', alignItems: 'center', gap: 3,
            }}>
              <span style={{
                display: 'inline-block', fontSize: 8,
                transition: 'transform 0.15s',
                transform: excludedOpen ? 'rotate(90deg)' : 'rotate(0deg)',
              }}>▶</span>
              Excluded ({excludedLots.length})
            </span>
          </button>
          {excludedOpen && (
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 6, marginTop: 2 }}>
              <span style={{ width: 70, flexShrink: 0 }} />
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3 }}>
                {excludedLots.map(l => (
                  <MovableLotPill
                    key={l.lot_id}
                    lot={l}
                    maxDigits={maxDigits}
                    selected={selectedIds.has(l.lot_id)}
                    onSelect={e => handlePillClick(l, e)}
                  />
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── Add Pre-MARKS ── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 2 }}>
        <span style={{ width: 70, flexShrink: 0 }} />
        <AddPreLotsPanel phaseId={phaseId} ltId={ltId} onAdded={onLotAdded} />
      </div>
    </div>
  )
}
