// TDA context menu policy
// Pure helper: inputs in, items[] out.
// Caller is responsible for the null guard on detail before calling.

export function buildContextMenuItems(type, lotIds, detail, agreements, callbacks) {
  const {
    clearLotSelection,
    clearPoolLotSelection,
    clearAssignedLotSelection,
    addLotsToPool,
    removeLotsFromPool,
    assignLotsToCheckpoint,
    unassignLotFromCheckpoint,
    moveLotToOtherTda,
  } = callbacks

  const n = lotIds.length
  const label = n > 1 ? `${n} lots` : '1 lot'
  const tdaId = detail.tda_id
  const checkpoints = detail.checkpoints || []
  const otherTdas = agreements.filter(a => a.tda_id !== tdaId)
  const items = []

  if (type === 'unassigned') {
    items.push(
      { label: `Add ${label} to In Agreement`, onClick: () => { clearLotSelection(); addLotsToPool(tdaId, lotIds) } },
      { divider: true },
      ...checkpoints.map(cp => ({
        label: `Assign to ${cp.checkpoint_name}`,
        onClick: () => { clearLotSelection(); assignLotsToCheckpoint(tdaId, lotIds, cp.checkpoint_id) },
      })),
    )
  } else if (type === 'pool') {
    items.push(
      { label: `Remove ${label} from In Agreement`, danger: true, onClick: () => { clearPoolLotSelection(); removeLotsFromPool(tdaId, lotIds) } },
      { divider: true },
      ...checkpoints.map(cp => ({
        label: `Assign to ${cp.checkpoint_name}`,
        onClick: () => { clearPoolLotSelection(); assignLotsToCheckpoint(tdaId, lotIds, cp.checkpoint_id) },
      })),
    )
    if (otherTdas.length > 0) {
      items.push({ divider: true })
      otherTdas.forEach(tda => {
        items.push({
          label: `Move to ${tda.tda_name}`,
          onClick: async () => {
            clearPoolLotSelection()
            await Promise.all(lotIds.map(id => moveLotToOtherTda(tdaId, tda.tda_id, id, false)))
          },
        })
      })
    }
  } else { // assigned
    items.push(
      { label: `Move ${label} to In Agreement (keep in TDA)`, onClick: () => { clearAssignedLotSelection(); Promise.all(lotIds.map(id => unassignLotFromCheckpoint(tdaId, id))) } },
      { label: `Remove ${label} from TDA`, danger: true, onClick: () => { clearAssignedLotSelection(); removeLotsFromPool(tdaId, lotIds) } },
      { divider: true },
      ...checkpoints.map(cp => ({
        label: `Move to ${cp.checkpoint_name}`,
        onClick: () => { clearAssignedLotSelection(); assignLotsToCheckpoint(tdaId, lotIds, cp.checkpoint_id) },
      })),
    )
    if (otherTdas.length > 0) {
      items.push({ divider: true })
      otherTdas.forEach(tda => {
        items.push({
          label: `Move to ${tda.tda_name}`,
          onClick: async () => {
            clearAssignedLotSelection()
            await Promise.all(lotIds.map(id => moveLotToOtherTda(tdaId, tda.tda_id, id, true)))
          },
        })
      })
    }
  }

  return items
}
