import { useState, useMemo } from 'react'
import { STATUS_CFG, STATUS_COLOR } from '../../utils/statusConfig'
import {
  EVENT_COLS, PLAN_LABELS, STATUS_COLS, STATUS_LABELS, FLOOR_STATUS,
  thS, tdS, cell, exportToCsv, fmt,
} from './simShared'

export function LedgerTable({ rows, floors, period, lots = [], deliverySchedule = [] }) {
  const floorMap = {}
  for (const [fk, sk] of Object.entries(FLOOR_STATUS)) {
    if (floors?.[fk] != null) floorMap[sk] = floors[fk]
  }

  const [tip, setTip] = useState(null)

  const EVENT_FIELD_MAP = {
    ent_plan: 'date_ent', dev_plan: 'date_dev', td_plan: 'date_td',
    str_plan: 'date_str', cmp_plan: 'date_cmp', cls_plan: 'date_cls',
  }

  const lotsByYM = useMemo(() => {
    const map = {}
    for (const lot of lots) {
      for (const field of Object.values(EVENT_FIELD_MAP)) {
        const d = lot[field]
        if (!d) continue
        const ym = d.slice(0, 7)
        if (!map[ym]) map[ym] = {}
        if (!map[ym][field]) map[ym][field] = []
        map[ym][field].push(lot)
      }
    }
    return map
  }, [lots])

  const deliveryByYM = useMemo(() => {
    const map = {}
    for (const d of deliverySchedule) {
      if (!d.delivery_date) continue
      const ym = d.delivery_date.slice(0, 7)
      if (!map[ym]) map[ym] = []
      map[ym].push(d)
    }
    return map
  }, [deliverySchedule])

  function rowMonths(row) {
    const k = row.calendar_month
    if (period === 'monthly') return [k]
    if (period === 'weekly') return [k.slice(0, 7)]
    if (period === 'quarterly') {
      const [y, q] = k.split('-Q')
      const s = (parseInt(q) - 1) * 3 + 1
      return [s, s + 1, s + 2].map(m => `${y}-${String(m).padStart(2, '0')}`)
    }
    return Array.from({ length: 12 }, (_, i) => `${k}-${String(i + 1).padStart(2, '0')}`)
  }

  function makeTipData(row, col) {
    const field = EVENT_FIELD_MAP[col]
    const months = rowMonths(row)
    const matchLots = months.flatMap(ym => (lotsByYM[ym]?.[field] ?? []))
    const matchDel  = col === 'dev_plan'
      ? months.flatMap(ym => (deliveryByYM[ym] ?? []))
      : []
    if (!matchLots.length && !matchDel.length) return null
    return { col, field, label: PLAN_LABELS[col], lots: matchLots, deliveries: matchDel }
  }

  function fmtFull(iso) {
    if (!iso) return '—'
    return new Date(iso + 'T00:00:00').toLocaleDateString('en-US',
      { month: 'short', day: 'numeric', year: 'numeric' })
  }

  function onCellEnter(e, data) {
    const rect = e.currentTarget.getBoundingClientRect()
    setTip({ data, x: Math.round(rect.left + rect.width / 2), y: Math.round(rect.top) })
  }

  function handleExport() {
    const periodCol = period === 'quarterly' ? 'Quarter' : period === 'annual' ? 'Year' : 'Month'
    const headers = [periodCol, 'ENT','DEV','TD','STR','CMP','CLS','P','E','D','H','U','UC','C','Total','Closed']
    const csvRows = rows.map(r => {
      const total = STATUS_COLS.reduce((s, c) => s + (r[c] || 0), 0) + (r.closed_cumulative || 0) || null
      return [
        r._periodLabel ?? r.calendar_month,
        ...EVENT_COLS.map(c => r[c] || 0),
        ...STATUS_COLS.map(c => r[c] || 0),
        total ?? '',
        r.closed_cumulative ?? '',
      ]
    })
    exportToCsv('ledger.csv', headers, csvRows)
  }

  return (
    <div>
      <div style={{ marginBottom: 8, textAlign: 'right' }}>
        <button onClick={handleExport}
          style={{ fontSize: 11, padding: '3px 10px', borderRadius: 4, border: '1px solid #d1d5db',
                   background: '#f9fafb', color: '#374151', cursor: 'pointer' }}>
          Export CSV
        </button>
      </div>
    <div style={{ overflowX: 'auto' }}>
      <table style={{ borderCollapse: 'collapse', fontSize: 12, whiteSpace: 'nowrap', width: '100%' }}>
        <thead>
          <tr style={{ background: '#f9fafb' }}>
            <th style={{ ...thS('left'), position: 'sticky', top: 0, zIndex: 2 }}>
              {period === 'quarterly' ? 'Quarter' : period === 'annual' ? 'Year' : 'Month'}
            </th>
            <th style={{ ...thS('center'), borderRight: '2px solid #d1d5db', position: 'sticky', top: 0, zIndex: 2 }} colSpan={6}>Events</th>
            <th style={{ ...thS('center'), borderLeft: '2px solid #d1d5db', position: 'sticky', top: 0, zIndex: 2 }} colSpan={8}>End-of-period status</th>
            <th style={{ ...thS(), position: 'sticky', top: 0, zIndex: 2 }}>Closed</th>
          </tr>
          <tr style={{ background: '#f9fafb' }}>
            <th style={{ ...thS('left'), position: 'sticky', top: 26, zIndex: 2 }} />
            {EVENT_COLS.map((c, i) => (
              <th key={c} style={{ ...thS(), ...(i === 5 ? { borderRight: '2px solid #d1d5db' } : {}), position: 'sticky', top: 26, zIndex: 2 }}>
                {PLAN_LABELS[c]}
              </th>
            ))}
            {STATUS_COLS.map((c, i) => {
              const lbl = STATUS_LABELS[c]
              const cfg = STATUS_CFG[lbl] ?? {}
              const hasFloor = floorMap[c] != null
              return (
                <th key={c} style={{ ...thS(), ...(i === 0 ? { borderLeft: '2px solid #d1d5db' } : {}),
                  color: hasFloor ? '#1d4ed8' : (cfg.color ?? '#6b7280'),
                  position: 'sticky', top: 26, zIndex: 2 }}>
                  <span title={cfg.label ?? lbl} style={{ letterSpacing: '0.01em' }}>
                    {cfg.shape} {lbl}
                  </span>
                  {hasFloor && <span style={{ fontSize: 9, verticalAlign: 'super', marginLeft: 1 }}>≥{floorMap[c]}</span>}
                </th>
              )
            })}
            <th style={{ ...thS(), borderLeft: '1px solid #e5e7eb', color: '#374151', fontWeight: 700, position: 'sticky', top: 26, zIndex: 2 }}>Total</th>
            <th style={{ ...thS(), position: 'sticky', top: 26, zIndex: 2 }} />
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={r.calendar_month} style={{ background: i % 2 === 0 ? '#fff' : '#f9fafb' }}>
              <td style={tdS('left', { color: '#374151', fontWeight: 500 })}>
                {r._periodLabel ?? fmt(r.calendar_month)}
              </td>
              {EVENT_COLS.map((c, idx) => {
                const count = r[c]
                const tipData = count > 0 ? makeTipData(r, c) : null
                return (
                  <td key={c}
                    style={tdS('right', {
                      ...(idx === 5 ? { borderRight: '2px solid #d1d5db' } : {}),
                      ...(tipData ? { cursor: 'help' } : {}),
                    })}
                    onMouseEnter={tipData ? (e) => onCellEnter(e, tipData) : undefined}
                    onMouseLeave={tipData ? () => setTip(null) : undefined}
                  >
                    {cell(count)}
                  </td>
                )
              })}
              {STATUS_COLS.map((c, idx) => {
                const below = floorMap[c] != null && r[c] > 0 && r[c] < floorMap[c]
                return (
                  <td key={c} style={tdS('right', {
                    ...(idx === 0 ? { borderLeft: '2px solid #d1d5db' } : {}),
                    ...(below ? { background: '#fff7ed', color: '#c2410c', fontWeight: 600 } : {}),
                  })}>
                    {cell(r[c])}
                  </td>
                )
              })}
              <td style={tdS('right', { borderLeft: '1px solid #e5e7eb', fontWeight: 600, color: '#374151' })}>
                {cell(STATUS_COLS.reduce((s, c) => s + (r[c] || 0), 0) + (r.closed_cumulative || 0) || null)}
              </td>
              <td style={tdS()}>
                {r.closed_cumulative > 0 ? r.closed_cumulative : ''}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>

    {tip && (
      <div style={{
        position: 'fixed',
        left: tip.x,
        top: tip.y < 180 ? tip.y + 34 : tip.y - 10,
        transform: tip.y < 180 ? 'translateX(-50%)' : 'translate(-50%, -100%)',
        background: '#1e293b', color: '#f1f5f9', borderRadius: 6,
        padding: '8px 12px', fontSize: 11, lineHeight: 1.55,
        zIndex: 9999, minWidth: 180, maxWidth: 340,
        boxShadow: '0 4px 16px rgba(0,0,0,0.45)', pointerEvents: 'none',
      }}>
        <div style={{ fontWeight: 700, marginBottom: 5, borderBottom: '1px solid #334155', paddingBottom: 4 }}>
          {tip.data.label} — {tip.data.lots.length} lot{tip.data.lots.length !== 1 ? 's' : ''}
        </div>

        {tip.data.deliveries.length > 0 && (
          <div style={{ marginBottom: 6 }}>
            <div style={{ color: '#fbbf24', fontWeight: 600, fontSize: 10, textTransform: 'uppercase',
                          letterSpacing: '0.04em', marginBottom: 4 }}>Phase deliveries</div>
            {tip.data.deliveries.map((d, i) => (
              <div key={i} style={{ marginBottom: 3 }}>
                <div style={{ color: '#94a3b8' }}>{d.dev_name}</div>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
                  <span style={{ color: '#cbd5e1' }}>{d.phases}</span>
                  <span style={{ color: '#fbbf24', fontWeight: 600, flexShrink: 0 }}>{d.units_delivered} units</span>
                </div>
              </div>
            ))}
            {tip.data.lots.length > 0 && <div style={{ borderTop: '1px solid #334155', margin: '6px 0' }} />}
          </div>
        )}

        {tip.data.lots.slice(0, 12).map((lot, i) => (
          <div key={i} style={{ display: 'flex', justifyContent: 'space-between', gap: 16, marginBottom: 2 }}>
            <span style={{ color: '#cbd5e1' }}>{lot.lot_number ?? '— sim —'}</span>
            <span style={{ color: '#94a3b8', flexShrink: 0 }}>{fmtFull(lot[tip.data.field])}</span>
          </div>
        ))}
        {tip.data.lots.length > 12 && (
          <div style={{ color: '#64748b', marginTop: 4 }}>+{tip.data.lots.length - 12} more</div>
        )}
      </div>
    )}
    </div>
  )
}
