import { useState, useMemo } from 'react'
import {
  AreaChart, Area, BarChart, Bar, LineChart, Line,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from 'recharts'
import { STATUS_CFG, STATUS_COLOR } from '../../utils/statusConfig'
import { periodKey } from './simShared'

const GRAPH_TOOLTIP_STYLE = { fontSize: 11, border: '1px solid #e5e7eb', background: '#fff', borderRadius: 4 }

const CHART_PANELS = [
  { key: 'pipeline', label: 'Pipeline' },
  { key: 'backlog',  label: 'Backlog'  },
  { key: 'velocity', label: 'Velocity' },
  { key: 'closings', label: 'Closings' },
]

function PipelineTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null
  const rowData = payload[0]?.payload
  const deliveries = rowData?._deliveries
  const cumCls = rowData?.cls_cumulative
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
      {cumCls > 0 && (
        <div style={{ borderTop: '1px solid #e5e7eb', marginTop: 6, paddingTop: 6 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16 }}>
            <span style={{ color: STATUS_COLOR.OUT }}>Closed to date</span>
            <span style={{ fontWeight: 600, color: '#374151' }}>{cumCls}</span>
          </div>
        </div>
      )}
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

export function LedgerGraph({ rows, period, deliverySchedule = [], selectedDevIds }) {
  const [panel, setPanel] = useState('pipeline')

  const enrichedRows = useMemo(() => {
    // Step 1: enrich with delivery pin markers
    let withDeliveries = rows
    if (deliverySchedule.length) {
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
      if (map.size) {
        withDeliveries = rows.map(r => {
          const delivs = map.get(r.calendar_month)
          if (!delivs?.length) return r
          const stackTop = (r.h_end||0) + (r.u_end||0) + (r.uc_end||0) + (r.c_end||0) + (r.d_end||0)
          return { ...r, _deliveries: delivs, _pinY: stackTop }
        })
      }
    }

    // Step 2: add cumulative closings (running sum of cls_plan)
    let cumCls = 0
    return withDeliveries.map(r => {
      cumCls += (r.cls_plan || 0)
      return { ...r, cls_cumulative: cumCls }
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

      {panel === 'pipeline' && (
        <>
          <ResponsiveContainer width="100%" height={280}>
            <AreaChart data={enrichedRows} {...chartProps} syncId="ledger-pipeline">
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

          <div style={{ marginTop: 6 }}>
            <div style={{ fontSize: 10, color: '#9ca3af', paddingLeft: 38, marginBottom: 2 }}>
              Cumulative closings
            </div>
            <ResponsiveContainer width="100%" height={110}>
              <AreaChart data={enrichedRows} {...chartProps} syncId="ledger-pipeline">
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" vertical={false} />
                <XAxis dataKey="_label" interval={xInterval} {...axisProps} />
                <YAxis {...axisProps} width={34} />
                <Tooltip cursor={{ stroke: '#94a3b8', strokeWidth: 1 }} content={() => null} />
                <Area type="monotone" dataKey="cls_cumulative"
                      stroke={STATUS_COLOR.OUT} fill={STATUS_COLOR.OUT}
                      fillOpacity={0.25} strokeWidth={1.5}
                      dot={false} isAnimationActive={false} legendType="none" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </>
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
            <Line type="monotone" dataKey="ent_plan"       stroke="#f59e0b"         strokeWidth={1.5} dot={false} name="ENT" />
            <Line type="monotone" dataKey="dev_plan"       stroke="#a8a29e"         strokeWidth={1.5} dot={false} name="DEV" />
            <Line type="monotone" dataKey="td_plan"        stroke="#818cf8"         strokeWidth={1.5} dot={false} name="TD"  />
            <Line type="monotone" dataKey="str_plan"       stroke={STATUS_COLOR.U}  strokeWidth={1.5} dot={false} name="STR" />
            <Line type="monotone" dataKey="str_plan_spec"  stroke="#0d9488"         strokeWidth={1.5} dot={false} name="STR(S)" strokeDasharray="4 2" />
            <Line type="monotone" dataKey="str_plan_build" stroke="#6b7280"         strokeWidth={1.5} dot={false} name="STR(B)" strokeDasharray="4 2" />
            <Line type="monotone" dataKey="cmp_plan"       stroke={STATUS_COLOR.C}  strokeWidth={1.5} dot={false} name="CMP" />
            <Line type="monotone" dataKey="cls_plan"       stroke={STATUS_COLOR.OUT} strokeWidth={2}  dot={false} name="CLS" />
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
            <Bar dataKey="str_plan_spec"  stackId="str" fill="#0d9488"         name="STR(S)" radius={[0,0,0,0]} />
            <Bar dataKey="str_plan_build" stackId="str" fill={STATUS_COLOR.U}  name="STR(B)" radius={[2,2,0,0]} />
            <Bar dataKey="cmp_plan"                     fill={STATUS_COLOR.C}  name="CMP"    radius={[2,2,0,0]} />
            <Bar dataKey="cls_plan"                     fill={STATUS_COLOR.OUT} name="CLS"   radius={[2,2,0,0]} />
          </BarChart>
        </ResponsiveContainer>
      )}
    </div>
  )
}
