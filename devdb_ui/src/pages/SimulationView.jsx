import { useState, useEffect, useCallback } from 'react'

const API = '/api'

// Column groups for the ledger table
const EVENT_COLS = [
  { key: 'ent_plan', label: 'ENT' },
  { key: 'dev_plan', label: 'DEV' },
  { key: 'td_plan',  label: 'TD' },
  { key: 'str_plan', label: 'STR' },
  { key: 'cmp_plan', label: 'CMP' },
  { key: 'cls_plan', label: 'CLS' },
]
const STATUS_COLS = [
  { key: 'p_end',  label: 'P' },
  { key: 'e_end',  label: 'E' },
  { key: 'd_end',  label: 'D' },
  { key: 'h_end',  label: 'H' },
  { key: 'u_end',  label: 'U' },
  { key: 'uc_end', label: 'UC' },
  { key: 'c_end',  label: 'C' },
]

function formatMonth(iso) {
  if (!iso) return ''
  const d = new Date(iso + 'T00:00:00')
  return d.toLocaleDateString('en-US', { month: 'short', year: '2-digit' })
}

function cell(val) {
  return val > 0 ? val : <span style={{ color: '#d1d5db' }}>—</span>
}

export default function SimulationView() {
  const [entGroups, setEntGroups] = useState([])
  const [entGroupId, setEntGroupId] = useState(null)
  const [runStatus, setRunStatus] = useState(null)   // null | 'running' | { ok, iterations, elapsed_ms, error }
  const [ledger, setLedger] = useState([])
  const [ledgerLoading, setLedgerLoading] = useState(false)
  const [missingSplits, setMissingSplits] = useState([])  // phases with no product splits

  // Load entitlement groups once
  useEffect(() => {
    fetch(`${API}/entitlement-groups`)
      .then(r => r.json())
      .then(data => {
        setEntGroups(data)
        if (data.length > 0) setEntGroupId(data[0].ent_group_id)
      })
      .catch(() => setEntGroups([]))
  }, [])

  // Check for phases missing splits whenever ent group changes
  const checkSplits = useCallback((id) => {
    if (!id) return
    fetch(`${API}/entitlement-groups/${id}/split-check`)
      .then(r => r.json())
      .then(rows => setMissingSplits(Array.isArray(rows) ? rows : []))
      .catch(() => setMissingSplits([]))
  }, [])

  useEffect(() => {
    if (entGroupId) checkSplits(entGroupId)
  }, [entGroupId, checkSplits])

  // Load ledger whenever ent group changes
  const loadLedger = useCallback((id) => {
    if (!id) return
    setLedgerLoading(true)
    fetch(`${API}/ledger/${id}`)
      .then(r => r.json())
      .then(rows => setLedger(Array.isArray(rows) ? rows : []))
      .catch(() => setLedger([]))
      .finally(() => setLedgerLoading(false))
  }, [])

  useEffect(() => {
    if (entGroupId) loadLedger(entGroupId)
  }, [entGroupId, loadLedger])

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
        const text = await res.text()
        setRunStatus({ ok: false, error: text })
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

  // Group ledger rows by projection_group_id
  const pgIds = [...new Set(ledger.map(r => r.projection_group_id))]

  return (
    <div style={{ padding: 24, fontFamily: 'system-ui, sans-serif', fontSize: 13 }}>

      {/* Controls row */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
        <select
          value={entGroupId ?? ''}
          onChange={e => setEntGroupId(Number(e.target.value))}
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
          <span style={{ color: runStatus.ok ? '#16a34a' : '#dc2626', fontSize: 12 }}>
            {runStatus.ok
              ? `Done — ${runStatus.iterations} iteration(s), ${runStatus.elapsed_ms}ms`
              : `Error: ${runStatus.error}`}
          </span>
        )}
      </div>

      {/* Missing splits warning */}
      {missingSplits.length > 0 && (
        <div style={{
          marginBottom: 16, padding: '10px 14px',
          background: '#fffbeb', border: '1px solid #fbbf24',
          borderRadius: 6, fontSize: 12,
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

      {/* Ledger table */}
      {ledgerLoading && (
        <div style={{ color: '#6b7280', fontSize: 12 }}>Loading ledger…</div>
      )}

      {!ledgerLoading && ledger.length === 0 && (
        <div style={{ color: '#9ca3af', fontSize: 12 }}>
          No ledger data. Run a simulation to populate results.
        </div>
      )}

      {!ledgerLoading && pgIds.map(pgId => {
        const rows = ledger.filter(r => r.projection_group_id === pgId)
        return (
          <div key={pgId} style={{ marginBottom: 32 }}>
            <div style={{
              fontWeight: 700, fontSize: 12, color: '#374151',
              marginBottom: 6, letterSpacing: '0.04em', textTransform: 'uppercase',
            }}>
              PG {pgId}
            </div>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ borderCollapse: 'collapse', fontSize: 12, whiteSpace: 'nowrap' }}>
                <thead>
                  <tr style={{ background: '#f9fafb' }}>
                    <th style={th()}>Month</th>
                    <th style={{ ...th(), borderRight: '2px solid #d1d5db' }} colSpan={6}>Events</th>
                    <th style={th()} colSpan={7}>End-of-month status</th>
                    <th style={th()}>CLS cumul.</th>
                  </tr>
                  <tr style={{ background: '#f9fafb' }}>
                    <th style={th()}></th>
                    {EVENT_COLS.map(c => <th key={c.key} style={th()}>{c.label}</th>)}
                    {STATUS_COLS.map((c, i) => (
                      <th key={c.key} style={{ ...th(), ...(i === 0 ? { borderLeft: '2px solid #d1d5db' } : {}) }}>
                        {c.label}
                      </th>
                    ))}
                    <th style={th()}></th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, i) => (
                    <tr key={r.calendar_month} style={{ background: i % 2 === 0 ? '#fff' : '#f9fafb' }}>
                      <td style={td(true)}>{formatMonth(r.calendar_month)}</td>
                      {EVENT_COLS.map(c => <td key={c.key} style={td()}>{cell(r[c.key])}</td>)}
                      {STATUS_COLS.map((c, j) => (
                        <td key={c.key} style={{ ...td(), ...(j === 0 ? { borderLeft: '2px solid #d1d5db' } : {}) }}>
                          {cell(r[c.key])}
                        </td>
                      ))}
                      <td style={td()}>{r.closed_cumulative > 0 ? r.closed_cumulative : ''}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )
      })}
    </div>
  )
}

function th() {
  return {
    padding: '4px 10px', textAlign: 'right', fontWeight: 600,
    borderBottom: '1px solid #e5e7eb', color: '#6b7280', fontSize: 11,
  }
}

function td(isMonth = false) {
  return {
    padding: '3px 10px', textAlign: isMonth ? 'left' : 'right',
    borderBottom: '1px solid #f3f4f6',
    fontVariantNumeric: 'tabular-nums',
    color: isMonth ? '#374151' : '#111827',
    fontWeight: isMonth ? 500 : 400,
  }
}
