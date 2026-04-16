import { useState, useEffect } from 'react'
import { API_BASE } from '../../config'
import { ACTIVE_FLOOR_KEYS, ACTIVE_FLOOR_LABELS, fmt } from './simShared'

const MONTH_LABELS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']

// ─── DateSuggest ──────────────────────────────────────────────────────────────

export function DateSuggest({ suggest, current, label, onAccept }) {
  if (!suggest) return null
  const violated = !!current && /^\d{4}-\d{2}-\d{2}$/.test(current) && current > suggest
  const mo = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  const [y, m] = suggest.split('-').map(Number)
  const display = `${mo[m - 1]} '${String(y).slice(2)}`
  return (
    <span
      onClick={() => onAccept(suggest)}
      title={`${label}: ${suggest}`}
      style={{
        fontSize: 11, cursor: 'pointer', userSelect: 'none',
        color: violated ? '#d97706' : '#9ca3af',
        borderBottom: `1px dashed ${violated ? '#d97706' : '#d1d5db'}`,
      }}>
      {violated ? '⚠ ' : '← '}{display}
    </span>
  )
}

// ─── subtractMonths ───────────────────────────────────────────────────────────

export function subtractMonths(dateStr, n) {
  if (!dateStr || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return null
  const [y, m, d] = dateStr.split('-').map(Number)
  let nm = m - 1 - n
  const ny = y + Math.floor(nm / 12)
  nm = ((nm % 12) + 12) % 12
  const lastDay = new Date(ny, nm + 1, 0).getDate()
  return `${ny}-${String(nm + 1).padStart(2, '0')}-${String(Math.min(d, lastDay)).padStart(2, '0')}`
}

// ─── MonthGrid ────────────────────────────────────────────────────────────────

export function MonthGrid({ selected, onChange, locked }) {
  return (
    <div style={{ display: 'flex', gap: 4 }}>
      {MONTH_LABELS.map((label, i) => {
        const m = i + 1
        const on = selected.includes(m)
        return (
          <button key={m} disabled={locked} onClick={() => {
            if (locked) return
            onChange(on ? selected.filter(x => x !== m) : [...selected, m].sort((a,b) => a-b))
          }} style={{
            padding: '3px 6px', fontSize: 11, borderRadius: 4, cursor: locked ? 'default' : 'pointer',
            border: on ? '1px solid #2563eb' : '1px solid #d1d5db',
            background: on ? '#dbeafe' : locked ? '#f9fafb' : '#fff',
            color: on ? '#1d4ed8' : '#6b7280',
            fontWeight: on ? 600 : 400,
            transition: 'all 0.1s',
          }}>
            {label}
          </button>
        )
      })}
    </div>
  )
}

// ─── LedgerConfigSection ──────────────────────────────────────────────────────

export function LedgerConfigSection({ entGroupId, datePaper, dateEnt, earliestDeliveryDate, onSaved, disabled }) {
  const [paperVal, setPaperVal] = useState(datePaper ?? '')
  const [entVal,   setEntVal]   = useState(dateEnt   ?? '')
  const [saving,   setSaving]   = useState(false)
  const [err,      setErr]      = useState(null)
  const [lotsMsg,  setLotsMsg]  = useState(null)

  useEffect(() => { setPaperVal(datePaper ?? '') }, [datePaper])
  useEffect(() => { setEntVal(dateEnt ?? '') },     [dateEnt])

  const isLocked = disabled || saving

  async function saveIfChanged(newPaper, newEnt) {
    if (newPaper === (datePaper ?? '') && newEnt === (dateEnt ?? '')) return
    setSaving(true); setErr(null); setLotsMsg(null)
    try {
      const res = await fetch(`${API_BASE}/entitlement-groups/${entGroupId}/ledger-config`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ date_paper: newPaper || null, date_ent: newEnt || null }),
      })
      if (!res.ok) throw new Error(await res.text())
      const data = await res.json()
      if (data.lots_entitled > 0) setLotsMsg(`${data.lots_entitled} lot${data.lots_entitled === 1 ? '' : 's'} entitled`)
      onSaved()
    } catch (e) { setErr(String(e)) }
    finally { setSaving(false) }
  }

  const rowStyle = { display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }
  const labelStyle = { fontSize: 12, color: '#374151', minWidth: 160 }
  const inputStyle = (saved, cur) => ({
    width: 120, padding: '3px 7px', fontSize: 12, borderRadius: 4,
    border: `1px solid ${cur !== (saved ?? '') ? '#2563eb' : '#d1d5db'}`,
    background: isLocked ? '#f3f4f6' : '#fff',
  })

  const suggestPaper = subtractMonths(entVal, 1)
  const suggestEnt   = earliestDeliveryDate ?? null

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={rowStyle}>
        <span style={labelStyle}>Ledger start date <span style={{ color: '#dc2626' }}>*</span></span>
        <input type="text" placeholder="YYYY-MM-DD" value={paperVal} disabled={isLocked}
          onChange={e => { setPaperVal(e.target.value); setErr(null); setLotsMsg(null) }}
          onBlur={e => saveIfChanged(e.target.value, entVal)}
          style={inputStyle(datePaper, paperVal)} />
        {!paperVal && <span style={{ fontSize: 11, color: '#dc2626' }}>Required</span>}
        {saving && <span style={{ fontSize: 11, color: '#9ca3af' }}>Saving…</span>}
        <DateSuggest suggest={suggestPaper} current={paperVal} label="Latest (1 mo before entitlement)"
          onAccept={v => { setPaperVal(v); saveIfChanged(v, entVal) }} />
      </div>
      <div style={rowStyle}>
        <span style={labelStyle}>Bulk entitlement date</span>
        <input type="text" placeholder="YYYY-MM-DD" value={entVal} disabled={isLocked}
          onChange={e => { setEntVal(e.target.value); setErr(null); setLotsMsg(null) }}
          onBlur={e => saveIfChanged(paperVal, e.target.value)}
          style={inputStyle(dateEnt, entVal)} />
        {!entVal && <span style={{ fontSize: 11, color: '#9ca3af' }}>Marks all P lots as entitled on this date</span>}
        {entVal && !saving && <span style={{ fontSize: 11, color: '#9ca3af' }}>{fmt(entVal)}</span>}
        <DateSuggest suggest={suggestEnt} current={entVal} label="Latest (before earliest delivery)"
          onAccept={v => { setEntVal(v); saveIfChanged(paperVal, v) }} />
      </div>
      {lotsMsg && <span style={{ fontSize: 11, color: '#16a34a' }}>{lotsMsg}</span>}
      {err    && <span style={{ fontSize: 11, color: '#dc2626' }}>{err}</span>}
    </div>
  )
}

