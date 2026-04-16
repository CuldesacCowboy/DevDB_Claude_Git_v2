import { useState, useEffect, useCallback, useRef } from 'react'
import { API_BASE } from '../config'
import {
  PANEL_BORDER, PANEL_HEADER_BG,
  TEXT_MUTED, TEXT_PRIMARY,
  BTN, greenEditorStyle,
} from '../utils/designTokens'

// ── Agreement status ───────────────────────────────────────────────
const AGREEMENT_STATUS_OPTIONS = ['active', 'closed', 'expired']
const AGREEMENT_STATUS_STYLE = {
  active:  BTN.success,
  closed:  { color: '#6b7280', bg: '#f3f4f6', border: '#d1d5db' },
  expired: BTN.warning,
}

function cpObligationStatus(required, assignedCumulative) {
  if (!required || required === 0) return 'none'
  if (assignedCumulative >= required) return 'met'
  return 'short'
}

// ── Inline editable date ───────────────────────────────────────────
function EditDate({ value, onSave }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value ?? '')
  const ref = useRef()

  useEffect(() => { if (editing && ref.current) ref.current.focus() }, [editing])

  function commit() {
    setEditing(false)
    const v = draft?.trim() ?? ''
    if (v !== (value ?? '')) onSave(v || null)
  }

  if (editing) {
    return (
      <input
        ref={ref}
        type="date"
        value={draft ?? ''}
        onChange={e => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={e => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') setEditing(false) }}
        style={{ fontSize: 12, padding: '1px 4px', borderRadius: 3, width: 128, ...greenEditorStyle }}
      />
    )
  }

  return (
    <span
      onClick={() => { setDraft(value ?? ''); setEditing(true) }}
      title="Click to edit"
      style={{
        cursor: 'text', fontSize: 12,
        borderBottom: value ? '1px dashed #d1d5db' : '1px dashed #e5e7eb',
        color: value ? TEXT_PRIMARY : TEXT_MUTED,
      }}
    >
      {value || '—'}
    </span>
  )
}

// ── Inline editable number ─────────────────────────────────────────
function EditNumber({ value, onSave }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(String(value ?? 0))
  const ref = useRef()

  useEffect(() => { if (editing && ref.current) ref.current.focus() }, [editing])

  function commit() {
    setEditing(false)
    const n = parseInt(draft, 10)
    if (!isNaN(n) && n !== value) onSave(n)
  }

  if (editing) {
    return (
      <input
        ref={ref}
        type="number"
        value={draft}
        onChange={e => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={e => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') setEditing(false) }}
        style={{ fontSize: 12, padding: '1px 4px', borderRadius: 3, width: 60, ...greenEditorStyle }}
      />
    )
  }

  return (
    <span
      onClick={() => { setDraft(String(value ?? 0)); setEditing(true) }}
      title="Click to edit"
      style={{ cursor: 'text', fontSize: 12, borderBottom: '1px dashed #d1d5db', fontVariantNumeric: 'tabular-nums' }}
    >
      {value ?? 0}
    </span>
  )
}

// ── Inline editable text ───────────────────────────────────────────
function EditText({ value, onSave, style }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value ?? '')
  const ref = useRef()

  useEffect(() => { if (editing && ref.current) ref.current.focus() }, [editing])

  function commit() {
    setEditing(false)
    if ((draft ?? '') !== (value ?? '')) onSave(draft)
  }

  if (editing) {
    return (
      <input
        ref={ref}
        value={draft ?? ''}
        onChange={e => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={e => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') setEditing(false) }}
        style={{ fontSize: 13, padding: '2px 5px', borderRadius: 3, width: 200, ...greenEditorStyle, ...style }}
      />
    )
  }

  return (
    <span
      onClick={() => { setDraft(value ?? ''); setEditing(true) }}
      title="Click to edit"
      style={{ cursor: 'text', borderBottom: '1px dashed #d1d5db', fontSize: 13, ...style }}
    >
      {value || <span style={{ color: TEXT_MUTED }}>—</span>}
    </span>
  )
}

// ── Small button ───────────────────────────────────────────────────
function Btn({ variant = 'default', onClick, disabled, children, style }) {
  const v = BTN[variant] || BTN.default
  return (
    <button onClick={onClick} disabled={disabled} style={{
      fontSize: 12, padding: '3px 10px', borderRadius: 4,
      border: `1px solid ${v.border}`,
      background: disabled ? '#f3f4f6' : v.bg,
      color: disabled ? '#9ca3af' : v.color,
      cursor: disabled ? 'default' : 'pointer',
      fontWeight: 500, ...style,
    }}>
      {children}
    </button>
  )
}

// ── Table style constants ──────────────────────────────────────────
const TH = {
  textAlign: 'left', padding: '3px 8px', fontSize: 11,
  fontWeight: 600, color: TEXT_MUTED, borderBottom: `1px solid ${PANEL_BORDER}`,
}
const TD = { padding: '6px 8px', verticalAlign: 'middle' }
const BADGE = { display: 'inline-block', fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 10 }

// ── Checkpoints section ────────────────────────────────────────────
function CheckpointsSection({ tda, onPatchCheckpoint, onAddCheckpoint, onDeleteCheckpoint }) {
  const [confirmDelete, setConfirmDelete] = useState(null)

  return (
    <div style={{ padding: '10px 16px' }}>
      <div style={{ fontSize: 11, fontWeight: 600, color: TEXT_MUTED, marginBottom: 6 }}>CHECKPOINTS</div>

      {tda.checkpoints.length > 0 && (
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, marginBottom: 6 }}>
          <thead>
            <tr>
              {['#', 'Date', 'Required', 'Assigned', 'Gap', 'Status', ''].map(h => (
                <th key={h} style={TH}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {tda.checkpoints.map(cp => {
              const required    = cp.lots_required_cumulative || 0
              const cumAssigned = cp.lots_assigned_cumulative || 0
              const gap         = required - cumAssigned
              const status      = cpObligationStatus(required, cumAssigned)

              return (
                <tr key={cp.checkpoint_id} style={{ borderBottom: `1px solid ${PANEL_BORDER}` }}>
                  <td style={TD}>{cp.checkpoint_number}</td>
                  <td style={TD}>
                    <EditDate value={cp.checkpoint_date}
                      onSave={v => onPatchCheckpoint(cp.checkpoint_id, { checkpoint_date: v })} />
                  </td>
                  <td style={TD}>
                    <EditNumber value={required}
                      onSave={v => onPatchCheckpoint(cp.checkpoint_id, { lots_required_cumulative: v })} />
                  </td>
                  <td style={{ ...TD, color: TEXT_MUTED }}>{cumAssigned}</td>
                  <td style={{
                    ...TD, fontWeight: gap !== 0 ? 600 : 400,
                    color: gap > 0 ? '#dc2626' : gap < 0 ? '#15803d' : TEXT_MUTED,
                  }}>
                    {required === 0 ? '—' : gap > 0 ? `−${gap}` : gap < 0 ? `+${Math.abs(gap)}` : '0'}
                  </td>
                  <td style={TD}>
                    {status === 'met'   && <span style={{ ...BADGE, background: '#f0fdf4', color: '#15803d', border: '1px solid #bbf7d0' }}>Met</span>}
                    {status === 'short' && <span style={{ ...BADGE, background: '#fef2f2', color: '#dc2626', border: '1px solid #fecaca' }}>Short {gap}</span>}
                    {status === 'none'  && <span style={{ ...BADGE, background: '#f3f4f6', color: '#9ca3af', border: '1px solid #e5e7eb' }}>—</span>}
                  </td>
                  <td style={{ ...TD, textAlign: 'right', paddingRight: 4 }}>
                    {confirmDelete === cp.checkpoint_id ? (
                      <span style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}>
                        <span style={{ fontSize: 11, color: '#dc2626' }}>Delete?</span>
                        <Btn variant="danger" style={{ padding: '1px 6px', fontSize: 11 }}
                          onClick={() => { onDeleteCheckpoint(cp.checkpoint_id); setConfirmDelete(null) }}>Yes</Btn>
                        <Btn style={{ padding: '1px 6px', fontSize: 11 }}
                          onClick={() => setConfirmDelete(null)}>No</Btn>
                      </span>
                    ) : (
                      <button onClick={() => setConfirmDelete(cp.checkpoint_id)}
                        style={{ fontSize: 14, color: '#d1d5db', background: 'none', border: 'none', cursor: 'pointer' }}
                        title="Delete checkpoint">×</button>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}

      {tda.checkpoints.length === 0 && (
        <p style={{ fontSize: 12, color: TEXT_MUTED, margin: '0 0 6px' }}>No checkpoints.</p>
      )}

      <button onClick={onAddCheckpoint}
        style={{ fontSize: 12, color: '#2563eb', background: 'none', border: 'none', cursor: 'pointer', padding: 0, fontWeight: 500 }}>
        + Add Checkpoint
      </button>
    </div>
  )
}

// ── Lots section ───────────────────────────────────────────────────
function LotsSection({ tda, unassignedLots, onAddLots, onRemoveLot, onAssignCheckpoint, onEditLotDates }) {
  const [showAdd, setShowAdd]         = useState(false)
  const [addSearch, setAddSearch]     = useState('')
  const [selectedIds, setSelectedIds] = useState(new Set())
  const [confirmRemove, setConfirmRemove] = useState(null)

  const filteredUnassigned = unassignedLots.filter(l =>
    !addSearch || (l.lot_number ?? '').toLowerCase().includes(addSearch.toLowerCase())
  )

  function toggleSelect(lotId) {
    setSelectedIds(prev => {
      const next = new Set(prev)
      next.has(lotId) ? next.delete(lotId) : next.add(lotId)
      return next
    })
  }

  async function handleAdd() {
    if (selectedIds.size === 0) return
    await onAddLots(tda.tda_id, [...selectedIds])
    setSelectedIds(new Set())
    setShowAdd(false)
    setAddSearch('')
  }

  const cpOptions = [
    { value: '', label: '— Pool —' },
    ...tda.checkpoints.map(cp => ({
      value: String(cp.checkpoint_id),
      label: `CP ${cp.checkpoint_number}${cp.checkpoint_date ? ' · ' + cp.checkpoint_date : ''}`,
    })),
  ]

  return (
    <div style={{ padding: '10px 16px', borderTop: `1px solid ${PANEL_BORDER}` }}>
      <div style={{ fontSize: 11, fontWeight: 600, color: TEXT_MUTED, marginBottom: 6 }}>
        LOTS IN AGREEMENT
        <span style={{ fontWeight: 400, marginLeft: 6 }}>({tda.lots.length})</span>
      </div>

      {tda.lots.length > 0 && (
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, marginBottom: 8 }}>
          <thead>
            <tr>
              <th style={TH}>Lot</th>
              <th style={TH}>Checkpoint</th>
              <th style={{ ...TH }} title="Hold / HC takedown date (date_td_hold_projected)">HC Date</th>
              <th style={{ ...TH }} title="Builder takedown date (date_td_projected)">BLDR Date</th>
              <th style={TH}></th>
            </tr>
          </thead>
          <tbody>
            {tda.lots.map(lot => (
              <tr key={lot.lot_id} style={{ borderBottom: `1px solid ${PANEL_BORDER}` }}>
                <td style={TD}>
                  <span style={{ fontFamily: 'monospace', fontSize: 12, color: TEXT_PRIMARY }}>
                    {lot.lot_number}
                  </span>
                </td>

                <td style={TD}>
                  <select
                    value={lot.checkpoint_id ? String(lot.checkpoint_id) : ''}
                    onChange={e => onAssignCheckpoint(tda.tda_id, lot.lot_id, e.target.value || null)}
                    style={{
                      fontSize: 11, padding: '2px 4px', borderRadius: 3,
                      border: '1px solid #d1d5db', background: '#fff', color: TEXT_PRIMARY,
                      maxWidth: 180,
                    }}
                  >
                    {cpOptions.map(o => (
                      <option key={o.value} value={o.value}>{o.label}</option>
                    ))}
                  </select>
                </td>

                <td style={TD}>
                  {lot.hc_marks_date
                    ? <span style={{ fontSize: 12, color: TEXT_MUTED, fontStyle: 'italic' }}>{lot.hc_marks_date}</span>
                    : <EditDate value={lot.hc_projected_date}
                        onSave={v => onEditLotDates(lot.lot_id, { hc_projected_date: v })} />
                  }
                </td>

                <td style={TD}>
                  {lot.bldr_marks_date
                    ? <span style={{ fontSize: 12, color: TEXT_MUTED, fontStyle: 'italic' }}>{lot.bldr_marks_date}</span>
                    : <EditDate value={lot.bldr_projected_date}
                        onSave={v => onEditLotDates(lot.lot_id, { bldr_projected_date: v })} />
                  }
                </td>

                <td style={{ ...TD, textAlign: 'right' }}>
                  {confirmRemove === lot.lot_id ? (
                    <span style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}>
                      <span style={{ fontSize: 11, color: '#dc2626' }}>Remove?</span>
                      <Btn variant="danger" style={{ padding: '1px 6px', fontSize: 11 }}
                        onClick={() => { onRemoveLot(tda.tda_id, lot.lot_id); setConfirmRemove(null) }}>Yes</Btn>
                      <Btn style={{ padding: '1px 6px', fontSize: 11 }}
                        onClick={() => setConfirmRemove(null)}>No</Btn>
                    </span>
                  ) : (
                    <button onClick={() => setConfirmRemove(lot.lot_id)}
                      style={{ fontSize: 14, color: '#d1d5db', background: 'none', border: 'none', cursor: 'pointer' }}
                      title="Remove from agreement">×</button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {/* Add-lots panel toggle */}
      {!showAdd && unassignedLots.length > 0 && (
        <button
          onClick={() => { setShowAdd(true); setSelectedIds(new Set()) }}
          style={{ fontSize: 12, color: '#2563eb', background: 'none', border: 'none', cursor: 'pointer', padding: 0, fontWeight: 500 }}
        >
          + Add Lots
        </button>
      )}

      {!showAdd && tda.lots.length === 0 && unassignedLots.length === 0 && (
        <p style={{ fontSize: 12, color: TEXT_MUTED, margin: 0 }}>No unassigned lots available for this community.</p>
      )}

      {/* Add-lots inline panel */}
      {showAdd && (
        <div style={{
          marginTop: 6, padding: 10, border: `1px solid ${PANEL_BORDER}`, borderRadius: 4, background: '#f9fafb',
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: TEXT_PRIMARY }}>Add lots to agreement</span>
            <button onClick={() => { setShowAdd(false); setSelectedIds(new Set()); setAddSearch('') }}
              style={{ fontSize: 12, color: TEXT_MUTED, background: 'none', border: 'none', cursor: 'pointer' }}>
              Cancel
            </button>
          </div>
          <input
            value={addSearch}
            onChange={e => setAddSearch(e.target.value)}
            placeholder="Filter lots…"
            style={{
              width: '100%', fontSize: 12, padding: '3px 7px', borderRadius: 4,
              border: '1px solid #d1d5db', background: '#fff', marginBottom: 6, boxSizing: 'border-box',
            }}
          />
          <div style={{ maxHeight: 160, overflowY: 'auto', marginBottom: 8 }}>
            {filteredUnassigned.length === 0 && (
              <p style={{ fontSize: 12, color: TEXT_MUTED, margin: 0 }}>No lots match.</p>
            )}
            {filteredUnassigned.map(lot => (
              <label key={lot.lot_id} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, padding: '2px 0', cursor: 'pointer', color: TEXT_PRIMARY }}>
                <input type="checkbox" checked={selectedIds.has(lot.lot_id)} onChange={() => toggleSelect(lot.lot_id)} />
                <span style={{ fontFamily: 'monospace' }}>{lot.lot_number}</span>
              </label>
            ))}
          </div>
          <Btn variant="primary" onClick={handleAdd} disabled={selectedIds.size === 0}>
            Add {selectedIds.size > 0 ? selectedIds.size : ''} {selectedIds.size === 1 ? 'lot' : 'lots'}
          </Btn>
        </div>
      )}
    </div>
  )
}

// ── Agreement card ─────────────────────────────────────────────────
function AgreementCard({ tda, unassignedLots, onPatch, onAddCheckpoint, onPatchCheckpoint, onDeleteCheckpoint, onAddLots, onRemoveLot, onAssignCheckpoint, onEditLotDates }) {
  const ss = AGREEMENT_STATUS_STYLE[tda.status] || AGREEMENT_STATUS_STYLE.active

  return (
    <div style={{ marginBottom: 18, border: `1px solid ${PANEL_BORDER}`, borderRadius: 6, background: '#fff', overflow: 'hidden' }}>
      {/* Header */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 12, padding: '9px 16px',
        background: PANEL_HEADER_BG, borderBottom: `1px solid ${PANEL_BORDER}`, flexWrap: 'wrap',
      }}>
        <EditText
          value={tda.tda_name}
          onSave={v => v && onPatch({ tda_name: v })}
          style={{ fontWeight: 600, fontSize: 14, color: TEXT_PRIMARY, minWidth: 140 }}
        />
        <select
          value={tda.status || 'active'}
          onChange={e => onPatch({ status: e.target.value })}
          style={{
            fontSize: 12, padding: '2px 7px', borderRadius: 10,
            border: `1px solid ${ss.border}`, background: ss.bg, color: ss.color,
            fontWeight: 600, cursor: 'pointer',
          }}
        >
          {AGREEMENT_STATUS_OPTIONS.map(s => (
            <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</option>
          ))}
        </select>
        <span style={{ fontSize: 12, color: TEXT_MUTED }}>Anchor:</span>
        <EditDate value={tda.anchor_date} onSave={v => onPatch({ anchor_date: v })} />
      </div>

      <CheckpointsSection
        tda={tda}
        onPatchCheckpoint={onPatchCheckpoint}
        onAddCheckpoint={() => onAddCheckpoint(tda.tda_id)}
        onDeleteCheckpoint={onDeleteCheckpoint}
      />

      <LotsSection
        tda={tda}
        unassignedLots={unassignedLots}
        onAddLots={onAddLots}
        onRemoveLot={onRemoveLot}
        onAssignCheckpoint={onAssignCheckpoint}
        onEditLotDates={onEditLotDates}
      />
    </div>
  )
}

// ── Main view ──────────────────────────────────────────────────────
export default function TakedownView({ showTestCommunities }) {
  const [communities, setCommunities] = useState([])
  const [search, setSearch]           = useState('')
  const [selectedId, setSelectedId]   = useState(() => {
    try { return Number(localStorage.getItem('devdb_tda_community')) || null } catch { return null }
  })
  const [data, setData]     = useState(null)
  const [loading, setLoading] = useState(false)
  const [showNewForm, setShowNewForm] = useState(false)
  const [newName, setNewName]         = useState('')

  // Load community list
  useEffect(() => {
    fetch(`${API_BASE}/entitlement-groups`)
      .then(r => r.json())
      .then(rows => {
        const filtered = Array.isArray(rows)
          ? rows.filter(r => showTestCommunities ? r.is_test : !r.is_test)
          : []
        setCommunities(filtered)
      })
      .catch(() => {})
  }, [showTestCommunities]) // eslint-disable-line react-hooks/exhaustive-deps

  // Persist selection
  useEffect(() => {
    if (selectedId) {
      try { localStorage.setItem('devdb_tda_community', String(selectedId)) } catch {}
    }
  }, [selectedId])

  // Load overview data
  const load = useCallback(() => {
    if (!selectedId) return
    setLoading(true)
    fetch(`${API_BASE}/entitlement-groups/${selectedId}/tda-overview`)
      .then(r => r.json())
      .then(d => { setData(d); setLoading(false) })
      .catch(() => setLoading(false))
  }, [selectedId])

  useEffect(() => { load() }, [load])

  // ── Mutations ──────────────────────────────────────────────────────

  async function createAgreement() {
    const name = newName.trim()
    if (!name || !selectedId) return
    await fetch(`${API_BASE}/takedown-agreements`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tda_name: name, ent_group_id: selectedId }),
    })
    setNewName(''); setShowNewForm(false); load()
  }

  async function patchAgreement(tdaId, patch) {
    await fetch(`${API_BASE}/takedown-agreements/${tdaId}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    })
    load()
  }

  async function addCheckpoint(tdaId) {
    await fetch(`${API_BASE}/takedown-agreements/${tdaId}/checkpoints`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ checkpoint_date: null, lots_required_cumulative: 0 }),
    })
    load()
  }

  async function patchCheckpoint(cpId, patch) {
    await fetch(`${API_BASE}/tda-checkpoints/${cpId}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    })
    load()
  }

  async function deleteCheckpoint(cpId) {
    await fetch(`${API_BASE}/tda-checkpoints/${cpId}`, { method: 'DELETE' })
    load()
  }

  async function addLots(tdaId, lotIds) {
    await Promise.all(lotIds.map(id =>
      fetch(`${API_BASE}/takedown-agreements/${tdaId}/lots/${id}/pool`, { method: 'POST' })
    ))
    load()
  }

  async function removeLot(tdaId, lotId) {
    await fetch(`${API_BASE}/takedown-agreements/${tdaId}/lots/${lotId}/pool`, { method: 'DELETE' })
    load()
  }

  async function assignCheckpoint(tdaId, lotId, checkpointId) {
    if (checkpointId) {
      await fetch(`${API_BASE}/takedown-agreements/${tdaId}/lots/${lotId}/assign`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ checkpoint_id: parseInt(checkpointId, 10) }),
      })
    } else {
      await fetch(`${API_BASE}/takedown-agreements/${tdaId}/lots/${lotId}/assign`, { method: 'DELETE' })
    }
    load()
  }

  async function editLotDates(lotId, patch) {
    await fetch(`${API_BASE}/tda-lots/${lotId}/dates`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    })
    load()
  }

  // ── Filtered community list ────────────────────────────────────────
  const visibleCommunities = search
    ? communities.filter(c => c.ent_group_name.toLowerCase().includes(search.toLowerCase()))
    : communities

  // ── Render ─────────────────────────────────────────────────────────
  return (
    <div style={{ display: 'flex', height: 'calc(100vh - 44px)', overflow: 'hidden' }}>

      {/* ── Left sidebar (AuditView pattern) ── */}
      <div style={{
        width: 260, flexShrink: 0,
        borderRight: '1px solid #e5e7eb',
        display: 'flex', flexDirection: 'column',
        background: '#fafafa',
      }}>
        <div style={{ padding: '12px 12px 8px', borderBottom: '1px solid #e5e7eb' }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: '#1e293b', marginBottom: 8 }}>
            Takedown Agreements
          </div>
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search communities…"
            style={{
              width: '100%', fontSize: 11, padding: '4px 8px', borderRadius: 4,
              border: '1px solid #d1d5db', background: '#fff', outline: 'none',
              boxSizing: 'border-box',
            }}
          />
        </div>

        <div style={{ flex: 1, overflowY: 'auto' }}>
          {visibleCommunities.length === 0 && (
            <div style={{ padding: 16, fontSize: 11, color: '#9ca3af', textAlign: 'center' }}>No matches.</div>
          )}
          {visibleCommunities.map(c => {
            const isSel = c.ent_group_id === selectedId
            return (
              <div
                key={c.ent_group_id}
                onClick={() => { setData(null); setSelectedId(c.ent_group_id) }}
                style={{
                  display: 'flex', alignItems: 'center', gap: 8,
                  padding: '7px 12px', cursor: 'pointer', userSelect: 'none',
                  borderLeft: isSel ? '3px solid #2563eb' : '3px solid transparent',
                  background: isSel ? '#eff6ff' : 'transparent',
                  borderBottom: '1px solid #f1f5f9',
                }}
              >
                <span style={{ fontSize: 12, color: isSel ? '#1d4ed8' : '#374151', flex: 1, lineHeight: 1.3 }}>
                  {c.ent_group_name}
                </span>
              </div>
            )
          })}
        </div>
      </div>

      {/* ── Right panel ── */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '20px 24px', background: '#f9fafb' }}>

        {!selectedId && (
          <p style={{ color: TEXT_MUTED, fontSize: 14, marginTop: 20 }}>
            Select a community to view its takedown agreements.
          </p>
        )}

        {selectedId && loading && (
          <p style={{ color: TEXT_MUTED, fontSize: 14, marginTop: 20 }}>Loading…</p>
        )}

        {selectedId && !loading && data && (
          <>
            {/* New agreement button / form */}
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 16 }}>
              {showNewForm ? (
                <span style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                  <input
                    autoFocus
                    value={newName}
                    onChange={e => setNewName(e.target.value)}
                    onKeyDown={e => {
                      if (e.key === 'Enter') createAgreement()
                      if (e.key === 'Escape') { setShowNewForm(false); setNewName('') }
                    }}
                    placeholder="Agreement name"
                    style={{ fontSize: 13, padding: '3px 8px', borderRadius: 4, border: '1px solid #d1d5db', width: 200 }}
                  />
                  <Btn variant="success" onClick={createAgreement} disabled={!newName.trim()}>Create</Btn>
                  <Btn onClick={() => { setShowNewForm(false); setNewName('') }}>Cancel</Btn>
                </span>
              ) : (
                <Btn variant="primary" onClick={() => setShowNewForm(true)}>+ New Agreement</Btn>
              )}
            </div>

            {data.agreements.length === 0 && (
              <p style={{ color: TEXT_MUTED, fontSize: 14 }}>No agreements yet for this community.</p>
            )}

            {data.agreements.map(tda => (
              <AgreementCard
                key={tda.tda_id}
                tda={tda}
                unassignedLots={data.unassigned_lots || []}
                onPatch={patch => patchAgreement(tda.tda_id, patch)}
                onAddCheckpoint={addCheckpoint}
                onPatchCheckpoint={patchCheckpoint}
                onDeleteCheckpoint={deleteCheckpoint}
                onAddLots={addLots}
                onRemoveLot={removeLot}
                onAssignCheckpoint={assignCheckpoint}
                onEditLotDates={editLotDates}
              />
            ))}
          </>
        )}
      </div>
    </div>
  )
}
