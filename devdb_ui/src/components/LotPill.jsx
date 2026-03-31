import { useState, useRef, useEffect } from 'react'
import { useDraggable } from '@dnd-kit/core'
import { fmt, shortLot, parseLot } from '../utils/tdaUtils'

// ── Lock icon (SVG) — neutral gray, no amber ─────────────────────
export function LockIcon({ locked }) {
  const color = locked ? '#444441' : '#B4B2A9'
  return locked ? (
    <svg width="13" height="15" viewBox="0 0 10 12" fill="none">
      <rect x="1" y="5.5" width="8" height="6" rx="1.5" fill={color} />
      <path d="M3 5.5V4a2 2 0 0 1 4 0v1.5" stroke={color} strokeWidth="1.4" strokeLinecap="round" fill="none" />
    </svg>
  ) : (
    <svg width="13" height="15" viewBox="0 0 10 12" fill="none">
      <rect x="1" y="5.5" width="8" height="6" rx="1.5" fill={color} />
      <path d="M3 5.5V4a2 2 0 0 1 4 0" stroke={color} strokeWidth="1.4" strokeLinecap="round" fill="none" />
    </svg>
  )
}

// ── Lock button ───────────────────────────────────────────────────
export function LockBtn({ locked, onClick }) {
  return (
    <button
      onClick={onClick}
      style={{
        background: 'none', border: 'none', cursor: 'pointer',
        padding: '0 1px', lineHeight: 1,
        display: 'inline-flex', alignItems: 'center',
      }}
    >
      <LockIcon locked={locked} />
    </button>
  )
}

// ── Projected date field ──────────────────────────────────────────
export function ProjectedDateField({ value, locked, onChange }) {
  const inputRef = useRef(null)
  const [pending, setPending] = useState(value || '')
  const pendingRef = useRef(value || '')
  const timerRef = useRef(null)

  useEffect(() => {
    // When server value changes, cancel any pending commit and sync display
    if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null }
    setPending(value || '')
    pendingRef.current = value || ''
  }, [value])

  if (locked) {
    return (
      <div style={{
        fontSize: 12, color: '#444441',
        pointerEvents: 'none',
        padding: '2px 4px',
      }}>
        {fmt(value) || '—'}
      </div>
    )
  }
  return (
    <div
      style={{ position: 'relative' }}
      onClick={() => inputRef.current?.showPicker?.()}
    >
      <div style={{
        fontSize: 12, color: '#27500A',
        border: '1px dashed #3B6D11',
        background: '#EAF3DE',
        borderRadius: 3,
        padding: '2px 4px',
        lineHeight: '1.3',
        cursor: 'pointer',
        userSelect: 'none',
        overflow: 'hidden', whiteSpace: 'nowrap',
      }}>
        {fmt(pending) || '—'}
      </div>
      <input
        ref={inputRef}
        type="date"
        value={pending}
        onChange={(e) => {
          const val = e.target.value
          setPending(val)
          pendingRef.current = val
          // Debounce: with pointerEvents:none, blur fires before change in Chrome.
          // Using onChange as primary commit (350ms) handles that race correctly.
          if (timerRef.current) clearTimeout(timerRef.current)
          timerRef.current = setTimeout(() => {
            timerRef.current = null
            onChange(pendingRef.current || null)
          }, 350)
        }}
        onBlur={() => {
          // Flush immediately if a debounced commit is pending
          if (timerRef.current) {
            clearTimeout(timerRef.current)
            timerRef.current = null
            onChange(pendingRef.current || null)
          }
        }}
        style={{
          position: 'absolute', inset: 0,
          width: '100%', height: '100%',
          opacity: 0, cursor: 'default',
          border: 'none', padding: 0, margin: 0,
          pointerEvents: 'none',
        }}
      />
    </div>
  )
}

