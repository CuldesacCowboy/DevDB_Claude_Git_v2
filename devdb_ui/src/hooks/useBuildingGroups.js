// useBuildingGroups.js
// Building group state and operations for SitePlanView.
// Owns: buildingGroups, selectedBgIds, pendingBuildingGroup, bgContextMenu, showBuildingGroups.

import { useState, useEffect, useCallback } from 'react'
import { pointInPolygon } from '../components/SitePlan/splitPolygon'
import { API_BASE } from '../config'

export function useBuildingGroups({ plan, lotPositions, allLots, boundaries, phases, mode, setMode }) {
  const [buildingGroups, setBuildingGroups]             = useState([])
  const [selectedBgIds, setSelectedBgIds]               = useState(new Set())
  const [pendingBuildingGroup, setPendingBuildingGroup] = useState(null)
  const [bgContextMenu, setBgContextMenu]               = useState(null)
  const [showBuildingGroups, setShowBuildingGroups]     = useState(() => {
    try { return localStorage.getItem('devdb_siteplan_show_bg') === 'true' } catch { return false }
  })

  useEffect(() => {
    if (!plan || !showBuildingGroups) { setBuildingGroups([]); return }
    fetch(`${API_BASE}/building-groups/plan/${plan.plan_id}`)
      .then(r => r.ok ? r.json() : [])
      .then(setBuildingGroups)
      .catch(() => setBuildingGroups([]))
  }, [plan?.plan_id, showBuildingGroups])

  async function loadBuildingGroups() {
    if (!plan) return
    const res = await fetch(`${API_BASE}/building-groups/plan/${plan.plan_id}`)
    if (res.ok) setBuildingGroups(await res.json())
  }

  function findPhaseForPosition(x, y) {
    for (const b of boundaries) {
      const poly = JSON.parse(b.polygon_json)
      if (pointInPolygon(x, y, poly)) return b.phase_id
    }
    return undefined
  }

  // ─── Toggle ────────────────────────────────────────────────────────────────

  function toggleShowBuildingGroups() {
    setShowBuildingGroups(prev => {
      const next = !prev
      try { localStorage.setItem('devdb_siteplan_show_bg', String(next)) } catch {}
      if (!next) {
        setBuildingGroups([])
        setSelectedBgIds(new Set())
        setPendingBuildingGroup(null)
        setBgContextMenu(null)
        if (mode === 'draw-building' || mode === 'delete-building') setMode('view')
      }
      return next
    })
  }

  // ─── Draw ──────────────────────────────────────────────────────────────────

  const handleBuildingGroupDrawn = useCallback((polygon) => {
    if (!polygon || polygon.length < 3) return

    const firstPhaseId = (() => {
      for (const b of boundaries) {
        const poly = JSON.parse(b.polygon_json)
        if (pointInPolygon(polygon[0].x, polygon[0].y, poly)) return b.phase_id
      }
      return undefined
    })()

    const assignedLotIds = new Set()
    for (const bg of buildingGroups) {
      for (const l of bg.lots) assignedLotIds.add(l.lot_id)
    }

    const insideLots = []
    for (const [lotIdStr, pos] of Object.entries(lotPositions)) {
      const lotId = Number(lotIdStr)
      if (assignedLotIds.has(lotId)) continue
      if (!pointInPolygon(pos.x, pos.y, polygon)) continue
      const lotPhase = (() => {
        for (const b of boundaries) {
          const poly = JSON.parse(b.polygon_json)
          if (pointInPolygon(pos.x, pos.y, poly)) return b.phase_id
        }
        return undefined
      })()
      if (firstPhaseId !== undefined && lotPhase !== firstPhaseId) continue
      const meta = allLots.find(l => l.lot_id === lotId)
      if (meta) insideLots.push({ lot_id: lotId, lot_number: meta.lot_number, phase_id: meta.phase_id })
    }

    if (!insideLots.length) return
    setPendingBuildingGroup({ lots: insideLots, polygon, phaseId: firstPhaseId })
  }, [buildingGroups, lotPositions, allLots, boundaries]) // eslint-disable-line react-hooks/exhaustive-deps

  async function handleBuildingGroupConfirm() {
    if (!pendingBuildingGroup || !plan) return
    const { lots } = pendingBuildingGroup
    const firstLot  = allLots.find(l => l.lot_id === lots[0].lot_id)
    const phaseInfo = phases.find(p => p.phase_id === firstLot?.phase_id)
    const devId     = phaseInfo?.dev_id ?? 0
    try {
      const res = await fetch(`${API_BASE}/building-groups`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lot_ids: lots.map(l => l.lot_id), dev_id: devId, plan_id: plan.plan_id }),
      })
      if (res.ok) {
        setPendingBuildingGroup(null)
        setMode('view')
        await loadBuildingGroups()
      }
    } catch { /* ignore */ }
  }

  function handleBuildingGroupCancel() {
    setPendingBuildingGroup(null)
    setMode('view')
  }

  // ─── Select / delete ───────────────────────────────────────────────────────

  const handleBuildingGroupSelect = useCallback((id) => {
    setSelectedBgIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  async function handleDeleteSelectedBuildingGroups() {
    const ids = [...selectedBgIds]
    if (!ids.length) return
    try {
      const res = await fetch(`${API_BASE}/building-groups/bulk-delete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ building_group_ids: ids }),
      })
      if (res.ok) {
        setSelectedBgIds(new Set())
        setMode('view')
        await loadBuildingGroups()
      }
    } catch { /* ignore */ }
  }

  async function handleDeleteSingleBuildingGroup(id) {
    try {
      const res = await fetch(`${API_BASE}/building-groups/${id}`, { method: 'DELETE' })
      if (res.ok) {
        setSelectedBgIds(prev => { const next = new Set(prev); next.delete(id); return next })
        setBgContextMenu(null)
        await loadBuildingGroups()
      }
    } catch { /* ignore */ }
  }

  const handleBuildingGroupContextMenu = useCallback((id, x, y) => {
    setBgContextMenu({ id, x, y })
  }, [])

  return {
    buildingGroups,
    selectedBgIds,
    setSelectedBgIds,
    pendingBuildingGroup,
    clearPendingBuildingGroup: () => setPendingBuildingGroup(null),
    bgContextMenu,
    setBgContextMenu,
    showBuildingGroups,
    toggleShowBuildingGroups,
    handleBuildingGroupDrawn,
    handleBuildingGroupConfirm,
    handleBuildingGroupCancel,
    handleBuildingGroupSelect,
    handleDeleteSelectedBuildingGroups,
    handleDeleteSingleBuildingGroup,
    handleBuildingGroupContextMenu,
  }
}
