import { useState, useRef } from 'react'
import { API_BASE } from '../../config'
import { StatusBadge } from '../../utils/statusConfig'
import OverrideDateCell from '../overrides/OverrideDateCell'
import { thS, tdS, fmt, exportToCsv, fmtLot, PROV_SIM, PROV_MARKS, PROV, provStyle, stripPrefix } from './simShared'

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

function sortVal(l, col, bgLabelMap) {
  switch (col) {
    case 'dev_name':       return l.dev_name ?? ''
    case 'lot_number':     return l.lot_number ?? ''
    case 'lot_type_short': return l.lot_type_short ?? ''
    case 'phase_name':     return l.phase_name ?? ''
    case 'bldg': {
      const k = l.building_group_id != null ? `${l.phase_name}::${l.building_group_id}` : null
      return k ? (bgLabelMap[k] ?? '') : ''
    }
    case 'lot_source':     return l.lot_source ?? ''
    case 'bldg_type':      return bgTypeMap[l.building_group_id] ?? ''
    case 'is_spec_s':
    case 'is_spec_b':      return l.is_spec === true ? 0 : l.is_spec === false ? 1 : 2
    case 'status':         return l.status ?? ''
    case 'date_ent':       return l.date_ent ?? null
    case 'date_dev':       return l.date_dev ?? null
    case 'date_hc':        return l.date_td_hold ?? l.date_td_hold_projected ?? null
    case 'date_bldr':      return l.date_td   ?? l.date_td_projected   ?? null
    case 'date_dig':       return l.date_str  ?? l.date_str_projected  ?? null
    case 'date_cmp':       return l.date_cmp  ?? l.date_cmp_projected  ?? null
    case 'date_cls':       return l.date_cls  ?? l.date_cls_projected  ?? null
    case 'sd':             return l.resolved_sd_name ?? ''
    default:               return ''
  }
}

function applySortedOrder(rows, col, dir, bgLabelMap) {
  if (!col) return rows
  return [...rows].sort((a, b) => {
    const av = sortVal(a, col, bgLabelMap)
    const bv = sortVal(b, col, bgLabelMap)
    // nulls last regardless of direction
    if (av === null && bv === null) return 0
    if (av === null) return 1
    if (bv === null) return -1
    const cmp = av < bv ? -1 : av > bv ? 1 : 0
    return dir === 'desc' ? -cmp : cmp
  })
}

