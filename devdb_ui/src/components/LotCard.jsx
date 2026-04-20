import { useState, useCallback } from 'react'
import { useDraggable } from '@dnd-kit/core'
import { CSS } from '@dnd-kit/utilities'
import { STATUS_CFG } from '../utils/statusConfig'
import { API_BASE } from '../config'

function pillStyle(status) {
  const cfg = STATUS_CFG[status]
  if (!cfg) return { background: '#fff', border: '1px solid #e5e7eb', color: '#6b7280' }
  return { background: cfg.bg, border: `1px solid ${cfg.border}`, color: cfg.color }
}

function parseLotNumber(lotNumber, fallbackId) {
  if (!lotNumber) return { code: 'lot', num: String(fallbackId) }
  const match = lotNumber.match(/^([A-Za-z]+)0*(\d+)$/)
  if (match) {
    const numStr = String(parseInt(match[2], 10))
    const pad = '\u00a0'.repeat(Math.max(0, 3 - numStr.length))
    return { code: match[1].toUpperCase(), num: `${pad}${numStr}` }
  }
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
            <p key={l.lot_id} className="text-[10px] font-mono ml-2"
               style={{ color: STATUS_CFG[l.status]?.color ?? '#6b7280', fontWeight: 600 }}>
              {num} — {STATUS_CFG[l.status]?.shape} {l.status}{l.has_actual_dates ? ' ⚠' : ''}
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
// Right-click on any lot card → context menu with Exclude / Re-include toggle.
export default function LotCard({ lot, isPending, isOverlay = false, listView = false, pillWidth = 50, pillHeight = 24, onExcludeToggle }) {
  const [excluded, setExcluded] = useState(lot.excluded ?? false)
  const [menu, setMenu] = useState(null)   // {x, y} or null

  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: `lot-${lot.lot_id}`,
    data: { type: 'lot', lot },
    disabled: isPending || excluded,
  })

  const handleContextMenu = useCallback((e) => {
    e.preventDefault()
    e.stopPropagation()
    setMenu({ x: e.clientX, y: e.clientY })
  }, [])

  const handleToggleExclude = useCallback(async () => {
    setMenu(null)
    const next = !excluded
    try {
      const res = await fetch(`${API_BASE}/lots/${lot.lot_id}/excluded`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ excluded: next }),
      })
      if (res.ok) {
        setExcluded(next)
        onExcludeToggle?.(lot.lot_id, next)
      }
    } catch {}
  }, [excluded, lot.lot_id, onExcludeToggle])

  const baseStyle = {
    transform: CSS.Translate.toString(transform),
    opacity: isDragging && !isOverlay ? 0.35 : excluded ? 0.4 : 1,
    cursor: isPending || excluded ? 'default' : isDragging ? 'grabbing' : 'grab',
  }

  const { code, num } = parseLotNumber(lot.lot_number, lot.lot_id)

  const contextMenu = menu && (
    <div
      style={{
        position: 'fixed', top: menu.y, left: menu.x, zIndex: 9999,
        background: '#fff', border: '1px solid #e5e7eb', borderRadius: 6,
        boxShadow: '0 4px 12px rgba(0,0,0,0.15)', padding: '4px 0', minWidth: 160,
      }}
      onMouseLeave={() => setMenu(null)}
    >
      <div style={{ padding: '2px 8px 4px', fontSize: 11, color: '#9ca3af', fontFamily: 'monospace' }}>
        {lot.lot_number}
      </div>
      <button
        onClick={handleToggleExclude}
        style={{
          display: 'block', width: '100%', textAlign: 'left',
          padding: '6px 12px', fontSize: 12, background: 'none', border: 'none',
          cursor: 'pointer', color: excluded ? '#059669' : '#dc2626',
        }}
        onMouseEnter={e => e.currentTarget.style.background = '#f9fafb'}
        onMouseLeave={e => e.currentTarget.style.background = 'none'}
      >
        {excluded ? '✓ Re-include lot' : '✕ Exclude lot'}
      </button>
    </div>
  )

  if (listView) {
    return (
      <>
        <div
          ref={setNodeRef}
          style={baseStyle}
          {...listeners}
          {...attributes}
          onContextMenu={handleContextMenu}
          className={`
            rounded border bg-white px-2 py-1.5 shadow-sm select-none touch-none
            ${isDragging && !isOverlay ? 'border-blue-400' : excluded ? 'border-dashed border-gray-300' : 'border-gray-200'}
            ${isPending ? 'opacity-60' : ''}
          `}
        >
          <p className="font-bold text-xs font-mono"
            style={{ color: excluded ? '#9ca3af' : '#1f2937', textDecoration: excluded ? 'line-through' : 'none' }}>
            {code}{num ? ` ${num}` : ''}
          </p>
          <p className="text-[10px] mt-0.5" style={{ color: excluded ? '#d1d5db' : (STATUS_CFG[lot.status]?.color ?? '#9ca3af'), fontWeight: 600 }}>
            {excluded ? 'excluded' : `${STATUS_CFG[lot.status]?.shape ?? ''} ${lot.status}${lot.has_actual_dates ? ' ⚠' : ''}`}
          </p>
        </div>
        {contextMenu}
      </>
    )
  }

  const ps = excluded
    ? { background: '#f9fafb', border: '1px dashed #d1d5db', color: '#9ca3af' }
    : pillStyle(lot.status)

  return (
    <>
      <div
        ref={setNodeRef}
        style={{
          ...baseStyle,
          ...ps,
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
        onContextMenu={handleContextMenu}
        className={`
          select-none touch-none font-medium
          ${isDragging && !isOverlay ? 'ring-1 ring-blue-400' : ''}
        `}
      >
        <span className="leading-none truncate"
          style={{ maxWidth: 28, textDecoration: excluded ? 'line-through' : 'none' }}>
          {code}
        </span>
        <span className="leading-none" style={{ flexShrink: 0 }}>{num}</span>
      </div>
      {contextMenu}
    </>
  )
}
