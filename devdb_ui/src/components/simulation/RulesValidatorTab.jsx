import { useState } from 'react'
import { API_BASE } from '../../config'

// ── Fix Action button ────────────────────────────────────────────────────────
function FixAction({ label, icon, onClick }) {
  return (
    <button onClick={onClick} style={{
      display: 'inline-flex', alignItems: 'center', gap: 5,
      padding: '4px 12px', borderRadius: 4, fontSize: 11, fontWeight: 600,
      border: '1px solid #2563eb', background: '#eff6ff', color: '#1e40af',
      cursor: 'pointer', marginTop: 6, marginRight: 6,
    }}>
      {icon && <span>{icon}</span>}
      {label}
    </button>
  )
}

// ── Styling atoms ────────────────────────────────────────────────────────────
const PASS_BADGE = { background: '#dcfce7', color: '#166534', border: '1px solid #bbf7d0' }
const FAIL_BADGE = { background: '#fee2e2', color: '#991b1b', border: '1px solid #fecaca' }

function Badge({ passed, label }) {
  const s = passed ? PASS_BADGE : FAIL_BADGE
  return (
    <span style={{
      display: 'inline-block', padding: '1px 10px', borderRadius: 10,
      fontSize: 11, fontWeight: 600, ...s,
    }}>{label || (passed ? 'PASS' : 'FAIL')}</span>
  )
}

// ── Typography ───────────────────────────────────────────────────────────────
const Section = ({ title, children }) => (
  <div style={{ marginBottom: 16 }}>
    <div style={{
      fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em',
      color: '#6b7280', marginBottom: 6, borderBottom: '1px solid #e5e7eb', paddingBottom: 4,
    }}>{title}</div>
    {children}
  </div>
)

const Prose = ({ children }) => (
  <div style={{ fontSize: 12, color: '#374151', lineHeight: 1.7, marginBottom: 8 }}>{children}</div>
)

const Muted = ({ children }) => (
  <span style={{ color: '#9ca3af' }}>{children}</span>
)

