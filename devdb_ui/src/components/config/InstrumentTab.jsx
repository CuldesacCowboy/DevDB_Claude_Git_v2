import { useState, useRef, useEffect } from 'react'
import { API_BASE } from '../../config'
import { EditableCell } from '../EditableCell'
import { TableShell, bandIdx, BAND } from './configShared'

// ─── SpecRateCell ─────────────────────────────────────────────────────────────
// Editable spec rate for an instrument with collapsible hint panel.

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

  function HintBtn({ label, hint }) {
    const vRaw = hint?.value ?? null
    const v    = vRaw != null ? Math.round(vRaw / 0.05) * 0.05 : null
    const n    = hint?.lot_count ?? 0
    const warn = hint?.warning ?? null
    const hasV = v != null
    const pct  = hasV ? `${Math.round(v * 100)}%` : null
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
            <HintBtn label="1yr"      hint={hints.historical_1yr} />
            <HintBtn label="2yr"      hint={hints.historical_2yr} />
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

// ─── InstrumentTab ────────────────────────────────────────────────────────────

export function InstrumentTab({ phaseRows, showTest, builders, onSaveSpecRate, onSaveBuilderSplit, initialFilterComm }) {
  const [localInstSplits, setLocalInstSplits] = useState({})
  const [filterComm, setFilterComm] = useState(initialFilterComm ?? null)

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
    const complement = builders.length === 2 ? builders.find(b => b.builder_id !== builderId) : null
    const compShare  = (complement && share != null) ? Math.round((1 - share) * 100) / 100 : null
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

  const allRows = [...instMap.values()].sort((a, b) =>
    a.ent_group_name.localeCompare(b.ent_group_name) ||
    a.dev_name.localeCompare(b.dev_name) ||
    a.instrument_name?.localeCompare(b.instrument_name ?? '')
  )
  const commOptions = [...new Map(allRows.map(r => [r.ent_group_id, r.ent_group_name])).entries()]
    .map(([id, name]) => ({ id: String(id), name }))
  const rows = filterComm ? allRows.filter(r => String(r.ent_group_id) === filterComm) : allRows

  const bi = bandIdx(rows, r => r.ent_group_id)

  const thB = {
    padding: '5px 8px', fontSize: 11, fontWeight: 600, color: '#6b7280',
    background: '#f3f4f6', whiteSpace: 'nowrap',
    borderBottom: '2px solid #e5e7eb', position: 'sticky', top: 0, zIndex: 2,
  }
  const thR = { ...thB, textAlign: 'right' }
  const thG = { ...thR, borderLeft: '2px solid #e0e0e0' }

  const selStyle = on => ({
    fontSize: 12, padding: '3px 24px 3px 8px', borderRadius: 4,
    border: on ? '1px solid #2563eb' : '1px solid #d1d5db',
    background: on ? '#eff6ff' : '#fff', color: on ? '#1d4ed8' : '#374151',
    appearance: 'none', cursor: 'pointer',
  })

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
        <span style={{ fontSize: 12, color: '#9ca3af', fontWeight: 500 }}>Filter</span>
        <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
          <select value={filterComm ?? ''} style={selStyle(!!filterComm)}
            onChange={e => setFilterComm(e.target.value || null)}>
            <option value="">All communities</option>
            {commOptions.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          {filterComm && (
            <button onClick={() => setFilterComm(null)}
              style={{ position: 'absolute', right: 6, fontSize: 13, lineHeight: 1,
                       background: 'none', border: 'none', color: '#2563eb', cursor: 'pointer', padding: 0 }}>×</button>
          )}
        </div>
      </div>
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
            const simTotal = Math.max(0, projTotal - marksTotal - preTotal - exclTotal)
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
                  const splits     = { ...row.builder_splits, ...(localInstSplits[row.instrument_id] ?? {}) }
                  const rawShare   = splits[b.builder_id] ?? null
                  const pctDisplay = rawShare != null ? Math.round(rawShare * 100) : null
                  const totalReal  = row.phases.reduce((s, p) => {
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
