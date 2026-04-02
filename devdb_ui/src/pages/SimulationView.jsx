import { useState, useEffect, useCallback } from 'react'

const API = '/api'

const EVENT_COLS = [
  { key: 'ent_plan', label: 'ENT' },
  { key: 'dev_plan', label: 'DEV' },
  { key: 'td_plan',  label: 'TD'  },
  { key: 'str_plan', label: 'STR' },
  { key: 'cmp_plan', label: 'CMP' },
  { key: 'cls_plan', label: 'CLS' },
]
const STATUS_COLS = [
  { key: 'p_end',  label: 'P'  },
  { key: 'e_end',  label: 'E'  },
  { key: 'd_end',  label: 'D'  },
  { key: 'h_end',  label: 'H'  },
  { key: 'u_end',  label: 'U'  },
  { key: 'uc_end', label: 'UC' },
  { key: 'c_end',  label: 'C'  },
]

function fmt(iso) {
  if (!iso) return ''
  return new Date(iso + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', year: '2-digit' })
}

function cell(v) {
  return v > 0 ? v : <span style={{ color: '#e5e7eb' }}>—</span>
}

function LedgerTable({ rows }) {
  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ borderCollapse: 'collapse', fontSize: 12, whiteSpace: 'nowrap' }}>
        <thead>
          <tr style={{ background: '#f9fafb' }}>
            <th style={thS('left')}>Month</th>
            <th style={{ ...thS(), borderRight: '2px solid #d1d5db' }} colSpan={6}>Events</th>
            <th style={thS()} colSpan={7}>End-of-month status</th>
            <th style={thS()}>CLS cumul.</th>
          </tr>
          <tr style={{ background: '#f9fafb' }}>
            <th style={thS('left')} />
            {EVENT_COLS.map(c => <th key={c.key} style={thS()}>{c.label}</th>)}
            {STATUS_COLS.map((c, i) => (
              <th key={c.key} style={{ ...thS(), ...(i === 0 ? { borderLeft: '2px solid #d1d5db' } : {}) }}>
                {c.label}
              </th>
            ))}
            <th style={thS()} />
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={r.calendar_month} style={{ background: i % 2 === 0 ? '#fff' : '#f9fafb' }}>
              <td style={tdS(true)}>{fmt(r.calendar_month)}</td>
              {EVENT_COLS.map(c => <td key={c.key} style={tdS()}>{cell(r[c.key])}</td>)}
              {STATUS_COLS.map((c, j) => (
                <td key={c.key} style={{ ...tdS(), ...(j === 0 ? { borderLeft: '2px solid #d1d5db' } : {}) }}>
                  {cell(r[c.key])}
                </td>
              ))}
              <td style={tdS()}>{r.closed_cumulative > 0 ? r.closed_cumulative : ''}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function utilColor(pct) {
  if (pct === null) return { bg: '#f3f4f6', text: '#9ca3af', label: 'no splits' }
  if (pct > 95)    return { bg: '#fee2e2', text: '#991b1b', label: `${pct}%` }
  if (pct < 70)    return { bg: '#fef9c3', text: '#854d0e', label: `${pct}%` }
  return               { bg: '#dcfce7', text: '#166534', label: `${pct}%` }
}

function UtilizationPanel({ phases }) {
  if (!phases.length) return null
  return (
    <div style={{ marginTop: 14 }}>
      <div style={{
        fontSize: 11, fontWeight: 600, color: '#9ca3af',
        textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 6,
      }}>
        Phase utilization
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {phases.map(p => {
          const { bg, text, label } = utilColor(p.utilization_pct)
          const barWidth = p.utilization_pct !== null
            ? `${Math.min(p.utilization_pct, 100)}%`
            : '0%'
          return (
            <div key={p.phase_id} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{
                width: 280, fontSize: 11, color: '#374151',
                whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', flexShrink: 0,
              }} title={p.phase_name}>
                {p.phase_name}
              </div>
              <div style={{
                flex: 1, height: 14, background: '#f3f4f6', borderRadius: 3,
                overflow: 'hidden', position: 'relative', minWidth: 80,
              }}>
                <div style={{
                  width: barWidth, height: '100%',
                  background: bg === '#dcfce7' ? '#86efac' : bg === '#fef9c3' ? '#fde047' : '#fca5a5',
                  borderRadius: 3, transition: 'width 0.3s',
                }} />
              </div>
              <div style={{
                width: 64, flexShrink: 0, textAlign: 'right',
                fontSize: 11, fontWeight: 600, color: text,
              }}>
                {label}
              </div>
              <div style={{ fontSize: 11, color: '#9ca3af', whiteSpace: 'nowrap', flexShrink: 0 }}>
                {p.real_count}r + {p.sim_count}s / {p.projected_count}p
              </div>
            </div>
          )
        })}
      </div>
      <div style={{ marginTop: 6, fontSize: 10, color: '#d1d5db' }}>
        green 70–95% · yellow &lt;70% (demand risk) · red &gt;95% (supply risk)
      </div>
    </div>
  )
}

