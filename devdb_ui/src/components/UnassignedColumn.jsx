import { useMemo } from 'react'
import { useDroppable } from '@dnd-kit/core'
import LotCard, { BuildingGroupCard } from './LotCard'

// Unassigned Lots panel — full-height sticky column with internal scroll.
// Lots here have phase_id: null in local state.
export default function UnassignedColumn({ lots, pendingLotId }) {
  const { isOver, setNodeRef } = useDroppable({
    id: 'unassigned',
    data: { type: 'unassigned' },
  })

  // Group building group lots into single entries; individual lots stay as-is
  const lotItems = useMemo(() => {
    const groups = {}
    const items = []
    for (const lot of lots) {
      if (lot.building_group_id != null) {
        if (!groups[lot.building_group_id]) groups[lot.building_group_id] = []
        groups[lot.building_group_id].push(lot)
      } else {
        items.push({ kind: 'lot', lot })
      }
    }
    for (const [bgId, grpLots] of Object.entries(groups)) {
      items.push({ kind: 'building-group', lots: grpLots, building_group_id: Number(bgId) })
    }
    // Sort: individual lots by lot_number; building groups by first lot_number
    return items.sort((a, b) => {
      const aKey = a.kind === 'lot' ? (a.lot.lot_number ?? '') : (a.lots[0]?.lot_number ?? '')
      const bKey = b.kind === 'lot' ? (b.lot.lot_number ?? '') : (b.lots[0]?.lot_number ?? '')
      return aKey.localeCompare(bKey)
    })
  }, [lots])

  return (
    <div
      ref={setNodeRef}
      className={`
        flex flex-col h-full rounded-none border-0 overflow-hidden
        transition-colors w-full
        ${isOver ? 'bg-blue-50' : 'bg-gray-50'}
      `}
    >
      {/* Header */}
      <div className={`px-3 py-2 border-b flex-shrink-0 ${isOver ? 'border-blue-300 bg-blue-100' : 'border-gray-200 bg-gray-100'}`}>
        <p className={`font-bold text-sm ${isOver ? 'text-blue-900' : 'text-gray-700'}`}>
          Unassigned Lots
        </p>
        <p className={`text-[11px] mt-0.5 ${isOver ? 'text-blue-600' : 'text-gray-400'}`}>
          {lots.length > 0 ? `${lots.length} lot${lots.length === 1 ? '' : 's'}` : 'empty'}
          {lotItems.some((i) => i.kind === 'building-group') && (
            <span className="ml-1 text-cyan-500">
              ({lotItems.filter((i) => i.kind === 'building-group').length} bldg)
            </span>
          )}
        </p>
      </div>

      {/* Lot cards — scrollable list */}
      <div className="flex-1 overflow-y-auto flex flex-col gap-1 p-2 min-h-0">
        {lotItems.length > 0 ? (
          lotItems.map((item) =>
            item.kind === 'building-group' ? (
              <BuildingGroupCard
                key={`bg-${item.building_group_id}`}
                lots={item.lots}
                isPending={item.lots.some((l) => l.lot_id === pendingLotId)}
                listView
              />
            ) : (
              <LotCard
                key={item.lot.lot_id}
                lot={item.lot}
                isPending={pendingLotId === item.lot.lot_id}
                listView
              />
            )
          )
        ) : (
          <p className={`text-[11px] italic text-center mt-2 ${isOver ? 'text-blue-600' : 'text-gray-400'}`}>
            {isOver ? 'Drop to unassign' : 'All lots assigned'}
          </p>
        )}
      </div>
    </div>
  )
}
