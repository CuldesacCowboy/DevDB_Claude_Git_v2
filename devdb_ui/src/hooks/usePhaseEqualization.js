import { useState, useRef, useLayoutEffect } from 'react'

// Per-row dev container height equalization + solo-dev detection.
// After render, group containers by top position, equalize heights per row,
// and track which dev containers are alone on their row (for wider layout).
export function usePhaseEqualization({ pgGroups, availableWidth, expandedState, expansionVersion }) {
  const pgWrapperRef = useRef(null)
  const [soloDevIds, setSoloDevIds] = useState(new Set())

  useLayoutEffect(() => {
    if (!pgWrapperRef.current) return
    const containers = Array.from(pgWrapperRef.current.children)
    // Reset all heights first so natural sizes drive row grouping
    containers.forEach(el => { el.style.height = '' })
    // Group by top position (within 10px tolerance for sub-pixel variation)
    const rows = []
    containers.forEach(el => {
      const top = el.getBoundingClientRect().top
      const row = rows.find(r => Math.abs(r.top - top) < 10)
      if (row) row.els.push(el)
      else rows.push({ top, els: [el] })
    })
    // Equalize row heights
    rows.forEach(row => {
      const maxH = Math.max(...row.els.map(el => el.getBoundingClientRect().height))
      row.els.forEach(el => { el.style.height = maxH + 'px' })
    })
    // Track which devs are alone on their row so they get wider layout
    const newSoloIds = new Set(
      rows.filter(r => r.els.length === 1).map(r => r.els[0].dataset.devId)
    )
    setSoloDevIds(prev => {
      // Avoid unnecessary re-renders: only update if the set changed
      if (newSoloIds.size === prev.size && [...newSoloIds].every(id => prev.has(id))) return prev
      return newSoloIds
    })
  }, [pgGroups, availableWidth, expandedState, expansionVersion])

  return { pgWrapperRef, soloDevIds }
}
