import { DragOverlay } from '@dnd-kit/core'
import { shortLot } from '../utils/tdaUtils'

export default function TdaDragOverlay({ dragLot, selectedLotIds, selectedPoolLotIds }) {
  return (
    <DragOverlay>
      {(dragLot?.type === 'unassigned-lot' || dragLot?.type === 'pool-lot') && (() => {
        const isPool = dragLot.type === 'pool-lot'
        const sel = isPool ? selectedPoolLotIds : selectedLotIds
        const isMulti = sel.has(dragLot.lot.lot_id) && sel.size > 1
        return (
          <div style={{
            padding: isMulti ? '5px 14px' : '3px 10px', borderRadius: 12,
            background: isPool ? '#e0e7ff' : '#f3f4f6',
            border: `1px solid ${isPool ? '#818cf8' : '#9ca3af'}`,
            fontSize: 13, fontWeight: isMulti ? 700 : 600,
            color: isPool ? '#3730a3' : '#374151',
          }}>
            {isMulti ? `${sel.size} lots` : dragLot.lot.lot_number}
          </div>
        )
      })()}
      {dragLot?.type === 'assigned-lot' && (
        <div style={{
          width: 148, borderRadius: 6,
          background: '#fff', border: '1px solid #E4E2DA',
          padding: '6px 8px', fontSize: 14, fontWeight: 700, color: '#2C2C2A',
          textAlign: 'center',
        }}>
          {shortLot(dragLot.assignment.lot_number)}
        </div>
      )}
    </DragOverlay>
  )
}
