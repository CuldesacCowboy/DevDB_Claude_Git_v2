import { useState, useMemo, useEffect } from 'react'
import { DndContext, DragOverlay, pointerWithin } from '@dnd-kit/core'
import { useDraggable, useDroppable } from '@dnd-kit/core'
import { useTdaData } from '../hooks/useTdaData'
import { useTdaDragHandler } from '../hooks/useTdaDragHandler'
import { fmt, shortLot, parseLot, buildClusters } from '../utils/tdaUtils'
import CheckpointBand from '../components/CheckpointBand'

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