// ─── GlobalSettingsSection ────────────────────────────────────────────────────

export function GlobalSettingsSection({ globalSettings, onSaved, disabled }) {
  const [edits, setEdits] = useState({})
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState(null)

  const isDirty  = Object.keys(edits).length > 0
  const isLocked = disabled || saving

  const currentMonths = edits.delivery_months !== undefined
    ? edits.delivery_months
    : (globalSettings?.delivery_months ?? [5,6,7,8,9,10,11])

  function valFor(key) { return edits[key] !== undefined ? edits[key] : (globalSettings?.[key] ?? '') }
  function setVal(key, v) { setEdits(p => ({ ...p, [key]: v })) }

  async function save() {
    setSaving(true); setErr(null)
    const body = { delivery_months: currentMonths.length > 0 ? currentMonths : null }
    const v_max = valFor('max_deliveries_per_year')
    body.max_deliveries_per_year = v_max === '' ? null : parseInt(v_max, 10)
    const v_cmp = valFor('default_cmp_lag_days')
    body.default_cmp_lag_days = v_cmp === '' ? null : parseInt(v_cmp, 10)
    const v_cls = valFor('default_cls_lag_days')
    body.default_cls_lag_days = v_cls === '' ? null : parseInt(v_cls, 10)
    for (const key of ACTIVE_FLOOR_KEYS) {
      const v = valFor(key); body[key] = v === '' ? null : parseInt(v, 10)
    }
    try {
      const res = await fetch(`${API_BASE}/global-settings`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) throw new Error(await res.text())
      setEdits({}); onSaved()
    } catch (e) { setErr(String(e)) }
    finally { setSaving(false) }
  }

  const numInput = (key, width = 56, placeholder = '—') => (
    <input key={key} type="number" min="0" placeholder={placeholder}
      value={valFor(key)} disabled={isLocked}
      onChange={e => setVal(key, e.target.value)}
      style={{ width, padding: '2px 5px', fontSize: 12, borderRadius: 4, textAlign: 'right',
               background: isLocked ? '#f3f4f6' : '#fff',
               border: `1px solid ${edits[key] !== undefined ? '#2563eb' : '#d1d5db'}` }} />
  )

  const textLink = (label, onClick) => (
    <button onClick={onClick} disabled={isLocked} style={{
      fontSize: 11, color: isLocked ? '#d1d5db' : '#2563eb',
      background: 'none', border: 'none', cursor: isLocked ? 'default' : 'pointer', padding: 0,
    }}>{label}</button>
  )

  const sectionHead = (title) => (
    <div style={{ fontSize: 12, fontWeight: 600, color: '#374151', marginBottom: 8 }}>{title}</div>
  )

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div>
        {sectionHead('Default delivery window')}
        <MonthGrid selected={currentMonths}
          onChange={months => setEdits(p => ({ ...p, delivery_months: months }))}
          locked={isLocked} />
        <div style={{ display: 'flex', gap: 12, marginTop: 6, alignItems: 'center' }}>
          {textLink('All', () => setEdits(p => ({ ...p, delivery_months: [1,2,3,4,5,6,7,8,9,10,11,12] })))}
          {textLink('None', () => setEdits(p => ({ ...p, delivery_months: [] })))}
        </div>
      </div>

      <div>
        {sectionHead('Scheduling defaults')}
        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'center' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
            <span style={{ color: '#6b7280' }}>Deliveries per year</span>
            {numInput('max_deliveries_per_year', 52, '1')}
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
            <span style={{ color: '#6b7280' }}>Start → completion (days)</span>
            {numInput('default_cmp_lag_days', 56, '270')}
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
            <span style={{ color: '#6b7280' }}>Completion → closing (days)</span>
            {numInput('default_cls_lag_days', 56, '45')}
          </label>
        </div>
      </div>

      <div>
        {sectionHead('Minimum inventory alerts')}
        <div style={{ fontSize: 11, color: '#9ca3af', marginBottom: 8 }}>
          Ledger rows highlight orange when a status count drops below its floor.
        </div>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
          {ACTIVE_FLOOR_KEYS.map(key => (
            <label key={key} style={{ display: 'flex', flexDirection: 'column', gap: 3, fontSize: 12 }}>
              <span style={{ color: '#9ca3af', fontSize: 11 }}>{ACTIVE_FLOOR_LABELS[key]}</span>
              {numInput(key, 56)}
            </label>
          ))}
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        {isDirty && (
          <button disabled={isLocked} onClick={save}
            style={{ padding: '4px 14px', fontSize: 12, borderRadius: 4, border: 'none',
                     background: isLocked ? '#d1d5db' : '#2563eb', color: '#fff',
                     cursor: isLocked ? 'default' : 'pointer' }}>
            {saving ? 'Saving…' : 'Save global defaults'}
          </button>
        )}
        {err && <span style={{ fontSize: 11, color: '#dc2626' }}>{err}</span>}
      </div>
    </div>
  )
}

