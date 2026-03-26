import { useDraggable, useDroppable } from '@dnd-kit/core'
import LotCard from './LotCard'

export default function PhaseColumn({ phase, pendingLotId, pendingPhaseId, isOverlay }) {
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

  return (
    <div
      ref={setDropRef}
      className={`
        flex flex-col rounded-lg border-2 transition-colors duration-100
        min-w-[180px] max-w-[220px] w-full flex-shrink-0
        ${isDragging ? 'opacity-30' : ''}
        ${isOver ? 'border-blue-400 bg-blue-50' : 'border-gray-200 bg-white'}
      `}
    >
      {/* Header — drag handle for phase-to-instrument moves */}
      <div
        ref={setDragRef}
        {...dragAttrs}
        {...dragListeners}
        className={`
          px-3 py-2 border-b border-gray-200 select-none
          ${isOverlay || isPending ? 'cursor-default' : 'cursor-grab active:cursor-grabbing'}
        `}
      >
        <div className="flex items-center gap-1.5">
          {/* 6-dot drag handle icon */}
          <span className="text-gray-300 text-[10px] leading-none flex-shrink-0" aria-hidden>
            ⠿
          </span>
          <p className="font-bold text-sm text-gray-800 leading-tight flex-1 min-w-0 truncate">
            {phase.phase_name}
          </p>
          {isPending && (
            <span className="text-[10px] text-gray-400 italic flex-shrink-0">moving…</span>
          )}
        </div>
      </div>

      {/* Capacity counts */}
      <div className="px-3 py-1.5 border-b border-gray-100">
        {phase.by_lot_type.map((lt) => (
          <p key={lt.lot_type_id} className="text-[11px] text-gray-500 leading-snug">
            <span className="font-medium text-gray-700">{lt.actual}</span> real{' '}
            / <span className="font-medium text-gray-700">{lt.projected}</span> proj{' '}
            / <span className="font-medium text-gray-700">{lt.total}</span> total
            <span className="text-gray-400"> (lt {lt.lot_type_id})</span>
          </p>
        ))}
        {phase.by_lot_type.length === 0 && (
          <p className="text-[11px] text-gray-400 italic">no splits configured</p>
        )}
      </div>

      {/* Lot cards */}
      <div className="flex flex-col gap-1 p-2 flex-1 min-h-[60px]">
        {phase.lots.map((lot) => (
          <LotCard
            key={lot.lot_id}
            lot={lot}
            isPending={pendingLotId === lot.lot_id}
          />
        ))}
        {phase.lots.length === 0 && !isOver && (
          <p className="text-[11px] text-gray-400 italic text-center mt-2">empty</p>
        )}
      </div>
    </div>
  )
}
