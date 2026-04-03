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
  distToSeg, snapToVertices, snapToBoundaries, findFirstBoundaryIntersection, splitPolygon, findBestSplit,
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

const UNASSIGNED_COLOR = '#9ca3af'

// ─── Rotation coordinate helpers ─────────────────────────────────────────────
// Coordinates are stored in un-rotated normalized [0,1] space.
// These helpers convert to/from the rotated display space so SVG overlays
// stay aligned with the PDF at any rotation angle.

function applyRotationToNorm(nx, ny, rotation) {
  // PDF.js rotation is clockwise (matching PDF spec).
  switch (rotation) {
    case 90:  return [1 - ny, nx]        // 90° CW
    case 180: return [1 - nx, 1 - ny]
    case 270: return [ny, 1 - nx]        // 270° CW (= 90° CCW)
    default:  return [nx, ny]
  }
}

function unapplyRotationFromNorm(rx, ry, rotation) {
  switch (rotation) {
    case 90:  return [ry, 1 - rx]        // inverse of 90° CW
    case 180: return [1 - rx, 1 - ry]
    case 270: return [1 - ry, rx]        // inverse of 270° CW
    default:  return [rx, ry]
  }
}

// ─── Parcel edit hit detection (SVG space) ────────────────────────────────────
function getEditTarget(sx, sy, svgPts) {
  for (let i = 0; i < svgPts.length; i++) {
    if (Math.hypot(svgPts[i].x - sx, svgPts[i].y - sy) < VERTEX_HIT_PX)
      return { type: 'vertex', idx: i }
  }
  for (let i = 0; i < svgPts.length; i++) {
    const a = svgPts[i], b = svgPts[(i + 1) % svgPts.length]
    const { dist, t, cx, cy } = distToSeg(sx, sy, a.x, a.y, b.x, b.y)
    // t is the parametric position along this edge in SVG space; it equals the
    // normalized-space t because normToScreen is a linear transform.
    if (dist < EDGE_HIT_PX) return { type: 'edge', idx: i, t, point: { x: cx, y: cy } }
  }
  return null
}

// "SC00000001" → "SC-1"
function lotLabel(lotNumber) {
  const m = lotNumber?.match(/^([A-Z]+)0*(\d+)$/)
  return m ? `${m[1]}-${parseInt(m[2], 10)}` : (lotNumber || '?')
}

const LOT_HIT_PX = 10

