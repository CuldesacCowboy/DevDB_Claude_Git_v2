import { useDraggable, useDroppable } from '@dnd-kit/core'
import LotCard from './LotCard'

export default function PhaseColumn({
  phase,
  pendingLotId,
  pendingPhaseId,
  isOverlay,
  isCollapsed,
  onToggleCollapse,
}) {
  // Draggable: phase header → instrument container (phase moves)
  const {
    attributes: dragAttrs,
    listeners: dragListeners,
    setNodeRef: setDragRef,
    isDragging,
  } = useDraggable({
    id: `phase-header-${phase.phase_id}`,
    data: { type: 'phase', phase },
    disabled: !!isOverlay || pendingPhaseId === phase.phase_id,
  })

  // Droppable: column body → receives lot cards
  const { setNodeRef: setDropRef, isOver } = useDroppable({
    id: `phase-${phase.phase_id}`,
    data: { type: 'lot-target', phase },
    disabled: !!isOverlay,
  })

  const isPending = pendingPhaseId === phase.phase_id
  const lotCount = phase.lots.length

  return (
    <div
      ref={setDropRef}
      className={`
        flex flex-col rounded-lg border-2 transition-colors duration-100
        flex-1 min-w-0 overflow-hidden
        ${isDragging ? 'opacity-30' : ''}
        ${isOver && !isCollapsed ? 'border-blue-400 bg-blue-50' : 'border-gray-200 bg-white'}
      `}
    >
      {/* Header — drag handle + collapse toggle */}
      <div
        ref={setDragRef}
        {...dragAttrs}
        {...dragListeners}
        className={`
          px-2 py-2 border-b border-gray-200 select-none
          ${isOverlay || isPending ? 'cursor-default' : 'cursor-grab active:cursor-grabbing'}
        `}
      >
        <div className="flex items-center gap-1">
          {/* Drag handle icon */}
          <span className="text-gray-300 text-[10px] leading-none flex-shrink-0" aria-hidden>
            ⠿
          </span>
          {/* Phase name */}
          <p className="font-bold text-xs text-gray-800 leading-tight flex-1 min-w-0 truncate">
            {phase.phase_name}
          </p>
          {/* Collapse toggle — stops drag propagation on pointer down */}
          {!isOverlay && onToggleCollapse && (
            <button
              onPointerDown={(e) => e.stopPropagation()}
              onClick={onToggleCollapse}
              className="flex-shrink-0 text-gray-400 hover:text-gray-600 text-[10px] leading-none px-0.5"
              aria-label={isCollapsed ? 'Expand' : 'Collapse'}
            >
              {isCollapsed ? '▶' : '▼'}
            </button>
          )}
          {isPending && (
            <span className="text-[10px] text-gray-400 italic flex-shrink-0 ml-0.5">…</span>
          )}
        </div>
      </div>

      {/* Capacity counts — always visible */}
      <div className="px-2 py-1 border-b border-gray-100">
        {phase.by_lot_type.map((lt) => (
          <p key={lt.lot_type_id} className="text-[11px] text-gray-500 leading-snug truncate">
            <span className="font-medium text-gray-700">{lt.actual}</span>r{' '}
            /<span className="font-medium text-gray-700"> {lt.projected}</span>p{' '}
            /<span className="font-medium text-gray-700"> {lt.total}</span>t
          </p>
        ))}
        {phase.by_lot_type.length === 0 && (
          <p className="text-[11px] text-gray-400 italic truncate">no splits</p>
        )}
        {/* Collapsed lot count */}
        {isCollapsed && (
          <p className="text-[11px] text-gray-400 mt-0.5">
            {lotCount} lot{lotCount !== 1 ? 's' : ''}
          </p>
        )}
      </div>

      {/* Lot cards — hidden when collapsed */}
      {!isCollapsed && (
        <div className="flex flex-col gap-1 p-2 flex-1 min-h-[40px]">
          {phase.lots.map((lot) => (
            <LotCard
              key={lot.lot_id}
              lot={lot}
              isPending={pendingLotId === lot.lot_id}
            />
          ))}
          {lotCount === 0 && !isOver && (
            <p className="text-[11px] text-gray-400 italic text-center mt-1">empty</p>
          )}
        </div>
      )}
    </div>
  )
}
