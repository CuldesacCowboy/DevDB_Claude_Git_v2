// computeCols.js
// Determines the optimal column count for an instrument band so CSS flex-wrap
// produces the most compact (minimum bounding-box area) layout for the given
// available width.
//
// Phase pill width is 160px (set by PhaseColumn inline style).
// instrWidth(N) = N * 160 + (N-1) * 8 + 16  =  N * 168 + 8
// This is the exact container width needed so that exactly N pills fit per row.

export function computeCols(phaseCount, availableWidth, expanded, phases) {
  const PILL_W = 158
  const GAP = 8
  const PADDING = 16
  const instrWidth = (n) => n * PILL_W + (n - 1) * GAP + PADDING

  // Never fewer than 2 cols (unless only 1 phase), never more cols than phases
  const minCols = Math.min(2, phaseCount)
  const maxCols = Math.min(
    phaseCount,
    Math.floor((availableWidth - PADDING + GAP) / (PILL_W + GAP))
  )

  // If nothing fits at minCols, fall back to 1-column (narrow viewport)
  if (maxCols < minCols) {
    return { cols: 1, width: instrWidth(1) }
  }

  // Cap columns to prevent excessively wide single-row layouts.
  // ceil(sqrt(phaseCount * 1.5)) keeps small counts at 2-3 cols and larger
  // counts proportional without forcing a single-row result.
  const maxColsCapped = Math.min(maxCols, Math.ceil(Math.sqrt(phaseCount * 1.5)))

  let bestCols = minCols
  let bestArea = Infinity

  for (let cols = minCols; cols <= maxColsCapped; cols++) {
    const w = instrWidth(cols)
    const rows = Math.ceil(phaseCount / cols)

    let contentH = 0
    for (let r = 0; r < rows; r++) {
      const rowPhases = phases.slice(r * cols, (r + 1) * cols)
      const maxLots = Math.max(...rowPhases.map((p) => p.lotCount || 0))
      const phaseH =
        expanded && maxLots > 0
          ? 64 + Math.ceil(maxLots / 3) * 21 + (Math.ceil(maxLots / 3) - 1) * 4 + 16
          : 138
      contentH += phaseH + (r < rows - 1 ? GAP : 0)
    }

    const area = w * contentH
    if (area < bestArea) {
      bestArea = area
      bestCols = cols
    }
  }

  return { cols: bestCols, width: instrWidth(bestCols) }
}
