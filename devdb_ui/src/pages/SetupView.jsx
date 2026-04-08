// SetupView.jsx
// Hierarchical setup tree: Community → Development → Instrument → Phase → Lot Types

import { useState, useEffect, useRef } from 'react'
import { API_BASE } from '../config'

// ─── small helpers ───────────────────────────────────────────────────────────

function ChevronIcon({ open }) {
  return (
    <span style={{
      display: 'inline-block', width: 12, marginRight: 4,
      transition: 'transform 0.15s',
      transform: open ? 'rotate(90deg)' : 'rotate(0deg)',
      color: '#9ca3af', fontSize: 10, lineHeight: 1,
    }}>▶</span>
  )
}

// ─── editable integer cell ────────────────────────────────────────────────────

function EditableCount({ value, onSave, min = 0 }) {
  const [local, setLocal] = useState(String(value ?? 0))
  const [error, setError] = useState(false)
  const committed = useRef(value)

  useEffect(() => {
    if (value !== committed.current) {
      setLocal(String(value ?? 0))
      committed.current = value
    }
  }, [value])

  function commit() {
    const n = parseInt(local, 10)
    if (!isNaN(n) && n >= min) {
      setError(false)
      committed.current = n
      if (n !== (value ?? 0)) onSave(n)
    } else {
      setError(true)
      setTimeout(() => {
        setError(false)
        setLocal(String(value ?? 0))
      }, 600)
    }
  }

  return (
    <input
      type="number" min={min}
      value={local}
      onChange={e => setLocal(e.target.value)}
      onBlur={commit}
      onKeyDown={e => {
        if (e.key === 'Enter') { commit(); e.target.blur() }
        if (e.key === 'Escape') { setLocal(String(value ?? 0)); e.target.blur() }
      }}
      style={{
        width: 52, textAlign: 'right', fontSize: 12,
        padding: '1px 4px', borderRadius: 3,
        border: `1px solid ${error ? '#ef4444' : '#d1d5db'}`,
        background: error ? '#fef2f2' : undefined,
        transition: 'border-color 0.15s, background 0.15s',
      }}
    />
  )
}

// ─── lot pills ───────────────────────────────────────────────────────────────

const LOT_PILL = {
  marks: { bg: '#eff6ff', text: '#1d4ed8', border: '#bfdbfe' },
  pre:   { bg: '#fffbeb', text: '#92400e', border: '#fde68a' },
  sim:   { bg: '#f3f4f6', text: '#9ca3af', border: '#e5e7eb' },
}

// Resolve pill style from lot data: orphaned real (no registry match) → pre/amber
function pillStyle(lot) {
  if (lot.lot_source === 'sim') return LOT_PILL.sim
  if (lot.lot_source === 'real' && lot.in_registry) return LOT_PILL.marks
  return LOT_PILL.pre
}

function LotPill({ label, source }) {
  const s = LOT_PILL[source] ?? LOT_PILL.sim
  return (
    <span style={{
      display: 'inline-block',
      padding: '1px 7px', borderRadius: 10, fontSize: 11,
      background: s.bg, color: s.text,
      border: `1px solid ${s.border}`,
      whiteSpace: 'nowrap',
    }}>
      {label}
    </span>
  )
}

