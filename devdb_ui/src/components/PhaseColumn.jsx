import { useState, useRef } from 'react'
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
}) {
  // Sortable: handles both intra-instrument reorder (drag to swap position)
  // and cross-instrument move (drag to a different instrument container).
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

  function setOuterRef(el) {
    setSortRef(el)
    setDropRef(el)
  }

  const [countsExpanded, setCountsExpanded] = useState(false)

  // Per-lot-type projected editing — p is editable at the lot_type level only
  const [localByLotType, setLocalByLotType] = useState(phase.by_lot_type)
  const [editingLtId, setEditingLtId] = useState(null)
  const [ltInput,     setLtInput]     = useState('')
  const [ltFlash,     setLtFlash]     = useState(null) // lot_type_id with error flash, or null
  const cancelLtRef = useRef(false)

  const isPending = pendingPhaseId === phase.phase_id
  const lotCount  = phase.lots.length

  // Totals derived from localByLotType so edits are reflected immediately
  const totalActual    = localByLotType.reduce((s, lt) => s + lt.actual,    0)
  const totalProjected = localByLotType.reduce((s, lt) => s + lt.projected, 0)
  const totalTotal     = localByLotType.reduce((s, lt) => s + lt.total,     0)

  async function confirmLtEdit(lotTypeId, prevProjected) {
    if (cancelLtRef.current) {
      cancelLtRef.current = false
      return
    }
    const val = parseInt(ltInput, 10)
    setEditingLtId(null)
    if (isNaN(val) || val < 0 || val === prevProjected) return
    try {
      const res = await fetch(
        `/api/phases/${phase.phase_id}/lot-type/${lotTypeId}/projected`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ projected_count: val }),
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
          {/* Collapse toggle */}
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

      {/* Capacity counts — display-only total; per-type editable p on expand */}
      <div className="px-2 py-1 border-b border-gray-100">
        {localByLotType.length === 0 ? (
          <p className="text-[11px] text-gray-400 italic text-center">no splits</p>
        ) : (
          <>
            {/* Slash line: read-only summary, click to toggle per-type breakdown */}
            <div
              className="w-full text-[11px] text-gray-500 leading-snug whitespace-nowrap text-center"
              style={{ cursor: 'pointer' }}
              onPointerDown={(e) => e.stopPropagation()}
              onClick={() => !isOverlay && setCountsExpanded((v) => !v)}
              title={countsExpanded ? 'Hide by type' : 'Show by type'}
            >
              <span className="font-medium text-gray-700">{totalActual}</span>r{' / '}
              <span className="font-medium text-gray-700">{totalProjected}</span>p{' / '}
              <span className="font-medium text-gray-700">{totalTotal}</span>t
            </div>
            {countsExpanded && (
              <div className="mt-1 space-y-0.5">
                {localByLotType.map((lt) => (
                  <div
                    key={lt.lot_type_id}
                    className="flex items-center justify-center gap-0.5 text-[10px] text-gray-500 leading-snug whitespace-nowrap"
                    onPointerDown={(e) => e.stopPropagation()}
                  >
                    <span className="text-gray-600 font-medium mr-0.5">
                      {lt.lot_type_short ?? `t${lt.lot_type_id}`}
                    </span>
                    <span className="font-medium text-gray-600">{lt.actual}</span>r /
                    {editingLtId === lt.lot_type_id ? (
                      <input
                        autoFocus
                        type="text"
                        value={ltInput}
                        onFocus={(e) => e.target.select()}
                        onChange={(e) => setLtInput(e.target.value.replace(/\D/g, ''))}
                        onKeyDown={(e) => {
                          if (e.key === 'Escape') {
                            cancelLtRef.current = true
                            setEditingLtId(null)
                          }
                          if (e.key === 'Enter') e.target.blur()
                        }}
                        onBlur={() => confirmLtEdit(lt.lot_type_id, lt.projected)}
                        onClick={(e) => e.stopPropagation()}
                        style={{
                          width: Math.max(2, ltInput.length) + 'ch',
                          minWidth: '2ch',
                          border: 'none',
                          background: 'transparent',
                          outline: 'none',
                          font: 'inherit',
                          textAlign: 'center',
                          color: 'inherit',
                          cursor: 'text',
                        }}
                        className="font-medium text-gray-700"
                      />
                    ) : (
                      <span
                        onClick={(e) => {
                          if (isOverlay) return
                          e.stopPropagation()
                          setLtInput(String(lt.projected))
                          setEditingLtId(lt.lot_type_id)
                        }}
                        style={{
                          border: `1px solid ${ltFlash === lt.lot_type_id ? '#ef4444' : '#93c5fd'}`,
                          background: ltFlash === lt.lot_type_id ? '#fef2f2' : '#eff6ff',
                          borderRadius: 3,
                          padding: '0 4px',
                          cursor: 'pointer',
                          display: 'inline-block',
                          lineHeight: 1.5,
                        }}
                        className="font-medium text-gray-700"
                        title="Click to edit projected count"
                      >
                        {lt.projected}
                      </span>
                    )}
                    p / <span className="font-medium text-gray-600">{lt.total}</span>t
                  </div>
                ))}
              </div>
            )}
          </>
        )}
        {isCollapsed && (
          <p className="text-[11px] text-gray-400 mt-0.5 text-center">
            {lotCount} lot{lotCount !== 1 ? 's' : ''}
          </p>
        )}
      </div>

      {/* Lot cards — 3-wide grid of lot pills, hidden when collapsed. */}
      {!isCollapsed && (
        <div
          className="flex-1 min-h-[40px]"
          style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 50px)', gridAutoRows: '24px', gap: 4, padding: 4, width: 'fit-content', margin: '0 auto' }}
        >
          {phase.lots.map((lot) => (
            <LotCard
              key={lot.lot_id}
              lot={lot}
              isPending={pendingLotId === lot.lot_id}
            />
          ))}
          {Array.from({ length: Math.max(0, totalProjected - lotCount) }).map((_, i) => (
            <div
              key={`temp-${i}`}
              style={{
                width: 50,
                height: 24,
                borderRadius: 4,
                border: '1.5px dashed #d1d5db',
                background: 'transparent',
              }}
            />
          ))}
          {lotCount === 0 && totalProjected === 0 && !isOver && (
            <p className="text-[11px] text-gray-400 italic text-center mt-1" style={{ gridColumn: '1 / -1' }}>empty</p>
          )}
        </div>
      )}
    </div>
  )
}
