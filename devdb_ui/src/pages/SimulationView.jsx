import { useState, useEffect, useCallback, useMemo } from 'react'

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

/** Collapse raw API rows (multiple builder_ids per month) into one row per month,
 *  overlay entitlement-event additions, then group into the chosen period. */
function buildLedgerRows(rawRows, entEvents, selectedDevIds, period, ledgerStartDate) {
  // 1. Filter by selected devs
  const filtered = selectedDevIds === null
    ? rawRows
    : rawRows.filter(r => selectedDevIds.includes(r.dev_id))

  // 2. Sum across builder_ids → one row per (dev_id, calendar_month) then across devs
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

  // 3. Overlay entitlement events (already baked into ent_plan by the API,
  //    but events for non-represented months may still be present)
  for (const ev of entEvents) {
    if (selectedDevIds !== null && !selectedDevIds.includes(ev.dev_id)) continue
    const key = ev.event_date.slice(0, 7) + '-01'
    if (!monthMap.has(key)) {
      monthMap.set(key, { calendar_month: key })
      for (const col of NUMERIC_COLS) monthMap.get(key)[col] = 0
    }
    // Events are already in ent_plan from the API — don't double-add
  }

  // 4. Sort months
  let sorted = [...monthMap.values()].sort((a, b) => a.calendar_month.localeCompare(b.calendar_month))

  // 5. Filter to ledger_start_date if set
  if (ledgerStartDate) {
    sorted = sorted.filter(r => r.calendar_month >= ledgerStartDate)
  }

  // 6. Running closed_cumulative
  let cumul = 0
  for (const r of sorted) { cumul += (r.cls_plan || 0); r.closed_cumulative = cumul || null }

  // 7. Group by period
  if (period === 'monthly') return sorted

  const periodMap = new Map()
  for (const r of sorted) {
    const pk = periodKey(r.calendar_month, period)
    if (!periodMap.has(pk)) periodMap.set(pk, { _key: pk, _rows: [] })
    periodMap.get(pk)._rows.push(r)
  }

  return [...periodMap.values()].map(({ _key, _rows }) => {
    const last = _rows[_rows.length - 1]
    const out = { calendar_month: _key, _periodLabel: periodLabel(_key, period) }
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
  const floorMap = {}  // status_col → min value
  for (const [fk, sk] of Object.entries(FLOOR_STATUS)) {
    if (floors?.[fk] != null) floorMap[sk] = floors[fk]
  }

  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ borderCollapse: 'collapse', fontSize: 12, whiteSpace: 'nowrap', width: '100%' }}>
        <thead>
          <tr style={{ background: '#f9fafb' }}>
            <th style={thS('left')}>
              {period === 'quarterly' ? 'Quarter' : period === 'annual' ? 'Year' : 'Month'}
            </th>
            <th style={{ ...thS('center'), borderRight: '2px solid #d1d5db' }} colSpan={6}>Events</th>
            <th style={{ ...thS('center'), borderLeft: '2px solid #d1d5db' }} colSpan={7}>End-of-period status</th>
            <th style={thS()}>Closed</th>
          </tr>
          <tr style={{ background: '#f9fafb' }}>
            <th style={thS('left')} />
            {EVENT_COLS.map((c, i) => (
              <th key={c} style={{ ...thS(), ...(i === 5 ? { borderRight: '2px solid #d1d5db' } : {}) }}>
                {PLAN_LABELS[c]}
              </th>
            ))}
            {STATUS_COLS.map((c, i) => (
              <th key={c} style={{ ...thS(), ...(i === 0 ? { borderLeft: '2px solid #d1d5db' } : {}),
                color: floorMap[c] != null ? '#1d4ed8' : '#6b7280' }}>
                {STATUS_LABELS[c]}
                {floorMap[c] != null && <span style={{ fontSize: 9, verticalAlign: 'super', marginLeft: 1 }}>≥{floorMap[c]}</span>}
              </th>
            ))}
            <th style={thS()} />
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

// ─── UtilizationPanel ────────────────────────────────────────────────────────

function UtilizationPanel({ phases }) {
  if (!phases.length) return null
  const color = pct => pct === null ? { bg: '#f3f4f6', bar: '#d1d5db', text: '#9ca3af', label: 'no splits' }
    : pct > 95  ? { bg: '#fee2e2', bar: '#fca5a5', text: '#991b1b', label: `${pct}%` }
    : pct < 70  ? { bg: '#fef9c3', bar: '#fde047', text: '#854d0e', label: `${pct}%` }
    :             { bg: '#dcfce7', bar: '#86efac', text: '#166534', label: `${pct}%` }

  return (
    <div style={{ marginTop: 12 }}>
      <div style={{ fontSize: 10, fontWeight: 600, color: '#9ca3af', textTransform: 'uppercase',
                    letterSpacing: '0.05em', marginBottom: 5 }}>Phase utilization</div>
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
    </div>
  )
}

// ─── Settings panel subcomponents ────────────────────────────────────────────

function LedgerStartSection({ entGroupId, ledgerStartDate, onSaved }) {
  const [val, setVal] = useState(ledgerStartDate ?? '')
  const [saving, setSaving] = useState(false)
  const [err, setErr]       = useState(null)
  useEffect(() => { setVal(ledgerStartDate ?? '') }, [ledgerStartDate])

  const dirty = val !== (ledgerStartDate ?? '')

  async function save() {
    setSaving(true); setErr(null)
    try {
      const res = await fetch(`${API}/entitlement-groups/${entGroupId}/ledger-config`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ledger_start_date: val || null }),
      })
      if (!res.ok) throw new Error(await res.text())
      onSaved()
    } catch (e) { setErr(String(e)) }
    finally { setSaving(false) }
  }

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
      <span style={{ fontSize: 12, color: '#374151', minWidth: 140 }}>Ledger start date</span>
      <input type="text" placeholder="YYYY-MM-DD" value={val}
        onChange={e => { setVal(e.target.value); setErr(null) }}
        style={{ width: 120, padding: '3px 7px', fontSize: 12, borderRadius: 4,
                 border: `1px solid ${dirty ? '#2563eb' : '#d1d5db'}` }} />
      {dirty && (
        <button disabled={saving} onClick={save}
          style={{ padding: '3px 10px', fontSize: 11, borderRadius: 4, border: 'none',
                   background: saving ? '#d1d5db' : '#2563eb', color: '#fff',
                   cursor: saving ? 'default' : 'pointer' }}>
          {saving ? 'Saving…' : 'Save'}
        </button>
      )}
      {!dirty && ledgerStartDate && (
        <span style={{ fontSize: 11, color: '#9ca3af' }}>Ledger starts {fmt(ledgerStartDate)}</span>
      )}
      {err && <span style={{ fontSize: 11, color: '#dc2626' }}>{err}</span>}
    </div>
  )
}

