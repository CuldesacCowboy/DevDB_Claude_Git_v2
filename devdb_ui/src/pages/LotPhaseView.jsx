import { useState, useEffect, useLayoutEffect, useCallback, useRef } from 'react'
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  closestCenter,
  pointerWithin,
} from '@dnd-kit/core'
import { arrayMove, SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable'
import InstrumentContainer, { buildDevColorMap } from '../components/InstrumentContainer'
import ProjectionGroupContainer from '../components/ProjectionGroupContainer'
import UnassignedColumn from '../components/UnassignedColumn'
import PhaseColumn from '../components/PhaseColumn'
import LotCard from '../components/LotCard'
import Toast from '../components/Toast'
import CommunityDevelopmentsView from './CommunityDevelopmentsView'
const LEFT_PANELS_WIDTH = 340 // sidebar + unassigned panel

// TODO: re-enable when simulation run trigger is wired up
const hideOutdatedWarning = true

export default function LotPhaseView() {
  // -----------------------------------------------------------------------
  // Sidebar + community selection
  // -----------------------------------------------------------------------
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [communities, setCommunities] = useState([])
  const [entGroupId, setEntGroupId] = useState(9002)
  const [addingCommunity, setAddingCommunity] = useState(false)
  const [newCommunityName, setNewCommunityName] = useState('')
  const [addCommunityError, setAddCommunityError] = useState('')
  const [renamingId, setRenamingId] = useState(null)
  const [renameValue, setRenameValue] = useState('')
  const [renameError, setRenameError] = useState('')

  // -----------------------------------------------------------------------
  // Lot-phase view data
  // -----------------------------------------------------------------------
  const [entGroup, setEntGroup] = useState(null)
  const [instruments, setInstruments] = useState([])
  const [pgOrder, setPgOrder] = useState([])       // ordered dev_ids for PG containers
  const [unassignedPhases, setUnassignedPhases] = useState([])
  const [unassigned, setUnassigned] = useState([])
  const [loading, setLoading] = useState(true)
  const [fetchError, setFetchError] = useState(null)
  const [devColorMap, setDevColorMap] = useState({})

  // Drag state
  const [activeLot, setActiveLot] = useState(null)
  const [activePhase, setActivePhase] = useState(null)
  const [activeInstrument, setActiveInstrument] = useState(null)
  const [activePg, setActivePg] = useState(null)
  const [activeDragType, setActiveDragType] = useState(null)
  const [pendingLotId, setPendingLotId] = useState(null)
  const [pendingPhaseId, setPendingPhaseId] = useState(null)

  // Toasts
  const [toasts, setToasts] = useState([])
  const toastCounter = useRef(0)

  // Needs-rerun banner
  const [needsRerun, setNeedsRerun] = useState(false)

  // Active tab — default 'developments' (active build area)
  const [activeTab, setActiveTab] = useState('developments')
  const [tabSwitchKey, setTabSwitchKey] = useState(0)

  // Lot-phase view refresh key — increment to re-fetch without tab remount
  const [lotPhaseKey, setLotPhaseKey] = useState(0)

  // Add instrument modal
  const [showAddInstrument, setShowAddInstrument] = useState(false)
  const [newInstrName, setNewInstrName] = useState('')
  const [newInstrType, setNewInstrType] = useState('Plat')
  const [newInstrDevId, setNewInstrDevId] = useState(null)
  const [addInstrError, setAddInstrError] = useState('')
  const [addInstrCreating, setAddInstrCreating] = useState(false)

  // Collapse state — tracks which phase_ids are collapsed
  const [collapsedPhaseIds, setCollapsedPhaseIds] = useState(new Set())

  // Available width for layout engine — recomputed on window resize (debounced 100ms)
  const [availableWidth, setAvailableWidth] = useState(
    () => window.innerWidth - LEFT_PANELS_WIDTH
  )
  useEffect(() => {
    let timer
    function handleResize() {
      clearTimeout(timer)
      timer = setTimeout(() => {
        setAvailableWidth(window.innerWidth - LEFT_PANELS_WIDTH)
      }, 100)
    }
    window.addEventListener('resize', handleResize)
    return () => {
      window.removeEventListener('resize', handleResize)
      clearTimeout(timer)
    }
  }, [])

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } })
  )

  // -----------------------------------------------------------------------
  // Fetch communities list (once on mount)
  // -----------------------------------------------------------------------
  useEffect(() => {
    fetch('/api/entitlement-groups')
      .then((r) => r.json())
      .then((data) => setCommunities(data))
      .catch(() => {})
  }, [])

  // -----------------------------------------------------------------------
  // Fetch lot-phase view whenever entGroupId changes
  // -----------------------------------------------------------------------
  useEffect(() => {
    setLoading(true)
    setFetchError(null)
    setEntGroup(null)
    setInstruments([])
    setPgOrder([])
    setUnassignedPhases([])
    setUnassigned([])
    setNeedsRerun(false)
    setCollapsedPhaseIds(new Set())
    setToasts([])

    fetch(`/api/entitlement-groups/${entGroupId}/lot-phase-view`)
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        return r.json()
      })
      .then((data) => {
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

        const allDevIds = instruments.map((i) => i.dev_id)
        setDevColorMap(buildDevColorMap(allDevIds))
        setPgOrder([...new Set(allDevIds)])

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
  }, [entGroupId, lotPhaseKey])

  // -----------------------------------------------------------------------
  // Add community handlers
  // -----------------------------------------------------------------------
  async function confirmAddCommunity() {
    const name = newCommunityName.trim()
    if (!name) return
    setAddCommunityError('')
    try {
      const res = await fetch('/api/entitlement-groups', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ent_group_name: name }),
      })
      const data = await res.json()
      if (res.ok) {
        setCommunities((prev) => [...prev, data])
        setEntGroupId(data.ent_group_id)
        setAddingCommunity(false)
        setNewCommunityName('')
        setAddCommunityError('')
      } else {
        setAddCommunityError(data?.detail ?? 'Failed to create community')
      }
    } catch {
      setAddCommunityError('Network error')
    }
  }

  function cancelAddCommunity() {
    setAddingCommunity(false)
    setNewCommunityName('')
    setAddCommunityError('')
  }

  function openAddInstrument() {
    setNewInstrName('')
    setNewInstrType('Plat')
    setNewInstrDevId(pgGroups[0]?.devId ?? null)
    setAddInstrError('')
    setShowAddInstrument(true)
  }

  async function handleCreateInstrument() {
    const name = newInstrName.trim()
    if (!name) { setAddInstrError('Instrument name is required'); return }
    if (!newInstrDevId) { setAddInstrError('Select a development'); return }
    setAddInstrCreating(true)
    setAddInstrError('')
    try {
      const res = await fetch('/api/instruments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ instrument_name: name, instrument_type: newInstrType, dev_id: newInstrDevId }),
      })
      const data = await res.json()
      if (res.ok) {
        setShowAddInstrument(false)
        setLotPhaseKey((k) => k + 1)
      } else {
        setAddInstrError(data?.detail ?? 'Create failed')
      }
    } catch (err) {
      setAddInstrError(`Network error: ${err.message}`)
    } finally {
      setAddInstrCreating(false)
    }
  }

  function startRename(c, e) {
    e.stopPropagation()
    setRenamingId(c.ent_group_id)
    setRenameValue(c.ent_group_name)
    setRenameError('')
  }

  function cancelRename() {
    setRenamingId(null)
    setRenameValue('')
    setRenameError('')
  }

  async function confirmRename(id) {
    const name = renameValue.trim()
    if (!name) return
    try {
      const res = await fetch(`/api/entitlement-groups/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ent_group_name: name }),
      })
      const data = await res.json()
      if (res.ok) {
        setCommunities((prev) =>
          prev.map((c) => (c.ent_group_id === id ? { ...c, ent_group_name: name } : c))
        )
        setRenamingId(null)
        setRenameValue('')
        setRenameError('')
      } else {
        setRenameError(data?.detail ?? 'Rename failed')
      }
    } catch {
      setRenameError('Network error')
    }
  }

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
  // Derived: PG groups for rendering
  // -----------------------------------------------------------------------
  const pgGroups = pgOrder.map((devId) => {
    const devInstrs = instruments.filter((i) => i.dev_id === devId)
    const devName = devInstrs[0]?.dev_name ?? `Dev ${devId}`
    return { devId, devName, instruments: devInstrs }
  })

  // Per-row dev container height equalization + solo-dev detection.
  // After render, group containers by top position, equalize heights per row,
  // and track which dev containers are alone on their row (for wider layout).
  // Placed here (after pgGroups) so pgGroups is in scope for the dep array.
  const pgWrapperRef = useRef(null)
  const [soloDevIds, setSoloDevIds] = useState(new Set())
  useLayoutEffect(() => {
    if (!pgWrapperRef.current) return
    const containers = Array.from(pgWrapperRef.current.children)
    // Reset all heights first so natural sizes drive row grouping
    containers.forEach(el => { el.style.height = '' })
    // Group by top position (within 10px tolerance for sub-pixel variation)
    const rows = []
    containers.forEach(el => {
      const top = el.getBoundingClientRect().top
      const row = rows.find(r => Math.abs(r.top - top) < 10)
      if (row) row.els.push(el)
      else rows.push({ top, els: [el] })
    })
    // Equalize row heights
    rows.forEach(row => {
      const maxH = Math.max(...row.els.map(el => el.getBoundingClientRect().height))
      row.els.forEach(el => { el.style.height = maxH + 'px' })
    })
    // Track which devs are alone on their row so they get wider layout
    const newSoloIds = new Set(
      rows.filter(r => r.els.length === 1).map(r => r.els[0].dataset.devId)
    )
    setSoloDevIds(prev => {
      // Avoid unnecessary re-renders: only update if the set changed
      if (newSoloIds.size === prev.size && [...newSoloIds].every(id => prev.has(id))) return prev
      return newSoloIds
    })
  }, [pgGroups, availableWidth, collapsedPhaseIds])

  // -----------------------------------------------------------------------
  // Render
  // -----------------------------------------------------------------------
  const activeEntGroupName =
    entGroup?.ent_group_name ??
    communities.find((c) => c.ent_group_id === entGroupId)?.ent_group_name ??
    `Group ${entGroupId}`

  return (
    <div className="flex h-screen overflow-hidden font-sans">

      {/* ---------------------------------------------------------------- */}
      {/* Toggle button — fixed top-left, always visible                   */}
      {/* ---------------------------------------------------------------- */}
      <button
        onClick={() => setSidebarOpen((v) => !v)}
        className="fixed top-2 left-2 z-50 flex items-center justify-center w-7 h-7 rounded bg-white border border-gray-200 shadow-sm text-gray-500 hover:text-gray-800 hover:bg-gray-50 text-base leading-none select-none"
        title={sidebarOpen ? 'Close sidebar' : 'Open sidebar'}
      >
        {sidebarOpen ? '☰' : '›'}
      </button>

      {/* ---------------------------------------------------------------- */}
      {/* Sidebar                                                          */}
      {/* ---------------------------------------------------------------- */}
      <div
        style={{
          width: sidebarOpen ? 220 : 12,
          transition: 'width 0.2s ease',
          flexShrink: 0,
          cursor: sidebarOpen ? 'default' : 'pointer',
        }}
        className="bg-white border-r border-gray-200 overflow-hidden h-screen flex flex-col"
        onClick={!sidebarOpen ? () => setSidebarOpen(true) : undefined}
      >
        {/* Inner content always 220px wide — overflow is clipped by parent */}
        <div style={{ width: 220, pointerEvents: sidebarOpen ? 'auto' : 'none' }} className="flex flex-col h-full">
          <div className="pt-10 px-3 pb-4 overflow-y-auto flex-1">
            <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider mb-2 px-2">
              Communities
            </p>
            {communities.length === 0 ? (
              <p className="text-[11px] text-gray-400 italic px-2">Loading…</p>
            ) : (
              communities.map((c) => (
                <div key={c.ent_group_id} className="mb-0.5">
                  {renamingId === c.ent_group_id ? (
                    <div className="px-1">
                      <input
                        autoFocus
                        type="text"
                        value={renameValue}
                        onChange={(e) => setRenameValue(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') confirmRename(c.ent_group_id)
                          if (e.key === 'Escape') cancelRename()
                        }}
                        onBlur={() => cancelRename()}
                        className="w-full text-sm border border-blue-400 rounded px-2 py-1 focus:outline-none"
                      />
                      {renameError && (
                        <p className="text-[11px] text-red-600 mt-0.5 px-1">{renameError}</p>
                      )}
                    </div>
                  ) : (
                    <button
                      onClick={(e) => { e.stopPropagation(); setEntGroupId(c.ent_group_id) }}
                      onDoubleClick={(e) => startRename(c, e)}
                      className={`block w-full text-left text-sm px-2 py-1.5 rounded transition-colors ${
                        c.ent_group_id === entGroupId
                          ? 'font-medium text-gray-900 bg-gray-100'
                          : 'font-normal text-gray-600 hover:bg-gray-50'
                      }`}
                    >
                      {c.ent_group_name}
                    </button>
                  )}
                </div>
              ))
            )}

            {/* Add community inline form */}
            {addingCommunity ? (
              <div className="px-1 mt-2">
                <input
                  autoFocus
                  type="text"
                  value={newCommunityName}
                  onChange={(e) => setNewCommunityName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') confirmAddCommunity()
                    if (e.key === 'Escape') cancelAddCommunity()
                  }}
                  placeholder="Community name"
                  className="w-full text-sm border border-gray-300 rounded px-2 py-1 focus:outline-none focus:border-blue-400"
                />
                <div className="flex gap-1 mt-1">
                  <button
                    onClick={confirmAddCommunity}
                    disabled={!newCommunityName.trim()}
                    className="flex-1 text-xs bg-blue-500 text-white rounded px-2 py-1 hover:bg-blue-600 disabled:opacity-40"
                  >
                    Add
                  </button>
                  <button
                    onClick={cancelAddCommunity}
                    className="text-xs text-gray-500 rounded px-2 py-1 hover:bg-gray-100"
                  >
                    Cancel
                  </button>
                </div>
                {addCommunityError && (
                  <p className="text-[11px] text-red-600 mt-1 px-1">{addCommunityError}</p>
                )}
              </div>
            ) : (
              <button
                onClick={() => setAddingCommunity(true)}
                className="mt-2 w-full text-left text-xs text-gray-400 hover:text-gray-600 hover:bg-gray-50 rounded px-2 py-1"
              >
                + Add community
              </button>
            )}
          </div>
        </div>
      </div>

      {/* ---------------------------------------------------------------- */}
      {/* Tab shell — tab bar + conditional content                       */}
      {/* ---------------------------------------------------------------- */}
      <div className="flex flex-col flex-1 overflow-hidden">

        {/* Tab bar */}
        <div className="flex-shrink-0 flex items-end gap-0 border-b border-gray-200 bg-white px-4">
          {[
            { id: 'developments', label: 'Developments' },
            { id: 'lot-phase', label: 'Legal Instruments' },
          ].map(({ id, label }) => (
            <button
              key={id}
              onClick={() => { setActiveTab(id); setTabSwitchKey((k) => k + 1) }}
              className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors select-none ${
                activeTab === id
                  ? 'border-blue-500 text-blue-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {activeTab === 'developments' ? (
          <CommunityDevelopmentsView
            key={tabSwitchKey}
            entGroupId={entGroupId}
            onOpenLotPhase={(id) => {
              setEntGroupId(id)
              setActiveTab('lot-phase')
              setTabSwitchKey((k) => k + 1)
            }}
          />
        ) : (
      <DndContext key={tabSwitchKey}
        sensors={sensors}
        collisionDetection={customCollision}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
        onDragCancel={handleDragCancel}
      >
        <div className="flex flex-1 overflow-hidden">

          {/* -------------------------------------------------------------- */}
          {/* Left column — Unassigned Lots (top) + No Instrument (bottom)   */}
          {/* -------------------------------------------------------------- */}
          <div
            style={{ width: 168, flexShrink: 0 }}
            className="h-full flex flex-col border-r border-gray-200 overflow-hidden"
          >
            <div className="flex-1 min-h-0">
              <UnassignedColumn lots={unassigned} pendingLotId={pendingLotId} />
            </div>
            <div className="flex-1 min-h-0 overflow-auto border-t border-gray-200">
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
          </div>

          {/* -------------------------------------------------------------- */}
          {/* Main scrollable area                                            */}
          {/* -------------------------------------------------------------- */}
          <div className="flex-1 overflow-auto bg-slate-50 p-4">

            {loading && (
              <div className="flex items-center justify-center min-h-[calc(100vh-2rem)] text-gray-500">
                Loading…
              </div>
            )}

            {fetchError && (
              <div className="flex items-center justify-center min-h-[calc(100vh-2rem)] text-red-600">
                Failed to load: {fetchError}
              </div>
            )}

            {!loading && !fetchError && (
              <>
                {/* Header */}
                <div className="mb-4 flex items-start justify-between gap-4 pl-2">
                  <div className="min-w-0">
                    <h1 className="text-xl font-bold text-gray-900 truncate">
                      Lot → Phase &nbsp;|&nbsp; {activeEntGroupName}
                    </h1>
                    <p className="text-sm text-gray-500 mt-0.5">
                      Drag lot cards to reassign. Drag phase headers (⠿) to reassign instrument.
                    </p>
                  </div>
                  <div className="flex gap-2 flex-shrink-0">
                    <button
                      onClick={openAddInstrument}
                      className="rounded border border-gray-200 bg-white px-3 py-1 text-xs text-gray-600 hover:bg-gray-50"
                    >
                      + Add instrument
                    </button>
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

                {/* Needs-rerun banner — hidden until simulation trigger is wired */}
                {!hideOutdatedWarning && needsRerun && (
                  <div className="mb-4 rounded-lg border border-amber-300 bg-amber-50 px-4 py-2 text-sm text-amber-800 font-medium">
                    ⚠ Simulation results are outdated. Run simulation to update.
                  </div>
                )}

                {/* PG containers + No-instrument container */}
                <SortableContext
                  items={pgOrder.map((id) => `pg-${id}`)}
                  strategy={verticalListSortingStrategy}
                >
                  <div ref={pgWrapperRef} className="flex flex-wrap gap-4 p-4 items-start">
                    {pgGroups.map((group) => {
                      const isSolo = soloDevIds.has(String(group.devId))
                      const effectiveWidth = isSolo
                        ? (pgWrapperRef.current?.clientWidth ?? availableWidth) - 32
                        : availableWidth
                      return (
                        <ProjectionGroupContainer
                          key={group.devId}
                          devId={group.devId}
                          devName={group.devName}
                          instruments={group.instruments}
                          tint={devColorMap[group.devId]}
                          pendingLotId={pendingLotId}
                          pendingPhaseId={pendingPhaseId}
                          activeDragType={activeDragType}
                          collapsedPhaseIds={collapsedPhaseIds}
                          onToggleCollapse={togglePhaseCollapse}
                          onAutoSort={handleAutoSort}
                          availableWidth={effectiveWidth}
                          relaxCap={isSolo && group.instruments.length === 1}
                        />
                      )
                    })}

                  </div>
                </SortableContext>
              </>
            )}
          </div>
        </div>

        <DragOverlay dropAnimation={null}>
          {activeLot && <LotCard lot={activeLot} isOverlay />}
          {activePhase && <PhaseColumn phase={activePhase} isOverlay />}
          {activeDragType === 'instrument' && activeInstrument && (
            <div
              className={`rounded-lg border-2 px-3 py-2 text-xs font-semibold shadow-lg ${devColorMap[activeInstrument.dev_id]?.border ?? 'border-gray-200'} ${devColorMap[activeInstrument.dev_id]?.bg ?? 'bg-white'} ${devColorMap[activeInstrument.dev_id]?.text ?? 'text-gray-700'}`}
            >
              {activeInstrument.instrument_name}
            </div>
          )}
          {activeDragType === 'projection-group' && activePg != null && (
            <div
              className={`rounded-xl border-2 px-3 py-2 text-xs font-bold shadow-lg ${devColorMap[activePg]?.border ?? 'border-gray-200'} ${devColorMap[activePg]?.bg ?? 'bg-gray-50'} ${devColorMap[activePg]?.text ?? 'text-gray-700'}`}
            >
              {instruments.find((i) => i.dev_id === activePg)?.dev_name ?? `Dev ${activePg}`}
            </div>
          )}
        </DragOverlay>
      </DndContext>
        )}
      </div>

      {/* Add instrument modal */}
      {showAddInstrument && (
        <div
          style={{ position: 'fixed', inset: 0, zIndex: 50, background: 'rgba(0,0,0,0.35)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          onClick={() => setShowAddInstrument(false)}
        >
          <div
            style={{ background: 'white', borderRadius: 10, padding: '24px', width: 380, boxShadow: '0 8px 32px rgba(0,0,0,0.18)' }}
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="text-base font-semibold text-gray-800 mb-4">Add instrument</h2>
            <div className="flex flex-col gap-3">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Instrument name</label>
                <input
                  autoFocus
                  type="text"
                  value={newInstrName}
                  onChange={(e) => setNewInstrName(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') handleCreateInstrument(); if (e.key === 'Escape') setShowAddInstrument(false) }}
                  className="w-full text-sm border border-gray-300 rounded px-2 py-1.5 focus:outline-none focus:border-blue-400"
                  placeholder="e.g. Waterton North Plat"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Instrument type</label>
                <select
                  value={newInstrType}
                  onChange={(e) => setNewInstrType(e.target.value)}
                  className="w-full text-sm border border-gray-300 rounded px-2 py-1.5 focus:outline-none focus:border-blue-400"
                >
                  {['Plat', 'Site Condo', 'Condo Declaration', 'Other'].map((t) => (
                    <option key={t} value={t}>{t}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Development</label>
                <select
                  value={newInstrDevId ?? ''}
                  onChange={(e) => setNewInstrDevId(Number(e.target.value))}
                  className="w-full text-sm border border-gray-300 rounded px-2 py-1.5 focus:outline-none focus:border-blue-400"
                >
                  {pgGroups.map((g) => (
                    <option key={g.devId} value={g.devId}>{g.devName}</option>
                  ))}
                </select>
              </div>
              {addInstrError && (
                <p className="text-xs text-red-600">{addInstrError}</p>
              )}
              <div className="flex gap-2 justify-end mt-1">
                <button
                  onClick={() => setShowAddInstrument(false)}
                  className="rounded border border-gray-200 bg-white px-3 py-1.5 text-xs text-gray-600 hover:bg-gray-50"
                >
                  Cancel
                </button>
                <button
                  onClick={handleCreateInstrument}
                  disabled={addInstrCreating}
                  className="rounded bg-blue-500 text-white px-3 py-1.5 text-xs font-medium hover:bg-blue-600 disabled:opacity-40"
                >
                  {addInstrCreating ? 'Creating…' : 'Create'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Toast stack — lot-phase tab only */}
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

// Phase drags: pointerWithin first so hovering anywhere inside a container or
// phase column registers correctly. Falls back to closestCenter when the pointer
// is in empty space (no droppable under it), preventing "lost" drops.
// Lot drags: filter to only lot-target and unassigned droppables so sortable
// phase-header-* items (type='phase') never win the collision and silently swallow the drop.
// Instrument drags: filter to instrument and pg-target droppables only.
// PG drags: filter to projection-group droppables only.
function customCollision(args) {
  const activeType = args.active?.data?.current?.type
  if (activeType === 'phase') {
    const result = pointerWithin(args)
    return result.length > 0 ? result : closestCenter(args)
  }
  if (activeType === 'lot') {
    const lotArgs = {
      ...args,
      droppableContainers: args.droppableContainers.filter(
        (c) => c.data?.current?.type === 'lot-target' || c.data?.current?.type === 'unassigned'
      ),
    }
    const result = pointerWithin(lotArgs)
    return result.length > 0 ? result : closestCenter(lotArgs)
  }
  if (activeType === 'instrument') {
    const instrArgs = {
      ...args,
      droppableContainers: args.droppableContainers.filter(
        (c) => c.data?.current?.type === 'instrument' || c.data?.current?.type === 'pg-target'
      ),
    }
    const result = pointerWithin(instrArgs)
    return result.length > 0 ? result : closestCenter(instrArgs)
  }
  if (activeType === 'projection-group') {
    const pgArgs = {
      ...args,
      droppableContainers: args.droppableContainers.filter(
        (c) => c.data?.current?.type === 'projection-group'
      ),
    }
    return closestCenter(pgArgs)
  }
  return closestCenter(args)
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
