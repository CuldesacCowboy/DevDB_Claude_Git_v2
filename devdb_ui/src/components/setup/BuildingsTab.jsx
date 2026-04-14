// setup/BuildingsTab.jsx
// Buildings tab content for PhaseRow: create/rename/delete building groups,
// assign unassigned lots to buildings.
//
// building_type and unit_count are DERIVED from lot count at the API level:
//   1 → villa, 2 → duplex, 3 → triplex, 4 → quad, N → N-plex
// Neither is stored on sim_building_groups (migration 056).

import { useState, useEffect } from 'react'
import { API_BASE } from '../../config'
import { formatLotNumPadded, InlineEdit } from './setupShared'

function TypePill({ unitCount }) {
  const labels = { 1: 'villa', 2: 'duplex', 3: 'triplex', 4: 'quad' }
  const label = unitCount > 0 ? (labels[unitCount] ?? `${unitCount}-plex`) : '—'
  const colors = {
    villa:   { bg: '#fff7ed', text: '#c2410c', border: '#fed7aa' },
    duplex:  { bg: '#eff6ff', text: '#2563eb', border: '#bfdbfe' },
    triplex: { bg: '#f0fdf4', text: '#16a34a', border: '#bbf7d0' },
    quad:    { bg: '#faf5ff', text: '#7c3aed', border: '#e9d5ff' },
  }
  const s = colors[label] ?? { bg: '#f9fafb', text: '#6b7280', border: '#e5e7eb' }
  return (
    <span style={{
      fontSize: 10, padding: '1px 6px', borderRadius: 8, whiteSpace: 'nowrap',
      background: s.bg, color: s.text, border: `1px solid ${s.border}`,
    }}>{label}</span>
  )
}

function LotChip({ lot, onRemove }) {
  const label = formatLotNumPadded(lot.lot_number, 4, lot.dev_code ?? '')
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 2,
      fontSize: 10, fontFamily: 'monospace',
      padding: '1px 5px', borderRadius: 8,
      background: '#f1f5f9', color: '#374151', border: '1px solid #e2e8f0',
      whiteSpace: 'nowrap',
    }}>
      {label}
      {onRemove && (
        <span
          onClick={onRemove}
          style={{ cursor: 'pointer', color: '#9ca3af', fontSize: 10, lineHeight: 1, marginLeft: 1 }}
          onMouseEnter={e => e.currentTarget.style.color = '#ef4444'}
          onMouseLeave={e => e.currentTarget.style.color = '#9ca3af'}
        >×</span>
      )}
    </span>
  )
}

// ─── Building config section (sim lot grouping) ───────────────────────────────

const UNIT_LABELS = { 1: 'villa', 2: 'duplex', 3: 'triplex', 4: 'quad' }
const unitLabel = n => UNIT_LABELS[n] ?? `${n}-plex`

