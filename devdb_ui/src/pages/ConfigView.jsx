import { useState, useEffect, useRef, useCallback } from 'react'
import { API_BASE } from '../config'
import BulkLotInsertModal from '../components/BulkLotInsertModal'

// ─── Constants ────────────────────────────────────────────────────────────────

const MONTH_ABBR = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
const TABS = [
  { id: 'community',  label: 'Community' },
  { id: 'dev',        label: 'Development' },
  { id: 'instrument', label: 'Instrument' },
  { id: 'phase',      label: 'Phase' },
]

// Sticky column geometry (phase tab only)
const CW = { comm: 160, dev: 140, inst: 144, phase: 116 }
const LEFT = {
  comm:  0,
  dev:   CW.comm,
  inst:  CW.comm + CW.dev,
  phase: CW.comm + CW.dev + CW.inst,
}
const PHASE_SHADOW = { boxShadow: '4px 0 8px -2px rgba(0,0,0,0.10)' }
const BAND = ['#ffffff', '#f8faff']

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtDate(iso) {
  if (!iso) return ''
  const [y, m, d] = iso.split('-')
  return `${parseInt(m)}/${parseInt(d)}/${y}`
}

function bandIdx(rows, getKey) {
  const map = {}; let n = 0
  rows.forEach(r => { const k = getKey(r); if (map[k] === undefined) map[k] = n++ })
  return map
}

// ─── Active cell highlight ────────────────────────────────────────────────────

function cellHighlight(isActive, editable) {
  if (!isActive) return {}
  return editable
    ? { boxShadow: 'inset 0 0 0 2px #2563eb', background: '#eff6ff' }
    : { boxShadow: 'inset 0 0 0 2px #cbd5e1', background: '#f1f5f9' }
}

// ─── EditableCell ─────────────────────────────────────────────────────────────

