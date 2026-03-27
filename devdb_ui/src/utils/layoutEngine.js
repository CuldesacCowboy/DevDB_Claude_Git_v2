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
export const DEV_PADDING         = 8     // px padding inside dev container
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
// phases = array of { phaseId, lotCount, expanded }
// Returns { cols, rows, width, height, fillRatio }
export function computeInstrumentLayout(phases, availableWidth) {
  const maxWidth = availableWidth - DEV_PADDING * 2
  const phaseCount = phases.length

  if (phaseCount === 0) {
    const emptyW = Math.min(PHASE_PILL_WIDTH + INSTR_PADDING * 2, maxWidth)
    return {
      cols: 1,
      rows: 0,
      width: emptyW,
      height: INSTR_HEADER_HEIGHT + INSTR_PADDING * 2 + 80,
      fillRatio: 0,
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

// Simulate packing instrument bands left-to-right with wrapping.
// instruments = array of { width, height } from computeInstrumentLayout
// Returns { width, height } of the dev container.
export function computeDevLayout(instruments, availableWidth) {
  if (instruments.length === 0) {
    return {
      width: PHASE_PILL_WIDTH + DEV_PADDING * 2,
      height: DEV_HEADER_HEIGHT + DEV_PADDING * 2 + 80,
    }
  }

  const maxWidth = availableWidth - DEV_PADDING * 2
  let rowW = 0
  let rowH = 0
  let totalH = DEV_HEADER_HEIGHT + DEV_PADDING * 2
  let maxActualRowW = 0

  for (const instr of instruments) {
    const gap = rowW > 0 ? DEV_INSTR_GAP : 0
    if (rowW > 0 && rowW + gap + instr.width > maxWidth) {
      // Wrap to next row
      maxActualRowW = Math.max(maxActualRowW, rowW)
      totalH += rowH + DEV_INSTR_GAP
      rowW = instr.width
      rowH = instr.height
    } else {
      rowW += gap + instr.width
      rowH = Math.max(rowH, instr.height)
    }
  }
  totalH += rowH
  maxActualRowW = Math.max(maxActualRowW, rowW)

  return { width: maxActualRowW + DEV_PADDING * 2, height: totalH }
}
