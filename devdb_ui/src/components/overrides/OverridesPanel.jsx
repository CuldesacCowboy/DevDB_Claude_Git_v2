// OverridesPanel.jsx — full list of active overrides with clear + export actions.

const fmt = d => d ? new Date(d + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' }) : '—'
const sign = n => n != null ? (n > 0 ? `+${n}d` : n < 0 ? `${n}d` : '±0') : null

function deltaColor(n) {
  if (n == null) return '#6b7280'
  if (n > 0) return '#b45309'
  if (n < 0) return '#15803d'
  return '#6b7280'
}

export default function OverridesPanel({ overrides, onClear, onClearAll, onExport, onCheckReconciliation, loading }) {
  if (loading) return <div style={{ color: '#6b7280', fontSize: 12, padding: 16 }}>Loading…</div>

  if (!overrides.length) return (
    <div style={{ color: '#9ca3af', fontSize: 13, padding: 24, textAlign: 'center' }}>
      No active overrides. Click any date in the lot ledger or Planning view to set one.
    </div>
  )

  const delta = (ov) => {
    if (!ov.override_value || !ov.current_marks) return null
    const d1 = new Date(ov.override_value)
    const d2 = new Date(ov.current_marks)
    return Math.round((d1 - d2) / 86400000)
  }

  const grouped = {}
  for (const ov of overrides) {
    const key = ov.dev_name || 'Unknown'
    if (!grouped[key]) grouped[key] = []
    grouped[key].push(ov)
  }

  return (
    <div style={{ fontSize: 12 }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 12 }}>
        <span style={{ fontWeight: 600, color: '#111827', fontSize: 13 }}>
          {overrides.length} active override{overrides.length !== 1 ? 's' : ''}
        </span>
        <button
          onClick={onExport}
          style={{ fontSize: 11, padding: '3px 10px', borderRadius: 4,
            border: '1px solid #d1d5db', background: '#fff', cursor: 'pointer', color: '#374151' }}
        >
          Export ITK changes
        </button>
        <button
          onClick={onCheckReconciliation}
          style={{ fontSize: 11, padding: '3px 10px', borderRadius: 4,
            border: '1px solid #a5b4fc', background: '#fff', cursor: 'pointer', color: '#4338ca' }}
        >
          Check reconciliation
        </button>
        <button
          onClick={onClearAll}
          style={{ fontSize: 11, padding: '3px 10px', borderRadius: 4,
            border: '1px solid #fca5a5', background: '#fff', cursor: 'pointer', color: '#dc2626' }}
        >
          Clear all
        </button>
      </div>

      {Object.entries(grouped).map(([devName, rows]) => (
        <div key={devName} style={{ marginBottom: 16 }}>
          <div style={{ fontWeight: 700, color: '#374151', marginBottom: 4, fontSize: 11,
            textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            {devName}
          </div>
          <table style={{ borderCollapse: 'collapse', width: '100%' }}>
            <thead>
              <tr style={{ background: '#f9fafb' }}>
                {['Lot', 'Phase', 'Field', 'MARKS', 'Override', 'Delta', 'Note', ''].map(h => (
                  <th key={h} style={{ padding: '4px 8px', textAlign: 'left', fontSize: 11,
                    color: '#6b7280', fontWeight: 600, borderBottom: '1px solid #e5e7eb' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map(ov => {
                const d = delta(ov)
                return (
                  <tr key={ov.override_id} style={{ borderBottom: '1px solid #f3f4f6' }}>
                    <td style={{ padding: '4px 8px', color: '#111827', fontFamily: 'monospace' }}>{ov.lot_number}</td>
                    <td style={{ padding: '4px 8px', color: '#6b7280' }}>{ov.phase_name}</td>
                    <td style={{ padding: '4px 8px' }}>
                      <span style={{ background: '#fef3c7', color: '#92400e', padding: '1px 6px',
                        borderRadius: 10, fontSize: 10, fontWeight: 700 }}>
                        {ov.label}
                      </span>
                    </td>
                    <td style={{ padding: '4px 8px', color: '#6b7280' }}>{fmt(ov.current_marks)}</td>
                    <td style={{ padding: '4px 8px', color: '#92400e', fontWeight: 600 }}>{fmt(ov.override_value)}</td>
                    <td style={{ padding: '4px 8px', color: deltaColor(d), fontWeight: 600 }}>{sign(d)}</td>
                    <td style={{ padding: '4px 8px', color: '#9ca3af', fontStyle: 'italic' }}>{ov.override_note || ''}</td>
                    <td style={{ padding: '4px 8px' }}>
                      <button
                        onClick={() => onClear(ov.lot_id, ov.date_field)}
                        style={{ fontSize: 10, padding: '1px 6px', borderRadius: 3,
                          border: '1px solid #fca5a5', background: '#fff',
                          color: '#dc2626', cursor: 'pointer' }}
                      >
                        ×
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      ))}
    </div>
  )
}
