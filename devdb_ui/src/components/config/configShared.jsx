import { useState } from 'react'

// ─── Constants ────────────────────────────────────────────────────────────────

export const MONTH_ABBR = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
export const BAND = ['#ffffff', '#f8faff']

// Sticky column geometry (phase tab only)
export const CW = { comm: 160, dev: 140, inst: 144, phase: 116 }
export const LEFT = {
  comm:  0,
  dev:   CW.comm,
  inst:  CW.comm + CW.dev,
  phase: CW.comm + CW.dev + CW.inst,
}
export const PHASE_SHADOW = { boxShadow: '4px 0 8px -2px rgba(0,0,0,0.10)' }

const TABS = [
  { id: 'community',  label: 'Community' },
  { id: 'dev',        label: 'Development' },
  { id: 'instrument', label: 'Instrument' },
  { id: 'phase',      label: 'Phase' },
]

// ─── Helpers ──────────────────────────────────────────────────────────────────

export function bandIdx(rows, getKey) {
  const map = {}; let n = 0
  rows.forEach(r => { const k = getKey(r); if (map[k] === undefined) map[k] = n++ })
  return map
}

// ─── TabBar ───────────────────────────────────────────────────────────────────

export function TabBar({ active, onChange }) {
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

// ─── TableShell ───────────────────────────────────────────────────────────────

export function TableShell({ children, maxHeight = 'calc(100vh - 170px)' }) {
  return (
    <div style={{ overflowX: 'auto', overflowY: 'auto', maxHeight,
                  border: '1px solid #e5e7eb', borderRadius: 6 }}>
      <table style={{ borderCollapse: 'collapse', minWidth: 'max-content', width: '100%' }}>
        {children}
      </table>
    </div>
  )
}

// ─── LockButton ───────────────────────────────────────────────────────────────

export function LockButton({ locked, disabled, onToggle }) {
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

// ─── MonthCell ────────────────────────────────────────────────────────────────

export function MonthCell({ months, globalMonths, onSave, onSaveGlobal }) {
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
