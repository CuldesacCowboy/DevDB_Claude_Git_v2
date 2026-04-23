import { useState } from 'react'

const PASS = { background: '#dcfce7', color: '#166534', border: '1px solid #bbf7d0' }
const FAIL = { background: '#fee2e2', color: '#991b1b', border: '1px solid #fecaca' }
const WARN = { background: '#fef9c3', color: '#854d0e', border: '1px solid #fde68a' }

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
              <span style={{ fontSize: 12, fontWeight: 600, color }}>
                Group {g.group}
              </span>
              <Badge passed={g.passed} />
            </div>
            {g.date && (
              <div style={{ fontSize: 11, color: '#6b7280', marginBottom: 4 }}>
                Delivers: {g.date}
              </div>
            )}
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
  if (!items.length) return <div style={{ color: '#059669', fontSize: 12 }}>No violations.</div>
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
            }}>
              {y}: {cnt} event{cnt !== 1 ? 's' : ''}
            </div>
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
    default:
      return <pre style={{ fontSize: 11 }}>{JSON.stringify(d, null, 2)}</pre>
  }
}

// ── Main component ───────────────────────────────────────────────────────────
export function RulesValidatorTab({ rules, loading }) {
  const [expanded, setExpanded] = useState({})

  if (loading) return <div style={{ color: '#6b7280', fontSize: 12 }}>Validating rules…</div>
  if (!rules.length) return <div style={{ color: '#9ca3af', fontSize: 12 }}>No validation data. Run a simulation first.</div>

  const toggle = id => setExpanded(prev => ({ ...prev, [id]: !prev[id] }))
  const passCount = rules.filter(r => r.passed).length

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
      <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 8 }}>
        {passCount} of {rules.length} rules passed
      </div>
      {rules.map(rule => (
        <div key={rule.rule_id} style={{
          borderBottom: '1px solid #e5e7eb',
          background: expanded[rule.rule_id] ? '#fafafa' : '#fff',
        }}>
          {/* Header row — clickable */}
          <div
            onClick={() => toggle(rule.rule_id)}
            style={{
              display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px',
              cursor: 'pointer', userSelect: 'none',
            }}
          >
            <span style={{ fontSize: 10, color: '#6b7280', width: 14 }}>
              {expanded[rule.rule_id] ? '▼' : '▶'}
            </span>
            <Badge passed={rule.passed} />
            <span style={{ fontSize: 13, fontWeight: 600, color: '#1f2937', minWidth: 220 }}>
              {rule.rule_name}
            </span>
            <span style={{ fontSize: 12, color: '#6b7280' }}>{rule.summary}</span>
          </div>
          {/* Expanded detail */}
          {expanded[rule.rule_id] && (
            <div style={{ padding: '4px 14px 14px 38px' }}>
              <RuleDetail rule={rule} />
            </div>
          )}
        </div>
      ))}
    </div>
  )
}
