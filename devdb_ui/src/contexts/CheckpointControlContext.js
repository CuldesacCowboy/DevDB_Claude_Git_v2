// contexts/CheckpointControlContext.js
// Provides master display/sort controls to all CheckpointBand instances
// in TakedownAgreementsView without prop drilling.
//
// Value shape:
//   { masterShowLots, masterCondensed, masterShowTimeline, masterShowDig,
//     masterDateDir, masterDateSeq, masterUnitDir, masterUnitSeq }

import { createContext, useContext } from 'react'

export const CheckpointControlContext = createContext(null)

export function useCheckpointControls() {
  return useContext(CheckpointControlContext)
}