function EditableCell({ value, type = 'number', onSave, placeholder = '—', width = 52, align = 'right', triggerActivate = 0, onDone, min = 0 }) {
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

// ─── LockButton ───────────────────────────────────────────────────────────────

function LockButton({ locked, disabled, onToggle }) {
  const [busy, setBusy] = useState(false)
  async function handle() {
    if (disabled || busy) return
    setBusy(true)
    try { await onToggle(!locked) }
    finally { setBusy(false) }
  }
  return (
    <button onClick={handle} disabled={disabled || busy}
      title={disabled ? 'Set a dev date first' : locked ? 'Locked — click to unlock' : 'Unlocked — click to lock'}
      style={{
        padding: '2px 8px', fontSize: 11, borderRadius: 4, cursor: disabled ? 'not-allowed' : 'pointer',
        border: locked ? '1px solid #16a34a' : '1px solid #d1d5db',
        background: locked ? '#f0fdf4' : busy ? '#f9fafb' : '#fff',
        color: locked ? '#16a34a' : '#9ca3af', fontWeight: locked ? 600 : 400,
        transition: 'all 0.15s', minWidth: 64,
      }}>
      {busy ? '…' : locked ? '⚿ Locked' : 'Unlocked'}
    </button>
  )
}

// ─── BuilderSumBadge ──────────────────────────────────────────────────────────

function BuilderSumBadge({ splits, builders }) {
  const sum = builders.reduce((acc, b) => acc + (splits[b.builder_id] ?? 0), 0)
  const r   = Math.round(sum * 10) / 10
  if (r === 0) return <span style={{ color: '#d1d5db', fontSize: 11 }}>—</span>
  const ok = r === 100, over = r > 100
  const color = ok ? '#16a34a' : over ? '#dc2626' : '#d97706'
  return (
    <span style={{ fontSize: 11, fontWeight: 600, color,
                   padding: '1px 6px', borderRadius: 10,
                   background: ok ? '#f0fdf4' : over ? '#fef2f2' : '#fef9c3',
                   border: `1px solid ${color}44` }}>
      {r}%
    </span>
  )
}

// ─── MonthCell ────────────────────────────────────────────────────────────────

function MonthCell({ months, globalMonths, onSave, onSaveGlobal }) {
  const [saving,        setSaving]        = useState(false)
  const [editingGlobal, setEditingGlobal] = useState(false)
  const [globalDraft,   setGlobalDraft]   = useState([])

  const isGlobal = months == null
  const active   = new Set(isGlobal ? (globalMonths ?? []) : months)
  const isAll    = !isGlobal && months.length === 12
  const isNone   = !isGlobal && months.length === 0
  const isCustom = !isGlobal && !isAll && !isNone

  async function save(next) {
    setSaving(true)
    try { await onSave(next) }
    finally { setSaving(false) }
  }

  async function toggle(m) {
    if (saving) return
    const base = isGlobal ? new Set(globalMonths ?? []) : active
    const next = base.has(m)
      ? [...base].filter(x => x !== m).sort((a, b) => a - b)
      : [...base, m].sort((a, b) => a - b)
    await save(next)
  }

  function startEditGlobal() {
    setGlobalDraft(globalMonths ? [...globalMonths].sort((a, b) => a - b) : [1,2,3,4,5,6,7,8,9,10,11,12])
    setEditingGlobal(true)
  }

  async function commitGlobal() {
    setSaving(true)
    try { await onSaveGlobal(globalDraft) }
    finally { setSaving(false); setEditingGlobal(false) }
  }

  function toggleGlobalDraft(m) {
    const s = new Set(globalDraft)
    if (s.has(m)) s.delete(m); else s.add(m)
    setGlobalDraft([...s].sort((a, b) => a - b))
  }

  function subtextStyle(isActive) {
    return {
      fontSize: 10, background: 'none', border: 'none', padding: 0,
      color: isActive ? '#2563eb' : '#9ca3af',
      fontWeight: isActive ? 700 : 400,
      cursor: isActive ? 'default' : 'pointer',
    }
  }

  return (
    <div style={{ minWidth: 220 }}>
      <div style={{ display: 'flex', gap: 2 }}>
        {MONTH_ABBR.map((abbr, i) => {
          const m = i + 1, on = active.has(m)
          return (
            <button key={m} onClick={() => toggle(m)} disabled={saving}
              title={abbr}
              style={{
                padding: '2px 4px', fontSize: 10, borderRadius: 3, cursor: saving ? 'default' : 'pointer',
                border: on ? (isGlobal ? '1px solid #7c3aed' : '1px solid #2563eb') : '1px solid #d1d5db',
                background: on ? (isGlobal ? '#f5f3ff' : '#eff6ff') : '#fff',
                color: on ? (isGlobal ? '#7c3aed' : '#1d4ed8') : '#9ca3af',
                fontWeight: on ? 600 : 400, minWidth: 26,
              }}>
              {abbr}
            </button>
          )
        })}
      </div>
      <div style={{ display: 'flex', gap: 8, marginTop: 3, alignItems: 'center' }}>
        <button onClick={() => save([1,2,3,4,5,6,7,8,9,10,11,12])} disabled={saving}
          style={subtextStyle(isAll)}>All</button>
        <button onClick={() => save([])} disabled={saving}
          style={subtextStyle(isNone)}>None</button>
        <span style={{ fontSize: 10, color: isCustom ? '#2563eb' : '#e5e7eb', fontWeight: isCustom ? 700 : 400 }}>
          Custom
        </span>
        <button onClick={() => save(null)} disabled={saving}
          style={subtextStyle(isGlobal)}>Global</button>
        <button onClick={startEditGlobal} disabled={saving}
          style={{ fontSize: 10, background: 'none', border: 'none', padding: 0,
                   color: '#9ca3af', cursor: 'pointer' }}>
          Edit Global
        </button>
      </div>
      {editingGlobal && (
        <div style={{ marginTop: 6, padding: 8, background: '#faf5ff',
                      border: '1px solid #e9d5ff', borderRadius: 6 }}>
          <div style={{ fontSize: 10, color: '#7c3aed', fontWeight: 600, marginBottom: 4 }}>
            Global delivery months
          </div>
          <div style={{ display: 'flex', gap: 2 }}>
            {MONTH_ABBR.map((abbr, i) => {
              const m = i + 1, on = globalDraft.includes(m)
              return (
                <button key={m} onClick={() => toggleGlobalDraft(m)} title={abbr}
                  style={{
                    padding: '2px 4px', fontSize: 10, borderRadius: 3, cursor: 'pointer',
                    border: on ? '1px solid #7c3aed' : '1px solid #d1d5db',
                    background: on ? '#f5f3ff' : '#fff',
                    color: on ? '#7c3aed' : '#9ca3af',
                    fontWeight: on ? 600 : 400, minWidth: 26,
                  }}>
                  {abbr}
                </button>
              )
            })}
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 5, alignItems: 'center' }}>
            <button onClick={commitGlobal} disabled={saving}
              style={{ fontSize: 10, padding: '2px 8px', borderRadius: 3,
                       cursor: saving ? 'default' : 'pointer',
                       background: '#7c3aed', color: '#fff', border: 'none', fontWeight: 600 }}>
              {saving ? '…' : 'Save'}
            </button>
            <button onClick={() => setEditingGlobal(false)} disabled={saving}
              style={{ fontSize: 10, color: '#9ca3af', background: 'none', border: 'none',
                       cursor: 'pointer', padding: 0 }}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Tab bar ──────────────────────────────────────────────────────────────────

function TabBar({ active, onChange }) {
  return (
    <div style={{ display: 'flex', borderBottom: '1px solid #e5e7eb', marginBottom: 14, gap: 0 }}>
      {TABS.map(t => (
        <button key={t.id} onClick={() => onChange(t.id)}
          style={{
            padding: '7px 18px', fontSize: 13, fontWeight: active === t.id ? 600 : 400,
            color: active === t.id ? '#2563eb' : '#6b7280',
            background: 'none', border: 'none',
            borderBottom: active === t.id ? '2px solid #2563eb' : '2px solid transparent',
            cursor: 'pointer', marginBottom: -1,
          }}>
          {t.label}
        </button>
      ))}
    </div>
  )
}

// ─── Shared table shell ───────────────────────────────────────────────────────

function TableShell({ children, maxHeight = 'calc(100vh - 170px)' }) {
  return (
    <div style={{ overflowX: 'auto', overflowY: 'auto', maxHeight,
                  border: '1px solid #e5e7eb', borderRadius: 6 }}>
      <table style={{ borderCollapse: 'collapse', minWidth: 'max-content', width: '100%' }}>
        {children}
      </table>
    </div>
  )
}

// ─── Community tab ────────────────────────────────────────────────────────────

// Community tab column metadata: index → { editable, kind, autoOpen }
// autoOpen: immediately enter editing mode when arrow-navigated onto this cell
const COMM_COLS = [
  { editable: false },                                     // 0 community name
  { editable: true, kind: 'edit',     autoOpen: false },  // 1 date_paper (date — don't auto-open)
  { editable: true, kind: 'edit',     autoOpen: false },  // 2 date_ent   (date — don't auto-open)
  { editable: true, kind: 'checkbox', autoOpen: false },  // 3 auto_schedule
  { editable: true, kind: 'month',    autoOpen: false },  // 4 delivery_months
  { editable: true, kind: 'edit',     autoOpen: true  },  // 5 del/year (number)
]

function CommunityTab({ rows, showTest, onPatchComm, globalMonths, onSaveGlobal }) {
  const filtered = rows.filter(r => showTest ? r.is_test : !r.is_test)
  const [activeCell,      setActiveCell]      = useState(null) // { r, c }
  const [activateSignal,  setActivateSignal]  = useState(0)
  const containerRef = useRef()

  const maxRow = filtered.length - 1

  // Auto-open editable cells immediately on arrow navigation
  useEffect(() => {
    if (!activeCell) return
    const col = COMM_COLS[activeCell.c]
    if (col?.autoOpen) setActivateSignal(s => s + 1)
  }, [activeCell])

  // Capture-phase handler: intercepts arrows before any focused child (e.g. number input) sees them.
  // Date and number inputs are left alone — their internal arrow nav takes priority.
  function handleKeyDown(e) {
    const NAV = ['ArrowUp','ArrowDown','ArrowLeft','ArrowRight']
    if (!NAV.includes(e.key)) return
    const ae = document.activeElement
    if (ae && ae.type === 'date') return   // let date picker handle its own arrows
    if (ae && ae.type === 'number') return // let number input handle up/down spin
    e.preventDefault()
    e.stopPropagation()
    if (ae && ae !== containerRef.current) ae.blur()  // commit any open number/text edit
    setActiveCell(prev => {
      const r = prev?.r ?? 0
      const c = prev?.c ?? 1
      if (e.key === 'ArrowUp')    return { r: Math.max(0, r - 1), c }
      if (e.key === 'ArrowDown')  return { r: Math.min(maxRow, r + 1), c }
      if (e.key === 'ArrowLeft')  return { r, c: Math.max(0, c - 1) }
      if (e.key === 'ArrowRight') return { r, c: Math.min(COMM_COLS.length - 1, c + 1) }
    })
  }

  function onDone() { containerRef.current?.focus() }

  const ac = (r, c) => activeCell?.r === r && activeCell?.c === c

  const thB = {
    padding: '5px 8px', fontSize: 11, fontWeight: 600, color: '#6b7280',
    background: '#f3f4f6', whiteSpace: 'nowrap',
    borderBottom: '2px solid #e5e7eb', position: 'sticky', top: 0, zIndex: 2,
    textAlign: 'left',
  }
  const thR = { ...thB, textAlign: 'right' }
  const thG = { ...thR, borderLeft: '2px solid #e0e0e0' }

  return (
    <div ref={containerRef} tabIndex={0} onKeyDownCapture={handleKeyDown}
         onBlur={e => { if (!containerRef.current?.contains(e.relatedTarget)) setActiveCell(null) }}
         style={{ outline: 'none' }}>
      <TableShell>
        <thead>
          <tr>
            <th style={{ ...thB, width: 200, position: 'sticky', top: 0, left: 0, zIndex: 5,
                         boxShadow: '4px 0 8px -2px rgba(0,0,0,0.08)' }}>
              Community
            </th>
            <th style={{ ...thG, width: 100 }}>Ledger Start</th>
            <th style={{ ...thR, width: 110 }}>Bulk Ent. Date</th>
            <th style={{ ...thG, width: 90, textAlign: 'center' }}>Auto Schedule</th>
            <th style={{ ...thG, width: 240 }}>Delivery Months</th>
            <th style={{ ...thR, width: 72 }}>Del / Year</th>
          </tr>
        </thead>
        <tbody>
          {filtered.length === 0 && (
            <tr><td colSpan={6} style={{ padding: 24, fontSize: 12, color: '#9ca3af', textAlign: 'center' }}>
              No communities.
            </td></tr>
          )}
          {filtered.map((row, i) => {
            const bg = BAND[i % 2]
            const td  = (c, extra = {}) => ({
              padding: '6px 8px', borderTop: '1px solid #f0f0f0', verticalAlign: 'middle',
              ...cellHighlight(ac(i, c), COMM_COLS[c].editable),
              background: ac(i, c) ? (COMM_COLS[c].editable ? '#eff6ff' : '#f1f5f9') : bg,
              ...extra,
            })
            const tdG = (c, extra = {}) => ({ ...td(c, extra), borderLeft: '2px solid #ebebeb' })

            return (
              <tr key={row.ent_group_id} onClick={() => setActiveCell({ r: i, c: activeCell?.c ?? 1 })}>
                <td style={{ ...td(0), position: 'sticky', left: 0, zIndex: 1,
                             boxShadow: '4px 0 8px -2px rgba(0,0,0,0.06)' }}>
                  <span style={{ fontSize: 13, fontWeight: 600, color: '#111827' }}>
                    {row.ent_group_name}
                  </span>
                </td>

                {/* Ledger start = date_paper */}
                <td style={tdG(1, { textAlign: 'right' })}>
                  <EditableCell value={row.date_paper} type="date" width={90}
                    triggerActivate={ac(i, 1) ? activateSignal : 0} onDone={onDone}
                    onSave={v => onPatchComm(row.ent_group_id, 'ledger', { date_paper: v, date_ent: row.date_ent })} />
                </td>

                {/* Bulk ent date = date_ent */}
                <td style={td(2, { textAlign: 'right' })}>
                  <EditableCell value={row.date_ent} type="date" width={100}
                    triggerActivate={ac(i, 2) ? activateSignal : 0} onDone={onDone}
                    onSave={v => onPatchComm(row.ent_group_id, 'ledger', { date_paper: row.date_paper, date_ent: v })} />
                </td>

                {/* Auto schedule */}
                <td style={tdG(3, { textAlign: 'center' })}>
                  <input type="checkbox"
                    checked={row.auto_schedule_enabled ?? false}
                    onChange={e => onPatchComm(row.ent_group_id, 'delivery', { auto_schedule_enabled: e.target.checked })}
                    style={{ cursor: 'pointer', width: 14, height: 14 }}
                  />
                </td>

                {/* Delivery months */}
                <td style={tdG(4, { padding: '5px 8px' })}>
                  <MonthCell months={row.delivery_months}
                    globalMonths={globalMonths}
                    onSave={v => onPatchComm(row.ent_group_id, 'delivery', { delivery_months: v })}
                    onSaveGlobal={onSaveGlobal} />
                </td>

                {/* Deliveries per year */}
                <td style={td(5, { textAlign: 'right' })}>
                  <EditableCell value={row.max_deliveries_per_year} width={60}
                    triggerActivate={ac(i, 5) ? activateSignal : 0} onDone={onDone}
                    onSave={v => onPatchComm(row.ent_group_id, 'delivery', { max_deliveries_per_year: v })} />
                </td>
              </tr>
            )
          })}
        </tbody>
      </TableShell>
    </div>
  )
}

// ─── StartsCell ───────────────────────────────────────────────────────────────
// Editable annual starts target with a reactive supply label below.

function StartsCell({ value, unstarted, onSave, triggerActivate = 0, onDone }) {
  const [editing, setEditing] = useState(false)
  const [draft,   setDraft]   = useState('')
  const [saving,  setSaving]  = useState(false)
  const [error,   setError]   = useState(null)
  const inputRef   = useRef()
  const prevSigRef = useRef(0)

  useEffect(() => {
    if (triggerActivate !== prevSigRef.current) {
      prevSigRef.current = triggerActivate
      if (triggerActivate > 0 && !editing) startEdit()
    }
  }, [triggerActivate]) // eslint-disable-line react-hooks/exhaustive-deps

  const liveTarget = editing ? (parseFloat(draft) || 0) : (value ?? 0)
  const supplyYrs  = liveTarget > 0 && unstarted != null ? unstarted / liveTarget : null

  function supplyLabel() {
    if (supplyYrs == null || liveTarget === 0) return null
    if (unstarted === 0) return 'exhausted'
    if (supplyYrs >= 2)  return `≈ ${supplyYrs.toFixed(1)} yrs`
    return `≈ ${Math.round(supplyYrs * 12)} mo`
  }

  const supplyColor = supplyYrs == null ? null
    : supplyYrs >= 3 ? '#16a34a'
    : supplyYrs >= 1 ? '#d97706'
    : '#dc2626'

  // Focus input after React commits it to DOM
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
    const parsed = raw === '' ? null : Number(raw)
    if (!raw || isNaN(parsed)) { if (raw && isNaN(parsed)) setError('!'); onDone?.(); return }
    if (parsed === value) { onDone?.(); return }
    setSaving(true); setError(null)
    try { await onSave(parsed) }
    catch (e) { setError(String(e).slice(0, 40)) }
    finally { setSaving(false); onDone?.() }
  }

  function onKeyDown(e) {
    if (e.key === 'Escape') { e.stopPropagation(); setEditing(false); onDone?.() }
    if (e.key === 'Enter')  { e.stopPropagation(); commit() }
  }

  const label = supplyLabel()

  return (
    <div style={{ textAlign: 'right' }}>
      <div onClick={startEdit} title={error ?? undefined} style={{ cursor: 'text' }}>
        {editing ? (
          <input ref={inputRef} type="number" min={0}
            value={draft} onChange={e => setDraft(e.target.value)}
            onBlur={commit} onKeyDown={onKeyDown}
            style={{ width: 72, padding: '1px 4px', fontSize: 12, textAlign: 'right',
                     border: '1px solid #2563eb', borderRadius: 3, background: '#fff', outline: 'none' }} />
        ) : (
          <span style={{
            display: 'inline-block', padding: '1px 4px', fontSize: 12, borderRadius: 3,
            background: error ? '#fef2f2' : saving ? '#fef3c7' : 'transparent',
            border: error ? '1px solid #fca5a5' : '1px solid transparent',
            color: value != null ? (error ? '#dc2626' : '#111827') : '#d1d5db',
          }}>
            {error ? `⚠ ${error}` : (value != null ? String(value) : '—')}
          </span>
        )}
      </div>
      {label && (
        <div style={{ fontSize: 10, color: supplyColor, marginTop: 2, paddingRight: 4 }}>
          {label} supply
        </div>
      )}
    </div>
  )
}

// ─── Development tab ──────────────────────────────────────────────────────────

const CUR_YEAR = new Date().getFullYear()

// Dev tab column metadata (0-8)
const DEV_COLS = [
  { editable: false },                                    // 0 community
  { editable: false },                                    // 1 development
  { editable: false },                                    // 2 proj
  { editable: false },                                    // 3 unstarted
  { editable: false },                                    // 4 ytd
  { editable: false },                                    // 5 last yr
  { editable: false },                                    // 6 2yr ago
  { editable: true, kind: 'starts', autoOpen: true },    // 7 annual starts
  { editable: true, kind: 'edit',   autoOpen: true },    // 8 max/month
]

function DevTab({ rows, showTest, onPatchDev }) {
  const filtered = rows.filter(r => showTest ? r.is_test : !r.is_test)
  const bi = bandIdx(filtered, r => r.ent_group_id)
  const [activeCell,     setActiveCell]     = useState(null)
  const [activateSignal, setActivateSignal] = useState(0)
  const containerRef = useRef()

  const maxRow = filtered.length - 1

  useEffect(() => {
    if (!activeCell) return
    const col = DEV_COLS[activeCell.c]
    if (col?.autoOpen) setActivateSignal(s => s + 1)
  }, [activeCell])

  function handleKeyDown(e) {
    const NAV = ['ArrowUp','ArrowDown','ArrowLeft','ArrowRight']
    if (!NAV.includes(e.key)) return
    const ae = document.activeElement
    if (ae && ae.type === 'date') return
    if (ae && ae.type === 'number') return
    e.preventDefault()
    e.stopPropagation()
    if (ae && ae !== containerRef.current) ae.blur()
    setActiveCell(prev => {
      const r = prev?.r ?? 0
      const c = prev?.c ?? 7
      if (e.key === 'ArrowUp')    return { r: Math.max(0, r - 1), c }
      if (e.key === 'ArrowDown')  return { r: Math.min(maxRow, r + 1), c }
      if (e.key === 'ArrowLeft')  return { r, c: Math.max(0, c - 1) }
      if (e.key === 'ArrowRight') return { r, c: Math.min(DEV_COLS.length - 1, c + 1) }
    })
  }

  function onDone() { containerRef.current?.focus() }

  const ac = (r, c) => activeCell?.r === r && activeCell?.c === c

  const thB = {
    padding: '5px 8px', fontSize: 11, fontWeight: 600, color: '#6b7280',
    background: '#f3f4f6', whiteSpace: 'nowrap',
    borderBottom: '2px solid #e5e7eb', position: 'sticky', top: 0, zIndex: 2,
  }
  const thR  = { ...thB, textAlign: 'right' }
  const thGR = { ...thR, borderLeft: '2px solid #e0e0e0' }

  return (
    <div ref={containerRef} tabIndex={0} onKeyDownCapture={handleKeyDown}
         onBlur={e => { if (!containerRef.current?.contains(e.relatedTarget)) setActiveCell(null) }}
         style={{ outline: 'none' }}>
      <TableShell>
        <thead>
          <tr>
            <th style={{ ...thB, width: 180, position: 'sticky', left: 0, zIndex: 5,
                         boxShadow: '4px 0 8px -2px rgba(0,0,0,0.08)' }}>Community</th>
            <th style={{ ...thB, width: 160 }}>Development</th>
            {/* Read-only context */}
            <th style={{ ...thGR, width: 60 }} title="Sum of product split projected counts across all phases">Proj</th>
            <th style={{ ...thR,  width: 68 }} title="Real lots with no start date (still in pipeline)">Unstarted</th>
            <th style={{ ...thR,  width: 60 }} title={`Actual starts YTD (${CUR_YEAR})`}>{CUR_YEAR}</th>
            <th style={{ ...thR,  width: 60 }} title={`Actual starts in ${CUR_YEAR - 1}`}>{CUR_YEAR - 1}</th>
            <th style={{ ...thR,  width: 60 }} title={`Actual starts in ${CUR_YEAR - 2}`}>{CUR_YEAR - 2}</th>
            {/* Editable */}
            <th style={{ ...thGR, width: 110 }}>Annual Starts</th>
            <th style={{ ...thR,  width: 90  }}>Max / Month</th>
          </tr>
        </thead>
        <tbody>
          {filtered.length === 0 && (
            <tr><td colSpan={9} style={{ padding: 24, fontSize: 12, color: '#9ca3af', textAlign: 'center' }}>
              No developments.
            </td></tr>
          )}
          {filtered.map((row, i) => {
            const prev = filtered[i - 1]
            const isFirstComm = i === 0 || row.ent_group_id !== prev.ent_group_id
            const bg = BAND[(bi[row.ent_group_id] ?? 0) % 2]
            const topBorder = isFirstComm ? '2px solid #e5e7eb' : '1px solid #f0f0f0'

            const td  = (c, extra = {}) => ({
              padding: '5px 8px', borderTop: topBorder, verticalAlign: 'top',
              ...cellHighlight(ac(i, c), DEV_COLS[c].editable),
              background: ac(i, c) ? (DEV_COLS[c].editable ? '#eff6ff' : '#f1f5f9') : bg,
              ...extra,
            })
            const tdG = (c, extra = {}) => ({ ...td(c, extra), borderLeft: '2px solid #ebebeb' })

            const noParams = row.annual_starts_target == null

            const num = (v, dim) => (
              <span style={{ fontSize: 12, display: 'block', textAlign: 'right', padding: '1px 4px',
                             color: v > 0 ? '#374151' : '#d1d5db' }}>
                {v > 0 ? v : (dim ? '—' : '0')}
              </span>
            )

            const paceYears = [row.starts_last_year, row.starts_2yr_ago].filter(v => v > 0)
            const pace2yr   = paceYears.length > 0
              ? Math.round(paceYears.reduce((s, v) => s + v, 0) / paceYears.length)
              : null

            return (
              <tr key={`${row.ent_group_id}-${row.dev_id}`}
                  onClick={() => setActiveCell({ r: i, c: activeCell?.c ?? 7 })}>
                <td style={{ ...td(0), position: 'sticky', left: 0, zIndex: 1,
                             boxShadow: '4px 0 8px -2px rgba(0,0,0,0.06)' }}>
                  <span style={{ fontSize: 12, color: isFirstComm ? '#374151' : '#d1d5db',
                                 fontWeight: isFirstComm ? 500 : 400 }}>
                    {isFirstComm ? row.ent_group_name : '·'}
                  </span>
                </td>
                <td style={td(1)}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ fontSize: 12, color: '#111827' }}>{row.dev_name}</span>
                    {noParams && (
                      <span style={{ fontSize: 10, color: '#d97706', background: '#fef9c3',
                                     border: '1px solid #fcd34d', borderRadius: 3, padding: '0 4px' }}>
                        no params
                      </span>
                    )}
                  </div>
                  {pace2yr != null && (
                    <div style={{ fontSize: 10, color: '#9ca3af', marginTop: 2 }}>
                      {pace2yr}/yr avg ({CUR_YEAR - 2}–{CUR_YEAR - 1})
                    </div>
                  )}
                </td>
                {/* Read-only context columns */}
                <td style={tdG(2, { textAlign: 'right', verticalAlign: 'middle' })}>{num(row.total_projected, true)}</td>
                <td style={td(3,  { textAlign: 'right', verticalAlign: 'middle' })}>{num(row.unstarted_real, true)}</td>
                <td style={td(4,  { textAlign: 'right', verticalAlign: 'middle' })}>{num(row.starts_ytd)}</td>
                <td style={td(5,  { textAlign: 'right', verticalAlign: 'middle' })}>{num(row.starts_last_year)}</td>
                <td style={td(6,  { textAlign: 'right', verticalAlign: 'middle' })}>{num(row.starts_2yr_ago)}</td>
                {/* Editable */}
                <td style={tdG(7, { textAlign: 'right' })}>
                  <StartsCell
                    value={row.annual_starts_target}
                    unstarted={row.unstarted_real}
                    triggerActivate={ac(i, 7) ? activateSignal : 0} onDone={onDone}
                    onSave={v => onPatchDev(row.dev_id, { annual_starts_target: v })}
                  />
                </td>
                <td style={td(8, { textAlign: 'right', verticalAlign: 'middle' })}>
                  <EditableCell value={row.max_starts_per_month} width={78}
                    triggerActivate={ac(i, 8) ? activateSignal : 0} onDone={onDone}
                    onSave={v => onPatchDev(row.dev_id, { max_starts_per_month: v })}
                    placeholder="—" />
                </td>
              </tr>
            )
          })}
        </tbody>
      </TableShell>
    </div>
  )
}

