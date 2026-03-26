import { useState, useEffect, useCallback, useRef } from 'react'
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  closestCenter,
} from '@dnd-kit/core'
import InstrumentContainer, { buildDevColorMap } from '../components/InstrumentContainer'
import UnassignedColumn from '../components/UnassignedColumn'
import PhaseColumn from '../components/PhaseColumn'
import LotCard from '../components/LotCard'
import Toast from '../components/Toast'

const ENT_GROUP_ID = 9002

export default function LotPhaseView() {
  const [entGroup, setEntGroup] = useState(null)
  const [instruments, setInstruments] = useState([])    // [{ instrument_id, phases: [...] }]
  const [unassignedPhases, setUnassignedPhases] = useState([])
  const [unassigned, setUnassigned] = useState([])      // lots with phase_id=null
  const [loading, setLoading] = useState(true)
  const [fetchError, setFetchError] = useState(null)
  const [devColorMap, setDevColorMap] = useState({})

  // Drag state
  const [activeLot, setActiveLot] = useState(null)
  const [activePhase, setActivePhase] = useState(null)
  const [activeDragType, setActiveDragType] = useState(null)
  const [pendingLotId, setPendingLotId] = useState(null)
  const [pendingPhaseId, setPendingPhaseId] = useState(null)

  // Toasts
  const [toasts, setToasts] = useState([])
  const toastCounter = useRef(0)

  // Needs-rerun banner
  const [needsRerun, setNeedsRerun] = useState(false)

  // Collapse state — tracks which phase_ids are collapsed
  const [collapsedPhaseIds, setCollapsedPhaseIds] = useState(new Set())

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } })
  )

  // -----------------------------------------------------------------------
  // Load initial data
  // -----------------------------------------------------------------------
  useEffect(() => {
    fetch(`/api/entitlement-groups/${ENT_GROUP_ID}/lot-phase-view`)
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        return r.json()
      })
      .then((data) => {
        // Inject phase_id onto each lot so drop detection works
        const instruments = data.instruments.map((instr) => ({
          ...instr,
          phases: instr.phases.map((p) => ({
            ...p,
            lots: p.lots.map((l) => ({ ...l, phase_id: p.phase_id })),
          })),
        }))
        const unassignedPhases = (data.unassigned_phases ?? []).map((p) => ({
          ...p,
          lots: p.lots.map((l) => ({ ...l, phase_id: p.phase_id })),
        }))

        // Build color map from unique dev_ids
        const allDevIds = instruments.map((i) => i.dev_id)
        setDevColorMap(buildDevColorMap(allDevIds))

        setEntGroup({ ent_group_id: data.ent_group_id, ent_group_name: data.ent_group_name })
        setInstruments(instruments)
        setUnassignedPhases(unassignedPhases)
        setUnassigned((data.unassigned ?? []).map((l) => ({ ...l, phase_id: null })))
        setLoading(false)
      })
      .catch((err) => {
        setFetchError(err.message)
        setLoading(false)
      })
  }, [])

  // -----------------------------------------------------------------------
  // Toast helpers
  // -----------------------------------------------------------------------
  const addToast = useCallback((type, message, subMessage = null) => {
    const id = ++toastCounter.current
    setToasts((prev) => [...prev, { id, type, message, subMessage }])
  }, [])

  const dismissToast = useCallback((id) => {
    setToasts((prev) => prev.filter((t) => t.id !== id))
  }, [])

  // -----------------------------------------------------------------------
  // Drag handlers
  // -----------------------------------------------------------------------
  function handleDragStart(event) {
    const type = event.active.data.current?.type
    setActiveDragType(type)
    if (type === 'lot') {
      setActiveLot(event.active.data.current?.lot)
    } else if (type === 'phase') {
      setActivePhase(event.active.data.current?.phase)
    }
  }

  function handleDragCancel() {
    setActiveLot(null)
    setActivePhase(null)
    setActiveDragType(null)
  }

  async function handleDragEnd(event) {
    const { active, over } = event
    setActiveLot(null)
    setActivePhase(null)
    setActiveDragType(null)

    if (!over) return

    const dragType = active.data.current?.type
    if (dragType === 'lot') {
      await handleLotDrop(active, over)
    } else if (dragType === 'phase') {
      await handlePhaseDrop(active, over)
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
    const targetPhase = over.data.current?.phase

    if (!droppedOnUnassigned && !overLotTarget) return

    if (droppedOnUnassigned && lot.phase_id === null) return
    if (overLotTarget && lot.phase_id === targetPhase.phase_id) return

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
        const res = await fetch(`/api/lots/${lot.lot_id}/phase`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ target_phase_id: targetPhase.phase_id, changed_by: 'user' }),
        })
        const data = await res.json()

        if (res.ok) {
          const { transaction, phase_counts, needs_rerun, warnings } = data
          const fromUnassigned = lot.phase_id === null

          if (fromUnassigned) {
            setUnassigned((prev) => prev.filter((l) => l.lot_id !== lot.lot_id))
          } else {
            updatePhaseInBothStates(transaction.from_phase_id, (p) => ({
              ...p,
              lots: p.lots.filter((l) => l.lot_id !== lot.lot_id),
              by_lot_type: mergedCounts(p.by_lot_type, phase_counts.from_phase.by_lot_type),
            }))
          }
          updatePhaseInBothStates(transaction.to_phase_id, (p) => ({
            ...p,
            lots: [...p.lots, { ...lot, phase_id: transaction.to_phase_id }].sort(
              (a, b) => (a.lot_number ?? '').localeCompare(b.lot_number ?? '')
            ),
            by_lot_type: mergedCounts(p.by_lot_type, phase_counts.to_phase.by_lot_type),
          }))

          if (needs_rerun?.length > 0) setNeedsRerun(true)
          const toPhaseName = findPhaseName(transaction.to_phase_id)
          addToast('success', `Lot ${transaction.lot_number} moved to ${toPhaseName}`)
          warnings?.forEach((w) => addToast('warning', w.message))
        } else {
          addToast('error', data?.detail?.message ?? data?.detail ?? 'Move failed')
        }
      }
    } catch (err) {
      addToast('error', `Network error: ${err.message}`)
    } finally {
      setPendingLotId(null)
    }
  }

  // -----------------------------------------------------------------------
  // Phase drop — move phase between instrument containers
  // -----------------------------------------------------------------------
  async function handlePhaseDrop(active, over) {
    const phase = active.data.current?.phase
    if (!phase) return

    if (over.data.current?.type !== 'instrument-target') return

    const targetInstrumentId = over.data.current?.instrumentId  // null = "No instrument"
    const currentInstrumentId = phase.instrument_id ?? null

    // Same instrument — no-op
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
        const { transaction, needs_rerun } = data
        const updatedPhase = { ...phase, instrument_id: targetInstrumentId }

        // Remove from old location
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

        // Add to new location
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

        const targetName = over.data.current?.instrumentName ?? 'No instrument'
        const verb = targetInstrumentId === null ? 'removed from instrument' : `moved to ${targetName}`
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
  // State helpers
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

  // -----------------------------------------------------------------------
  // Collapse helpers
  // -----------------------------------------------------------------------
  function togglePhaseCollapse(phaseId) {
    setCollapsedPhaseIds((prev) => {
      const next = new Set(prev)
      if (next.has(phaseId)) next.delete(phaseId)
      else next.add(phaseId)
      return next
    })
  }

  function collapseAll() {
    const ids = [
      ...instruments.flatMap((i) => i.phases.map((p) => p.phase_id)),
      ...unassignedPhases.map((p) => p.phase_id),
    ]
    setCollapsedPhaseIds(new Set(ids))
  }

  function expandAll() {
    setCollapsedPhaseIds(new Set())
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
  // Render
  // -----------------------------------------------------------------------
  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen text-gray-500">Loading…</div>
    )
  }

  if (fetchError) {
    return (
      <div className="flex items-center justify-center min-h-screen text-red-600">
        Failed to load: {fetchError}
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-slate-50 p-4 font-sans">
      {/* Header */}
      <div className="mb-4 flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-xl font-bold text-gray-900 truncate">
            Lot → Phase &nbsp;|&nbsp; {entGroup?.ent_group_name ?? `Group ${ENT_GROUP_ID}`}
          </h1>
          <p className="text-sm text-gray-500 mt-0.5">
            Drag lot cards to reassign. Drag phase headers (⠿) to reassign instrument.
          </p>
        </div>
        <div className="flex gap-2 flex-shrink-0">
          <button
            onClick={collapseAll}
            className="rounded border border-gray-200 bg-white px-3 py-1 text-xs text-gray-600 hover:bg-gray-50"
          >
            Collapse all
          </button>
          <button
            onClick={expandAll}
            className="rounded border border-gray-200 bg-white px-3 py-1 text-xs text-gray-600 hover:bg-gray-50"
          >
            Expand all
          </button>
        </div>
      </div>

      {/* Needs-rerun banner */}
      {needsRerun && (
        <div className="mb-4 rounded-lg border border-amber-300 bg-amber-50 px-4 py-2 text-sm text-amber-800 font-medium">
          ⚠ Simulation results are outdated. Run simulation to update.
        </div>
      )}

      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
        onDragCancel={handleDragCancel}
      >
        {/* Main layout — Unassigned pinned left, instruments wrap */}
        <div className="flex gap-3 pb-4 items-start flex-wrap">
          {/* Unassigned lots — fixed 160px, never wraps */}
          <div style={{ flex: '0 0 160px', width: 160 }}>
            <UnassignedColumn lots={unassigned} pendingLotId={pendingLotId} />
          </div>

          {/* Instrument containers — each sizes to fit-content, wrap to new rows */}
          {instruments.map((instr) => (
            <InstrumentContainer
              key={instr.instrument_id}
              instrument={instr}
              phases={instr.phases}
              tint={devColorMap[instr.dev_id]}
              pendingLotId={pendingLotId}
              pendingPhaseId={pendingPhaseId}
              activeDragType={activeDragType}
              collapsedPhaseIds={collapsedPhaseIds}
              onToggleCollapse={togglePhaseCollapse}
            />
          ))}

          {/* "No instrument" container — always visible */}
          <InstrumentContainer
            instrument={null}
            phases={unassignedPhases}
            tint={null}
            pendingLotId={pendingLotId}
            pendingPhaseId={pendingPhaseId}
            activeDragType={activeDragType}
            collapsedPhaseIds={collapsedPhaseIds}
            onToggleCollapse={togglePhaseCollapse}
          />
        </div>

        <DragOverlay dropAnimation={null}>
          {activeLot && <LotCard lot={activeLot} isOverlay />}
          {activePhase && <PhaseColumn phase={activePhase} isOverlay />}
        </DragOverlay>
      </DndContext>

      {/* Toast stack */}
      <div className="fixed bottom-4 right-4 flex flex-col gap-2 z-50">
        {toasts.map((t) => (
          <Toast
            key={t.id}
            id={t.id}
            type={t.type}
            message={t.message}
            subMessage={t.subMessage}
            onDismiss={dismissToast}
          />
        ))}
      </div>
    </div>
  )
}

// Replace phase counts for matching lot_type_ids; keep others unchanged
function mergedCounts(existing, updates) {
  const updateMap = Object.fromEntries(updates.map((u) => [u.lot_type_id, u]))
  return existing.map((e) => updateMap[e.lot_type_id] ?? e)
}
