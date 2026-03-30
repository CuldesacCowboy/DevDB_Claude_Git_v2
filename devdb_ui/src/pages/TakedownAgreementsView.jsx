import { useState, useCallback, useRef, useLayoutEffect, useMemo } from 'react'
import { DndContext, DragOverlay, pointerWithin } from '@dnd-kit/core'
import { useDraggable, useDroppable } from '@dnd-kit/core'
import { useTdaData } from '../hooks/useTdaData'

const API = 'http://localhost:8765/api'

// ── Colour palette for TDA cards ──────────────────────────────────
const TDA_COLORS = [
  { header: '#EEEDFE', tint: '#CECBF6', text: '#3D3A8C' },
  { header: '#E1F5EE', tint: '#9FE1CB', text: '#1A5C42' },
  { header: '#FAEEDA', tint: '#FAC775', text: '#7A4A0A' },
]

// ── Format date for display ───────────────────────────────────────
function fmt(dateStr) {
  if (!dateStr) return '—'
  const [y, m, d] = dateStr.split('-')
  return `${m}/${d}/${y.slice(2)}`
}

// ── Short lot number: "WS00000001" → "WS · 001" ──────────────────
function shortLot(lotNumber) {
  if (!lotNumber) return '—'
  const match = lotNumber.match(/^([A-Za-z]+)0*(\d+)$/)
  if (!match) return lotNumber
  const seq = parseInt(match[2], 10)
  return `${match[1]} · ${String(seq).padStart(3, '0')}`
}

// ── Parse lot into code + padded seq ─────────────────────────────
function parseLot(lotNumber) {
  if (!lotNumber) return { code: '—', seq: '—' }
  const match = lotNumber.match(/^([A-Za-z]+)0*(\d+)$/)
  if (!match) return { code: lotNumber, seq: '' }
  return { code: match[1], seq: String(parseInt(match[2], 10)).padStart(3, '0') }
}

// ── Draggable unassigned lot pill ─────────────────────────────────
function UnassignedLotPill({ lot }) {
  const { attributes, listeners, setNodeRef, isDragging } =
    useDraggable({ id: `unassigned-${lot.lot_id}`, data: { type: 'unassigned-lot', lot } })
  const { code, seq } = parseLot(lot.lot_number)
  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      style={{
        width: 68, height: 34, flexShrink: 0,
        background: '#fff',
        border: '0.5px solid #888780',
        borderRadius: 5,
        display: 'flex', alignItems: 'center',
        justifyContent: 'space-between',
        padding: '0 6px', boxSizing: 'border-box',
        cursor: 'grab', opacity: isDragging ? 0.4 : 1,
      }}
    >
      <span style={{ fontSize: 11, color: '#888780' }}>{code}</span>
      <span style={{ fontSize: 12, fontWeight: 500, color: '#2C2C2A' }}>{seq}</span>
    </div>
  )
}

// ── Droppable unassigned bank ─────────────────────────────────────
function UnassignedBank({ lots }) {
  const { setNodeRef, isOver } = useDroppable({ id: 'unassigned-bank', data: { type: 'unassigned-bank' } })
  return (
    <div
      ref={setNodeRef}
      style={{
        width: 240, flexShrink: 0,
        background: isOver ? '#eff6ff' : '#f9fafb',
        border: `2px solid ${isOver ? '#3b82f6' : '#e5e7eb'}`,
        borderRadius: 8, padding: 14, marginRight: 20,
        minHeight: 200, transition: 'all 0.15s',
      }}
    >
      <div style={{ fontWeight: 700, fontSize: 15, color: '#374151', marginBottom: 4 }}>
        Unassigned
      </div>
      <div style={{ fontSize: 13, color: '#9ca3af', marginBottom: 10 }}>
        {lots.length} lot{lots.length !== 1 ? 's' : ''}
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
        {lots.map(lot => <UnassignedLotPill key={lot.lot_id} lot={lot} />)}
      </div>
    </div>
  )
}

