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

function cpLabel(cp) {
  if (!cp) return '—'
  const req = cp.lots_required_cumulative ?? cp.checkpoint_number ?? ''
  const dt = cp.checkpoint_date ?? ''
  if (req && dt) return `${req} by ${dt}`
  if (dt) return dt
  return `CP ${cp.checkpoint_number ?? ''}`
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
function CheckpointsSection({ tda, onPatchCheckpoint, onAddCheckpoint, onDeleteCheckpoint, onAutoAssign }) {
  const [confirmDelete, setConfirmDelete] = useState(null)
  const [assigning, setAssigning] = useState(false)

  async function handleAutoAssign() {
    setAssigning(true)
    await onAutoAssign(tda.tda_id)
    setAssigning(false)
  }

  return (
    <div style={{ padding: '10px 16px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
        <span style={{ fontSize: 11, fontWeight: 600, color: TEXT_MUTED }}>CHECKPOINTS</span>
        {tda.checkpoints.length > 0 && (
          <Btn variant="teal" onClick={handleAutoAssign} disabled={assigning} style={{ padding: '1px 7px', fontSize: 11 }}>
            {assigning ? 'Assigning…' : 'Auto-Assign Lots'}
          </Btn>
        )}
      </div>

      {tda.checkpoints.length > 0 && (
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, marginBottom: 6 }}>
          <thead>
            <tr>
              {['Checkpoint', 'Required', 'Assigned', 'Gap', 'Status', 'Taken Down', 'MARKS Plan', 'Sim Plan', ''].map(h => (
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
                  <td style={TD}>
                    <span style={{ fontWeight: 500, color: TEXT_PRIMARY }}>
                      <EditNumber value={required}
                        onSave={v => onPatchCheckpoint(cp.checkpoint_id, { lots_required_cumulative: v })} />
                      {' by '}
                      <EditDate value={cp.checkpoint_date}
                        onSave={v => onPatchCheckpoint(cp.checkpoint_id, { checkpoint_date: v })} />
                    </span>
                  </td>
                  <td style={{ ...TD, color: TEXT_MUTED }}>{required}</td>
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
                  <td style={{ ...TD, color: TEXT_MUTED, fontVariantNumeric: 'tabular-nums' }}>{cp.taken_down_to_date ?? 0}</td>
                  <td style={{ ...TD, color: TEXT_MUTED, fontVariantNumeric: 'tabular-nums' }}>{cp.marks_plan ?? 0}</td>
                  <td style={{ ...TD, color: TEXT_MUTED, fontVariantNumeric: 'tabular-nums' }}>{cp.sim_plan ?? 0}</td>
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

// ── Lot pill ───────────────────────────────────────────────────────
function LotPill({ lot, selected, onToggle, cpColor }) {
  const hasTd = !!(lot.bldr_marks_date || lot.bldr_projected_date || lot.hc_marks_date || lot.hc_projected_date)
  return (
    <div
      onClick={onToggle}
      title={`${lot.lot_number}${lot.lot_type_short ? ' · ' + lot.lot_type_short : ''}${lot.checkpoint_date ? ' · CP: ' + lot.checkpoint_date : ''}`}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 4,
        padding: '3px 8px', borderRadius: 12, fontSize: 11,
        fontFamily: 'monospace', cursor: 'pointer', userSelect: 'none',
        border: `1.5px solid ${selected ? '#2563eb' : '#d1d5db'}`,
        background: selected ? '#eff6ff' : '#fff',
        color: selected ? '#1d4ed8' : TEXT_PRIMARY,
        fontWeight: selected ? 700 : 400,
        transition: 'background 0.1s, border-color 0.1s',
      }}
    >
      {cpColor && (
        <span style={{
          width: 6, height: 6, borderRadius: '50%', flexShrink: 0,
          background: cpColor,
        }} />
      )}
      {lot.lot_number.replace(/^[A-Z]+0*/, '')}
      {hasTd && <span style={{ width: 4, height: 4, borderRadius: '50%', background: '#10b981', flexShrink: 0 }} />}
    </div>
  )
}

// CP colors for visual coding
const CP_COLORS = ['#3b82f6', '#8b5cf6', '#f59e0b', '#ef4444', '#10b981', '#f97316']

// ── Lots section (pill-based) ──────────────────────────────────────
function LotsSection({ tda, allTdas, unassignedLots, onAddLots, onRemoveLots, onMoveLots, onEditLotDates }) {
  const [selected, setSelected]     = useState(new Set())   // selected lot_ids
  const [showAdd, setShowAdd]       = useState(false)
  const [addSearch, setAddSearch]   = useState('')
  const [addSelected, setAddSelected] = useState(new Set())
  const [moveTarget, setMoveTarget] = useState('')
  const [confirmRemove, setConfirmRemove] = useState(false)
  const [lastClicked, setLastClicked] = useState(null)

  // Build CP color map
  const cpColorMap = {}
  tda.checkpoints.forEach((cp, i) => {
    cpColorMap[cp.checkpoint_id] = CP_COLORS[i % CP_COLORS.length]
  })

  const otherTdas = allTdas.filter(t => t.tda_id !== tda.tda_id)

  function toggleLot(lotId, shiftKey) {
    if (shiftKey && lastClicked !== null) {
      const ids = tda.lots.map(l => l.lot_id)
      const a = ids.indexOf(lastClicked)
      const b = ids.indexOf(lotId)
      if (a !== -1 && b !== -1) {
        const [lo, hi] = a < b ? [a, b] : [b, a]
        const rangeIds = ids.slice(lo, hi + 1)
        setSelected(prev => {
          const next = new Set(prev)
          rangeIds.forEach(id => next.add(id))
          return next
        })
        setLastClicked(lotId)
        return
      }
    }
    setSelected(prev => {
      const next = new Set(prev)
      next.has(lotId) ? next.delete(lotId) : next.add(lotId)
      return next
    })
    setLastClicked(lotId)
  }

  function selectAll() { setSelected(new Set(tda.lots.map(l => l.lot_id))) }
  function clearSelection() { setSelected(new Set()) }

  async function handleRemove() {
    await onRemoveLots(tda.tda_id, [...selected])
    setSelected(new Set())
    setConfirmRemove(false)
  }

  async function handleMove() {
    if (!moveTarget) return
    await onMoveLots(tda.tda_id, [...selected], Number(moveTarget))
    setSelected(new Set())
    setMoveTarget('')
  }

  async function handleAdd() {
    if (addSelected.size === 0) return
    await onAddLots(tda.tda_id, [...addSelected])
    setAddSelected(new Set())
    setShowAdd(false)
    setAddSearch('')
  }

  const filteredUnassigned = unassignedLots.filter(l =>
    !addSearch || (l.lot_number ?? '').toLowerCase().includes(addSearch.toLowerCase())
  )

  const nSel = selected.size

  return (
    <div style={{ padding: '10px 16px', borderTop: `1px solid ${PANEL_BORDER}` }}>
      {/* Header row */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
        <span style={{ fontSize: 11, fontWeight: 600, color: TEXT_MUTED }}>
          LOTS <span style={{ fontWeight: 400 }}>({tda.lots.length})</span>
        </span>
        {tda.lots.length > 0 && (
          <>
            <button onClick={selectAll} style={{ fontSize: 11, color: '#2563eb', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>
              All
            </button>
            <button onClick={clearSelection} style={{ fontSize: 11, color: TEXT_MUTED, background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>
              None
            </button>
          </>
        )}

        {/* CP legend */}
        {tda.checkpoints.length > 0 && (
          <span style={{ display: 'flex', gap: 8, marginLeft: 4 }}>
            {tda.checkpoints.map((cp, i) => (
              <span key={cp.checkpoint_id} style={{ display: 'flex', alignItems: 'center', gap: 3, fontSize: 10, color: TEXT_MUTED }}>
                <span style={{ width: 7, height: 7, borderRadius: '50%', background: CP_COLORS[i % CP_COLORS.length] }} />
                {cp.checkpoint_date ? cp.checkpoint_date.slice(0, 7) : `CP${i+1}`}
              </span>
            ))}
          </span>
        )}

        <span style={{ marginLeft: 'auto' }} />

        {!showAdd && unassignedLots.length > 0 && (
          <button
            onClick={() => { setShowAdd(true); setAddSelected(new Set()) }}
            style={{ fontSize: 11, color: '#2563eb', background: 'none', border: 'none', cursor: 'pointer', padding: 0, fontWeight: 500 }}
          >
            + Add Lots
          </button>
        )}
      </div>

      {/* Pill grid */}
      {tda.lots.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginBottom: 8 }}>
          {tda.lots.map(lot => (
            <LotPill
              key={lot.lot_id}
              lot={lot}
              selected={selected.has(lot.lot_id)}
              onToggle={e => toggleLot(lot.lot_id, e.shiftKey)}
              cpColor={lot.checkpoint_id ? cpColorMap[lot.checkpoint_id] : '#e5e7eb'}
            />
          ))}
        </div>
      )}

      {tda.lots.length === 0 && !showAdd && (
        <p style={{ fontSize: 12, color: TEXT_MUTED, margin: '0 0 6px' }}>No lots in this agreement.</p>
      )}

      {/* Action bar (shows when lots are selected) */}
      {nSel > 0 && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px',
          background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: 6, marginBottom: 8,
        }}>
          <span style={{ fontSize: 11, fontWeight: 600, color: '#1d4ed8' }}>{nSel} selected</span>

          {otherTdas.length > 0 && (
            <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <span style={{ fontSize: 11, color: TEXT_MUTED }}>Move to:</span>
              <select
                value={moveTarget}
                onChange={e => setMoveTarget(e.target.value)}
                style={{
                  fontSize: 11, padding: '2px 6px', borderRadius: 4,
                  border: '1px solid #d1d5db', background: '#fff', color: TEXT_PRIMARY,
                  maxWidth: 200,
                }}
              >
                <option value="">— select agreement —</option>
                {otherTdas.map(t => (
                  <option key={t.tda_id} value={t.tda_id}>{t.tda_name}</option>
                ))}
              </select>
              <Btn variant="primary" onClick={handleMove} disabled={!moveTarget} style={{ padding: '2px 8px', fontSize: 11 }}>
                Move
              </Btn>
            </span>
          )}

          {confirmRemove ? (
            <span style={{ display: 'inline-flex', gap: 4, alignItems: 'center', marginLeft: 'auto' }}>
              <span style={{ fontSize: 11, color: '#dc2626' }}>Remove {nSel} lots?</span>
              <Btn variant="danger" onClick={handleRemove} style={{ padding: '2px 6px', fontSize: 11 }}>Yes</Btn>
              <Btn onClick={() => setConfirmRemove(false)} style={{ padding: '2px 6px', fontSize: 11 }}>No</Btn>
            </span>
          ) : (
            <Btn variant="danger" onClick={() => setConfirmRemove(true)} style={{ padding: '2px 6px', fontSize: 11, marginLeft: 'auto' }}>
              Remove
            </Btn>
          )}
        </div>
      )}

      {/* Add-lots panel */}
      {showAdd && (
        <div style={{
          marginTop: 6, padding: 10, border: `1px solid ${PANEL_BORDER}`, borderRadius: 4, background: '#f9fafb',
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: TEXT_PRIMARY }}>Add lots to agreement</span>
            <button onClick={() => { setShowAdd(false); setAddSelected(new Set()); setAddSearch('') }}
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
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, maxHeight: 140, overflowY: 'auto', marginBottom: 8 }}>
            {filteredUnassigned.length === 0 && (
              <p style={{ fontSize: 12, color: TEXT_MUTED, margin: 0 }}>No lots match.</p>
            )}
            {filteredUnassigned.map(lot => (
              <div
                key={lot.lot_id}
                onClick={() => setAddSelected(prev => {
                  const next = new Set(prev)
                  next.has(lot.lot_id) ? next.delete(lot.lot_id) : next.add(lot.lot_id)
                  return next
                })}
                style={{
                  padding: '3px 8px', borderRadius: 12, fontSize: 11, fontFamily: 'monospace',
                  cursor: 'pointer', userSelect: 'none',
                  border: `1.5px solid ${addSelected.has(lot.lot_id) ? '#2563eb' : '#d1d5db'}`,
                  background: addSelected.has(lot.lot_id) ? '#eff6ff' : '#fff',
                  color: addSelected.has(lot.lot_id) ? '#1d4ed8' : TEXT_PRIMARY,
                  fontWeight: addSelected.has(lot.lot_id) ? 700 : 400,
                }}
              >
                {lot.lot_number.replace(/^[A-Z]+0*/, '')}
              </div>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <Btn variant="primary" onClick={handleAdd} disabled={addSelected.size === 0}>
              Add {addSelected.size > 0 ? addSelected.size : ''} {addSelected.size === 1 ? 'lot' : 'lots'}
            </Btn>
            <button
              onClick={() => setAddSelected(new Set(filteredUnassigned.map(l => l.lot_id)))}
              style={{ fontSize: 11, color: '#2563eb', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
            >
              Select all
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Agreement card ─────────────────────────────────────────────────
function AgreementCard({ tda, allTdas, unassignedLots, onPatch, onAddCheckpoint, onPatchCheckpoint, onDeleteCheckpoint, onAddLots, onRemoveLots, onMoveLots, onEditLotDates, onAutoAssign }) {
  const ss = AGREEMENT_STATUS_STYLE[tda.status] || AGREEMENT_STATUS_STYLE.active

  return (
    <div style={{ border: `1px solid ${PANEL_BORDER}`, borderRadius: 6, background: '#fff', overflow: 'hidden' }}>
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
        onAutoAssign={onAutoAssign}
      />

      <LotsSection
        tda={tda}
        allTdas={allTdas}
        unassignedLots={unassignedLots}
        onAddLots={onAddLots}
        onRemoveLots={onRemoveLots}
        onMoveLots={onMoveLots}
        onEditLotDates={onEditLotDates}
      />
    </div>
  )
}

// ── Monthly ledger tab ─────────────────────────────────────────────
function LedgerTab({ selectedId }) {
  const [ledger, setLedger] = useState(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!selectedId) return
    setLoading(true)
    fetch(`${API_BASE}/entitlement-groups/${selectedId}/tda-monthly-ledger`)
      .then(r => r.json())
      .then(d => { setLedger(d.ledger || []); setLoading(false) })
      .catch(() => setLoading(false))
  }, [selectedId])

  if (!selectedId) return <p style={{ color: TEXT_MUTED, fontSize: 14, marginTop: 20 }}>Select a community.</p>
  if (loading)     return <p style={{ color: TEXT_MUTED, fontSize: 14, marginTop: 20 }}>Loading…</p>
  if (!ledger)     return null
  if (ledger.length === 0) return <p style={{ color: TEXT_MUTED, fontSize: 14 }}>No TDA lots with scheduled dates.</p>

  const thS = { ...TH, background: '#f9fafb', position: 'sticky', top: 0 }

  let cumActual = 0, cumMarks = 0, cumSim = 0
  const rows = ledger.map(r => {
    cumActual += r.actual || 0
    cumMarks  += r.marks_plan || 0
    cumSim    += r.sim_plan || 0
    return { ...r, cumActual, cumMarks, cumSim }
  })

  const today = new Date().toISOString().slice(0, 7)

  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ borderCollapse: 'collapse', fontSize: 12, width: '100%' }}>
        <thead>
          <tr>
            <th style={{ ...thS, minWidth: 80 }}>Month</th>
            <th style={{ ...thS, textAlign: 'right' }} title="Lots with actual MARKS date_td in this month and in the past">Taken Down</th>
            <th style={{ ...thS, textAlign: 'right' }} title="Lots with MARKS date_td in this month">MARKS Plan</th>
            <th style={{ ...thS, textAlign: 'right' }} title="Lots with sim projected date_td in this month (no MARKS date)">Sim Plan</th>
            <th style={{ ...thS, textAlign: 'right' }}>Cum. Taken</th>
            <th style={{ ...thS, textAlign: 'right' }}>Cum. MARKS</th>
            <th style={{ ...thS, textAlign: 'right' }}>Cum. Sim</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(r => {
            const isPast = r.month < today
            const isCurrent = r.month === today
            return (
              <tr key={r.month} style={{
                borderBottom: `1px solid ${PANEL_BORDER}`,
                background: isCurrent ? '#fffbeb' : isPast ? '#f9fafb' : '#fff',
              }}>
                <td style={{ ...TD, fontFamily: 'monospace', fontWeight: isCurrent ? 700 : 400 }}>{r.month}</td>
                <td style={{ ...TD, textAlign: 'right', color: r.actual > 0 ? '#15803d' : TEXT_MUTED, fontWeight: r.actual > 0 ? 600 : 400 }}>{r.actual || '—'}</td>
                <td style={{ ...TD, textAlign: 'right', color: TEXT_MUTED }}>{r.marks_plan || '—'}</td>
                <td style={{ ...TD, textAlign: 'right', color: '#2563eb' }}>{r.sim_plan || '—'}</td>
                <td style={{ ...TD, textAlign: 'right', color: TEXT_MUTED, fontVariantNumeric: 'tabular-nums' }}>{r.cumActual}</td>
                <td style={{ ...TD, textAlign: 'right', color: TEXT_MUTED, fontVariantNumeric: 'tabular-nums' }}>{r.cumMarks}</td>
                <td style={{ ...TD, textAlign: 'right', color: '#2563eb', fontVariantNumeric: 'tabular-nums' }}>{r.cumSim}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

// ── Override popover ───────────────────────────────────────────────
function OverridePanel({ lot, dateField, onClose, onApplied }) {
  const [draft, setDraft]           = useState('')
  const [preview, setPreview]       = useState(null)
  const [applyGroup, setApplyGroup] = useState(false)
  const [applying, setApplying]     = useState(false)
  const [error, setError]           = useState('')
  const inputRef = useRef()

  useEffect(() => { if (inputRef.current) inputRef.current.focus() }, [])

  async function loadPreview(val) {
    if (!val) { setPreview(null); return }
    try {
      const r = await fetch(`${API_BASE}/overrides/preview`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lot_id: lot.lot_id, date_field: dateField, override_value: val }),
      })
      if (!r.ok) return
      setPreview(await r.json())
    } catch { /* ignore */ }
  }

  async function handleApply() {
    if (!draft || !preview) return
    setApplying(true); setError('')
    try {
      const changes = [
        { date_field: dateField, override_value: draft },
        ...preview.cascade
          .filter(c => c.proposed_value)
          .map(c => ({ date_field: c.date_field, override_value: c.proposed_value })),
      ]
      const r = await fetch(`${API_BASE}/overrides/apply`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lot_id: lot.lot_id, changes, apply_to_building_group: applyGroup }),
      })
      if (!r.ok) { setError('Apply failed'); setApplying(false); return }
      onApplied()
    } catch { setError('Apply failed'); setApplying(false) }
  }

  const _LABEL = { date_td_hold: 'HC', date_td: 'BLDR', date_str: 'DIG', date_frm: 'FRM', date_cmp: 'CMP', date_cls: 'CLS' }

  return (
    <div style={{
      marginTop: 6, padding: 12, border: `1px solid ${PANEL_BORDER}`, borderRadius: 6,
      background: '#f9fafb', position: 'relative',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <span style={{ fontSize: 12, fontWeight: 600, color: TEXT_PRIMARY }}>
          Set {_LABEL[dateField] || dateField} override — <span style={{ fontFamily: 'monospace' }}>{lot.lot_number}</span>
        </span>
        <button onClick={onClose} style={{ fontSize: 14, color: TEXT_MUTED, background: 'none', border: 'none', cursor: 'pointer' }}>×</button>
      </div>

      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 }}>
        <input
          ref={inputRef}
          type="date"
          value={draft}
          onChange={e => { setDraft(e.target.value); loadPreview(e.target.value) }}
          style={{ fontSize: 12, padding: '3px 6px', borderRadius: 4, border: '1px solid #d1d5db', ...greenEditorStyle }}
        />
        {lot.building_group_id && (
          <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, color: TEXT_PRIMARY, cursor: 'pointer' }}>
            <input type="checkbox" checked={applyGroup} onChange={e => setApplyGroup(e.target.checked)} />
            Apply to all units in building group
          </label>
        )}
      </div>

      {preview && (
        <div style={{ marginBottom: 8 }}>
          <div style={{ fontSize: 11, color: TEXT_MUTED, marginBottom: 4, fontWeight: 600 }}>CASCADE PREVIEW</div>
          <table style={{ fontSize: 11, borderCollapse: 'collapse', width: '100%' }}>
            <thead>
              <tr>
                {['Field', 'Current', 'Proposed'].map(h => (
                  <th key={h} style={{ ...TH, fontSize: 10, padding: '2px 6px' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              <tr style={{ background: '#eff6ff' }}>
                <td style={{ ...TD, padding: '2px 6px', fontWeight: 600 }}>{_LABEL[dateField]}</td>
                <td style={{ ...TD, padding: '2px 6px', color: TEXT_MUTED }}>{preview.current_value || '—'}</td>
                <td style={{ ...TD, padding: '2px 6px', color: '#2563eb', fontWeight: 600 }}>{draft}</td>
              </tr>
              {preview.cascade.filter(c => c.proposed_value).map(c => (
                <tr key={c.date_field} style={{ borderTop: `1px solid ${PANEL_BORDER}` }}>
                  <td style={{ ...TD, padding: '2px 6px' }}>{c.label}</td>
                  <td style={{ ...TD, padding: '2px 6px', color: TEXT_MUTED }}>{c.current_value || '—'}</td>
                  <td style={{ ...TD, padding: '2px 6px', color: c.source === 'shifted' ? TEXT_PRIMARY : '#9ca3af' }}>
                    {c.proposed_value}
                    {c.delta_days !== null && c.delta_days !== undefined &&
                      <span style={{ color: TEXT_MUTED, marginLeft: 4 }}>({c.delta_days > 0 ? '+' : ''}{c.delta_days}d)</span>
                    }
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {error && <div style={{ fontSize: 11, color: '#dc2626', marginBottom: 6 }}>{error}</div>}

      <div style={{ display: 'flex', gap: 6 }}>
        <Btn variant="primary" onClick={handleApply} disabled={!draft || !preview || applying}>
          {applying ? 'Applying…' : 'Apply Override'}
        </Btn>
        <Btn onClick={onClose}>Cancel</Btn>
      </div>
    </div>
  )
}

// ── Lots tab ───────────────────────────────────────────────────────
function LotsTab({ selectedId, data, onReload }) {
  const [overrideMap, setOverrideMap] = useState({})
  const [activeOverride, setActiveOverride] = useState(null)
  const [clearConfirm, setClearConfirm] = useState(null)

  useEffect(() => {
    if (!selectedId) return
    fetch(`${API_BASE}/overrides?ent_group_id=${selectedId}`)
      .then(r => r.json())
      .then(rows => {
        const map = {}
        for (const r of rows) {
          if (!map[r.lot_id]) map[r.lot_id] = {}
          map[r.lot_id][r.date_field] = r.override_value
        }
        setOverrideMap(map)
      })
      .catch(() => {})
  }, [selectedId, data])

  if (!selectedId) return <p style={{ color: TEXT_MUTED, fontSize: 14, marginTop: 20 }}>Select a community.</p>
  if (!data) return null

  const lotMap = new Map()
  for (const tda of (data.agreements || [])) {
    for (const lot of (tda.lots || [])) {
      if (!lotMap.has(lot.lot_id)) {
        lotMap.set(lot.lot_id, { ...lot, tda_name: tda.tda_name, tda_id: tda.tda_id })
      }
    }
  }
  const lots = [...lotMap.values()].sort((a, b) => (a.lot_number ?? '').localeCompare(b.lot_number ?? ''))

  if (lots.length === 0) {
    return <p style={{ color: TEXT_MUTED, fontSize: 14 }}>No lots in any agreement for this community.</p>
  }

  async function handleClearAll(lotId) {
    await fetch(`${API_BASE}/overrides/clear-batch`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ lot_ids: [lotId] }),
    })
    setClearConfirm(null)
    onReload()
  }

  const thS = { ...TH, background: '#f9fafb', position: 'sticky', top: 0, zIndex: 1 }

  function dateCell(lot, field, label, marksKey, projKey) {
    const overrides = overrideMap[lot.lot_id] || {}
    const overrideVal = overrides[field]
    const marksVal = lot[marksKey]
    const projVal = lot[projKey]
    const isActive = activeOverride?.lot_id === lot.lot_id && activeOverride?.date_field === field

    const displayVal = marksVal || overrideVal || projVal
    const isOverride = !!overrideVal && !marksVal

    return (
      <td key={field} style={TD}>
        {marksVal ? (
          <span style={{ fontSize: 11, color: TEXT_MUTED, fontStyle: 'italic' }}>{marksVal}</span>
        ) : (
          <span
            onClick={() => setActiveOverride(isActive ? null : { lot_id: lot.lot_id, date_field: field })}
            style={{
              fontSize: 11, cursor: 'pointer',
              color: isOverride ? '#2563eb' : (displayVal ? TEXT_PRIMARY : TEXT_MUTED),
              fontStyle: isOverride ? 'italic' : 'normal',
              borderBottom: '1px dashed ' + (isActive ? '#2563eb' : '#d1d5db'),
            }}
            title={isOverride ? `Override: ${overrideVal}` : 'Click to set override'}
          >
            {displayVal || '—'}
          </span>
        )}
      </td>
    )
  }

  return (
    <div>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ borderCollapse: 'collapse', fontSize: 12, width: '100%' }}>
          <thead>
            <tr>
              <th style={{ ...thS, minWidth: 90 }}>Lot</th>
              <th style={thS}>Type</th>
              <th style={thS}>Bldg</th>
              <th style={thS}>Agreement</th>
              <th style={thS}>Checkpoint</th>
              <th style={{ ...thS, color: '#0d9488' }}>HC</th>
              <th style={{ ...thS, color: '#0d9488' }}>BLDR</th>
              <th style={{ ...thS, color: '#0d9488' }}>DIG</th>
              <th style={thS}></th>
            </tr>
          </thead>
          <tbody>
            {lots.map(lot => {
              const hasOverrides = Object.keys(overrideMap[lot.lot_id] || {}).length > 0
              const isAnyActive = activeOverride?.lot_id === lot.lot_id
              return (
                <>
                  <tr key={lot.lot_id} style={{
                    borderBottom: isAnyActive ? 'none' : `1px solid ${PANEL_BORDER}`,
                    background: isAnyActive ? '#f0f9ff' : (hasOverrides ? '#fefce8' : '#fff'),
                  }}>
                    <td style={{ ...TD, fontFamily: 'monospace', fontWeight: 500 }}>{lot.lot_number}</td>
                    <td style={{ ...TD, color: TEXT_MUTED }}>{lot.lot_type_short || '—'}</td>
                    <td style={{ ...TD, color: TEXT_MUTED }}>
                      {lot.building_name ? lot.building_name.replace('Building ', 'B') : '—'}
                    </td>
                    <td style={{ ...TD, fontSize: 11, color: TEXT_MUTED }}>{lot.tda_name}</td>
                    <td style={{ ...TD, fontSize: 11, color: lot.checkpoint_id ? TEXT_PRIMARY : TEXT_MUTED }}>
                      {lot.checkpoint_id
                        ? cpLabel({ lots_required_cumulative: lot.lots_required_cumulative, checkpoint_date: lot.checkpoint_date, checkpoint_number: lot.checkpoint_number })
                        : 'Unassigned'}
                    </td>

                    {dateCell(lot, 'date_td_hold', 'HC', 'hc_marks_date', 'hc_projected_date')}
                    {dateCell(lot, 'date_td', 'BLDR', 'bldr_marks_date', 'bldr_projected_date')}
                    <td style={TD}><span style={{ fontSize: 11, color: TEXT_MUTED }}>—</span></td>

                    <td style={{ ...TD, textAlign: 'right' }}>
                      {hasOverrides && (
                        clearConfirm === lot.lot_id ? (
                          <span style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}>
                            <span style={{ fontSize: 10, color: '#dc2626' }}>Clear all overrides?</span>
                            <Btn variant="danger" style={{ padding: '1px 6px', fontSize: 10 }}
                              onClick={() => handleClearAll(lot.lot_id)}>Yes</Btn>
                            <Btn style={{ padding: '1px 6px', fontSize: 10 }}
                              onClick={() => setClearConfirm(null)}>No</Btn>
                          </span>
                        ) : (
                          <button onClick={() => setClearConfirm(lot.lot_id)}
                            style={{ fontSize: 11, color: '#dc2626', background: 'none', border: 'none', cursor: 'pointer', padding: '1px 4px' }}
                            title="Clear all user overrides for this lot">
                            Clear All
                          </button>
                        )
                      )}
                    </td>
                  </tr>

                  {isAnyActive && (
                    <tr key={`${lot.lot_id}_panel`} style={{ borderBottom: `1px solid ${PANEL_BORDER}` }}>
                      <td colSpan={9} style={{ padding: '0 12px 8px' }}>
                        <OverridePanel
                          lot={lot}
                          dateField={activeOverride.date_field}
                          onClose={() => setActiveOverride(null)}
                          onApplied={() => { setActiveOverride(null); onReload() }}
                        />
                      </td>
                    </tr>
                  )}
                </>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ── Checklist tab ──────────────────────────────────────────────────
const CHECKLIST_COLORS = [
  '#f59e0b', '#3b82f6', '#8b5cf6', '#ec4899',
  '#ef4444', '#10b981', '#f97316', '#06b6d4',
  '#84cc16', '#6366f1',
]

function ChecklistTab({ showTestCommunities }) {
  const [items, setItems]             = useState(null)
  const [loading, setLoading]         = useState(false)
  const [filter, setFilter]           = useState('all')
  const [collapsed, setCollapsed]     = useState({})
  const [activeOverride, setActiveOverride] = useState(null)

  const reload = useCallback(() => {
    setLoading(true)
    const q = showTestCommunities ? 'show_test=true' : 'show_test=false'
    fetch(`${API_BASE}/tda-checklist?${q}`)
      .then(r => r.json())
      .then(d => { setItems(d.items || []); setLoading(false) })
      .catch(() => setLoading(false))
  }, [showTestCommunities])

  useEffect(() => { reload() }, [reload])

  if (loading) return <p style={{ color: TEXT_MUTED, fontSize: 14, marginTop: 20 }}>Loading checklist…</p>
  if (!items)  return null

  const allEgIds = [...new Set(items.map(i => i.ent_group_id))]
  const colorMap = {}
  allEgIds.forEach((id, idx) => { colorMap[id] = CHECKLIST_COLORS[idx % CHECKLIST_COLORS.length] })

  const filtered = filter === 'all' ? items
    : filter === 'closed' ? items.filter(i => i.status === 'closed')
    : items.filter(i => i.status !== 'closed')

  const monthGroups = new Map()
  for (const item of filtered) {
    const monthKey = item.checkpoint_date ? item.checkpoint_date.slice(0, 7) : 'no-date'
    if (!monthGroups.has(monthKey)) monthGroups.set(monthKey, new Map())
    const cg = monthGroups.get(monthKey)
    if (!cg.has(item.ent_group_id)) {
      cg.set(item.ent_group_id, {
        ent_group_id: item.ent_group_id,
        ent_group_name: item.ent_group_name,
        checkpoint_date: item.checkpoint_date,
        lots_required_cumulative: item.lots_required_cumulative,
        items: [],
      })
    }
    cg.get(item.ent_group_id).items.push(item)
  }

  function toggleCollapse(key) {
    setCollapsed(prev => ({ ...prev, [key]: !prev[key] }))
  }

  function monthLabel(key) {
    if (key === 'no-date') return 'No Deadline'
    const [y, m] = key.split('-')
    return new Date(Number(y), Number(m) - 1, 1).toLocaleString('en-US', { month: 'long', year: 'numeric' })
  }

  const visibleEgIds = new Set(filtered.map(i => i.ent_group_id))

  return (
    <div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 16, alignItems: 'center' }}>
        <span style={{ fontSize: 11, color: TEXT_MUTED, fontWeight: 600, marginRight: 2 }}>SHOW</span>
        {['all', 'open', 'closed'].map(f => (
          <button key={f} onClick={() => setFilter(f)} style={{
            fontSize: 11, padding: '3px 12px', borderRadius: 12,
            border: `1px solid ${filter === f ? '#2563eb' : '#d1d5db'}`,
            background: filter === f ? '#eff6ff' : '#fff',
            color: filter === f ? '#2563eb' : TEXT_MUTED,
            cursor: 'pointer', fontWeight: filter === f ? 600 : 400,
          }}>
            {f.charAt(0).toUpperCase() + f.slice(1)}
          </button>
        ))}
        <span style={{ marginLeft: 'auto', fontSize: 11, color: TEXT_MUTED }}>
          {filtered.length} lots · {visibleEgIds.size} communities
        </span>
      </div>

      {filtered.length === 0 && (
        <p style={{ color: TEXT_MUTED, fontSize: 14 }}>No items match the current filter.</p>
      )}

      {[...monthGroups.entries()].map(([monthKey, commGroup]) => {
        const monthCollapsed = collapsed[monthKey]
        const monthTotal  = [...commGroup.values()].reduce((s, g) => s + g.items.length, 0)
        const monthClosed = [...commGroup.values()].reduce((s, g) => s + g.items.filter(i => i.status === 'closed').length, 0)

        return (
          <div key={monthKey} style={{ marginBottom: 20 }}>
            <div
              onClick={() => toggleCollapse(monthKey)}
              style={{
                display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer',
                padding: '7px 14px', background: '#1e293b', borderRadius: 5,
                marginBottom: monthCollapsed ? 0 : 10,
              }}
            >
              <span style={{ fontSize: 13, fontWeight: 700, color: '#fff' }}>{monthLabel(monthKey)}</span>
              <span style={{ fontSize: 11, color: '#94a3b8', marginLeft: 'auto' }}>
                {monthClosed}/{monthTotal} closed
              </span>
              <span style={{ fontSize: 10, color: '#64748b', marginLeft: 4 }}>{monthCollapsed ? '▶' : '▼'}</span>
            </div>

            {!monthCollapsed && (
              <div style={{ paddingLeft: 8 }}>
                {[...commGroup.values()].map(group => {
                  const groupKey     = `${monthKey}_${group.ent_group_id}`
                  const groupCollapsed = collapsed[groupKey]
                  const color        = colorMap[group.ent_group_id] || '#6b7280'
                  const closedCount  = group.items.filter(i => i.status === 'closed').length
                  const totalCount   = group.items.length
                  const req          = group.lots_required_cumulative || 0
                  const reqMet       = req > 0 && closedCount >= req

                  return (
                    <div key={groupKey} style={{ marginBottom: 6 }}>
                      <div
                        onClick={() => toggleCollapse(groupKey)}
                        style={{
                          display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer',
                          padding: '5px 10px',
                          background: color + '22',
                          borderLeft: `4px solid ${color}`,
                          borderRadius: '0 4px 4px 0',
                          marginBottom: groupCollapsed ? 0 : 2,
                        }}
                      >
                        <span style={{ fontSize: 12, fontWeight: 700, color: '#1e293b' }}>
                          {group.ent_group_name}
                        </span>
                        <span style={{ fontSize: 10, color: TEXT_MUTED }}>
                          {closedCount} of {totalCount} closed
                        </span>
                        {req > 0 && (
                          <span style={{
                            fontSize: 10, padding: '1px 7px', borderRadius: 8, fontWeight: 600,
                            background: reqMet ? '#f0fdf4' : '#fef2f2',
                            color: reqMet ? '#15803d' : '#dc2626',
                            border: `1px solid ${reqMet ? '#bbf7d0' : '#fecaca'}`,
                          }}>
                            {closedCount}/{req} req
                          </span>
                        )}
                        <span style={{ fontSize: 10, color: TEXT_MUTED, marginLeft: 'auto' }}>
                          {groupCollapsed ? '▶' : '▼'}
                        </span>
                      </div>

                      {!groupCollapsed && (
                        <div>
                          {group.items.map(item => {
                            const isClosed = item.status === 'closed'
                            const isOverrideActive = activeOverride?.lot_id === item.lot_id

                            return (
                              <div key={item.lot_id}>
                                <div style={{
                                  display: 'flex', alignItems: 'center', gap: 8,
                                  padding: '4px 10px 4px 12px',
                                  borderLeft: `4px solid ${color}44`,
                                  background: isClosed ? '#f0fdf4' : (item.status === 'projected' ? '#f0f9ff' : '#fff'),
                                  borderBottom: `1px solid ${PANEL_BORDER}`,
                                }}>
                                  <span style={{ fontSize: 13, width: 16, textAlign: 'center', flexShrink: 0,
                                    color: isClosed ? '#16a34a' : '#d1d5db' }}>
                                    {isClosed ? '✓' : '○'}
                                  </span>
                                  <span style={{ fontFamily: 'monospace', fontSize: 11, color: TEXT_PRIMARY, minWidth: 80 }}>
                                    {item.lot_number}
                                  </span>
                                  {item.lot_type_short && (
                                    <span style={{ fontSize: 10, color: TEXT_MUTED, minWidth: 32 }}>
                                      {item.lot_type_short}
                                    </span>
                                  )}
                                  {item.building_name && (
                                    <span style={{ fontSize: 10, color: TEXT_MUTED, fontFamily: 'monospace' }}>
                                      {item.building_name.replace('Building ', 'B')}
                                    </span>
                                  )}
                                  <span style={{ marginLeft: 'auto', fontSize: 11 }}>
                                    {isClosed ? (
                                      <span style={{ color: '#16a34a', fontStyle: 'italic' }}>{item.display_date}</span>
                                    ) : item.display_date ? (
                                      <span
                                        onClick={() => setActiveOverride(isOverrideActive ? null : { lot_id: item.lot_id, date_field: 'date_td', lot: item })}
                                        style={{ color: '#2563eb', cursor: 'pointer', borderBottom: '1px dashed #93c5fd' }}
                                        title="Click to set override"
                                      >
                                        {item.display_date}
                                      </span>
                                    ) : (
                                      <span
                                        onClick={() => setActiveOverride(isOverrideActive ? null : { lot_id: item.lot_id, date_field: 'date_td', lot: item })}
                                        style={{ color: TEXT_MUTED, cursor: 'pointer', borderBottom: '1px dashed #e5e7eb' }}
                                        title="Click to set takedown override"
                                      >
                                        —
                                      </span>
                                    )}
                                  </span>
                                </div>

                                {isOverrideActive && (
                                  <div style={{ borderLeft: `4px solid ${color}44`, padding: '0 12px 8px' }}>
                                    <OverridePanel
                                      lot={activeOverride.lot}
                                      dateField={activeOverride.date_field}
                                      onClose={() => setActiveOverride(null)}
                                      onApplied={() => { setActiveOverride(null); reload() }}
                                    />
                                  </div>
                                )}
                              </div>
                            )
                          })}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

// ── TDA pill tabs ──────────────────────────────────────────────────
function TdaPillTabs({ agreements, activeId, onSelect }) {
  if (!agreements || agreements.length === 0) return null
  return (
    <div style={{
      display: 'flex', flexWrap: 'wrap', gap: 6, padding: '10px 0 12px',
    }}>
      {agreements.map(tda => {
        const isActive = tda.tda_id === activeId
        const ss = AGREEMENT_STATUS_STYLE[tda.status] || AGREEMENT_STATUS_STYLE.active
        const nLots = tda.lots?.length ?? 0
        return (
          <button
            key={tda.tda_id}
            onClick={() => onSelect(tda.tda_id)}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 6,
              padding: '5px 12px', borderRadius: 20,
              border: `1.5px solid ${isActive ? '#2563eb' : '#d1d5db'}`,
              background: isActive ? '#eff6ff' : '#fff',
              color: isActive ? '#1d4ed8' : TEXT_PRIMARY,
              fontWeight: isActive ? 700 : 500,
              fontSize: 12, cursor: 'pointer',
              boxShadow: isActive ? '0 1px 3px rgba(37,99,235,0.15)' : 'none',
            }}
          >
            {tda.tda_name}
            <span style={{
              fontSize: 10, padding: '1px 6px', borderRadius: 8, fontWeight: 600,
              background: ss.bg, color: ss.color, border: `1px solid ${ss.border}`,
            }}>
              {tda.status}
            </span>
            {nLots > 0 && (
              <span style={{ fontSize: 10, color: isActive ? '#3b82f6' : TEXT_MUTED }}>
                {nLots}
              </span>
            )}
          </button>
        )
      })}
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
  const [activeTab, setActiveTab] = useState('agreements')
  const [activeTdaId, setActiveTdaId] = useState(null)   // which TDA pill is active
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
      .then(d => {
        setData(d)
        setLoading(false)
        // Auto-select first active TDA if none selected or current one is gone
        setActiveTdaId(prev => {
          const agreements = d.agreements || []
          if (!prev || !agreements.find(a => a.tda_id === prev)) {
            const first = agreements.find(a => a.status === 'active') || agreements[0]
            return first?.tda_id ?? null
          }
          return prev
        })
      })
      .catch(() => setLoading(false))
  }, [selectedId])

  useEffect(() => { load() }, [load])

  // Reset active TDA when community changes
  useEffect(() => { setActiveTdaId(null) }, [selectedId])

  // ── Mutations ──────────────────────────────────────────────────────

  async function createAgreement() {
    const name = newName.trim()
    if (!name || !selectedId) return
    const resp = await fetch(`${API_BASE}/takedown-agreements`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tda_name: name, ent_group_id: selectedId }),
    })
    const created = await resp.json()
    setNewName(''); setShowNewForm(false)
    setActiveTdaId(created.tda_id)
    load()
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

  async function autoAssign(tdaId) {
    await fetch(`${API_BASE}/takedown-agreements/${tdaId}/auto-assign`, { method: 'POST' })
    load()
  }

  async function addLots(tdaId, lotIds) {
    await Promise.all(lotIds.map(id =>
      fetch(`${API_BASE}/takedown-agreements/${tdaId}/lots/${id}/pool`, { method: 'POST' })
    ))
    load()
  }

  async function removeLots(tdaId, lotIds) {
    await Promise.all(lotIds.map(id =>
      fetch(`${API_BASE}/takedown-agreements/${tdaId}/lots/${id}/pool`, { method: 'DELETE' })
    ))
    load()
  }

  async function moveLots(fromTdaId, lotIds, targetTdaId) {
    await fetch(`${API_BASE}/takedown-agreements/${fromTdaId}/lots/move`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ lot_ids: lotIds, target_tda_id: targetTdaId }),
    })
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

  // ── Tab header style ───────────────────────────────────────────────
  function tabStyle(tab) {
    const active = tab === activeTab
    return {
      padding: '6px 16px', fontSize: 12, fontWeight: active ? 700 : 500, cursor: 'pointer',
      background: 'none', border: 'none',
      borderBottom: active ? '2px solid #2563eb' : '2px solid transparent',
      color: active ? '#2563eb' : TEXT_MUTED,
    }
  }

  // Active TDA object
  const activeTda = data?.agreements?.find(a => a.tda_id === activeTdaId)

  // ── Render ─────────────────────────────────────────────────────────
  return (
    <div style={{ display: 'flex', height: 'calc(100vh - 44px)', overflow: 'hidden' }}>

      {/* ── Left sidebar ── */}
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
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', background: '#f9fafb' }}>

        {/* Tab bar */}
        <div style={{ display: 'flex', borderBottom: `1px solid ${PANEL_BORDER}`, background: '#fff', flexShrink: 0 }}>
          <button style={tabStyle('agreements')} onClick={() => setActiveTab('agreements')}>Agreements</button>
          <button style={tabStyle('ledger')}     onClick={() => setActiveTab('ledger')}>Ledger</button>
          <button style={tabStyle('lots')}       onClick={() => setActiveTab('lots')}>Lots</button>
          <button style={tabStyle('checklist')}  onClick={() => setActiveTab('checklist')}>Checklist</button>
        </div>

        {/* Tab body */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '16px 24px' }}>

          {!selectedId && (
            <p style={{ color: TEXT_MUTED, fontSize: 14, marginTop: 20 }}>
              Select a community to view its takedown agreements.
            </p>
          )}

          {selectedId && loading && (
            <p style={{ color: TEXT_MUTED, fontSize: 14, marginTop: 20 }}>Loading…</p>
          )}

          {/* Agreements tab */}
          {activeTab === 'agreements' && selectedId && !loading && data && (
            <>
              {/* Pill tab row + New Agreement button */}
              <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
                <TdaPillTabs
                  agreements={data.agreements}
                  activeId={activeTdaId}
                  onSelect={setActiveTdaId}
                />
                <div style={{ paddingTop: 10 }}>
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
              </div>

              {data.agreements.length === 0 && (
                <p style={{ color: TEXT_MUTED, fontSize: 14 }}>No agreements yet for this community.</p>
              )}

              {activeTda && (
                <AgreementCard
                  key={activeTda.tda_id}
                  tda={activeTda}
                  allTdas={data.agreements}
                  unassignedLots={data.unassigned_lots || []}
                  onPatch={patch => patchAgreement(activeTda.tda_id, patch)}
                  onAddCheckpoint={addCheckpoint}
                  onPatchCheckpoint={patchCheckpoint}
                  onDeleteCheckpoint={deleteCheckpoint}
                  onAddLots={addLots}
                  onRemoveLots={removeLots}
                  onMoveLots={moveLots}
                  onEditLotDates={editLotDates}
                  onAutoAssign={autoAssign}
                />
              )}

              {data.agreements.length > 0 && !activeTda && (
                <p style={{ color: TEXT_MUTED, fontSize: 14 }}>Select an agreement above.</p>
              )}
            </>
          )}

          {/* Ledger tab */}
          {activeTab === 'ledger' && (
            <LedgerTab selectedId={selectedId} />
          )}

          {/* Lots tab */}
          {activeTab === 'lots' && selectedId && !loading && (
            <LotsTab selectedId={selectedId} data={data} onReload={load} />
          )}

          {/* Checklist tab */}
          {activeTab === 'checklist' && (
            <ChecklistTab showTestCommunities={showTestCommunities} />
          )}
        </div>
      </div>
    </div>
  )
}
