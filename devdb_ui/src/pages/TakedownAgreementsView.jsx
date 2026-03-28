import { useState, useCallback } from 'react'
import { DndContext, DragOverlay, pointerWithin } from '@dnd-kit/core'
import { useDraggable, useDroppable } from '@dnd-kit/core'
import { useTdaData } from '../hooks/useTdaData'

const API = 'http://localhost:8765/api'
const ENT_GROUP_ID = 9002

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
        width: 50, height: 28, flexShrink: 0,
        background: '#fff',
        border: '0.5px solid #888780',
        borderRadius: 5,
        display: 'flex', alignItems: 'center',
        justifyContent: 'space-between',
        padding: '0 5px', boxSizing: 'border-box',
        cursor: 'grab', opacity: isDragging ? 0.4 : 1,
      }}
    >
      <span style={{ fontSize: 8, color: '#888780' }}>{code}</span>
      <span style={{ fontSize: 9, fontWeight: 500, color: '#2C2C2A' }}>{seq}</span>
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
        width: 200, flexShrink: 0,
        background: isOver ? '#eff6ff' : '#f9fafb',
        border: `2px solid ${isOver ? '#3b82f6' : '#e5e7eb'}`,
        borderRadius: 8, padding: 12, marginRight: 16,
        minHeight: 200, transition: 'all 0.15s',
      }}
    >
      <div style={{ fontWeight: 700, fontSize: 12, color: '#374151', marginBottom: 4 }}>
        Unassigned
      </div>
      <div style={{ fontSize: 11, color: '#9ca3af', marginBottom: 8 }}>
        {lots.length} lot{lots.length !== 1 ? 's' : ''}
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3 }}>
        {lots.map(lot => <UnassignedLotPill key={lot.lot_id} lot={lot} />)}
      </div>
    </div>
  )
}

// ── TDA card wrapper ──────────────────────────────────────────────
function TdaCard({ detail, colorIdx, children }) {
  const colors = TDA_COLORS[colorIdx % TDA_COLORS.length]
  const totalLots = (detail.checkpoints || []).reduce(
    (sum, cp) => sum + (cp.lots?.length || 0), 0
  )
  return (
    <div style={{
      borderRadius: 10, overflow: 'hidden',
      boxShadow: '0 1px 4px rgba(0,0,0,0.08)',
      display: 'inline-flex', flexDirection: 'column',
      flexShrink: 0, width: 'fit-content',
    }}>
      <div style={{
        background: colors.header, padding: '8px 14px',
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
      }}>
        <span style={{ fontWeight: 700, fontSize: 13, color: colors.text }}>
          {detail.tda_name}
        </span>
        <span style={{ fontSize: 11, color: colors.text, opacity: 0.8, marginLeft: 12 }}>
          {totalLots} lot{totalLots !== 1 ? 's' : ''}
        </span>
      </div>
      <div style={{ background: colors.tint, padding: 12 }}>
        {children}
      </div>
    </div>
  )
}

// ── Lock button ───────────────────────────────────────────────────
function LockBtn({ locked, onClick }) {
  return (
    <button
      onClick={onClick}
      style={{
        background: 'none', border: 'none', cursor: 'pointer',
        padding: '0 1px', fontSize: 10, lineHeight: 1,
      }}
    >
      {locked ? '🔒' : '🔓'}
    </button>
  )
}

// ── Projected date field ──────────────────────────────────────────
function ProjectedDateField({ value, locked, onChange }) {
  if (locked) {
    return (
      <div style={{
        fontSize: 8, color: '#444441',
        pointerEvents: 'none',
        height: 16, lineHeight: '16px',
        padding: '1px 3px', boxSizing: 'border-box',
      }}>
        {fmt(value) || '—'}
      </div>
    )
  }
  return (
    <div style={{ position: 'relative', height: 16 }}>
      <div style={{
        fontSize: 8, color: '#27500A',
        border: '1px dashed #3B6D11',
        background: '#EAF3DE',
        borderRadius: 3,
        padding: '1px 3px',
        height: '100%', lineHeight: '14px',
        boxSizing: 'border-box',
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
          position: 'absolute', top: 0, left: 0,
          width: '100%', height: '100%',
          opacity: 0, cursor: 'pointer',
          border: 'none', padding: 0, margin: 0,
        }}
      />
    </div>
  )
}

