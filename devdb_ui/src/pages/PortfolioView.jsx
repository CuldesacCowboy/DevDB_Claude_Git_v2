import { useState, useEffect, useMemo } from 'react'
import {
  AreaChart, Area, LineChart, Line,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from 'recharts'
import { API_BASE } from '../config'
import { STATUS_COLOR } from '../utils/statusConfig'

const STATUS_OPTIONS = ['Active', 'Prospective', 'Sold Out', 'Unlikely', 'Abandoned', 'OFFSITE', 'OTHER']
const STATUS_PILL_COLORS = {
  Active: '#16a34a', Prospective: '#2563eb', 'Sold Out': '#6b7280',
  Unlikely: '#d97706', Abandoned: '#dc2626', OFFSITE: '#9ca3af', OTHER: '#9ca3af',
}

function fmt(iso) {
  if (!iso) return ''
  const d = new Date(iso + 'T00:00:00')
  return d.toLocaleDateString('en-US', { month: 'short', year: '2-digit' })
}

// ── Summary Card ─────────────────────────────────────────────────────────────
function Card({ label, value, color = '#374151', sub }) {
  return (
    <div style={{
      flex: 1, minWidth: 160, padding: '16px 20px', borderRadius: 8,
      border: '1px solid #e5e7eb', background: '#fff',
    }}>
      <div style={{ fontSize: 28, fontWeight: 700, color }}>{value}</div>
      <div style={{ fontSize: 12, color: '#6b7280', marginTop: 2 }}>{label}</div>
      {sub && <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 2 }}>{sub}</div>}
    </div>
  )
}

