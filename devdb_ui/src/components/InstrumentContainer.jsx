import { useState, useEffect, useRef } from 'react'
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
  onAutoSort,     // (instrumentId: number) => void — called by auto-sort button
  availableWidth, // px — passed from LotPhaseView via ProjectionGroupContainer
}) {
  const [countsExpanded, setCountsExpanded] = useState(false)
  const phaseRowRef = useRef(null)
  const outerRef = useRef(null)

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
  const instrWidth =
    !isNoInstrument && availableWidth && phasesData.length > 0
      ? computeCols(
          phasesData.length,
          availableWidth,
          !allCollapsed,
          phasesData.map((p) => ({ lotCount: p.lots?.length ?? 0 }))
        ).width
      : null

  // After render, measure the actual phase row width and snap the band to it.
  // This corrects for sub-pixel border/gap rendering that formula-based widths miss.
  useEffect(() => {
    if (!phaseRowRef.current || !outerRef.current) return

    const pills = Array.from(phaseRowRef.current.children)
    if (pills.length === 0) return

    // Measure one pill's actual rendered width
    const pillW = pills[0].getBoundingClientRect().width

    // Measure actual gap between pill 0 and pill 1 (if exists)
    const gap = pills.length > 1
      ? pills[1].getBoundingClientRect().left - pills[0].getBoundingClientRect().right
      : parseFloat(window.getComputedStyle(phaseRowRef.current).gap) || 8

    // Measure phase row padding
    const rowStyle = window.getComputedStyle(phaseRowRef.current)
    const padH = parseFloat(rowStyle.paddingLeft) + parseFloat(rowStyle.paddingRight)

    // Measure band border
    const bandStyle = window.getComputedStyle(outerRef.current)
    const borderH = parseFloat(bandStyle.borderLeftWidth) + parseFloat(bandStyle.borderRightWidth)

    // Back-calculate cols from the instrWidth computeCols chose
    const cols = Math.round((instrWidth - padH - borderH + gap) / (pillW + gap))

    // Exact width for cols pills using real measurements
    const exactW = cols * pillW + (cols - 1) * gap + padH + borderH

    outerRef.current.style.width = exactW + 'px'

  }, [instrWidth, phasesData.length])

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
    outerRef.current = el
    setInstrSortRef(el)
    setDropRef(el)
  }

  const showPhaseDropHighlight = isOver && activeDragType === 'phase'

  const containerTint = isNoInstrument
    ? { border: 'border-gray-300', bg: 'bg-gray-50', header: 'bg-gray-100', text: 'text-gray-700' }
    : tint

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
          <p className="font-semibold text-sm text-gray-500 italic whitespace-nowrap">No instrument assigned</p>
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

              <p className={`font-bold text-sm ${containerTint.text} whitespace-nowrap`}>{instrument.instrument_name}</p>
              <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded flex-shrink-0 ${containerTint.header} border ${containerTint.border} ${containerTint.text}`}>
                {instrument.instrument_type}
              </span>

              {/* Auto-sort button — sorts phases alphabetically by prefix, then by ph. N */}
              <button
                onPointerDown={(e) => e.stopPropagation()}
                onClick={() => onAutoSort?.(instrument.instrument_id)}
                className="absolute right-0 flex-shrink-0 p-0.5 rounded text-gray-400 hover:text-gray-600 hover:bg-white/60"
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

      {/* Phase columns — wrap to new rows when phases don't fit */}
      <div ref={phaseRowRef} className="flex flex-wrap gap-2 p-2 items-start">
        {phasesData.length > 0 ? (
          isNoInstrument ? (
            phaseColumns
          ) : (
            <SortableContext items={sortableIds} strategy={rectSortingStrategy}>
              {phaseColumns}
            </SortableContext>
          )
        ) : (
          <div className="flex items-center justify-center min-h-[80px]" style={{ width: 160 }}>
            <p className="text-[11px] text-gray-400 italic">
              {showPhaseDropHighlight ? 'Drop phase here' : 'No phases'}
            </p>
          </div>
        )}
      </div>
    </div>
  )
}
