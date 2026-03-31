import { useState, useEffect, useCallback } from 'react'
import { API_BASE } from '../config'

// mutation status shape: { status: 'idle' | 'saving' | 'error', error: string | null }
const IDLE  = { status: 'idle',   error: null }
const SAVING = { status: 'saving', error: null }

function errorState(e) {
  return { status: 'error', error: typeof e === 'string' ? e : (e?.message ?? 'Unknown error') }
}

export function useTdaData(entGroupId) {
  // ── Read state ──────────────────────────────────────────────────
  const [agreements, setAgreements] = useState([])
  const [selectedTdaId, setSelectedTdaId] = useState(null)
  const [detail, setDetail] = useState(null)
  const [entGroupName, setEntGroupName] = useState('')
  const [unassignedLots, setUnassignedLots] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  // ── Mutation status ─────────────────────────────────────────────
  // Single status covers all in-flight mutations; operations are not concurrent
  // except for batch pool adds/removes which share the same status slot.
  const [mutationStatus, setMutationStatus] = useState(IDLE)

  // ── Fetch helpers ───────────────────────────────────────────────
  // signal is passed from the useEffect cleanup; mutation-triggered calls omit it.
  const fetchAgreements = useCallback((selectId = null, signal = undefined) => {
    if (!entGroupId) return
    setLoading(true)
    fetch(`${API_BASE}/entitlement-groups/${entGroupId}/takedown-agreements`, { signal })
      .then(r => r.json())
      .then(data => {
        setEntGroupName(data.ent_group_name || '')
        setAgreements(data.agreements || [])
        if (selectId) {
          setSelectedTdaId(selectId)
        } else if (data.agreements && data.agreements.length > 0) {
          setSelectedTdaId(prev => prev || data.agreements[0].tda_id)
        }
        setLoading(false)
      })
      .catch(e => {
        if (e.name === 'AbortError') return
        setError(e.message)
        setLoading(false)
      })
  }, [entGroupId])

  // Reset TDA state immediately when the community changes so the stale selectedTdaId
  // does not prevent fetchAgreements from selecting the first TDA of the new community.
  useEffect(() => {
    setSelectedTdaId(null)
    setDetail(null)
    setAgreements([])
    setUnassignedLots([])
  }, [entGroupId])

  // Fix 3: AbortController prevents stale responses from landing after entGroupId changes.
  useEffect(() => {
    const controller = new AbortController()
    fetchAgreements(null, controller.signal)
    return () => controller.abort()
  }, [fetchAgreements])

  const fetchDetail = useCallback((signal = undefined) => {
    if (!selectedTdaId) return
    fetch(`${API_BASE}/takedown-agreements/${selectedTdaId}/detail`, { signal })
      .then(r => r.json())
      .then(data => setDetail(data))
      .catch(e => {
        if (e.name === 'AbortError') return
        setError(e.message)
      })
  }, [selectedTdaId])

  // Fix 3: AbortController prevents stale detail responses from landing after TDA switches.
  useEffect(() => {
    const controller = new AbortController()
    fetchDetail(controller.signal)
    return () => controller.abort()
  }, [fetchDetail])

  const fetchUnassignedLots = useCallback((signal = undefined) => {
    if (!entGroupId) return
    fetch(`${API_BASE}/entitlement-groups/${entGroupId}/tda-unassigned-lots`, { signal })
      .then(r => r.json())
      .then(data => setUnassignedLots(Array.isArray(data) ? data : []))
      .catch(e => {
        if (e.name === 'AbortError') return
        // non-fatal — unassigned bank just stays empty
      })
  }, [entGroupId])

  useEffect(() => {
    const controller = new AbortController()
    fetchUnassignedLots(controller.signal)
    return () => controller.abort()
  }, [fetchUnassignedLots])

  // ── Mutations ───────────────────────────────────────────────────

  const renameTda = useCallback(async (tdaId, name) => {
    const trimmed = name?.trim()
    if (!trimmed) return { ok: false, error: 'Name is required.' }
    setMutationStatus(SAVING)
    try {
      const res = await fetch(`${API_BASE}/takedown-agreements/${tdaId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tda_name: trimmed }),
      })
      if (!res.ok) {
        const body = await res.json()
        const msg = body.detail || 'Failed to rename.'
        setMutationStatus(errorState(msg))
        return { ok: false, error: msg }
      }
      setMutationStatus(IDLE)
      fetchAgreements(tdaId)
      if (tdaId === selectedTdaId) fetchDetail()
      return { ok: true }
    } catch (e) {
      setMutationStatus(errorState(e))
      return { ok: false, error: e.message }
    }
  }, [fetchAgreements, fetchDetail, selectedTdaId])

  const createTda = useCallback(async (name) => {
    if (!name?.trim()) return { ok: false, error: 'Name is required.' }
    setMutationStatus(SAVING)
    try {
      const res = await fetch(`${API_BASE}/takedown-agreements`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tda_name: name.trim(), ent_group_id: entGroupId }),
      })
      if (!res.ok) {
        const body = await res.json()
        const msg = body.detail || 'Failed to create agreement.'
        setMutationStatus(errorState(msg))
        return { ok: false, error: msg }
      }
      const created = await res.json()
      setMutationStatus(IDLE)
      fetchAgreements(created.tda_id)
      return { ok: true, tda_id: created.tda_id }
    } catch (e) {
      setMutationStatus(errorState(e))
      return { ok: false, error: e.message }
    }
  }, [entGroupId, fetchAgreements])

  // Fix 1: read response, check res.ok, surface backend error message.
  const createCheckpoint = useCallback(async (tdaId, { checkpointDate, lotsRequired }) => {
    setMutationStatus(SAVING)
    try {
      const res = await fetch(`${API_BASE}/takedown-agreements/${tdaId}/checkpoints`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          checkpoint_date: checkpointDate || null,
          lots_required_cumulative: parseInt(lotsRequired, 10) || 0,
        }),
      })
      if (!res.ok) {
        const body = await res.json()
        setMutationStatus(errorState(body.detail || 'Failed to create checkpoint.'))
        return
      }
      setMutationStatus(IDLE)
      fetchDetail()
    } catch (e) {
      setMutationStatus(errorState(e))
    }
  }, [fetchDetail])

  // Fix 1: read response, check res.ok.
  const updateAssignmentDates = useCallback(async (assignmentId, patch) => {
    setMutationStatus(SAVING)
    try {
      const res = await fetch(`${API_BASE}/tda-lot-assignments/${assignmentId}/dates`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      })
      if (!res.ok) {
        const body = await res.json()
        setMutationStatus(errorState(body.detail || 'Failed to update dates.'))
        return
      }
      setMutationStatus(IDLE)
      fetchDetail()
    } catch (e) {
      setMutationStatus(errorState(e))
    }
  }, [fetchDetail])

  // Fix 1: read response, check res.ok.
  const updateAssignmentLock = useCallback(async (assignmentId, patch) => {
    setMutationStatus(SAVING)
    try {
      const res = await fetch(`${API_BASE}/tda-lot-assignments/${assignmentId}/lock`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      })
      if (!res.ok) {
        const body = await res.json()
        setMutationStatus(errorState(body.detail || 'Failed to update lock.'))
        return
      }
      setMutationStatus(IDLE)
      fetchDetail()
    } catch (e) {
      setMutationStatus(errorState(e))
    }
  }, [fetchDetail])

  // Fix 1: collect all responses, surface the first failure if any.
  const addLotsToPool = useCallback(async (tdaId, lotIds) => {
    setMutationStatus(SAVING)
    try {
      const responses = await Promise.all(lotIds.map(id =>
        fetch(`${API_BASE}/takedown-agreements/${tdaId}/lots/${id}/pool`, { method: 'POST' })
      ))
      const failed = responses.find(r => !r.ok)
      if (failed) {
        const body = await failed.json()
        setMutationStatus(errorState(body.detail || 'Failed to add lots to pool.'))
        return
      }
      setMutationStatus(IDLE)
      fetchDetail()
      fetchUnassignedLots()
    } catch (e) {
      setMutationStatus(errorState(e))
    }
  }, [fetchDetail, fetchUnassignedLots])

  // Fix 1: collect all responses, surface the first failure if any.
  const removeLotsFromPool = useCallback(async (tdaId, lotIds) => {
    setMutationStatus(SAVING)
    try {
      const responses = await Promise.all(lotIds.map(id =>
        fetch(`${API_BASE}/takedown-agreements/${tdaId}/lots/${id}/pool`, { method: 'DELETE' })
      ))
      const failed = responses.find(r => !r.ok)
      if (failed) {
        const body = await failed.json()
        setMutationStatus(errorState(body.detail || 'Failed to remove lots from pool.'))
        return
      }
      setMutationStatus(IDLE)
      fetchDetail()
      fetchUnassignedLots()
    } catch (e) {
      setMutationStatus(errorState(e))
    }
  }, [fetchDetail, fetchUnassignedLots])

  // Fix 1: collect all responses, surface the first failure if any.
  const assignLotsToCheckpoint = useCallback(async (tdaId, lotIds, checkpointId) => {
    setMutationStatus(SAVING)
    try {
      const responses = await Promise.all(lotIds.map(id =>
        fetch(`${API_BASE}/takedown-agreements/${tdaId}/lots/${id}/assign`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ checkpoint_id: checkpointId }),
        })
      ))
      const failed = responses.find(r => !r.ok)
      if (failed) {
        const body = await failed.json()
        setMutationStatus(errorState(body.detail || 'Failed to assign lots.'))
        return
      }
      setMutationStatus(IDLE)
      fetchDetail()
    } catch (e) {
      setMutationStatus(errorState(e))
    }
  }, [fetchDetail])

  // Fix 1: read response, check res.ok.
  const unassignLotFromCheckpoint = useCallback(async (tdaId, lotId) => {
    setMutationStatus(SAVING)
    try {
      const res = await fetch(`${API_BASE}/takedown-agreements/${tdaId}/lots/${lotId}/assign`, { method: 'DELETE' })
      if (!res.ok) {
        const body = await res.json()
        setMutationStatus(errorState(body.detail || 'Failed to unassign lot.'))
        return
      }
      setMutationStatus(IDLE)
      fetchDetail()
    } catch (e) {
      setMutationStatus(errorState(e))
    }
  }, [fetchDetail])

  // Fix 2: source pool DELETE always runs — it removes the lot from the source TDA
  // (the backend handles checkpoint unassignment as part of the pool DELETE).
  // isAssigned is retained in the signature to avoid changing the call sites, but
  // it no longer gates the source DELETE.
  const moveLotToOtherTda = useCallback(async (sourceTdaId, targetTdaId, lotId, isAssigned) => { // eslint-disable-line no-unused-vars
    setMutationStatus(SAVING)
    try {
      const delRes = await fetch(`${API_BASE}/takedown-agreements/${sourceTdaId}/lots/${lotId}/pool`, { method: 'DELETE' })
      if (!delRes.ok) {
        const body = await delRes.json()
        setMutationStatus(errorState(body.detail || 'Failed to remove lot from source TDA.'))
        return
      }
      const addRes = await fetch(`${API_BASE}/takedown-agreements/${targetTdaId}/lots/${lotId}/pool`, { method: 'POST' })
      if (!addRes.ok) {
        const body = await addRes.json()
        setMutationStatus(errorState(body.detail || 'Failed to add lot to target TDA.'))
        return
      }
      setMutationStatus(IDLE)
      fetchAgreements()
      fetchDetail()
      fetchUnassignedLots()
    } catch (e) {
      setMutationStatus(errorState(e))
    }
  }, [fetchAgreements, fetchDetail, fetchUnassignedLots])

  return {
    // Read state
    agreements,
    entGroupName,
    selectedTdaId,
    setSelectedTdaId,
    detail,
    unassignedLots,
    loading,
    error,
    // Mutation status
    mutationStatus,
    // Mutations
    renameTda,
    createTda,
    createCheckpoint,
    updateAssignmentDates,
    updateAssignmentLock,
    addLotsToPool,
    removeLotsFromPool,
    assignLotsToCheckpoint,
    unassignLotFromCheckpoint,
    moveLotToOtherTda,
    // Explicit refetch (for drag end — hook triggers refetch internally for mutations)
    refetchDetail: fetchDetail,
    refetchAgreements: fetchAgreements,
  }
}
