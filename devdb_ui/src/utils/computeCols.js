// computeCols.js
// Determines the optimal column count for an instrument band so CSS flex-wrap
// produces the most compact (minimum bounding-box area) layout for the given
// available width.
//
// Phase pill width is 187px.
// Lot grid: 3 × 50px + 2 × 4px gaps + 4px padding each side = 166px content.
// LotTypePill border (1px each side = 2px) + LotTypeContainer px-2 (8px each side = 16px) + phase border (2×1.25px) → 187px total.
// instrWidth(N) = N * 187 + (N-1) * 8 + 16 + 2.5
// This is the exact container width needed so that exactly N pills fit per row.

export function computeCols(phaseCount, availableWidth, expanded, phases, relaxCap = false) {
  const PILL_W = 187
  const GAP = 8
  const PADDING = 16
  const BAND_BORDER = 2.5
  const instrWidth = (n) => n * PILL_W + (n - 1) * GAP + PADDING + BAND_BORDER

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
  // ceil(sqrt(phaseCount * 1.5)) keeps small counts at 2-3 cols proportional.
  // relaxCap=true (solo dev on its row) skips the sqrt cap so all phases can
  // spread into one row when there is ample space.
  const maxColsCapped = relaxCap
    ? maxCols
    : Math.min(maxCols, Math.ceil(Math.sqrt(phaseCount * 1.5)))

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

// Computes per-phase { phaseId, width, height } for equalized pill layout within one band.
//
// Pass 1 — Orphan lateral expansion:
//   Pills in the last row (if that row is incomplete) expand to fill the full content width.
//
// Pass 2 — Column height equalization:
//   For each column, compute total natural height. Pad shorter columns so all columns
//   share the same total height (extra px distributed evenly across that column's pills).
//
// Single-orphan vertical equalization:
//   When the last row has exactly 1 pill, match its height to col0's total.
//
// phases: array of { phase_id, lotCount, isCollapsed }
// cols:   column count from computeCols
// instrWidth: band CSS width from computeCols
// gap:    px between pills (default 8)
// padding: total horizontal padding inside phase row (default 16)
export function computePhaseDimensions(phases, cols, instrWidth, gap = 8, padding = 16) {
  const BAND_BORDER = 2.5
  const PILL_W = 187

  function naturalH(lotCount, isCollapsed) {
    if (isCollapsed || lotCount === 0) return 138
    const lotRows = Math.ceil(lotCount / 3)
    // +22 accounts for the lot-count label line rendered above the grid (calibrated to DOM: 223px for 14 lots)
    return 64 + lotRows * 21 + (lotRows - 1) * 4 + 16 + 22
  }

  const phaseCount = phases.length
  if (phaseCount === 0) return []

  const rows = Math.ceil(phaseCount / cols)
  const lastRowCount = phaseCount - (rows - 1) * cols
  const isOrphanRow = lastRowCount < cols

  // Pass 1: widths
  const contentW = instrWidth - BAND_BORDER - padding
  const orphanPillW = isOrphanRow
    ? (contentW - (lastRowCount - 1) * gap) / lastRowCount
    : PILL_W

  const widths = phases.map((_, i) => {
    const rowIdx = Math.floor(i / cols)
    return isOrphanRow && rowIdx === rows - 1 ? orphanPillW : PILL_W
  })

  // Pass 2: column height equalization (non-orphan rows only)
  const naturalHeights = phases.map((p) => naturalH(p.lotCount || 0, p.isCollapsed ?? false))
  const adjustedHeights = [...naturalHeights]

  const nonOrphanCount = isOrphanRow ? phaseCount - lastRowCount : phaseCount
  const nonOrphanRowCount = isOrphanRow ? rows - 1 : rows

  const colPhaseIndices = Array.from({ length: cols }, (_, c) => {
    const indices = []
    for (let r = 0; r < nonOrphanRowCount; r++) {
      const idx = r * cols + c
      if (idx < nonOrphanCount) indices.push(idx)
    }
    return indices
  })

  const colHeights = colPhaseIndices.map((indices) =>
    indices.length === 0
      ? 0
      : indices.reduce((sum, idx) => sum + naturalHeights[idx], 0) + (indices.length - 1) * gap
  )

  const maxColH = colHeights.length > 0 ? Math.max(...colHeights) : 0

  for (let c = 0; c < cols; c++) {
    const deficit = maxColH - colHeights[c]
    if (deficit > 0 && colPhaseIndices[c].length > 0) {
      const extraPerPill = deficit / colPhaseIndices[c].length
      for (const idx of colPhaseIndices[c]) {
        adjustedHeights[idx] += extraPerPill
      }
    }
  }

  // Orphan pills are exempt from vertical equalization — they keep their natural height.
  // (Lateral expansion was already handled in Pass 1.)

  return phases.map((phase, i) => ({
    phaseId: phase.phase_id,
    width: widths[i],
    // Only return an explicit height when equalization raised the pill above its natural height.
    // Pills at natural height get null so CSS alignSelf:stretch handles distribution instead.
    height: adjustedHeights[i] > naturalHeights[i] + 0.01 ? adjustedHeights[i] : null,
  }))
}
