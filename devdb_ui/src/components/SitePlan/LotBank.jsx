// LotBank.jsx
// Left panel on the site plan page showing unpositioned lots.
//
// Two placement interactions:
//   1. Drag a lot pill onto the canvas (HTML5 drag-and-drop).
//   2. Click a lot pill to enter click-to-set loop; each subsequent canvas
//      click places that lot, then auto-advances to the next lot in the bank.
//
// Props:
//   lots             — [{lot_id, lot_number, instrument_id, instrument_name, phase_name}]
//   instrumentColors — {instrument_id: color}
//   placingLotId     — lot_id currently being placed (null if not in loop)
//   onLotDragStart   — (dragEvent, lot) => void
//   onLotClick       — (lot) => void  — enters click-to-set loop from this lot

import { useMemo } from 'react'

// "SC00000001" → "SC-1"
function lotLabel(lotNumber) {
  const m = lotNumber?.match(/^([A-Z]+)0*(\d+)$/)
  return m ? `${m[1]}-${parseInt(m[2], 10)}` : (lotNumber || '?')
}

export default function LotBank({ lots, instrumentColors, placingLotId, onLotDragStart, onLotClick }) {
  // Group by instrument_name (stable order: preserve first-appearance)
  const groups = useMemo(() => {
    const seen = {}
    const order = []
    for (const l of lots) {
      const key = l.instrument_name || 'Unassigned'
      if (!seen[key]) {
        seen[key] = { instrument_id: l.instrument_id, key, lots: [] }
        order.push(key)
      }
      seen[key].lots.push(l)
    }
    return order.map(k => seen[k])
  }, [lots])

  return (
    <div style={{
      width: 178, borderRight: '1px solid #e5e7eb', background: '#fafafa',
      display: 'flex', flexDirection: 'column', flexShrink: 0, overflow: 'hidden',
    }}>
      {/* Header */}
      <div style={{ padding: '8px 10px', borderBottom: '1px solid #e5e7eb', background: '#fff', flexShrink: 0 }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: '#374151' }}>Lot Bank</div>
        <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 1 }}>
          {lots.length === 0 ? 'All lots placed' : `${lots.length} lot${lots.length !== 1 ? 's' : ''}`}
        </div>
      </div>

      {/* Empty state */}
      {lots.length === 0 && (
        <div style={{ padding: '14px 10px', fontSize: 11, color: '#9ca3af', lineHeight: 1.5 }}>
          All lots have been placed on the plan.
        </div>
      )}

      {/* Grouped lot pills */}
      <div style={{ flex: 1, overflowY: 'auto' }}>
        {groups.map(({ key, instrument_id, lots: grpLots }) => {
          const color = (instrument_id && instrumentColors?.[instrument_id]) || '#9ca3af'
          return (
            <div key={key}>
              {/* Group header */}
              <div style={{
                padding: '3px 10px', fontSize: 10, fontWeight: 600, color: '#6b7280',
                background: '#f3f4f6', display: 'flex', alignItems: 'center', gap: 5,
                textTransform: 'uppercase', letterSpacing: '0.05em', userSelect: 'none',
              }}>
                <div style={{ width: 8, height: 8, borderRadius: 2, background: color, flexShrink: 0 }} />
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {key}
                </span>
                <span style={{ marginLeft: 'auto', color: '#d1d5db', fontWeight: 400 }}>
                  {grpLots.length}
                </span>
              </div>

              {/* Lot pills */}
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3, padding: '4px 6px 6px' }}>
                {grpLots.map(lot => {
                  const label = lotLabel(lot.lot_number)
                  const isPlacing = lot.lot_id === placingLotId
                  return (
                    <div
                      key={lot.lot_id}
                      draggable
                      onDragStart={e => onLotDragStart?.(e, lot)}
                      onClick={() => onLotClick?.(lot)}
                      title={`${lot.lot_number}${lot.phase_name ? ` · ${lot.phase_name}` : ''}\nDrag to place on map, or click to enter position-setting mode`}
                      style={{
                        padding: '2px 5px', borderRadius: 3, fontSize: 10, cursor: 'grab',
                        background: isPlacing ? color : '#e5e7eb',
                        color: isPlacing ? '#fff' : '#374151',
                        border: `1px solid ${isPlacing ? color : '#d1d5db'}`,
                        fontWeight: isPlacing ? 600 : 400,
                        userSelect: 'none',
                        transition: 'background 0.1s',
                      }}
                    >
                      {label}
                    </div>
                  )
                })}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
