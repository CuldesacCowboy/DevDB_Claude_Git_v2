import { useState, useEffect, useCallback, useMemo } from 'react'
import {
  AreaChart, Area, BarChart, Bar, LineChart, Line,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from 'recharts'
import { STATUS_CFG, STATUS_COLOR, StatusBadge } from '../utils/statusConfig'
import { API_BASE } from '../config'
import { useOverrides } from '../hooks/useOverrides'
import OverrideDateCell from '../components/overrides/OverrideDateCell'
import OverridesPanel from '../components/overrides/OverridesPanel'
import SyncReconciliationModal from '../components/overrides/SyncReconciliationModal'

// ─── Column definitions ──────────────────────────────────────────────────────

const EVENT_COLS   = ['ent_plan','dev_plan','td_plan','str_plan','cmp_plan','cls_plan']
const PLAN_LABELS  = { ent_plan:'ENT', dev_plan:'DEV', td_plan:'TD', str_plan:'STR', cmp_plan:'CMP', cls_plan:'CLS' }
const STATUS_COLS  = ['p_end','e_end','d_end','h_end','u_end','uc_end','c_end']
const STATUS_LABELS = { p_end:'P', e_end:'E', d_end:'D', h_end:'H', u_end:'U', uc_end:'UC', c_end:'C' }
const FLOOR_KEYS   = ['min_p_count','min_e_count','min_d_count','min_u_count','min_uc_count','min_c_count']
const FLOOR_STATUS = { min_p_count:'p_end', min_e_count:'e_end', min_d_count:'d_end',
                        min_u_count:'u_end', min_uc_count:'uc_end', min_c_count:'c_end' }
const FLOOR_LABELS = { min_p_count:'P', min_e_count:'E', min_d_count:'D',
                        min_u_count:'U', min_uc_count:'UC', min_c_count:'C' }
// Only the active-pipeline states are useful as alert thresholds
const ACTIVE_FLOOR_KEYS   = ['min_d_count','min_u_count','min_uc_count','min_c_count']
const ACTIVE_FLOOR_LABELS = { min_d_count:'Developed', min_u_count:'Unstarted', min_uc_count:'Under const.', min_c_count:'Completed' }
const NUMERIC_COLS = [...EVENT_COLS, ...STATUS_COLS]


// ─── Helpers ─────────────────────────────────────────────────────────────────

function exportToCsv(filename, headers, rows) {
  const escape = v => {
    if (v == null) return ''
    const s = String(v)
    return s.includes(',') || s.includes('"') || s.includes('\n') ? `"${s.replace(/"/g, '""')}"` : s
  }
  const lines = [headers.map(escape).join(',')]
  for (const row of rows) lines.push(row.map(escape).join(','))
  const blob = new Blob([lines.join('\r\n')], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url; a.download = filename; a.click()
  URL.revokeObjectURL(url)
}

function fmt(iso) {
  if (!iso) return ''
  return new Date(iso + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', year: '2-digit' })
}

function periodKey(iso, period) {
  const [y, m] = iso.split('-').map(Number)
  if (period === 'annual')    return `${y}`
  if (period === 'quarterly') return `${y}-Q${Math.ceil(m / 3)}`
  return iso
}

function periodLabel(key, period) {
  if (period === 'annual')    return `'${key.slice(2)}`
  if (period === 'quarterly') {
    const [y, q] = key.split('-')
    return `${q} '${y.slice(2)}`
  }
  return fmt(key)
}

/** Collapse raw API rows into one row per period, compute p_end and cumulative closed. */
function buildLedgerRows(rawRows, selectedDevIds, period, ledgerStartDate, utilization) {
  const filtered = selectedDevIds === null
    ? rawRows
    : rawRows.filter(r => selectedDevIds.includes(r.dev_id))

  const monthMap = new Map()
  for (const r of filtered) {
    const key = r.calendar_month
    if (!monthMap.has(key)) {
      monthMap.set(key, { calendar_month: key })
      for (const col of NUMERIC_COLS) monthMap.get(key)[col] = 0
    }
    const agg = monthMap.get(key)
    for (const col of NUMERIC_COLS) agg[col] += (r[col] || 0)
  }

  let sorted = [...monthMap.values()].sort((a, b) => a.calendar_month.localeCompare(b.calendar_month))

  if (ledgerStartDate) {
    sorted = sorted.filter(r => r.calendar_month >= ledgerStartDate)
  }

  const filteredUtil = utilization
    ? (selectedDevIds === null ? utilization : utilization.filter(u => selectedDevIds.includes(u.dev_id)))
    : []
  const totalPlannedLots = filteredUtil.reduce((s, u) => s + (u.total_count || 0), 0)
  if (totalPlannedLots > 0) {
    let entitledSoFar = 0
    for (const r of sorted) {
      entitledSoFar += (r.ent_plan || 0)
      r.p_end = Math.max(0, totalPlannedLots - entitledSoFar)
    }
  }

  let cumul = 0
  for (const r of sorted) { cumul += (r.cls_plan || 0); r.closed_cumulative = cumul || null }

  if (period === 'monthly') {
    for (const r of sorted) r._label = fmt(r.calendar_month)
    return sorted
  }

  const periodMap = new Map()
  for (const r of sorted) {
    const pk = periodKey(r.calendar_month, period)
    if (!periodMap.has(pk)) periodMap.set(pk, { _key: pk, _rows: [] })
    periodMap.get(pk)._rows.push(r)
  }

  return [...periodMap.values()].map(({ _key, _rows }) => {
    const last = _rows[_rows.length - 1]
    const out = { calendar_month: _key, _label: periodLabel(_key, period), _periodLabel: periodLabel(_key, period) }
    for (const col of EVENT_COLS)  out[col] = _rows.reduce((s, r) => s + (r[col] || 0), 0)
    for (const col of STATUS_COLS) out[col] = last[col] || 0
    out.closed_cumulative = last.closed_cumulative || null
    return out
  })
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const thS = (align = 'right', extra = {}) => ({
  padding: '4px 8px', textAlign: align, fontWeight: 600,
  borderBottom: '2px solid #e5e7eb', color: '#6b7280', fontSize: 12,
  whiteSpace: 'nowrap', background: '#f9fafb', ...extra,
})
const tdS = (align = 'right', extra = {}) => ({
  padding: '3px 8px', textAlign: align, borderBottom: '1px solid #f3f4f6',
  fontVariantNumeric: 'tabular-nums', fontSize: 13, ...extra,
})

function cell(v) { return v > 0 ? v : <span style={{ color: '#e5e7eb' }}>—</span> }

// ─── LedgerTable ─────────────────────────────────────────────────────────────

function LedgerTable({ rows, floors, period, lots = [], deliverySchedule = [] }) {
  const floorMap = {}
  for (const [fk, sk] of Object.entries(FLOOR_STATUS)) {
    if (floors?.[fk] != null) floorMap[sk] = floors[fk]
  }

  // ── Tooltip ──────────────────────────────────────────────────────────────
  const [tip, setTip] = useState(null)   // { data, x, y }

  const EVENT_FIELD_MAP = {
    ent_plan: 'date_ent', dev_plan: 'date_dev', td_plan: 'date_td',
    str_plan: 'date_str', cmp_plan: 'date_cmp', cls_plan: 'date_cls',
  }

  // lot-level lookup: YYYY-MM → date_field → [lot, …]
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

  // delivery schedule lookup: YYYY-MM → [event, …]
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
        background: '#1e293b',
        color: '#f1f5f9',
        borderRadius: 6,
        padding: '8px 12px',
        fontSize: 11,
        lineHeight: 1.55,
        zIndex: 9999,
        minWidth: 180,
        maxWidth: 340,
        boxShadow: '0 4px 16px rgba(0,0,0,0.45)',
        pointerEvents: 'none',
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

// ─── LedgerGraph ─────────────────────────────────────────────────────────────

const GRAPH_TOOLTIP_STYLE = { fontSize: 11, border: '1px solid #e5e7eb', background: '#fff', borderRadius: 4 }

function PipelineTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null
  const rowData = payload[0]?.payload
  const deliveries = rowData?._deliveries
  const seriesPayload = payload.filter(p => p.dataKey !== '_pinY')
  return (
    <div style={{ fontSize: 11, border: '1px solid #e5e7eb', background: '#fff',
                  borderRadius: 4, padding: '6px 10px', maxWidth: 300 }}>
      <div style={{ fontWeight: 600, color: '#374151', marginBottom: 4 }}>{label}</div>
      {seriesPayload.map(p => (
        <div key={p.dataKey} style={{ display: 'flex', justifyContent: 'space-between', gap: 16 }}>
          <span style={{ color: p.color }}>{p.name}</span>
          <span style={{ fontWeight: 600, color: '#374151' }}>{p.value > 0 ? p.value : '—'}</span>
        </div>
      ))}
      {deliveries?.length > 0 && (
        <div style={{ borderTop: '1px solid #e5e7eb', marginTop: 6, paddingTop: 6 }}>
          <div style={{ fontWeight: 600, color: '#b45309', marginBottom: 4 }}>Phase deliveries:</div>
          {deliveries.map((d, i) => (
            <div key={i} style={{ marginTop: i > 0 ? 4 : 0 }}>
              <div style={{ color: '#374151', fontWeight: 500 }}>{d.devName}</div>
              <div style={{ color: '#6b7280' }}>{d.phases}</div>
              <div style={{ color: '#b45309', fontWeight: 600 }}>{d.units} units delivered</div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function renderPinDot(props) {
  const { cx, cy, payload } = props
  if (!payload?._deliveries?.length) return null
  const color = '#b45309'
  return (
    <g key={`pin-${cx}-${cy}`}>
      <line x1={cx} y1={cy} x2={cx} y2={cy - 12} stroke={color} strokeWidth={1.5} />
      <circle cx={cx} cy={cy - 16} r={4} fill={color} stroke="#fff" strokeWidth={1.5} />
    </g>
  )
}

const CHART_PANELS = [
  { key: 'pipeline', label: 'Pipeline' },
  { key: 'backlog',  label: 'Backlog'  },
  { key: 'velocity', label: 'Velocity' },
  { key: 'closings', label: 'Closings' },
]

function LedgerGraph({ rows, period, deliverySchedule = [], selectedDevIds }) {
  const [panel, setPanel] = useState('pipeline')

  const enrichedRows = useMemo(() => {
    if (!deliverySchedule.length) return rows
    const filtered = selectedDevIds
      ? deliverySchedule.filter(d => selectedDevIds.includes(d.dev_id))
      : deliverySchedule
    const map = new Map()
    for (const d of filtered) {
      if (!d.delivery_date) continue
      const monthFirst = d.delivery_date.slice(0, 7) + '-01'
      const pk = periodKey(monthFirst, period)
      if (!map.has(pk)) map.set(pk, [])
      map.get(pk).push({ phases: d.phases, units: d.units_delivered, devName: d.dev_name })
    }
    if (!map.size) return rows
    return rows.map(r => {
      const delivs = map.get(r.calendar_month)
      if (!delivs?.length) return r
      const stackTop = (r.h_end||0) + (r.u_end||0) + (r.uc_end||0) + (r.c_end||0) + (r.d_end||0)
      return { ...r, _deliveries: delivs, _pinY: stackTop }
    })
  }, [rows, deliverySchedule, selectedDevIds, period])

  if (!rows.length) return null

  const xInterval  = period === 'monthly' ? 11 : period === 'quarterly' ? 3 : 0
  const tickStyle  = { fontSize: 10, fill: '#9ca3af' }
  const chartProps = { margin: { top: 4, right: 8, bottom: 0, left: 0 } }
  const tooltipProps = {
    contentStyle: GRAPH_TOOLTIP_STYLE,
    formatter: (v, name) => [v > 0 ? v : '—', name],
    itemStyle: { fontSize: 11 },
  }
  const axisProps  = { tick: tickStyle, tickLine: false, axisLine: false }
  const legendProps = { wrapperStyle: { fontSize: 11, paddingTop: 8 } }

  const descriptions = {
    pipeline: 'Full supply stack — developed, held, unstarted, under construction, completed',
    backlog:  'End-of-period lots not yet activated — paper & entitled',
    velocity: 'Lot transitions per period across all pipeline stages',
    closings: 'Starts, completions, and closings per period',
  }

  return (
    <div>
      {/* Panel selector */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 12 }}>
        {CHART_PANELS.map(({ key, label }) => (
          <button key={key} onClick={() => setPanel(key)} style={{
            padding: '3px 14px', fontSize: 12, borderRadius: 4,
            border: '1px solid #d1d5db', cursor: 'pointer',
            background: panel === key ? '#1e40af' : '#f9fafb',
            color:      panel === key ? '#fff'    : '#374151',
            fontWeight: panel === key ? 600       : 400,
          }}>
            {label}
          </button>
        ))}
        <span style={{ fontSize: 11, color: '#9ca3af', marginLeft: 8 }}>
          {descriptions[panel]}
        </span>
      </div>

      {/* Active panel */}
      {panel === 'pipeline' && (
        <ResponsiveContainer width="100%" height={280}>
          <AreaChart data={enrichedRows} {...chartProps}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" vertical={false} />
            <XAxis dataKey="_label" interval={xInterval} {...axisProps} />
            <YAxis {...axisProps} width={34} />
            <Tooltip content={<PipelineTooltip />} />
            <Legend {...legendProps} />
            <Area type="linear" dataKey="h_end"  stackId="s" stroke={STATUS_COLOR.H}  fill={STATUS_COLOR.H}  fillOpacity={0.80} name={`${STATUS_CFG.H.shape} H`}  />
            <Area type="linear" dataKey="u_end"  stackId="s" stroke={STATUS_COLOR.U}  fill={STATUS_COLOR.U}  fillOpacity={0.85} name={`${STATUS_CFG.U.shape} U`}  />
            <Area type="linear" dataKey="uc_end" stackId="s" stroke={STATUS_COLOR.UC} fill={STATUS_COLOR.UC} fillOpacity={0.85} name={`${STATUS_CFG.UC.shape} UC`} />
            <Area type="linear" dataKey="c_end"  stackId="s" stroke={STATUS_COLOR.C}  fill={STATUS_COLOR.C}  fillOpacity={0.85} name={`${STATUS_CFG.C.shape} C`}  />
            <Area type="linear" dataKey="d_end"  stackId="s" stroke={STATUS_COLOR.D}  fill={STATUS_COLOR.D}  fillOpacity={0.75} name={`${STATUS_CFG.D.shape} D`}  />
            <Line dataKey="_pinY" stroke="none" strokeWidth={0} dot={renderPinDot} activeDot={false}
                  isAnimationActive={false} legendType="none" connectNulls={false} />
          </AreaChart>
        </ResponsiveContainer>
      )}

      {panel === 'backlog' && (
        <ResponsiveContainer width="100%" height={280}>
          <AreaChart data={rows} {...chartProps}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" vertical={false} />
            <XAxis dataKey="_label" interval={xInterval} {...axisProps} />
            <YAxis {...axisProps} width={40} />
            <Tooltip {...tooltipProps} />
            <Legend {...legendProps} />
            <Area type="monotone" dataKey="p_end" stackId="s" stroke={STATUS_COLOR.P} fill={STATUS_COLOR.P} fillOpacity={0.85} name={`${STATUS_CFG.P.shape} P`} />
            <Area type="monotone" dataKey="e_end" stackId="s" stroke={STATUS_COLOR.E} fill={STATUS_COLOR.E} fillOpacity={0.85} name={`${STATUS_CFG.E.shape} E`} />
          </AreaChart>
        </ResponsiveContainer>
      )}

      {panel === 'velocity' && (
        <ResponsiveContainer width="100%" height={280}>
          <LineChart data={rows} {...chartProps}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" vertical={false} />
            <XAxis dataKey="_label" interval={xInterval} {...axisProps} />
            <YAxis {...axisProps} width={34} />
            <Tooltip {...tooltipProps} />
            <Legend {...legendProps} />
            <Line type="monotone" dataKey="ent_plan" stroke="#f59e0b"         strokeWidth={1.5} dot={false} name="ENT" />
            <Line type="monotone" dataKey="dev_plan" stroke="#a8a29e"         strokeWidth={1.5} dot={false} name="DEV" />
            <Line type="monotone" dataKey="td_plan"  stroke="#818cf8"         strokeWidth={1.5} dot={false} name="TD"  />
            <Line type="monotone" dataKey="str_plan" stroke={STATUS_COLOR.U}  strokeWidth={1.5} dot={false} name="STR" />
            <Line type="monotone" dataKey="cmp_plan" stroke={STATUS_COLOR.C}  strokeWidth={1.5} dot={false} name="CMP" />
            <Line type="monotone" dataKey="cls_plan" stroke={STATUS_COLOR.OUT} strokeWidth={2}  dot={false} name="CLS" />
          </LineChart>
        </ResponsiveContainer>
      )}

      {panel === 'closings' && (
        <ResponsiveContainer width="100%" height={280}>
          <BarChart data={rows} {...chartProps} barCategoryGap="30%">
            <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" vertical={false} />
            <XAxis dataKey="_label" interval={xInterval} {...axisProps} />
            <YAxis {...axisProps} width={34} />
            <Tooltip {...tooltipProps} />
            <Legend {...legendProps} />
            <Bar dataKey="str_plan" fill={STATUS_COLOR.U}    name="STR" radius={[2,2,0,0]} />
            <Bar dataKey="cmp_plan" fill={STATUS_COLOR.C}    name="CMP" radius={[2,2,0,0]} />
            <Bar dataKey="cls_plan" fill={STATUS_COLOR.OUT}  name="CLS" radius={[2,2,0,0]} />
          </BarChart>
        </ResponsiveContainer>
      )}
    </div>
  )
}

// ─── UtilizationPanel ────────────────────────────────────────────────────────

function UtilizationPanel({ phases }) {
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
          </div>
        )
      })}
    </div>
  )
}

// ─── Settings panel subcomponents ────────────────────────────────────────────

// Compact date hint: "← Mar '26" — gray when ok/unset, amber + ⚠ when violated.
// suggest is the latest acceptable date (ISO string). current is the current input value.
// onAccept fills the input with suggest.
function DateSuggest({ suggest, current, label, onAccept }) {
  if (!suggest) return null
  const violated = !!current && /^\d{4}-\d{2}-\d{2}$/.test(current) && current > suggest
  const mo = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  const [y, m] = suggest.split('-').map(Number)
  const display = `${mo[m - 1]} '${String(y).slice(2)}`
  return (
    <span
      onClick={() => onAccept(suggest)}
      title={`${label}: ${suggest}`}
      style={{
        fontSize: 11, cursor: 'pointer', userSelect: 'none',
        color: violated ? '#d97706' : '#9ca3af',
        borderBottom: `1px dashed ${violated ? '#d97706' : '#d1d5db'}`,
      }}>
      {violated ? '⚠ ' : '← '}{display}
    </span>
  )
}

// Subtract N months from an ISO date string (YYYY-MM-DD). Returns null if input is invalid.
function subtractMonths(dateStr, n) {
  if (!dateStr || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return null
  const [y, m, d] = dateStr.split('-').map(Number)
  let nm = m - 1 - n  // 0-based
  const ny = y + Math.floor(nm / 12)
  nm = ((nm % 12) + 12) % 12
  const lastDay = new Date(ny, nm + 1, 0).getDate()
  return `${ny}-${String(nm + 1).padStart(2, '0')}-${String(Math.min(d, lastDay)).padStart(2, '0')}`
}

function LedgerConfigSection({ entGroupId, datePaper, dateEnt, earliestDeliveryDate, onSaved, disabled }) {
  const [paperVal, setPaperVal] = useState(datePaper ?? '')
  const [entVal,   setEntVal]   = useState(dateEnt   ?? '')
  const [saving,   setSaving]   = useState(false)
  const [err,      setErr]      = useState(null)
  const [lotsMsg,  setLotsMsg]  = useState(null)

  useEffect(() => { setPaperVal(datePaper ?? '') }, [datePaper])
  useEffect(() => { setEntVal(dateEnt ?? '') },     [dateEnt])

  const isLocked = disabled || saving

  async function saveIfChanged(newPaper, newEnt) {
    if (newPaper === (datePaper ?? '') && newEnt === (dateEnt ?? '')) return
    setSaving(true); setErr(null); setLotsMsg(null)
    try {
      const res = await fetch(`${API_BASE}/entitlement-groups/${entGroupId}/ledger-config`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ date_paper: newPaper || null, date_ent: newEnt || null }),
      })
      if (!res.ok) throw new Error(await res.text())
      const data = await res.json()
      if (data.lots_entitled > 0) setLotsMsg(`${data.lots_entitled} lot${data.lots_entitled === 1 ? '' : 's'} entitled`)
      onSaved()
    } catch (e) { setErr(String(e)) }
    finally { setSaving(false) }
  }

  const rowStyle = { display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }
  const labelStyle = { fontSize: 12, color: '#374151', minWidth: 160 }
  const inputStyle = (saved, cur) => ({
    width: 120, padding: '3px 7px', fontSize: 12, borderRadius: 4,
    border: `1px solid ${cur !== (saved ?? '') ? '#2563eb' : '#d1d5db'}`,
    background: isLocked ? '#f3f4f6' : '#fff',
  })

  // Hints: latest reasonable dates given the downstream constraints
  const suggestPaper = subtractMonths(entVal, 1)          // ≤ ent - 1 month
  const suggestEnt   = earliestDeliveryDate ?? null        // ≤ earliest delivery

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={rowStyle}>
        <span style={labelStyle}>Ledger start date <span style={{ color: '#dc2626' }}>*</span></span>
        <input type="text" placeholder="YYYY-MM-DD" value={paperVal} disabled={isLocked}
          onChange={e => { setPaperVal(e.target.value); setErr(null); setLotsMsg(null) }}
          onBlur={e => saveIfChanged(e.target.value, entVal)}
          style={inputStyle(datePaper, paperVal)} />
        {!paperVal && <span style={{ fontSize: 11, color: '#dc2626' }}>Required</span>}
        {saving && <span style={{ fontSize: 11, color: '#9ca3af' }}>Saving…</span>}
        <DateSuggest suggest={suggestPaper} current={paperVal} label="Latest (1 mo before entitlement)"
          onAccept={v => { setPaperVal(v); saveIfChanged(v, entVal) }} />
      </div>
      <div style={rowStyle}>
        <span style={labelStyle}>Bulk entitlement date</span>
        <input type="text" placeholder="YYYY-MM-DD" value={entVal} disabled={isLocked}
          onChange={e => { setEntVal(e.target.value); setErr(null); setLotsMsg(null) }}
          onBlur={e => saveIfChanged(paperVal, e.target.value)}
          style={inputStyle(dateEnt, entVal)} />
        {!entVal && <span style={{ fontSize: 11, color: '#9ca3af' }}>Marks all P lots as entitled on this date</span>}
        {entVal && !saving && <span style={{ fontSize: 11, color: '#9ca3af' }}>{fmt(entVal)}</span>}
        <DateSuggest suggest={suggestEnt} current={entVal} label="Latest (before earliest delivery)"
          onAccept={v => { setEntVal(v); saveIfChanged(paperVal, v) }} />
      </div>
      {lotsMsg && <span style={{ fontSize: 11, color: '#16a34a' }}>{lotsMsg}</span>}
      {err    && <span style={{ fontSize: 11, color: '#dc2626' }}>{err}</span>}
    </div>
  )
}

const MONTH_LABELS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']

function MonthGrid({ selected, onChange, locked }) {
  return (
    <div style={{ display: 'flex', gap: 4 }}>
      {MONTH_LABELS.map((label, i) => {
        const m = i + 1
        const on = selected.includes(m)
        return (
          <button key={m} disabled={locked} onClick={() => {
            if (locked) return
            onChange(on ? selected.filter(x => x !== m) : [...selected, m].sort((a,b) => a-b))
          }} style={{
            padding: '3px 6px', fontSize: 11, borderRadius: 4, cursor: locked ? 'default' : 'pointer',
            border: on ? '1px solid #2563eb' : '1px solid #d1d5db',
            background: on ? '#dbeafe' : locked ? '#f9fafb' : '#fff',
            color: on ? '#1d4ed8' : '#6b7280',
            fontWeight: on ? 600 : 400,
            transition: 'all 0.1s',
          }}>
            {label}
          </button>
        )
      })}
    </div>
  )
}

function GlobalSettingsSection({ globalSettings, onSaved, disabled }) {
  const [edits, setEdits] = useState({})
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState(null)

  const isDirty  = Object.keys(edits).length > 0
  const isLocked = disabled || saving

  const currentMonths = edits.delivery_months !== undefined
    ? edits.delivery_months
    : (globalSettings?.delivery_months ?? [5,6,7,8,9,10,11])

  function valFor(key) { return edits[key] !== undefined ? edits[key] : (globalSettings?.[key] ?? '') }
  function setVal(key, v) { setEdits(p => ({ ...p, [key]: v })) }

  async function save() {
    setSaving(true); setErr(null)
    const body = { delivery_months: currentMonths.length > 0 ? currentMonths : null }
    const v_max = valFor('max_deliveries_per_year')
    body.max_deliveries_per_year = v_max === '' ? null : parseInt(v_max, 10)
    const v_cmp = valFor('default_cmp_lag_days')
    body.default_cmp_lag_days = v_cmp === '' ? null : parseInt(v_cmp, 10)
    const v_cls = valFor('default_cls_lag_days')
    body.default_cls_lag_days = v_cls === '' ? null : parseInt(v_cls, 10)
    for (const key of ACTIVE_FLOOR_KEYS) {
      const v = valFor(key); body[key] = v === '' ? null : parseInt(v, 10)
    }
    try {
      const res = await fetch(`${API_BASE}/global-settings`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) throw new Error(await res.text())
      setEdits({}); onSaved()
    } catch (e) { setErr(String(e)) }
    finally { setSaving(false) }
  }

  const numInput = (key, width = 56, placeholder = '—') => (
    <input key={key} type="number" min="0" placeholder={placeholder}
      value={valFor(key)} disabled={isLocked}
      onChange={e => setVal(key, e.target.value)}
      style={{ width, padding: '2px 5px', fontSize: 12, borderRadius: 4, textAlign: 'right',
               background: isLocked ? '#f3f4f6' : '#fff',
               border: `1px solid ${edits[key] !== undefined ? '#2563eb' : '#d1d5db'}` }} />
  )

  const textLink = (label, onClick) => (
    <button onClick={onClick} disabled={isLocked} style={{
      fontSize: 11, color: isLocked ? '#d1d5db' : '#2563eb',
      background: 'none', border: 'none', cursor: isLocked ? 'default' : 'pointer', padding: 0,
    }}>{label}</button>
  )

  const sectionHead = (title) => (
    <div style={{ fontSize: 12, fontWeight: 600, color: '#374151', marginBottom: 8 }}>{title}</div>
  )

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

      {/* Default delivery window */}
      <div>
        {sectionHead('Default delivery window')}
        <MonthGrid selected={currentMonths}
          onChange={months => setEdits(p => ({ ...p, delivery_months: months }))}
          locked={isLocked} />
        <div style={{ display: 'flex', gap: 12, marginTop: 6, alignItems: 'center' }}>
          {textLink('All', () => setEdits(p => ({ ...p, delivery_months: [1,2,3,4,5,6,7,8,9,10,11,12] })))}
          {textLink('None', () => setEdits(p => ({ ...p, delivery_months: [] })))}
        </div>
      </div>

      {/* Deliveries per year + build times */}
      <div>
        {sectionHead('Scheduling defaults')}
        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'center' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
            <span style={{ color: '#6b7280' }}>Deliveries per year</span>
            {numInput('max_deliveries_per_year', 52, '1')}
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
            <span style={{ color: '#6b7280' }}>Start → completion (days)</span>
            {numInput('default_cmp_lag_days', 56, '270')}
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
            <span style={{ color: '#6b7280' }}>Completion → closing (days)</span>
            {numInput('default_cls_lag_days', 56, '45')}
          </label>
        </div>
      </div>

      {/* Inventory alert floors */}
      <div>
        {sectionHead('Minimum inventory alerts')}
        <div style={{ fontSize: 11, color: '#9ca3af', marginBottom: 8 }}>
          Ledger rows highlight orange when a status count drops below its floor.
        </div>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
          {ACTIVE_FLOOR_KEYS.map(key => (
            <label key={key} style={{ display: 'flex', flexDirection: 'column', gap: 3, fontSize: 12 }}>
              <span style={{ color: '#9ca3af', fontSize: 11 }}>{ACTIVE_FLOOR_LABELS[key]}</span>
              {numInput(key, 56)}
            </label>
          ))}
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        {isDirty && (
          <button disabled={isLocked} onClick={save}
            style={{ padding: '4px 14px', fontSize: 12, borderRadius: 4, border: 'none',
                     background: isLocked ? '#d1d5db' : '#2563eb', color: '#fff',
                     cursor: isLocked ? 'default' : 'pointer' }}>
            {saving ? 'Saving…' : 'Save global defaults'}
          </button>
        )}
        {err && <span style={{ fontSize: 11, color: '#dc2626' }}>{err}</span>}
      </div>
    </div>
  )
}

function DeliveryConfigSection({ entGroupId, deliveryConfig, globalSettings, onSaved, disabled }) {
  const [edits, setEdits] = useState({})
  const [saving, setSaving] = useState(false)
  const [err, setErr]       = useState(null)
  const [editingGlobalHorizon, setEditingGlobalHorizon] = useState(false)
  const [globalHorizonDraft, setGlobalHorizonDraft]     = useState('')
  const [savingGlobal, setSavingGlobal]                 = useState(false)

  const isDirty  = Object.keys(edits).length > 0
  const isLocked = disabled || saving

  // Community override vs global inherit for delivery_months
  const communityMonths = deliveryConfig?.delivery_months  // null = inherit
  const globalMonths    = globalSettings?.delivery_months ?? [5,6,7,8,9,10,11]
  const hasMonthOverride = edits.delivery_months !== undefined
    ? edits.delivery_months !== null
    : communityMonths !== null && communityMonths !== undefined

  const currentMonths = edits.delivery_months !== undefined
    ? (edits.delivery_months ?? [])
    : (communityMonths ?? globalMonths)

  // Community override for max_deliveries_per_year
  const communityMaxDel = deliveryConfig?.max_deliveries_per_year
  const globalMaxDel    = globalSettings?.max_deliveries_per_year ?? 1
  const hasMaxDelOverride = edits.max_deliveries_per_year !== undefined
    ? edits.max_deliveries_per_year !== null
    : communityMaxDel !== null && communityMaxDel !== undefined

  // Community override for scheduling_horizon_days
  const communityHorizon = deliveryConfig?.scheduling_horizon_days
  const globalHorizon    = globalSettings?.scheduling_horizon_days ?? 14
  const hasHorizonOverride = edits.scheduling_horizon_days !== undefined
    ? edits.scheduling_horizon_days !== null
    : communityHorizon !== null && communityHorizon !== undefined

  function valFor(key) { return edits[key] !== undefined ? edits[key] : (deliveryConfig?.[key] ?? '') }
  function setVal(key, v) { setEdits(p => ({ ...p, [key]: v })) }

  const globalMonthsLabel = globalMonths.length
    ? globalMonths.map(m => MONTH_LABELS[m - 1]).join(', ')
    : 'none'

  async function saveGlobalHorizon() {
    const v = parseInt(globalHorizonDraft, 10)
    if (isNaN(v) || v < 0) return
    setSavingGlobal(true)
    try {
      await fetch(`${API_BASE}/global-settings`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scheduling_horizon_days: v }),
      })
      setEditingGlobalHorizon(false)
      onSaved()
    } finally { setSavingGlobal(false) }
  }

  async function save() {
    setSaving(true); setErr(null)
    const body = {}

    // delivery_months: send null to clear override, or array if override active
    if (edits.delivery_months !== undefined) {
      body.delivery_months = edits.delivery_months
    } else if (!hasMonthOverride) {
      body.delivery_months = null
    }

    // max_deliveries_per_year: send null to clear override
    if (edits.max_deliveries_per_year !== undefined) {
      body.max_deliveries_per_year = edits.max_deliveries_per_year === null ? null
        : parseInt(edits.max_deliveries_per_year, 10)
    } else if (!hasMaxDelOverride) {
      body.max_deliveries_per_year = null
    }

    const asVal = valFor('auto_schedule_enabled')
    if (asVal !== '') body.auto_schedule_enabled = asVal === true || asVal === 'true'

    const fsVal = valFor('feed_starts_mode')
    if (fsVal !== '') body.feed_starts_mode = fsVal === true || fsVal === 'true'

    // scheduling_horizon_days: null clears community override (inherit global)
    if (edits.scheduling_horizon_days !== undefined) {
      body.scheduling_horizon_days = edits.scheduling_horizon_days === null ? null
        : parseInt(edits.scheduling_horizon_days, 10)
    }

    try {
      const res = await fetch(`${API_BASE}/entitlement-groups/${entGroupId}/delivery-config`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) throw new Error(await res.text())
      setEdits({}); onSaved()
    } catch (e) { setErr(String(e)) }
    finally { setSaving(false) }
  }

  const textLink = (label, onClick, color = '#2563eb') => (
    <button onClick={onClick} disabled={isLocked} style={{
      fontSize: 11, color: isLocked ? '#d1d5db' : color,
      background: 'none', border: 'none', cursor: isLocked ? 'default' : 'pointer', padding: 0,
    }}>{label}</button>
  )

  const sectionHead = (title) => (
    <div style={{ fontSize: 12, fontWeight: 600, color: '#374151', marginBottom: 8 }}>{title}</div>
  )

  const numInput = (key, width = 52, placeholder = '—') => (
    <input key={key} type="number" min="0" placeholder={placeholder}
      value={valFor(key)} disabled={isLocked}
      onChange={e => setVal(key, e.target.value)}
      style={{ width, padding: '2px 5px', fontSize: 12, borderRadius: 4, textAlign: 'right',
               background: isLocked ? '#f3f4f6' : '#fff',
               border: `1px solid ${edits[key] !== undefined ? '#2563eb' : '#d1d5db'}` }} />
  )

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

      {/* Auto-schedule */}
      <div>
        {sectionHead('Delivery scheduling')}
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12,
                        cursor: isLocked ? 'default' : 'pointer' }}>
          <input type="checkbox" disabled={isLocked}
            checked={valFor('auto_schedule_enabled') === true || valFor('auto_schedule_enabled') === 'true'}
            onChange={e => setVal('auto_schedule_enabled', e.target.checked)}
            style={{ width: 14, height: 14, accentColor: '#2563eb' }} />
          <span style={{ color: '#6b7280' }}>Schedule deliveries automatically</span>
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12,
                        cursor: isLocked ? 'default' : 'pointer', marginTop: 6 }}>
          <input type="checkbox" disabled={isLocked}
            checked={valFor('feed_starts_mode') === true || valFor('feed_starts_mode') === 'true'}
            onChange={e => setVal('feed_starts_mode', e.target.checked)}
            style={{ width: 14, height: 14, accentColor: '#d97706' }} />
          <span style={{ color: '#6b7280' }}>Aggressive batching (feed starts mode)</span>
        </label>
      </div>

      {/* Delivery window override */}
      <div>
        {sectionHead('Delivery window')}
        {!hasMonthOverride ? (
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <span style={{ fontSize: 12, color: '#6b7280' }}>
              Using global ({globalMonthsLabel})
            </span>
            {textLink('Set override', () => setEdits(p => ({ ...p, delivery_months: [...globalMonths] })))}
          </div>
        ) : (
          <div>
            <MonthGrid selected={currentMonths}
              onChange={months => setEdits(p => ({ ...p, delivery_months: months }))}
              locked={isLocked} />
            <div style={{ display: 'flex', gap: 12, marginTop: 6, alignItems: 'center' }}>
              {textLink('All', () => setEdits(p => ({ ...p, delivery_months: [1,2,3,4,5,6,7,8,9,10,11,12] })))}
              {textLink('None', () => setEdits(p => ({ ...p, delivery_months: [] })))}
              <span style={{ color: '#e5e7eb' }}>·</span>
              {textLink('Revert to global', () => setEdits(p => ({ ...p, delivery_months: null })), '#dc2626')}
            </div>
          </div>
        )}
      </div>

      {/* Deliveries per year override */}
      <div>
        {sectionHead('Deliveries per year')}
        {!hasMaxDelOverride ? (
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <span style={{ fontSize: 12, color: '#6b7280' }}>
              Using global ({globalMaxDel})
            </span>
            {textLink('Set override', () => setEdits(p => ({ ...p, max_deliveries_per_year: String(communityMaxDel ?? globalMaxDel) })))}
          </div>
        ) : (
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            {numInput('max_deliveries_per_year', 52, '1')}
            {textLink('Revert to global', () => setEdits(p => ({ ...p, max_deliveries_per_year: null })), '#dc2626')}
          </div>
        )}
      </div>

      {/* Scheduling horizon */}
      <div>
        {sectionHead('Scheduling horizon')}
        {!hasHorizonOverride ? (
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <span style={{ fontSize: 12, color: '#6b7280' }}>
              Using global ({globalHorizon} days from today)
            </span>
            {textLink('Set override', () => setEdits(p => ({ ...p, scheduling_horizon_days: String(communityHorizon ?? globalHorizon) })))}
            <span style={{ color: '#e5e7eb' }}>·</span>
            {!editingGlobalHorizon
              ? textLink('Edit global', () => { setGlobalHorizonDraft(String(globalHorizon)); setEditingGlobalHorizon(true) }, '#6b7280')
              : (
                <span style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                  <input type="number" min="0" value={globalHorizonDraft}
                    onChange={e => setGlobalHorizonDraft(e.target.value)}
                    style={{ width: 52, padding: '2px 5px', fontSize: 12, borderRadius: 4,
                             border: '1px solid #2563eb', textAlign: 'right' }} />
                  <span style={{ fontSize: 12, color: '#6b7280' }}>days</span>
                  <button onClick={saveGlobalHorizon} disabled={savingGlobal}
                    style={{ fontSize: 11, padding: '2px 8px', borderRadius: 4, border: 'none',
                             background: '#2563eb', color: '#fff', cursor: 'pointer' }}>
                    {savingGlobal ? '…' : 'Save global'}
                  </button>
                  {textLink('Cancel', () => setEditingGlobalHorizon(false), '#6b7280')}
                </span>
              )
            }
          </div>
        ) : (
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            {numInput('scheduling_horizon_days', 52, String(globalHorizon))}
            <span style={{ fontSize: 12, color: '#6b7280' }}>days from today</span>
            {textLink('Revert to global', () => setEdits(p => ({ ...p, scheduling_horizon_days: null })), '#dc2626')}
          </div>
        )}
        <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 4 }}>
          No dates will be projected prior to today + this many days.
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        {isDirty && (
          <button disabled={isLocked} onClick={save}
            style={{ padding: '4px 14px', fontSize: 12, borderRadius: 4, border: 'none',
                     background: isLocked ? '#d1d5db' : '#2563eb', color: '#fff',
                     cursor: isLocked ? 'default' : 'pointer' }}>
            {saving ? 'Saving…' : 'Save community settings'}
          </button>
        )}
        {err && <span style={{ fontSize: 11, color: '#dc2626' }}>{err}</span>}
      </div>
    </div>
  )
}