function BuildingConfigSection({ phaseId }) {
  const [cfg, setCfg]       = useState(null)   // { rows, total_units }
  const [editing, setEditing] = useState(false)
  const [draft, setDraft]   = useState([])     // [{building_count, units_per_building}]
  const [saving, setSaving] = useState(false)

  async function loadCfg() {
    const res = await fetch(`${API_BASE}/phases/${phaseId}/building-config`)
    if (res.ok) setCfg(await res.json())
  }

  useEffect(() => { loadCfg() }, [phaseId]) // eslint-disable-line react-hooks/exhaustive-deps

  function startEdit() {
    setDraft(cfg?.rows?.length ? cfg.rows.map(r => ({ ...r })) : [{ building_count: 1, units_per_building: 2 }])
    setEditing(true)
  }

  async function saveCfg() {
    setSaving(true)
    try {
      const body = draft.filter(r => r.building_count > 0 && r.units_per_building > 0)
      const res = await fetch(`${API_BASE}/phases/${phaseId}/building-config`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (res.ok) { await loadCfg(); setEditing(false) }
    } finally { setSaving(false) }
  }

  function updateDraftRow(i, field, val) {
    setDraft(prev => prev.map((r, idx) => idx === i ? { ...r, [field]: Math.max(1, parseInt(val) || 1) } : r))
  }

  const draftTotal = draft.reduce((s, r) => s + (r.building_count * r.units_per_building), 0)

  const hasConfig = cfg?.rows?.length > 0

  return (
    <div style={{ marginBottom: 10, paddingBottom: 10, borderBottom: '1px solid #e5e7eb' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
        <span style={{ fontSize: 11, color: '#6b7280', fontWeight: 500 }}>Sim building config</span>
        {!editing && (
          <button onClick={startEdit}
            style={{ fontSize: 10, color: '#6b7280', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
            onMouseEnter={e => e.currentTarget.style.color = '#2563eb'}
            onMouseLeave={e => e.currentTarget.style.color = '#6b7280'}
          >{hasConfig ? 'edit' : '+ configure'}</button>
        )}
      </div>

      {!editing && hasConfig && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, alignItems: 'center' }}>
          {cfg.rows.map((r, i) => (
            <span key={i} style={{ fontSize: 11, color: '#374151' }}>
              {r.building_count}×{unitLabel(r.units_per_building)}
              {i < cfg.rows.length - 1 && <span style={{ color: '#9ca3af', margin: '0 3px' }}>+</span>}
            </span>
          ))}
          <span style={{ fontSize: 11, color: '#9ca3af', marginLeft: 4 }}>= {cfg.total_units} units</span>
        </div>
      )}

      {!editing && !hasConfig && (
        <span style={{ fontSize: 11, color: '#d1d5db' }}>SF phase — no building grouping</span>
      )}

      {editing && (
        <div>
          {draft.map((r, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
              <input type="number" min="1" value={r.building_count}
                onChange={e => updateDraftRow(i, 'building_count', e.target.value)}
                style={{ width: 44, fontSize: 12, padding: '2px 4px', borderRadius: 3, border: '1px solid #d1d5db', textAlign: 'right' }} />
              <span style={{ fontSize: 11, color: '#6b7280' }}>×</span>
              <input type="number" min="1" value={r.units_per_building}
                onChange={e => updateDraftRow(i, 'units_per_building', e.target.value)}
                style={{ width: 44, fontSize: 12, padding: '2px 4px', borderRadius: 3, border: '1px solid #d1d5db', textAlign: 'right' }} />
              <span style={{ fontSize: 11, color: '#6b7280' }}>{unitLabel(r.units_per_building)}</span>
              <button onClick={() => setDraft(prev => prev.filter((_, idx) => idx !== i))}
                style={{ fontSize: 13, color: '#d1d5db', background: 'none', border: 'none', cursor: 'pointer', lineHeight: 1 }}
                onMouseEnter={e => e.currentTarget.style.color = '#ef4444'}
                onMouseLeave={e => e.currentTarget.style.color = '#d1d5db'}
              >×</button>
            </div>
          ))}
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 4 }}>
            <button onClick={() => setDraft(prev => [...prev, { building_count: 1, units_per_building: 2 }])}
              style={{ fontSize: 11, color: '#6b7280', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>
              + row
            </button>
            <span style={{ fontSize: 11, color: '#9ca3af', marginLeft: 4 }}>= {draftTotal} units</span>
            <button onClick={saveCfg} disabled={saving}
              style={{ fontSize: 11, padding: '2px 8px', borderRadius: 3, background: '#2563eb', color: '#fff', border: 'none', cursor: 'pointer', marginLeft: 4 }}>
              {saving ? '…' : 'Save'}
            </button>
            <button onClick={() => setEditing(false)}
              style={{ fontSize: 11, padding: '2px 6px', borderRadius: 3, background: '#f1f5f9', color: '#6b7280', border: '1px solid #d1d5db', cursor: 'pointer' }}>
              Cancel
            </button>
            {draft.length > 0 && (
              <button onClick={() => { setDraft([]); }}
                style={{ fontSize: 11, color: '#9ca3af', background: 'none', border: 'none', cursor: 'pointer', marginLeft: 2 }}
                title="Clear building config (SF phase)">
                clear all
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function BuildingsTab({ phaseId }) {
  const [data, setData]         = useState(null)   // { buildings, unassigned }
  const [loading, setLoading]   = useState(true)
  const [selected, setSelected] = useState(new Set())
  const [creating, setCreating] = useState(false)
  const [newName, setNewName]   = useState('')
  const [saving, setSaving]     = useState(false)
  const [error, setError]       = useState(null)

  async function load() {
    setLoading(true)
    try {
      const res = await fetch(`${API_BASE}/building-groups/phase/${phaseId}`)
      setData(res.ok ? await res.json() : { buildings: [], unassigned: [] })
    } finally { setLoading(false) }
  }

  useEffect(() => { load() }, [phaseId]) // eslint-disable-line react-hooks/exhaustive-deps

  async function handleCreate() {
    const name = newName.trim()
    if (!name) return
    setSaving(true); setError(null)
    try {
      const res = await fetch(`${API_BASE}/building-groups/setup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          phase_id: phaseId,
          building_name: name,
          lot_ids: [...selected],
        }),
      })
      if (!res.ok) throw new Error((await res.json()).detail ?? 'Failed')
      setCreating(false); setNewName(''); setSelected(new Set())
      await load()
    } catch (e) { setError(e.message) }
    finally { setSaving(false) }
  }

  async function handleDelete(bgId) {
    await fetch(`${API_BASE}/building-groups/${bgId}`, { method: 'DELETE' })
    await load()
  }

  async function handleRemoveLot(bgId, lotId, building) {
    const remaining = building.lots.filter(l => l.lot_id !== lotId).map(l => l.lot_id)
    await fetch(`${API_BASE}/building-groups/${bgId}/lots`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ lot_ids: remaining }),
    })
    await load()
  }

  async function handleRenameBuilding(bgId, name) {
    await fetch(`${API_BASE}/building-groups/${bgId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ building_name: name }),
    })
    setData(prev => prev ? {
      ...prev,
      buildings: prev.buildings.map(b => b.building_group_id === bgId ? { ...b, building_name: name } : b),
    } : prev)
  }

  if (loading) return <div style={{ padding: '8px 0', fontSize: 11, color: '#9ca3af' }}>Loading…</div>

  const { buildings = [], unassigned = [] } = data ?? {}

  return (
    <div style={{ paddingTop: 4 }}>

      {/* Sim building config (engine grouping for future lots) */}
      <BuildingConfigSection phaseId={phaseId} />

      {/* Buildings list */}
      {buildings.length > 0 && (
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, marginBottom: 10 }}>
          <thead>
            <tr>
              {['Name', 'Type', 'Lots', ''].map((h, i) => (
                <th key={i} style={{
                  textAlign: 'left', padding: '2px 6px 4px',
                  fontWeight: 400, fontSize: 11, color: '#9ca3af',
                  borderBottom: '1px solid #e5e7eb',
                  width: i === 3 ? 24 : undefined,
                }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {buildings.map(b => (
              <tr key={b.building_group_id} style={{ borderBottom: '1px solid #f3f4f6' }}>
                <td style={{ padding: '4px 6px', whiteSpace: 'nowrap' }}>
                  <InlineEdit
                    value={b.building_name ?? '—'}
                    onSave={name => handleRenameBuilding(b.building_group_id, name)}
                  />
                </td>
                <td style={{ padding: '4px 6px' }}>
                  <TypePill unitCount={b.unit_count ?? b.lots.length} />
                </td>
                <td style={{ padding: '4px 6px' }}>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3 }}>
                    {b.lots.map(lot => (
                      <LotChip
                        key={lot.lot_id}
                        lot={lot}
                        onRemove={() => handleRemoveLot(b.building_group_id, lot.lot_id, b)}
                      />
                    ))}
                  </div>
                </td>
                <td style={{ padding: '4px 2px', textAlign: 'center' }}>
                  <button
                    onClick={() => handleDelete(b.building_group_id)}
                    title="Delete building"
                    style={{ fontSize: 14, color: '#d1d5db', background: 'none', border: 'none', cursor: 'pointer', padding: '0 3px' }}
                    onMouseEnter={e => e.currentTarget.style.color = '#ef4444'}
                    onMouseLeave={e => e.currentTarget.style.color = '#d1d5db'}
                  >×</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {/* Unassigned lots + create form */}
      {(unassigned.length > 0 || creating) && (
        <div style={{ borderTop: buildings.length > 0 ? '1px solid #e5e7eb' : 'none', paddingTop: buildings.length > 0 ? 8 : 0 }}>
          {unassigned.length > 0 && (
            <>
              <div style={{ fontSize: 11, color: '#9ca3af', marginBottom: 4 }}>
                Unassigned ({unassigned.length}) — select to group
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3, marginBottom: 6 }}>
                {unassigned.map(lot => {
                  const sel = selected.has(lot.lot_id)
                  const label = formatLotNumPadded(lot.lot_number, 4, lot.dev_code2 ?? '')
                  return (
                    <span
                      key={lot.lot_id}
                      onClick={() => {
                        const s = new Set(selected)
                        sel ? s.delete(lot.lot_id) : s.add(lot.lot_id)
                        setSelected(s)
                      }}
                      style={{
                        display: 'inline-block', fontSize: 10, fontFamily: 'monospace',
                        padding: '1px 6px', borderRadius: 8, cursor: 'pointer',
                        background: sel ? '#dbeafe' : '#f1f5f9',
                        color: sel ? '#1d4ed8' : '#374151',
                        border: `1px solid ${sel ? '#93c5fd' : '#e2e8f0'}`,
                        whiteSpace: 'nowrap', userSelect: 'none',
                      }}
                    >{label}</span>
                  )
                })}
              </div>
            </>
          )}

          {creating ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', marginTop: 4 }}>
              <input
                autoFocus
                placeholder="Building name"
                value={newName}
                onChange={e => setNewName(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') handleCreate(); if (e.key === 'Escape') setCreating(false) }}
                style={{ fontSize: 12, padding: '2px 6px', borderRadius: 3, border: '1px solid #d1d5db', width: 140 }}
              />
              {selected.size > 0 && (
                <span style={{ fontSize: 11, color: '#6b7280' }}>{selected.size} lots</span>
              )}
              {error && <span style={{ fontSize: 11, color: '#dc2626' }}>{error}</span>}
              <button
                onClick={handleCreate}
                disabled={saving || !newName.trim()}
                style={{ fontSize: 11, padding: '2px 10px', borderRadius: 3, background: '#2563eb', color: '#fff', border: 'none', cursor: 'pointer' }}
              >{saving ? '…' : 'Create'}</button>
              <button
                onClick={() => { setCreating(false); setNewName('') }}
                style={{ fontSize: 11, padding: '2px 6px', borderRadius: 3, background: '#f1f5f9', color: '#6b7280', border: '1px solid #d1d5db', cursor: 'pointer' }}
              >Cancel</button>
            </div>
          ) : (
            <button
              onClick={() => setCreating(true)}
              style={{ fontSize: 11, color: '#6b7280', background: 'none', border: 'none', cursor: 'pointer', padding: '2px 0' }}
              onMouseEnter={e => e.currentTarget.style.color = '#2563eb'}
              onMouseLeave={e => e.currentTarget.style.color = '#6b7280'}
            >+ New building{selected.size > 0 ? ` (${selected.size} lots selected)` : ''}</button>
          )}
        </div>
      )}

      {buildings.length === 0 && unassigned.length === 0 && (
        <div style={{ fontSize: 11, color: '#d1d5db' }}>No lots in this phase yet.</div>
      )}
    </div>
  )
}
