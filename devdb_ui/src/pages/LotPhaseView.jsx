import { useState, useEffect, useCallback, useRef } from 'react'
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  closestCenter,
} from '@dnd-kit/core'
import PhaseColumn from '../components/PhaseColumn'
import LotCard from '../components/LotCard'
import Toast from '../components/Toast'

const DEV_ID = 48

export default function LotPhaseView() {
  const [phases, setPhases] = useState([])
  const [loading, setLoading] = useState(true)
  const [fetchError, setFetchError] = useState(null)

  // Drag state
  const [activeLot, setActiveLot] = useState(null)         // lot being dragged
  const [pendingLotId, setPendingLotId] = useState(null)   // lot mid-API call
  const [dragDisabled, setDragDisabled] = useState(false)

  // Toasts
  const [toasts, setToasts] = useState([])
  const toastCounter = useRef(0)

  // Needs-rerun banner
  const [needsRerun, setNeedsRerun] = useState(false)

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } })
  )

  // -----------------------------------------------------------------------
  // Load initial data
  // -----------------------------------------------------------------------
  useEffect(() => {
    fetch(`/api/developments/${DEV_ID}/lot-phase-view`)
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        return r.json()
      })
      .then((data) => {
        // Inject phase_id onto each lot so we can detect same-column drops
        const phases = data.phases.map((p) => ({
          ...p,
          lots: p.lots.map((l) => ({ ...l, phase_id: p.phase_id })),
        }))
        setPhases(phases)
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
    const lot = event.active.data.current?.lot
    if (lot) setActiveLot(lot)
  }

  function handleDragCancel() {
    setActiveLot(null)
  }

  async function handleDragEnd(event) {
    const { active, over } = event
    setActiveLot(null)

    if (!over) return

    const lot = active.data.current?.lot
    const targetPhase = over.data.current?.phase

    if (!lot || !targetPhase) return
    if (lot.phase_id === targetPhase.phase_id) return  // dropped on same column

    // Prevent further drags while API call is in flight
    setDragDisabled(true)
    setPendingLotId(lot.lot_id)

    try {
      const res = await fetch(`/api/lots/${lot.lot_id}/phase`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          target_phase_id: targetPhase.phase_id,
          changed_by: 'user',
        }),
      })

      const data = await res.json()

      if (res.ok) {
        // Update local state from response
        const { transaction, phase_counts, needs_rerun, warnings } = data

        setPhases((prev) => {
          const updated = prev.map((phase) => {
            // Move lot from from_phase to to_phase
            if (phase.phase_id === transaction.from_phase_id) {
              const updatedLots = phase.lots.filter((l) => l.lot_id !== lot.lot_id)
              const fromCounts = phase_counts.from_phase.by_lot_type
              return { ...phase, lots: updatedLots, by_lot_type: mergedCounts(phase.by_lot_type, fromCounts) }
            }
            if (phase.phase_id === transaction.to_phase_id) {
              const updatedLots = [...phase.lots, { ...lot, phase_id: transaction.to_phase_id }].sort(
                (a, b) => (a.lot_number ?? '').localeCompare(b.lot_number ?? '')
              )
              const toCounts = phase_counts.to_phase.by_lot_type
              return { ...phase, lots: updatedLots, by_lot_type: mergedCounts(phase.by_lot_type, toCounts) }
            }
            return phase
          })
          return updated
        })

        if (needs_rerun?.length > 0) setNeedsRerun(true)

        const toPhase = phases.find((p) => p.phase_id === transaction.to_phase_id)
        addToast('success', `Lot ${transaction.lot_number} moved to ${toPhase?.phase_name ?? `phase ${transaction.to_phase_id}`}`)

        if (warnings?.length > 0) {
          warnings.forEach((w) => addToast('warning', w.message))
        }
      } else {
        // 422 or other error — snap back (lot already stayed in place, nothing to undo in local state)
        const errMsg = data?.detail?.message ?? data?.detail ?? 'Move failed'
        addToast('error', errMsg)
      }
    } catch (err) {
      addToast('error', `Network error: ${err.message}`)
    } finally {
      setPendingLotId(null)
      setDragDisabled(false)
    }
  }

  // -----------------------------------------------------------------------
  // Render
  // -----------------------------------------------------------------------
  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen text-gray-500">
        Loading…
      </div>
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
      <div className="mb-4">
        <h1 className="text-xl font-bold text-gray-900">
          Lot → Phase Assignment &nbsp;|&nbsp; dev {DEV_ID}
        </h1>
        <p className="text-sm text-gray-500 mt-0.5">
          Drag a lot card onto a phase column to reassign it.
        </p>
      </div>

      {/* Needs-rerun banner */}
      {needsRerun && (
        <div className="mb-4 rounded-lg border border-amber-300 bg-amber-50 px-4 py-2 text-sm text-amber-800 font-medium">
          ⚠ Simulation results are outdated. Run simulation to update.
        </div>
      )}

      {/* Phase columns */}
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
        onDragCancel={handleDragCancel}
      >
        <div className="flex gap-3 overflow-x-auto pb-4">
          {phases.map((phase) => (
            <PhaseColumn
              key={phase.phase_id}
              phase={phase}
              pendingLotId={pendingLotId}
              devId={DEV_ID}
              dragSourceDevId={activeLot ? DEV_ID : null}
            />
          ))}
        </div>

        <DragOverlay dropAnimation={null}>
          {activeLot && <LotCard lot={activeLot} isOverlay />}
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