// ── TDA card wrapper ──────────────────────────────────────────────
function TdaCard({ detail, colorIdx, onCheckpointCreated, children }) {
  const colors = TDA_COLORS[colorIdx % TDA_COLORS.length]
  const totalLots = (detail.checkpoints || []).reduce(
    (sum, cp) => sum + (cp.lots?.length || 0), 0
  )
  const [showAddCP, setShowAddCP] = useState(false)
  const [cpName, setCpName] = useState('')
  const [cpDate, setCpDate] = useState('')
  const [cpCreating, setCpCreating] = useState(false)
  const [cpError, setCpError] = useState('')

  async function handleAddCheckpoint() {
    const name = cpName.trim()
    if (!name) { setCpError('Name required.'); return }
    setCpCreating(true)
    setCpError('')
    try {
      const res = await fetch(`${API}/takedown-agreements/${detail.tda_id}/checkpoints`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          checkpoint_name: name,
          checkpoint_date: cpDate || null,
          lots_required_cumulative: 0,
        }),
      })
      if (!res.ok) {
        const err = await res.json()
        setCpError(err.detail || 'Failed to create checkpoint.')
        return
      }
      setCpName(''); setCpDate(''); setShowAddCP(false)
      onCheckpointCreated()
    } finally {
      setCpCreating(false)
    }
  }

  return (
    <div style={{
      borderRadius: 10, overflow: 'hidden',
      boxShadow: '0 1px 4px rgba(0,0,0,0.08)',
      display: 'inline-flex', flexDirection: 'column',
      flexShrink: 0, width: 'fit-content',
    }}>
      <div style={{
        background: colors.header, padding: '10px 16px',
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
      }}>
        <span style={{ fontWeight: 700, fontSize: 16, color: colors.text }}>
          {detail.tda_name}
        </span>
        <span style={{ fontSize: 13, color: colors.text, opacity: 0.8, marginLeft: 14 }}>
          {totalLots} lot{totalLots !== 1 ? 's' : ''}
        </span>
      </div>
      <div style={{ background: colors.tint, padding: 14 }}>
        {children}

        {/* Add checkpoint */}
        {showAddCP ? (
          <div style={{
            display: 'flex', alignItems: 'center', gap: 8, marginTop: 4,
            padding: '10px 14px', background: '#fff',
            borderRadius: 8, border: '1.5px solid #E4E2DA',
          }}>
            <input
              autoFocus
              type="text"
              placeholder="Checkpoint name"
              value={cpName}
              onChange={e => { setCpName(e.target.value); setCpError('') }}
              onKeyDown={e => {
                if (e.key === 'Enter') handleAddCheckpoint()
                if (e.key === 'Escape') { setShowAddCP(false); setCpName(''); setCpDate(''); setCpError('') }
              }}
              style={{
                fontSize: 14, padding: '4px 8px', borderRadius: 5,
                border: `1px solid ${cpError ? '#ef4444' : '#d1d5db'}`,
                outline: 'none', width: 180,
              }}
            />
            <input
              type="date"
              value={cpDate}
              onChange={e => setCpDate(e.target.value)}
              style={{
                fontSize: 13, padding: '4px 8px', borderRadius: 5,
                border: '1px solid #d1d5db', outline: 'none',
              }}
            />
            <button
              onClick={handleAddCheckpoint}
              disabled={cpCreating}
              style={{
                fontSize: 13, padding: '4px 12px', borderRadius: 5,
                border: 'none', background: '#2563eb', color: '#fff',
                cursor: cpCreating ? 'default' : 'pointer', opacity: cpCreating ? 0.6 : 1,
              }}
            >
              {cpCreating ? 'Adding…' : 'Add'}
            </button>
            <button
              onClick={() => { setShowAddCP(false); setCpName(''); setCpDate(''); setCpError('') }}
              style={{
                fontSize: 13, padding: '4px 10px', borderRadius: 5,
                border: '1px solid #d1d5db', background: '#fff', color: '#6b7280',
                cursor: 'pointer',
              }}
            >
              Cancel
            </button>
            {cpError && <span style={{ fontSize: 12, color: '#ef4444' }}>{cpError}</span>}
          </div>
        ) : (
          <button
            onClick={() => setShowAddCP(true)}
            style={{
              marginTop: 4,
              fontSize: 13, padding: '6px 14px', borderRadius: 6,
              border: '1.5px dashed #B4B2A9', background: 'transparent', color: '#888780',
              cursor: 'pointer', width: '100%', textAlign: 'left',
            }}
          >
            + Add checkpoint
          </button>
        )}
      </div>
    </div>
  )
}

