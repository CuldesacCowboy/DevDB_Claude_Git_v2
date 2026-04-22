// setup/PhaseRow.jsx
// LotTypeRow (one table row + pill detail) and PhaseRow (expandable lot-type table).

import { useState, useEffect, useRef, useContext, useCallback } from 'react'
import { API_BASE } from '../../config'
import { stripPrefix } from '../simulation/simShared'
import {
  useLocalOpen, ExpandAllContext, LotRefreshContext,
  SUB, PHASE_COLS, fmtRelative, SubCell, EditableCount,
  ChevronIcon, InlineEdit, ROW,
  useDeleteConfirm, DeleteButton, DeleteConfirmBanner,
} from './setupShared'
import { LotPillGroup } from './LotPillGroup'
import BuildingsTab from './BuildingsTab'

// ─── LotTypeRow ───────────────────────────────────────────────────────────────

function LotTypeRow({ phaseId, ltId, lotTypeName, projected, realMarks, realPre, sim, excluded,
                      targetPhases, lotTypes, onSaveTotal, onDelete, onRefresh, showMirror = true, commName }) {
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
          <EditableCount value={projected} onSave={onSaveTotal} min={realMarks + realPre + excluded} />
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
                              onLotsUpdated={handleLotsUpdated} onRefresh={onRefresh}
                              commName={commName} />
            }
          </td>
        </tr>
      )}
    </>
  )
}

// ─── PhaseRow ─────────────────────────────────────────────────────────────────

