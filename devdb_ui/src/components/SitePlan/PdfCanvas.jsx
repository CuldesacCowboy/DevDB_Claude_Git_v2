// PdfCanvas.jsx
// PDF viewer with pan, zoom, rotation, parcel trace, and parcel vertex editing.
//
// Props:
//   pdfUrl        — URL to fetch the PDF
//   planId        — plan_id for saving parcel to the backend
//   initialParcel — [{x,y}] normalized coords (0–1) loaded from DB, or null
//   mode          — 'view' | 'trace' | 'edit'
//   onModeChange  — (newMode) => void
//   onParcelSaved — (points) => void

import { useEffect, useRef, useState, useCallback } from 'react'
import * as pdfjsLib from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.mjs?url'

pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl

const RENDER_SCALE   = 2.0
const MIN_ZOOM       = 0.1
const MAX_ZOOM       = 8.0
const SNAP_PX        = 16   // px — snap-to-first ring in trace mode
const DRAG_THRESHOLD = 5    // px — below this = click, above = drag
const VERTEX_HIT_PX  = 12  // px — vertex handle hit radius
const EDGE_HIT_PX    = 8   // px — edge hit radius for add-vertex

// ─── Geometry helpers ─────────────────────────────────────────────────────────
function distToSeg(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay
  const len2 = dx * dx + dy * dy
  const t = len2 > 0 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2)) : 0
  const cx = ax + t * dx, cy = ay + t * dy
  return { dist: Math.hypot(px - cx, py - cy), t, cx, cy }
}

