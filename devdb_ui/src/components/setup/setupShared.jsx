// setup/setupShared.jsx
// Shared hooks, utilities, and UI atoms for the Setup tree.

import { useState, useEffect, useRef, useCallback, createContext } from 'react'

// ─── Contexts ─────────────────────────────────────────────────────────────────
// Broadcast tick to all open LotTypeRows after any silent refresh
export const LotRefreshContext = createContext(0)
// Broadcast expand-all / collapse-all commands down the tree
export const ExpandAllContext = createContext({ tick: 0, value: null })

// ─── Hooks ────────────────────────────────────────────────────────────────────
// Persistent open state backed by localStorage
export function useLocalOpen(key) {
  const [open, setOpenRaw] = useState(() => {
    try { const v = localStorage.getItem(key); return v !== null ? JSON.parse(v) : false }
    catch { return false }
  })
  const setOpen = useCallback((val) => {
    setOpenRaw(prev => {
      const next = typeof val === 'function' ? val(prev) : val
      try { localStorage.setItem(key, JSON.stringify(next)) } catch {}
      return next
    })
  }, [key]) // eslint-disable-line react-hooks/exhaustive-deps
  return [open, setOpen]
}

// ─── Subtotal layout ──────────────────────────────────────────────────────────
export const SUB = { D: 52, I: 78, P: 58, L: 56 }
export const SUB_LABELS = { D: 'Devs', I: 'Instruments', P: 'Phases', L: 'Lots' }

export function phaseTotal(p) {
  return Object.values(p.product_splits ?? {}).reduce((s, v) => s + (v ?? 0), 0)
}

// A phase is "configured" if it has projected lots OR any real/pre/excluded lots assigned to it.
export function phaseHasLots(p) {
  if (phaseTotal(p) > 0) return true
  return Object.values(p.lot_type_counts ?? {}).some(c => (c.marks ?? 0) + (c.pre ?? 0) + (c.excl ?? 0) > 0)
}

export function fmtRelative(iso) {
  if (!iso) return null
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000)
  if (days === 0) return 'today'
  if (days === 1) return 'yesterday'
  if (days < 30)  return `${days}d ago`
  const mo = Math.floor(days / 30)
  if (mo < 12)    return `${mo}mo ago`
  return `${Math.floor(mo / 12)}y ago`
}

export function SubCell({ n, w, left = false, onClick }) {
  return (
    <div
      onClick={onClick}
      style={{
        width: w, flexShrink: 0, textAlign: 'right', padding: '0 5px',
        fontSize: 11, color: n > 0 ? '#374151' : '#d1d5db',
        cursor: onClick ? 'pointer' : undefined,
        ...(left ? { borderLeft: '2px solid #e5e7eb' } : {}),
      }}>
      {n > 0 ? n : '—'}
    </div>
  )
}

export function SortHeader({ label, sortKey, sort, onSort, style = {} }) {
  const active = sort.key === sortKey
  return (
    <div
      onClick={() => onSort(prev =>
        prev.key === sortKey
          ? { ...prev, dir: prev.dir * -1 }
          : { key: sortKey, dir: 1 }
      )}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 2,
        fontSize: 10, fontWeight: 600, cursor: 'pointer', userSelect: 'none',
        color: active ? '#2563eb' : '#9ca3af',
        ...style,
      }}>
      {label}
      {active && <span style={{ fontSize: 8 }}>{sort.dir > 0 ? '▲' : '▼'}</span>}
    </div>
  )
}

// ─── Lot number formatters ────────────────────────────────────────────────────

// Strip leading zeros from the numeric suffix: "WS083" → "WS83", "083" → "83"
export function formatLotNum(s) {
  if (!s) return s ?? ''
  const m = s.match(/^([A-Za-z]*)(\d+)$/)
  return m ? `${m[1]}${parseInt(m[2], 10)}` : s
}

// Extract the sequence string from a lot number given its dev code.
// Handles both alphabetic prefixes ("WS001" → "1") and numeric dev codes ("4300000001" with devCode="43" → "1").
export function lotSeqStr(lotNumber, devCode = '') {
  if (!lotNumber) return ''
  const m = lotNumber.match(/^([A-Za-z]+)(\d+)$/)
  if (m) return String(parseInt(m[2], 10))
  if (devCode && lotNumber.startsWith(devCode)) {
    const seq = parseInt(lotNumber.slice(devCode.length), 10)
    if (!isNaN(seq)) return String(seq)
  }
  return lotNumber
}

// Fixed-width display: "WS1" → "WS   1", "4300000001" (devCode="43") → "43   1"
// Always ≥1 non-breaking space between prefix and number, monospace font required.
export function formatLotNumPadded(s, maxDigits, devCode = '') {
  if (!s) return s ?? ''
  const m = s.match(/^([A-Za-z]+)(\d+)$/)
  if (m) {
    const numStr = String(parseInt(m[2], 10))
    const spaces = Math.max(1, maxDigits - numStr.length + 1)
    return `${m[1]}${'\u00a0'.repeat(spaces)}${numStr}`
  }
  if (devCode && s.startsWith(devCode)) {
    const seq = parseInt(s.slice(devCode.length), 10)
    if (!isNaN(seq)) {
      const numStr = String(seq)
      const spaces = Math.max(1, maxDigits - numStr.length + 1)
      return `${devCode}${'\u00a0'.repeat(spaces)}${numStr}`
    }
  }
  return s
}

export function ChevronIcon({ open }) {
  return (
    <span style={{
      display: 'inline-block', width: 12, marginRight: 4,
      transition: 'transform 0.15s',
      transform: open ? 'rotate(90deg)' : 'rotate(0deg)',
      color: '#9ca3af', fontSize: 10, lineHeight: 1,
    }}>▶</span>
  )
}