// ── Data Table ───────────────────────────────────────────────────────────────
function DataTable({ columns, rows, keyFn }) {
  if (!rows || !rows.length) return <Muted>No data.</Muted>
  const thStyle = {
    padding: '5px 10px', fontSize: 11, fontWeight: 600, color: '#6b7280',
    background: '#f9fafb', textAlign: 'left', borderBottom: '2px solid #e5e7eb',
    whiteSpace: 'nowrap',
  }
  const tdStyle = (extra = {}) => ({
    padding: '4px 10px', fontSize: 12, color: '#374151', borderBottom: '1px solid #f0f0f0',
    whiteSpace: 'nowrap', ...extra,
  })
  return (
    <div style={{ overflowX: 'auto', marginBottom: 8 }}>
      <table style={{ borderCollapse: 'collapse', width: '100%' }}>
        <thead>
          <tr>{columns.map(c => (
            <th key={c.key} style={{ ...thStyle, textAlign: c.align || 'left', width: c.width }}>{c.label}</th>
          ))}</tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={keyFn ? keyFn(r, i) : i} style={{ background: r._highlight === false ? '#fee2e2' : (r._highlight === true ? '#f0fdf4' : (i % 2 ? '#fafafa' : '#fff')) }}>
              {columns.map(c => (
                <td key={c.key} style={tdStyle({ textAlign: c.align || 'left', fontWeight: c.bold ? 600 : 400 })}>
                  {c.render ? c.render(r) : (r[c.key] ?? <Muted>—</Muted>)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ── Conclusion box ───────────────────────────────────────────────────────────
function Conclusion({ passed, children }) {
  return (
    <div style={{
      padding: '8px 14px', borderRadius: 6, fontSize: 12, fontWeight: 500,
      background: passed ? '#f0fdf4' : '#fef2f2',
      border: passed ? '1px solid #bbf7d0' : '1px solid #fecaca',
      color: passed ? '#166534' : '#991b1b',
    }}>{children}</div>
  )
}

// ── Tier Flow Diagram ────────────────────────────────────────────────────────
// Strip longest common prefix from an array of names (e.g. "Abbey Farms SF ph. 1" → "SF ph. 1")
function stripCommonPrefix(names) {
  if (names.length <= 1) return names
  let prefix = names[0]
  for (let i = 1; i < names.length; i++) {
    while (!names[i].startsWith(prefix)) prefix = prefix.slice(0, -1)
    if (!prefix) return names
  }
  // Trim to last word boundary so we don't cut mid-word
  const trimmed = prefix.replace(/\s*\S*$/, '')
  if (trimmed.length < 4) return names  // not worth stripping < 4 chars
  return names.map(n => n.slice(trimmed.length).replace(/^\s+/, ''))
}

function TierFlowDiagram({ flow }) {
  if (!flow || !flow.length) return <Muted>No tiered phases.</Muted>

  // Shorten phase names by stripping common community prefix
  const allNames = flow.flatMap(t => t.phases.map(p => p.phase_name))
  const shortNames = stripCommonPrefix(allNames)
  const nameMap = Object.fromEntries(allNames.map((n, i) => [n, shortNames[i]]))

  const allDates = [...new Set(flow.flatMap(t => t.phases.map(p => p.date)))].sort()

  const tierStyles = [
    { bg: '#f5f3ff', fill: '#ede9fe', border: '#c4b5fd', text: '#5b21b6', label: '#7c3aed' },
    { bg: '#eff6ff', fill: '#dbeafe', border: '#93c5fd', text: '#1e40af', label: '#2563eb' },
    { bg: '#ecfdf5', fill: '#d1fae5', border: '#6ee7b7', text: '#065f46', label: '#059669' },
    { bg: '#fffbeb', fill: '#fef3c7', border: '#fcd34d', text: '#92400e', label: '#d97706' },
    { bg: '#fef2f2', fill: '#fecaca', border: '#fca5a5', text: '#991b1b', label: '#dc2626' },
    { bg: '#eef2ff', fill: '#e0e7ff', border: '#a5b4fc', text: '#3730a3', label: '#6366f1' },
    { bg: '#ecfeff', fill: '#cffafe', border: '#67e8f9', text: '#155e75', label: '#0891b2' },
    { bg: '#fdf2f8', fill: '#fce7f3', border: '#f9a8d4', text: '#9d174d', label: '#be185d' },
  ]

  const fmtDate = d => {
    const dt = new Date(d + 'T00:00:00')
    return dt.toLocaleDateString('en-US', { month: 'short', year: 'numeric' })
  }

  return (
    <div style={{ overflowX: 'auto', padding: '4px 0', borderRadius: 8, border: '1px solid #e5e7eb' }}>
      <table style={{ borderCollapse: 'separate', borderSpacing: 0, width: '100%' }}>
        <thead>
          <tr>
            <th style={{
              padding: '8px 14px', fontSize: 11, fontWeight: 700, color: '#374151',
              textAlign: 'left', background: '#f9fafb', borderBottom: '2px solid #e5e7eb',
              position: 'sticky', left: 0, zIndex: 3, minWidth: 70,
            }}>Tier</th>
            {allDates.map(d => (
              <th key={d} style={{
                padding: '8px 10px', fontSize: 11, fontWeight: 600, color: '#374151',
                textAlign: 'center', background: '#f9fafb', borderBottom: '2px solid #e5e7eb',
                borderLeft: '1px solid #e5e7eb', whiteSpace: 'nowrap',
              }}>{fmtDate(d)}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {flow.map((tier, ti) => {
            const s = tierStyles[ti % tierStyles.length]
            const byDate = {}
            for (const p of tier.phases) {
              if (!byDate[p.date]) byDate[p.date] = []
              byDate[p.date].push(p)
            }
            // Assign row slots chronologically: earlier dates get top rows,
            // later dates continue below. This produces the staircase layout.
            const dateCols = allDates.filter(d => byDate[d])
            const dateRowStart = {}  // date -> first row index for that date
            let nextRow = 0
            for (const d of dateCols) {
              dateRowStart[d] = nextRow
              nextRow += byDate[d].length
            }
            const maxRows = Math.max(1, nextRow)
            const isLast = ti === flow.length - 1

            return Array.from({ length: maxRows }, (_, rowIdx) => (
              <tr key={`${tier.tier}-${rowIdx}`}>
                {rowIdx === 0 && (
                  <td rowSpan={maxRows} style={{
                    padding: '8px 14px', fontSize: 13, fontWeight: 800, color: s.label,
                    background: s.bg, borderRight: `3px solid ${s.border}`,
                    borderBottom: isLast ? 'none' : '2px solid #e5e7eb',
                    verticalAlign: 'middle', position: 'sticky', left: 0, zIndex: 2,
                    letterSpacing: '0.02em',
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span style={{
                        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                        width: 22, height: 22, borderRadius: '50%', background: s.label,
                        color: '#fff', fontSize: 11, fontWeight: 700,
                      }}>{tier.tier}</span>
                      <span>Tier {tier.tier}</span>
                    </div>
                  </td>
                )}
                {allDates.map(d => {
                  const phases = byDate[d] || []
                  const start = dateRowStart[d] ?? 0
                  // Phase shows if this rowIdx falls within this date's slot range
                  const localIdx = rowIdx - start
                  const phase = (localIdx >= 0 && localIdx < phases.length) ? phases[localIdx] : null
                  return (
                    <td key={d} style={{
                      padding: phase ? '4px 10px' : '4px 6px',
                      fontSize: 11, whiteSpace: 'nowrap',
                      borderBottom: rowIdx === maxRows - 1
                        ? (isLast ? 'none' : '2px solid #e5e7eb')
                        : '1px solid #f5f5f5',
                      borderLeft: '1px solid #e5e7eb',
                      background: phase ? s.fill : '#fff',
                    }}>
                      {phase && (
                        <div style={{
                          padding: '1px 6px', borderRadius: 3,
                          border: `1px solid ${s.border}`,
                          background: '#fff', color: s.text,
                          fontWeight: 500, fontSize: 10, lineHeight: 1.4,
                          whiteSpace: 'nowrap',
                        }}>
                          {nameMap[phase.phase_name] || phase.phase_name}
                        </div>
                      )}
                    </td>
                  )
                })}
              </tr>
            ))
          })}
        </tbody>
      </table>
    </div>
  )
}

// ── Group Cards ──────────────────────────────────────────────────────────────
const GROUP_COLORS = { A:'#7c3aed', B:'#2563eb', C:'#059669', D:'#d97706', E:'#dc2626', F:'#6366f1', G:'#0891b2', H:'#be185d' }

function GroupCards({ groups }) {
  if (!groups || !groups.length) return <Muted>No delivery groups configured.</Muted>
  return (
    <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', padding: '8px 0' }}>
      {groups.map(g => {
        const color = GROUP_COLORS[g.group] || '#6b7280'
        return (
          <div key={g.group} style={{
            border: `2px solid ${color}`, borderRadius: 8, padding: '10px 16px',
            background: g.passed ? '#fafafa' : '#fef2f2', minWidth: 160,
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
              <span style={{
                display: 'inline-block', width: 24, height: 24, borderRadius: '50%',
                background: color, color: '#fff', textAlign: 'center', lineHeight: '24px',
                fontSize: 13, fontWeight: 700,
              }}>{g.group}</span>
              <span style={{ fontSize: 13, fontWeight: 700, color }}>Group {g.group}</span>
              <Badge passed={g.passed} />
            </div>
            {g.date && <div style={{ fontSize: 11, color: '#6b7280', marginBottom: 6 }}>Delivery date: <b style={{ color: '#374151' }}>{g.date}</b></div>}
            {g.members.map((m, j) => (
              <div key={j} style={{ fontSize: 11, color: '#374151', lineHeight: 1.6, paddingLeft: 4, borderLeft: `2px solid ${color}20`, marginBottom: 1 }}>
                <b>{m.phase_name}</b> <Muted>— {m.dev_name}</Muted>
                {!m.date && <span style={{ color: '#dc2626', fontWeight: 600, marginLeft: 4 }}>(unscheduled)</span>}
                {m.date && g.date && m.date !== g.date && (
                  <span style={{ color: '#dc2626', fontWeight: 600, marginLeft: 4 }}>({m.date})</span>
                )}
              </div>
            ))}
          </div>
        )
      })}
    </div>
  )
}

// ── Pipeline stage diagram ───────────────────────────────────────────────────
function PipelineDiagram() {
  const stages = ['P','E','D','H','U','UC','C','CLS']
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 0, padding: '6px 0', overflowX: 'auto' }}>
      {stages.map((s, i) => (
        <div key={s} style={{ display: 'flex', alignItems: 'center' }}>
          <div style={{
            padding: '3px 10px', borderRadius: 4, fontSize: 11, fontWeight: 600,
            background: '#f3f4f6', color: '#374151', border: '1px solid #d1d5db',
          }}>{s}</div>
          {i < stages.length - 1 && <span style={{ padding: '0 4px', color: '#9ca3af', fontSize: 12 }}>→</span>}
        </div>
      ))}
    </div>
  )
}

// ── Sequence Grid (instrument × date timeline) ──────────────────────────────
function SequenceGrid({ instruments }) {
  if (!instruments || !instruments.length) return <Muted>No instruments.</Muted>

  // Shorten phase names
  const allNames = instruments.flatMap(inst => (inst.phases || []).map(p => p.phase_name))
  const shortNames = stripCommonPrefix(allNames)
  const nameMap = Object.fromEntries(allNames.map((n, i) => [n, shortNames[i]]))

  // Shorten instrument names
  const allInstNames = instruments.map(inst => inst.instrument_name)
  const shortInstNames = stripCommonPrefix(allInstNames)
  const instNameMap = Object.fromEntries(allInstNames.map((n, i) => [n, shortInstNames[i]]))

  // All unique dates across all instruments
  const allDates = [...new Set(instruments.flatMap(inst =>
    (inst.phases || []).map(p => p.date)
  ))].sort()

  const instStyles = [
    { bg: '#eff6ff', fill: '#dbeafe', border: '#93c5fd', text: '#1e40af', label: '#2563eb' },
    { bg: '#f5f3ff', fill: '#ede9fe', border: '#c4b5fd', text: '#5b21b6', label: '#7c3aed' },
    { bg: '#ecfdf5', fill: '#d1fae5', border: '#6ee7b7', text: '#065f46', label: '#059669' },
    { bg: '#fffbeb', fill: '#fef3c7', border: '#fcd34d', text: '#92400e', label: '#d97706' },
    { bg: '#fef2f2', fill: '#fecaca', border: '#fca5a5', text: '#991b1b', label: '#dc2626' },
    { bg: '#ecfeff', fill: '#cffafe', border: '#67e8f9', text: '#155e75', label: '#0891b2' },
    { bg: '#fdf2f8', fill: '#fce7f3', border: '#f9a8d4', text: '#9d174d', label: '#be185d' },
    { bg: '#eef2ff', fill: '#e0e7ff', border: '#a5b4fc', text: '#3730a3', label: '#6366f1' },
  ]

  const fmtDate = d => {
    const dt = new Date(d + 'T00:00:00')
    return dt.toLocaleDateString('en-US', { month: 'short', year: 'numeric' })
  }

  return (
    <div style={{ overflowX: 'auto', padding: '4px 0', borderRadius: 8, border: '1px solid #e5e7eb' }}>
      <table style={{ borderCollapse: 'separate', borderSpacing: 0, width: '100%' }}>
        <thead>
          <tr>
            <th style={{
              padding: '8px 14px', fontSize: 11, fontWeight: 700, color: '#374151',
              textAlign: 'left', background: '#f9fafb', borderBottom: '2px solid #e5e7eb',
              position: 'sticky', left: 0, zIndex: 3, minWidth: 160,
            }}>Instrument</th>
            {allDates.map(d => (
              <th key={d} style={{
                padding: '8px 10px', fontSize: 11, fontWeight: 600, color: '#374151',
                textAlign: 'center', background: '#f9fafb', borderBottom: '2px solid #e5e7eb',
                borderLeft: '1px solid #e5e7eb', whiteSpace: 'nowrap',
              }}>{fmtDate(d)}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {instruments.map((inst, ii) => {
            const s = instStyles[ii % instStyles.length]
            const phases = inst.phases || []
            // Group by date
            const byDate = {}
            for (const p of phases) {
              if (!byDate[p.date]) byDate[p.date] = []
              byDate[p.date].push(p)
            }
            // Staircase: earlier dates top, later dates below
            const dateCols = allDates.filter(d => byDate[d])
            const dateRowStart = {}
            let nextRow = 0
            for (const d of dateCols) {
              dateRowStart[d] = nextRow
              nextRow += byDate[d].length
            }
            const maxRows = Math.max(1, nextRow)
            const isLast = ii === instruments.length - 1

            return Array.from({ length: maxRows }, (_, rowIdx) => (
              <tr key={`${ii}-${rowIdx}`}>
                {rowIdx === 0 && (
                  <td rowSpan={maxRows} style={{
                    padding: '8px 14px', fontSize: 12, fontWeight: 700, color: s.label,
                    background: s.bg, borderRight: `3px solid ${s.border}`,
                    borderBottom: isLast ? 'none' : '2px solid #e5e7eb',
                    verticalAlign: 'middle', position: 'sticky', left: 0, zIndex: 2,
                  }}>
                    {instNameMap[inst.instrument_name] || inst.instrument_name}
                  </td>
                )}
                {allDates.map(d => {
                  const dPhases = byDate[d] || []
                  const start = dateRowStart[d] ?? 0
                  const localIdx = rowIdx - start
                  const phase = (localIdx >= 0 && localIdx < dPhases.length) ? dPhases[localIdx] : null
                  return (
                    <td key={d} style={{
                      padding: phase ? '4px 10px' : '4px 6px',
                      fontSize: 11, whiteSpace: 'nowrap',
                      borderBottom: rowIdx === maxRows - 1
                        ? (isLast ? 'none' : '2px solid #e5e7eb')
                        : '1px solid #f5f5f5',
                      borderLeft: '1px solid #e5e7eb',
                      background: phase ? s.fill : '#fff',
                      minWidth: 80,
                    }}>
                      {phase && (
                        <div style={{
                          display: 'flex', alignItems: 'center', gap: 4,
                          padding: '1px 6px', borderRadius: 3,
                          border: `1px solid ${phase.passed === false ? '#fca5a5' : s.border}`,
                          background: phase.passed === false ? '#fef2f2' : '#fff',
                          color: phase.passed === false ? '#991b1b' : s.text,
                          fontWeight: 500, fontSize: 10, lineHeight: 1.4,
                          whiteSpace: 'nowrap',
                        }}>
                          <span style={{
                            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                            width: 16, height: 16, borderRadius: '50%', fontSize: 9, fontWeight: 700,
                            background: phase.passed === false ? '#fecaca' : s.border + '40',
                            color: phase.passed === false ? '#991b1b' : s.text,
                            flexShrink: 0,
                          }}>{phase.seq ?? '?'}</span>
                          {nameMap[phase.phase_name] || phase.phase_name}
                        </div>
                      )}
                    </td>
                  )
                })}
              </tr>
            ))
          })}
        </tbody>
      </table>
    </div>
  )
}

// ═════════════════════════════════════════════════════════════════════════════
// Detail renderers — one per rule_id
// ═════════════════════════════════════════════════════════════════════════════

// ── Fix actions per rule (only shown on failure) ─────────────────────────────
function RuleFixActions({ ruleId, passed, onNavigate }) {
  if (passed || !onNavigate) return null
  const nav = onNavigate
  const actions = {
    // Config completeness
    config_product_splits: [{ label: 'Fix in Config → Phase Tab', icon: '→', action: () => nav({ to: 'config', tab: 'phase' }) }],
    config_starts_target:  [{ label: 'Fix in Config → Development Tab', icon: '→', action: () => nav({ to: 'config', tab: 'development' }) }],
    config_builder_splits: [{ label: 'Fix in Config → Instrument Tab', icon: '→', action: () => nav({ to: 'config', tab: 'instrument' }) }],
    config_delivery:       [{ label: 'Fix in Config → Community Tab', icon: '→', action: () => nav({ to: 'config', tab: 'community' }) }],
    // Delivery rules
    delivery_window:       [{ label: 'Edit Delivery Schedule', icon: '→', action: () => nav({ to: 'delivery' }) },
                            { label: 'Change Delivery Months in Config', icon: '→', action: () => nav({ to: 'config', tab: 'community' }) }],
    max_per_year:          [{ label: 'Edit Delivery Schedule', icon: '→', action: () => nav({ to: 'delivery' }) },
                            { label: 'Change Max/Year in Config', icon: '→', action: () => nav({ to: 'config', tab: 'community' }) }],
    tier_ordering:         [{ label: 'Edit Tiers in Delivery Schedule', icon: '→', action: () => nav({ to: 'delivery' }) }],
    group_simultaneous:    [{ label: 'Edit Groups in Delivery Schedule', icon: '→', action: () => nav({ to: 'delivery' }) }],
    group_exclusivity:     [{ label: 'Edit Groups in Delivery Schedule', icon: '→', action: () => nav({ to: 'delivery' }) }],
    sequence_ordering:     [{ label: 'Edit Order in Delivery Schedule', icon: '→', action: () => nav({ to: 'delivery' }) }],
    all_scheduled:         [{ label: 'Re-run Simulation', icon: '↻', action: null }],
    locked_honored:        [{ label: 'Edit Dates in Delivery Schedule', icon: '→', action: () => nav({ to: 'delivery' }) }],
    // Engine diagnostics
    chronology:            [{ label: 'Re-run Simulation', icon: '↻', action: null }],
    builder_coverage:      [{ label: 'Check Builder Splits in Config', icon: '→', action: () => nav({ to: 'config', tab: 'instrument' }) }],
    spec_build:            [{ label: 'Set Spec Rate in Config', icon: '→', action: () => nav({ to: 'config', tab: 'instrument' }) }],
    building_group_sync:   [{ label: 'Re-run Simulation', icon: '↻', action: null }],
    tda_fulfillment:       [{ label: 'Review TDAs', icon: '→', action: () => nav({ to: 'setup' }) }],
    demand_capacity:       [{ label: 'Check Product Splits in Config', icon: '→', action: () => nav({ to: 'config', tab: 'phase' }) }],
    convergence:           [{ label: 'Run Simulation', icon: '↻', action: null }],
    pipeline_monotonicity: [{ label: 'Re-run Simulation', icon: '↻', action: null }],
  }
  const items = actions[ruleId]
  if (!items) return null
  return (
    <div style={{ marginTop: 4 }}>
      {items.map((a, i) => a.action
        ? <FixAction key={i} label={a.label} icon={a.icon} onClick={a.action} />
        : <span key={i} style={{ display: 'inline-block', fontSize: 11, color: '#6b7280', marginTop: 6, marginRight: 8 }}>{a.icon} {a.label}</span>
      )}
    </div>
  )
}

function RuleDetail({ rule, onNavigate }) {
  const nav = onNavigate || (() => {})
  const d = rule.detail || {}
  const explanation = d.explanation
  const methodology = d.methodology

  // Shared header sections
  const renderHeader = () => (
    <>
      {explanation && <Section title="What This Rule Checks"><Prose>{explanation}</Prose></Section>}
      {methodology && <Section title="Methodology"><Prose>{methodology}</Prose></Section>}
    </>
  )

  switch (rule.rule_id) {

    // ── DELIVERY WINDOW ────────────────────────────────────────────────────
    case 'delivery_window': {
      const allEvents = d.all_events || []
      return (
        <div>
          {renderHeader()}
          <Section title="Delivery Events Analyzed">
            <DataTable
              columns={[
                { key: 'event', label: 'Event', width: 200 },
                { key: 'date', label: 'Date', width: 100 },
                { key: 'month_name', label: 'Month', width: 80 },
                { key: 'phases', label: 'Phases', render: r => (r.phases || []).join(', ') },
                { key: 'passed', label: 'Status', width: 60, render: r => <Badge passed={r.passed} /> },
              ]}
              rows={allEvents.map(e => ({ ...e, _highlight: e.passed }))}
            />
            {!allEvents.length && d.violations && d.violations.length > 0 && (
              <div style={{ color: '#991b1b', fontSize: 12 }}>
                {d.violations.map((v, i) => <div key={i}>{v.event} ({v.date}) — {v.month} is not valid</div>)}
              </div>
            )}
          </Section>
          <Conclusion passed={rule.passed}>
            {rule.passed
              ? `All ${allEvents.length} delivery event(s) fall within the configured window: ${(d.valid_month_names || []).join(', ')}.`
              : `${(d.violations || []).length} event(s) fall outside the delivery window.`}
          </Conclusion>
        </div>
      )
    }

    // ── MAX PER YEAR ───────────────────────────────────────────────────────
    case 'max_per_year': {
      const allYears = d.all_years || []
      return (
        <div>
          {renderHeader()}
          <Section title="Deliveries by Year">
            <Prose>A "delivery" is one unique date. Multiple phases delivered on the same date count as a single delivery event.</Prose>
            <DataTable
              columns={[
                { key: 'year', label: 'Year', width: 80, bold: true },
                { key: '_deliveries', label: 'Deliveries', width: 240, render: r => {
                  const dc = r.delivery_count ?? 0
                  const pc = r.phase_count ?? 0
                  return `${dc} delivery date${dc !== 1 ? 's' : ''} (${pc} phase${pc !== 1 ? 's' : ''} total)`
                }},
                { key: 'limit', label: 'Limit', width: 80, align: 'right', render: r => r.limit ?? <Muted>none</Muted> },
                { key: 'passed', label: 'Status', width: 60, render: r => <Badge passed={r.passed} /> },
              ]}
              rows={allYears.map(y => ({ ...y, _highlight: y.passed }))}
            />
            {allYears.filter(y => y.deliveries && y.deliveries.length > 0).map(y => (
              <div key={y.year} style={{ marginBottom: 8 }}>
                <div style={{ fontSize: 11, fontWeight: 600, color: '#6b7280', marginBottom: 2 }}>{y.year}</div>
                {y.deliveries.map((del_, i) => (
                  <div key={i} style={{ fontSize: 11, color: '#374151', paddingLeft: 12, lineHeight: 1.6 }}>
                    <b>{del_.date}</b> — {del_.phases.join(', ')} <Muted>({del_.phase_count} phase{del_.phase_count !== 1 ? 's' : ''})</Muted>
                  </div>
                ))}
              </div>
            ))}
          </Section>
          <Conclusion passed={rule.passed}>
            {d.max_per_year
              ? (rule.passed
                  ? `All years have ${d.max_per_year} or fewer unique delivery date(s).`
                  : `Some years exceed the ${d.max_per_year} delivery date(s)/year limit.`)
              : `No max-per-year limit is configured.`}
          </Conclusion>
        </div>
      )
    }

    // ── TIER ORDERING ──────────────────────────────────────────────────────
    case 'tier_ordering': {
      const untiered = d.untiered_phases || []
      return (
        <div>
          {renderHeader()}
          <Section title="Tier Delivery Flow">
            <TierFlowDiagram flow={d.flow} />
          </Section>
          {untiered.length > 0 && (
            <Section title={`Untiered Phases (${untiered.length})`}>
              <Prose>These phases have no delivery tier set and are not subject to tier ordering constraints.</Prose>
              {untiered.map((p, i) => (
                <div key={i} style={{ fontSize: 12, color: '#854d0e', padding: '1px 0' }}>
                  {p.phase_name} <Muted>— {p.dev_name}</Muted>
                </div>
              ))}
            </Section>
          )}
          {(d.violations || []).length > 0 && (
            <Section title="Violations">
              {d.violations.map((v, i) => (
                <div key={i} style={{ fontSize: 12, color: '#991b1b', padding: '3px 10px', background: '#fee2e2', borderRadius: 4, marginBottom: 4 }}>
                  Tier {v.tier_low} latest ({v.latest_low}) delivers after Tier {v.tier_high} earliest ({v.earliest_high})
                </div>
              ))}
            </Section>
          )}
          <Conclusion passed={rule.passed}>
            {rule.passed
              ? `All ${d.tier_count || 0} tier(s) deliver in strictly ascending chronological order.`
              : `Tier ordering is violated — higher-priority tiers are delivering after lower-priority ones.`}
          </Conclusion>
        </div>
      )
    }

    // ── GROUP SIMULTANEOUS ─────────────────────────────────────────────────
    case 'group_simultaneous':
      return (
        <div>
          {renderHeader()}
          <Section title="Delivery Groups">
            <GroupCards groups={d.groups} />
          </Section>
          <Conclusion passed={rule.passed}>
            {rule.passed
              ? `All ${(d.groups || []).length} delivery group(s) have their member phases delivering on the same date.`
              : `Some groups have members delivering on different dates or members that are unscheduled.`}
          </Conclusion>
        </div>
      )

    // ── GROUP EXCLUSIVITY ──────────────────────────────────────────────────
    case 'group_exclusivity': {
      const allDates = d.all_dates || []
      return (
        <div>
          {renderHeader()}
          {allDates.length > 0 && (
            <Section title="All Delivery Dates">
              <DataTable
                columns={[
                  { key: 'date', label: 'Date', width: 100, bold: true },
                  { key: 'phases', label: 'Phases Delivering', render: r => (r.phases || []).join(', ') },
                  { key: 'has_group', label: 'Group?', width: 70, render: r => r.has_group ? <span style={{ color: '#7c3aed', fontWeight: 600 }}>Yes ({r.groups.join(',')})</span> : <Muted>No</Muted> },
                  { key: 'exclusive', label: 'Exclusive', width: 80, render: r => r.has_group ? <Badge passed={r.exclusive} /> : <Muted>n/a</Muted> },
                ]}
                rows={allDates.map(ad => ({ ...ad, _highlight: ad.has_group ? ad.exclusive : undefined }))}
              />
            </Section>
          )}
          {!allDates.length && (d.violations || []).length > 0 && (
            <Section title="Violations">
              {d.violations.map((v, i) => (
                <div key={i} style={{ fontSize: 12, color: '#991b1b', padding: '3px 10px', background: '#fee2e2', borderRadius: 4, marginBottom: 4 }}>
                  {v.phase_name} ({v.dev_name}) delivers on group date {v.date}
                </div>
              ))}
            </Section>
          )}
          <Conclusion passed={rule.passed}>
            {rule.passed
              ? `${(d.group_dates || []).length} group delivery date(s) are fully exclusive — no non-group phases share them.`
              : `Non-group phases are delivering on dates reserved for group deliveries.`}
          </Conclusion>
        </div>
      )
    }

    // ── SEQUENCE ORDERING ──────────────────────────────────────────────────
    case 'sequence_ordering': {
      const allInst = d.all_instruments || []
      return (
        <div>
          {renderHeader()}
          {allInst.length > 0 && (
            <Section title="Phase Sequence by Instrument">
              <SequenceGrid instruments={allInst} />
            </Section>
          )}
          {!allInst.length && (d.violations || []).length > 0 && (
            <Section title="Violations">
              {d.violations.map((v, i) => (
                <div key={i} style={{ fontSize: 12, color: '#991b1b', padding: '3px 10px', background: '#fee2e2', borderRadius: 4, marginBottom: 4 }}>
                  {v.instrument}: {v.earlier_phase} (seq {v.earlier_seq}, {v.earlier_date}) delivers after {v.later_phase} (seq {v.later_seq}, {v.later_date})
                </div>
              ))}
            </Section>
          )}
          <Conclusion passed={rule.passed}>
            {rule.passed
              ? `All phases within each instrument deliver in their configured sequence order.`
              : `${(d.violations || []).length} phase pair(s) deliver out of sequence order.`}
          </Conclusion>
        </div>
      )
    }

    // ── ALL SCHEDULED ──────────────────────────────────────────────────────
    case 'all_scheduled': {
      const scheduled = d.scheduled_list || []
      const unscheduled = d.unscheduled || []
      return (
        <div>
          {renderHeader()}
          {scheduled.length > 0 && (
            <Section title={`Scheduled Phases (${scheduled.length})`}>
              <DataTable
                columns={[
                  { key: 'phase_name', label: 'Phase', bold: true },
                  { key: 'dev_name', label: 'Development' },
                  { key: 'instrument_name', label: 'Instrument' },
                  { key: 'date', label: 'Delivery Date', width: 100 },
                ]}
                rows={scheduled.map(p => ({ ...p, _highlight: true }))}
              />
            </Section>
          )}
          {unscheduled.length > 0 && (
            <Section title={`Unscheduled Phases (${unscheduled.length})`}>
              <DataTable
                columns={[
                  { key: 'phase_name', label: 'Phase', bold: true },
                  { key: 'dev_name', label: 'Development' },
                  { key: 'instrument_name', label: 'Instrument' },
                ]}
                rows={unscheduled.map(p => ({ ...p, _highlight: false }))}
              />
            </Section>
          )}
          <Conclusion passed={rule.passed}>
            {rule.passed
              ? `All ${d.total} phases in this community have been assigned to delivery events.`
              : `${unscheduled.length} of ${d.total} phases are not assigned to any delivery event. These phases will not receive sim lots.`}
          </Conclusion>
        </div>
      )
    }

    // ── LOCKED HONORED ─────────────────────────────────────────────────────
    case 'locked_honored': {
      const locked = d.locked_events || []
      const auto = d.auto_events || []
      return (
        <div>
          {renderHeader()}
          {locked.length > 0 && (
            <Section title={`Locked Events (${locked.length})`}>
              <DataTable
                columns={[
                  { key: 'date', label: 'Date', width: 100, bold: true },
                  { key: 'event', label: 'Event Name' },
                  { key: 'phases', label: 'Phases', render: r => (r.phases || []).join(', ') },
                ]}
                rows={locked}
              />
            </Section>
          )}
          {auto.length > 0 && (
            <Section title={`Auto-Scheduled Events (${auto.length})`}>
              <DataTable
                columns={[
                  { key: 'date', label: 'Date', width: 100, bold: true },
                  { key: 'event', label: 'Event Name' },
                  { key: 'phases', label: 'Phases', render: r => (r.phases || []).join(', ') },
                ]}
                rows={auto}
              />
            </Section>
          )}
          {!locked.length && !auto.length && <Prose>No delivery events exist for this community.</Prose>}
          <Conclusion passed={rule.passed}>
            {locked.length > 0
              ? `${locked.length} user-locked event(s) preserved with their original dates. ${auto.length} event(s) auto-scheduled by the engine.`
              : `No locked events. All ${auto.length} event(s) were auto-scheduled by the engine.`}
          </Conclusion>
        </div>
      )
    }

    // ── CHRONOLOGY ─────────────────────────────────────────────────────────
    case 'chronology': {
      const violations = d.violations || []
      return (
        <div>
          {renderHeader()}
          <Section title="Expected Pipeline Order">
            <PipelineDiagram />
            <Prose>Each date must be less than or equal to the next stage's date. A lot cannot be taken down before delivery, started before takedown, completed before start, or closed before completion.</Prose>
          </Section>
          {violations.length > 0 && (
            <Section title={`Violations (${d.total > 20 ? `showing 20 of ${d.total}` : violations.length})`}>
              <DataTable
                columns={[
                  { key: 'lot_number', label: 'Lot', bold: true },
                  { key: 'lot_source', label: 'Source', width: 50 },
                  { key: 'phase_name', label: 'Phase' },
                  { key: 'early_stage', label: 'Earlier Stage', width: 80, render: r => <span style={{ fontWeight: 600 }}>date_{r.early_stage}</span> },
                  { key: 'early_date', label: 'Date', width: 100 },
                  { key: '_gt', label: '', width: 20, render: () => <span style={{ color: '#dc2626', fontWeight: 700 }}>&gt;</span> },
                  { key: 'late_stage', label: 'Later Stage', width: 80, render: r => <span style={{ fontWeight: 600 }}>date_{r.late_stage}</span> },
                  { key: 'late_date', label: 'Date', width: 100 },
                ]}
                rows={violations.map(v => ({ ...v, _highlight: false }))}
              />
            </Section>
          )}
          <Conclusion passed={rule.passed}>
            {rule.passed
              ? `All ${d.lots_checked || '—'} lots have dates in correct pipeline order.`
              : `${d.total} lot(s) have dates that violate the pipeline sequence. This indicates an engine bug or corrupt data.`}
          </Conclusion>
        </div>
      )
    }

    // ── BUILDER COVERAGE ───────────────────────────────────────────────────
    case 'builder_coverage': {
      const byPhase = d.by_phase || []
      return (
        <div>
          {renderHeader()}
          {byPhase.length > 0 && (
            <Section title="Builder Assignment by Phase">
              <DataTable
                columns={[
                  { key: 'phase_name', label: 'Phase', bold: true },
                  { key: 'sim_count', label: 'Sim Lots', width: 80, align: 'right' },
                  { key: 'assigned', label: 'Assigned', width: 80, align: 'right' },
                  { key: '_pct', label: '%', width: 60, align: 'right', render: r => r.sim_count > 0 ? `${Math.round(r.assigned / r.sim_count * 100)}%` : <Muted>—</Muted> },
                ]}
                rows={byPhase.map(p => ({ ...p, _highlight: p.assigned >= p.sim_count }))}
              />
            </Section>
          )}
          <Conclusion passed={rule.passed}>
            {rule.passed
              ? `All ${d.total} sim lots have been assigned a builder via instrument-level builder splits.`
              : `${d.unassigned} of ${d.total} sim lots have no builder assigned. Check that builder splits are configured on all instruments.`}
          </Conclusion>
        </div>
      )
    }

    // ── SPEC BUILD ─────────────────────────────────────────────────────────
    case 'spec_build': {
      const instruments = d.instruments || []
      return (
        <div>
          {renderHeader()}
          {instruments.length > 0 ? (
            <Section title="Spec/Build Assignment by Instrument">
              <DataTable
                columns={[
                  { key: 'instrument_name', label: 'Instrument', bold: true },
                  { key: 'spec_rate', label: 'Spec Rate', width: 80, align: 'right', render: r => r.spec_rate != null ? `${(r.spec_rate * 100).toFixed(1)}%` : <Muted>—</Muted> },
                  { key: 'total', label: 'Total Lots', width: 80, align: 'right' },
                  { key: 'assigned', label: 'Assigned', width: 80, align: 'right' },
                  { key: 'spec_count', label: 'Spec', width: 60, align: 'right', render: r => r.spec_count ?? <Muted>—</Muted> },
                  { key: 'build_count', label: 'Build', width: 60, align: 'right', render: r => r.build_count ?? <Muted>—</Muted> },
                ]}
                rows={instruments.map(inst => ({ ...inst, _highlight: inst.assigned >= inst.total }))}
              />
            </Section>
          ) : <Prose>No instruments in this community have a spec_rate configured.</Prose>}
          <Conclusion passed={rule.passed}>
            {rule.passed
              ? `All lots in instruments with spec_rate configured have been assigned a spec or build designation.`
              : `Some lots remain unassigned. The engine module S-0950 assigns is_spec based on the instrument's configured spec_rate.`}
          </Conclusion>
        </div>
      )
    }

    // ── BUILDING GROUP SYNC ────────────────────────────────────────────────
    case 'building_group_sync': {
      const violations = d.violations || []
      return (
        <div>
          {renderHeader()}
          <Section title="Building Groups Analyzed">
            <Prose>{d.groups_checked ?? '—'} building group(s) with start dates were checked. {violations.length > 0 ? `${violations.length} group(s) have inconsistent dates.` : 'All groups are synchronized.'}</Prose>
          </Section>
          {violations.length > 0 && (
            <Section title="Violations">
              <DataTable
                columns={[
                  { key: 'building_group_id', label: 'Group ID', width: 80 },
                  { key: 'lot_count', label: 'Lots', width: 60, align: 'right' },
                  { key: 'min_str', label: 'Earliest Start', width: 100 },
                  { key: 'max_str', label: 'Latest Start', width: 100 },
                ]}
                rows={violations.map(v => ({ ...v, _highlight: false }))}
              />
            </Section>
          )}
          <Conclusion passed={rule.passed}>
            {rule.passed
              ? `All building groups have a unified start date — all units in each building start construction on the same date.`
              : `${violations.length} group(s) have split start dates. This violates the building group invariant (S-0810).`}
          </Conclusion>
        </div>
      )
    }

    // ── TDA FULFILLMENT ────────────────────────────────────────────────────
    case 'tda_fulfillment': {
      const cps = d.checkpoints || []
      return (
        <div>
          {renderHeader()}
          {cps.length > 0 ? (
            <Section title={`Checkpoint Detail (${cps.length} checkpoints across ${d.tda_count ?? '—'} TDA(s))`}>
              <DataTable
                columns={[
                  { key: 'tda_name', label: 'TDA', bold: true },
                  { key: 'checkpoint_number', label: '#', width: 30, align: 'center' },
                  { key: 'checkpoint_date', label: 'Date', width: 100 },
                  { key: 'required', label: 'Required', width: 70, align: 'right' },
                  { key: 'assigned', label: 'Assigned', width: 70, align: 'right' },
                  { key: 'gap', label: 'Gap', width: 60, align: 'right', render: r => r.gap > 0 ? <span style={{ color: '#dc2626', fontWeight: 700 }}>-{r.gap}</span> : <span style={{ color: '#16a34a' }}>—</span> },
                ]}
                rows={cps.map(cp => ({ ...cp, _highlight: cp.gap <= 0 }))}
              />
            </Section>
          ) : <Prose>No active TDA checkpoints exist for this community.</Prose>}
          <Conclusion passed={rule.passed}>
            {rule.passed
              ? `All ${cps.length} checkpoint(s) have sufficient lots assigned to meet their cumulative requirements.`
              : `${(d.gaps || []).length} checkpoint(s) are under-fulfilled. The engine (S-0500) assigns hold-commitment lots as a last resort when natural fulfillment falls short.`}
          </Conclusion>
        </div>
      )
    }

    // ── DEMAND CAPACITY ────────────────────────────────────────────────────
    case 'demand_capacity': {
      const allPhases = d.all_phases || d.mismatches || []
      return (
        <div>
          {renderHeader()}
          <Section title="Capacity Analysis by Phase">
            <DataTable
              columns={[
                { key: 'phase_name', label: 'Phase', bold: true },
                { key: 'configured', label: 'Configured', width: 80, align: 'right' },
                { key: 'real_started', label: 'Real Started', width: 90, align: 'right' },
                { key: 'expected_sim', label: 'Expected Sim', width: 90, align: 'right' },
                { key: 'actual_sim', label: 'Actual Sim', width: 80, align: 'right' },
                { key: 'passed', label: 'Match', width: 60, render: r => r.passed !== undefined ? <Badge passed={r.passed} /> : <Badge passed={r.expected_sim === r.actual_sim} /> },
              ]}
              rows={allPhases.map(p => ({ ...p, _highlight: p.passed !== undefined ? p.passed : p.expected_sim === p.actual_sim }))}
            />
          </Section>
          <Conclusion passed={rule.passed}>
            {rule.passed
              ? `Sim lot counts match expected capacity (configured - real started) for all phases.`
              : `${(d.mismatches || allPhases.filter(p => !p.passed)).length} phase(s) have a mismatch between expected and actual sim lot counts.`}
          </Conclusion>
        </div>
      )
    }

    // ── CONVERGENCE ────────────────────────────────────────────────────────
    case 'convergence': {
      const bySource = d.by_source || []
      return (
        <div>
          {renderHeader()}
          {bySource.length > 0 && (
            <Section title="Lot Inventory by Source">
              <DataTable
                columns={[
                  { key: 'lot_source', label: 'Source', bold: true },
                  { key: 'count', label: 'Count', width: 80, align: 'right' },
                ]}
                rows={bySource}
              />
            </Section>
          )}
          <Conclusion passed={rule.passed}>
            {rule.passed
              ? `The simulation has produced ${d.sim_lot_count} sim lots, confirming the engine ran to completion.`
              : `No sim lots found. Run the simulation to generate projected lot data.`}
          </Conclusion>
        </div>
      )
    }

    // ── PIPELINE MONOTONICITY ──────────────────────────────────────────────
    case 'pipeline_monotonicity': {
      const violations = d.violations || []
      const byStatus = d.by_status || []
      return (
        <div>
          {renderHeader()}
          <Section title="Expected Stage Progression">
            <PipelineDiagram />
            <Prose>A lot cannot have a later stage date without having passed through all prior stages. For example, a lot with date_str (started) must also have date_dev (delivered).</Prose>
          </Section>
          {byStatus.length > 0 && (
            <Section title="Real/Pre Lots by Pipeline Status">
              <DataTable
                columns={[
                  { key: 'status', label: 'Status', bold: true },
                  { key: 'count', label: 'Count', width: 80, align: 'right' },
                ]}
                rows={byStatus}
              />
            </Section>
          )}
          {violations.length > 0 && (
            <Section title={`Violations (${d.total > 20 ? `showing 20 of ${d.total}` : violations.length})`}>
              <DataTable
                columns={[
                  { key: 'lot', label: 'Lot', bold: true },
                  { key: 'has', label: 'Has Stage' },
                  { key: 'missing', label: 'Missing Stage', render: r => <span style={{ color: '#dc2626', fontWeight: 600 }}>{r.missing}</span> },
                ]}
                rows={violations.map(v => ({ ...v, _highlight: false }))}
              />
            </Section>
          )}
          <Conclusion passed={rule.passed}>
            {rule.passed
              ? `All ${d.lots_checked || '—'} real/pre lots have contiguous pipeline stages — no gaps in progression.`
              : `${d.total} lot(s) have stage gaps. This may indicate missing MARKS data or a data import issue.`}
          </Conclusion>
        </div>
      )
    }

    // ── CONFIG: PRODUCT SPLITS ─────────────────────────────────────────────
    case 'config_product_splits': {
      const allItems = d.all_items || d.all_phases || []
      const missing = d.missing || []
      return (
        <div>
          {renderHeader()}
          <Section title="All Phases">
            {allItems.map((p, i) => (
              <div key={i} style={{
                display: 'flex', alignItems: 'center', gap: 8, padding: '4px 8px',
                background: p.passed ? '#f0fdf4' : '#fef9c3', borderRadius: 4, marginBottom: 3,
              }}>
                <span style={{ fontSize: 12, fontWeight: 600, color: '#374151', flex: 1 }}>{p.phase_name}</span>
                <Muted>{p.instrument_name}</Muted>
                <span style={{
                  fontSize: 12, fontWeight: 600, minWidth: 40, textAlign: 'right',
                  color: (p.configured_capacity || p.configured || 0) > 0 ? '#374151' : '#dc2626',
                }}>{p.configured_capacity ?? p.configured ?? 0} lots</span>
                <Badge passed={p.passed} />
                {!p.passed && nav && (
                  <button onClick={() => nav({ to: 'config', tab: 'phase' })} style={{
                    fontSize: 10, padding: '1px 8px', borderRadius: 3, cursor: 'pointer',
                    border: '1px solid #2563eb', background: '#eff6ff', color: '#1e40af',
                  }}>Edit</button>
                )}
              </div>
            ))}
          </Section>
          <Conclusion passed={rule.passed}>
            {rule.passed
              ? `All phases have product splits configured.`
              : `${missing.length} phase(s) need product splits. Click Edit to configure in the Phase tab.`}
          </Conclusion>
        </div>
      )
    }

    // ── CONFIG: STARTS TARGET ──────────────────────────────────────────────
    case 'config_starts_target': {
      const allItems = d.all_items || d.all_devs || []
      const missing = d.missing || []
      return (
        <div>
          {renderHeader()}
          <Section title="All Developments">
            {allItems.map((dev, i) => (
              <div key={i} style={{
                display: 'flex', alignItems: 'center', gap: 10, padding: '4px 8px',
                background: dev.passed ? '#f0fdf4' : '#fef9c3', borderRadius: 4, marginBottom: 3,
              }}>
                <span style={{ fontSize: 12, fontWeight: 600, color: '#374151', flex: 1 }}>{dev.dev_name}</span>
                <input type="number" min={0} step={1}
                  defaultValue={dev.target ?? dev.annual_starts_target ?? ''}
                  placeholder="not set"
                  onBlur={async e => {
                    const v = e.target.value === '' ? null : parseFloat(e.target.value)
                    try {
                      await fetch(`${API_BASE}/developments/${dev.dev_id}/sim-params`, {
                        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ annual_starts_target: v }),
                      })
                      e.target.style.borderColor = '#16a34a'
                    } catch { e.target.style.borderColor = '#dc2626' }
                  }}
                  style={{
                    width: 70, textAlign: 'right', fontSize: 12, padding: '2px 6px',
                    borderRadius: 3, border: `1px solid ${dev.passed ? '#bbf7d0' : '#fcd34d'}`,
                  }}
                />
                <span style={{ fontSize: 11, color: '#6b7280' }}>starts/yr</span>
                <Badge passed={dev.passed} />
              </div>
            ))}
          </Section>
          <Conclusion passed={rule.passed}>
            {rule.passed
              ? `All developments have an annual starts target configured.`
              : `${missing.length} development(s) missing. Edit values above, then re-run simulation.`}
          </Conclusion>
        </div>
      )
    }

    // ── CONFIG: BUILDER SPLITS ─────────────────────────────────────────────
    case 'config_builder_splits': {
      const allItems = d.all_items || d.all_instruments || []
      return (
        <div>
          {renderHeader()}
          <Section title="All Instruments">
            {allItems.map((inst, i) => (
              <div key={i} style={{
                display: 'flex', alignItems: 'center', gap: 8, padding: '4px 8px',
                background: inst.passed ? '#f0fdf4' : '#fef9c3', borderRadius: 4, marginBottom: 3,
              }}>
                <span style={{ fontSize: 12, fontWeight: 600, color: '#374151', flex: 1 }}>{inst.instrument_name}</span>
                <span style={{ fontSize: 11, color: '#6b7280' }}>
                  {inst.split_count} builder{inst.split_count !== 1 ? 's' : ''}
                </span>
                <span style={{
                  fontSize: 12, fontWeight: 600, minWidth: 50, textAlign: 'right',
                  color: inst.passed ? '#16a34a' : '#dc2626',
                }}>{inst.total_pct}%</span>
                <Badge passed={inst.passed} />
                {!inst.passed && nav && (
                  <button onClick={() => nav({ to: 'config', tab: 'instrument' })} style={{
                    fontSize: 10, padding: '1px 8px', borderRadius: 3, cursor: 'pointer',
                    border: '1px solid #2563eb', background: '#eff6ff', color: '#1e40af',
                  }}>Edit</button>
                )}
              </div>
            ))}
          </Section>
          <Conclusion passed={rule.passed}>
            {rule.passed
              ? `All instruments have builder splits summing to 100%.`
              : `Some instruments need builder splits configured. Click Edit to set up in the Instrument tab.`}
          </Conclusion>
        </div>
      )
    }

    // ── CONFIG: DELIVERY ───────────────────────────────────────────────────
    case 'config_delivery':
      return (
        <div>
          {renderHeader()}
          <Section title="Current Configuration">
            <div style={{ fontSize: 12, color: '#374151', lineHeight: 2.2 }}>
              <div>
                Delivery months: <b>{(d.delivery_month_names || d.delivery_months || []).join(', ')}</b>
                <Muted> ({d.source === 'community' ? 'community override' : 'global default'})</Muted>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                Max deliveries per year:
                <input type="number" min={1} max={12}
                  defaultValue={d.max_per_year ?? ''}
                  placeholder="not set"
                  onBlur={async e => {
                    const v = e.target.value === '' ? null : parseInt(e.target.value, 10)
                    try {
                      await fetch(`${API_BASE}/entitlement-groups/${d.ent_group_id}/delivery-config`, {
                        method: 'PUT', headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ max_deliveries_per_year: v }),
                      })
                      e.target.style.borderColor = '#16a34a'
                    } catch { e.target.style.borderColor = '#dc2626' }
                  }}
                  style={{
                    width: 50, textAlign: 'right', fontSize: 12, padding: '2px 6px',
                    borderRadius: 3, border: '1px solid #d1d5db',
                  }}
                />
                <Muted>per year</Muted>
              </div>
            </div>
          </Section>
          <Conclusion passed={rule.passed}>
            {rule.passed
              ? `Delivery months and max/yr are configured (${d.source === 'community' ? 'community override' : 'via global defaults'}).`
              : `Missing configuration. Edit above, then re-run simulation.`}
          </Conclusion>
        </div>
      )

    // ── FALLBACK ───────────────────────────────────────────────────────────
    default:
      return (
        <div>
          {renderHeader()}
          <pre style={{ fontSize: 11, background: '#f9fafb', padding: 12, borderRadius: 6, overflow: 'auto' }}>
            {JSON.stringify(d, null, 2)}
          </pre>
        </div>
      )
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// Category metadata
// ═════════════════════════════════════════════════════════════════════════════
const CATEGORIES = [
  {
    key: 'config_completeness',
    label: 'Config Completeness',
    description: 'Is your community fully configured? Fix these before running.',
    color: '#d97706', bgHeader: '#fffbeb', defaultOpen: true,
  },
  {
    key: 'config_validation',
    label: 'Delivery Rules',
    description: 'Did the simulation honor your delivery config (tiers, groups, windows)?',
    color: '#2563eb', bgHeader: '#eff6ff', defaultOpen: true,
  },
  {
    key: 'engine_diagnostic',
    label: 'Engine Diagnostics',
    description: 'Internal consistency checks. Failures here indicate engine bugs or data issues.',
    color: '#6b7280', bgHeader: '#f9fafb', defaultOpen: false,
  },
]

// ── Rule row ─────────────────────────────────────────────────────────────────
function RuleRow({ rule, expanded, onToggle, onNavigate }) {
  return (
    <div style={{ borderBottom: '1px solid #f0f0f0', background: expanded ? '#fafafa' : '#fff' }}>
      <div
        onClick={onToggle}
        style={{
          display: 'flex', alignItems: 'center', gap: 10, padding: '8px 14px',
          cursor: 'pointer', userSelect: 'none',
        }}
      >
        <span style={{ fontSize: 10, color: '#6b7280', width: 14 }}>
          {expanded ? '▼' : '▶'}
        </span>
        <Badge passed={rule.passed} />
        <span style={{ fontSize: 12, fontWeight: 600, color: '#1f2937', minWidth: 200 }}>
          {rule.rule_name}
        </span>
        <span style={{ fontSize: 12, color: '#6b7280' }}>{rule.summary}</span>
      </div>
      {expanded && (
        <div style={{ padding: '8px 20px 20px 38px', maxWidth: 900 }}>
          <RuleDetail rule={rule} onNavigate={onNavigate} />
          <RuleFixActions ruleId={rule.rule_id} passed={rule.passed} onNavigate={onNavigate} />
        </div>
      )}
    </div>
  )
}

// ── Main component ───────────────────────────────────────────────────────────
export function RulesValidatorTab({ rules, loading, onNavigate }) {
  const [expanded, setExpanded] = useState({})
  const [sectionOpen, setSectionOpen] = useState(
    Object.fromEntries(CATEGORIES.map(c => [c.key, c.defaultOpen]))
  )

  if (loading) return <div style={{ color: '#6b7280', fontSize: 12 }}>Validating rules...</div>
  if (!rules.length) return <div style={{ color: '#9ca3af', fontSize: 12 }}>No validation data. Run a simulation first.</div>

  const toggle = id => setExpanded(prev => ({ ...prev, [id]: !prev[id] }))
  const toggleSection = key => setSectionOpen(prev => ({ ...prev, [key]: !prev[key] }))

  const byCategory = {}
  for (const r of rules) {
    const cat = r.category || 'engine_diagnostic'
    if (!byCategory[cat]) byCategory[cat] = []
    byCategory[cat].push(r)
  }

  const totalPass = rules.filter(r => r.passed).length

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ fontSize: 12, color: '#6b7280' }}>
        {totalPass} of {rules.length} checks passed
      </div>

      {CATEGORIES.map(cat => {
        const catRules = byCategory[cat.key] || []
        if (!catRules.length) return null
        const catPass = catRules.filter(r => r.passed).length
        const allPass = catPass === catRules.length
        const open = sectionOpen[cat.key]

        return (
          <div key={cat.key} style={{ border: '1px solid #e5e7eb', borderRadius: 8, overflow: 'hidden' }}>
            <div
              onClick={() => toggleSection(cat.key)}
              style={{
                display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px',
                cursor: 'pointer', userSelect: 'none',
                background: cat.bgHeader, borderBottom: open ? '1px solid #e5e7eb' : 'none',
              }}
            >
              <span style={{ fontSize: 10, color: '#6b7280' }}>{open ? '▼' : '▶'}</span>
              <span style={{ fontSize: 14, fontWeight: 700, color: cat.color }}>{cat.label}</span>
              <span style={{
                fontSize: 11, padding: '1px 8px', borderRadius: 10, fontWeight: 600,
                background: allPass ? '#dcfce7' : '#fee2e2',
                color: allPass ? '#166534' : '#991b1b',
              }}>{catPass}/{catRules.length}</span>
              <span style={{ fontSize: 11, color: '#9ca3af' }}>{cat.description}</span>
            </div>
            {open && catRules.map(rule => (
              <RuleRow key={rule.rule_id} rule={rule}
                expanded={!!expanded[rule.rule_id]}
                onToggle={() => toggle(rule.rule_id)}
                onNavigate={onNavigate}
              />
            ))}
          </div>
        )
      })}
    </div>
  )
}
