import { useMemo } from 'react'

function fmt(iso) {
  if (!iso) return '—'
  const d = new Date(iso + 'T00:00:00')
  return d.toLocaleDateString('en-US', { month: 'short', year: 'numeric' })
}

function Delta({ base, scenario, unit = '', invert = false }) {
  const delta = scenario - base
  if (delta === 0) return <span style={{ color: '#9ca3af' }}>—</span>
  const isGood = invert ? delta < 0 : delta > 0
  return (
    <span style={{ fontWeight: 600, color: isGood ? '#16a34a' : '#dc2626' }}>
      {delta > 0 ? '+' : ''}{delta}{unit}
    </span>
  )
}

function MetricRow({ label, baseVal, scenarioVal, unit = '', invert = false, highlight = false }) {
  return (
    <tr style={{ borderBottom: '1px solid #f0f0f0', background: highlight ? '#f8faff' : '#fff' }}>
      <td style={{ padding: '8px 12px', fontSize: 12, color: '#374151', fontWeight: 500 }}>{label}</td>
      <td style={{ padding: '8px 12px', fontSize: 13, textAlign: 'right', color: '#6b7280' }}>{baseVal}{unit}</td>
      <td style={{ padding: '8px 12px', fontSize: 13, textAlign: 'right', fontWeight: 600, color: '#374151' }}>{scenarioVal}{unit}</td>
      <td style={{ padding: '8px 12px', fontSize: 13, textAlign: 'right' }}>
        {typeof baseVal === 'number' && typeof scenarioVal === 'number'
          ? <Delta base={baseVal} scenario={scenarioVal} unit={unit} invert={invert} />
          : <span style={{ color: '#9ca3af' }}>{baseVal === scenarioVal ? '—' : 'changed'}</span>}
      </td>
    </tr>
  )
}

function SectionHeader({ title }) {
  return (
    <tr>
      <td colSpan={4} style={{
        padding: '10px 12px 4px', fontSize: 11, fontWeight: 700, textTransform: 'uppercase',
        letterSpacing: '0.06em', color: '#6b7280', borderBottom: '2px solid #e5e7eb',
      }}>{title}</td>
    </tr>
  )
}

