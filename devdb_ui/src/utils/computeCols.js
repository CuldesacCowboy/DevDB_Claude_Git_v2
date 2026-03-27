// computeCols.js
// Determines the optimal column count for an instrument band so CSS flex-wrap
// produces the shortest possible layout for the given available width.
//
// Phase pill width is 160px (set by PhaseColumn inline style).
// instrWidth(N) = N * 160 + (N-1) * 8 + 16  =  N * 168 + 8
// This is the exact container width needed so that exactly N pills fit per row.

export function computeCols(phaseCount, availableWidth, expanded, phases) {
  const PILL_W = 160
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

  let bestCols = minCols
  let bestHeight = Infinity

  for (let cols = minCols; cols <= maxCols; cols++) {
    const rows = Math.ceil(phaseCount / cols)
    let totalH = 0
    for (let r = 0; r < rows; r++) {
      const rowPhases = phases.slice(r * cols, (r + 1) * cols)
      const maxLots = Math.max(...rowPhases.map((p) => p.lotCount || 0))
      const phaseH =
        expanded && maxLots > 0
          ? 64 +
            Math.ceil(maxLots / 3) * 21 +
            (Math.ceil(maxLots / 3) - 1) * 4 +
            16
          : 138
      totalH += phaseH + (r < rows - 1 ? GAP : 0)
    }
    if (totalH < bestHeight) {
      bestHeight = totalH
      bestCols = cols
    }
  }

  return { cols: bestCols, width: instrWidth(bestCols) }
}
