// LotMarkersLayer.jsx
// SVG overlay: lot position markers and place-mode cursor tooltip.
// Renders SVG elements — must be a child of PdfCanvas's <svg>.

// "SC00000001" → "SC-1"
function lotLabel(lotNumber) {
  const m = lotNumber?.match(/^([A-Z]+)0*(\d+)$/)
  return m ? `${m[1]}-${parseInt(m[2], 10)}` : (lotNumber || '?')
}

export default function LotMarkersLayer({
  lotPositions, dragLotId, dragLotPos, lotColorMap, lotMeta,
  zoom, normToScreen,
  inPlace, placingLot, placeCursorSvg,
}) {
  return (
    <>
      {Object.entries(lotPositions).map(([lotIdStr, pos]) => {
        const lotId = Number(lotIdStr)
        const isBeingDragged = lotId === dragLotId
        const displayPos = (isBeingDragged && dragLotPos) ? dragLotPos : pos
        const sp = normToScreen(displayPos.x, displayPos.y)
        const color = lotColorMap[lotId] || '#6366f1'
        const label = lotLabel(lotMeta[lotId]?.lot_number)
        return (
          <g key={lotId} style={{ pointerEvents: 'none' }}>
            <circle cx={sp.x} cy={sp.y} r={isBeingDragged ? 8 : 6}
              fill={color} stroke="#fff" strokeWidth={1.5}
              opacity={isBeingDragged ? 0.75 : 1} />
            {zoom > 0.65 && (
              <text x={sp.x} y={sp.y - 9} textAnchor="middle"
                fontSize={Math.max(8, 10 / zoom)} fill="#1e293b"
                stroke="rgba(255,255,255,0.9)" strokeWidth={2.5 / zoom}
                paintOrder="stroke"
                style={{ pointerEvents: 'none', userSelect: 'none' }}>
                {label}
              </text>
            )}
          </g>
        )
      })}

      {inPlace && placingLot && placeCursorSvg && (
        <g style={{ pointerEvents: 'none' }}>
          <circle cx={placeCursorSvg.x} cy={placeCursorSvg.y} r={5}
            fill="rgba(124,58,237,0.5)" stroke="#7c3aed" strokeWidth={1.5}
            strokeDasharray="3 2" />
          <text x={placeCursorSvg.x + 11} y={placeCursorSvg.y - 4}
            fontSize={12} fill="#7c3aed"
            stroke="rgba(255,255,255,0.95)" strokeWidth={3} paintOrder="stroke"
            style={{ userSelect: 'none', fontWeight: 600 }}>
            {lotLabel(placingLot.lot_number)}
          </text>
        </g>
      )}
    </>
  )
}
