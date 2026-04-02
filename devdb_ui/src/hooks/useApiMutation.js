// hooks/useApiMutation.js
// Shared mutation lifecycle: fetch, res.ok check, body.detail error extraction,
// onSuccess callback, and mutationStatus state management.
//
// mutate(url, fetchOptions, { errorMsg, onSuccess })
//   Single-request mutation. Returns { ok, data, error }.
//   Calls onSuccess(data) on success.
//
// mutateMany(fetchPromises, { errorMsg, onSuccess })
//   Parallel-request mutation. Pass already-started fetch promises.
//   Returns { ok, error }. Calls onSuccess() on success.

import { useState, useCallback } from 'react'

const IDLE   = { status: 'idle',   error: null }
const SAVING = { status: 'saving', error: null }

function errorState(e) {
  return { status: 'error', error: typeof e === 'string' ? e : (e?.message ?? 'Unknown error') }
}

export function useApiMutation() {
  const [mutationStatus, setStatus] = useState(IDLE)

  const mutate = useCallback(async (url, fetchOptions = {}, { errorMsg = 'Request failed.', onSuccess } = {}) => {
    setStatus(SAVING)
    try {
      const res = await fetch(url, {
        headers: { 'Content-Type': 'application/json' },
        ...fetchOptions,
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        const msg = body.detail || errorMsg
        setStatus(errorState(msg))
        return { ok: false, error: msg }
      }
      const data = await res.json().catch(() => null)
      setStatus(IDLE)
      onSuccess?.(data)
      return { ok: true, data }
    } catch (e) {
      setStatus(errorState(e))
      return { ok: false, error: e.message }
    }
  }, [])

  const mutateMany = useCallback(async (requests, { errorMsg = 'Request failed.', onSuccess } = {}) => {
    setStatus(SAVING)
    try {
      const responses = await Promise.all(requests)
      const failed = responses.find(r => !r.ok)
      if (failed) {
        const body = await failed.json().catch(() => ({}))
        const msg = body.detail || errorMsg
        setStatus(errorState(msg))
        return { ok: false, error: msg }
      }
      setStatus(IDLE)
      onSuccess?.()
      return { ok: true }
    } catch (e) {
      setStatus(errorState(e))
      return { ok: false, error: e.message }
    }
  }, [])

  return { mutate, mutateMany, mutationStatus }
}
