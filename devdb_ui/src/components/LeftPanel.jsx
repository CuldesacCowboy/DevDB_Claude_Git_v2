import { useMemo } from 'react'
import { useDraggable, useDroppable } from '@dnd-kit/core'
import { parseLot } from '../utils/tdaUtils'

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
export function TdaPoolBank({ lots, tdaName, selectedIds, onToggle, onToggleDevGroup, onRemoveFromPool, onClearSelection }) {
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
export function UnassignedBank({ lots, selectedIds, onToggle, onToggleDevGroup, onAddToPool, onClearSelection }) {
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
export function OtherTdaTile({ agreement, onNavigate }) {
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
