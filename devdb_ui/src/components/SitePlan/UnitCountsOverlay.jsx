// UnitCountsOverlay.jsx
// SVG overlay: r/p/t table cards per phase boundary (unit-counts panel mode).
// Renders SVG elements — must be a child of PdfCanvas's <svg>.

const UNASSIGNED_COLOR = '#9ca3af'

function darkenHex(hex, factor = 0.45) {
  if (!hex || !hex.startsWith('#') || hex.length < 7) return hex
  const r = Math.round(parseInt(hex.slice(1, 3), 16) * (1 - factor))
  const g = Math.round(parseInt(hex.slice(3, 5), 16) * (1 - factor))
  const b = Math.round(parseInt(hex.slice(5, 7), 16) * (1 - factor))
  return `rgb(${r},${g},${b})`
}

export default function UnitCountsOverlay({
  boundaries, phasesData, unitCountsSubtotal,
  lotPositions, lotMeta, phaseColorMap,
  zoom, normToScreen, onEditProjected,
}) {
  return boundaries.map(b => {
    if (!b.phase_id) return null
    const phaseData = phasesData.find(p => p.phase_id === b.phase_id)
    if (!phaseData) return null

    const byLt = (phaseData.by_lot_type || []).filter(lt => (lt.actual || 0) > 0 || (lt.projected || 0) > 0)
    if (!byLt.length && !unitCountsSubtotal) {
      // In totals mode with no data skip silently
    }

    const pts = JSON.parse(b.polygon_json)
    const svg = pts.map(p => normToScreen(p.x, p.y))

    const avgCx = svg.reduce((s, p) => s + p.x, 0) / svg.length
    const avgCy = svg.reduce((s, p) => s + p.y, 0) / svg.length
    let labelCx = avgCx, labelCy = avgCy
    {
      let best = Infinity
      for (const [lidStr, pos] of Object.entries(lotPositions)) {
        if (lotMeta[Number(lidStr)]?.phase_id !== b.phase_id) continue
        const sp = normToScreen(pos.x, pos.y)
        const d = Math.hypot(sp.x - avgCx, sp.y - avgCy)
        if (d < best) { best = d; labelCx = sp.x; labelCy = sp.y }
      }
    }

    const totalR = byLt.reduce((s, lt) => s + (lt.actual || 0), 0)
    const totalP = byLt.reduce((s, lt) => s + (lt.projected || 0), 0)
    const totalT = byLt.reduce((s, lt) => s + (lt.total || 0), 0)

    const fs    = Math.max(9, Math.min(14, 11.5 / Math.sqrt(zoom)))
    const lineH = fs * 1.6
    const charW = fs * 0.58

    const phaseColor  = (b.phase_id && phaseColorMap[b.phase_id]) || UNASSIGNED_COLOR
    const borderColor = darkenHex(phaseColor, 0.4)

    if (!unitCountsSubtotal) {
      // ── Totals mode: table card with single "Total" row ───
      const pText    = String(totalP)
      const pW       = pText.length * charW * 1.05
      const pillPadX = charW * 0.4
      const pillPadY = fs * 0.12
      const typeColW = 5 * charW
      const valColW  = Math.max(2 * charW, String(Math.max(totalR, totalP, totalT, 9)).length * charW + charW * 0.5)
      const gapW     = charW * 1.0
      const padX     = 7
      const padY     = 5
      const innerW   = typeColW + gapW + valColW + gapW + valColW + gapW + valColW
      const boxW     = innerW + padX * 2
      const boxH     = 2 * lineH + padY * 2
      const boxX     = labelCx - boxW / 2
      const boxY     = labelCy - boxH / 2
      const col0x    = boxX + padX
      const col1x    = col0x + typeColW + gapW + valColW
      const col2x    = col1x + gapW + valColW
      const col3x    = col2x + gapW + valColW
      const rowY     = (i) => boxY + padY + (i + 0.78) * lineH
      const headerY  = rowY(0)
      const sepY1    = boxY + padY + lineH
      const dataY    = rowY(1)
      return (
        <g key={`uc_${b.boundary_id}`} style={{ pointerEvents: 'none' }}>
          <text x={labelCx} y={boxY - 2} textAnchor="middle" dominantBaseline="auto"
            fontFamily="sans-serif" fontSize={fs * 0.82} fill={borderColor} fontWeight="700"
            style={{ userSelect: 'none' }}>
            {phaseData.phase_name}
          </text>
          <rect x={boxX} y={boxY} width={boxW} height={boxH} rx={5}
            fill="rgba(255,255,255,0.94)" stroke={borderColor}
            strokeWidth={Math.max(0.8, 1.5 / zoom)} />
          <text x={col0x} y={headerY} dominantBaseline="auto"
            fontFamily="sans-serif" fontSize={fs * 0.82} fill="#94a3b8" fontWeight="700"
            style={{ userSelect: 'none' }}>
            Type
          </text>
          {['R', 'P', 'T'].map((hdr, hi) => (
            <text key={hdr} x={[col1x, col2x, col3x][hi]} y={headerY} textAnchor="end" dominantBaseline="auto"
              fontFamily="sans-serif" fontSize={fs * 0.82}
              fill={hi === 1 ? '#0f766e' : hi === 0 ? '#64748b' : '#374151'}
              fontWeight="700" style={{ userSelect: 'none' }}>
              {hdr}
            </text>
          ))}
          <line x1={boxX + 3} y1={sepY1} x2={boxX + boxW - 3} y2={sepY1}
            stroke={borderColor} strokeOpacity={0.4} strokeWidth={Math.max(0.5, 0.8 / zoom)} />
          <text x={col0x} y={dataY} dominantBaseline="auto"
            fontFamily="sans-serif" fontSize={fs * 0.82} fill="#94a3b8" fontWeight="700"
            style={{ userSelect: 'none' }}>
            Total
          </text>
          <text x={col1x} y={dataY} textAnchor="end" dominantBaseline="auto"
            fontFamily="monospace" fontSize={fs} fill="#64748b" fontWeight="600"
            style={{ userSelect: 'none' }}>
            {totalR}
          </text>
          <rect x={col2x - pW - pillPadX} y={dataY - fs * 0.85 - pillPadY}
            width={pW + pillPadX * 2} height={fs * 1.1} rx={3}
            fill="#f0fdfa" stroke="#0d9488" strokeWidth={Math.max(0.6, 1 / zoom)} />
          <text x={col2x} y={dataY} textAnchor="end" dominantBaseline="auto"
            fontFamily="monospace" fontSize={fs} fill="#0f766e" fontWeight="700"
            style={{ userSelect: 'none' }}>
            {pText}
          </text>
          <text x={col3x} y={dataY} textAnchor="end" dominantBaseline="auto"
            fontFamily="monospace" fontSize={fs} fill="#1e293b" fontWeight="700"
            style={{ userSelect: 'none' }}>
            {totalT}
          </text>
        </g>
      )
    }

    // ── By-type mode: table card ──────────────────────────
    if (!byLt.length) return null

    const multiLt    = byLt.length > 1
    const headerRows = 1
    const dataRows   = byLt.length
    const totalRows  = multiLt ? 1 : 0
    const rowCount   = headerRows + dataRows + totalRows

    const typeColW = Math.max(4 * charW, ...byLt.map(lt => (lt.lot_type_short || '').length * charW))
    const valColW  = Math.max(2 * charW, String(Math.max(totalR, totalP, totalT, 9)).length * charW + charW * 0.5)
    const gapW     = charW * 1.0
    const padX     = 7
    const padY     = 5
    const innerW   = typeColW + gapW + valColW + gapW + valColW + gapW + valColW
    const boxW     = innerW + padX * 2
    const boxH     = rowCount * lineH + padY * 2
    const boxX     = labelCx - boxW / 2
    const boxY     = labelCy - boxH / 2

    const col0x = boxX + padX
    const col1x = col0x + typeColW + gapW + valColW
    const col2x = col1x + gapW + valColW
    const col3x = col2x + gapW + valColW

    const rowY    = (i) => boxY + padY + (i + 0.78) * lineH
    const headerY = rowY(0)
    const sepY1   = boxY + padY + lineH
    const sepY2   = multiLt ? boxY + padY + (1 + dataRows) * lineH : null

    return (
      <g key={`uc_${b.boundary_id}`}>
        <text x={labelCx} y={boxY - 2} textAnchor="middle" dominantBaseline="auto"
          fontFamily="sans-serif" fontSize={fs * 0.82} fill={borderColor} fontWeight="700"
          style={{ userSelect: 'none', pointerEvents: 'none' }}>
          {phaseData.phase_name}
        </text>
        <rect x={boxX} y={boxY} width={boxW} height={boxH} rx={5}
          fill="rgba(255,255,255,0.94)" stroke={borderColor}
          strokeWidth={Math.max(0.8, 1.5 / zoom)}
          style={{ pointerEvents: 'none' }} />

        <text x={col0x} y={headerY} dominantBaseline="auto"
          fontFamily="sans-serif" fontSize={fs * 0.82} fill="#94a3b8" fontWeight="700"
          textTransform="uppercase" style={{ userSelect: 'none', pointerEvents: 'none' }}>
          Type
        </text>
        {['R', 'P', 'T'].map((hdr, hi) => {
          const colRightX = [col1x, col2x, col3x][hi]
          return (
            <text key={hdr} x={colRightX} y={headerY} textAnchor="end" dominantBaseline="auto"
              fontFamily="sans-serif" fontSize={fs * 0.82}
              fill={hi === 1 ? '#0f766e' : hi === 0 ? '#64748b' : '#374151'}
              fontWeight="700"
              style={{ userSelect: 'none', pointerEvents: 'none' }}>
              {hdr}
            </text>
          )
        })}

        <line x1={boxX + 3} y1={sepY1} x2={boxX + boxW - 3} y2={sepY1}
          stroke={borderColor} strokeOpacity={0.4} strokeWidth={Math.max(0.5, 0.8 / zoom)}
          style={{ pointerEvents: 'none' }} />

        {byLt.map((lt, i) => {
          const ry    = rowY(i + 1)
          const pText = String(lt.projected || 0)
          const pW    = pText.length * charW * 1.05
          return (
            <g key={lt.lot_type_id}
              style={{ cursor: 'pointer', pointerEvents: 'all' }}
              onClick={(e) => {
                e.stopPropagation()
                onEditProjected?.(b.phase_id, lt.lot_type_id, lt.projected || 0, labelCx, ry)
              }}
            >
              <rect x={boxX} y={ry - lineH * 0.85} width={boxW} height={lineH}
                fill="transparent" />
              <text x={col0x} y={ry} dominantBaseline="auto"
                fontFamily="monospace" fontSize={fs} fill="#475569"
                style={{ userSelect: 'none', pointerEvents: 'none' }}>
                {lt.lot_type_short || '—'}
              </text>
              <text x={col1x} y={ry} textAnchor="end" dominantBaseline="auto"
                fontFamily="monospace" fontSize={fs} fill="#64748b"
                style={{ userSelect: 'none', pointerEvents: 'none' }}>
                {lt.actual || 0}
              </text>
              <rect x={col2x - pW - charW * 0.4} y={ry - fs * 0.85 - fs * 0.12}
                width={pW + charW * 0.8} height={fs * 1.1} rx={3}
                fill="#f0fdfa" stroke="#0d9488" strokeWidth={Math.max(0.6, 1 / zoom)}
                style={{ pointerEvents: 'none' }} />
              <text x={col2x} y={ry} textAnchor="end" dominantBaseline="auto"
                fontFamily="monospace" fontSize={fs} fill="#0f766e" fontWeight="700"
                style={{ userSelect: 'none', pointerEvents: 'none' }}>
                {pText}
              </text>
              <text x={col3x} y={ry} textAnchor="end" dominantBaseline="auto"
                fontFamily="monospace" fontSize={fs} fill="#1e293b" fontWeight="600"
                style={{ userSelect: 'none', pointerEvents: 'none' }}>
                {lt.total || 0}
              </text>
            </g>
          )
        })}

        {multiLt && (() => {
          const ty = rowY(1 + dataRows)
          return (
            <g key="total" style={{ pointerEvents: 'none' }}>
              <line x1={boxX + 3} y1={sepY2} x2={boxX + boxW - 3} y2={sepY2}
                stroke={borderColor} strokeOpacity={0.4} strokeWidth={Math.max(0.5, 0.8 / zoom)} />
              <text x={col0x} y={ty} dominantBaseline="auto"
                fontFamily="sans-serif" fontSize={fs * 0.82} fill="#94a3b8" fontWeight="700"
                style={{ userSelect: 'none' }}>
                Total
              </text>
              <text x={col1x} y={ty} textAnchor="end" dominantBaseline="auto"
                fontFamily="monospace" fontSize={fs} fill="#64748b" fontWeight="600"
                style={{ userSelect: 'none' }}>
                {totalR}
              </text>
              {(() => { const tpW = String(totalP).length * charW * 1.05; return (
                <rect x={col2x - tpW - charW * 0.4} y={ty - fs * 0.85 - fs * 0.12}
                  width={tpW + charW * 0.8} height={fs * 1.1} rx={3}
                  fill="#f0fdfa" stroke="#0d9488" strokeWidth={Math.max(0.6, 1 / zoom)} />
              )})()}
              <text x={col2x} y={ty} textAnchor="end" dominantBaseline="auto"
                fontFamily="monospace" fontSize={fs} fill="#0f766e" fontWeight="700"
                style={{ userSelect: 'none' }}>
                {totalP}
              </text>
              <text x={col3x} y={ty} textAnchor="end" dominantBaseline="auto"
                fontFamily="monospace" fontSize={fs} fill="#1e293b" fontWeight="700"
                style={{ userSelect: 'none' }}>
                {totalT}
              </text>
            </g>
          )
        })()}
      </g>
    )
  })
}
