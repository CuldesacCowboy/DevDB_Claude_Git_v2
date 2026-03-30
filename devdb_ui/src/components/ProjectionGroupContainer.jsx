import { useState } from 'react'
import { useDroppable } from '@dnd-kit/core'
import { SortableContext, rectSortingStrategy, useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import InstrumentContainer from './InstrumentContainer'

// Groups all legal instruments belonging to one dev_id (projection group).
// The container itself is sortable (type='projection-group') so PGs can be reordered.
// Its instruments are in a SortableContext for intra-PG instrument reorder.
export default function ProjectionGroupContainer({
  devId,
  devName,
  instruments,
  tint,
  pendingLotId,
  pendingPhaseId,
  activeDragType,
  collapsedPhaseIds,
  onToggleCollapse,
  onAutoSort,
  availableWidth,
  relaxCap,
  onRefetch,
  onProjectedSaved,
}) {
  // PG-level sortable — drag handle on the PG header to reorder among all PGs
  const {
    attributes,
    listeners,
    setNodeRef: setSortRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: `pg-${devId}`,
    data: { type: 'projection-group', devId },
  })

  // PG is also a droppable so instruments can be dragged into it from another PG
  const { isOver, setNodeRef: setDropRef } = useDroppable({
    id: `pg-drop-${devId}`,
    data: { type: 'pg-target', devId },
  })

  function setRef(el) {
    setSortRef(el)
    setDropRef(el)
  }

  const showInstrDropHighlight = isOver && activeDragType === 'instrument'

  const [devCountsExpanded, setDevCountsExpanded] = useState(false)

  // Aggregate by_lot_type across all phases in all instruments of this dev
  const devLotTypeTotals = (() => {
    const byTypeMap = {}
    instruments
      .flatMap((i) => i.phases ?? [])
      .flatMap((p) => p.by_lot_type ?? [])
      .forEach((lt) => {
        if (!byTypeMap[lt.lot_type_id]) {
          byTypeMap[lt.lot_type_id] = {
            lot_type_id: lt.lot_type_id,
            lot_type_short: lt.lot_type_short,
            actual: 0, projected: 0, total: 0,
          }
        }
        byTypeMap[lt.lot_type_id].actual    += lt.actual    || 0
        byTypeMap[lt.lot_type_id].projected += lt.projected || 0
        byTypeMap[lt.lot_type_id].total     += lt.total     || 0
      })
    return Object.values(byTypeMap)
  })()
  const devR = devLotTypeTotals.reduce((s, lt) => s + lt.actual,    0)
  const devP = devLotTypeTotals.reduce((s, lt) => s + lt.projected, 0)
  const devT = devLotTypeTotals.reduce((s, lt) => s + lt.total,     0)

  const aw = availableWidth ?? (typeof window !== 'undefined' ? window.innerWidth - 340 : 1200)

  // SortableContext items for intra-PG instrument reorder
  const instrSortableIds = instruments.map((i) => `instrument-sortable-${i.instrument_id}`)

  return (
    <div
      ref={setRef}
      data-dev-id={devId}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        flex: '0 0 auto',
        opacity: isDragging ? 0.4 : 1,
        width: 'fit-content',
      }}
      className={`
        flex flex-col rounded-xl border-2 transition-colors duration-100
        ${tint?.bg ?? 'bg-gray-50'}
        ${showInstrDropHighlight ? 'border-blue-400 border-dashed' : (tint?.border ?? 'border-gray-200')}
      `}
    >
      {/* PG header — drag handle to reorder projection groups */}
      <div
        {...attributes}
        {...listeners}
        className={`
          px-3 py-2 rounded-t-xl border-b select-none
          cursor-grab active:cursor-grabbing
          ${tint?.border ?? 'border-gray-200'} ${tint?.header ?? 'bg-gray-100'}
        `}
      >
        <div className="flex flex-col gap-0.5">
          <div className="relative flex items-center justify-center">
            <span className="absolute left-0 text-gray-400 text-[10px] leading-none flex-shrink-0 cursor-grab active:cursor-grabbing select-none" aria-hidden>⠿</span>
            <p
              className={`font-bold text-sm ${tint?.text ?? 'text-gray-700'} break-words min-w-0 cursor-default`}
              title="Development names are managed in MARKS."
            >
              {devName}
            </p>
          </div>
          <div>
            <button
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => { e.stopPropagation(); setDevCountsExpanded((v) => !v) }}
              className="w-full text-[11px] text-gray-500 text-center leading-snug whitespace-nowrap hover:text-gray-700"
              title={devCountsExpanded ? 'Hide by type' : 'Show by type'}
            >
              <span className="font-medium text-gray-700">{devR}</span>r{' '}
              /<span className="font-medium text-gray-700"> {devP}</span>p{' '}
              /<span className="font-medium text-gray-700"> {devT}</span>t
              {' '}<span className="text-gray-400">{devCountsExpanded ? '▴' : '▾'}</span>
            </button>
            {devCountsExpanded && (
              <div className="mt-1 space-y-0.5">
                {devLotTypeTotals.map((lt) => (
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
      </div>

      {/* Instruments — sortable within this PG */}
      <SortableContext items={instrSortableIds} strategy={rectSortingStrategy}>
        <div className="flex flex-wrap gap-2 p-2 items-stretch" style={{ width: 'fit-content' }}>
          {instruments.map((instr) => (
            <InstrumentContainer
              key={instr.instrument_id}
              instrument={instr}
              tint={tint}
              pendingLotId={pendingLotId}
              pendingPhaseId={pendingPhaseId}
              activeDragType={activeDragType}
              collapsedPhaseIds={collapsedPhaseIds}
              onToggleCollapse={onToggleCollapse}
              onAutoSort={onAutoSort}
              availableWidth={aw}
              relaxCap={relaxCap}
              onRefetch={onRefetch}
              onProjectedSaved={onProjectedSaved}
            />
          ))}
          {instruments.length === 0 && (
            <div className="flex items-center justify-center min-h-[60px] w-full">
              <p className="text-[11px] text-gray-400 italic">
                {showInstrDropHighlight ? 'Drop instrument here' : 'No instruments'}
              </p>
            </div>
          )}
        </div>
      </SortableContext>
    </div>
  )
}
