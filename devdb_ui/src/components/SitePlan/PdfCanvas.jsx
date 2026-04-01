// PdfCanvas.jsx
// PDF viewer with pan, wheel zoom, rotation, and parcel trace overlay.
//
// Props:
//   pdfUrl        — URL to fetch the PDF
//   planId        — plan_id for saving parcel to the backend
//   initialParcel — [{x, y}] normalized coords loaded from DB, or null
//   mode          — 'view' | 'trace'
//   onModeChange  — (newMode) => void
//   onParcelSaved — (points) => void  called after successful save

import { useEffect, useRef, useState, useCallback } from 'react'
import * as pdfjsLib from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.mjs?url'

pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl

const RENDER_SCALE = 2.0
const MIN_ZOOM = 0.1
const MAX_ZOOM = 8.0
const SNAP_PX = 16       // px distance to first vertex that triggers snap-to-close
const DRAG_THRESHOLD = 5 // px movement before a pointer-down is treated as a drag

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
  const dragRef      = useRef(null)  // view-mode pan state
  const traceRef     = useRef(null)  // trace-mode pointer-down state

  const [cssDims, setCssDims]       = useState(null)
  const [pan, setPan]               = useState({ x: 0, y: 0 })
  const [zoom, setZoom]             = useState(1.0)
  const [rotation, setRotation]     = useState(0)          // 0 | 90 | 180 | 270

  const [savedParcel, setSavedParcel]   = useState(initialParcel || null)
  const [tracePoints, setTracePoints]   = useState([])  // in-progress vertices (normalized)
  const [cursorNorm, setCursorNorm]     = useState(null)

  // Keep savedParcel in sync if parent re-loads the plan
  useEffect(() => { setSavedParcel(initialParcel || null) }, [initialParcel])

  // Clear trace state whenever mode returns to view
  useEffect(() => {
    if (mode !== 'trace') {
      setTracePoints([])
      setCursorNorm(null)
      traceRef.current = null
    }
  }, [mode])

  // ─── PDF load + render ────────────────────────────────────────────────────
  useEffect(() => {
    if (!pdfUrl) return
    let cancelled = false

    async function load() {
      const pdf  = await pdfjsLib.getDocument(pdfUrl).promise
      if (cancelled) return
      const page = await pdf.getPage(1)
      if (cancelled) return

      const viewport = page.getViewport({ scale: RENDER_SCALE, rotation })
      const canvas   = canvasRef.current
      canvas.width   = viewport.width
      canvas.height  = viewport.height

      const ctx = canvas.getContext('2d')
      await page.render({ canvasContext: ctx, viewport }).promise

      if (!cancelled) {
        const w = viewport.width  / RENDER_SCALE
        const h = viewport.height / RENDER_SCALE
        setCssDims({ width: w, height: h })

        // Fit to viewport
        const container = containerRef.current
        if (container) {
          const cw = container.clientWidth
          const ch = container.clientHeight
          const fit = Math.min(cw / w, ch / h, 1.0)
          setZoom(fit)
          setPan({ x: (cw - w * fit) / 2, y: (ch - h * fit) / 2 })
        }
      }
    }

    load()
    return () => { cancelled = true }
  }, [pdfUrl, rotation])

  // ─── Coordinate helpers ───────────────────────────────────────────────────
  // Screen coords (relative to container top-left) ↔ normalized PDF coords (0–1)
  const screenToNorm = useCallback((sx, sy) => {
    if (!cssDims) return null
    return { x: (sx - pan.x) / zoom / cssDims.width, y: (sy - pan.y) / zoom / cssDims.height }
  }, [cssDims, pan, zoom])

  const normToScreen = useCallback((nx, ny) => {
    if (!cssDims) return { x: 0, y: 0 }
    return { x: nx * cssDims.width * zoom + pan.x, y: ny * cssDims.height * zoom + pan.y }
  }, [cssDims, pan, zoom])

  // ─── Zoom ─────────────────────────────────────────────────────────────────
  function handleWheel(e) {
    e.preventDefault()
    const rect    = containerRef.current.getBoundingClientRect()
    const cursorX = e.clientX - rect.left
    const cursorY = e.clientY - rect.top
    const factor  = e.deltaY < 0 ? 1.12 : 1 / 1.12
    const newZoom = Math.min(Math.max(zoom * factor, MIN_ZOOM), MAX_ZOOM)
    const ratio   = newZoom / zoom
    setPan(p => ({ x: cursorX - (cursorX - p.x) * ratio, y: cursorY - (cursorY - p.y) * ratio }))
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
    if (e.button !== 0 || mode === 'trace') return
    e.currentTarget.setPointerCapture(e.pointerId)
    dragRef.current = { startX: e.clientX, startY: e.clientY, startPanX: pan.x, startPanY: pan.y }
  }

  function handlePointerMove(e) {
    if (!dragRef.current) return
    setPan({
      x: dragRef.current.startPanX + (e.clientX - dragRef.current.startX),
      y: dragRef.current.startPanY + (e.clientY - dragRef.current.startY),
    })
  }

  function handlePointerUp() { dragRef.current = null }

  // ─── Trace-mode overlay events ────────────────────────────────────────────
  function handleTracePointerDown(e) {
    if (e.button !== 0) return
    e.currentTarget.setPointerCapture(e.pointerId)
    traceRef.current = {
      startX: e.clientX, startY: e.clientY,
      startPanX: pan.x, startPanY: pan.y,
      moved: false,
    }
  }

  function handleTracePointerMove(e) {
    const ref = traceRef.current
    const rect = containerRef.current.getBoundingClientRect()

    // Update cursor preview
    const norm = screenToNorm(e.clientX - rect.left, e.clientY - rect.top)
    setCursorNorm(norm)

    if (!ref) return
    const dx = e.clientX - ref.startX
    const dy = e.clientY - ref.startY
    if (Math.hypot(dx, dy) > DRAG_THRESHOLD) {
      ref.moved = true
      setPan({ x: ref.startPanX + dx, y: ref.startPanY + dy })
    }
  }

  function handleTracePointerUp(e) {
    const ref = traceRef.current
    traceRef.current = null
    if (!ref || ref.moved) return

    const rect = containerRef.current.getBoundingClientRect()
    const clickX = e.clientX - rect.left
    const clickY = e.clientY - rect.top
    const norm = screenToNorm(clickX, clickY)
    if (!norm) return

    // Snap to first vertex → close polygon
    if (tracePoints.length >= 3) {
      const first = normToScreen(tracePoints[0].x, tracePoints[0].y)
      if (Math.hypot(first.x - clickX, first.y - clickY) < SNAP_PX) {
        closePolygon()
        return
      }
    }

    setTracePoints(pts => [...pts, norm])
  }

  function handleTracePointerLeave() {
    setCursorNorm(null)
  }

  // ─── Parcel close + save ──────────────────────────────────────────────────
  async function closePolygon() {
    if (tracePoints.length < 3) return
    const points = tracePoints
    setTracePoints([])
    setCursorNorm(null)
    setSavedParcel(points)
    onModeChange('view')

    try {
      await fetch(`/api/site-plans/${planId}/parcel`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ parcel_json: JSON.stringify(points) }),
      })
      onParcelSaved?.(points)
    } catch (err) {
      console.error('Failed to save parcel:', err)
    }
  }

  // ─── Derived overlay state ────────────────────────────────────────────────
  const inTrace    = mode === 'trace'
  const svgTrace   = cssDims ? tracePoints.map(p => normToScreen(p.x, p.y)) : []
  const svgSaved   = cssDims && savedParcel ? savedParcel.map(p => normToScreen(p.x, p.y)) : []
  const svgCursor  = cssDims && cursorNorm ? normToScreen(cursorNorm.x, cursorNorm.y) : null
  const svgFirst   = svgTrace[0] ?? null
  const svgLast    = svgTrace[svgTrace.length - 1] ?? null
  const snapToFirst = svgFirst && svgCursor && tracePoints.length >= 3 &&
    Math.hypot(svgFirst.x - svgCursor.x, svgFirst.y - svgCursor.y) < SNAP_PX

  const tracePoly = svgTrace.map(p => `${p.x},${p.y}`).join(' ')
  const savedPoly = svgSaved.map(p => `${p.x},${p.y}`).join(' ')

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>

      {/* Pan/zoom viewport */}
      <div
        ref={containerRef}
        style={{
          width: '100%', height: '100%',
          overflow: 'hidden',
          background: '#374151',
          cursor: dragRef.current ? 'grabbing' : (inTrace ? 'none' : 'grab'),
        }}
        onWheel={handleWheel}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerLeave={handlePointerUp}
      >
        {/* PDF canvas */}
        <div style={{
          position: 'absolute',
          transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
          transformOrigin: '0 0',
        }}>
          <canvas
            ref={canvasRef}
            style={{
              display: 'block',
              width: cssDims ? cssDims.width : 0,
              height: cssDims ? cssDims.height : 0,
              boxShadow: '0 4px 24px rgba(0,0,0,0.4)',
            }}
          />
        </div>

        {/* SVG overlay — parcel + trace */}
        {cssDims && (
          <svg
            style={{
              position: 'absolute', top: 0, left: 0,
              width: '100%', height: '100%',
              pointerEvents: inTrace ? 'all' : 'none',
              cursor: inTrace ? (snapToFirst ? 'cell' : 'crosshair') : 'default',
              overflow: 'visible',
            }}
            onWheel={handleWheel}
            onPointerDown={inTrace ? handleTracePointerDown : undefined}
            onPointerMove={inTrace ? handleTracePointerMove : undefined}
            onPointerUp={inTrace ? handleTracePointerUp : undefined}
            onPointerLeave={inTrace ? handleTracePointerLeave : undefined}
          >
            {/* Saved parcel polygon */}
            {svgSaved.length >= 3 && (
              <polygon
                points={savedPoly}
                fill="rgba(37,99,235,0.08)"
                stroke="#2563eb"
                strokeWidth={2}
              />
            )}

            {/* In-progress trace */}
            {inTrace && svgTrace.length > 0 && (
              <>
                {/* Drawn edges */}
                {svgTrace.length >= 2 && (
                  <polyline
                    points={tracePoly}
                    fill="none"
                    stroke="#f59e0b"
                    strokeWidth={2}
                    strokeLinejoin="round"
                  />
                )}

                {/* Preview line: last vertex → cursor */}
                {svgCursor && svgLast && !snapToFirst && (
                  <line
                    x1={svgLast.x} y1={svgLast.y}
                    x2={svgCursor.x} y2={svgCursor.y}
                    stroke="#f59e0b" strokeWidth={1.5} strokeDasharray="5 4"
                  />
                )}

                {/* Closing preview when snap: last → cursor → first */}
                {snapToFirst && svgLast && (
                  <>
                    <line
                      x1={svgLast.x} y1={svgLast.y}
                      x2={svgFirst.x} y2={svgFirst.y}
                      stroke="#f59e0b" strokeWidth={1.5} strokeDasharray="5 4"
                    />
                    <polygon
                      points={tracePoly}
                      fill="rgba(245,158,11,0.08)"
                      stroke="none"
                    />
                  </>
                )}

                {/* Vertex dots */}
                {svgTrace.map((p, i) => (
                  <circle key={i} cx={p.x} cy={p.y} r={4}
                    fill="#f59e0b" stroke="#fff" strokeWidth={1.5} />
                ))}

                {/* First vertex snap ring */}
                {svgFirst && tracePoints.length >= 3 && (
                  <circle
                    cx={svgFirst.x} cy={svgFirst.y}
                    r={snapToFirst ? SNAP_PX : 7}
                    fill={snapToFirst ? 'rgba(245,158,11,0.25)' : 'none'}
                    stroke="#f59e0b" strokeWidth={2}
                    style={{ transition: 'r 0.1s' }}
                  />
                )}

                {/* Crosshair cursor dot */}
                {svgCursor && (
                  <circle cx={svgCursor.x} cy={svgCursor.y} r={3}
                    fill="#f59e0b" stroke="#fff" strokeWidth={1} />
                )}
              </>
            )}
          </svg>
        )}
      </div>

      {/* Bottom-right controls */}
      {cssDims && (
        <div style={{ position: 'absolute', bottom: 16, right: 16, display: 'flex', gap: 6 }}>
          {/* Close polygon button — only in trace mode with enough points */}
          {inTrace && tracePoints.length >= 3 && (
            <button onClick={closePolygon} style={{ ...btnStyle, width: 'auto', padding: '0 10px', fontSize: 12, color: '#92400e', borderColor: '#f59e0b', background: 'rgba(255,251,235,0.95)' }}>
              Close
            </button>
          )}
          <button onClick={() => zoomBy(1.25)} style={btnStyle}>+</button>
          <button onClick={() => zoomBy(1 / 1.25)} style={btnStyle}>−</button>
          <button onClick={resetView} style={btnStyle}>Fit</button>
          <button
            onClick={() => setRotation(r => (r + 90) % 360)}
            style={btnStyle}
            title="Rotate 90°"
          >↻</button>
        </div>
      )}
    </div>
  )
}

const btnStyle = {
  width: 32, height: 32,
  background: 'rgba(255,255,255,0.92)',
  border: '1px solid #d1d5db',
  borderRadius: 6,
  fontSize: 16, fontWeight: 600,
  cursor: 'pointer',
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  color: '#374151',
}
