import { useState, useRef, useEffect, useLayoutEffect } from 'react'
import { useDroppable } from '@dnd-kit/core'
import LotPill, { StitchConnector, PlaceholderPill } from './LotPill'
import CheckpointTimeline from './CheckpointTimeline'
import { fmt, buildClusters } from '../utils/tdaUtils'

// ── Editable inline value (green dashed style) ───────────────────
export function EditableNumber({ value, onChange }) {
  const [editing, setEditing] = useState(false)
  if (editing) {
    return (
      <input
        autoFocus
        type="number"
        min={0}
        defaultValue={value}
        onBlur={(e) => {
          const val = parseInt(e.target.value, 10)
          if (!isNaN(val) && val >= 0) onChange(val)
          setEditing(false)
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.target.blur()
          if (e.key === 'Escape') setEditing(false)
        }}
        style={{
          width: 42, fontSize: 15, fontWeight: 700,
          border: '1px dashed #3B6D11',
          background: '#EAF3DE', color: '#27500A',
          borderRadius: 3, padding: '1px 2px',
          outline: 'none', textAlign: 'center',
        }}
      />
    )
  }
  return (
    <span
      onClick={() => setEditing(true)}
      title="Click to edit"
      style={{
        fontSize: 15, fontWeight: 700, color: '#27500A',
        border: '1px dashed #3B6D11',
        background: '#EAF3DE',
        borderRadius: 3, padding: '1px 6px',
        cursor: 'pointer',
      }}
    >
      {value}
    </span>
  )
}

