import { useDraggable } from '@dnd-kit/core'
import { CSS } from '@dnd-kit/utilities'

const STATUS_STYLES = {
  P:   'bg-slate-100 text-slate-600',
  E:   'bg-purple-100 text-purple-700',
  D:   'bg-gray-200 text-gray-600',
  H:   'bg-orange-100 text-orange-600',
  U:   'bg-blue-100 text-blue-700',
  UC:  'bg-amber-100 text-amber-700',
  C:   'bg-green-100 text-green-700',
  OUT: 'bg-teal-100 text-teal-700',
}

export default function LotCard({ lot, isPending, isOverlay = false }) {
  function formatLotNumber(lotNumber) {
    if (!lotNumber) return `lot ${lot.lot_id}`
    const match = lotNumber.match(/^([A-Za-z]+)0*(\d+)$/)
    if (match) return `${match[1].toUpperCase()} ${parseInt(match[2])}`
    return lotNumber
  }

  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: `lot-${lot.lot_id}`,
    data: { type: 'lot', lot },
    disabled: isPending,
  })

  const style = {
    transform: CSS.Translate.toString(transform),
    opacity: isDragging && !isOverlay ? 0.35 : 1,
    cursor: isPending ? 'not-allowed' : isDragging ? 'grabbing' : 'grab',
  }

  const badge = STATUS_STYLES[lot.status] ?? STATUS_STYLES.P

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...listeners}
      {...attributes}
      className={`
        flex items-center justify-between gap-1.5
        rounded border bg-white px-2 py-1.5 text-xs shadow-sm
        select-none touch-none
        ${isDragging && !isOverlay ? 'border-blue-400' : 'border-gray-200'}
        ${isPending ? 'opacity-60' : ''}
      `}
    >
      <span className="font-mono font-medium text-gray-800 truncate">
        {formatLotNumber(lot.lot_number)}
      </span>

      <div className="flex items-center gap-1 shrink-0">
        {lot.has_actual_dates && (
          <span title="Has MARKsystems dates" className="text-amber-500 text-[10px]">⚠</span>
        )}
        <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${badge}`}>
          {lot.status}
        </span>
        {isPending && (
          <svg className="animate-spin h-3 w-3 text-blue-500" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
          </svg>
        )}
      </div>
    </div>
  )
}
