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

function DevSection({ devId, devName, devRows, pgRows }) {
  const [showPg, setShowPg] = useState(false)
  const pgIds = [...new Set(pgRows.map(r => r.projection_group_id))]

  return (
    <div style={{ marginBottom: 32 }}>
      <div style={{
        display: 'flex', alignItems: 'baseline', gap: 10,
        borderBottom: '2px solid #e5e7eb', paddingBottom: 5, marginBottom: 10,
      }}>
        <span style={{ fontWeight: 700, fontSize: 14, color: '#111827' }}>{devName}</span>
        {pgIds.length > 0 && (
          <button
            onClick={() => setShowPg(v => !v)}
            style={{ fontSize: 11, color: '#6b7280', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
          >
            {showPg ? 'hide PG detail ▲' : `show PG detail (${pgIds.length}) ▼`}
          </button>
        )}
      </div>

      <LedgerTable rows={devRows} />

      {showPg && pgIds.map(pgId => (
        <div key={pgId} style={{ marginTop: 20, paddingLeft: 20, borderLeft: '3px solid #e5e7eb' }}>
          <div style={{
            fontSize: 11, fontWeight: 600, color: '#9ca3af',
            textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 6,
          }}>
            PG {pgId}
          </div>
          <LedgerTable rows={pgRows.filter(r => r.projection_group_id === pgId)} />
        </div>
      ))}
    </div>
  )
}

export default function SimulationView() {
  const [entGroups, setEntGroups]     = useState([])
  const [entGroupId, setEntGroupId]   = useState(null)
  const [runStatus, setRunStatus]     = useState(null)
  const [byDev, setByDev]             = useState([])
  const [byPg, setByPg]               = useState([])
  const [loading, setLoading]         = useState(false)
  const [missingSplits, setMissingSplits] = useState([])

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
    fetch(`${API}/entitlement-groups/${id}/split-check`)
      .then(r => r.json())
      .then(rows => setMissingSplits(Array.isArray(rows) ? rows : []))
      .catch(() => setMissingSplits([]))
  }, [])

  const loadLedger = useCallback((id) => {
    setLoading(true)
    Promise.all([
      fetch(`${API}/ledger/${id}/by-dev`).then(r => r.json()),
      fetch(`${API}/ledger/${id}`).then(r => r.json()),
    ])
      .then(([devRows, pgRows]) => {
        setByDev(Array.isArray(devRows) ? devRows : [])
        setByPg(Array.isArray(pgRows) ? pgRows : [])
      })
      .catch(() => { setByDev([]); setByPg([]) })
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    if (entGroupId) { checkSplits(entGroupId); loadLedger(entGroupId) }
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
      loadLedger(entGroupId)
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

      {/* Ledger */}
      {loading && <div style={{ color: '#6b7280', fontSize: 12 }}>Loading…</div>}

      {!loading && !hasData && (
        <div style={{ color: '#9ca3af', fontSize: 12 }}>
          No ledger data. Run a simulation to populate results.
        </div>
      )}

      {!loading && hasData && devList.map(({ id: devId, name: devName }) => (
        <DevSection
          key={devId}
          devId={devId}
          devName={devName}
          devRows={byDev.filter(r => r.dev_id === devId)}
          pgRows={byPg.filter(r => r.dev_id === devId)}
        />
      ))}
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
