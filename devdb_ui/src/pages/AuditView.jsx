// AuditView.jsx
// Config audit: surfaces compliance issues between phase config, builder splits,
// delivery month constraints, and delivery event coverage.

import { useState, useEffect, useMemo } from 'react'
import { API_BASE } from '../utils/api'

const MONTH_SHORT = ['','Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']

// ─── Status constants ─────────────────────────────────────────────────────────

const S = {
  PASS:   'pass',
  WARN:   'warn',
  FAIL:   'fail',
  SKIP:   'skip',
}

const STATUS_COLOR = {
  pass: { bg: '#f0fdf4', border: '#86efac', text: '#166534', dot: '#22c55e' },
  warn: { bg: '#fefce8', border: '#fde047', text: '#854d0e', dot: '#eab308' },
  fail: { bg: '#fef2f2', border: '#fca5a5', text: '#991b1b', dot: '#ef4444' },
  skip: { bg: '#f9fafb', border: '#e5e7eb', text: '#9ca3af', dot: '#d1d5db' },
}

function Chip({ status, label, title }) {
  const c = STATUS_COLOR[status]
  return (
    <span title={title} style={{
      display: 'inline-flex', alignItems: 'center', gap: 4,
      fontSize: 11, padding: '2px 7px', borderRadius: 10,
      background: c.bg, border: `1px solid ${c.border}`, color: c.text,
      fontWeight: 500, whiteSpace: 'nowrap',
    }}>
      <span style={{ width: 6, height: 6, borderRadius: '50%', background: c.dot, flexShrink: 0 }} />
      {label}
    </span>
  )
}

function SummaryBar({ checks }) {
  const counts = { pass: 0, warn: 0, fail: 0, skip: 0 }
  for (const s of checks) counts[s] = (counts[s] ?? 0) + 1
  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
      {counts.fail > 0 && <Chip status="fail" label={`${counts.fail} issue${counts.fail !== 1 ? 's' : ''}`} />}
      {counts.warn > 0 && <Chip status="warn" label={`${counts.warn} warning${counts.warn !== 1 ? 's' : ''}`} />}
      {counts.pass > 0 && <Chip status="pass" label={`${counts.pass} pass`} />}
      {counts.fail === 0 && counts.warn === 0 && counts.pass === 0 && (
        <Chip status="skip" label="no checks" />
      )}
    </div>
  )
}

// ─── Audit logic ──────────────────────────────────────────────────────────────

function effectiveMonths(comm, globalMonths) {
  return comm.delivery_months != null ? comm.delivery_months : globalMonths
}

function checkPhase(phase, hasAnyEvents, globalMonths) {
  const { real_pre_lots, product_split_total, builder_splits, builder_split_sum, in_delivery_event } = phase

  // Product splits check
  let prod
  if (real_pre_lots > 0) {
    // Phase already has real/pre lots — product splits are supplementary
    prod = { status: S.SKIP, label: 'lots present', detail: `${real_pre_lots} real/pre lots — product splits optional` }
  } else if (product_split_total > 0) {
    prod = { status: S.PASS, label: `${product_split_total} projected`, detail: 'Product splits configured' }
  } else {
    prod = { status: S.WARN, label: 'no splits', detail: 'No product splits and no real/pre lots — phase will have no simulation output' }
  }

  // Builder splits check
  let bld
  const hasAnyLots = real_pre_lots > 0 || product_split_total > 0
  if (!hasAnyLots) {
    bld = { status: S.SKIP, label: 'no lots', detail: 'No lots or projections — builder splits not needed' }
  } else if (builder_split_sum === null) {
    bld = { status: S.WARN, label: 'not set', detail: 'No builder splits configured — simulation will assign all lots to default builder' }
  } else if (Math.abs(builder_split_sum - 100) < 0.5) {
    const parts = Object.entries(builder_splits).map(([id, s]) => `Builder ${id}: ${(s*100).toFixed(0)}%`).join(', ')
    bld = { status: S.PASS, label: `${builder_split_sum}%`, detail: `Builder splits sum to 100% — ${parts}` }
  } else if (builder_split_sum > 100.5) {
    bld = { status: S.FAIL, label: `${builder_split_sum}% (over)`, detail: `Builder splits sum to ${builder_split_sum}% — exceeds 100%, will distort starts allocation` }
  } else {
    bld = { status: S.WARN, label: `${builder_split_sum}%`, detail: `Builder splits sum to ${builder_split_sum}% — remaining ${(100 - builder_split_sum).toFixed(1)}% unassigned` }
  }

  // Delivery event coverage check
  let del
  if (!hasAnyLots) {
    del = { status: S.SKIP, label: 'no lots', detail: 'No lots — delivery coverage not applicable' }
  } else if (!hasAnyEvents) {
    del = { status: S.WARN, label: 'no events', detail: 'No delivery events exist for this community yet' }
  } else if (in_delivery_event) {
    del = { status: S.PASS, label: 'covered', detail: 'Phase is assigned to at least one delivery event' }
  } else {
    del = { status: S.FAIL, label: 'uncovered', detail: 'Delivery events exist but this phase has not been assigned to any of them' }
  }

  return { prod, bld, del }
}

