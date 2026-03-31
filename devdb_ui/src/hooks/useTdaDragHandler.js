import { useState } from 'react'
import { useSensors, useSensor, PointerSensor } from '@dnd-kit/core'

// Encapsulates all drag-drop state and event handling for the TDA view.
// Receives mutations from useTdaData so it never calls fetch directly.
//
// Returns:
//   sensors, dragLot, handleDragStart, handleDragEnd
//   selectedLotIds, selectedPoolLotIds, and all toggle/clear helpers
export function useTdaDragHandler({
  detail,
  addLotsToPool,
  removeLotsFromPool,
  assignLotsToCheckpoint,
  unassignLotFromCheckpoint,
  moveLotToOtherTda,
}) {
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }))

  const [dragLot, setDragLot] = useState(null)
  const [selectedLotIds, setSelectedLotIds] = useState(new Set())
  const [selectedPoolLotIds, setSelectedPoolLotIds] = useState(new Set())
  const [selectedAssignedLotIds, setSelectedAssignedLotIds] = useState(new Set())

  function clearSelectionsForTda() {
    setSelectedLotIds(new Set())
    setSelectedPoolLotIds(new Set())
    setSelectedAssignedLotIds(new Set())
  }

  function clearLotSelection() { setSelectedLotIds(new Set()) }
  function clearPoolLotSelection() { setSelectedPoolLotIds(new Set()) }
  function clearAssignedLotSelection() { setSelectedAssignedLotIds(new Set()) }

  function toggleAssignedLotSelection(lotId) {
    setSelectedAssignedLotIds(prev => {
      const next = new Set(prev)
      if (next.has(lotId)) next.delete(lotId)
      else next.add(lotId)
      return next
    })
  }

  // Select or deselect all lot_ids belonging to a checkpoint
  function toggleAssignedCheckpointSelection(checkpointLotIds) {
    const allSel = checkpointLotIds.every(id => selectedAssignedLotIds.has(id))
    setSelectedAssignedLotIds(prev => {
      const next = new Set(prev)
      if (allSel) checkpointLotIds.forEach(id => next.delete(id))
      else checkpointLotIds.forEach(id => next.add(id))
      return next
    })
  }

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

  function handleDragStart(event) {
    setDragLot(event.active.data.current)
  }

  async function handleDragEnd(event) {
    setDragLot(null)
    const { active, over } = event
    if (!over || !active || !detail) return

    const src = active.data.current
    const dst = over.data.current
    const tdaId = detail.tda_id

    // ── Global unassigned → TDA pool ─────────────────────────────
    if (src?.type === 'unassigned-lot' && dst?.type === 'tda-pool') {
      const isMulti = selectedLotIds.has(src.lot.lot_id) && selectedLotIds.size > 1
      const ids = isMulti ? [...selectedLotIds] : [src.lot.lot_id]
      if (isMulti) setSelectedLotIds(new Set())
      await addLotsToPool(tdaId, ids)
      return
    }

    // ── Global unassigned → checkpoint ───────────────────────────
    if (src?.type === 'unassigned-lot' && dst?.type === 'checkpoint') {
      const isMulti = selectedLotIds.has(src.lot.lot_id) && selectedLotIds.size > 1
      const ids = isMulti ? [...selectedLotIds] : [src.lot.lot_id]
      if (isMulti) setSelectedLotIds(new Set())
      await assignLotsToCheckpoint(tdaId, ids, dst.checkpointId)
      return
    }

    // ── TDA pool → checkpoint ────────────────────────────────────
    if (src?.type === 'pool-lot' && dst?.type === 'checkpoint') {
      const isMulti = selectedPoolLotIds.has(src.lot.lot_id) && selectedPoolLotIds.size > 1
      const ids = isMulti ? [...selectedPoolLotIds] : [src.lot.lot_id]
      if (isMulti) setSelectedPoolLotIds(new Set())
      await assignLotsToCheckpoint(tdaId, ids, dst.checkpointId)
      return
    }

    // ── TDA pool → global unassigned ────────────────────────────
    if (src?.type === 'pool-lot' && dst?.type === 'unassigned-bank') {
      const isMulti = selectedPoolLotIds.has(src.lot.lot_id) && selectedPoolLotIds.size > 1
      const ids = isMulti ? [...selectedPoolLotIds] : [src.lot.lot_id]
      if (isMulti) setSelectedPoolLotIds(new Set())
      await removeLotsFromPool(tdaId, ids)
      return
    }

    // ── Assigned lot → TDA pool (unassign from checkpoint, keep in pool) ──
    if (src?.type === 'assigned-lot' && dst?.type === 'tda-pool') {
      const isMulti = selectedAssignedLotIds.has(src.assignment.lot_id) && selectedAssignedLotIds.size > 1
      const ids = isMulti ? [...selectedAssignedLotIds] : [src.assignment.lot_id]
      if (isMulti) setSelectedAssignedLotIds(new Set())
      await Promise.all(ids.map(id => unassignLotFromCheckpoint(tdaId, id)))
      return
    }

    // ── Assigned lot → global unassigned (remove from pool entirely) ──
    if (src?.type === 'assigned-lot' && dst?.type === 'unassigned-bank') {
      const isMulti = selectedAssignedLotIds.has(src.assignment.lot_id) && selectedAssignedLotIds.size > 1
      const ids = isMulti ? [...selectedAssignedLotIds] : [src.assignment.lot_id]
      if (isMulti) setSelectedAssignedLotIds(new Set())
      await removeLotsFromPool(tdaId, ids)
      return
    }

    // ── Assigned lot → different checkpoint ──────────────────────
    // Backend moves the existing assignment row (preserves HC/BLDR dates)
    if (src?.type === 'assigned-lot' && dst?.type === 'checkpoint') {
      const isMulti = selectedAssignedLotIds.has(src.assignment.lot_id) && selectedAssignedLotIds.size > 1
      const ids = isMulti ? [...selectedAssignedLotIds] : [src.assignment.lot_id]
      if (isMulti) setSelectedAssignedLotIds(new Set())
      await assignLotsToCheckpoint(tdaId, ids, dst.checkpointId)
      return
    }

    // ── Any lot → other TDA pool ─────────────────────────────────
    if (dst?.type === 'other-tda') {
      const targetTdaId = dst.tdaId
      if (src?.type === 'unassigned-lot') {
        const isMulti = selectedLotIds.has(src.lot.lot_id) && selectedLotIds.size > 1
        const ids = isMulti ? [...selectedLotIds] : [src.lot.lot_id]
        if (isMulti) setSelectedLotIds(new Set())
        await addLotsToPool(targetTdaId, ids)
      } else if (src?.type === 'pool-lot') {
        const isMulti = selectedPoolLotIds.has(src.lot.lot_id) && selectedPoolLotIds.size > 1
        const ids = isMulti ? [...selectedPoolLotIds] : [src.lot.lot_id]
        if (isMulti) setSelectedPoolLotIds(new Set())
        for (const id of ids) await moveLotToOtherTda(tdaId, targetTdaId, id, false)
      } else if (src?.type === 'assigned-lot') {
        await moveLotToOtherTda(tdaId, targetTdaId, src.assignment.lot_id, true)
      }
    }
  }

  return {
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
  }
}
