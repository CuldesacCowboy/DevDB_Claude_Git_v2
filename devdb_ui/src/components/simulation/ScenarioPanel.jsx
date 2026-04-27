import { useState, useEffect, useMemo } from 'react'
import { API_BASE } from '../../config'

// ── Parameter definitions ────────────────────────────────────────────────────
const DEV_PARAMS = [
  { key: 'annual_starts_target', label: 'Starts / Year', type: 'number' },
  { key: 'max_starts_per_month', label: 'Max / Month', type: 'number' },
  { key: 'seasonal_weight_set', label: 'Seasonal Weights', type: 'text' },
]

const INSTRUMENT_PARAMS = [
  { key: 'spec_rate', label: 'Spec Rate', type: 'number', format: v => v != null ? `${(v * 100).toFixed(1)}%` : '—' },
]

const COMMUNITY_PARAMS = [
  { key: 'max_deliveries_per_year', label: 'Max Deliveries / Year', type: 'number' },
  { key: 'delivery_months', label: 'Delivery Months', type: 'array' },
  { key: 'min_gap_months', label: 'Min Gap (months)', type: 'number' },
  { key: 'min_d_count', label: 'Min D-Count', type: 'number' },
  { key: 'feed_starts_mode', label: 'Feed Starts Mode', type: 'boolean' },
  { key: 'default_cmp_lag_days', label: 'Default CMP Lag (days)', type: 'number' },
  { key: 'default_cls_lag_days', label: 'Default CLS Lag (days)', type: 'number' },
  { key: 'td_to_str_lag', label: 'TD→STR Lag (months)', type: 'number' },
  { key: 'hc_to_bldr_lag_days', label: 'HC→BLDR Lag (days)', type: 'number' },
  { key: 'scheduling_horizon_days', label: 'Scheduling Horizon (days)', type: 'number' },
]

function fmtVal(val, param) {
  if (val == null) return '—'
  if (param.format) return param.format(val)
  if (param.type === 'boolean') return val ? 'Yes' : 'No'
  if (param.type === 'array') return Array.isArray(val) ? val.join(', ') : String(val)
  return String(val)
}

function parseInput(raw, param) {
  if (raw === '' || raw === null) return null
  if (param.type === 'number') return parseFloat(raw)
  if (param.type === 'boolean') return raw === 'true' || raw === true
  if (param.type === 'array') return raw.split(',').map(s => parseInt(s.trim())).filter(n => !isNaN(n))
  return raw
}