function DevSection({ devId, devName, devRows, utilRows = [] }) {
  return (
    <div style={{ marginBottom: 32 }}>
      <div style={{
        display: 'flex', alignItems: 'baseline', gap: 10,
        borderBottom: '2px solid #e5e7eb', paddingBottom: 5, marginBottom: 10,
      }}>
        <span style={{ fontWeight: 700, fontSize: 14, color: '#111827' }}>{devName}</span>
      </div>
      <LedgerTable rows={devRows} />
      <UtilizationPanel phases={utilRows} />
    </div>
  )
}

export default function SimulationView() {
  const [entGroups, setEntGroups]     = useState([])
  const [entGroupId, setEntGroupId]   = useState(null)
  const [runStatus, setRunStatus]     = useState(null)
  const [byDev, setByDev]             = useState([])
  const [utilization, setUtilization] = useState([])
  const [loading, setLoading]         = useState(false)
  const [missingSplits, setMissingSplits] = useState([])
  const [staleParams, setStaleParams]     = useState([])
  const [paramEdits, setParamEdits]       = useState({})   // { [dev_id]: { value: string, saving: bool, error: str } }
  const [view, setView]                   = useState('ledger')   // 'ledger' | 'lots'
  const [lots, setLots]                   = useState([])
  const [lotsLoading, setLotsLoading]     = useState(false)
  const [runErrors, setRunErrors]         = useState([])

  useEffect(() => {
    fetch(`${API}/entitlement-groups`)
      .then(r => r.json())
      .then(data => {
        setEntGroups(data)
        if (data.length > 0) setEntGroupId(data[0].ent_group_id)
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
      })
      .catch(() => { setMissingSplits([]); setStaleParams([]) })
  }, [])

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

  const loadLots = useCallback((id) => {
    setLotsLoading(true)
    fetch(`${API}/ledger/${id}/lots`).then(r => r.json())
      .then(data => setLots(Array.isArray(data) ? data : []))
      .catch(() => setLots([]))
      .finally(() => setLotsLoading(false))
  }, [])

  useEffect(() => {
    if (entGroupId) {
      checkSplits(entGroupId)
      loadLedger(entGroupId)
      setRunErrors([])
    }
  }, [entGroupId, checkSplits, loadLedger])

  async function handleRun() {
    if (!entGroupId) return
    setRunStatus('running')
    try {
      const res = await fetch(`${API}/simulations/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ent_group_id: entGroupId }),
      })
      if (!res.ok) {
        setRunStatus({ ok: false, error: await res.text() })
        return
      }
      const data = await res.json()
      setRunStatus({ ok: true, iterations: data.iterations, elapsed_ms: data.elapsed_ms })
      setRunErrors(data.errors || [])
      loadLedger(entGroupId)
      if (view === 'lots') loadLots(entGroupId)
      checkSplits(entGroupId)
    } catch (e) {
      setRunStatus({ ok: false, error: e.message })
    }
  }

  // Build ordered dev list from byDev (preserves sort order from API)
  const devList = [...new Map(byDev.map(r => [r.dev_id, r.dev_name])).entries()]
    .map(([id, name]) => ({ id, name }))

  const hasData = byDev.length > 0

  return (
    <div style={{ padding: 24, fontFamily: 'system-ui, sans-serif', fontSize: 13, maxWidth: 1200 }}>

      {/* Controls */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
        <select
          value={entGroupId ?? ''}
          onChange={e => { setEntGroupId(Number(e.target.value)); setRunStatus(null) }}
          style={{ fontSize: 13, padding: '4px 8px', borderRadius: 4, border: '1px solid #d1d5db' }}
        >
          {entGroups.map(g => (
            <option key={g.ent_group_id} value={g.ent_group_id}>
              {g.ent_group_name ?? `Group ${g.ent_group_id}`}
            </option>
          ))}
        </select>

        <button
          onClick={handleRun}
          disabled={!entGroupId || runStatus === 'running'}
          style={{
            padding: '5px 16px', borderRadius: 4, fontSize: 13, fontWeight: 600,
            background: runStatus === 'running' ? '#93c5fd' : '#2563eb',
            color: '#fff', border: 'none', cursor: runStatus === 'running' ? 'default' : 'pointer',
          }}
        >
          {runStatus === 'running' ? 'Running…' : 'Run Simulation'}
        </button>

        {runStatus && runStatus !== 'running' && (
          <span style={{ fontSize: 12, color: runStatus.ok ? '#16a34a' : '#dc2626' }}>
            {runStatus.ok
              ? `Done — ${runStatus.iterations} iteration(s), ${runStatus.elapsed_ms}ms`
              : `Error: ${runStatus.error}`}
          </span>
        )}

        {hasData && (
          <span style={{ marginLeft: 'auto', fontSize: 11, color: '#9ca3af', fontStyle: 'italic' }}>
            Plan scenario · units view
          </span>
        )}
      </div>

      {/* Missing splits warning */}
      {missingSplits.length > 0 && (
        <div style={{
          marginBottom: 16, padding: '10px 14px',
          background: '#fffbeb', border: '1px solid #fbbf24', borderRadius: 6, fontSize: 12,
        }}>
          <div style={{ fontWeight: 600, color: '#92400e', marginBottom: 4 }}>
            {missingSplits.length} phase{missingSplits.length !== 1 ? 's' : ''} have no product splits — temp lot generation will produce zero lots for these phases (D-100):
          </div>
          <ul style={{ margin: 0, paddingLeft: 18, color: '#78350f', lineHeight: 1.7 }}>
            {missingSplits.map(p => (
              <li key={p.phase_id}>
                <span style={{ fontWeight: 500 }}>{p.phase_name}</span>
                <span style={{ color: '#b45309' }}> — {p.instrument_name}</span>
              </li>
            ))}
          </ul>
          <div style={{ marginTop: 6, color: '#92400e', fontSize: 11 }}>
            Add product splits in the Lot · Phase tab before running.
          </div>
        </div>
      )}

      {/* Stale params warning — inline edit */}
      {staleParams.length > 0 && (
        <div style={{
          marginBottom: 16, padding: '10px 14px',
          background: '#fff7ed', border: '1px solid #fb923c', borderRadius: 6, fontSize: 12,
        }}>
          <div style={{ fontWeight: 600, color: '#9a3412', marginBottom: 6 }}>
            {staleParams.length} development{staleParams.length !== 1 ? 's' : ''} have missing or outdated starts targets:
          </div>
          {staleParams.map(p => {
            const edit = paramEdits[p.dev_id] || {}
            const val  = edit.value !== undefined ? edit.value : (p.annual_starts_target ?? '')
            return (
              <div key={p.dev_id} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4, flexWrap: 'wrap' }}>
                <span style={{ fontWeight: 500, color: '#7c2d12', minWidth: 180 }}>{p.dev_name}</span>
                {p.status === 'stale' && (
                  <span style={{ color: '#b45309', fontSize: 11 }}>
                    (last updated {p.updated_at ? p.updated_at.slice(0, 10) : 'unknown'})
                  </span>
                )}
                <input
                  type="number" min="1" placeholder="starts/yr"
                  value={val}
                  onChange={e => setParamEdits(prev => ({ ...prev, [p.dev_id]: { ...prev[p.dev_id], value: e.target.value } }))}
                  style={{ width: 80, padding: '2px 6px', border: '1px solid #fb923c', borderRadius: 4, fontSize: 12 }}
                />
                <button
                  disabled={edit.saving || !val}
                  onClick={async () => {
                    const n = parseInt(val, 10)
                    if (!n || n < 1) return
                    setParamEdits(prev => ({ ...prev, [p.dev_id]: { ...prev[p.dev_id], saving: true, error: null } }))
                    try {
                      const res = await fetch(`${API}/developments/${p.dev_id}/sim-params`, {
                        method: 'PUT',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ annual_starts_target: n }),
                      })
                      if (!res.ok) throw new Error(await res.text())
                      setParamEdits(prev => { const next = { ...prev }; delete next[p.dev_id]; return next })
                      checkSplits(entGroupId)
                    } catch (err) {
                      setParamEdits(prev => ({ ...prev, [p.dev_id]: { ...prev[p.dev_id], saving: false, error: String(err) } }))
                    }
                  }}
                  style={{
                    padding: '2px 10px', fontSize: 12, borderRadius: 4, border: 'none',
                    background: edit.saving ? '#d1d5db' : '#ea580c', color: '#fff', cursor: edit.saving ? 'default' : 'pointer',
                  }}
                >
                  {edit.saving ? 'Saving…' : 'Save'}
                </button>
                {edit.error && <span style={{ color: '#dc2626', fontSize: 11 }}>{edit.error}</span>}
              </div>
            )
          })}
        </div>
      )}

      {/* Run errors (missing params) */}
      {runErrors.length > 0 && (
        <div style={{ marginBottom: 14, padding: '8px 14px', background: '#fef3c7', border: '1px solid #f59e0b', borderRadius: 6, fontSize: 12 }}>
          <div style={{ fontWeight: 600, color: '#92400e', marginBottom: 4 }}>Simulation ran with warnings:</div>
          <ul style={{ margin: 0, paddingLeft: 18, color: '#78350f', lineHeight: 1.7 }}>
            {runErrors.map((e, i) => <li key={i}>{e}</li>)}
          </ul>
        </div>
      )}

      {/* View toggle */}
      <div style={{ display: 'flex', gap: 2, marginBottom: 14 }}>
        {[['ledger', 'Monthly Ledger'], ['lots', 'Lot List']].map(([v, label]) => (
          <button key={v} onClick={() => { setView(v); if (v === 'lots' && entGroupId) loadLots(entGroupId) }}
            style={{
              padding: '4px 14px', fontSize: 12, borderRadius: 4, border: '1px solid #d1d5db', cursor: 'pointer',
              background: view === v ? '#1e40af' : '#f9fafb', color: view === v ? '#fff' : '#374151', fontWeight: view === v ? 600 : 400,
            }}>
            {label}
          </button>
        ))}
      </div>

      {/* Monthly Ledger */}
      {view === 'ledger' && (
        <>
          {loading && <div style={{ color: '#6b7280', fontSize: 12 }}>Loading…</div>}
          {!loading && !hasData && (
            <div style={{ color: '#9ca3af', fontSize: 12 }}>No ledger data. Run a simulation to populate results.</div>
          )}
          {!loading && hasData && devList.map(({ id: devId, name: devName }) => (
            <DevSection key={devId} devId={devId} devName={devName}
              devRows={byDev.filter(r => r.dev_id === devId)}
              utilRows={utilization.filter(r => r.dev_id === devId)}
            />
          ))}
        </>
      )}

      {/* Lot List */}
      {view === 'lots' && (
        <LotLedger lots={lots} loading={lotsLoading} />
      )}
    </div>
  )
}

function thS(align = 'right') {
  return {
    padding: '4px 10px', textAlign: align, fontWeight: 600,
    borderBottom: '1px solid #e5e7eb', color: '#6b7280', fontSize: 11,
  }
}
function tdS(isMonth = false) {
  return {
    padding: '3px 10px', textAlign: isMonth ? 'left' : 'right',
    borderBottom: '1px solid #f3f4f6', fontVariantNumeric: 'tabular-nums',
    color: isMonth ? '#374151' : '#111827', fontWeight: isMonth ? 500 : 400,
  }
}

const STATUS_COLOR = {
  OUT: '#6b7280', C: '#059669', UC: '#0284c7', H: '#d97706',
  U: '#7c3aed', D: '#374151', E: '#b45309', P: '#9ca3af',
}

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

  const LOT_COLS = [
    { key: 'lot_number',   label: 'Lot #',   left: true },
    { key: 'lot_type_short', label: 'Type',  left: true },
    { key: 'phase_name',   label: 'Phase',   left: true },
    { key: 'lot_source',   label: 'Src',     left: true },
    { key: 'status',       label: 'Status',  left: true },
    { key: 'date_ent',     label: 'ENT' },
    { key: 'date_dev',     label: 'DEV' },
    { key: 'date_td',      label: 'TD' },
    { key: 'date_str',     label: 'STR' },
    { key: 'date_cmp',     label: 'CMP' },
    { key: 'date_cls',     label: 'CLS' },
  ]

  return (
    <div>
      {/* Filters */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 10, alignItems: 'center', flexWrap: 'wrap' }}>
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
      </div>

      <div style={{ overflowX: 'auto' }}>
        <table style={{ borderCollapse: 'collapse', fontSize: 12, whiteSpace: 'nowrap' }}>
          <thead>
            <tr style={{ background: '#f9fafb' }}>
              {devFilter === 'all' && <th style={thS('left')}>Development</th>}
              {LOT_COLS.map(c => <th key={c.key} style={thS(c.left ? 'left' : 'right')}>{c.label}</th>)}
            </tr>
          </thead>
          <tbody>
            {filtered.map(l => (
              <tr key={l.lot_id}>
                {devFilter === 'all' && <td style={tdS(true)}>{l.dev_name}</td>}
                <td style={tdS(true)}>{l.lot_number ?? '—'}</td>
                <td style={tdS(true)}>{l.lot_type_short ?? '—'}</td>
                <td style={tdS(true)}>{l.phase_name}</td>
                <td style={{ ...tdS(true), color: '#6b7280', fontSize: 11 }}>{l.lot_source}</td>
                <td style={{ ...tdS(true), fontWeight: 600, color: STATUS_COLOR[l.status] ?? '#374151' }}>{l.status}</td>
                {['date_ent','date_dev','date_td','date_str','date_cmp','date_cls'].map(k => (
                  <td key={k} style={tdS()}>{l[k] ? fmt(l[k]) : <span style={{ color: '#e5e7eb' }}>—</span>}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
