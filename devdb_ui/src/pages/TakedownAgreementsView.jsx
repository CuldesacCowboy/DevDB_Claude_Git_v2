import { useState, useCallback, useEffect, useMemo } from 'react'
import { DndContext, pointerWithin } from '@dnd-kit/core'
import { useTdaData } from '../hooks/useTdaData'
import { useTdaDragHandler } from '../hooks/useTdaDragHandler'
import CheckpointBand from '../components/CheckpointBand'
import TdaCard from '../components/TdaCard'
import TdaPageHeader from '../components/TdaPageHeader'
import TdaDragOverlay from '../components/TdaDragOverlay'
import TdaNavBar from '../components/TdaNavBar'
import ContextMenu from '../components/ContextMenu'
import { UnassignedBank } from '../components/LeftPanel'


// ── Main view ─────────────────────────────────────────────────────
export default function TakedownAgreementsView({ entGroupId }) {
  const {
    agreements, entGroupName,
    selectedTdaId, setSelectedTdaId,
    detail,
    mutationStatus,
    renameTda,
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
    selectedAssignedLotIds,
    clearSelectionsForTda,
    clearLotSelection,
    clearPoolLotSelection,
    clearAssignedLotSelection,
    toggleLotSelection,
    toggleDevGroupSelection,
    togglePoolLotSelection,
    togglePoolDevGroupSelection,
    toggleAssignedLotSelection,
    toggleAssignedCheckpointSelection,
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

  // ── Context menu ──────────────────────────────────────────────────
  const [contextMenu, setContextMenu] = useState(null)
  // { x, y, type: 'unassigned'|'pool'|'assigned', lotId }

  const handleContextMenu = useCallback((e, type, lotId) => {
    e.preventDefault()
    // If the right-clicked lot is part of a selection of the same type, the
    // menu applies to the whole selection; otherwise just this lot.
    let lotIds
    if (type === 'unassigned') {
      lotIds = selectedLotIds.has(lotId) && selectedLotIds.size > 1
        ? [...selectedLotIds] : [lotId]
    } else if (type === 'pool') {
      lotIds = selectedPoolLotIds.has(lotId) && selectedPoolLotIds.size > 1
        ? [...selectedPoolLotIds] : [lotId]
    } else {
      lotIds = selectedAssignedLotIds.has(lotId) && selectedAssignedLotIds.size > 1
        ? [...selectedAssignedLotIds] : [lotId]
    }
    setContextMenu({ x: e.clientX, y: e.clientY, type, lotIds })
  }, [selectedLotIds, selectedPoolLotIds, selectedAssignedLotIds])

  const contextMenuItems = useMemo(() => {
    if (!contextMenu || !detail) return []
    const { type, lotIds } = contextMenu
    const n = lotIds.length
    const label = n > 1 ? `${n} lots` : '1 lot'
    const tdaId = detail.tda_id
    const checkpoints = detail.checkpoints || []
    const otherTdas = agreements.filter(a => a.tda_id !== tdaId)
    const items = []

    if (type === 'unassigned') {
      items.push(
        { label: `Add ${label} to In Agreement`, onClick: () => { clearLotSelection(); addLotsToPool(tdaId, lotIds) } },
        { divider: true },
        ...checkpoints.map(cp => ({
          label: `Assign to ${cp.checkpoint_name}`,
          onClick: () => { clearLotSelection(); assignLotsToCheckpoint(tdaId, lotIds, cp.checkpoint_id) },
        })),
      )
    } else if (type === 'pool') {
      items.push(
        { label: `Remove ${label} from In Agreement`, danger: true, onClick: () => { clearPoolLotSelection(); removeLotsFromPool(tdaId, lotIds) } },
        { divider: true },
        ...checkpoints.map(cp => ({
          label: `Assign to ${cp.checkpoint_name}`,
          onClick: () => { clearPoolLotSelection(); assignLotsToCheckpoint(tdaId, lotIds, cp.checkpoint_id) },
        })),
      )
      if (otherTdas.length > 0) {
        items.push({ divider: true })
        otherTdas.forEach(tda => {
          items.push({
            label: `Move to ${tda.tda_name}`,
            onClick: async () => {
              clearPoolLotSelection()
              await Promise.all(lotIds.map(id => moveLotToOtherTda(tdaId, tda.tda_id, id, false)))
            },
          })
        })
      }
    } else { // assigned
      items.push(
        { label: `Move ${label} to In Agreement (keep in TDA)`, onClick: () => { clearAssignedLotSelection(); Promise.all(lotIds.map(id => unassignLotFromCheckpoint(tdaId, id))) } },
        { label: `Remove ${label} from TDA`, danger: true, onClick: () => { clearAssignedLotSelection(); removeLotsFromPool(tdaId, lotIds) } },
        { divider: true },
        ...checkpoints.map(cp => ({
          label: `Move to ${cp.checkpoint_name}`,
          onClick: () => { clearAssignedLotSelection(); assignLotsToCheckpoint(tdaId, lotIds, cp.checkpoint_id) },
        })),
      )
      if (otherTdas.length > 0) {
        items.push({ divider: true })
        otherTdas.forEach(tda => {
          items.push({
            label: `Move to ${tda.tda_name}`,
            onClick: async () => {
              clearAssignedLotSelection()
              await Promise.all(lotIds.map(id => moveLotToOtherTda(tdaId, tda.tda_id, id, true)))
            },
          })
        })
      }
    }
    return items
  }, [contextMenu, detail, agreements, clearLotSelection, clearPoolLotSelection, clearAssignedLotSelection, addLotsToPool, removeLotsFromPool, assignLotsToCheckpoint, unassignLotFromCheckpoint, moveLotToOtherTda])

  // ── Render ───────────────────────────────────────────────────
  if (loading) return (
    <div style={{ padding: 32, color: '#6b7280', flex: 1 }}>Loading…</div>
  )
  if (error) return (
    <div style={{ padding: 32, color: '#dc2626', flex: 1 }}>Error: {error}</div>
  )

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden', background: '#f9fafb' }}>
      <TdaPageHeader
        entGroupName={entGroupName}
        mutationStatus={mutationStatus}
        createTda={createTda}
      />

      {/* TDA navigation bar — shows all agreements, replaces OtherTdaTile */}
      <TdaNavBar
        agreements={agreements}
        selectedTdaId={selectedTdaId}
        onSelect={setSelectedTdaId}
      />

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
            display: 'flex', gap: 20, alignItems: 'flex-start',
          }}>
            {/* Left panel: Unassigned only */}
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
              onContextMenu={handleContextMenu}
              dragLot={dragLot}
            />

            {/* TDA card: editable name + In Agreement pool + checkpoints */}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14, alignItems: 'flex-start' }}>
              <TdaCard
                detail={detail}
                onAddCheckpoint={(checkpointDate, lotsRequired) =>
                  createCheckpoint(detail.tda_id, { checkpointDate, lotsRequired })
                }
                onRenameTda={renameTda}
                selectedPoolLotIds={selectedPoolLotIds}
                onPoolToggle={togglePoolLotSelection}
                onPoolToggleDevGroup={togglePoolDevGroupSelection}
                onRemoveFromPool={() => {
                  if (!detail || selectedPoolLotIds.size === 0) return
                  const ids = [...selectedPoolLotIds]
                  clearPoolLotSelection()
                  removeLotsFromPool(detail.tda_id, ids)
                }}
                onClearPoolSelection={clearPoolLotSelection}
                onContextMenu={handleContextMenu}
                dragLot={dragLot}
              >
                {(detail.checkpoints || []).map((cp) => (
                  <CheckpointBand
                    key={cp.checkpoint_id}
                    checkpoint={cp}
                    onDateChange={updateAssignmentDates}
                    onLockChange={updateAssignmentLock}
                    selectedAssignedLotIds={selectedAssignedLotIds}
                    onToggleAssignedLot={toggleAssignedLotSelection}
                    onToggleCheckpointLots={toggleAssignedCheckpointSelection}
                    onContextMenu={handleContextMenu}
                    dragLot={dragLot}
                  />
                ))}
              </TdaCard>
            </div>
          </div>

          <TdaDragOverlay
            dragLot={dragLot}
            selectedLotIds={selectedLotIds}
            selectedPoolLotIds={selectedPoolLotIds}
          />
        </DndContext>
      ) : (
        <div style={{ padding: 32, color: '#9ca3af', fontSize: 15 }}>
          No agreement selected.
        </div>
      )}

      {/* Right-click context menu */}
      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          items={contextMenuItems}
          onClose={() => setContextMenu(null)}
        />
      )}
    </div>
  )
}