function StartsTargetsSection({ entGroupId, params, onSaved, disabled }) {
  const [edits, setEdits] = useState({})

  if (!params.length) return (
    <div style={{ fontSize: 12, color: '#9ca3af' }}>No developments found. Run a simulation first.</div>
  )

  const DOT_COLOR = { ok: '#16a34a', stale: '#d97706', missing: '#dc2626' }

  return (
    <div>
      <div style={{ marginBottom: 8 }}>
        <span style={{ fontSize: 12, fontWeight: 600, color: '#374151' }}>Annual starts pace</span>
        <span style={{ fontSize: 11, color: '#9ca3af', marginLeft: 8 }}>
          Homes started per year and monthly cap, per development.
        </span>
      </div>
      {/* Column headers */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4, paddingLeft: 15 }}>
        <span style={{ fontSize: 11, color: '#9ca3af', minWidth: 180 }}>Development</span>
        <span style={{ fontSize: 11, color: '#9ca3af', width: 68, textAlign: 'right' }}>Per year</span>
        <span style={{ fontSize: 11, color: '#9ca3af', width: 68, textAlign: 'right' }}>Max / mo</span>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
        {params.map(p => {
          const edit = edits[p.dev_id] || {}
          const annualVal   = edit.annual   !== undefined ? edit.annual   : (p.annual_starts_target ?? '')
          const maxMonthVal = edit.maxMonth !== undefined ? edit.maxMonth : (p.max_starts_per_month ?? '')
          const annualDirty   = edit.annual   !== undefined && edit.annual   !== String(p.annual_starts_target ?? '')
          const maxMonthDirty = edit.maxMonth !== undefined && edit.maxMonth !== String(p.max_starts_per_month ?? '')
          const dirty = annualDirty || maxMonthDirty

          async function save() {
            const n = parseInt(annualVal, 10)
            if (!n || n < 1) return
            const maxN = maxMonthVal === '' ? null : parseInt(maxMonthVal, 10)
            setEdits(prev => ({ ...prev, [p.dev_id]: { ...prev[p.dev_id], saving: true } }))
            try {
              const res = await fetch(`${API_BASE}/developments/${p.dev_id}/sim-params`, {
                method: 'PUT', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ annual_starts_target: n, max_starts_per_month: maxN }),
              })
              if (!res.ok) throw new Error(await res.text())
              setEdits(prev => { const next = { ...prev }; delete next[p.dev_id]; return next })
              onSaved()
            } catch (err) {
              setEdits(prev => ({ ...prev, [p.dev_id]: { ...prev[p.dev_id], saving: false, error: String(err) } }))
            }
          }

          return (
            <div key={p.dev_id} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ display: 'inline-block', width: 7, height: 7, borderRadius: '50%',
                             background: DOT_COLOR[p.status] ?? '#9ca3af', flexShrink: 0 }}
                    title={p.status} />
              <span style={{ fontSize: 12, color: '#374151', minWidth: 180 }}>{p.dev_name}</span>
              <input type="number" min="1" placeholder="—" value={annualVal}
                disabled={disabled || edit.saving}
                onChange={e => setEdits(prev => ({ ...prev, [p.dev_id]: { ...prev[p.dev_id], annual: e.target.value } }))}
                style={{ width: 68, padding: '2px 5px', fontSize: 12, borderRadius: 4, textAlign: 'right',
                         background: (disabled || edit.saving) ? '#f3f4f6' : '#fff',
                         border: `1px solid ${annualDirty ? '#2563eb' : '#d1d5db'}` }} />
              <input type="number" min="1" placeholder="—" value={maxMonthVal}
                disabled={disabled || edit.saving}
                onChange={e => setEdits(prev => ({ ...prev, [p.dev_id]: { ...prev[p.dev_id], maxMonth: e.target.value } }))}
                style={{ width: 68, padding: '2px 5px', fontSize: 12, borderRadius: 4, textAlign: 'right',
                         background: (disabled || edit.saving) ? '#f3f4f6' : '#fff',
                         border: `1px solid ${maxMonthDirty ? '#2563eb' : '#d1d5db'}` }} />
              {dirty && (
                <button disabled={disabled || edit.saving || !annualVal} onClick={save}
                  style={{ padding: '2px 8px', fontSize: 11, borderRadius: 4, border: 'none',
                           background: (disabled || edit.saving) ? '#d1d5db' : '#2563eb', color: '#fff',
                           cursor: (disabled || edit.saving) ? 'default' : 'pointer' }}>
                  {edit.saving ? '…' : 'Save'}
                </button>
              )}
              {edit.error && <span style={{ fontSize: 11, color: '#dc2626' }}>{edit.error}</span>}
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ─── DeliveryScheduleTab ─────────────────────────────────────────────────────

function DeliveryScheduleTab({ rows, loading }) {
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

// ─── LotLedger ───────────────────────────────────────────────────────────────

function LotLedger({ lots, loading, onApplyOverride, onClearOverride }) {
  const [devFilter, setDevFilter] = useState('all')
  const [srcFilter, setSrcFilter] = useState('all')

  if (loading) return <div style={{ color: '#6b7280', fontSize: 12 }}>Loading…</div>
  if (!lots.length) return <div style={{ color: '#9ca3af', fontSize: 12 }}>No lots. Run a simulation first.</div>

  const devNames = [...new Set(lots.map(l => l.dev_name))].sort()
  const filtered = lots.filter(l =>
    (devFilter === 'all' || l.dev_name === devFilter) &&
    (srcFilter === 'all' || l.lot_source === srcFilter)
  )

  const overrideable = l => l.lot_source === 'real'

  // Distinct row background tints for consecutive buildings (cycles through 8 colors).
  const BG_ROW_PALETTE = [
    '#eff6ff','#f0fdf4','#fefce8','#fff1f2',
    '#f5f3ff','#fdf4ff','#ecfeff','#fff7ed',
  ]

  // Building group labels: per phase, first-seen building_group_id → B1, B2, …
  const bgLabelMap = (() => {
    const map = {}
    const counters = {}
    for (const l of filtered) {
      if (l.building_group_id != null) {
        const key = `${l.phase_name}::${l.building_group_id}`
        if (!(key in map)) {
          const n = (counters[l.phase_name] ?? 0) + 1
          counters[l.phase_name] = n
          map[key] = `B${n}`
        }
      }
    }
    return map
  })()

  // Maps violation_type → the two date fields involved (early, late).
  // Used to show a warning indicator inline in the affected date cells.
  const VIOLATION_FIELDS = {
    ent_after_dev: ['date_ent', 'date_dev'],
    dev_after_td:  ['date_dev', 'date_td'],
    td_after_str:  ['date_td',  'date_str'],
    str_after_cmp: ['date_str', 'date_cmp'],
    cmp_after_cls: ['date_cmp', 'date_cls'],
  }
  const violatedFields = l => {
    const fields = new Set()
    for (const vt of (l.violations ?? [])) {
      for (const f of (VIOLATION_FIELDS[vt] ?? [])) fields.add(f)
    }
    return fields
  }
  const ViolationDot = ({ title }) => (
    <span title={title}
      style={{ display: 'inline-block', width: 7, height: 7, borderRadius: '50%',
               background: '#f97316', marginLeft: 4, verticalAlign: 'middle', flexShrink: 0 }} />
  )

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ flexShrink: 0, display: 'flex', gap: 8, marginBottom: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <select value={devFilter} onChange={e => setDevFilter(e.target.value)}
          style={{ fontSize: 12, padding: '3px 8px', borderRadius: 4, border: '1px solid #d1d5db' }}>
          <option value="all">All developments</option>
          {devNames.map(n => <option key={n} value={n}>{n}</option>)}
        </select>
        <select value={srcFilter} onChange={e => setSrcFilter(e.target.value)}
          style={{ fontSize: 12, padding: '3px 8px', borderRadius: 4, border: '1px solid #d1d5db' }}>
          <option value="all">All sources</option>
          <option value="real">Real</option>
          <option value="sim">Sim</option>
        </select>
        <span style={{ fontSize: 11, color: '#6b7280' }}>{filtered.length} lots</span>
        <span style={{ fontSize: 11, color: '#93c5fd', fontStyle: 'italic', marginLeft: 6 }}>italic blue = projected</span>
        <span style={{ fontSize: 11, color: '#92400e', marginLeft: 6 }}>amber = override (click to edit)</span>
        <button onClick={() => {
          const headers = ['Development','Lot #','Type','Phase','Bldg','Source','Status','ENT','DEV','HC','BLDR','DIG','CMP','CLS']
          const csvRows = filtered.map(l => {
            const bgKey = l.building_group_id != null ? `${l.phase_name}::${l.building_group_id}` : null
            const bgLabel = bgKey ? bgLabelMap[bgKey] : ''
            return [
              l.dev_name, l.lot_number ?? '', l.lot_type_short ?? '', l.phase_name, bgLabel,
              l.lot_source, l.status,
              l.date_ent ?? '', l.date_dev ?? '', l.date_td_hold ?? '',
              l.date_td ?? '', l.date_str ?? l.date_str_projected ?? '',
              l.date_cmp ?? l.date_cmp_projected ?? '', l.date_cls ?? l.date_cls_projected ?? '',
            ]
          })
          exportToCsv('lots.csv', headers, csvRows)
        }}
          style={{ fontSize: 11, padding: '3px 10px', borderRadius: 4, border: '1px solid #d1d5db',
                   background: '#f9fafb', color: '#374151', cursor: 'pointer', marginLeft: 'auto' }}>
          Export CSV
        </button>
      </div>
      <div style={{ flex: 1, overflowY: 'auto', overflowX: 'auto' }}>
        <table style={{ borderCollapse: 'collapse', fontSize: 12, whiteSpace: 'nowrap' }}>
          <thead>
            <tr style={{ background: '#f9fafb' }}>
              {devFilter === 'all' && <th style={{ ...thS('left'), position: 'sticky', top: 0, zIndex: 2 }}>Development</th>}
              <th style={{ ...thS('left'), position: 'sticky', top: 0, zIndex: 2 }}>Lot #</th>
              <th style={{ ...thS('left'), position: 'sticky', top: 0, zIndex: 2 }}>Type</th>
              <th style={{ ...thS('left'), position: 'sticky', top: 0, zIndex: 2 }}>Phase</th>
              <th style={{ ...thS('center'), position: 'sticky', top: 0, zIndex: 2, color: '#0d9488' }}>Bldg</th>
              <th style={{ ...thS('left'), position: 'sticky', top: 0, zIndex: 2 }}>Src</th>
              <th style={{ ...thS('left'), position: 'sticky', top: 0, zIndex: 2 }}>Status</th>
              <th style={{ ...thS(), position: 'sticky', top: 0, zIndex: 2 }}>ENT</th>
              <th style={{ ...thS(), position: 'sticky', top: 0, zIndex: 2 }}>DEV</th>
              <th style={{ ...thS(), position: 'sticky', top: 0, zIndex: 2 }}>HC</th>
              <th style={{ ...thS(), position: 'sticky', top: 0, zIndex: 2 }}>BLDR</th>
              <th style={{ ...thS(), position: 'sticky', top: 0, zIndex: 2 }}>DIG</th>
              <th style={{ ...thS(), position: 'sticky', top: 0, zIndex: 2 }}>CMP</th>
              <th style={{ ...thS(), position: 'sticky', top: 0, zIndex: 2 }}>CLS</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((l, idx) => {
              const vf = violatedFields(l)
              const vTip = l.violations?.length
                ? l.violations.join(', ')
                : ''
              const VDot = ({ field }) => vf.has(field)
                ? <ViolationDot title={`Date order violation: ${vTip}`} />
                : null
              const bgKey = l.building_group_id != null ? `${l.phase_name}::${l.building_group_id}` : null
              const bgLabel = bgKey ? bgLabelMap[bgKey] : null
              const bgIndex = bgLabel ? parseInt(bgLabel.slice(1)) - 1 : 0
              const rowTint = bgLabel ? BG_ROW_PALETTE[bgIndex % BG_ROW_PALETTE.length] : null
              const prevLot = idx > 0 ? filtered[idx - 1] : null
              const isGroupStart = l.building_group_id != null && (
                !prevLot || prevLot.building_group_id !== l.building_group_id || prevLot.phase_name !== l.phase_name
              )
              return (
              <tr key={l.lot_id} style={{ background: rowTint ?? '' }}>
                {devFilter === 'all' && <td style={tdS('left')}>{l.dev_name}</td>}
                <td style={tdS('left')}>{l.lot_number ?? '—'}</td>
                <td style={tdS('left')}>{l.lot_type_short ?? '—'}</td>
                <td style={tdS('left')}>{l.phase_name}</td>
                <td style={tdS('center', {
                  color: '#0d9488', fontWeight: 600, fontSize: 11, letterSpacing: '0.02em',
                  borderTop: isGroupStart ? '2px solid #0d9488' : undefined,
                })}>{bgLabel ?? ''}</td>
                <td style={tdS('left', { color: '#6b7280', fontSize: 11 })}>{l.lot_source}</td>
                <td style={tdS('left')}><StatusBadge status={l.status} pill /></td>
                <td style={tdS()}>
                  <span style={{ display: 'inline-flex', alignItems: 'center' }}>
                    {l.date_ent ? fmt(l.date_ent) : <span style={{ color: '#e5e7eb' }}>—</span>}
                    <VDot field="date_ent" />
                  </span>
                </td>
                <td style={tdS()}>
                  <span style={{ display: 'inline-flex', alignItems: 'center' }}>
                    {l.date_dev ? fmt(l.date_dev) : <span style={{ color: '#e5e7eb' }}>—</span>}
                    <VDot field="date_dev" />
                  </span>
                </td>
                <td style={tdS()}>
                  <OverrideDateCell lotId={l.lot_id} dateField="date_td_hold" label="HC"
                    marksValue={l.date_td_hold} projectedValue={null}
                    overrideValue={l.ov_date_td_hold}
                    onApply={onApplyOverride} onClear={onClearOverride}
                    disabled={!overrideable(l)} />
                </td>
                <td style={tdS()}>
                  <span style={{ display: 'inline-flex', alignItems: 'center' }}>
                    <OverrideDateCell lotId={l.lot_id} dateField="date_td" label="BLDR"
                      marksValue={l.date_td} projectedValue={null}
                      overrideValue={l.ov_date_td}
                      onApply={onApplyOverride} onClear={onClearOverride}
                      disabled={!overrideable(l)} />
                    <VDot field="date_td" />
                  </span>
                </td>
                <td style={tdS()}>
                  <span style={{ display: 'inline-flex', alignItems: 'center' }}>
                    <OverrideDateCell lotId={l.lot_id} dateField="date_str" label="DIG"
                      marksValue={l.date_str} projectedValue={l.date_str_projected}
                      overrideValue={l.ov_date_str}
                      onApply={onApplyOverride} onClear={onClearOverride}
                      disabled={!overrideable(l)} />
                    <VDot field="date_str" />
                  </span>
                </td>
                <td style={tdS()}>
                  <span style={{ display: 'inline-flex', alignItems: 'center' }}>
                    <OverrideDateCell lotId={l.lot_id} dateField="date_cmp" label="CMP"
                      marksValue={l.date_cmp} projectedValue={l.date_cmp_projected}
                      overrideValue={l.ov_date_cmp}
                      onApply={onApplyOverride} onClear={onClearOverride}
                      disabled={!overrideable(l)} />
                    <VDot field="date_cmp" />
                  </span>
                </td>
                <td style={tdS()}>
                  <span style={{ display: 'inline-flex', alignItems: 'center' }}>
                    <OverrideDateCell lotId={l.lot_id} dateField="date_cls" label="CLS"
                      marksValue={l.date_cls} projectedValue={l.date_cls_projected}
                      overrideValue={l.ov_date_cls}
                      onApply={onApplyOverride} onClear={onClearOverride}
                      disabled={!overrideable(l)} />
                    <VDot field="date_cls" />
                  </span>
                </td>
              </tr>
            )})}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// Fetch helper — throws on non-2xx so .catch() blocks see real API errors.
async function fetchOk(url) {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`${res.status} from ${url}`)
  return res.json()
}

// ─── Main view ───────────────────────────────────────────────────────────────

export default function SimulationView({ selectedGroupId, setSelectedGroupId, showTestCommunities, globalSettingsOpen, onCloseGlobalSettings }) {
  const entGroupId = selectedGroupId
  const setEntGroupId = setSelectedGroupId
  const [entGroups, setEntGroups]   = useState([])
  const [runStatus, setRunStatus]   = useState(null)
  const [runErrors, setRunErrors]   = useState([])
  const [byDev, setByDev]           = useState([])
  const [utilization, setUtilization] = useState([])
  const [loading, setLoading]       = useState(false)
  const [missingSplits, setMissingSplits] = useState([])
  const [staleParams, setStaleParams]     = useState([])
  const [deliveryConfig, setDeliveryConfig]   = useState(null)
  const [ledgerConfig, setLedgerConfig]       = useState(null)
  const [globalSettings, setGlobalSettings]   = useState(null)
  const [view, setView]             = useState('ledger')
  const [ledgerSubView, setLedgerSubView] = useState('graph')   // 'table' | 'graph'
  const [lots, setLots]             = useState([])
  const [lotsLoading, setLotsLoading] = useState(false)
  const [showReconModal, setShowReconModal] = useState(false)

  const {
    overrides, loading: ovLoading,
    reconciliation,
    fetchOverrides, applyOverrides, clearOverride, clearBatch,
    fetchReconciliation, exportOverrides,
  } = useOverrides(entGroupId)
  const [deliverySchedule, setDeliverySchedule]               = useState([])
  const [deliveryScheduleLoading, setDeliveryScheduleLoading] = useState(false)
  const [modalOpen, setModalOpen] = useState(false)
  const [selectedDevIds, setSelectedDevIds] = useState(null)
  const [period, setPeriod]                 = useState('monthly')
  const [loadError, setLoadError]           = useState(null)
  const [lastRunAt, setLastRunAt]           = useState(null)

  const devList = useMemo(
    () => [...new Map(byDev.map(r => [r.dev_id, r.dev_name])).entries()].map(([id, name]) => ({ id, name })),
    [byDev],
  )

const loadLedger = useCallback((id) => {
    setLoading(true)
    setLoadError(null)
    Promise.all([
      fetchOk(`${API_BASE}/ledger/${id}/by-dev`),
      fetchOk(`${API_BASE}/ledger/${id}/utilization`),
    ])
      .then(([devRows, utilRows]) => {
        setByDev(Array.isArray(devRows) ? devRows : [])
        setUtilization(Array.isArray(utilRows) ? utilRows : [])
      })
      .catch((err) => { setByDev([]); setUtilization([]); setLoadError(`Could not load ledger data — ${err.message}`) })
      .finally(() => setLoading(false))
  }, [])

  const loadConfig = useCallback((id) => {
    Promise.all([
      fetchOk(`${API_BASE}/entitlement-groups/${id}/delivery-config`),
      fetchOk(`${API_BASE}/entitlement-groups/${id}/ledger-config`),
    ])
      .then(([dc, lc]) => { setDeliveryConfig(dc); setLedgerConfig(lc) })
      .catch(() => {})
  }, [])

  const loadGlobalSettings = useCallback(() => {
    fetchOk(`${API_BASE}/global-settings`)
      .then(data => setGlobalSettings(data))
      .catch(() => {})
  }, [])

  const checkSplits = useCallback((id) => {
    Promise.all([
      fetchOk(`${API_BASE}/entitlement-groups/${id}/split-check`),
      fetchOk(`${API_BASE}/entitlement-groups/${id}/param-check`),
    ])
      .then(([splits, params]) => {
        setMissingSplits(Array.isArray(splits) ? splits : [])
        setStaleParams(Array.isArray(params) ? params : [])
      })
      .catch(() => { setMissingSplits([]); setStaleParams([]) }) // advisory — warnings only
  }, [])

  const loadLots = useCallback((id) => {
    setLotsLoading(true)
    fetchOk(`${API_BASE}/ledger/${id}/lots`)
      .then(data => setLots(Array.isArray(data) ? data : []))
      .catch((err) => { setLots([]); setLoadError(`Could not load lot ledger — ${err.message}`) })
      .finally(() => setLotsLoading(false))
  }, [])

  const loadDeliverySchedule = useCallback((id) => {
    setDeliveryScheduleLoading(true)
    fetchOk(`${API_BASE}/ledger/${id}/delivery-schedule`)
      .then(data => setDeliverySchedule(Array.isArray(data) ? data : []))
      .catch((err) => { setDeliverySchedule([]); setLoadError(`Could not load delivery schedule — ${err.message}`) })
      .finally(() => setDeliveryScheduleLoading(false))
  }, [])

  useEffect(() => {
    fetch(`${API_BASE}/entitlement-groups`).then(r => r.json())
      .then(data => { setEntGroups(data); if (data.length && !selectedGroupId) { const first = data.find(g => showTestCommunities ? g.is_test : !g.is_test) ?? data[0]; setEntGroupId(first.ent_group_id) } })
      .catch(() => {})
  }, [])

  useEffect(() => {
    if (!entGroupId) return
    setLoadError(null)
    checkSplits(entGroupId)
    loadLedger(entGroupId)
    loadConfig(entGroupId)
    loadGlobalSettings()
    fetchOverrides()
    loadDeliverySchedule(entGroupId)
    loadLots(entGroupId)
    setRunErrors([])
    setSelectedDevIds(null)
  }, [entGroupId, checkSplits, loadLedger, loadConfig, fetchOverrides, loadDeliverySchedule])

  async function handleRun() {
    if (!entGroupId) return
    setRunStatus('running')
    try {
      const res = await fetch(`${API_BASE}/simulations/run`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ent_group_id: entGroupId }),
      })
      if (!res.ok) { setRunStatus({ ok: false, error: await res.text() }); return }
      const data = await res.json()
      setRunStatus({ ok: true, iterations: data.iterations, elapsed_ms: data.elapsed_ms })
      setRunErrors(data.errors || [])
      setLastRunAt(new Date())
      setLoadError(null)
      loadLedger(entGroupId)
      loadLots(entGroupId)
      loadDeliverySchedule(entGroupId)
      checkSplits(entGroupId)
    } catch (e) { setRunStatus({ ok: false, error: e.message }); setLastRunAt(new Date()) }
  }

  const ledgerRows = useMemo(() => buildLedgerRows(
    byDev, selectedDevIds, period, ledgerConfig?.date_paper ?? null, utilization,
  ), [byDev, selectedDevIds, period, ledgerConfig, utilization])

  const filteredUtilization = useMemo(() => {
    if (selectedDevIds === null) return utilization
    return utilization.filter(p => selectedDevIds.includes(p.dev_id))
  }, [utilization, selectedDevIds])

  const hasData = byDev.length > 0

  const isRunning = runStatus === 'running'

  // Pre-run validation warnings shown near Run button (non-blocking advisory).
  const runWarnings = useMemo(() => {
    const w = []
    if (ledgerConfig !== null && !ledgerConfig.date_paper)
      w.push('Plan start date is not set — ledger will not render (Settings → Plan Start Date)')
    const missingDevs = staleParams.filter(p => p.status === 'missing')
    if (missingDevs.length > 0)
      w.push(`${missingDevs.length} development${missingDevs.length !== 1 ? 's' : ''} have no starts target configured`)
    return w
  }, [ledgerConfig, staleParams])

  function toggleDev(devId) {
    if (selectedDevIds === null) {
      setSelectedDevIds([devId])
    } else if (selectedDevIds.includes(devId)) {
      const next = selectedDevIds.filter(d => d !== devId)
      setSelectedDevIds(next.length === 0 || next.length === devList.length ? null : next)
    } else {
      const next = [...selectedDevIds, devId]
      setSelectedDevIds(next.length === devList.length ? null : next)
    }
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: 'calc(100vh - 45px)', overflow: 'hidden', fontFamily: 'system-ui, sans-serif', fontSize: 13 }}>

      {/* ── Locked header ── */}
      <div style={{ flexShrink: 0, padding: '16px 24px 0', maxWidth: 1300, boxSizing: 'border-box', background: '#fff' }}>

      {/* ── Top bar ── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16, flexWrap: 'wrap' }}>
        <select value={entGroupId ?? ''}
          onChange={e => { setEntGroupId(Number(e.target.value)); setRunStatus(null) }}
          style={{ fontSize: 13, padding: '4px 8px', borderRadius: 4, border: '1px solid #d1d5db' }}>
          {entGroups.filter(g => showTestCommunities ? g.is_test : !g.is_test).map(g => (
            <option key={g.ent_group_id} value={g.ent_group_id}>
              {g.ent_group_name ?? `Group ${g.ent_group_id}`}
            </option>
          ))}
        </select>

        <button onClick={() => setModalOpen(true)}
          title="Community settings"
          style={{ fontSize: 15, lineHeight: 1, padding: '4px 10px', borderRadius: 4,
                   border: '1px solid #d1d5db', background: '#fff',
                   color: '#6b7280', cursor: 'pointer' }}>
          ⚙
        </button>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <button onClick={handleRun} disabled={!entGroupId || isRunning}
            style={{ padding: '5px 16px', borderRadius: 4, fontSize: 13, fontWeight: 600,
                     background: isRunning ? '#93c5fd' : '#2563eb',
                     color: '#fff', border: 'none', cursor: isRunning ? 'default' : 'pointer',
                     display: 'flex', alignItems: 'center', gap: 8 }}>
            {isRunning && (
              <span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: '50%',
                             border: '2px solid rgba(255,255,255,0.5)', borderTopColor: '#fff',
                             animation: 'spin 0.8s linear infinite' }} />
            )}
            {isRunning ? 'Running…' : 'Run Simulation'}
          </button>
          {runWarnings.length > 0 && !isRunning && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              {runWarnings.map((w, i) => (
                <span key={i} style={{ fontSize: 11, color: '#b45309', display: 'flex', alignItems: 'center', gap: 4 }}>
                  ⚠ {w}
                </span>
              ))}
            </div>
          )}
        </div>

        {/* Run result card */}
        {runStatus && !isRunning && (
          <div style={{
            display: 'flex', alignItems: 'center', gap: 8,
            padding: '5px 12px', borderRadius: 6, fontSize: 12,
            background: runStatus.ok ? '#f0fdf4' : '#fef2f2',
            border: `1px solid ${runStatus.ok ? '#bbf7d0' : '#fecaca'}`,
          }}>
            <span style={{ fontWeight: 600, color: runStatus.ok ? '#15803d' : '#dc2626' }}>
              {runStatus.ok ? '✓ Run complete' : '✕ Run failed'}
            </span>
            {runStatus.ok && (
              <span style={{ color: '#6b7280' }}>
                {runStatus.iterations} iteration{runStatus.iterations !== 1 ? 's' : ''} · {runStatus.elapsed_ms}ms
              </span>
            )}
            {!runStatus.ok && (
              <span style={{ color: '#dc2626', maxWidth: 300, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {runStatus.error}
              </span>
            )}
            {lastRunAt && (
              <span style={{ color: '#9ca3af', fontSize: 11 }}>
                {lastRunAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </span>
            )}
            <button onClick={() => setRunStatus(null)}
              style={{ marginLeft: 4, background: 'none', border: 'none', cursor: 'pointer',
                       color: '#9ca3af', fontSize: 14, lineHeight: 1, padding: '0 2px' }}>
              ×
            </button>
          </div>
        )}

      </div>
      {/* ── Data load error banner ── */}
      {loadError && (
        <div style={{
          marginBottom: 12, padding: '8px 14px',
          background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 6,
          display: 'flex', alignItems: 'center', gap: 10,
        }}>
          <span style={{ fontSize: 12, color: '#dc2626', flex: 1 }}>{loadError}</span>
          <button
            onClick={() => setLoadError(null)}
            style={{ fontSize: 11, padding: '2px 8px', borderRadius: 4, border: '1px solid #fca5a5',
                     background: 'transparent', color: '#dc2626', cursor: 'pointer' }}
          >
            Dismiss
          </button>
        </div>
      )}

      {/* ── Starts targets — read-only summary ── */}
      {staleParams.length > 0 && (
        <div style={{ marginBottom: 12, display: 'flex', flexWrap: 'wrap', gap: '4px 16px', alignItems: 'center' }}>
          {staleParams.map(p => {
            const dotColor = { ok: '#16a34a', stale: '#d97706', missing: '#dc2626' }[p.status] ?? '#9ca3af'
            const target = p.annual_starts_target != null ? `${p.annual_starts_target}/yr` : '—'
            const cap    = p.max_starts_per_month  != null ? ` · ${p.max_starts_per_month}/mo` : ''
            return (
              <span key={p.dev_id} style={{ fontSize: 11, color: '#6b7280', display: 'flex', alignItems: 'center', gap: 4 }}>
                <span style={{ width: 6, height: 6, borderRadius: '50%', background: dotColor, display: 'inline-block', flexShrink: 0 }} />
                {p.dev_name} <span style={{ color: '#374151' }}>{target}{cap}</span>
              </span>
            )
          })}
          <button onClick={() => setModalOpen(true)} style={{
            fontSize: 11, color: '#2563eb', background: 'none', border: 'none',
            cursor: 'pointer', padding: 0,
          }}>edit</button>
        </div>
      )}

      {/* ── Run errors ── */}
      {runErrors.length > 0 && (
        <div style={{ marginBottom: 12, padding: '8px 14px', background: '#fef3c7',
                      border: '1px solid #f59e0b', borderRadius: 6, fontSize: 12 }}>
          <div style={{ fontWeight: 600, color: '#92400e', marginBottom: 4 }}>Simulation ran with warnings:</div>
          <ul style={{ margin: 0, paddingLeft: 18, color: '#78350f', lineHeight: 1.7 }}>
            {runErrors.map((e, i) => <li key={i}>{e}</li>)}
          </ul>
        </div>
      )}

      {/* ── Missing splits ── */}
      {missingSplits.length > 0 && (
        <div style={{ marginBottom: 12, padding: '8px 14px', background: '#fffbeb',
                      border: '1px solid #fbbf24', borderRadius: 6, fontSize: 12 }}>
          <div style={{ fontWeight: 600, color: '#92400e', marginBottom: 3 }}>
            {missingSplits.length} phase{missingSplits.length !== 1 ? 's' : ''} have no product splits (D-100):
          </div>
          <ul style={{ margin: 0, paddingLeft: 18, color: '#78350f', lineHeight: 1.7 }}>
            {missingSplits.map(p => <li key={p.phase_id}><b>{p.phase_name}</b> — {p.instrument_name}</li>)}
          </ul>
        </div>
      )}

      {/* ── View tabs ── */}
      <div style={{ display: 'flex', gap: 2, marginBottom: 12, alignItems: 'center' }}>
        {[
          ['ledger',      'Ledger'],
          ['lots',        'Lot List'],
          ['delivery',    'Delivery Schedule'],
          ['utilization', 'Phase Utilization'],
          ['overrides',   null],
        ].map(([v, label]) => {
          const isOverrides = v === 'overrides'
          const count = overrides.length
          return (
            <button key={v} onClick={() => {
              setView(v)
              if (v === 'lots'     && entGroupId) loadLots(entGroupId)
              if (v === 'delivery' && entGroupId) loadDeliverySchedule(entGroupId)
              if (v === 'overrides' && entGroupId) fetchOverrides()
            }}
              style={{ padding: '4px 14px', fontSize: 12, borderRadius: 4, border: '1px solid #d1d5db',
                       cursor: 'pointer',
                       background: view === v ? (isOverrides ? '#92400e' : '#1e40af') : '#f9fafb',
                       color: view === v ? '#fff' : (isOverrides && count > 0 ? '#92400e' : '#374151'),
                       fontWeight: view === v ? 600 : (isOverrides && count > 0 ? 600 : 400) }}>
              {isOverrides
                ? <>Plan{count > 0 && <span style={{ marginLeft: 5, background: view === v ? 'rgba(255,255,255,0.3)' : '#fef3c7', color: view === v ? '#fff' : '#92400e', borderRadius: 10, fontSize: 10, padding: '0 5px', fontWeight: 700 }}>{count}</span>}</>
                : label}
            </button>
          )
        })}
      </div>

      </div>{/* end locked header */}

      {/* ── Tab content ── */}
      <div style={{ flex: 1, overflow: 'hidden', padding: '0 24px', maxWidth: 1300, boxSizing: 'border-box' }}>

      {/* ── Ledger ── */}
      {view === 'ledger' && (
        <div style={{ height: '100%', overflowY: 'auto' }}>
        <>
          {loading && <div style={{ color: '#6b7280', fontSize: 12 }}>Loading…</div>}
          {!loading && !hasData && (
            <div style={{ color: '#9ca3af', fontSize: 12 }}>No ledger data. Run a simulation to populate results.</div>
          )}
          {!loading && hasData && (
            <>
              {/* Controls row */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 10, flexWrap: 'wrap' }}>
                {/* Dev filter pills */}
                <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                  <span style={{ fontSize: 11, color: '#9ca3af', marginRight: 2 }}>Dev</span>
                  <button onClick={() => setSelectedDevIds(null)}
                    style={{ padding: '3px 10px', fontSize: 11, borderRadius: 12, border: '1px solid',
                             borderColor: selectedDevIds === null ? '#1e40af' : '#d1d5db',
                             background: selectedDevIds === null ? '#dbeafe' : '#fff',
                             color: selectedDevIds === null ? '#1e40af' : '#374151',
                             cursor: 'pointer', fontWeight: selectedDevIds === null ? 600 : 400 }}>All</button>
                  {devList.map(({ id, name }) => {
                    const active = selectedDevIds !== null && selectedDevIds.includes(id)
                    return (
                      <button key={id} onClick={() => toggleDev(id)}
                        style={{ padding: '3px 10px', fontSize: 11, borderRadius: 12, border: '1px solid',
                                 borderColor: active ? '#1e40af' : '#d1d5db',
                                 background: active ? '#dbeafe' : '#fff',
                                 color: active ? '#1e40af' : '#374151',
                                 cursor: 'pointer', fontWeight: active ? 600 : 400 }}>
                        {name}
                      </button>
                    )
                  })}
                </div>

                {/* Period toggle */}
                <div style={{ display: 'flex', gap: 2 }}>
                  {[['monthly','M'],['quarterly','Q'],['annual','Y']].map(([v, label]) => (
                    <button key={v} onClick={() => setPeriod(v)}
                      style={{ padding: '3px 10px', fontSize: 11, borderRadius: 4, border: '1px solid #d1d5db',
                               cursor: 'pointer', background: period === v ? '#1e40af' : '#f9fafb',
                               color: period === v ? '#fff' : '#374151', fontWeight: period === v ? 600 : 400 }}>
                      {label}
                    </button>
                  ))}
                </div>

                {/* Ledger / Graph sub-toggle */}
                <div style={{ display: 'flex', gap: 0, borderRadius: 4, overflow: 'hidden',
                              border: '1px solid #d1d5db', flexShrink: 0 }}>
                  {[['graph','Chart'],['table','Table']].map(([v, label]) => (
                    <button key={v} onClick={() => setLedgerSubView(v)}
                      style={{ padding: '3px 12px', fontSize: 11, border: 'none', cursor: 'pointer',
                               background: ledgerSubView === v ? '#1e40af' : '#f9fafb',
                               color: ledgerSubView === v ? '#fff' : '#374151',
                               fontWeight: ledgerSubView === v ? 600 : 400 }}>
                      {label}
                    </button>
                  ))}
                </div>

                <span style={{ fontSize: 11, color: '#9ca3af', marginLeft: 'auto', fontStyle: 'italic' }}>
                  {ledgerRows.length} {period === 'monthly' ? 'months' : period === 'quarterly' ? 'quarters' : 'years'}
                  {selectedDevIds !== null && ` · ${selectedDevIds.length} dev${selectedDevIds.length !== 1 ? 's' : ''}`}
                </span>
                {ledgerConfig !== null && (
                  ledgerConfig.date_paper
                    ? <span style={{ fontSize: 11, color: '#9ca3af' }}>
                        From {fmt(ledgerConfig.date_paper)}
                        <button onClick={() => setModalOpen(true)}
                          style={{ marginLeft: 5, fontSize: 11, color: '#2563eb', background: 'none',
                                   border: 'none', cursor: 'pointer', padding: 0 }}>
                          edit
                        </button>
                      </span>
                    : <button onClick={() => setModalOpen(true)}
                        style={{ fontSize: 11, color: '#dc2626', background: 'none',
                                 border: 'none', cursor: 'pointer', padding: 0 }}>
                        Set start date ↗
                      </button>
                )}
              </div>

              {ledgerSubView === 'table'
                ? <LedgerTable rows={ledgerRows} floors={deliveryConfig} period={period} lots={lots} deliverySchedule={deliverySchedule} />
                : <LedgerGraph rows={ledgerRows} period={period} deliverySchedule={deliverySchedule} selectedDevIds={selectedDevIds} />
              }
            </>
          )}
        </>
        </div>
      )}

      {/* ── Lot List ── */}
      {view === 'lots' && (
        <LotLedger
          lots={lots}
          loading={lotsLoading}
          onApplyOverride={async (lotId, changes) => {
            await applyOverrides(lotId, changes)
            loadLots(entGroupId)
          }}
          onClearOverride={async (lotId, dateField) => {
            await clearOverride(lotId, dateField)
            loadLots(entGroupId)
          }}
        />
      )}

      {/* ── Plan / Overrides ── */}
      {view === 'overrides' && (
        <div style={{ height: '100%', overflowY: 'auto' }}>
        <OverridesPanel
          overrides={overrides}
          loading={ovLoading}
          onClear={(lotId, dateField) => clearOverride(lotId, dateField)}
          onClearAll={() => {
            const lotIds = [...new Set(overrides.map(o => o.lot_id))]
            clearBatch({ lotIds })
          }}
          onExport={async () => {
            const rows = await exportOverrides()
            if (!rows.length) { alert('No overrides to export.'); return }
            const headers = ['Lot','Dev','Phase','Field','Activity','MARKS Current','Override','Delta Days','Note']
            const csv = [
              headers.join(','),
              ...rows.map(r => [
                r.lot_number, r.dev_name, r.phase_name, r.label, r.marks_activity,
                r.current_marks ?? '', r.override_value, r.delta_days ?? '', r.override_note ?? '',
              ].map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')),
            ].join('\n')
            const blob = new Blob([csv], { type: 'text/csv' })
            const url = URL.createObjectURL(blob)
            const a = document.createElement('a'); a.href = url; a.download = 'itk_changes.csv'; a.click()
            URL.revokeObjectURL(url)
          }}
          onCheckReconciliation={async () => {
            await fetchReconciliation()
            setShowReconModal(true)
          }}
        />
        </div>
      )}

      {/* ── Delivery Schedule ── */}
      {view === 'delivery' && (
        <div style={{ height: '100%', overflowY: 'auto' }}>
          <DeliveryScheduleTab rows={deliverySchedule} loading={deliveryScheduleLoading} />
        </div>
      )}

      {/* ── Phase Utilization ── */}
      {view === 'utilization' && (
        <div style={{ height: '100%', overflowY: 'auto' }}>
          {loading && <div style={{ color: '#6b7280', fontSize: 12 }}>Loading…</div>}
          {!loading && <UtilizationPanel phases={filteredUtilization} />}
        </div>
      )}

      {/* ── Sync reconciliation modal ── */}
      {showReconModal && reconciliation.length > 0 && (
        <SyncReconciliationModal
          rows={reconciliation}
          onClearSelected={async (ids) => {
            await clearBatch({ overrideIds: ids })
            setShowReconModal(false)
          }}
          onDismiss={() => setShowReconModal(false)}
        />
      )}

      {/* ── Global settings modal (triggered from nav) ── */}
      {globalSettingsOpen && (
        <div onClick={onCloseGlobalSettings} style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.25)',
          zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <div onClick={e => e.stopPropagation()} style={{
            background: '#fff', borderRadius: 8, padding: 24,
            width: 580, maxHeight: '85vh', overflowY: 'auto',
            boxShadow: '0 8px 32px rgba(0,0,0,0.18)',
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
              <span style={{ fontWeight: 700, fontSize: 15, color: '#111827' }}>Global Settings</span>
              <button onClick={onCloseGlobalSettings} style={{
                fontSize: 18, lineHeight: 1, background: 'none', border: 'none',
                cursor: 'pointer', color: '#9ca3af', padding: '0 4px',
              }}>×</button>
            </div>
            <GlobalSettingsSection
              globalSettings={globalSettings}
              onSaved={loadGlobalSettings}
              disabled={isRunning}
            />
          </div>
        </div>
      )}

      {/* ── Community settings modal ── */}
      {modalOpen && (
        <div onClick={() => setModalOpen(false)} style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.25)',
          zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <div onClick={e => e.stopPropagation()} style={{
            background: '#fff', borderRadius: 8, padding: 24,
            width: 580, maxHeight: '85vh', overflowY: 'auto',
            boxShadow: '0 8px 32px rgba(0,0,0,0.18)',
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
              <span style={{ fontWeight: 700, fontSize: 15, color: '#111827' }}>Community Settings</span>
              <button onClick={() => setModalOpen(false)} style={{
                fontSize: 18, lineHeight: 1, background: 'none', border: 'none',
                cursor: 'pointer', color: '#9ca3af', padding: '0 4px',
              }}>×</button>
            </div>

            {ledgerConfig !== null && (
              <div style={{ marginBottom: 20, paddingBottom: 20, borderBottom: '1px solid #e5e7eb' }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: '#374151', marginBottom: 10 }}>Ledger dates</div>
                <LedgerConfigSection
                  entGroupId={entGroupId}
                  datePaper={ledgerConfig.date_paper}
                  dateEnt={ledgerConfig.date_ent}
                  earliestDeliveryDate={ledgerConfig.earliest_delivery_date ?? null}
                  onSaved={() => { loadConfig(entGroupId); loadLedger(entGroupId) }}
                  disabled={isRunning}
                />
              </div>
            )}

            {deliveryConfig !== null && (
              <div style={{ marginBottom: 20, paddingBottom: 20, borderBottom: '1px solid #e5e7eb' }}>
                <DeliveryConfigSection
                  entGroupId={entGroupId}
                  deliveryConfig={deliveryConfig}
                  globalSettings={globalSettings}
                  onSaved={() => loadConfig(entGroupId)}
                  disabled={isRunning}
                />
              </div>
            )}

            <div>
              <div style={{ fontSize: 12, fontWeight: 600, color: '#374151', marginBottom: 10 }}>Annual starts pace</div>
              <StartsTargetsSection
                entGroupId={entGroupId}
                params={staleParams}
                onSaved={() => checkSplits(entGroupId)}
                disabled={isRunning}
              />
            </div>
          </div>
        </div>
      )}

      </div>{/* end tab content */}
    </div>
  )
}