// ─── DeliveryConfigSection ────────────────────────────────────────────────────

export function DeliveryConfigSection({ entGroupId, deliveryConfig, globalSettings, onSaved, disabled }) {
  const [edits, setEdits] = useState({})
  const [saving, setSaving] = useState(false)
  const [err, setErr]       = useState(null)
  const [editingGlobalHorizon, setEditingGlobalHorizon] = useState(false)
  const [globalHorizonDraft, setGlobalHorizonDraft]     = useState('')
  const [savingGlobal, setSavingGlobal]                 = useState(false)

  const isDirty  = Object.keys(edits).length > 0
  const isLocked = disabled || saving

  const communityMonths = deliveryConfig?.delivery_months
  const globalMonths    = globalSettings?.delivery_months ?? [5,6,7,8,9,10,11]
  const hasMonthOverride = edits.delivery_months !== undefined
    ? edits.delivery_months !== null
    : communityMonths !== null && communityMonths !== undefined

  const currentMonths = edits.delivery_months !== undefined
    ? (edits.delivery_months ?? [])
    : (communityMonths ?? globalMonths)

  const communityMaxDel = deliveryConfig?.max_deliveries_per_year
  const globalMaxDel    = globalSettings?.max_deliveries_per_year ?? 1
  const hasMaxDelOverride = edits.max_deliveries_per_year !== undefined
    ? edits.max_deliveries_per_year !== null
    : communityMaxDel !== null && communityMaxDel !== undefined

  const communityHorizon = deliveryConfig?.scheduling_horizon_days
  const globalHorizon    = globalSettings?.scheduling_horizon_days ?? 14
  const hasHorizonOverride = edits.scheduling_horizon_days !== undefined
    ? edits.scheduling_horizon_days !== null
    : communityHorizon !== null && communityHorizon !== undefined

  function valFor(key) { return edits[key] !== undefined ? edits[key] : (deliveryConfig?.[key] ?? '') }
  function setVal(key, v) { setEdits(p => ({ ...p, [key]: v })) }

  const globalMonthsLabel = globalMonths.length
    ? globalMonths.map(m => MONTH_LABELS[m - 1]).join(', ')
    : 'none'

  async function saveGlobalHorizon() {
    const v = parseInt(globalHorizonDraft, 10)
    if (isNaN(v) || v < 0) return
    setSavingGlobal(true)
    try {
      await fetch(`${API_BASE}/global-settings`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scheduling_horizon_days: v }),
      })
      setEditingGlobalHorizon(false)
      onSaved()
    } finally { setSavingGlobal(false) }
  }

  async function save() {
    setSaving(true); setErr(null)
    const body = {}

    if (edits.delivery_months !== undefined) {
      body.delivery_months = edits.delivery_months
    } else if (!hasMonthOverride) {
      body.delivery_months = null
    }

    if (edits.max_deliveries_per_year !== undefined) {
      body.max_deliveries_per_year = edits.max_deliveries_per_year === null ? null
        : parseInt(edits.max_deliveries_per_year, 10)
    } else if (!hasMaxDelOverride) {
      body.max_deliveries_per_year = null
    }

    const asVal = valFor('auto_schedule_enabled')
    if (asVal !== '') body.auto_schedule_enabled = asVal === true || asVal === 'true'

    const fsVal = valFor('feed_starts_mode')
    if (fsVal !== '') body.feed_starts_mode = fsVal === true || fsVal === 'true'

    if (edits.scheduling_horizon_days !== undefined) {
      body.scheduling_horizon_days = edits.scheduling_horizon_days === null ? null
        : parseInt(edits.scheduling_horizon_days, 10)
    }

    try {
      const res = await fetch(`${API_BASE}/entitlement-groups/${entGroupId}/delivery-config`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) throw new Error(await res.text())
      setEdits({}); onSaved()
    } catch (e) { setErr(String(e)) }
    finally { setSaving(false) }
  }

  const textLink = (label, onClick, color = '#2563eb') => (
    <button onClick={onClick} disabled={isLocked} style={{
      fontSize: 11, color: isLocked ? '#d1d5db' : color,
      background: 'none', border: 'none', cursor: isLocked ? 'default' : 'pointer', padding: 0,
    }}>{label}</button>
  )

  const sectionHead = (title) => (
    <div style={{ fontSize: 12, fontWeight: 600, color: '#374151', marginBottom: 8 }}>{title}</div>
  )

  const numInput = (key, width = 52, placeholder = '—') => (
    <input key={key} type="number" min="0" placeholder={placeholder}
      value={valFor(key)} disabled={isLocked}
      onChange={e => setVal(key, e.target.value)}
      style={{ width, padding: '2px 5px', fontSize: 12, borderRadius: 4, textAlign: 'right',
               background: isLocked ? '#f3f4f6' : '#fff',
               border: `1px solid ${edits[key] !== undefined ? '#2563eb' : '#d1d5db'}` }} />
  )

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

      <div>
        {sectionHead('Delivery scheduling')}
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12,
                        cursor: isLocked ? 'default' : 'pointer' }}>
          <input type="checkbox" disabled={isLocked}
            checked={valFor('auto_schedule_enabled') === true || valFor('auto_schedule_enabled') === 'true'}
            onChange={e => setVal('auto_schedule_enabled', e.target.checked)}
            style={{ width: 14, height: 14, accentColor: '#2563eb' }} />
          <span style={{ color: '#6b7280' }}>Schedule deliveries automatically</span>
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12,
                        cursor: isLocked ? 'default' : 'pointer', marginTop: 6 }}>
          <input type="checkbox" disabled={isLocked}
            checked={valFor('feed_starts_mode') === true || valFor('feed_starts_mode') === 'true'}
            onChange={e => setVal('feed_starts_mode', e.target.checked)}
            style={{ width: 14, height: 14, accentColor: '#d97706' }} />
          <span style={{ color: '#6b7280' }}>Aggressive batching (feed starts mode)</span>
        </label>
      </div>

      <div>
        {sectionHead('Delivery window')}
        {!hasMonthOverride ? (
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <span style={{ fontSize: 12, color: '#6b7280' }}>
              Using global ({globalMonthsLabel})
            </span>
            {textLink('Set override', () => setEdits(p => ({ ...p, delivery_months: [...globalMonths] })))}
          </div>
        ) : (
          <div>
            <MonthGrid selected={currentMonths}
              onChange={months => setEdits(p => ({ ...p, delivery_months: months }))}
              locked={isLocked} />
            <div style={{ display: 'flex', gap: 12, marginTop: 6, alignItems: 'center' }}>
              {textLink('All', () => setEdits(p => ({ ...p, delivery_months: [1,2,3,4,5,6,7,8,9,10,11,12] })))}
              {textLink('None', () => setEdits(p => ({ ...p, delivery_months: [] })))}
              <span style={{ color: '#e5e7eb' }}>·</span>
              {textLink('Revert to global', () => setEdits(p => ({ ...p, delivery_months: null })), '#dc2626')}
            </div>
          </div>
        )}
      </div>

      <div>
        {sectionHead('Deliveries per year')}
        {!hasMaxDelOverride ? (
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <span style={{ fontSize: 12, color: '#6b7280' }}>
              Using global ({globalMaxDel})
            </span>
            {textLink('Set override', () => setEdits(p => ({ ...p, max_deliveries_per_year: String(communityMaxDel ?? globalMaxDel) })))}
          </div>
        ) : (
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            {numInput('max_deliveries_per_year', 52, '1')}
            {textLink('Revert to global', () => setEdits(p => ({ ...p, max_deliveries_per_year: null })), '#dc2626')}
          </div>
        )}
      </div>

      <div>
        {sectionHead('Scheduling horizon')}
        {!hasHorizonOverride ? (
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <span style={{ fontSize: 12, color: '#6b7280' }}>
              Using global ({globalHorizon} days from today)
            </span>
            {textLink('Set override', () => setEdits(p => ({ ...p, scheduling_horizon_days: String(communityHorizon ?? globalHorizon) })))}
            <span style={{ color: '#e5e7eb' }}>·</span>
            {!editingGlobalHorizon
              ? textLink('Edit global', () => { setGlobalHorizonDraft(String(globalHorizon)); setEditingGlobalHorizon(true) }, '#6b7280')
              : (
                <span style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                  <input type="number" min="0" value={globalHorizonDraft}
                    onChange={e => setGlobalHorizonDraft(e.target.value)}
                    style={{ width: 52, padding: '2px 5px', fontSize: 12, borderRadius: 4,
                             border: '1px solid #2563eb', textAlign: 'right' }} />
                  <span style={{ fontSize: 12, color: '#6b7280' }}>days</span>
                  <button onClick={saveGlobalHorizon} disabled={savingGlobal}
                    style={{ fontSize: 11, padding: '2px 8px', borderRadius: 4, border: 'none',
                             background: '#2563eb', color: '#fff', cursor: 'pointer' }}>
                    {savingGlobal ? '…' : 'Save global'}
                  </button>
                  {textLink('Cancel', () => setEditingGlobalHorizon(false), '#6b7280')}
                </span>
              )
            }
          </div>
        ) : (
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            {numInput('scheduling_horizon_days', 52, String(globalHorizon))}
            <span style={{ fontSize: 12, color: '#6b7280' }}>days from today</span>
            {textLink('Revert to global', () => setEdits(p => ({ ...p, scheduling_horizon_days: null })), '#dc2626')}
          </div>
        )}
        <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 4 }}>
          No dates will be projected prior to today + this many days.
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        {isDirty && (
          <button disabled={isLocked} onClick={save}
            style={{ padding: '4px 14px', fontSize: 12, borderRadius: 4, border: 'none',
                     background: isLocked ? '#d1d5db' : '#2563eb', color: '#fff',
                     cursor: isLocked ? 'default' : 'pointer' }}>
            {saving ? 'Saving…' : 'Save community settings'}
          </button>
        )}
        {err && <span style={{ fontSize: 11, color: '#dc2626' }}>{err}</span>}
      </div>
    </div>
  )
}

