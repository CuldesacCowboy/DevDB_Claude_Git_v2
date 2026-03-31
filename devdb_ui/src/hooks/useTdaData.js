import { useState, useEffect, useCallback } from 'react'
import { API_BASE } from '../config'

export function useTdaData(entGroupId) {
  const [agreements, setAgreements] = useState([])
  const [selectedTdaId, setSelectedTdaId] = useState(null)
  const [detail, setDetail] = useState(null)
  const [entGroupName, setEntGroupName] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

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

  // Fetch detail for selected TDA
  const fetchDetail = useCallback(() => {
    if (!selectedTdaId) return
    fetch(`${API_BASE}/takedown-agreements/${selectedTdaId}/detail`)
      .then(r => r.json())
      .then(data => setDetail(data))
      .catch(e => setError(e.message))
  }, [selectedTdaId])

  useEffect(() => { fetchDetail() }, [fetchDetail])

  return {
    agreements, entGroupName,
    selectedTdaId, setSelectedTdaId,
    detail, refetchDetail: fetchDetail,
    refetchAgreements: fetchAgreements,
    loading, error,
  }
}