// Lot pill with an inline move-to-phase control
function MovableLotPill({ lot, targetPhases, onMoved }) {
  const [moving, setMoving] = useState(false)
  const [saving, setSaving] = useState(false)

  const s = pillStyle(lot)
  const label = lot.lot_number ?? `#${lot.lot_id}`

  async function handleSelect(e) {
    const targetPhaseId = parseInt(e.target.value, 10)
    if (!targetPhaseId) return
    setSaving(true)
    try {
      const res = await fetch(`${API_BASE}/lots/${lot.lot_id}/phase`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ target_phase_id: targetPhaseId, changed_by: 'setup' }),
      })
      if (res.ok) { setMoving(false); onMoved(lot.lot_id) }
    } finally {
      setSaving(false)
    }
  }

  if (moving) {
    return (
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}>
        <select
          autoFocus
          disabled={saving}
          defaultValue=""
          onChange={handleSelect}
          style={{
            fontSize: 11, padding: '1px 3px', borderRadius: 3,
            border: '1px solid #d1d5db', maxWidth: 200,
          }}>
          <option value="" disabled>Move to…</option>
          {targetPhases.map(p => (
            <option key={p.phase_id} value={p.phase_id}>
              {p.instrument_name} · {p.phase_name}
            </option>
          ))}
        </select>
        <button
          onClick={() => setMoving(false)}
          style={{
            fontSize: 11, color: '#9ca3af', background: 'none',
            border: 'none', cursor: 'pointer', padding: '0 2px', lineHeight: 1,
          }}>
          ✕
        </button>
      </span>
    )
  }

  return (
    <span
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 2,
        padding: '1px 5px 1px 7px', borderRadius: 10, fontSize: 11,
        background: s.bg, color: s.text, border: `1px solid ${s.border}`,
        whiteSpace: 'nowrap',
      }}>
      {label}
      {targetPhases.length > 0 && (
        <button
          onClick={() => setMoving(true)}
          title="Move to another phase"
          style={{
            background: 'none', border: 'none', cursor: 'pointer',
            padding: 0, fontSize: 10, color: 'inherit',
            opacity: 0.4, lineHeight: 1, marginLeft: 1,
          }}
          onMouseEnter={e => e.currentTarget.style.opacity = '1'}
          onMouseLeave={e => e.currentTarget.style.opacity = '0.4'}>
          →
        </button>
      )}
    </span>
  )
}

function InlineAddPreLot({ phaseId, ltId, onAdded }) {
  const [adding, setAdding]     = useState(false)
  const [lotNumber, setLotNumber] = useState('')
  const [saving, setSaving]     = useState(false)
  const [error, setError]       = useState(null)
  const inputRef = useRef(null)

  useEffect(() => { if (adding) inputRef.current?.focus() }, [adding])

  async function handleSave() {
    const ln = lotNumber.trim()
    if (!ln) return
    setSaving(true)
    setError(null)
    try {
      const res = await fetch(`${API_BASE}/bulk-lots/insert`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lots: [{ lot_number: ln, lot_type_id: ltId, phase_id: phaseId }] }),
      })
      const data = await res.json()
      if (!res.ok) { setError(data.detail ?? 'Failed'); return }
      setLotNumber('')
      setAdding(false)
      onAdded({ ...data.inserted[0], lot_source: 'pre', in_registry: false })
    } catch { setError('Network error') }
    finally { setSaving(false) }
  }

  const preStyle = LOT_PILL.pre
  if (!adding) {
    return (
      <button
        onClick={() => setAdding(true)}
        style={{
          display: 'inline-flex', alignItems: 'center', gap: 3,
          padding: '1px 7px', borderRadius: 10, fontSize: 11,
          background: 'none', color: preStyle.text,
          border: `1px dashed ${preStyle.border}`,
          cursor: 'pointer',
        }}>
        + Pre-MARKS
      </button>
    )
  }

  return (
    <div style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
      <input
        ref={inputRef}
        value={lotNumber}
        onChange={e => setLotNumber(e.target.value)}
        placeholder="Lot number"
        onKeyDown={e => {
          if (e.key === 'Enter') handleSave()
          if (e.key === 'Escape') { setAdding(false); setLotNumber(''); setError(null) }
        }}
        style={{
          width: 90, fontSize: 11, padding: '1px 5px', borderRadius: 3,
          border: `1px solid ${error ? '#ef4444' : '#d1d5db'}`,
        }}
      />
      <button
        onClick={handleSave} disabled={saving}
        style={{
          fontSize: 11, padding: '1px 6px', borderRadius: 3, cursor: 'pointer',
          background: '#f0fdf4', color: '#15803d', border: '1px solid #86efac',
        }}>
        {saving ? '…' : '✓'}
      </button>
      <button
        onClick={() => { setAdding(false); setLotNumber(''); setError(null) }}
        style={{
          fontSize: 11, padding: '1px 6px', borderRadius: 3, cursor: 'pointer',
          background: 'none', color: '#9ca3af', border: '1px solid #e5e7eb',
        }}>
        ✕
      </button>
      {error && <span style={{ fontSize: 11, color: '#ef4444' }}>{error}</span>}
    </div>
  )
}

const GROUP_LABEL_COLOR = {
  marks: '#1d4ed8',
  pre:   '#92400e',
  sim:   '#9ca3af',
}

