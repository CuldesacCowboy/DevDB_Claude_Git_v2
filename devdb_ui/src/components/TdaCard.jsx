import { useState } from 'react'

// ── TDA card wrapper ──────────────────────────────────────────────
// Shell component: renders TDA header summary, children (checkpoint bands),
// and the "Add checkpoint" form. Calls onAddCheckpoint(date, lots) — the
// page/hook owns the actual mutation.
export default function TdaCard({ detail, onAddCheckpoint, children }) {
  const poolCount = detail.pool_lots?.length || 0
  const cpCounts = (detail.checkpoints || []).map(cp => ({ name: cp.checkpoint_name, count: cp.lots?.length || 0 }))
  const totalLots = poolCount + cpCounts.reduce((sum, cp) => sum + cp.count, 0)
  const [showAddCP, setShowAddCP] = useState(false)
  const [cpDate, setCpDate] = useState('')
  const [cpLots, setCpLots] = useState('')
  const [cpCreating, setCpCreating] = useState(false)

  async function handleAddCheckpoint() {
    setCpCreating(true)
    try {
      await onAddCheckpoint(cpDate || null, cpLots)
      setCpDate(''); setCpLots(''); setShowAddCP(false)
    } finally {
      setCpCreating(false)
    }
  }

  return (
    <div style={{
      borderRadius: 10, overflow: 'hidden',
      boxShadow: '0 1px 4px rgba(0,0,0,0.08)',
      display: 'inline-flex', flexDirection: 'column',
      flexShrink: 0, width: 'fit-content',
    }}>
      <div style={{
        background: '#F0EEE8', padding: '10px 16px',
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
      }}>
        <span style={{ fontWeight: 700, fontSize: 16, color: '#2C2C2A' }}>
          {detail.tda_name}
        </span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 0, marginLeft: 14, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 12, color: '#888780', marginLeft: 10 }}>
            no&nbsp;cp:&nbsp;{poolCount}
          </span>
          {cpCounts.map((cp, i) => (
            <span key={i} style={{ fontSize: 12, color: '#888780', marginLeft: 10 }}>
              cp{i + 1}:&nbsp;{cp.count}
            </span>
          ))}
          <span style={{ fontSize: 13, fontWeight: 600, color: '#444441', marginLeft: 12 }}>
            {totalLots}&nbsp;total
          </span>
        </div>
      </div>
      <div style={{ background: '#F7F6F3', padding: 14 }}>
        {children}

        {/* Add checkpoint */}
        {showAddCP ? (
          <div style={{
            display: 'flex', alignItems: 'center', gap: 8, marginTop: 4,
            padding: '10px 14px', background: '#fff',
            borderRadius: 8, border: '1.5px solid #E4E2DA',
          }}>
            <input
              autoFocus
              type="number"
              min={0}
              placeholder="Lots required"
              value={cpLots}
              onChange={e => setCpLots(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter') handleAddCheckpoint()
                if (e.key === 'Escape') { setShowAddCP(false); setCpDate(''); setCpLots('') }
              }}
              style={{
                fontSize: 14, padding: '4px 8px', borderRadius: 5,
                border: '1px solid #d1d5db', outline: 'none', width: 110,
              }}
            />
            <input
              type="date"
              value={cpDate}
              onChange={e => setCpDate(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Escape') { setShowAddCP(false); setCpDate(''); setCpLots('') }
              }}
              style={{
                fontSize: 13, padding: '4px 8px', borderRadius: 5,
                border: '1px solid #d1d5db', outline: 'none',
              }}
            />
            <button
              onClick={handleAddCheckpoint}
              disabled={cpCreating}
              style={{
                fontSize: 13, padding: '4px 12px', borderRadius: 5,
                border: 'none', background: '#2563eb', color: '#fff',
                cursor: cpCreating ? 'default' : 'pointer', opacity: cpCreating ? 0.6 : 1,
              }}
            >
              {cpCreating ? 'Adding…' : 'Add'}
            </button>
            <button
              onClick={() => { setShowAddCP(false); setCpDate(''); setCpLots('') }}
              style={{
                fontSize: 13, padding: '4px 10px', borderRadius: 5,
                border: '1px solid #d1d5db', background: '#fff', color: '#6b7280',
                cursor: 'pointer',
              }}
            >
              Cancel
            </button>
          </div>
        ) : (
          <button
            onClick={() => setShowAddCP(true)}
            style={{
              marginTop: 4,
              fontSize: 13, padding: '6px 14px', borderRadius: 6,
              border: '1.5px dashed #B4B2A9', background: 'transparent', color: '#888780',
              cursor: 'pointer', width: '100%', textAlign: 'left',
            }}
          >
            + Add checkpoint
          </button>
        )}
      </div>
    </div>
  )
}
