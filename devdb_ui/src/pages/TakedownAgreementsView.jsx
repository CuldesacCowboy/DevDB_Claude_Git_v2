import { useState, useCallback, useRef, useLayoutEffect, useMemo, useEffect } from 'react'
import { DndContext, DragOverlay, pointerWithin, PointerSensor, useSensor, useSensors } from '@dnd-kit/core'
import { useDraggable, useDroppable } from '@dnd-kit/core'
import { useTdaData } from '../hooks/useTdaData'
import { fmt, shortLot, parseLot, buildClusters } from '../utils/tdaUtils'
import { API_BASE } from '../config'

// ── Draggable unassigned lot pill ─────────────────────────────────
function UnassignedLotPill({ lot, isSelected, onToggle }) {
  const { attributes, listeners, setNodeRef, isDragging } =
    useDraggable({ id: `unassigned-${lot.lot_id}`, data: { type: 'unassigned-lot', lot } })
  const { code, seq } = parseLot(lot.lot_number)
  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      onClick={() => !isDragging && onToggle(lot.lot_id)}
      style={{
        width: 68, height: 34, flexShrink: 0,
        background: isSelected ? '#eff6ff' : '#fff',
        border: isSelected ? '2px solid #2563eb' : '0.5px solid #888780',
        borderRadius: 5,
        display: 'flex', alignItems: 'center',
        justifyContent: 'space-between',
        padding: '0 6px', boxSizing: 'border-box',
        cursor: 'grab', opacity: isDragging ? 0.4 : 1,
        position: 'relative',
      }}
    >
      <span style={{ fontSize: 11, color: isSelected ? '#2563eb' : '#888780' }}>{code}</span>
      <span style={{ fontSize: 12, fontWeight: 500, color: '#2C2C2A' }}>{seq}</span>
      {isSelected && (
        <div style={{
          position: 'absolute', top: 2, right: 2,
          width: 8, height: 8, borderRadius: '50%', background: '#2563eb',
        }} />
      )}
    </div>
  )
}

// ── Draggable TDA-pool lot pill ───────────────────────────────────
function TdaPoolLotPill({ lot, isSelected, onToggle }) {
  const { attributes, listeners, setNodeRef, isDragging } =
    useDraggable({ id: `pool-${lot.lot_id}`, data: { type: 'pool-lot', lot } })
  const { code, seq } = parseLot(lot.lot_number)
  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      onClick={() => !isDragging && onToggle && onToggle(lot.lot_id)}
      style={{
        width: 68, height: 34, flexShrink: 0,
        background: isSelected ? '#eef2ff' : '#fff',
        border: isSelected ? '2px solid #6366f1' : '0.5px solid #6366f1',
        borderRadius: 5,
        display: 'flex', alignItems: 'center',
        justifyContent: 'space-between',
        padding: '0 6px', boxSizing: 'border-box',
        cursor: 'grab', opacity: isDragging ? 0.4 : 1,
        position: 'relative',
      }}
    >
      <span style={{ fontSize: 11, color: '#6366f1' }}>{code}</span>
      <span style={{ fontSize: 12, fontWeight: 500, color: '#2C2C2A' }}>{seq}</span>
      {isSelected && (
        <div style={{
          position: 'absolute', top: 2, right: 2,
          width: 8, height: 8, borderRadius: '50%', background: '#6366f1',
        }} />
      )}
    </div>
  )
}

// ── Droppable TDA pool bank ───────────────────────────────────────
function TdaPoolBank({ lots, tdaName, selectedIds, onToggle, onToggleDevGroup, onRemoveFromPool, onClearSelection }) {
  const { setNodeRef, isOver } = useDroppable({ id: 'tda-pool', data: { type: 'tda-pool' } })

  const devGroups = useMemo(() => {
    const groups = {}
    for (const lot of lots) {
      const code = lot.lot_number?.match(/^([A-Za-z]+)/)?.[1] ?? '??'
      if (!groups[code]) groups[code] = []
      groups[code].push(lot)
    }
    return Object.entries(groups)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([devCode, devLots]) => ({ devCode, devLots }))
  }, [lots])

  const selCount = selectedIds?.size || 0

  return (
    <div
      ref={setNodeRef}
      style={{
        width: 240, flexShrink: 0,
        background: isOver ? '#eef2ff' : '#f5f3ff',
        border: `2px solid ${isOver ? '#6366f1' : '#c7d2fe'}`,
        borderRadius: 8, padding: 14,
        minHeight: 200, transition: 'all 0.15s',
      }}
    >
      <div style={{ fontWeight: 700, fontSize: 15, color: '#3730a3', marginBottom: 4 }}>
        In Agreement
      </div>
      <div style={{ fontSize: 13, color: '#818cf8', marginBottom: selCount > 0 ? 8 : 10 }}>
        {lots.length} lot{lots.length !== 1 ? 's' : ''} · no checkpoint
      </div>

      {/* Selection action bar */}
      {selCount > 0 && (
        <div style={{
          marginBottom: 10, padding: '6px 8px', borderRadius: 6,
          background: '#e0e7ff', border: '1px solid #a5b4fc',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6,
        }}>
          <span style={{ fontSize: 12, color: '#3730a3', fontWeight: 500 }}>
            {selCount} selected
          </span>
          <div style={{ display: 'flex', gap: 6 }}>
            <button
              onClick={onRemoveFromPool}
              style={{
                fontSize: 11, padding: '3px 8px', borderRadius: 4,
                border: 'none', background: '#4f46e5', color: '#fff',
                cursor: 'pointer', fontWeight: 600,
              }}
            >
              Remove
            </button>
            <button
              onClick={onClearSelection}
              style={{
                fontSize: 11, padding: '3px 6px', borderRadius: 4,
                border: '1px solid #a5b4fc', background: 'transparent', color: '#3730a3',
                cursor: 'pointer',
              }}
            >
              Clear
            </button>
          </div>
        </div>
      )}

      {/* Dev groups */}
      {devGroups.map(({ devCode, devLots }) => {
        const allSel = devLots.every(l => selectedIds?.has(l.lot_id))
        const someSel = devLots.some(l => selectedIds?.has(l.lot_id))
        return (
          <div key={devCode} style={{ marginBottom: 10 }}>
            <div style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              marginBottom: 5,
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <div style={{ height: 1, width: 8, background: '#c7d2fe' }} />
                <span style={{ fontSize: 11, fontWeight: 700, color: '#4f46e5', letterSpacing: '0.06em' }}>
                  {devCode}
                </span>
                <span style={{ fontSize: 11, color: '#818cf8' }}>
                  {devLots.length}
                </span>
              </div>
              <button
                onClick={() => onToggleDevGroup && onToggleDevGroup(devLots)}
                style={{
                  fontSize: 10, padding: '1px 6px', borderRadius: 3,
                  border: `1px solid ${allSel ? '#6366f1' : '#c7d2fe'}`,
                  background: allSel ? '#e0e7ff' : 'transparent',
                  color: allSel ? '#3730a3' : someSel ? '#6366f1' : '#a5b4fc',
                  cursor: 'pointer', fontWeight: 500,
                }}
              >
                {allSel ? 'deselect' : 'select all'}
              </button>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 68px)', gap: 4 }}>
              {devLots.map(lot => (
                <TdaPoolLotPill
                  key={lot.lot_id}
                  lot={lot}
                  isSelected={selectedIds?.has(lot.lot_id)}
                  onToggle={onToggle}
                />
              ))}
            </div>
          </div>
        )
      })}

      {lots.length === 0 && (
        <p style={{ fontSize: 12, color: '#818cf8', fontStyle: 'italic', textAlign: 'center', marginTop: 12 }}>
          {isOver ? 'Drop to add to pool' : 'No lots in pool'}
        </p>
      )}
    </div>
  )
}