function FloorTolerancesSection({ entGroupId, deliveryConfig, onSaved }) {
  const [edits, setEdits] = useState({})
  const [saving, setSaving] = useState(false)
  const [err, setErr]       = useState(null)

  const isDirty = Object.keys(edits).length > 0

  function valFor(key) {
    return edits[key] !== undefined ? edits[key] : (deliveryConfig?.[key] ?? '')
  }

  async function save() {
    setSaving(true); setErr(null)
    const body = {}
    for (const key of FLOOR_KEYS) {
      const v = valFor(key)
      body[key] = v === '' ? null : parseInt(v, 10)
    }
    try {
      const res = await fetch(`${API}/entitlement-groups/${entGroupId}/delivery-config`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) throw new Error(await res.text())
      setEdits({})
      onSaved()
    } catch (e) { setErr(String(e)) }
    finally { setSaving(false) }
  }

  return (
    <div>
      <div style={{ fontSize: 12, color: '#374151', marginBottom: 6, fontWeight: 500 }}>
        Inventory floor tolerances
        <span style={{ fontSize: 11, color: '#9ca3af', fontWeight: 400, marginLeft: 8 }}>
          highlighted orange in ledger when below floor
        </span>
      </div>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
        {FLOOR_KEYS.map(key => (
          <label key={key} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12 }}>
            <span style={{ color: '#6b7280', minWidth: 20 }}>{FLOOR_LABELS[key]}</span>
            <input type="number" min="0" placeholder="—"
              value={valFor(key)}
              onChange={e => setEdits(p => ({ ...p, [key]: e.target.value }))}
              style={{ width: 56, padding: '2px 5px', fontSize: 12, borderRadius: 4,
                       border: `1px solid ${edits[key] !== undefined ? '#2563eb' : '#d1d5db'}`,
                       textAlign: 'right' }} />
          </label>
        ))}
        {isDirty && (
          <button disabled={saving} onClick={save}
            style={{ padding: '3px 10px', fontSize: 11, borderRadius: 4, border: 'none',
                     background: saving ? '#d1d5db' : '#2563eb', color: '#fff',
                     cursor: saving ? 'default' : 'pointer' }}>
            {saving ? 'Saving…' : 'Save'}
          </button>
        )}
        {err && <span style={{ fontSize: 11, color: '#dc2626' }}>{err}</span>}
      </div>
    </div>
  )
}

