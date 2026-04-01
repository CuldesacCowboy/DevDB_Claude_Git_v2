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
import { buildContextMenuItems } from '../utils/tdaContextMenu'


// ── Main view ─────────────────────────────────────────────────────
export default function TakedownAgreementsView({ entGroupId }) {
  const {
    agreements, entGroupName,
    selectedTdaId, setSelectedTdaId,
    detail,
    unassignedLots,
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

  useEffect(() => { clearSelectionsForTda() }, [selectedTdaId]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Global master controls ────────────────────────────────────────
  // These broadcast to all CheckpointBand instances via props.
  // Per-checkpoint controls still work independently (local override after master fires).
  const [masterShowLots,     setMasterShowLots]     = useState(true)
  const [masterCondensed,    setMasterCondensed]     = useState(false)
  const [masterShowTimeline, setMasterShowTimeline]  = useState(false)
  const [masterShowDig,      setMasterShowDig]       = useState(false)

  // Sort direction + sequence counter. Incrementing seq triggers all bands to re-sort.
  const [masterDateDir, setMasterDateDir] = useState('desc')
  const [masterDateSeq, setMasterDateSeq] = useState(0)
  const [masterUnitDir, setMasterUnitDir] = useState('asc')
  const [masterUnitSeq, setMasterUnitSeq] = useState(0)

  function handleMasterSortByDate() {
    const newDir = masterDateDir === 'desc' ? 'asc' : 'desc'
    setMasterDateDir(newDir)
    setMasterDateSeq(s => s + 1)
  }

  function handleMasterSortByUnit() {
    const newDir = masterUnitDir === 'asc' ? 'desc' : 'asc'
    setMasterUnitDir(newDir)
    setMasterUnitSeq(s => s + 1)
  }

  // ── Context menu ──────────────────────────────────────────────────
  const [contextMenu, setContextMenu] = useState(null)

  const handleContextMenu = useCallback((e, type, lotId) => {
    e.preventDefault()
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
    return buildContextMenuItems(contextMenu.type, contextMenu.lotIds, detail, agreements, {
      clearLotSelection, clearPoolLotSelection, clearAssignedLotSelection,
      addLotsToPool, removeLotsFromPool, assignLotsToCheckpoint,
      unassignLotFromCheckpoint, moveLotToOtherTda,
    })
  }, [contextMenu, detail, agreements, clearLotSelection, clearPoolLotSelection, clearAssignedLotSelection, addLotsToPool, removeLotsFromPool, assignLotsToCheckpoint, unassignLotFromCheckpoint, moveLotToOtherTda])

  // ── Render ───────────────────────────────────────────────────
  if (loading) return (
    <div style={{ padding: 32, color: '#6b7280', flex: 1 }}>Loading…</div>
  )
  if (error) return (
    <div style={{ padding: 32, color: '#dc2626', flex: 1 }}>Error: {error}</div>
  )

  // ── Master controls bar button helper ─────────────────────────────
  function masterBtn(active, label, onClick, activeColor = '#3B6D11', activeBg = '#EAF3DE', activeText = '#27500A') {
    return (
      <button
        onClick={onClick}
        style={{
          fontSize: 11, padding: '2px 9px', borderRadius: 4,
          border: `1px solid ${active ? activeColor : '#D4D2CB'}`,
          background: active ? activeBg : '#fff',
          color: active ? activeText : '#6B6B68',
          cursor: 'pointer',
        }}
      >
        {label}
      </button>
    )
  }

  const dateDirLabel = masterDateDir === 'desc' ? '↓ Date' : '↑ Date'
  const unitDirLabel = masterUnitDir === 'asc'  ? '↑ Unit' : '↓ Unit'

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden', background: '#f9fafb' }}>
      <TdaPageHeader
        entGroupName={entGroupName}
        mutationStatus={mutationStatus}
        createTda={createTda}
      />

      <TdaNavBar
        agreements={agreements}
        selectedTdaId={selectedTdaId}
        onSelect={setSelectedTdaId}
      />

      {/* Main content — scrollable */}
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
          {/* Left panel: Unassigned — always visible */}
          <UnassignedBank
            lots={unassignedLots}
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

          {/* Right: TDA content */}
          {detail ? (
            <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 12 }}>

              {/* Global master controls bar */}
              <div style={{
                display: 'flex', alignItems: 'center', gap: 6,
                padding: '6px 10px',
                background: '#F5F5F2',
                border: '1px solid #E4E2DA',
                borderRadius: 6,
                flexWrap: 'wrap',
              }}>
                <span style={{ fontSize: 11, color: '#888780', fontWeight: 600, marginRight: 4, whiteSpace: 'nowrap' }}>
                  All Checkpoints:
                </span>
                {masterBtn(masterDateSeq > 0, dateDirLabel, handleMasterSortByDate, '#0f766e', '#ccfbf1', '#0f766e')}
                {masterBtn(masterUnitSeq > 0, unitDirLabel, handleMasterSortByUnit, '#0f766e', '#ccfbf1', '#0f766e')}
                {masterBtn(masterShowTimeline, masterShowTimeline ? '▾ Timeline' : '▸ Timeline', () => setMasterShowTimeline(v => !v))}
                {masterBtn(masterCondensed,    masterCondensed    ? '⊟ Condensed' : '⊞ Condensed', () => setMasterCondensed(v => !v), '#6366f1', '#eef2ff', '#4338ca')}
                {masterBtn(false, masterShowLots ? '▾ Lots' : '▸ Lots', () => setMasterShowLots(v => !v))}
                {masterBtn(masterShowDig, masterShowDig ? '▾ DIG' : '▸ DIG', () => setMasterShowDig(v => !v), '#7c3aed', '#ede9fe', '#4c1d95')}
              </div>

              {/* TDA card + checkpoints */}
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
                      masterShowLots={masterShowLots}
                      masterCondensed={masterCondensed}
                      masterShowTimeline={masterShowTimeline}
                      masterShowDig={masterShowDig}
                      masterDateDir={masterDateDir}
                      masterDateSeq={masterDateSeq}
                      masterUnitDir={masterUnitDir}
                      masterUnitSeq={masterUnitSeq}
                    />
                  ))}
                </TdaCard>
              </div>
            </div>
          ) : (
            <div style={{ padding: '32px 0', color: '#9ca3af', fontSize: 15 }}>
              No agreement selected. Create one above to get started.
            </div>
          )}
        </div>

        <TdaDragOverlay
          dragLot={dragLot}
          selectedLotIds={selectedLotIds}
          selectedPoolLotIds={selectedPoolLotIds}
        />
      </DndContext>

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