export default function PhaseRow({ phase, phases, lotTypes, onRename, onDelete, onRefresh, commName }) {
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
  const [deliveryDate, setDeliveryDate] = useState(phase.date_dev_actual ?? '')
  const [editingDate, setEditingDate] = useState(false)
  const [savingDate, setSavingDate] = useState(false)
  useEffect(() => { setDeliveryDate(phase.date_dev_actual ?? '') }, [phase.date_dev_actual])

  const handleSaveDeliveryDate = useCallback(async (val) => {
    setSavingDate(true)
    try {
      const res = await fetch(`${API_BASE}/admin/phase/${phase.phase_id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ date_dev_actual: val || null }),
      })
      if (res.ok) { setDeliveryDate(val); onRefresh() }
    } finally { setSavingDate(false); setEditingDate(false) }
  }, [phase.phase_id, onRefresh])

  const [deliveryTier, setDeliveryTier] = useState(phase.delivery_tier ?? null)
  const [editingTier, setEditingTier] = useState(false)
  const [savingTier, setSavingTier] = useState(false)
  useEffect(() => { setDeliveryTier(phase.delivery_tier ?? null) }, [phase.delivery_tier])

  const handleSaveTier = useCallback(async (val) => {
    const parsed = val === '' || val === null ? null : parseInt(val, 10)
    if (parsed !== null && (isNaN(parsed) || parsed < 1)) { setEditingTier(false); return }
    setSavingTier(true)
    try {
      const res = await fetch(`${API_BASE}/admin/phase/${phase.phase_id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ delivery_tier: parsed }),
      })
      if (res.ok) { setDeliveryTier(parsed); onRefresh() }
    } finally { setSavingTier(false); setEditingTier(false) }
  }, [phase.phase_id, onRefresh])

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
    const sim       = Math.max(0, projected - realMarks - realPre - excl)
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

  const phaseL = tableRows.reduce((s, r) => s + r.realMarks + r.realPre + r.sim, 0)
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
          <InlineEdit value={phase.phase_name} displayValue={stripPrefix(phase.phase_name, commName)} onSave={onRename} />
        </span>
        {/* Delivery date — fixed column */}
        <div style={{ width: PHASE_COLS.date, flexShrink: 0, display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 3 }}>
          {editingDate ? (
            <input
              type="date"
              defaultValue={deliveryDate}
              autoFocus
              onClick={e => e.stopPropagation()}
              onKeyDown={e => {
                e.stopPropagation()
                if (e.key === 'Enter') handleSaveDeliveryDate(e.currentTarget.value)
                if (e.key === 'Escape') setEditingDate(false)
              }}
              onBlur={e => handleSaveDeliveryDate(e.currentTarget.value)}
              style={{
                fontSize: 10, padding: '1px 4px', border: '1px solid #0d9488',
                borderRadius: 3, width: PHASE_COLS.date - 4,
              }}
            />
          ) : (() => {
            const hint = phase.hint_date ?? null
            const violated = deliveryDate && hint && deliveryDate > hint
            const mo = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
            const fmtHint = d => { const [y, m] = d.split('-').map(Number); return `${mo[m-1]} '${String(y).slice(2)}` }
            return (<>
              <span
                onClick={e => { e.stopPropagation(); setEditingDate(true) }}
                title={hint ? `Set delivery date (before ${hint})` : 'Set locked delivery date for this phase'}
                style={{
                  fontSize: 10, cursor: 'pointer',
                  color: deliveryDate ? (violated ? '#d97706' : '#0d9488') : '#d1d5db',
                  borderBottom: deliveryDate
                    ? `1px dashed ${violated ? '#d97706' : '#0d9488'}`
                    : '1px dashed #d1d5db',
                }}>
                {savingDate ? '…' : deliveryDate ? `del. ${deliveryDate}` : 'del. date'}
              </span>
              {!deliveryDate && hint && (
                <span
                  onClick={e => { e.stopPropagation(); handleSaveDeliveryDate(hint) }}
                  title={`Click to use latest reasonable date: ${hint}`}
                  style={{ fontSize: 9, color: '#d1d5db', cursor: 'pointer', borderBottom: '1px dashed #e5e7eb', flexShrink: 0 }}>
                  ←{fmtHint(hint)}
                </span>
              )}
            </>)
          })()}
        </div>
        {/* Delivery tier — fixed column */}
        <div style={{ width: PHASE_COLS.tier, flexShrink: 0, display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
          {editingTier ? (
            <input
              type="number"
              min="1"
              max="99"
              defaultValue={deliveryTier ?? ''}
              autoFocus
              onClick={e => e.stopPropagation()}
              onKeyDown={e => {
                e.stopPropagation()
                if (e.key === 'Enter') handleSaveTier(e.currentTarget.value)
                if (e.key === 'Escape') setEditingTier(false)
              }}
              onBlur={e => handleSaveTier(e.currentTarget.value)}
              style={{
                fontSize: 10, padding: '1px 4px', width: PHASE_COLS.tier - 4,
                border: '1px solid #6366f1', borderRadius: 3,
              }}
            />
          ) : (
            <span
              onClick={e => { e.stopPropagation(); setEditingTier(true) }}
              title="Set delivery tier (cross-instrument ordering)"
              style={{
                fontSize: 10, cursor: 'pointer',
                color: deliveryTier != null ? '#4f46e5' : '#d1d5db',
                borderBottom: deliveryTier != null ? '1px dashed #6366f1' : '1px dashed #d1d5db',
              }}>
              {savingTier ? '…' : deliveryTier != null ? `T${deliveryTier}` : 'tier'}
            </span>
          )}
        </div>
        {/* County + SD read-only badges */}
        {(() => {
          const resolvedCounty = phase.phase_county_name ?? phase.community_county_name ?? null
          const resolvedSd     = phase.phase_sd_name     ?? phase.community_sd_name     ?? null
          if (!resolvedCounty && !resolvedSd) return null
          const badgeStyle = (isOverride) => ({
            fontSize: 9, borderRadius: 3, padding: '1px 5px', whiteSpace: 'nowrap',
            border: `1px solid ${isOverride ? '#fcd34d' : '#e5e7eb'}`,
            background: isOverride ? '#fffbeb' : '#f3f4f6',
            color: isOverride ? '#92400e' : '#9ca3af',
          })
          return (
            <div style={{ display: 'flex', gap: 4, alignItems: 'center', flexShrink: 0, marginRight: 4 }}>
              {resolvedCounty && (
                <span style={badgeStyle(!!phase.phase_county_id)}
                  title={phase.phase_county_id ? 'Phase county override' : 'Inherited from community'}>
                  {resolvedCounty}{!phase.phase_county_id && ' ↗'}
                </span>
              )}
              {resolvedSd && (
                <span style={badgeStyle(!!phase.phase_sd_id)}
                  title={phase.phase_sd_id ? 'Phase SD override' : 'Inherited from community'}>
                  {resolvedSd}{!phase.phase_sd_id && ' ↗'}
                </span>
              )}
            </div>
          )
        })()}
        {/* Type count — fixed column, always reserves space */}
        <div style={{ width: PHASE_COLS.types, flexShrink: 0, display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
          {!open && ltIds.length > 0 && (
            <span style={{ fontSize: 11, color: '#9ca3af' }}>
              {ltIds.length} type{ltIds.length !== 1 ? 's' : ''}
            </span>
          )}
        </div>
        {/* Updated — fixed column, always reserves space */}
        <div style={{ width: PHASE_COLS.ago, flexShrink: 0, display: 'flex', justifyContent: 'flex-end', alignItems: 'center' }}>
          {!open && phase.updated_at && (
            <span style={{ fontSize: 10, color: '#d1d5db' }}>
              {fmtRelative(phase.updated_at)}
            </span>
          )}
        </div>
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
                    commName={commName}
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