// ─── SpecRateCell ─────────────────────────────────────────────────────────────
// Editable spec rate for an instrument with collapsible hint panel.
// Hints are grouped: company-wide curves weighted to instrument, and instrument history.
// Each hint shows sample size; warnings surface as amber styling + tooltip.

function SpecRateCell({ instrumentId, value, onSave }) {
  const [editing,      setEditing]      = useState(false)
  const [draft,        setDraft]        = useState('')
  const [saving,       setSaving]       = useState(false)
  const [error,        setError]        = useState(null)
  const [hints,        setHints]        = useState(null)
  const [hintsOpen,    setHintsOpen]    = useState(false)
  const [hintsLoading, setHintsLoading] = useState(false)
  const inputRef = useRef()

  useEffect(() => {
    if (editing) { inputRef.current?.focus(); inputRef.current?.select() }
  }, [editing])

  function startEdit() {
    if (saving) return
    setDraft(value != null ? String(Math.round(value * 1000) / 10) : '')
    setEditing(true)
  }

  async function commit() {
    setEditing(false)
    const raw = draft.trim()
    if (raw === '') {
      if (value == null) return
      setSaving(true); setError(null)
      try { await onSave(null) } catch (e) { setError(String(e).slice(0, 40)) } finally { setSaving(false) }
      return
    }
    const pct = parseFloat(raw)
    if (isNaN(pct) || pct < 0 || pct > 100) { setError('0–100'); return }
    const frac = Math.round(pct * 10) / 1000
    if (frac === value) return
    setSaving(true); setError(null)
    try { await onSave(frac) } catch (e) { setError(String(e).slice(0, 40)) } finally { setSaving(false) }
  }

  function onKeyDown(e) {
    if (e.key === 'Escape') { e.stopPropagation(); setEditing(false) }
    if (e.key === 'Enter')  { e.stopPropagation(); commit() }
  }

  async function toggleHints() {
    if (hintsOpen) { setHintsOpen(false); return }
    if (hints)     { setHintsOpen(true);  return }
    setHintsLoading(true)
    setHintsOpen(true)
    try {
      const res = await fetch(`${API_BASE}/instruments/${instrumentId}/spec-rate-hints`)
      if (res.ok) setHints(await res.json())
    } catch (_) {}
    finally { setHintsLoading(false) }
  }

  function applyHint(frac) {
    if (frac == null) return
    onSave(frac)
  }

  // Render one hint button. hint = {value, lot_count, warning} | null
  function HintBtn({ label, hint }) {
    const v    = hint?.value ?? null
    const n    = hint?.lot_count ?? 0
    const warn = hint?.warning ?? null
    const hasV = v != null
    const pct  = hasV ? `${Math.round(v * 1000) / 10}%` : null
    const tooltip = warn ?? (hasV ? `Apply ${pct} (n=${n})` : 'No data available')
    return (
      <button
        onClick={() => hasV && applyHint(v)}
        disabled={!hasV}
        title={tooltip}
        style={{
          fontSize: 10, padding: '1px 5px', borderRadius: 3,
          cursor: hasV ? 'pointer' : 'default', whiteSpace: 'nowrap', fontWeight: 600,
          border:      `1px solid ${!hasV ? '#e5e7eb' : warn ? '#fcd34d' : '#d1fae5'}`,
          background:  !hasV ? '#f9fafb' : warn ? '#fffbeb' : '#f0fdfa',
          color:       !hasV ? '#9ca3af' : warn ? '#b45309' : '#0d9488',
        }}
      >
        {label}{pct ? `: ${pct}` : ''}{n > 0 ? ` (${n})` : ''}{warn ? ' ⚠' : ''}
      </button>
    )
  }

  const pctLabel = v => v != null ? `${Math.round(v * 1000) / 10}%` : null

  return (
    <div style={{ minWidth: 120 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 4, justifyContent: 'flex-end' }}>
        <div onClick={startEdit} title={error ?? undefined} style={{ cursor: 'text' }}>
          {editing ? (
            <input ref={inputRef} type="number" min={0} max={100} step={0.1}
              value={draft} onChange={e => setDraft(e.target.value)}
              onBlur={commit} onKeyDown={onKeyDown}
              placeholder="%"
              style={{ width: 60, padding: '1px 4px', fontSize: 12, textAlign: 'right',
                       border: '1px solid #2563eb', borderRadius: 3, background: '#fff', outline: 'none' }} />
          ) : (
            <span style={{
              display: 'inline-block', padding: '1px 4px', fontSize: 12, borderRadius: 3,
              background: error ? '#fef2f2' : saving ? '#fef3c7' : 'transparent',
              border: error ? '1px solid #fca5a5' : '1px solid transparent',
              color: value != null ? (error ? '#dc2626' : '#0d9488') : '#d1d5db',
              fontWeight: value != null ? 600 : 400,
            }}>
              {error ? `⚠ ${error}` : (value != null ? pctLabel(value) : '—')}
            </span>
          )}
        </div>
        <button
          onClick={toggleHints}
          title={hintsOpen ? 'Collapse hints' : 'Show spec rate hints from MARKS history'}
          style={{
            fontSize: 10, padding: '1px 5px', borderRadius: 3, cursor: 'pointer',
            border: '1px solid #e5e7eb', background: hintsOpen ? '#f3f4f6' : '#fff',
            color: '#6b7280', lineHeight: 1.4,
          }}
        >
          {hintsLoading ? '…' : `hints ${hintsOpen ? '▾' : '▸'}`}
        </button>
      </div>

      {hintsOpen && hints && (
        <div style={{ marginTop: 5 }}>
          <div style={{ fontSize: 9, color: '#9ca3af', textAlign: 'right', marginBottom: 2 }}>
            company-wide, weighted to instrument
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3, justifyContent: 'flex-end', marginBottom: 5 }}>
            <HintBtn label="Bldr 1yr"    hint={hints.computed_builder_1yr} />
            <HintBtn label="Bldr 2yr"    hint={hints.computed_builder_2yr} />
            <HintBtn label="Bldr×LT 1yr" hint={hints.computed_blt_1yr} />
            <HintBtn label="Bldr×LT 2yr" hint={hints.computed_blt_2yr} />
          </div>
          <div style={{ fontSize: 9, color: '#9ca3af', textAlign: 'right', marginBottom: 2 }}>
            instrument history (closed lots)
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3, justifyContent: 'flex-end' }}>
            <HintBtn label="1yr"     hint={hints.historical_1yr} />
            <HintBtn label="2yr"     hint={hints.historical_2yr} />
            <HintBtn label="All-time" hint={hints.historical_alltime} />
          </div>
        </div>
      )}

      {hintsOpen && !hints && !hintsLoading && (
        <div style={{ fontSize: 10, color: '#9ca3af', textAlign: 'right', marginTop: 4 }}>
          Failed to load hints.
        </div>
      )}
    </div>
  )
}

