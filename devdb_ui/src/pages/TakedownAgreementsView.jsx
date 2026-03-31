import { useState, useEffect } from 'react'
import { DndContext, DragOverlay, pointerWithin } from '@dnd-kit/core'
import { useTdaData } from '../hooks/useTdaData'
import { useTdaDragHandler } from '../hooks/useTdaDragHandler'
import { shortLot } from '../utils/tdaUtils'
import CheckpointBand from '../components/CheckpointBand'
import TdaCard from '../components/TdaCard'
import { UnassignedBank, TdaPoolBank, OtherTdaTile } from '../components/LeftPanel'


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