// ── Main Component ───────────────────────────────────────────────────────────
export function ScenarioPanel({ entGroupId, devList, onCompare }) {
  const [params, setParams] = useState(null)
  const [scenarios, setScenarios] = useState([])
  const [loading, setLoading] = useState(true)
  const [runningId, setRunningId] = useState(null)
  const [runStatus, setRunStatus] = useState({}) // { scenarioId: { state: 'idle'|'running'|'done'|'error', elapsed_ms, error } }
  const [error, setError] = useState(null)

  // Scenario overrides: { scenarioId: { 'dev:42:annual_starts_target': { mode: 'manual'|'pct', value: 20, pct: 25 } } }
  const [overrides, setOverrides] = useState({})
  const [selectedForCompare, setSelectedForCompare] = useState(new Set())

  const loadAll = () => {
    if (!entGroupId) return
    setLoading(true)
    Promise.all([
      fetch(`${API_BASE}/scenarios/params/${entGroupId}`).then(r => r.json()),
      fetch(`${API_BASE}/scenarios/community/${entGroupId}`).then(r => r.json()),
    ])
      .then(([p, s]) => {
        setParams(p)
        setScenarios(Array.isArray(s) ? s : [])
        // Load existing overrides for each scenario
        const ovMap = {}
        for (const sc of s) {
          ovMap[sc.scenario_id] = {}
          // Load detail to get overrides
          fetch(`${API_BASE}/scenarios/${sc.scenario_id}`).then(r => r.json()).then(detail => {
            const scOv = {}
            for (const o of (detail.overrides || [])) {
              const cellKey = `${o.scope}:${o.scope_id}:${o.param_name}`
              scOv[cellKey] = { mode: 'manual', value: o.param_value }
            }
            setOverrides(prev => ({ ...prev, [sc.scenario_id]: scOv }))
          }).catch(() => {})
        }
        setOverrides(prev => ({ ...prev, ...ovMap }))
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }

  useEffect(() => { loadAll() }, [entGroupId])

  // ── Add / Delete scenario ──────────────────────────────────────────────
  const addScenario = async () => {
    const name = `Scenario ${scenarios.length + 1}`
    try {
      const res = await fetch(`${API_BASE}/scenarios`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ent_group_id: entGroupId, scenario_name: name, overrides: [] }),
      })
      if (res.ok) loadAll()
    } catch {}
  }

  const deleteScenario = async (id) => {
    try {
      await fetch(`${API_BASE}/scenarios/${id}`, { method: 'DELETE' })
      loadAll()
    } catch {}
  }

  const renameScenario = async (id, newName) => {
    try {
      await fetch(`${API_BASE}/scenarios/${id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scenario_name: newName }),
      })
      loadAll()
    } catch {}
  }

  // ── Cell edit ──────────────────────────────────────────────────────────
  const setCellValue = (scenarioId, cellKey, value, paramDef) => {
    setOverrides(prev => {
      const scOv = { ...(prev[scenarioId] || {}) }
      if (value === '' || value === null) {
        delete scOv[cellKey]
      } else {
        scOv[cellKey] = { mode: 'manual', value: parseInput(value, paramDef) }
      }
      return { ...prev, [scenarioId]: scOv }
    })
  }

  // ── Save overrides to backend ──────────────────────────────────────────
  const saveScenario = async (scenarioId) => {
    const scOv = overrides[scenarioId] || {}
    const ovList = Object.entries(scOv).map(([cellKey, cell]) => {
      const [scope, scopeIdStr, paramName] = cellKey.split(':')
      return { scope, scope_id: parseInt(scopeIdStr), param_name: paramName, param_value: cell.value }
    })
    try {
      await fetch(`${API_BASE}/scenarios/${scenarioId}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ overrides: ovList }),
      })
    } catch {}
  }

  // ── Run scenario ───────────────────────────────────────────────────────
  const runScenario = async (scenarioId, skipReload = false) => {
    setRunningId(scenarioId)
    setError(null)
    setRunStatus(prev => ({ ...prev, [scenarioId]: { state: 'running' } }))
    await saveScenario(scenarioId)
    const t0 = Date.now()
    try {
      const res = await fetch(`${API_BASE}/scenarios/${scenarioId}/run`, { method: 'POST' })
      const elapsed = Date.now() - t0
      if (!res.ok) { const e = await res.json(); throw new Error(e.detail || 'Run failed') }
      const data = await res.json()
      setRunStatus(prev => ({ ...prev, [scenarioId]: {
        state: 'done', elapsed_ms: elapsed,
        iterations: data.iterations,
      }}))
      if (!skipReload) loadAll()
    } catch (e) {
      setRunStatus(prev => ({ ...prev, [scenarioId]: { state: 'error', error: e.message } }))
      setError(e.message)
    }
    finally { setRunningId(null) }
  }

  const runAll = async () => {
    const ids = scenarios.map(sc => sc.scenario_id)
    for (const id of ids) {
      await runScenario(id, true)  // skip reload between runs
    }
    loadAll()  // reload once at the end
  }

  // ── Render ─────────────────────────────────────────────────────────────
  if (loading || !params) return <div style={{ color: '#6b7280', fontSize: 12, padding: 24 }}>Loading parameters...</div>

  const devs = params.devs || []
  const instruments = params.instruments || []
  const community = params.community || {}

  // Build row definitions
  const rows = []

  // Community section
  rows.push({ type: 'header', label: 'Community Settings' })
  for (const p of COMMUNITY_PARAMS) {
    rows.push({ type: 'param', scope: 'ent_group', scopeId: entGroupId, param: p, currentValue: community[p.key] })
  }

  // Dev sections
  for (const dev of devs) {
    rows.push({ type: 'header', label: dev.dev_name })
    for (const p of DEV_PARAMS) {
      rows.push({ type: 'param', scope: 'dev', scopeId: dev.dev_id, param: p, currentValue: dev[p.key] })
    }
  }

  // Instrument sections
  if (instruments.length) {
    rows.push({ type: 'header', label: 'Instruments' })
    for (const inst of instruments) {
      for (const p of INSTRUMENT_PARAMS) {
        rows.push({ type: 'param', scope: 'instrument', scopeId: inst.instrument_id, param: p, currentValue: inst[p.key], entityLabel: inst.instrument_name })
      }
    }
  }

  const thStyle = {
    padding: '6px 10px', fontSize: 11, fontWeight: 600, color: '#6b7280',
    background: '#f9fafb', borderBottom: '2px solid #e5e7eb', whiteSpace: 'nowrap',
    position: 'sticky', top: 0, zIndex: 2,
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {error && (
        <div style={{ background: '#fee2e2', border: '1px solid #fecaca', borderRadius: 6, padding: '6px 14px', fontSize: 12, color: '#991b1b' }}>
          {error}
        </div>
      )}

      {/* Toolbar */}
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <button onClick={addScenario} style={{
          padding: '4px 14px', fontSize: 12, borderRadius: 4, cursor: 'pointer',
          border: '1px solid #2563eb', background: '#2563eb', color: '#fff', fontWeight: 600,
        }}>+ Add Scenario</button>
        {scenarios.length > 0 && (
          <button onClick={runAll} disabled={runningId !== null} style={{
            padding: '4px 14px', fontSize: 12, borderRadius: 4, cursor: 'pointer',
            border: '1px solid #16a34a', background: '#16a34a', color: '#fff', fontWeight: 600,
            opacity: runningId !== null ? 0.5 : 1,
          }}>Run All</button>
        )}
        {selectedForCompare.size > 0 && (
          <button onClick={() => onCompare([...selectedForCompare])} style={{
            padding: '4px 14px', fontSize: 12, borderRadius: 4, cursor: 'pointer',
            border: '1px solid #7c3aed', background: '#7c3aed', color: '#fff', fontWeight: 600,
          }}>Compare {selectedForCompare.size} Selected</button>
        )}
      </div>

      {/* Parameter Spreadsheet */}
      <div style={{ overflowX: 'auto', border: '1px solid #e5e7eb', borderRadius: 8 }}>
        <table style={{ borderCollapse: 'collapse', fontSize: 12 }}>
          <thead>
            <tr>
              <th style={{ ...thStyle, textAlign: 'left', minWidth: 200 }}>Parameter</th>
              <th style={{ ...thStyle, textAlign: 'right', width: 90 }}>Current</th>
              {scenarios.map(sc => {
                const rs = runStatus[sc.scenario_id] || {}
                const isRunning = rs.state === 'running'
                const isDone = rs.state === 'done'
                const isError = rs.state === 'error'
                return (
                  <th key={sc.scenario_id} style={{ ...thStyle, textAlign: 'center', width: 120 }}>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 3, alignItems: 'center' }}>
                      <input
                        defaultValue={sc.scenario_name}
                        onBlur={e => { if (e.target.value !== sc.scenario_name) renameScenario(sc.scenario_id, e.target.value) }}
                        style={{ fontSize: 11, fontWeight: 600, border: 'none', background: 'transparent', textAlign: 'center', width: '100%', color: '#1e40af' }}
                      />
                      {/* Status indicator */}
                      {isRunning && (
                        <div style={{ fontSize: 10, color: '#2563eb', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 4 }}>
                          <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', background: '#2563eb', animation: 'pulse 1s infinite' }} />
                          Running...
                        </div>
                      )}
                      {isDone && (
                        <div style={{ fontSize: 10, color: '#16a34a', fontWeight: 500 }}>
                          Done {rs.iterations ? `(${rs.iterations} iter)` : ''} {rs.elapsed_ms ? `${(rs.elapsed_ms / 1000).toFixed(1)}s` : ''}
                        </div>
                      )}
                      {isError && (
                        <div style={{ fontSize: 10, color: '#dc2626', fontWeight: 500 }} title={rs.error}>
                          Failed
                        </div>
                      )}
                      <div style={{ display: 'flex', gap: 3 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                        <input type="checkbox"
                          checked={selectedForCompare.has(sc.scenario_id)}
                          disabled={!sc.has_results && !isDone}
                          onChange={e => {
                            setSelectedForCompare(prev => {
                              const next = new Set(prev)
                              if (e.target.checked) next.add(sc.scenario_id)
                              else next.delete(sc.scenario_id)
                              return next
                            })
                          }}
                          title={sc.has_results || isDone ? 'Select for comparison' : 'Run first to enable comparison'}
                          style={{ width: 12, height: 12 }}
                        />
                        <button onClick={() => runScenario(sc.scenario_id)} disabled={runningId !== null}
                          style={{
                            fontSize: 9, padding: '1px 6px', borderRadius: 3, cursor: 'pointer',
                            border: isRunning ? '1px solid #93c5fd' : '1px solid #2563eb',
                            background: isRunning ? '#dbeafe' : '#eff6ff',
                            color: '#1e40af', opacity: runningId !== null && !isRunning ? 0.4 : 1,
                          }}>
                          {isRunning ? 'Running...' : 'Run'}
                        </button>
                        <button onClick={() => deleteScenario(sc.scenario_id)}
                          style={{ fontSize: 9, padding: '1px 6px', borderRadius: 3, border: '1px solid #fecaca', background: '#fff', color: '#dc2626', cursor: 'pointer' }}>
                          x
                        </button>
                      </div>
                      </div>
                    </div>
                  </th>
                )
              })}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => {
              if (row.type === 'header') {
                return (
                  <tr key={i}>
                    <td colSpan={2 + scenarios.length} style={{
                      padding: '8px 10px', fontSize: 11, fontWeight: 700, color: '#374151',
                      background: '#f3f4f6', borderTop: i > 0 ? '2px solid #e5e7eb' : undefined,
                      borderBottom: '1px solid #e5e7eb',
                    }}>{row.label}</td>
                  </tr>
                )
              }

              const cellKey = `${row.scope}:${row.scopeId}:${row.param.key}`
              return (
                <tr key={i} style={{ borderBottom: '1px solid #f0f0f0' }}>
                  <td style={{ padding: '4px 10px', color: '#374151' }}>
                    {row.entityLabel && <span style={{ color: '#9ca3af', marginRight: 6 }}>{row.entityLabel}</span>}
                    {row.param.label}
                  </td>
                  <td style={{ padding: '4px 10px', textAlign: 'right', color: '#6b7280', fontWeight: 500 }}>
                    {fmtVal(row.currentValue, row.param)}
                  </td>
                  {scenarios.map(sc => {
                    const scOv = overrides[sc.scenario_id] || {}
                    const cell = scOv[cellKey]
                    const hasOverride = cell && cell.value != null
                    return (
                      <td key={sc.scenario_id} style={{
                        padding: '2px 6px', textAlign: 'center',
                        background: hasOverride ? '#eff6ff' : '#fff',
                      }}>
                        {row.param.type === 'boolean' ? (
                          <select
                            value={hasOverride ? String(cell.value) : ''}
                            onChange={e => setCellValue(sc.scenario_id, cellKey, e.target.value === '' ? null : e.target.value, row.param)}
                            onBlur={() => saveScenario(sc.scenario_id)}
                            style={{
                              fontSize: 11, padding: '1px 4px', borderRadius: 3, width: '100%',
                              border: hasOverride ? '1px solid #93c5fd' : '1px solid #e5e7eb',
                              background: hasOverride ? '#eff6ff' : '#fafafa', textAlign: 'center',
                            }}
                          >
                            <option value="">base</option>
                            <option value="true">Yes</option>
                            <option value="false">No</option>
                          </select>
                        ) : (
                          <input
                            value={hasOverride ? cell.value : ''}
                            placeholder="base"
                            onChange={e => setCellValue(sc.scenario_id, cellKey, e.target.value, row.param)}
                            onBlur={() => saveScenario(sc.scenario_id)}
                            style={{
                              width: '100%', fontSize: 11, padding: '2px 4px', borderRadius: 3,
                              border: hasOverride ? '1px solid #93c5fd' : '1px solid #e5e7eb',
                              background: hasOverride ? '#eff6ff' : '#fafafa',
                              textAlign: 'center', color: hasOverride ? '#1e40af' : '#9ca3af',
                              fontWeight: hasOverride ? 600 : 400,
                            }}
                          />
                        )}
                      </td>
                    )
                  })}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {!scenarios.length && (
        <div style={{ color: '#9ca3af', fontSize: 12, textAlign: 'center', padding: 16 }}>
          Add a scenario to test different assumptions. Each column overrides specific parameters — leave empty for base values.
        </div>
      )}
    </div>
  )
}