// ── Lot pill inside a checkpoint ──────────────────────────────────
function LotPill({ assignment, onDateChange, onLockChange }) {
  const { attributes, listeners, setNodeRef, isDragging } =
    useDraggable({
      id: `assigned-${assignment.assignment_id}`,
      data: { type: 'assigned-lot', assignment },
    })

  function col(label, marksDate, projDate, isLocked, dateKey, lockKey) {
    return (
      <div style={{ flex: 1, minWidth: 0, overflow: 'hidden' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 2 }}>
          <span style={{ fontSize: 7, textTransform: 'uppercase', color: '#888780', letterSpacing: '0.04em' }}>
            {label}
          </span>
          <LockBtn locked={isLocked} onClick={() => onLockChange(lockKey, !isLocked)} />
        </div>
        <div style={{ fontSize: 8, color: '#B4B2A9', marginBottom: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
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
        width: 106, flexShrink: 0,
        borderRadius: 6, overflow: 'hidden',
        background: '#fff', border: '1px solid #E4E2DA',
        opacity: isDragging ? 0.4 : 1,
        boxShadow: '0 1px 2px rgba(0,0,0,0.06)',
        display: 'flex', flexDirection: 'column',
      }}
    >
      <div
        {...attributes}
        {...listeners}
        style={{
          textAlign: 'center', fontSize: 11, fontWeight: 700, color: '#2C2C2A',
          padding: '5px 6px 4px',
          cursor: 'grab', background: '#FAFAF8',
          borderBottom: '1px solid #F0EEE8',
          userSelect: 'none',
        }}
      >
        {shortLot(assignment.lot_number)}
      </div>
      <div style={{ display: 'flex', padding: '4px 5px 5px', gap: 3 }}>
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
      width: 106, flexShrink: 0, borderRadius: 6,
      background: cfg.bg, border: cfg.border,
      display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center',
      padding: '10px 6px', minHeight: 72,
    }}>
      <span style={{ fontSize: 18, color: cfg.iconColor, lineHeight: 1 }}>
        {cfg.icon}
      </span>
      {cfg.label && (
        <span style={{ fontSize: 8, color: cfg.iconColor, marginTop: 4, letterSpacing: '0.05em', fontWeight: 600 }}>
          {cfg.label}
        </span>
      )}
    </div>
  )
}

