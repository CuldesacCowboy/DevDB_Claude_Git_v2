// setup/PhaseRow.jsx
// LotTypeRow (one table row + pill detail) and PhaseRow (expandable lot-type table).

import { useState, useEffect, useRef, useContext } from 'react'
import { API_BASE } from '../../config'
import {
  useLocalOpen, ExpandAllContext, LotRefreshContext,
  SUB, fmtRelative, SubCell, EditableCount,
  ChevronIcon, InlineEdit, ROW,
  useDeleteConfirm, DeleteButton, DeleteConfirmBanner,
} from './setupShared'
import { LotPillGroup } from './LotPillGroup'
import BuildingsTab from './BuildingsTab'

// ─── LotTypeRow ───────────────────────────────────────────────────────────────

function LotTypeRow({ phaseId, ltId, lotTypeName, projected, realMarks, realPre, sim, excluded,
                      targetPhases, lotTypes, onSaveTotal, onDelete, onRefresh, showMirror = true }) {
  const [open, setOpen] = useState(false)
  const [lots, setLots] = useState(null)
  const [fetching, setFetching] = useState(false)
  const refreshTick = useContext(LotRefreshContext)
  const isFirstTick = useRef(true)

  // When parent data reloads (e.g. after a move), silently re-fetch if already open and loaded
  useEffect(() => {
    if (isFirstTick.current) { isFirstTick.current = false; return }
    if (open && lots !== null) {
      fetch(`${API_BASE}/phases/${phaseId}/lot-type/${ltId}/lots`)
        .then(res => res.ok ? res.json() : null)
        .then(data => { if (data) setLots(data) })
    }
  }, [refreshTick]) // eslint-disable-line react-hooks/exhaustive-deps

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

  function handleLotsRemoved(ids) {
    const s = new Set(ids)
    setLots(prev => prev ? prev.filter(l => !s.has(l.lot_id)) : null)
    onRefresh()
  }

  function handleLotsUpdated(ids, updates) {
    const s = new Set(ids)
    setLots(prev => prev ? prev.map(l => s.has(l.lot_id) ? { ...l, ...updates } : l) : null)
    onRefresh()
  }

  function handleLotAdded(newLots) {
    const arr = Array.isArray(newLots) ? newLots : [newLots]
    setLots(prev => [...(prev ?? []), ...arr])
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
        <td style={{ padding: '3px 6px', textAlign: 'right', color: realMarks > 0 ? '#1d4ed8' : '#d1d5db' }}>{realMarks > 0 ? realMarks : '—'}</td>
        <td style={{ padding: '3px 6px', textAlign: 'right', color: realPre > 0 ? '#92400e' : '#d1d5db' }}>{realPre > 0 ? realPre : '—'}</td>
        <td style={{ padding: '3px 6px', textAlign: 'right', color: sim > 0 ? '#6b7280' : '#d1d5db' }}>{sim > 0 ? sim : '—'}</td>
        <td style={{ padding: '3px 6px', textAlign: 'right', color: excluded > 0 ? '#9ca3af' : '#d1d5db' }}>{excluded > 0 ? excluded : '—'}</td>
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
        {showMirror && (
          <td style={{
            padding: '3px 6px', textAlign: 'right', width: SUB.L,
            borderLeft: '2px solid #e5e7eb',
            fontSize: 11, color: projected > 0 ? '#374151' : '#d1d5db',
          }}>
            {projected > 0 ? projected : '—'}
          </td>
        )}
      </tr>
      {open && (
        <tr style={{ borderBottom: '1px solid #f3f4f6' }}>
          <td colSpan={showMirror ? 8 : 7} style={{ padding: '4px 6px 8px 28px', background: '#fafafa' }}>
            {fetching
              ? <span style={{ fontSize: 11, color: '#9ca3af' }}>Loading…</span>
              : <LotPillGroup lots={lots} targetPhases={targetPhases} onMoveLot={handleLotMoved}
                              phaseId={phaseId} ltId={ltId} onLotAdded={handleLotAdded}
                              lotTypes={lotTypes} onLotsRemoved={handleLotsRemoved}
                              onLotsUpdated={handleLotsUpdated} onRefresh={onRefresh} />
            }
          </td>
        </tr>
      )}
    </>
  )
}

// ─── PhaseRow ─────────────────────────────────────────────────────────────────

