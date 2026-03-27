// layoutEngine.js
// Self-compacting layout algorithm for instrument bands and dev containers.
// All constants are measured from the live UI — do not scatter as magic numbers.

export const PHASE_PILL_WIDTH    = 156   // px, fixed — never changes
export const LOT_PILL_HEIGHT     = 21    // px per lot row
export const LOT_PILL_GAP        = 4     // px gap between lot rows
export const LOTS_PER_ROW        = 3     // lot pills per row inside a phase
export const PHASE_HEADER_HEIGHT = 64    // px (name + slash line)
export const PHASE_EMPTY_HEIGHT  = 138   // px (no lots, or collapsed)
export const PHASE_PADDING       = 16    // px total vertical padding inside phase
export const INSTR_HEADER_HEIGHT = 63    // px
export const INSTR_PHASE_GAP     = 8     // px gap between phase pills
export const INSTR_PADDING       = 8     // px padding inside instrument band
export const DEV_HEADER_HEIGHT   = 28    // px
export const DEV_INSTR_GAP       = 8     // px gap between instrument bands
export const DEV_PADDING         = 8     // px padding inside dev container (each side)
export const DEV_ROW_GAP         = 16    // px gap between dev containers
export const LEFT_PANELS_WIDTH   = 340   // px (sidebar + unassigned panel)

// Height of a single phase pill given its lot count and expanded state.
export function phasePillHeight(lotCount, expanded) {
  if (!expanded) return PHASE_EMPTY_HEIGHT
  if (lotCount === 0) return PHASE_EMPTY_HEIGHT
  const rows = Math.ceil(lotCount / LOTS_PER_ROW)
  const lotGridH = rows * LOT_PILL_HEIGHT + (rows - 1) * LOT_PILL_GAP
  return PHASE_HEADER_HEIGHT + lotGridH + PHASE_PADDING
}

// Compute the optimal column count and dimensions for one instrument band.
// phases      = array of { phaseId, lotCount, expanded }
// availableWidth = full content area width (px)
// maxBandWidth   = optional hard cap on instrument band width (px).
//                  Defaults to availableWidth - DEV_PADDING * 2 (dev container horizontal padding).
// Returns { cols, rows, width, height, score }
export function computeInstrumentLayout(phases, availableWidth, maxBandWidth = null) {
  const maxWidth = maxBandWidth !== null ? maxBandWidth : availableWidth - DEV_PADDING * 2
  const phaseCount = phases.length

  if (phaseCount === 0) {
    const emptyW = Math.min(PHASE_PILL_WIDTH + INSTR_PADDING * 2, maxWidth)
    return {
      cols: 1,
      rows: 0,
      width: emptyW,
      height: INSTR_HEADER_HEIGHT + INSTR_PADDING * 2 + 80,
      score: Infinity,
    }
  }

  let bestLayout = null

  for (let cols = 1; cols <= phaseCount; cols++) {
    const bandWidth =
      cols * PHASE_PILL_WIDTH + (cols - 1) * INSTR_PHASE_GAP + INSTR_PADDING * 2
    if (bandWidth > maxWidth) break

    const rows = Math.ceil(phaseCount / cols)
    let contentH = 0

    for (let r = 0; r < rows; r++) {
      const rowPhases = phases.slice(r * cols, (r + 1) * cols)
      const rowH = Math.max(...rowPhases.map((p) => phasePillHeight(p.lotCount, p.expanded)))
      contentH += rowH
      if (r < rows - 1) contentH += INSTR_PHASE_GAP
    }

    const totalH = INSTR_HEADER_HEIGHT + contentH + INSTR_PADDING * 2

    // Minimize height first, then width as tiebreaker
    const score = totalH * 100000 + bandWidth

    if (!bestLayout || score < bestLayout.score) {
      bestLayout = { cols, rows, width: bandWidth, height: totalH, score }
    }
  }

  // Fallback: available width too narrow — stack all phases in 1 column
  if (!bestLayout) {
    const bandWidth = PHASE_PILL_WIDTH + INSTR_PADDING * 2
    const rows = phaseCount
    let contentH = 0
    for (let r = 0; r < rows; r++) {
      contentH += phasePillHeight(phases[r].lotCount, phases[r].expanded)
      if (r < rows - 1) contentH += INSTR_PHASE_GAP
    }
    const totalH = INSTR_HEADER_HEIGHT + contentH + INSTR_PADDING * 2
    bestLayout = { cols: 1, rows, width: bandWidth, height: totalH, score: totalH * 100000 + bandWidth }
  }

  return bestLayout
}

// ─── Private helpers ────────────────────────────────────────────────────────

