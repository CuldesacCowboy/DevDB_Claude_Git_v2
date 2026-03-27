import { useState, useRef } from 'react'
import { useDroppable } from '@dnd-kit/core'
import LotCard from './LotCard'

export default function LotTypePill({
  phaseId,
  lotTypeId,
  lotTypeShort,
  actual,
  projected,
  total,
  lots,            // LotDetail[] already filtered to this lotTypeId
  onProjectedEdit, // callback(phaseId, lotTypeId, newValue)
  pendingLotId,
  isOverlay,
  phaseColor,      // reserved for future tinting — unused for now
}) {
  const { setNodeRef, isOver } = useDroppable({
    id: `lot-type-${phaseId}-${lotTypeId}`,
    data: { type: 'lot-target', phase: { phase_id: phaseId }, lotTypeId },
    disabled: !!isOverlay,
  })

  const [editing, setEditing]   = useState(false)
  const [inputVal, setInputVal] = useState('')
  const [flash, setFlash]       = useState(false)
  const cancelRef               = useRef(false)

  function startEdit(e) {
    if (isOverlay) return
    e.stopPropagation()
    setInputVal(String(projected))
    setEditing(true)
  }

  function confirmEdit() {
    if (cancelRef.current) {
      cancelRef.current = false
      return
    }
    const val = parseInt(inputVal, 10)
    setEditing(false)
    if (isNaN(val) || val < 0 || val === projected) return
    onProjectedEdit?.(phaseId, lotTypeId, val)
  }

  const tempCount = Math.max(0, projected - actual)

  return (
    <div
      style={{
        border: `1px solid ${isOver ? '#93c5fd' : '#e5e7eb'}`,
        borderRadius: 4,
        background: isOver ? '#eff6ff' : 'white',
        marginBottom: 4,
        transition: 'border-color 0.1s, background 0.1s',
      }}
    >
      {/* Header row */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          padding: '2px 4px',
          borderBottom: '1px solid #f3f4f6',
        }}
        onPointerDown={(e) => e.stopPropagation()}
      >
        {/* Left: lot type label */}
        <span style={{ fontSize: 11, fontWeight: 600, color: '#4b5563' }}>
          {lotTypeShort ?? `t${lotTypeId}`}
        </span>

        {/* Right: slash line with editable p */}
        <span style={{ fontSize: 10, color: '#9ca3af', display: 'flex', alignItems: 'center', gap: 2 }}>
          <span style={{ fontWeight: 500, color: '#374151' }}>{actual}</span>r
          {' / '}
          {editing ? (
            <input
              autoFocus
              type="text"
              value={inputVal}
              onFocus={(e) => e.target.select()}
              onChange={(e) => setInputVal(e.target.value.replace(/\D/g, ''))}
              onKeyDown={(e) => {
                if (e.key === 'Escape') {
                  cancelRef.current = true
                  setEditing(false)
                }
                if (e.key === 'Enter') e.target.blur()
              }}
              onBlur={confirmEdit}
              onClick={(e) => e.stopPropagation()}
              style={{
                width: Math.max(2, inputVal.length) + 'ch',
                minWidth: '2ch',
                border: 'none',
                background: 'transparent',
                outline: 'none',
                font: 'inherit',
                textAlign: 'center',
                color: '#374151',
                fontWeight: 500,
                cursor: 'text',
              }}
            />
          ) : (
            <span
              onClick={startEdit}
              style={{
                border: `1px solid ${flash ? '#ef4444' : '#93c5fd'}`,
                background: flash ? '#fef2f2' : '#eff6ff',
                borderRadius: 3,
                padding: '0 3px',
                cursor: 'pointer',
                lineHeight: 1.5,
                fontWeight: 500,
                color: '#374151',
                display: 'inline-block',
              }}
              title="Click to edit projected count"
            >
              {projected}
            </span>
          )}
          p{' / '}
          <span style={{ fontWeight: 500, color: '#4b5563' }}>{total}</span>t
        </span>
      </div>

      {/* Droppable lot grid */}
      <div
        ref={setNodeRef}
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(3, 50px)',
          gridAutoRows: '24px',
          gap: 4,
          padding: 4,
          width: 'fit-content',
          margin: '0 auto',
          minHeight: 32,
        }}
      >
        {lots.map((lot) => (
          <LotCard
            key={lot.lot_id}
            lot={lot}
            isPending={pendingLotId === lot.lot_id}
          />
        ))}
        {Array.from({ length: tempCount }).map((_, i) => (
          <div
            key={`temp-${i}`}
            style={{
              width: 50,
              height: 24,
              borderRadius: 4,
              border: '1.5px dashed #d1d5db',
              background: 'transparent',
            }}
          />
        ))}
        {lots.length === 0 && tempCount === 0 && !isOver && (
          <p
            style={{ gridColumn: '1 / -1', fontSize: 11, color: '#9ca3af', fontStyle: 'italic', textAlign: 'center', margin: '2px 0' }}
          >
            empty
          </p>
        )}
      </div>
    </div>
  )
}
