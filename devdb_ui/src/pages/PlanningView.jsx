// PlanningView.jsx — Production planning workbench.
// Override MARKS dates per lot to test schedule changes before entering into ITK.

import { useState, useEffect, useCallback } from 'react'
import { API_BASE } from '../config'
import { useOverrides } from '../hooks/useOverrides'
import OverrideDateCell from '../components/overrides/OverrideDateCell'
import OverridesPanel from '../components/overrides/OverridesPanel'
import SyncReconciliationModal from '../components/overrides/SyncReconciliationModal'

// ─── Date columns ─────────────────────────────────────────────────────────────

const DATE_COLS = [
  { field: 'date_td_hold', label: 'Hold',  ovField: 'ov_date_td_hold' },
  { field: 'date_td',      label: 'TD',    ovField: 'ov_date_td'      },
  { field: 'date_str',     label: 'DIG',   ovField: 'ov_date_str'     },
  { field: 'date_frm',     label: 'FRM',   ovField: 'ov_date_frm'     },
  { field: 'date_cmp',     label: 'CMP',   ovField: 'ov_date_cmp'     },
  { field: 'date_cls',     label: 'CLS',   ovField: 'ov_date_cls'     },
]

// ─── Status helpers ───────────────────────────────────────────────────────────

const STATUS_COLORS = {
  P: { bg: '#f3f4f6', color: '#6b7280' },
  E: { bg: '#fef9c3', color: '#854d0e' },
  D: { bg: '#dcfce7', color: '#166534' },
  H: { bg: '#fce7f3', color: '#9d174d' },
  U: { bg: '#dbeafe', color: '#1e40af' },
  UC:{ bg: '#e0f2fe', color: '#075985' },
  C: { bg: '#d1fae5', color: '#065f46' },
  OUT:{ bg: '#f3f4f6', color: '#9ca3af' },
}

function StatusBadge({ status }) {
  const cfg = STATUS_COLORS[status] || STATUS_COLORS.P
  return (
    <span style={{
      fontSize: 10, fontWeight: 700, padding: '1px 5px', borderRadius: 10,
      background: cfg.bg, color: cfg.color,
    }}>{status}</span>
  )
}

// ─── Community selector ───────────────────────────────────────────────────────

function CommunityBar({ communities, selectedId, onSelect }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
      {communities.map(c => (
        <button
          key={c.ent_group_id}
          onClick={() => onSelect(c.ent_group_id)}
          style={{
            fontSize: 12, padding: '4px 12px', borderRadius: 20, cursor: 'pointer',
            border: '1px solid',
            borderColor: selectedId === c.ent_group_id ? '#2563eb' : '#d1d5db',
            background: selectedId === c.ent_group_id ? '#eff6ff' : '#fff',
            color: selectedId === c.ent_group_id ? '#2563eb' : '#374151',
            fontWeight: selectedId === c.ent_group_id ? 600 : 400,
          }}
        >
          {c.ent_group_name}
        </button>
      ))}
    </div>
  )
}

// ─── Lot table row ────────────────────────────────────────────────────────────

function LotRow({ lot, onApply, onClear }) {
  const isSim = lot.lot_source === 'sim'
  return (
    <tr style={{ borderBottom: '1px solid #f3f4f6' }}>
      <td style={{ padding: '3px 8px', fontFamily: 'monospace', fontSize: 12,
        color: isSim ? '#9ca3af' : '#111827', whiteSpace: 'nowrap' }}>
        {lot.lot_number ?? <span style={{ color: '#d1d5db' }}>—</span>}
      </td>
      <td style={{ padding: '3px 8px', fontSize: 11, color: '#6b7280' }}>
        {lot.lot_type_short ?? ''}
      </td>
      <td style={{ padding: '3px 8px' }}>
        <StatusBadge status={lot.status} />
      </td>
      {DATE_COLS.map(col => (
        <td key={col.field} style={{ padding: '3px 4px', whiteSpace: 'nowrap' }}>
          <OverrideDateCell
            lotId={lot.lot_id}
            dateField={col.field}
            label={col.label}
            marksValue={lot[col.field]}
            overrideValue={lot[col.ovField]}
            projectedValue={null}
            onApply={onApply}
            onClear={onClear}
            disabled={isSim}
          />
        </td>
      ))}
    </tr>
  )
}