export default function PdfCanvas({
  pdfUrl,
  planId,
  initialParcel,
  mode,
  onModeChange,
  onParcelSaved,
}) {
  const canvasRef    = useRef(null)
  const containerRef = useRef(null)

  // Pan/zoom state
  const [cssDims, setCssDims] = useState(null)
  const [pan, setPan]         = useState({ x: 0, y: 0 })
  const [zoom, setZoom]       = useState(1.0)
  const [rotation, setRotation] = useState(0)

  // Parcel state
  const [savedParcel, setSavedParcel]   = useState(initialParcel || null)

  // Trace mode state
  const [tracePoints, setTracePoints]   = useState([])
  const [cursorNorm, setCursorNorm]     = useState(null)

  // Edit mode state
  const [editPoints, setEditPoints]     = useState(null)
  const [hoverTarget, setHoverTarget]   = useState(null)  // {type:'vertex'|'edge', idx, point?}

  // Interaction refs (avoid stale closures in pointer handlers)
  const dragRef  = useRef(null)   // view-mode pan
  const traceRef = useRef(null)   // trace-mode pointer
  const editRef  = useRef(null)   // edit-mode pointer

  // Keep savedParcel in sync when parent re-provides initialParcel
  useEffect(() => { setSavedParcel(initialParcel || null) }, [initialParcel])

  // Reset mode-local state when mode changes
  useEffect(() => {
    if (mode === 'trace') {
      setTracePoints([])
      setCursorNorm(null)
      setEditPoints(null)
      setHoverTarget(null)
      editRef.current = null
    } else if (mode === 'edit') {
      setTracePoints([])
      setCursorNorm(null)
      traceRef.current = null
      setEditPoints(savedParcel ? [...savedParcel] : null)
      setHoverTarget(null)
    } else {
      setTracePoints([])
      setCursorNorm(null)
      setEditPoints(null)
      setHoverTarget(null)
      traceRef.current = null
      editRef.current = null
    }
  }, [mode]) // eslint-disable-line react-hooks/exhaustive-deps

  // ─── PDF load + render ─────────────────────────────────────────────────────
  useEffect(() => {
    if (!pdfUrl) return
    let cancelled = false

    async function load() {
      const pdf      = await pdfjsLib.getDocument(pdfUrl).promise
      if (cancelled) return
      const page     = await pdf.getPage(1)
      if (cancelled) return
      const viewport = page.getViewport({ scale: RENDER_SCALE, rotation })
      const canvas   = canvasRef.current
      canvas.width   = viewport.width
      canvas.height  = viewport.height
      const ctx      = canvas.getContext('2d')
      await page.render({ canvasContext: ctx, viewport }).promise
      if (cancelled) return

      const w = viewport.width  / RENDER_SCALE
      const h = viewport.height / RENDER_SCALE
      setCssDims({ width: w, height: h })
      const cont = containerRef.current
      if (cont) {
        const fit = Math.min(cont.clientWidth / w, cont.clientHeight / h, 1.0)
        setZoom(fit)
        setPan({ x: (cont.clientWidth - w * fit) / 2, y: (cont.clientHeight - h * fit) / 2 })
      }
    }

    load()
    return () => { cancelled = true }
  }, [pdfUrl, rotation])

  // ─── Coordinate conversion ────────────────────────────────────────────────
  const screenToNorm = useCallback((sx, sy) => {
    if (!cssDims) return null
    return { x: (sx - pan.x) / zoom / cssDims.width, y: (sy - pan.y) / zoom / cssDims.height }
  }, [cssDims, pan, zoom])

  const normToScreen = useCallback((nx, ny) => {
    if (!cssDims) return { x: 0, y: 0 }
    return { x: nx * cssDims.width * zoom + pan.x, y: ny * cssDims.height * zoom + pan.y }
  }, [cssDims, pan, zoom])

  // ─── Edit mode hit detection ──────────────────────────────────────────────
  function getEditTarget(sx, sy, svgPts) {
    // Vertices have priority over edges
    for (let i = 0; i < svgPts.length; i++) {
      if (Math.hypot(svgPts[i].x - sx, svgPts[i].y - sy) < VERTEX_HIT_PX) {
        return { type: 'vertex', idx: i }
      }
    }
    for (let i = 0; i < svgPts.length; i++) {
      const a = svgPts[i], b = svgPts[(i + 1) % svgPts.length]
      const { dist, cx, cy } = distToSeg(sx, sy, a.x, a.y, b.x, b.y)
      if (dist < EDGE_HIT_PX) {
        return { type: 'edge', idx: i, point: { x: cx, y: cy } }
      }
    }
    return null
  }

  // ─── Parcel save ──────────────────────────────────────────────────────────
  async function saveParcel(points) {
    setSavedParcel(points)
    onParcelSaved?.(points)
    try {
      await fetch(`/api/site-plans/${planId}/parcel`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ parcel_json: JSON.stringify(points) }),
      })
    } catch (err) {
      console.error('Failed to save parcel:', err)
    }
  }

  // ─── Zoom helpers ─────────────────────────────────────────────────────────
  function handleWheel(e) {
    e.preventDefault()
    const rect    = containerRef.current.getBoundingClientRect()
    const cx      = e.clientX - rect.left, cy = e.clientY - rect.top
    const factor  = e.deltaY < 0 ? 1.12 : 1 / 1.12
    const newZoom = Math.min(Math.max(zoom * factor, MIN_ZOOM), MAX_ZOOM)
    const ratio   = newZoom / zoom
    setPan(p => ({ x: cx - (cx - p.x) * ratio, y: cy - (cy - p.y) * ratio }))
    setZoom(newZoom)
  }

  function zoomBy(factor) {
    if (!containerRef.current) return
    const rect  = containerRef.current.getBoundingClientRect()
    const cx    = rect.width / 2, cy = rect.height / 2
    const nz    = Math.min(Math.max(zoom * factor, MIN_ZOOM), MAX_ZOOM)
    const ratio = nz / zoom
    setPan(p => ({ x: cx - (cx - p.x) * ratio, y: cy - (cy - p.y) * ratio }))
    setZoom(nz)
  }

  function resetView() {
    if (!cssDims || !containerRef.current) return
    const { clientWidth: cw, clientHeight: ch } = containerRef.current
    const fit = Math.min(cw / cssDims.width, ch / cssDims.height, 1.0)
    setZoom(fit)
    setPan({ x: (cw - cssDims.width * fit) / 2, y: (ch - cssDims.height * fit) / 2 })
  }

  // ─── View-mode pan ────────────────────────────────────────────────────────
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

  // ─── Trace-mode handlers ──────────────────────────────────────────────────
  function handleTracePointerDown(e) {
    if (e.button !== 0) return
    e.currentTarget.setPointerCapture(e.pointerId)
    traceRef.current = { startX: e.clientX, startY: e.clientY, startPanX: pan.x, startPanY: pan.y, moved: false }
  }

  function handleTracePointerMove(e) {
    const ref  = traceRef.current
    const rect = containerRef.current.getBoundingClientRect()
    setCursorNorm(screenToNorm(e.clientX - rect.left, e.clientY - rect.top))
    if (!ref) return
    const dx = e.clientX - ref.startX, dy = e.clientY - ref.startY
    if (Math.hypot(dx, dy) > DRAG_THRESHOLD) {
      ref.moved = true
      setPan({ x: ref.startPanX + dx, y: ref.startPanY + dy })
    }
  }

  function handleTracePointerUp(e) {
    const ref = traceRef.current
    traceRef.current = null
    if (!ref || ref.moved) return
    const rect  = containerRef.current.getBoundingClientRect()
    const sx    = e.clientX - rect.left, sy = e.clientY - rect.top
    const norm  = screenToNorm(sx, sy)
    if (!norm) return

    if (tracePoints.length >= 3) {
      const first = normToScreen(tracePoints[0].x, tracePoints[0].y)
      if (Math.hypot(first.x - sx, first.y - sy) < SNAP_PX) { closePolygon(); return }
    }
    setTracePoints(pts => [...pts, norm])
  }

  async function closePolygon() {
    if (tracePoints.length < 3) return
    const points = tracePoints
    setTracePoints([])
    setCursorNorm(null)
    onModeChange('view')
    await saveParcel(points)
  }

  // ─── Edit-mode handlers ───────────────────────────────────────────────────
  const editSvgPoints = cssDims && editPoints ? editPoints.map(p => normToScreen(p.x, p.y)) : []

  function handleEditPointerDown(e) {
    if (e.button !== 0) return
    e.currentTarget.setPointerCapture(e.pointerId)
    const rect   = containerRef.current.getBoundingClientRect()
    const sx     = e.clientX - rect.left, sy = e.clientY - rect.top
    const target = getEditTarget(sx, sy, editSvgPoints)

    editRef.current = {
      target,
      startX: e.clientX, startY: e.clientY,
      startPanX: pan.x,  startPanY: pan.y,
      startPts: editPoints ? [...editPoints] : [],
      moved: false,
    }
  }

  function handleEditPointerMove(e) {
    const ref  = editRef.current
    const rect = containerRef.current.getBoundingClientRect()
    const sx   = e.clientX - rect.left, sy = e.clientY - rect.top

    // Update hover target for cursor/visual feedback
    if (!ref?.moved) setHoverTarget(getEditTarget(sx, sy, editSvgPoints))

    if (!ref) return
    const dx = e.clientX - ref.startX, dy = e.clientY - ref.startY
    if (Math.hypot(dx, dy) <= DRAG_THRESHOLD) return
    ref.moved = true

    if (ref.target?.type === 'vertex') {
      // Drag vertex to new position
      const norm = screenToNorm(sx, sy)
      if (norm) {
        const newPts = [...ref.startPts]
        newPts[ref.target.idx] = norm
        setEditPoints(newPts)
      }
    } else {
      // Pan
      setPan({ x: ref.startPanX + dx, y: ref.startPanY + dy })
    }
  }

  function handleEditPointerUp(e) {
    const ref = editRef.current
    editRef.current = null
    if (!ref) return

    if (ref.target?.type === 'vertex' && ref.moved) {
      // Commit vertex drag
      saveParcel(editPoints)
    } else if (!ref.moved) {
      // Click — check for edge add
      const rect   = containerRef.current.getBoundingClientRect()
      const sx     = e.clientX - rect.left, sy = e.clientY - rect.top
      const target = getEditTarget(sx, sy, editSvgPoints)
      if (target?.type === 'edge') {
        const norm = screenToNorm(target.point.x, target.point.y)
        if (norm) {
          const newPts = [...(editPoints || [])]
          newPts.splice(target.idx + 1, 0, norm)
          setEditPoints(newPts)
          saveParcel(newPts)
        }
      }
    }
  }

  function handleEditContextMenu(e) {
    e.preventDefault()
    if (!editPoints || editPoints.length <= 3) return
    const rect   = containerRef.current.getBoundingClientRect()
    const sx     = e.clientX - rect.left, sy = e.clientY - rect.top
    const target = getEditTarget(sx, sy, editSvgPoints)
    if (target?.type === 'vertex') {
      const newPts = editPoints.filter((_, i) => i !== target.idx)
      setEditPoints(newPts)
      saveParcel(newPts)
    }
  }

  // ─── Derived overlay values ───────────────────────────────────────────────
  const inTrace    = mode === 'trace'
  const inEdit     = mode === 'edit'
  const overlayOn  = inTrace || inEdit

  const svgTrace   = cssDims ? tracePoints.map(p => normToScreen(p.x, p.y)) : []
  const svgSaved   = cssDims && savedParcel ? savedParcel.map(p => normToScreen(p.x, p.y)) : []
  const svgCursor  = cssDims && cursorNorm ? normToScreen(cursorNorm.x, cursorNorm.y) : null
  const svgFirst   = svgTrace[0] ?? null
  const svgLast    = svgTrace[svgTrace.length - 1] ?? null
  const snapToFirst = svgFirst && svgCursor && tracePoints.length >= 3 &&
    Math.hypot(svgFirst.x - svgCursor.x, svgFirst.y - svgCursor.y) < SNAP_PX

  const tracePoly = svgTrace.map(p => `${p.x},${p.y}`).join(' ')
  const savedPoly = svgSaved.map(p => `${p.x},${p.y}`).join(' ')
  const editPoly  = editSvgPoints.map(p => `${p.x},${p.y}`).join(' ')

  const editCursor = inEdit
    ? (hoverTarget?.type === 'vertex' ? 'move' : hoverTarget?.type === 'edge' ? 'cell' : dragRef.current ? 'grabbing' : 'grab')
    : 'default'

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>

      {/* Pan/zoom viewport */}
      <div
        ref={containerRef}
        style={{ width: '100%', height: '100%', overflow: 'hidden', background: '#374151',
          cursor: mode === 'view' ? (dragRef.current ? 'grabbing' : 'grab') : 'default' }}
        onWheel={handleWheel}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerLeave={handlePointerUp}
      >
        {/* PDF canvas */}
        <div style={{ position: 'absolute', transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`, transformOrigin: '0 0' }}>
          <canvas ref={canvasRef} style={{ display: 'block', width: cssDims ? cssDims.width : 0, height: cssDims ? cssDims.height : 0, boxShadow: '0 4px 24px rgba(0,0,0,0.4)' }} />
        </div>

        {/* SVG overlay */}
        {cssDims && (
          <svg
            style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%',
              pointerEvents: overlayOn ? 'all' : 'none',
              cursor: inTrace ? (snapToFirst ? 'cell' : 'crosshair') : inEdit ? editCursor : 'default',
              overflow: 'visible' }}
            onWheel={handleWheel}
            onPointerDown={inTrace ? handleTracePointerDown : inEdit ? handleEditPointerDown : undefined}
            onPointerMove={inTrace ? handleTracePointerMove : inEdit ? handleEditPointerMove : undefined}
            onPointerUp={inTrace ? handleTracePointerUp : inEdit ? handleEditPointerUp : undefined}
            onPointerLeave={inTrace ? () => setCursorNorm(null) : inEdit ? () => setHoverTarget(null) : undefined}
            onContextMenu={inEdit ? handleEditContextMenu : undefined}
          >

            {/* ── Saved parcel (view mode) ── */}
            {!inEdit && svgSaved.length >= 3 && (
              <polygon points={savedPoly} fill="rgba(37,99,235,0.08)" stroke="#2563eb" strokeWidth={2} />
            )}

            {/* ── Edit mode parcel ── */}
            {inEdit && editSvgPoints.length >= 3 && (
              <>
                <polygon points={editPoly} fill="rgba(37,99,235,0.08)" stroke="#2563eb" strokeWidth={2} />

                {/* Edge hover indicator */}
                {hoverTarget?.type === 'edge' && (
                  <circle cx={hoverTarget.point.x} cy={hoverTarget.point.y} r={5}
                    fill="#fff" stroke="#2563eb" strokeWidth={2} strokeDasharray="2 2" />
                )}

                {/* Vertex handles */}
                {editSvgPoints.map((p, i) => {
                  const isHovered = hoverTarget?.type === 'vertex' && hoverTarget.idx === i
                  return (
                    <circle key={i} cx={p.x} cy={p.y} r={isHovered ? 9 : 6}
                      fill="#fff" stroke={isHovered ? '#1d4ed8' : '#2563eb'}
                      strokeWidth={isHovered ? 2.5 : 2} style={{ cursor: 'move' }} />
                  )
                })}

                {/* Right-click hint — only show when hovering a vertex and enough points to delete */}
                {hoverTarget?.type === 'vertex' && editPoints?.length > 3 && (() => {
                  const p = editSvgPoints[hoverTarget.idx]
                  return <text x={p.x + 12} y={p.y - 8} fontSize={10} fill="#6b7280" style={{ pointerEvents: 'none', userSelect: 'none' }}>right-click to delete</text>
                })()}
              </>
            )}

            {/* ── Trace mode ── */}
            {inTrace && svgTrace.length > 0 && (
              <>
                {svgTrace.length >= 2 && (
                  <polyline points={tracePoly} fill="none" stroke="#f59e0b" strokeWidth={2} strokeLinejoin="round" />
                )}
                {svgCursor && svgLast && !snapToFirst && (
                  <line x1={svgLast.x} y1={svgLast.y} x2={svgCursor.x} y2={svgCursor.y}
                    stroke="#f59e0b" strokeWidth={1.5} strokeDasharray="5 4" />
                )}
                {snapToFirst && svgLast && (
                  <>
                    <line x1={svgLast.x} y1={svgLast.y} x2={svgFirst.x} y2={svgFirst.y}
                      stroke="#f59e0b" strokeWidth={1.5} strokeDasharray="5 4" />
                    <polygon points={tracePoly} fill="rgba(245,158,11,0.08)" stroke="none" />
                  </>
                )}
                {svgTrace.map((p, i) => (
                  <circle key={i} cx={p.x} cy={p.y} r={4} fill="#f59e0b" stroke="#fff" strokeWidth={1.5} />
                ))}
                {svgFirst && tracePoints.length >= 3 && (
                  <circle cx={svgFirst.x} cy={svgFirst.y} r={snapToFirst ? SNAP_PX : 7}
                    fill={snapToFirst ? 'rgba(245,158,11,0.25)' : 'none'} stroke="#f59e0b" strokeWidth={2} />
                )}
                {svgCursor && (
                  <circle cx={svgCursor.x} cy={svgCursor.y} r={3} fill="#f59e0b" stroke="#fff" strokeWidth={1} />
                )}
              </>
            )}
          </svg>
        )}
      </div>

      {/* Bottom-right controls */}
      {cssDims && (
        <div style={{ position: 'absolute', bottom: 16, right: 16, display: 'flex', gap: 6 }}>
          {inTrace && tracePoints.length >= 3 && (
            <button onClick={closePolygon}
              style={{ ...btnStyle, width: 'auto', padding: '0 10px', fontSize: 12, color: '#92400e', borderColor: '#f59e0b', background: 'rgba(255,251,235,0.95)' }}>
              Close
            </button>
          )}
          <button onClick={() => zoomBy(1.25)} style={btnStyle}>+</button>
          <button onClick={() => zoomBy(1 / 1.25)} style={btnStyle}>−</button>
          <button onClick={resetView} style={btnStyle}>Fit</button>
          <button onClick={() => setRotation(r => (r + 90) % 360)} style={btnStyle} title="Rotate 90°">↻</button>
        </div>
      )}
    </div>
  )
}

const btnStyle = {
  width: 32, height: 32,
  background: 'rgba(255,255,255,0.92)', border: '1px solid #d1d5db',
  borderRadius: 6, fontSize: 16, fontWeight: 600,
  cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
  color: '#374151',
}
