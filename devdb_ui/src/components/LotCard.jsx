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

function parseLotNumber(lotNumber, fallbackId) {
  if (!lotNumber) return { code: 'lot', num: String(fallbackId) }
  const match = lotNumber.match(/^([A-Za-z]+)0*(\d+)$/)
  if (match) return { code: match[1].toUpperCase(), num: String(parseInt(match[2])) }
  return { code: lotNumber, num: '' }
}

// -----------------------------------------------------------------------
// BuildingGroupCard — renders a building group as a single draggable unit.
// All units in the group are carried together; the backend fans out the move.
// listView=false → compact pill (phase grid)
// listView=true  → expanded card (Unassigned panel)
// -----------------------------------------------------------------------
export function BuildingGroupCard({ lots, isPending, isOverlay = false, listView = false }) {
  const building_group_id = lots[0]?.building_group_id
  const { code } = parseLotNumber(lots[0]?.lot_number, lots[0]?.lot_id)

  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: `bg-${building_group_id}`,
    data: { type: 'building-group', lots, lot: lots[0] },
    disabled: isPending,
  })

  const baseStyle = {
    transform: CSS.Translate.toString(transform),
    opacity: isDragging && !isOverlay ? 0.35 : 1,
    cursor: isPending ? 'not-allowed' : isDragging ? 'grabbing' : 'grab',
  }

  if (listView) {
    return (
      <div
        ref={setNodeRef}
        style={baseStyle}
        {...listeners}
        {...attributes}
        className={`
          rounded border bg-cyan-50 border-cyan-200 px-2 py-1.5 shadow-sm select-none touch-none
          ${isDragging && !isOverlay ? 'border-cyan-400' : ''}
          ${isPending ? 'opacity-60' : ''}
        `}
      >
        <p className="font-bold text-xs text-cyan-800 font-mono">
          {code} <span className="text-cyan-500">×{lots.length}</span>
        </p>
        {lots.map((l) => {
          const { num } = parseLotNumber(l.lot_number, l.lot_id)
          return (
            <p key={l.lot_id} className="text-[10px] text-gray-500 font-mono ml-2">
              {num} — {l.status}{l.has_actual_dates ? ' ⚠' : ''}
            </p>
          )
        })}
      </div>
    )
  }

  return (
    <div
      ref={setNodeRef}
      style={{
        ...baseStyle,
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        width: 50,
        height: 24,
        overflow: 'hidden',
        padding: '1px 4px',
        fontSize: 11,
        borderRadius: 4,
        flexShrink: 0,
      }}
      {...listeners}
      {...attributes}
      className={`
        select-none touch-none font-medium bg-cyan-50 border border-cyan-300 text-cyan-800
        ${isPending ? 'opacity-60' : ''}
        ${isDragging && !isOverlay ? 'ring-1 ring-cyan-400' : ''}
      `}
      title={`Building group: ${lots.map((l) => l.lot_number).join(', ')}`}
    >
      <span className="leading-none truncate" style={{ maxWidth: 26 }}>{code}</span>
      <span className="leading-none text-[10px] font-bold text-cyan-500">{lots.length}×</span>
    </div>
  )
}

// -----------------------------------------------------------------------
// LotCard — individual lot pill / list card
// -----------------------------------------------------------------------
// listView=true  → tall card (white bg, lot# bold, status muted below) — used in Unassigned Lots panel
// listView=false → compact pill (status as bg color, code left / number right) — used in phase grid
//   pillWidth: pill width in px (default 50); override for orphan-row phases
export default function LotCard({ lot, isPending, isOverlay = false, listView = false, pillWidth = 50, pillHeight = 24 }) {
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

  const { code, num } = parseLotNumber(lot.lot_number, lot.lot_id)

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
        width: pillWidth,
        height: pillHeight,
        overflow: 'hidden',
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