// ─── LocationSection ─────────────────────────────────────────────────────────

export function LocationSection({ entGroupId, onSaved, disabled }) {
  const [counties, setCounties] = useState([])
  const [schoolDistricts, setSchoolDistricts] = useState([])
  const [countyId, setCountyId] = useState(undefined)   // undefined = not loaded
  const [sdId, setSdId]         = useState(undefined)
  const [saving, setSaving]     = useState(false)
  const [err, setErr]           = useState(null)

  useEffect(() => {
    if (!entGroupId) return
    Promise.all([
      fetch(`${API_BASE}/ref/counties`).then(r => r.json()),
      fetch(`${API_BASE}/admin/community-config/${entGroupId}`).then(r => r.json()),
    ]).then(([cList, cfg]) => {
      setCounties(cList)
      setCountyId(cfg.county_id ?? null)
      setSdId(cfg.school_district_id ?? null)
    }).catch(() => { setCountyId(null); setSdId(null) })
  }, [entGroupId])

  useEffect(() => {
    fetch(`${API_BASE}/ref/school-districts`).then(r => r.json()).then(setSchoolDistricts).catch(() => {})
  }, [])

  async function patch(body) {
    setSaving(true); setErr(null)
    try {
      const res = await fetch(`${API_BASE}/entitlement-groups/${entGroupId}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) throw new Error(await res.text())
      onSaved()
    } catch (e) { setErr(String(e)) }
    finally { setSaving(false) }
  }

  const isLocked = disabled || saving
  if (countyId === undefined) return <div style={{ fontSize: 12, color: '#9ca3af' }}>Loading…</div>

  const selStyle = {
    padding: '3px 7px', fontSize: 12, borderRadius: 4,
    border: '1px solid #d1d5db',
    background: isLocked ? '#f3f4f6' : '#fff', minWidth: 200,
  }
  const rowStyle = { display: 'flex', alignItems: 'center', gap: 10 }
  const labelStyle = { fontSize: 12, color: '#374151', minWidth: 160 }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={rowStyle}>
        <span style={labelStyle}>County</span>
        <select value={countyId ?? ''} disabled={isLocked} style={selStyle}
          onChange={e => {
            const v = e.target.value === '' ? null : Number(e.target.value)
            setCountyId(v); setSdId(null)
            patch({ county_id: v })
          }}>
          <option value="">— not set —</option>
          {counties.map(c => <option key={c.county_id} value={c.county_id}>{c.county_name}</option>)}
        </select>
      </div>
      <div style={rowStyle}>
        <span style={labelStyle}>School district</span>
        <select value={sdId ?? ''} disabled={isLocked} style={selStyle}
          onChange={e => {
            const v = e.target.value === '' ? null : Number(e.target.value)
            setSdId(v)
            patch({ school_district_id: v })
          }}>
          <option value="">— not set —</option>
          {schoolDistricts.map(d => <option key={d.sd_id} value={d.sd_id}>{d.district_name}</option>)}
        </select>
      </div>
      {saving && <span style={{ fontSize: 11, color: '#9ca3af' }}>Saving…</span>}
      {err    && <span style={{ fontSize: 11, color: '#dc2626' }}>{err}</span>}
    </div>
  )
}

// ─── StartsTargetsSection ─────────────────────────────────────────────────────

export function StartsTargetsSection({ entGroupId, params, onSaved, disabled }) {
  const [edits, setEdits] = useState({})

  if (!params.length) return (
    <div style={{ fontSize: 12, color: '#9ca3af' }}>No developments found. Run a simulation first.</div>
  )

  const DOT_COLOR = { ok: '#16a34a', stale: '#d97706', missing: '#dc2626' }

  return (
    <div>
      <div style={{ marginBottom: 8 }}>
        <span style={{ fontSize: 12, fontWeight: 600, color: '#374151' }}>Annual starts pace</span>
        <span style={{ fontSize: 11, color: '#9ca3af', marginLeft: 8 }}>
          Homes started per year and monthly cap, per development.
        </span>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4, paddingLeft: 15 }}>
        <span style={{ fontSize: 11, color: '#9ca3af', minWidth: 180 }}>Development</span>
        <span style={{ fontSize: 11, color: '#9ca3af', width: 68, textAlign: 'right' }}>Per year</span>
        <span style={{ fontSize: 11, color: '#9ca3af', width: 68, textAlign: 'right' }}>Max / mo</span>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
        {params.map(p => {
          const edit = edits[p.dev_id] || {}
          const annualVal   = edit.annual   !== undefined ? edit.annual   : (p.annual_starts_target ?? '')
          const maxMonthVal = edit.maxMonth !== undefined ? edit.maxMonth : (p.max_starts_per_month ?? '')
          const annualDirty   = edit.annual   !== undefined && edit.annual   !== String(p.annual_starts_target ?? '')
          const maxMonthDirty = edit.maxMonth !== undefined && edit.maxMonth !== String(p.max_starts_per_month ?? '')
          const dirty = annualDirty || maxMonthDirty

          async function save() {
            const n = parseInt(annualVal, 10)
            if (!n || n < 1) return
            const maxN = maxMonthVal === '' ? null : parseInt(maxMonthVal, 10)
            setEdits(prev => ({ ...prev, [p.dev_id]: { ...prev[p.dev_id], saving: true } }))
            try {
              const res = await fetch(`${API_BASE}/developments/${p.dev_id}/sim-params`, {
                method: 'PUT', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ annual_starts_target: n, max_starts_per_month: maxN }),
              })
              if (!res.ok) throw new Error(await res.text())
              setEdits(prev => { const next = { ...prev }; delete next[p.dev_id]; return next })
              onSaved()
            } catch (err) {
              setEdits(prev => ({ ...prev, [p.dev_id]: { ...prev[p.dev_id], saving: false, error: String(err) } }))
            }
          }

          return (
            <div key={p.dev_id} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ display: 'inline-block', width: 7, height: 7, borderRadius: '50%',
                             background: DOT_COLOR[p.status] ?? '#9ca3af', flexShrink: 0 }}
                    title={p.status} />
              <span style={{ fontSize: 12, color: '#374151', minWidth: 180 }}>{p.dev_name}</span>
              <input type="number" min="1" placeholder="—" value={annualVal}
                disabled={disabled || edit.saving}
                onChange={e => setEdits(prev => ({ ...prev, [p.dev_id]: { ...prev[p.dev_id], annual: e.target.value } }))}
                style={{ width: 68, padding: '2px 5px', fontSize: 12, borderRadius: 4, textAlign: 'right',
                         background: (disabled || edit.saving) ? '#f3f4f6' : '#fff',
                         border: `1px solid ${annualDirty ? '#2563eb' : '#d1d5db'}` }} />
              <input type="number" min="1" placeholder="—" value={maxMonthVal}
                disabled={disabled || edit.saving}
                onChange={e => setEdits(prev => ({ ...prev, [p.dev_id]: { ...prev[p.dev_id], maxMonth: e.target.value } }))}
                style={{ width: 68, padding: '2px 5px', fontSize: 12, borderRadius: 4, textAlign: 'right',
                         background: (disabled || edit.saving) ? '#f3f4f6' : '#fff',
                         border: `1px solid ${maxMonthDirty ? '#2563eb' : '#d1d5db'}` }} />
              {dirty && (
                <button disabled={disabled || edit.saving || !annualVal} onClick={save}
                  style={{ padding: '2px 8px', fontSize: 11, borderRadius: 4, border: 'none',
                           background: (disabled || edit.saving) ? '#d1d5db' : '#2563eb', color: '#fff',
                           cursor: (disabled || edit.saving) ? 'default' : 'pointer' }}>
                  {edit.saving ? '…' : 'Save'}
                </button>
              )}
              {edit.error && <span style={{ fontSize: 11, color: '#dc2626' }}>{edit.error}</span>}
            </div>
          )
        })}
      </div>
    </div>
  )
}