// ─── Instrument tab ───────────────────────────────────────────────────────────

function InstrumentTab({ phaseRows, showTest, builders, onSaveSpecRate, onSaveBuilderSplit }) {
  const [localInstSplits, setLocalInstSplits] = useState({}) // { instrument_id: { builder_id: share } }

  // Derive instrument summary from phase data
  const filtered = phaseRows.filter(r => showTest ? r.is_test : !r.is_test)
  const instMap = new Map()
  for (const r of filtered) {
    const k = r.instrument_id
    if (!instMap.has(k)) {
      instMap.set(k, {
        ent_group_id: r.ent_group_id, ent_group_name: r.ent_group_name,
        dev_id: r.dev_id, dev_name: r.dev_name,
        instrument_id: k, instrument_name: r.instrument_name,
        spec_rate: r.spec_rate ?? null,
        builder_splits: r.builder_splits ?? {},
        phases: [],
      })
    }
    instMap.get(k).phases.push(r)
  }

  async function handleBuilderSplit(instrumentId, builderId, pctValue) {
    const share = pctValue != null ? Math.min(1, Math.max(0, Math.round(pctValue) / 100)) : null
    // Complement: for a 2-builder setup, auto-set the other builder
    const complement = builders.length === 2 ? builders.find(b => b.builder_id !== builderId) : null
    const compShare  = (complement && share != null) ? Math.round((1 - share) * 100) / 100 : null
    // Optimistic update
    setLocalInstSplits(prev => {
      const base = { ...(instMap.get(instrumentId)?.builder_splits ?? {}), ...(prev[instrumentId] ?? {}) }
      base[builderId] = share
      if (complement && compShare != null) base[complement.builder_id] = compShare
      return { ...prev, [instrumentId]: base }
    })
    const saves = [onSaveBuilderSplit(instrumentId, builderId, share)]
    if (complement) saves.push(onSaveBuilderSplit(instrumentId, complement.builder_id, compShare))
    await Promise.all(saves)
  }
  const rows = [...instMap.values()].sort((a, b) =>
    a.ent_group_name.localeCompare(b.ent_group_name) ||
    a.dev_name.localeCompare(b.dev_name) ||
    a.instrument_name?.localeCompare(b.instrument_name ?? '')
  )

  const bi = bandIdx(rows, r => r.ent_group_id)

  const thB = {
    padding: '5px 8px', fontSize: 11, fontWeight: 600, color: '#6b7280',
    background: '#f3f4f6', whiteSpace: 'nowrap',
    borderBottom: '2px solid #e5e7eb', position: 'sticky', top: 0, zIndex: 2,
  }
  const thR = { ...thB, textAlign: 'right' }
  const thG = { ...thR, borderLeft: '2px solid #e0e0e0' }

  return (
    <div>
      <TableShell>
        <thead>
          <tr>
            <th style={{ ...thB, width: 180, position: 'sticky', left: 0, zIndex: 5,
                         boxShadow: '4px 0 8px -2px rgba(0,0,0,0.08)' }}>Community</th>
            <th style={{ ...thB, width: 160 }}>Development</th>
            <th style={{ ...thB, width: 160 }}>Instrument</th>
            <th style={{ ...thG,  width: 72 }}>Phases</th>
            <th style={{ ...thR,  width: 60 }}>Proj</th>
            <th style={{ ...thR,  width: 56 }} title="In MARKS">In MARKS</th>
            <th style={{ ...thR,  width: 60 }} title="Pre-MARKS">Pre-MARKS</th>
            <th style={{ ...thR,  width: 44 }}>Sim</th>
            <th style={{ ...thR,  width: 44 }}>Excl</th>
            <th style={{ ...thG,  width: 160 }} title="Spec rate applies to undetermined lots (is_spec IS NULL) via S-0950">Spec Rate</th>
            {builders.map((b, i) => (
              <th key={b.builder_id} style={{ ...thR, width: 74,
                ...(i === 0 ? { borderLeft: '2px solid #e0e0e0' } : {}) }}
                title={`${b.builder_name} — instrument builder split %`}>
                {b.builder_name.split(' ')[0]}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && (
            <tr><td colSpan={10 + builders.length} style={{ padding: 24, fontSize: 12, color: '#9ca3af', textAlign: 'center' }}>
              No instruments.
            </td></tr>
          )}
          {rows.map((row, i) => {
            const prev = rows[i - 1]
            const isFirstComm = i === 0 || row.ent_group_id !== prev?.ent_group_id
            const isFirstDev  = i === 0 || row.dev_id       !== prev?.dev_id || isFirstComm
            const bg = BAND[(bi[row.ent_group_id] ?? 0) % 2]
            const topBorder = isFirstComm ? '2px solid #e5e7eb' : isFirstDev ? '1px solid #e9e9e9' : '1px solid #f3f4f6'

            const td  = (extra = {}) => ({ padding: '5px 8px', background: bg, borderTop: topBorder,
                                           verticalAlign: 'top', ...extra })
            const tdG = (extra = {}) => ({ ...td(extra), borderLeft: '2px solid #ebebeb' })

            const phaseCount = row.phases.length
            let projTotal = 0, marksTotal = 0, preTotal = 0, exclTotal = 0
            for (const p of row.phases) {
              projTotal  += Object.values(p.product_splits  ?? {}).reduce((s, v) => s + (v        ?? 0), 0)
              marksTotal += Object.values(p.lot_type_counts ?? {}).reduce((s, v) => s + (v.marks  ?? 0), 0)
              preTotal   += Object.values(p.lot_type_counts ?? {}).reduce((s, v) => s + (v.pre    ?? 0), 0)
              exclTotal  += Object.values(p.lot_type_counts ?? {}).reduce((s, v) => s + (v.excl   ?? 0), 0)
            }
            const simTotal = Math.max(0, projTotal - marksTotal - preTotal)
            const num = v => (
              <span style={{ fontSize: 12, display: 'block', textAlign: 'right', padding: '1px 4px',
                             color: v > 0 ? '#374151' : '#d1d5db' }}>
                {v > 0 ? v : '—'}
              </span>
            )
            const dim = (show, text) => (
              <span style={{ fontSize: 12, color: show ? '#374151' : '#d1d5db', fontWeight: show ? 500 : 400 }}>
                {show ? text : '·'}
              </span>
            )

            return (
              <tr key={row.instrument_id}>
                <td style={{ ...td(), position: 'sticky', left: 0, zIndex: 1,
                             boxShadow: '4px 0 8px -2px rgba(0,0,0,0.06)' }}>
                  {dim(isFirstComm, row.ent_group_name)}
                </td>
                <td style={td()}>{dim(isFirstDev, row.dev_name)}</td>
                <td style={td()}>
                  <span style={{ fontSize: 12, color: '#111827' }}>{row.instrument_name ?? '—'}</span>
                </td>
                <td style={tdG({ textAlign: 'right', verticalAlign: 'middle' })}>{num(phaseCount)}</td>
                <td style={td({ textAlign: 'right', verticalAlign: 'middle' })}>{num(projTotal)}</td>
                <td style={td({ textAlign: 'right', verticalAlign: 'middle' })}>{num(marksTotal)}</td>
                <td style={td({ textAlign: 'right', verticalAlign: 'middle' })}>{num(preTotal)}</td>
                <td style={td({ textAlign: 'right', verticalAlign: 'middle' })}>{num(simTotal)}</td>
                <td style={td({ textAlign: 'right', verticalAlign: 'middle' })}>
                  {exclTotal > 0
                    ? <span style={{ fontSize: 11, color: '#9ca3af' }}>{exclTotal}</span>
                    : <span style={{ color: '#d1d5db' }}>—</span>}
                </td>
                <td style={tdG({ verticalAlign: 'top', paddingTop: 6 })}>
                  <SpecRateCell
                    instrumentId={row.instrument_id}
                    value={row.spec_rate}
                    onSave={v => onSaveSpecRate(row.instrument_id, v)}
                  />
                </td>
                {builders.map((b, idx) => {
                  const splits    = { ...row.builder_splits, ...(localInstSplits[row.instrument_id] ?? {}) }
                  const rawShare  = splits[b.builder_id] ?? null
                  const pctDisplay = rawShare != null ? Math.round(rawShare * 100) : null
                  // Actual committed lots: sum across all phases of this instrument
                  const totalReal = row.phases.reduce((s, p) => {
                    const ltc = p.lot_type_counts ?? {}
                    return s + Object.values(ltc).reduce((a, v) => a + (v.marks ?? 0) + (v.pre ?? 0), 0)
                  }, 0)
                  const actualCnt = row.phases.reduce((s, p) => {
                    const abc = p.actual_builder_counts ?? {}
                    return s + (abc[b.builder_id] ?? 0)
                  }, 0)
                  return (
                    <td key={b.builder_id} style={{
                      ...td({ textAlign: 'right', verticalAlign: 'top', paddingBottom: 5 }),
                      ...(idx === 0 ? { borderLeft: '2px solid #e0e0e0' } : {}),
                    }}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 2 }}>
                        <EditableCell value={pctDisplay} width={46} placeholder="—" min={0}
                          onSave={v => handleBuilderSplit(row.instrument_id, b.builder_id, v)} />
                        {pctDisplay != null && <span style={{ fontSize: 11, color: '#6b7280', marginLeft: 1 }}>%</span>}
                      </div>
                      {totalReal > 0 && (
                        <div style={{ fontSize: 10, color: actualCnt > 0 ? '#60a5fa' : '#d1d5db',
                                      textAlign: 'right', marginTop: 2, paddingRight: 2 }}
                          title={`${actualCnt} of ${totalReal} committed lots assigned to ${b.builder_name}`}>
                          {actualCnt}&thinsp;/&thinsp;{totalReal} act
                        </div>
                      )}
                    </td>
                  )
                })}
              </tr>
            )
          })}
        </tbody>
      </TableShell>
    </div>
  )
}