// ── Lock icon (SVG) — neutral gray, no amber ─────────────────────
function LockIcon({ locked }) {
  const color = locked ? '#444441' : '#B4B2A9'
  return locked ? (
    <svg width="13" height="15" viewBox="0 0 10 12" fill="none">
      <rect x="1" y="5.5" width="8" height="6" rx="1.5" fill={color} />
      <path d="M3 5.5V4a2 2 0 0 1 4 0v1.5" stroke={color} strokeWidth="1.4" strokeLinecap="round" fill="none" />
    </svg>
  ) : (
    <svg width="13" height="15" viewBox="0 0 10 12" fill="none">
      <rect x="1" y="5.5" width="8" height="6" rx="1.5" fill={color} />
      <path d="M3 5.5V4a2 2 0 0 1 4 0" stroke={color} strokeWidth="1.4" strokeLinecap="round" fill="none" />
    </svg>
  )
}

// ── Lock button ───────────────────────────────────────────────────
function LockBtn({ locked, onClick }) {
  return (
    <button
      onClick={onClick}
      style={{
        background: 'none', border: 'none', cursor: 'pointer',
        padding: '0 1px', lineHeight: 1,
        display: 'inline-flex', alignItems: 'center',
      }}
    >
      <LockIcon locked={locked} />
    </button>
  )
}

// ── Projected date field ──────────────────────────────────────────
function ProjectedDateField({ value, locked, onChange }) {
  if (locked) {
    return (
      <div style={{
        fontSize: 12, color: '#444441',
        pointerEvents: 'none',
        padding: '2px 4px',
      }}>
        {fmt(value) || '—'}
      </div>
    )
  }
  return (
    <div style={{ position: 'relative' }}>
      <div style={{
        fontSize: 12, color: '#27500A',
        border: '1px dashed #3B6D11',
        background: '#EAF3DE',
        borderRadius: 3,
        padding: '2px 4px',
        lineHeight: '1.3',
        cursor: 'pointer',
        userSelect: 'none',
        overflow: 'hidden', whiteSpace: 'nowrap',
      }}>
        {fmt(value) || '—'}
      </div>
      <input
        key={value || ''}
        type="date"
        defaultValue={value || ''}
        onChange={(e) => { if (e.target.value) onChange(e.target.value) }}
        style={{
          position: 'absolute', inset: 0,
          width: '100%', height: '100%',
          opacity: 0, cursor: 'pointer',
          border: 'none', padding: 0, margin: 0,
        }}
      />
    </div>
  )
}