function StartsTargetsSection({ entGroupId, params, onSaved }) {
  const [edits, setEdits] = useState({})

  if (!params.length) return (
    <div style={{ fontSize: 12, color: '#9ca3af' }}>
      No starts targets to configure. Run a simulation first.
    </div>
  )

  return (
    <div>
      <div style={{ fontSize: 12, color: '#374151', marginBottom: 6, fontWeight: 500 }}>Starts targets</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
        {params.map(p => {
          const edit = edits[p.dev_id] || {}
          const val  = edit.value !== undefined ? edit.value : (p.annual_starts_target ?? '')
          const dirty = edit.value !== undefined && edit.value !== String(p.annual_starts_target ?? '')
          const DOT = { ok: '#16a34a', stale: '#d97706', missing: '#dc2626' }

          async function save() {
            const n = parseInt(val, 10)
            if (!n || n < 1) return
            setEdits(prev => ({ ...prev, [p.dev_id]: { ...prev[p.dev_id], saving: true } }))
            try {
              const res = await fetch(`${API}/developments/${p.dev_id}/sim-params`, {
                method: 'PUT', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ annual_starts_target: n }),
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
              <input type="number" min="1" placeholder="starts/yr" value={val}
                onChange={e => setEdits(prev => ({ ...prev, [p.dev_id]: { ...prev[p.dev_id], value: e.target.value } }))}
                style={{ width: 68, padding: '2px 5px', fontSize: 12, borderRadius: 4,
                         border: `1px solid ${dirty ? '#2563eb' : '#d1d5db'}` }} />
              <span style={{ fontSize: 11, color: '#9ca3af' }}>/ yr</span>
              {dirty && (
                <button disabled={edit.saving || !val} onClick={save}
                  style={{ padding: '2px 8px', fontSize: 11, borderRadius: 4, border: 'none',
                           background: edit.saving ? '#d1d5db' : '#2563eb', color: '#fff',
                           cursor: edit.saving ? 'default' : 'pointer' }}>
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

function EntitlementEventsSection({ entGroupId, events, devList, onChanged }) {
  const [adding, setAdding]   = useState(false)
  const [newRow, setNewRow]   = useState({ dev_id: '', event_date: '', lots_entitled: '', notes: '' })
  const [saving, setSaving]   = useState(false)
  const [err, setErr]         = useState(null)

  async function createEvent() {
    if (!newRow.dev_id || !newRow.event_date || !newRow.lots_entitled) {
      setErr('Development, date, and lot count are required'); return
    }
    setSaving(true); setErr(null)
    try {
      const res = await fetch(`${API}/entitlement-groups/${entGroupId}/entitlement-events`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          dev_id: parseInt(newRow.dev_id, 10),
          event_date: newRow.event_date,
          lots_entitled: parseInt(newRow.lots_entitled, 10),
          notes: newRow.notes || null,
        }),
      })
      if (!res.ok) throw new Error(await res.text())
      setNewRow({ dev_id: '', event_date: '', lots_entitled: '', notes: '' })
      setAdding(false)
      onChanged()
    } catch (e) { setErr(String(e)) }
    finally { setSaving(false) }
  }

  async function deleteEvent(id) {
    await fetch(`${API}/entitlement-groups/${entGroupId}/entitlement-events/${id}`, { method: 'DELETE' })
    onChanged()
  }

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
        <span style={{ fontSize: 12, color: '#374151', fontWeight: 500 }}>Entitlement events</span>
        <button onClick={() => setAdding(a => !a)}
          style={{ padding: '2px 8px', fontSize: 11, borderRadius: 4,
                   border: '1px solid #d1d5db', background: adding ? '#f1f5f9' : '#fff',
                   color: '#374151', cursor: 'pointer' }}>
          {adding ? 'Cancel' : '+ Add event'}
        </button>
      </div>

      {adding && (
        <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap',
                      padding: '8px 10px', background: '#f8fafc', borderRadius: 4,
                      border: '1px solid #e2e8f0', marginBottom: 8 }}>
          <select value={newRow.dev_id} onChange={e => setNewRow(r => ({ ...r, dev_id: e.target.value }))}
            style={{ fontSize: 12, padding: '3px 6px', borderRadius: 4, border: '1px solid #d1d5db', minWidth: 140 }}>
            <option value="">Development…</option>
            {devList.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
          <input type="text" placeholder="YYYY-MM-DD" value={newRow.event_date}
            onChange={e => setNewRow(r => ({ ...r, event_date: e.target.value }))}
            style={{ width: 110, padding: '3px 6px', fontSize: 12, borderRadius: 4, border: '1px solid #d1d5db' }} />
          <input type="number" min="1" placeholder="Lots" value={newRow.lots_entitled}
            onChange={e => setNewRow(r => ({ ...r, lots_entitled: e.target.value }))}
            style={{ width: 60, padding: '3px 6px', fontSize: 12, borderRadius: 4, border: '1px solid #d1d5db' }} />
          <input type="text" placeholder="Notes (optional)" value={newRow.notes}
            onChange={e => setNewRow(r => ({ ...r, notes: e.target.value }))}
            style={{ width: 160, padding: '3px 6px', fontSize: 12, borderRadius: 4, border: '1px solid #d1d5db' }} />
          <button disabled={saving} onClick={createEvent}
            style={{ padding: '3px 10px', fontSize: 11, borderRadius: 4, border: 'none',
                     background: saving ? '#d1d5db' : '#16a34a', color: '#fff',
                     cursor: saving ? 'default' : 'pointer' }}>
            {saving ? 'Saving…' : 'Add'}
          </button>
          {err && <span style={{ fontSize: 11, color: '#dc2626' }}>{err}</span>}
        </div>
      )}

      {events.length === 0 && !adding && (
        <div style={{ fontSize: 11, color: '#9ca3af' }}>No entitlement events recorded.</div>
      )}

      {events.length > 0 && (
        <table style={{ borderCollapse: 'collapse', fontSize: 12, width: '100%' }}>
          <thead>
            <tr style={{ background: '#f9fafb' }}>
              {['Date','Development','Lots','Notes',''].map(h => (
                <th key={h} style={{ padding: '3px 8px', textAlign: h === 'Lots' ? 'right' : 'left',
                                     fontSize: 11, fontWeight: 600, color: '#6b7280',
                                     borderBottom: '1px solid #e5e7eb' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {events.map(ev => (
              <tr key={ev.event_id} style={{ borderBottom: '1px solid #f3f4f6' }}>
                <td style={{ padding: '3px 8px', fontSize: 12, color: '#374151' }}>{fmt(ev.event_date)}</td>
                <td style={{ padding: '3px 8px', fontSize: 12, color: '#374151' }}>{ev.dev_name}</td>
                <td style={{ padding: '3px 8px', fontSize: 12, textAlign: 'right' }}>{ev.lots_entitled}</td>
                <td style={{ padding: '3px 8px', fontSize: 11, color: '#6b7280' }}>{ev.notes ?? ''}</td>
                <td style={{ padding: '3px 8px' }}>
                  <button onClick={() => deleteEvent(ev.event_id)}
                    style={{ fontSize: 11, color: '#dc2626', background: 'none', border: 'none',
                             cursor: 'pointer', padding: '1px 4px' }}>×</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}

// ─── LotLedger ───────────────────────────────────────────────────────────────

const STATUS_COLOR = { OUT:'#6b7280', C:'#059669', UC:'#0284c7', H:'#d97706', U:'#7c3aed', D:'#374151', E:'#b45309', P:'#9ca3af' }

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
              {devFilter === 'all' && <th style={thS('left')}>Development</th>}
              <th style={thS('left')}>Lot #</th>
              <th style={thS('left')}>Type</th>
              <th style={thS('left')}>Phase</th>
              <th style={thS('left')}>Src</th>
              <th style={thS('left')}>Status</th>
              <th style={thS()}>ENT</th>
              <th style={thS()}>DEV</th>
              <th style={thS()}>TD</th>
              <th style={thS()}>STR</th>
              <th style={thS()}>CMP</th>
              <th style={thS()}>CLS</th>
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
                <td style={tdS('left', { fontWeight: 600, color: STATUS_COLOR[l.status] ?? '#374151' })}>{l.status}</td>
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

export default function SimulationView() {
  const [entGroups, setEntGroups]   = useState([])
  const [entGroupId, setEntGroupId] = useState(null)
  const [runStatus, setRunStatus]   = useState(null)
  const [runErrors, setRunErrors]   = useState([])
  const [byDev, setByDev]           = useState([])
  const [utilization, setUtilization] = useState([])
  const [loading, setLoading]       = useState(false)
  const [missingSplits, setMissingSplits] = useState([])
  const [staleParams, setStaleParams]     = useState([])
  const [deliveryConfig, setDeliveryConfig]   = useState(null)
  const [ledgerConfig, setLedgerConfig]       = useState(null)
  const [entEvents, setEntEvents]             = useState([])
  const [view, setView]             = useState('ledger')
  const [lots, setLots]             = useState([])
  const [lotsLoading, setLotsLoading] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  // Ledger controls
  const [selectedDevIds, setSelectedDevIds] = useState(null)   // null = all
  const [period, setPeriod]                 = useState('monthly')

  // Dev list derived from loaded ledger data
  const devList = useMemo(
    () => [...new Map(byDev.map(r => [r.dev_id, r.dev_name])).entries()].map(([id, name]) => ({ id, name })),
    [byDev],
  )

  // ── Fetch helpers ──────────────────────────────────────────────────────────

  const loadLedger = useCallback((id) => {
    setLoading(true)
    Promise.all([
      fetch(`${API}/ledger/${id}/by-dev`).then(r => r.json()),
      fetch(`${API}/ledger/${id}/utilization`).then(r => r.json()),
    ])
      .then(([devRows, utilRows]) => {
        setByDev(Array.isArray(devRows) ? devRows : [])
        setUtilization(Array.isArray(utilRows) ? utilRows : [])
      })
      .catch(() => { setByDev([]); setUtilization([]) })
      .finally(() => setLoading(false))
  }, [])

  const loadConfig = useCallback((id) => {
    Promise.all([
      fetch(`${API}/entitlement-groups/${id}/delivery-config`).then(r => r.json()),
      fetch(`${API}/entitlement-groups/${id}/ledger-config`).then(r => r.json()),
      fetch(`${API}/entitlement-groups/${id}/entitlement-events`).then(r => r.json()),
    ])
      .then(([dc, lc, ev]) => {
        setDeliveryConfig(dc)
        setLedgerConfig(lc)
        setEntEvents(Array.isArray(ev) ? ev : [])
      })
      .catch(() => {})
  }, [])

  const checkSplits = useCallback((id) => {
    Promise.all([
      fetch(`${API}/entitlement-groups/${id}/split-check`).then(r => r.json()),
      fetch(`${API}/entitlement-groups/${id}/param-check`).then(r => r.json()),
    ])
      .then(([splits, params]) => {
        setMissingSplits(Array.isArray(splits) ? splits : [])
        setStaleParams(Array.isArray(params) ? params : [])
        if (params?.length) setSettingsOpen(true)
      })
      .catch(() => { setMissingSplits([]); setStaleParams([]) })
  }, [])

  const loadLots = useCallback((id) => {
    setLotsLoading(true)
    fetch(`${API}/ledger/${id}/lots`).then(r => r.json())
      .then(data => setLots(Array.isArray(data) ? data : []))
      .catch(() => setLots([]))
      .finally(() => setLotsLoading(false))
  }, [])

  useEffect(() => {
    fetch(`${API}/entitlement-groups`).then(r => r.json())
      .then(data => { setEntGroups(data); if (data.length) setEntGroupId(data[0].ent_group_id) })
      .catch(() => {})
  }, [])

  useEffect(() => {
    if (!entGroupId) return
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
      loadLedger(entGroupId)
      if (view === 'lots') loadLots(entGroupId)
      checkSplits(entGroupId)
    } catch (e) { setRunStatus({ ok: false, error: e.message }) }
  }

  // ── Build ledger rows ──────────────────────────────────────────────────────

  const ledgerRows = useMemo(() => buildLedgerRows(
    byDev, entEvents, selectedDevIds, period, ledgerConfig?.ledger_start_date ?? null,
  ), [byDev, entEvents, selectedDevIds, period, ledgerConfig])

  const filteredUtilization = useMemo(() => {
    if (selectedDevIds === null) return utilization
    return utilization.filter(p => selectedDevIds.includes(p.dev_id))
  }, [utilization, selectedDevIds])

  const hasData = byDev.length > 0

  // ── Dev filter pill toggle ─────────────────────────────────────────────────

  function toggleDev(devId) {
    if (selectedDevIds === null) {
      // "All" → select single dev
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

        <button onClick={handleRun} disabled={!entGroupId || runStatus === 'running'}
          style={{ padding: '5px 16px', borderRadius: 4, fontSize: 13, fontWeight: 600,
                   background: runStatus === 'running' ? '#93c5fd' : '#2563eb',
                   color: '#fff', border: 'none', cursor: runStatus === 'running' ? 'default' : 'pointer' }}>
          {runStatus === 'running' ? 'Running…' : 'Run Simulation'}
        </button>

        {runStatus && runStatus !== 'running' && (
          <span style={{ fontSize: 12, color: runStatus.ok ? '#16a34a' : '#dc2626' }}>
            {runStatus.ok
              ? `Done — ${runStatus.iterations} iteration(s), ${runStatus.elapsed_ms}ms`
              : `Error: ${runStatus.error}`}
          </span>
        )}

        <button onClick={() => setSettingsOpen(o => !o)}
          style={{ marginLeft: 'auto', fontSize: 12, padding: '4px 12px', borderRadius: 4,
                   border: '1px solid #d1d5db', background: settingsOpen ? '#f1f5f9' : '#fff',
                   color: '#374151', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4 }}>
          Settings {settingsOpen ? '▲' : '▼'}
          {(missingSplits.length > 0 || staleParams.length > 0) && (
            <span style={{ display: 'inline-block', width: 7, height: 7, borderRadius: '50%',
                           background: '#f59e0b', marginLeft: 2 }} />
          )}
        </button>
      </div>

      {/* ── Settings panel ── */}
      {settingsOpen && (
        <div style={{ marginBottom: 16, padding: '14px 16px', background: '#f8fafc',
                      border: '1px solid #e2e8f0', borderRadius: 8,
                      display: 'flex', flexDirection: 'column', gap: 14 }}>

          {ledgerConfig !== null && (
            <LedgerStartSection
              entGroupId={entGroupId}
              ledgerStartDate={ledgerConfig.ledger_start_date}
              onSaved={() => loadConfig(entGroupId)}
            />
          )}

          <div style={{ borderTop: '1px solid #e2e8f0', paddingTop: 14 }}>
            <StartsTargetsSection
              entGroupId={entGroupId}
              params={staleParams}
              onSaved={() => checkSplits(entGroupId)}
            />
          </div>

          {deliveryConfig !== null && (
            <div style={{ borderTop: '1px solid #e2e8f0', paddingTop: 14 }}>
              <FloorTolerancesSection
                entGroupId={entGroupId}
                deliveryConfig={deliveryConfig}
                onSaved={() => loadConfig(entGroupId)}
              />
            </div>
          )}

          <div style={{ borderTop: '1px solid #e2e8f0', paddingTop: 14 }}>
            <EntitlementEventsSection
              entGroupId={entGroupId}
              events={entEvents}
              devList={devList}
              onChanged={() => { loadConfig(entGroupId); loadLedger(entGroupId) }}
            />
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

      {/* ── View toggle ── */}
      <div style={{ display: 'flex', gap: 2, marginBottom: 12 }}>
        {[['ledger','Monthly Ledger'],['lots','Lot List']].map(([v, label]) => (
          <button key={v} onClick={() => { setView(v); if (v === 'lots' && entGroupId) loadLots(entGroupId) }}
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
                  <button
                    onClick={() => setSelectedDevIds(null)}
                    style={{ padding: '3px 10px', fontSize: 11, borderRadius: 12,
                             border: '1px solid',
                             borderColor: selectedDevIds === null ? '#1e40af' : '#d1d5db',
                             background: selectedDevIds === null ? '#dbeafe' : '#fff',
                             color: selectedDevIds === null ? '#1e40af' : '#374151',
                             cursor: 'pointer', fontWeight: selectedDevIds === null ? 600 : 400 }}>
                    All
                  </button>
                  {devList.map(({ id, name }) => {
                    const active = selectedDevIds !== null && selectedDevIds.includes(id)
                    return (
                      <button key={id} onClick={() => toggleDev(id)}
                        style={{ padding: '3px 10px', fontSize: 11, borderRadius: 12,
                                 border: '1px solid',
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
                <div style={{ display: 'flex', gap: 2, marginLeft: 8 }}>
                  {[['monthly','M'],['quarterly','Q'],['annual','Y']].map(([v, label]) => (
                    <button key={v} onClick={() => setPeriod(v)}
                      style={{ padding: '3px 10px', fontSize: 11, borderRadius: 4,
                               border: '1px solid #d1d5db', cursor: 'pointer',
                               background: period === v ? '#1e40af' : '#f9fafb',
                               color: period === v ? '#fff' : '#374151',
                               fontWeight: period === v ? 600 : 400 }}>
                      {label}
                    </button>
                  ))}
                </div>

                <span style={{ fontSize: 11, color: '#9ca3af', marginLeft: 'auto', fontStyle: 'italic' }}>
                  {ledgerRows.length} {period === 'monthly' ? 'months' : period === 'quarterly' ? 'quarters' : 'years'}
                  {selectedDevIds !== null && ` · ${selectedDevIds.length} dev${selectedDevIds.length !== 1 ? 's' : ''}`}
                </span>
              </div>

              <LedgerTable rows={ledgerRows} floors={deliveryConfig} period={period} />
              <UtilizationPanel phases={filteredUtilization} />
            </>
          )}
        </>
      )}

      {/* ── Lot List ── */}
      {view === 'lots' && (
        <LotLedger lots={lots} loading={lotsLoading} />
      )}
    </div>
  )
}
