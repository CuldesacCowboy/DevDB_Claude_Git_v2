// PdfCanvas.jsx
// PDF viewer with pan/zoom/rotation, parcel trace+edit, and phase boundary split.
//
// Props:
//   pdfUrl          — URL of the PDF
//   planId          — for saving parcel / split results
//   initialParcel   — [{x,y}] or null
//   boundaries      — [{boundary_id, polygon_json, phase_id, label, split_order}]
//   selectedBoundaryId — boundary highlighted for assignment (controlled by SitePlanView)
//   mode            — 'view'|'trace'|'edit'|'split'
//   onModeChange    — (mode) => void
//   onParcelSaved   — (points) => void
//   onSplitConfirm  — (originalId, polyA, polyB) => void
//   onBoundarySelect — (boundary_id | null) => void

import { useEffect, useRef, useState, useCallback } from 'react'
import * as pdfjsLib from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.mjs?url'
import {
  distToSeg, snapToBoundaries, findFirstBoundaryIntersection, splitPolygon,
} from './splitPolygon'

pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl

const RENDER_SCALE   = 2.0
const MIN_ZOOM       = 0.1
const MAX_ZOOM       = 8.0
const SNAP_TRACE_PX      = 16    // snap-to-first ring in trace mode
const DRAG_THRESHOLD     = 5
const VERTEX_HIT_PX      = 12
const EDGE_HIT_PX        = 8
const SNAP_SPLIT_PX      = 18    // snap to boundary edge in split mode
const SNAP_VERTEX_EDIT_PX = 14   // snap-to-vertex while dragging in edit mode
const SHARED_VERTEX_TOL  = 1e-5  // normalized-space tolerance for "same vertex"

// Colour palette for boundary polygons
const BOUNDARY_COLORS = [
  '#3b82f6','#10b981','#f97316','#8b5cf6','#06b6d4',
  '#ec4899','#84cc16','#eab308','#ef4444','#6366f1',
]
function boundaryColor(idx) { return BOUNDARY_COLORS[idx % BOUNDARY_COLORS.length] }

// ─── Parcel edit hit detection (SVG space) ────────────────────────────────────
function getEditTarget(sx, sy, svgPts) {
  for (let i = 0; i < svgPts.length; i++) {
    if (Math.hypot(svgPts[i].x - sx, svgPts[i].y - sy) < VERTEX_HIT_PX)
      return { type: 'vertex', idx: i }
  }
  for (let i = 0; i < svgPts.length; i++) {
    const a = svgPts[i], b = svgPts[(i + 1) % svgPts.length]
    const { dist, cx, cy } = distToSeg(sx, sy, a.x, a.y, b.x, b.y)
    if (dist < EDGE_HIT_PX) return { type: 'edge', idx: i, point: { x: cx, y: cy } }
  }
  return null
}

