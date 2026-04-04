import { useState, useEffect, useCallback, useMemo } from 'react'
import {
  AreaChart, Area, BarChart, Bar,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from 'recharts'
import { STATUS_CFG, STATUS_COLOR, StatusBadge } from '../utils/statusConfig'

const API = '/api'

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
const NUMERIC_COLS = [...EVENT_COLS, ...STATUS_COLS]


// ─── Helpers ─────────────────────────────────────────────────────────────────

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
  borderBottom: '2px solid #e5e7eb', color: '#6b7280', fontSize: 11,
  whiteSpace: 'nowrap', ...extra,
})
const tdS = (align = 'right', extra = {}) => ({
  padding: '3px 8px', textAlign: align, borderBottom: '1px solid #f3f4f6',
  fontVariantNumeric: 'tabular-nums', fontSize: 12, ...extra,
})

function cell(v) { return v > 0 ? v : <span style={{ color: '#e5e7eb' }}>—</span> }

// ─── LedgerTable ─────────────────────────────────────────────────────────────

function LedgerTable({ rows, floors, period }) {
  const floorMap = {}
  for (const [fk, sk] of Object.entries(FLOOR_STATUS)) {
    if (floors?.[fk] != null) floorMap[sk] = floors[fk]
  }

  return (
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
              {EVENT_COLS.map((c, idx) => (
                <td key={c} style={tdS('right', idx === 5 ? { borderRight: '2px solid #d1d5db' } : {})}>
                  {cell(r[c])}
                </td>
              ))}
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
  )
}

// ─── LedgerGraph ─────────────────────────────────────────────────────────────

const GRAPH_TOOLTIP_STYLE = { fontSize: 11, border: '1px solid #e5e7eb', background: '#fff', borderRadius: 4 }

