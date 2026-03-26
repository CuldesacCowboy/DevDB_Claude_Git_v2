import { useDroppable } from '@dnd-kit/core'
import PhaseColumn from './PhaseColumn'

// Color tints cycle by dev_id across the ent_group.
// Keys are dev_ids; unknown devs get the last color.
const DEV_TINTS = [
  { border: 'border-blue-200',   bg: 'bg-blue-50',   header: 'bg-blue-100',   text: 'text-blue-800' },
  { border: 'border-teal-200',   bg: 'bg-teal-50',   header: 'bg-teal-100',   text: 'text-teal-800' },
  { border: 'border-violet-200', bg: 'bg-violet-50', header: 'bg-violet-100', text: 'text-violet-800' },
  { border: 'border-green-200',  bg: 'bg-green-50',  header: 'bg-green-100',  text: 'text-green-800' },
]

// Map sorted unique dev_ids to tint index so color is stable across re-renders.
export function buildDevColorMap(devIds) {
  const sorted = [...new Set(devIds)].sort((a, b) => a - b)
  const map = {}
  sorted.forEach((id, idx) => {
    map[id] = DEV_TINTS[idx % DEV_TINTS.length]
  })
  return map
}

// instrument = null → "No instrument" container
export default function InstrumentContainer({
  instrument,   // { instrument_id, instrument_name, instrument_type, dev_id, dev_name, phases }
                // or null for the "No instrument" container
  phases,       // phases array (for null instrument case)
  tint,         // { border, bg, header, text } — from buildDevColorMap, or gray for null
  pendingLotId,
  pendingPhaseId,
  activeDragType,   // 'lot' | 'phase' | null
}) {
  const isNoInstrument = instrument === null
  const droppableId = isNoInstrument ? 'instrument-null' : `instrument-${instrument.instrument_id}`
  const phasesData = isNoInstrument ? phases : instrument.phases

  const { isOver, setNodeRef } = useDroppable({
    id: droppableId,
    data: {
      type: 'instrument-target',
      instrumentId: isNoInstrument ? null : instrument.instrument_id,
      instrumentName: isNoInstrument ? 'No instrument' : instrument.instrument_name,
    },
  })

  // Only show drop highlight when a phase is being dragged
  const showPhaseDropHighlight = isOver && activeDragType === 'phase'

  const containerTint = isNoInstrument
    ? { border: 'border-gray-300', bg: 'bg-gray-50', header: 'bg-gray-100', text: 'text-gray-700' }
    : tint

  return (
    <div
      ref={setNodeRef}
      className={`
        flex flex-col rounded-xl border-2 transition-colors duration-100 flex-shrink-0
        ${containerTint.bg}
        ${showPhaseDropHighlight ? 'border-blue-400 border-dashed' : containerTint.border}
        ${isNoInstrument ? 'border-dashed' : ''}
      `}
    >
      {/* Container header */}
      <div className={`px-3 py-2 rounded-t-xl border-b ${containerTint.border} ${containerTint.header}`}>
        {isNoInstrument ? (
          <p className="font-semibold text-sm text-gray-500 italic">No instrument assigned</p>
        ) : (
          <div className="flex items-center gap-2 flex-wrap">
            <p className={`font-bold text-sm ${containerTint.text}`}>{instrument.instrument_name}</p>
            <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded ${containerTint.header} border ${containerTint.border} ${containerTint.text}`}>
              {instrument.instrument_type}
            </span>
            <span className="text-[11px] text-gray-400 ml-auto">{instrument.dev_name}</span>
          </div>
        )}
      </div>

      {/* Phase columns */}
      <div className="flex gap-2 p-2 min-w-fit">
        {phasesData.length > 0 ? (
          phasesData.map((phase) => (
            <PhaseColumn
              key={phase.phase_id}
              phase={phase}
              pendingLotId={pendingLotId}
              pendingPhaseId={pendingPhaseId}
            />
          ))
        ) : (
          <div className="min-w-[180px] flex items-center justify-center min-h-[80px]">
            <p className="text-[11px] text-gray-400 italic">
              {showPhaseDropHighlight ? 'Drop phase here' : 'No phases'}
            </p>
          </div>
        )}
      </div>
    </div>
  )
}
