export function UtilizationPanel({ phases }) {
  if (!phases.length) return (
    <div style={{ color: '#9ca3af', fontSize: 12 }}>No utilization data. Run a simulation first.</div>
  )

  const color = pct => pct === null ? { bg: '#f3f4f6', bar: '#d1d5db', text: '#9ca3af', label: 'no splits' }
    : pct > 95  ? { bg: '#fee2e2', bar: '#fca5a5', text: '#991b1b', label: `${pct}%` }
    : pct < 70  ? { bg: '#fef9c3', bar: '#fde047', text: '#854d0e', label: `${pct}%` }
    :             { bg: '#dcfce7', bar: '#86efac', text: '#166534', label: `${pct}%` }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
      {phases.map(p => {
        const { bar, text, label } = color(p.utilization_pct)
        const hasSpec = (p.spec_count || 0) + (p.build_count || 0) + (p.undet_count || 0) > 0
        return (
          <div key={p.phase_id} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{ width: 260, fontSize: 11, color: '#374151', overflow: 'hidden',
                          textOverflow: 'ellipsis', whiteSpace: 'nowrap', flexShrink: 0 }}
                 title={p.phase_name}>{p.phase_name}</div>
            <div style={{ flex: 1, height: 12, background: '#f3f4f6', borderRadius: 2,
                          overflow: 'hidden', minWidth: 60 }}>
              <div style={{ width: `${Math.min(p.utilization_pct ?? 0, 100)}%`, height: '100%',
                            background: bar, transition: 'width .3s', borderRadius: 2 }} />
            </div>
            <div style={{ width: 52, textAlign: 'right', fontSize: 11, fontWeight: 600, color: text, flexShrink: 0 }}>
              {label}
            </div>
            <div style={{ fontSize: 10, color: '#9ca3af', flexShrink: 0 }}>
              {p.real_count}r+{p.sim_count}s/{p.projected_count}p
            </div>
            {hasSpec && (
              <div style={{ fontSize: 10, flexShrink: 0, display: 'flex', gap: 4 }}>
                {p.spec_count  > 0 && <span style={{ color: '#0d9488', fontWeight: 600 }}>{p.spec_count}S</span>}
                {p.build_count > 0 && <span style={{ color: '#6b7280' }}>{p.build_count}B</span>}
                {p.undet_count > 0 && <span style={{ color: '#d1d5db' }}>{p.undet_count}?</span>}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
