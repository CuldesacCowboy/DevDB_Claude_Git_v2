import { useState } from 'react'

const PASS = { background: '#dcfce7', color: '#166534', border: '1px solid #bbf7d0' }
const FAIL = { background: '#fee2e2', color: '#991b1b', border: '1px solid #fecaca' }

function Badge({ passed, label }) {
  const s = passed ? PASS : FAIL
  return (
    <span style={{
      display: 'inline-block', padding: '1px 10px', borderRadius: 10,
      fontSize: 11, fontWeight: 600, ...s,
    }}>{label || (passed ? 'PASS' : 'FAIL')}</span>
  )
}

// ── Tier Flow Diagram ────────────────────────────────────────────────────────
function TierFlowDiagram({ flow }) {
  if (!flow.length) return <span style={{ color: '#9ca3af', fontSize: 12 }}>No tiered phases.</span>
  return (
    <div style={{ display: 'flex', alignItems: 'stretch', gap: 0, overflowX: 'auto', padding: '8px 0' }}>
      {flow.map((tier, i) => (
        <div key={tier.tier} style={{ display: 'flex', alignItems: 'center' }}>
          <div style={{
            border: '2px solid #6366f1', borderRadius: 8, padding: '8px 14px',
            background: '#eef2ff', minWidth: 120,
          }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: '#4338ca', marginBottom: 4 }}>
              Tier {tier.tier}
            </div>
            {tier.phases.map((p, j) => (
              <div key={j} style={{ fontSize: 11, color: '#374151', lineHeight: 1.5 }}>
                {p.phase_name}
                <span style={{ color: '#9ca3af', marginLeft: 4 }}>{p.date}</span>
              </div>
            ))}
          </div>
          {i < flow.length - 1 && (
            <div style={{ padding: '0 8px', color: '#6366f1', fontSize: 18, fontWeight: 700 }}>→</div>
          )}
        </div>
      ))}
    </div>
  )
}

// ── Group Diagram ────────────────────────────────────────────────────────────
function GroupDiagram({ groups }) {
  if (!groups.length) return <span style={{ color: '#9ca3af', fontSize: 12 }}>No delivery groups configured.</span>
  const colors = {
    A: '#7c3aed', B: '#2563eb', C: '#059669', D: '#d97706', E: '#dc2626',
    F: '#6366f1', G: '#0891b2', H: '#be185d',
  }
  return (
    <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', padding: '8px 0' }}>
      {groups.map(g => {
        const color = colors[g.group] || '#6b7280'
        return (
          <div key={g.group} style={{
            border: `2px solid ${color}`, borderRadius: 8, padding: '8px 14px',
            background: g.passed ? '#fafafa' : '#fef2f2', minWidth: 140,
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
              <span style={{
                display: 'inline-block', width: 22, height: 22, borderRadius: '50%',
                background: color, color: '#fff', textAlign: 'center', lineHeight: '22px',
                fontSize: 12, fontWeight: 700,
              }}>{g.group}</span>
              <span style={{ fontSize: 12, fontWeight: 600, color }}>Group {g.group}</span>
              <Badge passed={g.passed} />
            </div>
            {g.date && <div style={{ fontSize: 11, color: '#6b7280', marginBottom: 4 }}>Delivers: {g.date}</div>}
            {g.members.map((m, j) => (
              <div key={j} style={{ fontSize: 11, color: '#374151', lineHeight: 1.5 }}>
                {m.phase_name}
                <span style={{ color: '#9ca3af', marginLeft: 4 }}>{m.dev_name}</span>
                {!m.date && <span style={{ color: '#dc2626', marginLeft: 4, fontWeight: 600 }}>(unscheduled)</span>}
                {m.date && g.date && m.date !== g.date && (
                  <span style={{ color: '#dc2626', marginLeft: 4, fontWeight: 600 }}>({m.date})</span>
                )}
              </div>
            ))}
          </div>
        )
      })}
    </div>
  )
}

// ── Violation List ───────────────────────────────────────────────────────────
function ViolationList({ items, render }) {
  if (!items || !items.length) return <div style={{ color: '#059669', fontSize: 12 }}>No violations.</div>
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, padding: '4px 0' }}>
      {items.map((item, i) => (
        <div key={i} style={{
          fontSize: 12, padding: '4px 10px', borderRadius: 4,
          background: '#fee2e2', color: '#991b1b',
        }}>{render(item)}</div>
      ))}
    </div>
  )
}

// ── Missing List (amber for config completeness) ─────────────────────────────
function MissingList({ items, render }) {
  if (!items || !items.length) return null
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 3, padding: '4px 0' }}>
      {items.map((item, i) => (
        <div key={i} style={{
          fontSize: 12, padding: '3px 10px', borderRadius: 4,
          background: '#fef9c3', color: '#854d0e',
        }}>{render(item)}</div>
      ))}
    </div>
  )
}

