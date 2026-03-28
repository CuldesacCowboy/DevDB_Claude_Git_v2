import { useState, useRef, useEffect, useCallback } from 'react'

// Module-level cache — lot types are static; only fetch once per page load.
let _cachedLotTypes = null
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
  onRefetch,
  onProjectedSaved,
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

  // Feature: add product type
  const [showAddLotType, setShowAddLotType] = useState(false)
  const [availLotTypes, setAvailLotTypes] = useState(() => _cachedLotTypes ?? [])
  const [selectedLtId, setSelectedLtId] = useState(null)
  const [addLtCount, setAddLtCount] = useState('0')
  const [addLtSaving, setAddLtSaving] = useState(false)

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
        onProjectedSaved?.(phaseId, lotTypeId, data.projected_count, data.total)
      } else {
        setLtFlash(lotTypeId)
        setTimeout(() => setLtFlash(null), 1500)
      }
    } catch {
      setLtFlash(lotTypeId)
      setTimeout(() => setLtFlash(null), 1500)
    }
  }

  async function handleOpenAddLotType() {
    setAddLtCount('0')
    setShowAddLotType(true)
    let types = availLotTypes
    if (!types.length) {
      try {
        const r = await fetch('/api/phases/lot-types')
        if (r.ok) {
          types = await r.json()
          _cachedLotTypes = types
          setAvailLotTypes(types)
        }
      } catch {}
    }
    const available = types.filter(
      (lt) => !localByLotType.some((e) => e.lot_type_id === lt.lot_type_id)
    )
    setSelectedLtId(available[0]?.lot_type_id ?? null)
  }

  async function handleAddLotType() {
    const count = parseInt(addLtCount, 10)
    if (isNaN(count) || count < 0 || !selectedLtId) return
    setAddLtSaving(true)
    try {
      const res = await fetch(
        `/api/phases/${phase.phase_id}/lot-type/${selectedLtId}/projected`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ projected_count: count }),
        }
      )
      if (res.ok) {
        setShowAddLotType(false)
        onRefetch?.()
      }
    } finally {
      setAddLtSaving(false)
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

          {/* Add product type */}
          {!isOverlay && (
            showAddLotType ? (
              <div
                className="mt-1 border border-blue-200 rounded bg-blue-50 p-2 flex flex-col gap-1.5"
                onPointerDown={(e) => e.stopPropagation()}
              >
                <div className="flex items-center gap-2">
                  <span className="text-[11px] text-gray-600 w-20 flex-shrink-0">Product type</span>
                  {availLotTypes.length === 0 ? (
                    <span className="text-[11px] text-gray-400 italic">Loading…</span>
                  ) : (
                    <select
                      value={selectedLtId ?? ''}
                      onChange={(e) => setSelectedLtId(Number(e.target.value))}
                      className="flex-1 text-[11px] border border-gray-300 rounded px-1 py-0.5 focus:outline-none focus:border-blue-400 bg-white"
                    >
                      {availLotTypes
                        .filter((lt) => !localByLotType.some((e) => e.lot_type_id === lt.lot_type_id))
                        .map((lt) => (
                          <option key={lt.lot_type_id} value={lt.lot_type_id}>
                            {lt.lot_type_short ?? `t${lt.lot_type_id}`}
                          </option>
                        ))}
                    </select>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-[11px] text-gray-600 w-20 flex-shrink-0">Projected count</span>
                  <input
                    type="number"
                    min="0"
                    value={addLtCount}
                    onChange={(e) => setAddLtCount(e.target.value.replace(/[^0-9]/g, ''))}
                    className="w-16 text-[11px] border border-gray-300 rounded px-1 py-0.5 focus:outline-none focus:border-blue-400 text-center bg-white"
                    onKeyDown={(e) => { if (e.key === 'Enter') handleAddLotType(); if (e.key === 'Escape') setShowAddLotType(false) }}
                  />
                </div>
                <div className="flex gap-1 justify-end">
                  <button
                    onClick={() => setShowAddLotType(false)}
                    className="text-[11px] px-2 py-0.5 rounded border border-gray-200 text-gray-500 hover:bg-gray-100"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleAddLotType}
                    disabled={addLtSaving || !selectedLtId}
                    className="text-[11px] px-2 py-0.5 rounded bg-blue-500 text-white hover:bg-blue-600 disabled:opacity-40"
                  >
                    {addLtSaving ? 'Adding…' : 'Add'}
                  </button>
                </div>
              </div>
            ) : (
              <button
                onPointerDown={(e) => e.stopPropagation()}
                onClick={handleOpenAddLotType}
                className="mt-0.5 w-full flex items-center justify-center gap-1 py-1 text-[11px] text-gray-400 hover:text-gray-600 hover:bg-gray-50 rounded border-t border-gray-100"
              >
                <span className="w-3.5 h-3.5 rounded-full border border-current flex items-center justify-center text-[9px] leading-none flex-shrink-0">+</span>
                Add product type
              </button>
            )
          )}
        </div>
      )}
    </div>
  )
}