// ─── Phase group ──────────────────────────────────────────────────────────────

function PhaseGroup({ phaseName, lots, onApply, onClear, defaultExpanded = true }) {
  const [expanded, setExpanded] = useState(defaultExpanded)
  const ovCount = lots.reduce((n, l) => n + DATE_COLS.filter(c => l[c.ovField]).length, 0)

  return (
    <div style={{ marginBottom: 8 }}>
      <div
        onClick={() => setExpanded(v => !v)}
        style={{
          display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer',
          padding: '4px 8px', borderRadius: 4, background: '#f9fafb',
          border: '1px solid #e5e7eb', fontSize: 12, fontWeight: 600, color: '#374151',
          userSelect: 'none',
        }}
      >
        <span style={{ fontSize: 10, color: '#9ca3af' }}>{expanded ? '▾' : '▸'}</span>
        <span>{phaseName}</span>
        <span style={{ color: '#9ca3af', fontWeight: 400 }}>{lots.length} lots</span>
        {ovCount > 0 && (
          <span style={{
            fontSize: 10, fontWeight: 700, padding: '1px 6px', borderRadius: 10,
            background: '#fef3c7', color: '#92400e',
          }}>{ovCount} override{ovCount !== 1 ? 's' : ''}</span>
        )}
      </div>

      {expanded && (
        <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: 12 }}>
          <thead>
            <tr style={{ background: '#fafafa' }}>
              <th style={thStyle}>Lot</th>
              <th style={thStyle}>Type</th>
              <th style={thStyle}>Status</th>
              {DATE_COLS.map(c => (
                <th key={c.field} style={thStyle}>{c.label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {lots.map(lot => (
              <LotRow key={lot.lot_id} lot={lot} onApply={onApply} onClear={onClear} />
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}

const thStyle = {
  padding: '3px 8px', textAlign: 'left', fontSize: 11,
  color: '#6b7280', fontWeight: 600, borderBottom: '1px solid #e5e7eb',
}

// ─── Dev group ────────────────────────────────────────────────────────────────

function DevGroup({ devName, lots, onApply, onClear }) {
  const [expanded, setExpanded] = useState(true)
  const ovCount = lots.reduce((n, l) => n + DATE_COLS.filter(c => l[c.ovField]).length, 0)

  // Group lots by phase
  const byPhase = {}
  for (const lot of lots) {
    const p = lot.phase_name || 'Unknown'
    if (!byPhase[p]) byPhase[p] = []
    byPhase[p].push(lot)
  }

  return (
    <div style={{ marginBottom: 20 }}>
      <div
        onClick={() => setExpanded(v => !v)}
        style={{
          display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer',
          padding: '6px 10px', borderRadius: 4, background: '#f1f5f9',
          border: '1px solid #cbd5e1', marginBottom: expanded ? 8 : 0,
          userSelect: 'none',
        }}
      >
        <span style={{ fontSize: 11, color: '#64748b' }}>{expanded ? '▾' : '▸'}</span>
        <span style={{ fontWeight: 700, fontSize: 13, color: '#1e293b' }}>{devName}</span>
        <span style={{ fontSize: 12, color: '#94a3b8' }}>{lots.length} lots</span>
        {ovCount > 0 && (
          <span style={{
            fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 10,
            background: '#fef3c7', color: '#92400e',
          }}>{ovCount} override{ovCount !== 1 ? 's' : ''}</span>
        )}
      </div>

      {expanded && Object.entries(byPhase).map(([phaseName, phaseLots]) => (
        <PhaseGroup
          key={phaseName}
          phaseName={phaseName}
          lots={phaseLots}
          onApply={onApply}
          onClear={onClear}
        />
      ))}
    </div>
  )
}

// ─── Status filter ────────────────────────────────────────────────────────────

const ALL_STATUSES = ['P','E','D','H','U','UC','C','OUT']
const ACTIVE_STATUSES = ['D','H','U','UC']

// ─── Main view ────────────────────────────────────────────────────────────────

export default function PlanningView({ selectedGroupId, setSelectedGroupId, showTestCommunities }) {
  const [communities, setCommunities] = useState([])
  const [lots, setLots] = useState([])
  const [lotsLoading, setLotsLoading] = useState(false)
  const [showReconModal, setShowReconModal] = useState(false)
  const [statusFilter, setStatusFilter] = useState(new Set(ACTIVE_STATUSES))
  const [showPanel, setShowPanel] = useState(true)

  const entGroupId = selectedGroupId

  const {
    overrides, loading: ovLoading,
    reconciliation,
    fetchOverrides,
    applyOverrides, clearOverride,
    clearBatch,
    fetchReconciliation,
    exportOverrides,
  } = useOverrides(entGroupId)

  // Load communities
  useEffect(() => {
    fetch(`${API_BASE}/simulation/communities`)
      .then(r => r.json())
      .then(data => {
        const filtered = showTestCommunities
          ? data.filter(c => c.is_test)
          : data.filter(c => !c.is_test)
        setCommunities(filtered)
        if (!selectedGroupId && filtered.length) setSelectedGroupId(filtered[0].ent_group_id)
      })
      .catch(() => {})
  }, [showTestCommunities]) // eslint-disable-line

  // Load lots when community changes
  const loadLots = useCallback(async () => {
    if (!entGroupId) return
    setLotsLoading(true)
    try {
      const res = await fetch(`${API_BASE}/simulation/${entGroupId}/lots`)
      const data = await res.json()
      setLots(Array.isArray(data) ? data : [])
    } finally {
      setLotsLoading(false)
    }
  }, [entGroupId])

  useEffect(() => {
    loadLots()
    fetchOverrides()
  }, [loadLots, fetchOverrides])

  // Apply override handler: refresh both lots and override list
  const handleApply = useCallback(async (lotId, changes) => {
    await applyOverrides(lotId, changes)
    await loadLots()
  }, [applyOverrides, loadLots])

  const handleClear = useCallback(async (lotId, dateField) => {
    await clearOverride(lotId, dateField)
    await loadLots()
  }, [clearOverride, loadLots])

  // Group lots by dev, filtered by status
  const filteredLots = lots.filter(l => statusFilter.has(l.status))

  const byDev = {}
  for (const lot of filteredLots) {
    const d = lot.dev_name || 'Unknown'
    if (!byDev[d]) byDev[d] = []
    byDev[d].push(lot)
  }

  function toggleStatus(s) {
    setStatusFilter(prev => {
      const next = new Set(prev)
      if (next.has(s)) next.delete(s)
      else next.add(s)
      return next
    })
  }

  const handleExport = async () => {
    const rows = await exportOverrides()
    if (!rows.length) { alert('No overrides to export.'); return }
    const headers = ['Lot','Dev','Phase','Field','Activity','MARKS Current','Override','Delta Days','Note']
    const csv = [
      headers.join(','),
      ...rows.map(r => [
        r.lot_number, r.dev_name, r.phase_name, r.label, r.marks_activity,
        r.current_marks ?? '', r.override_value, r.delta_days ?? '', r.override_note ?? '',
      ].map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')),
    ].join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a'); a.href = url; a.download = 'itk_changes.csv'; a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', overflow: 'hidden' }}>

      {/* ── Top bar ── */}
      <div style={{
        padding: '10px 16px', borderBottom: '1px solid #e5e7eb', background: '#fff',
        display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', flexShrink: 0,
      }}>
        <span style={{ fontWeight: 700, fontSize: 13, color: '#111827' }}>Planning</span>
        <CommunityBar
          communities={communities}
          selectedId={selectedGroupId}
          onSelect={setSelectedGroupId}
        />
      </div>

      {/* ── Body: sidebar + main ── */}
      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>

        {/* ── Override panel sidebar ── */}
        {showPanel && (
          <div style={{
            width: 420, flexShrink: 0, borderRight: '1px solid #e5e7eb',
            overflowY: 'auto', padding: 16, background: '#fff',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
              <span style={{ fontSize: 12, fontWeight: 600, color: '#374151' }}>Active overrides</span>
              <button
                onClick={() => setShowPanel(false)}
                style={{ fontSize: 11, color: '#9ca3af', background: 'none', border: 'none', cursor: 'pointer' }}
              >
                ✕
              </button>
            </div>
            <OverridesPanel
              overrides={overrides}
              loading={ovLoading}
              onClear={handleClear}
              onClearAll={() => {
                const lotIds = [...new Set(overrides.map(o => o.lot_id))]
                clearBatch({ lotIds }).then(loadLots)
              }}
              onExport={handleExport}
              onCheckReconciliation={async () => {
                await fetchReconciliation()
                setShowReconModal(true)
              }}
            />
          </div>
        )}

        {/* ── Lot table area ── */}
        <div style={{ flex: 1, overflowY: 'auto', padding: 16 }}>

          {/* Toolbar row */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
            {!showPanel && (
              <button
                onClick={() => setShowPanel(true)}
                style={{
                  fontSize: 11, padding: '3px 10px', borderRadius: 4,
                  border: '1px solid #d1d5db', background: '#fff', cursor: 'pointer', color: '#374151',
                }}
              >
                {overrides.length > 0
                  ? `Show overrides (${overrides.length})`
                  : 'Show overrides'}
              </button>
            )}

            <span style={{ fontSize: 11, color: '#6b7280', marginLeft: showPanel ? 0 : 4 }}>Filter:</span>
            {ALL_STATUSES.map(s => {
              const cfg = STATUS_COLORS[s] || STATUS_COLORS.P
              const active = statusFilter.has(s)
              return (
                <button
                  key={s}
                  onClick={() => toggleStatus(s)}
                  style={{
                    fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 10,
                    cursor: 'pointer', border: '1px solid',
                    borderColor: active ? cfg.color : '#d1d5db',
                    background: active ? cfg.bg : '#fff',
                    color: active ? cfg.color : '#9ca3af',
                  }}
                >
                  {s}
                </button>
              )
            })}

            <span style={{ fontSize: 11, color: '#9ca3af', marginLeft: 4 }}>
              {filteredLots.length} lot{filteredLots.length !== 1 ? 's' : ''}
            </span>
          </div>

          {/* Lot groups */}
          {lotsLoading && (
            <div style={{ color: '#6b7280', fontSize: 12, padding: 16 }}>Loading…</div>
          )}

          {!lotsLoading && !entGroupId && (
            <div style={{ color: '#9ca3af', fontSize: 13, padding: 24, textAlign: 'center' }}>
              Select a community above to begin.
            </div>
          )}

          {!lotsLoading && entGroupId && filteredLots.length === 0 && (
            <div style={{ color: '#9ca3af', fontSize: 13, padding: 24, textAlign: 'center' }}>
              No lots match the current status filter.
            </div>
          )}

          {!lotsLoading && Object.entries(byDev).map(([devName, devLots]) => (
            <DevGroup
              key={devName}
              devName={devName}
              lots={devLots}
              onApply={handleApply}
              onClear={handleClear}
            />
          ))}
        </div>
      </div>

      {/* ── Sync reconciliation modal ── */}
      {showReconModal && reconciliation.length > 0 && (
        <SyncReconciliationModal
          rows={reconciliation}
          onClearSelected={async (ids) => {
            await clearBatch({ overrideIds: ids })
            await loadLots()
            setShowReconModal(false)
          }}
          onDismiss={() => setShowReconModal(false)}
        />
      )}
    </div>
  )
}
