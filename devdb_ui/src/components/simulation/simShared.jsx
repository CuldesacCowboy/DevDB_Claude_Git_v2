// ─── Column definitions ──────────────────────────────────────────────────────

export const EVENT_COLS   = ['ent_plan','dev_plan','td_plan','str_plan','cmp_plan','cls_plan']
export const PLAN_LABELS  = { ent_plan:'ENT', dev_plan:'DEV', td_plan:'TD', str_plan:'STR', cmp_plan:'CMP', cls_plan:'CLS' }
export const STATUS_COLS  = ['p_end','e_end','d_end','h_end','u_end','uc_end','c_end']
export const STATUS_LABELS = { p_end:'P', e_end:'E', d_end:'D', h_end:'H', u_end:'U', uc_end:'UC', c_end:'C' }
export const SPEC_SPLIT_COLS = ['str_plan_spec', 'str_plan_build']
export const FLOOR_KEYS   = ['min_p_count','min_e_count','min_d_count','min_u_count','min_uc_count','min_c_count']
export const FLOOR_STATUS = { min_p_count:'p_end', min_e_count:'e_end', min_d_count:'d_end',
                               min_u_count:'u_end', min_uc_count:'uc_end', min_c_count:'c_end' }
export const FLOOR_LABELS = { min_p_count:'P', min_e_count:'E', min_d_count:'D',
                               min_u_count:'U', min_uc_count:'UC', min_c_count:'C' }
export const ACTIVE_FLOOR_KEYS   = ['min_d_count','min_u_count','min_uc_count','min_c_count']
export const ACTIVE_FLOOR_LABELS = { min_d_count:'Developed', min_u_count:'Unstarted', min_uc_count:'Under const.', min_c_count:'Completed' }
export const NUMERIC_COLS = [...EVENT_COLS, ...STATUS_COLS, ...SPEC_SPLIT_COLS]

// ─── Helpers ─────────────────────────────────────────────────────────────────

