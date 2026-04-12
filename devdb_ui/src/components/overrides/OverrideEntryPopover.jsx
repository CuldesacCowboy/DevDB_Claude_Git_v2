// OverrideEntryPopover.jsx — date entry popover with cascade preview + confirm.

import { useState, useEffect, useRef } from 'react'
import { API_BASE } from '../../config'

const fmt = d => d ? new Date(d + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' }) : '—'
const sign = n => n > 0 ? `+${n}d` : n < 0 ? `${n}d` : '±0'

export default function OverrideEntryPopover({
  lotId, dateField, label,
  marksValue, currentOverride,
  onApply, onClear, onClose,
}) {
  const [inputDate, setInputDate]   = useState(currentOverride || marksValue || '')
  const [note, setNote]             = useState('')
  const [preview, setPreview]       = useState(null)
  const [cascade, setCascade]       = useState([])   // [{date_field, proposed_value, ...}]
  const [selected, setSelected]     = useState({})   // date_field -> bool (include in apply)
  const [loading, setLoading]       = useState(false)
  const [err, setErr]               = useState(null)
  const ref = useRef(null)

  // Close on outside click
  useEffect(() => {
    function handler(e) { if (ref.current && !ref.current.contains(e.target)) onClose() }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [onClose])

  // Fetch preview when date changes
  useEffect(() => {
    if (!inputDate) { setPreview(null); setCascade([]); return }
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`${API_BASE}/overrides/preview`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ lot_id: lotId, date_field: dateField, override_value: inputDate }),
        })
        if (!res.ok) return
        const data = await res.json()
        setPreview(data)
        const cas = data.cascade || []
        setCascade(cas)
        // Default: select all cascade rows that have a meaningful proposed change
        const sel = {}
        for (const c of cas) sel[c.date_field] = true
        setSelected(sel)
      } catch {}
    }, 400)
    return () => clearTimeout(timer)
  }, [inputDate, lotId, dateField])

  async function handleApply() {
    if (!inputDate) return
    setLoading(true); setErr(null)
    try {
      const changes = [{ date_field: dateField, override_value: inputDate, note }]
      for (const c of cascade) {
        if (selected[c.date_field]) {
          changes.push({ date_field: c.date_field, override_value: c.proposed_value, note })
        }
      }
      await onApply(changes)
    } catch (e) {
      setErr(String(e))
    } finally {
      setLoading(false)
    }
  }

  const popStyle = {
    position: 'absolute', zIndex: 1000, top: '100%', left: 0,
    background: '#fff', border: '1px solid #d1d5db', borderRadius: 6,
    boxShadow: '0 4px 16px rgba(0,0,0,0.12)', padding: 12, minWidth: 280,
    fontSize: 12,
  }

  return (
    <div ref={ref} style={popStyle}>
      <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 8, color: '#111827' }}>
        {label} override
      </div>

      {marksValue && (
        <div style={{ color: '#6b7280', marginBottom: 6 }}>
          MARKS: <strong>{fmt(marksValue)}</strong>
          {currentOverride && <> · Current override: <strong style={{ color: '#92400e' }}>{fmt(currentOverride)}</strong></>}
        </div>
      )}

      <div style={{ marginBottom: 8 }}>
        <label style={{ fontSize: 11, color: '#374151', display: 'block', marginBottom: 3 }}>New date</label>
        <input
          type="date"
          value={inputDate}
          onChange={e => setInputDate(e.target.value)}
          style={{ fontSize: 12, padding: '4px 8px', border: '1px solid #d1d5db', borderRadius: 4, width: '100%' }}
        />
      </div>

      <div style={{ marginBottom: 8 }}>
        <label style={{ fontSize: 11, color: '#374151', display: 'block', marginBottom: 3 }}>Note (optional)</label>
        <input
          value={note}
          onChange={e => setNote(e.target.value)}
          placeholder="e.g. pushed per mtg Apr 12"
          style={{ fontSize: 12, padding: '4px 8px', border: '1px solid #d1d5db', borderRadius: 4, width: '100%' }}
        />
      </div>

      {preview && (
        <div style={{ marginBottom: 6, color: '#374151' }}>
          Delta: <strong style={{ color: preview.delta_days > 0 ? '#b45309' : preview.delta_days < 0 ? '#15803d' : '#6b7280' }}>
            {sign(preview.delta_days)}
          </strong>
        </div>
      )}

      {cascade.length > 0 && (
        <div style={{ marginBottom: 10 }}>
          <div style={{ fontSize: 11, color: '#6b7280', marginBottom: 4 }}>Cascade to downstream dates:</div>
          {cascade.map(c => (
            <label key={c.date_field} style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3, cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={!!selected[c.date_field]}
                onChange={e => setSelected(s => ({ ...s, [c.date_field]: e.target.checked }))}
              />
              <span style={{ color: '#374151' }}>
                <strong>{c.label}</strong>: {fmt(c.current_value)} → <strong style={{ color: '#92400e' }}>{fmt(c.proposed_value)}</strong>
                {c.delta_days != null && <span style={{ color: '#9ca3af', marginLeft: 4 }}>{sign(c.delta_days)}</span>}
              </span>
            </label>
          ))}
        </div>
      )}

      {err && <div style={{ color: '#dc2626', fontSize: 11, marginBottom: 6 }}>{err}</div>}

      <div style={{ display: 'flex', gap: 6 }}>
        <button
          onClick={handleApply}
          disabled={loading || !inputDate}
          style={{
            fontSize: 12, padding: '4px 12px', borderRadius: 4, border: 'none',
            background: '#2563eb', color: '#fff', cursor: 'pointer', fontWeight: 600,
          }}
        >
          {loading ? '…' : 'Apply'}
        </button>
        {currentOverride && (
          <button
            onClick={onClear}
            style={{ fontSize: 12, padding: '4px 10px', borderRadius: 4,
              border: '1px solid #d1d5db', background: '#fff', color: '#dc2626', cursor: 'pointer' }}
          >
            Clear
          </button>
        )}
        <button
          onClick={onClose}
          style={{ fontSize: 12, padding: '4px 10px', borderRadius: 4,
            border: '1px solid #d1d5db', background: '#fff', color: '#6b7280', cursor: 'pointer' }}
        >
          Cancel
        </button>
      </div>
    </div>
  )
}