// ─── InlineEdit ───────────────────────────────────────────────────────────────
// Double-click the name (or click the pencil) to edit. Enter/blur saves, Escape cancels.

export function InlineEdit({ value, onSave, style }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft]     = useState(value)
  const [saving, setSaving]   = useState(false)
  const inputRef = useRef(null)

  useEffect(() => { if (editing) inputRef.current?.select() }, [editing])

  function start(e) { e.stopPropagation(); setDraft(value); setEditing(true) }

  async function commit() {
    const trimmed = draft.trim()
    if (!trimmed || trimmed === value) { setEditing(false); return }
    setSaving(true)
    try {
      await onSave(trimmed)
    } finally {
      setSaving(false)
      setEditing(false)
    }
  }

  if (editing) return (
    <input
      ref={inputRef}
      value={draft}
      onChange={e => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={e => {
        if (e.key === 'Enter')  { e.preventDefault(); commit() }
        if (e.key === 'Escape') { setEditing(false) }
        e.stopPropagation()
      }}
      onClick={e => e.stopPropagation()}
      disabled={saving}
      style={{
        fontSize: 'inherit', fontWeight: 'inherit', color: 'inherit',
        background: '#fff', border: '1px solid #2563eb', borderRadius: 3,
        padding: '0 4px', minWidth: 80, width: Math.max(120, value.length * 8),
        outline: 'none',
        ...style,
      }}
    />
  )

  return (
    <span
      onDoubleClick={start}
      style={{ display: 'inline-flex', alignItems: 'center', gap: 3, cursor: 'default', ...style }}
    >
      <span>{value}</span>
      <span
        onClick={start}
        title="Rename"
        style={{
          fontSize: 10, color: '#d1d5db', cursor: 'pointer', lineHeight: 1,
          opacity: 0.35, transition: 'opacity 0.1s',
        }}
        className="inline-edit-pencil"
      >✎</span>
    </span>
  )
}

// ─── EditableCount ────────────────────────────────────────────────────────────

export function EditableCount({ value, onSave, min = 0 }) {
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

// ─── AddForm / useAddForm ─────────────────────────────────────────────────────

export function AddForm({ fields, onSave, onCancel, saving, error }) {
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

export function useAddForm(saveFn) {
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

// ─── Tree row primitives ──────────────────────────────────────────────────────

export const ROW = {
  display: 'flex', alignItems: 'center', gap: 6,
  padding: '3px 6px', borderRadius: 4, cursor: 'pointer',
  fontSize: 13,
}

// ─── DeleteButton / useDeleteConfirm ─────────────────────────────────────────
// Hover-visible delete trigger + inline confirm state.

export function useDeleteConfirm(deleteFn) {
  const [confirming, setConfirming] = useState(false)
  const [deleting, setDeleting]     = useState(false)
  const [error, setError]           = useState(null)

  async function handleConfirm() {
    setDeleting(true)
    setError(null)
    try {
      await deleteFn()
    } catch (e) {
      setError(e.message)
      setDeleting(false)
    }
  }

  return { confirming, setConfirming, deleting, error, handleConfirm }
}

// Small red trash button — visible only on hover (parent controls opacity via hovered prop)
export function DeleteButton({ onClick, visible }) {
  return (
    <button
      onClick={e => { e.stopPropagation(); onClick() }}
      title="Delete"
      style={{
        fontSize: 10, color: '#f87171', background: 'none', border: 'none',
        cursor: 'pointer', padding: '1px 4px', borderRadius: 3,
        marginLeft: 2, lineHeight: 1,
        opacity: visible ? 1 : 0,
        pointerEvents: visible ? undefined : 'none',
        transition: 'opacity 0.1s',
      }}>
      🗑
    </button>
  )
}

// Inline confirmation banner rendered below the row header
export function DeleteConfirmBanner({ label, warning, onConfirm, onCancel, deleting, error }) {
  return (
    <div
      onClick={e => e.stopPropagation()}
      style={{
        display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 8,
        padding: '4px 8px', marginLeft: 12, marginBottom: 2,
        background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 4, fontSize: 12,
      }}>
      <span style={{ color: '#991b1b', fontWeight: 600 }}>Delete {label}?</span>
      {warning && <span style={{ color: '#b45309', fontSize: 11 }}>{warning}</span>}
      <button
        onClick={onConfirm}
        disabled={deleting}
        style={{
          fontSize: 11, padding: '2px 10px', borderRadius: 3, border: 'none',
          background: deleting ? '#fca5a5' : '#dc2626', color: '#fff', cursor: deleting ? 'default' : 'pointer',
        }}>
        {deleting ? 'Deleting…' : 'Confirm delete'}
      </button>
      <button
        onClick={onCancel}
        style={{
          fontSize: 11, padding: '2px 8px', borderRadius: 3,
          background: '#f1f5f9', color: '#6b7280', border: '1px solid #d1d5db', cursor: 'pointer',
        }}>
        Cancel
      </button>
      {error && <span style={{ color: '#dc2626', fontSize: 11 }}>{error}</span>}
    </div>
  )
}

export function AddButton({ label, onClick, dim = false }) {
  return (
    <button onClick={onClick}
      style={{
        fontSize: 11, color: dim ? '#d1d5db' : '#6b7280', background: 'none', border: 'none',
        cursor: 'pointer', padding: '1px 4px', borderRadius: 3,
        marginLeft: 4, transition: 'color 0.15s',
      }}
      onMouseEnter={e => { e.currentTarget.style.color = '#2563eb'; e.currentTarget.style.background = '#eff6ff' }}
      onMouseLeave={e => { e.currentTarget.style.color = dim ? '#d1d5db' : '#6b7280'; e.currentTarget.style.background = 'none' }}>
      + {label}
    </button>
  )
}
