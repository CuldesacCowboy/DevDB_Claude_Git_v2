import { useState, useRef, useEffect } from 'react'
import { EditableCell, cellHighlight } from '../EditableCell'
import { TableShell, bandIdx, BAND } from './configShared'

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

// ─── StartsCell ───────────────────────────────────────────────────────────────
// Editable annual starts target with a reactive supply label below.

function StartsCell({ value, unstarted, totalProjected, onSave, triggerActivate = 0, onDone }) {
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
  // Use the larger of unstarted real lots or total projected (from product splits).
  // total_projected captures the full planned capacity including future sim lots.
  // unstarted_real captures only lots that exist today and haven't started.
  const supply = Math.max(unstarted ?? 0, totalProjected ?? 0)
  const supplyYrs  = liveTarget > 0 && supply > 0 ? supply / liveTarget : null

  function supplyLabel() {
    if (liveTarget === 0) return null
    if (supply === 0) return 'exhausted'
    if (supplyYrs == null) return null
    if (supplyYrs >= 2)  return `≈ ${supplyYrs.toFixed(1)} yrs`
    return `≈ ${Math.round(supplyYrs * 12)} mo`
  }

  const supplyColor = supplyYrs == null ? null
    : supplyYrs >= 3 ? '#16a34a'
    : supplyYrs >= 1 ? '#d97706'
    : '#dc2626'

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

// ─── DevTab ───────────────────────────────────────────────────────────────────

export function DevTab({ rows, showTest, onPatchDev }) {
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
            <th style={{ ...thGR, width: 60 }} title="Sum of product split projected counts across all phases">Proj</th>
            <th style={{ ...thR,  width: 68 }} title="Real lots with no start date (still in pipeline)">Unstarted</th>
            <th style={{ ...thR,  width: 60 }} title={`Actual starts YTD (${CUR_YEAR})`}>{CUR_YEAR}</th>
            <th style={{ ...thR,  width: 60 }} title={`Actual starts in ${CUR_YEAR - 1}`}>{CUR_YEAR - 1}</th>
            <th style={{ ...thR,  width: 60 }} title={`Actual starts in ${CUR_YEAR - 2}`}>{CUR_YEAR - 2}</th>
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
                <td style={tdG(2, { textAlign: 'right', verticalAlign: 'middle' })}>{num(row.total_projected, true)}</td>
                <td style={td(3,  { textAlign: 'right', verticalAlign: 'middle' })}>{num(row.unstarted_real, true)}</td>
                <td style={td(4,  { textAlign: 'right', verticalAlign: 'middle' })}>{num(row.starts_ytd)}</td>
                <td style={td(5,  { textAlign: 'right', verticalAlign: 'middle' })}>{num(row.starts_last_year)}</td>
                <td style={td(6,  { textAlign: 'right', verticalAlign: 'middle' })}>{num(row.starts_2yr_ago)}</td>
                <td style={tdG(7, { textAlign: 'right' })}>
                  <StartsCell
                    value={row.annual_starts_target}
                    unstarted={row.unstarted_real}
                    totalProjected={row.total_projected}
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
