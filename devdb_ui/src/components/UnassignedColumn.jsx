import { useDroppable } from '@dnd-kit/core'
import LotCard from './LotCard'

// Unassigned Lots panel — full-height sticky column with internal scroll.
// Lots here have phase_id: null in local state.
export default function UnassignedColumn({ lots, pendingLotId }) {
  const { isOver, setNodeRef } = useDroppable({
    id: 'unassigned',
    data: { type: 'unassigned' },
  })

  return (
    <div
      ref={setNodeRef}
      className={`
        flex flex-col h-full rounded-none border-0 overflow-hidden
        transition-colors w-full
        ${isOver ? 'bg-blue-50' : 'bg-gray-50'}
      `}
    >
      {/* Header */}
      <div className={`px-3 py-2 border-b flex-shrink-0 ${isOver ? 'border-blue-300 bg-blue-100' : 'border-gray-200 bg-gray-100'}`}>
        <p className={`font-bold text-sm ${isOver ? 'text-blue-900' : 'text-gray-700'}`}>
          Unassigned Lots
        </p>
        <p className={`text-[11px] mt-0.5 ${isOver ? 'text-blue-600' : 'text-gray-400'}`}>
          {lots.length > 0 ? `${lots.length} lot${lots.length === 1 ? '' : 's'}` : 'empty'}
        </p>
      </div>

      {/* Lot cards — scrollable list */}
      <div className="flex-1 overflow-y-auto flex flex-col gap-1 p-2 min-h-0">
        {lots.length > 0 ? (
          lots.map((lot) => (
            <LotCard
              key={lot.lot_id}
              lot={lot}
              isPending={pendingLotId === lot.lot_id}
              listView
            />
          ))
        ) : (
          <p className={`text-[11px] italic text-center mt-2 ${isOver ? 'text-blue-600' : 'text-gray-400'}`}>
            {isOver ? 'Drop to unassign' : 'All lots assigned'}
          </p>
        )}
      </div>
    </div>
  )
}