// ─── Phase tab ────────────────────────────────────────────────────────────────

function PhaseTab({ phaseData, showTest, onPatchPhase, onSaveProductSplit, onToggleLock, onLotsAdded }) {
  const [filterComm,    setFilterComm]    = useState(null)
  const [filterDev,     setFilterDev]     = useState(null)
  const [showSplits,    setShowSplits]    = useState(true)
  const [bulkInsertPhase, setBulkInsertPhase] = useState(null) // row object or null

  const allRows  = phaseData?.rows ?? []
  const testRows = allRows.filter(r => showTest ? r.is_test : !r.is_test)

  const communities = [...new Map(
    testRows.map(r => [r.ent_group_id, { id: String(r.ent_group_id), name: r.ent_group_name }])
  ).values()]
  const devsByComm = testRows.reduce((acc, r) => {
    const k = String(r.ent_group_id)
    if (!acc[k]) acc[k] = []
    if (!acc[k].find(d => d.id === String(r.dev_id)))
      acc[k].push({ id: String(r.dev_id), name: r.dev_name })
    return acc
  }, {})

  const rows = testRows.filter(r => {
    if (filterComm && String(r.ent_group_id) !== filterComm) return false
    if (filterDev  && String(r.dev_id)       !== filterDev)  return false
    return true
  })

  const bi = bandIdx(rows, r => r.ent_group_id)

  // Precompute subtotals at each hierarchy level
  const commSubs = {}, devSubs = {}, instSubs = {}
  for (const r of rows) {
    const proj = Object.values(r.product_splits ?? {}).reduce((s, v) => s + (v ?? 0), 0)
    const cid = r.ent_group_id
    const dk  = `${r.ent_group_id}|${r.dev_id}`
    const iid = r.instrument_id
    if (!commSubs[cid]) commSubs[cid] = { devs: new Set(), insts: new Set(), phases: 0, lots: 0 }
    commSubs[cid].devs.add(r.dev_id); commSubs[cid].insts.add(r.instrument_id)
    commSubs[cid].phases++; commSubs[cid].lots += proj
    if (!devSubs[dk])  devSubs[dk]  = { insts: new Set(), phases: 0, lots: 0 }
    devSubs[dk].insts.add(r.instrument_id); devSubs[dk].phases++; devSubs[dk].lots += proj
    if (!instSubs[iid]) instSubs[iid] = { phases: 0, lots: 0 }
    instSubs[iid].phases++; instSubs[iid].lots += proj
  }

  const SUB_W = { comm: 76, dev: 90, inst: 72, phase: 50, lots: 56 }
  const SUB_ROW1_H = 26

  const lotTypes = phaseData?.lot_types ?? []
  const builders = phaseData?.builders  ?? []

  const thBase = {
    padding: '5px 7px', fontSize: 11, fontWeight: 600, color: '#6b7280',
    background: '#f3f4f6', whiteSpace: 'nowrap',
    borderBottom: '2px solid #e5e7eb', position: 'sticky', top: 0,
  }
  const thS  = (left, w, extra = {}) => ({ ...thBase, left, zIndex: 5, width: w, minWidth: w, ...extra })
  const thR  = (extra = {}) => ({ ...thBase, zIndex: 2, textAlign: 'right', ...extra })
  const thGR = (extra = {}) => ({ ...thR(extra), borderLeft: '2px solid #e0e0e0' })

  // Filter bar
  const devOptions = filterComm ? (devsByComm[filterComm] ?? [])
                                : Object.values(devsByComm).flat()
  const selStyle = on => ({
    fontSize: 12, padding: '3px 24px 3px 8px', borderRadius: 4,
    border: on ? '1px solid #2563eb' : '1px solid #d1d5db',
    background: on ? '#eff6ff' : '#fff', color: on ? '#1d4ed8' : '#374151',
    appearance: 'none', cursor: 'pointer',
  })

  return (
    <>
    <div>
      {/* Filter bar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 12, color: '#9ca3af', fontWeight: 500 }}>Filter</span>
        <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
          <select value={filterComm ?? ''} style={selStyle(!!filterComm)}
            onChange={e => { setFilterComm(e.target.value || null); setFilterDev(null) }}>
            <option value="">All communities</option>
            {communities.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          {filterComm && <button onClick={() => { setFilterComm(null); setFilterDev(null) }}
            style={{ position: 'absolute', right: 6, fontSize: 13, lineHeight: 1,
                     background: 'none', border: 'none', color: '#2563eb', cursor: 'pointer', padding: 0 }}>×</button>}
        </div>
        <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
          <select value={filterDev ?? ''} style={selStyle(!!filterDev)}
            onChange={e => setFilterDev(e.target.value || null)}>
            <option value="">All developments</option>
            {devOptions.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
          {filterDev && <button onClick={() => setFilterDev(null)}
            style={{ position: 'absolute', right: 6, fontSize: 13, lineHeight: 1,
                     background: 'none', border: 'none', color: '#2563eb', cursor: 'pointer', padding: 0 }}>×</button>}
        </div>
        {(filterComm || filterDev) && (
          <button onClick={() => { setFilterComm(null); setFilterDev(null) }}
            style={{ fontSize: 11, color: '#6b7280', background: '#f3f4f6',
                     border: '1px solid #e5e7eb', borderRadius: 4, padding: '3px 8px', cursor: 'pointer' }}>
            Clear all
          </button>
        )}
        <button onClick={() => setShowSplits(v => !v)} style={{
          fontSize: 11, padding: '2px 10px', borderRadius: 4, cursor: 'pointer',
          border: showSplits ? '1px solid #2563eb' : '1px solid #d1d5db',
          background: showSplits ? '#eff6ff' : '#fff', color: showSplits ? '#1d4ed8' : '#6b7280',
          marginLeft: 'auto',
        }}>
          {showSplits ? 'Hide' : 'Show'} product splits
        </button>
        <span style={{ fontSize: 11, color: '#9ca3af' }}>
          {rows.length} phase{rows.length !== 1 ? 's' : ''}
        </span>
      </div>

      <TableShell maxHeight="calc(100vh - 200px)">
        <thead>
          <tr>
            <th rowSpan={2} style={thS(LEFT.comm,  CW.comm)}>Community</th>
            <th rowSpan={2} style={thS(LEFT.dev,   CW.dev)}>Development</th>
            <th rowSpan={2} style={thS(LEFT.inst,  CW.inst)}>Instrument</th>
            <th rowSpan={2} style={thS(LEFT.phase, CW.phase, PHASE_SHADOW)}>Phase</th>
            <th rowSpan={2} style={thGR({ width: 52 })} title="Sum of projected counts">Proj</th>
            <th rowSpan={2} style={thR({  width: 56 })} title="In MARKS">In MARKS</th>
            <th rowSpan={2} style={thR({  width: 60 })} title="Pre-MARKS">Pre-MARKS</th>
            <th rowSpan={2} style={thR({  width: 44 })} title="Sim lots">Sim</th>
            <th rowSpan={2} style={thR({  width: 44 })} title="Excluded lots">Excl</th>
            <th rowSpan={2} style={thGR({ width: 90 })}>Dev Date</th>
            <th rowSpan={2} style={thR({  width: 84 })}>Lock</th>
            {showSplits && lotTypes.map((lt, i) => (
              <th key={lt.lot_type_id} rowSpan={2} style={{ ...thR({ width: 68 }),
                ...(i === 0 ? { borderLeft: '2px solid #e0e0e0' } : {}) }} title={lt.lot_type_name}>
                {lt.lot_type_short}
              </th>
            ))}
            <th colSpan={5} style={{ ...thBase, textAlign: 'center',
              borderLeft: '3px solid #c7d2e2', fontSize: 10, color: '#9ca3af',
              letterSpacing: '0.09em', textTransform: 'uppercase', fontWeight: 700,
              paddingBottom: 2 }}>
              Subtotals
            </th>
          </tr>
          <tr>
            <th style={{ ...thBase, top: SUB_ROW1_H, width: SUB_W.comm, textAlign: 'right',
                         borderLeft: '3px solid #c7d2e2' }}>Community</th>
            <th style={{ ...thBase, top: SUB_ROW1_H, width: SUB_W.dev,  textAlign: 'right' }}>Development</th>
            <th style={{ ...thBase, top: SUB_ROW1_H, width: SUB_W.inst, textAlign: 'right' }}>Instrument</th>
            <th style={{ ...thBase, top: SUB_ROW1_H, width: SUB_W.phase,textAlign: 'right' }}>Phase</th>
            <th style={{ ...thBase, top: SUB_ROW1_H, width: SUB_W.lots, textAlign: 'right' }}>Lots</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && (
            <tr><td colSpan={99} style={{ padding: 24, fontSize: 12, color: '#9ca3af', textAlign: 'center' }}>
              No phases match the current filter.
            </td></tr>
          )}
          {rows.map((row, i) => {
            const prev = rows[i - 1]
            const isFirstComm = i === 0 || row.ent_group_id  !== prev.ent_group_id
            const isFirstDev  = i === 0 || row.dev_id        !== prev.dev_id
            const isFirstInst = i === 0 || row.instrument_id !== prev.instrument_id
            const bg = BAND[(bi[row.ent_group_id] ?? 0) % 2]
            const topBorder = isFirstDev ? '2px solid #e5e7eb' : isFirstInst ? '1px solid #e9e9e9' : '1px solid #f3f4f6'

            const ltc = row.lot_type_counts ?? {}
            const ps  = row.product_splits  ?? {}
            const projTotal  = Object.values(ps).reduce((s, v) => s + (v        ?? 0), 0)
            const marksTotal = Object.values(ltc).reduce((s, v) => s + (v.marks  ?? 0), 0)
            const preTotal   = Object.values(ltc).reduce((s, v) => s + (v.pre    ?? 0), 0)
            const exclTotal  = Object.values(ltc).reduce((s, v) => s + (v.excl   ?? 0), 0)
            const simTotal   = Math.max(0, projTotal - marksTotal - preTotal)
            const isLocked  = !!row.date_dev_actual
            const canLock   = !!row.date_dev_projected

            const tdB = (extra = {}) => ({ padding: '4px 6px', background: bg, borderTop: topBorder, verticalAlign: 'middle', ...extra })
            const tdS = (left, extra = {}) => ({ ...tdB(extra), position: 'sticky', left, zIndex: 1 })
            const tdG = (extra = {}) => ({ ...tdB(extra), borderLeft: '2px solid #ebebeb' })

            const dimText = (show, text) => (
              <span style={{ fontSize: 12, color: show ? '#374151' : '#d1d5db',
                             fontWeight: show ? 500 : 400, display: 'block', paddingLeft: show ? 0 : 11 }}>
                {show ? text : '·'}
              </span>
            )
            const numCell = val => (
              <span style={{ fontSize: 12, display: 'block', padding: '1px 4px', textAlign: 'right',
                             color: val > 0 ? '#374151' : '#d1d5db' }}>
                {val > 0 ? val : '—'}
              </span>
            )

            return (
              <tr key={row.phase_id}>
                <td style={tdS(LEFT.comm)}>{dimText(isFirstComm, row.ent_group_name)}</td>
                <td style={tdS(LEFT.dev)}>{dimText(isFirstDev, row.dev_name)}</td>
                <td style={tdS(LEFT.inst)}>{dimText(isFirstInst, row.instrument_name ?? '—')}</td>
                <td style={tdS(LEFT.phase, PHASE_SHADOW)}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                    <span style={{ fontSize: 12, color: '#374151', flex: 1 }}>{row.phase_name}</span>
                    <button
                      onClick={() => setBulkInsertPhase(row)}
                      title="Add lots"
                      style={{
                        flexShrink: 0, width: 16, height: 16, borderRadius: 3,
                        border: '1px solid #d1d5db', background: 'white',
                        color: '#6b7280', fontSize: 11, lineHeight: 1, cursor: 'pointer',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                      }}
                    >+</button>
                  </div>
                </td>
                <td style={tdG({ textAlign: 'right' })}>{numCell(projTotal)}</td>
                <td style={tdB({ textAlign: 'right' })}>{numCell(marksTotal)}</td>
                <td style={tdB({ textAlign: 'right' })}>{numCell(preTotal)}</td>
                <td style={tdB({ textAlign: 'right' })}>{numCell(simTotal)}</td>
                <td style={tdB({ textAlign: 'right' })}>
                  {exclTotal > 0
                    ? <span style={{ fontSize: 11, color: '#9ca3af' }}>{exclTotal}</span>
                    : <span style={{ fontSize: 12, color: '#d1d5db' }}>—</span>}
                </td>
                <td style={tdG({ textAlign: 'right' })}>
                  <EditableCell value={row.date_dev_projected} type="date" width={84}
                    onSave={v => onPatchPhase(row.phase_id, 'date_dev_projected', v)} placeholder="—" />
                </td>
                <td style={tdB({ textAlign: 'center' })}>
                  <LockButton locked={isLocked} disabled={!canLock}
                    onToggle={shouldLock => onToggleLock(row, shouldLock)} />
                </td>
                {showSplits && lotTypes.map((lt, idx) => {
                  const projVal  = ps[lt.lot_type_id] ?? null
                  const ltCounts = ltc[lt.lot_type_id] ?? {}
                  const m = ltCounts.marks ?? 0
                  const p = ltCounts.pre   ?? 0
                  const x = ltCounts.excl  ?? 0
                  const s = Math.max(0, (projVal ?? 0) - m - p)
                  return (
                    <td key={lt.lot_type_id} style={{
                      ...tdB({ textAlign: 'right', padding: '3px 6px' }),
                      ...(idx === 0 ? { borderLeft: '2px solid #ebebeb' } : {}),
                    }}>
                      <EditableCell value={projVal} width={56} placeholder="0" min={m + p}
                        onSave={v => onSaveProductSplit(row.phase_id, lt.lot_type_id, v)} />
                      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 5, marginTop: 2, paddingRight: 4 }}>
                        <span style={{ fontSize: 10, color: m > 0 ? '#1d4ed8' : '#e5e7eb' }} title="In MARKS">M:{m}</span>
                        <span style={{ fontSize: 10, color: p > 0 ? '#92400e' : '#e5e7eb' }} title="Pre-MARKS">P:{p}</span>
                        <span style={{ fontSize: 10, color: s > 0 ? '#9ca3af' : '#e5e7eb' }} title="Sim">S:{s}</span>
                        {x > 0 && <span style={{ fontSize: 10, color: '#9ca3af' }} title="Excluded">X:{x}</span>}
                      </div>
                    </td>
                  )
                })}
                {/* Subtotals */}
                {(() => {
                  const csub = commSubs[row.ent_group_id]
                  const dsub = devSubs[`${row.ent_group_id}|${row.dev_id}`]
                  const isub = instSubs[row.instrument_id]
                  const stTd = (extra = {}) => ({
                    padding: '4px 6px', background: bg, borderTop: topBorder,
                    verticalAlign: 'middle', textAlign: 'right', ...extra,
                  })
                  const sn = v => (
                    <span style={{ fontSize: 12, display: 'block', textAlign: 'right',
                                   padding: '1px 4px', color: v > 0 ? '#374151' : '#d1d5db' }}>
                      {v > 0 ? v : '—'}
                    </span>
                  )
                  const blank = <span style={{ fontSize: 12, color: '#e5e7eb' }}>—</span>
                  return (
                    <>
                      {/* Community */}
                      <td style={{ ...stTd(), borderLeft: '3px solid #c7d2e2' }}>
                        {isFirstComm ? sn(1) : blank}
                      </td>
                      {/* Development */}
                      <td style={stTd()}>
                        {isFirstComm ? sn(csub?.devs.size ?? 0)
                          : isFirstDev ? sn(1)
                          : blank}
                      </td>
                      {/* Instrument */}
                      <td style={stTd()}>
                        {isFirstComm ? sn(csub?.insts.size ?? 0)
                          : isFirstDev  ? sn(dsub?.insts.size ?? 0)
                          : isFirstInst ? sn(1)
                          : blank}
                      </td>
                      {/* Phase */}
                      <td style={stTd()}>
                        {isFirstComm ? sn(csub?.phases ?? 0)
                          : isFirstDev  ? sn(dsub?.phases ?? 0)
                          : isFirstInst ? sn(isub?.phases ?? 0)
                          : blank}
                      </td>
                      {/* Lots */}
                      <td style={stTd()}>
                        {isFirstComm ? sn(csub?.lots ?? 0)
                          : isFirstDev  ? sn(dsub?.lots ?? 0)
                          : isFirstInst ? sn(isub?.lots ?? 0)
                          : sn(projTotal)}
                      </td>
                    </>
                  )
                })()}
              </tr>
            )
          })}
        </tbody>
      </TableShell>
    </div>

    {bulkInsertPhase && (
      <BulkLotInsertModal
        phase={{ phase_id: bulkInsertPhase.phase_id, phase_name: bulkInsertPhase.phase_name }}
        knownLotTypes={(phaseData?.lot_types ?? []).map(lt => ({
          lot_type_id: lt.lot_type_id,
          lot_type_short: lt.lot_type_short,
        }))}
        onClose={() => setBulkInsertPhase(null)}
        onInserted={() => { setBulkInsertPhase(null); onLotsAdded?.() }}
      />
    )}
    </>
  )
}

