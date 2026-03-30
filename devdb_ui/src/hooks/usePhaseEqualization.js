import { useState, useRef, useLayoutEffect } from 'react'

// Per-row dev container height equalization + solo-dev detection.
// After render, group containers by top position, equalize heights per row,
// and track which dev containers are alone on their row (for wider layout).
export function usePhaseEqualization({ pgGroups, availableWidth, expandedState }) {
  const pgWrapperRef = useRef(null)
  const [soloDevIds, setSoloDevIds] = useState(new Set())

  useLayoutEffect(() => {
    if (!pgWrapperRef.current) return
    const containers = Array.from(pgWrapperRef.current.children)
    // Step B: Reset all to 'auto' BEFORE the rAF so the browser reflows
    // natural content heights before we measure. Clear minHeight too so
    // the previous equalization floor doesn't suppress the natural height.
    containers.forEach(el => { el.style.height = 'auto'; el.style.minHeight = '' })
    // Step C-E: Measure and equalize AFTER reflow
    requestAnimationFrame(() => {
      if (!pgWrapperRef.current) return
      // Group by top position (within 10px tolerance for sub-pixel variation)
      const rows = []
      containers.forEach(el => {
        const top = el.getBoundingClientRect().top
        const row = rows.find(r => Math.abs(r.top - top) < 10)
        if (row) row.els.push(el)
        else rows.push({ top, els: [el] })
      })
      // Equalize row heights using min-height so containers can still grow
      // when inline forms (add product type, delete confirm) expand their content.
      rows.forEach(row => {
        const maxH = Math.max(...row.els.map(el => el.getBoundingClientRect().height))
        row.els.forEach(el => { el.style.minHeight = maxH + 'px' })
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
    })
  }, [pgGroups, availableWidth, expandedState])

  return { pgWrapperRef, soloDevIds }
}
