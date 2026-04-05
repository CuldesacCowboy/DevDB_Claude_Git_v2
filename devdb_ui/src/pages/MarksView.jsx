// MarksView.jsx
// MARKS lot management: sync dates, import unimported lots, promote pre→real.

import { useState, useEffect, useCallback, useRef } from 'react'
import { API_BASE } from '../config'

// ─── helpers ─────────────────────────────────────────────────────────────────

function pipelineStatus({ date_cls, date_cmp, date_str, date_td, date_td_hold, date_dev }) {
  if (date_cls)      return { label: 'CLS', color: '#6b7280' }
  if (date_cmp)      return { label: 'C',   color: '#7c3aed' }
  if (date_str)      return { label: 'UC',  color: '#2563eb' }
  if (date_td_hold)  return { label: 'H',   color: '#d97706' }
  if (date_td)       return { label: 'U',   color: '#059669' }
  if (date_dev)      return { label: 'D',   color: '#0891b2' }
  return               { label: 'P',   color: '#9ca3af' }
}

function StatusPill({ lot }) {
  const { label, color } = pipelineStatus(lot)
  return (
    <span style={{
      fontSize: 10, fontWeight: 600, padding: '1px 6px', borderRadius: 10,
      background: color + '18', color, border: `1px solid ${color}40`,
    }}>{label}</span>
  )
}

function Btn({ onClick, disabled, children, variant = 'default', small }) {
  const styles = {
    default: { background: '#f1f5f9', color: '#374151', border: '1px solid #d1d5db' },
    primary: { background: '#2563eb', color: '#fff',    border: '1px solid #1d4ed8' },
    green:   { background: '#059669', color: '#fff',    border: '1px solid #047857' },
    purple:  { background: '#7c3aed', color: '#fff',    border: '1px solid #6d28d9' },
    danger:  { background: '#dc2626', color: '#fff',    border: '1px solid #b91c1c' },
  }
  const s = styles[variant] || styles.default
  return (
    <button onClick={onClick} disabled={disabled} style={{
      ...s, fontSize: small ? 11 : 12, padding: small ? '2px 8px' : '4px 12px',
      borderRadius: 4, cursor: disabled ? 'not-allowed' : 'pointer',
      opacity: disabled ? 0.5 : 1,
    }}>{children}</button>
  )
}

// ─── lot type selector (fetched once) ────────────────────────────────────────

function useLotTypes() {
  const [lotTypes, setLotTypes] = useState([])
  useEffect(() => {
    fetch(`${API_BASE}/phases/lot-types`).then(r => r.json()).then(setLotTypes).catch(() => {})
  }, [])
  return lotTypes
}

// ─── Promotable section ───────────────────────────────────────────────────────