function LotPillGroup({ lots, targetPhases, onMoveLot, phaseId, ltId, onLotAdded }) {
  const groups = [
    { key: 'marks', label: 'In MARKS',  items: (lots ?? []).filter(l => l.lot_source === 'real' && l.in_registry) },
    { key: 'pre',   label: 'Pre-MARKS', items: (lots ?? []).filter(l => l.lot_source === 'pre' || (l.lot_source === 'real' && !l.in_registry)) },
    { key: 'sim',   label: 'Sim',       items: (lots ?? []).filter(l => l.lot_source === 'sim') },
  ].filter(g => g.items.length > 0)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      {groups.map(g => (
        <div key={g.key} style={{ display: 'flex', alignItems: 'flex-start', gap: 6 }}>
          <span style={{
            fontSize: 10, color: GROUP_LABEL_COLOR[g.key] ?? '#9ca3af',
            minWidth: 36, paddingTop: 3, textAlign: 'right', flexShrink: 0,
            fontWeight: g.key !== 'sim' ? 600 : 400,
          }}>
            {g.label}
          </span>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3 }}>
            {g.items.map(l =>
              l.lot_source === 'sim' ? (
                <LotPill key={l.lot_id} label="sim" source="sim" />
              ) : (
                <MovableLotPill
                  key={l.lot_id}
                  lot={l}
                  targetPhases={targetPhases}
                  onMoved={onMoveLot}
                />
              )
            )}
          </div>
        </div>
      ))}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 2 }}>
        <span style={{ minWidth: 36, flexShrink: 0 }} />
        <InlineAddPreLot phaseId={phaseId} ltId={ltId} onAdded={onLotAdded} />
      </div>
    </div>
  )
}

// ─── LotTypeRow — one table row + optional lot-pill detail row ────────────────

function LotTypeRow({ phaseId, ltId, lotTypeName, projected, realMarks, realPre, sim,
                       targetPhases, onSaveTotal, onDelete, onRefresh }) {
  const [open, setOpen] = useState(false)
  const [lots, setLots] = useState(null)
  const [fetching, setFetching] = useState(false)

  async function toggle() {
    const next = !open
    setOpen(next)
    if (next && lots === null) {
      setFetching(true)
      try {
        const res = await fetch(`${API_BASE}/phases/${phaseId}/lot-type/${ltId}/lots`)
        setLots(res.ok ? await res.json() : [])
      } finally {
        setFetching(false)
      }
    }
  }

  function handleLotMoved(movedLotId) {
    setLots(prev => prev ? prev.filter(l => l.lot_id !== movedLotId) : null)
    onRefresh()
  }

  function handleLotAdded(newLot) {
    setLots(prev => [...(prev ?? []), newLot])
    onRefresh()
  }

  return (
    <>
      <tr style={{ borderBottom: open ? 'none' : '1px solid #f3f4f6' }}>
        <td style={{ padding: '3px 6px', color: '#374151' }}>
          <button
            onClick={toggle}
            title={open ? 'Hide lots' : 'Show lots'}
            style={{
              background: 'none', border: 'none', cursor: 'pointer',
              padding: 0, marginRight: 4, verticalAlign: 'middle',
              display: 'inline-flex', alignItems: 'center',
            }}>
            <span style={{
              display: 'inline-block', fontSize: 9, color: '#9ca3af',
              transition: 'transform 0.15s',
              transform: open ? 'rotate(90deg)' : 'rotate(0deg)',
            }}>▶</span>
          </button>
          {lotTypeName}
        </td>
        <td style={{ padding: '3px 6px', textAlign: 'right' }}>
          <EditableCount value={projected} onSave={onSaveTotal} min={realMarks + realPre} />
        </td>
        <td style={{ padding: '3px 6px', textAlign: 'right', color: '#6b7280' }}>{realMarks}</td>
        <td style={{ padding: '3px 6px', textAlign: 'right', color: '#6b7280' }}>{realPre}</td>
        <td style={{ padding: '3px 6px', textAlign: 'right', color: '#6b7280' }}>{sim}</td>
        <td style={{ padding: '3px 2px', textAlign: 'center' }}>
          <button
            onClick={onDelete}
            title="Remove lot type"
            style={{
              fontSize: 14, lineHeight: 1, color: '#d1d5db',
              background: 'none', border: 'none', cursor: 'pointer', padding: '0 3px',
            }}
            onMouseEnter={e => e.currentTarget.style.color = '#ef4444'}
            onMouseLeave={e => e.currentTarget.style.color = '#d1d5db'}>
            ×
          </button>
        </td>
      </tr>
      {open && (
        <tr style={{ borderBottom: '1px solid #f3f4f6' }}>
          <td colSpan={6} style={{ padding: '4px 6px 8px 28px', background: '#fafafa' }}>
            {fetching
              ? <span style={{ fontSize: 11, color: '#9ca3af' }}>Loading…</span>
              : <LotPillGroup lots={lots} targetPhases={targetPhases} onMoveLot={handleLotMoved}
                              phaseId={phaseId} ltId={ltId} onLotAdded={handleLotAdded} />
            }
          </td>
        </tr>
      )}
    </>
  )
}

