import { useState, useEffect } from 'react'
import { API_BASE } from '../../config'
import BulkLotInsertModal from '../BulkLotInsertModal'
import { EditableCell } from '../EditableCell'
import { TableShell, LockButton, bandIdx, BAND, CW, LEFT, PHASE_SHADOW } from './configShared'

export function PhaseTab({ phaseData, showTest, onPatchPhase, onSaveProductSplit, onToggleLock, onLotsAdded, initialFilterComm }) {
  const [filterComm,    setFilterComm]    = useState(initialFilterComm ?? null)
  const [filterDev,     setFilterDev]     = useState(null)
  const [showSplits,    setShowSplits]    = useState(true)
  const [bulkInsertPhase, setBulkInsertPhase] = useState(null)
  const [counties,      setCounties]      = useState([])
  const [allSDs,        setAllSDs]        = useState([])

  useEffect(() => {
    Promise.all([
      fetch(`${API_BASE}/ref/counties`).then(r => r.json()),
      fetch(`${API_BASE}/ref/school-districts`).then(r => r.json()),
    ]).then(([cs, sds]) => { setCounties(cs); setAllSDs(sds) }).catch(() => {})
  }, [])

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

  const thBase = {
    padding: '5px 7px', fontSize: 11, fontWeight: 600, color: '#6b7280',
    background: '#f3f4f6', whiteSpace: 'nowrap',
    borderBottom: '2px solid #e5e7eb', position: 'sticky', top: 0,
  }
  const thS  = (left, w, extra = {}) => ({ ...thBase, left, zIndex: 5, width: w, minWidth: w, ...extra })
  const thR  = (extra = {}) => ({ ...thBase, zIndex: 2, textAlign: 'right', ...extra })
  const thGR = (extra = {}) => ({ ...thR(extra), borderLeft: '2px solid #e0e0e0' })

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
            <th rowSpan={2} style={thR({  width: 110 })}>County</th>
            <th rowSpan={2} style={thR({  width: 130 })}>School District</th>
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
            const isLocked   = !!row.date_dev_actual
            const canLock    = !!row.date_dev_projected

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
                {/* County */}
                <td style={tdB({ padding: '3px 4px' })}>
                  {(() => {
                    const hasOverride = row.phase_county_id != null
                    return (
                      <select
                        value={row.phase_county_id ?? ''}
                        onChange={async e => {
                          const v = e.target.value === '' ? null : Number(e.target.value)
                          try { await onPatchPhase(row.phase_id, 'county_id', v) } catch {}
                        }}
                        style={{
                          fontSize: 11, padding: '1px 3px', borderRadius: 3, width: '100%',
                          border: hasOverride ? '1px solid #fcd34d' : '1px solid #e5e7eb',
                          background: hasOverride ? '#fffbeb' : '#fafafa',
                          color: hasOverride ? '#92400e' : '#9ca3af',
                        }}>
                        <option value="">
                          {row.community_county_name ? `${row.community_county_name} ↗` : '—'}
                        </option>
                        {counties.map(c => <option key={c.county_id} value={c.county_id}>{c.county_name}</option>)}
                      </select>
                    )
                  })()}
                </td>
                {/* School District */}
                <td style={tdB({ padding: '3px 4px' })}>
                  {(() => {
                    const resolvedCountyId = row.phase_county_id ?? row.community_county_id
                    const sdOpts = allSDs.filter(sd => !sd.county_id || sd.county_id === resolvedCountyId)
                    const hasOverride = row.phase_sd_id != null
                    return (
                      <select
                        value={row.phase_sd_id ?? ''}
                        onChange={async e => {
                          const v = e.target.value === '' ? null : Number(e.target.value)
                          try { await onPatchPhase(row.phase_id, 'school_district_id', v) } catch {}
                        }}
                        style={{
                          fontSize: 11, padding: '1px 3px', borderRadius: 3, width: '100%',
                          border: hasOverride ? '1px solid #fcd34d' : '1px solid #e5e7eb',
                          background: hasOverride ? '#fffbeb' : '#fafafa',
                          color: hasOverride ? '#92400e' : '#9ca3af',
                        }}>
                        <option value="">
                          {row.community_sd_name ? `${row.community_sd_name} ↗` : '—'}
                        </option>
                        {sdOpts.map(d => <option key={d.sd_id} value={d.sd_id}>{d.district_name}</option>)}
                      </select>
                    )
                  })()}
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
                      <td style={{ ...stTd(), borderLeft: '3px solid #c7d2e2' }}>
                        {isFirstComm ? sn(1) : blank}
                      </td>
                      <td style={stTd()}>
                        {isFirstComm ? sn(csub?.devs.size ?? 0)
                          : isFirstDev ? sn(1)
                          : blank}
                      </td>
                      <td style={stTd()}>
                        {isFirstComm ? sn(csub?.insts.size ?? 0)
                          : isFirstDev  ? sn(dsub?.insts.size ?? 0)
                          : isFirstInst ? sn(1)
                          : blank}
                      </td>
                      <td style={stTd()}>
                        {isFirstComm ? sn(csub?.phases ?? 0)
                          : isFirstDev  ? sn(dsub?.phases ?? 0)
                          : isFirstInst ? sn(isub?.phases ?? 0)
                          : blank}
                      </td>
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
