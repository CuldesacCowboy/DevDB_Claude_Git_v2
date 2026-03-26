import { useDroppable } from '@dnd-kit/core'
import LotCard from './LotCard'

// The Unassigned column is both a drag source and a drop target.
// Lots here have phase_id: null in local state.
// Width is controlled by the parent — no min-width enforced here.
export default function UnassignedColumn({ lots, pendingLotId }) {
  const { isOver, setNodeRef } = useDroppable({
    id: 'unassigned',
    data: { type: 'unassigned' },
  })

  return (
    <div
      ref={setNodeRef}
      className={`
        flex flex-col rounded-lg border-2 bg-amber-50 w-full overflow-hidden
        transition-colors
        ${isOver ? 'border-blue-400 border-dashed' : 'border-amber-200'}
      `}
      style={{ alignSelf: 'flex-start' }}
    >
      {/* Header */}
      <div className="px-2 py-2 border-b border-amber-200 bg-amber-100 rounded-t-md">
        <p className="font-bold text-sm text-amber-900 truncate">Unassigned</p>
        <p className="text-[11px] text-amber-700 mt-0.5">
          {lots.length > 0 ? `${lots.length} lot${lots.length === 1 ? '' : 's'}` : 'empty'}
        </p>
      </div>

      {/* Lot cards or placeholder */}
      <div className="flex flex-col gap-1 p-2 min-h-[60px]">
        {lots.length > 0 ? (
          lots.map((lot) => (
            <LotCard
              key={lot.lot_id}
              lot={lot}
              isPending={pendingLotId === lot.lot_id}
            />
          ))
        ) : (
          <p className="text-[11px] text-amber-600 italic text-center mt-2">
            {isOver ? 'Drop to unassign' : 'All lots assigned'}
          </p>
        )}
      </div>
    </div>
  )
}
