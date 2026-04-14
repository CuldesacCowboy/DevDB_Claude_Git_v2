// useBoundaryManager.js
// Phase boundary state and topology operations for SitePlanView.
// Owns: boundaries, selectedBoundaryId, undoStack.
// Handles: split, merge, delete, cleanup, phase assignment, undo.

import { useState, useEffect, useRef, useCallback } from 'react'
import { normalizeSharedVertices, mergeAdjacentPolygons } from '../components/SitePlan/splitPolygon'
import { API_BASE } from '../config'

export function useBoundaryManager({ planId, setMode, setError }) {
  const [boundaries, setBoundaries]                 = useState([])
  const [selectedBoundaryId, setSelectedBoundaryId] = useState(null)
  const [undoStack, setUndoStack]                   = useState([])

  const boundariesRef = useRef(boundaries)
  useEffect(() => { boundariesRef.current = boundaries }, [boundaries])

  // Load boundaries when plan changes
  useEffect(() => {
    if (!planId) { setBoundaries([]); setSelectedBoundaryId(null); setUndoStack([]); return }
    fetch(`${API_BASE}/phase-boundaries/plan/${planId}`)
      .then(r => r.ok ? r.json() : [])
      .then(bs => setBoundaries(bs))
      .catch(() => setBoundaries([]))
  }, [planId])

  // ─── Delete ────────────────────────────────────────────────────────────────

  async function handleDeleteBoundary(boundaryId) {
    const current = boundariesRef.current
    const toDelete = current.find(b => b.boundary_id === boundaryId)
    if (!toDelete) return
    setError(null)
    try {
      const poly1 = JSON.parse(toDelete.polygon_json)
      let bestNeighbor = null, bestShared = 0
      for (const b of current) {
        if (b.boundary_id === boundaryId) continue
        const poly2 = JSON.parse(b.polygon_json)
        const shared = poly1.filter(p1 =>
          poly2.some(p2 => Math.hypot(p1.x - p2.x, p1.y - p2.y) < 2e-4)
        ).length
        if (shared > bestShared) { bestShared = shared; bestNeighbor = b }
      }
      if (bestNeighbor && bestShared >= 2) {
        const poly2 = JSON.parse(bestNeighbor.polygon_json)
        const merged = mergeAdjacentPolygons(poly1, poly2)
        if (merged) {
          await fetch(`${API_BASE}/phase-boundaries/${bestNeighbor.boundary_id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ polygon_json: JSON.stringify(merged) }),
          })
        }
      }
      await fetch(`${API_BASE}/phase-boundaries/${boundaryId}`, { method: 'DELETE' })
      const fresh = await fetch(`${API_BASE}/phase-boundaries/plan/${planId}`)
      setBoundaries(fresh.ok ? await fresh.json() : current.filter(b => b.boundary_id !== boundaryId))
      setSelectedBoundaryId(prev => prev === boundaryId ? null : prev)
      setUndoStack([])
    } catch (err) { setError('Delete failed: ' + err.message) }
  }

  async function handleDeleteAllBoundaries() {
    const current = boundariesRef.current
    if (!planId || !current.length) return
    setError(null)
    try {
      const res = await fetch(`${API_BASE}/phase-boundaries/bulk-delete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ boundary_ids: current.map(b => b.boundary_id) }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        setError(body.detail || `Delete all failed (${res.status})`)
        return
      }
      setBoundaries([])
      setSelectedBoundaryId(null)
      setUndoStack([])
      setMode('view')
    } catch (err) { setError('Delete all failed: ' + err.message) }
  }

  function clearBoundaries() {
    setBoundaries([])
    setSelectedBoundaryId(null)
    setUndoStack([])
  }

  // ─── Split ─────────────────────────────────────────────────────────────────

  const onSplitConfirm = useCallback(async (originalBoundaryId, polyA, polyB) => {
    if (!planId) return
    const original = originalBoundaryId != null
      ? boundariesRef.current.find(b => b.boundary_id === originalBoundaryId)
      : null

    const synthetic = [
      { boundary_id: '_a', polygon_json: JSON.stringify(polyA) },
      { boundary_id: '_b', polygon_json: JSON.stringify(polyB) },
    ]
    const normChanges = normalizeSharedVertices(synthetic)
    const normMap = Object.fromEntries(normChanges.map(n => [n.boundary_id, JSON.parse(n.polygon_json)]))
    const finalPolyA = normMap['_a'] || polyA
    const finalPolyB = normMap['_b'] || polyB

    try {
      const res = await fetch(`${API_BASE}/phase-boundaries/split`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          plan_id: planId,
          original_boundary_id: originalBoundaryId ?? null,
          polygon_a: JSON.stringify(finalPolyA),
          polygon_b: JSON.stringify(finalPolyB),
        }),
      })
      if (!res.ok) throw new Error('Split failed')
      const newPair = await res.json()
      const fresh = await fetch(`${API_BASE}/phase-boundaries/plan/${planId}`)
      setBoundaries(fresh.ok ? await fresh.json() : [])
      setSelectedBoundaryId(null)
      if (original) {
        setUndoStack(prev => [...prev.slice(-19), {
          type: 'split',
          deleted: original,
          addedIds: newPair.map(b => b.boundary_id),
        }])
      }
    } catch (err) { setError(err.message) }
  }, [planId, setError])

  // ─── Vertex edit ───────────────────────────────────────────────────────────

  const onBoundarySelect = useCallback((id) => {
    setSelectedBoundaryId(prev => prev === id ? null : id)
  }, [])

  const onVertexEditComplete = useCallback((oldStates) => {
    if (!oldStates?.length) return
    setUndoStack(prev => [...prev.slice(-19), { type: 'edit', oldStates }])
  }, [])

  // ─── Undo (boundary domain) ─────────────────────────────────────────────────

  async function handleBoundaryUndo() {
    if (!undoStack.length || !planId) return
    const entry = undoStack[undoStack.length - 1]
    setUndoStack(prev => prev.slice(0, -1))
    setError(null)
    try {
      if (entry.type === 'split') {
        for (const id of entry.addedIds) {
          await fetch(`${API_BASE}/phase-boundaries/${id}`, { method: 'DELETE' })
        }
        await fetch(`${API_BASE}/phase-boundaries`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            plan_id: planId,
            polygon_json: entry.deleted.polygon_json,
            label: entry.deleted.label ?? undefined,
            phase_id: entry.deleted.phase_id ?? undefined,
            split_order: entry.deleted.split_order,
          }),
        })
      } else if (entry.type === 'edit') {
        for (const { boundary_id, old_polygon_json } of entry.oldStates) {
          await fetch(`${API_BASE}/phase-boundaries/${boundary_id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ polygon_json: old_polygon_json }),
          })
        }
      }
      const fresh = await fetch(`${API_BASE}/phase-boundaries/plan/${planId}`)
      setBoundaries(fresh.ok ? await fresh.json() : [])
      setSelectedBoundaryId(null)
    } catch (err) {
      setError('Undo failed: ' + err.message)
      setUndoStack(prev => [...prev, entry])
    }
  }

  // ─── Cleanup ───────────────────────────────────────────────────────────────

  async function handleCleanupPolygons() {
    const current = boundariesRef.current
    if (!planId || !current.length) return
    const modified = normalizeSharedVertices(current)
    if (!modified.length) return
    setError(null)
    try {
      await Promise.all(modified.map(m =>
        fetch(`${API_BASE}/phase-boundaries/${m.boundary_id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ polygon_json: m.polygon_json }),
        })
      ))
      const fresh = await fetch(`${API_BASE}/phase-boundaries/plan/${planId}`)
      setBoundaries(fresh.ok ? await fresh.json() : current)
    } catch (err) { setError('Cleanup failed: ' + err.message) }
  }

  // ─── Phase assignment ───────────────────────────────────────────────────────

  async function assignPhaseToBoundary(boundaryId, phaseId) {
    setError(null)
    try {
      const res = await fetch(`${API_BASE}/phase-boundaries/${boundaryId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phase_id: phaseId }),
      })
      if (res.ok) {
        const updated = await res.json()
        setBoundaries(bs => bs.map(b => b.boundary_id === boundaryId ? updated : b))
      } else {
        const body = await res.json().catch(() => ({}))
        setError(body.detail || `Phase assignment failed (${res.status})`)
      }
    } catch (err) { setError('Phase assignment failed: ' + err.message) }
  }

  async function swapBoundaryAssignments(draggedBoundaryId, draggedPhaseId, targetBoundaryId, targetPhaseId) {
    setError(null)
    try {
      await fetch(`${API_BASE}/phase-boundaries/${targetBoundaryId}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phase_id: null }),
      })
      await fetch(`${API_BASE}/phase-boundaries/${draggedBoundaryId}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phase_id: targetPhaseId }),
      })
      await fetch(`${API_BASE}/phase-boundaries/${targetBoundaryId}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phase_id: draggedPhaseId }),
      })
      const fresh = await fetch(`${API_BASE}/phase-boundaries/plan/${planId}`)
      if (fresh.ok) setBoundaries(await fresh.json())
    } catch (err) { setError('Swap failed: ' + err.message) }
  }

  async function unassignBoundary(boundaryId) {
    setError(null)
    try {
      const res = await fetch(`${API_BASE}/phase-boundaries/${boundaryId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phase_id: null }),
      })
      if (res.ok) {
        const updated = await res.json()
        setBoundaries(bs => bs.map(b => b.boundary_id === boundaryId ? updated : b))
      } else {
        const body = await res.json().catch(() => ({}))
        setError(body.detail || `Unassign failed (${res.status})`)
      }
    } catch (err) { setError('Unassign failed: ' + err.message) }
  }

  return {
    boundaries,
    setBoundaries,
    selectedBoundaryId,
    setSelectedBoundaryId,
    undoStack,
    handleDeleteBoundary,
    handleDeleteAllBoundaries,
    clearBoundaries,
    onSplitConfirm,
    onBoundarySelect,
    onVertexEditComplete,
    handleBoundaryUndo,
    handleCleanupPolygons,
    assignPhaseToBoundary,
    swapBoundaryAssignments,
    unassignBoundary,
  }
}
