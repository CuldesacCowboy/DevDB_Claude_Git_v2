import { useState, useEffect, useCallback, useRef } from 'react'
import { API_BASE } from '../config'
import {
  PANEL_BORDER, PANEL_HEADER_BG,
  TEXT_MUTED, TEXT_PRIMARY,
  BTN, greenEditorStyle,
} from '../utils/designTokens'

// ── Status display for agreements ─────────────────────────────────
const AGREEMENT_STATUS_OPTIONS = ['active', 'closed', 'expired']
const AGREEMENT_STATUS_STYLE = {
  active:  BTN.success,
  closed:  { color: '#6b7280', bg: '#f3f4f6', border: '#d1d5db' },
  expired: BTN.warning,
}

// ── Checkpoint obligation status ──────────────────────────────────
function cpObligationStatus(required, assignedCumulative) {
  if (!required || required === 0) return 'none'
  if (assignedCumulative >= required) return 'met'
  return 'short'
}

// ── Inline editable cell ──────────────────────────────────────────
function EditCell({ value, type = 'text', onSave, placeholder, style }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value ?? '')
  const inputRef = useRef()

  useEffect(() => {
    if (editing && inputRef.current) inputRef.current.focus()
  }, [editing])

  function start() {
    setDraft(value ?? '')
    setEditing(true)
  }

  function commit() {
    setEditing(false)
    const trimmed = type === 'number' ? draft : String(draft ?? '').trim()
    if (trimmed !== String(value ?? '').trim()) onSave(trimmed)
  }

  function onKey(e) {
    if (e.key === 'Enter') commit()
    if (e.key === 'Escape') setEditing(false)
  }

  if (editing) {
    return (
      <input
        ref={inputRef}
        type={type}
        value={draft ?? ''}
        onChange={e => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={onKey}
        style={{
          fontSize: 13,
          padding: '2px 5px',
          borderRadius: 3,
          ...greenEditorStyle,
          width: type === 'date' ? 128 : type === 'number' ? 64 : 200,
          ...style,
        }}
      />
    )
  }

  const displayVal = value || ''
  return (
    <span
      onClick={start}
      title="Click to edit"
      style={{
        cursor: 'text',
        borderBottom: '1px dashed #d1d5db',
        fontSize: 13,
        color: displayVal ? undefined : TEXT_MUTED,
        ...style,
      }}
    >
      {displayVal || placeholder || <span style={{ color: TEXT_MUTED }}>—</span>}
    </span>
  )
}

// ── Small button helper ────────────────────────────────────────────
function Btn({ variant = 'default', onClick, disabled, children, style }) {
  const v = BTN[variant] || BTN.default
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        fontSize: 12,
        padding: '3px 10px',
        borderRadius: 4,
        border: `1px solid ${v.border}`,
        background: disabled ? '#f3f4f6' : v.bg,
        color: disabled ? '#9ca3af' : v.color,
        cursor: disabled ? 'default' : 'pointer',
        fontWeight: 500,
        ...style,
      }}
    >
      {children}
    </button>
  )
}