export function exportToCsv(filename, headers, rows) {
  const escape = v => {
    if (v == null) return ''
    const s = String(v)
    return s.includes(',') || s.includes('"') || s.includes('\n') ? `"${s.replace(/"/g, '""')}"` : s
  }
  const lines = [headers.map(escape).join(',')]
  for (const row of rows) lines.push(row.map(escape).join(','))
  const blob = new Blob([lines.join('\r\n')], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url; a.download = filename; a.click()
  URL.revokeObjectURL(url)
}

export function fmt(iso) {
  if (!iso) return ''
  return new Date(iso + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', year: '2-digit' })
}

export function periodKey(iso, period) {
  const [y, m] = iso.split('-').map(Number)
  if (period === 'annual')    return `${y}`
  if (period === 'quarterly') return `${y}-Q${Math.ceil(m / 3)}`
  return iso
}

export function periodLabel(key, period) {
  if (period === 'annual')    return `'${key.slice(2)}`
  if (period === 'quarterly') {
    const [y, q] = key.split('-')
    return `${q} '${y.slice(2)}`
  }
  if (period === 'weekly') {
    // key = "YYYY-MM-W1" … "YYYY-MM-W4"
    const [y, m, w] = key.split('-')
    return `${w} ${fmt(`${y}-${m}`)}`
  }
  return fmt(key)
}

/** Collapse raw API rows into one row per period, compute p_end and cumulative closed. */
export function buildLedgerRows(rawRows, selectedDevIds, period, ledgerStartDate, utilization) {
  const filtered = selectedDevIds === null
    ? rawRows
    : rawRows.filter(r => selectedDevIds.includes(r.dev_id))

  const monthMap = new Map()
  for (const r of filtered) {
    const key = r.calendar_month
    if (!monthMap.has(key)) {
      monthMap.set(key, { calendar_month: key })
      for (const col of NUMERIC_COLS) monthMap.get(key)[col] = 0
    }
    const agg = monthMap.get(key)
    for (const col of NUMERIC_COLS) agg[col] += (r[col] || 0)
  }

  let sorted = [...monthMap.values()].sort((a, b) => a.calendar_month.localeCompare(b.calendar_month))

  if (ledgerStartDate) {
    sorted = sorted.filter(r => r.calendar_month >= ledgerStartDate)
  }

  const filteredUtil = utilization
    ? (selectedDevIds === null ? utilization : utilization.filter(u => selectedDevIds.includes(u.dev_id)))
    : []
  const totalPlannedLots = filteredUtil.reduce((s, u) => s + (u.total_count || 0), 0)
  if (totalPlannedLots > 0) {
    let entitledSoFar = 0
    for (const r of sorted) {
      entitledSoFar += (r.ent_plan || 0)
      r.p_end = Math.max(0, totalPlannedLots - entitledSoFar)
    }
  }

  let cumul = 0
  for (const r of sorted) { cumul += (r.cls_plan || 0); r.closed_cumulative = cumul || null }

  if (period === 'weekly') {
    // Expand each monthly row into 4 weekly sub-rows.
    // Event cols (counts): split evenly as floats — no remainder spike.
    // Status cols (snapshots): repeat the month-end value for all 4 weeks
    // so area charts stay smooth rather than dropping to 0 for W1-W3.
    const result = []
    const WEEKS = 4
    for (const r of sorted) {
      for (let w = 1; w <= WEEKS; w++) {
        const key = `${r.calendar_month}-W${w}`
        const label = periodLabel(key, 'weekly')
        const row = { calendar_month: key, _label: label, _periodLabel: label }
        for (const col of EVENT_COLS) row[col] = (r[col] || 0) / WEEKS
        for (const col of STATUS_COLS) row[col] = r[col] || 0
        row.p_end = r.p_end || 0
        row.closed_cumulative = r.closed_cumulative || null
        result.push(row)
      }
    }
    return result
  }

  if (period === 'monthly') {
    for (const r of sorted) r._label = fmt(r.calendar_month)
    return sorted
  }

  const periodMap = new Map()
  for (const r of sorted) {
    const pk = periodKey(r.calendar_month, period)
    if (!periodMap.has(pk)) periodMap.set(pk, { _key: pk, _rows: [] })
    periodMap.get(pk)._rows.push(r)
  }

  return [...periodMap.values()].map(({ _key, _rows }) => {
    const last = _rows[_rows.length - 1]
    const out = { calendar_month: _key, _label: periodLabel(_key, period), _periodLabel: periodLabel(_key, period) }
    for (const col of EVENT_COLS)  out[col] = _rows.reduce((s, r) => s + (r[col] || 0), 0)
    for (const col of STATUS_COLS) out[col] = last[col] || 0
    out.closed_cumulative = last.closed_cumulative || null
    return out
  })
}

// ─── Shared table styles ──────────────────────────────────────────────────────

// ─── Provenance style tokens ──────────────────────────────────────────────────
// Use these everywhere a value can be MARKS-actual, engine-projected, or user-overridden.
export const PROV_MARKS = { color: '#111827' }
export const PROV_SIM   = { color: '#93c5fd', fontStyle: 'italic' }
export const PROV_OV    = { color: '#92400e', background: '#fef3c7', fontWeight: 600 }

// ─── Lot number display ───────────────────────────────────────────────────────
// Converts raw DB lot_number ("ST00000064") → display format ("ST_ 64").
// XX = dev code, _ = literal separator, NNN = 3-char right-justified with non-breaking spaces.
// ─── Hierarchy name deduplication ────────────────────────────────────────────
// Strips a parent name prefix from a child name (case-insensitive).
// "Stonewater SF Dev 1", parent "Stonewater SF" → "Dev 1"
// Falls back to full name if stripping produces empty string.
export function stripPrefix(name, parent) {
  if (!name || !parent) return name
  const p = parent.trim()
  if (name.toLowerCase().startsWith(p.toLowerCase())) {
    return name.slice(p.length).replace(/^[\s\-–—,/]+/, '').trim() || name
  }
  return name
}

export function fmtLot(lotNumber) {
  if (!lotNumber) return '—'
  const m = lotNumber.match(/^([A-Za-z]+|\d{2})0*(\d+)$/)
  if (!m) return lotNumber
  const numStr = String(parseInt(m[2], 10))
  const pad = '\u00a0'.repeat(Math.max(0, 3 - numStr.length))
  return `${m[1]}\u00a0${pad}${numStr}`
}

export const thS = (align = 'right', extra = {}) => ({
  padding: '4px 8px', textAlign: align, fontWeight: 600,
  borderBottom: '2px solid #e5e7eb', color: '#6b7280', fontSize: 12,
  whiteSpace: 'nowrap', background: '#f9fafb', ...extra,
})
export const tdS = (align = 'right', extra = {}) => ({
  padding: '3px 8px', textAlign: align, borderBottom: '1px solid #f3f4f6',
  fontVariantNumeric: 'tabular-nums', fontSize: 13, ...extra,
})

export function cell(v) { return v > 0 ? v : <span style={{ color: '#e5e7eb' }}>—</span> }
