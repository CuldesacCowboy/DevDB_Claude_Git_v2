// TDA domain utilities — pure functions, no React dependency.

// ── Format date for display ───────────────────────────────────────
export function fmt(dateStr) {
  if (!dateStr) return '—'
  const [y, m, d] = dateStr.split('-')
  return `${m}/${d}/${y.slice(2)}`
}

// ── Short lot number: "ST00000064" → "ST_ 64" ──────────────────────────────
// XX = dev code, _ = separator, NNN = 3-char right-justified (non-breaking spaces).
export function shortLot(lotNumber) {
  if (!lotNumber) return '—'
  const match = lotNumber.match(/^([A-Za-z]+|\d{2})0*(\d+)$/)
  if (!match) return lotNumber
  const numStr = String(parseInt(match[2], 10))
  const pad = '\u00a0'.repeat(Math.max(0, 3 - numStr.length))
  return `${match[1]}\u00a0${pad}${numStr}`
}

// ── Parse lot into { code, seq } ─────────────────────────────────
// seq is 3-char right-justified with non-breaking spaces (no leading zeros).
export function parseLot(lotNumber) {
  if (!lotNumber) return { code: '—', seq: '—' }
  const match = lotNumber.match(/^([A-Za-z]+|\d{2})0*(\d+)$/)
  if (!match) return { code: lotNumber, seq: '' }
  const numStr = String(parseInt(match[2], 10))
  const pad = '\u00a0'.repeat(Math.max(0, 3 - numStr.length))
  return { code: match[1], seq: `${pad}${numStr}` }
}

// ── Group lots by building_group_id, preserving first-appearance order ─
// Returns [{type:'solo', lot}] or [{type:'group', bgId, lots:[...]}]
export function buildClusters(lots) {
  const clusters = []
  const bgMap = new Map()  // bgId -> index in clusters array
  for (const lot of lots) {
    const bgId = lot.building_group_id
    if (bgId != null) {
      if (bgMap.has(bgId)) {
        clusters[bgMap.get(bgId)].lots.push(lot)
      } else {
        bgMap.set(bgId, clusters.length)
        clusters.push({ type: 'group', bgId, lots: [lot] })
      }
    } else {
      clusters.push({ type: 'solo', lot })
    }
  }
  return clusters
}
