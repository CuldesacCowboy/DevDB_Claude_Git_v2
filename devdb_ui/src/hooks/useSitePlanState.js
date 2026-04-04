// useSitePlanState.js
// Lot positioning and placement state for SitePlanView.
// Owns: allLots, lotPositions, savedPositions, isDirty, placeQueue, placeHistory.

import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { pointInPolygon } from '../components/SitePlan/splitPolygon'

const API = '/api'

export function useSitePlanState({ planId, boundaries, setMode }) {
  const [allLots, setAllLots]             = useState([])
  const [lotPositions, setLotPositions]   = useState({})
  const [savedPositions, setSavedPositions] = useState({})
  const [isDirty, setIsDirty]             = useState(false)
  const [placeQueue, setPlaceQueue]       = useState([])
  const [placeHistory, setPlaceHistory]   = useState([])
  const [savePending, setSavePending]     = useState(false)
  const [saveError, setSaveError]         = useState(null)

  const lotPositionsRef = useRef(lotPositions)
  const boundariesRef   = useRef(boundaries)
  useEffect(() => { lotPositionsRef.current = lotPositions }, [lotPositions])
  useEffect(() => { boundariesRef.current = boundaries }, [boundaries])

  // Load lot positions when plan changes
  useEffect(() => {
    if (!planId) {
      setAllLots([]); setLotPositions({}); setSavedPositions({})
      setIsDirty(false); setPlaceQueue([]); setPlaceHistory([])
      return
    }
    fetch(`${API}/lot-positions/plan/${planId}`)
      .then(r => r.ok ? r.json() : { positioned: [], bank: [] })
      .then(data => {
        const all = [...(data.positioned || []), ...(data.bank || [])]
        setAllLots(all)
        const pos = {}
        for (const l of (data.positioned || [])) pos[l.lot_id] = { x: l.x, y: l.y }
        setLotPositions(pos)
        setSavedPositions(pos)
        setIsDirty(false)
      })
      .catch(() => {})
  }, [planId])

  // Phase lookup using the freshest boundaries (via ref)
  function findPhaseForPosition(x, y) {
    for (const b of boundariesRef.current) {
      const poly = JSON.parse(b.polygon_json)
      if (pointInPolygon(x, y, poly)) return b.phase_id
    }
    return undefined
  }

  // ─── Drag / drop / place handlers ──────────────────────────────────────────

  const handleLotDrop = useCallback((lotId, normPos) => {
    const prevPos = lotPositionsRef.current[lotId] || null
    setPlaceHistory(h => [...h, { lotId, prevPos }])
    setLotPositions(prev => ({ ...prev, [lotId]: normPos }))
    setIsDirty(true)
  }, [])

  const handleLotMove = useCallback((lotId, normPos) => {
    const prevPos = lotPositionsRef.current[lotId] || null
    setPlaceHistory(h => [...h, { lotId, prevPos }])
    setLotPositions(prev => ({ ...prev, [lotId]: normPos }))
    setIsDirty(true)
  }, [])

  const handlePlaceLot = useCallback((normPos) => {
    setPlaceQueue(prev => {
      if (!prev.length) return prev
      const [current, ...rest] = prev
      const prevPos = lotPositionsRef.current[current.lot_id] || null
      setPlaceHistory(h => [...h, { lotId: current.lot_id, prevPos }])
      setLotPositions(lp => ({ ...lp, [current.lot_id]: normPos }))
      setIsDirty(true)
      if (!rest.length) setMode('view')
      return rest
    })
  }, [setMode])

  // ─── Derived ────────────────────────────────────────────────────────────────

  const bankLots = useMemo(
    () => allLots.filter(l => !(l.lot_id in lotPositions)),
    [allLots, lotPositions]
  )

  const lotMeta = useMemo(() => {
    const m = {}
    for (const l of allLots) m[l.lot_id] = { lot_number: l.lot_number, instrument_id: l.instrument_id, phase_id: l.phase_id }
    return m
  }, [allLots])

  // ─── Place mode ─────────────────────────────────────────────────────────────

  function startPlaceFromLot(lot) {
    const idx = bankLots.findIndex(l => l.lot_id === lot.lot_id)
    const queue = idx >= 0 ? [...bankLots.slice(idx), ...bankLots.slice(0, idx)] : bankLots
    setPlaceQueue(queue)
    setMode('place')
  }

  function endPlaceMode() {
    setPlaceQueue([])
    setMode('view')
  }

  // ─── Save / discard ─────────────────────────────────────────────────────────

  async function handleSaveLotPositions() {
    if (!planId) return
    setSavePending(true)
    setSaveError(null)
    const currentPositions = lotPositionsRef.current
    const updates = [], removes = []
    for (const [lotIdStr, pos] of Object.entries(currentPositions)) {
      const lotId = Number(lotIdStr)
      const phase = findPhaseForPosition(pos.x, pos.y)
      updates.push({ lot_id: lotId, x: pos.x, y: pos.y, phase_id: phase ?? null })
    }
    for (const lotIdStr of Object.keys(savedPositions)) {
      const lotId = Number(lotIdStr)
      if (!(lotId in currentPositions)) removes.push(lotId)
    }
    try {
      const res = await fetch(`${API}/lot-positions/plan/${planId}/save`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ updates, removes: [...new Set(removes)] }),
      })
      if (res.ok) {
        const data = await res.json()
        const all = [...(data.positioned || []), ...(data.bank || [])]
        setAllLots(all)
        const pos = {}
        for (const l of (data.positioned || [])) pos[l.lot_id] = { x: l.x, y: l.y }
        setLotPositions(pos)
        setSavedPositions(pos)
        setIsDirty(false)
        setPlaceQueue([])
        setPlaceHistory([])
        setMode('view')
      } else {
        const body = await res.json().catch(() => ({}))
        setSaveError(body.detail || `Save failed (${res.status})`)
      }
    } catch (err) {
      setSaveError(err.message || 'Network error — save failed')
    } finally {
      setSavePending(false)
    }
  }

  function handleDiscardLotPositions() {
    setLotPositions(savedPositions)
    setIsDirty(false)
    setSaveError(null)
    setPlaceQueue([])
    setPlaceHistory([])
    setMode('view')
  }

  // ─── Undo (place mode) ───────────────────────────────────────────────────────

  function handlePlaceUndo() {
    setPlaceHistory(h => {
      if (!h.length) return h
      const { lotId, prevPos } = h[h.length - 1]
      if (prevPos === null) {
        setLotPositions(lp => { const next = { ...lp }; delete next[lotId]; return next })
      } else {
        setLotPositions(lp => ({ ...lp, [lotId]: prevPos }))
      }
      return h.slice(0, -1)
    })
  }

  return {
    allLots,
    lotPositions,
    savedPositions,
    isDirty,
    placeQueue,
    placeHistory,
    bankLots,
    currentPlacingLot: placeQueue[0] || null,
    lotMeta,
    handleLotDrop,
    handleLotMove,
    handlePlaceLot,
    startPlaceFromLot,
    endPlaceMode,
    saveError,
    savePending,
    clearSaveError: () => setSaveError(null),
    handleSaveLotPositions,
    handleDiscardLotPositions,
    handlePlaceUndo,
  }
}
