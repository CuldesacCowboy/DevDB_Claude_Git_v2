import { useState, useEffect } from 'react'
import { useDraggable } from '@dnd-kit/core'
import { fmt, shortLot, parseLot } from '../utils/tdaUtils'
import { PANEL_HEADER_BG, PANEL_BORDER, EDITOR_BORDER, EDITOR_BG, EDITOR_TEXT, TEXT_MUTED, DIVIDER_MED } from '../utils/designTokens'

// ── Parse a free-form date string → ISO YYYY-MM-DD (or null) ─────
// Accepts: MM/DD/YY, MM/DD/YYYY, M/D/YY, YYYY-MM-DD
function parseDate(str) {
  if (!str) return null
  const s = str.trim()
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    const d = new Date(s + 'T12:00:00')
    return isNaN(d.getTime()) ? null : s
  }
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/)
  if (m) {
    let year = parseInt(m[3], 10)
    if (year < 100) year += 2000
    const month = parseInt(m[1], 10)
    const day   = parseInt(m[2], 10)
    if (month < 1 || month > 12 || day < 1 || day > 31) return null
    const iso = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
    const d = new Date(iso + 'T12:00:00')
    return isNaN(d.getTime()) ? null : iso
  }
  return null
}

// ── Lock icon (SVG) ───────────────────────────────────────────────
export function LockIcon({ locked }) {
  const color = locked ? '#D97706' : DIVIDER_MED
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
// Click-to-edit text input. Accepts MM/DD/YY, MM/DD/YYYY, YYYY-MM-DD.
// Enter or blur commits; Escape cancels. Invalid input is discarded.
export function ProjectedDateField({ value, locked, onChange }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')

  // Keep draft in sync when server value changes while not editing
  useEffect(() => {
    if (!editing) setDraft(value ? fmt(value) : '')
  }, [value, editing])

  function startEdit() {
    setDraft(value ? fmt(value) : '')
    setEditing(true)
  }

  function commit(raw) {
    const s = (raw || '').trim()
    if (!s) {
      onChange(null)
    } else {
      const parsed = parseDate(s)
      if (parsed) onChange(parsed)
      // invalid input: silently discard (field reverts to server value on next render)
    }
    setEditing(false)
  }

  if (locked) {
    return (
      <div style={{
        fontSize: 12,
        fontWeight: 600,
        color: '#78350F',
        background: '#FEF3C7',
        border: '1px solid #FCD34D',
        borderRadius: 3,
        padding: '2px 4px',
        lineHeight: '1.3',
        whiteSpace: 'nowrap',
      }}>
        {fmt(value) || '—'}
      </div>
    )
  }

  if (editing) {
    return (
      <input
        autoFocus
        type="text"
        placeholder="MM/DD/YY"
        value={draft}
        onChange={e => setDraft(e.target.value)}
        onBlur={e => commit(e.target.value)}
        onKeyDown={e => {
          if (e.key === 'Enter') { e.preventDefault(); commit(draft) }
          if (e.key === 'Escape') setEditing(false)
        }}
        style={{
          fontSize: 12, width: '100%', boxSizing: 'border-box',
          border: `1px solid ${EDITOR_BORDER}`,
          background: EDITOR_BG, color: EDITOR_TEXT,
          borderRadius: 3, padding: '2px 4px',
          outline: 'none', lineHeight: '1.3',
        }}
      />
    )
  }

  return (
    <div
      onClick={startEdit}
      title="Click to edit date (MM/DD/YY)"
      style={{
        fontSize: 12, color: EDITOR_TEXT,
        border: `1px dashed ${EDITOR_BORDER}`,
        background: EDITOR_BG,
        borderRadius: 3,
        padding: '2px 4px',
        lineHeight: '1.3',
        cursor: 'pointer',
        userSelect: 'none',
        whiteSpace: 'nowrap',
      }}
    >
      {fmt(value) || '—'}
    </div>
  )
}

// ── Stitch connector between building-group pills ────────────────
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
export function PlaceholderPill({ daysToCP, condensed = false }) {
  let state = 'normal'
  if (daysToCP !== null) {
    if (daysToCP < 0) state = 'missed'
    else if (daysToCP <= 30) state = 'urgent'
  }
  const cfg = {
    normal: { bg: 'transparent',  border: `1.5px dashed ${TEXT_MUTED}`, icon: '○', iconColor: DIVIDER_MED, label: null },
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
      width: 180, flexShrink: 0, borderRadius: 6,
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
export default function LotPill({
  assignment, onDateChange, onLockChange,
  isExcess = false, checkpointDate = '',
  condensed = false, isSelected = false,
  onContextMenu, showDig = false,
}) {
  const { attributes, listeners, setNodeRef, isDragging } =
    useDraggable({
      id: `assigned-${assignment.assignment_id}`,
      data: { type: 'assigned-lot', assignment },
    })

  const [localHcDate,   setLocalHcDate]   = useState(assignment.hc_projected_date   || '')
  const [localBldrDate, setLocalBldrDate] = useState(assignment.bldr_projected_date || '')
  const [localDigDate,  setLocalDigDate]  = useState(assignment.dig_projected_date  || '')

  useEffect(() => { setLocalHcDate(assignment.hc_projected_date     || '') }, [assignment.hc_projected_date])
  useEffect(() => { setLocalBldrDate(assignment.bldr_projected_date || '') }, [assignment.bldr_projected_date])
  useEffect(() => { setLocalDigDate(assignment.dig_projected_date   || '') }, [assignment.dig_projected_date])

  const todayStr = new Date().toISOString().slice(0, 10)
  const isFuture = (d) => !!d && d > todayStr
  const cpIsPast = !!checkpointDate && checkpointDate <= todayStr
  const hcMeetsCP   = !!localHcDate   && localHcDate   <= checkpointDate
  const bldrMeetsCP = !!localBldrDate && localBldrDate <= checkpointDate
  const neitherMeets = !hcMeetsCP && !bldrMeetsCP
  const isDelinquent = !!checkpointDate && cpIsPast && neitherMeets
  const hasAnyFutureDate = isFuture(localHcDate) || isFuture(localBldrDate)
  const isCaution = !!checkpointDate && !cpIsPast && hasAnyFutureDate && neitherMeets
  const hasNoDates = !localHcDate && !localBldrDate && !isDelinquent && !isCaution

  // ── Condensed view ───────────────────────────────────────────────
  if (condensed) {
    const { code, seq } = parseLot(assignment.lot_number)
    const codeColor = isExcess ? '#E24B4A' : isDelinquent ? '#dc2626' : isCaution ? '#D97706' : TEXT_MUTED
    return (
      <div
        ref={setNodeRef}
        {...attributes}
        {...listeners}
        onContextMenu={onContextMenu}
        style={{
          width: 68, height: 34, flexShrink: 0,
          background: isSelected ? '#dbeafe' : isExcess ? '#FFF0F0' : isDelinquent ? '#fee2e2' : isCaution ? '#FEF3C7' : hasNoDates ? '#EEECEA' : '#FAFAF8',
          border: isSelected ? '2px solid #2563eb' : isExcess ? '1.5px dashed #E24B4A' : isDelinquent ? '1.5px solid #dc2626' : isCaution ? '1.5px dashed #D97706' : hasNoDates ? `1px dashed #C8C6BE` : `1px solid ${PANEL_BORDER}`,
          borderRadius: 5,
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '0 6px', boxSizing: 'border-box',
          cursor: 'grab', opacity: isDragging ? 0.4 : 1,
        }}
      >
        <span style={{ fontSize: 11, color: isSelected ? '#1d4ed8' : codeColor, flexShrink: 0 }}>{code}</span>
        <span style={{ fontSize: 12, fontWeight: 500, color: '#2C2C2A' }}>{seq}</span>
      </div>
    )
  }

  // ── Date column helper ────────────────────────────────────────────
  // setLocal: setter for the local optimistic state for this field
  function col(label, marksDate, projDate, isLocked, dateKey, lockKey, setLocal) {
    return (
      <div style={{
        flex: 1, minWidth: 0, overflow: 'hidden',
        // Locked visual treatment: amber column background
        background: isLocked ? '#FFFBEB' : 'transparent',
        border: isLocked ? '1px solid #FCD34D' : '1px solid transparent',
        borderRadius: isLocked ? 4 : 0,
        padding: isLocked ? '3px 5px 4px' : '0',
        boxSizing: 'border-box',
      }}>
        {/* Label row: label + sync-to-marks button + lock button */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 3 }}>
          <span style={{
            fontSize: 11, textTransform: 'uppercase',
            color: isLocked ? '#92400E' : TEXT_MUTED,
            letterSpacing: '0.04em',
            fontWeight: isLocked ? 700 : 400,
          }}>
            {label}
          </span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            {marksDate && (
              <button
                title="Set projected date to MARKsystems date and lock"
                onClick={() => {
                  setLocal(marksDate)
                  onDateChange(dateKey, marksDate)
                  onLockChange(lockKey, true)
                }}
                style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '0 1px', lineHeight: 1, display: 'inline-flex', alignItems: 'center' }}
              >
                <svg width="11" height="11" viewBox="0 0 12 12" fill="none">
                  <path d="M10 6A4 4 0 1 1 8.5 2.8" stroke={DIVIDER_MED} strokeWidth="1.5" strokeLinecap="round"/>
                  <polyline points="8.5,1 8.5,3 10.5,3" stroke={DIVIDER_MED} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              </button>
            )}
            <LockBtn locked={isLocked} onClick={() => onLockChange(lockKey, !isLocked)} />
          </div>
        </div>

        {/* MARKS date — paddingLeft:4 aligns left edge with projected date field */}
        <div style={{
          fontSize: 12,
          color: isLocked ? '#92400E' : DIVIDER_MED,
          marginBottom: 4,
          paddingLeft: 4,
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
        }}>
          {fmt(marksDate)}
        </div>

        {/* User-entry projected date */}
        <ProjectedDateField
          value={projDate}
          locked={isLocked}
          onChange={(val) => {
            setLocal(val || '')
            onDateChange(dateKey, val)
          }}
        />
      </div>
    )
  }

  // Winning fulfillment date: earliest of HC, BLDR, DIG projected dates
  const winningDate = (() => {
    const dates = [localHcDate, localBldrDate, localDigDate].filter(Boolean)
    return dates.length ? dates.reduce((m, d) => d < m ? d : m) : null
  })()

  return (
    <div
      ref={setNodeRef}
      onContextMenu={onContextMenu}
      style={{
        width: 180, flexShrink: 0,
        borderRadius: 6, overflow: 'hidden',
        background: isSelected ? '#eff6ff' : isExcess ? '#FFF5F5' : isDelinquent ? '#fef2f2' : isCaution ? '#FFFBEB' : hasNoDates ? '#F7F6F3' : '#fff',
        border: isSelected ? '2px solid #2563eb' : isExcess ? '1.5px dashed #E24B4A' : isDelinquent ? '1.5px solid #dc2626' : isCaution ? '1.5px dashed #D97706' : hasNoDates ? '1px dashed #C8C6BE' : '1px solid #E4E2DA',
        opacity: isDragging ? 0.4 : 1,
        boxShadow: isSelected ? '0 0 0 2px #bfdbfe' : '0 1px 2px rgba(0,0,0,0.06)',
        display: 'flex', flexDirection: 'column',
      }}
    >
      {/* Drag handle / header */}
      <div
        {...attributes}
        {...listeners}
        style={{
          textAlign: 'center',
          padding: '5px 8px 6px',
          cursor: 'grab',
          background: isSelected ? '#dbeafe' : isExcess ? '#FFF0F0' : isDelinquent ? '#fee2e2' : isCaution ? '#FEF3C7' : hasNoDates ? '#EEECEA' : '#FAFAF8',
          borderBottom: `1px solid ${isSelected ? '#93c5fd' : isExcess ? '#FFCCC9' : isDelinquent ? '#fecaca' : isCaution ? '#FDE68A' : hasNoDates ? '#DDDBD3' : PANEL_HEADER_BG}`,
          userSelect: 'none',
        }}
      >
        <div style={{ fontSize: 14, fontWeight: 700, color: '#2C2C2A', lineHeight: 1.2 }}>
          {shortLot(assignment.lot_number)}
        </div>
        {winningDate ? (
          <div style={{ fontSize: 11, color: TEXT_MUTED, marginTop: 2, lineHeight: 1 }}>
            {fmt(winningDate)}
          </div>
        ) : (
          <div style={{ fontSize: 11, color: '#D4D2CB', marginTop: 2, lineHeight: 1 }}>—</div>
        )}
      </div>

      {/* HC + BLDR columns */}
      <div style={{ display: 'flex', padding: '6px 8px', gap: 4 }}>
        {col('HC',
          assignment.hc_marks_date,   localHcDate,   assignment.hc_is_locked,
          'hc_projected_date',   'hc_is_locked',   setLocalHcDate)}
        <div style={{ width: 1, background: PANEL_HEADER_BG, flexShrink: 0 }} />
        {col('BLDR',
          assignment.bldr_marks_date, localBldrDate, assignment.bldr_is_locked,
          'bldr_projected_date', 'bldr_is_locked', setLocalBldrDate)}
      </div>

      {/* DIG expansion — shown when showDig && !condensed */}
      {showDig && (
        <>
          <div style={{ height: 1, background: PANEL_HEADER_BG, margin: '0 8px' }} />
          <div style={{ padding: '4px 8px 6px' }}>
            {col('DIG',
              assignment.dig_marks_date,  localDigDate,  assignment.dig_is_locked,
              'dig_projected_date',  'dig_is_locked',  setLocalDigDate)}
          </div>
        </>
      )}
    </div>
  )
}