// ── Droppable unassigned bank ─────────────────────────────────────
function UnassignedBank({ lots, selectedIds, onToggle, onToggleDevGroup, onAddToPool, onClearSelection }) {
  const { setNodeRef, isOver } = useDroppable({ id: 'unassigned-bank', data: { type: 'unassigned-bank' } })

  const devGroups = useMemo(() => {
    const groups = {}
    for (const lot of lots) {
      const code = lot.lot_number?.match(/^([A-Za-z]+)/)?.[1] ?? '??'
      if (!groups[code]) groups[code] = []
      groups[code].push(lot)
    }
    return Object.entries(groups)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([devCode, devLots]) => ({ devCode, devLots }))
  }, [lots])

  const selCount = selectedIds.size

  return (
    <div
      ref={setNodeRef}
      style={{
        width: 252, flexShrink: 0,
        background: isOver ? '#eff6ff' : '#f9fafb',
        border: `2px solid ${isOver ? '#3b82f6' : '#e5e7eb'}`,
        borderRadius: 8, padding: 12,
        minHeight: 200, transition: 'all 0.15s',
      }}
    >
      <div style={{ fontWeight: 700, fontSize: 15, color: '#374151', marginBottom: 2 }}>
        Unassigned
      </div>
      <div style={{ fontSize: 13, color: '#9ca3af', marginBottom: selCount > 0 ? 8 : 10 }}>
        {lots.length} lot{lots.length !== 1 ? 's' : ''}
      </div>

      {/* Selection action bar */}
      {selCount > 0 && (
        <div style={{
          marginBottom: 10, padding: '6px 8px', borderRadius: 6,
          background: '#dbeafe', border: '1px solid #93c5fd',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6,
        }}>
          <span style={{ fontSize: 12, color: '#1d4ed8', fontWeight: 500 }}>
            {selCount} selected
          </span>
          <div style={{ display: 'flex', gap: 6 }}>
            <button
              onClick={onAddToPool}
              style={{
                fontSize: 11, padding: '3px 8px', borderRadius: 4,
                border: 'none', background: '#2563eb', color: '#fff',
                cursor: 'pointer', fontWeight: 600,
              }}
            >
              Add to In Agreement
            </button>
            <button
              onClick={onClearSelection}
              style={{
                fontSize: 11, padding: '3px 6px', borderRadius: 4,
                border: '1px solid #93c5fd', background: 'transparent', color: '#1d4ed8',
                cursor: 'pointer',
              }}
            >
              Clear
            </button>
          </div>
        </div>
      )}

      {/* Dev groups */}
      {devGroups.map(({ devCode, devLots }) => {
        const allSel = devLots.every(l => selectedIds.has(l.lot_id))
        const someSel = devLots.some(l => selectedIds.has(l.lot_id))
        return (
          <div key={devCode} style={{ marginBottom: 10 }}>
            <div style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              marginBottom: 5,
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <div style={{ height: 1, width: 8, background: '#d1d5db' }} />
                <span style={{ fontSize: 11, fontWeight: 700, color: '#6b7280', letterSpacing: '0.06em' }}>
                  {devCode}
                </span>
                <span style={{ fontSize: 11, color: '#9ca3af' }}>
                  {devLots.length}
                </span>
              </div>
              <button
                onClick={() => onToggleDevGroup(devLots)}
                style={{
                  fontSize: 10, padding: '1px 6px', borderRadius: 3,
                  border: `1px solid ${allSel ? '#2563eb' : '#d1d5db'}`,
                  background: allSel ? '#dbeafe' : 'transparent',
                  color: allSel ? '#1d4ed8' : someSel ? '#2563eb' : '#9ca3af',
                  cursor: 'pointer', fontWeight: 500,
                }}
              >
                {allSel ? 'deselect' : 'select all'}
              </button>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 68px)', gap: 4 }}>
              {devLots.map(lot => (
                <UnassignedLotPill
                  key={lot.lot_id}
                  lot={lot}
                  isSelected={selectedIds.has(lot.lot_id)}
                  onToggle={onToggle}
                />
              ))}
            </div>
          </div>
        )
      })}

      {lots.length === 0 && (
        <p style={{ fontSize: 12, color: '#9ca3af', fontStyle: 'italic', textAlign: 'center', marginTop: 12 }}>
          {isOver ? 'Drop to unassign' : 'All lots in an agreement'}
        </p>
      )}
    </div>
  )
}

// ── Droppable tile for another TDA ───────────────────────────────
function OtherTdaTile({ agreement, onNavigate }) {
  const { setNodeRef, isOver } = useDroppable({
    id: `other-tda-${agreement.tda_id}`,
    data: { type: 'other-tda', tdaId: agreement.tda_id },
  })
  return (
    <div
      ref={setNodeRef}
      style={{
        width: 240,
        background: isOver ? '#eff6ff' : '#fff',
        border: `1.5px solid ${isOver ? '#3b82f6' : '#e5e7eb'}`,
        borderRadius: 8, padding: '10px 14px',
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        transition: 'all 0.15s',
      }}
    >
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{
          fontSize: 13, fontWeight: 600, color: isOver ? '#1d4ed8' : '#374151',
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
          transition: 'color 0.15s',
        }}>
          {agreement.tda_name}
        </div>
        <div style={{ fontSize: 12, color: '#9ca3af', marginTop: 2 }}>
          {agreement.total_lots} lot{agreement.total_lots !== 1 ? 's' : ''}
        </div>
      </div>
      <button
        onClick={() => onNavigate(agreement.tda_id)}
        title={`Switch to ${agreement.tda_name}`}
        style={{
          flexShrink: 0, marginLeft: 10,
          background: 'none', border: 'none', cursor: 'pointer',
          color: '#9ca3af', padding: '4px 6px', borderRadius: 4,
          fontSize: 16, lineHeight: 1,
          display: 'flex', alignItems: 'center',
        }}
      >
        →
      </button>
    </div>
  )
}

// ── TDA card wrapper ──────────────────────────────────────────────
function TdaCard({ detail, onCheckpointCreated, children }) {
  const poolCount = detail.pool_lots?.length || 0
  const cpCounts = (detail.checkpoints || []).map(cp => ({ name: cp.checkpoint_name, count: cp.lots?.length || 0 }))
  const totalLots = poolCount + cpCounts.reduce((sum, cp) => sum + cp.count, 0)
  const [showAddCP, setShowAddCP] = useState(false)
  const [cpDate, setCpDate] = useState('')
  const [cpLots, setCpLots] = useState('')
  const [cpCreating, setCpCreating] = useState(false)

  async function handleAddCheckpoint() {
    setCpCreating(true)
    try {
      await fetch(`${API_BASE}/takedown-agreements/${detail.tda_id}/checkpoints`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          checkpoint_date: cpDate || null,
          lots_required_cumulative: parseInt(cpLots, 10) || 0,
        }),
      })
      setCpDate(''); setCpLots(''); setShowAddCP(false)
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
        background: '#F0EEE8', padding: '10px 16px',
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
      }}>
        <span style={{ fontWeight: 700, fontSize: 16, color: '#2C2C2A' }}>
          {detail.tda_name}
        </span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 0, marginLeft: 14, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 12, color: '#888780', marginLeft: 10 }}>
            no&nbsp;cp:&nbsp;{poolCount}
          </span>
          {cpCounts.map((cp, i) => (
            <span key={i} style={{ fontSize: 12, color: '#888780', marginLeft: 10 }}>
              cp{i + 1}:&nbsp;{cp.count}
            </span>
          ))}
          <span style={{ fontSize: 13, fontWeight: 600, color: '#444441', marginLeft: 12 }}>
            {totalLots}&nbsp;total
          </span>
        </div>
      </div>
      <div style={{ background: '#F7F6F3', padding: 14 }}>
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
              type="number"
              min={0}
              placeholder="Lots required"
              value={cpLots}
              onChange={e => setCpLots(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter') handleAddCheckpoint()
                if (e.key === 'Escape') { setShowAddCP(false); setCpDate(''); setCpLots('') }
              }}
              style={{
                fontSize: 14, padding: '4px 8px', borderRadius: 5,
                border: '1px solid #d1d5db', outline: 'none', width: 110,
              }}
            />
            <input
              type="date"
              value={cpDate}
              onChange={e => setCpDate(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Escape') { setShowAddCP(false); setCpDate(''); setCpLots('') }
              }}
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
              onClick={() => { setShowAddCP(false); setCpDate(''); setCpLots('') }}
              style={{
                fontSize: 13, padding: '4px 10px', borderRadius: 5,
                border: '1px solid #d1d5db', background: '#fff', color: '#6b7280',
                cursor: 'pointer',
              }}
            >
              Cancel
            </button>
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
  const inputRef = useRef(null)
  const [pending, setPending] = useState(value || '')
  const pendingRef = useRef(value || '')
  const timerRef = useRef(null)

  useEffect(() => {
    // When server value changes, cancel any pending commit and sync display
    if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null }
    setPending(value || '')
    pendingRef.current = value || ''
  }, [value])

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
    <div
      style={{ position: 'relative' }}
      onClick={() => inputRef.current?.showPicker?.()}
    >
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
        {fmt(pending) || '—'}
      </div>
      <input
        ref={inputRef}
        type="date"
        value={pending}
        onChange={(e) => {
          const val = e.target.value
          setPending(val)
          pendingRef.current = val
          // Debounce: with pointerEvents:none, blur fires before change in Chrome.
          // Using onChange as primary commit (350ms) handles that race correctly.
          if (timerRef.current) clearTimeout(timerRef.current)
          timerRef.current = setTimeout(() => {
            timerRef.current = null
            onChange(pendingRef.current || null)
          }, 350)
        }}
        onBlur={() => {
          // Flush immediately if a debounced commit is pending
          if (timerRef.current) {
            clearTimeout(timerRef.current)
            timerRef.current = null
            onChange(pendingRef.current || null)
          }
        }}
        style={{
          position: 'absolute', inset: 0,
          width: '100%', height: '100%',
          opacity: 0, cursor: 'default',
          border: 'none', padding: 0, margin: 0,
          pointerEvents: 'none',
        }}
      />
    </div>
  )
}