function checkDeliveryEvent(ev, effMonths, eventsThisYear, maxPerYear) {
  const date = ev.date_dev_actual || ev.date_dev_projected

  // Month compliance
  let month
  if (!date) {
    month = { status: S.WARN, label: 'no date', detail: 'No delivery date set — cannot check month compliance' }
  } else if (effMonths.length === 0) {
    month = { status: S.WARN, label: 'no months set', detail: 'No delivery months configured — any month is allowed but this may be unintentional' }
  } else {
    const m = parseInt(date.slice(5, 7), 10)
    if (effMonths.includes(m)) {
      month = { status: S.PASS, label: MONTH_SHORT[m], detail: `${MONTH_SHORT[m]} is within configured delivery months (${effMonths.map(x=>MONTH_SHORT[x]).join(', ')})` }
    } else {
      month = { status: S.FAIL, label: `${MONTH_SHORT[m]} blocked`, detail: `${MONTH_SHORT[m]} is not in configured delivery months (${effMonths.map(x=>MONTH_SHORT[x]).join(', ')})` }
    }
  }

  // Phase coverage
  const phases = {
    status: ev.phase_ids.length > 0 ? S.PASS : S.WARN,
    label:  ev.phase_ids.length > 0 ? `${ev.phase_ids.length} phase${ev.phase_ids.length!==1?'s':''}` : 'no phases',
    detail: ev.phase_ids.length > 0
      ? `${ev.phase_ids.length} phase(s) assigned to this event`
      : 'No phases assigned — this event will have no lots',
  }

  // Year limit
  let yearLimit
  if (!date || maxPerYear == null) {
    yearLimit = { status: S.SKIP, label: maxPerYear == null ? 'no limit' : 'no date', detail: maxPerYear == null ? 'No max deliveries/year configured' : 'No date set' }
  } else {
    const year = date.slice(0, 4)
    const count = eventsThisYear[year] ?? 0
    if (count <= maxPerYear) {
      yearLimit = { status: S.PASS, label: `${count}/${maxPerYear}`, detail: `${count} of ${maxPerYear} allowed events in ${year}` }
    } else {
      yearLimit = { status: S.FAIL, label: `${count}/${maxPerYear} OVER`, detail: `${count} delivery events in ${year} exceeds the configured maximum of ${maxPerYear}` }
    }
  }

  return { month, phases, yearLimit }
}

// ─── Community sidebar item ───────────────────────────────────────────────────