// ── Stitch connector between building-group pills ────────────────
// A narrow panel with a center-track + crossbar SVG pattern that implies
// units are sewn together.
export function StitchConnector() {
  const w = 14
  const crossbarSvg = encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="12">` +
    `<line x1="${w / 2}" y1="0" x2="${w / 2}" y2="12" stroke="#C8C6BE" stroke-width="1.5"/>` +
    `<line x1="2" y1="3" x2="${w - 2}" y2="3" stroke="#C8C6BE" stroke-width="1.5"/>` +
    `<line x1="2" y1="9" x2="${w - 2}" y2="9" stroke="#C8C6BE" stroke-width="1.5"/>` +
    `</svg>`
  )
  return (
    <div style={{
      width: w,
      flexShrink: 0,
      alignSelf: 'stretch',
      backgroundImage: `url("data:image/svg+xml,${crossbarSvg}")`,
      backgroundRepeat: 'repeat-y',
      backgroundSize: `${w}px 12px`,
      backgroundPositionX: 'center',
    }} />
  )
}

// ── Placeholder slot pill ─────────────────────────────────────────
// State: normal (>30d), urgent (≤30d), missed (<0d)
export function PlaceholderPill({ daysToCP, condensed = false }) {
  let state = 'normal'
  if (daysToCP !== null) {
    if (daysToCP < 0) state = 'missed'
    else if (daysToCP <= 30) state = 'urgent'
  }
  const cfg = {
    normal: { bg: 'transparent',  border: '1.5px dashed #888780', icon: '○', iconColor: '#B4B2A9', label: null },
    urgent: { bg: '#FFF3CD',      border: '1.5px dashed #BA7517', icon: '⚠', iconColor: '#854F0B', label: `${daysToCP} DAYS` },
    missed: { bg: '#FCEBEB',      border: '1.5px dashed #A32D2D', icon: '✕', iconColor: '#A32D2D', label: 'PAST DUE' },
  }[state]

  if (condensed) {
    return (
      <div style={{
        width: 68, height: 34, flexShrink: 0, borderRadius: 5,
        background: cfg.bg, border: cfg.border,
        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4,
      }}>
        <span style={{ fontSize: 14, color: cfg.iconColor, lineHeight: 1 }}>{cfg.icon}</span>
        {cfg.label && (
          <span style={{ fontSize: 9, color: cfg.iconColor, fontWeight: 700, letterSpacing: '0.04em' }}>
            {cfg.label}
          </span>
        )}
      </div>
    )
  }

  return (
    <div style={{
      width: 148, flexShrink: 0, borderRadius: 6,
      background: cfg.bg, border: cfg.border,
      display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center',
      padding: '12px 8px', minHeight: 88,
    }}>
      <span style={{ fontSize: 22, color: cfg.iconColor, lineHeight: 1 }}>
        {cfg.icon}
      </span>
      {cfg.label && (
        <span style={{ fontSize: 11, color: cfg.iconColor, marginTop: 5, letterSpacing: '0.05em', fontWeight: 600 }}>
          {cfg.label}
        </span>
      )}
    </div>
  )
}

// ── Lot pill inside a checkpoint ──────────────────────────────────
export default function LotPill({ assignment, onDateChange, onLockChange, isExcess = false, checkpointDate = '', condensed = false }) {
  const { attributes, listeners, setNodeRef, isDragging } =
    useDraggable({
      id: `assigned-${assignment.assignment_id}`,
      data: { type: 'assigned-lot', assignment },
    })

  // Local projected date state for instant caution recompute (no refetch needed)
  const [localHcDate, setLocalHcDate] = useState(assignment.hc_projected_date || '')
  const [localBldrDate, setLocalBldrDate] = useState(assignment.bldr_projected_date || '')
  useEffect(() => { setLocalHcDate(assignment.hc_projected_date || '') }, [assignment.hc_projected_date])
  useEffect(() => { setLocalBldrDate(assignment.bldr_projected_date || '') }, [assignment.bldr_projected_date])

  const todayStr = new Date().toISOString().slice(0, 10)
  const isFuture = (d) => !!d && d > todayStr
  const cpIsPast = !!checkpointDate && checkpointDate <= todayStr
  const hcMeetsCP = !!localHcDate && localHcDate <= checkpointDate
  const bldrMeetsCP = !!localBldrDate && localBldrDate <= checkpointDate
  const neitherMeets = !hcMeetsCP && !bldrMeetsCP
  // Delinquent: checkpoint passed and this lot has no projected date on/before it
  const isDelinquent = !!checkpointDate && cpIsPast && neitherMeets
  // Caution: future checkpoint only — if it were past it would be delinquent instead
  const hasAnyFutureDate = isFuture(localHcDate) || isFuture(localBldrDate)
  const isCaution = !!checkpointDate && !cpIsPast && hasAnyFutureDate && neitherMeets
  // No dates: neither projected date entered (and not already flagged by a higher-priority state)
  const hasNoDates = !localHcDate && !localBldrDate && !isDelinquent && !isCaution

  // ── Condensed view ───────────────────────────────────────────────
  if (condensed) {
    const { code, seq } = parseLot(assignment.lot_number)
    const codeColor = isExcess ? '#E24B4A' : isDelinquent ? '#dc2626' : isCaution ? '#D97706' : '#888780'
    return (
      <div
        ref={setNodeRef}
        {...attributes}
        {...listeners}
        style={{
          width: 68, height: 34, flexShrink: 0,
          background: isExcess ? '#FFF0F0' : isDelinquent ? '#fee2e2' : isCaution ? '#FEF3C7' : hasNoDates ? '#EEECEA' : '#FAFAF8',
          border: isExcess ? '1.5px dashed #E24B4A' : isDelinquent ? '1.5px solid #dc2626' : isCaution ? '1.5px dashed #D97706' : hasNoDates ? '1px dashed #C8C6BE' : '1px solid #E4E2DA',
          borderRadius: 5,
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '0 6px', boxSizing: 'border-box',
          cursor: 'grab', opacity: isDragging ? 0.4 : 1,
        }}
      >
        <span style={{ fontSize: 11, color: codeColor, flexShrink: 0 }}>{code}</span>
        <span style={{ fontSize: 12, fontWeight: 500, color: '#2C2C2A' }}>{seq}</span>
      </div>
    )
  }

  function col(label, marksDate, projDate, isLocked, dateKey, lockKey) {
    return (
      <div style={{ flex: 1, minWidth: 0, overflow: 'hidden' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 3 }}>
          <span style={{ fontSize: 11, textTransform: 'uppercase', color: '#888780', letterSpacing: '0.04em' }}>
            {label}
          </span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            {marksDate && (
              <button
                title="Set projected date to MARKsystems date and lock"
                onClick={() => {
                  if (dateKey === 'hc_projected_date') setLocalHcDate(marksDate)
                  if (dateKey === 'bldr_projected_date') setLocalBldrDate(marksDate)
                  onDateChange(dateKey, marksDate); onLockChange(lockKey, true)
                }}
                style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '0 1px', lineHeight: 1, display: 'inline-flex', alignItems: 'center' }}
              >
                <svg width="11" height="11" viewBox="0 0 12 12" fill="none">
                  <path d="M10 6A4 4 0 1 1 8.5 2.8" stroke="#B4B2A9" strokeWidth="1.5" strokeLinecap="round"/>
                  <polyline points="8.5,1 8.5,3 10.5,3" stroke="#B4B2A9" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              </button>
            )}
            <LockBtn locked={isLocked} onClick={() => onLockChange(lockKey, !isLocked)} />
          </div>
        </div>
        <div style={{ fontSize: 12, color: '#B4B2A9', marginBottom: 4, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {fmt(marksDate)}
        </div>
        <ProjectedDateField
          value={projDate}
          locked={isLocked}
          onChange={(val) => {
            if (dateKey === 'hc_projected_date') setLocalHcDate(val || '')
            if (dateKey === 'bldr_projected_date') setLocalBldrDate(val || '')
            onDateChange(dateKey, val)
          }}
        />
      </div>
    )
  }

  // Winning fulfillment date: earlier of HC and BLDR projected dates
  const winningDate = (() => {
    const dates = [localHcDate, localBldrDate].filter(Boolean)
    return dates.length ? dates.reduce((m, d) => d < m ? d : m) : null
  })()

  return (
    <div
      ref={setNodeRef}
      style={{
        width: 148, flexShrink: 0,
        borderRadius: 6, overflow: 'hidden',
        background: isExcess ? '#FFF5F5' : isDelinquent ? '#fef2f2' : isCaution ? '#FFFBEB' : hasNoDates ? '#F7F6F3' : '#fff',
        border: isExcess ? '1.5px dashed #E24B4A' : isDelinquent ? '1.5px solid #dc2626' : isCaution ? '1.5px dashed #D97706' : hasNoDates ? '1px dashed #C8C6BE' : '1px solid #E4E2DA',
        opacity: isDragging ? 0.4 : 1,
        boxShadow: '0 1px 2px rgba(0,0,0,0.06)',
        display: 'flex', flexDirection: 'column',
      }}
    >
      <div
        {...attributes}
        {...listeners}
        style={{
          textAlign: 'center',
          padding: '5px 8px 6px',
          cursor: 'grab',
          background: isExcess ? '#FFF0F0' : isDelinquent ? '#fee2e2' : isCaution ? '#FEF3C7' : hasNoDates ? '#EEECEA' : '#FAFAF8',
          borderBottom: `1px solid ${isExcess ? '#FFCCC9' : isDelinquent ? '#fecaca' : isCaution ? '#FDE68A' : hasNoDates ? '#DDDBD3' : '#F0EEE8'}`,
          userSelect: 'none',
        }}
      >
        <div style={{ fontSize: 14, fontWeight: 700, color: '#2C2C2A', lineHeight: 1.2 }}>
          {shortLot(assignment.lot_number)}
        </div>
        {winningDate ? (
          <div style={{ fontSize: 11, color: '#888780', marginTop: 2, lineHeight: 1 }}>
            {fmt(winningDate)}
          </div>
        ) : (
          <div style={{ fontSize: 11, color: '#D4D2CB', marginTop: 2, lineHeight: 1 }}>—</div>
        )}
      </div>
      <div style={{ display: 'flex', padding: '6px 8px', gap: 4 }}>
        {col('HC',
          assignment.hc_marks_date, assignment.hc_projected_date,
          assignment.hc_is_locked, 'hc_projected_date', 'hc_is_locked')}
        <div style={{ width: 1, background: '#F0EEE8', flexShrink: 0 }} />
        {col('BLDR',
          assignment.bldr_marks_date, assignment.bldr_projected_date,
          assignment.bldr_is_locked, 'bldr_projected_date', 'bldr_is_locked')}
      </div>
    </div>
  )
}