export function LotLedger({ lots, loading, onApplyOverride, onClearOverride, onRefreshLots, communityName }) {
  const [devFilter,  setDevFilter]  = useState('all')
  const [srcFilter,  setSrcFilter]  = useState('all')
  const [specFilter, setSpecFilter] = useState('all')
  const [sortCol,    setSortCol]    = useState(null)
  const [sortDir,    setSortDir]    = useState('asc')
  const [sdEditing,  setSdEditing]  = useState(null)    // lot_id being edited
  const [sdOptions,  setSdOptions]  = useState([])      // loaded when edit opens
  const [sdSaving,   setSdSaving]   = useState(false)
  const sdSelectRef = useRef(null)

  async function openSdEdit(lot) {
    if (sdEditing === lot.lot_id) { setSdEditing(null); return }
    fetch(`${API_BASE}/ref/school-districts`).then(r => r.json()).then(opts => {
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

  function handleSort(col) {
    if (sortCol === col) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortCol(col); setSortDir('asc') }
  }

  const overrideable = l => l.lot_source === 'real'

  const bgTypeMap = (() => {
    const counts = {}
    for (const l of lots) {
      if (l.building_group_id != null) counts[l.building_group_id] = (counts[l.building_group_id] ?? 0) + 1
    }
    const labels = {}
    for (const [id, n] of Object.entries(counts)) {
      if (n === 1)      labels[id] = 'Villa'
      else if (n === 2) labels[id] = 'Duplex'
      else if (n === 3) labels[id] = 'Triplex'
      else if (n === 4) labels[id] = 'Quad'
      else              labels[id] = `${n}-plex`
    }
    return labels
  })()

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

  const sortedFiltered = applySortedOrder(filtered, sortCol, sortDir, bgLabelMap)

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
          {devNames.map(n => <option key={n} value={n}>{stripPrefix(n, communityName)}</option>)}
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
        {sortCol && (
          <button onClick={() => { setSortCol(null); setSortDir('asc') }}
            style={{ fontSize: 11, padding: '2px 8px', borderRadius: 4, border: '1px solid #d1d5db',
                     background: '#fff', color: '#6b7280', cursor: 'pointer' }}>
            ↺ reset sort
          </button>
        )}
        <span style={{ ...provStyle('marks'), marginLeft: 6 }}>MARKS</span>
        <span style={{ ...provStyle('sim'), marginLeft: 4 }}>SIM</span>
        <span style={{ ...provStyle('override'), marginLeft: 4 }}>OVR</span>
        <button onClick={() => {
          const headers = ['Development','Lot #','Type','Phase','Bldg','Source','Spec','Status','ENT','DEV','HC','BLDR','DIG','CMP','CLS']
          const csvRows = sortedFiltered.map(l => {
            const bgKey = l.building_group_id != null ? `${l.phase_name}::${l.building_group_id}` : null
            const bgLabel = bgKey ? bgLabelMap[bgKey] : ''
            const specLabel = l.is_spec === true ? 'Spec' : l.is_spec === false ? 'Build' : ''
            return [
              l.dev_name, l.lot_number ?? '', l.lot_type_short ?? '', l.phase_name, bgLabel,
              l.lot_source, specLabel, l.status,
              l.date_ent ?? '', l.date_dev ?? '', l.date_td_hold ?? l.date_td_hold_projected ?? '',
              l.date_td ?? l.date_td_projected ?? '', l.date_str ?? l.date_str_projected ?? '',
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
              {[
                devFilter === 'all' && ['dev_name',       'left',   'Development'],
                                       ['lot_number',     'left',   'Lot #'],
                                       ['lot_type_short', 'left',   'Type'],
                                       ['phase_name',     'left',   'Phase'],
                                       ['bldg',           'center', 'Bldg'],
                                       ['bldg_type',      'left',   'Bldg Type'],
                                       ['lot_source',     'left',   'Src'],
                                       ['is_spec_s',      'center', 'S'],
                                       ['is_spec_b',      'center', 'B'],
                                       ['status',         'left',   'Status'],
                                       ['date_ent',       'center', 'ENT'],
                                       ['date_dev',       'center', 'DEV'],
                                       ['date_hc',        'center', 'HC'],
                                       ['date_bldr',      'center', 'BLDR'],
                                       ['date_dig',       'center', 'DIG'],
                                       ['date_cmp',       'center', 'CMP'],
                                       ['date_cls',       'center', 'CLS'],
                                       ['sd',             'left',   'SD'],
              ].filter(Boolean).map(([col, align, label, extra]) => {
                const active = sortCol === col
                return (
                  <th key={col}
                    onClick={() => handleSort(col)}
                    style={{
                      ...thS(align), ...extra,
                      position: 'sticky', top: 0, zIndex: 2,
                      cursor: 'pointer', userSelect: 'none',
                      background: active ? '#eef2ff' : '#f9fafb',
                    }}>
                    {label}
                    {active
                      ? <span style={{ marginLeft: 3, fontSize: 9, color: '#4f46e5' }}>
                          {sortDir === 'asc' ? '▲' : '▼'}
                        </span>
                      : <span style={{ marginLeft: 3, fontSize: 9, color: '#d1d5db' }}>⇅</span>}
                  </th>
                )
              })}
            </tr>
          </thead>
          <tbody>
            {sortedFiltered.map((l, idx) => {
              const vf = violatedFields(l)
              const vTip = violationTip(l)
              const VDot = ({ field }) => vf.has(field) ? <ViolationDot title={vTip} /> : null
              const bgKey = l.building_group_id != null ? `${l.phase_name}::${l.building_group_id}` : null
              const bgLabel = bgKey ? bgLabelMap[bgKey] : null
              const bgIndex = bgLabel ? parseInt(bgLabel.slice(1)) - 1 : 0
              const rowTint = bgLabel ? BG_ROW_PALETTE[bgIndex % BG_ROW_PALETTE.length] : null
              const prevLot = idx > 0 ? sortedFiltered[idx - 1] : null
              const isGroupStart = l.building_group_id != null && (
                !prevLot || prevLot.building_group_id !== l.building_group_id || prevLot.phase_name !== l.phase_name
              )
              return (
              <tr key={l.lot_id} style={{ background: rowTint ?? '' }}>
                {devFilter === 'all' && <td style={tdS('left')}>{stripPrefix(l.dev_name, communityName)}</td>}
                <td style={tdS('left')}>{fmtLot(l.lot_number)}</td>
                <td style={tdS('left')}>{l.lot_type_short ?? '—'}</td>
                <td style={tdS('left')}>{stripPrefix(l.phase_name, communityName)}</td>
                <td style={tdS('center', {
                  borderTop: isGroupStart ? '2px solid #e5e7eb' : undefined,
                })}>{bgLabel ?? ''}</td>
                <td style={tdS('left', { color: '#6b7280', fontSize: 11 })}>
                  {l.building_group_id != null ? (bgTypeMap[l.building_group_id] ?? '—') : ''}
                </td>
                <td style={tdS('left', { color: '#6b7280', fontSize: 11 })}>{l.lot_source}</td>
                <td style={tdS('center', { width: 20 })}>
                  {l.is_spec === true && <span style={{ ...provStyle(l.lot_source === 'sim' ? 'sim' : 'marks'), fontSize: 10, padding: '0 4px' }}>S</span>}
                </td>
                <td style={tdS('center', { width: 20 })}>
                  {l.is_spec === false && <span style={{ ...provStyle(l.lot_source === 'sim' ? 'sim' : 'marks'), fontSize: 10, padding: '0 4px' }}>B</span>}
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
                    marksValue={l.date_td_hold} projectedValue={l.date_td_hold_projected}
                    overrideValue={l.ov_date_td_hold}
                    onApply={onApplyOverride} onClear={onClearOverride}
                    disabled={!overrideable(l)} isSim={l.lot_source === 'sim'} />
                </td>
                <td style={tdS()}>
                  <span style={{ display: 'inline-flex', alignItems: 'center' }}>
                    <OverrideDateCell lotId={l.lot_id} dateField="date_td" label="BLDR"
                      marksValue={l.date_td} projectedValue={l.date_td_projected}
                      overrideValue={l.ov_date_td}
                      onApply={onApplyOverride} onClear={onClearOverride}
                      disabled={!overrideable(l)} isSim={l.lot_source === 'sim'} />
                    <VDot field="date_td" />
                  </span>
                </td>
                <td style={tdS()}>
                  <span style={{ display: 'inline-flex', alignItems: 'center' }}>
                    <OverrideDateCell lotId={l.lot_id} dateField="date_str" label="DIG"
                      marksValue={l.date_str} projectedValue={l.date_str_projected}
                      overrideValue={l.ov_date_str}
                      onApply={onApplyOverride} onClear={onClearOverride}
                      disabled={!overrideable(l)} isSim={l.lot_source === 'sim'} />
                    <VDot field="date_str" />
                  </span>
                </td>
                <td style={tdS()}>
                  <span style={{ display: 'inline-flex', alignItems: 'center' }}>
                    <OverrideDateCell lotId={l.lot_id} dateField="date_cmp" label="CMP"
                      marksValue={l.date_cmp} projectedValue={l.date_cmp_projected}
                      overrideValue={l.ov_date_cmp}
                      onApply={onApplyOverride} onClear={onClearOverride}
                      disabled={!overrideable(l)} isSim={l.lot_source === 'sim'} />
                    <VDot field="date_cmp" />
                  </span>
                </td>
                <td style={tdS()}>
                  <span style={{ display: 'inline-flex', alignItems: 'center' }}>
                    <OverrideDateCell lotId={l.lot_id} dateField="date_cls" label="CLS"
                      marksValue={l.date_cls} projectedValue={l.date_cls_projected}
                      overrideValue={l.ov_date_cls}
                      onApply={onApplyOverride} onClear={onClearOverride}
                      disabled={!overrideable(l)} isSim={l.lot_source === 'sim'} />
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