function PromotableSection({ onRefresh }) {
  const [items, setItems] = useState(null)
  const [selected, setSelected] = useState(new Set())
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)
  const [open, setOpen] = useState(false)

  async function load() {
    const data = await fetch(`${API_BASE}/marks/promotable`).then(r => r.json())
    setItems(data)
    setSelected(new Set(data.map(d => d.lot_id)))
  }

  useEffect(() => { load() }, [])

  async function handlePromote() {
    setSaving(true)
    setError(null)
    try {
      const res = await fetch(`${API_BASE}/marks/promote`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lot_ids: [...selected] }),
      })
      if (!res.ok) throw new Error((await res.json()).detail ?? 'Promote failed')
      const data = await res.json()
      await load()
      onRefresh()
    } catch (e) {
      setError(e.message)
    } finally {
      setSaving(false)
    }
  }

  if (!items || items.length === 0) return null

  return (
    <div style={{
      border: '1px solid #fbbf24', borderRadius: 6, marginBottom: 16,
      background: '#fffbeb', overflow: 'hidden',
    }}>
      <div
        style={{
          padding: '8px 12px', display: 'flex', alignItems: 'center', gap: 10,
          borderBottom: open ? '1px solid #fde68a' : 'none', cursor: 'pointer',
        }}
        onClick={() => setOpen(o => !o)}
      >
        <span style={{ fontSize: 13, fontWeight: 600, color: '#92400e', flex: 1 }}>
          ⚡ {items.length} pre-MARKS lot{items.length !== 1 ? 's' : ''} now have MARKS records — ready to promote
        </span>
        <span style={{ fontSize: 11, color: '#b45309' }}>{open ? '▲' : '▼'}</span>
      </div>

      {open && (
        <div style={{ padding: '8px 12px' }}>
          <p style={{ fontSize: 12, color: '#78350f', margin: '0 0 8px' }}>
            These lots were manually created and now exist in MARKsystems. Promoting them updates
            their <code>lot_source</code> to <code>real</code> and applies MARKS pipeline dates.
          </p>

          <div style={{ maxHeight: 240, overflowY: 'auto', marginBottom: 8 }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead>
                <tr style={{ background: '#fef3c7' }}>
                  <th style={{ padding: '3px 8px', textAlign: 'left', width: 24 }}>
                    <input type="checkbox"
                      checked={selected.size === items.length}
                      onChange={e => setSelected(e.target.checked ? new Set(items.map(i => i.lot_id)) : new Set())}
                    />
                  </th>
                  {['Lot', 'Status', 'STR', 'CMP', 'CLS'].map(h => (
                    <th key={h} style={{ padding: '3px 8px', textAlign: 'left', color: '#78350f' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {items.map(lot => (
                  <tr key={lot.lot_id} style={{ borderTop: '1px solid #fde68a' }}>
                    <td style={{ padding: '3px 8px' }}>
                      <input type="checkbox"
                        checked={selected.has(lot.lot_id)}
                        onChange={e => {
                          const s = new Set(selected)
                          e.target.checked ? s.add(lot.lot_id) : s.delete(lot.lot_id)
                          setSelected(s)
                        }}
                      />
                    </td>
                    <td style={{ padding: '3px 8px', fontFamily: 'monospace' }}>{lot.lot_number}</td>
                    <td style={{ padding: '3px 8px' }}><StatusPill lot={lot} /></td>
                    <td style={{ padding: '3px 8px', color: '#6b7280' }}>{lot.date_str ?? '—'}</td>
                    <td style={{ padding: '3px 8px', color: '#6b7280' }}>{lot.date_cmp ?? '—'}</td>
                    <td style={{ padding: '3px 8px', color: '#6b7280' }}>{lot.date_cls ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {error && <p style={{ color: '#dc2626', fontSize: 12, margin: '4px 0' }}>{error}</p>}
          <div style={{ display: 'flex', gap: 8 }}>
            <Btn variant="purple" onClick={handlePromote} disabled={saving || selected.size === 0}>
              {saving ? 'Promoting…' : `Promote ${selected.size} lot${selected.size !== 1 ? 's' : ''}`}
            </Btn>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Import panel (per dev code) ─────────────────────────────────────────────

function ImportPanel({ devCode, onDone }) {
  const [lots, setLots] = useState(null)
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState(new Set())
  const [lotTypeId, setLotTypeId] = useState('')
  const [phaseId, setPhaseId] = useState('')
  const [devPhases, setDevPhases] = useState({ instruments: [], phases: [] })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)
  const lotTypes = useLotTypes()
  const anchorIdx = useRef(null)

  useEffect(() => {
    Promise.all([
      fetch(`${API_BASE}/marks/unimported?dev_code=${encodeURIComponent(devCode)}`).then(r => r.json()),
      fetch(`${API_BASE}/marks/dev-phases?dev_code=${encodeURIComponent(devCode)}`).then(r => r.json()),
    ]).then(([lotsData, phasesData]) => {
      setLots(lotsData)
      setSelected(new Set(lotsData.map(d => d.housenumber)))
      setDevPhases(phasesData)
    }).finally(() => setLoading(false))
  }, [devCode])

  async function handleImport() {
    if (!lotTypeId) return
    setSaving(true)
    setError(null)
    try {
      const selectedLots = (lots || []).filter(l => selected.has(l.housenumber))
      const body = {
        lots: selectedLots.map(l => ({ dev_code: devCode, housenumber: l.housenumber })),
        lot_type_id: parseInt(lotTypeId, 10),
      }
      if (phaseId) body.phase_id = parseInt(phaseId, 10)
      const res = await fetch(`${API_BASE}/marks/import`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) throw new Error((await res.json()).detail ?? 'Import failed')
      const data = await res.json()
      onDone(data.inserted)
    } catch (e) {
      setError(e.message)
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <div style={{ padding: '8px 12px', fontSize: 12, color: '#9ca3af' }}>Loading…</div>
  if (!lots?.length) return <div style={{ padding: '8px 12px', fontSize: 12, color: '#9ca3af' }}>No unimported lots.</div>

  const assignmentLabel = phaseId
    ? `→ ${devPhases.phases.find(p => String(p.phase_id) === phaseId)?.phase_name ?? 'phase'}`
    : '→ unassigned'

  return (
    <div style={{ padding: '8px 12px' }}>
      {/* controls row */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8, flexWrap: 'wrap' }}>
        {/* lot type */}
        <label style={{ fontSize: 12, color: '#374151' }}>Lot type:</label>
        <select
          value={lotTypeId}
          onChange={e => setLotTypeId(e.target.value)}
          style={{ fontSize: 12, padding: '2px 6px', borderRadius: 3, border: '1px solid #d1d5db' }}
        >
          <option value="">— select —</option>
          {lotTypes.map(lt => (
            <option key={lt.lot_type_id} value={lt.lot_type_id}>{lt.lot_type_short}</option>
          ))}
        </select>

        {/* phase */}
        <label style={{ fontSize: 12, color: '#374151', marginLeft: 8 }}>Phase:</label>
        <select
          value={phaseId}
          onChange={e => setPhaseId(e.target.value)}
          style={{ fontSize: 12, padding: '2px 6px', borderRadius: 3, border: '1px solid #d1d5db' }}
        >
          <option value="">— unassigned —</option>
          {devPhases.phases.map(p => (
            <option key={p.phase_id} value={p.phase_id}>{p.phase_name}</option>
          ))}
        </select>
      </div>

      {/* select all + assignment summary */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
        <label style={{ fontSize: 12, color: '#6b7280' }}>
          <input
            type="checkbox"
            checked={selected.size === lots.length}
            onChange={e => setSelected(e.target.checked ? new Set(lots.map(l => l.housenumber)) : new Set())}
            style={{ marginRight: 4 }}
          />
          Select all ({lots.length})
        </label>
        <span style={{ fontSize: 11, color: phaseId ? '#059669' : '#9ca3af', marginLeft: 'auto' }}>
          {assignmentLabel}
        </span>
      </div>

      {/* lot table */}
      <div style={{ maxHeight: 260, overflowY: 'auto', marginBottom: 8, border: '1px solid #e5e7eb', borderRadius: 4 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
          <thead style={{ position: 'sticky', top: 0, background: '#f9fafb' }}>
            <tr>
              <th style={{ padding: '4px 8px', width: 24, borderBottom: '1px solid #e5e7eb' }}></th>
              {['Lot #', 'Status', 'Takedown', 'Start', 'Complete', 'Close'].map(h => (
                <th key={h} style={{ padding: '4px 8px', textAlign: 'left', color: '#6b7280', fontWeight: 500, borderBottom: '1px solid #e5e7eb' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {lots.map((lot, idx) => (
              <tr key={lot.housenumber}
                style={{
                  borderTop: '1px solid #f1f5f9',
                  background: selected.has(lot.housenumber) ? '#f0f9ff' : undefined,
                  cursor: 'pointer',
                  userSelect: 'none',
                }}
                onClick={e => {
                  if (e.shiftKey && anchorIdx.current !== null) {
                    // Range select: fill from anchor to current
                    const lo = Math.min(anchorIdx.current, idx)
                    const hi = Math.max(anchorIdx.current, idx)
                    const s = new Set(selected)
                    for (let i = lo; i <= hi; i++) s.add(lots[i].housenumber)
                    setSelected(s)
                  } else if (e.ctrlKey || e.metaKey) {
                    // Ctrl/Cmd: toggle individual without affecting others
                    const s = new Set(selected)
                    selected.has(lot.housenumber) ? s.delete(lot.housenumber) : s.add(lot.housenumber)
                    setSelected(s)
                    anchorIdx.current = idx
                  } else {
                    // Plain click: toggle and set anchor
                    const s = new Set(selected)
                    selected.has(lot.housenumber) ? s.delete(lot.housenumber) : s.add(lot.housenumber)
                    setSelected(s)
                    anchorIdx.current = idx
                  }
                }}
              >
                <td style={{ padding: '3px 8px' }}>
                  <input type="checkbox" readOnly checked={selected.has(lot.housenumber)} />
                </td>
                <td style={{ padding: '3px 8px', fontFamily: 'monospace', fontWeight: 500 }}>{lot.lot_number}</td>
                <td style={{ padding: '3px 8px' }}><StatusPill lot={lot} /></td>
                <td style={{ padding: '3px 8px', color: '#6b7280' }}>{lot.date_td ?? '—'}</td>
                <td style={{ padding: '3px 8px', color: '#6b7280' }}>{lot.date_str ?? '—'}</td>
                <td style={{ padding: '3px 8px', color: '#6b7280' }}>{lot.date_cmp ?? '—'}</td>
                <td style={{ padding: '3px 8px', color: '#6b7280' }}>{lot.date_cls ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {error && <p style={{ color: '#dc2626', fontSize: 12, margin: '4px 0' }}>{error}</p>}
      <div style={{ display: 'flex', gap: 8 }}>
        <Btn
          variant="green"
          onClick={handleImport}
          disabled={saving || selected.size === 0 || !lotTypeId}
        >
          {saving ? 'Importing…' : `Import ${selected.size} lot${selected.size !== 1 ? 's' : ''}`}
        </Btn>
        {!lotTypeId && selected.size > 0 && (
          <span style={{ fontSize: 11, color: '#d97706', alignSelf: 'center' }}>Select a lot type first</span>
        )}
      </div>
    </div>
  )
}

// ─── Dev code row ─────────────────────────────────────────────────────────────

function DevCodeRow({ row, onSyncDev, onRefresh }) {
  const [importOpen, setImportOpen] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [toast, setToast] = useState(null)

  async function handleSync() {
    setSyncing(true)
    try {
      const res = await fetch(`${API_BASE}/marks/sync`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dev_code: row.dev_code }),
      })
      const data = await res.json()
      setToast(`Updated ${data.updated} lot${data.updated !== 1 ? 's' : ''}`)
      setTimeout(() => setToast(null), 3000)
    } finally {
      setSyncing(false)
    }
  }

  function handleImportDone(inserted) {
    setToast(`Imported ${inserted} lot${inserted !== 1 ? 's' : ''}`)
    setTimeout(() => setToast(null), 3000)
    setImportOpen(false)
    onRefresh()
  }

  const hasActivity = row.unimported > 0 || row.imported > 0

  return (
    <div style={{
      border: '1px solid #e5e7eb', borderRadius: 6, marginBottom: 6, overflow: 'hidden',
    }}>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 10,
        padding: '6px 12px', background: '#f9fafb',
        borderBottom: importOpen ? '1px solid #e5e7eb' : 'none',
      }}>
        {/* dev code + name */}
        <code style={{ fontSize: 13, fontWeight: 700, color: '#111827', width: 48 }}>{row.dev_code}</code>
        <span style={{ fontSize: 13, color: '#374151', flex: 1 }}>
          {row.dev_name ?? <span style={{ color: '#9ca3af', fontSize: 11 }}>not linked to internal dev</span>}
        </span>

        {/* counts */}
        <span style={{ fontSize: 11, color: '#6b7280' }}>{row.total_marks} in MARKS</span>
        <span style={{ fontSize: 11, color: '#059669' }}>{row.imported} imported</span>
        {row.unimported > 0 && (
          <span style={{ fontSize: 11, color: '#2563eb', fontWeight: 600 }}>{row.unimported} new</span>
        )}
        {row.promotable > 0 && (
          <span style={{ fontSize: 11, color: '#7c3aed', fontWeight: 600 }}>{row.promotable} promotable</span>
        )}

        {/* toast */}
        {toast && <span style={{ fontSize: 11, color: '#059669', fontWeight: 500 }}>{toast}</span>}

        {/* actions */}
        <div style={{ display: 'flex', gap: 6 }}>
          {row.imported > 0 && (
            <Btn small onClick={handleSync} disabled={syncing}>
              {syncing ? '…' : 'Sync dates'}
            </Btn>
          )}
          {row.unimported > 0 && (
            <Btn small variant="primary" onClick={() => setImportOpen(o => !o)}>
              {importOpen ? 'Close' : 'Import lots'}
            </Btn>
          )}
        </div>
      </div>

      {importOpen && (
        <ImportPanel devCode={row.dev_code} onDone={handleImportDone} />
      )}
    </div>
  )
}

// ─── MarksView ─────────────────────────────────────────────────────────────────

export default function MarksView() {
  const [summary, setSummary] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [syncingAll, setSyncingAll] = useState(false)
  const [syncToast, setSyncToast] = useState(null)
  const [filter, setFilter] = useState('all') // all | new | promotable

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await fetch(`${API_BASE}/marks/summary`).then(r => r.json())
      setSummary(data)
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  async function handleSyncAll() {
    setSyncingAll(true)
    try {
      const res = await fetch(`${API_BASE}/marks/sync`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dev_code: null }),
      })
      const data = await res.json()
      setSyncToast(`Synced — ${data.updated} lot${data.updated !== 1 ? 's' : ''} updated`)
      setTimeout(() => setSyncToast(null), 4000)
    } finally {
      setSyncingAll(false)
    }
  }

  const filtered = (summary || []).filter(row => {
    if (filter === 'new')        return row.unimported > 0
    if (filter === 'promotable') return row.promotable > 0
    return true
  })

  const totalUnimported  = (summary || []).reduce((s, r) => s + r.unimported, 0)
  const totalPromotable  = (summary || []).reduce((s, r) => s + r.promotable, 0)
  const totalImported    = (summary || []).reduce((s, r) => s + r.imported, 0)

  if (loading) return <div style={{ padding: 40, color: '#9ca3af', fontSize: 13 }}>Loading…</div>
  if (error)   return <div style={{ padding: 40, color: '#dc2626', fontSize: 13 }}>{error}</div>

  return (
    <div style={{ padding: '24px 32px', maxWidth: 900, boxSizing: 'border-box' }}>

      {/* header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 4 }}>
        <h1 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: '#111827' }}>MARKS Lots</h1>
        <Btn variant="default" onClick={handleSyncAll} disabled={syncingAll}>
          {syncingAll ? 'Syncing…' : 'Sync all dates'}
        </Btn>
        {syncToast && <span style={{ fontSize: 12, color: '#059669', fontWeight: 500 }}>{syncToast}</span>}
      </div>

      {/* summary bar */}
      <div style={{ display: 'flex', gap: 20, marginBottom: 16, fontSize: 12, color: '#6b7280' }}>
        <span><strong style={{ color: '#111827' }}>{totalImported}</strong> imported</span>
        {totalUnimported > 0 && (
          <span><strong style={{ color: '#2563eb' }}>{totalUnimported}</strong> new in MARKS</span>
        )}
        {totalPromotable > 0 && (
          <span><strong style={{ color: '#7c3aed' }}>{totalPromotable}</strong> pre lots ready to promote</span>
        )}
      </div>

      {/* promotable banner */}
      {totalPromotable > 0 && <PromotableSection onRefresh={load} />}

      {/* filter tabs */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 12 }}>
        {[
          { key: 'all',        label: `All (${(summary || []).length})` },
          { key: 'new',        label: `New (${totalUnimported})` },
          { key: 'promotable', label: `Promotable (${totalPromotable})` },
        ].map(tab => (
          <button key={tab.key} onClick={() => setFilter(tab.key)} style={{
            fontSize: 12, padding: '3px 10px', borderRadius: 4, cursor: 'pointer',
            background: filter === tab.key ? '#2563eb' : '#f1f5f9',
            color:      filter === tab.key ? '#fff'    : '#374151',
            border:     filter === tab.key ? '1px solid #1d4ed8' : '1px solid #d1d5db',
          }}>{tab.label}</button>
        ))}
      </div>

      {/* dev code rows */}
      {filtered.length === 0 ? (
        <div style={{ fontSize: 13, color: '#9ca3af' }}>Nothing to show.</div>
      ) : (
        filtered.map(row => (
          <DevCodeRow key={row.dev_code} row={row} onRefresh={load} />
        ))
      )}
    </div>
  )
}
