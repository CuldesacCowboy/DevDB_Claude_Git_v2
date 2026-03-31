// ── Horizontal TDA navigation bar ────────────────────────────────
// Shows all agreements for the current community as clickable pills.
// Replaces the "Other Agreements" tiles from the left panel.
export default function TdaNavBar({ agreements, selectedTdaId, onSelect }) {
  if (!agreements || agreements.length === 0) return null

  return (
    <div style={{
      display: 'flex', gap: 6, padding: '8px 24px',
      borderBottom: '1px solid #e5e7eb',
      background: '#fff', flexShrink: 0,
      overflowX: 'auto',
    }}>
      {agreements.map(a => {
        const isActive = a.tda_id === selectedTdaId
        return (
          <button
            key={a.tda_id}
            onClick={() => onSelect(a.tda_id)}
            style={{
              display: 'flex', alignItems: 'center', gap: 8,
              padding: '5px 14px', borderRadius: 6,
              border: isActive ? '2px solid #15803d' : '1.5px solid #e5e7eb',
              background: isActive ? '#dcfce7' : '#f9fafb',
              cursor: 'pointer', flexShrink: 0,
              transition: 'all 0.12s',
            }}
          >
            <span style={{
              fontSize: 13, fontWeight: isActive ? 700 : 500,
              color: isActive ? '#14532d' : '#374151',
              whiteSpace: 'nowrap',
            }}>
              {a.tda_name}
            </span>
            <span style={{
              fontSize: 11, color: isActive ? '#15803d' : '#9ca3af',
              whiteSpace: 'nowrap',
            }}>
              {a.total_lots} lots
            </span>
          </button>
        )
      })}
    </div>
  )
}