// Simulate left-to-right greedy packing of instrument bands into rows.
// Returns array of rows; each row is an array of indices into `layouts`.
function packIntoRows(layouts, packingMaxWidth) {
  const rows = []
  let currentRow = []
  let currentW = 0

  for (let i = 0; i < layouts.length; i++) {
    const gap = currentW > 0 ? DEV_INSTR_GAP : 0
    if (currentW > 0 && currentW + gap + layouts[i].width > packingMaxWidth) {
      rows.push(currentRow)
      currentRow = [i]
      currentW = layouts[i].width
    } else {
      currentRow.push(i)
      currentW += gap + layouts[i].width
    }
  }
  if (currentRow.length > 0) rows.push(currentRow)
  return rows
}

// Total instrument content height for a given set of layouts (excludes dev header/padding).
function devContentHeight(layouts, packingMaxWidth) {
  let rowW = 0
  let rowH = 0
  let total = 0

  for (const layout of layouts) {
    const gap = rowW > 0 ? DEV_INSTR_GAP : 0
    if (rowW > 0 && rowW + gap + layout.width > packingMaxWidth) {
      total += rowH + DEV_INSTR_GAP
      rowW = layout.width
      rowH = layout.height
    } else {
      rowW += gap + layout.width
      rowH = Math.max(rowH, layout.height)
    }
  }
  return total + rowH
}

// ─── Public API ─────────────────────────────────────────────────────────────

// Compute optimal layout for all instrument bands in a dev container,
// accounting for sibling instruments that share the same row.
//
// instrumentPhaseSets = array of phase arrays (one per instrument),
//   each element is array of { phaseId, lotCount, expanded }
// availableWidth = full content area width (px)
//
// Returns { width, height, instrumentLayouts }
// where instrumentLayouts[i] = { cols, rows, width, height, score }
export function computeDevLayout(instrumentPhaseSets, availableWidth) {
  if (instrumentPhaseSets.length === 0) {
    return {
      width: PHASE_PILL_WIDTH + DEV_PADDING * 2,
      height: DEV_HEADER_HEIGHT + DEV_PADDING * 2 + 80,
      instrumentLayouts: [],
    }
  }

  const packingMaxWidth = availableWidth - DEV_PADDING * 2

  // Step 1: compute unconstrained layouts (each band may use full width)
  let layouts = instrumentPhaseSets.map((phases) =>
    computeInstrumentLayout(phases, availableWidth)
  )

  // Step 2: iteratively narrow lone instruments to encourage row-sharing
  let improved = true
  while (improved) {
    improved = false
    const rows = packIntoRows(layouts, packingMaxWidth)

    for (const row of rows) {
      // Only target instruments that are alone on a row AND have siblings
      if (row.length !== 1 || instrumentPhaseSets.length < 2) continue

      const loneIdx = row[0]
      const siblingWidths = layouts
        .filter((_, i) => i !== loneIdx)
        .map((l) => l.width)
      const widestSibling = Math.max(...siblingWidths)

      // Target: lone instrument width + gap + widest sibling ≤ packingMaxWidth
      const targetMaxBand = packingMaxWidth - widestSibling - DEV_INSTR_GAP

      // Skip if target is impossible or the instrument is already narrow enough
      if (targetMaxBand <= 0 || layouts[loneIdx].width <= targetMaxBand) continue

      const tighter = computeInstrumentLayout(
        instrumentPhaseSets[loneIdx],
        availableWidth,
        targetMaxBand
      )

      // Accept only if overall dev content height does not increase
      const oldH = devContentHeight(layouts, packingMaxWidth)
      const candidate = [...layouts]
      candidate[loneIdx] = tighter
      const newH = devContentHeight(candidate, packingMaxWidth)

      if (newH <= oldH) {
        layouts = candidate
        improved = true
        break // restart with updated layouts
      }
    }
  }

  // Compute final dev container dimensions
  let rowW = 0
  let rowH = 0
  let totalH = DEV_HEADER_HEIGHT + DEV_PADDING * 2
  let maxActualRowW = 0

  for (const layout of layouts) {
    const gap = rowW > 0 ? DEV_INSTR_GAP : 0
    if (rowW > 0 && rowW + gap + layout.width > packingMaxWidth) {
      maxActualRowW = Math.max(maxActualRowW, rowW)
      totalH += rowH + DEV_INSTR_GAP
      rowW = layout.width
      rowH = layout.height
    } else {
      rowW += gap + layout.width
      rowH = Math.max(rowH, layout.height)
    }
  }
  totalH += rowH
  maxActualRowW = Math.max(maxActualRowW, rowW)

  return {
    width: maxActualRowW + DEV_PADDING * 2,
    height: totalH,
    instrumentLayouts: layouts,
  }
}