export default function PdfCanvas({
  pdfUrl, planId, initialParcel,
  boundaries = [],
  selectedBoundaryId,
  mode, onModeChange,
  onParcelSaved, onSplitConfirm, onBoundarySelect, onBoundaryUpdated,
}) {
  const canvasRef    = useRef(null)
  const containerRef = useRef(null)

  const [cssDims, setCssDims]       = useState(null)
  const [pan, setPan]               = useState({ x: 0, y: 0 })
  const [zoom, setZoom]             = useState(1.0)
  const [rotation, setRotation]     = useState(0)

  // Parcel
  const [savedParcel, setSavedParcel] = useState(initialParcel || null)

  // Trace
  const [tracePoints, setTracePoints] = useState([])
  const [cursorNorm, setCursorNorm]   = useState(null)

  // Parcel + boundary edit
  const [editPoints, setEditPoints]                 = useState(null)
  const [editBoundaryPoints, setEditBoundaryPoints] = useState({}) // {boundaryId: [{x,y}]}
  const [hoverTarget, setHoverTarget]               = useState(null)
  const [editSnapSvg, setEditSnapSvg]               = useState(null) // snap indicator while dragging

  // Split
  // phase: 'idle' | 'drawing' | 'review'
  const [splitPhase, setSplitPhase]       = useState('idle')
  const [splitLine, setSplitLine]         = useState([])   // [{x,y}] normalized
  const [splitCursorSvg, setSplitCursorSvg] = useState(null)
  const [splitSnapSvg, setSplitSnapSvg]   = useState(null) // snap indicator SVG pos
  const [splitTargetId, setSplitTargetId] = useState(null) // which boundary being split

  // Interaction refs
  const dragRef  = useRef(null)
  const traceRef = useRef(null)
  const editRef  = useRef(null)

  useEffect(() => { setSavedParcel(initialParcel || null) }, [initialParcel])

  // Reset mode-local state on mode change
  useEffect(() => {
    setTracePoints([]); setCursorNorm(null); traceRef.current = null
    setEditPoints(null); setEditBoundaryPoints({}); setHoverTarget(null); setEditSnapSvg(null); editRef.current = null
    setSplitPhase('idle'); setSplitLine([]); setSplitCursorSvg(null)
    setSplitSnapSvg(null); setSplitTargetId(null)

    if (mode === 'edit') {
      setEditPoints(savedParcel ? [...savedParcel] : null)
      const bpts = {}
      for (const b of boundaries) bpts[b.boundary_id] = JSON.parse(b.polygon_json)
      setEditBoundaryPoints(bpts)
    }
  }, [mode]) // eslint-disable-line react-hooks/exhaustive-deps

  // ─── PDF load ────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!pdfUrl) return
    let cancelled = false
    async function load() {
      const pdf  = await pdfjsLib.getDocument(pdfUrl).promise
      if (cancelled) return
      const page = await pdf.getPage(1)
      if (cancelled) return
      const vp   = page.getViewport({ scale: RENDER_SCALE, rotation })
      const cv   = canvasRef.current
      cv.width = vp.width; cv.height = vp.height
      await page.render({ canvasContext: cv.getContext('2d'), viewport: vp }).promise
      if (cancelled) return
      const w = vp.width / RENDER_SCALE, h = vp.height / RENDER_SCALE
      setCssDims({ width: w, height: h })
      const el = containerRef.current
      if (el) {
        const fit = Math.min(el.clientWidth / w, el.clientHeight / h, 1.0)
        setZoom(fit)
        setPan({ x: (el.clientWidth - w * fit) / 2, y: (el.clientHeight - h * fit) / 2 })
      }
    }
    load()
    return () => { cancelled = true }
  }, [pdfUrl, rotation])

  // ─── Coord helpers ────────────────────────────────────────────────────────────
  const screenToNorm = useCallback((sx, sy) => {
    if (!cssDims) return null
    return { x: (sx - pan.x) / zoom / cssDims.width, y: (sy - pan.y) / zoom / cssDims.height }
  }, [cssDims, pan, zoom])

  const normToScreen = useCallback((nx, ny) => {
    if (!cssDims) return { x: 0, y: 0 }
    return { x: nx * cssDims.width * zoom + pan.x, y: ny * cssDims.height * zoom + pan.y }
  }, [cssDims, pan, zoom])

  function svgXY(e) {
    const rect = containerRef.current.getBoundingClientRect()
    return { sx: e.clientX - rect.left, sy: e.clientY - rect.top }
  }

  // ─── Zoom ─────────────────────────────────────────────────────────────────────
  function handleWheel(e) {
    e.preventDefault()
    const { sx: cx, sy: cy } = svgXY(e)
    const factor  = e.deltaY < 0 ? 1.12 : 1 / 1.12
    const nz      = Math.min(Math.max(zoom * factor, MIN_ZOOM), MAX_ZOOM)
    const ratio   = nz / zoom
    setPan(p => ({ x: cx - (cx - p.x) * ratio, y: cy - (cy - p.y) * ratio }))
    setZoom(nz)
  }
  function zoomBy(factor) {
    if (!containerRef.current) return
    const { width: cw, height: ch } = containerRef.current.getBoundingClientRect()
    const nz = Math.min(Math.max(zoom * factor, MIN_ZOOM), MAX_ZOOM)
    const r  = nz / zoom
    setPan(p => ({ x: cw/2 - (cw/2 - p.x) * r, y: ch/2 - (ch/2 - p.y) * r }))
    setZoom(nz)
  }
  function resetView() {
    if (!cssDims || !containerRef.current) return
    const { clientWidth: cw, clientHeight: ch } = containerRef.current
    const fit = Math.min(cw / cssDims.width, ch / cssDims.height, 1.0)
    setZoom(fit)
    setPan({ x: (cw - cssDims.width * fit) / 2, y: (ch - cssDims.height * fit) / 2 })
  }

  // ─── View pan ─────────────────────────────────────────────────────────────────
  function handlePointerDown(e) {
    if (e.button !== 0 || mode !== 'view') return
    e.currentTarget.setPointerCapture(e.pointerId)
    dragRef.current = { startX: e.clientX, startY: e.clientY, startPanX: pan.x, startPanY: pan.y }
  }
  function handlePointerMove(e) {
    if (!dragRef.current) return
    setPan({ x: dragRef.current.startPanX + (e.clientX - dragRef.current.startX), y: dragRef.current.startPanY + (e.clientY - dragRef.current.startY) })
  }
  function handlePointerUp() { dragRef.current = null }

  // ─── Trace ────────────────────────────────────────────────────────────────────
  function handleTraceDown(e) {
    if (e.button !== 0) return
    e.currentTarget.setPointerCapture(e.pointerId)
    traceRef.current = { startX: e.clientX, startY: e.clientY, startPanX: pan.x, startPanY: pan.y, moved: false }
  }
  function handleTraceMove(e) {
    const ref = traceRef.current
    const { sx, sy } = svgXY(e)
    setCursorNorm(screenToNorm(sx, sy))
    if (!ref) return
    const dx = e.clientX - ref.startX, dy = e.clientY - ref.startY
    if (Math.hypot(dx, dy) > DRAG_THRESHOLD) { ref.moved = true; setPan({ x: ref.startPanX + dx, y: ref.startPanY + dy }) }
  }
  function handleTraceUp(e) {
    const ref = traceRef.current; traceRef.current = null
    if (!ref || ref.moved) return
    const { sx, sy } = svgXY(e)
    const norm = screenToNorm(sx, sy)
    if (!norm) return
    if (tracePoints.length >= 3) {
      const first = normToScreen(tracePoints[0].x, tracePoints[0].y)
      if (Math.hypot(first.x - sx, first.y - sy) < SNAP_TRACE_PX) { closeTrace(); return }
    }
    setTracePoints(pts => [...pts, norm])
  }
  async function closeTrace() {
    if (tracePoints.length < 3) return
    const pts = tracePoints
    setTracePoints([]); setCursorNorm(null); onModeChange('view')
    setSavedParcel(pts); onParcelSaved?.(pts)
    await fetch(`/api/site-plans/${planId}/parcel`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ parcel_json: JSON.stringify(pts) }),
    }).catch(console.error)
  }

  // ─── Parcel edit ──────────────────────────────────────────────────────────────
  const editSvgPts = cssDims && editPoints ? editPoints.map(p => normToScreen(p.x, p.y)) : []

  // Hit test parcel + all boundary polygons. Returns target with `source` field.
  function getEditTargetAll(sx, sy) {
    if (editPoints) {
      const t = getEditTarget(sx, sy, editSvgPts)
      if (t) return { ...t, source: 'parcel' }
    }
    for (const [bidStr, pts] of Object.entries(editBoundaryPoints)) {
      const svgPts = pts.map(p => normToScreen(p.x, p.y))
      const t = getEditTarget(sx, sy, svgPts)
      if (t) return { ...t, source: 'boundary', boundaryId: Number(bidStr), svgPts }
    }
    return null
  }

  // Find all vertices (across parcel + boundaries) at the same position as the drag target.
  function buildSharedGroup(target) {
    const pos = target.source === 'parcel'
      ? editPoints?.[target.idx]
      : editBoundaryPoints[target.boundaryId]?.[target.idx]
    if (!pos) return [target]
    const group = [target]
    if (editPoints) {
      editPoints.forEach((p, i) => {
        if (target.source === 'parcel' && i === target.idx) return
        if (Math.abs(p.x - pos.x) < SHARED_VERTEX_TOL && Math.abs(p.y - pos.y) < SHARED_VERTEX_TOL)
          group.push({ type: 'vertex', source: 'parcel', idx: i })
      })
    }
    for (const [bidStr, pts] of Object.entries(editBoundaryPoints)) {
      const bid = Number(bidStr)
      pts.forEach((p, i) => {
        if (target.source === 'boundary' && bid === target.boundaryId && i === target.idx) return
        if (Math.abs(p.x - pos.x) < SHARED_VERTEX_TOL && Math.abs(p.y - pos.y) < SHARED_VERTEX_TOL)
          group.push({ type: 'vertex', source: 'boundary', boundaryId: bid, idx: i })
      })
    }
    return group
  }

  // Find nearest vertex not in the drag's shared group for snapping.
  function findSnapForDrag(sx, sy, sharedGroup) {
    const inGroup = (src, bid, idx) =>
      sharedGroup.some(g => g.source === src && g.idx === idx &&
        (src === 'parcel' || g.boundaryId === bid))
    let best = null, bestDist = SNAP_VERTEX_EDIT_PX
    if (editPoints) {
      editPoints.forEach((p, i) => {
        if (inGroup('parcel', null, i)) return
        const sp = normToScreen(p.x, p.y)
        const d = Math.hypot(sp.x - sx, sp.y - sy)
        if (d < bestDist) { bestDist = d; best = { normPos: p, svgPos: sp } }
      })
    }
    for (const [bidStr, pts] of Object.entries(editBoundaryPoints)) {
      const bid = Number(bidStr)
      pts.forEach((p, i) => {
        if (inGroup('boundary', bid, i)) return
        const sp = normToScreen(p.x, p.y)
        const d = Math.hypot(sp.x - sx, sp.y - sy)
        if (d < bestDist) { bestDist = d; best = { normPos: p, svgPos: sp } }
      })
    }
    return best
  }

  function handleEditDown(e) {
    if (e.button !== 0) return
    e.currentTarget.setPointerCapture(e.pointerId)
    const { sx, sy } = svgXY(e)
    const target = getEditTargetAll(sx, sy)
    const sharedGroup = target?.type === 'vertex' ? buildSharedGroup(target) : (target ? [target] : [])
    editRef.current = {
      target,
      sharedGroup,
      startX: e.clientX, startY: e.clientY,
      startPanX: pan.x, startPanY: pan.y,
      startPts: editPoints ? [...editPoints] : [],
      // Deep copy ALL boundary point arrays — needed to reconstruct each frame
      startBndPts: Object.fromEntries(
        Object.entries(editBoundaryPoints).map(([k, v]) => [k, [...v]])
      ),
      moved: false,
    }
  }
  function handleEditMove(e) {
    const ref = editRef.current
    const { sx, sy } = svgXY(e)
    if (!ref) { setHoverTarget(getEditTargetAll(sx, sy)); return }
    const dx = e.clientX - ref.startX, dy = e.clientY - ref.startY
    if (Math.hypot(dx, dy) <= DRAG_THRESHOLD) return
    ref.moved = true

    if (ref.target?.type === 'vertex') {
      // Snap to a nearby vertex not in the shared group
      const snap = findSnapForDrag(sx, sy, ref.sharedGroup)
      setEditSnapSvg(snap ? snap.svgPos : null)
      const n = snap ? snap.normPos : screenToNorm(sx, sy)
      if (!n) return

      // Parcel vertices in group
      const parcelIdxs = ref.sharedGroup.filter(g => g.source === 'parcel').map(g => g.idx)
      if (parcelIdxs.length > 0) {
        const np = [...ref.startPts]
        parcelIdxs.forEach(i => { np[i] = n })
        setEditPoints(np)
      }

      // Boundary vertices in group (grouped by boundary)
      const bndGroups = {}
      ref.sharedGroup.filter(g => g.source === 'boundary').forEach(g => {
        ;(bndGroups[g.boundaryId] ??= []).push(g.idx)
      })
      if (Object.keys(bndGroups).length > 0) {
        setEditBoundaryPoints(prev => {
          const next = { ...prev }
          for (const [bidStr, idxs] of Object.entries(bndGroups)) {
            const bid = Number(bidStr)
            const np = [...(ref.startBndPts[bid] || [])]
            idxs.forEach(i => { np[i] = n })
            next[bid] = np
          }
          return next
        })
      }
    } else {
      setPan({ x: ref.startPanX + dx, y: ref.startPanY + dy })
    }
  }

  async function handleEditUp(e) {
    const ref = editRef.current; editRef.current = null
    setEditSnapSvg(null)
    if (!ref) return
    if (ref.target?.type === 'vertex' && ref.moved) {
      // Save parcel if any parcel vertex moved
      if (ref.sharedGroup.some(g => g.source === 'parcel')) await saveParcel(editPoints)
      // Save every affected boundary
      const bids = [...new Set(ref.sharedGroup.filter(g => g.source === 'boundary').map(g => g.boundaryId))]
      for (const bid of bids) await saveBoundaryPoints(bid, editBoundaryPoints[bid])
    } else if (!ref.moved) {
      const { sx, sy } = svgXY(e)
      const t = getEditTargetAll(sx, sy)
      if (t?.type === 'edge') {
        const n = screenToNorm(t.point.x, t.point.y); if (!n) return
        if (t.source === 'parcel') {
          const np = [...(editPoints || [])]; np.splice(t.idx + 1, 0, n)
          setEditPoints(np); await saveParcel(np)
        } else {
          const np = [...(editBoundaryPoints[t.boundaryId] || [])]; np.splice(t.idx + 1, 0, n)
          setEditBoundaryPoints(prev => ({ ...prev, [t.boundaryId]: np }))
          await saveBoundaryPoints(t.boundaryId, np)
        }
      }
    }
  }

  async function handleEditContextMenu(e) {
    e.preventDefault()
    const { sx, sy } = svgXY(e)
    const t = getEditTargetAll(sx, sy)
    if (t?.type === 'vertex') {
      if (t.source === 'parcel' && editPoints && editPoints.length > 3) {
        const np = editPoints.filter((_, i) => i !== t.idx)
        setEditPoints(np); await saveParcel(np)
      } else if (t.source === 'boundary') {
        const pts = editBoundaryPoints[t.boundaryId] || []
        if (pts.length > 3) {
          const np = pts.filter((_, i) => i !== t.idx)
          setEditBoundaryPoints(prev => ({ ...prev, [t.boundaryId]: np }))
          await saveBoundaryPoints(t.boundaryId, np)
        }
      }
    }
  }
  async function saveParcel(pts) {
    setSavedParcel(pts); onParcelSaved?.(pts)
    await fetch(`/api/site-plans/${planId}/parcel`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ parcel_json: JSON.stringify(pts) }),
    }).catch(console.error)
  }
  async function saveBoundaryPoints(boundaryId, pts) {
    const res = await fetch(`/api/phase-boundaries/${boundaryId}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ polygon_json: JSON.stringify(pts) }),
    }).catch(console.error)
    if (res?.ok) onBoundaryUpdated?.(await res.json())
  }

  // ─── Split mode ────────────────────────────────────────────────────────────────

  // Derived: split line in SVG coords (for rendering)
  const splitLineSvg = splitLine.map(p => normToScreen(p.x, p.y))

  function handleSplitMove(e) {
    const { sx, sy } = svgXY(e)
    setSplitCursorSvg({ x: sx, y: sy })
    const snap = snapToBoundaries(sx, sy, boundaries, normToScreen, screenToNorm, SNAP_SPLIT_PX)
    setSplitSnapSvg(snap ? snap.svgPoint : null)
  }

  function handleSplitDown(e) {
    if (e.button !== 0) return
    const { sx, sy } = svgXY(e)

    if (splitPhase === 'idle') {
      // Must start on a boundary edge
      const snap = snapToBoundaries(sx, sy, boundaries, normToScreen, screenToNorm, SNAP_SPLIT_PX)
      if (!snap) return
      e.currentTarget.setPointerCapture(e.pointerId)
      setSplitTargetId(snap.boundary.boundary_id)
      setSplitLine([snap.normPoint])
      setSplitPhase('drawing')
      return
    }

    if (splitPhase === 'drawing') {
      e.currentTarget.setPointerCapture(e.pointerId)
      const last = splitLineSvg[splitLineSvg.length - 1]

      // Snap to boundary edge → terminate and immediately split
      const snap = snapToBoundaries(sx, sy, boundaries, normToScreen, screenToNorm, SNAP_SPLIT_PX)
      if (snap) {
        performSplit([...splitLine, snap.normPoint])
        return
      }

      // Click overshoots a boundary edge → clip to intersection and immediately split
      const ix = findFirstBoundaryIntersection(last.x, last.y, sx, sy, boundaries, normToScreen)
      if (ix) {
        performSplit([...splitLine, ix.normPoint])
        return
      }

      // Interior click → add vertex and continue drawing
      const norm = screenToNorm(sx, sy)
      if (norm) setSplitLine(l => [...l, norm])
      return
    }
  }

  function performSplit(finalLine) {
    if (!splitTargetId || finalLine.length < 2) return
    const target = boundaries.find(b => b.boundary_id === splitTargetId)
    if (!target) return
    const poly = JSON.parse(target.polygon_json)
    const result = splitPolygon(poly, finalLine)
    if (!result) { cancelSplit(); return }
    const [polyA, polyB] = result
    onSplitConfirm?.(splitTargetId, polyA, polyB)
    setSplitPhase('idle'); setSplitLine([]); setSplitTargetId(null)
    setSplitCursorSvg(null); setSplitSnapSvg(null)
  }

  function cancelSplit() {
    setSplitPhase('idle'); setSplitLine([]); setSplitTargetId(null)
    setSplitCursorSvg(null); setSplitSnapSvg(null)
  }

  // ─── Overlay event dispatcher ─────────────────────────────────────────────────
  const inTrace = mode === 'trace'
  const inEdit  = mode === 'edit'
  const inSplit = mode === 'split'
  const overlayActive = inTrace || inEdit || inSplit

  function onSvgPointerDown(e) {
    if (inTrace) handleTraceDown(e)
    else if (inEdit) handleEditDown(e)
    else if (inSplit) {
      if (splitPhase === 'review') handleSplitDown(e)
      else handleSplitDown(e)
    }
  }
  function onSvgPointerMove(e) {
    if (inTrace) handleTraceMove(e)
    else if (inEdit) handleEditMove(e)
    else if (inSplit) { handleSplitMove(e) }
  }
  function onSvgPointerUp(e) {
    if (inTrace) handleTraceUp(e)
    else if (inEdit) handleEditUp(e)
  }
  function onSvgPointerLeave() {
    if (inTrace) setCursorNorm(null)
    else if (inEdit) { setHoverTarget(null); setEditSnapSvg(null) }
    else if (inSplit) { setSplitCursorSvg(null); setSplitSnapSvg(null) }
  }
  function onSvgContextMenu(e) {
    if (inEdit) handleEditContextMenu(e)
  }

  // ─── Derived SVG values ────────────────────────────────────────────────────────
  const traceSnap   = tracePoints.length >= 3 && cursorNorm
    ? (() => { const f = normToScreen(tracePoints[0].x, tracePoints[0].y); const c = normToScreen(cursorNorm.x, cursorNorm.y); return Math.hypot(f.x-c.x, f.y-c.y) < SNAP_TRACE_PX })()
    : false
  const svgTrace    = tracePoints.map(p => normToScreen(p.x, p.y))
  const svgSaved    = cssDims && savedParcel ? savedParcel.map(p => normToScreen(p.x, p.y)) : []
  const svgCursor   = cssDims && cursorNorm ? normToScreen(cursorNorm.x, cursorNorm.y) : null
  const svgFirst    = svgTrace[0]
  const svgLast     = svgTrace[svgTrace.length - 1]

  const editCursor = inEdit
    ? (hoverTarget?.type === 'vertex' ? 'move' : hoverTarget?.type === 'edge' ? 'cell' : 'grab')
    : 'default'

  const splitCursor = inSplit
    ? (splitPhase === 'drawing' || splitSnapSvg ? 'crosshair' : 'default')
    : 'default'

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      <div ref={containerRef}
        style={{ width: '100%', height: '100%', overflow: 'hidden', background: '#374151',
          cursor: mode === 'view' ? (dragRef.current ? 'grabbing' : 'grab') : 'default' }}
        onWheel={handleWheel}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerLeave={handlePointerUp}
      >
        {/* PDF canvas */}
        <div style={{ position: 'absolute', transform: `translate(${pan.x}px,${pan.y}px) scale(${zoom})`, transformOrigin: '0 0' }}>
          <canvas ref={canvasRef} style={{ display: 'block', width: cssDims?.width||0, height: cssDims?.height||0, boxShadow: '0 4px 24px rgba(0,0,0,0.4)' }} />
        </div>

        {/* SVG overlay */}
        {cssDims && (
          <svg
            style={{ position: 'absolute', top:0, left:0, width:'100%', height:'100%', overflow:'visible',
              pointerEvents: overlayActive ? 'all' : 'none',
              cursor: inTrace ? (traceSnap ? 'cell' : 'crosshair') : inEdit ? editCursor : inSplit ? splitCursor : 'default' }}
            onWheel={handleWheel}
            onPointerDown={overlayActive ? onSvgPointerDown : undefined}
            onPointerMove={overlayActive ? onSvgPointerMove : undefined}
            onPointerUp={overlayActive ? onSvgPointerUp : undefined}
            onPointerLeave={overlayActive ? onSvgPointerLeave : undefined}
            onContextMenu={overlayActive ? onSvgContextMenu : undefined}
          >
            {/* ── Phase boundaries ── */}
            {boundaries.map((b, idx) => {
              const pts = JSON.parse(b.polygon_json)
              const svg = pts.map(p => normToScreen(p.x, p.y))
              const polyStr = svg.map(p => `${p.x},${p.y}`).join(' ')
              const color = boundaryColor(idx)
              const isSelected = b.boundary_id === selectedBoundaryId
              const isTarget = b.boundary_id === splitTargetId
              // Centroid for label
              const cx = svg.reduce((s,p)=>s+p.x,0)/svg.length
              const cy = svg.reduce((s,p)=>s+p.y,0)/svg.length
              return (
                <g key={b.boundary_id}
                  onClick={inSplit ? undefined : () => onBoundarySelect?.(isSelected ? null : b.boundary_id)}
                  style={{ cursor: inSplit ? 'inherit' : 'pointer' }}
                >
                  <polygon points={polyStr}
                    fill={isTarget ? `${color}30` : `${color}18`}
                    stroke={isSelected ? color : color}
                    strokeWidth={isSelected ? 3 : isTarget ? 2.5 : 1.5}
                    strokeDasharray={isTarget ? '6 3' : 'none'}
                  />
                  {b.label && (
                    <text x={cx} y={cy} textAnchor="middle" dominantBaseline="middle"
                      fontSize={12 / zoom * 1.2} fill={color} fontWeight="600"
                      style={{ pointerEvents:'none', userSelect:'none' }}>
                      {b.label}
                    </text>
                  )}
                </g>
              )
            })}

            {/* ── Saved parcel (view/split mode: show as subtle outline) ── */}
            {!inEdit && svgSaved.length >= 3 && (
              <polygon points={svgSaved.map(p=>`${p.x},${p.y}`).join(' ')}
                fill="none" stroke="rgba(37,99,235,0.25)" strokeWidth={1} strokeDasharray="4 4" />
            )}

            {/* ── Vertex snap indicator (edit mode drag) ── */}
            {inEdit && editSnapSvg && (
              <circle cx={editSnapSvg.x} cy={editSnapSvg.y} r={10}
                fill="rgba(245,158,11,0.2)" stroke="#f59e0b" strokeWidth={2} strokeDasharray="3 2"
                style={{ pointerEvents: 'none' }} />
            )}

            {/* ── Parcel edit ── */}
            {inEdit && editSvgPts.length >= 3 && (
              <>
                <polygon points={editSvgPts.map(p=>`${p.x},${p.y}`).join(' ')}
                  fill="rgba(37,99,235,0.08)" stroke="#2563eb" strokeWidth={2} />
                {hoverTarget?.source === 'parcel' && hoverTarget.type === 'edge' && (
                  <circle cx={hoverTarget.point.x} cy={hoverTarget.point.y} r={5}
                    fill="#fff" stroke="#2563eb" strokeWidth={2} strokeDasharray="2 2" />
                )}
                {editSvgPts.map((p, i) => {
                  const hov = hoverTarget?.source==='parcel' && hoverTarget.type==='vertex' && hoverTarget.idx===i
                  return <circle key={i} cx={p.x} cy={p.y} r={hov?9:6}
                    fill="#fff" stroke={hov?'#1d4ed8':'#2563eb'} strokeWidth={hov?2.5:2} />
                })}
              </>
            )}

            {/* ── Boundary vertex edit (edit mode) ── */}
            {inEdit && Object.entries(editBoundaryPoints).map(([bidStr, pts]) => {
              const bid = Number(bidStr)
              const bidx = boundaries.findIndex(b => b.boundary_id === bid)
              const color = boundaryColor(bidx >= 0 ? bidx : 0)
              const svgPts = pts.map(p => normToScreen(p.x, p.y))
              const polyStr = svgPts.map(p => `${p.x},${p.y}`).join(' ')
              return (
                <g key={bid}>
                  <polygon points={polyStr} fill={`${color}18`} stroke={color} strokeWidth={2} />
                  {hoverTarget?.source === 'boundary' && hoverTarget.boundaryId === bid && hoverTarget.type === 'edge' && (
                    <circle cx={hoverTarget.point.x} cy={hoverTarget.point.y} r={5}
                      fill="#fff" stroke={color} strokeWidth={2} strokeDasharray="2 2" />
                  )}
                  {svgPts.map((p, i) => {
                    const hov = hoverTarget?.source==='boundary' && hoverTarget.boundaryId===bid && hoverTarget.type==='vertex' && hoverTarget.idx===i
                    return <circle key={i} cx={p.x} cy={p.y} r={hov?9:6}
                      fill="#fff" stroke={hov ? color : color} strokeWidth={hov?2.5:2}
                      style={{ opacity: hov ? 1 : 0.85 }} />
                  })}
                </g>
              )
            })}

            {/* ── Trace ── */}
            {inTrace && svgTrace.length > 0 && (
              <>
                {svgTrace.length>=2 && <polyline points={svgTrace.map(p=>`${p.x},${p.y}`).join(' ')} fill="none" stroke="#f59e0b" strokeWidth={2} strokeLinejoin="round"/>}
                {svgCursor && svgLast && !traceSnap && <line x1={svgLast.x} y1={svgLast.y} x2={svgCursor.x} y2={svgCursor.y} stroke="#f59e0b" strokeWidth={1.5} strokeDasharray="5 4"/>}
                {traceSnap && svgLast && <>
                  <line x1={svgLast.x} y1={svgLast.y} x2={svgFirst.x} y2={svgFirst.y} stroke="#f59e0b" strokeWidth={1.5} strokeDasharray="5 4"/>
                  <polygon points={svgTrace.map(p=>`${p.x},${p.y}`).join(' ')} fill="rgba(245,158,11,0.08)" stroke="none"/>
                </>}
                {svgTrace.map((p,i)=><circle key={i} cx={p.x} cy={p.y} r={4} fill="#f59e0b" stroke="#fff" strokeWidth={1.5}/>)}
                {svgFirst && tracePoints.length>=3 && <circle cx={svgFirst.x} cy={svgFirst.y} r={traceSnap?SNAP_TRACE_PX:7} fill={traceSnap?'rgba(245,158,11,0.25)':'none'} stroke="#f59e0b" strokeWidth={2}/>}
                {svgCursor && <circle cx={svgCursor.x} cy={svgCursor.y} r={3} fill="#f59e0b" stroke="#fff" strokeWidth={1}/>}
              </>
            )}

            {/* ── Split mode overlay ── */}
            {inSplit && (
              <>
                {/* Snap indicator (idle + drawing) */}
                {splitSnapSvg && (
                  <circle cx={splitSnapSvg.x} cy={splitSnapSvg.y} r={7}
                    fill="rgba(16,185,129,0.3)" stroke="#10b981" strokeWidth={2}/>
                )}

                {/* Split line being drawn */}
                {splitLineSvg.length >= 1 && (
                  <>
                    {splitLineSvg.length >= 2 && (
                      <polyline points={splitLineSvg.map(p=>`${p.x},${p.y}`).join(' ')}
                        fill="none" stroke="#10b981" strokeWidth={2} strokeLinejoin="round"/>
                    )}
                    {/* Preview line to cursor (drawing phase) */}
                    {splitPhase === 'drawing' && splitCursorSvg && (() => {
                      const last = splitLineSvg[splitLineSvg.length - 1]
                      return <line x1={last.x} y1={last.y} x2={splitCursorSvg.x} y2={splitCursorSvg.y}
                        stroke="#10b981" strokeWidth={1.5} strokeDasharray="5 4"/>
                    })()}
                    {/* Vertex dots on split line */}
                    {splitLineSvg.map((p, i) => {
                      const isAnchor = i === 0 || i === splitLineSvg.length - 1
                      return <circle key={i} cx={p.x} cy={p.y}
                        r={isAnchor ? 6 : 4}
                        fill={isAnchor ? '#10b981' : '#fff'}
                        stroke="#10b981" strokeWidth={2}/>
                    })}
                  </>
                )}

              </>
            )}
          </svg>
        )}
      </div>

      {/* Bottom-right controls */}
      {cssDims && (
        <div style={{ position:'absolute', bottom:16, right:16, display:'flex', gap:6 }}>
          {inTrace && tracePoints.length >= 3 && (
            <button onClick={closeTrace} style={{...btn, width:'auto', padding:'0 10px', fontSize:12, color:'#92400e', borderColor:'#f59e0b', background:'rgba(255,251,235,0.95)'}}>
              Close
            </button>
          )}
          {inSplit && splitPhase === 'drawing' && (
            <button onClick={cancelSplit} style={{...btn, width:'auto', padding:'0 10px', fontSize:12}}>
              Cancel
            </button>
          )}
          <button onClick={()=>zoomBy(1.25)} style={btn}>+</button>
          <button onClick={()=>zoomBy(1/1.25)} style={btn}>−</button>
          <button onClick={resetView} style={btn}>Fit</button>
          <button onClick={()=>setRotation(r=>(r+90)%360)} style={btn} title="Rotate 90°">↻</button>
        </div>
      )}
    </div>
  )
}

const btn = {
  width:32, height:32, background:'rgba(255,255,255,0.92)', border:'1px solid #d1d5db',
  borderRadius:6, fontSize:16, fontWeight:600, cursor:'pointer',
  display:'flex', alignItems:'center', justifyContent:'center', color:'#374151',
}