// ─── inline add forms ─────────────────────────────────────────────────────────

function AddForm({ fields, onSave, onCancel, saving, error }) {
  const [values, setValues] = useState(() =>
    Object.fromEntries(fields.map(f => [f.name, f.default ?? '']))
  )
  const firstRef = useRef(null)
  useEffect(() => { firstRef.current?.focus() }, [])

  async function handleSave(e) {
    e.preventDefault()
    await onSave(values)
  }

  return (
    <form onSubmit={handleSave}
      style={{
        display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 6,
        padding: '4px 8px', background: '#f8fafc', borderRadius: 4,
        border: '1px solid #e2e8f0', marginTop: 4,
      }}>
      {fields.map((f, i) =>
        f.options ? (
          <select
            key={f.name}
            value={values[f.name]}
            onChange={e => setValues(prev => ({ ...prev, [f.name]: e.target.value }))}
            required={f.required}
            style={{ fontSize: 12, padding: '2px 4px', borderRadius: 3, border: '1px solid #d1d5db' }}>
            {f.options.map(o => <option key={o} value={o}>{o}</option>)}
          </select>
        ) : (
          <input
            key={f.name}
            ref={i === 0 ? firstRef : null}
            type={f.type ?? 'text'}
            placeholder={f.label}
            value={values[f.name]}
            onChange={e => setValues(prev => ({ ...prev, [f.name]: e.target.value }))}
            required={f.required}
            style={{
              fontSize: 12, padding: '2px 6px', borderRadius: 3,
              border: '1px solid #d1d5db', width: f.width ?? 180,
            }}
          />
        )
      )}
      {error && <span style={{ fontSize: 11, color: '#dc2626' }}>{error}</span>}
      <button type="submit" disabled={saving}
        style={{ fontSize: 11, padding: '2px 10px', borderRadius: 3,
          background: '#2563eb', color: '#fff', border: 'none', cursor: 'pointer' }}>
        {saving ? '…' : 'Add'}
      </button>
      <button type="button" onClick={onCancel}
        style={{ fontSize: 11, padding: '2px 8px', borderRadius: 3,
          background: '#f1f5f9', color: '#6b7280', border: '1px solid #d1d5db', cursor: 'pointer' }}>
        Cancel
      </button>
    </form>
  )
}

function useAddForm(saveFn) {
  const [open, setOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)

  async function handleSave(values) {
    setSaving(true)
    setError(null)
    try {
      await saveFn(values)
      setOpen(false)
    } catch (e) {
      setError(e.message)
    } finally {
      setSaving(false)
    }
  }

  return { open, setOpen, saving, error, handleSave }
}

// ─── tree row styles ──────────────────────────────────────────────────────────

const ROW = {
  display: 'flex', alignItems: 'center', gap: 6,
  padding: '3px 6px', borderRadius: 4, cursor: 'pointer',
  fontSize: 13,
}

function AddButton({ label, onClick }) {
  return (
    <button onClick={onClick}
      style={{
        fontSize: 11, color: '#6b7280', background: 'none', border: 'none',
        cursor: 'pointer', padding: '1px 4px', borderRadius: 3,
        marginLeft: 4,
      }}
      onMouseEnter={e => { e.currentTarget.style.color = '#2563eb'; e.currentTarget.style.background = '#eff6ff' }}
      onMouseLeave={e => { e.currentTarget.style.color = '#6b7280'; e.currentTarget.style.background = 'none' }}>
      + {label}
    </button>
  )
}

// ─── Phase row — expandable lot-type table ────────────────────────────────────

