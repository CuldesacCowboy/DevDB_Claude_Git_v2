import { useState } from 'react'
import { useDroppable } from '@dnd-kit/core'
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import LotCard from './LotCard'

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
  forcedWidth,
  forcedHeight,
}) {
  // Sortable: handles both intra-instrument reorder (drag to swap position)
  // and cross-instrument move (drag to a different instrument container).
  // instrumentId is passed in data so handleDragEnd can distinguish the two cases.
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

  // Droppable: column body → receives lot cards
  const { setNodeRef: setDropRef, isOver } = useDroppable({
    id: `phase-${phase.phase_id}`,
    data: { type: 'lot-target', phase },
    disabled: !!isOverlay,
  })

  // Both the sortable system and the lot-droppable need a ref to the outer element.
  function setOuterRef(el) {
    setSortRef(el)
    setDropRef(el)
  }

  const [countsExpanded, setCountsExpanded] = useState(false)

  const isPending = pendingPhaseId === phase.phase_id
  const lotCount = phase.lots.length

  return (
    <div
      ref={setOuterRef}
      className={`
        flex flex-col rounded-lg border-2 transition-colors duration-100 overflow-hidden
        ${isDragging ? 'opacity-30' : ''}
        ${isOver && !isCollapsed ? 'border-blue-400 bg-blue-50' : 'border-gray-200 bg-white'}
      `}
      style={{
        flex: '0 0 auto',
        width: forcedWidth != null ? forcedWidth + 'px' : 160,
        minWidth: forcedWidth != null ? forcedWidth + 'px' : 140,
        maxWidth: forcedWidth != null ? forcedWidth + 'px' : 220,
        height: forcedHeight != null ? forcedHeight + 'px' : undefined,
        alignSelf: forcedWidth != null ? 'stretch' : undefined,
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
          {/* Drag handle icon */}
          <span className="text-gray-300 text-[10px] leading-none flex-shrink-0" aria-hidden>
            ⠿
          </span>
          {/* Phase name — 2-line clamp prefix + always-visible suffix */}
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

      {/* Capacity counts — total line always visible, per-type on expand */}
      <div className="px-2 py-1 border-b border-gray-100">
        {phase.by_lot_type.length === 0 ? (
          <p className="text-[11px] text-gray-400 italic text-center">no splits</p>
        ) : (() => {
          const totalActual    = phase.by_lot_type.reduce((s, lt) => s + lt.actual, 0)
          const totalProjected = phase.by_lot_type.reduce((s, lt) => s + lt.projected, 0)
          const totalTotal     = phase.by_lot_type.reduce((s, lt) => s + lt.total, 0)
          return (
            <>
              <button
                onPointerDown={(e) => e.stopPropagation()}
                onClick={() => !isOverlay && setCountsExpanded((v) => !v)}
                className="w-full text-[11px] text-gray-500 leading-snug whitespace-nowrap text-center hover:text-gray-700"
                title={countsExpanded ? 'Hide by type' : 'Show by type'}
              >
                <span className="font-medium text-gray-700">{totalActual}</span>r{' '}
                /<span className="font-medium text-gray-700"> {totalProjected}</span>p{' '}
                /<span className="font-medium text-gray-700"> {totalTotal}</span>t
              </button>
              {countsExpanded && (
                <div className="mt-1 space-y-0.5">
                  {phase.by_lot_type.map((lt) => (
                    <p key={lt.lot_type_id} className="text-[10px] text-gray-400 leading-snug whitespace-nowrap text-center">
                      <span className="text-gray-500 mr-1">{lt.lot_type_short ?? `t${lt.lot_type_id}`}</span>
                      <span className="font-medium text-gray-600">{lt.actual}</span>r{' '}
                      /<span className="font-medium text-gray-600"> {lt.projected}</span>p{' '}
                      /<span className="font-medium text-gray-600"> {lt.total}</span>t
                    </p>
                  ))}
                </div>
              )}
            </>
          )
        })()}
        {isCollapsed && (
          <p className="text-[11px] text-gray-400 mt-0.5 text-center">
            {lotCount} lot{lotCount !== 1 ? 's' : ''}
          </p>
        )}
      </div>

      {/* Lot cards — hidden when collapsed */}
      {!isCollapsed && (
        <div
          className="flex-1 min-h-[40px]"
          style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 3, padding: 4 }}
        >
          {phase.lots.map((lot) => (
            <LotCard
              key={lot.lot_id}
              lot={lot}
              isPending={pendingLotId === lot.lot_id}
            />
          ))}
          {lotCount === 0 && !isOver && (
            <p className="text-[11px] text-gray-400 italic text-center mt-1" style={{ gridColumn: '1 / -1' }}>empty</p>
          )}
        </div>
      )}
    </div>
  )
}
