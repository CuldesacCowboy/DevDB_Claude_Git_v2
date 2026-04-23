import { useState } from 'react'

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
function TierFlowDiagram({ flow }) {
  if (!flow || !flow.length) return <Muted>No tiered phases.</Muted>
  return (
    <div style={{ display: 'flex', alignItems: 'stretch', gap: 0, overflowX: 'auto', padding: '8px 0' }}>
      {flow.map((tier, i) => (
        <div key={tier.tier} style={{ display: 'flex', alignItems: 'center' }}>
          <div style={{
            border: '2px solid #6366f1', borderRadius: 8, padding: '10px 16px',
            background: '#eef2ff', minWidth: 140,
          }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: '#4338ca', marginBottom: 6 }}>
              Tier {tier.tier} <Muted>({tier.phases.length} phase{tier.phases.length !== 1 ? 's' : ''})</Muted>
            </div>
            {tier.phases.map((p, j) => (
              <div key={j} style={{ fontSize: 11, color: '#374151', lineHeight: 1.6 }}>
                {p.phase_name}
                <span style={{ color: '#6366f1', marginLeft: 6, fontWeight: 500 }}>{p.date}</span>
                <Muted> — {p.dev_name}</Muted>
              </div>
            ))}
          </div>
          {i < flow.length - 1 && (
            <div style={{ padding: '0 10px', color: '#6366f1', fontSize: 20, fontWeight: 700 }}>→</div>
          )}
        </div>
      ))}
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

// ═════════════════════════════════════════════════════════════════════════════
// Detail renderers — one per rule_id
// ═════════════════════════════════════════════════════════════════════════════

function RuleDetail({ rule }) {
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
            <DataTable
              columns={[
                { key: 'year', label: 'Year', width: 80, bold: true },
                { key: '_events', label: 'Events', width: 200, render: r => {
                  const ec = r.event_count ?? r.count ?? 0
                  const pc = r.phase_count ?? 0
                  return `${ec} event${ec !== 1 ? 's' : ''} (${pc} phase${pc !== 1 ? 's' : ''})`
                }},
                { key: 'limit', label: 'Limit', width: 80, align: 'right', render: r => r.limit ?? <Muted>none</Muted> },
                { key: 'passed', label: 'Status', width: 60, render: r => <Badge passed={r.passed} /> },
              ]}
              rows={allYears.map(y => ({ ...y, _highlight: y.passed }))}
            />
            {/* Expandable event detail per year */}
            {allYears.filter(y => y.events && y.events.length > 0).map(y => (
              <div key={y.year} style={{ marginBottom: 8 }}>
                <div style={{ fontSize: 11, fontWeight: 600, color: '#6b7280', marginBottom: 2 }}>{y.year}</div>
                {y.events.map((ev, i) => (
                  <div key={i} style={{ fontSize: 11, color: '#374151', paddingLeft: 12, lineHeight: 1.6 }}>
                    <b>{ev.date}</b> — {ev.phases.join(', ')} <Muted>({ev.phase_count} phase{ev.phase_count !== 1 ? 's' : ''})</Muted>
                  </div>
                ))}
              </div>
            ))}
          </Section>
          <Conclusion passed={rule.passed}>
            {d.max_per_year
              ? (rule.passed
                  ? `All years have ${d.max_per_year} or fewer delivery event(s).`
                  : `Some years exceed the ${d.max_per_year}/year limit.`)
              : `Limit is set to ${d.max_per_year ?? 'none'} delivery event(s) per year.`}
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
              {allInst.map((inst, ii) => (
                <div key={ii} style={{ marginBottom: 12 }}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: '#374151', marginBottom: 4 }}>{inst.instrument_name}</div>
                  <DataTable
                    columns={[
                      { key: 'seq', label: '#', width: 30, align: 'right' },
                      { key: 'phase_name', label: 'Phase' },
                      { key: 'date', label: 'Delivery Date', width: 100 },
                      { key: 'passed', label: 'Order', width: 60, render: r => r.passed !== undefined ? <Badge passed={r.passed} /> : <Muted>—</Muted> },
                    ]}
                    rows={(inst.phases || []).map(p => ({ ...p, _highlight: p.passed }))}
                  />
                </div>
              ))}
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
      const allItems = d.all_phases || []
      const missing = d.missing || []
      return (
        <div>
          {renderHeader()}
          {allItems.length > 0 ? (
            <Section title="All Phases">
              <DataTable
                columns={[
                  { key: 'phase_name', label: 'Phase', bold: true },
                  { key: 'dev_name', label: 'Development' },
                  { key: 'instrument_name', label: 'Instrument' },
                  { key: 'configured', label: 'Configured', width: 80, align: 'right', render: r => r.configured > 0 ? r.configured : <span style={{ color: '#dc2626', fontWeight: 600 }}>0</span> },
                  { key: 'passed', label: 'Status', width: 60, render: r => <Badge passed={r.passed} /> },
                ]}
                rows={allItems.map(p => ({ ...p, _highlight: p.passed }))}
              />
            </Section>
          ) : missing.length > 0 && (
            <Section title="Missing Product Splits">
              {missing.map((m, i) => (
                <div key={i} style={{ fontSize: 12, color: '#854d0e', padding: '3px 10px', background: '#fef9c3', borderRadius: 4, marginBottom: 3 }}>
                  {m.phase_name} <Muted>— {m.dev_name} / {m.instrument_name}</Muted>
                </div>
              ))}
            </Section>
          )}
          <Conclusion passed={rule.passed}>
            {rule.passed
              ? `All phases have product splits configured. The engine uses these to determine how many sim lots to generate per phase.`
              : `${missing.length} phase(s) have no product splits. Without splits, the engine cannot generate sim lots for these phases.`}
          </Conclusion>
        </div>
      )
    }

    // ── CONFIG: STARTS TARGET ──────────────────────────────────────────────
    case 'config_starts_target': {
      const allItems = d.all_devs || []
      const missing = d.missing || []
      const configured = d.configured || []
      return (
        <div>
          {renderHeader()}
          {allItems.length > 0 ? (
            <Section title="All Developments">
              <DataTable
                columns={[
                  { key: 'dev_name', label: 'Development', bold: true },
                  { key: 'target', label: 'Starts/Year', width: 100, align: 'right', render: r => r.target != null ? r.target : <span style={{ color: '#dc2626', fontWeight: 600 }}>not set</span> },
                  { key: 'passed', label: 'Status', width: 60, render: r => <Badge passed={r.passed} /> },
                ]}
                rows={allItems.map(d => ({ ...d, _highlight: d.passed }))}
              />
            </Section>
          ) : (
            <>
              {configured.length > 0 && (
                <Section title="Configured">
                  {configured.map((c, i) => <div key={i} style={{ fontSize: 12, padding: '1px 0' }}>{c.dev_name}: <b>{c.target}</b> starts/yr</div>)}
                </Section>
              )}
              {missing.length > 0 && (
                <Section title="Missing">
                  {missing.map((m, i) => <div key={i} style={{ fontSize: 12, color: '#854d0e', padding: '1px 0' }}>{m.dev_name}</div>)}
                </Section>
              )}
            </>
          )}
          <Conclusion passed={rule.passed}>
            {rule.passed
              ? `All developments have an annual starts target configured. This drives the demand schedule and delivery timing.`
              : `${missing.length} development(s) are missing an annual starts target. Set this in the Development tab of ConfigView.`}
          </Conclusion>
        </div>
      )
    }

    // ── CONFIG: BUILDER SPLITS ─────────────────────────────────────────────
    case 'config_builder_splits': {
      const allItems = d.all_instruments || []
      const missing = d.missing || []
      const badSum = d.bad_sum || []
      return (
        <div>
          {renderHeader()}
          {allItems.length > 0 ? (
            <Section title="All Instruments">
              <DataTable
                columns={[
                  { key: 'instrument_name', label: 'Instrument', bold: true },
                  { key: 'split_count', label: 'Builders', width: 70, align: 'right' },
                  { key: 'total_pct', label: 'Sum %', width: 70, align: 'right', render: r => r.total_pct != null ? `${r.total_pct}%` : <Muted>—</Muted> },
                  { key: 'passed', label: 'Status', width: 60, render: r => <Badge passed={r.passed} /> },
                ]}
                rows={allItems.map(r => ({ ...r, _highlight: r.passed }))}
              />
            </Section>
          ) : (
            <>
              {missing.length > 0 && (
                <Section title="Missing Builder Splits">
                  {missing.map((m, i) => <div key={i} style={{ fontSize: 12, color: '#854d0e', padding: '3px 10px', background: '#fef9c3', borderRadius: 4, marginBottom: 3 }}>{m.instrument_name}</div>)}
                </Section>
              )}
              {badSum.length > 0 && (
                <Section title="Invalid Split Sums">
                  {badSum.map((b, i) => <div key={i} style={{ fontSize: 12, color: '#991b1b', padding: '3px 10px', background: '#fee2e2', borderRadius: 4, marginBottom: 3 }}>{b.instrument_name} — splits sum to {b.total_pct}%</div>)}
                </Section>
              )}
            </>
          )}
          <Conclusion passed={rule.passed}>
            {rule.passed
              ? `All instruments have builder splits configured that sum to 100%. The engine (S-0900) uses these to assign builders to sim lots.`
              : `Some instruments are missing builder splits or their splits don't sum to 100%.`}
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
            <div style={{ fontSize: 12, color: '#374151', lineHeight: 1.8 }}>
              <div>Delivery months: <b>{(d.delivery_months || []).join(', ') || 'using global defaults'}</b></div>
              <div>Max deliveries per year: <b>{d.max_per_year ?? 'not set'}</b></div>
            </div>
          </Section>
          <Conclusion passed={rule.passed}>
            {rule.passed
              ? `Delivery configuration is present for this community.`
              : `No community-specific delivery config exists. The engine will use global defaults.`}
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
function RuleRow({ rule, expanded, onToggle }) {
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
          <RuleDetail rule={rule} />
        </div>
      )}
    </div>
  )
}

// ── Main component ───────────────────────────────────────────────────────────
export function RulesValidatorTab({ rules, loading }) {
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
              />
            ))}
          </div>
        )
      })}
    </div>
  )
}