function PhaseRow({ phase, phases, lotTypes, onRefresh }) {
  // All other phases in the same development — valid move targets
  const targetPhases = (phases || []).filter(
    p => p.dev_id === phase.dev_id && p.phase_id !== phase.phase_id
  )
  const [open, setOpen] = useState(false)
  const [addLtOpen, setAddLtOpen] = useState(false)
  const [addLtId, setAddLtId] = useState('')
  const [addSaving, setAddSaving] = useState(false)
  const [addError, setAddError] = useState(null)

  const lotTypeMap = Object.fromEntries(
    (lotTypes || []).map(lt => [lt.lot_type_id, lt])
  )

  // Collect all lot type IDs present in splits or actual lots
  const ltIds = [...new Set([
    ...Object.keys(phase.lot_type_counts || {}),
    ...Object.keys(phase.product_splits || {}),
  ].map(Number))].sort((a, b) => a - b)

  const tableRows = ltIds.map(ltId => {
    const counts    = phase.lot_type_counts?.[ltId] ?? {}
    const projected = phase.product_splits?.[ltId]  ?? 0
    const realMarks = counts.marks ?? 0
    const realPre   = counts.pre   ?? 0
    const sim       = Math.max(0, projected - realMarks - realPre)
    return { ltId, projected, realMarks, realPre, sim }
  })

  const availableLotTypes = (lotTypes || []).filter(
    lt => !ltIds.includes(lt.lot_type_id)
  )

  async function handleSaveTotal(ltId, newCount) {
    const res = await fetch(
      `${API_BASE}/phases/${phase.phase_id}/lot-type/${ltId}/projected`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projected_count: newCount }),
      }
    )
    if (res.ok) onRefresh()
  }

  async function handleDelete(ltId) {
    const res = await fetch(
      `${API_BASE}/phases/${phase.phase_id}/lot-type/${ltId}`,
      { method: 'DELETE' }
    )
    if (res.ok || res.status === 204) onRefresh()
  }

  async function handleAddLotType() {
    if (!addLtId) return
    setAddSaving(true)
    setAddError(null)
    try {
      const res = await fetch(
        `${API_BASE}/phases/${phase.phase_id}/lot-type/${parseInt(addLtId, 10)}/projected`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ projected_count: 0 }),
        }
      )
      if (!res.ok) throw new Error((await res.json()).detail ?? 'Failed')
      setAddLtOpen(false)
      setAddLtId('')
      onRefresh()
    } catch (e) {
      setAddError(e.message)
    } finally {
      setAddSaving(false)
    }
  }

  return (
    <div style={{ paddingLeft: 24, paddingTop: 2, paddingBottom: 2 }}>
      {/* Phase header */}
      <div style={{ ...ROW }} onClick={() => setOpen(o => !o)}>
        <ChevronIcon open={open} />
        <span style={{ color: '#374151', flex: 1 }}>{phase.phase_name}</span>
        {!open && ltIds.length > 0 && (
          <span style={{ fontSize: 11, color: '#9ca3af' }}>
            {ltIds.length} type{ltIds.length !== 1 ? 's' : ''}
          </span>
        )}
      </div>

      {/* Expanded lot-type table */}
      {open && (
        <div style={{ paddingLeft: 16, paddingTop: 4, paddingBottom: 6 }}>
          {tableRows.length > 0 && (
            <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: 12 }}>
              <thead>
                <tr>
                  {['Product', 'Total', 'In MARKS', 'Pre-MARKS', 'Sim', ''].map((h, i) => (
                    <th key={i} style={{
                      textAlign: i === 0 ? 'left' : i === 5 ? 'center' : 'right',
                      padding: '2px 6px 4px',
                      fontWeight: 400, fontSize: 11, color: '#9ca3af',
                      borderBottom: '1px solid #e5e7eb',
                      width: i === 5 ? 24 : undefined,
                    }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {tableRows.map(r => (
                  <LotTypeRow
                    key={r.ltId}
                    phaseId={phase.phase_id}
                    ltId={r.ltId}
                    lotTypeName={lotTypeMap[r.ltId]?.lot_type_short ?? `#${r.ltId}`}
                    projected={r.projected}
                    realMarks={r.realMarks}
                    realPre={r.realPre}
                    sim={r.sim}
                    targetPhases={targetPhases}
                    onSaveTotal={n => handleSaveTotal(r.ltId, n)}
                    onDelete={() => handleDelete(r.ltId)}
                    onRefresh={onRefresh}
                  />
                ))}
              </tbody>
            </table>
          )}

          {/* Add lot type */}
          {addLtOpen ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 6 }}>
              <select
                value={addLtId}
                onChange={e => setAddLtId(e.target.value)}
                style={{ fontSize: 12, padding: '2px 4px', borderRadius: 3, border: '1px solid #d1d5db' }}>
                <option value="">— lot type —</option>
                {availableLotTypes.map(lt => (
                  <option key={lt.lot_type_id} value={lt.lot_type_id}>
                    {lt.lot_type_short}
                  </option>
                ))}
              </select>
              {addError && (
                <span style={{ fontSize: 11, color: '#dc2626' }}>{addError}</span>
              )}
              <button
                onClick={handleAddLotType}
                disabled={!addLtId || addSaving}
                style={{
                  fontSize: 11, padding: '2px 8px', borderRadius: 3,
                  background: '#2563eb', color: '#fff', border: 'none', cursor: 'pointer',
                }}>
                {addSaving ? '…' : 'Add'}
              </button>
              <button
                onClick={() => { setAddLtOpen(false); setAddLtId('') }}
                style={{
                  fontSize: 11, padding: '2px 6px', borderRadius: 3,
                  background: '#f1f5f9', color: '#6b7280',
                  border: '1px solid #d1d5db', cursor: 'pointer',
                }}>
                Cancel
              </button>
            </div>
          ) : (
            availableLotTypes.length > 0 && (
              <button
                onClick={e => { e.stopPropagation(); setAddLtOpen(true) }}
                style={{
                  marginTop: 4, fontSize: 11, color: '#6b7280',
                  background: 'none', border: 'none', cursor: 'pointer', padding: '2px 0',
                }}
                onMouseEnter={e => e.currentTarget.style.color = '#2563eb'}
                onMouseLeave={e => e.currentTarget.style.color = '#6b7280'}>
                + lot type
              </button>
            )
          )}
        </div>
      )}
    </div>
  )
}

