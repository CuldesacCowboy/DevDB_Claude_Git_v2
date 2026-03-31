import { useRef, useState, useLayoutEffect } from 'react'
import { fmt, shortLot } from '../utils/tdaUtils'

// ── Checkpoint timeline (dot-plot) ───────────────────────────────
// Receives all assigned lots + placeholder slot count.
// Every slot gets a row: lots with dates get dots, all others get a ghost line.
export default function CheckpointTimeline({ lots, slotCount, checkpointDate, lotsRequired }) {
  const containerRef = useRef(null)
  const [width, setWidth] = useState(0)

  useLayoutEffect(() => {
    const el = containerRef.current
    if (!el) return
    setWidth(Math.floor(el.getBoundingClientRect().width))
    const obs = new ResizeObserver(([e]) => setWidth(Math.floor(e.contentRect.width)))
    obs.observe(el)
    return () => obs.disconnect()
  }, [])

  // Layout constants — readable sizes throughout
  const PAD_L = 80   // label column width
  const PAD_R = 20
  const ROW_H = 28
  const AXIS_ROW_H = 18   // height of each axis band (month / quarter / year)
  const TOP_PAD = 34      // room for checkpoint label above first row

  const chartW = Math.max(1, width - PAD_L - PAD_R)

  // Build one row per assigned lot + one ghost row per placeholder slot
  const allRows = [
    ...lots.map(l => ({
      key: `lot-${l.assignment_id ?? l.lot_id}`,
      label: shortLot(l.lot_number),
      hcDate: l.hc_projected_date || null,
      bldrDate: l.bldr_projected_date || null,
      ghost: !l.hc_projected_date && !l.bldr_projected_date,
    })),
    ...Array.from({ length: slotCount }, (_, i) => ({
      key: `slot-${i}`,
      label: '—',
      hcDate: null,
      bldrDate: null,
      ghost: true,
    })),
  ]
  const nRows = allRows.length

  // Time domain: lot dates + checkpoint only — today never stretches the axis.
  // Today's line is shown only when it falls within the natural date range.
  const todayTs = new Date().setHours(0, 0, 0, 0)
  const lotAndCpTs = [
    ...lots.flatMap(l => [l.hc_projected_date, l.bldr_projected_date]),
    checkpointDate,
  ].filter(Boolean).map(d => new Date(d).getTime())

  const rawMin = lotAndCpTs.length ? Math.min(...lotAndCpTs) : todayTs
  const rawMax = lotAndCpTs.length ? Math.max(...lotAndCpTs) : todayTs
  const span = rawMax - rawMin || 30 * 86400000
  const domMin = rawMin - span * 0.10
  const domMax = rawMax + span * 0.10

  const toX = ts => PAD_L + ((ts - domMin) / (domMax - domMin)) * chartW
  const dateX = d => d ? toX(new Date(d).getTime()) : null
  const todayX = toX(todayTs)
  // Only draw today line when it falls within the visible domain (not distorting the axis)
  const showToday = todayTs >= rawMin && todayTs <= rawMax
  const cpX = checkpointDate ? dateX(checkpointDate) : null

  // Generate period boundary timestamps within the domain
  function monthStarts() {
    const out = []
    const d = new Date(domMin); d.setDate(1); d.setHours(0, 0, 0, 0)
    while (d.getTime() <= domMax) { out.push(d.getTime()); d.setMonth(d.getMonth() + 1) }
    return out
  }
  const allMonths = monthStarts()
  const quarterBounds = allMonths.filter(ts => [0, 3, 6, 9].includes(new Date(ts).getMonth()))
  const yearBounds = allMonths.filter(ts => new Date(ts).getMonth() === 0)

  // Build axis cells: list of { x1, x2, rawX1, label } clipped to [PAD_L, PAD_L+chartW]
  function buildCells(bounds, labelFn) {
    const cells = bounds.map((ts, i) => {
      const nextTs = i + 1 < bounds.length ? bounds[i + 1] : domMax
      const rx1 = toX(Math.max(ts, domMin))
      const rx2 = toX(Math.min(nextTs, domMax))
      return { x1: Math.max(rx1, PAD_L), x2: Math.min(rx2, PAD_L + chartW), rawX1: rx1, label: labelFn(new Date(ts)) }
    }).filter(c => c.x2 > PAD_L && c.x1 < PAD_L + chartW)
    // Fallback: if no boundary starts inside domain, one spanning cell
    if (cells.length === 0 && bounds.length > 0) {
      cells.push({ x1: PAD_L, x2: PAD_L + chartW, rawX1: PAD_L - 1, label: labelFn(new Date(bounds[0])) })
    }
    return cells
  }

  const monthCells   = buildCells(allMonths,    d => d.toLocaleString('en-US', { month: 'short' }))
  const quarterCells = buildCells(quarterBounds, d => `Q${Math.floor(d.getMonth() / 3) + 1}`)
  const yearCells    = buildCells(yearBounds,    d => `${d.getFullYear()}`)

  // Fallback: if checkpoint / today set a year/quarter not in yearBounds/quarterBounds
  if (yearCells.length === 0 && checkpointDate) {
    const yr = new Date(checkpointDate).getFullYear()
    yearCells.push({ x1: PAD_L, x2: PAD_L + chartW, rawX1: PAD_L - 1, label: `${yr}` })
  }
  if (quarterCells.length === 0 && checkpointDate) {
    const q = Math.floor(new Date(checkpointDate).getMonth() / 3) + 1
    quarterCells.push({ x1: PAD_L, x2: PAD_L + chartW, rawX1: PAD_L - 1, label: `Q${q}` })
  }

  // Vertical positions
  const dataTop  = TOP_PAD
  const dataBot  = dataTop + nRows * ROW_H
  const monthTop = dataBot
  const qTop     = monthTop + AXIS_ROW_H
  const yearTop  = qTop + AXIS_ROW_H
  const svgH     = yearTop + AXIS_ROW_H

  // Checkpoint label: "{n} by mm/dd/yy", anchor flips near edges
  const cpLabel  = checkpointDate
    ? `${lotsRequired != null ? lotsRequired : ''}  by ${fmt(checkpointDate)}`.trimStart()
    : null
  const cpAnchor = cpX == null ? 'middle'
    : cpX < PAD_L + chartW * 0.18 ? 'start'
    : cpX > PAD_L + chartW * 0.82 ? 'end'
    : 'middle'

  if (width === 0) return <div ref={containerRef} style={{ width: '100%', height: 8 }} />

  return (
    <div ref={containerRef} style={{ padding: '4px 14px 14px' }}>
      <svg
        width={width - 28}
        height={svgH}
        style={{ display: 'block', overflow: 'visible' }}
      >
        {/* ── Month grid lines through data area ── */}
        {allMonths.map((ts, i) => {
          const x = toX(ts)
          return (x >= PAD_L && x <= PAD_L + chartW)
            ? <line key={i} x1={x} y1={dataTop} x2={x} y2={dataBot} stroke="#EDEDEA" strokeWidth={1} />
            : null
        })}

        {/* today line is rendered LAST so it draws on top — see below */}

        {/* ── Checkpoint line — solid red, label sits above line start ── */}
        {cpX !== null && (
          <g>
            {cpLabel && (
              <text
                x={cpX + (cpAnchor === 'end' ? -5 : cpAnchor === 'start' ? 5 : 0)}
                y={2}
                textAnchor={cpAnchor} dominantBaseline="hanging"
                fontSize={12} fontWeight={700} fill="#dc2626"
              >{cpLabel}</text>
            )}
            <line x1={cpX} y1={dataTop - 2} x2={cpX} y2={dataBot} stroke="#dc2626" strokeWidth={2} />
          </g>
        )}

        {/* ── Chart border ── */}
        <rect x={PAD_L} y={dataTop} width={chartW} height={nRows * ROW_H}
          fill="none" stroke="#E4E2DA" strokeWidth={1} />

        {/* ── Lot / slot rows ── */}
        {allRows.map((row, i) => {
          const cy = dataTop + i * ROW_H + ROW_H / 2
          const hx = dateX(row.hcDate)
          const bx = dateX(row.bldrDate)
          const hasDate = hx !== null || bx !== null
          const meetsCp = cpX !== null && hasDate && (
            (hx !== null && hx <= cpX) || (bx !== null && bx <= cpX)
          )
          // Has dates but earliest is after the checkpoint date
          const missesCp = cpX !== null && hasDate && !meetsCp

          return (
            <g key={row.key}>
              {/* Icon + lot label — single text block, right-aligned */}
              <text x={PAD_L - 8} y={cy} textAnchor="end" dominantBaseline="middle" fontSize={13}>
                {meetsCp && (
                  <tspan fill="#15803d" fontWeight={700}>✓</tspan>
                )}
                {missesCp && (
                  <tspan fill="#b45309" fontWeight={700}>↷</tspan>
                )}
                <tspan
                  fill={row.ghost ? '#C8C6BE' : '#6B6B68'}
                  dx={meetsCp || missesCp ? 5 : 0}
                >{row.label}</tspan>
              </text>

              {row.ghost ? (
                // Ghost row: dashed line spanning full chart width
                <line
                  x1={PAD_L + 6} y1={cy} x2={PAD_L + chartW - 6} y2={cy}
                  stroke="#DDDBD3" strokeWidth={1} strokeDasharray="5,5"
                />
              ) : (
                <>
                  {/* Connector */}
                  {hx !== null && bx !== null && (
                    <line
                      x1={Math.min(hx, bx)} y1={cy}
                      x2={Math.max(hx, bx)} y2={cy}
                      stroke="#C8C6BE" strokeWidth={2.5}
                    />
                  )}
                  {/* HC dot */}
                  {hx !== null && (
                    <circle cx={hx} cy={cy} r={6} fill="#2563eb" stroke="#fff" strokeWidth={1.5}>
                      <title>HC: {fmt(row.hcDate)}</title>
                    </circle>
                  )}
                  {/* BLDR dot */}
                  {bx !== null && (
                    <circle cx={bx} cy={cy} r={6} fill="#d97706" stroke="#fff" strokeWidth={1.5}>
                      <title>BLDR: {fmt(row.bldrDate)}</title>
                    </circle>
                  )}
                </>
              )}
            </g>
          )
        })}

        {/* ── Today line — rendered last so it appears on top of all row content ── */}
        {showToday && todayX >= PAD_L && todayX <= PAD_L + chartW && (() => {
          // Flip label to opposite side when close to checkpoint line
          const nearCp = cpX !== null && Math.abs(todayX - cpX) < 52
          const labelRight = nearCp ? todayX < cpX : todayX > PAD_L + chartW * 0.7
          const labelX = labelRight ? todayX - 5 : todayX + 5
          const labelAnchor = labelRight ? 'end' : 'start'
          // Suppress label entirely if it would still overlap the checkpoint label area
          const suppressLabel = nearCp && Math.abs(todayX - cpX) < 28
          return (
            <g>
              <line x1={todayX} y1={dataTop} x2={todayX} y2={dataBot}
                stroke="#444441" strokeWidth={1.5} />
              {!suppressLabel && (
                <text x={labelX} y={dataTop + 5}
                  dominantBaseline="hanging" textAnchor={labelAnchor}
                  fontSize={12} fontWeight={600} fill="#444441"
                >today</text>
              )}
            </g>
          )
        })()}

        {/* ── Month axis band ── */}
        <rect x={PAD_L} y={monthTop} width={chartW} height={AXIS_ROW_H} fill="#F3F2EE" />
        {monthCells.map((c, i) => (
          <g key={`m${i}`}>
            {c.rawX1 > PAD_L && c.rawX1 < PAD_L + chartW && (
              <line x1={c.rawX1} y1={monthTop} x2={c.rawX1} y2={monthTop + AXIS_ROW_H}
                stroke="#E4E2DA" strokeWidth={1} />
            )}
            {(c.x2 - c.x1) >= 28 && (
              <text x={(c.x1 + c.x2) / 2} y={monthTop + AXIS_ROW_H / 2}
                textAnchor="middle" dominantBaseline="middle"
                fontSize={12} fill="#6B6B68">{c.label}</text>
            )}
          </g>
        ))}
        <line x1={PAD_L} y1={monthTop + AXIS_ROW_H} x2={PAD_L + chartW} y2={monthTop + AXIS_ROW_H}
          stroke="#E4E2DA" strokeWidth={1} />

        {/* ── Quarter axis band ── */}
        <rect x={PAD_L} y={qTop} width={chartW} height={AXIS_ROW_H} fill="#ECEAE4" />
        {quarterCells.map((c, i) => (
          <g key={`q${i}`}>
            {c.rawX1 > PAD_L && c.rawX1 < PAD_L + chartW && (
              <line x1={c.rawX1} y1={qTop} x2={c.rawX1} y2={qTop + AXIS_ROW_H}
                stroke="#D4D2CB" strokeWidth={1} />
            )}
            {(c.x2 - c.x1) >= 20 && (
              <text x={(c.x1 + c.x2) / 2} y={qTop + AXIS_ROW_H / 2}
                textAnchor="middle" dominantBaseline="middle"
                fontSize={12} fontWeight={600} fill="#6B6B68">{c.label}</text>
            )}
          </g>
        ))}
        <line x1={PAD_L} y1={qTop + AXIS_ROW_H} x2={PAD_L + chartW} y2={qTop + AXIS_ROW_H}
          stroke="#D4D2CB" strokeWidth={1} />

        {/* ── Year axis band ── */}
        <rect x={PAD_L} y={yearTop} width={chartW} height={AXIS_ROW_H} fill="#E4E1D8" />
        {yearCells.map((c, i) => (
          <g key={`y${i}`}>
            {c.rawX1 > PAD_L && c.rawX1 < PAD_L + chartW && (
              <line x1={c.rawX1} y1={yearTop} x2={c.rawX1} y2={yearTop + AXIS_ROW_H}
                stroke="#C8C6BE" strokeWidth={1} />
            )}
            {(c.x2 - c.x1) >= 32 && (
              <text x={(c.x1 + c.x2) / 2} y={yearTop + AXIS_ROW_H / 2}
                textAnchor="middle" dominantBaseline="middle"
                fontSize={13} fontWeight={700} fill="#444441">{c.label}</text>
            )}
          </g>
        ))}
        <line x1={PAD_L} y1={yearTop + AXIS_ROW_H} x2={PAD_L + chartW} y2={yearTop + AXIS_ROW_H}
          stroke="#C8C6BE" strokeWidth={1} />

      </svg>

      {/* Legend */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginTop: 6, paddingLeft: PAD_L }}>
        {[{ color: '#2563eb', label: 'HC' }, { color: '#d97706', label: 'BLDR' }].map(({ color, label }) => (
          <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
            <svg width={13} height={13}><circle cx={6.5} cy={6.5} r={6} fill={color} /></svg>
            <span style={{ fontSize: 12, color: '#888780' }}>{label}</span>
          </div>
        ))}
        <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
          <svg width={18} height={13}><line x1={0} y1={6.5} x2={18} y2={6.5} stroke="#dc2626" strokeWidth={2} /></svg>
          <span style={{ fontSize: 12, color: '#888780' }}>Checkpoint</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
          <svg width={18} height={13}><line x1={0} y1={6.5} x2={18} y2={6.5} stroke="#444441" strokeWidth={1.5} /></svg>
          <span style={{ fontSize: 12, color: '#888780' }}>Today</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
          <span style={{ fontSize: 13, color: '#15803d', fontWeight: 700 }}>✓</span>
          <span style={{ fontSize: 12, color: '#888780' }}>Meets CP</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
          <span style={{ fontSize: 13, color: '#b45309', fontWeight: 700 }}>↷</span>
          <span style={{ fontSize: 12, color: '#888780' }}>Late for CP</span>
        </div>
      </div>
    </div>
  )
}
