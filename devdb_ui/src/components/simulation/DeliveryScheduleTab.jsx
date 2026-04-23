import { useState, useMemo } from 'react'
import { thS, tdS, fmt } from './simShared'

// Sort modes: 'date' (default API order), 'instrument', 'order', 'tier', 'group'
const SORT_MODES = [
  { key: 'date',       label: 'Date' },
  { key: 'instrument', label: 'Instrument' },
  { key: 'order',      label: 'Inst + Order' },
  { key: 'tier',       label: 'Tier' },
  { key: 'group',      label: 'Group' },
]

function sortRows(rows, mode) {
  const s = [...rows]
  const nil = 9999
  switch (mode) {
    case 'instrument':
      return s.sort((a, b) =>
        a.dev_name.localeCompare(b.dev_name)
        || a.instrument_name.localeCompare(b.instrument_name)
        || (a.sequence_number ?? nil) - (b.sequence_number ?? nil)
      )
    case 'order':
      return s.sort((a, b) =>
        a.dev_name.localeCompare(b.dev_name)
        || a.instrument_name.localeCompare(b.instrument_name)
        || (a.sequence_number ?? nil) - (b.sequence_number ?? nil)
      )
    case 'tier':
      return s.sort((a, b) =>
        (a.delivery_tier ?? nil) - (b.delivery_tier ?? nil)
        || a.dev_name.localeCompare(b.dev_name)
        || a.instrument_name.localeCompare(b.instrument_name)
        || (a.sequence_number ?? nil) - (b.sequence_number ?? nil)
      )
    case 'group':
      return s.sort((a, b) => {
        const ga = a.delivery_group || '\xff'
        const gb = b.delivery_group || '\xff'
        return ga.localeCompare(gb)
          || (a.delivery_tier ?? nil) - (b.delivery_tier ?? nil)
          || a.dev_name.localeCompare(b.dev_name)
          || (a.sequence_number ?? nil) - (b.sequence_number ?? nil)
      })
    default: // 'date' — preserve API order
      return s
  }
}

