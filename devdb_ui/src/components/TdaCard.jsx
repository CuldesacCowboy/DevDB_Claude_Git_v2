import { useState, useMemo } from 'react'
import { useDraggable, useDroppable } from '@dnd-kit/core'
import { parseLot } from '../utils/tdaUtils'

// ── Draggable pool lot pill (inline, inside TDA card) ─────────────
function PoolLotPill({ lot, isSelected, onToggle, onContextMenu }) {
  const { attributes, listeners, setNodeRef, isDragging } =
    useDraggable({ id: `pool-${lot.lot_id}`, data: { type: 'pool-lot', lot } })
  const { code, seq } = parseLot(lot.lot_number)
  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      onClick={() => !isDragging && onToggle && onToggle(lot.lot_id)}
      onContextMenu={onContextMenu ? (e) => { e.preventDefault(); onContextMenu(e, 'pool', lot.lot_id) } : undefined}
      style={{
        width: 68, height: 34, flexShrink: 0,
        background: isSelected ? '#eef2ff' : '#fff',
        border: isSelected ? '2px solid #6366f1' : '0.5px solid #6366f1',
        borderRadius: 5,
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
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

// ── Inline pool section (droppable + pool lot pills) ──────────────
function PoolSection({ lots, selectedIds, onToggle, onToggleDevGroup, onRemoveFromPool, onClearSelection, onContextMenu, dragLot }) {
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
  // Valid drop target when dragging unassigned or assigned lots
  const isValidDrop = !!dragLot && (dragLot.type === 'unassigned-lot' || dragLot.type === 'assigned-lot') && !isOver

  return (
    <div
      ref={setNodeRef}
      style={{
        background: isOver ? '#eef2ff' : '#f5f3ff',
        border: isOver ? '2px solid #6366f1' : isValidDrop ? '1.5px dashed #a5b4fc' : '1.5px solid #e0e7ff',
        borderRadius: 8, padding: '10px 14px',
        marginBottom: 14, transition: 'all 0.15s',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: selCount > 0 ? 8 : 6 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontWeight: 700, fontSize: 13, color: '#3730a3' }}>In Agreement</span>
          <span style={{ fontSize: 12, color: '#818cf8' }}>
            {lots.length} lot{lots.length !== 1 ? 's' : ''} · no checkpoint
          </span>
        </div>
        {selCount > 0 && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ fontSize: 12, color: '#3730a3', fontWeight: 500 }}>{selCount} selected</span>
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
        )}
      </div>

      {lots.length === 0 ? (
        <p style={{ fontSize: 12, color: '#818cf8', fontStyle: 'italic', margin: 0 }}>
          {isOver ? 'Drop to add to agreement' : 'No lots in pool'}
        </p>
      ) : (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
          {devGroups.map(({ devCode, devLots }) => {
            const allSel = devLots.every(l => selectedIds?.has(l.lot_id))
            const someSel = devLots.some(l => selectedIds?.has(l.lot_id))
            return (
              <div key={devCode}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                    <div style={{ height: 1, width: 8, background: '#c7d2fe' }} />
                    <span style={{ fontSize: 11, fontWeight: 700, color: '#4f46e5', letterSpacing: '0.06em' }}>{devCode}</span>
                    <span style={{ fontSize: 11, color: '#818cf8' }}>{devLots.length}</span>
                  </div>
                  <button
                    onClick={() => onToggleDevGroup && onToggleDevGroup(devLots)}
                    style={{
                      fontSize: 10, padding: '1px 6px', borderRadius: 3,
                      border: `1px solid ${allSel ? '#6366f1' : '#c7d2fe'}`,
                      background: allSel ? '#e0e7ff' : 'transparent',
                      color: allSel ? '#3730a3' : someSel ? '#6366f1' : '#a5b4fc',
                      cursor: 'pointer', fontWeight: 500, marginLeft: 6,
                    }}
                  >
                    {allSel ? 'deselect' : 'select all'}
                  </button>
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                  {devLots.map(lot => (
                    <PoolLotPill
                      key={lot.lot_id}
                      lot={lot}
                      isSelected={selectedIds?.has(lot.lot_id)}
                      onToggle={onToggle}
                      onContextMenu={onContextMenu}
                    />
                  ))}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ── Editable TDA name ─────────────────────────────────────────────
function EditableTdaName({ value, onSave }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value)

  function commit() {
    const trimmed = draft.trim()
    if (trimmed && trimmed !== value) onSave(trimmed)
    setEditing(false)
  }

  if (editing) {
    return (
      <input
        autoFocus
        value={draft}
        onChange={e => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={e => {
          if (e.key === 'Enter') commit()
          if (e.key === 'Escape') { setDraft(value); setEditing(false) }
        }}
        style={{
          fontSize: 16, fontWeight: 700, color: '#2C2C2A',
          border: '1px dashed #3B6D11',
          background: '#EAF3DE',
          borderRadius: 4, padding: '2px 8px',
          outline: 'none', minWidth: 140,
        }}
      />
    )
  }
  return (
    <span
      onClick={() => { setDraft(value); setEditing(true) }}
      title="Click to rename"
      style={{
        fontWeight: 700, fontSize: 16, color: '#2C2C2A',
        border: '1px dashed #3B6D11',
        background: '#EAF3DE',
        borderRadius: 4, padding: '2px 8px',
        cursor: 'pointer', userSelect: 'none',
      }}
    >
      {value}
    </span>
  )
}

// ── TDA card wrapper ──────────────────────────────────────────────
export default function TdaCard({
  detail,
  onAddCheckpoint,
  onRenameTda,
  // Pool section props
  selectedPoolLotIds,
  onPoolToggle,
  onPoolToggleDevGroup,
  onRemoveFromPool,
  onClearPoolSelection,
  onContextMenu,
  dragLot,
  children,
}) {
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
      {/* Header */}
      <div style={{
        background: '#F0EEE8', padding: '10px 16px',
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
      }}>
        <EditableTdaName
          value={detail.tda_name}
          onSave={(name) => onRenameTda && onRenameTda(detail.tda_id, name)}
        />
        <div style={{ display: 'flex', alignItems: 'center', gap: 0, marginLeft: 14, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 12, color: '#888780', marginLeft: 10 }}>
            pool:&nbsp;{poolCount}
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

      {/* Body */}
      <div style={{ background: '#F7F6F3', padding: 14 }}>
        {/* In Agreement pool — droppable, above checkpoints */}
        <PoolSection
          lots={detail.pool_lots || []}
          selectedIds={selectedPoolLotIds}
          onToggle={onPoolToggle}
          onToggleDevGroup={onPoolToggleDevGroup}
          onRemoveFromPool={onRemoveFromPool}
          onClearSelection={onClearPoolSelection}
          onContextMenu={onContextMenu}
          dragLot={dragLot}
        />

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
