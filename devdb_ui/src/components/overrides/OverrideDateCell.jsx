// OverrideDateCell.jsx — displays a pipeline date with override indicator.
// Amber = active override. Click to open entry popover.

import { useState } from 'react'
import OverrideEntryPopover from './OverrideEntryPopover'

const fmt = d => d ? new Date(d + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' }) : null

export default function OverrideDateCell({
  lotId,
  dateField,
  label,
  marksValue,       // from sim_lots (MARKS actual)
  projectedValue,   // engine projection
  overrideValue,    // from sim_lot_date_overrides (null if no override)
  onApply,          // async fn(lotId, changes[]) => void
  onClear,          // async fn(lotId, dateField) => void
  disabled = false,
}) {
  const [open, setOpen] = useState(false)

  const hasOverride  = !!overrideValue
  const displayValue = overrideValue || marksValue
  const isProjected  = !displayValue && !!projectedValue

  const style = {
    cursor: disabled ? 'default' : 'pointer',
    padding: '2px 4px',
    borderRadius: 3,
    fontSize: 12,
    display: 'inline-block',
    userSelect: 'none',
    ...(hasOverride
      ? { color: '#92400e', background: '#fef3c7', fontWeight: 600 }
      : isProjected
        ? { color: '#93c5fd', fontStyle: 'italic' }
        : { color: '#111827' }
    ),
  }

  const shown = displayValue ? fmt(displayValue) : isProjected ? fmt(projectedValue) : null

  return (
    <span style={{ position: 'relative', display: 'inline-block' }}>
      <span
        style={style}
        title={hasOverride ? `Override: ${fmt(overrideValue)} | MARKS: ${fmt(marksValue) ?? '—'}` : undefined}
        onClick={() => { if (!disabled) setOpen(o => !o) }}
      >
        {shown ?? <span style={{ color: '#e5e7eb' }}>—</span>}
        {hasOverride && <span style={{ fontSize: 9, marginLeft: 3, verticalAlign: 'super' }}>●</span>}
      </span>

      {open && (
        <OverrideEntryPopover
          lotId={lotId}
          dateField={dateField}
          label={label}
          marksValue={marksValue}
          currentOverride={overrideValue}
          onApply={async (changes) => {
            await onApply(lotId, changes)
            setOpen(false)
          }}
          onClear={async () => {
            await onClear(lotId, dateField)
            setOpen(false)
          }}
          onClose={() => setOpen(false)}
        />
      )}
    </span>
  )
}
