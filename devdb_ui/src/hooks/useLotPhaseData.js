import { useState, useEffect, useCallback } from 'react'
import { buildDevColorMap } from '../components/InstrumentContainer'

const LEFT_PANELS_WIDTH = 340

export function useLotPhaseData(entGroupId) {
  // ── All useState calls first, in fixed order ──────────────────────────────
  const [instruments, setInstruments] = useState([])
  const [pgOrder, setPgOrder] = useState([])
  const [unassignedPhases, setUnassignedPhases] = useState([])
  const [unassigned, setUnassigned] = useState([])
  const [entGroup, setEntGroup] = useState(null)
  const [devColorMap, setDevColorMap] = useState({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [availableWidth, setAvailableWidth] = useState(
    () => window.innerWidth - LEFT_PANELS_WIDTH
  )

  // ── useCallback after all useState ────────────────────────────────────────
  // Named fetch function — stable per entGroupId, returned as refetch.
  const fetchData = useCallback(() => {
    setLoading(true)
    setError(null)
    setEntGroup(null)
    setInstruments([])
    setPgOrder([])
    setUnassignedPhases([])
    setUnassigned([])

    fetch(`/api/entitlement-groups/${entGroupId}/lot-phase-view`)
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        return r.json()
      })
      .then((data) => {
        const instrs = data.instruments.map((instr) => ({
          ...instr,
          phases: instr.phases.map((p) => ({
            ...p,
            lots: p.lots.map((l) => ({ ...l, phase_id: p.phase_id })),
          })),
        }))
        const unassignedPhs = (data.unassigned_phases ?? []).map((p) => ({
          ...p,
          lots: p.lots.map((l) => ({ ...l, phase_id: p.phase_id })),
        }))

        const allDevIds = instrs.map((i) => i.dev_id)
        setDevColorMap(buildDevColorMap(allDevIds))
        setPgOrder([...new Set(allDevIds)])
        setEntGroup({ ent_group_id: data.ent_group_id, ent_group_name: data.ent_group_name })
        setInstruments(instrs)
        setUnassignedPhases(unassignedPhs)
        setUnassigned((data.unassigned ?? []).map((l) => ({ ...l, phase_id: null })))
        setLoading(false)
      })
      .catch((err) => {
        setError(err.message)
        setLoading(false)
      })
  }, [entGroupId])

  // ── All useEffect calls after useState and useCallback ────────────────────

  // Fetch on mount and whenever entGroupId changes
  useEffect(() => {
    fetchData()
  }, [fetchData])

  // Debounced resize listener
  useEffect(() => {
    let timer
    function handleResize() {
      clearTimeout(timer)
      timer = setTimeout(() => {
        setAvailableWidth(window.innerWidth - LEFT_PANELS_WIDTH)
      }, 100)
    }
    window.addEventListener('resize', handleResize)
    return () => {
      window.removeEventListener('resize', handleResize)
      clearTimeout(timer)
    }
  }, [])

  // ── Derived values (no hooks) ─────────────────────────────────────────────
  const pgGroups = pgOrder.map((devId) => {
    const devInstrs = instruments.filter((i) => i.dev_id === devId)
    const devName = devInstrs[0]?.dev_name ?? `Dev ${devId}`
    return { devId, devName, instruments: devInstrs }
  })

  return {
    instruments,
    setInstruments,
    pgGroups,
    pgOrder,
    setPgOrder,
    unassignedPhases,
    setUnassignedPhases,
    unassigned,
    setUnassigned,
    entGroup,
    devColorMap,
    availableWidth,
    loading,
    error,
    refetch: fetchData,
  }
}
