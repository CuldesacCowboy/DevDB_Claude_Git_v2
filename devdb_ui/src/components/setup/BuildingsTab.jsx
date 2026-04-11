// setup/BuildingsTab.jsx
// Buildings tab content for PhaseRow: create/rename/retype/delete building groups,
// assign unassigned lots to buildings.

import { useState, useEffect } from 'react'
import { API_BASE } from '../../config'
import { formatLotNumPadded, InlineEdit } from './setupShared'

const BUILDING_TYPES = ['duplex', 'triplex', 'quadplex', 'sf', 'other']

const TYPE_COLOR = {
  duplex:   { bg: '#eff6ff', text: '#2563eb', border: '#bfdbfe' },
  triplex:  { bg: '#f0fdf4', text: '#16a34a', border: '#bbf7d0' },
  quadplex: { bg: '#faf5ff', text: '#7c3aed', border: '#e9d5ff' },
  sf:       { bg: '#fff7ed', text: '#c2410c', border: '#fed7aa' },
  other:    { bg: '#f9fafb', text: '#6b7280', border: '#e5e7eb' },
}

function TypePill({ type }) {
  const s = TYPE_COLOR[type] ?? TYPE_COLOR.other
  return (
    <span style={{
      fontSize: 10, padding: '1px 6px', borderRadius: 8, whiteSpace: 'nowrap',
      background: s.bg, color: s.text, border: `1px solid ${s.border}`,
    }}>{type ?? '—'}</span>
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

export default function BuildingsTab({ phaseId }) {
  const [data, setData]           = useState(null)   // { buildings, unassigned }
  const [loading, setLoading]     = useState(true)
  const [selected, setSelected]   = useState(new Set())  // unassigned lot_ids selected
  const [creating, setCreating]   = useState(false)
  const [newName, setNewName]     = useState('')
  const [newType, setNewType]     = useState('duplex')
  const [saving, setSaving]       = useState(false)
  const [error, setError]         = useState(null)

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
          building_type: newType,
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

  async function handleRetypeBuilding(bgId, type) {
    await fetch(`${API_BASE}/building-groups/${bgId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ building_type: type }),
    })
    setData(prev => prev ? {
      ...prev,
      buildings: prev.buildings.map(b => b.building_group_id === bgId ? { ...b, building_type: type } : b),
    } : prev)
  }

  if (loading) return <div style={{ padding: '8px 0', fontSize: 11, color: '#9ca3af' }}>Loading…</div>

  const { buildings = [], unassigned = [] } = data ?? {}

  return (
    <div style={{ paddingTop: 4 }}>

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
                  <select
                    value={b.building_type ?? ''}
                    onChange={e => handleRetypeBuilding(b.building_group_id, e.target.value || null)}
                    style={{ fontSize: 11, border: 'none', background: 'none', cursor: 'pointer', color: '#374151', padding: 0 }}
                  >
                    <option value="">—</option>
                    {BUILDING_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                  </select>
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

          {/* Create building form */}
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
              <select
                value={newType}
                onChange={e => setNewType(e.target.value)}
                style={{ fontSize: 12, padding: '2px 4px', borderRadius: 3, border: '1px solid #d1d5db' }}
              >
                {BUILDING_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
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
