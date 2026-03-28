import { useState } from 'react'
import { PointerSensor, useSensor, useSensors } from '@dnd-kit/core'
import { arrayMove } from '@dnd-kit/sortable'

export function useDragHandler({
  instruments,
  setInstruments,
  pgGroups,
  unassignedPhases,
  setUnassignedPhases,
  unassigned,
  setUnassigned,
  setPgOrder,
  addToast,
  setNeedsRerun,
}) {
  const [activeLot, setActiveLot] = useState(null)
  const [activePhase, setActivePhase] = useState(null)
  const [activeInstrument, setActiveInstrument] = useState(null)
  const [activePg, setActivePg] = useState(null)
  const [activeDragType, setActiveDragType] = useState(null)
  const [pendingLotId, setPendingLotId] = useState(null)
  const [pendingPhaseId, setPendingPhaseId] = useState(null)

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } })
  )

  // -----------------------------------------------------------------------
  // Internal helpers
  // -----------------------------------------------------------------------
  function updatePhaseInBothStates(phase_id, updater) {
    setInstruments((prev) =>
      prev.map((instr) => ({
        ...instr,
        phases: instr.phases.map((p) => (p.phase_id === phase_id ? updater(p) : p)),
      }))
    )
    setUnassignedPhases((prev) => prev.map((p) => (p.phase_id === phase_id ? updater(p) : p)))
  }

  function findPhaseName(phase_id) {
    for (const instr of instruments) {
      const p = instr.phases.find((p) => p.phase_id === phase_id)
      if (p) return p.phase_name
    }
    const p = unassignedPhases.find((p) => p.phase_id === phase_id)
    return p?.phase_name ?? `phase ${phase_id}`
  }

  // -----------------------------------------------------------------------
  // Drag start / cancel
  // -----------------------------------------------------------------------
  function handleDragStart(event) {
    const type = event.active.data.current?.type
    setActiveDragType(type)
    if (type === 'lot') {
      setActiveLot(event.active.data.current?.lot)
    } else if (type === 'phase') {
      setActivePhase(event.active.data.current?.phase)
    } else if (type === 'instrument') {
      const instrId = event.active.data.current?.instrumentId
      setActiveInstrument(instruments.find((i) => i.instrument_id === instrId) ?? null)
    } else if (type === 'projection-group') {
      setActivePg(event.active.data.current?.devId ?? null)
    }
  }

  function handleDragCancel() {
    setActiveLot(null)
    setActivePhase(null)
    setActiveInstrument(null)
    setActivePg(null)
    setActiveDragType(null)
  }

  // -----------------------------------------------------------------------
  // Drag end — dispatches by type
  // -----------------------------------------------------------------------
  async function handleDragEnd(event) {
    const { active, over } = event
    setActiveLot(null)
    setActivePhase(null)
    setActiveInstrument(null)
    setActivePg(null)
    setActiveDragType(null)

    if (!over || active.id === over.id) return

    const dragType = active.data.current?.type

    if (dragType === 'lot') {
      await handleLotDrop(active, over)
    } else if (dragType === 'phase') {
      const overType = over.data.current?.type
      const activeInstrumentId = active.data.current?.instrumentId ?? null
      if (overType === 'instrument-target') {
        await handlePhaseReassign(
          active,
          over.data.current.instrumentId,
          over.data.current.instrumentName ?? 'No instrument',
        )
      } else if (overType === 'phase') {
        const overInstrumentId = over.data.current?.instrumentId ?? null
        if (activeInstrumentId === overInstrumentId) {
          await handlePhaseReorder(active, over)
        } else {
          const targetInstr = instruments.find((i) => i.instrument_id === overInstrumentId)
          await handlePhaseReassign(
            active,
            overInstrumentId,
            targetInstr?.instrument_name ?? 'No instrument',
          )
        }
      }
    } else if (dragType === 'instrument') {
      const overType = over.data.current?.type
      const activeInstrId = active.data.current?.instrumentId
      const activeDevId = active.data.current?.devId
      if (overType === 'instrument') {
        const overInstrId = over.data.current?.instrumentId
        const overDevId = over.data.current?.devId
        if (activeDevId === overDevId) {
          handleInstrumentReorder(activeInstrId, overInstrId, activeDevId)
        } else {
          handleInstrumentMoveToPg(activeInstrId, overDevId)
        }
      } else if (overType === 'pg-target') {
        handleInstrumentMoveToPg(activeInstrId, over.data.current?.devId)
      }
    } else if (dragType === 'projection-group') {
      const overType = over.data.current?.type
      if (overType === 'projection-group') {
        handlePgReorder(active.data.current?.devId, over.data.current?.devId)
      }
    }
  }

  // -----------------------------------------------------------------------
  // Lot drop — move lot between phases or to Unassigned
  // -----------------------------------------------------------------------
  async function handleLotDrop(active, over) {
    const lot = active.data.current?.lot
    if (!lot) return

    const droppedOnUnassigned = over.data.current?.type === 'unassigned'
    const overLotTarget = over.data.current?.type === 'lot-target'

    if (!droppedOnUnassigned && !overLotTarget) return
    if (droppedOnUnassigned && lot.phase_id === null) return

    const targetPhase = over.data.current?.phase
    const targetPhaseId = targetPhase?.phase_id ?? null
    const targetLotTypeId = over.data.current?.lotTypeId ?? null

    if (
      overLotTarget &&
      targetPhaseId === lot.phase_id &&
      (targetLotTypeId === null || targetLotTypeId === lot.lot_type_id)
    ) return

    setPendingLotId(lot.lot_id)

    try {
      if (droppedOnUnassigned) {
        const res = await fetch(`/api/lots/${lot.lot_id}/phase?changed_by=user`, { method: 'DELETE' })
        const data = await res.json()

        if (res.ok) {
          const { transaction, from_phase_counts, needs_rerun, warnings } = data
          updatePhaseInBothStates(transaction.from_phase_id, (p) => ({
            ...p,
            lots: p.lots.filter((l) => l.lot_id !== lot.lot_id),
            by_lot_type: mergedCounts(p.by_lot_type, from_phase_counts.by_lot_type),
          }))
          setUnassigned((prev) =>
            [...prev, { ...lot, phase_id: null }].sort(
              (a, b) => (a.lot_number ?? '').localeCompare(b.lot_number ?? '')
            )
          )
          if (needs_rerun?.length > 0) setNeedsRerun(true)
          const fromPhaseName = findPhaseName(transaction.from_phase_id)
          addToast('success', `Lot ${transaction.lot_number} unassigned from ${fromPhaseName}`)
          warnings?.forEach((w) => addToast('warning', w.message))
        } else {
          addToast('error', data?.detail?.message ?? data?.detail ?? 'Unassign failed')
        }
      } else {
        const diffType = targetLotTypeId !== null && targetLotTypeId !== lot.lot_type_id
        const diffPhase = targetPhaseId !== lot.phase_id
        const fromUnassigned = lot.phase_id === null

        if (diffType) {
          // Case B — different lot type: change type first, then optionally move phase
          const r1 = await fetch(`/api/lots/${lot.lot_id}/lot-type`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ lot_type_id: targetLotTypeId, changed_by: 'user' }),
          })
          const d1 = await r1.json()
          if (!r1.ok) {
            addToast('error', d1?.detail?.message ?? d1?.detail ?? 'Type change failed')
            return
          }

          // Apply lot-type change: update lot's type in current location
          if (fromUnassigned) {
            setUnassigned((prev) =>
              prev.map((l) => l.lot_id === lot.lot_id ? { ...l, lot_type_id: targetLotTypeId } : l)
            )
          } else {
            updatePhaseInBothStates(lot.phase_id, (p) => ({
              ...p,
              lots: p.lots.map((l) =>
                l.lot_id === lot.lot_id ? { ...l, lot_type_id: targetLotTypeId } : l
              ),
              by_lot_type: d1.phase_counts.phase.by_lot_type,
            }))
          }

          const updatedLot = { ...lot, lot_type_id: targetLotTypeId }
          const newTypeShort = d1.phase_counts.phase.by_lot_type.find(
            (lt) => lt.lot_type_id === targetLotTypeId
          )?.lot_type_short ?? String(targetLotTypeId)

          if (diffPhase) {
            // Also move to target phase
            const r2 = await fetch(`/api/lots/${lot.lot_id}/phase`, {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ target_phase_id: targetPhaseId, changed_by: 'user' }),
            })
            const d2 = await r2.json()
            if (!r2.ok) {
              addToast('error', d2?.detail?.message ?? d2?.detail ?? 'Move failed')
              return
            }

            const { transaction: t2, phase_counts: pc2, needs_rerun: nr2, warnings: w2 } = d2

            if (fromUnassigned) {
              setUnassigned((prev) => prev.filter((l) => l.lot_id !== lot.lot_id))
            } else {
              updatePhaseInBothStates(t2.from_phase_id, (p) => ({
                ...p,
                lots: p.lots.filter((l) => l.lot_id !== lot.lot_id),
                by_lot_type: pc2.from_phase.by_lot_type,
              }))
            }
            updatePhaseInBothStates(t2.to_phase_id, (p) => ({
              ...p,
              lots: [...p.lots, { ...updatedLot, phase_id: targetPhaseId }].sort(
                (a, b) => (a.lot_number ?? '').localeCompare(b.lot_number ?? '')
              ),
              by_lot_type: pc2.to_phase.by_lot_type,
            }))

            if (nr2?.length > 0) setNeedsRerun(true)
            const toPhaseName = findPhaseName(targetPhaseId)
            addToast('success', `Lot ${lot.lot_number} → ${newTypeShort} and moved to ${toPhaseName}`)
            w2?.forEach((w) => addToast('warning', w.message))
          } else {
            // Same phase, type changed only
            addToast('success', `Lot ${lot.lot_number} → ${newTypeShort}`)
          }
        } else {
          // Case A or C — same type (or no specific type): just move phase
          const res = await fetch(`/api/lots/${lot.lot_id}/phase`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ target_phase_id: targetPhaseId, changed_by: 'user' }),
          })
          const data = await res.json()

          if (res.ok) {
            const { transaction, phase_counts, needs_rerun, warnings } = data

            if (fromUnassigned) {
              setUnassigned((prev) => prev.filter((l) => l.lot_id !== lot.lot_id))
            } else {
              updatePhaseInBothStates(transaction.from_phase_id, (p) => ({
                ...p,
                lots: p.lots.filter((l) => l.lot_id !== lot.lot_id),
                by_lot_type: phase_counts.from_phase.by_lot_type,
              }))
            }
            updatePhaseInBothStates(transaction.to_phase_id, (p) => ({
              ...p,
              lots: [...p.lots, { ...lot, phase_id: transaction.to_phase_id }].sort(
                (a, b) => (a.lot_number ?? '').localeCompare(b.lot_number ?? '')
              ),
              by_lot_type: phase_counts.to_phase.by_lot_type,
            }))

            if (needs_rerun?.length > 0) setNeedsRerun(true)
            const toPhaseName = findPhaseName(transaction.to_phase_id)
            addToast('success', `Lot ${transaction.lot_number} moved to ${toPhaseName}`)
            warnings?.forEach((w) => addToast('warning', w.message))
          } else {
            addToast('error', data?.detail?.message ?? data?.detail ?? 'Move failed')
          }
        }
      }
    } catch (err) {
      addToast('error', `Network error: ${err.message}`)
    } finally {
      setPendingLotId(null)
    }
  }

  // -----------------------------------------------------------------------
  // Phase reassign — move phase to a different instrument container
  // -----------------------------------------------------------------------
  async function handlePhaseReassign(active, targetInstrumentId, targetInstrumentName) {
    const phase = active.data.current?.phase
    if (!phase) return

    const currentInstrumentId = phase.instrument_id ?? null
    if (currentInstrumentId === targetInstrumentId) return

    setPendingPhaseId(phase.phase_id)

    try {
      const res = await fetch(`/api/phases/${phase.phase_id}/instrument`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ target_instrument_id: targetInstrumentId, changed_by: 'user' }),
      })
      const data = await res.json()

      if (res.ok) {
        const { needs_rerun } = data
        const updatedPhase = { ...phase, instrument_id: targetInstrumentId }

        if (currentInstrumentId === null) {
          setUnassignedPhases((prev) => prev.filter((p) => p.phase_id !== phase.phase_id))
        } else {
          setInstruments((prev) =>
            prev.map((instr) =>
              instr.instrument_id === currentInstrumentId
                ? { ...instr, phases: instr.phases.filter((p) => p.phase_id !== phase.phase_id) }
                : instr
            )
          )
        }

        if (targetInstrumentId === null) {
          setUnassignedPhases((prev) => [...prev, updatedPhase])
        } else {
          setInstruments((prev) =>
            prev.map((instr) =>
              instr.instrument_id === targetInstrumentId
                ? { ...instr, phases: [...instr.phases, updatedPhase] }
                : instr
            )
          )
        }

        if (needs_rerun?.length > 0) setNeedsRerun(true)

        const verb =
          targetInstrumentId === null ? 'removed from instrument' : `moved to ${targetInstrumentName}`
        addToast('success', `Phase ${phase.phase_name} ${verb}`)
      } else {
        addToast('error', data?.detail?.message ?? data?.detail ?? 'Phase move failed')
      }
    } catch (err) {
      addToast('error', `Network error: ${err.message}`)
    } finally {
      setPendingPhaseId(null)
    }
  }

  // -----------------------------------------------------------------------
  // Phase reorder — drag to new position within same instrument
  // display_order is updated; sequence_number is never touched.
  // -----------------------------------------------------------------------
  async function handlePhaseReorder(active, over) {
    const instrumentId = active.data.current?.instrumentId ?? null
    if (instrumentId === null) return

    const instr = instruments.find((i) => i.instrument_id === instrumentId)
    if (!instr) return

    const activePhaseId = active.data.current?.phase?.phase_id
    const overPhaseId = over.data.current?.phase?.phase_id

    const oldIndex = instr.phases.findIndex((p) => p.phase_id === activePhaseId)
    const newIndex = instr.phases.findIndex((p) => p.phase_id === overPhaseId)
    if (oldIndex === -1 || newIndex === -1 || oldIndex === newIndex) return

    const previousPhases = instr.phases
    const reordered = arrayMove(instr.phases, oldIndex, newIndex)

    setInstruments((prev) =>
      prev.map((i) => (i.instrument_id === instrumentId ? { ...i, phases: reordered } : i))
    )

    const phaseIds = reordered.map((p) => p.phase_id)

    try {
      const res = await fetch(`/api/instruments/${instrumentId}/phase-order`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phase_ids: phaseIds, changed_by: 'user' }),
      })
      const data = await res.json()
      if (!res.ok) {
        setInstruments((prev) =>
          prev.map((i) => (i.instrument_id === instrumentId ? { ...i, phases: previousPhases } : i))
        )
        addToast('error', data?.detail ?? 'Reorder failed')
      }
    } catch (err) {
      setInstruments((prev) =>
        prev.map((i) => (i.instrument_id === instrumentId ? { ...i, phases: previousPhases } : i))
      )
      addToast('error', `Network error: ${err.message}`)
    }
  }

  // -----------------------------------------------------------------------
  // Instrument reorder — drag to new position within same PG
  // Frontend-only; no backend endpoint yet.
  // -----------------------------------------------------------------------
  function handleInstrumentReorder(activeInstrId, overInstrId, devId) {
    setInstruments((prev) => {
      const devInstrs = prev.filter((i) => i.dev_id === devId)
      const oldIdx = devInstrs.findIndex((i) => i.instrument_id === activeInstrId)
      const newIdx = devInstrs.findIndex((i) => i.instrument_id === overInstrId)
      if (oldIdx === -1 || newIdx === -1 || oldIdx === newIdx) return prev
      const reorderedDev = arrayMove(devInstrs, oldIdx, newIdx)
      let devCounter = 0
      return prev.map((i) => (i.dev_id === devId ? reorderedDev[devCounter++] : i))
    })
    // TODO: persist instrument order to backend
  }

  // -----------------------------------------------------------------------
  // Instrument move to different PG — frontend-only stub
  // -----------------------------------------------------------------------
  function handleInstrumentMoveToPg(instrumentId, targetDevId) {
    setInstruments((prev) =>
      prev.map((i) => (i.instrument_id === instrumentId ? { ...i, dev_id: targetDevId } : i))
    )
    // TODO: persist instrument dev_id change to backend
  }

  // -----------------------------------------------------------------------
  // PG reorder — drag to new position among all PGs
  // Frontend-only; order is local state only.
  // -----------------------------------------------------------------------
  function handlePgReorder(activeDevId, overDevId) {
    setPgOrder((prev) => {
      const oldIdx = prev.indexOf(activeDevId)
      const newIdx = prev.indexOf(overDevId)
      if (oldIdx === -1 || newIdx === -1 || oldIdx === newIdx) return prev
      return arrayMove(prev, oldIdx, newIdx)
    })
  }

  // -----------------------------------------------------------------------
  // Auto-sort — sort phases in an instrument via backend auto-sort endpoint
  // -----------------------------------------------------------------------
  async function handleAutoSort(instrumentId) {
    try {
      const res = await fetch(`/api/instruments/${instrumentId}/phase-order/auto-sort`, {
        method: 'POST',
      })
      const data = await res.json()
      if (res.ok) {
        const orderedIds = data.phase_order
        setInstruments((prev) =>
          prev.map((instr) => {
            if (instr.instrument_id !== instrumentId) return instr
            const phaseMap = Object.fromEntries(instr.phases.map((p) => [p.phase_id, p]))
            const reordered = orderedIds.map((id) => phaseMap[id]).filter(Boolean)
            return { ...instr, phases: reordered }
          })
        )
        addToast('success', 'Phases sorted')
      } else {
        addToast('error', data?.detail ?? 'Auto-sort failed')
      }
    } catch (err) {
      addToast('error', `Network error: ${err.message}`)
    }
  }

  return {
    sensors,
    handleDragStart,
    handleDragEnd,
    handleDragCancel,
    handleAutoSort,
    activeLot,
    activePhase,
    activeInstrument,
    activePg,
    activeDragType,
    pendingLotId,
    pendingPhaseId,
  }
}

// Replace phase counts for matching lot_type_ids; keep others unchanged.
// Appends entries from updates whose lot_type_id is not yet in existing.
// Removes entries where both actual and projected dropped to 0 (cleanup on lot removal).
function mergedCounts(existing, updates) {
  if (!updates?.length) return existing
  const updateMap = Object.fromEntries(updates.map((u) => [u.lot_type_id, u]))
  const existingIds = new Set(existing.map((e) => e.lot_type_id))
  const merged = existing.map((e) => updateMap[e.lot_type_id] ?? e)
  const added = updates.filter((u) => !existingIds.has(u.lot_type_id))
  return [...merged, ...added].filter((e) => e.actual > 0 || e.projected > 0)
}