// ── Builder Table ────────────────────────────────────────────────────────────
function BuilderTable({ builders }) {
  const [sortKey, setSortKey] = useState('total_lots')
  const sorted = useMemo(() =>
    [...builders].sort((a, b) => b[sortKey] - a[sortKey]),
    [builders, sortKey]
  )
  const th = (key, label, w) => (
    <th onClick={() => setSortKey(key)} style={{
      padding: '6px 10px', fontSize: 11, fontWeight: 600, color: '#6b7280',
      cursor: 'pointer', textAlign: 'right', width: w,
      background: sortKey === key ? '#eff6ff' : '#f9fafb',
      borderBottom: '2px solid #e5e7eb', whiteSpace: 'nowrap',
    }}>{label} {sortKey === key ? '▼' : ''}</th>
  )
  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: 12 }}>
        <thead>
          <tr>
            <th style={{ padding: '6px 10px', textAlign: 'left', fontSize: 11, fontWeight: 600, color: '#6b7280', background: '#f9fafb', borderBottom: '2px solid #e5e7eb' }}>Builder</th>
            {th('total_lots', 'Total Lots', 80)}
            {th('started', 'Started', 70)}
            {th('pipeline', 'Pipeline', 70)}
            {th('communities', 'Communities', 90)}
            <th style={{ padding: '6px 10px', fontSize: 11, fontWeight: 600, color: '#6b7280', background: '#f9fafb', borderBottom: '2px solid #e5e7eb', width: 140 }}>Utilization</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map(b => {
            const pct = b.total_lots > 0 ? Math.round(b.started / b.total_lots * 100) : 0
            return (
              <tr key={b.builder_id} style={{ borderBottom: '1px solid #f0f0f0' }}>
                <td style={{ padding: '6px 10px', fontWeight: 500, color: '#374151' }}>{b.builder_name}</td>
                <td style={{ padding: '6px 10px', textAlign: 'right' }}>{b.total_lots}</td>
                <td style={{ padding: '6px 10px', textAlign: 'right' }}>{b.started}</td>
                <td style={{ padding: '6px 10px', textAlign: 'right' }}>{b.pipeline}</td>
                <td style={{ padding: '6px 10px', textAlign: 'right' }}>{b.communities}</td>
                <td style={{ padding: '6px 10px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <div style={{ flex: 1, height: 8, background: '#f3f4f6', borderRadius: 4, overflow: 'hidden' }}>
                      <div style={{ width: `${pct}%`, height: '100%', background: pct > 80 ? '#dc2626' : pct > 50 ? '#d97706' : '#16a34a', borderRadius: 4 }} />
                    </div>
                    <span style={{ fontSize: 10, color: '#6b7280', minWidth: 28 }}>{pct}%</span>
                  </div>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

// ── Main Component ───────────────────────────────────────────────────────────
export default function PortfolioView({ showTestCommunities }) {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [selectedStatuses, setSelectedStatuses] = useState(['Active'])
  const [chartPanel, setChartPanel] = useState('production')

  useEffect(() => {
    setLoading(true)
    const qs = selectedStatuses.length ? `?status=${selectedStatuses.join(',')}` : ''
    fetch(`${API_BASE}/portfolio/summary${qs}`)
      .then(r => r.json())
      .then(d => setData(d))
      .catch(() => setData(null))
      .finally(() => setLoading(false))
  }, [selectedStatuses])

  const toggleStatus = (s) => {
    setSelectedStatuses(prev =>
      prev.includes(s) ? prev.filter(x => x !== s) : [...prev, s]
    )
  }

  if (loading && !data) return <div style={{ padding: 24, color: '#6b7280' }}>Loading portfolio...</div>
  if (!data) return <div style={{ padding: 24, color: '#dc2626' }}>Failed to load portfolio data.</div>

  const communities = data.communities || []
  const monthly = data.monthly_aggregate || []
  const builders = data.builder_summary || []
  const statusCounts = data.status_counts || {}

  const totalCommunities = communities.length
  const totalStartsYTD = communities.reduce((s, c) => s + (c.starts_ytd || 0), 0)
  const totalUnstarted = communities.reduce((s, c) => s + (c.unstarted_real || 0), 0)
  const totalProjected = communities.reduce((s, c) => s + (c.total_projected || 0), 0)
  const totalTarget = communities.reduce((s, c) => s + (c.annual_starts_target || 0), 0)

  const chartRows = monthly.map(r => ({ ...r, _label: fmt(r.calendar_month) }))

  const tickStyle = { fontSize: 10, fill: '#9ca3af' }
  const axisProps = { tick: tickStyle, tickLine: false, axisLine: false }

  return (
    <div style={{ maxWidth: 1200, margin: '0 auto', padding: '16px 24px' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 20 }}>
        <h1 style={{ fontSize: 20, fontWeight: 700, color: '#1f2937', margin: 0 }}>Portfolio Dashboard</h1>
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
          {STATUS_OPTIONS.map(s => {
            const active = selectedStatuses.includes(s)
            const cnt = statusCounts[s] || 0
            return (
              <button key={s} onClick={() => toggleStatus(s)} style={{
                padding: '2px 10px', fontSize: 11, borderRadius: 12, cursor: 'pointer',
                border: active ? `1px solid ${STATUS_PILL_COLORS[s]}` : '1px solid #d1d5db',
                background: active ? STATUS_PILL_COLORS[s] + '18' : '#fff',
                color: active ? STATUS_PILL_COLORS[s] : '#9ca3af',
                fontWeight: active ? 600 : 400,
              }}>
                {s} ({cnt})
              </button>
            )
          })}
        </div>
      </div>

      {/* Summary Cards */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 24, flexWrap: 'wrap' }}>
        <Card label="Communities" value={totalCommunities} color="#2563eb" />
        <Card label="Starts YTD" value={totalStartsYTD} color="#16a34a"
          sub={totalTarget > 0 ? `${totalTarget}/yr target` : undefined} />
        <Card label="Unstarted Inventory" value={totalUnstarted.toLocaleString()} color="#d97706" />
        <Card label="Total Projected" value={totalProjected.toLocaleString()} color="#7c3aed"
          sub="from product splits" />
      </div>

      {/* Charts */}
      {chartRows.length > 0 && (
        <div style={{ marginBottom: 24 }}>
          <div style={{ display: 'flex', gap: 4, marginBottom: 12 }}>
            {[
              ['production', 'Production Curve'],
              ['pipeline', 'Inventory Pipeline'],
            ].map(([key, label]) => (
              <button key={key} onClick={() => setChartPanel(key)} style={{
                padding: '4px 14px', fontSize: 12, borderRadius: 4, cursor: 'pointer',
                border: '1px solid #d1d5db',
                background: chartPanel === key ? '#1e40af' : '#f9fafb',
                color: chartPanel === key ? '#fff' : '#374151',
                fontWeight: chartPanel === key ? 600 : 400,
              }}>{label}</button>
            ))}
          </div>

          {chartPanel === 'production' && (
            <ResponsiveContainer width="100%" height={300}>
              <LineChart data={chartRows} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" vertical={false} />
                <XAxis dataKey="_label" interval={11} {...axisProps} />
                <YAxis {...axisProps} width={40} />
                <Tooltip contentStyle={{ fontSize: 11, border: '1px solid #e5e7eb', borderRadius: 4 }} />
                <Legend wrapperStyle={{ fontSize: 11, paddingTop: 8 }} />
                <Line type="monotone" dataKey="str_plan" stroke={STATUS_COLOR.U || '#2563eb'} strokeWidth={2} dot={false} name="Starts" />
                <Line type="monotone" dataKey="cmp_plan" stroke={STATUS_COLOR.C || '#16a34a'} strokeWidth={2} dot={false} name="Completions" />
                <Line type="monotone" dataKey="cls_plan" stroke={STATUS_COLOR.OUT || '#6b7280'} strokeWidth={2} dot={false} name="Closings" />
              </LineChart>
            </ResponsiveContainer>
          )}

          {chartPanel === 'pipeline' && (
            <ResponsiveContainer width="100%" height={300}>
              <AreaChart data={chartRows} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" vertical={false} />
                <XAxis dataKey="_label" interval={11} {...axisProps} />
                <YAxis {...axisProps} width={40} />
                <Tooltip contentStyle={{ fontSize: 11, border: '1px solid #e5e7eb', borderRadius: 4 }} />
                <Legend wrapperStyle={{ fontSize: 11, paddingTop: 8 }} />
                <Area type="linear" dataKey="d_end" stackId="s" stroke="#a8a29e" fill="#a8a29e" fillOpacity={0.75} name="D" />
                <Area type="linear" dataKey="h_end" stackId="s" stroke="#fbbf24" fill="#fbbf24" fillOpacity={0.80} name="H" />
                <Area type="linear" dataKey="u_end" stackId="s" stroke="#3b82f6" fill="#3b82f6" fillOpacity={0.85} name="U" />
                <Area type="linear" dataKey="uc_end" stackId="s" stroke="#f97316" fill="#f97316" fillOpacity={0.85} name="UC" />
                <Area type="linear" dataKey="c_end" stackId="s" stroke="#22c55e" fill="#22c55e" fillOpacity={0.85} name="C" />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </div>
      )}

      {/* Builder Capacity */}
      {builders.length > 0 && (
        <div>
          <h2 style={{ fontSize: 14, fontWeight: 600, color: '#374151', marginBottom: 8 }}>Builder Capacity</h2>
          <BuilderTable builders={builders} />
        </div>
      )}
    </div>
  )
}
