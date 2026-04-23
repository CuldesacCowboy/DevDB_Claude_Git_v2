// AuditView.jsx
// Config audit: surfaces compliance issues between phase config, builder splits,
// delivery month constraints, delivery event coverage, spec rates, and dev params.
// Actionable chips: spec rate, delivery tier, and annual starts target can be edited inline.
// Complex issues (builder splits, product splits) link directly to the relevant Config tab.

import { useState, useEffect, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { API_BASE } from '../config'

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

// ─── Editable chip — wraps a Chip with an inline input triggered by pencil icon ─

function EditableChip({ status, label, title, editType, current, onSave }) {
  const [editing, setSaving_] = useState(false)  // renamed internal
  const [val,     setVal]     = useState('')
  const [busy,    setBusy]    = useState(false)
  const [err,     setErr]     = useState(null)

  const canEdit = (status === S.WARN || status === S.FAIL) && !!onSave

  function open() {
    setVal(current != null ? String(current) : '')
    setErr(null)
    setSaving_(true)
  }

  async function commit(rawVal) {
    const v = (rawVal ?? val).trim()
    if (!v) { setSaving_(false); return }
    setBusy(true); setErr(null)
    try {
      await onSave(v)
      setSaving_(false)
    } catch (e) {
      setErr(String(e).replace(/^Error:\s*/, '').slice(0, 80))
    } finally {
      setBusy(false)
    }
  }

  if (editing) {
    const inputStyle = {
      width: editType === 'tier' ? 50 : 64, fontSize: 11, padding: '2px 5px',
      borderRadius: 4, border: `1px solid ${err ? '#f87171' : '#94a3b8'}`,
      outline: 'none', background: '#fff',
    }
    return (
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, flexWrap: 'wrap' }}>
        {editType === 'tier' ? (
          <select value={val} autoFocus style={inputStyle}
            onChange={async e => {
              const v = e.target.value
              setVal(v)
              if (v) await commit(v)
            }}
            onBlur={() => { if (!busy) setSaving_(false) }}
            onKeyDown={e => { if (e.key === 'Escape') setSaving_(false) }}
          >
            <option value="">—</option>
            <option value="1">T1</option>
            <option value="2">T2</option>
            <option value="3">T3</option>
          </select>
        ) : (
          <input type="number" value={val} autoFocus style={inputStyle}
            onChange={e => setVal(e.target.value)}
            onBlur={() => commit()}
            onKeyDown={e => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') setSaving_(false) }}
            placeholder={editType === 'percent' ? '%' : '#'}
            min={editType === 'percent' ? 0 : 1}
            max={editType === 'percent' ? 100 : undefined}
          />
        )}
        {busy && <span style={{ fontSize: 10, color: '#9ca3af' }}>…</span>}
        {err  && <span style={{ fontSize: 10, color: '#dc2626', maxWidth: 120 }} title={err}>⚠ {err}</span>}
      </span>
    )
  }

  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}>
      <Chip status={status} label={label} title={canEdit ? `${title} — click ✎ to edit` : title} />
      {canEdit && (
        <span onClick={open} title="Edit inline"
          style={{ fontSize: 12, color: '#94a3b8', cursor: 'pointer', userSelect: 'none', lineHeight: 1 }}>
          ✎
        </span>
      )}
    </span>
  )
}

// ─── Go-to-Config navigation button ──────────────────────────────────────────