// ── Lot pill inside a checkpoint ──────────────────────────────────
function LotPill({ assignment, onDateChange, onLockChange, isExcess = false, checkpointDate = '' }) {
  const { attributes, listeners, setNodeRef, isDragging } =
    useDraggable({
      id: `assigned-${assignment.assignment_id}`,
      data: { type: 'assigned-lot', assignment },
    })

  // Local projected date state for instant caution recompute (no refetch needed)
  const [localHcDate, setLocalHcDate] = useState(assignment.hc_projected_date || '')
  const [localBldrDate, setLocalBldrDate] = useState(assignment.bldr_projected_date || '')
  useEffect(() => { setLocalHcDate(assignment.hc_projected_date || '') }, [assignment.hc_projected_date])
  useEffect(() => { setLocalBldrDate(assignment.bldr_projected_date || '') }, [assignment.bldr_projected_date])

  const todayStr = new Date().toISOString().slice(0, 10)
  const isFuture = (d) => !!d && d > todayStr
  const cpIsPast = !!checkpointDate && checkpointDate <= todayStr
  const hcMeetsCP = !!localHcDate && localHcDate <= checkpointDate
  const bldrMeetsCP = !!localBldrDate && localBldrDate <= checkpointDate
  const neitherMeets = !hcMeetsCP && !bldrMeetsCP
  // Delinquent: checkpoint passed and this lot has no projected date on/before it
  const isDelinquent = !!checkpointDate && cpIsPast && neitherMeets
  // Caution: future checkpoint only — if it were past it would be delinquent instead
  const hasAnyFutureDate = isFuture(localHcDate) || isFuture(localBldrDate)
  const isCaution = !!checkpointDate && !cpIsPast && hasAnyFutureDate && neitherMeets
  // No dates: neither projected date entered (and not already flagged by a higher-priority state)
  const hasNoDates = !localHcDate && !localBldrDate && !isDelinquent && !isCaution

  function col(label, marksDate, projDate, isLocked, dateKey, lockKey) {
    return (
      <div style={{ flex: 1, minWidth: 0, overflow: 'hidden' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 3 }}>
          <span style={{ fontSize: 11, textTransform: 'uppercase', color: '#888780', letterSpacing: '0.04em' }}>
            {label}
          </span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            {marksDate && (
              <button
                title="Set projected date to MARKsystems date and lock"
                onClick={() => {
                  if (dateKey === 'hc_projected_date') setLocalHcDate(marksDate)
                  if (dateKey === 'bldr_projected_date') setLocalBldrDate(marksDate)
                  onDateChange(dateKey, marksDate); onLockChange(lockKey, true)
                }}
                style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '0 1px', lineHeight: 1, display: 'inline-flex', alignItems: 'center' }}
              >
                <svg width="11" height="11" viewBox="0 0 12 12" fill="none">
                  <path d="M10 6A4 4 0 1 1 8.5 2.8" stroke="#B4B2A9" strokeWidth="1.5" strokeLinecap="round"/>
                  <polyline points="8.5,1 8.5,3 10.5,3" stroke="#B4B2A9" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              </button>
            )}
            <LockBtn locked={isLocked} onClick={() => onLockChange(lockKey, !isLocked)} />
          </div>
        </div>
        <div style={{ fontSize: 12, color: '#B4B2A9', marginBottom: 4, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {fmt(marksDate)}
        </div>
        <ProjectedDateField
          value={projDate}
          locked={isLocked}
          onChange={(val) => {
            if (dateKey === 'hc_projected_date') setLocalHcDate(val || '')
            if (dateKey === 'bldr_projected_date') setLocalBldrDate(val || '')
            onDateChange(dateKey, val)
          }}
        />
      </div>
    )
  }

  // Winning fulfillment date: earlier of HC and BLDR projected dates
  const winningDate = (() => {
    const dates = [localHcDate, localBldrDate].filter(Boolean)
    return dates.length ? dates.reduce((m, d) => d < m ? d : m) : null
  })()

  return (
    <div
      ref={setNodeRef}
      style={{
        width: 148, flexShrink: 0,
        borderRadius: 6, overflow: 'hidden',
        background: isExcess ? '#FFF5F5' : isDelinquent ? '#fef2f2' : isCaution ? '#FFFBEB' : hasNoDates ? '#F7F6F3' : '#fff',
        border: isExcess ? '1.5px dashed #E24B4A' : isDelinquent ? '1.5px solid #dc2626' : isCaution ? '1.5px dashed #D97706' : hasNoDates ? '1px dashed #C8C6BE' : '1px solid #E4E2DA',
        opacity: isDragging ? 0.4 : 1,
        boxShadow: '0 1px 2px rgba(0,0,0,0.06)',
        display: 'flex', flexDirection: 'column',
      }}
    >
      <div
        {...attributes}
        {...listeners}
        style={{
          textAlign: 'center',
          padding: '5px 8px 6px',
          cursor: 'grab',
          background: isExcess ? '#FFF0F0' : isDelinquent ? '#fee2e2' : isCaution ? '#FEF3C7' : hasNoDates ? '#EEECEA' : '#FAFAF8',
          borderBottom: `1px solid ${isExcess ? '#FFCCC9' : isDelinquent ? '#fecaca' : isCaution ? '#FDE68A' : hasNoDates ? '#DDDBD3' : '#F0EEE8'}`,
          userSelect: 'none',
        }}
      >
        <div style={{ fontSize: 14, fontWeight: 700, color: '#2C2C2A', lineHeight: 1.2 }}>
          {shortLot(assignment.lot_number)}
        </div>
        {winningDate ? (
          <div style={{ fontSize: 11, color: '#888780', marginTop: 2, lineHeight: 1 }}>
            {fmt(winningDate)}
          </div>
        ) : (
          <div style={{ fontSize: 11, color: '#D4D2CB', marginTop: 2, lineHeight: 1 }}>—</div>
        )}
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

// ── Stitch connector between building-group pills ────────────────
// A narrow panel with a center-track + crossbar SVG pattern that implies
// units are sewn together.
function StitchConnector() {
  const w = 14
  const crossbarSvg = encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="12">` +
    `<line x1="${w / 2}" y1="0" x2="${w / 2}" y2="12" stroke="#C8C6BE" stroke-width="1.5"/>` +
    `<line x1="2" y1="3" x2="${w - 2}" y2="3" stroke="#C8C6BE" stroke-width="1.5"/>` +
    `<line x1="2" y1="9" x2="${w - 2}" y2="9" stroke="#C8C6BE" stroke-width="1.5"/>` +
    `</svg>`
  )
  return (
    <div style={{
      width: w,
      flexShrink: 0,
      alignSelf: 'stretch',
      backgroundImage: `url("data:image/svg+xml,${crossbarSvg}")`,
      backgroundRepeat: 'repeat-y',
      backgroundSize: `${w}px 12px`,
      backgroundPositionX: 'center',
    }} />
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
          width: 42, fontSize: 15, fontWeight: 700,
          border: '1px dashed #3B6D11',
          background: '#EAF3DE', color: '#27500A',
          borderRadius: 3, padding: '1px 2px',
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
        fontSize: 15, fontWeight: 700, color: '#27500A',
        border: '1px dashed #3B6D11',
        background: '#EAF3DE',
        borderRadius: 3, padding: '1px 6px',
        cursor: 'pointer',
      }}
    >
      {value}
    </span>
  )
}

// ── Checkpoint timeline (dot-plot) ───────────────────────────────
// Receives all assigned lots + placeholder slot count.
// Every slot gets a row: lots with dates get dots, all others get a ghost line.
function CheckpointTimeline({ lots, slotCount, checkpointDate, lotsRequired }) {
  const containerRef = useRef(null)
  const [width, setWidth] = useState(0)

  useLayoutEffect(() => {
    const el = containerRef.current
    if (!el) return
    setWidth(Math.floor(el.getBoundingClientRect().width))
    const obs = new ResizeObserver(([e]) => setWidth(Math.floor(e.contentRect.width)))
    obs.observe(el)
    return () => obs.disconnect()
  }, [])

  // Layout constants — readable sizes throughout
  const PAD_L = 80   // label column width
  const PAD_R = 20
  const ROW_H = 28
  const AXIS_ROW_H = 18   // height of each axis band (month / quarter / year)
  const TOP_PAD = 34      // room for checkpoint label above first row

  const chartW = Math.max(1, width - PAD_L - PAD_R)

  // Build one row per assigned lot + one ghost row per placeholder slot
  const allRows = [
    ...lots.map(l => ({
      key: `lot-${l.assignment_id ?? l.lot_id}`,
      label: shortLot(l.lot_number),
      hcDate: l.hc_projected_date || null,
      bldrDate: l.bldr_projected_date || null,
      ghost: !l.hc_projected_date && !l.bldr_projected_date,
    })),
    ...Array.from({ length: slotCount }, (_, i) => ({
      key: `slot-${i}`,
      label: '—',
      hcDate: null,
      bldrDate: null,
      ghost: true,
    })),
  ]
  const nRows = allRows.length

  // Time domain: lot dates + checkpoint only — today never stretches the axis.
  // Today's line is shown only when it falls within the natural date range.
  const todayTs = new Date().setHours(0, 0, 0, 0)
  const lotAndCpTs = [
    ...lots.flatMap(l => [l.hc_projected_date, l.bldr_projected_date]),
    checkpointDate,
  ].filter(Boolean).map(d => new Date(d).getTime())

  const rawMin = lotAndCpTs.length ? Math.min(...lotAndCpTs) : todayTs
  const rawMax = lotAndCpTs.length ? Math.max(...lotAndCpTs) : todayTs
  const span = rawMax - rawMin || 30 * 86400000
  const domMin = rawMin - span * 0.10
  const domMax = rawMax + span * 0.10

  const toX = ts => PAD_L + ((ts - domMin) / (domMax - domMin)) * chartW
  const dateX = d => d ? toX(new Date(d).getTime()) : null
  const todayX = toX(todayTs)
  // Only draw today line when it falls within the visible domain (not distorting the axis)
  const showToday = todayTs >= rawMin && todayTs <= rawMax
  const cpX = checkpointDate ? dateX(checkpointDate) : null

  // Generate period boundary timestamps within the domain
  function monthStarts() {
    const out = []
    const d = new Date(domMin); d.setDate(1); d.setHours(0, 0, 0, 0)
    while (d.getTime() <= domMax) { out.push(d.getTime()); d.setMonth(d.getMonth() + 1) }
    return out
  }
  const allMonths = monthStarts()
  const quarterBounds = allMonths.filter(ts => [0, 3, 6, 9].includes(new Date(ts).getMonth()))
  const yearBounds = allMonths.filter(ts => new Date(ts).getMonth() === 0)

  // Build axis cells: list of { x1, x2, rawX1, label } clipped to [PAD_L, PAD_L+chartW]
  function buildCells(bounds, labelFn) {
    const cells = bounds.map((ts, i) => {
      const nextTs = i + 1 < bounds.length ? bounds[i + 1] : domMax
      const rx1 = toX(Math.max(ts, domMin))
      const rx2 = toX(Math.min(nextTs, domMax))
      return { x1: Math.max(rx1, PAD_L), x2: Math.min(rx2, PAD_L + chartW), rawX1: rx1, label: labelFn(new Date(ts)) }
    }).filter(c => c.x2 > PAD_L && c.x1 < PAD_L + chartW)
    // Fallback: if no boundary starts inside domain, one spanning cell
    if (cells.length === 0 && bounds.length > 0) {
      cells.push({ x1: PAD_L, x2: PAD_L + chartW, rawX1: PAD_L - 1, label: labelFn(new Date(bounds[0])) })
    }
    return cells
  }

  const monthCells   = buildCells(allMonths,    d => d.toLocaleString('en-US', { month: 'short' }))
  const quarterCells = buildCells(quarterBounds, d => `Q${Math.floor(d.getMonth() / 3) + 1}`)
  const yearCells    = buildCells(yearBounds,    d => `${d.getFullYear()}`)

  // Fallback: if checkpoint / today set a year/quarter not in yearBounds/quarterBounds
  if (yearCells.length === 0 && checkpointDate) {
    const yr = new Date(checkpointDate).getFullYear()
    yearCells.push({ x1: PAD_L, x2: PAD_L + chartW, rawX1: PAD_L - 1, label: `${yr}` })
  }
  if (quarterCells.length === 0 && checkpointDate) {
    const q = Math.floor(new Date(checkpointDate).getMonth() / 3) + 1
    quarterCells.push({ x1: PAD_L, x2: PAD_L + chartW, rawX1: PAD_L - 1, label: `Q${q}` })
  }

  // Vertical positions
  const dataTop  = TOP_PAD
  const dataBot  = dataTop + nRows * ROW_H
  const monthTop = dataBot
  const qTop     = monthTop + AXIS_ROW_H
  const yearTop  = qTop + AXIS_ROW_H
  const svgH     = yearTop + AXIS_ROW_H

  // Checkpoint label: "{n} by mm/dd/yy", anchor flips near edges
  const cpLabel  = checkpointDate
    ? `${lotsRequired != null ? lotsRequired : ''}  by ${fmt(checkpointDate)}`.trimStart()
    : null
  const cpAnchor = cpX == null ? 'middle'
    : cpX < PAD_L + chartW * 0.18 ? 'start'
    : cpX > PAD_L + chartW * 0.82 ? 'end'
    : 'middle'

  if (width === 0) return <div ref={containerRef} style={{ width: '100%', height: 8 }} />

  return (
    <div ref={containerRef} style={{ padding: '4px 14px 14px' }}>
      <svg
        width={width - 28}
        height={svgH}
        style={{ display: 'block', overflow: 'visible' }}
      >
        {/* ── Month grid lines through data area ── */}
        {allMonths.map((ts, i) => {
          const x = toX(ts)
          return (x >= PAD_L && x <= PAD_L + chartW)
            ? <line key={i} x1={x} y1={dataTop} x2={x} y2={dataBot} stroke="#EDEDEA" strokeWidth={1} />
            : null
        })}

        {/* today line is rendered LAST so it draws on top — see below */}

        {/* ── Checkpoint line — solid red, label sits above line start ── */}
        {cpX !== null && (
          <g>
            {cpLabel && (
              <text
                x={cpX + (cpAnchor === 'end' ? -5 : cpAnchor === 'start' ? 5 : 0)}
                y={2}
                textAnchor={cpAnchor} dominantBaseline="hanging"
                fontSize={12} fontWeight={700} fill="#dc2626"
              >{cpLabel}</text>
            )}
            <line x1={cpX} y1={dataTop - 2} x2={cpX} y2={dataBot} stroke="#dc2626" strokeWidth={2} />
          </g>
        )}

        {/* ── Chart border ── */}
        <rect x={PAD_L} y={dataTop} width={chartW} height={nRows * ROW_H}
          fill="none" stroke="#E4E2DA" strokeWidth={1} />

        {/* ── Lot / slot rows ── */}
        {allRows.map((row, i) => {
          const cy = dataTop + i * ROW_H + ROW_H / 2
          const hx = dateX(row.hcDate)
          const bx = dateX(row.bldrDate)
          const hasDate = hx !== null || bx !== null
          const meetsCp = cpX !== null && hasDate && (
            (hx !== null && hx <= cpX) || (bx !== null && bx <= cpX)
          )
          // Has dates but earliest is after the checkpoint date
          const missesCp = cpX !== null && hasDate && !meetsCp

          return (
            <g key={row.key}>
              {/* Icon + lot label — single text block, right-aligned */}
              <text x={PAD_L - 8} y={cy} textAnchor="end" dominantBaseline="middle" fontSize={13}>
                {meetsCp && (
                  <tspan fill="#15803d" fontWeight={700}>✓</tspan>
                )}
                {missesCp && (
                  <tspan fill="#b45309" fontWeight={700}>↷</tspan>
                )}
                <tspan
                  fill={row.ghost ? '#C8C6BE' : '#6B6B68'}
                  dx={meetsCp || missesCp ? 5 : 0}
                >{row.label}</tspan>
              </text>

              {row.ghost ? (
                // Ghost row: dashed line spanning full chart width
                <line
                  x1={PAD_L + 6} y1={cy} x2={PAD_L + chartW - 6} y2={cy}
                  stroke="#DDDBD3" strokeWidth={1} strokeDasharray="5,5"
                />
              ) : (
                <>
                  {/* Connector */}
                  {hx !== null && bx !== null && (
                    <line
                      x1={Math.min(hx, bx)} y1={cy}
                      x2={Math.max(hx, bx)} y2={cy}
                      stroke="#C8C6BE" strokeWidth={2.5}
                    />
                  )}
                  {/* HC dot */}
                  {hx !== null && (
                    <circle cx={hx} cy={cy} r={6} fill="#2563eb" stroke="#fff" strokeWidth={1.5}>
                      <title>HC: {fmt(row.hcDate)}</title>
                    </circle>
                  )}
                  {/* BLDR dot */}
                  {bx !== null && (
                    <circle cx={bx} cy={cy} r={6} fill="#d97706" stroke="#fff" strokeWidth={1.5}>
                      <title>BLDR: {fmt(row.bldrDate)}</title>
                    </circle>
                  )}
                </>
              )}
            </g>
          )
        })}

        {/* ── Today line — rendered last so it appears on top of all row content ── */}
        {showToday && todayX >= PAD_L && todayX <= PAD_L + chartW && (() => {
          // Flip label to opposite side when close to checkpoint line
          const nearCp = cpX !== null && Math.abs(todayX - cpX) < 52
          const labelRight = nearCp ? todayX < cpX : todayX > PAD_L + chartW * 0.7
          const labelX = labelRight ? todayX - 5 : todayX + 5
          const labelAnchor = labelRight ? 'end' : 'start'
          // Suppress label entirely if it would still overlap the checkpoint label area
          const suppressLabel = nearCp && Math.abs(todayX - cpX) < 28
          return (
            <g>
              <line x1={todayX} y1={dataTop} x2={todayX} y2={dataBot}
                stroke="#444441" strokeWidth={1.5} />
              {!suppressLabel && (
                <text x={labelX} y={dataTop + 5}
                  dominantBaseline="hanging" textAnchor={labelAnchor}
                  fontSize={12} fontWeight={600} fill="#444441"
                >today</text>
              )}
            </g>
          )
        })()}

        {/* ── Month axis band ── */}
        <rect x={PAD_L} y={monthTop} width={chartW} height={AXIS_ROW_H} fill="#F3F2EE" />
        {monthCells.map((c, i) => (
          <g key={`m${i}`}>
            {c.rawX1 > PAD_L && c.rawX1 < PAD_L + chartW && (
              <line x1={c.rawX1} y1={monthTop} x2={c.rawX1} y2={monthTop + AXIS_ROW_H}
                stroke="#E4E2DA" strokeWidth={1} />
            )}
            {(c.x2 - c.x1) >= 28 && (
              <text x={(c.x1 + c.x2) / 2} y={monthTop + AXIS_ROW_H / 2}
                textAnchor="middle" dominantBaseline="middle"
                fontSize={12} fill="#6B6B68">{c.label}</text>
            )}
          </g>
        ))}
        <line x1={PAD_L} y1={monthTop + AXIS_ROW_H} x2={PAD_L + chartW} y2={monthTop + AXIS_ROW_H}
          stroke="#E4E2DA" strokeWidth={1} />

        {/* ── Quarter axis band ── */}
        <rect x={PAD_L} y={qTop} width={chartW} height={AXIS_ROW_H} fill="#ECEAE4" />
        {quarterCells.map((c, i) => (
          <g key={`q${i}`}>
            {c.rawX1 > PAD_L && c.rawX1 < PAD_L + chartW && (
              <line x1={c.rawX1} y1={qTop} x2={c.rawX1} y2={qTop + AXIS_ROW_H}
                stroke="#D4D2CB" strokeWidth={1} />
            )}
            {(c.x2 - c.x1) >= 20 && (
              <text x={(c.x1 + c.x2) / 2} y={qTop + AXIS_ROW_H / 2}
                textAnchor="middle" dominantBaseline="middle"
                fontSize={12} fontWeight={600} fill="#6B6B68">{c.label}</text>
            )}
          </g>
        ))}
        <line x1={PAD_L} y1={qTop + AXIS_ROW_H} x2={PAD_L + chartW} y2={qTop + AXIS_ROW_H}
          stroke="#D4D2CB" strokeWidth={1} />

        {/* ── Year axis band ── */}
        <rect x={PAD_L} y={yearTop} width={chartW} height={AXIS_ROW_H} fill="#E4E1D8" />
        {yearCells.map((c, i) => (
          <g key={`y${i}`}>
            {c.rawX1 > PAD_L && c.rawX1 < PAD_L + chartW && (
              <line x1={c.rawX1} y1={yearTop} x2={c.rawX1} y2={yearTop + AXIS_ROW_H}
                stroke="#C8C6BE" strokeWidth={1} />
            )}
            {(c.x2 - c.x1) >= 32 && (
              <text x={(c.x1 + c.x2) / 2} y={yearTop + AXIS_ROW_H / 2}
                textAnchor="middle" dominantBaseline="middle"
                fontSize={13} fontWeight={700} fill="#444441">{c.label}</text>
            )}
          </g>
        ))}
        <line x1={PAD_L} y1={yearTop + AXIS_ROW_H} x2={PAD_L + chartW} y2={yearTop + AXIS_ROW_H}
          stroke="#C8C6BE" strokeWidth={1} />

      </svg>

      {/* Legend */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginTop: 6, paddingLeft: PAD_L }}>
        {[{ color: '#2563eb', label: 'HC' }, { color: '#d97706', label: 'BLDR' }].map(({ color, label }) => (
          <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
            <svg width={13} height={13}><circle cx={6.5} cy={6.5} r={6} fill={color} /></svg>
            <span style={{ fontSize: 12, color: '#888780' }}>{label}</span>
          </div>
        ))}
        <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
          <svg width={18} height={13}><line x1={0} y1={6.5} x2={18} y2={6.5} stroke="#dc2626" strokeWidth={2} /></svg>
          <span style={{ fontSize: 12, color: '#888780' }}>Checkpoint</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
          <svg width={18} height={13}><line x1={0} y1={6.5} x2={18} y2={6.5} stroke="#444441" strokeWidth={1.5} /></svg>
          <span style={{ fontSize: 12, color: '#888780' }}>Today</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
          <span style={{ fontSize: 13, color: '#15803d', fontWeight: 700 }}>✓</span>
          <span style={{ fontSize: 12, color: '#888780' }}>Meets CP</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
          <span style={{ fontSize: 13, color: '#b45309', fontWeight: 700 }}>↷</span>
          <span style={{ fontSize: 12, color: '#888780' }}>Late for CP</span>
        </div>
      </div>
    </div>
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

  // Display order — follows server order by default; manual sort on demand.
  // When lots refresh (lock/date change), preserve current order if the set of
  // assignment_ids is unchanged; only reset to server order when lots are added/removed.
  const [displayLots, setDisplayLots] = useState(lots)
  useEffect(() => {
    setDisplayLots(prev => {
      const newById = Object.fromEntries(lots.map(l => [l.assignment_id, l]))
      const prevIds = prev.map(l => l.assignment_id)
      const newIds  = lots.map(l => l.assignment_id)
      // Same set of IDs: merge updated fields into existing order
      const sameSet = prevIds.length === newIds.length &&
        prevIds.every(id => newById[id] !== undefined)
      if (sameSet) return prev.map(l => newById[l.assignment_id])
      // Different set: reset to server order
      return lots
    })
  }, [lots])

  const [showTimeline, setShowTimeline] = useState(false)

  // Sort animation: briefly dim the grid when a sort is triggered so the
  // reorder isn't a disorienting instantaneous snap.
  const [sortFlash, setSortFlash] = useState(false)
  const sortFlashTimer = useRef(null)

  function triggerSort(sortFn) {
    if (sortFlashTimer.current) clearTimeout(sortFlashTimer.current)
    setSortFlash(true)
    setDisplayLots(prev => [...prev].sort(sortFn))
    sortFlashTimer.current = setTimeout(() => {
      setSortFlash(false)
      sortFlashTimer.current = null
    }, 380)
  }

  function handleReorderByFulfillment() {
    triggerSort((a, b) => {
      const winDate = (l) => {
        const dates = [l.hc_projected_date, l.bldr_projected_date].filter(Boolean)
        return dates.length ? dates.reduce((m, d) => d < m ? d : m) : null
      }
      const aDate = winDate(a), bDate = winDate(b)
      if (!aDate && !bDate) return 0
      if (!aDate) return 1
      if (!bDate) return -1
      return aDate.localeCompare(bDate)
    })
  }

  function handleReorderByUnit() {
    triggerSort((a, b) => {
      const parse = l => {
        const m = (l.lot_number || '').match(/^([A-Za-z]+)0*(\d+)$/)
        return m ? [m[1], parseInt(m[2], 10)] : [l.lot_number || '', 0]
      }
      const [ac, an] = parse(a), [bc, bn] = parse(b)
      if (ac !== bc) return ac.localeCompare(bc)
      return an - bn
    })
  }

  // C = lots with HC or BLDR projected date in the past (≤ today) — completed
  // futureP = lots with HC or BLDR projected date in the future — planned
  // Caution = future projected date exists but it falls after the checkpoint date
  const todayStr = new Date().toISOString().slice(0, 10)
  const isPast = (d) => !!d && d <= todayStr
  const c = lots.filter(l =>
    isPast(l.hc_projected_date) || isPast(l.bldr_projected_date)
  ).length
  const futureP = lots.filter(l =>
    (l.hc_projected_date && !isPast(l.hc_projected_date)) ||
    (l.bldr_projected_date && !isPast(l.bldr_projected_date))
  ).length
  const plannedTotal = c + futureP  // used for "+ Planned" bar
  const t = localTotal
  const total = lots.length
  const excess = Math.max(0, total - t)
  const overTotal = plannedTotal > t
  const overC = c > t                // completed alone exceeds required

  // Placeholder count and urgency
  const slotCount = Math.max(0, t - total)
  const daysToCP = (() => {
    if (!localDate) return null
    const today = new Date(); today.setHours(0, 0, 0, 0)
    const cpDate = new Date(localDate)
    return Math.floor((cpDate - today) / (1000 * 60 * 60 * 24))
  })()

  const cPct   = t > 0 ? Math.min(100, Math.round((c            / t) * 100)) : 0
  const cpPct  = t > 0 ? Math.min(100, Math.round((plannedTotal / t) * 100)) : 0

  // ── Checkpoint status ──────────────────────────────────────────
  // metCP = lots where any date (marks or projected) is on/before the checkpoint date
  // Only user-entered projected dates count — marks dates are system actuals, not "entered"
  const metCP = localDate ? lots.filter(l => {
    const dates = [l.hc_projected_date, l.bldr_projected_date].filter(Boolean)
    return dates.some(d => d <= localDate)
  }).length : 0
  // Every assigned lot must have a qualifying date — not just the required count
  const allMet = total > 0 && metCP >= total
  const cpIsPast = !!localDate && localDate <= todayStr
  const cpStatus = (!localDate || t === 0) ? 'none'
    : cpIsPast
      ? (allMet ? 'complete' : 'missed')
      : (allMet ? 'on-track' : metCP > 0 ? 'at-risk' : 'none')

  const STATUS_CFG = {
    'complete': { label: 'Complete', icon: '✓', color: '#15803d', bg: '#dcfce7', border: '#86efac' },
    'on-track': { label: 'On Track', icon: '↗', color: '#0f766e', bg: '#ccfbf1', border: '#5eead4' },
    'at-risk':  { label: 'At Risk',  icon: '⚠', color: '#b45309', bg: '#fef3c7', border: '#fcd34d' },
    'missed':   { label: 'Missed',   icon: '✕', color: '#b91c1c', bg: '#fee2e2', border: '#fca5a5' },
  }
  const statusCfg = STATUS_CFG[cpStatus] || null

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
  }, [displayLots, slotCount])

  return (
    <div
      ref={setNodeRef}
      style={{
        background: isOver ? '#f0f9ff' : '#ffffff',
        border: `1.5px solid ${isOver ? '#3b82f6' : '#E4E2DA'}`,
        borderLeft: isOver ? '1.5px solid #3b82f6' : statusCfg ? `4px solid ${statusCfg.border}` : '1.5px solid #E4E2DA',
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
        <div style={{ flexShrink: 0, display: 'flex', alignItems: 'center', gap: 7, flexWrap: 'wrap' }}>
          <EditableNumber value={t} onChange={setLocalTotal} />
          <span style={{ fontSize: 15, color: '#6B6B68', fontWeight: 500 }}>required by</span>
          {/* Editable date — overlay pattern */}
          <div style={{ position: 'relative', display: 'inline-block' }}>
            <div style={{
              fontSize: 15, fontWeight: 700, color: '#27500A',
              border: '1px dashed #3B6D11',
              background: '#EAF3DE',
              borderRadius: 3, padding: '1px 6px',
              cursor: 'pointer', userSelect: 'none',
              whiteSpace: 'nowrap',
            }}>
              {localDate ? fmt(localDate) : '—'}
            </div>
            <input
              key={localDate}
              type="date"
              defaultValue={localDate}
              onBlur={(e) => { if (e.target.value && e.target.value !== localDate) setLocalDate(e.target.value) }}
              style={{
                position: 'absolute', top: 0, left: 0,
                width: '100%', height: '100%',
                opacity: 0, cursor: 'pointer',
                border: 'none', padding: 0, margin: 0,
              }}
            />
          </div>
          {displayLots.length > 1 && (
            <>
              <button
                onClick={handleReorderByFulfillment}
                title="Sort lots by earliest fulfillment date (HC or BLDR projected)"
                style={{
                  fontSize: 11, padding: '2px 8px', borderRadius: 4,
                  border: '1px solid #D4D2CB', background: '#fff', color: '#6B6B68',
                  cursor: 'pointer', marginLeft: 2,
                }}
              >
                ↕ Sort by date
              </button>
              <button
                onClick={handleReorderByUnit}
                title="Sort lots by unit number"
                style={{
                  fontSize: 11, padding: '2px 8px', borderRadius: 4,
                  border: '1px solid #D4D2CB', background: '#fff', color: '#6B6B68',
                  cursor: 'pointer',
                }}
              >
                ↕ Sort by unit
              </button>
            </>
          )}
          <button
            onClick={() => setShowTimeline(v => !v)}
            style={{
              fontSize: 11, padding: '2px 9px', borderRadius: 4,
              border: `1px solid ${showTimeline ? '#3B6D11' : '#D4D2CB'}`,
              background: showTimeline ? '#EAF3DE' : '#fff',
              color: showTimeline ? '#27500A' : '#6B6B68',
              cursor: 'pointer', marginLeft: 2,
            }}
          >
            {showTimeline ? '▾ Timeline' : '▸ Timeline'}
          </button>
        </div>

        {/* Status badge */}
        {statusCfg && (
          <div style={{
            flexShrink: 0,
            display: 'inline-flex', alignItems: 'center', gap: 4,
            padding: '3px 9px', borderRadius: 12,
            background: statusCfg.bg, border: `1px solid ${statusCfg.border}`,
          }}>
            <span style={{ fontSize: 12, color: statusCfg.color, lineHeight: 1 }}>{statusCfg.icon}</span>
            <span style={{ fontSize: 11, fontWeight: 700, color: statusCfg.color, letterSpacing: '0.04em' }}>
              {statusCfg.label.toUpperCase()}
            </span>
          </div>
        )}

        {/* Right: Completed + Completed+Planned bars */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 5, minWidth: 240 }}>
          {/* Completed row */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ fontSize: 11, color: overC ? '#A32D2D' : '#888780', whiteSpace: 'nowrap', flexShrink: 0, minWidth: 78 }}>
              Completed
            </span>
            <div style={{ flex: 1, height: 8, background: '#F1EFE8', borderRadius: 3, overflow: 'hidden' }}>
              <div style={{ width: `${cPct}%`, height: '100%', background: overC ? '#E24B4A' : '#444441', borderRadius: 3, transition: 'width 0.2s' }} />
            </div>
            <span style={{ fontSize: 12, fontWeight: 500, color: overC ? '#A32D2D' : '#444441', flexShrink: 0, minWidth: 52, textAlign: 'right' }}>
              {c} of {t}
            </span>
          </div>
          {/* Completed + Planned For row */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ fontSize: 11, color: overTotal ? '#A32D2D' : '#888780', whiteSpace: 'nowrap', flexShrink: 0, minWidth: 78 }}>
              + Planned
            </span>
            <div style={{ flex: 1, height: 8, background: '#F1EFE8', borderRadius: 3, overflow: 'hidden' }}>
              <div style={{ width: `${cpPct}%`, height: '100%', background: overTotal ? '#E24B4A' : '#B4B2A9', borderRadius: 3, transition: 'width 0.2s' }} />
            </div>
            <span style={{ fontSize: 12, fontWeight: 500, color: overTotal ? '#A32D2D' : '#444441', flexShrink: 0, minWidth: 52, textAlign: 'right' }}>
              {plannedTotal} of {t}
            </span>
          </div>
        </div>
      </div>

      {/* Body — outer pad + inner grid capped at 8 columns (8×148 + 7×8 = 1240px) */}
      <div style={{ padding: 14, minHeight: 60 }}>
        <div
          ref={gridRef}
          style={{
            display: 'flex', flexWrap: 'wrap', gap: 14, alignItems: 'stretch',
            maxWidth: 1330,
            opacity: sortFlash ? 0.5 : 1,
            transition: `opacity ${sortFlash ? '0.06s' : '0.32s'} ease-in-out`,
          }}
        >
          {buildClusters(displayLots).map((cluster) => {
            if (cluster.type === 'solo') {
              const a = cluster.lot
              const idx = displayLots.indexOf(a)
              return (
                <LotPill
                  key={a.assignment_id}
                  assignment={a}
                  isExcess={idx >= total - excess}
                  checkpointDate={localDate}
                  onDateChange={(key, val) => onDateChange(a.assignment_id, { [key]: val })}
                  onLockChange={(key, val) => onLockChange(a.assignment_id, { [key]: val })}
                />
              )
            }
            // Building group cluster — stays together on one row, stitched visually
            return (
              <div key={`grp-${cluster.bgId}`} style={{ display: 'flex', flexShrink: 0, alignItems: 'stretch' }}>
                {cluster.lots.flatMap((a, pi) => {
                  const idx = displayLots.indexOf(a)
                  const items = []
                  if (pi > 0) items.push(<StitchConnector key={`stitch-${a.assignment_id}`} />)
                  items.push(
                    <LotPill
                      key={a.assignment_id}
                      assignment={a}
                      isExcess={idx >= total - excess}
                      checkpointDate={localDate}
                      onDateChange={(key, val) => onDateChange(a.assignment_id, { [key]: val })}
                      onLockChange={(key, val) => onLockChange(a.assignment_id, { [key]: val })}
                    />
                  )
                  return items
                })}
              </div>
            )
          })}
          {Array.from({ length: slotCount }).map((_, i) => (
            <PlaceholderPill key={`ph-${i}`} daysToCP={daysToCP} />
          ))}
        </div>
      </div>

      {/* Timeline chart — toggled from checkpoint header */}
      {showTimeline && (
        <CheckpointTimeline lots={displayLots} slotCount={slotCount} checkpointDate={localDate} lotsRequired={t} />
      )}
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

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }))

  const [dragLot, setDragLot] = useState(null)
  const [selectedLotIds, setSelectedLotIds] = useState(new Set())
  const [selectedPoolLotIds, setSelectedPoolLotIds] = useState(new Set())

  // Clear selections when switching TDAs
  useEffect(() => {
    setSelectedLotIds(new Set())
    setSelectedPoolLotIds(new Set())
  }, [selectedTdaId])

  function toggleLotSelection(lotId) {
    setSelectedLotIds(prev => {
      const next = new Set(prev)
      if (next.has(lotId)) next.delete(lotId)
      else next.add(lotId)
      return next
    })
  }

  function toggleDevGroupSelection(devLots) {
    const ids = devLots.map(l => l.lot_id)
    const allSel = ids.every(id => selectedLotIds.has(id))
    setSelectedLotIds(prev => {
      const next = new Set(prev)
      if (allSel) ids.forEach(id => next.delete(id))
      else ids.forEach(id => next.add(id))
      return next
    })
  }

  async function handleAddSelectedToPool() {
    if (!detail || selectedLotIds.size === 0) return
    await Promise.all([...selectedLotIds].map(id =>
      fetch(`${API_BASE}/takedown-agreements/${detail.tda_id}/lots/${id}/pool`, { method: 'POST' })
    ))
    setSelectedLotIds(new Set())
    refetchDetail()
  }

  function togglePoolLotSelection(lotId) {
    setSelectedPoolLotIds(prev => {
      const next = new Set(prev)
      if (next.has(lotId)) next.delete(lotId)
      else next.add(lotId)
      return next
    })
  }

  function togglePoolDevGroupSelection(devLots) {
    const ids = devLots.map(l => l.lot_id)
    const allSel = ids.every(id => selectedPoolLotIds.has(id))
    setSelectedPoolLotIds(prev => {
      const next = new Set(prev)
      if (allSel) ids.forEach(id => next.delete(id))
      else ids.forEach(id => next.add(id))
      return next
    })
  }

  async function handleRemoveSelectedFromPool() {
    if (!detail || selectedPoolLotIds.size === 0) return
    await Promise.all([...selectedPoolLotIds].map(id =>
      fetch(`${API_BASE}/takedown-agreements/${detail.tda_id}/lots/${id}/pool`, { method: 'DELETE' })
    ))
    setSelectedPoolLotIds(new Set())
    refetchDetail()
  }

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
      const res = await fetch(`${API_BASE}/takedown-agreements`, {
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
    await fetch(`${API_BASE}/tda-lot-assignments/${assignmentId}/dates`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    })
    refetchDetail()
  }, [refetchDetail])

  // ── Lock toggle ──────────────────────────────────────────────
  const handleLockChange = useCallback(async (assignmentId, patch) => {
    await fetch(`${API_BASE}/tda-lot-assignments/${assignmentId}/lock`, {
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
    const tdaId = detail.tda_id

    // Helper shortcuts
    const assignToCP = (lotId, checkpointId) =>
      fetch(`${API_BASE}/takedown-agreements/${tdaId}/lots/${lotId}/assign`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ checkpoint_id: checkpointId }),
      })
    const unassignFromCP = (lotId) =>
      fetch(`${API_BASE}/takedown-agreements/${tdaId}/lots/${lotId}/assign`, { method: 'DELETE' })
    const addToPool = (lotId) =>
      fetch(`${API_BASE}/takedown-agreements/${tdaId}/lots/${lotId}/pool`, { method: 'POST' })
    const removeFromPool = (lotId) =>
      fetch(`${API_BASE}/takedown-agreements/${tdaId}/lots/${lotId}/pool`, { method: 'DELETE' })

    // ── Global unassigned → TDA pool ──────────────────────────────
    if (src?.type === 'unassigned-lot' && dst?.type === 'tda-pool') {
      const isMulti = selectedLotIds.has(src.lot.lot_id) && selectedLotIds.size > 1
      const ids = isMulti ? [...selectedLotIds] : [src.lot.lot_id]
      await Promise.all(ids.map(id => addToPool(id)))
      if (isMulti) setSelectedLotIds(new Set())
      refetchDetail(); return
    }

    // ── Global unassigned → checkpoint ────────────────────────────
    if (src?.type === 'unassigned-lot' && dst?.type === 'checkpoint') {
      const isMulti = selectedLotIds.has(src.lot.lot_id) && selectedLotIds.size > 1
      const ids = isMulti ? [...selectedLotIds] : [src.lot.lot_id]
      await Promise.all(ids.map(id => assignToCP(id, dst.checkpointId)))
      if (isMulti) setSelectedLotIds(new Set())
      refetchDetail(); return
    }

    // ── TDA pool → checkpoint ─────────────────────────────────────
    if (src?.type === 'pool-lot' && dst?.type === 'checkpoint') {
      const isMulti = selectedPoolLotIds.has(src.lot.lot_id) && selectedPoolLotIds.size > 1
      const ids = isMulti ? [...selectedPoolLotIds] : [src.lot.lot_id]
      await Promise.all(ids.map(id => assignToCP(id, dst.checkpointId)))
      if (isMulti) setSelectedPoolLotIds(new Set())
      refetchDetail(); return
    }

    // ── TDA pool → global unassigned ─────────────────────────────
    if (src?.type === 'pool-lot' && dst?.type === 'unassigned-bank') {
      const isMulti = selectedPoolLotIds.has(src.lot.lot_id) && selectedPoolLotIds.size > 1
      const ids = isMulti ? [...selectedPoolLotIds] : [src.lot.lot_id]
      await Promise.all(ids.map(id => removeFromPool(id)))
      if (isMulti) setSelectedPoolLotIds(new Set())
      refetchDetail(); return
    }

    // ── Assigned lot → TDA pool (unassign from checkpoint, keep in pool) ──
    if (src?.type === 'assigned-lot' && dst?.type === 'tda-pool') {
      await unassignFromCP(src.assignment.lot_id)
      refetchDetail(); return
    }

    // ── Assigned lot → global unassigned (remove from pool entirely) ──
    if (src?.type === 'assigned-lot' && dst?.type === 'unassigned-bank') {
      await removeFromPool(src.assignment.lot_id)
      refetchDetail(); return
    }

    // ── Assigned lot → different checkpoint ──────────────────────
    // Single call: backend moves the existing assignment row (preserves HC/BLDR dates)
    if (src?.type === 'assigned-lot' && dst?.type === 'checkpoint') {
      await assignToCP(src.assignment.lot_id, dst.checkpointId)
      refetchDetail(); return
    }

    // ── Any lot → other TDA pool ──────────────────────────────────
    if (dst?.type === 'other-tda') {
      const targetTdaId = dst.tdaId
      const addToTargetPool = (lotId) =>
        fetch(`${API_BASE}/takedown-agreements/${targetTdaId}/lots/${lotId}/pool`, { method: 'POST' })

      if (src?.type === 'unassigned-lot') {
        const isMulti = selectedLotIds.has(src.lot.lot_id) && selectedLotIds.size > 1
        const ids = isMulti ? [...selectedLotIds] : [src.lot.lot_id]
        await Promise.all(ids.map(id => addToTargetPool(id)))
        if (isMulti) setSelectedLotIds(new Set())
      } else if (src?.type === 'pool-lot') {
        const isMulti = selectedPoolLotIds.has(src.lot.lot_id) && selectedPoolLotIds.size > 1
        const ids = isMulti ? [...selectedPoolLotIds] : [src.lot.lot_id]
        await Promise.all(ids.map(async id => { await removeFromPool(id); await addToTargetPool(id) }))
        if (isMulti) setSelectedPoolLotIds(new Set())
      } else if (src?.type === 'assigned-lot') {
        await removeFromPool(src.assignment.lot_id)
        await addToTargetPool(src.assignment.lot_id)
      }
      refetchAgreements()
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
          sensors={sensors}
          collisionDetection={pointerWithin}
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
        >
          <div style={{
            flex: 1, overflowY: 'auto', padding: 24,
            display: 'flex', gap: 0, alignItems: 'flex-start',
          }}>
            {/* Left panel: Unassigned + In Agreement + Other Agreements stacked vertically */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginRight: 20, flexShrink: 0 }}>
              <UnassignedBank
                lots={detail.unassigned_lots || []}
                selectedIds={selectedLotIds}
                onToggle={toggleLotSelection}
                onToggleDevGroup={toggleDevGroupSelection}
                onAddToPool={handleAddSelectedToPool}
                onClearSelection={() => setSelectedLotIds(new Set())}
              />
              <TdaPoolBank
                lots={detail.pool_lots || []}
                tdaName={detail.tda_name}
                selectedIds={selectedPoolLotIds}
                onToggle={togglePoolLotSelection}
                onToggleDevGroup={togglePoolDevGroupSelection}
                onRemoveFromPool={handleRemoveSelectedFromPool}
                onClearSelection={() => setSelectedPoolLotIds(new Set())}
              />
              {agreements.filter(a => a.tda_id !== selectedTdaId).length > 0 && (
                <>
                  <div style={{ fontSize: 11, fontWeight: 600, color: '#9ca3af', letterSpacing: '0.06em', paddingLeft: 2, marginTop: 4 }}>
                    OTHER AGREEMENTS
                  </div>
                  {agreements
                    .filter(a => a.tda_id !== selectedTdaId)
                    .map(a => (
                      <OtherTdaTile key={a.tda_id} agreement={a} onNavigate={setSelectedTdaId} />
                    ))}
                </>
              )}
            </div>

            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14, alignItems: 'flex-start' }}>
              <TdaCard detail={detail} onCheckpointCreated={refetchDetail}>
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
            {(dragLot?.type === 'unassigned-lot' || dragLot?.type === 'pool-lot') && (() => {
              const isPool = dragLot.type === 'pool-lot'
              const sel = isPool ? selectedPoolLotIds : selectedLotIds
              const isMulti = sel.has(dragLot.lot.lot_id) && sel.size > 1
              return (
                <div style={{
                  padding: isMulti ? '5px 14px' : '3px 10px', borderRadius: 12,
                  background: isPool ? '#e0e7ff' : '#f3f4f6',
                  border: `1px solid ${isPool ? '#818cf8' : '#9ca3af'}`,
                  fontSize: 13, fontWeight: isMulti ? 700 : 600,
                  color: isPool ? '#3730a3' : '#374151',
                }}>
                  {isMulti ? `${sel.size} lots` : dragLot.lot.lot_number}
                </div>
              )
            })()}
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
