// useOverrides.js — fetch, apply, clear, and export lot date overrides.
import { useState, useCallback } from 'react'
import { API_BASE } from '../config'

export function useOverrides(entGroupId) {
  const [overrides, setOverrides]   = useState([])
  const [loading, setLoading]       = useState(false)
  const [reconciliation, setRecon]  = useState([])

  const fetchOverrides = useCallback(async () => {
    if (!entGroupId) return
    setLoading(true)
    try {
      const res = await fetch(`${API_BASE}/overrides?ent_group_id=${entGroupId}`)
      const data = await res.json()
      setOverrides(Array.isArray(data) ? data : [])
    } finally {
      setLoading(false)
    }
  }, [entGroupId])

  const previewOverride = useCallback(async (lotId, dateField, overrideValue) => {
    const res = await fetch(`${API_BASE}/overrides/preview`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ lot_id: lotId, date_field: dateField, override_value: overrideValue }),
    })
    if (!res.ok) throw new Error(await res.text())
    return res.json()
  }, [])

  const applyOverrides = useCallback(async (lotId, changes) => {
    const res = await fetch(`${API_BASE}/overrides/apply`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ lot_id: lotId, changes }),
    })
    if (!res.ok) throw new Error(await res.text())
    const data = await res.json()
    await fetchOverrides()
    return data
  }, [fetchOverrides])

  const clearOverride = useCallback(async (lotId, dateField) => {
    await fetch(`${API_BASE}/overrides/${lotId}/${dateField}`, { method: 'DELETE' })
    await fetchOverrides()
  }, [fetchOverrides])

  const clearBatch = useCallback(async ({ overrideIds, lotIds } = {}) => {
    await fetch(`${API_BASE}/overrides/clear-batch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ override_ids: overrideIds, lot_ids: lotIds }),
    })
    await fetchOverrides()
    setRecon([])
  }, [fetchOverrides])

  const fetchReconciliation = useCallback(async (nDays = 7) => {
    if (!entGroupId) return
    const res = await fetch(
      `${API_BASE}/overrides/reconciliation?ent_group_id=${entGroupId}&n_days=${nDays}`
    )
    const data = await res.json()
    setRecon(Array.isArray(data) ? data : [])
    return data
  }, [entGroupId])

  const exportOverrides = useCallback(async () => {
    if (!entGroupId) return []
    const res = await fetch(`${API_BASE}/overrides/export?ent_group_id=${entGroupId}`)
    return res.json()
  }, [entGroupId])

  return {
    overrides, loading,
    reconciliation, setRecon,
    fetchOverrides,
    previewOverride,
    applyOverrides,
    clearOverride,
    clearBatch,
    fetchReconciliation,
    exportOverrides,
  }
}