function commOverallStatus(comm, globalMonths, globalMaxPerYear) {
  const effMonths    = effectiveMonths(comm, globalMonths)
  const maxPerYear   = comm.max_deliveries_per_year ?? globalMaxPerYear
  const hasEvents    = comm.delivery_events.length > 0

  // Year event counts
  const eventsThisYear = {}
  for (const ev of comm.delivery_events) {
    const d = ev.date_dev_actual || ev.date_dev_projected
    if (d) { const y = d.slice(0,4); eventsThisYear[y] = (eventsThisYear[y]??0)+1 }
  }

  const statuses = []
  for (const p of comm.phases) {
    const c = checkPhase(p, hasEvents, globalMonths)
    statuses.push(c.prod.status, c.bld.status, c.del.status)
  }
  for (const ev of comm.delivery_events) {
    const c = checkDeliveryEvent(ev, effMonths, eventsThisYear, maxPerYear)
    statuses.push(c.month.status, c.phases.status, c.yearLimit.status)
  }

  if (statuses.includes(S.FAIL)) return S.FAIL
  if (statuses.includes(S.WARN)) return S.WARN
  if (statuses.includes(S.PASS)) return S.PASS
  return S.SKIP
}

// ─── Phase checks table ───────────────────────────────────────────────────────

function PhaseChecksTable({ comm, globalMonths }) {
  const hasEvents = comm.delivery_events.length > 0
  if (comm.phases.length === 0) {
    return <div style={{ fontSize: 12, color: '#9ca3af', padding: '12px 0' }}>No phases configured.</div>
  }

  const thStyle = {
    padding: '5px 8px', fontSize: 11, fontWeight: 600, color: '#6b7280',
    background: '#f8fafc', borderBottom: '2px solid #e5e7eb',
    textAlign: 'left', whiteSpace: 'nowrap', position: 'sticky', top: 0,
  }

  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
        <thead>
          <tr>
            <th style={thStyle}>Phase</th>
            <th style={thStyle}>Development</th>
            <th style={{ ...thStyle, textAlign: 'right' }}>Real/Pre</th>
            <th style={{ ...thStyle, borderLeft: '2px solid #e5e7eb' }}>Product Splits</th>
            <th style={thStyle}>Builder Splits</th>
            <th style={thStyle}>Delivery Coverage</th>
          </tr>
        </thead>
        <tbody>
          {comm.phases.map((phase, i) => {
            const { prod, bld, del } = checkPhase(phase, hasEvents, globalMonths)
            const bg = i % 2 === 0 ? '#fff' : '#fafafa'
            const td = (extra={}) => ({ padding: '5px 8px', background: bg, borderTop: '1px solid #f3f4f6', verticalAlign: 'middle', ...extra })
            return (
              <tr key={phase.phase_id}>
                <td style={td({ fontWeight: 500, color: '#1e293b' })}>{phase.phase_name}</td>
                <td style={td({ color: '#6b7280' })}>{phase.dev_name}</td>
                <td style={td({ textAlign: 'right', color: phase.real_pre_lots > 0 ? '#1e40af' : '#d1d5db' })}>
                  {phase.real_pre_lots > 0 ? phase.real_pre_lots : '—'}
                </td>
                <td style={td({ borderLeft: '2px solid #f1f5f9' })}>
                  <Chip status={prod.status} label={prod.label} title={prod.detail} />
                </td>
                <td style={td()}>
                  <Chip status={bld.status} label={bld.label} title={bld.detail} />
                </td>
                <td style={td()}>
                  <Chip status={del.status} label={del.label} title={del.detail} />
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

// ─── Delivery event checks table ──────────────────────────────────────────────

function DeliveryEventsTable({ comm, globalMonths, globalMaxPerYear }) {
  const effMonths  = effectiveMonths(comm, globalMonths)
  const maxPerYear = comm.max_deliveries_per_year ?? globalMaxPerYear

  if (comm.delivery_events.length === 0) {
    return (
      <div style={{ fontSize: 12, color: '#9ca3af', padding: '12px 0' }}>
        No delivery events. Run a simulation or add events manually in Setup.
      </div>
    )
  }

  // Precompute events per year
  const eventsThisYear = {}
  for (const ev of comm.delivery_events) {
    const d = ev.date_dev_actual || ev.date_dev_projected
    if (d) { const y = d.slice(0,4); eventsThisYear[y] = (eventsThisYear[y]??0)+1 }
  }

  const thStyle = {
    padding: '5px 8px', fontSize: 11, fontWeight: 600, color: '#6b7280',
    background: '#f8fafc', borderBottom: '2px solid #e5e7eb',
    textAlign: 'left', whiteSpace: 'nowrap', position: 'sticky', top: 0,
  }

  const fmtDate = iso => iso
    ? new Date(iso + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
    : '—'

  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
        <thead>
          <tr>
            <th style={thStyle}>Event</th>
            <th style={thStyle}>Date</th>
            <th style={{ ...thStyle, borderLeft: '2px solid #e5e7eb' }}>Month</th>
            <th style={thStyle}>Phase Coverage</th>
            <th style={thStyle}>Year Limit</th>
            <th style={{ ...thStyle, color: '#c0c8d4', fontSize: 10 }}>Auto?</th>
          </tr>
        </thead>
        <tbody>
          {comm.delivery_events.map((ev, i) => {
            const { month, phases, yearLimit } = checkDeliveryEvent(ev, effMonths, eventsThisYear, maxPerYear)
            const bg = i % 2 === 0 ? '#fff' : '#fafafa'
            const td = (extra={}) => ({ padding: '5px 8px', background: bg, borderTop: '1px solid #f3f4f6', verticalAlign: 'middle', ...extra })
            const displayDate = ev.date_dev_actual || ev.date_dev_projected
            const isProj = !ev.date_dev_actual && !!ev.date_dev_projected
            return (
              <tr key={ev.delivery_event_id}>
                <td style={td({ fontWeight: 500, color: '#1e293b' })}>{ev.event_name}</td>
                <td style={td({ color: isProj ? '#93c5fd' : '#374151', fontStyle: isProj ? 'italic' : 'normal' })}>
                  {fmtDate(displayDate)}
                  {isProj && <span style={{ fontSize: 10, marginLeft: 4 }}>proj</span>}
                </td>
                <td style={td({ borderLeft: '2px solid #f1f5f9' })}>
                  <Chip status={month.status} label={month.label} title={month.detail} />
                </td>
                <td style={td()}>
                  <Chip status={phases.status} label={phases.label} title={phases.detail} />
                </td>
                <td style={td()}>
                  <Chip status={yearLimit.status} label={yearLimit.label} title={yearLimit.detail} />
                </td>
                <td style={td({ color: '#c0c8d4', fontSize: 10, textAlign: 'center' })}>
                  {ev.is_auto_created ? 'auto' : ''}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

// ─── Delivery config summary strip ───────────────────────────────────────────

function DeliveryConfigStrip({ comm, globalMonths, globalMaxPerYear }) {
  const effMonths  = effectiveMonths(comm, globalMonths)
  const maxPerYear = comm.max_deliveries_per_year ?? globalMaxPerYear
  const isOverride = comm.delivery_months != null

  return (
    <div style={{
      display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center',
      padding: '6px 10px', background: '#f8fafc', borderRadius: 6,
      border: '1px solid #e2e8f0', fontSize: 11, marginBottom: 14,
    }}>
      <span style={{ color: '#6b7280', fontWeight: 600 }}>Delivery config:</span>
      <span title="Effective delivery months for this community">
        <span style={{ color: '#94a3b8' }}>Months:</span>{' '}
        <span style={{ color: '#1e293b' }}>
          {effMonths.length === 0 ? 'none (blocked)'
           : effMonths.length === 12 ? 'all'
           : effMonths.map(m => MONTH_SHORT[m]).join(', ')}
        </span>
        {isOverride && <span style={{ color: '#2563eb', marginLeft: 4 }}>(override)</span>}
      </span>
      <span title="Max delivery events per calendar year">
        <span style={{ color: '#94a3b8' }}>Max/yr:</span>{' '}
        <span style={{ color: '#1e293b' }}>{maxPerYear ?? '—'}</span>
      </span>
      <span title="Auto-scheduling enabled">
        <span style={{ color: '#94a3b8' }}>Auto:</span>{' '}
        <span style={{ color: comm.auto_schedule_enabled ? '#16a34a' : '#9ca3af' }}>
          {comm.auto_schedule_enabled ? 'on' : comm.auto_schedule_enabled === false ? 'off' : '—'}
        </span>
      </span>
    </div>
  )
}

// ─── Community detail panel ───────────────────────────────────────────────────

function CommDetail({ comm, globalMonths, globalMaxPerYear }) {
  // Collect all check statuses for the summary bar
  const effMonths  = effectiveMonths(comm, globalMonths)
  const maxPerYear = comm.max_deliveries_per_year ?? globalMaxPerYear
  const hasEvents  = comm.delivery_events.length > 0
  const eventsThisYear = {}
  for (const ev of comm.delivery_events) {
    const d = ev.date_dev_actual || ev.date_dev_projected
    if (d) { const y = d.slice(0,4); eventsThisYear[y] = (eventsThisYear[y]??0)+1 }
  }

  const allStatuses = []
  for (const p of comm.phases) {
    const c = checkPhase(p, hasEvents, globalMonths)
    allStatuses.push(c.prod.status, c.bld.status, c.del.status)
  }
  for (const ev of comm.delivery_events) {
    const c = checkDeliveryEvent(ev, effMonths, eventsThisYear, maxPerYear)
    allStatuses.push(c.month.status, c.phases.status, c.yearLimit.status)
  }

  const sectionHead = (label) => (
    <div style={{ fontSize: 11, fontWeight: 700, color: '#64748b', letterSpacing: '0.07em',
                  textTransform: 'uppercase', marginBottom: 8, marginTop: 16 }}>
      {label}
    </div>
  )

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
        <span style={{ fontSize: 15, fontWeight: 700, color: '#1e293b' }}>{comm.ent_group_name}</span>
        <SummaryBar checks={allStatuses} />
      </div>

      <DeliveryConfigStrip comm={comm} globalMonths={globalMonths} globalMaxPerYear={globalMaxPerYear} />

      {sectionHead(`Phases (${comm.phases.length})`)}
      <PhaseChecksTable comm={comm} globalMonths={globalMonths} />

      {sectionHead(`Delivery Events (${comm.delivery_events.length})`)}
      <DeliveryEventsTable comm={comm} globalMonths={globalMonths} globalMaxPerYear={globalMaxPerYear} />
    </div>
  )
}

// ─── Main AuditView ───────────────────────────────────────────────────────────

export default function AuditView({ showTestCommunities }) {
  const [data,       setData]       = useState(null)
  const [loading,    setLoading]    = useState(true)
  const [error,      setError]      = useState(null)
  const [selected,   setSelected]   = useState(null)  // ent_group_id
  const [search,     setSearch]     = useState('')
  const [filterFail, setFilterFail] = useState(false)

  useEffect(() => {
    setLoading(true)
    fetch(`${API_BASE}/admin/audit-data`)
      .then(r => r.ok ? r.json() : Promise.reject(r.statusText))
      .then(d => { setData(d); setLoading(false) })
      .catch(e => { setError(String(e)); setLoading(false) })
  }, [])

  const communities = useMemo(() => {
    if (!data) return []
    return data.communities.filter(c => showTestCommunities ? c.is_test : !c.is_test)
  }, [data, showTestCommunities])

  const visibleComms = useMemo(() => {
    let list = communities
    if (search.trim()) {
      const q = search.toLowerCase()
      list = list.filter(c => c.ent_group_name.toLowerCase().includes(q))
    }
    if (filterFail) {
      list = list.filter(c => commOverallStatus(c, data.global_months, data.global_max_per_year) !== S.PASS
                            && commOverallStatus(c, data.global_months, data.global_max_per_year) !== S.SKIP)
    }
    return list
  }, [communities, search, filterFail, data])

  const selectedComm = useMemo(() =>
    communities.find(c => c.ent_group_id === selected) ?? null,
    [communities, selected])

  // Overall summary across all communities
  const globalStatuses = useMemo(() => {
    if (!data) return []
    const all = []
    for (const c of communities) {
      const s = commOverallStatus(c, data.global_months, data.global_max_per_year)
      all.push(s)
    }
    return all
  }, [communities, data])

  const failCount = globalStatuses.filter(s => s === S.FAIL).length
  const warnCount = globalStatuses.filter(s => s === S.WARN).length
  const passCount = globalStatuses.filter(s => s === S.PASS).length

  if (loading) return (
    <div style={{ padding: 40, fontSize: 13, color: '#9ca3af', textAlign: 'center' }}>Loading audit data…</div>
  )
  if (error) return (
    <div style={{ padding: 40, fontSize: 13, color: '#dc2626' }}>Error: {error}</div>
  )

  return (
    <div style={{ display: 'flex', height: 'calc(100vh - 48px)', overflow: 'hidden' }}>

      {/* ── Left sidebar: community list ── */}
      <div style={{
        width: 260, flexShrink: 0, borderRight: '1px solid #e5e7eb',
        display: 'flex', flexDirection: 'column', background: '#fafafa',
      }}>
        {/* Header */}
        <div style={{ padding: '12px 12px 8px', borderBottom: '1px solid #e5e7eb' }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: '#1e293b', marginBottom: 8 }}>Config Audit</div>
          <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
            <Chip status="fail" label={String(failCount)} title={`${failCount} communities with issues`} />
            <Chip status="warn" label={String(warnCount)} title={`${warnCount} communities with warnings`} />
            <Chip status="pass" label={String(passCount)} title={`${passCount} communities passing all checks`} />
          </div>
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search communities…"
            style={{
              width: '100%', fontSize: 11, padding: '4px 8px', borderRadius: 4,
              border: '1px solid #d1d5db', background: '#fff', outline: 'none',
              boxSizing: 'border-box',
            }}
          />
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 6, fontSize: 11, color: '#6b7280', cursor: 'pointer', userSelect: 'none' }}>
            <input type="checkbox" checked={filterFail} onChange={e => setFilterFail(e.target.checked)}
              style={{ cursor: 'pointer' }} />
            Issues only
          </label>
        </div>

        {/* Community list */}
        <div style={{ flex: 1, overflowY: 'auto' }}>
          {visibleComms.length === 0 && (
            <div style={{ padding: 16, fontSize: 11, color: '#9ca3af', textAlign: 'center' }}>No matches.</div>
          )}
          {visibleComms.map(c => {
            const status = commOverallStatus(c, data.global_months, data.global_max_per_year)
            const col    = STATUS_COLOR[status]
            const isSel  = c.ent_group_id === selected
            return (
              <div
                key={c.ent_group_id}
                onClick={() => setSelected(isSel ? null : c.ent_group_id)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 8,
                  padding: '7px 12px', cursor: 'pointer', userSelect: 'none',
                  borderLeft: isSel ? '3px solid #2563eb' : '3px solid transparent',
                  background: isSel ? '#eff6ff' : 'transparent',
                  borderBottom: '1px solid #f1f5f9',
                }}
              >
                <span style={{ width: 8, height: 8, borderRadius: '50%', background: col.dot, flexShrink: 0 }} />
                <span style={{ fontSize: 12, color: isSel ? '#1d4ed8' : '#374151', flex: 1, lineHeight: 1.3 }}>
                  {c.ent_group_name}
                </span>
                <span style={{ fontSize: 10, color: '#9ca3af', flexShrink: 0 }}>
                  {c.phases.length}p
                </span>
              </div>
            )
          })}
        </div>
      </div>

      {/* ── Right panel: detail or overview ── */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '16px 20px' }}>
        {selectedComm ? (
          <CommDetail
            comm={selectedComm}
            globalMonths={data.global_months}
            globalMaxPerYear={data.global_max_per_year}
          />
        ) : (
          <OverviewTable
            communities={visibleComms}
            globalMonths={data.global_months}
            globalMaxPerYear={data.global_max_per_year}
            onSelect={id => setSelected(id)}
          />
        )}
      </div>
    </div>
  )
}

// ─── Overview table (no community selected) ───────────────────────────────────

function OverviewTable({ communities, globalMonths, globalMaxPerYear, onSelect }) {
  const rows = communities.map(c => {
    const effMonths  = effectiveMonths(c, globalMonths)
    const maxPerYear = c.max_deliveries_per_year ?? globalMaxPerYear
    const hasEvents  = c.delivery_events.length > 0
    const eventsThisYear = {}
    for (const ev of c.delivery_events) {
      const d = ev.date_dev_actual || ev.date_dev_projected
      if (d) { const y = d.slice(0,4); eventsThisYear[y] = (eventsThisYear[y]??0)+1 }
    }

    // Aggregate phase checks
    let prodFail=0, prodWarn=0
    let bldFail=0, bldWarn=0
    let delFail=0, delWarn=0
    for (const p of c.phases) {
      const ch = checkPhase(p, hasEvents, globalMonths)
      if (ch.prod.status===S.FAIL) prodFail++; else if (ch.prod.status===S.WARN) prodWarn++
      if (ch.bld.status===S.FAIL)  bldFail++;  else if (ch.bld.status===S.WARN)  bldWarn++
      if (ch.del.status===S.FAIL)  delFail++;  else if (ch.del.status===S.WARN)  delWarn++
    }

    // Aggregate event checks
    let monthFail=0, monthWarn=0
    let evPhaseFail=0, evPhaseWarn=0
    let yearFail=0
    for (const ev of c.delivery_events) {
      const ch = checkDeliveryEvent(ev, effMonths, eventsThisYear, maxPerYear)
      if (ch.month.status===S.FAIL) monthFail++; else if (ch.month.status===S.WARN) monthWarn++
      if (ch.phases.status===S.FAIL) evPhaseFail++; else if (ch.phases.status===S.WARN) evPhaseWarn++
      if (ch.yearLimit.status===S.FAIL) yearFail++
    }

    const overall = commOverallStatus(c, globalMonths, globalMaxPerYear)

    function mini(fail, warn, total, skipVal) {
      if (total === 0) return <span style={{ color: '#d1d5db', fontSize: 10 }}>—</span>
      if (fail > 0) return <Chip status="fail" label={`${fail}`} title={`${fail} issue${fail!==1?'s':''}`} />
      if (warn > 0) return <Chip status="warn" label={`${warn}`} title={`${warn} warning${warn!==1?'s':''}`} />
      return <Chip status="pass" label="all ok" />
    }

    return { c, overall, prodFail, prodWarn, bldFail, bldWarn, delFail, delWarn, monthFail, monthWarn, evPhaseFail, evPhaseWarn, yearFail }
  })

  const thStyle = {
    padding: '6px 10px', fontSize: 11, fontWeight: 600, color: '#6b7280',
    background: '#f3f4f6', borderBottom: '2px solid #e5e7eb',
    textAlign: 'left', whiteSpace: 'nowrap', position: 'sticky', top: 0, zIndex: 2,
  }

  return (
    <div>
      <div style={{ fontSize: 13, fontWeight: 700, color: '#1e293b', marginBottom: 4 }}>
        All Communities — Config Overview
      </div>
      <div style={{ fontSize: 11, color: '#9ca3af', marginBottom: 14 }}>
        Click a row to inspect details. Hover chips for tooltips.
      </div>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
          <thead>
            <tr>
              <th style={{ ...thStyle, width: 24 }} />
              <th style={thStyle}>Community</th>
              <th style={{ ...thStyle, textAlign: 'center' }}>Phases</th>
              <th style={{ ...thStyle, textAlign: 'center', borderLeft: '2px solid #e5e7eb' }}
                  title="Phases missing product splits">Product Splits</th>
              <th style={{ ...thStyle, textAlign: 'center' }}
                  title="Phases with builder split issues">Builder Splits</th>
              <th style={{ ...thStyle, textAlign: 'center' }}
                  title="Phases not covered by a delivery event">Delivery Coverage</th>
              <th style={{ ...thStyle, textAlign: 'center', borderLeft: '2px solid #e5e7eb' }}
                  title="Delivery events in blocked months">Month Compliance</th>
              <th style={{ ...thStyle, textAlign: 'center' }}
                  title="Delivery events over annual limit">Year Limit</th>
              <th style={{ ...thStyle, textAlign: 'center' }}
                  title="Delivery events with no phases assigned">Event Coverage</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ c, overall, prodFail, prodWarn, bldFail, bldWarn, delFail, delWarn, monthFail, monthWarn, evPhaseFail, evPhaseWarn, yearFail }, i) => {
              const col = STATUS_COLOR[overall]
              const bg  = i % 2 === 0 ? '#fff' : '#fafafa'
              const td  = (extra={}) => ({ padding: '6px 10px', background: bg, borderTop: '1px solid #f3f4f6', verticalAlign: 'middle', ...extra })

              function mini(fail, warn, count) {
                if (count === 0) return <span style={{ color: '#d1d5db', fontSize: 10 }}>—</span>
                if (fail > 0) return <Chip status="fail" label={String(fail)} title={`${fail} issue${fail!==1?'s':''}`} />
                if (warn > 0) return <Chip status="warn" label={String(warn)} title={`${warn} warning${warn!==1?'s':''}`} />
                return <Chip status="pass" label="ok" />
              }

              return (
                <tr key={c.ent_group_id}
                    onClick={() => onSelect(c.ent_group_id)}
                    style={{ cursor: 'pointer' }}
                    onMouseEnter={e => e.currentTarget.style.background = '#f0f9ff'}
                    onMouseLeave={e => { e.currentTarget.querySelectorAll('td').forEach(td => td.style.background = '') }}
                >
                  <td style={td({ textAlign: 'center', paddingRight: 4 })}>
                    <span style={{ width: 8, height: 8, borderRadius: '50%', background: col.dot, display: 'inline-block' }} />
                  </td>
                  <td style={td({ fontWeight: 500, color: '#1e293b' })}>{c.ent_group_name}</td>
                  <td style={td({ textAlign: 'center', color: '#6b7280' })}>{c.phases.length}</td>
                  <td style={td({ textAlign: 'center', borderLeft: '2px solid #f1f5f9' })}>
                    {mini(prodFail, prodWarn, c.phases.length)}
                  </td>
                  <td style={td({ textAlign: 'center' })}>
                    {mini(bldFail, bldWarn, c.phases.length)}
                  </td>
                  <td style={td({ textAlign: 'center' })}>
                    {mini(delFail, delWarn, c.phases.length)}
                  </td>
                  <td style={td({ textAlign: 'center', borderLeft: '2px solid #f1f5f9' })}>
                    {mini(monthFail, monthWarn, c.delivery_events.length)}
                  </td>
                  <td style={td({ textAlign: 'center' })}>
                    {mini(yearFail, 0, c.delivery_events.length)}
                  </td>
                  <td style={td({ textAlign: 'center' })}>
                    {mini(evPhaseFail, evPhaseWarn, c.delivery_events.length)}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
