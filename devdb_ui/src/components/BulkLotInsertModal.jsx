import { useState, useEffect, useRef } from 'react'
import { API_BASE } from '../config'

// Rebuild a flat lot list from prefix + startSeq + padWidth, preserving per-lot lot_type_id.
function rebuildNumbers(rows, prefix, startSeq, padWidth) {
  const p = (prefix || '').toUpperCase()
  const w = Math.max(1, padWidth)
  return rows.map((row, i) => ({
    ...row,
    lot_number: `${p}${String(startSeq + i).padStart(w, '0')}`,
  }))
}

export default function BulkLotInsertModal({ phase, knownLotTypes, onClose, onInserted }) {
  // Step 1: count inputs per lot type
  // Step 2: suggestion review (range editor + flat list)
  const [step, setStep] = useState(1)

  // Count inputs: { [lot_type_id]: count string }
  const [counts, setCounts] = useState(() => {
    const init = {}
    ;(knownLotTypes ?? []).forEach((lt) => { init[lt.lot_type_id] = '' })
    return init
  })

  // Suggestion state
  const [prefix, setPrefix]     = useState('')
  const [startSeq, setStartSeq] = useState(1)
  const [padWidth, setPadWidth] = useState(3)
  const [rows, setRows]         = useState([])   // [{lot_number, lot_type_id, lot_type_short}]
  const [loading, setLoading]   = useState(false)
  const [saving, setSaving]     = useState(false)
  const [error, setError]       = useState(null)

  const prefixRef   = useRef(prefix)
  const startSeqRef = useRef(startSeq)
  const padWidthRef = useRef(padWidth)
  prefixRef.current   = prefix
  startSeqRef.current = startSeq
  padWidthRef.current = padWidth

  const totalCount = Object.values(counts).reduce((s, v) => s + (parseInt(v, 10) || 0), 0)

  // ── Step 1: fetch suggestions ────────────────────────────────────────────

  async function handleGetSuggestions() {
    const requests = Object.entries(counts)
      .map(([id, v]) => ({ lot_type_id: parseInt(id, 10), count: parseInt(v, 10) || 0 }))
      .filter((r) => r.count > 0)
    if (!requests.length) return

    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`${API_BASE}/bulk-lots/suggestions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phase_id: phase.phase_id, requests }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.detail || 'Failed to get suggestions')
      setPrefix(data.prefix)
      setStartSeq(data.next_seq)
      setPadWidth(data.pad_width)
      setRows(data.suggestions)
      setStep(2)
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  // ── Range editor: rebuild flat list when prefix/startSeq change ──────────

  function handlePrefixChange(val) {
    setPrefix(val)
    setRows((prev) => rebuildNumbers(prev, val, startSeqRef.current, padWidthRef.current))
  }

  function handleStartSeqChange(val) {
    const n = parseInt(val, 10)
    if (isNaN(n) || n < 1) return
    setStartSeq(n)
    setRows((prev) => rebuildNumbers(prev, prefixRef.current, n, padWidthRef.current))
  }

  function handleIndividualEdit(idx, val) {
    setRows((prev) => prev.map((r, i) => i === idx ? { ...r, lot_number: val } : r))
  }

  // ── Step 2: insert ───────────────────────────────────────────────────────

  async function handleInsert() {
    setSaving(true)
    setError(null)
    try {
      const lots = rows.map((r) => ({
        lot_number: r.lot_number.trim(),
        lot_type_id: r.lot_type_id,
        phase_id: phase.phase_id,
      }))
      const res = await fetch(`${API_BASE}/bulk-lots/insert`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lots }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.detail || 'Insert failed')
      onInserted?.(data.inserted)
      onClose()
    } catch (e) {
      setError(e.message)
    } finally {
      setSaving(false)
    }
  }

  // ── Lot type short name map ──────────────────────────────────────────────
  const ltShortMap = {}
  ;(knownLotTypes ?? []).forEach((lt) => { ltShortMap[lt.lot_type_id] = lt.lot_type_short })

  // ── Render ───────────────────────────────────────────────────────────────

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: 'rgba(0,0,0,0.35)' }}
      onPointerDown={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div
        className="bg-white rounded-xl shadow-2xl border border-gray-200 flex flex-col"
        style={{ width: 480, maxHeight: '85vh' }}
        onPointerDown={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200">
          <div>
            <p className="text-xs text-gray-400 font-medium uppercase tracking-wide">Add lots to</p>
            <p className="text-sm font-bold text-gray-800">{phase.phase_name}</p>
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 text-lg leading-none"
            aria-label="Close"
          >✕</button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-4 py-3 flex flex-col gap-3">
          {error && (
            <div className="text-xs text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2">
              {error}
            </div>
          )}

          {/* ── Step 1: count inputs ── */}
          {step === 1 && (
            <>
              <p className="text-xs text-gray-500">
                Enter how many lots to create per product type.
              </p>
              <div className="flex flex-col gap-1.5">
                {(knownLotTypes ?? []).map((lt) => (
                  <div key={lt.lot_type_id} className="flex items-center gap-3">
                    <span
                      className="text-[11px] font-semibold px-2 py-0.5 rounded text-white flex-shrink-0"
                      style={{ background: '#6b7280', minWidth: 36, textAlign: 'center' }}
                    >
                      {lt.lot_type_short}
                    </span>
                    <input
                      type="number"
                      min="0"
                      value={counts[lt.lot_type_id] ?? ''}
                      onChange={(e) =>
                        setCounts((prev) => ({ ...prev, [lt.lot_type_id]: e.target.value }))
                      }
                      placeholder="0"
                      className="w-20 text-xs border border-gray-300 rounded px-2 py-1 focus:outline-none focus:border-blue-400"
                    />
                    <span className="text-xs text-gray-400">lots</span>
                  </div>
                ))}
              </div>
              {totalCount > 0 && (
                <p className="text-[11px] text-gray-400">{totalCount} lot{totalCount !== 1 ? 's' : ''} total</p>
              )}
            </>
          )}

          {/* ── Step 2: range editor + flat list ── */}
          {step === 2 && (
            <>
              {/* Range editor */}
              <div className="border border-gray-200 rounded-lg p-3 bg-gray-50 flex flex-col gap-2">
                <p className="text-[11px] text-gray-500 font-medium">Numbering range</p>
                <div className="flex items-center gap-2 flex-wrap">
                  <div className="flex items-center gap-1">
                    <span className="text-[11px] text-gray-500">Prefix</span>
                    <input
                      type="text"
                      value={prefix}
                      onChange={(e) => handlePrefixChange(e.target.value)}
                      className="w-16 text-xs border border-gray-300 rounded px-2 py-1 focus:outline-none focus:border-blue-400 uppercase"
                      placeholder="e.g. WS"
                    />
                  </div>
                  <div className="flex items-center gap-1">
                    <span className="text-[11px] text-gray-500">Start</span>
                    <input
                      type="number"
                      min="1"
                      value={startSeq}
                      onChange={(e) => handleStartSeqChange(e.target.value)}
                      className="w-20 text-xs border border-gray-300 rounded px-2 py-1 focus:outline-none focus:border-blue-400"
                    />
                  </div>
                  <span className="text-[11px] text-gray-400">
                    → {prefix}{String(startSeq + rows.length - 1).padStart(padWidth, '0')}
                  </span>
                </div>
                <p className="text-[11px] text-gray-400">
                  Edit individual lot numbers below if needed.
                </p>
              </div>

              {/* Flat list */}
              <div className="flex flex-col gap-1">
                {rows.map((row, idx) => (
                  <div key={idx} className="flex items-center gap-2">
                    <span
                      className="text-[10px] font-semibold px-1.5 py-0.5 rounded text-white flex-shrink-0"
                      style={{ background: '#6b7280', minWidth: 32, textAlign: 'center' }}
                    >
                      {row.lot_type_short}
                    </span>
                    <input
                      type="text"
                      value={row.lot_number}
                      onChange={(e) => handleIndividualEdit(idx, e.target.value)}
                      className="flex-1 text-xs border border-gray-300 rounded px-2 py-1 focus:outline-none focus:border-blue-400 font-mono"
                    />
                    <span className="text-[10px] text-amber-600 font-medium flex-shrink-0">PRE</span>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-4 py-3 border-t border-gray-200 gap-2">
          {step === 2 && (
            <button
              onClick={() => setStep(1)}
              className="text-xs text-gray-500 hover:text-gray-700"
            >
              ← Back
            </button>
          )}
          <div className="flex gap-2 ml-auto">
            <button
              onClick={onClose}
              className="text-xs px-3 py-1.5 rounded border border-gray-200 text-gray-600 hover:bg-gray-50"
            >
              Cancel
            </button>
            {step === 1 ? (
              <button
                onClick={handleGetSuggestions}
                disabled={loading || totalCount === 0}
                className="text-xs px-3 py-1.5 rounded bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-40"
              >
                {loading ? 'Loading…' : `Next — ${totalCount} lot${totalCount !== 1 ? 's' : ''}`}
              </button>
            ) : (
              <button
                onClick={handleInsert}
                disabled={saving || rows.length === 0}
                className="text-xs px-3 py-1.5 rounded bg-green-700 text-white hover:bg-green-800 disabled:opacity-40"
              >
                {saving ? 'Saving…' : `Add ${rows.length} lot${rows.length !== 1 ? 's' : ''}`}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
