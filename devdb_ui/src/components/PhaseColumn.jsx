import { useState, useRef, useEffect } from 'react'
import { useDroppable } from '@dnd-kit/core'
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import LotCard from './LotCard'
import LotTypePill from './LotTypePill'

// Split "Waterton Station SF ph. 3" into prefix="Waterton Station SF" and suffix="ph. 3".
// Falls back to { prefix: name, suffix: null } if no " ph." pattern is found.
function splitPhaseName(name) {
  const idx = name.lastIndexOf(' ph.')
  if (idx === -1) return { prefix: name, suffix: null }
  return { prefix: name.slice(0, idx), suffix: name.slice(idx + 1) }
}

export default function PhaseColumn({
  phase,
  pendingLotId,
  pendingPhaseId,
  isOverlay,
  isCollapsed,
  onToggleCollapse,
}) {
  // Sortable: handles both intra-instrument reorder and cross-instrument move.
  const {
    attributes: sortAttrs,
    listeners: sortListeners,
    setNodeRef: setSortRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: `phase-header-${phase.phase_id}`,
    data: { type: 'phase', phase, instrumentId: phase.instrument_id ?? null },
    disabled: !!isOverlay || pendingPhaseId === phase.phase_id,
  })

  // Phase-level droppable (Case C: lot dropped onto phase, not a specific lot-type zone)
  const { setNodeRef: setDropRef, isOver } = useDroppable({
    id: `phase-${phase.phase_id}`,
    data: { type: 'lot-target', phase },
    disabled: !!isOverlay,
  })

  function setOuterRef(el) {
    setSortRef(el)
    setDropRef(el)
  }

  // localByLotType drives the slash-line totals and is updated optimistically on p edits.
  const [localByLotType, setLocalByLotType] = useState(phase.by_lot_type)
  useEffect(() => { setLocalByLotType(phase.by_lot_type) }, [phase.by_lot_type])

  const isPending = pendingPhaseId === phase.phase_id
  const lotCount  = phase.lots.length

  const totalActual    = localByLotType.reduce((s, lt) => s + lt.actual,    0)
  const totalProjected = localByLotType.reduce((s, lt) => s + lt.projected, 0)
  const totalTotal     = localByLotType.reduce((s, lt) => s + lt.total,     0)

  // Handle projected edit from a LotTypePill: PATCH then update localByLotType.
  const ltFlashRef = useRef({}) // lotTypeId -> timeout id
  const [ltFlash, setLtFlash] = useState(null)

  async function handleProjectedEdit(phaseId, lotTypeId, newValue) {
    try {
      const res = await fetch(
        `/api/phases/${phaseId}/lot-type/${lotTypeId}/projected`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ projected_count: newValue }),
        }
      )
      if (res.ok) {
        const data = await res.json()
        setLocalByLotType((prev) =>
          prev.map((lt) =>
            lt.lot_type_id === lotTypeId
              ? { ...lt, projected: data.projected_count, total: data.total }
              : lt
          )
        )
      } else {
        setLtFlash(lotTypeId)
        setTimeout(() => setLtFlash(null), 1500)
      }
    } catch {
      setLtFlash(lotTypeId)
      setTimeout(() => setLtFlash(null), 1500)
    }
  }

  return (
    <div
      ref={setOuterRef}
      className={`
        flex flex-col rounded-lg border-2 transition-colors duration-100 overflow-hidden
        ${isDragging ? 'opacity-30' : ''}
        ${isOver && !isCollapsed ? 'border-blue-400 bg-blue-50' : 'border-gray-200 bg-white'}
      `}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
      }}
    >
      {/* Header — drag handle + collapse toggle */}
      <div
        {...sortAttrs}
        {...sortListeners}
        className={`
          px-2 py-2 border-b border-gray-200 select-none
          ${isOverlay || isPending ? 'cursor-default' : 'cursor-grab active:cursor-grabbing'}
        `}
      >
        <div className="flex items-center gap-1">
          <span className="text-gray-300 text-[10px] leading-none flex-shrink-0" aria-hidden>
            ⠿
          </span>
          {(() => {
            const { prefix, suffix } = splitPhaseName(phase.phase_name)
            return (
              <div className="font-bold text-xs text-gray-800 flex-1 min-w-0" title={phase.phase_name}>
                <span
                  style={{
                    display: '-webkit-box',
                    WebkitLineClamp: 2,
                    WebkitBoxOrient: 'vertical',
                    overflow: 'hidden',
                    lineHeight: 1.3,
                    wordBreak: 'break-word',
                  }}
                >
                  {prefix}
                </span>
                {suffix && (
                  <span
                    style={{
                      display: 'block',
                      whiteSpace: 'nowrap',
                      color: '#9ca3af',
                      fontSize: 11,
                      marginTop: 2,
                    }}
                  >
                    {suffix}
                  </span>
                )}
              </div>
            )
          })()}
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

      {/* Slash line — phase-level read-only summary */}
      <div className="px-2 py-1 border-b border-gray-100" onPointerDown={(e) => e.stopPropagation()}>
        {localByLotType.length === 0 ? (
          <p className="text-[11px] text-gray-400 italic text-center">no splits</p>
        ) : (
          <div className="w-full text-[11px] text-gray-500 leading-snug whitespace-nowrap text-center">
            <span className="font-medium text-gray-700">{totalActual}</span>r{' / '}
            <span className="font-medium text-gray-700">{totalProjected}</span>p{' / '}
            <span className="font-medium text-gray-700">{totalTotal}</span>t
          </div>
        )}
        {isCollapsed && (
          <p className="text-[11px] text-gray-400 mt-0.5 text-center">
            {lotCount} lot{lotCount !== 1 ? 's' : ''}
          </p>
        )}
      </div>

      {/* Lot type container — one LotTypePill per entry in by_lot_type */}
      {!isCollapsed && (
        <div className="flex flex-col gap-1 px-2 pb-2 pt-1">
          {localByLotType.length === 0 && (
            <p className="text-[11px] text-gray-400 italic text-center mt-1">empty</p>
          )}
          {localByLotType.map((lt) => (
            <LotTypePill
              key={lt.lot_type_id}
              phaseId={phase.phase_id}
              lotTypeId={lt.lot_type_id}
              lotTypeShort={lt.lot_type_short}
              actual={lt.actual}
              projected={lt.projected}
              total={lt.total}
              lots={phase.lots.filter((l) => l.lot_type_id === lt.lot_type_id)}
              onProjectedEdit={handleProjectedEdit}
              pendingLotId={pendingLotId}
              isOverlay={isOverlay}
            />
          ))}
        </div>
      )}
    </div>
  )
}