export default function PdfCanvas({
  pdfUrl, planId, initialParcel,
  boundaries = [],
  selectedBoundaryId,
  phaseColorMap = {},   // {phase_id: color} — assigned by instrument in SitePlanView
  mode, onModeChange,
  onParcelSaved, onSplitConfirm, onBoundarySelect, onBoundaryDelete, onBoundaryUpdated,
  onVertexEditComplete,   // ({boundary_id, old_polygon_json}[]) => void — for undo tracking
  traceUndoSignal = 0,    // increment to pop the last trace point (granular undo)
  // Lot positioning props
  lotPositions = {},    // {lot_id: {x, y}} normalized
  lotMeta = {},         // {lot_id: {lot_number, instrument_id}}
  lotColorMap = {},     // {lot_id: color}
  placingLot = null,    // {lot_id, lot_number} | null — current lot in click-to-set loop
  onPlaceLot,           // ({x,y}) => void
  onLotDrop,            // (lot_id, {x,y}) => void  — HTML5 drop from bank
  onLotMove,            // (lot_id, {x,y}) => void  — drag existing lot on map
  // Building group props
  buildingGroups = [],        // [{building_group_id, dev_id, building_name, lots:[{lot_id,lot_number,x,y}]}]
  showBuildingGroups = false, // whether to render ovals
  selectedBgIds = new Set(),  // set of selected building_group_ids (delete mode)
  onBuildingGroupDrawn,       // (polygon:[{x,y}]) => void
  onBuildingGroupSelect,      // (building_group_id) => void
  onBuildingGroupContextMenu, // (building_group_id, svgX, svgY) => void
  // Unit counts overlay props
  rightPanelTab = 'assignment', // 'assignment' | 'unit-counts'
  unitCountsSubtotal = false,   // false=totals on polygons, true=per-lot-type rows + editable p
  phasesData = [],              // phases array with by_lot_type from SitePlanView
  onEditProjected,              // (phase_id, lot_type_id, current_p, svgX, svgY) => void
}) {
  const canvasRef    = useRef(null)
  const containerRef = useRef(null)

  const [cssDims, setCssDims]       = useState(null)
  const [pan, setPan]               = useState({ x: 0, y: 0 })
  const [zoom, setZoom]             = useState(1.0)
  const [rotation, setRotation]     = useState(() => {
    const saved = localStorage.getItem(`siteplan_rotation_${planId}`)
    return saved ? parseInt(saved, 10) : 0
  })
  const [pdfError, setPdfError]     = useState(null)

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

  // Lot drag on map
  const lotDragRef = useRef(null)   // {lotId}
  const [dragLotId, setDragLotId]   = useState(null)
  const [dragLotPos, setDragLotPos] = useState(null)  // normalized {x,y}
  const [hoveredLotId, setHoveredLotId] = useState(null)

  // Place mode cursor
  const [placeCursorSvg, setPlaceCursorSvg] = useState(null)  // {x,y} in SVG space

  // Split
  // phase: 'idle' | 'drawing' | 'review'
  const [splitPhase, setSplitPhase]       = useState('idle')
  const [splitLine, setSplitLine]         = useState([])   // [{x,y}] normalized
  const [splitCursorSvg, setSplitCursorSvg] = useState(null)
  const [splitSnapSvg, setSplitSnapSvg]   = useState(null) // snap indicator SVG pos
  const [splitTargetId, setSplitTargetId] = useState(null) // which boundary being split

  // Delete-phases mode hover
  const [hoveredDeleteBndId, setHoveredDeleteBndId] = useState(null)

  // Building group draw mode
  const [bgDrawPoints, setBgDrawPoints]       = useState([])   // [{x,y}] normalized — multi-point mode
  const [bgDrawCursorSvg, setBgDrawCursorSvg] = useState(null) // {x,y} in SVG space

  // Building group delete mode
  const [hoveredBgId, setHoveredBgId] = useState(null)

  // Interaction refs
  const dragRef    = useRef(null)
  const traceRef   = useRef(null)
  const editRef    = useRef(null)
  const bgDrawRef  = useRef(null) // {startX,startY,moved,freehand,freehandPts:[{x,y}],lastFreehandSvg}
  const bgLastClick = useRef(0)   // timestamp of last pointer-up click (for dblclick detection)

  useEffect(() => { setSavedParcel(initialParcel || null) }, [initialParcel])

  // Persist rotation across sessions
  useEffect(() => {
    if (planId) localStorage.setItem(`siteplan_rotation_${planId}`, String(rotation))
  }, [planId, rotation])

  // Granular undo for trace mode: pop the last placed point
  useEffect(() => {
    if (traceUndoSignal === 0) return
    setTracePoints(pts => pts.slice(0, -1))
  }, [traceUndoSignal])

  // Reset mode-local state on mode change
  useEffect(() => {
    setTracePoints([]); setCursorNorm(null); traceRef.current = null
    setEditPoints(null); setEditBoundaryPoints({}); setHoverTarget(null); setEditSnapSvg(null); editRef.current = null
    setSplitPhase('idle'); setSplitLine([]); setSplitCursorSvg(null)
    setSplitSnapSvg(null); setSplitTargetId(null)
    setHoveredDeleteBndId(null)
    setBgDrawPoints([]); setBgDrawCursorSvg(null); bgDrawRef.current = null
    setHoveredBgId(null)

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
    setPdfError(null)
    async function load() {
      try {
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
        if (el && el.clientWidth > 0 && el.clientHeight > 0) {
          const fit = Math.min(el.clientWidth / w, el.clientHeight / h, 1.0)
          setZoom(fit)
          setPan({ x: (el.clientWidth - w * fit) / 2, y: (el.clientHeight - h * fit) / 2 })
        }
      } catch (err) {
        if (!cancelled) setPdfError(String(err))
      }
    }
    load()
    return () => { cancelled = true }
  }, [pdfUrl, rotation])

  // ─── Coord helpers ────────────────────────────────────────────────────────────
  const screenToNorm = useCallback((sx, sy) => {
    if (!cssDims) return null
    const rx = (sx - pan.x) / zoom / cssDims.width
    const ry = (sy - pan.y) / zoom / cssDims.height
    const [nx, ny] = unapplyRotationFromNorm(rx, ry, rotation)
    return { x: nx, y: ny }
  }, [cssDims, pan, zoom, rotation])

  const normToScreen = useCallback((nx, ny) => {
    if (!cssDims) return { x: 0, y: 0 }
    const [rx, ry] = applyRotationToNorm(nx, ny, rotation)
    return { x: rx * cssDims.width * zoom + pan.x, y: ry * cssDims.height * zoom + pan.y }
  }, [cssDims, pan, zoom, rotation])

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

  // ─── View pan + lot drag ──────────────────────────────────────────────────────
  function handlePointerDown(e) {
    if (e.button !== 0 || mode !== 'view') return
    const { sx, sy } = svgXY(e)
    const hitLot = cssDims ? findLotAtPoint(sx, sy) : null
    if (hitLot !== null) {
      // Start lot drag
      e.currentTarget.setPointerCapture(e.pointerId)
      lotDragRef.current = { lotId: hitLot }
      setDragLotId(hitLot)
      return
    }
    // Pan
    e.currentTarget.setPointerCapture(e.pointerId)
    dragRef.current = { startX: e.clientX, startY: e.clientY, startPanX: pan.x, startPanY: pan.y }
  }
  function handlePointerMove(e) {
    if (lotDragRef.current) {
      const { sx, sy } = svgXY(e)
      const norm = screenToNorm(sx, sy)
      if (norm) setDragLotPos(norm)
      return
    }
    if (dragRef.current) {
      setPan({ x: dragRef.current.startPanX + (e.clientX - dragRef.current.startX), y: dragRef.current.startPanY + (e.clientY - dragRef.current.startY) })
      return
    }
    // Hover: update hovered lot for cursor feedback
    if (mode === 'view' && cssDims) {
      const { sx, sy } = svgXY(e)
      setHoveredLotId(findLotAtPoint(sx, sy))
    }
  }
  function handlePointerUp() {
    if (lotDragRef.current) {
      if (dragLotPos) onLotMove?.(lotDragRef.current.lotId, dragLotPos)
      lotDragRef.current = null
      setDragLotId(null)
      setDragLotPos(null)
      return
    }
    dragRef.current = null
  }

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
      // Collect old boundary states BEFORE saving (for undo)
      const bids = [...new Set(ref.sharedGroup.filter(g => g.source === 'boundary').map(g => g.boundaryId))]
      const oldStates = bids.map(bid => ({
        boundary_id: bid,
        old_polygon_json: JSON.stringify(ref.startBndPts[bid] || []),
      }))
      // Save parcel if any parcel vertex moved
      if (ref.sharedGroup.some(g => g.source === 'parcel')) await saveParcel(editPoints)
      // Save every affected boundary
      for (const bid of bids) await saveBoundaryPoints(bid, editBoundaryPoints[bid])
      if (oldStates.length > 0) onVertexEditComplete?.(oldStates)
    } else if (!ref.moved) {
      const { sx, sy } = svgXY(e)
      const tgt = getEditTargetAll(sx, sy)
      if (tgt?.type === 'edge') {
        if (tgt.source === 'parcel') {
          // Interpolate in normalized space using t — avoids lossy screenToNorm
          const edgeA = editPoints[tgt.idx], edgeB = editPoints[(tgt.idx + 1) % editPoints.length]
          const n = { x: edgeA.x + tgt.t * (edgeB.x - edgeA.x), y: edgeA.y + tgt.t * (edgeB.y - edgeA.y) }
          const np = [...editPoints]; np.splice(tgt.idx + 1, 0, n)
          setEditPoints(np); await saveParcel(np)
        } else {
          const srcPts = editBoundaryPoints[tgt.boundaryId] || []
          const edgeA = srcPts[tgt.idx], edgeB = srcPts[(tgt.idx + 1) % srcPts.length]
          const n = { x: edgeA.x + tgt.t * (edgeB.x - edgeA.x), y: edgeA.y + tgt.t * (edgeB.y - edgeA.y) }
          const np = [...srcPts]; np.splice(tgt.idx + 1, 0, n)
          // Propagate to any other boundary sharing this exact edge (topology preservation)
          const oldStates = [{ boundary_id: tgt.boundaryId, old_polygon_json: JSON.stringify(srcPts) }]
          const updates = { [tgt.boundaryId]: np }
          for (const [bidStr, pts] of Object.entries(editBoundaryPoints)) {
            const bid = Number(bidStr)
            if (bid === tgt.boundaryId) continue
            for (let i = 0; i < pts.length; i++) {
              const p = pts[i], q = pts[(i + 1) % pts.length]
              const fwd = Math.hypot(p.x-edgeA.x,p.y-edgeA.y) < SHARED_VERTEX_TOL && Math.hypot(q.x-edgeB.x,q.y-edgeB.y) < SHARED_VERTEX_TOL
              const rev = Math.hypot(p.x-edgeB.x,p.y-edgeB.y) < SHARED_VERTEX_TOL && Math.hypot(q.x-edgeA.x,q.y-edgeA.y) < SHARED_VERTEX_TOL
              if (fwd || rev) {
                oldStates.push({ boundary_id: bid, old_polygon_json: JSON.stringify(pts) })
                const spts = [...pts]; spts.splice(i + 1, 0, n)
                updates[bid] = spts
                break
              }
            }
          }
          setEditBoundaryPoints(prev => ({ ...prev, ...updates }))
          for (const [bidStr, updatedPts] of Object.entries(updates)) {
            await saveBoundaryPoints(Number(bidStr), updatedPts)
          }
          onVertexEditComplete?.(oldStates)
        }
      }
    }
  }

  async function handleEditContextMenu(e) {
    e.preventDefault()
    const { sx, sy } = svgXY(e)
    const tgt = getEditTargetAll(sx, sy)
    if (tgt?.type !== 'vertex') return

    const sharedGroup = buildSharedGroup(tgt)

    // Delete vertex from parcel if it's there
    const parcelIdxs = new Set(sharedGroup.filter(g => g.source === 'parcel').map(g => g.idx))
    if (parcelIdxs.size > 0 && editPoints && editPoints.length - parcelIdxs.size >= 3) {
      const np = editPoints.filter((_, i) => !parcelIdxs.has(i))
      setEditPoints(np); await saveParcel(np)
    }

    // Delete vertex from every boundary in the shared group
    const bndMap = {}
    sharedGroup.filter(g => g.source === 'boundary').forEach(g => {
      ;(bndMap[g.boundaryId] ??= []).push(g.idx)
    })
    const oldStates = [], updates = {}
    for (const [bidStr, idxs] of Object.entries(bndMap)) {
      const bid = Number(bidStr)
      const pts = editBoundaryPoints[bid] || []
      const del = new Set(idxs)
      if (pts.length - del.size >= 3) {
        oldStates.push({ boundary_id: bid, old_polygon_json: JSON.stringify(pts) })
        updates[bid] = pts.filter((_, i) => !del.has(i))
      }
    }
    if (Object.keys(updates).length > 0) {
      setEditBoundaryPoints(prev => ({ ...prev, ...updates }))
      for (const [bidStr, pts] of Object.entries(updates)) await saveBoundaryPoints(Number(bidStr), pts)
      onVertexEditComplete?.(oldStates)
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

  // When no phase boundaries exist yet, treat the saved parcel as the initial split target.
  const PARCEL_BOUNDARY_ID = '__parcel__'
  const parcelAsBoundary = savedParcel && boundaries.length === 0
    ? [{ boundary_id: PARCEL_BOUNDARY_ID, polygon_json: JSON.stringify(savedParcel) }]
    : null

  function getSplitCandidates() {
    return boundaries.length > 0 ? boundaries : (parcelAsBoundary || [])
  }

  // Detect the best split from a completed polyline.
  // Returns { boundary, clippedLine } or null.
  function detectSplit(polyline) {
    return findBestSplit(polyline, getSplitCandidates())
  }

  // Vertex snap takes priority over edge snap in split mode to ensure exact corner alignment.
  function bestSplitSnap(sx, sy) {
    const candidates = getSplitCandidates()
    return snapToVertices(sx, sy, candidates, normToScreen, SNAP_SPLIT_PX)
        || snapToBoundaries(sx, sy, candidates, normToScreen, screenToNorm, SNAP_SPLIT_PX)
  }

  function handleSplitMove(e) {
    const { sx, sy } = svgXY(e)
    setSplitCursorSvg({ x: sx, y: sy })

    // Snap to vertex first, then edge — no target restriction
    const snap = bestSplitSnap(sx, sy)
    setSplitSnapSvg(snap ? snap.svgPoint : null)

    // Live preview: update highlighted target based on where the line would end
    if (splitPhase === 'drawing' && splitLine.length >= 1) {
      const tentativeEnd = snap ? snap.normPoint : screenToNorm(sx, sy)
      if (tentativeEnd) {
        const result = detectSplit([...splitLine, tentativeEnd])
        setSplitTargetId(result ? result.boundary.boundary_id : null)
      }
    }
  }

  function handleSplitDown(e) {
    if (e.button !== 0) return
    const { sx, sy } = svgXY(e)

    if (splitPhase === 'idle') {
      // Start drawing — must begin on any boundary vertex or edge
      const snap = bestSplitSnap(sx, sy)
      if (!snap) return
      e.currentTarget.setPointerCapture(e.pointerId)
      setSplitLine([snap.normPoint])
      setSplitPhase('drawing')
      return
    }

    if (splitPhase === 'drawing') {
      e.currentTarget.setPointerCapture(e.pointerId)
      const last = splitLineSvg[splitLineSvg.length - 1]
      const candidates = getSplitCandidates()

      // Snap to any boundary vertex or edge → try to auto-detect and complete the split
      const snap = bestSplitSnap(sx, sy)
      if (snap) {
        const finalLine = [...splitLine, snap.normPoint]
        const result = detectSplit(finalLine)
        if (result) { performSplit(result); return }
        // Snapped but no valid bisection yet — add the vertex and continue
        setSplitLine(l => [...l, snap.normPoint])
        return
      }

      // Cursor overshot a boundary → clip to the crossing point and try to split
      const ix = findFirstBoundaryIntersection(last.x, last.y, sx, sy, candidates, normToScreen)
      if (ix) {
        const finalLine = [...splitLine, ix.normPoint]
        const result = detectSplit(finalLine)
        if (result) { performSplit(result); return }
      }

      // Interior click → add vertex and continue drawing
      const norm = screenToNorm(sx, sy)
      if (norm) setSplitLine(l => [...l, norm])
    }
  }

  function performSplit(detection) {
    // detection = { boundary, clippedLine }
    const { boundary, clippedLine } = detection
    const poly = boundary.boundary_id === PARCEL_BOUNDARY_ID
      ? savedParcel
      : JSON.parse(boundary.polygon_json)
    if (!poly) { cancelSplit(); return }
    const result = splitPolygon(poly, clippedLine)
    if (!result) { cancelSplit(); return }
    const [polyA, polyB] = result
    const originalId = boundary.boundary_id === PARCEL_BOUNDARY_ID ? null : boundary.boundary_id
    onSplitConfirm?.(originalId, polyA, polyB)
    setSplitPhase('idle'); setSplitLine([]); setSplitTargetId(null)
    setSplitCursorSvg(null); setSplitSnapSvg(null)
  }

  function cancelSplit() {
    setSplitPhase('idle'); setSplitLine([]); setSplitTargetId(null)
    setSplitCursorSvg(null); setSplitSnapSvg(null)
  }

  // ─── Lot hit testing (view mode, screen coords) ───────────────────────────────
  function findLotAtPoint(sx, sy) {
    for (const [lotIdStr, pos] of Object.entries(lotPositions)) {
      const sp = normToScreen(pos.x, pos.y)
      if (Math.hypot(sp.x - sx, sp.y - sy) < LOT_HIT_PX) return Number(lotIdStr)
    }
    return null
  }

  // ─── Place mode ───────────────────────────────────────────────────────────────
  function handlePlaceMove(e) {
    const { sx, sy } = svgXY(e)
    setPlaceCursorSvg({ x: sx, y: sy })
  }
  function handlePlaceUp(e) {
    if (e.button !== 0) return
    const { sx, sy } = svgXY(e)
    const norm = screenToNorm(sx, sy)
    if (norm) onPlaceLot?.(norm)
  }

  // ─── Building group: hit-test an ellipse (screen coords) ─────────────────────
  // Returns true when (sx,sy) is inside the ellipse described by (cx,cy,rx,ry).
  function hitTestEllipse(sx, sy, cx, cy, rx, ry) {
    const dx = (sx - cx) / rx
    const dy = (sy - cy) / ry
    return dx * dx + dy * dy <= 1
  }

  // Compute the SVG-space ellipse for a building group given its lot positions.
  // Returns {cx, cy, rx, ry} in screen pixels, or null if no lots have positions.
  function bgEllipse(bg) {
    if (!bg.lots || !bg.lots.length) return null
    const pts = bg.lots.map(l => normToScreen(l.x, l.y))
    const minX = Math.min(...pts.map(p => p.x))
    const maxX = Math.max(...pts.map(p => p.x))
    const minY = Math.min(...pts.map(p => p.y))
    const maxY = Math.max(...pts.map(p => p.y))
    const PAD = 18
    return {
      cx: (minX + maxX) / 2,
      cy: (minY + maxY) / 2,
      rx: Math.max(14, (maxX - minX) / 2 + PAD),
      ry: Math.max(14, (maxY - minY) / 2 + PAD),
    }
  }

  // Find the first building group whose ellipse contains (sx, sy).
  function findBgAtPoint(sx, sy) {
    for (const bg of buildingGroups) {
      const ell = bgEllipse(bg)
      if (!ell) continue
      if (hitTestEllipse(sx, sy, ell.cx, ell.cy, ell.rx, ell.ry)) return bg.building_group_id
    }
    return null
  }

  // ─── Building group draw mode ─────────────────────────────────────────────────
  // Supports two drawing styles:
  //   Freehand: hold mouse button and drag → releases on mouseup
  //   Multi-point: click to add vertices → double-click (or click near first point) to close

  const FREEHAND_STEP_SQ = 25  // minimum squared screen-px distance between freehand samples
  const DBLCLICK_MS = 350      // milliseconds to distinguish double-click from two single clicks

  function handleBgDrawDown(e) {
    if (e.button !== 0) return
    e.currentTarget.setPointerCapture(e.pointerId)
    const { sx, sy } = svgXY(e)
    const norm = screenToNorm(sx, sy)
    bgDrawRef.current = {
      startX: e.clientX, startY: e.clientY,
      moved: false,
      freehand: false,
      freehandPts: norm ? [norm] : [],
      lastFreehandSvg: { x: sx, y: sy },
    }
  }

  function handleBgDrawMove(e) {
    const { sx, sy } = svgXY(e)
    setBgDrawCursorSvg({ x: sx, y: sy })

    const ref = bgDrawRef.current
    if (!ref) return

    const dx = e.clientX - ref.startX
    const dy = e.clientY - ref.startY

    if (!ref.freehand && Math.hypot(dx, dy) > DRAG_THRESHOLD) {
      ref.freehand = true
      ref.moved = true
    }

    if (ref.freehand) {
      const last = ref.lastFreehandSvg
      const dSq = (sx - last.x) * (sx - last.x) + (sy - last.y) * (sy - last.y)
      if (dSq >= FREEHAND_STEP_SQ) {
        const norm = screenToNorm(sx, sy)
        if (norm) ref.freehandPts.push(norm)
        ref.lastFreehandSvg = { x: sx, y: sy }
      }
    }
  }

  function handleBgDrawUp(e) {
    const ref = bgDrawRef.current
    bgDrawRef.current = null

    if (!ref) return

    if (ref.freehand) {
      // Freehand close — use collected points
      const pts = ref.freehandPts
      if (pts.length >= 3) {
        onBuildingGroupDrawn?.(pts)
        setBgDrawPoints([])
      }
      return
    }

    // Not freehand — treat as a click
    const now = Date.now()
    const isDblClick = (now - bgLastClick.current) < DBLCLICK_MS
    bgLastClick.current = now

    const { sx, sy } = svgXY(e)
    const norm = screenToNorm(sx, sy)
    if (!norm) return

    if (isDblClick) {
      // Double-click: pop the point added by the first click of this dblclick pair, then close
      setBgDrawPoints(pts => {
        const trimmed = pts.slice(0, -1)
        if (trimmed.length >= 3) {
          onBuildingGroupDrawn?.(trimmed)
          return []
        }
        return trimmed
      })
      return
    }

    // Single click
    setBgDrawPoints(pts => {
      if (pts.length >= 3) {
        // Check proximity to first point — snap-close
        const first = normToScreen(pts[0].x, pts[0].y)
        if (Math.hypot(first.x - sx, first.y - sy) < SNAP_TRACE_PX) {
          onBuildingGroupDrawn?.(pts)
          return []
        }
      }
      return [...pts, norm]
    })
  }

  // ─── Building group delete mode ───────────────────────────────────────────────

  function handleBgDeleteDown(e) {
    if (e.button !== 0) return
    const { sx, sy } = svgXY(e)
    const id = findBgAtPoint(sx, sy)
    if (id !== null) onBuildingGroupSelect?.(id)
  }

  function handleBgDeleteContextMenu(e) {
    e.preventDefault()
    const { sx, sy } = svgXY(e)
    const id = findBgAtPoint(sx, sy)
    if (id !== null) {
      // Select it first if not already selected
      if (!selectedBgIds.has(id)) onBuildingGroupSelect?.(id)
      onBuildingGroupContextMenu?.(id, sx, sy)
    }
  }

  // ─── Overlay event dispatcher ─────────────────────────────────────────────────
  const inTrace          = mode === 'trace'
  const inEdit           = mode === 'edit'
  const inSplit          = mode === 'split'
  const inPlace          = mode === 'place'
  const inDeletePhases   = mode === 'delete-phases'
  const inDrawBuilding   = mode === 'draw-building'
  const inDeleteBuilding = mode === 'delete-building'
  const overlayActive    = inTrace || inEdit || inSplit || inPlace || inDeletePhases || inDrawBuilding || inDeleteBuilding

  function onSvgPointerDown(e) {
    if (inTrace) handleTraceDown(e)
    else if (inEdit) handleEditDown(e)
    else if (inSplit) handleSplitDown(e)
    else if (inDrawBuilding) handleBgDrawDown(e)
    else if (inDeleteBuilding) handleBgDeleteDown(e)
    // place mode: handled on PointerUp to avoid conflict with accidental drags
  }
  function onSvgPointerMove(e) {
    if (inTrace) handleTraceMove(e)
    else if (inEdit) handleEditMove(e)
    else if (inSplit) handleSplitMove(e)
    else if (inPlace) handlePlaceMove(e)
    else if (inDrawBuilding) handleBgDrawMove(e)
    else if (inDeleteBuilding) {
      const { sx, sy } = svgXY(e)
      setHoveredBgId(findBgAtPoint(sx, sy))
    }
  }
  function onSvgPointerUp(e) {
    if (inTrace) handleTraceUp(e)
    else if (inEdit) handleEditUp(e)
    else if (inPlace) handlePlaceUp(e)
    else if (inDrawBuilding) handleBgDrawUp(e)
  }
  function onSvgPointerLeave() {
    if (inTrace) setCursorNorm(null)
    else if (inEdit) { setHoverTarget(null); setEditSnapSvg(null) }
    else if (inSplit) { setSplitCursorSvg(null); setSplitSnapSvg(null) }
    else if (inPlace) { setPlaceCursorSvg(null) }
    else if (inDrawBuilding) setBgDrawCursorSvg(null)
    else if (inDeleteBuilding) setHoveredBgId(null)
  }
  function onSvgContextMenu(e) {
    if (inEdit) handleEditContextMenu(e)
    else if (inDeleteBuilding) handleBgDeleteContextMenu(e)
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

  const deleteCursor = inDeletePhases
    ? (hoveredDeleteBndId !== null ? 'pointer' : 'default')
    : 'default'

  const bgDrawCursor   = inDrawBuilding ? 'crosshair' : 'default'
  const bgDeleteCursor = inDeleteBuilding ? (hoveredBgId !== null ? 'pointer' : 'default') : 'default'

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      {pdfError && (
        <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 20, background: '#1f2937' }}>
          <div style={{ color: '#f87171', fontSize: 13, maxWidth: 420, textAlign: 'center', padding: 24 }}>
            <div style={{ fontWeight: 600, marginBottom: 6 }}>Failed to load PDF</div>
            <div style={{ opacity: 0.7, fontFamily: 'monospace', fontSize: 11 }}>{pdfError}</div>
          </div>
        </div>
      )}
      {!cssDims && !pdfError && (
        <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 10, pointerEvents: 'none' }}>
          <div style={{ color: '#9ca3af', fontSize: 13 }}>Loading PDF…</div>
        </div>
      )}
      <div ref={containerRef}
        style={{ width: '100%', height: '100%', overflow: 'hidden', background: '#374151',
          cursor: mode === 'view'
            ? (dragLotId ? 'grabbing' : hoveredLotId !== null ? 'grab' : 'default')
            : 'default' }}
        onWheel={handleWheel}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerLeave={() => { handlePointerUp(); setHoveredLotId(null) }}
        onDragOver={e => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy' }}
        onDrop={e => {
          e.preventDefault()
          const lotId = parseInt(e.dataTransfer.getData('lot_id'), 10)
          if (!lotId || !cssDims) return
          const rect = containerRef.current.getBoundingClientRect()
          const norm = screenToNorm(e.clientX - rect.left, e.clientY - rect.top)
          if (norm) onLotDrop?.(lotId, norm)
        }}
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
              cursor: inTrace ? (traceSnap ? 'cell' : 'crosshair') : inEdit ? editCursor : inSplit ? splitCursor : inDeletePhases ? deleteCursor : inPlace ? 'crosshair' : inDrawBuilding ? bgDrawCursor : inDeleteBuilding ? bgDeleteCursor : 'default' }}
            onPointerDown={overlayActive ? onSvgPointerDown : undefined}
            onPointerMove={overlayActive ? onSvgPointerMove : undefined}
            onPointerUp={overlayActive ? onSvgPointerUp : undefined}
            onPointerLeave={overlayActive ? onSvgPointerLeave : undefined}
            onContextMenu={overlayActive ? onSvgContextMenu : undefined}
          >
            {/* ── Phase boundaries — selected rendered last so it is never occluded ── */}
            {[...boundaries].sort((a, b) => a.boundary_id === selectedBoundaryId ? 1 : b.boundary_id === selectedBoundaryId ? -1 : 0).map((b) => {
              const pts = JSON.parse(b.polygon_json)
              const svg = pts.map(p => normToScreen(p.x, p.y))
              const polyStr = svg.map(p => `${p.x},${p.y}`).join(' ')
              const fillColor = (b.phase_id && phaseColorMap[b.phase_id]) || UNASSIGNED_COLOR
              const isSelected = b.boundary_id === selectedBoundaryId
              const isTarget = b.boundary_id === splitTargetId
              const isDeleteHover = inDeletePhases && b.boundary_id === hoveredDeleteBndId
              // Stroke / fill styling
              const strokeColor = isDeleteHover ? '#dc2626' : isSelected ? '#1d4ed8' : '#1e293b'
              const strokeW = isDeleteHover ? 3 : isSelected ? 3 : isTarget ? 2.5 : 2
              const fillOpacity = isDeleteHover ? 0.55 : isTarget ? 0.6 : b.phase_id ? 0.45 : 0.20
              const fillActual = isDeleteHover ? '#ef4444' : fillColor
              // Centroid for label
              const cx = svg.reduce((s,p)=>s+p.x,0)/svg.length
              const cy = svg.reduce((s,p)=>s+p.y,0)/svg.length
              return (
                <g key={b.boundary_id}
                  onClick={inDeletePhases
                    ? () => onBoundaryDelete?.(b.boundary_id)
                    : inSplit ? undefined
                    : () => onBoundarySelect?.(isSelected ? null : b.boundary_id)}
                  onPointerEnter={inDeletePhases ? () => setHoveredDeleteBndId(b.boundary_id) : undefined}
                  onPointerLeave={inDeletePhases ? () => setHoveredDeleteBndId(null) : undefined}
                  style={{ cursor: inDeletePhases ? 'pointer' : inSplit ? 'inherit' : 'pointer' }}
                >
                  {/* White backing makes dark stroke legible over any PDF background */}
                  <polygon points={polyStr}
                    fill="none" stroke="rgba(255,255,255,0.75)" strokeWidth={strokeW + 3}
                    style={{ pointerEvents: 'none' }} />
                  <polygon points={polyStr}
                    fill={fillActual} fillOpacity={fillOpacity}
                    stroke={strokeColor}
                    strokeWidth={strokeW}
                    strokeDasharray={isTarget ? '6 3' : 'none'}
                    style={{ pointerEvents: 'fill' }}
                  />
                  {b.label && (
                    <text x={cx} y={cy} textAnchor="middle" dominantBaseline="middle"
                      fontSize={12 / zoom * 1.2} fill="#1e293b" fontWeight="700"
                      stroke="rgba(255,255,255,0.8)" strokeWidth={3 / zoom}
                      paintOrder="stroke"
                      style={{ pointerEvents:'none', userSelect:'none' }}>
                      {b.label}
                    </text>
                  )}
                </g>
              )
            })}

            {/* ── Saved parcel (view/split mode: show as subtle outline) ── */}
            {!inEdit && svgSaved.length >= 3 && (() => {
              // In split mode with no phase boundaries yet, highlight the parcel edge so
              // the user knows it is the snappable split target.
              const splitTarget = inSplit && parcelAsBoundary
              return (
                <>
                  {splitTarget && (
                    <polygon points={svgSaved.map(p=>`${p.x},${p.y}`).join(' ')}
                      fill="none" stroke="rgba(255,255,255,0.6)" strokeWidth={5}
                      style={{ pointerEvents: 'none' }} />
                  )}
                  <polygon points={svgSaved.map(p=>`${p.x},${p.y}`).join(' ')}
                    fill={splitTarget ? 'rgba(37,99,235,0.08)' : 'none'}
                    stroke={splitTarget ? 'rgba(37,99,235,0.85)' : 'rgba(37,99,235,0.25)'}
                    strokeWidth={splitTarget ? 2.5 : 1}
                    strokeDasharray={splitTarget ? '6 3' : '4 4'} />
                </>
              )
            })()}

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
              const bnd = boundaries.find(b => b.boundary_id === bid)
              const fillColor = (bnd?.phase_id && phaseColorMap[bnd.phase_id]) || UNASSIGNED_COLOR
              const svgPts = pts.map(p => normToScreen(p.x, p.y))
              const polyStr = svgPts.map(p => `${p.x},${p.y}`).join(' ')
              return (
                <g key={bid}>
                  <polygon points={polyStr} fill={fillColor} fillOpacity={bnd?.phase_id ? 0.45 : 0.20}
                    stroke="#1e293b" strokeWidth={2} />
                  {hoverTarget?.source === 'boundary' && hoverTarget.boundaryId === bid && hoverTarget.type === 'edge' && (
                    <circle cx={hoverTarget.point.x} cy={hoverTarget.point.y} r={5}
                      fill="#fff" stroke="#1e293b" strokeWidth={2} strokeDasharray="2 2" />
                  )}
                  {svgPts.map((p, i) => {
                    const hov = hoverTarget?.source==='boundary' && hoverTarget.boundaryId===bid && hoverTarget.type==='vertex' && hoverTarget.idx===i
                    return <circle key={i} cx={p.x} cy={p.y} r={hov?9:6}
                      fill="#fff" stroke="#1e293b" strokeWidth={hov?2.5:2}
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

            {/* ── Building group ovals ── */}
            {showBuildingGroups && buildingGroups.map(bg => {
              const ell = bgEllipse(bg)
              if (!ell) return null
              const isSelected  = selectedBgIds.has(bg.building_group_id)
              const isHovered   = hoveredBgId === bg.building_group_id
              const strokeColor = isSelected ? '#ef4444' : isHovered ? '#f97316' : '#0d9488'
              const fillColor   = isSelected ? 'rgba(239,68,68,0.10)' : isHovered ? 'rgba(249,115,22,0.10)' : 'rgba(13,148,136,0.07)'
              const strokeW     = isSelected || isHovered ? 2.5 : 1.8
              return (
                <g key={bg.building_group_id}
                  style={{ cursor: inDeleteBuilding ? 'pointer' : 'default' }}
                  onPointerEnter={inDeleteBuilding ? () => setHoveredBgId(bg.building_group_id) : undefined}
                  onPointerLeave={inDeleteBuilding ? () => setHoveredBgId(null) : undefined}
                  onClick={inDeleteBuilding ? () => onBuildingGroupSelect?.(bg.building_group_id) : undefined}
                  onContextMenu={inDeleteBuilding ? (e) => {
                    e.preventDefault()
                    if (!selectedBgIds.has(bg.building_group_id)) onBuildingGroupSelect?.(bg.building_group_id)
                    onBuildingGroupContextMenu?.(bg.building_group_id, ell.cx, ell.cy)
                  } : undefined}
                >
                  {/* White halo for legibility over any PDF background */}
                  <ellipse cx={ell.cx} cy={ell.cy} rx={ell.rx + 2} ry={ell.ry + 2}
                    fill="none" stroke="rgba(255,255,255,0.6)" strokeWidth={strokeW + 3}
                    style={{ pointerEvents: 'none' }} />
                  <ellipse cx={ell.cx} cy={ell.cy} rx={ell.rx} ry={ell.ry}
                    fill={fillColor}
                    stroke={strokeColor}
                    strokeWidth={strokeW}
                    strokeDasharray="6 4"
                    style={{ pointerEvents: inDeleteBuilding ? 'fill' : 'none' }}
                  />
                  {zoom > 0.5 && (
                    <text
                      x={ell.cx} y={ell.cy + ell.ry + 13}
                      textAnchor="middle"
                      fontSize={Math.max(8, 10 / zoom)}
                      fill={strokeColor}
                      stroke="rgba(255,255,255,0.9)" strokeWidth={2.5 / zoom}
                      paintOrder="stroke"
                      style={{ pointerEvents: 'none', userSelect: 'none' }}
                    >
                      {bg.building_name}
                    </text>
                  )}
                </g>
              )
            })}

            {/* ── Building group draw preview ── */}
            {inDrawBuilding && bgDrawPoints.length > 0 && (() => {
              const svgPts = bgDrawPoints.map(p => normToScreen(p.x, p.y))
              const svgFirst = svgPts[0]
              const svgLast  = svgPts[svgPts.length - 1]
              const nearFirst = bgDrawPoints.length >= 3 && bgDrawCursorSvg
                && Math.hypot(svgFirst.x - bgDrawCursorSvg.x, svgFirst.y - bgDrawCursorSvg.y) < SNAP_TRACE_PX
              return (
                <>
                  {svgPts.length >= 2 && (
                    <polyline points={svgPts.map(p => `${p.x},${p.y}`).join(' ')}
                      fill="none" stroke="#0d9488" strokeWidth={2} strokeLinejoin="round" />
                  )}
                  {/* Closing line preview */}
                  {bgDrawCursorSvg && svgLast && !nearFirst && (
                    <line x1={svgLast.x} y1={svgLast.y} x2={bgDrawCursorSvg.x} y2={bgDrawCursorSvg.y}
                      stroke="#0d9488" strokeWidth={1.5} strokeDasharray="5 4" />
                  )}
                  {nearFirst && (
                    <line x1={svgLast.x} y1={svgLast.y} x2={svgFirst.x} y2={svgFirst.y}
                      stroke="#0d9488" strokeWidth={1.5} strokeDasharray="5 4" />
                  )}
                  {/* Fill preview when about to close */}
                  {nearFirst && (
                    <polygon points={svgPts.map(p => `${p.x},${p.y}`).join(' ')}
                      fill="rgba(13,148,136,0.12)" stroke="none" />
                  )}
                  {/* Vertex dots */}
                  {svgPts.map((p, i) => (
                    <circle key={i} cx={p.x} cy={p.y} r={i === 0 ? 6 : 4}
                      fill={i === 0 && bgDrawPoints.length >= 3 ? (nearFirst ? 'rgba(13,148,136,0.3)' : 'none') : '#0d9488'}
                      stroke="#0d9488" strokeWidth={2} />
                  ))}
                  {/* Snap ring on first point when close enough */}
                  {bgDrawPoints.length >= 3 && (
                    <circle cx={svgFirst.x} cy={svgFirst.y}
                      r={nearFirst ? SNAP_TRACE_PX : 8}
                      fill={nearFirst ? 'rgba(13,148,136,0.2)' : 'none'}
                      stroke="#0d9488" strokeWidth={nearFirst ? 2 : 1.5} strokeDasharray={nearFirst ? 'none' : '3 2'} />
                  )}
                  {/* Cursor dot */}
                  {bgDrawCursorSvg && (
                    <circle cx={bgDrawCursorSvg.x} cy={bgDrawCursorSvg.y} r={3}
                      fill="#0d9488" stroke="#fff" strokeWidth={1} />
                  )}
                </>
              )
            })()}

            {/* Draw-building: cursor dot when no points yet */}
            {inDrawBuilding && bgDrawPoints.length === 0 && bgDrawCursorSvg && (
              <circle cx={bgDrawCursorSvg.x} cy={bgDrawCursorSvg.y} r={4}
                fill="rgba(13,148,136,0.5)" stroke="#0d9488" strokeWidth={1.5}
                style={{ pointerEvents: 'none' }} />
            )}

            {/* ── Unit count overlays ── */}
            {rightPanelTab === 'unit-counts' && cssDims && boundaries.map(b => {
              if (!b.phase_id) return null
              const phaseData = phasesData.find(p => p.phase_id === b.phase_id)
              if (!phaseData) return null

              const byLt = (phaseData.by_lot_type || []).filter(lt => (lt.actual || 0) > 0 || (lt.projected || 0) > 0)

              const pts   = JSON.parse(b.polygon_json)
              const svg   = pts.map(p => normToScreen(p.x, p.y))
              const cx    = svg.reduce((s,p) => s+p.x, 0) / svg.length
              const cy    = svg.reduce((s,p) => s+p.y, 0) / svg.length

              const totalR = byLt.reduce((s,lt) => s+(lt.actual||0), 0)
              const totalP = byLt.reduce((s,lt) => s+(lt.projected||0), 0)
              const totalT = byLt.reduce((s,lt) => s+(lt.total||0), 0)

              const fs     = Math.max(8, 10.5 / zoom)
              const lineH  = fs * 1.65
              const charW  = fs * 0.6   // monospace approximation

              if (!unitCountsSubtotal) {
                // ── Totals mode ─────────────────────────────────
                const label = `r:${totalR}  p:${totalP}  t:${totalT}`
                const bw = label.length * charW + 10
                return (
                  <g key={`uc_${b.boundary_id}`} style={{ pointerEvents: 'none' }}>
                    <rect x={cx - bw/2} y={cy - fs * 0.85} width={bw} height={fs * 1.35}
                      rx={3} fill="rgba(255,255,255,0.84)" />
                    <text x={cx} y={cy} textAnchor="middle" dominantBaseline="central"
                      fontFamily="monospace" fontSize={fs} fill="#1e293b" fontWeight="600"
                      style={{ userSelect: 'none' }}>
                      {label}
                    </text>
                  </g>
                )
              }

              // ── Subtotal by product type ─────────────────────
              if (!byLt.length) return null
              const rowCount = byLt.length
              const maxLabelLen = Math.max(...byLt.map(lt => `${lt.lot_type_short}: r:${lt.actual||0}  p:${lt.projected||0}  t:${lt.total||0}`.length))
              const boxW  = maxLabelLen * charW + 12
              const boxH  = rowCount * lineH + 6
              const startY = cy - boxH / 2 + lineH * 0.5

              return (
                <g key={`uc_${b.boundary_id}`}>
                  {/* Background card */}
                  <rect x={cx - boxW/2 - 2} y={startY - lineH * 0.75}
                    width={boxW + 4} height={boxH}
                    rx={4} fill="rgba(255,255,255,0.88)"
                    style={{ pointerEvents: 'none' }}
                  />
                  {byLt.map((lt, i) => {
                    const rowY   = startY + i * lineH
                    const prefix = `${lt.lot_type_short}: r:${lt.actual||0}  `
                    const pText  = `p:${lt.projected||0}`
                    const suffix = `  t:${lt.total||0}`
                    const prefixW = prefix.length * charW
                    const pW      = pText.length  * charW
                    const startX  = cx - (prefix.length + pText.length + suffix.length) * charW / 2

                    return (
                      <g key={lt.lot_type_id}
                        style={{ cursor: 'pointer', pointerEvents: 'all' }}
                        onClick={(e) => {
                          e.stopPropagation()
                          onEditProjected?.(b.phase_id, lt.lot_type_id, lt.projected||0, cx, rowY + lineH * 0.4)
                        }}
                      >
                        {/* Hit area */}
                        <rect x={cx - boxW/2} y={rowY - lineH * 0.72} width={boxW} height={lineH}
                          fill="transparent" />
                        {/* Gray prefix: "SF: r:5  " */}
                        <text x={startX} y={rowY} dominantBaseline="auto"
                          fontFamily="monospace" fontSize={fs} fill="#64748b"
                          stroke="rgba(255,255,255,0.8)" strokeWidth={2/zoom} paintOrder="stroke"
                          style={{ userSelect: 'none', pointerEvents: 'none' }}>
                          {prefix}
                        </text>
                        {/* Teal p value */}
                        <text x={startX + prefixW} y={rowY} dominantBaseline="auto"
                          fontFamily="monospace" fontSize={fs} fill="#0f766e" fontWeight="700"
                          stroke="rgba(255,255,255,0.8)" strokeWidth={2/zoom} paintOrder="stroke"
                          style={{ userSelect: 'none', pointerEvents: 'none' }}>
                          {pText}
                        </text>
                        {/* Underline under p value */}
                        <line x1={startX + prefixW} y1={rowY + fs * 0.18}
                          x2={startX + prefixW + pW} y2={rowY + fs * 0.18}
                          stroke="#0d9488" strokeWidth={Math.max(0.8, 1.2/zoom)} />
                        {/* Dark suffix: "  t:10" */}
                        <text x={startX + prefixW + pW} y={rowY} dominantBaseline="auto"
                          fontFamily="monospace" fontSize={fs} fill="#374151"
                          stroke="rgba(255,255,255,0.8)" strokeWidth={2/zoom} paintOrder="stroke"
                          style={{ userSelect: 'none', pointerEvents: 'none' }}>
                          {suffix}
                        </text>
                      </g>
                    )
                  })}
                </g>
              )
            })}

            {/* ── Lot markers ── */}
            {cssDims && Object.entries(lotPositions).map(([lotIdStr, pos]) => {
              const lotId = Number(lotIdStr)
              const isBeingDragged = lotId === dragLotId
              const displayPos = (isBeingDragged && dragLotPos) ? dragLotPos : pos
              const sp = normToScreen(displayPos.x, displayPos.y)
              const color = lotColorMap[lotId] || '#6366f1'
              const label = lotLabel(lotMeta[lotId]?.lot_number)
              return (
                <g key={lotId} style={{ pointerEvents: 'none' }}>
                  <circle cx={sp.x} cy={sp.y} r={isBeingDragged ? 8 : 6}
                    fill={color} stroke="#fff" strokeWidth={1.5}
                    opacity={isBeingDragged ? 0.75 : 1} />
                  {zoom > 0.65 && (
                    <text x={sp.x} y={sp.y - 9} textAnchor="middle"
                      fontSize={Math.max(8, 10 / zoom)} fill="#1e293b"
                      stroke="rgba(255,255,255,0.9)" strokeWidth={2.5 / zoom}
                      paintOrder="stroke"
                      style={{ pointerEvents: 'none', userSelect: 'none' }}>
                      {label}
                    </text>
                  )}
                </g>
              )
            })}

            {/* ── Place mode cursor tooltip ── */}
            {inPlace && placingLot && placeCursorSvg && (
              <g style={{ pointerEvents: 'none' }}>
                <circle cx={placeCursorSvg.x} cy={placeCursorSvg.y} r={5}
                  fill="rgba(124,58,237,0.5)" stroke="#7c3aed" strokeWidth={1.5}
                  strokeDasharray="3 2" />
                <text x={placeCursorSvg.x + 11} y={placeCursorSvg.y - 4}
                  fontSize={12} fill="#7c3aed"
                  stroke="rgba(255,255,255,0.95)" strokeWidth={3} paintOrder="stroke"
                  style={{ userSelect: 'none', fontWeight: 600 }}>
                  {lotLabel(placingLot.lot_number)}
                </text>
              </g>
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
