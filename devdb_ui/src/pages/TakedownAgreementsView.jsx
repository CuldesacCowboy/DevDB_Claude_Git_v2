import { useState, useRef, useLayoutEffect, useMemo, useEffect } from 'react'
import { DndContext, DragOverlay, pointerWithin } from '@dnd-kit/core'
import { useDraggable, useDroppable } from '@dnd-kit/core'
import { useTdaData } from '../hooks/useTdaData'
import { useTdaDragHandler } from '../hooks/useTdaDragHandler'
import { fmt, shortLot, parseLot, buildClusters } from '../utils/tdaUtils'
import CheckpointTimeline from '../components/CheckpointTimeline'
import LotPill, { StitchConnector, PlaceholderPill } from '../components/LotPill'

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
function TdaCard({ detail, onAddCheckpoint, children }) {
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
      await onAddCheckpoint(cpDate || null, cpLots)
      setCpDate(''); setCpLots(''); setShowAddCP(false)
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
    detail,
    mutationStatus,
    createTda,
    createCheckpoint,
    updateAssignmentDates,
    updateAssignmentLock,
    addLotsToPool,
    removeLotsFromPool,
    assignLotsToCheckpoint,
    unassignLotFromCheckpoint,
    moveLotToOtherTda,
    loading, error,
  } = useTdaData(entGroupId)

  const {
    sensors,
    dragLot,
    handleDragStart,
    handleDragEnd,
    selectedLotIds,
    selectedPoolLotIds,
    clearSelectionsForTda,
    clearLotSelection,
    clearPoolLotSelection,
    toggleLotSelection,
    toggleDevGroupSelection,
    togglePoolLotSelection,
    togglePoolDevGroupSelection,
  } = useTdaDragHandler({
    detail,
    addLotsToPool,
    removeLotsFromPool,
    assignLotsToCheckpoint,
    unassignLotFromCheckpoint,
    moveLotToOtherTda,
  })

  // Clear selections when switching TDAs
  useEffect(() => { clearSelectionsForTda() }, [selectedTdaId]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Create TDA form state (local — ephemeral form fields only) ──
  const [showNewTdaForm, setShowNewTdaForm] = useState(false)
  const [newTdaName, setNewTdaName] = useState('')
  const [newTdaError, setNewTdaError] = useState('')

  async function handleCreateTda() {
    setNewTdaError('')
    const result = await createTda(newTdaName)
    if (!result.ok) { setNewTdaError(result.error); return }
    setNewTdaName('')
    setShowNewTdaForm(false)
  }

  // ── Render ───────────────────────────────────────────────────
  if (loading) return (
    <div style={{ padding: 32, color: '#6b7280', flex: 1 }}>Loading…</div>
  )
  if (error) return (
    <div style={{ padding: 32, color: '#dc2626', flex: 1 }}>Error: {error}</div>
  )

  const isSaving = mutationStatus.status === 'saving'

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
          {/* Mutation status indicator */}
          {isSaving && (
            <span style={{ fontSize: 12, color: '#6b7280' }}>Saving…</span>
          )}
          {mutationStatus.status === 'error' && (
            <span style={{ fontSize: 12, color: '#dc2626' }}>{mutationStatus.error}</span>
          )}

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
                disabled={isSaving}
                style={{
                  fontSize: 13, padding: '5px 12px', borderRadius: 6,
                  border: 'none', background: '#2563eb', color: '#fff',
                  cursor: isSaving ? 'default' : 'pointer', opacity: isSaving ? 0.6 : 1,
                }}
              >
                {isSaving ? 'Creating…' : 'Create'}
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
                onAddToPool={() => {
                  if (!detail || selectedLotIds.size === 0) return
                  const ids = [...selectedLotIds]
                  clearLotSelection()
                  addLotsToPool(detail.tda_id, ids)
                }}
                onClearSelection={clearLotSelection}
              />
              <TdaPoolBank
                lots={detail.pool_lots || []}
                tdaName={detail.tda_name}
                selectedIds={selectedPoolLotIds}
                onToggle={togglePoolLotSelection}
                onToggleDevGroup={togglePoolDevGroupSelection}
                onRemoveFromPool={() => {
                  if (!detail || selectedPoolLotIds.size === 0) return
                  const ids = [...selectedPoolLotIds]
                  clearPoolLotSelection()
                  removeLotsFromPool(detail.tda_id, ids)
                }}
                onClearSelection={clearPoolLotSelection}
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
              <TdaCard
                detail={detail}
                onAddCheckpoint={(checkpointDate, lotsRequired) =>
                  createCheckpoint(detail.tda_id, { checkpointDate, lotsRequired })
                }
              >
                {(detail.checkpoints || []).map((cp) => (
                  <CheckpointBand
                    key={cp.checkpoint_id}
                    checkpoint={cp}
                    onDateChange={updateAssignmentDates}
                    onLockChange={updateAssignmentLock}
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