// ─── Main view ────────────────────────────────────────────────────────────────

export default function ConfigView({ showTestCommunities }) {
  const [tab,          setTab]         = useState('community')
  const [phaseData,    setPhaseData]   = useState(null)
  const [commData,     setCommData]    = useState(null)
  const [devData,      setDevData]     = useState(null)
  const [globalMonths, setGlobalMonths] = useState(null)
  const [loading,      setLoading]     = useState(true)
  const [loadError,    setLoadError]   = useState(null)

  const load = useCallback(() => {
    setLoading(true)
    Promise.all([
      fetch(`${API_BASE}/admin/phase-config`).then(r => { if (!r.ok) throw new Error(r.status); return r.json() }),
      fetch(`${API_BASE}/admin/community-config`).then(r => { if (!r.ok) throw new Error(r.status); return r.json() }),
      fetch(`${API_BASE}/admin/dev-config`).then(r => { if (!r.ok) throw new Error(r.status); return r.json() }),
      fetch(`${API_BASE}/global-settings`).then(r => { if (!r.ok) throw new Error(r.status); return r.json() }),
    ])
      .then(([pd, cd, dd, gs]) => {
        setPhaseData(pd); setCommData(cd); setDevData(dd)
        setGlobalMonths(gs?.delivery_months ? [...gs.delivery_months] : null)
        setLoadError(null)
      })
      .catch(e => setLoadError(String(e)))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => { load() }, [load])

  // ── Community config save ──────────────────────────────────────────────────

  async function patchComm(entGroupId, kind, patch) {
    if (kind === 'ledger') {
      const res = await fetch(`${API_BASE}/entitlement-groups/${entGroupId}/ledger-config`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      })
      if (!res.ok) throw new Error(await res.text())
      const updated = await res.json()
      setCommData(prev => prev.map(r => r.ent_group_id === entGroupId
        ? { ...r, date_paper: updated.date_paper, date_ent: updated.date_ent }
        : r))
    } else {
      const res = await fetch(`${API_BASE}/entitlement-groups/${entGroupId}/delivery-config`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      })
      if (!res.ok) throw new Error(await res.text())
      const updated = await res.json()
      setCommData(prev => prev.map(r => r.ent_group_id === entGroupId
        ? { ...r,
            auto_schedule_enabled:   updated.auto_schedule_enabled,
            delivery_months:         updated.delivery_months != null ? [...updated.delivery_months] : null,
            max_deliveries_per_year: updated.max_deliveries_per_year }
        : r))
    }
  }

  // ── Global delivery months save ────────────────────────────────────────────

  async function saveGlobal(months) {
    const res = await fetch(`${API_BASE}/global-settings`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ delivery_months: months }),
    })
    if (!res.ok) throw new Error(await res.text())
    const updated = await res.json()
    setGlobalMonths(updated?.delivery_months ? [...updated.delivery_months] : null)
  }

  // ── Dev params save ────────────────────────────────────────────────────────

  async function patchDev(devId, patch) {
    const res = await fetch(`${API_BASE}/developments/${devId}/sim-params`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    })
    if (!res.ok) throw new Error(await res.text())
    const updated = await res.json()
    setDevData(prev => prev.map(r => r.dev_id === devId
      ? { ...r,
          annual_starts_target: updated.annual_starts_target,
          max_starts_per_month: updated.max_starts_per_month }
      : r))
  }

  // ── Instrument spec_rate save ──────────────────────────────────────────────

  async function saveSpecRate(instrumentId, rate) {
    const res = await fetch(`${API_BASE}/instruments/${instrumentId}/spec-rate`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ spec_rate: rate }),
    })
    if (!res.ok) throw new Error(await res.text())
    // Update spec_rate in all phaseRows for this instrument
    setPhaseData(prev => ({
      ...prev,
      rows: prev.rows.map(r => r.instrument_id === instrumentId ? { ...r, spec_rate: rate } : r),
    }))
  }

  // ── Phase save helpers ─────────────────────────────────────────────────────

  function patchPhaseRow(phaseId, patch) {
    setPhaseData(prev => ({ ...prev, rows: prev.rows.map(r => r.phase_id === phaseId ? { ...r, ...patch } : r) }))
  }

  async function patchPhase(phaseId, field, value) {
    const res = await fetch(`${API_BASE}/admin/phase/${phaseId}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ [field]: value }),
    })
    if (!res.ok) throw new Error(await res.text())
    patchPhaseRow(phaseId, await res.json())
  }

  async function toggleLock(row, shouldLock) {
    const date_dev_actual = shouldLock ? row.date_dev_projected : null
    const res = await fetch(`${API_BASE}/admin/phase/${row.phase_id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ date_dev_actual }),
    })
    if (!res.ok) throw new Error(await res.text())
    patchPhaseRow(row.phase_id, await res.json())
  }

  async function saveProductSplit(phaseId, lotTypeId, count) {
    const res = await fetch(`${API_BASE}/admin/product-split/${phaseId}/${lotTypeId}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projected_count: count ?? 0 }),
    })
    if (!res.ok) throw new Error(await res.text())
    const row = phaseData?.rows.find(r => r.phase_id === phaseId)
    patchPhaseRow(phaseId, { product_splits: { ...(row?.product_splits ?? {}), [lotTypeId]: count ?? 0 } })
  }

  async function saveBuilderSplit(instrumentId, builderId, share) {
    const res = await fetch(`${API_BASE}/admin/builder-split/${instrumentId}/${builderId}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ share }),
    })
    if (!res.ok) throw new Error(await res.text())
    // Patch all phase rows belonging to this instrument
    const affectedRows = phaseData?.rows.filter(r => r.instrument_id === instrumentId) ?? []
    for (const row of affectedRows) {
      const newSplits = { ...(row?.builder_splits ?? {}) }
      if (share == null) delete newSplits[builderId]; else newSplits[builderId] = share
      patchPhaseRow(row.phase_id, { builder_splits: newSplits })
    }
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  if (loading)   return <div style={{ padding: 24, color: '#6b7280', fontSize: 13 }}>Loading…</div>
  if (loadError) return <div style={{ padding: 24, color: '#dc2626', fontSize: 13 }}>{loadError}</div>

  return (
    <div style={{ padding: '14px 20px', fontFamily: 'system-ui, sans-serif', fontSize: 13 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
        <span style={{ fontSize: 15, fontWeight: 700, color: '#111827' }}>Configuration</span>
        <button onClick={load} style={{
          fontSize: 11, color: '#6b7280', background: 'none',
          border: '1px solid #e5e7eb', borderRadius: 4, padding: '2px 8px', cursor: 'pointer',
        }}>Refresh</button>
      </div>

      <TabBar active={tab} onChange={setTab} />

      {tab === 'community'  && commData  && (
        <CommunityTab rows={commData} showTest={showTestCommunities} onPatchComm={patchComm}
          globalMonths={globalMonths} onSaveGlobal={saveGlobal} />
      )}
      {tab === 'dev'        && devData   && (
        <DevTab rows={devData} showTest={showTestCommunities} onPatchDev={patchDev} />
      )}
      {tab === 'instrument' && phaseData && (
        <InstrumentTab phaseRows={phaseData.rows} showTest={showTestCommunities}
          builders={phaseData.builders ?? []}
          onSaveSpecRate={saveSpecRate} onSaveBuilderSplit={saveBuilderSplit} />
      )}
      {tab === 'phase'      && phaseData && (
        <PhaseTab
          phaseData={phaseData} showTest={showTestCommunities}
          onPatchPhase={patchPhase} onSaveProductSplit={saveProductSplit}
          onToggleLock={toggleLock}
          onLotsAdded={load}
        />
      )}
    </div>
  )
}