// ── Agreement card ────────────────────────────────────────────────
function AgreementCard({ tda, onPatch, onAddCheckpoint, onPatchCheckpoint, onDeleteCheckpoint }) {
  const [confirmDeleteCp, setConfirmDeleteCp] = useState(null)
  const ss = AGREEMENT_STATUS_STYLE[tda.status] || AGREEMENT_STATUS_STYLE.active

  return (
    <div style={{
      marginBottom: 18,
      border: `1px solid ${PANEL_BORDER}`,
      borderRadius: 6,
      background: '#fff',
      overflow: 'hidden',
    }}>
      {/* ── Agreement header ── */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        padding: '9px 16px',
        background: PANEL_HEADER_BG,
        borderBottom: `1px solid ${PANEL_BORDER}`,
        flexWrap: 'wrap',
      }}>
        <EditCell
          value={tda.tda_name}
          onSave={v => v && onPatch({ tda_name: v })}
          placeholder="Agreement name"
          style={{ fontWeight: 600, fontSize: 14, color: TEXT_PRIMARY, minWidth: 140 }}
        />

        <select
          value={tda.status || 'active'}
          onChange={e => onPatch({ status: e.target.value })}
          style={{
            fontSize: 12,
            padding: '2px 7px',
            borderRadius: 10,
            border: `1px solid ${ss.border}`,
            background: ss.bg,
            color: ss.color,
            fontWeight: 600,
            cursor: 'pointer',
          }}
        >
          {AGREEMENT_STATUS_OPTIONS.map(s => (
            <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</option>
          ))}
        </select>

        <span style={{ fontSize: 12, color: TEXT_MUTED, marginLeft: 4 }}>Anchor:</span>
        <EditCell
          value={tda.anchor_date || ''}
          type="date"
          onSave={v => onPatch({ anchor_date: v || null })}
          placeholder="—"
          style={{ fontSize: 12 }}
        />
      </div>

      {/* ── Checkpoint table ── */}
      <div style={{ padding: '12px 16px' }}>
        {tda.checkpoints.length > 0 ? (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr>
                {['#', 'Date', 'Required', 'Assigned', 'Gap', 'Status', ''].map(h => (
                  <th key={h} style={{
                    textAlign: 'left',
                    padding: '3px 10px',
                    fontSize: 11,
                    fontWeight: 600,
                    color: TEXT_MUTED,
                    borderBottom: `1px solid ${PANEL_BORDER}`,
                  }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {tda.checkpoints.map(cp => {
                const required = cp.lots_required_cumulative || 0
                const cumAssigned = cp.lots_assigned_cumulative || 0
                const gap = required - cumAssigned
                const status = cpObligationStatus(required, cumAssigned)

                return (
                  <tr key={cp.checkpoint_id} style={{ borderBottom: `1px solid ${PANEL_BORDER}` }}>
                    <td style={TD}>{cp.checkpoint_number}</td>

                    <td style={TD}>
                      <EditCell
                        value={cp.checkpoint_date || ''}
                        type="date"
                        onSave={v => onPatchCheckpoint(cp.checkpoint_id, { checkpoint_date: v || null })}
                        placeholder="—"
                      />
                    </td>

                    <td style={TD}>
                      <EditCell
                        value={String(required)}
                        type="number"
                        onSave={v => onPatchCheckpoint(cp.checkpoint_id, { lots_required_cumulative: parseInt(v, 10) || 0 })}
                        style={{ textAlign: 'right' }}
                      />
                    </td>

                    <td style={{ ...TD, color: TEXT_MUTED }}>{cumAssigned}</td>

                    <td style={{
                      ...TD,
                      fontWeight: gap !== 0 ? 600 : 400,
                      color: gap > 0 ? '#dc2626' : gap < 0 ? '#15803d' : TEXT_MUTED,
                    }}>
                      {required === 0 ? '—' : gap > 0 ? `−${gap}` : gap < 0 ? `+${Math.abs(gap)}` : '0'}
                    </td>

                    <td style={TD}>
                      {status === 'met' && (
                        <span style={{ ...BADGE, background: '#f0fdf4', color: '#15803d', border: '1px solid #bbf7d0' }}>
                          Met
                        </span>
                      )}
                      {status === 'short' && (
                        <span style={{ ...BADGE, background: '#fef2f2', color: '#dc2626', border: '1px solid #fecaca' }}>
                          Short {gap}
                        </span>
                      )}
                      {status === 'none' && (
                        <span style={{ ...BADGE, background: '#f3f4f6', color: '#9ca3af', border: '1px solid #e5e7eb' }}>
                          —
                        </span>
                      )}
                    </td>

                    <td style={{ ...TD, textAlign: 'right', paddingRight: 4 }}>
                      {confirmDeleteCp === cp.checkpoint_id ? (
                        <span style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}>
                          <span style={{ fontSize: 11, color: '#dc2626' }}>Delete?</span>
                          <Btn variant="danger" onClick={() => { onDeleteCheckpoint(cp.checkpoint_id); setConfirmDeleteCp(null) }}>
                            Yes
                          </Btn>
                          <Btn onClick={() => setConfirmDeleteCp(null)}>No</Btn>
                        </span>
                      ) : (
                        <button
                          onClick={() => setConfirmDeleteCp(cp.checkpoint_id)}
                          style={{
                            fontSize: 14, lineHeight: 1, padding: '0 4px',
                            color: '#d1d5db', background: 'none', border: 'none', cursor: 'pointer',
                          }}
                          title="Delete checkpoint"
                        >
                          ×
                        </button>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        ) : (
          <p style={{ fontSize: 13, color: TEXT_MUTED, margin: '0 0 8px' }}>No checkpoints.</p>
        )}

        <button
          onClick={onAddCheckpoint}
          style={{
            marginTop: 8,
            fontSize: 12,
            color: '#2563eb',
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            padding: 0,
            fontWeight: 500,
          }}
        >
          + Add Checkpoint
        </button>
      </div>
    </div>
  )
}

const TD = { padding: '7px 10px', verticalAlign: 'middle' }
const BADGE = {
  display: 'inline-block',
  fontSize: 11,
  fontWeight: 600,
  padding: '2px 8px',
  borderRadius: 10,
}

// ── Main view ─────────────────────────────────────────────────────
export default function TakedownView({ showTestCommunities }) {
  const [communities, setCommunities] = useState([])
  const [selectedId, setSelectedId] = useState(() => {
    try { return Number(localStorage.getItem('devdb_tda_community')) || null } catch { return null }
  })
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [showNewForm, setShowNewForm] = useState(false)
  const [newName, setNewName] = useState('')

  // Load community list
  useEffect(() => {
    fetch(`${API_BASE}/entitlement-groups`)
      .then(r => r.json())
      .then(rows => {
        const filtered = Array.isArray(rows)
          ? rows.filter(r => showTestCommunities ? r.is_test : !r.is_test)
          : []
        setCommunities(filtered)
        if (filtered.length > 0 && !selectedId) {
          setSelectedId(filtered[0].ent_group_id)
        }
      })
      .catch(() => {})
  }, [showTestCommunities]) // eslint-disable-line react-hooks/exhaustive-deps

  // Persist selected community
  useEffect(() => {
    if (selectedId) {
      try { localStorage.setItem('devdb_tda_community', String(selectedId)) } catch {}
    }
  }, [selectedId])

  // Load overview for selected community
  const load = useCallback(() => {
    if (!selectedId) return
    setLoading(true)
    fetch(`${API_BASE}/entitlement-groups/${selectedId}/tda-overview`)
      .then(r => r.json())
      .then(d => { setData(d); setLoading(false) })
      .catch(() => setLoading(false))
  }, [selectedId])

  useEffect(() => { load() }, [load])

  // ── Mutations ─────────────────────────────────────────────────────

  async function createAgreement() {
    const name = newName.trim()
    if (!name || !selectedId) return
    setSaving(true)
    await fetch(`${API_BASE}/takedown-agreements`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tda_name: name, ent_group_id: selectedId }),
    })
    setSaving(false)
    setNewName('')
    setShowNewForm(false)
    load()
  }

  async function patchAgreement(tdaId, patch) {
    setSaving(true)
    await fetch(`${API_BASE}/takedown-agreements/${tdaId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    })
    setSaving(false)
    load()
  }

  async function addCheckpoint(tdaId) {
    await fetch(`${API_BASE}/takedown-agreements/${tdaId}/checkpoints`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ checkpoint_date: null, lots_required_cumulative: 0 }),
    })
    load()
  }

  async function patchCheckpoint(cpId, patch) {
    await fetch(`${API_BASE}/tda-checkpoints/${cpId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    })
    load()
  }

  async function deleteCheckpoint(cpId) {
    await fetch(`${API_BASE}/tda-checkpoints/${cpId}`, { method: 'DELETE' })
    load()
  }

  // ── Render ────────────────────────────────────────────────────────

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: '#f9fafb' }}>

      {/* ── Top bar ── */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        padding: '8px 24px',
        background: '#fff',
        borderBottom: `1px solid ${PANEL_BORDER}`,
        flexShrink: 0,
        flexWrap: 'wrap',
      }}>
        <span style={{ fontWeight: 600, fontSize: 14, color: TEXT_PRIMARY, marginRight: 4 }}>
          Takedown Agreements
        </span>

        <select
          value={selectedId ?? ''}
          onChange={e => { setData(null); setSelectedId(Number(e.target.value)) }}
          style={{
            fontSize: 13,
            padding: '3px 8px',
            borderRadius: 4,
            border: '1px solid #d1d5db',
            color: TEXT_PRIMARY,
            background: '#fff',
          }}
        >
          <option value="">— Select community —</option>
          {communities.map(c => (
            <option key={c.ent_group_id} value={c.ent_group_id}>{c.ent_group_name}</option>
          ))}
        </select>

        {saving && <span style={{ fontSize: 12, color: TEXT_MUTED }}>Saving…</span>}

        <div style={{ marginLeft: 'auto' }}>
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
                style={{
                  fontSize: 13,
                  padding: '3px 8px',
                  borderRadius: 4,
                  border: '1px solid #d1d5db',
                  width: 190,
                }}
              />
              <Btn variant="success" onClick={createAgreement} disabled={!newName.trim()}>
                Create
              </Btn>
              <Btn onClick={() => { setShowNewForm(false); setNewName('') }}>Cancel</Btn>
            </span>
          ) : (
            <Btn variant="primary" onClick={() => setShowNewForm(true)} disabled={!selectedId}>
              + New Agreement
            </Btn>
          )}
        </div>
      </div>

      {/* ── Content ── */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '24px' }}>
        {!selectedId && (
          <p style={{ color: TEXT_MUTED, fontSize: 14 }}>
            Select a community to view its takedown agreements.
          </p>
        )}

        {selectedId && loading && (
          <p style={{ color: TEXT_MUTED, fontSize: 14 }}>Loading…</p>
        )}

        {selectedId && !loading && data && data.agreements.length === 0 && (
          <p style={{ color: TEXT_MUTED, fontSize: 14 }}>
            No agreements for this community yet.
          </p>
        )}

        {data && data.agreements.map(tda => (
          <AgreementCard
            key={tda.tda_id}
            tda={tda}
            onPatch={patch => patchAgreement(tda.tda_id, patch)}
            onAddCheckpoint={() => addCheckpoint(tda.tda_id)}
            onPatchCheckpoint={patchCheckpoint}
            onDeleteCheckpoint={deleteCheckpoint}
          />
        ))}
      </div>
    </div>
  )
}
