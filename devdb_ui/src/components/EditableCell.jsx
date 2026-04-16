import { useState, useEffect, useRef } from 'react'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtDate(iso) {
  if (!iso) return ''
  const [y, m, d] = iso.split('-')
  return `${parseInt(m)}/${parseInt(d)}/${y}`
}

// ─── Active cell highlight (exported for use in tab tables) ───────────────────

export function cellHighlight(isActive, editable) {
  if (!isActive) return {}
  return editable
    ? { boxShadow: 'inset 0 0 0 2px #2563eb', background: '#eff6ff' }
    : { boxShadow: 'inset 0 0 0 2px #cbd5e1', background: '#f1f5f9' }
}

// ─── EditableCell ─────────────────────────────────────────────────────────────

export function EditableCell({ value, type = 'number', onSave, placeholder = '—', width = 52, align = 'right', triggerActivate = 0, onDone, min = 0 }) {
  const [editing, setEditing] = useState(false)
  const [draft,   setDraft]   = useState('')
  const [saving,  setSaving]  = useState(false)
  const [error,   setError]   = useState(null)
  const inputRef   = useRef()
  const prevSigRef = useRef(0)

  // Keyboard-nav activation: start editing when triggerActivate counter increments
  useEffect(() => {
    if (triggerActivate !== prevSigRef.current) {
      prevSigRef.current = triggerActivate
      if (triggerActivate > 0 && !editing) startEdit()
    }
  }, [triggerActivate]) // eslint-disable-line react-hooks/exhaustive-deps

  // Focus input after React commits it to DOM (more reliable than RAF in startEdit)
  useEffect(() => {
    if (editing) { inputRef.current?.focus(); inputRef.current?.select() }
  }, [editing])

  function startEdit() {
    if (saving) return
    setDraft(value != null ? String(value) : '')
    setEditing(true)
  }

  async function commit() {
    setEditing(false)
    const raw = draft.trim()
    let parsed
    if (raw === '') { parsed = null }
    else if (type === 'number') {
      parsed = Number(raw)
      if (isNaN(parsed)) { setError('!'); setTimeout(() => setError(null), 1200); return }
      if (parsed < min) {
        setError(`Min ${min}`)
        setTimeout(() => setError(null), 1200)
        return
      }
    } else { parsed = raw }
    if (parsed === value || (parsed == null && value == null)) { onDone?.(); return }
    setSaving(true); setError(null)
    try { await onSave(parsed) }
    catch (e) { setError(String(e).slice(0, 40)) }
    finally { setSaving(false); onDone?.() }
  }

  function onKeyDown(e) {
    if (e.key === 'Escape') { e.stopPropagation(); setEditing(false); onDone?.() }
    if (e.key === 'Enter')  { e.stopPropagation(); commit() }
    if (type === 'number' && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
      e.preventDefault()
      e.stopPropagation()
      const cur = parseFloat(draft)
      const base = isNaN(cur) ? min : cur
      const next = e.key === 'ArrowUp' ? base + 1 : base - 1
      setDraft(String(Math.max(min, next)))
    }
  }

  const display = type === 'date' ? fmtDate(value) : (value != null ? String(value) : '')

  return (
    <div onClick={startEdit} title={error ?? undefined}
         style={{ width, minHeight: 20, textAlign: align, cursor: 'text' }}>
      {editing ? (
        <input ref={inputRef} type={type === 'date' ? 'date' : 'number'}
          min={type === 'number' ? min : undefined}
          value={draft} onChange={e => setDraft(e.target.value)}
          onBlur={commit} onKeyDown={onKeyDown}
          style={{ width: '100%', padding: '1px 4px', fontSize: 12, textAlign: align,
                   border: '1px solid #2563eb', borderRadius: 3, background: '#fff', outline: 'none',
                   MozAppearance: 'textfield' }}
          className="no-spin" />
      ) : (
        <span style={{
          display: 'block', padding: '1px 4px', fontSize: 12, borderRadius: 3,
          background: error ? '#fef2f2' : saving ? '#fef3c7' : 'transparent',
          border: error ? '1px solid #fca5a5' : '1px solid transparent',
          color: display ? (error ? '#dc2626' : '#111827') : '#d1d5db',
        }}>
          {error ? `⚠ ${error}` : (display || placeholder)}
        </span>
      )}
    </div>
  )
}

export default EditableCell