// ─── Instrument row ───────────────────────────────────────────────────────────

function InstrumentRow({ instr, phases, lotTypes, onAddPhase, onRefresh }) {
  const instrPhases = phases.filter(p => p.instrument_id === instr.instrument_id)
  const [open, setOpen] = useState(false)
  const addPhase = useAddForm(async (vals) => {
    await onAddPhase(instr.instrument_id, vals.phase_name)
  })

  return (
    <div style={{ paddingLeft: 24 }}>
      <div style={{ ...ROW, color: '#4b5563' }}
        onClick={() => setOpen(o => !o)}>
        <ChevronIcon open={open} />
        <span style={{ fontWeight: 500 }}>{instr.instrument_name}</span>
        <span style={{ fontSize: 10, color: '#9ca3af', background: '#f1f5f9',
          padding: '0 5px', borderRadius: 10, marginLeft: 4 }}>
          {instr.instrument_type}
        </span>
        <span style={{ fontSize: 11, color: '#9ca3af', marginLeft: 4 }}>
          {instrPhases.length} phase{instrPhases.length !== 1 ? 's' : ''}
        </span>
        {open && (
          <span onClick={e => e.stopPropagation()}>
            <AddButton label="phase" onClick={() => addPhase.setOpen(o => !o)} />
          </span>
        )}
      </div>

      {open && (
        <div>
          {addPhase.open && (
            <div style={{ paddingLeft: 24 }}>
              <AddForm
                fields={[{ name: 'phase_name', label: 'Phase name', required: true }]}
                onSave={addPhase.handleSave}
                onCancel={() => addPhase.setOpen(false)}
                saving={addPhase.saving}
                error={addPhase.error}
              />
            </div>
          )}
          {instrPhases.map(p => (
            <PhaseRow
              key={p.phase_id}
              phase={p}
              phases={phases}
              lotTypes={lotTypes}
              onRefresh={onRefresh}
            />
          ))}
          {instrPhases.length === 0 && !addPhase.open && (
            <div style={{ paddingLeft: 48, fontSize: 11, color: '#d1d5db', padding: '2px 0 2px 48px' }}>
              No phases
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ─── Development row ─────────────────────────────────────────────────────────

function DevRow({ dev, instruments, phases, lotTypes, onAddInstrument, onAddPhase, onRefresh }) {
  const devInstrs = instruments.filter(i => i.modern_dev_id === dev.dev_id)
  const [open, setOpen] = useState(false)
  const addInstr = useAddForm(async (vals) => {
    await onAddInstrument(dev.dev_id, vals.instrument_name, vals.instrument_type)
  })

  return (
    <div style={{ paddingLeft: 20 }}>
      <div style={{ ...ROW, color: '#374151' }}
        onClick={() => setOpen(o => !o)}>
        <ChevronIcon open={open} />
        <span style={{ fontWeight: 500 }}>{dev.dev_name}</span>
        {dev.marks_code && (
          <span style={{ fontSize: 10, color: '#6b7280', background: '#f9fafb',
            border: '1px solid #e5e7eb', padding: '0 5px', borderRadius: 10 }}>
            {dev.marks_code}
          </span>
        )}
        <span style={{ fontSize: 11, color: '#9ca3af', marginLeft: 4 }}>
          {devInstrs.length} instrument{devInstrs.length !== 1 ? 's' : ''}
        </span>
        {open && (
          <span onClick={e => e.stopPropagation()}>
            <AddButton label="instrument" onClick={() => addInstr.setOpen(o => !o)} />
          </span>
        )}
      </div>

      {open && (
        <div>
          {addInstr.open && (
            <div style={{ paddingLeft: 24 }}>
              <AddForm
                fields={[
                  { name: 'instrument_name', label: 'Instrument name', required: true },
                  { name: 'instrument_type', label: 'Type', required: true,
                    options: ['Plat', 'Site Condo', 'Other'], default: 'Plat' },
                ]}
                onSave={addInstr.handleSave}
                onCancel={() => addInstr.setOpen(false)}
                saving={addInstr.saving}
                error={addInstr.error}
              />
            </div>
          )}
          {devInstrs.map(instr => (
            <InstrumentRow
              key={instr.instrument_id}
              instr={instr}
              phases={phases}
              lotTypes={lotTypes}
              onAddPhase={onAddPhase}
              onRefresh={onRefresh}
            />
          ))}
          {devInstrs.length === 0 && !addInstr.open && (
            <div style={{ paddingLeft: 44, fontSize: 11, color: '#d1d5db', padding: '2px 0 2px 44px' }}>
              No instruments — add one to start
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ─── Community row ───────────────────────────────────────────────────────────

function CommunityRow({ comm, devs, instruments, phases, lotTypes,
  onAddDev, onAddInstrument, onAddPhase, onRefresh }) {
  const [open, setOpen] = useState(false)
  const addDev = useAddForm(async (vals) => {
    await onAddDev(comm.ent_group_id, vals.dev_name, vals.marks_code || null)
  })

  return (
    <div style={{
      border: '1px solid #e5e7eb', borderRadius: 6,
      marginBottom: 6, overflow: 'hidden',
    }}>
      <div
        style={{
          ...ROW, padding: '6px 10px', background: '#f9fafb',
          borderBottom: open ? '1px solid #e5e7eb' : 'none',
          cursor: 'pointer', fontWeight: 600, color: '#111827', fontSize: 13,
        }}
        onClick={() => setOpen(o => !o)}>
        <ChevronIcon open={open} />
        <span style={{ flex: 1 }}>{comm.ent_group_name}</span>
        <span style={{ fontSize: 11, color: '#9ca3af', fontWeight: 400 }}>
          {devs.length} dev{devs.length !== 1 ? 's' : ''}
        </span>
        {open && (
          <span onClick={e => e.stopPropagation()}>
            <AddButton label="development" onClick={() => addDev.setOpen(o => !o)} />
          </span>
        )}
      </div>

      {open && (
        <div style={{ padding: '4px 4px 6px' }}>
          {addDev.open && (
            <div style={{ paddingLeft: 20, paddingTop: 4 }}>
              <AddForm
                fields={[
                  { name: 'dev_name', label: 'Development name', required: true, width: 200 },
                  { name: 'marks_code', label: 'MARKS code (optional)', width: 140 },
                ]}
                onSave={addDev.handleSave}
                onCancel={() => addDev.setOpen(false)}
                saving={addDev.saving}
                error={addDev.error}
              />
            </div>
          )}
          {devs.map(dev => (
            <DevRow
              key={dev.dev_id}
              dev={dev}
              instruments={instruments}
              phases={phases}
              lotTypes={lotTypes}
              onAddInstrument={onAddInstrument}
              onAddPhase={onAddPhase}
              onRefresh={onRefresh}
            />
          ))}
          {devs.length === 0 && !addDev.open && (
            <div style={{ paddingLeft: 28, fontSize: 11, color: '#d1d5db', padding: '4px 0 4px 28px' }}>
              No developments assigned
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ─── SetupView ────────────────────────────────────────────────────────────────

export default function SetupView({ showTestCommunities }) {
  const [communities, setCommunities] = useState([])
  const [developments, setDevelopments] = useState([])
  const [instruments, setInstruments] = useState([])
  const [phases, setPhases] = useState([])
  const [lotTypes, setLotTypes] = useState([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(null)

  const addComm = useAddForm(async (vals) => {
    const res = await fetch(`${API_BASE}/entitlement-groups`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ent_group_name: vals.comm_name }),
    })
    if (!res.ok) throw new Error((await res.json()).detail ?? 'Create failed')
    const data = await res.json()
    setCommunities(prev => [...prev, { ...data, is_test: false }])
  })

  async function load(silent = false) {
    if (!silent) setLoading(true)
    setLoadError(null)
    try {
      const [eg, devs, instrs, cfg] = await Promise.all([
        fetch(`${API_BASE}/entitlement-groups`).then(r => r.json()),
        fetch(`${API_BASE}/developments`).then(r => r.json()),
        fetch(`${API_BASE}/instruments`).then(r => r.json()),
        fetch(`${API_BASE}/admin/phase-config`).then(r => r.json()),
      ])
      setCommunities(eg)
      setDevelopments(devs)
      setInstruments(instrs)
      setPhases(cfg.rows ?? [])
      setLotTypes(cfg.lot_types ?? [])
    } catch (e) {
      setLoadError(e.message)
    } finally {
      if (!silent) setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  async function handleAddDev(communityId, devName, marksCode) {
    const res = await fetch(`${API_BASE}/developments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ dev_name: devName, marks_code: marksCode, community_id: communityId }),
    })
    if (!res.ok) throw new Error((await res.json()).detail ?? 'Create failed')
    const data = await res.json()
    setDevelopments(prev => [...prev, data])
  }

  async function handleAddInstrument(devId, name, type) {
    const res = await fetch(`${API_BASE}/instruments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ dev_id: devId, instrument_name: name, instrument_type: type }),
    })
    if (!res.ok) throw new Error((await res.json()).detail ?? 'Create failed')
    const data = await res.json()
    setInstruments(prev => [...prev, { ...data, modern_dev_id: devId }])
  }

  async function handleAddPhase(instrumentId, name) {
    const res = await fetch(`${API_BASE}/phases`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ instrument_id: instrumentId, phase_name: name }),
    })
    if (!res.ok) throw new Error((await res.json()).detail ?? 'Create failed')
    const data = await res.json()
    setPhases(prev => [...prev, { ...data, lot_type_counts: {}, product_splits: {} }])
  }

  const visibleCommunities = communities.filter(c =>
    showTestCommunities ? c.is_test : !c.is_test
  )

  if (loading) return (
    <div style={{ padding: 40, color: '#9ca3af', fontSize: 13 }}>Loading…</div>
  )
  if (loadError) return (
    <div style={{ padding: 40, color: '#dc2626', fontSize: 13 }}>{loadError}</div>
  )

  return (
    <div style={{ padding: '24px 32px', maxWidth: 820, boxSizing: 'border-box' }}>
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: 16, gap: 12 }}>
        <h1 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: '#111827' }}>Setup</h1>
        <button
          onClick={() => addComm.setOpen(o => !o)}
          style={{
            fontSize: 12, color: '#2563eb', background: '#eff6ff',
            border: '1px solid #bfdbfe', borderRadius: 4,
            padding: '3px 10px', cursor: 'pointer',
          }}>
          + New community
        </button>
      </div>

      {addComm.open && (
        <div style={{ marginBottom: 10 }}>
          <AddForm
            fields={[{ name: 'comm_name', label: 'Community name', required: true, width: 240 }]}
            onSave={addComm.handleSave}
            onCancel={() => addComm.setOpen(false)}
            saving={addComm.saving}
            error={addComm.error}
          />
        </div>
      )}

      {visibleCommunities.length === 0 && (
        <div style={{ fontSize: 13, color: '#9ca3af' }}>No communities yet.</div>
      )}

      {visibleCommunities.map(comm => (
        <CommunityRow
          key={comm.ent_group_id}
          comm={comm}
          devs={developments.filter(d => d.community_id === comm.ent_group_id)}
          instruments={instruments}
          phases={phases}
          lotTypes={lotTypes}
          onAddDev={handleAddDev}
          onAddInstrument={handleAddInstrument}
          onAddPhase={handleAddPhase}
          onRefresh={() => load(true)}
        />
      ))}
    </div>
  )
}