function LedgerGraph({ rows, period }) {
  if (!rows.length) return null

  // Thin X axis labels: monthly → every 12th, quarterly → every 4th, annual → all
  const xInterval = period === 'monthly' ? 11 : period === 'quarterly' ? 3 : 0

  const tickStyle = { fontSize: 10, fill: '#9ca3af' }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 28 }}>

      {/* ── Inventory stacked area ── */}
      <div>
        <div style={{ fontSize: 10, fontWeight: 600, color: '#9ca3af', textTransform: 'uppercase',
                      letterSpacing: '0.05em', marginBottom: 8 }}>
          End-of-period inventory
        </div>
        <ResponsiveContainer width="100%" height={300}>
          <AreaChart data={rows} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" vertical={false} />
            <XAxis dataKey="_label" interval={xInterval} tick={tickStyle} tickLine={false} axisLine={false} />
            <YAxis tick={tickStyle} tickLine={false} axisLine={false} width={34} />
            <Tooltip contentStyle={GRAPH_TOOLTIP_STYLE}
              formatter={(v, name) => [v > 0 ? v : '—', name]}
              itemStyle={{ fontSize: 11 }} />
            <Legend wrapperStyle={{ fontSize: 11, paddingTop: 8 }} />
            <Area type="monotone" dataKey="p_end"  stackId="s" stroke={STATUS_COLOR.P}  fill={STATUS_COLOR.P}  fillOpacity={0.85} name={`${STATUS_CFG.P.shape} P`}  />
            <Area type="monotone" dataKey="e_end"  stackId="s" stroke={STATUS_COLOR.E}  fill={STATUS_COLOR.E}  fillOpacity={0.85} name={`${STATUS_CFG.E.shape} E`}  />
            <Area type="monotone" dataKey="d_end"  stackId="s" stroke={STATUS_COLOR.D}  fill={STATUS_COLOR.D}  fillOpacity={0.85} name={`${STATUS_CFG.D.shape} D`}  />
            <Area type="monotone" dataKey="h_end"  stackId="s" stroke={STATUS_COLOR.H}  fill={STATUS_COLOR.H}  fillOpacity={0.85} name={`${STATUS_CFG.H.shape} H`}  />
            <Area type="monotone" dataKey="u_end"  stackId="s" stroke={STATUS_COLOR.U}  fill={STATUS_COLOR.U}  fillOpacity={0.85} name={`${STATUS_CFG.U.shape} U`}  />
            <Area type="monotone" dataKey="uc_end" stackId="s" stroke={STATUS_COLOR.UC} fill={STATUS_COLOR.UC} fillOpacity={0.85} name={`${STATUS_CFG.UC.shape} UC`} />
            <Area type="monotone" dataKey="c_end"  stackId="s" stroke={STATUS_COLOR.C}  fill={STATUS_COLOR.C}  fillOpacity={0.85} name={`${STATUS_CFG.C.shape} C`}  />
          </AreaChart>
        </ResponsiveContainer>
      </div>

      {/* ── Activity bar chart ── */}
      <div>
        <div style={{ fontSize: 10, fontWeight: 600, color: '#9ca3af', textTransform: 'uppercase',
                      letterSpacing: '0.05em', marginBottom: 8 }}>
          Activity per period — STR / CMP / CLS
        </div>
        <ResponsiveContainer width="100%" height={220}>
          <BarChart data={rows} margin={{ top: 4, right: 8, bottom: 0, left: 0 }} barCategoryGap="30%">
            <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" vertical={false} />
            <XAxis dataKey="_label" interval={xInterval} tick={tickStyle} tickLine={false} axisLine={false} />
            <YAxis tick={tickStyle} tickLine={false} axisLine={false} width={34} />
            <Tooltip contentStyle={GRAPH_TOOLTIP_STYLE}
              formatter={(v, name) => [v > 0 ? v : '—', name]}
              itemStyle={{ fontSize: 11 }} />
            <Legend wrapperStyle={{ fontSize: 11, paddingTop: 8 }} />
            <Bar dataKey="str_plan" fill={STATUS_COLOR.U}   name="STR" radius={[2,2,0,0]} />
            <Bar dataKey="cmp_plan" fill={STATUS_COLOR.C}   name="CMP" radius={[2,2,0,0]} />
            <Bar dataKey="cls_plan" fill={STATUS_COLOR.OUT} name="CLS" radius={[2,2,0,0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>

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

function LedgerConfigSection({ entGroupId, datePaper, dateEnt, onSaved, disabled }) {
  const [paperVal, setPaperVal] = useState(datePaper ?? '')
  const [entVal,   setEntVal]   = useState(dateEnt   ?? '')
  const [saving,   setSaving]   = useState(false)
  const [err,      setErr]      = useState(null)
  const [lotsMsg,  setLotsMsg]  = useState(null)

  useEffect(() => { setPaperVal(datePaper ?? '') }, [datePaper])
  useEffect(() => { setEntVal(dateEnt ?? '') },     [dateEnt])

  const dirty = paperVal !== (datePaper ?? '') || entVal !== (dateEnt ?? '')
  const isLocked = disabled || saving

  async function save() {
    setSaving(true); setErr(null); setLotsMsg(null)
    try {
      const res = await fetch(`${API}/entitlement-groups/${entGroupId}/ledger-config`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ date_paper: paperVal || null, date_ent: entVal || null }),
      })
      if (!res.ok) throw new Error(await res.text())
      const data = await res.json()
      if (data.lots_entitled > 0) setLotsMsg(`${data.lots_entitled} lot${data.lots_entitled === 1 ? '' : 's'} entitled`)
      onSaved()
    } catch (e) { setErr(String(e)) }
    finally { setSaving(false) }
  }

  const inputStyle = (saved, cur) => ({
    width: 120, padding: '3px 7px', fontSize: 12, borderRadius: 4,
    border: `1px solid ${cur !== (saved ?? '') ? '#2563eb' : '#d1d5db'}`,
    background: isLocked ? '#f3f4f6' : '#fff',
  })

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 12, color: '#374151', minWidth: 140 }}>
          Plan Start Date <span style={{ color: '#dc2626' }}>*</span>
        </span>
        <input type="text" placeholder="YYYY-MM-DD" value={paperVal} disabled={isLocked}
          onChange={e => { setPaperVal(e.target.value); setErr(null); setLotsMsg(null) }}
          style={inputStyle(datePaper, paperVal)} />
        {!dirty && datePaper
          ? <span style={{ fontSize: 11, color: '#9ca3af' }}>Ledger starts {fmt(datePaper)}</span>
          : !datePaper && <span style={{ fontSize: 11, color: '#dc2626' }}>Required — ledger won't render without this</span>
        }
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 12, color: '#374151', minWidth: 140 }}>Entitlements Date</span>
        <input type="text" placeholder="YYYY-MM-DD" value={entVal} disabled={isLocked}
          onChange={e => { setEntVal(e.target.value); setErr(null); setLotsMsg(null) }}
          style={inputStyle(dateEnt, entVal)} />
        {!dirty && dateEnt && <span style={{ fontSize: 11, color: '#9ca3af' }}>Entitled {fmt(dateEnt)}</span>}
      </div>
      {dirty && (
        <button disabled={isLocked} onClick={save}
          style={{ alignSelf: 'flex-start', padding: '3px 10px', fontSize: 11, borderRadius: 4, border: 'none',
                   background: isLocked ? '#d1d5db' : '#2563eb', color: '#fff',
                   cursor: isLocked ? 'default' : 'pointer' }}>
          {saving ? 'Saving…' : 'Save'}
        </button>
      )}
      {lotsMsg && <span style={{ fontSize: 11, color: '#16a34a' }}>{lotsMsg}</span>}
      {err && <span style={{ fontSize: 11, color: '#dc2626' }}>{err}</span>}
    </div>
  )
}

