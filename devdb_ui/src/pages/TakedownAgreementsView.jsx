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

// ── Draggable unassigned lot pill ─────────────────────────────────
function UnassignedLotPill({ lot }) {
  const { attributes, listeners, setNodeRef, isDragging } =
    useDraggable({ id: `unassigned-${lot.lot_id}`, data: { type: 'unassigned-lot', lot } })
  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      style={{
        display: 'inline-flex', alignItems: 'center',
        padding: '2px 8px', borderRadius: 12,
        background: '#e0e7ff', border: '1px solid #818cf8',
        fontSize: 11, fontWeight: 600, color: '#3730a3',
        cursor: 'grab', opacity: isDragging ? 0.4 : 1,
        marginBottom: 4, marginRight: 4,
      }}
    >
      {lot.lot_number}
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
      {lots.map(lot => <UnassignedLotPill key={lot.lot_id} lot={lot} />)}
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
      flexShrink: 0,
    }}>
      {/* TDA header */}
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
      {/* TDA body */}
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
        padding: '0 2px', fontSize: 12, lineHeight: 1,
      }}
    >
      {locked ? '🔒' : '🔓'}
    </button>
  )
}

// ── Lot pill inside a checkpoint ──────────────────────────────────
function LotPill({ assignment, onDateChange, onLockChange }) {
  const { attributes, listeners, setNodeRef, isDragging } =
    useDraggable({
      id: `assigned-${assignment.assignment_id}`,
      data: { type: 'assigned-lot', assignment },
    })

  function dateField(label, marksDate, projDate, isLocked, dateKey, lockKey) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 2 }}>
        <span style={{ width: 28, fontSize: 10, fontWeight: 700, color: '#6b7280' }}>
          {label}
        </span>
        <span style={{ fontSize: 11, color: '#9ca3af', minWidth: 52 }}>
          {fmt(marksDate)}
        </span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
          {isLocked ? (
            <span style={{ fontSize: 11, color: '#166534', fontWeight: 600 }}>{fmt(projDate) || '—'}</span>
          ) : (
            <input
              type="date"
              defaultValue={projDate || ''}
              onChange={(e) => { if (e.target.value) onDateChange(dateKey, e.target.value) }}
              style={{
                fontSize: 11, border: '1px dashed #86efac',
                borderRadius: 4, padding: '1px 3px', width: 88,
                background: '#f0fdf4', color: '#166534',
                outline: 'none',
              }}
            />
          )}
          <LockBtn locked={isLocked} onClick={() => onLockChange(lockKey, !isLocked)} />
        </div>
      </div>
    )
  }

  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      style={{
        background: '#fff', border: '1px solid #d1fae5',
        borderRadius: 6, padding: '6px 8px', marginBottom: 6,
        cursor: 'grab', opacity: isDragging ? 0.4 : 1,
        boxShadow: '0 1px 2px rgba(0,0,0,0.06)',
      }}
    >
      <div style={{ fontWeight: 700, fontSize: 12, color: '#111827', marginBottom: 4 }}>
        {assignment.lot_number}
      </div>
      <div>
        {dateField('HC',
          assignment.hc_marks_date, assignment.hc_projected_date,
          assignment.hc_is_locked, 'hc_projected_date', 'hc_is_locked')}
        {dateField('BLDR',
          assignment.bldr_marks_date, assignment.bldr_projected_date,
          assignment.bldr_is_locked, 'bldr_projected_date', 'bldr_is_locked')}
      </div>
    </div>
  )
}

// ── Droppable checkpoint band ─────────────────────────────────────
function CheckpointBand({ checkpoint, onDateChange, onLockChange }) {
  const { setNodeRef, isOver } = useDroppable({
    id: `checkpoint-${checkpoint.checkpoint_id}`,
    data: { type: 'checkpoint', checkpointId: checkpoint.checkpoint_id },
  })

  const assigned = checkpoint.lots?.length || 0
  const required = checkpoint.lots_required_cumulative || 0
  const over = assigned > required

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
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontWeight: 700, fontSize: 13, color: '#444441' }}>
            {checkpoint.checkpoint_name || `CP${checkpoint.checkpoint_number}`}
          </span>
          <span style={{ fontSize: 11, color: '#888780' }}>
            → {fmt(checkpoint.checkpoint_date)}
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {over && (
            <span style={{
              fontSize: 11, color: '#b45309',
              background: '#fef3c7', padding: '1px 6px', borderRadius: 10,
            }}>
              ⚠ Over-assigned — {assigned} assigned, {required} required
            </span>
          )}
          <span style={{ fontSize: 12, color: '#444441', fontWeight: 600 }}>
            {assigned}/{required} lots
          </span>
        </div>
      </div>

      {/* Body */}
      <div style={{ padding: 12, minHeight: 60 }}>
        {(checkpoint.lots || []).map(a => (
          <LotPill
            key={a.assignment_id}
            assignment={a}
            onDateChange={(key, val) => onDateChange(a.assignment_id, { [key]: val })}
            onLockChange={(key, val) => onLockChange(a.assignment_id, { [key]: val })}
          />
        ))}
        {(checkpoint.lots || []).length === 0 && (
          <div style={{ color: '#9ca3af', fontSize: 12, textAlign: 'center', padding: 12 }}>
            Drop lots here
          </div>
        )}
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
      // Unassign first, then reassign
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
          {/* TDA selector */}
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
            {/* Unassigned bank */}
            <UnassignedBank lots={detail.unassigned_lots || []} />

            {/* TDA cards — flex-wrap row */}
            <div style={{ flex: 1, display: 'flex', flexWrap: 'wrap', gap: 16, alignItems: 'flex-start' }}>
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
                background: '#fff', border: '1px solid #d1fae5',
                borderRadius: 6, padding: '4px 8px',
                fontSize: 12, fontWeight: 700, color: '#111827',
              }}>
                {dragLot.assignment.lot_number}
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
