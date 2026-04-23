import { useState } from 'react'
import { thS, tdS, fmt } from './simShared'

export function DeliveryScheduleTab({ rows, loading, phaseConfig = [], dirty, onPatchPhase }) {
  const [configOpen, setConfigOpen] = useState(true)

  if (loading) return <div style={{ color: '#6b7280', fontSize: 12 }}>Loading…</div>

  // ── Phase Delivery Config panel ────────────────────────────────────────────
  // Group phases by dev → instrument
  const grouped = {}
  for (const p of phaseConfig) {
    const dk = p.dev_id
    if (!grouped[dk]) grouped[dk] = { dev_name: p.dev_name, instruments: {} }
    const ik = p.instrument_id
    if (!grouped[dk].instruments[ik]) grouped[dk].instruments[ik] = { instrument_name: p.instrument_name, phases: [] }
    grouped[dk].instruments[ik].phases.push(p)
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
    fontSize: 11, padding: '1px 4px', borderRadius: 3, width: 90,
    border: hasValue ? '1px solid #2563eb' : '1px solid #e5e7eb',
    background: hasValue ? '#eff6ff' : '#fafafa',
    color: hasValue ? '#1e40af' : '#9ca3af',
  })

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* ── Dirty banner ── */}
      {dirty && (
        <div style={{
          background: '#fef3c7', border: '1px solid #fcd34d', borderRadius: 6,
          padding: '6px 14px', fontSize: 12, fontWeight: 600, color: '#92400e',
        }}>
          Delivery config changed — re-run simulation to see updated schedule.
        </div>
      )}

      {/* ── Phase Delivery Config ── */}
      <div style={{ border: '1px solid #e5e7eb', borderRadius: 6, background: '#fff' }}>
        <div
          onClick={() => setConfigOpen(o => !o)}
          style={{
            display: 'flex', alignItems: 'center', gap: 8, padding: '8px 14px',
            cursor: 'pointer', userSelect: 'none', borderBottom: configOpen ? '1px solid #e5e7eb' : 'none',
          }}
        >
          <span style={{ fontSize: 10, color: '#6b7280' }}>{configOpen ? '▼' : '▶'}</span>
          <span style={{ fontSize: 13, fontWeight: 600, color: '#1f2937' }}>Phase Delivery Config</span>
          <span style={{ fontSize: 11, color: '#9ca3af', marginLeft: 8 }}>
            Order · Tier · Group · Date · Source
          </span>
        </div>
        {configOpen && (
          <div style={{ overflowX: 'auto', padding: '0 0 8px' }}>
            <table style={{ borderCollapse: 'collapse', fontSize: 12, whiteSpace: 'nowrap', width: '100%' }}>
              <thead>
                <tr style={{ background: '#f9fafb' }}>
                  <th style={{ ...thS('left'), position: 'sticky', top: 0, zIndex: 2, width: 140 }}>Development</th>
                  <th style={{ ...thS('left'), position: 'sticky', top: 0, zIndex: 2, width: 140 }}>Instrument</th>
                  <th style={{ ...thS('left'), position: 'sticky', top: 0, zIndex: 2, width: 140 }}>Phase</th>
                  <th style={{ ...thS('center'), position: 'sticky', top: 0, zIndex: 2, width: 50 }}
                      title="Sequence within instrument — controls delivery order among sibling phases">Order</th>
                  <th style={{ ...thS('center'), position: 'sticky', top: 0, zIndex: 2, width: 50 }}
                      title="Delivery tier — controls ordering across instruments (lower tier delivers first)">Tier</th>
                  <th style={{ ...thS('center'), position: 'sticky', top: 0, zIndex: 2, width: 50 }}
                      title="Delivery group A-Z — phases with the same letter deliver simultaneously within this community">Group</th>
                  <th style={{ ...thS('center'), position: 'sticky', top: 0, zIndex: 2, width: 100 }}
                      title="Projected delivery date (auto-scheduled)">Date</th>
                  <th style={{ ...thS('center'), position: 'sticky', top: 0, zIndex: 2, width: 80 }}
                      title="Locked = user-specified actual date; Projected = engine-scheduled">Source</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(grouped).map(([devId, devData]) => {
                  const instruments = Object.entries(devData.instruments)
                  let devRowSpan = instruments.reduce((s, [, inst]) => s + inst.phases.length, 0)
                  let devShown = false
                  return instruments.map(([instId, instData], ii) => {
                    let instShown = false
                    return instData.phases.map((p, pi) => {
                      const showDev = !devShown
                      const showInst = !instShown
                      if (showDev) devShown = true
                      if (showInst) instShown = true
                      const isLocked = !!p.date_dev_actual
                      const dateVal = p.date_dev_actual || p.date_dev_projected || ''
                      return (
                        <tr key={p.phase_id} style={{ borderTop: pi === 0 && ii > 0 ? '1px solid #e5e7eb' : undefined }}>
                          {showDev && (
                            <td rowSpan={devRowSpan} style={{
                              ...tdS('left'), verticalAlign: 'top', fontWeight: 600, color: '#374151',
                              borderRight: '1px solid #f0f0f0', background: '#fafafa',
                            }}>{devData.dev_name}</td>
                          )}
                          {showInst && (
                            <td rowSpan={instData.phases.length} style={{
                              ...tdS('left'), verticalAlign: 'top', color: '#6b7280',
                              borderRight: '1px solid #f0f0f0',
                            }}>{instData.instrument_name}</td>
                          )}
                          <td style={tdS('left', { color: '#374151' })}>{p.phase_name}</td>
                          {/* Order (sequence_number) */}
                          <td style={tdS('center')}>
                            <input type="number" min={1} max={99}
                              value={p.sequence_number ?? ''}
                              onChange={e => {
                                const v = e.target.value === '' ? null : Number(e.target.value)
                                onPatchPhase(p.phase_id, 'sequence_number', v)
                              }}
                              style={{ ...inputStyle(p.sequence_number != null), width: 40 }}
                            />
                          </td>
                          {/* Tier */}
                          <td style={tdS('center')}>
                            <input type="number" min={0} max={9}
                              value={p.delivery_tier ?? ''}
                              onChange={e => {
                                const v = e.target.value === '' ? null : Number(e.target.value)
                                onPatchPhase(p.phase_id, 'delivery_tier', v)
                              }}
                              style={{ ...inputStyle(p.delivery_tier != null), width: 40 }}
                            />
                          </td>
                          {/* Group */}
                          <td style={tdS('center')}>
                            <input type="text" maxLength={1}
                              value={p.delivery_group ?? ''}
                              onChange={e => {
                                const raw = e.target.value.toUpperCase().replace(/[^A-Z]/g, '')
                                onPatchPhase(p.phase_id, 'delivery_group', raw || null)
                              }}
                              style={{ ...inputStyle(!!p.delivery_group), width: 30 }}
                              placeholder="—"
                            />
                          </td>
                          {/* Date */}
                          <td style={tdS('center')}>
                            <input type="date"
                              value={dateVal}
                              onChange={e => {
                                const v = e.target.value || null
                                if (isLocked) {
                                  onPatchPhase(p.phase_id, 'date_dev_actual', v)
                                } else {
                                  onPatchPhase(p.phase_id, 'date_dev_projected', v)
                                }
                              }}
                              style={dateInputStyle(!!dateVal)}
                            />
                          </td>
                          {/* Source (locked vs projected) */}
                          <td style={tdS('center')}>
                            {isLocked
                              ? <span
                                  onClick={() => onPatchPhase(p.phase_id, 'date_dev_actual', null)}
                                  title="Click to unlock — clears locked date"
                                  style={{
                                    display: 'inline-block', padding: '1px 8px', borderRadius: 10,
                                    fontSize: 11, fontWeight: 600, cursor: 'pointer',
                                    background: '#dbeafe', color: '#1e40af',
                                  }}>Locked</span>
                              : <span
                                  onClick={() => {
                                    if (p.date_dev_projected) {
                                      onPatchPhase(p.phase_id, 'date_dev_actual', p.date_dev_projected)
                                    }
                                  }}
                                  title={p.date_dev_projected ? 'Click to lock — copies projected date as actual' : 'Set a projected date first'}
                                  style={{
                                    display: 'inline-block', padding: '1px 8px', borderRadius: 10,
                                    fontSize: 11, fontWeight: 500, cursor: p.date_dev_projected ? 'pointer' : 'default',
                                    background: '#f3f4f6', color: '#6b7280',
                                    opacity: p.date_dev_projected ? 1 : 0.5,
                                  }}>Projected</span>
                            }
                          </td>
                        </tr>
                      )
                    })
                  })
                })}
              </tbody>
            </table>
            <div style={{ padding: '6px 14px', fontSize: 11, color: '#9ca3af' }}>
              <b>Order</b> — sequence within instrument (lower delivers first).{' '}
              <b>Tier</b> — ordering across instruments (lower tier delivers first).{' '}
              <b>Group</b> — A-Z letter forces simultaneous delivery within this community.{' '}
              <b>Source</b> — click to toggle locked/projected.
            </div>
          </div>
        )}
      </div>

      {/* ── Schedule table ── */}
      {!rows.length
        ? <div style={{ color: '#9ca3af', fontSize: 12 }}>No delivery events found. Run a simulation first.</div>
        : <ScheduleTable rows={rows} />
      }
    </div>
  )
}


// ── Extracted schedule table (was the entire original component) ──────────────
function ScheduleTable({ rows }) {
  const eventOrder = [...new Set(rows.map(r => r.delivery_event_id))]
  const eventIdx   = new Map(eventOrder.map((id, i) => [id, i]))
  const rowBg = r => eventIdx.get(r.delivery_event_id) % 2 === 0 ? '#fff' : '#f9fafb'

  const stickyTh = (align = 'right', extra = {}) => ({
    ...thS(align, extra), position: 'sticky', top: 0, zIndex: 2,
  })

  return (
    <div style={{ overflowX: 'auto', overflowY: 'auto', maxHeight: 'calc(100vh - 400px)' }}>
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