function DeliveryConfigSection({ entGroupId, deliveryConfig, onSaved, disabled }) {
  const [edits, setEdits] = useState({})
  const [saving, setSaving] = useState(false)
  const [err, setErr]       = useState(null)

  const isDirty  = Object.keys(edits).length > 0
  const isLocked = disabled || saving

  function valFor(key) { return edits[key] !== undefined ? edits[key] : (deliveryConfig?.[key] ?? '') }
  function setVal(key, v) { setEdits(p => ({ ...p, [key]: v })) }

  async function save() {
    setSaving(true); setErr(null)
    const body = {}
    for (const key of FLOOR_KEYS) {
      const v = valFor(key); body[key] = v === '' ? null : parseInt(v, 10)
    }
    for (const key of ['delivery_window_start', 'delivery_window_end', 'max_deliveries_per_year']) {
      const v = valFor(key); body[key] = v === '' ? null : parseInt(v, 10)
    }
    const asVal = valFor('auto_schedule_enabled')
    body['auto_schedule_enabled'] = asVal === '' ? null : asVal === true || asVal === 'true'
    for (const key of ['default_cmp_lag_days', 'default_cls_lag_days']) {
      const v = valFor(key); body[key] = v === '' ? null : parseInt(v, 10)
    }
    try {
      const res = await fetch(`${API}/entitlement-groups/${entGroupId}/delivery-config`, {
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

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div>
        <div style={{ fontSize: 12, color: '#374151', marginBottom: 6, fontWeight: 500 }}>Delivery scheduling</div>
        <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', alignItems: 'center' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12 }}>
            <span style={{ color: '#6b7280' }}>Window start (month, 1–12)</span>
            {numInput('delivery_window_start', 48, '5')}
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12 }}>
            <span style={{ color: '#6b7280' }}>Window end (month, 1–12)</span>
            {numInput('delivery_window_end', 48, '11')}
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12 }}>
            <span style={{ color: '#6b7280' }}>Max deliveries/yr (≥1)</span>
            {numInput('max_deliveries_per_year', 48, '1')}
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, cursor: isLocked ? 'default' : 'pointer' }}>
            <input type="checkbox" disabled={isLocked}
              checked={valFor('auto_schedule_enabled') === true || valFor('auto_schedule_enabled') === 'true'}
              onChange={e => setVal('auto_schedule_enabled', e.target.checked)}
              style={{ width: 14, height: 14, accentColor: '#2563eb',
                       outline: edits['auto_schedule_enabled'] !== undefined ? '2px solid #2563eb' : 'none' }} />
            <span style={{ color: '#6b7280' }}>Auto-schedule enabled</span>
          </label>
        </div>
      </div>
      <div>
        <div style={{ fontSize: 12, color: '#374151', marginBottom: 6, fontWeight: 500 }}>
          Build lag fallbacks
          <span style={{ fontSize: 11, color: '#9ca3af', fontWeight: 400, marginLeft: 8 }}>used when no empirical curve exists</span>
        </div>
        <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', alignItems: 'center' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12 }}>
            <span style={{ color: '#6b7280' }}>STR→CMP (days, typical 180–365)</span>
            {numInput('default_cmp_lag_days', 56, '270')}
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12 }}>
            <span style={{ color: '#6b7280' }}>CMP→CLS (days, typical 14–90)</span>
            {numInput('default_cls_lag_days', 56, '45')}
          </label>
        </div>
      </div>
      <div>
        <div style={{ fontSize: 12, color: '#374151', marginBottom: 6, fontWeight: 500 }}>
          Inventory floor tolerances
          <span style={{ fontSize: 11, color: '#9ca3af', fontWeight: 400, marginLeft: 8 }}>highlighted orange in ledger when below floor</span>
        </div>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
          {FLOOR_KEYS.map(key => (
            <label key={key} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12 }}>
              <span style={{ color: '#6b7280', minWidth: 20 }}>{FLOOR_LABELS[key]}</span>
              {numInput(key, 56)}
            </label>
          ))}
        </div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        {isDirty && (
          <button disabled={isLocked} onClick={save}
            style={{ padding: '3px 10px', fontSize: 11, borderRadius: 4, border: 'none',
                     background: isLocked ? '#d1d5db' : '#2563eb', color: '#fff',
                     cursor: isLocked ? 'default' : 'pointer' }}>
            {saving ? 'Saving…' : 'Save'}
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
    <div style={{ fontSize: 12, color: '#9ca3af' }}>No starts targets to configure. Run a simulation first.</div>
  )

  return (
    <div>
      <div style={{ fontSize: 12, color: '#374151', marginBottom: 6, fontWeight: 500 }}>Starts targets</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
        {params.map(p => {
          const edit = edits[p.dev_id] || {}
          const annualVal   = edit.annual   !== undefined ? edit.annual   : (p.annual_starts_target ?? '')
          const maxMonthVal = edit.maxMonth !== undefined ? edit.maxMonth : (p.max_starts_per_month ?? '')
          const annualDirty   = edit.annual   !== undefined && edit.annual   !== String(p.annual_starts_target ?? '')
          const maxMonthDirty = edit.maxMonth !== undefined && edit.maxMonth !== String(p.max_starts_per_month ?? '')
          const dirty = annualDirty || maxMonthDirty
          const DOT = { ok: '#16a34a', stale: '#d97706', missing: '#dc2626' }

          async function save() {
            const n = parseInt(annualVal, 10)
            if (!n || n < 1) return
            const maxN = maxMonthVal === '' ? null : parseInt(maxMonthVal, 10)
            setEdits(prev => ({ ...prev, [p.dev_id]: { ...prev[p.dev_id], saving: true } }))
            try {
              const res = await fetch(`${API}/developments/${p.dev_id}/sim-params`, {
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
            <div key={p.dev_id} style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <span style={{ display: 'inline-block', width: 7, height: 7, borderRadius: '50%',
                             background: DOT[p.status] ?? '#9ca3af', flexShrink: 0 }} />
              <span style={{ fontSize: 12, color: '#374151', minWidth: 180 }}>{p.dev_name}</span>
              <input type="number" min="1" placeholder="starts/yr" value={annualVal}
                disabled={disabled || edit.saving}
                onChange={e => setEdits(prev => ({ ...prev, [p.dev_id]: { ...prev[p.dev_id], annual: e.target.value } }))}
                style={{ width: 68, padding: '2px 5px', fontSize: 12, borderRadius: 4,
                         background: (disabled || edit.saving) ? '#f3f4f6' : '#fff',
                         border: `1px solid ${annualDirty ? '#2563eb' : '#d1d5db'}` }} />
              <span style={{ fontSize: 11, color: '#9ca3af' }}>/ yr</span>
              <input type="number" min="1" placeholder="max/mo" value={maxMonthVal}
                disabled={disabled || edit.saving}
                onChange={e => setEdits(prev => ({ ...prev, [p.dev_id]: { ...prev[p.dev_id], maxMonth: e.target.value } }))}
                style={{ width: 60, padding: '2px 5px', fontSize: 12, borderRadius: 4,
                         background: (disabled || edit.saving) ? '#f3f4f6' : '#fff',
                         border: `1px solid ${maxMonthDirty ? '#2563eb' : '#d1d5db'}` }} />
              <span style={{ fontSize: 11, color: '#9ca3af' }}>max/mo</span>
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
    <div style={{ overflowX: 'auto' }}>
      <table style={{ borderCollapse: 'collapse', fontSize: 12, whiteSpace: 'nowrap', width: '100%' }}>
        <thead>
          <tr style={{ background: '#f9fafb' }}>
            <th style={stickyTh('left')}>Date</th>
            <th style={stickyTh('left')}>Source</th>
            <th style={stickyTh('left')}>Development</th>
            <th style={stickyTh('left', { whiteSpace: 'normal' })}>Phases Delivered</th>
            <th style={stickyTh()}>Units</th>
            <th style={{ ...stickyTh(), borderLeft: '2px solid #d1d5db' }}>D at Delivery</th>
            <th style={stickyTh()}>U at Delivery</th>
            <th style={stickyTh()}>UC at Delivery</th>
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
                {r.d_end != null ? r.d_end : <span style={{ color: '#e5e7eb' }}>—</span>}
              </td>
              <td style={tdS()}>{r.u_end != null ? r.u_end : <span style={{ color: '#e5e7eb' }}>—</span>}</td>
              <td style={tdS()}>{r.uc_end != null ? r.uc_end : <span style={{ color: '#e5e7eb' }}>—</span>}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div style={{ marginTop: 8, fontSize: 11, color: '#9ca3af' }}>
        D/U/UC counts are end-of-month values for the delivery month.
      </div>
    </div>
  )
}

// ─── LotLedger ───────────────────────────────────────────────────────────────

function LotLedger({ lots, loading }) {
  const [devFilter, setDevFilter] = useState('all')
  const [srcFilter, setSrcFilter] = useState('all')

  if (loading) return <div style={{ color: '#6b7280', fontSize: 12 }}>Loading…</div>
  if (!lots.length) return <div style={{ color: '#9ca3af', fontSize: 12 }}>No lots. Run a simulation first.</div>

  const devNames = [...new Set(lots.map(l => l.dev_name))].sort()
  const filtered = lots.filter(l =>
    (devFilter === 'all' || l.dev_name === devFilter) &&
    (srcFilter === 'all' || l.lot_source === srcFilter)
  )

  function dateCell(actual, projected) {
    if (actual) return <span>{fmt(actual)}</span>
    if (projected) return <span style={{ color: '#93c5fd', fontStyle: 'italic' }}>{fmt(projected)}</span>
    return <span style={{ color: '#e5e7eb' }}>—</span>
  }

  return (
    <div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 10, alignItems: 'center', flexWrap: 'wrap' }}>
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
      </div>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ borderCollapse: 'collapse', fontSize: 12, whiteSpace: 'nowrap' }}>
          <thead>
            <tr style={{ background: '#f9fafb' }}>
              {devFilter === 'all' && <th style={{ ...thS('left'), position: 'sticky', top: 0, zIndex: 2 }}>Development</th>}
              <th style={{ ...thS('left'), position: 'sticky', top: 0, zIndex: 2 }}>Lot #</th>
              <th style={{ ...thS('left'), position: 'sticky', top: 0, zIndex: 2 }}>Type</th>
              <th style={{ ...thS('left'), position: 'sticky', top: 0, zIndex: 2 }}>Phase</th>
              <th style={{ ...thS('left'), position: 'sticky', top: 0, zIndex: 2 }}>Src</th>
              <th style={{ ...thS('left'), position: 'sticky', top: 0, zIndex: 2 }}>Status</th>
              <th style={{ ...thS(), position: 'sticky', top: 0, zIndex: 2 }}>ENT</th>
              <th style={{ ...thS(), position: 'sticky', top: 0, zIndex: 2 }}>DEV</th>
              <th style={{ ...thS(), position: 'sticky', top: 0, zIndex: 2 }}>TD</th>
              <th style={{ ...thS(), position: 'sticky', top: 0, zIndex: 2 }}>STR</th>
              <th style={{ ...thS(), position: 'sticky', top: 0, zIndex: 2 }}>CMP</th>
              <th style={{ ...thS(), position: 'sticky', top: 0, zIndex: 2 }}>CLS</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map(l => (
              <tr key={l.lot_id}>
                {devFilter === 'all' && <td style={tdS('left')}>{l.dev_name}</td>}
                <td style={tdS('left')}>{l.lot_number ?? '—'}</td>
                <td style={tdS('left')}>{l.lot_type_short ?? '—'}</td>
                <td style={tdS('left')}>{l.phase_name}</td>
                <td style={tdS('left', { color: '#6b7280', fontSize: 11 })}>{l.lot_source}</td>
                <td style={tdS('left')}><StatusBadge status={l.status} pill /></td>
                <td style={tdS()}>{l.date_ent ? fmt(l.date_ent) : <span style={{ color: '#e5e7eb' }}>—</span>}</td>
                <td style={tdS()}>{l.date_dev ? fmt(l.date_dev) : <span style={{ color: '#e5e7eb' }}>—</span>}</td>
                <td style={tdS()}>{l.date_td  ? fmt(l.date_td)  : <span style={{ color: '#e5e7eb' }}>—</span>}</td>
                <td style={tdS()}>{dateCell(l.date_str, l.date_str_projected)}</td>
                <td style={tdS()}>{dateCell(l.date_cmp, l.date_cmp_projected)}</td>
                <td style={tdS()}>{dateCell(l.date_cls, l.date_cls_projected)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ─── Main view ───────────────────────────────────────────────────────────────

export default function SimulationView({ selectedGroupId, setSelectedGroupId }) {
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
  const [deliveryConfig, setDeliveryConfig] = useState(null)
  const [ledgerConfig, setLedgerConfig]     = useState(null)
  const [view, setView]             = useState('ledger')
  const [ledgerSubView, setLedgerSubView] = useState('table')   // 'table' | 'graph'
  const [lots, setLots]             = useState([])
  const [lotsLoading, setLotsLoading] = useState(false)
  const [deliverySchedule, setDeliverySchedule]               = useState([])
  const [deliveryScheduleLoading, setDeliveryScheduleLoading] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [selectedDevIds, setSelectedDevIds] = useState(null)
  const [period, setPeriod]                 = useState('monthly')
  const [loadError, setLoadError]           = useState(null)
  const [lastRunAt, setLastRunAt]           = useState(null)

  const devList = useMemo(
    () => [...new Map(byDev.map(r => [r.dev_id, r.dev_name])).entries()].map(([id, name]) => ({ id, name })),
    [byDev],
  )

  // Fetch helper that throws on non-2xx so Promise.all catch blocks see real errors.
  async function fetchOk(url) {
    const res = await fetch(url)
    if (!res.ok) throw new Error(`${res.status} from ${url}`)
    return res.json()
  }

  const loadLedger = useCallback((id) => {
    setLoading(true)
    setLoadError(null)
    Promise.all([
      fetchOk(`${API}/ledger/${id}/by-dev`),
      fetchOk(`${API}/ledger/${id}/utilization`),
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
      fetchOk(`${API}/entitlement-groups/${id}/delivery-config`),
      fetchOk(`${API}/entitlement-groups/${id}/ledger-config`),
    ])
      .then(([dc, lc]) => { setDeliveryConfig(dc); setLedgerConfig(lc) })
      .catch(() => {}) // advisory — settings panel shows empty on failure, not blocking
  }, [])

  const checkSplits = useCallback((id) => {
    Promise.all([
      fetchOk(`${API}/entitlement-groups/${id}/split-check`),
      fetchOk(`${API}/entitlement-groups/${id}/param-check`),
    ])
      .then(([splits, params]) => {
        setMissingSplits(Array.isArray(splits) ? splits : [])
        setStaleParams(Array.isArray(params) ? params : [])
        if (params?.length) setSettingsOpen(true)
      })
      .catch(() => { setMissingSplits([]); setStaleParams([]) }) // advisory — warnings only
  }, [])

  const loadLots = useCallback((id) => {
    setLotsLoading(true)
    fetchOk(`${API}/ledger/${id}/lots`)
      .then(data => setLots(Array.isArray(data) ? data : []))
      .catch((err) => { setLots([]); setLoadError(`Could not load lot ledger — ${err.message}`) })
      .finally(() => setLotsLoading(false))
  }, [])

  const loadDeliverySchedule = useCallback((id) => {
    setDeliveryScheduleLoading(true)
    fetchOk(`${API}/ledger/${id}/delivery-schedule`)
      .then(data => setDeliverySchedule(Array.isArray(data) ? data : []))
      .catch((err) => { setDeliverySchedule([]); setLoadError(`Could not load delivery schedule — ${err.message}`) })
      .finally(() => setDeliveryScheduleLoading(false))
  }, [])

  useEffect(() => {
    fetch(`${API}/entitlement-groups`).then(r => r.json())
      .then(data => { setEntGroups(data); if (data.length && !selectedGroupId) setEntGroupId(data[0].ent_group_id) })
      .catch(() => {})
  }, [])

  useEffect(() => {
    if (!entGroupId) return
    setLoadError(null)
    checkSplits(entGroupId)
    loadLedger(entGroupId)
    loadConfig(entGroupId)
    setRunErrors([])
    setSelectedDevIds(null)
  }, [entGroupId, checkSplits, loadLedger, loadConfig])

  async function handleRun() {
    if (!entGroupId) return
    setRunStatus('running')
    try {
      const res = await fetch(`${API}/simulations/run`, {
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
      if (view === 'lots')     loadLots(entGroupId)
      if (view === 'delivery') loadDeliverySchedule(entGroupId)
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
    <div style={{ padding: 24, fontFamily: 'system-ui, sans-serif', fontSize: 13, maxWidth: 1300 }}>

      {/* ── Top bar ── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16, flexWrap: 'wrap' }}>
        <select value={entGroupId ?? ''}
          onChange={e => { setEntGroupId(Number(e.target.value)); setRunStatus(null) }}
          style={{ fontSize: 13, padding: '4px 8px', borderRadius: 4, border: '1px solid #d1d5db' }}>
          {entGroups.map(g => (
            <option key={g.ent_group_id} value={g.ent_group_id}>
              {g.ent_group_name ?? `Group ${g.ent_group_id}`}
            </option>
          ))}
        </select>

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

        <button onClick={() => setSettingsOpen(o => !o)}
          style={{ marginLeft: 'auto', fontSize: 12, padding: '4px 12px', borderRadius: 4,
                   border: '1px solid #d1d5db', background: settingsOpen ? '#f1f5f9' : '#fff',
                   color: '#374151', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4 }}>
          {isRunning ? '⏳ ' : ''}Settings {settingsOpen ? '▲' : '▼'}
          {(missingSplits.length > 0 || staleParams.length > 0) && (
            <span style={{ display: 'inline-block', width: 7, height: 7, borderRadius: '50%',
                           background: '#f59e0b', marginLeft: 2 }} />
          )}
        </button>
      </div>
      {/* Spinner keyframe (injected once) */}
      <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>

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

      {/* ── Settings panel ── */}
      {settingsOpen && (
        <div style={{ position: 'relative', marginBottom: 16 }}>
          {/* Frosted lock overlay during run */}
          {isRunning && (
            <div style={{
              position: 'absolute', inset: 0, borderRadius: 8, zIndex: 10,
              background: 'rgba(248,250,252,0.82)', backdropFilter: 'blur(2px)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <span style={{ fontSize: 12, color: '#6b7280', fontWeight: 500,
                             background: '#fff', padding: '5px 14px', borderRadius: 20,
                             border: '1px solid #e2e8f0', boxShadow: '0 1px 4px rgba(0,0,0,0.07)' }}>
                Run in progress — settings locked
              </span>
            </div>
          )}
          <div style={{ padding: '14px 16px', background: '#f8fafc',
                        border: '1px solid #e2e8f0', borderRadius: 8,
                        display: 'flex', flexDirection: 'column', gap: 14 }}>
            {ledgerConfig !== null && (
              <LedgerConfigSection
                entGroupId={entGroupId}
                datePaper={ledgerConfig.date_paper}
                dateEnt={ledgerConfig.date_ent}
                onSaved={() => { loadConfig(entGroupId); loadLedger(entGroupId) }}
                disabled={isRunning}
              />
            )}
            <div style={{ borderTop: '1px solid #e2e8f0', paddingTop: 14 }}>
              <StartsTargetsSection entGroupId={entGroupId} params={staleParams} onSaved={() => checkSplits(entGroupId)} disabled={isRunning} />
            </div>
            {deliveryConfig !== null && (
              <div style={{ borderTop: '1px solid #e2e8f0', paddingTop: 14 }}>
                <DeliveryConfigSection entGroupId={entGroupId} deliveryConfig={deliveryConfig} onSaved={() => loadConfig(entGroupId)} disabled={isRunning} />
              </div>
            )}
          </div>
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
      <div style={{ display: 'flex', gap: 2, marginBottom: 12 }}>
        {[
          ['ledger',      'Monthly Ledger'],
          ['lots',        'Lot List'],
          ['delivery',    'Delivery Schedule'],
          ['utilization', 'Phase Utilization'],
        ].map(([v, label]) => (
          <button key={v} onClick={() => {
            setView(v)
            if (v === 'lots'     && entGroupId) loadLots(entGroupId)
            if (v === 'delivery' && entGroupId) loadDeliverySchedule(entGroupId)
          }}
            style={{ padding: '4px 14px', fontSize: 12, borderRadius: 4, border: '1px solid #d1d5db',
                     cursor: 'pointer', background: view === v ? '#1e40af' : '#f9fafb',
                     color: view === v ? '#fff' : '#374151', fontWeight: view === v ? 600 : 400 }}>
            {label}
          </button>
        ))}
      </div>

      {/* ── Monthly Ledger ── */}
      {view === 'ledger' && (
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
                  {[['table','Ledger'],['graph','Graph']].map(([v, label]) => (
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
              </div>

              {ledgerSubView === 'table'
                ? <LedgerTable rows={ledgerRows} floors={deliveryConfig} period={period} />
                : <LedgerGraph rows={ledgerRows} period={period} />
              }
            </>
          )}
        </>
      )}

      {/* ── Lot List ── */}
      {view === 'lots' && <LotLedger lots={lots} loading={lotsLoading} />}

      {/* ── Delivery Schedule ── */}
      {view === 'delivery' && <DeliveryScheduleTab rows={deliverySchedule} loading={deliveryScheduleLoading} />}

      {/* ── Phase Utilization ── */}
      {view === 'utilization' && (
        <>
          {loading && <div style={{ color: '#6b7280', fontSize: 12 }}>Loading…</div>}
          {!loading && <UtilizationPanel phases={filteredUtilization} />}
        </>
      )}
    </div>
  )
}
