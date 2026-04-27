import { useMemo } from 'react'
import {
  AreaChart, Area, LineChart, Line,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from 'recharts'
import { STATUS_COLOR } from '../../utils/statusConfig'

function fmt(iso) {
  if (!iso) return ''
  const d = new Date(iso + 'T00:00:00')
  return d.toLocaleDateString('en-US', { month: 'short', year: '2-digit' })
}

function MetricCard({ label, baseVal, scenarioVal, unit = '', better = 'lower' }) {
  const delta = scenarioVal - baseVal
  const isGood = better === 'lower' ? delta <= 0 : delta >= 0
  return (
    <div style={{
      flex: 1, minWidth: 140, padding: '10px 14px', borderRadius: 6,
      border: '1px solid #e5e7eb', background: '#fff',
    }}>
      <div style={{ fontSize: 11, color: '#6b7280', marginBottom: 4 }}>{label}</div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
        <span style={{ fontSize: 12, color: '#9ca3af' }}>{baseVal}{unit}</span>
        <span style={{ fontSize: 14, fontWeight: 700, color: '#374151' }}>→</span>
        <span style={{ fontSize: 16, fontWeight: 700, color: '#374151' }}>{scenarioVal}{unit}</span>
      </div>
      {delta !== 0 && (
        <div style={{ fontSize: 12, fontWeight: 600, marginTop: 2, color: isGood ? '#16a34a' : '#dc2626' }}>
          {delta > 0 ? '+' : ''}{delta}{unit}
        </div>
      )}
    </div>
  )
}

function PipelineChart({ data, title, color = '#374151' }) {
  const tickStyle = { fontSize: 10, fill: '#9ca3af' }
  const axisProps = { tick: tickStyle, tickLine: false, axisLine: false }
  return (
    <div>
      <div style={{ fontSize: 12, fontWeight: 600, color, marginBottom: 4 }}>{title}</div>
      <ResponsiveContainer width="100%" height={200}>
        <AreaChart data={data} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" vertical={false} />
          <XAxis dataKey="_label" interval={11} {...axisProps} />
          <YAxis {...axisProps} width={34} />
          <Tooltip contentStyle={{ fontSize: 11, border: '1px solid #e5e7eb', borderRadius: 4 }} />
          <Area type="linear" dataKey="d_end" stackId="s" stroke="#a8a29e" fill="#a8a29e" fillOpacity={0.75} name="D" />
          <Area type="linear" dataKey="h_end" stackId="s" stroke="#fbbf24" fill="#fbbf24" fillOpacity={0.80} name="H" />
          <Area type="linear" dataKey="u_end" stackId="s" stroke="#3b82f6" fill="#3b82f6" fillOpacity={0.85} name="U" />
          <Area type="linear" dataKey="uc_end" stackId="s" stroke="#f97316" fill="#f97316" fillOpacity={0.85} name="UC" />
          <Area type="linear" dataKey="c_end" stackId="s" stroke="#22c55e" fill="#22c55e" fillOpacity={0.85} name="C" />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  )
}

function VelocityChart({ baseData, scenarioData }) {
  const tickStyle = { fontSize: 10, fill: '#9ca3af' }
  const axisProps = { tick: tickStyle, tickLine: false, axisLine: false }

  const merged = useMemo(() => {
    const scMap = {}
    for (const r of scenarioData) scMap[r.calendar_month] = r
    return baseData.map(r => {
      const sc = scMap[r.calendar_month] || {}
      return {
        ...r,
        sc_str: sc.str_plan || 0,
        sc_cmp: sc.cmp_plan || 0,
        sc_cls: sc.cls_plan || 0,
      }
    })
  }, [baseData, scenarioData])

  return (
    <div>
      <div style={{ fontSize: 12, fontWeight: 600, color: '#374151', marginBottom: 4 }}>
        Starts / Completions / Closings
        <span style={{ fontWeight: 400, color: '#9ca3af', marginLeft: 8 }}>Solid = base, Dashed = scenario</span>
      </div>
      <ResponsiveContainer width="100%" height={220}>
        <LineChart data={merged} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" vertical={false} />
          <XAxis dataKey="_label" interval={11} {...axisProps} />
          <YAxis {...axisProps} width={34} />
          <Tooltip contentStyle={{ fontSize: 11, border: '1px solid #e5e7eb', borderRadius: 4 }} />
          <Legend wrapperStyle={{ fontSize: 11, paddingTop: 8 }} />
          {/* Base - solid */}
          <Line type="monotone" dataKey="str_plan" stroke="#3b82f6" strokeWidth={2} dot={false} name="Base STR" />
          <Line type="monotone" dataKey="cmp_plan" stroke="#22c55e" strokeWidth={2} dot={false} name="Base CMP" />
          <Line type="monotone" dataKey="cls_plan" stroke="#6b7280" strokeWidth={2} dot={false} name="Base CLS" />
          {/* Scenario - dashed */}
          <Line type="monotone" dataKey="sc_str" stroke="#7c3aed" strokeWidth={2} strokeDasharray="6 3" dot={false} name="Scenario STR" />
          <Line type="monotone" dataKey="sc_cmp" stroke="#db2777" strokeWidth={2} strokeDasharray="6 3" dot={false} name="Scenario CMP" />
          <Line type="monotone" dataKey="sc_cls" stroke="#ea580c" strokeWidth={2} strokeDasharray="6 3" dot={false} name="Scenario CLS" />
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}

export function ScenarioCompareView({ baseRows, scenarioRows, scenarioName, overrides, onClose }) {
  const base = useMemo(() => (baseRows || []).map(r => ({ ...r, _label: fmt(r.calendar_month) })), [baseRows])
  const scenario = useMemo(() => (scenarioRows || []).map(r => ({ ...r, _label: fmt(r.calendar_month) })), [scenarioRows])

  // Compute summary metrics
  const sumField = (rows, field) => rows.reduce((s, r) => s + (r[field] || 0), 0)
  const peakField = (rows, field) => Math.max(0, ...rows.map(r => r[field] || 0))

  const baseStarts = sumField(base, 'str_plan')
  const scStarts = sumField(scenario, 'str_plan')
  const baseClosings = sumField(base, 'cls_plan')
  const scClosings = sumField(scenario, 'cls_plan')
  const basePeakD = peakField(base, 'd_end')
  const scPeakD = peakField(scenario, 'd_end')

  // Sellout month: last month with any non-closed inventory
  const lastActive = (rows) => {
    for (let i = rows.length - 1; i >= 0; i--) {
      const r = rows[i]
      if ((r.d_end || 0) + (r.h_end || 0) + (r.u_end || 0) + (r.uc_end || 0) + (r.c_end || 0) > 0) {
        return r._label
      }
    }
    return '—'
  }
  const baseSellout = lastActive(base)
  const scSellout = lastActive(scenario)

  // Override summary
  const overrideSummary = (overrides || []).map(o => {
    const parts = []
    if (o.scope === 'dev') parts.push(`Dev ${o.scope_id}`)
    if (o.scope === 'instrument') parts.push(`Inst ${o.scope_id}`)
    if (o.scope === 'ent_group') parts.push('Community')
    parts.push(`${o.param_name} = ${JSON.stringify(o.param_value)}`)
    return parts.join(': ')
  })

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Header */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 12, padding: '10px 16px',
        background: '#f5f3ff', border: '1px solid #c4b5fd', borderRadius: 8,
      }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: '#7c3aed' }}>
            Comparing: {scenarioName || 'Scenario'}
          </div>
          {overrideSummary.length > 0 && (
            <div style={{ fontSize: 11, color: '#6b7280', marginTop: 2 }}>
              Changes: {overrideSummary.join(' · ')}
            </div>
          )}
        </div>
        <button onClick={onClose} style={{
          padding: '4px 14px', fontSize: 12, borderRadius: 4, cursor: 'pointer',
          border: '1px solid #c4b5fd', background: '#fff', color: '#7c3aed', fontWeight: 600,
        }}>Close Comparison</button>
      </div>

      {/* Summary Metrics */}
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        <MetricCard label="Total Starts" baseVal={baseStarts} scenarioVal={scStarts} better="context" />
        <MetricCard label="Total Closings" baseVal={baseClosings} scenarioVal={scClosings} better="context" />
        <MetricCard label="Peak D-Inventory" baseVal={basePeakD} scenarioVal={scPeakD} better="lower" />
        <MetricCard label="Sellout" baseVal={baseSellout} scenarioVal={scSellout} />
      </div>

      {/* Pipeline comparison: base on top, scenario below */}
      <div style={{ display: 'flex', gap: 16 }}>
        <div style={{ flex: 1 }}>
          <PipelineChart data={base} title="Base Plan" color="#374151" />
        </div>
        <div style={{ flex: 1 }}>
          <PipelineChart data={scenario} title={scenarioName || 'Scenario'} color="#7c3aed" />
        </div>
      </div>

      {/* Velocity overlay */}
      <VelocityChart baseData={base} scenarioData={scenario} />
    </div>
  )
}