export default function PhaseRow({ phase, phases, lotTypes, onRename, onDelete, onRefresh }) {
  // All other phases in the same development — valid move targets
  const targetPhases = (phases || []).filter(
    p => p.dev_id === phase.dev_id && p.phase_id !== phase.phase_id
  )
  const [open, setOpen] = useLocalOpen(`setup_open_phase_${phase.phase_id}`)
  const [tab, setTab]   = useState('lots')   // 'lots' | 'buildings'
  const [hovered, setHovered] = useState(false)
  const delPhase = useDeleteConfirm(async () => {
    const res = await fetch(`${API_BASE}/phases/${phase.phase_id}`, { method: 'DELETE' })
    if (!res.ok) throw new Error((await res.json()).detail ?? 'Delete failed')
    onDelete?.()
  })
  const [addLtOpen, setAddLtOpen] = useState(false)
  const { tick: xTick, value: xVal } = useContext(ExpandAllContext)
  useEffect(() => { if (xTick > 0) setOpen(xVal) }, [xTick]) // eslint-disable-line
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
    const excl      = counts.excl  ?? 0
    const sim       = Math.max(0, projected - realMarks - realPre)
    return { ltId, projected, realMarks, realPre, sim, excl }
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

  const phaseL = tableRows.reduce((s, r) => s + (r.projected ?? 0), 0)
  const showMirror = tableRows.length > 1

  const lotCount = Object.values(phase.lot_type_counts ?? {}).reduce((s, c) => s + (c.marks ?? 0) + (c.pre ?? 0), 0)

  return (
    <div style={{ paddingLeft: 24, paddingTop: 2, paddingBottom: 2 }}>
      {/* Phase header */}
      <div style={{ ...ROW }} onClick={() => { if (!delPhase.confirming) setOpen(o => !o) }}
        onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}
        tabIndex={0} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setOpen(o => !o) } }}>
        <ChevronIcon open={open} />
        <span style={{ color: '#374151', flex: 1 }}>
          <InlineEdit value={phase.phase_name} onSave={onRename} />
        </span>
        {!open && ltIds.length > 0 && (
          <span style={{ fontSize: 11, color: '#9ca3af' }}>
            {ltIds.length} type{ltIds.length !== 1 ? 's' : ''}
          </span>
        )}
        {!open && phase.updated_at && (
          <span style={{ fontSize: 10, color: '#d1d5db', marginLeft: 6 }}>
            {fmtRelative(phase.updated_at)}
          </span>
        )}
        <DeleteButton
          visible={hovered && !delPhase.confirming}
          onClick={() => delPhase.setConfirming(true)}
        />
        <div style={{ display: 'flex', flexShrink: 0 }}>
          <div style={{ width: SUB.D, flexShrink: 0, borderLeft: '2px solid #e5e7eb' }} />
          <div style={{ width: SUB.I, flexShrink: 0 }} />
          <div style={{ width: SUB.P, flexShrink: 0 }} />
          <SubCell n={phaseL} w={SUB.L} />
        </div>
      </div>

      {delPhase.confirming && (
        <DeleteConfirmBanner
          label={`"${phase.phase_name}"`}
          warning={lotCount > 0 ? `${lotCount} lot${lotCount !== 1 ? 's' : ''} will be unassigned` : undefined}
          onConfirm={delPhase.handleConfirm}
          onCancel={() => delPhase.setConfirming(false)}
          deleting={delPhase.deleting}
          error={delPhase.error}
        />
      )}

      {/* Expanded content */}
      {open && (
        <div style={{ paddingLeft: 16, paddingRight: 6, paddingTop: 4, paddingBottom: 6 }}>
          {/* Tab bar */}
          <div style={{ display: 'flex', gap: 2, marginBottom: 8 }}>
            {[['lots', 'Lots'], ['buildings', 'Buildings']].map(([key, label]) => (
              <button
                key={key}
                onClick={e => { e.stopPropagation(); setTab(key) }}
                style={{
                  fontSize: 11, padding: '2px 10px', borderRadius: 3, cursor: 'pointer',
                  background: tab === key ? '#2563eb' : '#f1f5f9',
                  color:      tab === key ? '#fff'    : '#6b7280',
                  border:     tab === key ? '1px solid #1d4ed8' : '1px solid #e5e7eb',
                }}
              >{label}</button>
            ))}
          </div>

          {tab === 'buildings' && <BuildingsTab phaseId={phase.phase_id} />}

          {tab === 'lots' && (<>
          {tableRows.length > 0 && (
            <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: 12 }}>
              <thead>
                <tr>
                  {['Product', 'Total', 'Active', 'Pending', 'Sim', 'Excl', '', ...(showMirror ? ['L'] : [])].map((h, i) => (
                    <th key={i} style={{
                      textAlign: i === 0 ? 'left' : i === 6 ? 'center' : 'right',
                      padding: '2px 6px 4px',
                      fontWeight: 400, fontSize: 11, color: '#9ca3af',
                      borderBottom: '1px solid #e5e7eb',
                      width: i === 6 ? 24 : (showMirror && i === 7) ? SUB.L : undefined,
                      ...((showMirror && i === 7) ? { borderLeft: '2px solid #e5e7eb' } : {}),
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
                    excluded={r.excl}
                    targetPhases={targetPhases}
                    lotTypes={lotTypes}
                    onSaveTotal={n => handleSaveTotal(r.ltId, n)}
                    onDelete={() => handleDelete(r.ltId)}
                    onRefresh={onRefresh}
                    showMirror={showMirror}
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
          </>)}
        </div>
      )}
    </div>
  )
}