// ── Droppable checkpoint band ─────────────────────────────────────
export default function CheckpointBand({ checkpoint, onDateChange, onLockChange, selectedAssignedLotIds, onToggleAssignedLot, onToggleCheckpointLots, onContextMenu, dragLot }) {
  const [localTotal, setLocalTotal] = useState(checkpoint.lots_required_cumulative || 0)
  const [localDate, setLocalDate] = useState(checkpoint.checkpoint_date || '')

  const { setNodeRef, isOver } = useDroppable({
    id: `checkpoint-${checkpoint.checkpoint_id}`,
    data: { type: 'checkpoint', checkpointId: checkpoint.checkpoint_id },
  })

  const lots = checkpoint.lots || []
  const checkpointLotIds = lots.map(l => l.lot_id)
  const allSelected = checkpointLotIds.length > 0 && checkpointLotIds.every(id => selectedAssignedLotIds?.has(id))
  const someSelected = !allSelected && checkpointLotIds.some(id => selectedAssignedLotIds?.has(id))
  const selectedCount = checkpointLotIds.filter(id => selectedAssignedLotIds?.has(id)).length

  // Landing zone: highlight when a drag is in progress (any lot type can land on a checkpoint)
  const isValidDrop = !!dragLot && !isOver

  // Display order — follows server order by default; manual sort on demand.
  // When lots refresh (lock/date change), preserve current order if the set of
  // assignment_ids is unchanged; only reset to server order when lots are added/removed.
  const [displayLots, setDisplayLots] = useState(lots)
  useEffect(() => {
    setDisplayLots(prev => {
      const newById = Object.fromEntries(lots.map(l => [l.assignment_id, l]))
      const prevIds = prev.map(l => l.assignment_id)
      const newIds  = lots.map(l => l.assignment_id)
      // Same set of IDs: merge updated fields into existing order
      const sameSet = prevIds.length === newIds.length &&
        prevIds.every(id => newById[id] !== undefined)
      if (sameSet) return prev.map(l => newById[l.assignment_id])
      // Different set: reset to server order
      return lots
    })
  }, [lots])

  const [showLots, setShowLots] = useState(true)
  const [lotView, setLotView] = useState('expanded') // 'expanded' | 'condensed'
  const condensed = lotView === 'condensed'

  const [showTimeline, setShowTimeline] = useState(false)

  // Sort animation: briefly dim the grid when a sort is triggered so the
  // reorder isn't a disorienting instantaneous snap.
  const [sortFlash, setSortFlash] = useState(false)
  const sortFlashTimer = useRef(null)

  function triggerSort(sortFn) {
    if (sortFlashTimer.current) clearTimeout(sortFlashTimer.current)
    setSortFlash(true)
    setDisplayLots(prev => [...prev].sort(sortFn))
    sortFlashTimer.current = setTimeout(() => {
      setSortFlash(false)
      sortFlashTimer.current = null
    }, 380)
  }

  function handleReorderByFulfillment() {
    triggerSort((a, b) => {
      const winDate = (l) => {
        const dates = [l.hc_projected_date, l.bldr_projected_date].filter(Boolean)
        return dates.length ? dates.reduce((m, d) => d < m ? d : m) : null
      }
      const aDate = winDate(a), bDate = winDate(b)
      if (!aDate && !bDate) return 0
      if (!aDate) return 1
      if (!bDate) return -1
      return aDate.localeCompare(bDate)
    })
  }

  function handleReorderByUnit() {
    triggerSort((a, b) => {
      const parse = l => {
        const m = (l.lot_number || '').match(/^([A-Za-z]+)0*(\d+)$/)
        return m ? [m[1], parseInt(m[2], 10)] : [l.lot_number || '', 0]
      }
      const [ac, an] = parse(a), [bc, bn] = parse(b)
      if (ac !== bc) return ac.localeCompare(bc)
      return an - bn
    })
  }

  // C = lots with HC or BLDR projected date in the past (≤ today) — completed
  // futureP = lots with HC or BLDR projected date in the future — planned
  // Caution = future projected date exists but it falls after the checkpoint date
  const todayStr = new Date().toISOString().slice(0, 10)
  const isPast = (d) => !!d && d <= todayStr
  const c = lots.filter(l =>
    isPast(l.hc_projected_date) || isPast(l.bldr_projected_date)
  ).length
  const futureP = lots.filter(l =>
    (l.hc_projected_date && !isPast(l.hc_projected_date)) ||
    (l.bldr_projected_date && !isPast(l.bldr_projected_date))
  ).length
  const plannedTotal = c + futureP  // used for "+ Planned" bar
  const t = localTotal
  const total = lots.length
  const excess = Math.max(0, total - t)
  const overTotal = plannedTotal > t
  const overC = c > t                // completed alone exceeds required

  // Placeholder count and urgency
  const slotCount = Math.max(0, t - total)
  const daysToCP = (() => {
    if (!localDate) return null
    const today = new Date(); today.setHours(0, 0, 0, 0)
    const cpDate = new Date(localDate)
    return Math.floor((cpDate - today) / (1000 * 60 * 60 * 24))
  })()

  const cPct   = t > 0 ? Math.min(100, Math.round((c            / t) * 100)) : 0
  const cpPct  = t > 0 ? Math.min(100, Math.round((plannedTotal / t) * 100)) : 0

  // ── Checkpoint status ──────────────────────────────────────────
  // metCP = lots where any date (marks or projected) is on/before the checkpoint date
  // Only user-entered projected dates count — marks dates are system actuals, not "entered"
  const metCP = localDate ? lots.filter(l => {
    const dates = [l.hc_projected_date, l.bldr_projected_date].filter(Boolean)
    return dates.some(d => d <= localDate)
  }).length : 0
  // Every assigned lot must have a qualifying date — not just the required count
  const allMet = total > 0 && metCP >= total
  const cpIsPast = !!localDate && localDate <= todayStr
  const cpStatus = (!localDate || t === 0) ? 'none'
    : cpIsPast
      ? (allMet ? 'complete' : 'missed')
      : (allMet ? 'on-track' : metCP > 0 ? 'at-risk' : 'none')

  const STATUS_CFG = {
    'complete': { label: 'Complete', icon: '✓', color: '#15803d', bg: '#dcfce7', border: '#86efac' },
    'on-track': { label: 'On Track', icon: '↗', color: '#0f766e', bg: '#ccfbf1', border: '#5eead4' },
    'at-risk':  { label: 'At Risk',  icon: '⚠', color: '#b45309', bg: '#fef3c7', border: '#fcd34d' },
    'missed':   { label: 'Missed',   icon: '✕', color: '#b91c1c', bg: '#fee2e2', border: '#fca5a5' },
  }
  const statusCfg = STATUS_CFG[cpStatus] || null

  // ── Row height equalization (lots + placeholders) ──────────────
  const gridRef = useRef(null)
  useLayoutEffect(() => {
    const grid = gridRef.current
    if (!grid) return
    const children = Array.from(grid.children)
    children.forEach(el => { el.style.height = '' })
    const rows = []
    children.forEach(el => {
      const top = el.getBoundingClientRect().top
      const row = rows.find(r => Math.abs(r.top - top) < 10)
      if (row) row.els.push(el)
      else rows.push({ top, els: [el] })
    })
    rows.forEach(row => {
      const maxH = Math.max(...row.els.map(el => el.getBoundingClientRect().height))
      row.els.forEach(el => { el.style.height = `${maxH}px` })
    })
  }, [displayLots, slotCount, showLots, lotView])

  return (
    <div
      ref={setNodeRef}
      style={{
        background: isOver ? '#f0f9ff' : '#ffffff',
        border: isOver ? '1.5px solid #3b82f6' : isValidDrop ? '1.5px dashed #93c5fd' : '1.5px solid #E4E2DA',
        borderLeft: isOver ? '1.5px solid #3b82f6' : isValidDrop ? '1.5px dashed #93c5fd' : statusCfg ? `4px solid ${statusCfg.border}` : '1.5px solid #E4E2DA',
        borderRadius: 8, marginBottom: 14,
        transition: 'all 0.15s',
      }}
    >
      {/* Header */}
      <div style={{
        background: '#F5F5F2',
        borderRadius: '6px 6px 0 0',
        padding: '10px 14px',
        display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 14,
      }}>
        {/* Left: select-all toggle + "{X} required by {date}" — both editable inline */}
        <div style={{ flexShrink: 0, display: 'flex', alignItems: 'center', gap: 7, flexWrap: 'wrap' }}>
          {checkpointLotIds.length > 0 && onToggleCheckpointLots && (
            <button
              onClick={() => onToggleCheckpointLots(checkpointLotIds)}
              title={allSelected ? 'Deselect all lots in this checkpoint' : 'Select all lots in this checkpoint'}
              style={{
                width: 18, height: 18, borderRadius: 3, flexShrink: 0,
                border: `1.5px solid ${allSelected ? '#2563eb' : someSelected ? '#93c5fd' : '#D4D2CB'}`,
                background: allSelected ? '#2563eb' : someSelected ? '#dbeafe' : '#fff',
                cursor: 'pointer', padding: 0,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 11, color: allSelected ? '#fff' : someSelected ? '#2563eb' : '#9ca3af',
              }}
            >
              {allSelected ? '✓' : someSelected ? '–' : ''}
            </button>
          )}
          {selectedCount > 0 && (
            <span style={{ fontSize: 11, color: '#2563eb', fontWeight: 600 }}>
              {selectedCount} selected
            </span>
          )}
          <EditableNumber value={t} onChange={setLocalTotal} />
          <span style={{ fontSize: 15, color: '#6B6B68', fontWeight: 500 }}>required by</span>
          {/* Editable date — overlay pattern */}
          <div style={{ position: 'relative', display: 'inline-block' }}>
            <div style={{
              fontSize: 15, fontWeight: 700, color: '#27500A',
              border: '1px dashed #3B6D11',
              background: '#EAF3DE',
              borderRadius: 3, padding: '1px 6px',
              cursor: 'pointer', userSelect: 'none',
              whiteSpace: 'nowrap',
            }}>
              {localDate ? fmt(localDate) : '—'}
            </div>
            <input
              key={localDate}
              type="date"
              defaultValue={localDate}
              onBlur={(e) => { if (e.target.value && e.target.value !== localDate) setLocalDate(e.target.value) }}
              style={{
                position: 'absolute', top: 0, left: 0,
                width: '100%', height: '100%',
                opacity: 0, cursor: 'pointer',
                border: 'none', padding: 0, margin: 0,
              }}
            />
          </div>
          {displayLots.length > 1 && (
            <>
              <button
                onClick={handleReorderByFulfillment}
                title="Sort lots by earliest fulfillment date (HC or BLDR projected)"
                style={{
                  fontSize: 11, padding: '2px 8px', borderRadius: 4,
                  border: '1px solid #D4D2CB', background: '#fff', color: '#6B6B68',
                  cursor: 'pointer', marginLeft: 2,
                }}
              >
                ↕ Sort by date
              </button>
              <button
                onClick={handleReorderByUnit}
                title="Sort lots by unit number"
                style={{
                  fontSize: 11, padding: '2px 8px', borderRadius: 4,
                  border: '1px solid #D4D2CB', background: '#fff', color: '#6B6B68',
                  cursor: 'pointer',
                }}
              >
                ↕ Sort by unit
              </button>
            </>
          )}
          <button
            onClick={() => setShowTimeline(v => !v)}
            style={{
              fontSize: 11, padding: '2px 9px', borderRadius: 4,
              border: `1px solid ${showTimeline ? '#3B6D11' : '#D4D2CB'}`,
              background: showTimeline ? '#EAF3DE' : '#fff',
              color: showTimeline ? '#27500A' : '#6B6B68',
              cursor: 'pointer', marginLeft: 2,
            }}
          >
            {showTimeline ? '▾ Timeline' : '▸ Timeline'}
          </button>
          {showLots && (
            <button
              onClick={() => setLotView(v => v === 'expanded' ? 'condensed' : 'expanded')}
              style={{
                fontSize: 11, padding: '2px 9px', borderRadius: 4,
                border: `1px solid ${condensed ? '#6366f1' : '#D4D2CB'}`,
                background: condensed ? '#eef2ff' : '#fff',
                color: condensed ? '#4338ca' : '#6B6B68',
                cursor: 'pointer', marginLeft: 2,
              }}
            >
              {condensed ? '⊟ Condensed' : '⊞ Condensed'}
            </button>
          )}
          <button
            onClick={() => setShowLots(v => !v)}
            style={{
              fontSize: 11, padding: '2px 9px', borderRadius: 4,
              border: '1px solid #D4D2CB',
              background: '#fff',
              color: '#6B6B68',
              cursor: 'pointer', marginLeft: 2,
            }}
          >
            {showLots ? '▾ Lots' : '▸ Lots'}
          </button>
        </div>

        {/* Status badge */}
        {statusCfg && (
          <div style={{
            flexShrink: 0,
            display: 'inline-flex', alignItems: 'center', gap: 4,
            padding: '3px 9px', borderRadius: 12,
            background: statusCfg.bg, border: `1px solid ${statusCfg.border}`,
          }}>
            <span style={{ fontSize: 12, color: statusCfg.color, lineHeight: 1 }}>{statusCfg.icon}</span>
            <span style={{ fontSize: 11, fontWeight: 700, color: statusCfg.color, letterSpacing: '0.04em' }}>
              {statusCfg.label.toUpperCase()}
            </span>
          </div>
        )}

        {/* Right: Completed + Completed+Planned bars */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 5, minWidth: 240 }}>
          {/* Completed row */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ fontSize: 11, color: overC ? '#A32D2D' : '#888780', whiteSpace: 'nowrap', flexShrink: 0, minWidth: 78 }}>
              Completed
            </span>
            <div style={{ flex: 1, height: 8, background: '#F1EFE8', borderRadius: 3, overflow: 'hidden' }}>
              <div style={{ width: `${cPct}%`, height: '100%', background: overC ? '#E24B4A' : '#444441', borderRadius: 3, transition: 'width 0.2s' }} />
            </div>
            <span style={{ fontSize: 12, fontWeight: 500, color: overC ? '#A32D2D' : '#444441', flexShrink: 0, minWidth: 52, textAlign: 'right' }}>
              {c} of {t}
            </span>
          </div>
          {/* Completed + Planned For row */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ fontSize: 11, color: overTotal ? '#A32D2D' : '#888780', whiteSpace: 'nowrap', flexShrink: 0, minWidth: 78 }}>
              + Planned
            </span>
            <div style={{ flex: 1, height: 8, background: '#F1EFE8', borderRadius: 3, overflow: 'hidden' }}>
              <div style={{ width: `${cpPct}%`, height: '100%', background: overTotal ? '#E24B4A' : '#B4B2A9', borderRadius: 3, transition: 'width 0.2s' }} />
            </div>
            <span style={{ fontSize: 12, fontWeight: 500, color: overTotal ? '#A32D2D' : '#444441', flexShrink: 0, minWidth: 52, textAlign: 'right' }}>
              {plannedTotal} of {t}
            </span>
          </div>
        </div>
      </div>

      {/* Body — outer pad + inner grid capped at 8 columns (8×148 + 7×8 = 1240px) */}
      {showLots && (
        <div style={{ padding: 14, minHeight: 60 }}>
          <div
            ref={gridRef}
            style={{
              display: 'flex', flexWrap: 'wrap', gap: condensed ? 6 : 14, alignItems: 'stretch',
              maxWidth: 1330,
              opacity: sortFlash ? 0.5 : 1,
              transition: `opacity ${sortFlash ? '0.06s' : '0.32s'} ease-in-out`,
            }}
          >
            {buildClusters(displayLots).map((cluster) => {
              if (cluster.type === 'solo') {
                const a = cluster.lot
                const idx = displayLots.indexOf(a)
                return (
                  <LotPill
                    key={a.assignment_id}
                    assignment={a}
                    isExcess={idx >= total - excess}
                    checkpointDate={localDate}
                    condensed={condensed}
                    isSelected={selectedAssignedLotIds?.has(a.lot_id)}
                    onContextMenu={onContextMenu ? (e) => { e.preventDefault(); onContextMenu(e, 'assigned', a.lot_id) } : undefined}
                    onDateChange={(key, val) => onDateChange(a.assignment_id, { [key]: val })}
                    onLockChange={(key, val) => onLockChange(a.assignment_id, { [key]: val })}
                  />
                )
              }
              // Building group cluster — stays together on one row, stitched visually
              return (
                <div key={`grp-${cluster.bgId}`} style={{ display: 'flex', flexShrink: 0, alignItems: 'stretch' }}>
                  {cluster.lots.flatMap((a, pi) => {
                    const idx = displayLots.indexOf(a)
                    const items = []
                    if (pi > 0) items.push(<StitchConnector key={`stitch-${a.assignment_id}`} />)
                    items.push(
                      <LotPill
                        key={a.assignment_id}
                        assignment={a}
                        isExcess={idx >= total - excess}
                        checkpointDate={localDate}
                        condensed={condensed}
                        isSelected={selectedAssignedLotIds?.has(a.lot_id)}
                        onContextMenu={onContextMenu ? (e) => { e.preventDefault(); onContextMenu(e, 'assigned', a.lot_id) } : undefined}
                        onDateChange={(key, val) => onDateChange(a.assignment_id, { [key]: val })}
                        onLockChange={(key, val) => onLockChange(a.assignment_id, { [key]: val })}
                      />
                    )
                    return items
                  })}
                </div>
              )
            })}
            {Array.from({ length: slotCount }).map((_, i) => (
              <PlaceholderPill key={`ph-${i}`} daysToCP={daysToCP} condensed={condensed} />
            ))}
          </div>
        </div>
      )}

      {/* Timeline chart — toggled from checkpoint header */}
      {showTimeline && (
        <CheckpointTimeline lots={displayLots} slotCount={slotCount} checkpointDate={localDate} lotsRequired={t} />
      )}
    </div>
  )
}
