import { useState, useRef, useLayoutEffect, useCallback } from 'react'
import { useDroppable } from '@dnd-kit/core'
import { SortableContext, rectSortingStrategy, useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import PhaseColumn from './PhaseColumn'
import { computeCols } from '../utils/computeCols'

// Color tints cycle by dev_id across the ent_group.
const DEV_TINTS = [
  { border: 'border-blue-300',   bg: 'bg-blue-100',  header: 'bg-blue-200',   text: 'text-blue-800' },
  { border: 'border-teal-200',   bg: 'bg-teal-50',   header: 'bg-teal-100',   text: 'text-teal-800' },
  { border: 'border-violet-200', bg: 'bg-violet-50', header: 'bg-violet-100', text: 'text-violet-800' },
  { border: 'border-green-200',  bg: 'bg-green-50',  header: 'bg-green-100',  text: 'text-green-800' },
]

// Map sorted unique dev_ids to tint index so color is stable across re-renders.
export function buildDevColorMap(devIds) {
  const sorted = [...new Set(devIds)].sort((a, b) => a - b)
  const map = {}
  sorted.forEach((id, idx) => {
    map[id] = DEV_TINTS[idx % DEV_TINTS.length]
  })
  return map
}

// instrument = null → "No instrument" container
export default function InstrumentContainer({
  instrument,
  phases,           // phases array (for null instrument case, comes from parent)
  tint,
  pendingLotId,
  pendingPhaseId,
  activeDragType,
  collapsedPhaseIds,
  onToggleCollapse,
  onAutoSort,       // (instrumentId: number) => void — called by auto-sort button
  availableWidth,   // px — passed from LotPhaseView via ProjectionGroupContainer
  relaxCap,         // true when this dev is alone on its row — skip sqrt col cap
  onRefetch,        // () => void — triggers full data reload after mutations
  onProjectedSaved, // (phaseId, lotTypeId, projected, total) => void — cascade totals
}) {
  const [countsExpanded, setCountsExpanded] = useState(false)

  // Feature: add phase
  const [showAddPhase, setShowAddPhase] = useState(false)
  const [newPhaseName, setNewPhaseName] = useState('')
  const [addPhaseError, setAddPhaseError] = useState('')
  const [addPhaseSaving, setAddPhaseSaving] = useState(false)

  const isNoInstrument = instrument === null
  const droppableId = isNoInstrument ? 'instrument-null' : `instrument-${instrument.instrument_id}`
  const phasesData = isNoInstrument ? phases : instrument.phases

  // Aggregate lot type totals across all phases (real instruments only)
  const instrLotTypeTotals = (() => {
    if (isNoInstrument) return []
    const byTypeMap = {}
    for (const phase of phasesData) {
      for (const lt of phase.by_lot_type) {
        if (!byTypeMap[lt.lot_type_id]) {
          byTypeMap[lt.lot_type_id] = { lot_type_id: lt.lot_type_id, lot_type_short: lt.lot_type_short, actual: 0, projected: 0, total: 0 }
        }
        byTypeMap[lt.lot_type_id].actual    += lt.actual
        byTypeMap[lt.lot_type_id].projected += lt.projected
        byTypeMap[lt.lot_type_id].total     += lt.total
      }
    }
    return Object.values(byTypeMap)
  })()
  const instrTotalActual    = instrLotTypeTotals.reduce((s, lt) => s + lt.actual, 0)
  const instrTotalProjected = instrLotTypeTotals.reduce((s, lt) => s + lt.projected, 0)
  const instrTotalTotal     = instrLotTypeTotals.reduce((s, lt) => s + lt.total, 0)

  // Compute optimal column count so CSS flex-wrap produces the shortest layout.
  // expanded = true unless every phase is individually collapsed.
  const allCollapsed =
    phasesData.length > 0 && phasesData.every((p) => collapsedPhaseIds?.has(p.phase_id))
  const _colResult =
    !isNoInstrument && availableWidth && phasesData.length > 0
      ? computeCols(
          phasesData.length,
          availableWidth,
          !allCollapsed,
          phasesData.map((p) => ({ lotCount: p.lots?.length ?? 0 })),
          relaxCap ?? false
        )
      : null
  const instrCols = _colResult?.cols ?? null
  const instrWidth = _colResult?.width ?? null

  const gridRef = useRef(null)
  useLayoutEffect(() => {
    if (!gridRef.current || !instrCols) return
    const cells = Array.from(gridRef.current.children)
    // Reset heights so natural content sizes drive measurement
    cells.forEach((c) => { c.style.height = '' })
    requestAnimationFrame(() => {
      if (!gridRef.current) return
      for (let col = 0; col < instrCols; col++) {
        const colCells = cells.filter((_, i) => i % instrCols === col)
        if (colCells.length === 0) continue
        const maxH = Math.max(...colCells.map((c) => c.getBoundingClientRect().height))
        colCells.forEach((c) => { c.style.height = maxH + 'px' })
      }
    })
  }, [instrCols, phasesData.length, collapsedPhaseIds])

  // Droppable: instrument container body → receives phase cards
  const { isOver, setNodeRef: setDropRef } = useDroppable({
    id: droppableId,
    data: {
      type: 'instrument-target',
      instrumentId: isNoInstrument ? null : instrument.instrument_id,
      instrumentName: isNoInstrument ? 'No instrument' : instrument.instrument_name,
    },
  })

  // Sortable: instrument can be dragged to reorder within its PG or move to another PG
  const {
    attributes: instrAttrs,
    listeners: instrListeners,
    setNodeRef: setInstrSortRef,
    transform: instrTransform,
    transition: instrTransition,
    isDragging: isInstrDragging,
  } = useSortable({
    id: isNoInstrument ? 'instrument-sortable-null' : `instrument-sortable-${instrument.instrument_id}`,
    data: {
      type: 'instrument',
      instrumentId: isNoInstrument ? null : instrument.instrument_id,
      devId: isNoInstrument ? null : instrument.dev_id,
    },
    disabled: isNoInstrument,
  })

  function setOuterRef(el) {
    setInstrSortRef(el)
    setDropRef(el)
  }

  const showPhaseDropHighlight = isOver && activeDragType === 'phase'

  const containerTint = isNoInstrument
    ? { border: 'border-gray-300', bg: 'bg-gray-50', header: 'bg-gray-100', text: 'text-gray-700' }
    : tint

  function openAddPhase() {
    const nextN = phasesData.length + 1
    setNewPhaseName(`${instrument?.dev_name ?? ''} ph. ${nextN}`.trim())
    setAddPhaseError('')
    setShowAddPhase(true)
  }

  async function handleAddPhase() {
    const name = newPhaseName.trim()
    if (!name) { setAddPhaseError('Phase name is required'); return }
    setAddPhaseSaving(true)
    setAddPhaseError('')
    try {
      const res = await fetch('/api/phases', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ instrument_id: instrument.instrument_id, phase_name: name }),
      })
      const data = await res.json()
      if (res.ok) {
        setShowAddPhase(false)
        onRefetch?.()
      } else {
        setAddPhaseError(data?.detail ?? 'Create failed')
      }
    } catch (err) {
      setAddPhaseError(`Network error: ${err.message}`)
    } finally {
      setAddPhaseSaving(false)
    }
  }

  // SortableContext items for intra-instrument phase reorder.
  // Only used for real instruments (null instrument not supported for persist).
  const sortableIds = isNoInstrument
    ? []
    : phasesData.map((p) => `phase-header-${p.phase_id}`)

  const phaseColumns = phasesData.map((phase) => (
    <PhaseColumn
      key={phase.phase_id}
      phase={phase}
      pendingLotId={pendingLotId}
      pendingPhaseId={pendingPhaseId}
      isCollapsed={collapsedPhaseIds?.has(phase.phase_id) ?? false}
      onToggleCollapse={() => onToggleCollapse?.(phase.phase_id)}
      onRefetch={onRefetch}
      onProjectedSaved={onProjectedSaved}
    />
  ))

  return (
    <div
      ref={setOuterRef}
      className={`
        flex flex-col rounded-xl border-2 transition-colors duration-100
        ${containerTint.bg}
        ${showPhaseDropHighlight ? 'border-blue-400 border-dashed' : containerTint.border}
        ${isNoInstrument ? 'border-dashed' : ''}
        ${isInstrDragging ? 'opacity-30' : ''}
      `}
      style={{
        flex: '0 0 auto',
        width: instrWidth != null ? instrWidth + 'px' : 'fit-content',
        transform: CSS.Transform.toString(instrTransform),
        transition: instrTransition,
      }}
    >
      {/* Container header */}
      <div className={`px-3 py-2 rounded-t-xl border-b ${containerTint.border} ${containerTint.header}`}>
        {isNoInstrument ? (
          <>
            <p className="font-bold text-sm text-gray-700">No Instrument</p>
            <p className="text-[11px] text-gray-400 mt-0.5">
              {phasesData.length} phase{phasesData.length !== 1 ? 's' : ''}
            </p>
          </>
        ) : (
          <div className="flex flex-col gap-0.5">
            <div className="relative flex items-center justify-center gap-2">
              {/* Instrument drag handle */}
              <span
                {...instrListeners}
                {...instrAttrs}
                className="absolute left-0 text-gray-300 text-[10px] leading-none flex-shrink-0 cursor-grab active:cursor-grabbing select-none"
                aria-hidden
              >
                ⠿
              </span>

              <p className={`font-bold text-sm ${containerTint.text} break-words min-w-0`}>{instrument.instrument_name}</p>
              <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded flex-shrink-0 ${containerTint.header} border ${containerTint.border} ${containerTint.text}`}>
                {instrument.instrument_type}
              </span>

              {/* Right-side controls: add phase + auto-sort */}
              <div className="absolute right-0 flex items-center gap-0.5">
                <button
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={openAddPhase}
                  className="flex-shrink-0 px-1 py-0.5 rounded text-[10px] font-medium text-gray-500 hover:text-gray-800 hover:bg-white/60 border border-transparent hover:border-gray-200 leading-none"
                  title="Add phase"
                  aria-label="Add phase"
                >
                  + phase
                </button>
                {/* Auto-sort button — sorts phases alphabetically by prefix, then by ph. N */}
                <button
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={() => onAutoSort?.(instrument.instrument_id)}
                  className="flex-shrink-0 p-0.5 rounded text-gray-400 hover:text-gray-600 hover:bg-white/60"
                  title="Auto-sort phases"
                  aria-label="Auto-sort phases"
                >
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M3 6h18M7 12h10M11 18h2"/>
                  </svg>
                </button>
              </div>
            </div>

            {/* Aggregated counts — total line clickable to expand per-type breakdown */}
            <div>
              <button
                onPointerDown={(e) => e.stopPropagation()}
                onClick={() => setCountsExpanded((v) => !v)}
                className="w-full text-[11px] text-gray-500 text-center leading-snug whitespace-nowrap hover:text-gray-700"
                title={countsExpanded ? 'Hide by type' : 'Show by type'}
              >
                <span className="font-medium text-gray-700">{instrTotalActual}</span>r{' '}
                /<span className="font-medium text-gray-700"> {instrTotalProjected}</span>p{' '}
                /<span className="font-medium text-gray-700"> {instrTotalTotal}</span>t
              </button>
              {countsExpanded && (
                <div className="mt-1 space-y-0.5">
                  {instrLotTypeTotals.map((lt) => (
                    <p key={lt.lot_type_id} className="text-[10px] text-gray-400 text-center leading-snug whitespace-nowrap">
                      <span className="text-gray-500 mr-1">{lt.lot_type_short ?? `t${lt.lot_type_id}`}</span>
                      <span className="font-medium text-gray-600">{lt.actual}</span>r{' '}
                      /<span className="font-medium text-gray-600"> {lt.projected}</span>p{' '}
                      /<span className="font-medium text-gray-600"> {lt.total}</span>t
                    </p>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Add phase inline form */}
      {!isNoInstrument && showAddPhase && (
        <div
          className="mx-2 mt-2 border border-blue-200 rounded bg-blue-50 p-2 flex flex-col gap-1.5"
          onPointerDown={(e) => e.stopPropagation()}
        >
          <input
            autoFocus
            type="text"
            value={newPhaseName}
            onChange={(e) => setNewPhaseName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleAddPhase()
              if (e.key === 'Escape') setShowAddPhase(false)
            }}
            placeholder="Phase name"
            className="w-full text-[11px] border border-gray-300 rounded px-2 py-1 focus:outline-none focus:border-blue-400 bg-white"
          />
          {addPhaseError && (
            <p className="text-[11px] text-red-600">{addPhaseError}</p>
          )}
          <div className="flex gap-1 justify-end">
            <button
              onClick={() => setShowAddPhase(false)}
              className="text-[11px] px-2 py-0.5 rounded border border-gray-200 text-gray-500 hover:bg-gray-100"
            >
              Cancel
            </button>
            <button
              onClick={handleAddPhase}
              disabled={addPhaseSaving}
              className="text-[11px] px-2 py-0.5 rounded bg-blue-500 text-white hover:bg-blue-600 disabled:opacity-40"
            >
              {addPhaseSaving ? 'Adding…' : 'Add phase'}
            </button>
          </div>
        </div>
      )}

      {/* Phase columns — explicit rows so CSS flex:1 distributes instrument height evenly */}
      {phasesData.length > 0 ? (
        isNoInstrument || instrCols == null ? (
          // No-instrument or fallback: plain flex-wrap
          <div className="flex flex-wrap gap-2 p-2 items-start">
            {phaseColumns}
          </div>
        ) : (
          // Real instrument: CSS grid — columns equal-width, rows auto-sized to content
          <div ref={gridRef} style={{ display: 'grid', gridTemplateColumns: `repeat(${instrCols}, 1fr)`, gridAutoRows: 'auto', gap: 8, padding: 8 }}>
            <SortableContext items={sortableIds} strategy={rectSortingStrategy}>
              {phaseColumns}
            </SortableContext>
          </div>
        )
      ) : (
        <div className="flex items-center justify-center min-h-[80px]" style={{ width: 160 }}>
          <p className="text-[11px] text-gray-400 italic">
            {showPhaseDropHighlight ? 'Drop phase here' : 'No phases'}
          </p>
        </div>
      )}
    </div>
  )
}
