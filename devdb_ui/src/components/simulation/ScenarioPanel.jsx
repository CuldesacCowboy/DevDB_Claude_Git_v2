import { useState, useEffect } from 'react'
import { API_BASE } from '../../config'

export function ScenarioPanel({ entGroupId, devList, onCompare }) {
  const [scenarios, setScenarios] = useState([])
  const [loading, setLoading] = useState(false)
  const [creating, setCreating] = useState(false)
  const [newName, setNewName] = useState('')
  const [newOverrides, setNewOverrides] = useState([])
  const [runningId, setRunningId] = useState(null)
  const [error, setError] = useState(null)

  const load = () => {
    if (!entGroupId) return
    setLoading(true)
    fetch(`${API_BASE}/scenarios/community/${entGroupId}`)
      .then(r => r.json())
      .then(data => setScenarios(Array.isArray(data) ? data : []))
      .catch(() => setScenarios([]))
      .finally(() => setLoading(false))
  }

  useEffect(() => { load() }, [entGroupId])

  const handleCreate = async () => {
    if (!newName.trim()) return
    setError(null)
    try {
      const res = await fetch(`${API_BASE}/scenarios`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ent_group_id: entGroupId,
          scenario_name: newName.trim(),
          overrides: newOverrides.filter(o => o.param_name && o.param_value !== ''),
        }),
      })
      if (!res.ok) { const e = await res.json(); throw new Error(e.detail || 'Failed'); }
      setCreating(false)
      setNewName('')
      setNewOverrides([])
      load()
    } catch (e) { setError(e.message) }
  }

  const handleRun = async (scenarioId) => {
    setRunningId(scenarioId)
    setError(null)
    try {
      const res = await fetch(`${API_BASE}/scenarios/${scenarioId}/run`, { method: 'POST' })
      if (!res.ok) { const e = await res.json(); throw new Error(e.detail || 'Run failed'); }
      const data = await res.json()
      setError(null)
      load()
    } catch (e) { setError(e.message) }
    finally { setRunningId(null) }
  }

  const handleDelete = async (scenarioId) => {
    try {
      await fetch(`${API_BASE}/scenarios/${scenarioId}`, { method: 'DELETE' })
      load()
    } catch {}
  }

  const addOverride = () => {
    setNewOverrides(prev => [...prev, { scope: 'dev', scope_id: '', param_name: 'annual_starts_target', param_value: '' }])
  }

  const updateOverride = (idx, field, value) => {
    setNewOverrides(prev => prev.map((o, i) => i === idx ? { ...o, [field]: value } : o))
  }

  const removeOverride = (idx) => {
    setNewOverrides(prev => prev.filter((_, i) => i !== idx))
  }

  const paramOptions = {
    dev: ['annual_starts_target', 'max_starts_per_month'],
    instrument: ['spec_rate'],
    ent_group: ['max_deliveries_per_year'],
  }

  const btnStyle = (primary) => ({
    padding: '4px 12px', fontSize: 11, borderRadius: 4, cursor: 'pointer',
    border: primary ? '1px solid #2563eb' : '1px solid #d1d5db',
    background: primary ? '#2563eb' : '#fff',
    color: primary ? '#fff' : '#374151',
    fontWeight: primary ? 600 : 400,
  })

  if (loading && !scenarios.length) return <div style={{ color: '#6b7280', fontSize: 12 }}>Loading scenarios...</div>

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {error && (
        <div style={{ background: '#fee2e2', border: '1px solid #fecaca', borderRadius: 6, padding: '6px 14px', fontSize: 12, color: '#991b1b' }}>
          {error}
        </div>
      )}

      {/* Scenario list */}
      {scenarios.length > 0 && (
        <div style={{ border: '1px solid #e5e7eb', borderRadius: 8, overflow: 'hidden' }}>
          <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: 12 }}>
            <thead>
              <tr style={{ background: '#f9fafb' }}>
                <th style={{ padding: '8px 12px', textAlign: 'left', fontWeight: 600, borderBottom: '2px solid #e5e7eb' }}>Scenario</th>
                <th style={{ padding: '8px 12px', textAlign: 'right', fontWeight: 600, borderBottom: '2px solid #e5e7eb' }}>Overrides</th>
                <th style={{ padding: '8px 12px', textAlign: 'left', fontWeight: 600, borderBottom: '2px solid #e5e7eb' }}>Last Run</th>
                <th style={{ padding: '8px 12px', textAlign: 'center', fontWeight: 600, borderBottom: '2px solid #e5e7eb' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {scenarios.map(s => (
                <tr key={s.scenario_id} style={{ borderBottom: '1px solid #f0f0f0' }}>
                  <td style={{ padding: '8px 12px', fontWeight: 500 }}>
                    {s.scenario_name}
                    {s.description && <div style={{ fontSize: 11, color: '#9ca3af' }}>{s.description}</div>}
                  </td>
                  <td style={{ padding: '8px 12px', textAlign: 'right', color: '#6b7280' }}>{s.override_count}</td>
                  <td style={{ padding: '8px 12px', color: '#6b7280' }}>
                    {s.last_run_at ? new Date(s.last_run_at).toLocaleDateString() : <span style={{ color: '#d1d5db' }}>never</span>}
                  </td>
                  <td style={{ padding: '8px 12px', textAlign: 'center' }}>
                    <div style={{ display: 'flex', gap: 4, justifyContent: 'center' }}>
                      <button onClick={() => handleRun(s.scenario_id)} disabled={runningId !== null}
                        style={{ ...btnStyle(true), opacity: runningId !== null ? 0.5 : 1 }}>
                        {runningId === s.scenario_id ? 'Running...' : 'Run'}
                      </button>
                      {s.has_results && (
                        <button onClick={() => onCompare(s.scenario_id)} style={btnStyle(false)}>
                          Compare
                        </button>
                      )}
                      <button onClick={() => handleDelete(s.scenario_id)} style={{ ...btnStyle(false), color: '#dc2626', border: '1px solid #fecaca' }}>
                        Del
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Create new scenario */}
      {!creating ? (
        <button onClick={() => setCreating(true)} style={{ ...btnStyle(true), alignSelf: 'flex-start' }}>
          + New Scenario
        </button>
      ) : (
        <div style={{ border: '1px solid #2563eb', borderRadius: 8, padding: 16, background: '#f8faff' }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: '#1e40af', marginBottom: 12 }}>New Scenario</div>

          <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
            <input value={newName} onChange={e => setNewName(e.target.value)} placeholder="Scenario name"
              style={{ flex: 1, padding: '4px 8px', fontSize: 12, borderRadius: 4, border: '1px solid #d1d5db' }} />
          </div>

          {/* Override rows */}
          <div style={{ fontSize: 11, fontWeight: 600, color: '#6b7280', marginBottom: 6 }}>Parameter Overrides</div>
          {newOverrides.map((o, i) => (
            <div key={i} style={{ display: 'flex', gap: 6, marginBottom: 6, alignItems: 'center' }}>
              <select value={o.scope} onChange={e => updateOverride(i, 'scope', e.target.value)}
                style={{ fontSize: 11, padding: '3px 6px', borderRadius: 3, border: '1px solid #d1d5db' }}>
                <option value="dev">Development</option>
                <option value="instrument">Instrument</option>
                <option value="ent_group">Community</option>
              </select>

              {o.scope === 'dev' && (
                <select value={o.scope_id} onChange={e => updateOverride(i, 'scope_id', parseInt(e.target.value))}
                  style={{ fontSize: 11, padding: '3px 6px', borderRadius: 3, border: '1px solid #d1d5db', minWidth: 120 }}>
                  <option value="">Select dev...</option>
                  {(devList || []).map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
                </select>
              )}
              {o.scope === 'ent_group' && (
                <input value={entGroupId} disabled style={{ fontSize: 11, width: 60, padding: '3px 6px', borderRadius: 3, border: '1px solid #e5e7eb', background: '#f3f4f6' }} />
              )}

              <select value={o.param_name} onChange={e => updateOverride(i, 'param_name', e.target.value)}
                style={{ fontSize: 11, padding: '3px 6px', borderRadius: 3, border: '1px solid #d1d5db' }}>
                {(paramOptions[o.scope] || []).map(p => <option key={p} value={p}>{p}</option>)}
              </select>

              <input value={o.param_value} onChange={e => updateOverride(i, 'param_value', e.target.value)}
                placeholder="value" type="number"
                style={{ width: 70, fontSize: 11, padding: '3px 6px', borderRadius: 3, border: '1px solid #d1d5db', textAlign: 'right' }} />

              <button onClick={() => removeOverride(i)} style={{ fontSize: 11, cursor: 'pointer', border: 'none', background: 'none', color: '#dc2626' }}>x</button>
            </div>
          ))}

          <button onClick={addOverride} style={{ fontSize: 11, color: '#2563eb', background: 'none', border: 'none', cursor: 'pointer', padding: 0, marginBottom: 12 }}>
            + Add Override
          </button>

          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={handleCreate} style={btnStyle(true)}>Create</button>
            <button onClick={() => { setCreating(false); setNewOverrides([]); setNewName('') }} style={btnStyle(false)}>Cancel</button>
          </div>
        </div>
      )}

      {!scenarios.length && !creating && (
        <div style={{ color: '#9ca3af', fontSize: 12 }}>
          No scenarios yet. Create one to test different assumptions against the current community structure.
        </div>
      )}
    </div>
  )
}