// ── Droppable checkpoint band ─────────────────────────────────────
function CheckpointBand({ checkpoint, onDateChange, onLockChange }) {
  const [localTotal, setLocalTotal] = useState(checkpoint.lots_required_cumulative || 0)
  const [localDate, setLocalDate] = useState(checkpoint.checkpoint_date || '')
  const [editingTotal, setEditingTotal] = useState(false)

  const { setNodeRef, isOver } = useDroppable({
    id: `checkpoint-${checkpoint.checkpoint_id}`,
    data: { type: 'checkpoint', checkpointId: checkpoint.checkpoint_id },
  })

  const lots = checkpoint.lots || []
  // C = confirmed (has marks dates), P = projected only
  const c = lots.filter(l => l.hc_marks_date || l.bldr_marks_date).length
  const p = lots.filter(l => !l.hc_marks_date && !l.bldr_marks_date).length
  const t = localTotal
  const over = (c + p) > t

  // Placeholder count and urgency
  const slotCount = Math.max(0, t - (c + p))
  const daysToCP = (() => {
    if (!localDate) return null
    const today = new Date(); today.setHours(0, 0, 0, 0)
    const cpDate = new Date(localDate)
    return Math.floor((cpDate - today) / (1000 * 60 * 60 * 24))
  })()
  const barFill = over ? '#E24B4A' : null
  const cPct = t > 0 ? Math.min(100, Math.round((c / t) * 100)) : 0
  const pPct = t > 0 ? Math.min(100, Math.round((p / t) * 100)) : 0

  // Editable total — inline number input, green-dashed style
  const tDisplay = editingTotal ? (
    <input
      autoFocus
      type="number"
      min={0}
      defaultValue={localTotal}
      onBlur={(e) => {
        const val = parseInt(e.target.value, 10)
        if (!isNaN(val) && val >= 0) setLocalTotal(val)
        setEditingTotal(false)
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.target.blur()
        if (e.key === 'Escape') setEditingTotal(false)
      }}
      style={{
        width: 28, fontSize: 9, fontWeight: 500,
        border: '1px dashed #3B6D11',
        background: '#EAF3DE', color: '#27500A',
        borderRadius: 3, padding: '0 2px',
        outline: 'none', textAlign: 'center',
      }}
    />
  ) : (
    <span
      onClick={() => setEditingTotal(true)}
      title="Click to edit"
      style={{
        fontSize: 9, fontWeight: 500, color: '#27500A',
        border: '1px dashed #3B6D11',
        background: '#EAF3DE',
        borderRadius: 3, padding: '0 3px',
        cursor: 'pointer',
      }}
    >
      {t}
    </span>
  )

  return (
    <div
      ref={setNodeRef}
      style={{
        background: isOver ? '#f0f9ff' : '#ffffff',
        border: `1.5px solid ${isOver ? '#3b82f6' : '#E4E2DA'}`,
        borderRadius: 8, marginBottom: 12,
        transition: 'all 0.15s',
      }}
    >
      {/* Header */}
      <div style={{
        background: '#F5F5F2',
        borderRadius: '6px 6px 0 0',
        padding: '8px 12px',
        display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12,
      }}>
        {/* Left: name + editable checkpoint date */}
        <div style={{ flexShrink: 0 }}>
          <div style={{ fontWeight: 700, fontSize: 12, color: '#444441', marginBottom: 4 }}>
            {checkpoint.checkpoint_name || `CP${checkpoint.checkpoint_number}`}
          </div>
          {/* Editable checkpoint date — overlay pattern, local state only */}
          <div style={{ position: 'relative', display: 'inline-block' }}>
            <div style={{
              fontSize: 9, color: '#27500A',
              border: '1px dashed #3B6D11',
              background: '#EAF3DE',
              borderRadius: 3, padding: '1px 5px',
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

        {/* Right: C / P progress grid */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 160 }}>
          {/* C row */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
            <span style={{ fontSize: 9, textTransform: 'uppercase', color: '#888780', width: 10, flexShrink: 0 }}>C</span>
            <div style={{ flex: 1, height: 6, background: '#F1EFE8', borderRadius: 3, overflow: 'hidden' }}>
              <div style={{ width: `${cPct}%`, height: '100%', background: barFill || '#444441', borderRadius: 3, transition: 'width 0.2s' }} />
            </div>
            <span style={{ fontSize: 9, fontWeight: 500, color: '#444441', flexShrink: 0, display: 'flex', alignItems: 'center', gap: 2 }}>
              {c}/{tDisplay}
            </span>
          </div>
          {/* P row */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
            <span style={{ fontSize: 9, textTransform: 'uppercase', color: '#888780', width: 10, flexShrink: 0 }}>P</span>
            <div style={{ flex: 1, height: 6, background: '#F1EFE8', borderRadius: 3, overflow: 'hidden' }}>
              <div style={{ width: `${pPct}%`, height: '100%', background: barFill || '#B4B2A9', borderRadius: 3, transition: 'width 0.2s' }} />
            </div>
            <span style={{ fontSize: 9, fontWeight: 500, color: '#444441', flexShrink: 0, display: 'flex', alignItems: 'center', gap: 2 }}>
              {p}/{t}
            </span>
          </div>
        </div>
      </div>

      {/* Over-assigned warning strip */}
      {over && (
        <div style={{
          padding: '3px 12px 4px',
          background: '#FFF5F5',
          borderTop: '1px solid #FAD5D5',
          fontSize: 9, color: '#A32D2D',
        }}>
          ⚠ Over-assigned — {c + p} assigned, {t} required
        </div>
      )}

      {/* Body — outer pad + inner grid capped at 5 columns (5×106 + 4×6 = 554px) */}
      <div style={{ padding: 12, minHeight: 60 }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'stretch', maxWidth: 554 }}>
          {lots.map(a => (
            <LotPill
              key={a.assignment_id}
              assignment={a}
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
export default function TakedownAgreementsView() {
  const {
    agreements, entGroupName,
    selectedTdaId, setSelectedTdaId,
    detail, refetchDetail,
    loading, error,
  } = useTdaData(ENT_GROUP_ID)

  const [dragLot, setDragLot] = useState(null)

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
    <div style={{ padding: 32, color: '#6b7280' }}>Loading…</div>
  )
  if (error) return (
    <div style={{ padding: 32, color: '#dc2626' }}>Error: {error}</div>
  )

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: 'calc(100vh - 44px)', background: '#f9fafb' }}>
      {/* Page header */}
      <div style={{
        background: '#fff', borderBottom: '1px solid #e5e7eb',
        padding: '12px 24px', display: 'flex', justifyContent: 'space-between', alignItems: 'center',
      }}>
        <div>
          <h1 style={{ fontSize: 18, fontWeight: 700, color: '#111827', margin: 0 }}>
            Takedown Agreements
          </h1>
          <div style={{ fontSize: 12, color: '#6b7280', marginTop: 2 }}>
            {entGroupName}
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <select
            value={selectedTdaId || ''}
            onChange={e => setSelectedTdaId(Number(e.target.value))}
            style={{
              fontSize: 13, padding: '4px 8px', borderRadius: 6,
              border: '1px solid #d1d5db', background: '#fff', color: '#374151',
            }}
          >
            {agreements.map(a => (
              <option key={a.tda_id} value={a.tda_id}>{a.tda_name}</option>
            ))}
          </select>
          <button
            style={{
              fontSize: 12, padding: '4px 12px', borderRadius: 6,
              border: '1px solid #d1d5db', background: '#fff', color: '#6b7280',
              cursor: 'pointer',
            }}
          >
            + New agreement
          </button>
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

            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'flex-start' }}>
              <TdaCard detail={detail} colorIdx={tdaColorIdx >= 0 ? tdaColorIdx : 0}>
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
                padding: '2px 8px', borderRadius: 12,
                background: '#e0e7ff', border: '1px solid #818cf8',
                fontSize: 11, fontWeight: 600, color: '#3730a3',
              }}>
                {dragLot.lot.lot_number}
              </div>
            )}
            {dragLot?.type === 'assigned-lot' && (
              <div style={{
                width: 106, borderRadius: 6,
                background: '#fff', border: '1px solid #E4E2DA',
                padding: '5px 6px', fontSize: 11, fontWeight: 700, color: '#2C2C2A',
                textAlign: 'center',
              }}>
                {shortLot(dragLot.assignment.lot_number)}
              </div>
            )}
          </DragOverlay>
        </DndContext>
      ) : (
        <div style={{ padding: 32, color: '#9ca3af', fontSize: 14 }}>
          No agreement selected.
        </div>
      )}
    </div>
  )
}