export function DeliveryScheduleTab({ rows, loading, dirty, onPatchPhase }) {
  const [sortMode, setSortMode] = useState('date')
  const sorted = useMemo(() => sortRows(rows, sortMode), [rows, sortMode])

  if (loading) return <div style={{ color: '#6b7280', fontSize: 12 }}>Loading…</div>
  if (!rows.length) return <div style={{ color: '#9ca3af', fontSize: 12 }}>No phases found. Run a simulation first.</div>

  // Alternating background — group key depends on sort mode
  const groupKey = r => {
    if (sortMode === 'date') return r.delivery_event_id ?? '_none'
    if (sortMode === 'group') return r.delivery_group || '_none'
    if (sortMode === 'tier') return r.delivery_tier ?? '_none'
    return `${r.dev_id}|${r.instrument_id}`   // instrument / order
  }
  const groupOrder = [...new Set(sorted.map(groupKey))]
  const groupIdx = new Map(groupOrder.map((id, i) => [id, i]))
  const rowBg = r => {
    const isUnscheduled = sortMode === 'date' && !r.delivery_event_id
    if (isUnscheduled) return '#fefce8'
    return groupIdx.get(groupKey(r)) % 2 === 0 ? '#fff' : '#f9fafb'
  }

  // Group separator borders
  const firstOfGroup = new Set()
  let prevGroup = null
  for (const r of sorted) {
    const k = groupKey(r)
    if (k !== prevGroup) { firstOfGroup.add(r.phase_id); prevGroup = k }
  }

  const stickyTh = (align = 'right', extra = {}) => ({
    ...thS(align, extra), position: 'sticky', top: 0, zIndex: 2,
  })

  const inputStyle = (hasValue) => ({
    width: 36, textAlign: 'center', fontSize: 11, padding: '1px 2px',
    borderRadius: 3,
    border: hasValue ? '1px solid #7c3aed' : '1px solid #e5e7eb',
    background: hasValue ? '#f5f3ff' : '#fafafa',
    color: hasValue ? '#5b21b6' : '#9ca3af',
    fontWeight: hasValue ? 600 : 400,
  })

  const dateInputStyle = (hasValue) => ({
    fontSize: 11, padding: '1px 3px', borderRadius: 3, width: 88,
    border: hasValue ? '1px solid #2563eb' : '1px solid #e5e7eb',
    background: hasValue ? '#eff6ff' : '#fafafa',
    color: hasValue ? '#1e40af' : '#9ca3af',
  })

  const sortBtnStyle = (active) => ({
    padding: '2px 10px', fontSize: 11, borderRadius: 4,
    border: active ? '1px solid #2563eb' : '1px solid #d1d5db',
    background: active ? '#1e40af' : '#f9fafb',
    color: active ? '#fff' : '#374151',
    fontWeight: active ? 600 : 400,
    cursor: 'pointer',
  })

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {dirty && (
        <div style={{
          background: '#fef3c7', border: '1px solid #fcd34d', borderRadius: 6,
          padding: '6px 14px', fontSize: 12, fontWeight: 600, color: '#92400e',
        }}>
          Delivery config changed — re-run simulation to see updated schedule.
        </div>
      )}

      {/* Sort controls */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <span style={{ fontSize: 11, color: '#6b7280', marginRight: 2 }}>Sort:</span>
        {SORT_MODES.map(m => (
          <button key={m.key} onClick={() => setSortMode(m.key)} style={sortBtnStyle(sortMode === m.key)}>
            {m.label}
          </button>
        ))}
      </div>

      <div style={{ overflowX: 'auto', overflowY: 'auto', maxHeight: 'calc(100vh - 310px)' }}>
        <table style={{ borderCollapse: 'collapse', fontSize: 12, whiteSpace: 'nowrap', width: '100%' }}>
          <thead>
            <tr style={{ background: '#f9fafb' }}>
              <th style={stickyTh('left')}>Date</th>
              <th style={stickyTh('left')}>Source</th>
              <th style={{ ...stickyTh('left'), borderLeft: '2px solid #d1d5db' }}>Development</th>
              <th style={stickyTh('left')}>Instrument</th>
              <th style={stickyTh('left')}>Phase</th>
              <th style={stickyTh()}>Units</th>
              <th style={{ ...stickyTh('center'), borderLeft: '2px solid #d1d5db' }}
                  title="Sequence within instrument — controls delivery order among sibling phases">Order</th>
              <th style={stickyTh('center')}
                  title="Delivery tier — controls ordering across instruments (lower tier delivers first)">Tier</th>
              <th style={stickyTh('center')}
                  title="Delivery group A-Z — phases with the same letter deliver simultaneously within this community">Group</th>
              <th style={{ ...stickyTh(), borderLeft: '2px solid #d1d5db', color: '#6b7280', fontSize: 10 }}
                  colSpan={3}>Prior to delivery</th>
              <th style={{ ...stickyTh(), borderLeft: '2px solid #d1d5db', color: '#6b7280', fontSize: 10 }}>After</th>
            </tr>
            <tr style={{ background: '#f9fafb' }}>
              <th style={{ ...stickyTh('left'), top: 24 }} />
              <th style={{ ...stickyTh('left'), top: 24 }} />
              <th style={{ ...stickyTh('left'), top: 24, borderLeft: '2px solid #d1d5db' }} />
              <th style={{ ...stickyTh('left'), top: 24 }} />
              <th style={{ ...stickyTh('left'), top: 24 }} />
              <th style={{ ...stickyTh(), top: 24 }} />
              <th style={{ ...stickyTh('center'), top: 24, borderLeft: '2px solid #d1d5db' }} />
              <th style={{ ...stickyTh('center'), top: 24 }} />
              <th style={{ ...stickyTh('center'), top: 24 }} />
              <th style={{ ...stickyTh(), borderLeft: '2px solid #d1d5db', top: 24 }}>D</th>
              <th style={{ ...stickyTh(), top: 24 }}>H</th>
              <th style={{ ...stickyTh(), top: 24 }}>U</th>
              <th style={{ ...stickyTh(), borderLeft: '2px solid #d1d5db', top: 24 }}>D</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map(r => {
              const isLocked = !!r.date_dev_actual
              const dateVal = r.date_dev_actual || r.date_dev_projected || ''
              const isUnscheduled = !r.delivery_event_id
              const border = firstOfGroup.has(r.phase_id) ? '2px solid #e0e0e0' : undefined

              return (
                <tr key={r.phase_id} style={{ background: rowBg(r), borderTop: border }}>
                  <td style={tdS('left', { fontWeight: 500 })}>
                    <input type="date" value={dateVal}
                      onChange={e => {
                        const v = e.target.value || null
                        if (isLocked) onPatchPhase(r.phase_id, 'date_dev_actual', v)
                        else onPatchPhase(r.phase_id, 'date_dev_projected', v)
                      }}
                      style={dateInputStyle(!!dateVal)}
                    />
                  </td>
                  <td style={tdS('left')}>
                    {isLocked
                      ? <span
                          onClick={() => onPatchPhase(r.phase_id, 'date_dev_actual', null)}
                          title="Click to unlock"
                          style={{
                            display: 'inline-block', padding: '1px 7px', borderRadius: 10,
                            fontSize: 11, fontWeight: 600, cursor: 'pointer',
                            background: '#dbeafe', color: '#1e40af',
                          }}>Locked</span>
                      : <span
                          onClick={() => {
                            if (r.date_dev_projected)
                              onPatchPhase(r.phase_id, 'date_dev_actual', r.date_dev_projected)
                          }}
                          title={r.date_dev_projected ? 'Click to lock' : 'Set a date first'}
                          style={{
                            display: 'inline-block', padding: '1px 7px', borderRadius: 10,
                            fontSize: 11, fontWeight: 500,
                            cursor: r.date_dev_projected ? 'pointer' : 'default',
                            background: isUnscheduled ? '#fef9c3' : '#f3f4f6',
                            color: isUnscheduled ? '#a16207' : '#6b7280',
                            opacity: r.date_dev_projected ? 1 : 0.5,
                          }}>{isUnscheduled ? 'Unscheduled' : 'Projected'}</span>
                    }
                  </td>
                  <td style={tdS('left', { borderLeft: '2px solid #d1d5db', color: '#374151' })}>{r.dev_name}</td>
                  <td style={tdS('left', { color: '#6b7280' })}>{r.instrument_name}</td>
                  <td style={tdS('left', { color: '#374151', fontWeight: 500 })}>{r.phase_name}</td>
                  <td style={tdS()}>{r.units > 0 ? r.units : <span style={{ color: '#e5e7eb' }}>—</span>}</td>
                  <td style={tdS('center', { borderLeft: '2px solid #d1d5db' })}>
                    <input type="number" min={1} max={99}
                      value={r.sequence_number ?? ''}
                      onChange={e => {
                        const v = e.target.value === '' ? null : Number(e.target.value)
                        onPatchPhase(r.phase_id, 'sequence_number', v)
                      }}
                      style={{ ...inputStyle(r.sequence_number != null), width: 40 }}
                    />
                  </td>
                  <td style={tdS('center')}>
                    <input type="number" min={0} max={9}
                      value={r.delivery_tier ?? ''}
                      onChange={e => {
                        const v = e.target.value === '' ? null : Number(e.target.value)
                        onPatchPhase(r.phase_id, 'delivery_tier', v)
                      }}
                      style={{ ...inputStyle(r.delivery_tier != null), width: 40 }}
                    />
                  </td>
                  <td style={tdS('center')}>
                    <input type="text" maxLength={1}
                      value={r.delivery_group ?? ''}
                      onChange={e => {
                        const raw = e.target.value.toUpperCase().replace(/[^A-Z]/g, '')
                        onPatchPhase(r.phase_id, 'delivery_group', raw || null)
                      }}
                      style={{ ...inputStyle(!!r.delivery_group), width: 30 }}
                      placeholder="—"
                    />
                  </td>
                  <td style={tdS('right', { borderLeft: '2px solid #d1d5db' })}>
                    {r.d_pre != null ? r.d_pre : <span style={{ color: '#e5e7eb' }}>—</span>}
                  </td>
                  <td style={tdS()}>{r.h_pre != null ? r.h_pre : <span style={{ color: '#e5e7eb' }}>—</span>}</td>
                  <td style={tdS()}>{r.u_pre != null ? r.u_pre : <span style={{ color: '#e5e7eb' }}>—</span>}</td>
                  <td style={tdS('right', { borderLeft: '2px solid #d1d5db' })}>
                    {r.d_post != null ? r.d_post : <span style={{ color: '#e5e7eb' }}>—</span>}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
        <div style={{ marginTop: 8, fontSize: 11, color: '#9ca3af' }}>
          <b>Order</b> — sequence within instrument. <b>Tier</b> — ordering across instruments (lower first).{' '}
          <b>Group</b> — A-Z forces simultaneous delivery.{' '}
          D/H/U prior = end of month before delivery. D after = end of delivery month.{' '}
          Yellow rows = unscheduled phases.
        </div>
      </div>
    </div>
  )
}