// ── Lot pill inside a checkpoint ──────────────────────────────────
function LotPill({ assignment, onDateChange, onLockChange, isExcess = false }) {
  const { attributes, listeners, setNodeRef, isDragging } =
    useDraggable({
      id: `assigned-${assignment.assignment_id}`,
      data: { type: 'assigned-lot', assignment },
    })

  function col(label, marksDate, projDate, isLocked, dateKey, lockKey) {
    return (
      <div style={{ flex: 1, minWidth: 0, overflow: 'hidden' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 3 }}>
          <span style={{ fontSize: 11, textTransform: 'uppercase', color: '#888780', letterSpacing: '0.04em' }}>
            {label}
          </span>
          <LockBtn locked={isLocked} onClick={() => onLockChange(lockKey, !isLocked)} />
        </div>
        <div style={{ fontSize: 12, color: '#B4B2A9', marginBottom: 4, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {fmt(marksDate)}
        </div>
        <ProjectedDateField
          value={projDate}
          locked={isLocked}
          onChange={(val) => {
            onDateChange(dateKey, val)
            onLockChange(lockKey, true)
          }}
        />
      </div>
    )
  }

  return (
    <div
      ref={setNodeRef}
      style={{
        width: 148, flexShrink: 0,
        borderRadius: 6, overflow: 'hidden',
        background: isExcess ? '#FFF5F5' : '#fff',
        border: isExcess ? '1.5px dashed #E24B4A' : '1px solid #E4E2DA',
        opacity: isDragging ? 0.4 : 1,
        boxShadow: '0 1px 2px rgba(0,0,0,0.06)',
        display: 'flex', flexDirection: 'column',
      }}
    >
      <div
        {...attributes}
        {...listeners}
        style={{
          textAlign: 'center', fontSize: 14, fontWeight: 700, color: '#2C2C2A',
          padding: '6px 8px',
          cursor: 'grab', background: '#FAFAF8',
          borderBottom: '1px solid #F0EEE8',
          userSelect: 'none',
        }}
      >
        {shortLot(assignment.lot_number)}
      </div>
      <div style={{ display: 'flex', padding: '6px 8px', gap: 4 }}>
        {col('HC',
          assignment.hc_marks_date, assignment.hc_projected_date,
          assignment.hc_is_locked, 'hc_projected_date', 'hc_is_locked')}
        <div style={{ width: 1, background: '#F0EEE8', flexShrink: 0 }} />
        {col('BLDR',
          assignment.bldr_marks_date, assignment.bldr_projected_date,
          assignment.bldr_is_locked, 'bldr_projected_date', 'bldr_is_locked')}
      </div>
    </div>
  )
}

// ── Placeholder slot pill ─────────────────────────────────────────
// State: normal (>30d), urgent (≤30d), missed (<0d)
function PlaceholderPill({ daysToCP }) {
  let state = 'normal'
  if (daysToCP !== null) {
    if (daysToCP < 0) state = 'missed'
    else if (daysToCP <= 30) state = 'urgent'
  }
  const cfg = {
    normal: { bg: 'transparent',  border: '1.5px dashed #888780', icon: '○', iconColor: '#B4B2A9', label: null },
    urgent: { bg: '#FFF3CD',      border: '1.5px dashed #BA7517', icon: '⚠', iconColor: '#854F0B', label: `${daysToCP} DAYS` },
    missed: { bg: '#FCEBEB',      border: '1.5px dashed #A32D2D', icon: '✕', iconColor: '#A32D2D', label: 'PAST DUE' },
  }[state]

  return (
    <div style={{
      width: 148, flexShrink: 0, borderRadius: 6,
      background: cfg.bg, border: cfg.border,
      display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center',
      padding: '12px 8px', minHeight: 88,
    }}>
      <span style={{ fontSize: 22, color: cfg.iconColor, lineHeight: 1 }}>
        {cfg.icon}
      </span>
      {cfg.label && (
        <span style={{ fontSize: 11, color: cfg.iconColor, marginTop: 5, letterSpacing: '0.05em', fontWeight: 600 }}>
          {cfg.label}
        </span>
      )}
    </div>
  )
}

// ── Editable inline value (green dashed style) ───────────────────
function EditableNumber({ value, onChange }) {
  const [editing, setEditing] = useState(false)
  if (editing) {
    return (
      <input
        autoFocus
        type="number"
        min={0}
        defaultValue={value}
        onBlur={(e) => {
          const val = parseInt(e.target.value, 10)
          if (!isNaN(val) && val >= 0) onChange(val)
          setEditing(false)
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.target.blur()
          if (e.key === 'Escape') setEditing(false)
        }}
        style={{
          width: 36, fontSize: 13, fontWeight: 700,
          border: '1px dashed #3B6D11',
          background: '#EAF3DE', color: '#27500A',
          borderRadius: 3, padding: '0 2px',
          outline: 'none', textAlign: 'center',
        }}
      />
    )
  }
  return (
    <span
      onClick={() => setEditing(true)}
      title="Click to edit"
      style={{
        fontSize: 13, fontWeight: 700, color: '#27500A',
        border: '1px dashed #3B6D11',
        background: '#EAF3DE',
        borderRadius: 3, padding: '0 5px',
        cursor: 'pointer',
      }}
    >
      {value}
    </span>
  )
}

// ── Droppable checkpoint band ─────────────────────────────────────
function CheckpointBand({ checkpoint, onDateChange, onLockChange }) {
  const [localTotal, setLocalTotal] = useState(checkpoint.lots_required_cumulative || 0)
  const [localDate, setLocalDate] = useState(checkpoint.checkpoint_date || '')

  const { setNodeRef, isOver } = useDroppable({
    id: `checkpoint-${checkpoint.checkpoint_id}`,
    data: { type: 'checkpoint', checkpointId: checkpoint.checkpoint_id },
  })

  const lots = checkpoint.lots || []

  // Sort lots: earliest obligation date first (marks date > projected date > no date)
  const sortedLots = useMemo(() => {
    return [...lots].sort((a, b) => {
      const aDate = a.hc_marks_date || a.hc_projected_date || a.bldr_marks_date || a.bldr_projected_date
      const bDate = b.hc_marks_date || b.hc_projected_date || b.bldr_marks_date || b.bldr_projected_date
      if (!aDate && !bDate) return 0
      if (!aDate) return 1
      if (!bDate) return -1
      return aDate.localeCompare(bDate)
    })
  }, [lots])

  // C = confirmed (has marks dates), P = projected only
  const c = lots.filter(l => l.hc_marks_date || l.bldr_marks_date).length
  const p = lots.filter(l => !l.hc_marks_date && !l.bldr_marks_date).length
  const t = localTotal
  const total = c + p
  const excess = Math.max(0, total - t)
  const over = excess > 0

  // Placeholder count and urgency
  const slotCount = Math.max(0, t - total)
  const daysToCP = (() => {
    if (!localDate) return null
    const today = new Date(); today.setHours(0, 0, 0, 0)
    const cpDate = new Date(localDate)
    return Math.floor((cpDate - today) / (1000 * 60 * 60 * 24))
  })()

  const barColor = over ? '#E24B4A' : null
  const cPct = t > 0 ? Math.min(100, Math.round((c / t) * 100)) : 0
  const cpPct = t > 0 ? Math.min(100, Math.round((total / t) * 100)) : 0

  // ── Row height equalization (lots + placeholders) ──────────────
  const gridRef = useRef(null)
  useLayoutEffect(() => {
    const grid = gridRef.current
    if (!grid) return
    const children = Array.from(grid.children)
    children.forEach(el => { el.style.height = '' })
    const rows = []
    children.forEach(el => {
      const top = el.getBoundingClientRect().top
      const row = rows.find(r => Math.abs(r.top - top) < 10)
      if (row) row.els.push(el)
      else rows.push({ top, els: [el] })
    })
    rows.forEach(row => {
      const maxH = Math.max(...row.els.map(el => el.getBoundingClientRect().height))
      row.els.forEach(el => { el.style.height = `${maxH}px` })
    })
  }, [lots, slotCount])

  return (
    <div
      ref={setNodeRef}
      style={{
        background: isOver ? '#f0f9ff' : '#ffffff',
        border: `1.5px solid ${isOver ? '#3b82f6' : '#E4E2DA'}`,
        borderRadius: 8, marginBottom: 14,
        transition: 'all 0.15s',
      }}
    >
      {/* Header */}
      <div style={{
        background: '#F5F5F2',
        borderRadius: '6px 6px 0 0',
        padding: '10px 14px',
        display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 14,
      }}>
        {/* Left: "{X} required by {date}" — both editable inline */}
        <div style={{ flexShrink: 0, display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
          <EditableNumber value={t} onChange={setLocalTotal} />
          <span style={{ fontSize: 13, color: '#6B6B68', fontWeight: 500 }}>required by</span>
          {/* Editable date — overlay pattern */}
          <div style={{ position: 'relative', display: 'inline-block' }}>
            <div style={{
              fontSize: 13, fontWeight: 700, color: '#27500A',
              border: '1px dashed #3B6D11',
              background: '#EAF3DE',
              borderRadius: 3, padding: '0 5px',
              cursor: 'pointer', userSelect: 'none',
              whiteSpace: 'nowrap',
            }}>
              {localDate ? fmt(localDate) : '—'}
            </div>
            <input
              key={localDate}
              type="date"
              defaultValue={localDate}
              onChange={(e) => { if (e.target.value) setLocalDate(e.target.value) }}
              style={{
                position: 'absolute', top: 0, left: 0,
                width: '100%', height: '100%',
                opacity: 0, cursor: 'pointer',
                border: 'none', padding: 0, margin: 0,
              }}
            />
          </div>
        </div>

        {/* Right: Completed + Completed+Planned bars */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 5, minWidth: 220 }}>
          {/* Completed row */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ fontSize: 11, color: '#888780', whiteSpace: 'nowrap', flexShrink: 0, minWidth: 78 }}>
              Completed
            </span>
            <div style={{ flex: 1, height: 8, background: '#F1EFE8', borderRadius: 3, overflow: 'hidden' }}>
              <div style={{ width: `${cPct}%`, height: '100%', background: barColor || '#444441', borderRadius: 3, transition: 'width 0.2s' }} />
            </div>
            <span style={{ fontSize: 12, fontWeight: 500, color: '#444441', flexShrink: 0, minWidth: 40, textAlign: 'right' }}>
              {c}/{t}
            </span>
          </div>
          {/* Completed + Planned For row */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ fontSize: 11, color: '#888780', whiteSpace: 'nowrap', flexShrink: 0, minWidth: 78 }}>
              + Planned
            </span>
            <div style={{ flex: 1, height: 8, background: '#F1EFE8', borderRadius: 3, overflow: 'hidden' }}>
              <div style={{ width: `${cpPct}%`, height: '100%', background: barColor || '#B4B2A9', borderRadius: 3, transition: 'width 0.2s' }} />
            </div>
            <span style={{ fontSize: 12, fontWeight: 500, color: over ? '#A32D2D' : '#444441', flexShrink: 0, minWidth: 40, textAlign: 'right' }}>
              {total}/{t}
            </span>
          </div>
        </div>
      </div>

      {/* Body — outer pad + inner grid capped at 5 columns (5×148 + 4×8 = 772px) */}
      <div style={{ padding: 14, minHeight: 60 }}>
        <div ref={gridRef} style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'stretch', maxWidth: 772 }}>
          {sortedLots.map((a, idx) => (
            <LotPill
              key={a.assignment_id}
              assignment={a}
              isExcess={idx >= total - excess}
              onDateChange={(key, val) => onDateChange(a.assignment_id, { [key]: val })}
              onLockChange={(key, val) => onLockChange(a.assignment_id, { [key]: val })}
            />
          ))}
          {Array.from({ length: slotCount }).map((_, i) => (
            <PlaceholderPill key={`ph-${i}`} daysToCP={daysToCP} />
          ))}
        </div>
      </div>
    </div>
  )
}

