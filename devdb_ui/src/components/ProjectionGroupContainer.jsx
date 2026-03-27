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
          px-3 py-1.5 rounded-t-xl border-b select-none
          cursor-grab active:cursor-grabbing
          ${tint?.border ?? 'border-gray-200'} ${tint?.header ?? 'bg-gray-100'}
        `}
      >
        <div className="flex items-center gap-1.5">
          <span className="text-gray-400 text-[10px] leading-none flex-shrink-0" aria-hidden>⠿</span>
          <p className={`text-xs font-semibold ${tint?.text ?? 'text-gray-700'}`}>{devName}</p>
        </div>
      </div>

      {/* Instruments — sortable within this PG */}
      <SortableContext items={instrSortableIds} strategy={rectSortingStrategy}>
        <div className="flex flex-wrap gap-2 p-2 items-stretch" style={{ width: 'fit-content', height: '100%' }}>
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
