import { useState, useRef } from 'react'
import { API_BASE } from '../../config'
import { StatusBadge } from '../../utils/statusConfig'
import OverrideDateCell from '../overrides/OverrideDateCell'
import { thS, tdS, fmt, exportToCsv } from './simShared'

const BG_ROW_PALETTE = [
  '#eff6ff','#f0fdf4','#fefce8','#fff1f2',
  '#f5f3ff','#fdf4ff','#ecfeff','#fff7ed',
]

const VIOLATION_FIELDS = {
  ent_after_dev: ['date_ent', 'date_dev'],
  dev_after_td:  ['date_dev', 'date_td'],
  td_after_str:  ['date_td',  'date_str'],
  str_after_cmp: ['date_str', 'date_cmp'],
  cmp_after_cls: ['date_cmp', 'date_cls'],
}
const VIOLATION_LABELS = {
  ent_after_dev: 'Entitled after developed — entitlement date is later than the development date',
  dev_after_td:  'Developed after takedown — development date is later than the takedown date',
  td_after_str:  'Takedown after start — takedown date is later than the start date',
  str_after_cmp: 'Started after completed — start date is later than the completion date',
  cmp_after_cls: 'Completed after closed — completion date is later than the closing date',
}

export function LotLedger({ lots, loading, onApplyOverride, onClearOverride, onRefreshLots }) {
  const [devFilter,  setDevFilter]  = useState('all')
  const [srcFilter,  setSrcFilter]  = useState('all')
  const [specFilter, setSpecFilter] = useState('all')
  const [sdEditing,  setSdEditing]  = useState(null)    // lot_id being edited
  const [sdOptions,  setSdOptions]  = useState([])      // loaded when edit opens
  const [sdSaving,   setSdSaving]   = useState(false)
  const sdSelectRef = useRef(null)

  async function openSdEdit(lot) {
    if (sdEditing === lot.lot_id) { setSdEditing(null); return }
    const countyId = lot.resolved_county_id
    const url = countyId
      ? `${API_BASE}/ref/school-districts?county_id=${countyId}`
      : `${API_BASE}/ref/school-districts`
    fetch(url).then(r => r.json()).then(opts => {
      setSdOptions(opts)
      setSdEditing(lot.lot_id)
    }).catch(() => {})
  }

  async function saveSd(lotId, sdId) {
    setSdSaving(true)
    try {
      await fetch(`${API_BASE}/admin/lot/${lotId}/school-district`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ school_district_id: sdId }),
      })
      setSdEditing(null)
      onRefreshLots?.()
    } finally { setSdSaving(false) }
  }

  if (loading) return <div style={{ color: '#6b7280', fontSize: 12 }}>Loading…</div>
  if (!lots.length) return <div style={{ color: '#9ca3af', fontSize: 12 }}>No lots. Run a simulation first.</div>

  const devNames = [...new Set(lots.map(l => l.dev_name))].sort()
  const filtered = lots.filter(l =>
    (devFilter  === 'all' || l.dev_name   === devFilter) &&
    (srcFilter  === 'all' || l.lot_source === srcFilter) &&
    (specFilter === 'all' ||
     (specFilter === 'spec'  && l.is_spec === true)  ||
     (specFilter === 'build' && l.is_spec === false) ||
     (specFilter === 'undet' && l.is_spec == null))
  )

  const overrideable = l => l.lot_source === 'real'

  const bgLabelMap = (() => {
    const map = {}
    const counters = {}
    for (const l of filtered) {
      if (l.building_group_id != null) {
        const key = `${l.phase_name}::${l.building_group_id}`
        if (!(key in map)) {
          const n = (counters[l.phase_name] ?? 0) + 1
          counters[l.phase_name] = n
          map[key] = `B${n}`
        }
      }
    }
    return map
  })()

  const violatedFields = l => {
    const fields = new Set()
    for (const vt of (l.violations ?? [])) {
      for (const f of (VIOLATION_FIELDS[vt] ?? [])) fields.add(f)
    }
    return fields
  }
  const violationTip = l =>
    (l.violations ?? []).map(vt => VIOLATION_LABELS[vt] ?? vt).join('\n')
  const ViolationDot = ({ title }) => (
    <span title={title}
      style={{ display: 'inline-block', width: 7, height: 7, borderRadius: '50%',
               background: '#f97316', marginLeft: 4, verticalAlign: 'middle', flexShrink: 0 }} />
  )

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ flexShrink: 0, display: 'flex', gap: 8, marginBottom: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <select value={devFilter} onChange={e => setDevFilter(e.target.value)}
          style={{ fontSize: 12, padding: '3px 8px', borderRadius: 4, border: '1px solid #d1d5db' }}>
          <option value="all">All developments</option>
          {devNames.map(n => <option key={n} value={n}>{n}</option>)}
        </select>
        <select value={srcFilter} onChange={e => setSrcFilter(e.target.value)}
          style={{ fontSize: 12, padding: '3px 8px', borderRadius: 4, border: '1px solid #d1d5db' }}>
          <option value="all">All sources</option>
          <option value="real">Real</option>
          <option value="sim">Sim</option>
        </select>
        <select value={specFilter} onChange={e => setSpecFilter(e.target.value)}
          style={{ fontSize: 12, padding: '3px 8px', borderRadius: 4, border: '1px solid #d1d5db' }}>
          <option value="all">Spec + Build</option>
          <option value="spec">Spec only</option>
          <option value="build">Build only</option>
          <option value="undet">Undetermined</option>
        </select>
        <span style={{ fontSize: 11, color: '#6b7280' }}>{filtered.length} lots</span>
        <span style={{ fontSize: 11, color: '#93c5fd', fontStyle: 'italic', marginLeft: 6 }}>italic blue = projected</span>
        <span style={{ fontSize: 11, color: '#92400e', marginLeft: 6 }}>amber = override (click to edit)</span>
        <button onClick={() => {
          const headers = ['Development','Lot #','Type','Phase','Bldg','Source','Spec','Status','ENT','DEV','HC','BLDR','DIG','CMP','CLS']
          const csvRows = filtered.map(l => {
            const bgKey = l.building_group_id != null ? `${l.phase_name}::${l.building_group_id}` : null
            const bgLabel = bgKey ? bgLabelMap[bgKey] : ''
            const specLabel = l.is_spec === true ? 'Spec' : l.is_spec === false ? 'Build' : ''
            return [
              l.dev_name, l.lot_number ?? '', l.lot_type_short ?? '', l.phase_name, bgLabel,
              l.lot_source, specLabel, l.status,
              l.date_ent ?? '', l.date_dev ?? '', l.date_td_hold ?? '',
              l.date_td ?? '', l.date_str ?? l.date_str_projected ?? '',
              l.date_cmp ?? l.date_cmp_projected ?? '', l.date_cls ?? l.date_cls_projected ?? '',
            ]
          })
          exportToCsv('lots.csv', headers, csvRows)
        }}
          style={{ fontSize: 11, padding: '3px 10px', borderRadius: 4, border: '1px solid #d1d5db',
                   background: '#f9fafb', color: '#374151', cursor: 'pointer', marginLeft: 'auto' }}>
          Export CSV
        </button>
      </div>
      <div style={{ flex: 1, overflowY: 'auto', overflowX: 'auto' }}>
        <table style={{ borderCollapse: 'collapse', fontSize: 12, whiteSpace: 'nowrap' }}>
          <thead>
            <tr style={{ background: '#f9fafb' }}>
              {devFilter === 'all' && <th style={{ ...thS('left'), position: 'sticky', top: 0, zIndex: 2 }}>Development</th>}
              <th style={{ ...thS('left'), position: 'sticky', top: 0, zIndex: 2 }}>Lot #</th>
              <th style={{ ...thS('left'), position: 'sticky', top: 0, zIndex: 2 }}>Type</th>
              <th style={{ ...thS('left'), position: 'sticky', top: 0, zIndex: 2 }}>Phase</th>
              <th style={{ ...thS('center'), position: 'sticky', top: 0, zIndex: 2, color: '#0d9488' }}>Bldg</th>
              <th style={{ ...thS('left'), position: 'sticky', top: 0, zIndex: 2 }}>Src</th>
              <th style={{ ...thS('center'), position: 'sticky', top: 0, zIndex: 2, color: '#0d9488' }}>Spec</th>
              <th style={{ ...thS('left'), position: 'sticky', top: 0, zIndex: 2 }}>Status</th>
              <th style={{ ...thS(), position: 'sticky', top: 0, zIndex: 2 }}>ENT</th>
              <th style={{ ...thS(), position: 'sticky', top: 0, zIndex: 2 }}>DEV</th>
              <th style={{ ...thS(), position: 'sticky', top: 0, zIndex: 2 }}>HC</th>
              <th style={{ ...thS(), position: 'sticky', top: 0, zIndex: 2 }}>BLDR</th>
              <th style={{ ...thS(), position: 'sticky', top: 0, zIndex: 2 }}>DIG</th>
              <th style={{ ...thS(), position: 'sticky', top: 0, zIndex: 2 }}>CMP</th>
              <th style={{ ...thS(), position: 'sticky', top: 0, zIndex: 2 }}>CLS</th>
              <th style={{ ...thS('left'), position: 'sticky', top: 0, zIndex: 2 }}>SD</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((l, idx) => {
              const vf = violatedFields(l)
              const vTip = violationTip(l)
              const VDot = ({ field }) => vf.has(field) ? <ViolationDot title={vTip} /> : null
              const bgKey = l.building_group_id != null ? `${l.phase_name}::${l.building_group_id}` : null
              const bgLabel = bgKey ? bgLabelMap[bgKey] : null
              const bgIndex = bgLabel ? parseInt(bgLabel.slice(1)) - 1 : 0
              const rowTint = bgLabel ? BG_ROW_PALETTE[bgIndex % BG_ROW_PALETTE.length] : null
              const prevLot = idx > 0 ? filtered[idx - 1] : null
              const isGroupStart = l.building_group_id != null && (
                !prevLot || prevLot.building_group_id !== l.building_group_id || prevLot.phase_name !== l.phase_name
              )
              return (
              <tr key={l.lot_id} style={{ background: rowTint ?? '' }}>
                {devFilter === 'all' && <td style={tdS('left')}>{l.dev_name}</td>}
                <td style={tdS('left')}>{l.lot_number ?? '—'}</td>
                <td style={tdS('left')}>{l.lot_type_short ?? '—'}</td>
                <td style={tdS('left')}>{l.phase_name}</td>
                <td style={tdS('center', {
                  color: '#0d9488', fontWeight: 600, fontSize: 11, letterSpacing: '0.02em',
                  borderTop: isGroupStart ? '2px solid #0d9488' : undefined,
                })}>{bgLabel ?? ''}</td>
                <td style={tdS('left', { color: '#6b7280', fontSize: 11 })}>{l.lot_source}</td>
                <td style={tdS('center')}>
                  {l.is_spec === true  && <span style={{ fontSize: 10, fontWeight: 700, padding: '1px 5px', borderRadius: 3, background: '#f0fdfa', color: '#0d9488', border: '1px solid #99f6e4' }}>S</span>}
                  {l.is_spec === false && <span style={{ fontSize: 10, fontWeight: 600, padding: '1px 5px', borderRadius: 3, background: '#f9fafb', color: '#6b7280', border: '1px solid #e5e7eb' }}>B</span>}
                  {l.is_spec == null  && <span style={{ fontSize: 10, color: '#d1d5db' }}>—</span>}
                </td>
                <td style={tdS('left')}><StatusBadge status={l.status} pill /></td>
                <td style={tdS()}>
                  <span style={{ display: 'inline-flex', alignItems: 'center' }}>
                    {l.date_ent ? fmt(l.date_ent) : <span style={{ color: '#e5e7eb' }}>—</span>}
                    <VDot field="date_ent" />
                  </span>
                </td>
                <td style={tdS()}>
                  <span style={{ display: 'inline-flex', alignItems: 'center' }}>
                    {l.date_dev ? fmt(l.date_dev) : <span style={{ color: '#e5e7eb' }}>—</span>}
                    <VDot field="date_dev" />
                  </span>
                </td>
                <td style={tdS()}>
                  <OverrideDateCell lotId={l.lot_id} dateField="date_td_hold" label="HC"
                    marksValue={l.date_td_hold} projectedValue={null}
                    overrideValue={l.ov_date_td_hold}
                    onApply={onApplyOverride} onClear={onClearOverride}
                    disabled={!overrideable(l)} />
                </td>
                <td style={tdS()}>
                  <span style={{ display: 'inline-flex', alignItems: 'center' }}>
                    <OverrideDateCell lotId={l.lot_id} dateField="date_td" label="BLDR"
                      marksValue={l.date_td} projectedValue={null}
                      overrideValue={l.ov_date_td}
                      onApply={onApplyOverride} onClear={onClearOverride}
                      disabled={!overrideable(l)} />
                    <VDot field="date_td" />
                  </span>
                </td>
                <td style={tdS()}>
                  <span style={{ display: 'inline-flex', alignItems: 'center' }}>
                    <OverrideDateCell lotId={l.lot_id} dateField="date_str" label="DIG"
                      marksValue={l.date_str} projectedValue={l.date_str_projected}
                      overrideValue={l.ov_date_str}
                      onApply={onApplyOverride} onClear={onClearOverride}
                      disabled={!overrideable(l)} />
                    <VDot field="date_str" />
                  </span>
                </td>
                <td style={tdS()}>
                  <span style={{ display: 'inline-flex', alignItems: 'center' }}>
                    <OverrideDateCell lotId={l.lot_id} dateField="date_cmp" label="CMP"
                      marksValue={l.date_cmp} projectedValue={l.date_cmp_projected}
                      overrideValue={l.ov_date_cmp}
                      onApply={onApplyOverride} onClear={onClearOverride}
                      disabled={!overrideable(l)} />
                    <VDot field="date_cmp" />
                  </span>
                </td>
                <td style={tdS()}>
                  <span style={{ display: 'inline-flex', alignItems: 'center' }}>
                    <OverrideDateCell lotId={l.lot_id} dateField="date_cls" label="CLS"
                      marksValue={l.date_cls} projectedValue={l.date_cls_projected}
                      overrideValue={l.ov_date_cls}
                      onApply={onApplyOverride} onClear={onClearOverride}
                      disabled={!overrideable(l)} />
                    <VDot field="date_cls" />
                  </span>
                </td>
                <td style={tdS('left')}>
                  {sdEditing === l.lot_id ? (
                    <select ref={sdSelectRef} autoFocus
                      defaultValue={l.resolved_sd_id ?? ''}
                      disabled={sdSaving}
                      onChange={e => saveSd(l.lot_id, e.target.value ? Number(e.target.value) : null)}
                      onBlur={() => setSdEditing(null)}
                      style={{ fontSize: 11, padding: '1px 3px', borderRadius: 3,
                               border: '1px solid #2563eb', maxWidth: 140 }}>
                      <option value="">— clear —</option>
                      {sdOptions.map(d => <option key={d.sd_id} value={d.sd_id}>{d.district_name}</option>)}
                    </select>
                  ) : (
                    <span
                      onClick={() => openSdEdit(l)}
                      title={l.sd_is_lot_exception ? 'Lot-level SD override (click to edit)' : 'Inherited (click to set exception)'}
                      style={{
                        fontSize: 11, cursor: 'pointer',
                        color: l.sd_is_lot_exception ? '#92400e' : '#9ca3af',
                        borderBottom: l.sd_is_lot_exception ? '1px dashed #d97706' : '1px dashed transparent',
                      }}>
                      {l.resolved_sd_name ?? '—'}
                    </span>
                  )}
                </td>
              </tr>
            )})}
          </tbody>
        </table>
      </div>
    </div>
  )
}
