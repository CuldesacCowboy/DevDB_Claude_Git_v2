// SyncReconciliationModal.jsx — post-sync modal offering batch clear of near-MARKS overrides.

import { useState } from 'react'

const fmt = d => d ? new Date(d + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' }) : '—'

export default function SyncReconciliationModal({ rows, onClearSelected, onDismiss }) {
  const [selected, setSelected] = useState(() => {
    const s = {}
    for (const r of rows) s[r.override_id] = true
    return s
  })

  const toggle = id => setSelected(s => ({ ...s, [id]: !s[id] }))
  const selectedIds = rows.filter(r => selected[r.override_id]).map(r => r.override_id)

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.35)',
      zIndex: 2000, display: 'flex', alignItems: 'center', justifyContent: 'center',
    }}>
      <div style={{
        background: '#fff', borderRadius: 8, padding: 24, maxWidth: 560, width: '90%',
        boxShadow: '0 8px 32px rgba(0,0,0,0.15)', fontSize: 12,
      }}>
        <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 4, color: '#111827' }}>
          Sync Reconciliation
        </div>
        <div style={{ color: '#6b7280', marginBottom: 16 }}>
          {rows.length} override{rows.length !== 1 ? 's are' : ' is'} now within a few days of MARKS.
          Select overrides to clear — MARKS will take over for those dates.
        </div>

        <table style={{ borderCollapse: 'collapse', width: '100%', marginBottom: 16 }}>
          <thead>
            <tr style={{ background: '#f9fafb' }}>
              <th style={{ padding: '4px 8px', width: 24 }}>
                <input
                  type="checkbox"
                  checked={selectedIds.length === rows.length}
                  onChange={e => {
                    const s = {}
                    for (const r of rows) s[r.override_id] = e.target.checked
                    setSelected(s)
                  }}
                />
              </th>
              {['Lot', 'Field', 'Override', 'MARKS now', 'Gap'].map(h => (
                <th key={h} style={{ padding: '4px 8px', textAlign: 'left', fontSize: 11,
                  color: '#6b7280', fontWeight: 600, borderBottom: '1px solid #e5e7eb' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.override_id} style={{ borderBottom: '1px solid #f3f4f6' }}>
                <td style={{ padding: '4px 8px' }}>
                  <input type="checkbox" checked={!!selected[r.override_id]}
                    onChange={() => toggle(r.override_id)} />
                </td>
                <td style={{ padding: '4px 8px', fontFamily: 'monospace', color: '#111827' }}>{r.lot_number}</td>
                <td style={{ padding: '4px 8px' }}>
                  <span style={{ background: '#fef3c7', color: '#92400e', padding: '1px 6px',
                    borderRadius: 10, fontSize: 10, fontWeight: 700 }}>{r.label}</span>
                </td>
                <td style={{ padding: '4px 8px', color: '#92400e', fontWeight: 600 }}>{fmt(r.override_value)}</td>
                <td style={{ padding: '4px 8px', color: '#374151' }}>{fmt(r.current_marks)}</td>
                <td style={{ padding: '4px 8px', color: '#6b7280' }}>{r.delta_days != null ? `${r.delta_days}d` : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button onClick={onDismiss}
            style={{ fontSize: 12, padding: '5px 14px', borderRadius: 4,
              border: '1px solid #d1d5db', background: '#fff', cursor: 'pointer', color: '#6b7280' }}>
            Dismiss
          </button>
          <button
            onClick={() => onClearSelected(selectedIds)}
            disabled={selectedIds.length === 0}
            style={{ fontSize: 12, padding: '5px 14px', borderRadius: 4, border: 'none',
              background: selectedIds.length ? '#2563eb' : '#93c5fd',
              color: '#fff', cursor: selectedIds.length ? 'pointer' : 'default', fontWeight: 600 }}
          >
            Clear {selectedIds.length} selected
          </button>
        </div>
      </div>
    </div>
  )
}