export function ScenarioCompareView({ baseRows, scenarioRows, scenarioName, onClose }) {
  // Filter to active range: only years where either base or scenario has any activity
  const hasActivity = (r) => (r.str_plan || 0) + (r.cmp_plan || 0) + (r.cls_plan || 0) +
    (r.d_end || 0) + (r.h_end || 0) + (r.u_end || 0) + (r.uc_end || 0) + (r.c_end || 0) > 0

  const allRows = [...(baseRows || []), ...(scenarioRows || [])]
  const activeMonths = allRows.filter(hasActivity).map(r => r.calendar_month).filter(Boolean)
  const minMonth = activeMonths.length ? activeMonths.sort()[0] : null
  const maxMonth = activeMonths.length ? activeMonths.sort().reverse()[0] : null

  const inRange = (r) => {
    if (!minMonth || !maxMonth || !r.calendar_month) return false
    return r.calendar_month >= minMonth && r.calendar_month <= maxMonth
  }

  const base = (baseRows || []).filter(inRange)
  const scenario = (scenarioRows || []).filter(inRange)

  // ── Compute metrics ─────────────────────────────────────────────────────
  const sumField = (rows, field) => rows.reduce((s, r) => s + (r[field] || 0), 0)
  const peakField = (rows, field) => Math.max(0, ...rows.map(r => r[field] || 0))

  // Annual rollups
  const annualRollup = (rows) => {
    const byYear = {}
    for (const r of rows) {
      if (!r.calendar_month) continue
      const yr = r.calendar_month.slice(0, 4)
      if (!byYear[yr]) byYear[yr] = { str: 0, cmp: 0, cls: 0 }
      byYear[yr].str += r.str_plan || 0
      byYear[yr].cmp += r.cmp_plan || 0
      byYear[yr].cls += r.cls_plan || 0
    }
    return byYear
  }

  const baseAnnual = annualRollup(base)
  const scAnnual = annualRollup(scenario)
  const allYears = [...new Set([...Object.keys(baseAnnual), ...Object.keys(scAnnual)])]
    .sort()
    .filter(yr => {
      const b = baseAnnual[yr] || {}
      const s = scAnnual[yr] || {}
      return (b.str || 0) + (b.cmp || 0) + (b.cls || 0) + (s.str || 0) + (s.cmp || 0) + (s.cls || 0) > 0
    })

  // Sellout: last month with active inventory
  const selloutMonth = (rows) => {
    for (let i = rows.length - 1; i >= 0; i--) {
      const r = rows[i]
      if ((r.d_end || 0) + (r.h_end || 0) + (r.u_end || 0) + (r.uc_end || 0) + (r.c_end || 0) > 0) {
        return r.calendar_month
      }
    }
    return null
  }

  const baseSellout = selloutMonth(base)
  const scSellout = selloutMonth(scenario)

  // Months of zero active inventory between first activity and sellout
  const zeroMonths = (rows) => {
    const sellout = selloutMonth(rows)
    const firstActive = rows.find(r => totalInv(r) > 0)?.calendar_month
    if (!firstActive || !sellout) return 0
    let count = 0
    for (const r of rows) {
      if (!r.calendar_month) continue
      if (r.calendar_month < firstActive || r.calendar_month > sellout) continue
      if (totalInv(r) === 0) count++
    }
    return count
  }

  const baseZero = zeroMonths(base)
  const scZero = zeroMonths(scenario)

  // Peak inventory
  const totalInv = (r) => (r.d_end || 0) + (r.h_end || 0) + (r.u_end || 0) + (r.uc_end || 0) + (r.c_end || 0)
  const basePeak = Math.max(0, ...base.map(totalInv))
  const scPeak = Math.max(0, ...scenario.map(totalInv))

  const thStyle = {
    padding: '6px 12px', fontSize: 11, fontWeight: 600, color: '#6b7280',
    background: '#f9fafb', borderBottom: '2px solid #e5e7eb', textAlign: 'right',
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Header */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px',
        background: '#f5f3ff', border: '1px solid #c4b5fd', borderRadius: 8,
      }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 16, fontWeight: 700, color: '#7c3aed' }}>
            {scenarioName || 'Scenario'} vs Base
          </div>
        </div>
        <button onClick={onClose} style={{
          padding: '6px 16px', fontSize: 12, borderRadius: 4, cursor: 'pointer',
          border: '1px solid #c4b5fd', background: '#fff', color: '#7c3aed', fontWeight: 600,
        }}>Back to Scenarios</button>
      </div>

      {/* Warning if base looks like it hasn't been run */}
      {sumField(base, 'str_plan') === 0 && base.length > 0 && (
        <div style={{
          padding: '8px 14px', borderRadius: 6, fontSize: 12, fontWeight: 600,
          background: '#fef3c7', border: '1px solid #fcd34d', color: '#92400e',
        }}>
          Base simulation has no projected starts — run the base simulation first before comparing.
        </div>
      )}

      {/* Main comparison table */}
      <div style={{ border: '1px solid #e5e7eb', borderRadius: 8, overflow: 'hidden' }}>
        <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: 12 }}>
          <thead>
            <tr>
              <th style={{ ...thStyle, textAlign: 'left', width: 200 }}>Metric</th>
              <th style={{ ...thStyle, width: 100 }}>Base</th>
              <th style={{ ...thStyle, width: 100, color: '#7c3aed' }}>{scenarioName || 'Scenario'}</th>
              <th style={{ ...thStyle, width: 80 }}>Delta</th>
            </tr>
          </thead>
          <tbody>
            <SectionHeader title="Key Outcomes" />
            <MetricRow label="Total Starts" baseVal={sumField(base, 'str_plan')} scenarioVal={sumField(scenario, 'str_plan')} />
            <MetricRow label="Total Closings" baseVal={sumField(base, 'cls_plan')} scenarioVal={sumField(scenario, 'cls_plan')} />
            <MetricRow label="Peak Active Inventory" baseVal={basePeak} scenarioVal={scPeak} invert />
            <MetricRow label="Sellout Date" baseVal={fmt(baseSellout)} scenarioVal={fmt(scSellout)} />
            <MetricRow label="Dead Months (zero inventory)" baseVal={baseZero} scenarioVal={scZero} invert />

            <SectionHeader title="Starts by Year" />
            {allYears.map(yr => (
              <MetricRow key={`str-${yr}`} label={`${yr} Starts`}
                baseVal={baseAnnual[yr]?.str || 0} scenarioVal={scAnnual[yr]?.str || 0}
                highlight={yr === new Date().getFullYear().toString()} />
            ))}

            <SectionHeader title="Closings by Year" />
            {allYears.map(yr => (
              <MetricRow key={`cls-${yr}`} label={`${yr} Closings`}
                baseVal={baseAnnual[yr]?.cls || 0} scenarioVal={scAnnual[yr]?.cls || 0}
                highlight={yr === new Date().getFullYear().toString()} />
            ))}

            <SectionHeader title="Completions by Year" />
            {allYears.map(yr => (
              <MetricRow key={`cmp-${yr}`} label={`${yr} Completions`}
                baseVal={baseAnnual[yr]?.cmp || 0} scenarioVal={scAnnual[yr]?.cmp || 0}
                highlight={yr === new Date().getFullYear().toString()} />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