// ── Main view ─────────────────────────────────────────────────────
export default function TakedownAgreementsView({ entGroupId }) {
  const {
    agreements, entGroupName,
    selectedTdaId, setSelectedTdaId,
    detail, refetchDetail,
    refetchAgreements,
    loading, error,
  } = useTdaData(entGroupId)

  const [dragLot, setDragLot] = useState(null)
  const [showNewTdaForm, setShowNewTdaForm] = useState(false)
  const [newTdaName, setNewTdaName] = useState('')
  const [newTdaCreating, setNewTdaCreating] = useState(false)
  const [newTdaError, setNewTdaError] = useState('')

  async function handleCreateTda() {
    const name = newTdaName.trim()
    if (!name) { setNewTdaError('Name is required.'); return }
    setNewTdaCreating(true)
    setNewTdaError('')
    try {
      const res = await fetch(`${API}/takedown-agreements`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tda_name: name, ent_group_id: entGroupId }),
      })
      if (!res.ok) {
        const err = await res.json()
        setNewTdaError(err.detail || 'Failed to create agreement.')
        return
      }
      const created = await res.json()
      setNewTdaName('')
      setShowNewTdaForm(false)
      refetchAgreements(created.tda_id)
    } finally {
      setNewTdaCreating(false)
    }
  }

  // ── Date update ──────────────────────────────────────────────
  const handleDateChange = useCallback(async (assignmentId, patch) => {
    await fetch(`${API}/tda-lot-assignments/${assignmentId}/dates`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    })
    refetchDetail()
  }, [refetchDetail])

  // ── Lock toggle ──────────────────────────────────────────────
  const handleLockChange = useCallback(async (assignmentId, patch) => {
    await fetch(`${API}/tda-lot-assignments/${assignmentId}/lock`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    })
    refetchDetail()
  }, [refetchDetail])

  // ── Drag ─────────────────────────────────────────────────────
  function handleDragStart(event) {
    setDragLot(event.active.data.current)
  }

  async function handleDragEnd(event) {
    setDragLot(null)
    const { active, over } = event
    if (!over || !active) return

    const src = active.data.current
    const dst = over.data.current

    // Assigned lot → unassigned bank
    if (src?.type === 'assigned-lot' && dst?.type === 'unassigned-bank') {
      const { assignment } = src
      await fetch(
        `${API}/takedown-agreements/${detail.tda_id}/lots/${assignment.lot_id}/assign`,
        { method: 'DELETE' }
      )
      refetchDetail()
      return
    }

    // Unassigned lot → checkpoint
    if (src?.type === 'unassigned-lot' && dst?.type === 'checkpoint') {
      await fetch(
        `${API}/takedown-agreements/${detail.tda_id}/lots/${src.lot.lot_id}/assign`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ checkpoint_id: dst.checkpointId }),
        }
      )
      refetchDetail()
      return
    }

    // Assigned lot → different checkpoint
    if (src?.type === 'assigned-lot' && dst?.type === 'checkpoint') {
      const { assignment } = src
      await fetch(
        `${API}/takedown-agreements/${detail.tda_id}/lots/${assignment.lot_id}/assign`,
        { method: 'DELETE' }
      )
      await fetch(
        `${API}/takedown-agreements/${detail.tda_id}/lots/${assignment.lot_id}/assign`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ checkpoint_id: dst.checkpointId }),
        }
      )
      refetchDetail()
    }
  }

  const tdaColorIdx = agreements.findIndex(a => a.tda_id === detail?.tda_id)

  // ── Render ───────────────────────────────────────────────────
  if (loading) return (
    <div style={{ padding: 32, color: '#6b7280', flex: 1 }}>Loading…</div>
  )
  if (error) return (
    <div style={{ padding: 32, color: '#dc2626', flex: 1 }}>Error: {error}</div>
  )

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden', background: '#f9fafb' }}>
      {/* Page header */}
      <div style={{
        background: '#fff', borderBottom: '1px solid #e5e7eb',
        padding: '12px 24px', display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        flexShrink: 0,
      }}>
        <div>
          <h1 style={{ fontSize: 18, fontWeight: 700, color: '#111827', margin: 0 }}>
            Takedown Agreements
          </h1>
          <div style={{ fontSize: 13, color: '#6b7280', marginTop: 2 }}>
            {entGroupName}
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          {agreements.length > 0 && (
            <select
              value={selectedTdaId || ''}
              onChange={e => setSelectedTdaId(Number(e.target.value))}
              style={{
                fontSize: 14, padding: '5px 10px', borderRadius: 6,
                border: '1px solid #d1d5db', background: '#fff', color: '#374151',
              }}
            >
              {agreements.map(a => (
                <option key={a.tda_id} value={a.tda_id}>{a.tda_name}</option>
              ))}
            </select>
          )}
          {showNewTdaForm ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <input
                autoFocus
                type="text"
                placeholder="Agreement name"
                value={newTdaName}
                onChange={e => { setNewTdaName(e.target.value); setNewTdaError('') }}
                onKeyDown={e => {
                  if (e.key === 'Enter') handleCreateTda()
                  if (e.key === 'Escape') { setShowNewTdaForm(false); setNewTdaName(''); setNewTdaError('') }
                }}
                style={{
                  fontSize: 14, padding: '5px 10px', borderRadius: 6,
                  border: `1px solid ${newTdaError ? '#ef4444' : '#d1d5db'}`,
                  outline: 'none', width: 200, color: '#374151',
                }}
              />
              <button
                onClick={handleCreateTda}
                disabled={newTdaCreating}
                style={{
                  fontSize: 13, padding: '5px 12px', borderRadius: 6,
                  border: 'none', background: '#2563eb', color: '#fff',
                  cursor: newTdaCreating ? 'default' : 'pointer', opacity: newTdaCreating ? 0.6 : 1,
                }}
              >
                {newTdaCreating ? 'Creating…' : 'Create'}
              </button>
              <button
                onClick={() => { setShowNewTdaForm(false); setNewTdaName(''); setNewTdaError('') }}
                style={{
                  fontSize: 13, padding: '5px 10px', borderRadius: 6,
                  border: '1px solid #d1d5db', background: '#fff', color: '#6b7280',
                  cursor: 'pointer',
                }}
              >
                Cancel
              </button>
              {newTdaError && (
                <span style={{ fontSize: 12, color: '#ef4444' }}>{newTdaError}</span>
              )}
            </div>
          ) : (
            <button
              onClick={() => setShowNewTdaForm(true)}
              style={{
                fontSize: 13, padding: '5px 14px', borderRadius: 6,
                border: '1px solid #d1d5db', background: '#fff', color: '#6b7280',
                cursor: 'pointer',
              }}
            >
              + New agreement
            </button>
          )}
        </div>
      </div>

      {/* Main content — scrollable */}
      {detail ? (
        <DndContext
          collisionDetection={pointerWithin}
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
        >
          <div style={{
            flex: 1, overflowY: 'auto', padding: 24,
            display: 'flex', gap: 0, alignItems: 'flex-start',
          }}>
            <UnassignedBank lots={detail.unassigned_lots || []} />

            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14, alignItems: 'flex-start' }}>
              <TdaCard detail={detail} colorIdx={tdaColorIdx >= 0 ? tdaColorIdx : 0} onCheckpointCreated={refetchDetail}>
                {(detail.checkpoints || []).map((cp) => (
                  <CheckpointBand
                    key={cp.checkpoint_id}
                    checkpoint={cp}
                    onDateChange={handleDateChange}
                    onLockChange={handleLockChange}
                  />
                ))}
              </TdaCard>
            </div>
          </div>

          <DragOverlay>
            {dragLot?.type === 'unassigned-lot' && (
              <div style={{
                padding: '3px 10px', borderRadius: 12,
                background: '#e0e7ff', border: '1px solid #818cf8',
                fontSize: 13, fontWeight: 600, color: '#3730a3',
              }}>
                {dragLot.lot.lot_number}
              </div>
            )}
            {dragLot?.type === 'assigned-lot' && (
              <div style={{
                width: 148, borderRadius: 6,
                background: '#fff', border: '1px solid #E4E2DA',
                padding: '6px 8px', fontSize: 14, fontWeight: 700, color: '#2C2C2A',
                textAlign: 'center',
              }}>
                {shortLot(dragLot.assignment.lot_number)}
              </div>
            )}
          </DragOverlay>
        </DndContext>
      ) : (
        <div style={{ padding: 32, color: '#9ca3af', fontSize: 15 }}>
          No agreement selected.
        </div>
      )}
    </div>
  )
}
