import { useMemo } from 'react'

function fmt(iso) {
  if (!iso) return '—'
  const d = new Date(iso + 'T00:00:00')
  return d.toLocaleDateString('en-US', { month: 'short', year: 'numeric' })
}

const SC_COLORS = ['#7c3aed', '#2563eb', '#059669', '#d97706', '#dc2626', '#0891b2']

function SectionHeader({ title, colSpan }) {
  return (
    <tr>
      <td colSpan={colSpan} style={{
        padding: '10px 12px 4px', fontSize: 11, fontWeight: 700, textTransform: 'uppercase',
        letterSpacing: '0.06em', color: '#6b7280', borderBottom: '2px solid #e5e7eb',
      }}>{title}</td>
    </tr>
  )
}

export function ScenarioCompareView({ baseRows, scenarios, onClose }) {
  const scenarioList = useMemo(() =>
    Object.entries(scenarios || {}).map(([id, sc], i) => ({
      id, name: sc.scenario_name, rows: sc.rows || [], color: SC_COLORS[i % SC_COLORS.length],
    })),
    [scenarios]
  )

  // Total active inventory
  const totalInv = (r) => (r.d_end || 0) + (r.h_end || 0) + (r.u_end || 0) + (r.uc_end || 0) + (r.c_end || 0)

  // Filter to active range across ALL datasets
  const allRows = [...(baseRows || []), ...scenarioList.flatMap(s => s.rows)]
  const hasActivity = (r) => (r.str_plan || 0) + (r.cmp_plan || 0) + (r.cls_plan || 0) + totalInv(r) > 0
  const activeMonths = allRows.filter(hasActivity).map(r => r.calendar_month).filter(Boolean).sort()
  const minMonth = activeMonths[0] || null
  const maxMonth = activeMonths[activeMonths.length - 1] || null
  const inRange = (r) => r.calendar_month && r.calendar_month >= minMonth && r.calendar_month <= maxMonth

  const base = (baseRows || []).filter(inRange)
  const filteredScenarios = scenarioList.map(s => ({ ...s, rows: s.rows.filter(inRange) }))

  // Aggregate per-dev rows into per-month totals for inventory metrics
  const aggregateByMonth = (rows) => {
    const byMonth = {}
    for (const r of rows) {
      const m = r.calendar_month
      if (!m) continue
      if (!byMonth[m]) byMonth[m] = { calendar_month: m, d_end: 0, h_end: 0, u_end: 0, uc_end: 0, c_end: 0, str_plan: 0, cmp_plan: 0, cls_plan: 0 }
      byMonth[m].d_end += r.d_end || 0
      byMonth[m].h_end += r.h_end || 0
      byMonth[m].u_end += r.u_end || 0
      byMonth[m].uc_end += r.uc_end || 0
      byMonth[m].c_end += r.c_end || 0
      byMonth[m].str_plan += r.str_plan || 0
      byMonth[m].cmp_plan += r.cmp_plan || 0
      byMonth[m].cls_plan += r.cls_plan || 0
    }
    return Object.values(byMonth).sort((a, b) => a.calendar_month.localeCompare(b.calendar_month))
  }

  // Metrics
  const sumField = (rows, f) => rows.reduce((s, r) => s + (r[f] || 0), 0)
  const selloutMonth = (rows) => {
    const agg = aggregateByMonth(rows)
    for (let i = agg.length - 1; i >= 0; i--) if (totalInv(agg[i]) > 0) return agg[i].calendar_month
    return null
  }
  const zeroMonths = (rows) => {
    const agg = aggregateByMonth(rows)
    const sell = selloutMonth(rows)
    const first = agg.find(r => totalInv(r) > 0)?.calendar_month
    if (!first || !sell) return 0
    return agg.filter(r => r.calendar_month >= first && r.calendar_month <= sell && totalInv(r) === 0).length
  }

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
  const scAnnuals = filteredScenarios.map(s => ({ ...s, annual: annualRollup(s.rows) }))
  const allYears = [...new Set([
    ...Object.keys(baseAnnual),
    ...scAnnuals.flatMap(s => Object.keys(s.annual)),
  ])].sort().filter(yr => {
    const b = baseAnnual[yr] || {}
    const any = scAnnuals.some(s => { const a = s.annual[yr] || {}; return (a.str||0)+(a.cmp||0)+(a.cls||0) > 0 })
    return (b.str||0)+(b.cmp||0)+(b.cls||0) > 0 || any
  })

  const colCount = 2 + filteredScenarios.length  // label + base + N scenarios

  const thStyle = {
    padding: '6px 10px', fontSize: 11, fontWeight: 600, color: '#6b7280',
    background: '#f9fafb', borderBottom: '2px solid #e5e7eb', textAlign: 'right', whiteSpace: 'nowrap',
  }

  const delta = (baseVal, scVal) => {
    if (typeof baseVal !== 'number' || typeof scVal !== 'number') return null
    const d = scVal - baseVal
    if (d === 0) return null
    return d
  }

  const DeltaCell = ({ base: b, scenario: s }) => {
    const d = delta(b, s)
    if (d === null) return <td style={{ padding: '4px 8px', textAlign: 'right', color: '#9ca3af', fontSize: 11 }}>—</td>
    return (
      <td style={{ padding: '4px 8px', textAlign: 'right', fontSize: 11, fontWeight: 600, color: d > 0 ? '#16a34a' : '#dc2626' }}>
        {d > 0 ? '+' : ''}{d}
      </td>
    )
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
            Scenario Comparison
          </div>
          <div style={{ fontSize: 11, color: '#6b7280', marginTop: 2 }}>
            {filteredScenarios.map((s, i) => (
              <span key={s.id}>
                {i > 0 && ' · '}
                <span style={{ color: s.color, fontWeight: 600 }}>{s.name}</span>
              </span>
            ))}
          </div>
        </div>
        <button onClick={onClose} style={{
          padding: '6px 16px', fontSize: 12, borderRadius: 4, cursor: 'pointer',
          border: '1px solid #c4b5fd', background: '#fff', color: '#7c3aed', fontWeight: 600,
        }}>Back to Scenarios</button>
      </div>

      {/* Warning if base has no data */}
      {base.length === 0 && (
        <div style={{ padding: '8px 14px', borderRadius: 6, fontSize: 12, fontWeight: 600,
          background: '#fef3c7', border: '1px solid #fcd34d', color: '#92400e' }}>
          Base simulation has no data — run the base simulation first.
        </div>
      )}

      {/* Comparison table */}
      <div style={{ border: '1px solid #e5e7eb', borderRadius: 8, overflow: 'hidden' }}>
        <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: 12 }}>
          <thead>
            <tr>
              <th style={{ ...thStyle, textAlign: 'left', width: 180 }}>Metric</th>
              <th style={{ ...thStyle, width: 80 }}>Base</th>
              {filteredScenarios.map(s => (
                <th key={s.id} style={{ ...thStyle, width: 80, color: s.color }}>{s.name}</th>
              ))}
              {filteredScenarios.length === 1 && <th style={{ ...thStyle, width: 60 }}>Delta</th>}
            </tr>
          </thead>
          <tbody>
            <SectionHeader title="Key Outcomes" colSpan={colCount + (filteredScenarios.length === 1 ? 1 : 0)} />

            {/* Total Starts */}
            <tr style={{ borderBottom: '1px solid #f0f0f0' }}>
              <td style={{ padding: '6px 12px', fontWeight: 500 }}>Total Starts</td>
              <td style={{ padding: '6px 8px', textAlign: 'right', color: '#6b7280' }}>{sumField(base, 'str_plan')}</td>
              {filteredScenarios.map(s => (
                <td key={s.id} style={{ padding: '6px 8px', textAlign: 'right', fontWeight: 600 }}>{sumField(s.rows, 'str_plan')}</td>
              ))}
              {filteredScenarios.length === 1 && <DeltaCell base={sumField(base, 'str_plan')} scenario={sumField(filteredScenarios[0].rows, 'str_plan')} />}
            </tr>

            {/* Total Closings */}
            <tr style={{ borderBottom: '1px solid #f0f0f0' }}>
              <td style={{ padding: '6px 12px', fontWeight: 500 }}>Total Closings</td>
              <td style={{ padding: '6px 8px', textAlign: 'right', color: '#6b7280' }}>{sumField(base, 'cls_plan')}</td>
              {filteredScenarios.map(s => (
                <td key={s.id} style={{ padding: '6px 8px', textAlign: 'right', fontWeight: 600 }}>{sumField(s.rows, 'cls_plan')}</td>
              ))}
              {filteredScenarios.length === 1 && <DeltaCell base={sumField(base, 'cls_plan')} scenario={sumField(filteredScenarios[0].rows, 'cls_plan')} />}
            </tr>

            {/* Peak Inventory */}
            <tr style={{ borderBottom: '1px solid #f0f0f0' }}>
              <td style={{ padding: '6px 12px', fontWeight: 500 }}>Peak Inventory</td>
              <td style={{ padding: '6px 8px', textAlign: 'right', color: '#6b7280' }}>{Math.max(0, ...aggregateByMonth(base).map(totalInv))}</td>
              {filteredScenarios.map(s => (
                <td key={s.id} style={{ padding: '6px 8px', textAlign: 'right', fontWeight: 600 }}>{Math.max(0, ...aggregateByMonth(s.rows).map(totalInv))}</td>
              ))}
              {filteredScenarios.length === 1 && <DeltaCell base={Math.max(0, ...aggregateByMonth(base).map(totalInv))} scenario={Math.max(0, ...aggregateByMonth(filteredScenarios[0].rows).map(totalInv))} />}
            </tr>

            {/* Sellout */}
            <tr style={{ borderBottom: '1px solid #f0f0f0' }}>
              <td style={{ padding: '6px 12px', fontWeight: 500 }}>Sellout</td>
              <td style={{ padding: '6px 8px', textAlign: 'right', color: '#6b7280' }}>{fmt(selloutMonth(base))}</td>
              {filteredScenarios.map(s => (
                <td key={s.id} style={{ padding: '6px 8px', textAlign: 'right', fontWeight: 600 }}>{fmt(selloutMonth(s.rows))}</td>
              ))}
              {filteredScenarios.length === 1 && <td style={{ padding: '6px 8px', textAlign: 'right', fontSize: 11, color: '#9ca3af' }}>—</td>}
            </tr>

            {/* Dead Months */}
            <tr style={{ borderBottom: '1px solid #f0f0f0' }}>
              <td style={{ padding: '6px 12px', fontWeight: 500 }}>Dead Months</td>
              <td style={{ padding: '6px 8px', textAlign: 'right', color: '#6b7280' }}>{zeroMonths(base)}</td>
              {filteredScenarios.map(s => (
                <td key={s.id} style={{ padding: '6px 8px', textAlign: 'right', fontWeight: 600 }}>{zeroMonths(s.rows)}</td>
              ))}
              {filteredScenarios.length === 1 && <DeltaCell base={zeroMonths(base)} scenario={zeroMonths(filteredScenarios[0].rows)} />}
            </tr>

            {/* Annual Starts */}
            <SectionHeader title="Starts by Year" colSpan={colCount + (filteredScenarios.length === 1 ? 1 : 0)} />
            {allYears.map(yr => (
              <tr key={`str-${yr}`} style={{ borderBottom: '1px solid #f0f0f0', background: yr === String(new Date().getFullYear()) ? '#f8faff' : undefined }}>
                <td style={{ padding: '4px 12px' }}>{yr}</td>
                <td style={{ padding: '4px 8px', textAlign: 'right', color: '#6b7280' }}>{baseAnnual[yr]?.str || 0}</td>
                {scAnnuals.map(s => (
                  <td key={s.id} style={{ padding: '4px 8px', textAlign: 'right', fontWeight: 600 }}>{s.annual[yr]?.str || 0}</td>
                ))}
                {filteredScenarios.length === 1 && <DeltaCell base={baseAnnual[yr]?.str || 0} scenario={scAnnuals[0]?.annual[yr]?.str || 0} />}
              </tr>
            ))}

            {/* Annual Closings */}
            <SectionHeader title="Closings by Year" colSpan={colCount + (filteredScenarios.length === 1 ? 1 : 0)} />
            {allYears.map(yr => (
              <tr key={`cls-${yr}`} style={{ borderBottom: '1px solid #f0f0f0', background: yr === String(new Date().getFullYear()) ? '#f8faff' : undefined }}>
                <td style={{ padding: '4px 12px' }}>{yr}</td>
                <td style={{ padding: '4px 8px', textAlign: 'right', color: '#6b7280' }}>{baseAnnual[yr]?.cls || 0}</td>
                {scAnnuals.map(s => (
                  <td key={s.id} style={{ padding: '4px 8px', textAlign: 'right', fontWeight: 600 }}>{s.annual[yr]?.cls || 0}</td>
                ))}
                {filteredScenarios.length === 1 && <DeltaCell base={baseAnnual[yr]?.cls || 0} scenario={scAnnuals[0]?.annual[yr]?.cls || 0} />}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
