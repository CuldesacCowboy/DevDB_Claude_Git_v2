// BuildingGroupsLayer.jsx
// SVG overlay: building group ellipses and draw-group preview.
// computeBgEllipse is exported for PdfCanvas hit-testing (findBgAtPoint).
// Renders SVG elements — must be a child of PdfCanvas's <svg>.

const SNAP_TRACE_PX = 16  // snap-to-close distance for draw preview (matches PdfCanvas)

// Compute the SVG-space ellipse for a building group given its lot positions.
// Returns {cx, cy, rx, ry} in screen pixels, or null if no lots have positions.
export function computeBgEllipse(bg, normToScreen) {
  if (!bg.lots || !bg.lots.length) return null
  const pts = bg.lots.map(l => normToScreen(l.x, l.y))
  const minX = Math.min(...pts.map(p => p.x))
  const maxX = Math.max(...pts.map(p => p.x))
  const minY = Math.min(...pts.map(p => p.y))
  const maxY = Math.max(...pts.map(p => p.y))
  const PAD = 18
  return {
    cx: (minX + maxX) / 2,
    cy: (minY + maxY) / 2,
    rx: Math.max(14, (maxX - minX) / 2 + PAD),
    ry: Math.max(14, (maxY - minY) / 2 + PAD),
  }
}

export default function BuildingGroupsLayer({
  buildingGroups, showBuildingGroups,
  selectedBgIds, hoveredBgId, onHoverBg,
  inDeleteBuilding, zoom, normToScreen,
  onBuildingGroupSelect, onBuildingGroupContextMenu,
  inDrawBuilding, bgDrawPoints, bgDrawCursorSvg,
}) {
  return (
    <>
      {/* ── Building group ovals ── */}
      {showBuildingGroups && buildingGroups.map(bg => {
        const ell = computeBgEllipse(bg, normToScreen)
        if (!ell) return null
        const isSelected  = selectedBgIds.has(bg.building_group_id)
        const isHovered   = hoveredBgId === bg.building_group_id
        const strokeColor = isSelected ? '#ef4444' : isHovered ? '#f97316' : '#0d9488'
        const fillColor   = isSelected ? 'rgba(239,68,68,0.10)' : isHovered ? 'rgba(249,115,22,0.10)' : 'rgba(13,148,136,0.07)'
        const strokeW     = isSelected || isHovered ? 2.5 : 1.8
        return (
          <g key={bg.building_group_id}
            style={{ cursor: inDeleteBuilding ? 'pointer' : 'default' }}
            onPointerEnter={inDeleteBuilding ? () => onHoverBg?.(bg.building_group_id) : undefined}
            onPointerLeave={inDeleteBuilding ? () => onHoverBg?.(null) : undefined}
            onClick={inDeleteBuilding ? () => onBuildingGroupSelect?.(bg.building_group_id) : undefined}
            onContextMenu={inDeleteBuilding ? (e) => {
              e.preventDefault()
              if (!selectedBgIds.has(bg.building_group_id)) onBuildingGroupSelect?.(bg.building_group_id)
              onBuildingGroupContextMenu?.(bg.building_group_id, ell.cx, ell.cy)
            } : undefined}
          >
            {/* White halo for legibility over any PDF background */}
            <ellipse cx={ell.cx} cy={ell.cy} rx={ell.rx + 2} ry={ell.ry + 2}
              fill="none" stroke="rgba(255,255,255,0.6)" strokeWidth={strokeW + 3}
              style={{ pointerEvents: 'none' }} />
            <ellipse cx={ell.cx} cy={ell.cy} rx={ell.rx} ry={ell.ry}
              fill={fillColor}
              stroke={strokeColor}
              strokeWidth={strokeW}
              strokeDasharray="6 4"
              style={{ pointerEvents: inDeleteBuilding ? 'fill' : 'none' }}
            />
            {zoom > 0.5 && (
              <text
                x={ell.cx} y={ell.cy + ell.ry + 13}
                textAnchor="middle"
                fontSize={Math.max(8, 10 / zoom)}
                fill={strokeColor}
                stroke="rgba(255,255,255,0.9)" strokeWidth={2.5 / zoom}
                paintOrder="stroke"
                style={{ pointerEvents: 'none', userSelect: 'none' }}
              >
                {bg.building_name}
              </text>
            )}
          </g>
        )
      })}

      {/* ── Building group draw preview ── */}
      {inDrawBuilding && bgDrawPoints.length > 0 && (() => {
        const svgPts   = bgDrawPoints.map(p => normToScreen(p.x, p.y))
        const svgFirst = svgPts[0]
        const svgLast  = svgPts[svgPts.length - 1]
        const nearFirst = bgDrawPoints.length >= 3 && bgDrawCursorSvg
          && Math.hypot(svgFirst.x - bgDrawCursorSvg.x, svgFirst.y - bgDrawCursorSvg.y) < SNAP_TRACE_PX
        return (
          <>
            {svgPts.length >= 2 && (
              <polyline points={svgPts.map(p => `${p.x},${p.y}`).join(' ')}
                fill="none" stroke="#0d9488" strokeWidth={2} strokeLinejoin="round" />
            )}
            {bgDrawCursorSvg && svgLast && !nearFirst && (
              <line x1={svgLast.x} y1={svgLast.y} x2={bgDrawCursorSvg.x} y2={bgDrawCursorSvg.y}
                stroke="#0d9488" strokeWidth={1.5} strokeDasharray="5 4" />
            )}
            {nearFirst && (
              <line x1={svgLast.x} y1={svgLast.y} x2={svgFirst.x} y2={svgFirst.y}
                stroke="#0d9488" strokeWidth={1.5} strokeDasharray="5 4" />
            )}
            {nearFirst && (
              <polygon points={svgPts.map(p => `${p.x},${p.y}`).join(' ')}
                fill="rgba(13,148,136,0.12)" stroke="none" />
            )}
            {svgPts.map((p, i) => (
              <circle key={i} cx={p.x} cy={p.y} r={i === 0 ? 6 : 4}
                fill={i === 0 && bgDrawPoints.length >= 3 ? (nearFirst ? 'rgba(13,148,136,0.3)' : 'none') : '#0d9488'}
                stroke="#0d9488" strokeWidth={2} />
            ))}
            {bgDrawPoints.length >= 3 && (
              <circle cx={svgFirst.x} cy={svgFirst.y}
                r={nearFirst ? SNAP_TRACE_PX : 8}
                fill={nearFirst ? 'rgba(13,148,136,0.2)' : 'none'}
                stroke="#0d9488" strokeWidth={nearFirst ? 2 : 1.5} strokeDasharray={nearFirst ? 'none' : '3 2'} />
            )}
            {bgDrawCursorSvg && (
              <circle cx={bgDrawCursorSvg.x} cy={bgDrawCursorSvg.y} r={3}
                fill="#0d9488" stroke="#fff" strokeWidth={1} />
            )}
          </>
        )
      })()}

      {/* Cursor dot when no points yet */}
      {inDrawBuilding && bgDrawPoints.length === 0 && bgDrawCursorSvg && (
        <circle cx={bgDrawCursorSvg.x} cy={bgDrawCursorSvg.y} r={4}
          fill="rgba(13,148,136,0.5)" stroke="#0d9488" strokeWidth={1.5}
          style={{ pointerEvents: 'none' }} />
      )}
    </>
  )
}
