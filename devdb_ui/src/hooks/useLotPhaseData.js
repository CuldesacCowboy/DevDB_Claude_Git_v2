import { useState, useEffect, useCallback, useMemo } from 'react'
import { API_BASE } from '../config'
import { buildDevColorMap } from '../components/InstrumentContainer'

const LEFT_PANELS_WIDTH = 340

export function useLotPhaseData(entGroupId) {
  // 1. ALL useState calls — unconditional, fixed order
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

  // 2. useCallback — unconditional
  const fetchData = useCallback(async () => {
    if (!entGroupId) return
    setLoading(true)
    setError(null)
    setEntGroup(null)
    setInstruments([])
    setPgOrder([])
    setUnassignedPhases([])
    setUnassigned([])
    try {
      const r = await fetch(`${API_BASE}/entitlement-groups/${entGroupId}/lot-phase-view`)
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      const data = await r.json()
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
      // Apply saved instrument order from localStorage (survives refresh)
      try {
        const saved = localStorage.getItem(`devdb_instr_order_${entGroupId}`)
        if (saved) {
          const savedIds = JSON.parse(saved)
          const idMap = Object.fromEntries(instrs.map(i => [i.instrument_id, i]))
          const ordered = savedIds.filter(id => idMap[id]).map(id => idMap[id])
          const added = instrs.filter(i => !savedIds.includes(i.instrument_id))
          setInstruments([...ordered, ...added])
        } else {
          setInstruments(instrs)
        }
      } catch {
        setInstruments(instrs)
      }
      setUnassignedPhases(unassignedPhs)
      setUnassigned((data.unassigned ?? []).map((l) => ({ ...l, phase_id: null })))
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [entGroupId])

  // 3. useEffect for data fetch — unconditional
  useEffect(() => {
    fetchData()
  }, [fetchData])

  // 4. useEffect for resize — unconditional
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

  // 5. useMemo — unconditional
  const pgGroups = useMemo(() => {
    return pgOrder.map((devId) => {
      const devInstrs = instruments.filter((i) => i.dev_id === devId)
      const devName = devInstrs[0]?.dev_name ?? `Dev ${devId}`
      return { devId, devName, instruments: devInstrs }
    })
  }, [pgOrder, instruments])

  // 6. Return — always the same shape
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
