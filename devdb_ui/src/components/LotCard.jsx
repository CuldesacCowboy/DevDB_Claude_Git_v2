import { useDraggable } from '@dnd-kit/core'
import { CSS } from '@dnd-kit/utilities'

const STATUS_BG = {
  OUT: 'bg-white border border-gray-300 text-gray-400',
  C:   'bg-green-100 text-green-700',
  UC:  'bg-yellow-100 text-yellow-700',
  U:   'bg-blue-100 text-blue-700',
  D:   'bg-purple-100 text-purple-700',
}
const DEFAULT_PILL_BG = 'bg-white border border-gray-200 text-gray-600'

// listView=true  → tall card (white bg, lot# bold, status muted below) — used in Unassigned Lots panel
// listView=false → compact 50px pill (status as bg color, code left / number right) — used in phase grid
export default function LotCard({ lot, isPending, isOverlay = false, listView = false }) {
  function parseLotNumber(lotNumber) {
    if (!lotNumber) return { code: 'lot', num: String(lot.lot_id) }
    const match = lotNumber.match(/^([A-Za-z]+)0*(\d+)$/)
    if (match) return { code: match[1].toUpperCase(), num: String(parseInt(match[2])) }
    return { code: lotNumber, num: '' }
  }

  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: `lot-${lot.lot_id}`,
    data: { type: 'lot', lot },
    disabled: isPending,
  })

  const baseStyle = {
    transform: CSS.Translate.toString(transform),
    opacity: isDragging && !isOverlay ? 0.35 : 1,
    cursor: isPending ? 'not-allowed' : isDragging ? 'grabbing' : 'grab',
  }

  const { code, num } = parseLotNumber(lot.lot_number)

  if (listView) {
    return (
      <div
        ref={setNodeRef}
        style={baseStyle}
        {...listeners}
        {...attributes}
        className={`
          rounded border bg-white px-2 py-1.5 shadow-sm select-none touch-none
          ${isDragging && !isOverlay ? 'border-blue-400' : 'border-gray-200'}
          ${isPending ? 'opacity-60' : ''}
        `}
      >
        <p className="font-bold text-xs text-gray-800 font-mono">{code}{num ? ` ${num}` : ''}</p>
        <p className="text-[10px] text-gray-400 mt-0.5">
          {lot.status}{lot.has_actual_dates ? ' ⚠' : ''}
        </p>
      </div>
    )
  }

  const pillBg = STATUS_BG[lot.status] ?? DEFAULT_PILL_BG

  return (
    <div
      ref={setNodeRef}
      style={{
        ...baseStyle,
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        width: 50,
        padding: '1px 4px',
        fontSize: 11,
        borderRadius: 4,
        flexShrink: 0,
      }}
      {...listeners}
      {...attributes}
      className={`
        select-none touch-none font-medium ${pillBg}
        ${isPending ? 'opacity-60' : ''}
        ${isDragging && !isOverlay ? 'ring-1 ring-blue-400' : ''}
      `}
    >
      <span className="leading-none truncate" style={{ maxWidth: 28 }}>{code}</span>
      <span className="leading-none" style={{ flexShrink: 0 }}>{num}</span>
    </div>
  )
}
