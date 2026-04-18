import { useState, useEffect, useCallback, useRef } from 'react'
import { API_BASE } from '../config'
import {
  PANEL_BORDER, PANEL_HEADER_BG,
  TEXT_MUTED, TEXT_PRIMARY,
  BTN, greenEditorStyle,
} from '../utils/designTokens'

// ── Agreement status ───────────────────────────────────────────────
const AGREEMENT_STATUS_OPTIONS = ['active', 'closed', 'expired']
const AGREEMENT_STATUS_STYLE = {
  active:  BTN.success,
  closed:  { color: '#6b7280', bg: '#f3f4f6', border: '#d1d5db' },
  expired: BTN.warning,
}

function cpLabel(cp) {
  if (!cp) return '—'
  const req = cp.lots_required_cumulative ?? cp.checkpoint_number ?? ''
  const dt = cp.checkpoint_date ?? ''
  if (req && dt) return `${req} by ${dt}`
  if (dt) return dt
  return `CP ${cp.checkpoint_number ?? ''}`
}


// ── Inline editable date ───────────────────────────────────────────
function EditDate({ value, onSave }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value ?? '')
  const ref = useRef()

  useEffect(() => { if (editing && ref.current) ref.current.focus() }, [editing])

  function commit() {
    setEditing(false)
    const v = draft?.trim() ?? ''
    if (v !== (value ?? '')) onSave(v || null)
  }

  if (editing) {
    return (
      <input
        ref={ref}
        type="date"
        value={draft ?? ''}
        onChange={e => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={e => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') setEditing(false) }}
        style={{ fontSize: 12, padding: '1px 4px', borderRadius: 3, width: 128, ...greenEditorStyle }}
      />
    )
  }

  return (
    <span
      onClick={() => { setDraft(value ?? ''); setEditing(true) }}
      title="Click to edit"
      style={{
        cursor: 'text', fontSize: 12,
        borderBottom: value ? '1px dashed #d1d5db' : '1px dashed #e5e7eb',
        color: value ? TEXT_PRIMARY : TEXT_MUTED,
      }}
    >
      {value || '—'}
    </span>
  )
}

// ── Inline editable number ─────────────────────────────────────────
function EditNumber({ value, onSave, min, nullable }) {
  const nullVal = nullable && value == null
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(nullVal ? '' : String(value ?? 0))
  const [rejected, setRejected] = useState(false)
  const ref = useRef()

  useEffect(() => { if (editing && ref.current) ref.current.focus() }, [editing])

  function commit() {
    if (nullable && draft.trim() === '') {
      setEditing(false)
      if (value != null) onSave(null)
      return
    }
    const n = parseInt(draft, 10)
    if (!isNaN(n) && n !== value) {
      if (min != null && n < min) {
        // Flash red then revert — user needs to know the value was rejected
        setRejected(true)
        setTimeout(() => { setRejected(false); setEditing(false) }, 600)
        return
      }
      onSave(n)
    }
    setEditing(false)
  }

  if (editing) {
    return (
      <input
        ref={ref}
        type="number"
        min={min}
        value={draft}
        onChange={e => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={e => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') setEditing(false) }}
        style={{
          fontSize: 12, padding: '1px 4px', borderRadius: 3, width: 60,
          ...(rejected ? { border: '1.5px solid #dc2626', background: '#fef2f2', color: '#dc2626' } : greenEditorStyle),
        }}
      />
    )
  }

  return (
    <span
      onClick={() => { setDraft(nullVal ? '' : String(value ?? 0)); setEditing(true) }}
      title={min != null ? `Click to edit (minimum ${min})` : 'Click to edit'}
      style={{ cursor: 'text', fontSize: 12, borderBottom: '1px dashed #d1d5db', fontVariantNumeric: 'tabular-nums' }}
    >
      {nullVal ? <span style={{ color: '#9ca3af' }}>—</span> : (value ?? 0)}
    </span>
  )
}

// ── Inline editable text ───────────────────────────────────────────
function EditText({ value, onSave, style }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value ?? '')
  const ref = useRef()

  useEffect(() => { if (editing && ref.current) ref.current.focus() }, [editing])

  function commit() {
    setEditing(false)
    if ((draft ?? '') !== (value ?? '')) onSave(draft)
  }

  if (editing) {
    return (
      <input
        ref={ref}
        value={draft ?? ''}
        onChange={e => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={e => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') setEditing(false) }}
        style={{ fontSize: 13, padding: '2px 5px', borderRadius: 3, width: 200, ...greenEditorStyle, ...style }}
      />
    )
  }

  return (
    <span
      onClick={() => { setDraft(value ?? ''); setEditing(true) }}
      title="Click to edit"
      style={{ cursor: 'text', borderBottom: '1px dashed #d1d5db', fontSize: 13, ...style }}
    >
      {value || <span style={{ color: TEXT_MUTED }}>—</span>}
    </span>
  )
}

// ── Small button ───────────────────────────────────────────────────
function Btn({ variant = 'default', onClick, disabled, children, style }) {
  const v = BTN[variant] || BTN.default
  return (
    <button onClick={onClick} disabled={disabled} style={{
      fontSize: 12, padding: '3px 10px', borderRadius: 4,
      border: `1px solid ${v.border}`,
      background: disabled ? '#f3f4f6' : v.bg,
      color: disabled ? '#9ca3af' : v.color,
      cursor: disabled ? 'default' : 'pointer',
      fontWeight: 500, ...style,
    }}>
      {children}
    </button>
  )
}

// ── Table style constants ──────────────────────────────────────────
const TH = {
  textAlign: 'left', padding: '3px 8px', fontSize: 11,
  fontWeight: 600, color: TEXT_MUTED, borderBottom: `1px solid ${PANEL_BORDER}`,
}
const TD = { padding: '6px 8px', verticalAlign: 'middle' }
const BADGE = { display: 'inline-block', fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 10 }

// ── Lot pill utilities ─────────────────────────────────────────────
function pillLotNum(lot_number) {
  const m = (lot_number || '').match(/^([A-Za-z]+)(\d+)$/)
  if (!m) return lot_number || ''
  // Strip leading zeros then right-align number in 4 chars: "ST   1", "ST  11", "ST 111"
  const num = String(parseInt(m[2], 10))
  return m[1] + num.padStart(4, ' ')
}

function bldgType(unitCount) {
  if (!unitCount) return null
  const MAP = { 1: 'SF', 2: 'Duplex', 3: 'Triplex', 4: 'Quad', 6: 'Sixplex', 8: 'Octoplex' }
  return MAP[unitCount] || `${unitCount}-unit`
}

// ── Three-tier date resolution ────────────────────────────────────
// Hierarchy: marks (actual) > override (user-locked projected) > sim (engine projected)
// Returns { date, source: 'marks' | 'override' | 'sim' | null }
function resolveDate(lot, type) {
  if (type === 'hc') {
    if (lot.hc_marks_date)                         return { date: lot.hc_marks_date,     source: 'marks'    }
    if (lot.hc_is_locked && lot.hc_projected_date) return { date: lot.hc_projected_date, source: 'override' }
    if (lot.hc_projected_date)                     return { date: lot.hc_projected_date, source: 'sim'      }
    return { date: null, source: null }
  }
  if (lot.bldr_marks_date)                           return { date: lot.bldr_marks_date,     source: 'marks'    }
  if (lot.bldr_is_locked && lot.bldr_projected_date) return { date: lot.bldr_projected_date, source: 'override' }
  if (lot.bldr_projected_date)                       return { date: lot.bldr_projected_date, source: 'sim'      }
  return { date: null, source: null }
}

// Render a resolved date with source-specific styling.
// marks = gray italic (read-only) | override = teal bold (user set) | sim = slate dashed (projected)
function ResolvedDate({ resolved, onClick }) {
  const { date, source } = resolved
  if (source === 'marks') return (
    <span style={{ fontSize: 11, color: '#9ca3af', fontStyle: 'italic' }}
          title="MARKS — actual date from source system">{date}</span>
  )
  if (source === 'override') return (
    <span onClick={onClick}
          style={{ fontSize: 11, color: '#0d9488', fontWeight: 600, cursor: 'pointer', borderBottom: '1px solid #0d9488' }}
          title="User override — click to edit or clear">{date}</span>
  )
  if (source === 'sim') return (
    <span onClick={onClick}
          style={{ fontSize: 11, color: '#94a3b8', cursor: 'pointer', borderBottom: '1px dashed #94a3b8' }}
          title="Sim projection — click to set override">{date}</span>
  )
  return (
    <span onClick={onClick}
          style={{ fontSize: 11, color: '#d1d5db', cursor: 'pointer' }}
          title="Click to set">—</span>
  )
}

function fulfillmentInfo(lot) {
  const hc   = resolveDate(lot, 'hc')
  const bldr = resolveDate(lot, 'bldr')
  if (!hc.date && !bldr.date) return null
  if (hc.date && bldr.date)
    return hc.date <= bldr.date
      ? { date: hc.date,   label: 'HC',   source: hc.source   }
      : { date: bldr.date, label: 'BLDR', source: bldr.source }
  return hc.date
    ? { date: hc.date,   label: 'HC',   source: hc.source   }
    : { date: bldr.date, label: 'BLDR', source: bldr.source }
}

// ── TDA lot date editor (inline) ───────────────────────────────────
function TdaDateEditor({ lot, field, onApplied, onClose }) {
  const label      = field === 'date_td_hold' ? 'HC' : 'BLDR'
  const projKey    = field === 'date_td_hold' ? 'hc_projected_date' : 'bldr_projected_date'
  const resolved   = resolveDate(lot, field === 'date_td_hold' ? 'hc' : 'bldr')
  const isOverride = resolved.source === 'override'
  const isSim      = resolved.source === 'sim'
  const projDate   = resolved.source !== 'marks' ? resolved.date : null
  const [draft, setDraft]       = useState(projDate || '')
  const [applying, setApplying] = useState(false)
  const inputRef = useRef()

  useEffect(() => { if (inputRef.current) inputRef.current.focus() }, [])

  async function apply(val) {
    setApplying(true)
    await fetch(`${API_BASE}/tda-lots/${lot.lot_id}/dates`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ [projKey]: val }),
    })
    setApplying(false)
    onApplied()
  }

  const headerLabel = isOverride ? `Edit ${label} Override` : `Set ${label} Override`
  const bg     = isOverride ? '#f0fdf4' : '#f0f9ff'
  const border = isOverride ? '#bbf7d0' : '#bae6fd'
  const color  = isOverride ? '#15803d' : '#0369a1'

  return (
    <div style={{ padding: '8px 12px', background: bg, border: `1px solid ${border}`, borderRadius: 5 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
        <span style={{ fontSize: 11, fontWeight: 600, color }}>
          {headerLabel} — <span style={{ fontFamily: 'monospace', whiteSpace: 'pre' }}>{pillLotNum(lot.lot_number)}</span>
        </span>
        <button onClick={onClose} style={{ fontSize: 13, color: TEXT_MUTED, background: 'none', border: 'none', cursor: 'pointer' }}>×</button>
      </div>
      {isSim && projDate && (
        <div style={{ fontSize: 10, color: '#94a3b8', marginBottom: 5 }}>
          Sim projection: <span style={{ fontStyle: 'italic' }}>{projDate}</span> — setting a date locks it as your override.
        </div>
      )}
      <div style={{ marginBottom: 6 }}>
        <span style={{ fontSize: 10, color: TEXT_MUTED, display: 'block', marginBottom: 2 }}>
          {isOverride ? 'Update date' : 'Set date'}
        </span>
        <input
          ref={inputRef}
          type="date"
          value={draft}
          onChange={e => setDraft(e.target.value)}
          style={{ fontSize: 11, padding: '2px 5px', borderRadius: 3, border: `1px solid ${isOverride ? '#86efac' : '#7dd3fc'}`, ...greenEditorStyle }}
        />
      </div>
      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
        <Btn variant={isOverride ? 'success' : 'primary'} onClick={() => apply(draft || null)} disabled={applying || !draft} style={{ padding: '2px 8px', fontSize: 11 }}>
          {applying ? '…' : isOverride ? 'Update Override' : 'Set Override'}
        </Btn>
        <Btn onClick={onClose} style={{ padding: '2px 8px', fontSize: 11 }}>Cancel</Btn>
        {(isOverride || isSim) && projDate && (
          <Btn variant="danger" onClick={() => apply(null)} disabled={applying} style={{ padding: '2px 8px', fontSize: 11 }}>Clear</Btn>
        )}
      </div>
    </div>
  )
}

// Fixed column widths for cross-checkpoint alignment
const SLOT_COLS = { num: 28, lot: 80, type: 42, bldg: 44, bldgType: 66, hc: 92, bldr: 92, fulfill: 112 }

// ── Checkpoint slot table ──────────────────────────────────────────
function CheckpointSlotTable({ checkpoint, lots, perRequired, poolLots, onAssignSlot, marksplan, simplan, buildingUnitCounts, onPatchLotDate, onRemoveLots }) {
  const [sortCol, setSortCol]           = useState('fulfill')
  const [sortDir, setSortDir]           = useState(1)
  const [pickerSlot, setPickerSlot]     = useState(null)
  const [editingDate, setEditingDate]   = useState(null) // { lot_id, field, lot }
  const [selected, setSelected]         = useState(new Set())
  const lastClickedRef                  = useRef(null)
  const [bulkMode, setBulkMode]         = useState(null)  // 'hc' | 'bldr'
  const [bulkDate, setBulkDate]         = useState('')
  const [bulkApplying, setBulkApplying] = useState(false)
  const [confirmRemove, setConfirmRemove] = useState(false)
  const [overflowOpen, setOverflowOpen] = useState(false)

  const STD_H = {
    padding: '3px 6px', fontSize: 10, fontWeight: 600,
    background: '#f1f5f9', borderBottom: `1px solid ${PANEL_BORDER}`,
    textAlign: 'left', userSelect: 'none',
  }
  const STD_D = { padding: '4px 6px', fontSize: 11, verticalAlign: 'middle' }

  function toggleSort(col) {
    if (sortCol === col) setSortDir(d => -d)
    else { setSortCol(col); setSortDir(1) }
  }

  function sortKey(lot) {
    if (sortCol === 'fulfill') { const f = fulfillmentInfo(lot); return f ? f.date : '9999-99-99' }
    if (sortCol === 'lot')      return pillLotNum(lot.lot_number)
    if (sortCol === 'type')     return lot.lot_type_short || ''
    if (sortCol === 'bldg')     return lot.building_name || ''
    if (sortCol === 'bldgType') {
      const uc = lot.building_group_id != null ? ((buildingUnitCounts || {})[lot.building_group_id] ?? null) : null
      return bldgType(uc) || ''
    }
    if (sortCol === 'hc')   return resolveDate(lot, 'hc').date   || '9999-99-99'
    if (sortCol === 'bldr') return resolveDate(lot, 'bldr').date || '9999-99-99'
    return ''
  }

  const sortedLots   = [...lots].sort((a, b) => { const ka = sortKey(a), kb = sortKey(b); return sortDir * (ka < kb ? -1 : ka > kb ? 1 : 0) })
  const satisfyLots  = sortedLots.slice(0, Math.max(perRequired, 0))
  const overflowLots = sortedLots.slice(Math.max(perRequired, 0))
  const openSlotCount = Math.max(0, perRequired - lots.length)
  const nSel = selected.size

  function handleNumClick(lotId, e) {
    e.stopPropagation()
    const idx = sortedLots.findIndex(l => l.lot_id === lotId)
    if (e.shiftKey && lastClickedRef.current !== null) {
      const lo = Math.min(lastClickedRef.current, idx), hi = Math.max(lastClickedRef.current, idx)
      setSelected(prev => { const n = new Set(prev); sortedLots.slice(lo, hi + 1).forEach(l => n.add(l.lot_id)); return n })
    } else {
      setSelected(prev => { const n = new Set(prev); n.has(lotId) ? n.delete(lotId) : n.add(lotId); return n })
      lastClickedRef.current = idx
    }
  }

  async function applyBulk(field, val) {
    setBulkApplying(true)
    const projKey = field === 'hc' ? 'hc_projected_date' : 'bldr_projected_date'
    await Promise.all([...selected].map(lotId =>
      fetch(`${API_BASE}/tda-lots/${lotId}/dates`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ [projKey]: val }),
      })
    ))
    setBulkApplying(false); setBulkMode(null); setBulkDate('')
    setSelected(new Set()); lastClickedRef.current = null
    onPatchLotDate && onPatchLotDate()
  }

  async function handleBulkRemove() {
    if (!onRemoveLots || !nSel) return
    setBulkApplying(true)
    await onRemoveLots([...selected])
    setBulkApplying(false); setSelected(new Set()); lastClickedRef.current = null; setBulkMode(null)
  }

  function sTh(col, label) {
    const active = sortCol === col
    return (
      <th onClick={() => toggleSort(col)} style={{ ...STD_H, cursor: 'pointer', width: SLOT_COLS[col], color: active ? '#2563eb' : TEXT_MUTED }}>
        {label}{active ? (sortDir > 0 ? ' ▲' : ' ▼') : ''}
      </th>
    )
  }

  // Render a filled lot row, returning an array of <tr> elements
  function renderLotRow(lot, displayIdx, isOverflow) {
    const isSel       = selected.has(lot.lot_id)
    const hcResolved  = resolveDate(lot, 'hc')
    const bldrResolved = resolveDate(lot, 'bldr')
    const fulfill     = fulfillmentInfo(lot)
    const unitCount   = lot.building_group_id != null ? ((buildingUnitCounts || {})[lot.building_group_id] ?? null) : null
    const bType       = bldgType(unitCount)
    const isEditHc    = editingDate?.lot_id === lot.lot_id && editingDate?.field === 'date_td_hold'
    const isEditBldr  = editingDate?.lot_id === lot.lot_id && editingDate?.field === 'date_td'
    const anyEdit     = isEditHc || isEditBldr
    const rowBg       = anyEdit ? '#e0f2fe' : isSel ? '#dbeafe' : (isOverflow ? '#fefce8' : '#fff')

    const rows = [
      <tr key={lot.lot_id} style={{ borderTop: `1px solid ${PANEL_BORDER}`, background: rowBg }}>
        <td
          onClick={e => handleNumClick(lot.lot_id, e)}
          title="Click to select · Shift+click for range"
          style={{ ...STD_D, textAlign: 'center', cursor: 'pointer', userSelect: 'none', color: isSel ? '#2563eb' : TEXT_MUTED, fontWeight: isSel ? 700 : 400 }}
        >
          {isSel ? '✓' : displayIdx + 1}
        </td>
        <td style={{ ...STD_D }}>
          <div
            onClick={e => handleNumClick(lot.lot_id, e)}
            title="Click to select · Shift+click for range"
            style={{
              fontFamily: 'monospace', whiteSpace: 'pre',
              padding: '2px 8px', borderRadius: 5, fontSize: 11,
              cursor: 'pointer', userSelect: 'none', display: 'inline-block',
              border: `1.5px solid ${isSel ? '#2563eb' : '#d1d5db'}`,
              background: isSel ? '#eff6ff' : '#fff',
              color: isSel ? '#1d4ed8' : TEXT_PRIMARY,
              fontWeight: isSel ? 700 : 400,
            }}
          >
            {pillLotNum(lot.lot_number)}
          </div>
        </td>
        <td style={{ ...STD_D, color: TEXT_MUTED, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{lot.lot_type_short || '—'}</td>
        <td style={{ ...STD_D, color: TEXT_MUTED, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {lot.building_name ? lot.building_name.replace('Building ', 'B') : '—'}
        </td>
        <td style={{ ...STD_D, color: TEXT_MUTED }}>{bType || <span style={{ color: '#e5e7eb' }}>—</span>}</td>
        <td style={STD_D}>
          <ResolvedDate
            resolved={hcResolved}
            onClick={hcResolved.source !== 'marks' ? () => setEditingDate(isEditHc ? null : { lot_id: lot.lot_id, field: 'date_td_hold', lot }) : undefined}
          />
        </td>
        <td style={STD_D}>
          <ResolvedDate
            resolved={bldrResolved}
            onClick={bldrResolved.source !== 'marks' ? () => setEditingDate(isEditBldr ? null : { lot_id: lot.lot_id, field: 'date_td', lot }) : undefined}
          />
        </td>
        <td style={{ ...STD_D, fontVariantNumeric: 'tabular-nums' }}>
          {fulfill ? (() => {
            const cpDate = checkpoint.checkpoint_date
            const late   = cpDate && fulfill.date > cpDate
            return (
              <span title={late ? `Fulfillment date ${fulfill.date} is after checkpoint ${cpDate} — this lot does not satisfy this checkpoint` : undefined}>
                <span style={{ color: late ? '#d97706' : TEXT_PRIMARY }}>{fulfill.date}</span>
                {' '}
                <span style={{ fontSize: 9, color: late ? '#d97706' : TEXT_MUTED }}>({fulfill.label})</span>
                {late && <span style={{ fontSize: 9, color: '#d97706', marginLeft: 2 }}>⚠</span>}
              </span>
            )
          })() : (
            <span style={{ color: '#e5e7eb' }}>—</span>
          )}
        </td>
      </tr>,
    ]
    if (anyEdit) {
      rows.push(
        <tr key={`edit_${lot.lot_id}`} style={{ background: '#f0f9ff', borderTop: '1px solid #bae6fd' }}>
          <td colSpan={8} style={{ padding: '6px 10px' }}>
            <TdaDateEditor
              lot={editingDate.lot}
              field={editingDate.field}
              onApplied={() => { setEditingDate(null); onPatchLotDate && onPatchLotDate() }}
              onClose={() => setEditingDate(null)}
            />
          </td>
        </tr>
      )
    }
    return rows
  }

  const totalSlots = satisfyLots.length + openSlotCount
  if (totalSlots === 0 && overflowLots.length === 0) {
    return (
      <div style={{ padding: '6px 32px', fontSize: 11, color: TEXT_MUTED, fontStyle: 'italic', background: '#f8fafc', borderTop: `1px solid ${PANEL_BORDER}`, borderBottom: `1px solid ${PANEL_BORDER}` }}>
        No slots for this checkpoint.
      </div>
    )
  }

  const colGroup = (
    <colgroup>
      <col style={{ width: SLOT_COLS.num }} />
      <col style={{ width: SLOT_COLS.lot }} />
      <col style={{ width: SLOT_COLS.type }} />
      <col style={{ width: SLOT_COLS.bldg }} />
      <col style={{ width: SLOT_COLS.bldgType }} />
      <col style={{ width: SLOT_COLS.hc }} />
      <col style={{ width: SLOT_COLS.bldr }} />
      <col />
    </colgroup>
  )

  return (
    <div style={{ margin: '0 0 4px', background: '#f8fafc', borderTop: `1px solid ${PANEL_BORDER}`, borderBottom: `1px solid ${PANEL_BORDER}` }}>
      {/* Always-visible All / None + selection hint */}
      {sortedLots.length > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 8px', background: '#f1f5f9', borderBottom: `1px solid ${PANEL_BORDER}` }}>
          <button
            onClick={() => { setSelected(new Set(sortedLots.map(l => l.lot_id))); lastClickedRef.current = null }}
            style={{ fontSize: 10, color: '#2563eb', background: 'none', border: 'none', cursor: 'pointer', padding: 0, fontWeight: 600 }}
          >All</button>
          <button
            onClick={() => { setSelected(new Set()); lastClickedRef.current = null; setBulkMode(null) }}
            style={{ fontSize: 10, color: '#2563eb', background: 'none', border: 'none', cursor: 'pointer', padding: 0, fontWeight: 600 }}
          >None</button>
          <span style={{ width: 1, height: 10, background: '#cbd5e1', display: 'inline-block' }} />
          {nSel > 0
            ? <span style={{ fontSize: 10, fontWeight: 600, color: '#1d4ed8' }}>{nSel} of {sortedLots.length} selected</span>
            : <span style={{ fontSize: 10, color: TEXT_MUTED, fontStyle: 'italic' }}>Click pill to select · Shift+click for range</span>
          }
        </div>
      )}
      {/* Selection action bar */}
      {nSel > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 6, padding: '5px 8px', background: '#eff6ff', borderBottom: '1px solid #bfdbfe' }}>
          <span style={{ fontSize: 11, fontWeight: 600, color: '#1d4ed8' }}>{nSel} selected</span>
          <button onClick={() => { setSelected(new Set(sortedLots.map(l => l.lot_id))); lastClickedRef.current = null }}
            style={{ fontSize: 10, color: '#2563eb', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>All</button>
          <button onClick={() => { setSelected(new Set()); lastClickedRef.current = null; setBulkMode(null) }}
            style={{ fontSize: 10, color: '#2563eb', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>None</button>
          <span style={{ width: 1, height: 12, background: '#bfdbfe', display: 'inline-block' }} />
          <Btn onClick={() => { setBulkMode(bulkMode === 'hc' ? null : 'hc'); setBulkDate('') }}
            style={{ padding: '1px 6px', fontSize: 10, background: bulkMode === 'hc' ? '#bfdbfe' : undefined }}>Set HC</Btn>
          <Btn onClick={() => { setBulkMode(bulkMode === 'bldr' ? null : 'bldr'); setBulkDate('') }}
            style={{ padding: '1px 6px', fontSize: 10, background: bulkMode === 'bldr' ? '#bfdbfe' : undefined }}>Set BLDR</Btn>
          <Btn onClick={() => applyBulk('hc', null)} disabled={bulkApplying} style={{ padding: '1px 6px', fontSize: 10 }}>Clear HC</Btn>
          <Btn onClick={() => applyBulk('bldr', null)} disabled={bulkApplying} style={{ padding: '1px 6px', fontSize: 10 }}>Clear BLDR</Btn>
          {onRemoveLots && !confirmRemove && (
            <Btn variant="danger" onClick={() => setConfirmRemove(true)} disabled={bulkApplying} style={{ padding: '1px 6px', fontSize: 10, marginLeft: 'auto' }}>Remove from TDA</Btn>
          )}
          {onRemoveLots && confirmRemove && (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, marginLeft: 'auto' }}>
              <span style={{ fontSize: 10, color: '#dc2626' }}>Remove {nSel} lot{nSel > 1 ? 's' : ''} from TDA?</span>
              <Btn variant="danger" onClick={() => { setConfirmRemove(false); handleBulkRemove() }} disabled={bulkApplying} style={{ padding: '1px 6px', fontSize: 10 }}>Yes</Btn>
              <Btn onClick={() => setConfirmRemove(false)} style={{ padding: '1px 6px', fontSize: 10 }}>No</Btn>
            </span>
          )}
        </div>
      )}

      {/* Bulk date input form */}
      {bulkMode && nSel > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '5px 8px', background: '#f0f9ff', borderBottom: '1px solid #bae6fd' }}>
          <span style={{ fontSize: 11, color: '#0369a1', fontWeight: 600 }}>
            Set {bulkMode === 'hc' ? 'HC' : 'BLDR'} for {nSel} lot{nSel > 1 ? 's' : ''}:
          </span>
          <input
            autoFocus type="date" value={bulkDate} onChange={e => setBulkDate(e.target.value)}
            style={{ fontSize: 11, padding: '2px 5px', borderRadius: 3, border: '1px solid #7dd3fc', ...greenEditorStyle }}
          />
          <Btn variant="primary" onClick={() => applyBulk(bulkMode, bulkDate || null)} disabled={!bulkDate || bulkApplying} style={{ padding: '2px 8px', fontSize: 11 }}>
            {bulkApplying ? '…' : 'Apply'}
          </Btn>
          <Btn onClick={() => { setBulkMode(null); setBulkDate('') }} style={{ padding: '2px 8px', fontSize: 11 }}>Cancel</Btn>
        </div>
      )}

      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11, tableLayout: 'fixed' }}>
        {colGroup}
        <thead>
          <tr>
            <th
              onClick={() => { setSelected(s => s.size === sortedLots.length ? new Set() : new Set(sortedLots.map(l => l.lot_id))); lastClickedRef.current = null }}
              style={{ ...STD_H, width: SLOT_COLS.num, cursor: 'pointer', color: TEXT_MUTED }}
              title="Click to select all / none"
            >#</th>
            {sTh('lot', 'Lot')}
            {sTh('type', 'Type')}
            {sTh('bldg', 'Bldg')}
            {sTh('bldgType', 'Bldg Type')}
            {sTh('hc', 'HC')}
            {sTh('bldr', 'BLDR')}
            {sTh('fulfill', 'Fulfillment')}
          </tr>
        </thead>
        <tbody>
          {satisfyLots.flatMap((lot, i) => renderLotRow(lot, i, false))}

          {/* Open slots */}
          {Array.from({ length: openSlotCount }, (_, i) => {
            const slotIdx    = satisfyLots.length + i
            const showPicker = pickerSlot === slotIdx
            return [
              <tr key={`open_${i}`} style={{ borderTop: `1px solid ${PANEL_BORDER}`, background: '#f9fafb' }}>
                <td style={{ ...STD_D, color: TEXT_MUTED, textAlign: 'center' }}>{slotIdx + 1}</td>
                <td colSpan={7} style={{ ...STD_D, fontFamily: 'monospace' }}>
                  <button onClick={() => setPickerSlot(showPicker ? null : slotIdx)}
                    style={{ background: 'none', border: 'none', cursor: 'pointer', color: showPicker ? '#2563eb' : '#cbd5e1', fontSize: 11, fontFamily: 'monospace', padding: 0 }}>
                    — open slot —
                  </button>
                </td>
              </tr>,
              showPicker && (
                <tr key={`picker_${slotIdx}`} style={{ background: '#eff6ff' }}>
                  <td colSpan={8} style={{ padding: '5px 8px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ fontSize: 11, color: '#1d4ed8', fontWeight: 600 }}>Assign lot to slot:</span>
                      {poolLots.length === 0 ? (
                        <span style={{ fontSize: 11, color: TEXT_MUTED, fontStyle: 'italic' }}>No lots in pool</span>
                      ) : (
                        <select defaultValue=""
                          onChange={e => { if (e.target.value) { onAssignSlot(Number(e.target.value), checkpoint.checkpoint_id); setPickerSlot(null) } }}
                          style={{ fontSize: 11, padding: '2px 6px', borderRadius: 4, border: '1px solid #93c5fd', background: '#fff' }}>
                          <option value="">— select lot —</option>
                          {poolLots.map(l => <option key={l.lot_id} value={l.lot_id}>{pillLotNum(l.lot_number)}</option>)}
                        </select>
                      )}
                      <button onClick={() => setPickerSlot(null)}
                        style={{ fontSize: 11, color: TEXT_MUTED, background: 'none', border: 'none', cursor: 'pointer' }}>Cancel</button>
                    </div>
                  </td>
                </tr>
              ),
            ].filter(Boolean)
          })}

          {/* Footer: MARKS Plan / Sim Plan */}
          <tr style={{ borderTop: `2px solid ${PANEL_BORDER}`, background: '#f1f5f9' }}>
            <td colSpan={5} style={{ ...STD_D, color: TEXT_MUTED, fontStyle: 'italic', fontSize: 10 }}
                title="Cumulative totals: lots with dates on or before this checkpoint date, across the whole agreement">
              Cumulative through checkpoint date
            </td>
            <td colSpan={2} style={{ ...STD_D, fontSize: 10 }}>
              <span style={{ color: TEXT_MUTED }} title="Lots with actual MARKS takedown or HC hold dates on or before this checkpoint date">MARKS: <strong>{marksplan ?? '—'}</strong></span>
              <span style={{ color: TEXT_MUTED }}> · </span>
              <span style={{ color: '#2563eb' }} title="Lots with sim-projected dates on or before this checkpoint date">Sim: <strong>{simplan ?? '—'}</strong></span>
            </td>
            <td />
          </tr>
        </tbody>
      </table>

      {/* Overflow: lots beyond required count */}
      {overflowLots.length > 0 && (
        <div style={{ borderTop: '2px solid #f59e0b' }}>
          <div
            onClick={() => setOverflowOpen(v => !v)}
            style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 8px', background: '#fefce8', cursor: 'pointer', userSelect: 'none' }}
          >
            <span style={{ fontSize: 10, fontWeight: 700, color: '#92400e' }}>OVERFLOW ({overflowLots.length})</span>
            <span style={{ fontSize: 10, color: '#a16207' }}>lots beyond required count</span>
            <span style={{ fontSize: 9, color: '#92400e', marginLeft: 'auto' }}>{overflowOpen ? '▼' : '▶'}</span>
          </div>
          {overflowOpen && (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11, tableLayout: 'fixed' }}>
              {colGroup}
              <tbody>
                {overflowLots.flatMap((lot, i) => renderLotRow(lot, satisfyLots.length + i, true))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  )
}

// ── Checkpoint timeline strip ──────────────────────────────────────
function CheckpointTimeline({ pins }) {
  if (!pins || pins.length === 0) return null
  const dated = pins.filter(p => p.date)
  if (dated.length === 0) return null

  const timestamps = dated.map(p => new Date(p.date + 'T00:00:00').getTime())
  const minD = Math.min(...timestamps)
  const maxD = Math.max(...timestamps)
  const span = maxD - minD || 1

  const STATUS_COLOR = { met: '#16a34a', short: '#dc2626', none: '#9ca3af', conflict: '#d97706' }

  return (
    <div style={{ position: 'relative', height: 58, marginBottom: 10, overflow: 'visible' }}>
      {/* track */}
      <div style={{
        position: 'absolute', top: 16, left: '3%', right: '3%',
        height: 2, background: '#e2e8f0', borderRadius: 1,
      }} />
      {dated.map((pin, i) => {
        const t    = new Date(pin.date + 'T00:00:00').getTime()
        const raw  = span === 1 ? 0.5 : (t - minD) / span
        const pct  = 3 + raw * 94   // 3% … 97%
        const color = STATUS_COLOR[pin.status] || STATUS_COLOR.none
        return (
          <div key={i} style={{
            position: 'absolute', left: `${pct}%`, top: 0,
            transform: 'translateX(-50%)',
            display: 'flex', flexDirection: 'column', alignItems: 'center',
          }}>
            <div style={{
              width: 14, height: 14, borderRadius: '50%',
              background: color, border: '2px solid #fff',
              boxShadow: `0 0 0 1.5px ${color}`,
            }} />
            <div style={{ marginTop: 4, fontSize: 9, color: '#6b7280', whiteSpace: 'nowrap' }}>
              {pin.date.slice(5).replace('-', '/')}
            </div>
            <div style={{ fontSize: 9, color: '#374151', fontWeight: 700, whiteSpace: 'nowrap' }}>
              {pin.label}
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ── Checkpoints section ────────────────────────────────────────────
function CheckpointsSection({ tda, onPatchCheckpoint, onAddCheckpoint, onDeleteCheckpoint, onAutoAssign, onAssignLot, buildingUnitCounts, onPatchLotDate, onRemoveLots }) {
  const [confirmDelete, setConfirmDelete] = useState(null)
  const [assigning, setAssigning] = useState(false)
  const [autoAssignResult, setAutoAssignResult] = useState(null)
  const [expanded, setExpanded] = useState({})

  const lotsByCp = {}
  for (const lot of tda.lots || []) {
    if (lot.checkpoint_id) {
      if (!lotsByCp[lot.checkpoint_id]) lotsByCp[lot.checkpoint_id] = []
      lotsByCp[lot.checkpoint_id].push(lot)
    }
  }
  const poolLots = (tda.lots || []).filter(l => !l.checkpoint_id)

  function toggleExpand(cpId) {
    setExpanded(prev => ({ ...prev, [cpId]: !prev[cpId] }))
  }

  async function handleAutoAssign() {
    setAssigning(true)
    setAutoAssignResult(null)
    const result = await onAutoAssign(tda.tda_id)
    setAutoAssignResult(result)
    setAssigning(false)
    setTimeout(() => setAutoAssignResult(null), 4000)
  }

  // Build timeline pins
  const timelinePins = tda.checkpoints.map((cp, idx) => {
    const required    = cp.lots_required_cumulative || 0
    const prevCum     = idx > 0 ? (tda.checkpoints[idx - 1].lots_required_cumulative || 0) : 0
    const perRequired = required - prevCum
    const cpLots      = lotsByCp[cp.checkpoint_id] || []
    const slotsFull   = perRequired > 0 && cpLots.length >= perRequired
    const simShort    = cp.sim_plan != null && cp.sim_plan < required
    const status      = perRequired <= 0 ? 'none'
        : slotsFull && simShort ? 'conflict'
        : slotsFull             ? 'met'
        :                         'short'
    return { date: cp.checkpoint_date, status, label: `CP${idx + 1} ${cpLots.length}/${perRequired}` }
  })

  return (
    <div style={{ padding: '10px 16px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
        <span style={{ fontSize: 11, fontWeight: 600, color: TEXT_MUTED }}
              title="Assigned/Status tracks manual slot organization. Sim Plan tracks engine date projections. These are independent — both should agree for a checkpoint to be truly on track.">
          CHECKPOINTS
        </span>
        {tda.checkpoints.length > 0 && (
          <Btn variant="teal" onClick={handleAutoAssign} disabled={assigning} style={{ padding: '1px 7px', fontSize: 11 }}
               title="Assigns each TDA lot to the earliest checkpoint whose date covers its effective takedown date">
            {assigning ? 'Assigning…' : 'Auto-Assign Lots'}
          </Btn>
        )}
        {autoAssignResult && !assigning && (
          <span style={{ fontSize: 10, color: '#0d9488', fontStyle: 'italic', animation: 'tda-fadeout 0.5s ease 3.5s forwards' }}>
            {autoAssignResult.assigned} assigned
            {autoAssignResult.unassigned > 0 ? `, ${autoAssignResult.unassigned} without dates` : ''}
            {autoAssignResult.skipped_builder_mismatch > 0 ? `, ${autoAssignResult.skipped_builder_mismatch} skipped (builder mismatch)` : ''}
          </span>
        )}
      </div>

      {tda.checkpoints.length > 0 && <CheckpointTimeline pins={timelinePins} />}

      {tda.checkpoints.length > 0 && (
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, marginBottom: 0 }}>
          <thead>
            <tr>
              <th style={{ ...TH, width: 44, padding: '3px 4px' }}></th>
              {[
                { h: 'Checkpoint', tip: 'Cumulative lots required by this date' },
                { h: 'Required', tip: 'Lots needed for this checkpoint slot (delta from previous)' },
                { h: 'Assigned', tip: 'Lots manually slotted into this checkpoint — independent of engine date projections' },
                { h: 'Status', tip: 'Manual slot fill vs per-checkpoint delta (✓ full, +N surplus, −N short). Amber = slots full but Sim Plan is short — engine and slots disagree.' },
                { h: 'Sim Plan', tip: 'Engine projection: lots with projected or actual dates on or before this checkpoint date — cumulative (per D-087: both HC and BLDR count). Run sim to update.' },
                { h: 'To Date', tip: 'Cumulative lots actually taken down (actuals only) through today, or through the checkpoint date if it has already passed' },
                { h: '', tip: '' },
              ].map(({ h, tip }, i) => (
                <th key={i} style={TH} title={tip}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {tda.checkpoints.map((cp, idx) => {
              const required     = cp.lots_required_cumulative || 0
              const isOpen       = !!expanded[cp.checkpoint_id]
              const prevRequired = idx > 0 ? (tda.checkpoints[idx - 1].lots_required_cumulative || 0) : 0
              const perRequired  = required - prevRequired
              const cpLots       = lotsByCp[cp.checkpoint_id] || []
              const gap          = perRequired - cpLots.length
              const isFirst      = idx === 0
              const isLast       = idx === tda.checkpoints.length - 1

              const rowBg = perRequired === 0 ? '#fff'
                : gap === 0 ? '#f0fdf4'
                : gap < 0   ? '#f0fdf4'
                : '#fef2f2'

              return (
                <>
                  <tr key={cp.checkpoint_id} style={{ borderBottom: isOpen ? 'none' : `1px solid ${PANEL_BORDER}`, background: rowBg }}>
                    {/* CP# + expand toggle */}
                    <td style={{ ...TD, padding: '6px 4px', width: 44, whiteSpace: 'nowrap' }}>
                      <span style={{ fontSize: 10, color: TEXT_MUTED, fontWeight: 700, marginRight: 2 }}>
                        CP{idx + 1}
                      </span>
                      <button
                        onClick={() => toggleExpand(cp.checkpoint_id)}
                        title={isOpen ? 'Collapse slots' : 'Expand slots'}
                        style={{ fontSize: 10, color: TEXT_MUTED, background: 'none', border: 'none', cursor: 'pointer', padding: '1px 2px', lineHeight: 1 }}
                      >
                        {isOpen ? '▼' : '▶'}
                      </button>
                    </td>
                    {/* Checkpoint editable */}
                    <td style={TD}>
                      <span style={{ fontWeight: 500, color: TEXT_PRIMARY }}>
                        <EditNumber value={required}
                          min={prevRequired}
                          onSave={v => onPatchCheckpoint(cp.checkpoint_id, { lots_required_cumulative: v })} />
                        {' by '}
                        <EditDate value={cp.checkpoint_date}
                          onSave={v => onPatchCheckpoint(cp.checkpoint_id, { checkpoint_date: v })} />
                      </span>
                    </td>
                    {/* Required (per-cp) */}
                    <td style={{ ...TD, color: TEXT_MUTED, fontVariantNumeric: 'tabular-nums' }}>{perRequired}</td>
                    {/* Assigned */}
                    <td style={{ ...TD, color: TEXT_MUTED, fontVariantNumeric: 'tabular-nums' }}>{cpLots.length}</td>
                    {/* Status — amber when slots are full but Sim Plan is short */}
                    {(() => {
                      const slotsFull = perRequired > 0 && gap <= 0
                      const simShort  = cp.sim_plan != null && cp.sim_plan < required
                      const conflict  = slotsFull && simShort
                      return (
                        <td style={{ ...TD, background: conflict ? '#fef3c7' : undefined }}
                            title={conflict ? 'Slots full but engine projection is short — check lot dates or run sim' : undefined}>
                          {perRequired === 0 ? (
                            <span style={{ color: TEXT_MUTED }}>—</span>
                          ) : gap === 0 ? (
                            <span style={{ color: conflict ? '#92400e' : '#16a34a', fontWeight: 700, fontSize: 13 }}>✓</span>
                          ) : gap < 0 ? (
                            <span style={{ color: '#15803d', fontWeight: 700 }}>+{Math.abs(gap)}</span>
                          ) : (
                            <span style={{ color: '#dc2626', fontWeight: 700 }}>−{gap}</span>
                          )}
                        </td>
                      )
                    })()}
                    {/* Sim Plan */}
                    <td style={{ ...TD, fontVariantNumeric: 'tabular-nums' }}>
                      {cp.sim_plan != null ? (() => {
                        const simOk = cp.sim_plan >= required
                        const contributing = (tda.lots || []).filter(lot => {
                          if (tda.builder_id != null && lot.resolved_builder_id !== tda.builder_id) return false
                          const effBldr = lot.bldr_marks_date || lot.bldr_projected_date
                          const effHc   = lot.hc_marks_date   || lot.hc_projected_date
                          // Compare ISO date strings directly — avoids timezone shifts
                          // that occur when new Date('YYYY-MM-DD') is parsed as UTC midnight
                          // and then compared against a local-timezone T23:59:59 boundary.
                          return (effBldr && effBldr <= cp.checkpoint_date) || (effHc && effHc <= cp.checkpoint_date)
                        })
                        const simTip = !cp.checkpoint_date
                          ? 'Checkpoint has no date — set a checkpoint date to enable projection'
                          : contributing.length > 0
                            ? `Contributing lots: ${contributing.map(l => pillLotNum(l.lot_number).trim()).join(', ')}`
                            : 'No lots with dates on or before this checkpoint'
                        return (
                          <span title={simTip} style={{ color: simOk ? '#15803d' : '#dc2626', fontWeight: 600, cursor: 'help' }}>
                            {cp.sim_plan}/{required}
                          </span>
                        )
                      })() : <span style={{ color: TEXT_MUTED }}>—</span>}
                    </td>
                    {/* To Date */}
                    <td style={{ ...TD, color: TEXT_MUTED, fontVariantNumeric: 'tabular-nums' }}>{cp.taken_down_to_date ?? 0}</td>
                    {/* Delete */}
                    <td style={{ ...TD, textAlign: 'right', paddingRight: 4 }}>
                      {confirmDelete === cp.checkpoint_id ? (
                        <span style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}>
                          <span style={{ fontSize: 11, color: '#dc2626' }}>Delete?</span>
                          <Btn variant="danger" style={{ padding: '1px 6px', fontSize: 11 }}
                            onClick={() => { onDeleteCheckpoint(cp.checkpoint_id); setConfirmDelete(null) }}>Yes</Btn>
                          <Btn style={{ padding: '1px 6px', fontSize: 11 }}
                            onClick={() => setConfirmDelete(null)}>No</Btn>
                        </span>
                      ) : (
                        <button onClick={() => setConfirmDelete(cp.checkpoint_id)}
                          style={{ fontSize: 14, color: '#d1d5db', background: 'none', border: 'none', cursor: 'pointer' }}
                          title="Delete checkpoint">×</button>
                      )}
                    </td>
                  </tr>

                  {/* Slot list row */}
                  {isOpen && (
                    <tr key={`${cp.checkpoint_id}_slots`} style={{ borderBottom: `1px solid ${PANEL_BORDER}` }}>
                      <td colSpan={8} style={{ padding: 0, paddingLeft: 28 }}>
                        <CheckpointSlotTable
                          checkpoint={cp}
                          lots={cpLots}
                          perRequired={perRequired}
                          poolLots={poolLots}
                          onAssignSlot={onAssignLot}
                          marksplan={cp.marks_plan}
                          simplan={cp.sim_plan}
                          buildingUnitCounts={buildingUnitCounts}
                          onPatchLotDate={onPatchLotDate}
                          onRemoveLots={onRemoveLots ? lotIds => onRemoveLots(tda.tda_id, lotIds) : undefined}
                        />
                      </td>
                    </tr>
                  )}
                </>
              )
            })}
            {/* Add Checkpoint row inside table */}
            <tr style={{ borderTop: `1px solid ${PANEL_BORDER}` }}>
              <td colSpan={8} style={{ padding: '7px 8px' }}>
                <button onClick={onAddCheckpoint}
                  style={{ fontSize: 12, color: '#2563eb', background: 'none', border: 'none', cursor: 'pointer', padding: 0, fontWeight: 500 }}>
                  + Add Checkpoint
                </button>
              </td>
            </tr>
          </tbody>
        </table>
      )}

      {tda.checkpoints.length === 0 && (
        <div>
          <div style={{
            display: 'flex', alignItems: 'flex-start', gap: 8,
            padding: '8px 12px', marginBottom: 8,
            background: '#fffbeb', border: '1px solid #fcd34d', borderRadius: 5,
          }}>
            <span style={{ fontSize: 13, lineHeight: 1 }}>⚠</span>
            <span style={{ fontSize: 11, color: '#92400e', lineHeight: 1.5 }}>
              No checkpoints — this agreement is excluded from simulation runs.
              Add at least one checkpoint to enable engine scheduling.
            </span>
          </div>
          <button onClick={onAddCheckpoint}
            style={{ fontSize: 12, color: '#2563eb', background: 'none', border: 'none', cursor: 'pointer', padding: 0, fontWeight: 500 }}>
            + Add Checkpoint
          </button>
        </div>
      )}
    </div>
  )
}

// ── Lots section (pool management) ────────────────────────────────
function LotsSection({ tda, allTdas, unassignedLots, onAddLots, onRemoveLots, onMoveLots, onAutoAssign }) {
  const poolLots  = (tda.lots || []).filter(l => !l.checkpoint_id)
  const otherTdas = allTdas.filter(t => t.tda_id !== tda.tda_id)

  const [selected, setSelected]       = useState(new Set())
  const lastClickedRef                = useRef(null)
  const [lotsExpanded, setLotsExpanded] = useState(true)
  const [actionMode, setActionMode]   = useState(null)   // 'hc'|'bldr'|'remove'|'move'
  const [dateDraft, setDateDraft]     = useState('')
  const [moveTarget, setMoveTarget]   = useState('')
  const [confirmMove, setConfirmMove] = useState(false)
  const [applying, setApplying]       = useState(false)

  const nSel = selected.size

  function handlePillClick(lotId, e) {
    const idx = poolLots.findIndex(l => l.lot_id === lotId)
    if (e.shiftKey && lastClickedRef.current !== null) {
      const lo = Math.min(lastClickedRef.current, idx)
      const hi = Math.max(lastClickedRef.current, idx)
      setSelected(prev => { const n = new Set(prev); poolLots.slice(lo, hi + 1).forEach(l => n.add(l.lot_id)); return n })
    } else {
      setSelected(prev => { const n = new Set(prev); n.has(lotId) ? n.delete(lotId) : n.add(lotId); return n })
      lastClickedRef.current = idx
    }
  }

  function cancelAction() { setActionMode(null); setDateDraft(''); setMoveTarget(''); setConfirmMove(false) }

  async function handleSetDate(field) {
    if (!dateDraft || !nSel) return
    setApplying(true)
    const projKey = field === 'hc' ? 'hc_projected_date' : 'bldr_projected_date'
    await Promise.all([...selected].map(lotId =>
      fetch(`${API_BASE}/tda-lots/${lotId}/dates`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ [projKey]: dateDraft }),
      })
    ))
    setApplying(false)
    cancelAction()
    setSelected(new Set())
    lastClickedRef.current = null
    onAutoAssign && onAutoAssign(tda.tda_id)
  }

  async function handleRemove() {
    await onRemoveLots(tda.tda_id, [...selected])
    setSelected(new Set()); cancelAction(); lastClickedRef.current = null
  }

  async function handleMove() {
    if (!moveTarget) return
    await onMoveLots(tda.tda_id, [...selected], Number(moveTarget))
    setSelected(new Set()); cancelAction(); lastClickedRef.current = null
  }

  return (
    <div style={{ padding: '10px 16px', borderTop: `1px solid ${PANEL_BORDER}` }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: lotsExpanded ? 6 : 0 }}>
        <button
          onClick={() => setLotsExpanded(v => !v)}
          style={{ display: 'flex', alignItems: 'center', gap: 5, background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
        >
          <span style={{ fontSize: 11, fontWeight: 600, color: TEXT_MUTED }}>POOL LOTS</span>
          <span style={{ fontSize: 11, color: TEXT_MUTED }}>({poolLots.length})</span>
          <span style={{ fontSize: 10, color: TEXT_MUTED }}>{lotsExpanded ? '▼' : '▶'}</span>
        </button>
        {lotsExpanded && poolLots.length > 0 && nSel === 0 && (
          <span style={{ fontSize: 10, color: TEXT_MUTED, fontStyle: 'italic', marginLeft: 4 }}>Click to select · Shift+click for range</span>
        )}
      </div>

      {lotsExpanded && (
        <>
          {poolLots.length > 0 && (
            <>
              {/* All / None */}
              <div style={{ display: 'flex', gap: 8, marginBottom: 6, alignItems: 'center' }}>
                <button
                  onClick={() => { setSelected(new Set(poolLots.map(l => l.lot_id))); lastClickedRef.current = null }}
                  style={{ fontSize: 10, color: '#2563eb', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
                >All</button>
                <button
                  onClick={() => { setSelected(new Set()); lastClickedRef.current = null }}
                  style={{ fontSize: 10, color: '#2563eb', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
                >None</button>
                {nSel > 0 && <span style={{ fontSize: 10, fontWeight: 600, color: '#1d4ed8' }}>{nSel} selected</span>}
              </div>

              {/* Pill legend */}
              <div style={{ display: 'flex', gap: 10, marginBottom: 5, flexWrap: 'wrap' }}>
                {[
                  { border: '#0d9488', bg: '#f0fdfa', label: 'HC override' },
                  { border: '#7dd3fc', bg: '#f0f9ff', label: 'HC sim' },
                  { border: '#9ca3af', bg: '#fff',    label: 'HC marks' },
                  { border: '#d97706', bg: '#fffbeb', label: 'BLDR only' },
                  { border: '#d1d5db', bg: '#fff',    label: 'Free' },
                ].map(({ border, bg, label }) => (
                  <span key={label} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 9, color: TEXT_MUTED }}>
                    <span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 2, border: `1.5px solid ${border}`, background: bg }} />
                    {label}
                  </span>
                ))}
              </div>

              {/* Pill grid */}
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 8 }}>
                {poolLots.map(lot => {
                  const isSel   = selected.has(lot.lot_id)
                  const hcRes   = resolveDate(lot, 'hc')
                  const bldrRes = resolveDate(lot, 'bldr')
                  // Border/bg driven by HC first; fall back to BLDR source for lots with no HC
                  const pillBorder = isSel ? '#2563eb'
                    : hcRes.source === 'override' ? '#0d9488'
                    : hcRes.source === 'sim'      ? '#7dd3fc'
                    : hcRes.source === 'marks'    ? '#9ca3af'
                    : bldrRes.source === 'marks'  ? '#d97706'   // BLDR-only marks → amber
                    : bldrRes.source === 'override' ? '#d97706' // BLDR-only override → amber
                    : bldrRes.source === 'sim'    ? '#fbbf24'   // BLDR-only sim → light amber
                    : '#d1d5db'
                  const pillBg = isSel ? '#eff6ff'
                    : hcRes.source === 'override' ? '#f0fdfa'
                    : hcRes.source === 'sim'      ? '#f0f9ff'
                    : bldrRes.date                ? '#fffbeb'   // any BLDR-only date → amber tint
                    : '#fff'
                  const hcSubColor = hcRes.source === 'override' ? '#0d9488'
                    : hcRes.source === 'marks'    ? '#9ca3af'
                    : '#0369a1'
                  const hcTitle = hcRes.source === 'override' ? `${lot.lot_number} — override HC: ${hcRes.date}`
                    : hcRes.source === 'sim'      ? `${lot.lot_number} — sim HC: ${hcRes.date}`
                    : hcRes.source === 'marks'    ? `${lot.lot_number} — marks HC: ${hcRes.date}`
                    : bldrRes.date                ? `${lot.lot_number} — BLDR date only: ${bldrRes.date}`
                    : lot.lot_number
                  return (
                    <div
                      key={lot.lot_id}
                      onClick={e => handlePillClick(lot.lot_id, e)}
                      title={hcTitle}
                      style={{
                        fontFamily: 'monospace', whiteSpace: 'pre',
                        padding: '3px 8px', borderRadius: 5, fontSize: 11,
                        cursor: 'pointer', userSelect: 'none',
                        border: `1.5px solid ${pillBorder}`,
                        background: pillBg,
                        color: isSel ? '#1d4ed8' : TEXT_PRIMARY,
                        fontWeight: isSel ? 700 : 400,
                      }}
                    >
                      {pillLotNum(lot.lot_number)}
                      {hcRes.date && (
                        <span style={{ display: 'block', fontSize: 9, fontFamily: 'sans-serif', fontWeight: 400, color: hcSubColor, textAlign: 'center', marginTop: 1, whiteSpace: 'nowrap', fontStyle: hcRes.source === 'marks' ? 'italic' : 'normal' }}>
                          {hcRes.date.slice(5)}
                        </span>
                      )}
                      {bldrRes.date && (
                        <span style={{ display: 'block', fontSize: 9, fontFamily: 'sans-serif', fontWeight: 400, color: '#9ca3af', textAlign: 'center', whiteSpace: 'nowrap', fontStyle: bldrRes.source === 'marks' ? 'italic' : 'normal' }}>
                          B:{bldrRes.date.slice(5)}
                        </span>
                      )}
                    </div>
                  )
                })}
              </div>

              {/* Action bar */}
              {nSel > 0 && actionMode === null && (
                <div style={{
                  display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 6,
                  padding: '6px 10px', background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: 5, marginBottom: 6,
                }}>
                  <span style={{ fontSize: 11, fontWeight: 600, color: '#1d4ed8' }}>{nSel} selected</span>
                  <Btn onClick={() => setActionMode('hc')} style={{ padding: '2px 8px', fontSize: 11 }}>Set HC Date</Btn>
                  <Btn onClick={() => setActionMode('bldr')} style={{ padding: '2px 8px', fontSize: 11 }}>Set BLDR Date</Btn>
                  {otherTdas.length > 0 && (
                    <Btn onClick={() => setActionMode('move')} style={{ padding: '2px 8px', fontSize: 11 }}>Move to…</Btn>
                  )}
                  <Btn variant="danger" onClick={() => setActionMode('remove')} style={{ padding: '2px 8px', fontSize: 11, marginLeft: 'auto' }}>Remove</Btn>
                </div>
              )}

              {/* HC date form */}
              {actionMode === 'hc' && (
                <div style={{ padding: '8px 10px', background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 5, marginBottom: 6 }}>
                  <div style={{ fontSize: 11, fontWeight: 600, color: '#15803d', marginBottom: 6 }}>
                    Set HC (Holding Company) date for {nSel} lot{nSel > 1 ? 's' : ''}
                  </div>
                  <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                    <input autoFocus type="date" value={dateDraft} onChange={e => setDateDraft(e.target.value)}
                      style={{ fontSize: 11, padding: '2px 5px', borderRadius: 3, border: '1px solid #86efac', ...greenEditorStyle }} />
                    <Btn variant="success" onClick={() => handleSetDate('hc')} disabled={!dateDraft || applying} style={{ padding: '2px 8px', fontSize: 11 }}
                         title="Sets HC date for selected lots (locked as your override) then auto-assigns them into their earliest matching checkpoint slot">
                      {applying ? 'Applying…' : 'Apply & Auto-Assign'}
                    </Btn>
                    <Btn onClick={cancelAction} style={{ padding: '2px 8px', fontSize: 11 }}>Cancel</Btn>
                  </div>
                  <div style={{ fontSize: 10, color: '#15803d', marginTop: 4, fontStyle: 'italic' }}>Date is locked as your override — sim will not overwrite it. Lots are then auto-assigned into their earliest matching checkpoint slot.</div>
                </div>
              )}

              {/* BLDR date form */}
              {actionMode === 'bldr' && (
                <div style={{ padding: '8px 10px', background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: 5, marginBottom: 6 }}>
                  <div style={{ fontSize: 11, fontWeight: 600, color: '#1d4ed8', marginBottom: 6 }}>
                    Set BLDR (Builder) date for {nSel} lot{nSel > 1 ? 's' : ''}
                  </div>
                  <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                    <input autoFocus type="date" value={dateDraft} onChange={e => setDateDraft(e.target.value)}
                      style={{ fontSize: 11, padding: '2px 5px', borderRadius: 3, border: '1px solid #93c5fd', ...greenEditorStyle }} />
                    <Btn variant="primary" onClick={() => handleSetDate('bldr')} disabled={!dateDraft || applying} style={{ padding: '2px 8px', fontSize: 11 }}
                         title="Sets BLDR date for selected lots (locked as your override) then auto-assigns them into their earliest matching checkpoint slot">
                      {applying ? 'Applying…' : 'Apply & Auto-Assign'}
                    </Btn>
                    <Btn onClick={cancelAction} style={{ padding: '2px 8px', fontSize: 11 }}>Cancel</Btn>
                  </div>
                  <div style={{ fontSize: 10, color: '#1d4ed8', marginTop: 4, fontStyle: 'italic' }}>Date is locked as your override — sim will not overwrite it. Lots are then auto-assigned into their earliest matching checkpoint slot.</div>
                </div>
              )}

              {/* Remove confirm */}
              {actionMode === 'remove' && (
                <div style={{ padding: '8px 10px', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 5, marginBottom: 6 }}>
                  <span style={{ fontSize: 11, color: '#dc2626', marginRight: 8 }}>Remove {nSel} lot{nSel > 1 ? 's' : ''} from this agreement?</span>
                  <Btn variant="danger" onClick={handleRemove} style={{ padding: '2px 8px', fontSize: 11 }}>Yes, Remove</Btn>
                  <span style={{ marginLeft: 6 }} />
                  <Btn onClick={cancelAction} style={{ padding: '2px 8px', fontSize: 11 }}>Cancel</Btn>
                </div>
              )}

              {/* Move picker */}
              {actionMode === 'move' && !confirmMove && (
                <div style={{ padding: '8px 10px', background: '#f8fafc', border: `1px solid ${PANEL_BORDER}`, borderRadius: 5, marginBottom: 6 }}>
                  <div style={{ fontSize: 11, fontWeight: 600, color: TEXT_PRIMARY, marginBottom: 6 }}>Move {nSel} lot{nSel > 1 ? 's' : ''} to:</div>
                  <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                    <select value={moveTarget} onChange={e => setMoveTarget(e.target.value)}
                      style={{ fontSize: 11, padding: '2px 6px', borderRadius: 4, border: '1px solid #d1d5db', background: '#fff' }}>
                      <option value="">— select agreement —</option>
                      {otherTdas.map(t => <option key={t.tda_id} value={t.tda_id}>{t.tda_name}</option>)}
                    </select>
                    <Btn variant="primary" onClick={() => setConfirmMove(true)} disabled={!moveTarget} style={{ padding: '2px 8px', fontSize: 11 }}>Move</Btn>
                    <Btn onClick={cancelAction} style={{ padding: '2px 8px', fontSize: 11 }}>Cancel</Btn>
                  </div>
                </div>
              )}

              {/* Move confirm */}
              {actionMode === 'move' && confirmMove && moveTarget && (
                <div style={{ padding: '8px 10px', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 5, marginBottom: 6 }}>
                  <span style={{ fontSize: 11, color: '#dc2626', marginRight: 8 }}>
                    Move {nSel} lot{nSel > 1 ? 's' : ''} to <strong>{otherTdas.find(t => t.tda_id === Number(moveTarget))?.tda_name}</strong>?
                  </span>
                  <Btn variant="danger" onClick={handleMove} style={{ padding: '2px 8px', fontSize: 11 }}>Yes, Move</Btn>
                  <span style={{ marginLeft: 6 }} />
                  <Btn onClick={() => setConfirmMove(false)} style={{ padding: '2px 8px', fontSize: 11 }}>Back</Btn>
                </div>
              )}
            </>
          )}

          {poolLots.length === 0 && (
            <p style={{ fontSize: 11, color: TEXT_MUTED, margin: '0 0 6px' }}>
              {(tda.lots || []).length > 0 ? 'All lots assigned to checkpoints.' : 'No lots in this agreement.'}
            </p>
          )}
        </>
      )}

      {/* Add Lots section */}
      <AddLotsSection
        tda={tda}
        allTdas={allTdas}
        unassignedLots={unassignedLots}
        onAddLots={onAddLots}
        onMoveLots={onMoveLots}
      />
    </div>
  )
}

// ── Add lots section ───────────────────────────────────────────────
function AddLotsSection({ tda, allTdas, unassignedLots, onAddLots, onMoveLots }) {
  const [showAdd, setShowAdd]         = useState(false)
  const [addSelected, setAddSelected] = useState(new Map()) // lot_id → { lot, isMove, tdaId }
  const [confirmPending, setConfirmPending] = useState(null)
  const [applying, setApplying]       = useState(false)
  const lastClickedRef                = useRef({}) // keyed by groupKey

  const sourceGroups = []
  const bankAvailable = tda.bank_id != null ? (tda.bank_available_lots || []) : unassignedLots
  const unassignedLabel = tda.bank_id != null ? 'Available in bank' : 'Not in any agreement'
  if (bankAvailable.length > 0) {
    sourceGroups.push({ key: 'unassigned', label: unassignedLabel, lots: bankAvailable, isMove: false, tdaId: null })
  }
  for (const otherTda of allTdas.filter(t => t.tda_id !== tda.tda_id)) {
    const lots = otherTda.lots || []
    if (lots.length > 0) {
      sourceGroups.push({ key: `tda_${otherTda.tda_id}`, label: otherTda.tda_name, lots, isMove: true, tdaId: otherTda.tda_id })
    }
  }

  const totalAvailable = sourceGroups.reduce((s, g) => s + g.lots.length, 0)

  function handleGroupPillClick(lotId, lot, groupKey, groupLots, isMove, tdaId, e) {
    const idx = groupLots.findIndex(l => l.lot_id === lotId)
    if (e.shiftKey && lastClickedRef.current[groupKey] != null) {
      const lo = Math.min(lastClickedRef.current[groupKey], idx)
      const hi = Math.max(lastClickedRef.current[groupKey], idx)
      setAddSelected(prev => {
        const n = new Map(prev)
        groupLots.slice(lo, hi + 1).forEach(l => n.set(l.lot_id, { lot: l, isMove, tdaId }))
        return n
      })
    } else {
      setAddSelected(prev => {
        const n = new Map(prev)
        n.has(lotId) ? n.delete(lotId) : n.set(lotId, { lot, isMove, tdaId })
        return n
      })
      lastClickedRef.current[groupKey] = idx
    }
  }

  function handleGroupAllNone(groupLots, groupKey, isMove, tdaId, selectAll) {
    setAddSelected(prev => {
      const n = new Map(prev)
      if (selectAll) groupLots.forEach(l => n.set(l.lot_id, { lot: l, isMove, tdaId }))
      else groupLots.forEach(l => n.delete(l.lot_id))
      return n
    })
    lastClickedRef.current[groupKey] = null
  }

  const nSel = addSelected.size

  function handleRequestAdd() {
    const entries = [...addSelected.values()]
    const unassigned = entries.filter(e => !e.isMove).map(e => e.lot.lot_id)
    const moves = {}
    for (const e of entries.filter(e => e.isMove)) {
      if (!moves[e.tdaId]) moves[e.tdaId] = []
      moves[e.tdaId].push(e.lot.lot_id)
    }
    if (Object.keys(moves).length === 0) {
      doAdd(unassigned, {})
    } else {
      setConfirmPending({ unassigned, moves })
    }
  }

  async function doAdd(unassigned, moves) {
    setApplying(true)
    if (unassigned.length > 0) await onAddLots(tda.tda_id, unassigned)
    for (const [tdaId, lotIds] of Object.entries(moves)) {
      await onMoveLots(Number(tdaId), lotIds, tda.tda_id)
    }
    setApplying(false)
    setAddSelected(new Map()); setConfirmPending(null); setShowAdd(false)
    lastClickedRef.current = {}
  }

  if (totalAvailable === 0 && !showAdd) return null

  if (!showAdd) {
    return (
      <div style={{ marginTop: 8 }}>
        <button
          onClick={() => { setShowAdd(true); setAddSelected(new Map()) }}
          style={{ fontSize: 11, color: '#2563eb', background: 'none', border: 'none', cursor: 'pointer', padding: 0, fontWeight: 500 }}
        >
          + Add Lots to Agreement
        </button>
      </div>
    )
  }

  return (
    <div style={{ marginTop: 10, padding: 10, border: `1px solid ${PANEL_BORDER}`, borderRadius: 4, background: '#f9fafb' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
        <span style={{ fontSize: 12, fontWeight: 600, color: TEXT_PRIMARY }}>Add lots to agreement</span>
        <button
          onClick={() => { setShowAdd(false); setAddSelected(new Map()); setConfirmPending(null) }}
          style={{ fontSize: 12, color: TEXT_MUTED, background: 'none', border: 'none', cursor: 'pointer' }}
        >Cancel</button>
      </div>

      {confirmPending ? (
        <div style={{ padding: '8px 10px', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 5, marginBottom: 8 }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: '#dc2626', marginBottom: 6 }}>Confirm actions</div>
          {confirmPending.unassigned.length > 0 && (
            <div style={{ fontSize: 11, color: TEXT_PRIMARY, marginBottom: 3 }}>
              Add {confirmPending.unassigned.length} lot{confirmPending.unassigned.length > 1 ? 's' : ''} from unassigned pool
            </div>
          )}
          {Object.entries(confirmPending.moves).map(([tdaId, lotIds]) => {
            const src = allTdas.find(t => t.tda_id === Number(tdaId))
            return (
              <div key={tdaId} style={{ fontSize: 11, color: '#dc2626', marginBottom: 3 }}>
                Move {lotIds.length} lot{lotIds.length > 1 ? 's' : ''} from <strong>{src?.tda_name || `TDA ${tdaId}`}</strong>
              </div>
            )
          })}
          <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
            <Btn variant="danger" onClick={() => doAdd(confirmPending.unassigned, confirmPending.moves)} disabled={applying} style={{ padding: '2px 8px', fontSize: 11 }}>
              {applying ? 'Working…' : 'Confirm & Add'}
            </Btn>
            <Btn onClick={() => setConfirmPending(null)} style={{ padding: '2px 8px', fontSize: 11 }}>Back</Btn>
          </div>
        </div>
      ) : (
        <>
          {sourceGroups.map(group => {
            const groupSelCount = group.lots.filter(l => addSelected.has(l.lot_id)).length
            return (
              <div key={group.key} style={{ marginBottom: 10 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4, flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 11, fontWeight: 600, color: TEXT_MUTED }}>{group.label}</span>
                  {group.isMove && (
                    <span style={{ fontSize: 10, padding: '1px 5px', borderRadius: 3, background: '#fef2f2', color: '#dc2626', border: '1px solid #fecaca' }}>
                      will move
                    </span>
                  )}
                  <span style={{ fontSize: 10, color: TEXT_MUTED }}>({group.lots.length})</span>
                  <button onClick={() => handleGroupAllNone(group.lots, group.key, group.isMove, group.tdaId, true)}
                    style={{ fontSize: 10, color: '#2563eb', background: 'none', border: 'none', cursor: 'pointer', padding: 0, marginLeft: 4 }}>All</button>
                  <button onClick={() => handleGroupAllNone(group.lots, group.key, group.isMove, group.tdaId, false)}
                    style={{ fontSize: 10, color: '#2563eb', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>None</button>
                  {groupSelCount > 0 && (
                    <span style={{ fontSize: 10, color: '#1d4ed8', fontWeight: 600 }}>{groupSelCount} selected</span>
                  )}
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                  {group.lots.map(lot => {
                    const isSel = addSelected.has(lot.lot_id)
                    return (
                      <div
                        key={lot.lot_id}
                        onClick={e => handleGroupPillClick(lot.lot_id, lot, group.key, group.lots, group.isMove, group.tdaId, e)}
                        title={lot.lot_number}
                        style={{
                          fontFamily: 'monospace', whiteSpace: 'pre',
                          padding: '3px 7px', borderRadius: 5, fontSize: 11,
                          cursor: 'pointer', userSelect: 'none',
                          border: `1.5px solid ${isSel ? (group.isMove ? '#dc2626' : '#2563eb') : '#d1d5db'}`,
                          background: isSel ? (group.isMove ? '#fef2f2' : '#eff6ff') : '#fff',
                          color: isSel ? (group.isMove ? '#dc2626' : '#1d4ed8') : TEXT_PRIMARY,
                          fontWeight: isSel ? 700 : 400,
                        }}
                      >
                        {pillLotNum(lot.lot_number)}
                      </div>
                    )
                  })}
                </div>
              </div>
            )
          })}

          {nSel > 0 && (
            <div style={{ display: 'flex', gap: 6, alignItems: 'center', paddingTop: 8, borderTop: `1px solid ${PANEL_BORDER}` }}>
              <Btn variant="primary" onClick={handleRequestAdd} style={{ padding: '3px 10px', fontSize: 11 }}>
                Add {nSel} lot{nSel > 1 ? 's' : ''}
              </Btn>
              <button onClick={() => setAddSelected(new Map())}
                style={{ fontSize: 11, color: TEXT_MUTED, background: 'none', border: 'none', cursor: 'pointer' }}>
                Clear selection
              </button>
            </div>
          )}
        </>
      )}
    </div>
  )
}

// ── Agreement card ─────────────────────────────────────────────────
function AgreementCard({ tda, allTdas, unassignedLots, builders, banks, onPatch, onAddCheckpoint, onPatchCheckpoint, onDeleteCheckpoint, onAddLots, onRemoveLots, onMoveLots, onEditLotDates, onAutoAssign, onAssignLot, buildingUnitCounts, onPatchLotDate }) {
  const ss = AGREEMENT_STATUS_STYLE[tda.status] || AGREEMENT_STATUS_STYLE.active

  const totalLots        = tda.lots?.length ?? 0
  const assignedToCp     = (tda.lots || []).filter(l => l.checkpoint_id).length
  const inPool           = totalLots - assignedToCp
  const totalRequired    = tda.checkpoints.length > 0
    ? Math.max(...tda.checkpoints.map(cp => cp.lots_required_cumulative || 0))
    : 0
  const ineligibleCount        = tda.ineligible_lot_count ?? 0
  const builderEligibleCount   = tda.builder_eligible_count ?? null
  const leadDays               = tda.checkpoint_lead_days ?? 16

  const datedCps    = tda.checkpoints.filter(cp => cp.sim_plan != null)
  const simAtRisk   = datedCps.length > 0 && datedCps.some(cp => cp.sim_plan < (cp.lots_required_cumulative || 0))
  const simOnTrack  = datedCps.length > 0 && datedCps.every(cp => cp.sim_plan >= (cp.lots_required_cumulative || 0))

  const SEL_STYLE = { fontSize: 11, padding: '2px 5px', borderRadius: 4, border: '1px solid #d1d5db', background: '#fff', cursor: 'pointer' }

  return (
    <div style={{ border: `1px solid ${PANEL_BORDER}`, borderRadius: 6, background: '#fff', overflow: 'hidden' }}>
      {/* Header */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 12, padding: '9px 16px',
        background: PANEL_HEADER_BG, borderBottom: `1px solid ${PANEL_BORDER}`, flexWrap: 'wrap',
      }}>
        <EditText
          value={tda.tda_name}
          onSave={v => v && onPatch({ tda_name: v })}
          style={{ fontWeight: 600, fontSize: 14, color: TEXT_PRIMARY, minWidth: 140 }}
        />
        <select
          value={tda.status || 'active'}
          onChange={e => onPatch({ status: e.target.value })}
          style={{
            fontSize: 12, padding: '2px 7px', borderRadius: 10,
            border: `1px solid ${ss.border}`, background: ss.bg, color: ss.color,
            fontWeight: 600, cursor: 'pointer',
          }}
        >
          {AGREEMENT_STATUS_OPTIONS.map(s => (
            <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</option>
          ))}
        </select>
        <span style={{ fontSize: 11, color: TEXT_MUTED }}
              title="Agreement anchor date — informational only, not used by the engine scheduler">
          Anchor:
        </span>
        <EditDate value={tda.anchor_date} onSave={v => onPatch({ anchor_date: v })} />
        {/* Builder — editable dropdown */}
        <span style={{ fontSize: 11, color: TEXT_MUTED }}>Builder:</span>
        <select
          value={tda.builder_id ?? ''}
          onChange={e => onPatch({ builder_id: e.target.value ? Number(e.target.value) : null })}
          style={{ ...SEL_STYLE, color: tda.builder_id ? '#0d9488' : TEXT_MUTED, fontWeight: tda.builder_id ? 600 : 400 }}
          title="Builder filter — engine only assigns HC dates to lots matching this builder. Leave blank for any builder."
        >
          <option value="">— any builder —</option>
          {(builders || []).map(b => <option key={b.builder_id} value={b.builder_id}>{b.builder_name.replace(' Homes', '')}</option>)}
        </select>
        {/* Bank — editable dropdown */}
        {banks && banks.length > 0 && (
          <>
            <span style={{ fontSize: 11, color: TEXT_MUTED }}>Bank:</span>
            <select
              value={tda.bank_id ?? ''}
              onChange={e => onPatch({ bank_id: e.target.value ? Number(e.target.value) : null })}
              style={{ ...SEL_STYLE, color: tda.bank_id ? '#6366f1' : TEXT_MUTED }}
              title="Lot bank — restricts which lots can be added to this agreement"
            >
              <option value="">— no bank —</option>
              {banks.map(b => <option key={b.bank_id} value={b.bank_id}>{b.bank_name}</option>)}
            </select>
          </>
        )}
        {/* Lot quota — editable; null means unlimited */}
        <span style={{ fontSize: 11, color: TEXT_MUTED }}
              title="Max HC hold assignments the engine will make. Counts actual HC holds, actual BLDR TDs, and locked projected HC dates. Lots with only a BLDR sim projection (date_td_projected) do not count against quota — they travel the BLDR path and need no HC hold.">Quota:</span>
        <EditNumber
          value={tda.lot_quota ?? null}
          nullable
          onSave={v => onPatch({ lot_quota: v != null && v > 0 ? v : null })}
        />
        {/* Checkpoint lead days — editable with next-hold preview */}
        <span style={{ fontSize: 11, color: TEXT_MUTED }} title="Days before each checkpoint date that HC hold dates are scheduled">Lead days:</span>
        <EditNumber value={leadDays} onSave={v => onPatch({ checkpoint_lead_days: v })} />
        {tda.checkpoints.length > 0 && (() => {
          const _now = new Date()
          const today = _now.getFullYear() + '-' + String(_now.getMonth() + 1).padStart(2, '0') + '-' + String(_now.getDate()).padStart(2, '0')
          const next  = tda.checkpoints.find(cp => cp.checkpoint_date && cp.checkpoint_date >= today)
            || tda.checkpoints[tda.checkpoints.length - 1]
          if (!next?.checkpoint_date) return null
          const holdDate = new Date(new Date(next.checkpoint_date + 'T00:00:00').getTime() - leadDays * 86400000)
            .toISOString().slice(0, 10)
          return (
            <span style={{ fontSize: 10, color: TEXT_MUTED, fontStyle: 'italic' }}
                  title={`Next checkpoint ${next.checkpoint_date} → HC hold ${holdDate}`}>
              → {holdDate}
            </span>
          )
        })()}
      </div>

      {/* Summary stats */}
      <div style={{
        display: 'flex', gap: 24, padding: '6px 16px 7px',
        background: '#f8fafc', borderBottom: `1px solid ${PANEL_BORDER}`, flexWrap: 'wrap',
      }}>
        {[
          { label: 'Total lots', value: totalLots, tip: null },
          { label: 'In checkpoint', value: assignedToCp, tip: null },
          { label: 'In pool', value: inPool, tip: null },
          { label: 'Total required', value: totalRequired, tip: null },
          ...(builderEligibleCount !== null ? [{ label: 'Builder match', value: builderEligibleCount, tip: `Lots in this TDA whose resolved builder matches the TDA's builder filter (${totalLots - builderEligibleCount} excluded)`, warn: builderEligibleCount < totalLots }] : []),
          ...(ineligibleCount > 0 ? [{ label: 'No dev date', value: ineligibleCount, tip: 'Lots the engine cannot schedule — they have no dev date yet. Run sim after dev dates are assigned.', warn: true }] : []),
          ...(datedCps.length > 0 ? [{ label: 'Sim', value: simAtRisk ? 'At Risk' : 'On Track', tip: 'Engine projection vs checkpoint requirements — run sim to update', warn: simAtRisk, ok: simOnTrack, isText: true }] : []),
        ].map(({ label, value, tip, warn, ok, isText }) => (
          <div key={label} title={tip || undefined} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', minWidth: 64, cursor: tip ? 'help' : undefined }}>
            <span style={{ fontSize: 9, color: warn ? '#b45309' : TEXT_MUTED, fontWeight: 600, letterSpacing: '0.04em', textTransform: 'uppercase' }}>{label}</span>
            {isText ? (
              <span style={{ fontSize: 12, fontWeight: 700, color: warn ? '#dc2626' : ok ? '#16a34a' : TEXT_MUTED, lineHeight: 1.2, paddingTop: 2 }}>
                {warn ? '✗ ' : ok ? '✓ ' : ''}{value}
              </span>
            ) : (
              <span style={{ fontSize: 18, fontWeight: 700, color: warn ? '#d97706' : TEXT_PRIMARY, lineHeight: 1.2, fontVariantNumeric: 'tabular-nums' }}>{value}</span>
            )}
          </div>
        ))}
      </div>

      <CheckpointsSection
        tda={tda}
        onPatchCheckpoint={onPatchCheckpoint}
        onAddCheckpoint={() => onAddCheckpoint(tda.tda_id)}
        onDeleteCheckpoint={onDeleteCheckpoint}
        onAutoAssign={onAutoAssign}
        onAssignLot={(lotId, cpId) => onAssignLot(tda.tda_id, lotId, cpId)}
        buildingUnitCounts={buildingUnitCounts}
        onPatchLotDate={onPatchLotDate}
        onRemoveLots={onRemoveLots}
      />

      <LotsSection
        tda={tda}
        allTdas={allTdas}
        unassignedLots={unassignedLots}
        onAddLots={onAddLots}
        onRemoveLots={onRemoveLots}
        onMoveLots={onMoveLots}
        onAutoAssign={onAutoAssign}
      />
    </div>
  )
}

// ── Monthly ledger tab ─────────────────────────────────────────────
function LedgerTab({ selectedId }) {
  const [ledger, setLedger] = useState(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!selectedId) return
    setLoading(true)
    fetch(`${API_BASE}/entitlement-groups/${selectedId}/tda-monthly-ledger`)
      .then(r => r.json())
      .then(d => { setLedger(d.ledger || []); setLoading(false) })
      .catch(() => setLoading(false))
  }, [selectedId])

  if (!selectedId) return <p style={{ color: TEXT_MUTED, fontSize: 14, marginTop: 20 }}>Select a community.</p>
  if (loading)     return <p style={{ color: TEXT_MUTED, fontSize: 14, marginTop: 20 }}>Loading…</p>
  if (!ledger)     return null
  if (ledger.length === 0) return <p style={{ color: TEXT_MUTED, fontSize: 14 }}>No TDA lots with scheduled dates.</p>

  const thS = { ...TH, background: '#f9fafb', position: 'sticky', top: 0 }

  let cumActual = 0, cumMarks = 0, cumBldr = 0, cumHc = 0
  const rows = ledger.map(r => {
    cumActual += r.actual     || 0
    cumMarks  += r.marks_plan || 0
    cumBldr   += r.bldr_proj  || 0
    cumHc     += r.hc_proj    || 0
    return { ...r, cumActual, cumMarks, cumBldr, cumHc }
  })

  // Use local time (not UTC) to avoid the UTC-midnight shift that would
  // mark the current month as past in negative-offset timezones near end-of-month.
  const _now = new Date()
  const today = _now.getFullYear() + '-' + String(_now.getMonth() + 1).padStart(2, '0')

  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ borderCollapse: 'collapse', fontSize: 12, width: '100%' }}>
        <thead>
          <tr>
            <th style={{ ...thS, minWidth: 80 }}>Month</th>
            <th style={{ ...thS, textAlign: 'right' }} title="Lots with actual MARKS takedown or HC hold date in this month and in the past">Taken Down</th>
            <th style={{ ...thS, textAlign: 'right' }} title="Lots with actual MARKS takedown or HC hold date in this month">MARKS Plan</th>
            <th style={{ ...thS, textAlign: 'right', color: '#2563eb' }} title="Lots with sim-projected BLDR date (date_td_projected, no actual date_td) in this month">BLDR Proj</th>
            <th style={{ ...thS, textAlign: 'right', color: '#0d9488' }} title="Lots with sim-projected HC date only (date_td_hold_projected, no BLDR path) in this month">HC Proj</th>
            <th style={{ ...thS, textAlign: 'right' }}>Cum. Taken</th>
            <th style={{ ...thS, textAlign: 'right' }}>Cum. MARKS</th>
            <th style={{ ...thS, textAlign: 'right', color: '#2563eb' }}>Cum. BLDR</th>
            <th style={{ ...thS, textAlign: 'right', color: '#0d9488' }}>Cum. HC</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(r => {
            const isPast    = r.month < today
            const isCurrent = r.month === today
            return (
              <tr key={r.month} style={{
                borderBottom: `1px solid ${PANEL_BORDER}`,
                background: isCurrent ? '#fffbeb' : isPast ? '#f9fafb' : '#fff',
              }}>
                <td style={{ ...TD, fontFamily: 'monospace', fontWeight: isCurrent ? 700 : 400 }}>{r.month}</td>
                <td style={{ ...TD, textAlign: 'right', color: r.actual > 0 ? '#15803d' : TEXT_MUTED, fontWeight: r.actual > 0 ? 600 : 400 }}>{r.actual || '—'}</td>
                <td style={{ ...TD, textAlign: 'right', color: TEXT_MUTED }}>{r.marks_plan || '—'}</td>
                <td style={{ ...TD, textAlign: 'right', color: r.bldr_proj > 0 ? '#2563eb' : TEXT_MUTED }}>{r.bldr_proj || '—'}</td>
                <td style={{ ...TD, textAlign: 'right', color: r.hc_proj > 0 ? '#0d9488' : TEXT_MUTED }}>{r.hc_proj || '—'}</td>
                <td style={{ ...TD, textAlign: 'right', color: TEXT_MUTED, fontVariantNumeric: 'tabular-nums' }}>{r.cumActual}</td>
                <td style={{ ...TD, textAlign: 'right', color: TEXT_MUTED, fontVariantNumeric: 'tabular-nums' }}>{r.cumMarks}</td>
                <td style={{ ...TD, textAlign: 'right', color: '#2563eb', fontVariantNumeric: 'tabular-nums' }}>{r.cumBldr}</td>
                <td style={{ ...TD, textAlign: 'right', color: '#0d9488', fontVariantNumeric: 'tabular-nums' }}>{r.cumHc}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

// ── Override popover ───────────────────────────────────────────────
function OverridePanel({ lot, dateField, onClose, onApplied }) {
  const [draft, setDraft]           = useState('')
  const [preview, setPreview]       = useState(null)
  const [applyGroup, setApplyGroup] = useState(false)
  const [applying, setApplying]     = useState(false)
  const [error, setError]           = useState('')
  const inputRef = useRef()

  useEffect(() => { if (inputRef.current) inputRef.current.focus() }, [])

  async function loadPreview(val) {
    if (!val) { setPreview(null); return }
    try {
      const r = await fetch(`${API_BASE}/overrides/preview`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lot_id: lot.lot_id, date_field: dateField, override_value: val }),
      })
      if (!r.ok) return
      setPreview(await r.json())
    } catch { /* ignore */ }
  }

  async function handleApply() {
    if (!draft || !preview) return
    setApplying(true); setError('')
    try {
      const changes = [
        { date_field: dateField, override_value: draft },
        ...preview.cascade
          .filter(c => c.proposed_value)
          .map(c => ({ date_field: c.date_field, override_value: c.proposed_value })),
      ]
      const r = await fetch(`${API_BASE}/overrides/apply`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lot_id: lot.lot_id, changes, apply_to_building_group: applyGroup }),
      })
      if (!r.ok) { setError('Apply failed'); setApplying(false); return }
      onApplied()
    } catch { setError('Apply failed'); setApplying(false) }
  }

  const _LABEL = { date_td_hold: 'HC', date_td: 'BLDR', date_str: 'DIG', date_frm: 'FRM', date_cmp: 'CMP', date_cls: 'CLS' }

  return (
    <div style={{
      marginTop: 6, padding: 12, border: `1px solid ${PANEL_BORDER}`, borderRadius: 6,
      background: '#f9fafb', position: 'relative',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <span style={{ fontSize: 12, fontWeight: 600, color: TEXT_PRIMARY }}>
          Set {_LABEL[dateField] || dateField} override — <span style={{ fontFamily: 'monospace', whiteSpace: 'pre' }}>{pillLotNum(lot.lot_number)}</span>
        </span>
        <button onClick={onClose} style={{ fontSize: 14, color: TEXT_MUTED, background: 'none', border: 'none', cursor: 'pointer' }}>×</button>
      </div>

      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 }}>
        <input
          ref={inputRef}
          type="date"
          value={draft}
          onChange={e => { setDraft(e.target.value); loadPreview(e.target.value) }}
          style={{ fontSize: 12, padding: '3px 6px', borderRadius: 4, border: '1px solid #d1d5db', ...greenEditorStyle }}
        />
        {lot.building_group_id && (
          <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, color: TEXT_PRIMARY, cursor: 'pointer' }}>
            <input type="checkbox" checked={applyGroup} onChange={e => setApplyGroup(e.target.checked)} />
            Apply to all units in building group
          </label>
        )}
      </div>

      {preview && (
        <div style={{ marginBottom: 8 }}>
          <div style={{ fontSize: 11, color: TEXT_MUTED, marginBottom: 4, fontWeight: 600 }}>CASCADE PREVIEW</div>
          <table style={{ fontSize: 11, borderCollapse: 'collapse', width: '100%' }}>
            <thead>
              <tr>
                {['Field', 'Current', 'Proposed'].map(h => (
                  <th key={h} style={{ ...TH, fontSize: 10, padding: '2px 6px' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              <tr style={{ background: '#eff6ff' }}>
                <td style={{ ...TD, padding: '2px 6px', fontWeight: 600 }}>{_LABEL[dateField]}</td>
                <td style={{ ...TD, padding: '2px 6px', color: TEXT_MUTED }}>{preview.current_value || '—'}</td>
                <td style={{ ...TD, padding: '2px 6px', color: '#2563eb', fontWeight: 600 }}>{draft}</td>
              </tr>
              {preview.cascade.filter(c => c.proposed_value).map(c => (
                <tr key={c.date_field} style={{ borderTop: `1px solid ${PANEL_BORDER}` }}>
                  <td style={{ ...TD, padding: '2px 6px' }}>{c.label}</td>
                  <td style={{ ...TD, padding: '2px 6px', color: TEXT_MUTED }}>{c.current_value || '—'}</td>
                  <td style={{ ...TD, padding: '2px 6px', color: c.source === 'shifted' ? TEXT_PRIMARY : '#9ca3af' }}>
                    {c.proposed_value}
                    {c.delta_days !== null && c.delta_days !== undefined &&
                      <span style={{ color: TEXT_MUTED, marginLeft: 4 }}>({c.delta_days > 0 ? '+' : ''}{c.delta_days}d)</span>
                    }
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {error && <div style={{ fontSize: 11, color: '#dc2626', marginBottom: 6 }}>{error}</div>}

      <div style={{ display: 'flex', gap: 6 }}>
        <Btn variant="primary" onClick={handleApply} disabled={!draft || !preview || applying}>
          {applying ? 'Applying…' : 'Apply Override'}
        </Btn>
        <Btn onClick={onClose}>Cancel</Btn>
      </div>
    </div>
  )
}

// ── Lots tab ───────────────────────────────────────────────────────
function LotsTab({ selectedId, data, onReload }) {
  const [overrideMap, setOverrideMap] = useState({})
  const [activeOverride, setActiveOverride] = useState(null)
  const [clearConfirm, setClearConfirm] = useState(null)

  useEffect(() => {
    if (!selectedId) return
    fetch(`${API_BASE}/overrides?ent_group_id=${selectedId}`)
      .then(r => r.json())
      .then(rows => {
        const map = {}
        for (const r of rows) {
          if (!map[r.lot_id]) map[r.lot_id] = {}
          map[r.lot_id][r.date_field] = r.override_value
        }
        setOverrideMap(map)
      })
      .catch(() => {})
  }, [selectedId, data])

  if (!selectedId) return <p style={{ color: TEXT_MUTED, fontSize: 14, marginTop: 20 }}>Select a community.</p>
  if (!data) return null

  const lotMap = new Map()
  for (const tda of (data.agreements || [])) {
    for (const lot of (tda.lots || [])) {
      if (!lotMap.has(lot.lot_id)) {
        lotMap.set(lot.lot_id, { ...lot, tda_name: tda.tda_name, tda_id: tda.tda_id })
      }
    }
  }
  const lots = [...lotMap.values()].sort((a, b) => (a.lot_number ?? '').localeCompare(b.lot_number ?? ''))

  if (lots.length === 0) {
    return <p style={{ color: TEXT_MUTED, fontSize: 14 }}>No lots in any agreement for this community.</p>
  }

  async function handleClearAll(lotId) {
    await fetch(`${API_BASE}/overrides/clear-batch`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ lot_ids: [lotId] }),
    })
    setClearConfirm(null)
    onReload()
  }

  const thS = { ...TH, background: '#f9fafb', position: 'sticky', top: 0, zIndex: 1 }

  function dateCell(lot, field, label, marksKey, projKey) {
    const overrides = overrideMap[lot.lot_id] || {}
    const overrideVal = overrides[field]
    const marksVal = lot[marksKey]
    const projVal = lot[projKey]
    const isActive = activeOverride?.lot_id === lot.lot_id && activeOverride?.date_field === field

    const displayVal = marksVal || overrideVal || projVal
    const isOverride = !!overrideVal && !marksVal

    return (
      <td key={field} style={TD}>
        {marksVal ? (
          <span style={{ fontSize: 11, color: TEXT_MUTED, fontStyle: 'italic' }}>{marksVal}</span>
        ) : (
          <span
            onClick={() => setActiveOverride(isActive ? null : { lot_id: lot.lot_id, date_field: field })}
            style={{
              fontSize: 11, cursor: 'pointer',
              color: isOverride ? '#2563eb' : (displayVal ? TEXT_PRIMARY : TEXT_MUTED),
              fontStyle: isOverride ? 'italic' : 'normal',
              borderBottom: '1px dashed ' + (isActive ? '#2563eb' : '#d1d5db'),
            }}
            title={isOverride ? `Override: ${overrideVal}` : 'Click to set override'}
          >
            {displayVal || '—'}
          </span>
        )}
      </td>
    )
  }

  return (
    <div>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ borderCollapse: 'collapse', fontSize: 12, width: '100%' }}>
          <thead>
            <tr>
              <th style={{ ...thS, minWidth: 90 }}>Lot</th>
              <th style={thS}>Type</th>
              <th style={thS}>Bldg</th>
              <th style={thS}>Agreement</th>
              <th style={thS}>Checkpoint</th>
              <th style={{ ...thS, color: '#0d9488' }}>HC</th>
              <th style={{ ...thS, color: '#0d9488' }}>BLDR</th>
              <th style={{ ...thS, color: '#0d9488' }}>DIG</th>
              <th style={thS}></th>
            </tr>
          </thead>
          <tbody>
            {lots.map(lot => {
              const hasOverrides = Object.keys(overrideMap[lot.lot_id] || {}).length > 0
              const isAnyActive = activeOverride?.lot_id === lot.lot_id
              return (
                <>
                  <tr key={lot.lot_id} style={{
                    borderBottom: isAnyActive ? 'none' : `1px solid ${PANEL_BORDER}`,
                    background: isAnyActive ? '#f0f9ff' : (hasOverrides ? '#fefce8' : '#fff'),
                  }}>
                    <td style={{ ...TD, fontFamily: 'monospace', whiteSpace: 'pre', fontWeight: 500 }}>{pillLotNum(lot.lot_number)}</td>
                    <td style={{ ...TD, color: TEXT_MUTED }}>{lot.lot_type_short || '—'}</td>
                    <td style={{ ...TD, color: TEXT_MUTED }}>
                      {lot.building_name ? lot.building_name.replace('Building ', 'B') : '—'}
                    </td>
                    <td style={{ ...TD, fontSize: 11, color: TEXT_MUTED }}>{lot.tda_name}</td>
                    <td style={{ ...TD, fontSize: 11, color: lot.checkpoint_id ? TEXT_PRIMARY : TEXT_MUTED }}>
                      {lot.checkpoint_id
                        ? cpLabel({ lots_required_cumulative: lot.lots_required_cumulative, checkpoint_date: lot.checkpoint_date, checkpoint_number: lot.checkpoint_number })
                        : 'Unassigned'}
                    </td>

                    {dateCell(lot, 'date_td_hold', 'HC', 'hc_marks_date', 'hc_projected_date')}
                    {dateCell(lot, 'date_td', 'BLDR', 'bldr_marks_date', 'bldr_projected_date')}
                    <td style={TD}><span style={{ fontSize: 11, color: TEXT_MUTED }}>—</span></td>

                    <td style={{ ...TD, textAlign: 'right' }}>
                      {hasOverrides && (
                        clearConfirm === lot.lot_id ? (
                          <span style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}>
                            <span style={{ fontSize: 10, color: '#dc2626' }}>Clear all overrides?</span>
                            <Btn variant="danger" style={{ padding: '1px 6px', fontSize: 10 }}
                              onClick={() => handleClearAll(lot.lot_id)}>Yes</Btn>
                            <Btn style={{ padding: '1px 6px', fontSize: 10 }}
                              onClick={() => setClearConfirm(null)}>No</Btn>
                          </span>
                        ) : (
                          <button onClick={() => setClearConfirm(lot.lot_id)}
                            style={{ fontSize: 11, color: '#dc2626', background: 'none', border: 'none', cursor: 'pointer', padding: '1px 4px' }}
                            title="Clear all user overrides for this lot">
                            Clear All
                          </button>
                        )
                      )}
                    </td>
                  </tr>

                  {isAnyActive && (
                    <tr key={`${lot.lot_id}_panel`} style={{ borderBottom: `1px solid ${PANEL_BORDER}` }}>
                      <td colSpan={9} style={{ padding: '0 12px 8px' }}>
                        <OverridePanel
                          lot={lot}
                          dateField={activeOverride.date_field}
                          onClose={() => setActiveOverride(null)}
                          onApplied={() => { setActiveOverride(null); onReload() }}
                        />
                      </td>
                    </tr>
                  )}
                </>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ── Checklist tab ──────────────────────────────────────────────────
const CHECKLIST_COLORS = [
  '#f59e0b', '#3b82f6', '#8b5cf6', '#ec4899',
  '#ef4444', '#10b981', '#f97316', '#06b6d4',
  '#84cc16', '#6366f1',
]

function ChecklistTab({ showTestCommunities }) {
  const [items, setItems]             = useState(null)
  const [loading, setLoading]         = useState(false)
  const [filter, setFilter]           = useState('all')
  const [collapsed, setCollapsed]     = useState({})
  const [activeOverride, setActiveOverride] = useState(null)

  const reload = useCallback(() => {
    setLoading(true)
    const q = showTestCommunities ? 'show_test=true' : 'show_test=false'
    fetch(`${API_BASE}/tda-checklist?${q}`)
      .then(r => r.json())
      .then(d => { setItems(d.items || []); setLoading(false) })
      .catch(() => setLoading(false))
  }, [showTestCommunities])

  useEffect(() => { reload() }, [reload])

  if (loading) return <p style={{ color: TEXT_MUTED, fontSize: 14, marginTop: 20 }}>Loading checklist…</p>
  if (!items)  return null

  const allEgIds = [...new Set(items.map(i => i.ent_group_id))]
  const colorMap = {}
  allEgIds.forEach((id, idx) => { colorMap[id] = CHECKLIST_COLORS[idx % CHECKLIST_COLORS.length] })

  const filtered = filter === 'all' ? items
    : filter === 'closed' ? items.filter(i => i.status === 'closed')
    : items.filter(i => i.status !== 'closed')

  // Build per-checkpoint required count (delta from previous cumulative) using all items (unfiltered).
  // Must group by tda_id (not ent_group_id): communities with multiple TDAs have independent
  // cumulative sequences. Grouping by community mixes them, producing negative deltas when
  // a second TDA's CP has a lower lots_required_cumulative than the first TDA's CP.
  const perRequiredMap = new Map()
  {
    const tdaCheckpoints = new Map()
    for (const item of items) {
      if (!item.checkpoint_id) continue
      if (!tdaCheckpoints.has(item.tda_id)) tdaCheckpoints.set(item.tda_id, new Map())
      const cpMap = tdaCheckpoints.get(item.tda_id)
      if (!cpMap.has(item.checkpoint_id)) {
        cpMap.set(item.checkpoint_id, { lots_required_cumulative: item.lots_required_cumulative || 0, checkpoint_date: item.checkpoint_date })
      }
    }
    for (const [, cpMap] of tdaCheckpoints) {
      // Sort NULLS LAST to match DB (ORDER BY checkpoint_date ASC NULLS LAST).
      // Using empty string '' for null would sort undated CPs first, producing
      // negative delta values when an undated CP has lower lots_required_cumulative
      // than a later dated CP.
      const sorted = [...cpMap.entries()].sort((a, b) => (a[1].checkpoint_date || '9999-99-99').localeCompare(b[1].checkpoint_date || '9999-99-99'))
      let prevCum = 0
      for (const [cpId, cp] of sorted) {
        perRequiredMap.set(cpId, cp.lots_required_cumulative - prevCum)
        prevCum = cp.lots_required_cumulative
      }
    }
  }

  // Group filtered items by month → checkpoint (one block per checkpoint, not per community)
  const monthGroups = new Map()
  for (const item of filtered) {
    const monthKey = item.checkpoint_date ? item.checkpoint_date.slice(0, 7) : 'no-date'
    const cpKey    = item.checkpoint_id ? String(item.checkpoint_id) : `eg_${item.ent_group_id}`
    if (!monthGroups.has(monthKey)) monthGroups.set(monthKey, new Map())
    const cg = monthGroups.get(monthKey)
    if (!cg.has(cpKey)) {
      cg.set(cpKey, {
        ent_group_id: item.ent_group_id,
        ent_group_name: item.ent_group_name,
        tda_id: item.tda_id,
        tda_name: item.tda_name,
        checkpoint_date: item.checkpoint_date,
        checkpoint_id: item.checkpoint_id,
        lots_required_cumulative: item.lots_required_cumulative,
        items: [],
      })
    }
    cg.get(cpKey).items.push(item)
  }

  function toggleCollapse(key) {
    setCollapsed(prev => ({ ...prev, [key]: !prev[key] }))
  }

  function monthLabel(key) {
    if (key === 'no-date') return 'No Deadline'
    const [y, m] = key.split('-')
    return new Date(Number(y), Number(m) - 1, 1).toLocaleString('en-US', { month: 'long', year: 'numeric' })
  }

  const visibleEgIds = new Set(filtered.map(i => i.ent_group_id))

  return (
    <div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 16, alignItems: 'center' }}>
        <span style={{ fontSize: 11, color: TEXT_MUTED, fontWeight: 600, marginRight: 2 }}>SHOW</span>
        {['all', 'open', 'closed'].map(f => (
          <button key={f} onClick={() => setFilter(f)} style={{
            fontSize: 11, padding: '3px 12px', borderRadius: 12,
            border: `1px solid ${filter === f ? '#2563eb' : '#d1d5db'}`,
            background: filter === f ? '#eff6ff' : '#fff',
            color: filter === f ? '#2563eb' : TEXT_MUTED,
            cursor: 'pointer', fontWeight: filter === f ? 600 : 400,
          }}>
            {f.charAt(0).toUpperCase() + f.slice(1)}
          </button>
        ))}
        <span style={{ marginLeft: 'auto', fontSize: 11, color: TEXT_MUTED }}>
          {filtered.length} lots · {visibleEgIds.size} communities
        </span>
      </div>

      {filtered.length === 0 && (
        <p style={{ color: TEXT_MUTED, fontSize: 14 }}>No items match the current filter.</p>
      )}

      {[...monthGroups.entries()].map(([monthKey, commGroup]) => {
        const monthCollapsed = collapsed[monthKey]
        const monthTotal  = [...commGroup.values()].reduce((s, g) => {
          const pr = perRequiredMap.has(g.checkpoint_id) ? perRequiredMap.get(g.checkpoint_id) : (g.lots_required_cumulative || 0)
          return s + Math.max(pr, g.items.length)
        }, 0)
        const monthClosed = [...commGroup.values()].reduce((s, g) => s + g.items.filter(i => i.status === 'closed').length, 0)

        return (
          <div key={monthKey} style={{ marginBottom: 20 }}>
            <div
              onClick={() => toggleCollapse(monthKey)}
              style={{
                display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer',
                padding: '7px 14px', background: '#1e293b', borderRadius: 5,
                marginBottom: monthCollapsed ? 0 : 10,
              }}
            >
              <span style={{ fontSize: 13, fontWeight: 700, color: '#fff' }}>{monthLabel(monthKey)}</span>
              <span style={{ fontSize: 11, color: '#94a3b8', marginLeft: 'auto' }}>
                {monthClosed}/{monthTotal} closed
              </span>
              <span style={{ fontSize: 10, color: '#64748b', marginLeft: 4 }}>{monthCollapsed ? '▶' : '▼'}</span>
            </div>

            {!monthCollapsed && (
              <div style={{ paddingLeft: 8 }}>
                {[...commGroup.values()].map(group => {
                  const groupKey      = `${monthKey}_${group.checkpoint_id || group.ent_group_id}`
                  const groupCollapsed = collapsed[groupKey]
                  const color         = colorMap[group.ent_group_id] || '#6b7280'
                  const closedCount   = group.items.filter(i => i.status === 'closed').length
                  const perRequired   = perRequiredMap.has(group.checkpoint_id)
                    ? perRequiredMap.get(group.checkpoint_id)
                    : (group.lots_required_cumulative || 0)
                  const slotCount     = Math.max(perRequired, group.items.length)
                  const reqMet        = perRequired > 0 && closedCount >= perRequired

                  return (
                    <div key={groupKey} style={{ marginBottom: 6 }}>
                      <div
                        onClick={() => toggleCollapse(groupKey)}
                        style={{
                          display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer',
                          padding: '5px 10px',
                          background: color + '22',
                          borderLeft: `4px solid ${color}`,
                          borderRadius: '0 4px 4px 0',
                          marginBottom: groupCollapsed ? 0 : 2,
                        }}
                      >
                        <span style={{ fontSize: 12, fontWeight: 700, color: '#1e293b' }}>
                          {group.ent_group_name}
                          {group.tda_name && (
                            <span style={{ fontSize: 10, fontWeight: 500, color: '#475569', marginLeft: 6 }}>
                              · {group.tda_name}
                            </span>
                          )}
                        </span>
                        <span style={{ fontSize: 10, color: TEXT_MUTED }}>
                          {closedCount} of {slotCount} closed
                        </span>
                        {perRequired > 0 && (
                          <span style={{
                            fontSize: 10, padding: '1px 7px', borderRadius: 8, fontWeight: 600,
                            background: reqMet ? '#f0fdf4' : '#fef2f2',
                            color: reqMet ? '#15803d' : '#dc2626',
                            border: `1px solid ${reqMet ? '#bbf7d0' : '#fecaca'}`,
                          }}>
                            {closedCount}/{perRequired} req
                          </span>
                        )}
                        <span style={{ fontSize: 10, color: TEXT_MUTED, marginLeft: 'auto' }}>
                          {groupCollapsed ? '▶' : '▼'}
                        </span>
                      </div>

                      {!groupCollapsed && (
                        <div>
                          {Array.from({ length: slotCount }, (_, i) => {
                            const item = group.items[i] ?? null
                            const isClosed = item?.status === 'closed'
                            const isOverrideActive = item && activeOverride?.lot_id === item.lot_id

                            return (
                              <div key={item ? item.lot_id : `slot_${group.checkpoint_id}_${i}`}>
                                <div style={{
                                  display: 'flex', alignItems: 'center', gap: 8,
                                  padding: '4px 10px 4px 12px',
                                  borderLeft: `4px solid ${color}44`,
                                  background: item
                                    ? (isClosed ? '#f0fdf4' : item.status === 'projected' ? '#f0f9ff' : '#fff')
                                    : '#f9fafb',
                                  borderBottom: `1px solid ${PANEL_BORDER}`,
                                }}>
                                  <span style={{ fontSize: 13, width: 16, textAlign: 'center', flexShrink: 0,
                                    color: isClosed ? '#16a34a' : '#d1d5db' }}>
                                    {isClosed ? '✓' : '○'}
                                  </span>
                                  {item ? (
                                    <>
                                      <span style={{ fontFamily: 'monospace', whiteSpace: 'pre', fontSize: 11, color: TEXT_PRIMARY, minWidth: 80 }}>
                                        {pillLotNum(item.lot_number)}
                                      </span>
                                      {item.lot_type_short && (
                                        <span style={{ fontSize: 10, color: TEXT_MUTED, minWidth: 32 }}>
                                          {item.lot_type_short}
                                        </span>
                                      )}
                                      {item.building_name && (
                                        <span style={{ fontSize: 10, color: TEXT_MUTED, fontFamily: 'monospace' }}>
                                          {item.building_name.replace('Building ', 'B')}
                                        </span>
                                      )}
                                      <span style={{ marginLeft: 'auto', fontSize: 11 }}>
                                        {isClosed ? (
                                          <span style={{ color: '#16a34a', fontStyle: 'italic' }}>{item.display_date}</span>
                                        ) : (() => {
                                          // HC-path projected lots (only date_td_hold_projected set) must
                                          // target date_td_hold so the override sets the HC field, not BLDR.
                                          const overrideField = (!item.date_td && !item.date_td_hold && !item.date_td_projected && item.date_td_hold_projected)
                                            ? 'date_td_hold'
                                            : 'date_td'
                                          return item.display_date ? (
                                            <span
                                              onClick={() => setActiveOverride(isOverrideActive ? null : { lot_id: item.lot_id, date_field: overrideField, lot: item })}
                                              style={{ color: '#2563eb', cursor: 'pointer', borderBottom: '1px dashed #93c5fd' }}
                                              title="Click to set override"
                                            >
                                              {item.display_date}
                                            </span>
                                          ) : (
                                            <span
                                              onClick={() => setActiveOverride(isOverrideActive ? null : { lot_id: item.lot_id, date_field: overrideField, lot: item })}
                                              style={{ color: TEXT_MUTED, cursor: 'pointer', borderBottom: '1px dashed #e5e7eb' }}
                                              title="Click to set takedown override"
                                            >
                                              —
                                            </span>
                                          )
                                        })()}
                                      </span>
                                    </>
                                  ) : (
                                    <span style={{ fontFamily: 'monospace', fontSize: 11, color: '#d1d5db' }}>
                                      — open slot —
                                    </span>
                                  )}
                                </div>

                                {isOverrideActive && item && (
                                  <div style={{ borderLeft: `4px solid ${color}44`, padding: '0 12px 8px' }}>
                                    <OverridePanel
                                      lot={activeOverride.lot}
                                      dateField={activeOverride.date_field}
                                      onClose={() => setActiveOverride(null)}
                                      onApplied={() => { setActiveOverride(null); reload() }}
                                    />
                                  </div>
                                )}
                              </div>
                            )
                          })}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

// ── TDA pill tabs ──────────────────────────────────────────────────
function TdaPillTabs({ agreements, activeId, onSelect }) {
  if (!agreements || agreements.length === 0) return null
  return (
    <div style={{
      display: 'flex', flexWrap: 'wrap', gap: 6, padding: '10px 0 12px',
    }}>
      {agreements.map(tda => {
        const isActive = tda.tda_id === activeId
        const ss = AGREEMENT_STATUS_STYLE[tda.status] || AGREEMENT_STATUS_STYLE.active
        const nLots = tda.lots?.length ?? 0
        return (
          <button
            key={tda.tda_id}
            onClick={() => onSelect(tda.tda_id)}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 6,
              padding: '5px 12px', borderRadius: 20,
              border: `1.5px solid ${isActive ? '#2563eb' : '#d1d5db'}`,
              background: isActive ? '#eff6ff' : '#fff',
              color: isActive ? '#1d4ed8' : TEXT_PRIMARY,
              fontWeight: isActive ? 700 : 500,
              fontSize: 12, cursor: 'pointer',
              boxShadow: isActive ? '0 1px 3px rgba(37,99,235,0.15)' : 'none',
            }}
          >
            {tda.tda_name}
            {tda.builder_name && (
              <span style={{ fontSize: 10, color: isActive ? '#0d9488' : '#6b7280', fontWeight: 600 }}>
                {tda.builder_name.replace(' Homes', '')}
              </span>
            )}
            <span style={{
              fontSize: 10, padding: '1px 6px', borderRadius: 8, fontWeight: 600,
              background: ss.bg, color: ss.color, border: `1px solid ${ss.border}`,
            }}>
              {tda.status}
            </span>
            {tda.lot_quota != null && (
              <span style={{ fontSize: 10, color: isActive ? '#3b82f6' : TEXT_MUTED }}>
                {nLots}/{tda.lot_quota}
              </span>
            )}
            {tda.lot_quota == null && nLots > 0 && (
              <span style={{ fontSize: 10, color: isActive ? '#3b82f6' : TEXT_MUTED }}>
                {nLots}
              </span>
            )}
          </button>
        )
      })}
    </div>
  )
}

// ── Main view ──────────────────────────────────────────────────────
export default function TakedownView({ showTestCommunities }) {
  const [communities, setCommunities] = useState([])
  const [search, setSearch]           = useState('')
  const [selectedId, setSelectedId]   = useState(() => {
    try { return Number(localStorage.getItem('devdb_tda_community')) || null } catch { return null }
  })
  const [activeTab, setActiveTab] = useState('agreements')
  const [activeTdaId, setActiveTdaId] = useState(null)   // which TDA pill is active
  const [data, setData]     = useState(null)
  const [loading, setLoading] = useState(false)
  const [showNewForm, setShowNewForm] = useState(false)
  const [newName, setNewName]         = useState('')
  const [newBankId, setNewBankId]     = useState('')
  const [newBuilderId, setNewBuilderId] = useState('')
  const [newLotQuota, setNewLotQuota] = useState('')
  const [simRunning, setSimRunning]   = useState(false)
  const [simLastRunAt, setSimLastRunAt] = useState(null)   // Date.now() after each run
  const [simGaps, setSimGaps]         = useState([])       // residual gaps from last run
  const [simError, setSimError]       = useState(null)     // error message from last run

  // Load community list
  useEffect(() => {
    fetch(`${API_BASE}/entitlement-groups`)
      .then(r => r.json())
      .then(rows => {
        const filtered = Array.isArray(rows)
          ? rows.filter(r => showTestCommunities ? r.is_test : !r.is_test)
          : []
        setCommunities(filtered)
      })
      .catch(() => {})
  }, [showTestCommunities]) // eslint-disable-line react-hooks/exhaustive-deps

  // Persist selection
  useEffect(() => {
    if (selectedId) {
      try { localStorage.setItem('devdb_tda_community', String(selectedId)) } catch {}
    }
  }, [selectedId])

  // Load overview data
  const load = useCallback(() => {
    if (!selectedId) return
    setLoading(true)
    fetch(`${API_BASE}/entitlement-groups/${selectedId}/tda-overview`)
      .then(r => r.json())
      .then(d => {
        setData(d)
        setLoading(false)
        // Auto-select first active TDA if none selected or current one is gone
        setActiveTdaId(prev => {
          const agreements = d.agreements || []
          if (!prev || !agreements.find(a => a.tda_id === prev)) {
            const first = agreements.find(a => a.status === 'active') || agreements[0]
            return first?.tda_id ?? null
          }
          return prev
        })
      })
      .catch(() => setLoading(false))
  }, [selectedId])

  useEffect(() => { load() }, [load])

  // Reset active TDA + sim state when community changes
  useEffect(() => { setActiveTdaId(null); setSimGaps([]); setSimLastRunAt(null); setSimError(null) }, [selectedId])

  // ── Mutations ──────────────────────────────────────────────────────

  async function runSim() {
    if (!selectedId || simRunning) return
    setSimRunning(true)
    setSimGaps([])
    setSimError(null)
    try {
      const resp = await fetch(`${API_BASE}/simulations/run`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ent_group_id: selectedId }),
      })
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({}))
        throw new Error(err.detail || `HTTP ${resp.status}`)
      }
      const result = await resp.json()
      setSimGaps(result.tda_gaps || [])
      setSimLastRunAt(Date.now())
      load()
    } catch (e) {
      setSimError(e.message || 'Simulation failed')
    }
    setSimRunning(false)
  }

  function resetNewForm() {
    setNewName(''); setNewBankId(''); setNewBuilderId(''); setNewLotQuota(''); setShowNewForm(false)
  }

  async function createAgreement() {
    const name = newName.trim()
    if (!name || !selectedId) return
    const body = { tda_name: name, ent_group_id: selectedId }
    if (newBankId)    body.bank_id    = Number(newBankId)
    if (newBuilderId) body.builder_id = Number(newBuilderId)
    if (newLotQuota)  body.lot_quota  = Number(newLotQuota)
    const resp = await fetch(`${API_BASE}/takedown-agreements`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    const created = await resp.json()
    resetNewForm()
    setActiveTdaId(created.tda_id)
    load()
  }

  async function patchAgreement(tdaId, patch) {
    await fetch(`${API_BASE}/takedown-agreements/${tdaId}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    })
    load()
  }

  async function addCheckpoint(tdaId) {
    await fetch(`${API_BASE}/takedown-agreements/${tdaId}/checkpoints`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ checkpoint_date: null, lots_required_cumulative: 0 }),
    })
    load()
  }

  async function patchCheckpoint(cpId, patch) {
    await fetch(`${API_BASE}/tda-checkpoints/${cpId}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    })
    load()
  }

  async function deleteCheckpoint(cpId) {
    await fetch(`${API_BASE}/tda-checkpoints/${cpId}`, { method: 'DELETE' })
    load()
  }

  async function autoAssign(tdaId) {
    const resp = await fetch(`${API_BASE}/takedown-agreements/${tdaId}/auto-assign`, { method: 'POST' })
    const result = await resp.json().catch(() => ({}))
    load()
    return result
  }

  async function addLots(tdaId, lotIds) {
    await Promise.all(lotIds.map(id =>
      fetch(`${API_BASE}/takedown-agreements/${tdaId}/lots/${id}/pool`, { method: 'POST' })
    ))
    load()
  }

  async function removeLots(tdaId, lotIds) {
    await Promise.all(lotIds.map(id =>
      fetch(`${API_BASE}/takedown-agreements/${tdaId}/lots/${id}/pool`, { method: 'DELETE' })
    ))
    load()
  }

  async function moveLots(fromTdaId, lotIds, targetTdaId) {
    await fetch(`${API_BASE}/takedown-agreements/${fromTdaId}/lots/move`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ lot_ids: lotIds, target_tda_id: targetTdaId }),
    })
    load()
  }

  async function editLotDates(lotId, patch) {
    await fetch(`${API_BASE}/tda-lots/${lotId}/dates`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    })
    load()
  }

  async function assignLot(tdaId, lotId, checkpointId) {
    await fetch(`${API_BASE}/takedown-agreements/${tdaId}/lots/${lotId}/assign`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ checkpoint_id: checkpointId }),
    })
    load()
  }

  // ── Filtered community list ────────────────────────────────────────
  const visibleCommunities = search
    ? communities.filter(c => c.ent_group_name.toLowerCase().includes(search.toLowerCase()))
    : communities

  // ── Tab header style ───────────────────────────────────────────────
  function tabStyle(tab) {
    const active = tab === activeTab
    return {
      padding: '6px 16px', fontSize: 12, fontWeight: active ? 700 : 500, cursor: 'pointer',
      background: 'none', border: 'none',
      borderBottom: active ? '2px solid #2563eb' : '2px solid transparent',
      color: active ? '#2563eb' : TEXT_MUTED,
    }
  }

  // Active TDA object
  const activeTda = data?.agreements?.find(a => a.tda_id === activeTdaId)

  // ── Render ─────────────────────────────────────────────────────────
  return (
    <div style={{ display: 'flex', height: 'calc(100vh - 44px)', overflow: 'hidden' }}>
      <style>{`@keyframes tda-fadeout { from { opacity: 1 } to { opacity: 0; pointer-events: none } }`}</style>

      {/* ── Left sidebar ── */}
      <div style={{
        width: 260, flexShrink: 0,
        borderRight: '1px solid #e5e7eb',
        display: 'flex', flexDirection: 'column',
        background: '#fafafa',
      }}>
        <div style={{ padding: '12px 12px 8px', borderBottom: '1px solid #e5e7eb' }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: '#1e293b', marginBottom: 8 }}>
            Takedown Agreements
          </div>
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search communities…"
            style={{
              width: '100%', fontSize: 11, padding: '4px 8px', borderRadius: 4,
              border: '1px solid #d1d5db', background: '#fff', outline: 'none',
              boxSizing: 'border-box',
            }}
          />
        </div>

        <div style={{ flex: 1, overflowY: 'auto' }}>
          {visibleCommunities.length === 0 && (
            <div style={{ padding: 16, fontSize: 11, color: '#9ca3af', textAlign: 'center' }}>No matches.</div>
          )}
          {visibleCommunities.map(c => {
            const isSel = c.ent_group_id === selectedId
            return (
              <div
                key={c.ent_group_id}
                onClick={() => { setData(null); setSelectedId(c.ent_group_id) }}
                style={{
                  display: 'flex', alignItems: 'center', gap: 8,
                  padding: '7px 12px', cursor: 'pointer', userSelect: 'none',
                  borderLeft: isSel ? '3px solid #2563eb' : '3px solid transparent',
                  background: isSel ? '#eff6ff' : 'transparent',
                  borderBottom: '1px solid #f1f5f9',
                }}
              >
                <span style={{ fontSize: 12, color: isSel ? '#1d4ed8' : '#374151', flex: 1, lineHeight: 1.3 }}>
                  {c.ent_group_name}
                </span>
              </div>
            )
          })}
        </div>
      </div>

      {/* ── Right panel ── */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', background: '#f9fafb' }}>

        {/* Tab bar */}
        <div style={{ display: 'flex', alignItems: 'center', borderBottom: `1px solid ${PANEL_BORDER}`, background: '#fff', flexShrink: 0 }}>
          <button style={tabStyle('agreements')} onClick={() => setActiveTab('agreements')}>Agreements</button>
          <button style={tabStyle('ledger')}     onClick={() => setActiveTab('ledger')}>Ledger</button>
          <button style={tabStyle('lots')}       onClick={() => setActiveTab('lots')}>Lots</button>
          <button style={tabStyle('checklist')}  onClick={() => setActiveTab('checklist')}>Checklist</button>
          {selectedId && (
            <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8, padding: '0 16px' }}>
              {simLastRunAt && (
                <span style={{ fontSize: 10, color: TEXT_MUTED, fontStyle: 'italic' }}>
                  ran {new Date(simLastRunAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </span>
              )}
              <button
                onClick={runSim}
                disabled={simRunning}
                style={{
                  fontSize: 11, padding: '3px 12px', borderRadius: 4,
                  border: '1px solid #2563eb', background: simRunning ? '#eff6ff' : '#2563eb',
                  color: simRunning ? '#2563eb' : '#fff', fontWeight: 600, cursor: simRunning ? 'default' : 'pointer',
                }}
              >
                {simRunning ? 'Running…' : 'Run Sim'}
              </button>
            </div>
          )}
        </div>

        {/* Tab body */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '16px 24px' }}>

          {!selectedId && (
            <p style={{ color: TEXT_MUTED, fontSize: 14, marginTop: 20 }}>
              Select a community to view its takedown agreements.
            </p>
          )}

          {selectedId && loading && (
            <p style={{ color: TEXT_MUTED, fontSize: 14, marginTop: 20 }}>Loading…</p>
          )}

          {/* Agreements tab */}
          {activeTab === 'agreements' && selectedId && !loading && data && (
            <>
              {/* Sim error banner */}
              {simError && (
                <div style={{ marginBottom: 12, padding: '8px 14px', background: '#fef2f2', border: '1px solid #fca5a5', borderRadius: 6, fontSize: 12, color: '#991b1b', fontWeight: 500 }}>
                  Simulation error: {simError}
                </div>
              )}

              {/* Sim gaps banner — shown after a run from this view */}
              {simLastRunAt && simGaps.length > 0 && (
                <div style={{ marginBottom: 12, padding: '8px 14px', background: '#fef2f2', border: '1px solid #fca5a5', borderRadius: 6, fontSize: 12 }}>
                  <div style={{ fontWeight: 600, color: '#991b1b', marginBottom: 4 }}>
                    {simGaps.length} checkpoint{simGaps.length !== 1 ? 's' : ''} at risk after simulation:
                  </div>
                  <ul style={{ margin: 0, paddingLeft: 18, color: '#7f1d1d', lineHeight: 1.8 }}>
                    {simGaps.map((g, i) => (
                      <li key={i}>
                        <b>{g.tda_name}</b> CP{g.checkpoint_number} ({g.checkpoint_date})
                        {' — '}{g.projected}/{g.required} lots projected
                        <span style={{ marginLeft: 6, background: '#fee2e2', color: '#991b1b', borderRadius: 10, padding: '0 6px', fontWeight: 700, fontSize: 11 }}>
                          gap {g.gap}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {simLastRunAt && simGaps.length === 0 && !simError && (
                <div style={{ marginBottom: 12, padding: '6px 14px', background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 6, fontSize: 12, color: '#15803d', fontWeight: 500 }}>
                  All TDA checkpoints on track after simulation.
                </div>
              )}

              {/* Pill tab row + New Agreement button */}
              <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
                <TdaPillTabs
                  agreements={data.agreements}
                  activeId={activeTdaId}
                  onSelect={setActiveTdaId}
                />
                <div style={{ paddingTop: 10 }}>
                  {showNewForm ? (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, alignItems: 'flex-end', background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 6, padding: '10px 12px' }}>
                      <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                        <input
                          autoFocus
                          value={newName}
                          onChange={e => setNewName(e.target.value)}
                          onKeyDown={e => {
                            if (e.key === 'Enter') createAgreement()
                            if (e.key === 'Escape') resetNewForm()
                          }}
                          placeholder="Agreement name *"
                          style={{ fontSize: 13, padding: '3px 8px', borderRadius: 4, border: '1px solid #d1d5db', width: 200 }}
                        />
                        <select
                          value={newBuilderId}
                          onChange={e => setNewBuilderId(e.target.value)}
                          style={{ fontSize: 12, padding: '3px 7px', borderRadius: 4, border: '1px solid #d1d5db', color: newBuilderId ? '#111827' : '#9ca3af' }}
                        >
                          <option value="">Builder (optional)</option>
                          {(data?.builders || []).map(b => (
                            <option key={b.builder_id} value={b.builder_id}>{b.builder_name}</option>
                          ))}
                        </select>
                        <select
                          value={newBankId}
                          onChange={e => setNewBankId(e.target.value)}
                          style={{ fontSize: 12, padding: '3px 7px', borderRadius: 4, border: '1px solid #d1d5db', color: newBankId ? '#111827' : '#9ca3af' }}
                        >
                          <option value="">Lot bank (optional)</option>
                          {(data?.banks || []).map(b => (
                            <option key={b.bank_id} value={b.bank_id}>{b.bank_name}</option>
                          ))}
                        </select>
                        <input
                          type="number"
                          min={1}
                          value={newLotQuota}
                          onChange={e => setNewLotQuota(e.target.value)}
                          placeholder="Quota"
                          style={{ fontSize: 12, padding: '3px 8px', borderRadius: 4, border: '1px solid #d1d5db', width: 70 }}
                        />
                      </div>
                      <div style={{ display: 'flex', gap: 6 }}>
                        <Btn variant="success" onClick={createAgreement} disabled={!newName.trim()}>Create</Btn>
                        <Btn onClick={resetNewForm}>Cancel</Btn>
                      </div>
                    </div>
                  ) : (
                    <Btn variant="primary" onClick={() => setShowNewForm(true)}>+ New Agreement</Btn>
                  )}
                </div>
              </div>

              {data.agreements.length === 0 && (
                <p style={{ color: TEXT_MUTED, fontSize: 14 }}>No agreements yet for this community.</p>
              )}

              {activeTda && (
                <AgreementCard
                  key={activeTda.tda_id}
                  tda={activeTda}
                  allTdas={data.agreements}
                  unassignedLots={data.unassigned_lots || []}
                  builders={data.builders || []}
                  banks={data.banks || []}
                  onPatch={patch => patchAgreement(activeTda.tda_id, patch)}
                  onAddCheckpoint={addCheckpoint}
                  onPatchCheckpoint={patchCheckpoint}
                  onDeleteCheckpoint={deleteCheckpoint}
                  onAddLots={addLots}
                  onRemoveLots={removeLots}
                  onMoveLots={moveLots}
                  onEditLotDates={editLotDates}
                  onAutoAssign={autoAssign}
                  onAssignLot={assignLot}
                  buildingUnitCounts={data.building_unit_counts || {}}
                  onPatchLotDate={load}
                />
              )}

              {data.agreements.length > 0 && !activeTda && (
                <p style={{ color: TEXT_MUTED, fontSize: 14 }}>Select an agreement above.</p>
              )}
            </>
          )}

          {/* Ledger tab */}
          {activeTab === 'ledger' && (
            <LedgerTab selectedId={selectedId} />
          )}

          {/* Lots tab */}
          {activeTab === 'lots' && selectedId && !loading && (
            <LotsTab selectedId={selectedId} data={data} onReload={load} />
          )}

          {/* Checklist tab */}
          {activeTab === 'checklist' && (
            <ChecklistTab showTestCommunities={showTestCommunities} />
          )}
        </div>
      </div>
    </div>
  )
}