function GoToConfigBtn({ tab, entGroupId, label = '→ Config' }) {
  const navigate = useNavigate()
  function go() {
    try { localStorage.setItem('devdb_config_jump', JSON.stringify({ tab, ent_group_id: entGroupId })) } catch {}
    navigate('/configure')
  }
  return (
    <button onClick={go} title={`Open Configure → ${tab} tab, filtered to this community`}
      style={{
        fontSize: 10, padding: '1px 6px', borderRadius: 4, marginLeft: 4,
        border: '1px solid #cbd5e1', background: '#f8fafc',
        color: '#475569', cursor: 'pointer', whiteSpace: 'nowrap',
      }}>
      {label}
    </button>
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

function buildDatesPerYear(deliveryEvents) {
  const datesPerYear = {}
  for (const ev of deliveryEvents) {
    const d = ev.date_dev_actual || ev.date_dev_projected
    if (d) {
      const y = d.slice(0, 4)
      if (!datesPerYear[y]) datesPerYear[y] = new Set()
      datesPerYear[y].add(d)
    }
  }
  return datesPerYear
}

function checkPhase(phase, hasAnyEvents, globalMonths) {
  const { real_pre_lots, product_split_total, builder_splits, builder_split_sum,
          in_delivery_event, spec_rate, delivery_tier } = phase
  const hasAnyLots = real_pre_lots > 0 || product_split_total > 0

  // Product splits
  let prod
  if (real_pre_lots > 0) {
    prod = { status: S.SKIP, label: 'lots present', detail: `${real_pre_lots} real/pre lots — product splits optional` }
  } else if (product_split_total > 0) {
    prod = { status: S.PASS, label: `${product_split_total} projected`, detail: 'Product splits configured' }
  } else {
    prod = { status: S.WARN, label: 'no splits', detail: 'No product splits and no real/pre lots — phase will have no simulation output' }
  }

  // Builder splits
  let bld
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

  // Delivery coverage
  let del
  if (!hasAnyLots) {
    del = { status: S.SKIP, label: 'no lots', detail: 'No lots — delivery coverage not applicable' }
  } else if (!hasAnyEvents) {
    del = { status: S.WARN, label: 'no events', detail: 'No delivery events — run a simulation to auto-create delivery events for this community' }
  } else if (in_delivery_event) {
    del = { status: S.PASS, label: 'covered', detail: 'Phase is assigned to at least one delivery event' }
  } else {
    del = { status: S.FAIL, label: 'uncovered', detail: 'Delivery events exist but this phase has not been assigned to any of them' }
  }

  // Spec rate
  let spec
  if (!hasAnyLots) {
    spec = { status: S.SKIP, label: 'no lots', detail: 'No lots — spec rate not needed' }
  } else if (spec_rate != null) {
    spec = { status: S.PASS, label: `${(spec_rate * 100).toFixed(0)}%`, detail: `Spec rate configured at ${(spec_rate * 100).toFixed(1)}% — S-0950 will assign spec/build flags` }
  } else {
    spec = { status: S.WARN, label: 'not set', detail: 'No spec rate on this instrument — S-0950 will skip spec/build assignment for all lots in this phase' }
  }

  // Delivery tier
  let tier
  if (!hasAnyLots) {
    tier = { status: S.SKIP, label: 'no lots', detail: 'No lots — delivery tier not needed' }
  } else if (delivery_tier != null) {
    tier = { status: S.PASS, label: `T${delivery_tier}`, detail: `Delivery tier ${delivery_tier} — controls P-0050 scheduling order within the entitlement group` }
  } else {
    tier = { status: S.WARN, label: 'no tier', detail: 'No delivery tier set — phase will default to NULL tier, which may cause unexpected scheduling order' }
  }

  return { prod, bld, del, spec, tier }
}

function checkDev(dev, phases) {
  const devPhases = phases.filter(p => p.dev_id === dev.dev_id)
  const hasLots   = devPhases.some(p => p.real_pre_lots > 0 || p.product_split_total > 0)

  let startsTarget
  if (!hasLots) {
    startsTarget = { status: S.SKIP, label: 'no lots', detail: 'No lots in any phase — annual starts target not needed' }
  } else if (dev.annual_starts_target != null) {
    startsTarget = { status: S.PASS, label: `${dev.annual_starts_target}/yr`, detail: `Annual starts target: ${dev.annual_starts_target} — S-0600 will use this as the demand signal` }
  } else {
    startsTarget = { status: S.WARN, label: 'not set', detail: 'No annual starts target in sim_dev_params — simulation will not generate projected starts for this development' }
  }

  return { startsTarget }
}

function checkDeliveryEvent(ev, effMonths, datesPerYear, maxPerYear) {
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

  // Year limit — counts distinct delivery dates per year, not events.
  // Multiple phases/events on the same date count as one delivery day.
  let yearLimit
  if (!date || maxPerYear == null) {
    yearLimit = { status: S.SKIP, label: maxPerYear == null ? 'no limit' : 'no date', detail: maxPerYear == null ? 'No max deliveries/year configured' : 'No date set' }
  } else {
    const year  = date.slice(0, 4)
    const count = datesPerYear[year]?.size ?? 0
    if (count <= maxPerYear) {
      yearLimit = { status: S.PASS, label: `${count}/${maxPerYear}`, detail: `${count} distinct delivery date${count!==1?'s':''} in ${year} (limit: ${maxPerYear})` }
    } else {
      yearLimit = { status: S.FAIL, label: `${count}/${maxPerYear} OVER`, detail: `${count} distinct delivery dates in ${year} exceeds the configured maximum of ${maxPerYear}` }
    }
  }

  return { month, phases, yearLimit }
}

// ─── Community sidebar item ───────────────────────────────────────────────────

function commOverallStatus(comm, globalMonths, globalMaxPerYear) {
  const effMonths    = effectiveMonths(comm, globalMonths)
  const maxPerYear   = comm.max_deliveries_per_year ?? globalMaxPerYear
  const hasEvents    = comm.delivery_events.length > 0
  const datesPerYear = buildDatesPerYear(comm.delivery_events)

  const statuses = []
  for (const p of comm.phases) {
    const c = checkPhase(p, hasEvents, globalMonths)
    statuses.push(c.prod.status, c.bld.status, c.del.status, c.spec.status, c.tier.status)
  }
  for (const ev of comm.delivery_events) {
    const c = checkDeliveryEvent(ev, effMonths, datesPerYear, maxPerYear)
    statuses.push(c.month.status, c.phases.status, c.yearLimit.status)
  }
  for (const dev of (comm.developments || [])) {
    const c = checkDev(dev, comm.phases)
    statuses.push(c.startsTarget.status)
  }

  if (statuses.includes(S.FAIL)) return S.FAIL
  if (statuses.includes(S.WARN)) return S.WARN
  if (statuses.includes(S.PASS)) return S.PASS
  return S.SKIP
}

// ─── Phase checks table ───────────────────────────────────────────────────────

function PhaseChecksTable({ comm, globalMonths, onSaved }) {
  const hasEvents = comm.delivery_events.length > 0
  if (comm.phases.length === 0) {
    return <div style={{ fontSize: 12, color: '#9ca3af', padding: '12px 0' }}>No phases configured.</div>
  }

  const thStyle = {
    padding: '5px 8px', fontSize: 11, fontWeight: 600, color: '#6b7280',
    background: '#f8fafc', borderBottom: '2px solid #e5e7eb',
    textAlign: 'left', whiteSpace: 'nowrap', position: 'sticky', top: 0,
  }

  async function saveSpecRate(phase, rawPct) {
    const pct = parseFloat(rawPct)
    if (isNaN(pct) || pct < 0 || pct > 100) throw new Error('Enter 0–100')
    const res = await fetch(`${API_BASE}/instruments/${phase.instrument_id}/spec-rate`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ spec_rate: pct / 100 }),
    })
    if (!res.ok) throw new Error(await res.text())
    onSaved()
  }

  async function saveTier(phase, rawTier) {
    const tier = parseInt(rawTier, 10)
    if (isNaN(tier)) throw new Error('Invalid tier')
    const res = await fetch(`${API_BASE}/admin/phase/${phase.phase_id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ delivery_tier: tier }),
    })
    if (!res.ok) throw new Error(await res.text())
    onSaved()
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
            <th style={{ ...thStyle, borderLeft: '2px solid #e5e7eb' }}>Spec Rate</th>
            <th style={thStyle}>Tier</th>
          </tr>
        </thead>
        <tbody>
          {comm.phases.map((phase, i) => {
            const { prod, bld, del, spec, tier } = checkPhase(phase, hasEvents, globalMonths)
            const bg = i % 2 === 0 ? '#fff' : '#fafafa'
            const td = (extra={}) => ({ padding: '5px 8px', background: bg, borderTop: '1px solid #f3f4f6', verticalAlign: 'middle', ...extra })
            return (
              <tr key={phase.phase_id}>
                <td style={td({ fontWeight: 500, color: '#1e293b' })}>{phase.phase_name}</td>
                <td style={td({ color: '#6b7280' })}>{phase.dev_name}</td>
                <td style={td({ textAlign: 'right', color: phase.real_pre_lots > 0 ? '#1e40af' : '#d1d5db' })}>
                  {phase.real_pre_lots > 0 ? phase.real_pre_lots : '—'}
                </td>
                {/* Product splits — nav button when no splits */}
                <td style={td({ borderLeft: '2px solid #f1f5f9' })}>
                  <span style={{ display: 'inline-flex', alignItems: 'center' }}>
                    <Chip status={prod.status} label={prod.label} title={prod.detail} />
                    {prod.status === S.WARN && (
                      <GoToConfigBtn tab="phase" entGroupId={comm.ent_group_id} label="→ Config" />
                    )}
                  </span>
                </td>
                {/* Builder splits — nav button when warn/fail */}
                <td style={td()}>
                  <span style={{ display: 'inline-flex', alignItems: 'center' }}>
                    <Chip status={bld.status} label={bld.label} title={bld.detail} />
                    {(bld.status === S.WARN || bld.status === S.FAIL) && (
                      <GoToConfigBtn tab="instrument" entGroupId={comm.ent_group_id} label="→ Config" />
                    )}
                  </span>
                </td>
                <td style={td()}>
                  <Chip status={del.status} label={del.label} title={del.detail} />
                </td>
                {/* Spec rate — editable inline */}
                <td style={td({ borderLeft: '2px solid #f1f5f9' })}>
                  <EditableChip
                    status={spec.status} label={spec.label} title={spec.detail}
                    editType="percent"
                    current={spec.status === S.PASS ? (phase.spec_rate * 100).toFixed(0) : null}
                    onSave={spec.status !== S.SKIP ? v => saveSpecRate(phase, v) : null}
                  />
                </td>
                {/* Delivery tier — editable inline */}
                <td style={td()}>
                  <EditableChip
                    status={tier.status} label={tier.label} title={tier.detail}
                    editType="tier"
                    current={phase.delivery_tier}
                    onSave={tier.status !== S.SKIP ? v => saveTier(phase, v) : null}
                  />
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

// ─── Development checks table ─────────────────────────────────────────────────

function DevChecksTable({ comm, onSaved }) {
  const devs = comm.developments || []
  if (devs.length === 0) return null

  const thStyle = {
    padding: '5px 8px', fontSize: 11, fontWeight: 600, color: '#6b7280',
    background: '#f8fafc', borderBottom: '2px solid #e5e7eb',
    textAlign: 'left', whiteSpace: 'nowrap', position: 'sticky', top: 0,
  }

  async function saveStartsTarget(dev, rawVal) {
    const n = parseInt(rawVal, 10)
    if (isNaN(n) || n < 1) throw new Error('Must be ≥ 1')
    const res = await fetch(`${API_BASE}/developments/${dev.dev_id}/sim-params`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ annual_starts_target: n }),
    })
    if (!res.ok) throw new Error(await res.text())
    onSaved()
  }

  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
        <thead>
          <tr>
            <th style={thStyle}>Development</th>
            <th style={{ ...thStyle, borderLeft: '2px solid #e5e7eb' }}>Annual Starts Target</th>
          </tr>
        </thead>
        <tbody>
          {devs.map((dev, i) => {
            const { startsTarget } = checkDev(dev, comm.phases)
            const bg = i % 2 === 0 ? '#fff' : '#fafafa'
            const td = (extra={}) => ({ padding: '5px 8px', background: bg, borderTop: '1px solid #f3f4f6', verticalAlign: 'middle', ...extra })
            return (
              <tr key={dev.dev_id}>
                <td style={td({ fontWeight: 500, color: '#1e293b' })}>{dev.dev_name}</td>
                <td style={td({ borderLeft: '2px solid #f1f5f9' })}>
                  <EditableChip
                    status={startsTarget.status} label={startsTarget.label} title={startsTarget.detail}
                    editType="number"
                    current={dev.annual_starts_target}
                    onSave={startsTarget.status !== S.SKIP ? v => saveStartsTarget(dev, v) : null}
                  />
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
  const effMonths    = effectiveMonths(comm, globalMonths)
  const maxPerYear   = comm.max_deliveries_per_year ?? globalMaxPerYear
  const datesPerYear = buildDatesPerYear(comm.delivery_events)

  if (comm.delivery_events.length === 0) {
    return (
      <div style={{ fontSize: 12, color: '#9ca3af', padding: '12px 0' }}>
        No delivery events. Run a simulation or add events manually in Setup.
      </div>
    )
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
            const { month, phases, yearLimit } = checkDeliveryEvent(ev, effMonths, datesPerYear, maxPerYear)
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
      <span title="Max distinct delivery dates per calendar year">
        <span style={{ color: '#94a3b8' }}>Max/yr:</span>{' '}
        <span style={{ color: '#1e293b' }}>{maxPerYear ?? '—'}</span>
      </span>
    </div>
  )
}

// ─── Community detail panel ───────────────────────────────────────────────────

function CommDetail({ comm, globalMonths, globalMaxPerYear, onSaved }) {
  const effMonths    = effectiveMonths(comm, globalMonths)
  const maxPerYear   = comm.max_deliveries_per_year ?? globalMaxPerYear
  const hasEvents    = comm.delivery_events.length > 0
  const datesPerYear = buildDatesPerYear(comm.delivery_events)

  const allStatuses = []
  for (const p of comm.phases) {
    const c = checkPhase(p, hasEvents, globalMonths)
    allStatuses.push(c.prod.status, c.bld.status, c.del.status, c.spec.status, c.tier.status)
  }
  for (const ev of comm.delivery_events) {
    const c = checkDeliveryEvent(ev, effMonths, datesPerYear, maxPerYear)
    allStatuses.push(c.month.status, c.phases.status, c.yearLimit.status)
  }
  for (const dev of (comm.developments || [])) {
    const c = checkDev(dev, comm.phases)
    allStatuses.push(c.startsTarget.status)
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

      {sectionHead(`Developments (${(comm.developments || []).length})`)}
      <DevChecksTable comm={comm} onSaved={onSaved} />

      {sectionHead(`Phases (${comm.phases.length})`)}
      <PhaseChecksTable comm={comm} globalMonths={globalMonths} onSaved={onSaved} />

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
  const [selected,   setSelected]   = useState(null)
  const [search,     setSearch]     = useState('')
  const [filterFail, setFilterFail] = useState(false)
  const [reloadKey,  setReloadKey]  = useState(0)

  useEffect(() => {
    setLoading(true)
    fetch(`${API_BASE}/admin/audit-data`)
      .then(r => r.ok ? r.json() : Promise.reject(r.statusText))
      .then(d => { setData(d); setLoading(false) })
      .catch(e => { setError(String(e)); setLoading(false) })
  }, [reloadKey])

  const reload = () => setReloadKey(k => k + 1)

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

  const globalStatuses = useMemo(() => {
    if (!data) return []
    return communities.map(c => commOverallStatus(c, data.global_months, data.global_max_per_year))
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
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        {selectedComm ? (
          <div style={{ flex: 1, overflowY: 'auto', padding: '16px 20px' }}>
            <CommDetail
              comm={selectedComm}
              globalMonths={data.global_months}
              globalMaxPerYear={data.global_max_per_year}
              onSaved={reload}
            />
          </div>
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
    const effMonths    = effectiveMonths(c, globalMonths)
    const maxPerYear   = c.max_deliveries_per_year ?? globalMaxPerYear
    const hasEvents    = c.delivery_events.length > 0
    const datesPerYear = buildDatesPerYear(c.delivery_events)

    let prodFail=0, prodWarn=0
    let bldFail=0,  bldWarn=0
    let delFail=0,  delWarn=0
    let specFail=0, specWarn=0
    let tierFail=0, tierWarn=0
    for (const p of c.phases) {
      const ch = checkPhase(p, hasEvents, globalMonths)
      if (ch.prod.status===S.FAIL) prodFail++; else if (ch.prod.status===S.WARN) prodWarn++
      if (ch.bld.status===S.FAIL)  bldFail++;  else if (ch.bld.status===S.WARN)  bldWarn++
      if (ch.del.status===S.FAIL)  delFail++;  else if (ch.del.status===S.WARN)  delWarn++
      if (ch.spec.status===S.FAIL) specFail++; else if (ch.spec.status===S.WARN) specWarn++
      if (ch.tier.status===S.FAIL) tierFail++; else if (ch.tier.status===S.WARN) tierWarn++
    }

    let monthFail=0,   monthWarn=0
    let evPhaseFail=0, evPhaseWarn=0
    let yearFail=0
    for (const ev of c.delivery_events) {
      const ch = checkDeliveryEvent(ev, effMonths, datesPerYear, maxPerYear)
      if (ch.month.status===S.FAIL)     monthFail++;   else if (ch.month.status===S.WARN)   monthWarn++
      if (ch.phases.status===S.FAIL)    evPhaseFail++; else if (ch.phases.status===S.WARN)  evPhaseWarn++
      if (ch.yearLimit.status===S.FAIL) yearFail++
    }

    let stFail=0, stWarn=0
    for (const dev of (c.developments || [])) {
      const ch = checkDev(dev, c.phases)
      if (ch.startsTarget.status===S.FAIL) stFail++; else if (ch.startsTarget.status===S.WARN) stWarn++
    }

    const overall = commOverallStatus(c, globalMonths, globalMaxPerYear)
    return { c, overall,
             prodFail, prodWarn, bldFail, bldWarn, delFail, delWarn,
             specFail, specWarn, tierFail, tierWarn,
             monthFail, monthWarn, evPhaseFail, evPhaseWarn, yearFail,
             stFail, stWarn }
  })

  const thStyle = {
    padding: '6px 10px', fontSize: 11, fontWeight: 600, color: '#6b7280',
    background: '#f3f4f6', borderBottom: '2px solid #e5e7eb',
    textAlign: 'left', whiteSpace: 'nowrap', position: 'sticky', top: 0, zIndex: 2,
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      <div style={{ flexShrink: 0, padding: '16px 20px 0', background: '#fff' }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: '#1e293b', marginBottom: 4 }}>
          All Communities — Config Overview
        </div>
        <div style={{ fontSize: 11, color: '#9ca3af', marginBottom: 8 }}>
          Click a row to inspect details. Hover chips for tooltips.
        </div>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', overflowX: 'auto', padding: '0 20px 16px' }}>
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
              <th style={{ ...thStyle, textAlign: 'center' }}
                  title="Phases with no spec rate on their instrument">Spec Rate</th>
              <th style={{ ...thStyle, textAlign: 'center' }}
                  title="Phases with no delivery tier configured">Tier</th>
              <th style={{ ...thStyle, textAlign: 'center', borderLeft: '2px solid #e5e7eb' }}
                  title="Delivery events in blocked months">Month</th>
              <th style={{ ...thStyle, textAlign: 'center' }}
                  title="Delivery events over annual date limit">Year Limit</th>
              <th style={{ ...thStyle, textAlign: 'center' }}
                  title="Delivery events with no phases assigned">Event Coverage</th>
              <th style={{ ...thStyle, textAlign: 'center', borderLeft: '2px solid #e5e7eb' }}
                  title="Developments missing annual starts target">Starts Target</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ c, overall,
                         prodFail, prodWarn, bldFail, bldWarn, delFail, delWarn,
                         specFail, specWarn, tierFail, tierWarn,
                         monthFail, monthWarn, evPhaseFail, evPhaseWarn, yearFail,
                         stFail, stWarn }, i) => {
              const col = STATUS_COLOR[overall]
              const bg  = i % 2 === 0 ? '#fff' : '#fafafa'
              const tdS = (extra={}) => ({ padding: '6px 10px', background: bg, borderTop: '1px solid #f3f4f6', verticalAlign: 'middle', ...extra })

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
                    onMouseLeave={e => { e.currentTarget.querySelectorAll('td').forEach(t => t.style.background = '') }}
                >
                  <td style={tdS({ textAlign: 'center', paddingRight: 4 })}>
                    <span style={{ width: 8, height: 8, borderRadius: '50%', background: col.dot, display: 'inline-block' }} />
                  </td>
                  <td style={tdS({ fontWeight: 500, color: '#1e293b' })}>{c.ent_group_name}</td>
                  <td style={tdS({ textAlign: 'center', color: '#6b7280' })}>{c.phases.length}</td>
                  <td style={tdS({ textAlign: 'center', borderLeft: '2px solid #f1f5f9' })}>
                    {mini(prodFail, prodWarn, c.phases.length)}
                  </td>
                  <td style={tdS({ textAlign: 'center' })}>
                    {mini(bldFail, bldWarn, c.phases.length)}
                  </td>
                  <td style={tdS({ textAlign: 'center' })}>
                    {mini(delFail, delWarn, c.phases.length)}
                  </td>
                  <td style={tdS({ textAlign: 'center' })}>
                    {mini(specFail, specWarn, c.phases.length)}
                  </td>
                  <td style={tdS({ textAlign: 'center' })}>
                    {mini(tierFail, tierWarn, c.phases.length)}
                  </td>
                  <td style={tdS({ textAlign: 'center', borderLeft: '2px solid #f1f5f9' })}>
                    {mini(monthFail, monthWarn, c.delivery_events.length)}
                  </td>
                  <td style={tdS({ textAlign: 'center' })}>
                    {mini(yearFail, 0, c.delivery_events.length)}
                  </td>
                  <td style={tdS({ textAlign: 'center' })}>
                    {mini(evPhaseFail, evPhaseWarn, c.delivery_events.length)}
                  </td>
                  <td style={tdS({ textAlign: 'center', borderLeft: '2px solid #f1f5f9' })}>
                    {mini(stFail, stWarn, (c.developments || []).length)}
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
