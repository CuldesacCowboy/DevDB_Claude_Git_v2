// OverrideDateCell.jsx — displays a pipeline date with provenance pill.
// Three sources: MARKS (gray), SIM (blue), Override (amber).

import { useState } from 'react'
import { PROV } from '../simulation/simShared'
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
  isSim = false,    // true for sim lots — dates are engine-set, style as projected
}) {
  const [open, setOpen] = useState(false)

  const hasOverride  = !!overrideValue
  const displayValue = overrideValue || marksValue
  const isProjected  = !displayValue && !!projectedValue

  // Determine provenance
  const source = hasOverride ? 'override' : (isProjected || isSim) ? 'sim' : 'marks'
  const p = PROV[source]

  const style = {
    cursor: disabled ? 'default' : 'pointer',
    padding: '1px 7px',
    borderRadius: 9,
    fontSize: 11,
    fontWeight: 600,
    display: 'inline-block',
    userSelect: 'none',
    background: p.bg,
    border: `1px solid ${p.border}`,
    color: p.color,
  }

  const shown = displayValue ? fmt(displayValue) : isProjected ? fmt(projectedValue) : null

  return (
    <span style={{ position: 'relative', display: 'inline-block' }}>
      <span
        style={style}
        title={hasOverride
          ? `Override: ${fmt(overrideValue)} | MARKS: ${fmt(marksValue) ?? '—'}`
          : source === 'sim' ? 'Engine projection' : 'MARKS actual'}
        onClick={() => { if (!disabled) setOpen(o => !o) }}
      >
        {shown ?? <span style={{ color: '#d1d5db' }}>—</span>}
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
