// TDA domain utilities — pure functions, no React dependency.

// ── Format date for display ───────────────────────────────────────
export function fmt(dateStr) {
  if (!dateStr) return '—'
  const [y, m, d] = dateStr.split('-')
  return `${m}/${d}/${y.slice(2)}`
}

// ── Short lot number: "WS00000001" → "WS · 001", "4300000001" → "43 · 001" ──
export function shortLot(lotNumber) {
  if (!lotNumber) return '—'
  const match = lotNumber.match(/^([A-Za-z]+|\d{2})0*(\d+)$/)
  if (!match) return lotNumber
  const seq = parseInt(match[2], 10)
  return `${match[1]} · ${String(seq).padStart(3, '0')}`
}

// ── Parse lot into { code, seq } ─────────────────────────────────
export function parseLot(lotNumber) {
  if (!lotNumber) return { code: '—', seq: '—' }
  const match = lotNumber.match(/^([A-Za-z]+|\d{2})0*(\d+)$/)
  if (!match) return { code: lotNumber, seq: '' }
  return { code: match[1], seq: String(parseInt(match[2], 10)).padStart(3, '0') }
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
