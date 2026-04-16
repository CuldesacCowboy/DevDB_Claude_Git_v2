import { thS, tdS, fmt } from './simShared'

export function DeliveryScheduleTab({ rows, loading }) {
  if (loading) return <div style={{ color: '#6b7280', fontSize: 12 }}>Loading…</div>
  if (!rows.length) return <div style={{ color: '#9ca3af', fontSize: 12 }}>No delivery events found. Run a simulation first.</div>

  const eventOrder = [...new Set(rows.map(r => r.delivery_event_id))]
  const eventIdx   = new Map(eventOrder.map((id, i) => [id, i]))
  const rowBg = r => eventIdx.get(r.delivery_event_id) % 2 === 0 ? '#fff' : '#f9fafb'

  const stickyTh = (align = 'right', extra = {}) => ({
    ...thS(align, extra), position: 'sticky', top: 0, zIndex: 2,
  })

  return (
    <div style={{ overflowX: 'auto', overflowY: 'auto', maxHeight: 'calc(100vh - 280px)' }}>
      <table style={{ borderCollapse: 'collapse', fontSize: 12, whiteSpace: 'nowrap', width: '100%' }}>
        <thead>
          <tr style={{ background: '#f9fafb' }}>
            <th style={stickyTh('left')}>Date</th>
            <th style={stickyTh('left')}>Source</th>
            <th style={stickyTh('left')}>Development</th>
            <th style={stickyTh('left', { whiteSpace: 'normal' })}>Phases Delivered</th>
            <th style={stickyTh()}>Units</th>
            <th style={{ ...stickyTh(), borderLeft: '2px solid #d1d5db', color: '#6b7280', fontSize: 10 }} colSpan={3}>Prior to delivery</th>
            <th style={{ ...stickyTh(), borderLeft: '2px solid #d1d5db', color: '#6b7280', fontSize: 10 }}>After</th>
          </tr>
          <tr style={{ background: '#f9fafb' }}>
            <th style={{ ...stickyTh('left'), top: 24 }} />
            <th style={{ ...stickyTh('left'), top: 24 }} />
            <th style={{ ...stickyTh('left'), top: 24 }} />
            <th style={{ ...stickyTh('left', { whiteSpace: 'normal' }), top: 24 }} />
            <th style={{ ...stickyTh(), top: 24 }} />
            <th style={{ ...stickyTh(), borderLeft: '2px solid #d1d5db', top: 24 }}>D</th>
            <th style={{ ...stickyTh(), top: 24 }}>H</th>
            <th style={{ ...stickyTh(), top: 24 }}>U</th>
            <th style={{ ...stickyTh(), borderLeft: '2px solid #d1d5db', top: 24 }}>D</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(r => (
            <tr key={`${r.delivery_event_id}-${r.dev_id}`} style={{ background: rowBg(r) }}>
              <td style={tdS('left', { fontWeight: 500 })}>
                {r.delivery_date ? fmt(r.delivery_date) : <span style={{ color: '#9ca3af' }}>—</span>}
              </td>
              <td style={tdS('left')}>
                {r.is_locked
                  ? <span style={{ display: 'inline-block', padding: '1px 7px', borderRadius: 10,
                                   fontSize: 11, fontWeight: 600, background: '#dbeafe', color: '#1e40af' }}>Locked</span>
                  : <span style={{ display: 'inline-block', padding: '1px 7px', borderRadius: 10,
                                   fontSize: 11, fontWeight: 500, background: '#f3f4f6', color: '#6b7280' }}>Auto-scheduled</span>
                }
              </td>
              <td style={tdS('left')}>{r.dev_name}</td>
              <td style={tdS('left', { whiteSpace: 'normal', maxWidth: 340, color: '#374151' })}>{r.phases}</td>
              <td style={tdS()}>{r.units_delivered > 0 ? r.units_delivered : <span style={{ color: '#e5e7eb' }}>—</span>}</td>
              <td style={tdS('right', { borderLeft: '2px solid #d1d5db' })}>
                {r.d_pre != null ? r.d_pre : <span style={{ color: '#e5e7eb' }}>—</span>}
              </td>
              <td style={tdS()}>{r.h_pre != null ? r.h_pre : <span style={{ color: '#e5e7eb' }}>—</span>}</td>
              <td style={tdS()}>{r.u_pre != null ? r.u_pre : <span style={{ color: '#e5e7eb' }}>—</span>}</td>
              <td style={tdS('right', { borderLeft: '2px solid #d1d5db' })}>
                {r.d_post != null ? r.d_post : <span style={{ color: '#e5e7eb' }}>—</span>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div style={{ marginTop: 8, fontSize: 11, color: '#9ca3af' }}>
        D/H/U prior = end of month before delivery. D after = end of delivery month.
      </div>
    </div>
  )
}
