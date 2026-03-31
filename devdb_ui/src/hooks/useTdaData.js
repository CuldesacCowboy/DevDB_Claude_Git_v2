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
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  // ── Mutation status ─────────────────────────────────────────────
  // Single status covers all in-flight mutations; operations are not concurrent
  // except for batch pool adds/removes which share the same status slot.
  const [mutationStatus, setMutationStatus] = useState(IDLE)

  // ── Fetch helpers ───────────────────────────────────────────────
  const fetchAgreements = useCallback((selectId = null) => {
    if (!entGroupId) return
    setLoading(true)
    fetch(`${API_BASE}/entitlement-groups/${entGroupId}/takedown-agreements`)
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
      .catch(e => { setError(e.message); setLoading(false) })
  }, [entGroupId])

  useEffect(() => { fetchAgreements() }, [fetchAgreements])

  const fetchDetail = useCallback(() => {
    if (!selectedTdaId) return
    fetch(`${API_BASE}/takedown-agreements/${selectedTdaId}/detail`)
      .then(r => r.json())
      .then(data => setDetail(data))
      .catch(e => setError(e.message))
  }, [selectedTdaId])

  useEffect(() => { fetchDetail() }, [fetchDetail])

  // ── Mutations ───────────────────────────────────────────────────

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

  const createCheckpoint = useCallback(async (tdaId, { checkpointDate, lotsRequired }) => {
    setMutationStatus(SAVING)
    try {
      await fetch(`${API_BASE}/takedown-agreements/${tdaId}/checkpoints`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          checkpoint_date: checkpointDate || null,
          lots_required_cumulative: parseInt(lotsRequired, 10) || 0,
        }),
      })
      setMutationStatus(IDLE)
      fetchDetail()
    } catch (e) {
      setMutationStatus(errorState(e))
    }
  }, [fetchDetail])

  const updateAssignmentDates = useCallback(async (assignmentId, patch) => {
    setMutationStatus(SAVING)
    try {
      await fetch(`${API_BASE}/tda-lot-assignments/${assignmentId}/dates`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      })
      setMutationStatus(IDLE)
      fetchDetail()
    } catch (e) {
      setMutationStatus(errorState(e))
    }
  }, [fetchDetail])

  const updateAssignmentLock = useCallback(async (assignmentId, patch) => {
    setMutationStatus(SAVING)
    try {
      await fetch(`${API_BASE}/tda-lot-assignments/${assignmentId}/lock`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      })
      setMutationStatus(IDLE)
      fetchDetail()
    } catch (e) {
      setMutationStatus(errorState(e))
    }
  }, [fetchDetail])

  const addLotsToPool = useCallback(async (tdaId, lotIds) => {
    setMutationStatus(SAVING)
    try {
      await Promise.all(lotIds.map(id =>
        fetch(`${API_BASE}/takedown-agreements/${tdaId}/lots/${id}/pool`, { method: 'POST' })
      ))
      setMutationStatus(IDLE)
      fetchDetail()
    } catch (e) {
      setMutationStatus(errorState(e))
    }
  }, [fetchDetail])

  const removeLotsFromPool = useCallback(async (tdaId, lotIds) => {
    setMutationStatus(SAVING)
    try {
      await Promise.all(lotIds.map(id =>
        fetch(`${API_BASE}/takedown-agreements/${tdaId}/lots/${id}/pool`, { method: 'DELETE' })
      ))
      setMutationStatus(IDLE)
      fetchDetail()
    } catch (e) {
      setMutationStatus(errorState(e))
    }
  }, [fetchDetail])

  const assignLotsToCheckpoint = useCallback(async (tdaId, lotIds, checkpointId) => {
    setMutationStatus(SAVING)
    try {
      await Promise.all(lotIds.map(id =>
        fetch(`${API_BASE}/takedown-agreements/${tdaId}/lots/${id}/assign`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ checkpoint_id: checkpointId }),
        })
      ))
      setMutationStatus(IDLE)
      fetchDetail()
    } catch (e) {
      setMutationStatus(errorState(e))
    }
  }, [fetchDetail])

  const unassignLotFromCheckpoint = useCallback(async (tdaId, lotId) => {
    setMutationStatus(SAVING)
    try {
      await fetch(`${API_BASE}/takedown-agreements/${tdaId}/lots/${lotId}/assign`, { method: 'DELETE' })
      setMutationStatus(IDLE)
      fetchDetail()
    } catch (e) {
      setMutationStatus(errorState(e))
    }
  }, [fetchDetail])

  // Move lot across TDAs: remove from source pool, add to target pool.
  // If lot is assigned to a checkpoint in the source TDA, unassign first.
  const moveLotToOtherTda = useCallback(async (sourceTdaId, targetTdaId, lotId, isAssigned) => {
    setMutationStatus(SAVING)
    try {
      if (isAssigned) {
        await fetch(`${API_BASE}/takedown-agreements/${sourceTdaId}/lots/${lotId}/pool`, { method: 'DELETE' })
      }
      await fetch(`${API_BASE}/takedown-agreements/${targetTdaId}/lots/${lotId}/pool`, { method: 'POST' })
      setMutationStatus(IDLE)
      fetchAgreements()
      fetchDetail()
    } catch (e) {
      setMutationStatus(errorState(e))
    }
  }, [fetchAgreements, fetchDetail])

  return {
    // Read state
    agreements,
    entGroupName,
    selectedTdaId,
    setSelectedTdaId,
    detail,
    loading,
    error,
    // Mutation status
    mutationStatus,
    // Mutations
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
