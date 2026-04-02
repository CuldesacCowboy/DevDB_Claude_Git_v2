import { useState, useEffect, useCallback } from 'react'
import { API_BASE } from '../config'
import { useApiMutation } from './useApiMutation'

export function useTdaData(entGroupId) {
  // ── Read state ──────────────────────────────────────────────────
  const [agreements, setAgreements] = useState([])
  const [selectedTdaId, setSelectedTdaId] = useState(null)
  const [detail, setDetail] = useState(null)
  const [entGroupName, setEntGroupName] = useState('')
  const [unassignedLots, setUnassignedLots] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  // ── Mutation lifecycle ─────────────────────────────────────────
  // Single status covers all in-flight mutations; operations are not concurrent
  // except for batch pool adds/removes which share the same status slot.
  const { mutate, mutateMany, mutationStatus } = useApiMutation()

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

  // AbortController prevents stale responses from landing after entGroupId changes.
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

  // AbortController prevents stale detail responses from landing after TDA switches.
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
    return mutate(
      `${API_BASE}/takedown-agreements/${tdaId}`,
      { method: 'PATCH', body: JSON.stringify({ tda_name: trimmed }) },
      {
        errorMsg: 'Failed to rename.',
        onSuccess: () => { fetchAgreements(tdaId); if (tdaId === selectedTdaId) fetchDetail() },
      }
    )
  }, [mutate, fetchAgreements, fetchDetail, selectedTdaId])

  const createTda = useCallback(async (name) => {
    if (!name?.trim()) return { ok: false, error: 'Name is required.' }
    const result = await mutate(
      `${API_BASE}/takedown-agreements`,
      { method: 'POST', body: JSON.stringify({ tda_name: name.trim(), ent_group_id: entGroupId }) },
      {
        errorMsg: 'Failed to create agreement.',
        onSuccess: (data) => fetchAgreements(data?.tda_id),
      }
    )
    if (result.ok) return { ok: true, tda_id: result.data?.tda_id }
    return result
  }, [mutate, entGroupId, fetchAgreements])

  const createCheckpoint = useCallback(async (tdaId, { checkpointDate, lotsRequired }) => {
    await mutate(
      `${API_BASE}/takedown-agreements/${tdaId}/checkpoints`,
      {
        method: 'POST',
        body: JSON.stringify({
          checkpoint_date: checkpointDate || null,
          lots_required_cumulative: parseInt(lotsRequired, 10) || 0,
        }),
      },
      { errorMsg: 'Failed to create checkpoint.', onSuccess: fetchDetail }
    )
  }, [mutate, fetchDetail])

  const updateAssignmentDates = useCallback(async (assignmentId, patch) => {
    await mutate(
      `${API_BASE}/tda-lot-assignments/${assignmentId}/dates`,
      { method: 'PATCH', body: JSON.stringify(patch) },
      { errorMsg: 'Failed to update dates.', onSuccess: fetchDetail }
    )
  }, [mutate, fetchDetail])

  const updateAssignmentLock = useCallback(async (assignmentId, patch) => {
    await mutate(
      `${API_BASE}/tda-lot-assignments/${assignmentId}/lock`,
      { method: 'PATCH', body: JSON.stringify(patch) },
      { errorMsg: 'Failed to update lock.', onSuccess: fetchDetail }
    )
  }, [mutate, fetchDetail])

  const addLotsToPool = useCallback(async (tdaId, lotIds) => {
    await mutateMany(
      lotIds.map(id => fetch(`${API_BASE}/takedown-agreements/${tdaId}/lots/${id}/pool`, { method: 'POST' })),
      { errorMsg: 'Failed to add lots to pool.', onSuccess: () => { fetchDetail(); fetchUnassignedLots() } }
    )
  }, [mutateMany, fetchDetail, fetchUnassignedLots])

  const removeLotsFromPool = useCallback(async (tdaId, lotIds) => {
    await mutateMany(
      lotIds.map(id => fetch(`${API_BASE}/takedown-agreements/${tdaId}/lots/${id}/pool`, { method: 'DELETE' })),
      { errorMsg: 'Failed to remove lots from pool.', onSuccess: () => { fetchDetail(); fetchUnassignedLots() } }
    )
  }, [mutateMany, fetchDetail, fetchUnassignedLots])

  const assignLotsToCheckpoint = useCallback(async (tdaId, lotIds, checkpointId) => {
    await mutateMany(
      lotIds.map(id => fetch(`${API_BASE}/takedown-agreements/${tdaId}/lots/${id}/assign`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ checkpoint_id: checkpointId }),
      })),
      { errorMsg: 'Failed to assign lots.', onSuccess: fetchDetail }
    )
  }, [mutateMany, fetchDetail])

  const unassignLotFromCheckpoint = useCallback(async (tdaId, lotId) => {
    await mutate(
      `${API_BASE}/takedown-agreements/${tdaId}/lots/${lotId}/assign`,
      { method: 'DELETE' },
      { errorMsg: 'Failed to unassign lot.', onSuccess: fetchDetail }
    )
  }, [mutate, fetchDetail])

  const moveLotToOtherTda = useCallback(async (sourceTdaId, targetTdaId, lotId, isAssigned) => { // eslint-disable-line no-unused-vars
    const del = await mutate(
      `${API_BASE}/takedown-agreements/${sourceTdaId}/lots/${lotId}/pool`,
      { method: 'DELETE' },
      { errorMsg: 'Failed to remove lot from source TDA.' }
    )
    if (!del.ok) return
    await mutate(
      `${API_BASE}/takedown-agreements/${targetTdaId}/lots/${lotId}/pool`,
      { method: 'POST' },
      {
        errorMsg: 'Failed to add lot to target TDA.',
        onSuccess: () => { fetchAgreements(); fetchDetail(); fetchUnassignedLots() },
      }
    )
  }, [mutate, fetchAgreements, fetchDetail, fetchUnassignedLots])

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
