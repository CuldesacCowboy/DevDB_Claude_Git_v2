import { useDroppable } from '@dnd-kit/core'
import LotCard from './LotCard'

export default function PhaseColumn({ phase, pendingLotId, dragSourceDevId, devId }) {
  const { setNodeRef, isOver } = useDroppable({
    id: `phase-${phase.phase_id}`,
    data: { phase, devId },
  })

  // Cross-dev drop would be invalid (not applicable in single-dev spike,
  // but wire it for completeness using dragSourceDevId when provided)
  const isInvalidDrop = isOver && dragSourceDevId !== null && dragSourceDevId !== devId

  const borderClass = isOver
    ? isInvalidDrop
      ? 'border-red-400 bg-red-50'
      : 'border-blue-400 bg-blue-50'
    : 'border-gray-200 bg-white'

  return (
    <div
      ref={setNodeRef}
      className={`
        flex flex-col rounded-lg border-2 transition-colors duration-100
        min-w-[180px] max-w-[220px] w-full flex-shrink-0
        ${borderClass}
      `}
    >
      {/* Header */}
      <div className="px-3 py-2 border-b border-gray-200">
        <p className="font-bold text-sm text-gray-800 leading-tight">{phase.phase_name}</p>
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

      {/* Invalid drop message */}
      {isInvalidDrop && (
        <div className="px-3 py-1 text-[11px] text-red-600 font-medium">
          Cannot drop here
        </div>
      )}

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
