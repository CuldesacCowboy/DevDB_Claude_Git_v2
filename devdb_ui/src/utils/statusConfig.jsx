// statusConfig.js
// Single source of truth for pipeline status visual identity.
// Used in SimulationView (ledger table, graph, lot list), LotCard, and anywhere
// else a lot pipeline status is displayed.
//
// Pipeline order: P → E → D → H → U → UC → C → OUT

export const STATUS_CFG = {
  P:   { color: '#78716c', bg: '#fafaf9', border: '#e7e5e4', shape: '○', label: 'Paper' },
  E:   { color: '#92400e', bg: '#fffbeb', border: '#fde68a', shape: '◇', label: 'Entitled' },
  D:   { color: '#44403c', bg: '#f5f5f4', border: '#d6d3d1', shape: '▪', label: 'Developed' },
  H:   { color: '#c2410c', bg: '#fff7ed', border: '#fed7aa', shape: '⏸', label: 'Held' },
  U:   { color: '#6d28d9', bg: '#f5f3ff', border: '#ddd6fe', shape: '□', label: 'Unstarted' },
  UC:  { color: '#0369a1', bg: '#eff6ff', border: '#bfdbfe', shape: '◑', label: 'Under Construction' },
  C:   { color: '#065f46', bg: '#ecfdf5', border: '#a7f3d0', shape: '●', label: 'Complete' },
  OUT: { color: '#374151', bg: '#f8fafc', border: '#e2e8f0', shape: '✓', label: 'Closed' },
}

// Ordered for stacked charts and sequential display
export const STATUS_ORDER = ['P', 'E', 'D', 'H', 'U', 'UC', 'C', 'OUT']

// Flat color map for recharts and other consumers that just need the color
export const STATUS_COLOR = Object.fromEntries(
  Object.entries(STATUS_CFG).map(([k, v]) => [k, v.color])
)

/**
 * Inline status badge — shape + letter, styled in the status color.
 *
 * pill=false (default): colored text only, no background — for table cells, tight spaces
 * pill=true:            light background pill — for standalone display
 */
export function StatusBadge({ status, pill = false }) {
  const cfg = STATUS_CFG[status] ?? { color: '#6b7280', bg: '#f3f4f6', border: '#e5e7eb', shape: '·', label: status }
  if (!pill) {
    return (
      <span style={{ color: cfg.color, fontWeight: 700, whiteSpace: 'nowrap', letterSpacing: '0.01em' }}>
        {cfg.shape} {status}
      </span>
    )
  }
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 4,
      padding: '2px 7px', borderRadius: 10,
      background: cfg.bg,
      border: `1px solid ${cfg.border}`,
      color: cfg.color,
      fontWeight: 700, fontSize: 11, whiteSpace: 'nowrap',
      letterSpacing: '0.01em',
    }}>
      {cfg.shape} {status}
    </span>
  )
}