// ── Detail renderers per rule_id ─────────────────────────────────────────────
function RuleDetail({ rule }) {
  const d = rule.detail
  switch (rule.rule_id) {
    case 'delivery_window':
      return (
        <div>
          <div style={{ fontSize: 12, color: '#374151', marginBottom: 6 }}>
            Valid months: <b>{d.valid_month_names.join(', ')}</b>
          </div>
          <ViolationList items={d.violations} render={v =>
            `${v.event} (${v.date}) — ${v.month} is not a valid delivery month`
          } />
        </div>
      )
    case 'max_per_year':
      return (
        <div>
          <div style={{ fontSize: 12, color: '#374151', marginBottom: 6 }}>
            Limit: <b>{d.max_per_year ?? 'not set'}</b> deliveries per year
          </div>
          {Object.entries(d.year_counts).sort().map(([y, cnt]) => (
            <div key={y} style={{
              fontSize: 12, padding: '2px 8px',
              color: cnt > (d.max_per_year ?? 999) ? '#991b1b' : '#374151',
              fontWeight: cnt > (d.max_per_year ?? 999) ? 600 : 400,
            }}>{y}: {cnt} event{cnt !== 1 ? 's' : ''}</div>
          ))}
        </div>
      )
    case 'tier_ordering':
      return (
        <div>
          <TierFlowDiagram flow={d.flow} />
          <ViolationList items={d.violations} render={v =>
            `Tier ${v.tier_low} latest delivery (${v.latest_low}) is after Tier ${v.tier_high} earliest (${v.earliest_high})`
          } />
        </div>
      )
    case 'group_simultaneous':
      return <GroupDiagram groups={d.groups} />
    case 'group_exclusivity':
      return (
        <div>
          <div style={{ fontSize: 12, color: '#374151', marginBottom: 6 }}>
            Group delivery dates: <b>{d.group_dates.length ? d.group_dates.join(', ') : 'none'}</b>
          </div>
          <ViolationList items={d.violations} render={v =>
            `${v.phase_name} (${v.dev_name}) delivers on group date ${v.date}`
          } />
        </div>
      )
    case 'sequence_ordering':
      return (
        <ViolationList items={d.violations} render={v =>
          `${v.instrument}: ${v.earlier_phase} (seq ${v.earlier_seq}, ${v.earlier_date}) ` +
          `delivers after ${v.later_phase} (seq ${v.later_seq}, ${v.later_date})`
        } />
      )
    case 'all_scheduled':
      return (
        <div>
          <div style={{ fontSize: 12, color: '#374151', marginBottom: 4 }}>
            {d.scheduled} of {d.total} phases scheduled.
          </div>
          {d.unscheduled.map((p, i) => (
            <div key={i} style={{ fontSize: 12, color: '#854d0e', padding: '2px 0' }}>
              {p.phase_name} <span style={{ color: '#9ca3af' }}>({p.dev_name} / {p.instrument_name})</span>
            </div>
          ))}
        </div>
      )
    case 'locked_honored':
      return (
        <div>
          {d.locked_events.length === 0
            ? <div style={{ fontSize: 12, color: '#9ca3af' }}>No locked delivery events.</div>
            : d.locked_events.map((ev, i) => (
                <div key={i} style={{ fontSize: 12, color: '#374151', padding: '2px 0' }}>
                  <b>{ev.date}</b> — {ev.phases.join(', ')}
                </div>
              ))
          }
        </div>
      )
    case 'chronology':
      return (
        <div>
          {d.total > 20 && <div style={{ fontSize: 11, color: '#9ca3af', marginBottom: 4 }}>Showing first 20 of {d.total}</div>}
          <ViolationList items={d.violations} render={v =>
            `Lot ${v.lot_number}: date_${v.early_stage} (${v.early_date}) > date_${v.late_stage} (${v.late_date})`
          } />
        </div>
      )
    case 'builder_coverage':
      return (
        <div style={{ fontSize: 12, color: '#374151' }}>
          <div>{d.assigned} of {d.total} sim lots have a builder assigned.</div>
          {d.unassigned > 0 && <div style={{ color: '#991b1b', fontWeight: 600, marginTop: 4 }}>{d.unassigned} unassigned</div>}
        </div>
      )
    case 'spec_build':
      return (
        <div>
          {(d.instruments || []).map((inst, i) => (
            <div key={i} style={{
              fontSize: 12, padding: '2px 8px',
              color: inst.assigned < inst.total ? '#991b1b' : '#374151',
              fontWeight: inst.assigned < inst.total ? 600 : 400,
            }}>
              {inst.instrument_name} — spec_rate={((inst.spec_rate || 0) * 100).toFixed(1)}%
              — {inst.assigned}/{inst.total} assigned
            </div>
          ))}
        </div>
      )
    case 'building_group_sync':
      return (
        <ViolationList items={d.violations} render={v =>
          `Building group ${v.building_group_id} (${v.lot_count} lots): start dates range ${v.min_str} to ${v.max_str}`
        } />
      )
    case 'tda_fulfillment': {
      const cps = d.checkpoints || []
      return (
        <div>
          {cps.length === 0
            ? <div style={{ fontSize: 12, color: '#9ca3af' }}>No active TDA checkpoints.</div>
            : <table style={{ borderCollapse: 'collapse', fontSize: 12 }}>
                <thead>
                  <tr style={{ background: '#f9fafb' }}>
                    <th style={{ padding: '4px 8px', textAlign: 'left' }}>TDA</th>
                    <th style={{ padding: '4px 8px' }}>#</th>
                    <th style={{ padding: '4px 8px' }}>Date</th>
                    <th style={{ padding: '4px 8px' }}>Required</th>
                    <th style={{ padding: '4px 8px' }}>Assigned</th>
                    <th style={{ padding: '4px 8px' }}>Gap</th>
                  </tr>
                </thead>
                <tbody>
                  {cps.map((cp, i) => (
                    <tr key={i} style={{ background: cp.gap > 0 ? '#fee2e2' : '#fff' }}>
                      <td style={{ padding: '3px 8px' }}>{cp.tda_name}</td>
                      <td style={{ padding: '3px 8px', textAlign: 'center' }}>{cp.checkpoint_number}</td>
                      <td style={{ padding: '3px 8px' }}>{cp.checkpoint_date || '—'}</td>
                      <td style={{ padding: '3px 8px', textAlign: 'right' }}>{cp.required ?? '—'}</td>
                      <td style={{ padding: '3px 8px', textAlign: 'right' }}>{cp.assigned}</td>
                      <td style={{ padding: '3px 8px', textAlign: 'right', fontWeight: cp.gap > 0 ? 700 : 400, color: cp.gap > 0 ? '#991b1b' : '#374151' }}>
                        {cp.gap > 0 ? `-${cp.gap}` : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
          }
        </div>
      )
    }
    case 'demand_capacity':
      return (
        <ViolationList items={d.mismatches} render={v =>
          `${v.phase_name}: configured=${v.configured}, real started=${v.real_started}, ` +
          `expected sim=${v.expected_sim}, actual sim=${v.actual_sim}`
        } />
      )
    case 'convergence':
      return (
        <div style={{ fontSize: 12, color: '#374151' }}>
          {d.sim_lot_count != null
            ? <div>{d.sim_lot_count} sim lots produced.</div>
            : <div style={{ color: '#9ca3af' }}>No sim data found.</div>
          }
        </div>
      )
    case 'pipeline_monotonicity':
      return (
        <div>
          {d.total > 20 && <div style={{ fontSize: 11, color: '#9ca3af', marginBottom: 4 }}>Showing first 20 of {d.total}</div>}
          <ViolationList items={d.violations} render={v =>
            `Lot ${v.lot}: has ${v.has} but missing ${v.missing}`
          } />
        </div>
      )
    // Config completeness
    case 'config_product_splits':
      return <MissingList items={d.missing} render={m =>
        `${m.phase_name} (${m.dev_name} / ${m.instrument_name})`
      } />
    case 'config_starts_target':
      return (
        <div>
          {d.configured?.length > 0 && (
            <div style={{ marginBottom: 6 }}>
              {d.configured.map((c, i) => (
                <div key={i} style={{ fontSize: 12, color: '#374151', padding: '1px 0' }}>
                  {c.dev_name}: <b>{c.target}</b> starts/yr
                </div>
              ))}
            </div>
          )}
          <MissingList items={d.missing} render={m => m.dev_name} />
        </div>
      )
    case 'config_builder_splits':
      return (
        <div>
          <MissingList items={d.missing} render={m => `${m.instrument_name} — no builder splits`} />
          <MissingList items={d.bad_sum} render={m => `${m.instrument_name} — splits sum to ${m.total_pct}% (should be 100%)`} />
        </div>
      )
    case 'config_delivery':
      return (
        <div style={{ fontSize: 12, color: '#374151' }}>
          <div>Delivery months: <b>{d.delivery_months?.join(', ') || 'default'}</b></div>
          <div>Max per year: <b>{d.max_per_year ?? 'not set'}</b></div>
        </div>
      )
    default:
      return <pre style={{ fontSize: 11 }}>{JSON.stringify(d, null, 2)}</pre>
  }
}

// ── Category metadata ────────────────────────────────────────────────────────
const CATEGORIES = [
  {
    key: 'config_completeness',
    label: 'Config Completeness',
    description: 'Is your community fully configured? Fix these before running.',
    color: '#d97706',
    bgHeader: '#fffbeb',
    defaultOpen: true,
  },
  {
    key: 'config_validation',
    label: 'Delivery Rules',
    description: 'Did the simulation honor your delivery config (tiers, groups, windows)?',
    color: '#2563eb',
    bgHeader: '#eff6ff',
    defaultOpen: true,
  },
  {
    key: 'engine_diagnostic',
    label: 'Engine Diagnostics',
    description: 'Internal consistency checks. Failures here indicate engine bugs.',
    color: '#6b7280',
    bgHeader: '#f9fafb',
    defaultOpen: false,
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
        <div style={{ padding: '2px 14px 12px 38px' }}>
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

  if (loading) return <div style={{ color: '#6b7280', fontSize: 12 }}>Validating rules…</div>
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
            {/* Section header */}
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
              }}>
                {catPass}/{catRules.length}
              </span>
              <span style={{ fontSize: 11, color: '#9ca3af' }}>{cat.description}</span>
            </div>
            {/* Rules */}
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
