// PdfCanvas.jsx
// Renders a PDF page to a canvas with mouse-driven pan and wheel zoom.
// Pan: drag anywhere. Zoom: scroll wheel, centered on cursor position.

import { useEffect, useRef, useState } from 'react'
import * as pdfjsLib from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.mjs?url'

pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl

// Render the PDF at this scale for quality. CSS width/height scale it down to 1x.
const RENDER_SCALE = 2.0

const MIN_ZOOM = 0.1
const MAX_ZOOM = 8.0

export default function PdfCanvas({ pdfUrl }) {
  const canvasRef = useRef(null)
  const containerRef = useRef(null)
  const dragRef = useRef(null)  // { startX, startY, startPanX, startPanY } while dragging

  const [cssDims, setCssDims] = useState(null)  // { width, height } of canvas in CSS px at zoom=1
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const [zoom, setZoom] = useState(1.0)

  useEffect(() => {
    if (!pdfUrl) return
    let cancelled = false

    async function load() {
      const pdf = await pdfjsLib.getDocument(pdfUrl).promise
      if (cancelled) return

      const page = await pdf.getPage(1)
      if (cancelled) return

      const viewport = page.getViewport({ scale: RENDER_SCALE })
      const canvas = canvasRef.current
      canvas.width = viewport.width
      canvas.height = viewport.height

      const ctx = canvas.getContext('2d')
      await page.render({ canvasContext: ctx, viewport }).promise

      if (!cancelled) {
        const w = viewport.width / RENDER_SCALE
        const h = viewport.height / RENDER_SCALE
        setCssDims({ width: w, height: h })

        // Center the plan in the viewport on first load
        const container = containerRef.current
        if (container) {
          const cw = container.clientWidth
          const ch = container.clientHeight
          const fitScale = Math.min(cw / w, ch / h, 1.0)
          setZoom(fitScale)
          setPan({
            x: (cw - w * fitScale) / 2,
            y: (ch - h * fitScale) / 2,
          })
        }
      }
    }

    load()
    return () => { cancelled = true }
  }, [pdfUrl])

  function handleWheel(e) {
    e.preventDefault()
    const rect = containerRef.current.getBoundingClientRect()
    const cursorX = e.clientX - rect.left
    const cursorY = e.clientY - rect.top

    const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12
    const newZoom = Math.min(Math.max(zoom * factor, MIN_ZOOM), MAX_ZOOM)

    // Keep the point under the cursor fixed
    const ratio = newZoom / zoom
    setPan(p => ({
      x: cursorX - (cursorX - p.x) * ratio,
      y: cursorY - (cursorY - p.y) * ratio,
    }))
    setZoom(newZoom)
  }

  function handlePointerDown(e) {
    if (e.button !== 0) return
    e.currentTarget.setPointerCapture(e.pointerId)
    dragRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      startPanX: pan.x,
      startPanY: pan.y,
    }
  }

  function handlePointerMove(e) {
    if (!dragRef.current) return
    const dx = e.clientX - dragRef.current.startX
    const dy = e.clientY - dragRef.current.startY
    setPan({
      x: dragRef.current.startPanX + dx,
      y: dragRef.current.startPanY + dy,
    })
  }

  function handlePointerUp() {
    dragRef.current = null
  }

  function resetView() {
    if (!cssDims || !containerRef.current) return
    const cw = containerRef.current.clientWidth
    const ch = containerRef.current.clientHeight
    const fitScale = Math.min(cw / cssDims.width, ch / cssDims.height, 1.0)
    setZoom(fitScale)
    setPan({
      x: (cw - cssDims.width * fitScale) / 2,
      y: (ch - cssDims.height * fitScale) / 2,
    })
  }

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      {/* Pan/zoom viewport */}
      <div
        ref={containerRef}
        style={{
          width: '100%', height: '100%',
          overflow: 'hidden',
          background: '#374151',
          cursor: dragRef.current ? 'grabbing' : 'grab',
        }}
        onWheel={handleWheel}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerLeave={handlePointerUp}
      >
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
      </div>

      {/* Controls overlay */}
      {cssDims && (
        <div style={{
          position: 'absolute', bottom: 16, right: 16,
          display: 'flex', gap: 6,
        }}>
          <button
            onClick={() => {
              const newZoom = Math.min(zoom * 1.25, MAX_ZOOM)
              if (!containerRef.current) return
              const rect = containerRef.current.getBoundingClientRect()
              const cx = rect.width / 2, cy = rect.height / 2
              const ratio = newZoom / zoom
              setPan(p => ({ x: cx - (cx - p.x) * ratio, y: cy - (cy - p.y) * ratio }))
              setZoom(newZoom)
            }}
            style={btnStyle}
          >+</button>
          <button
            onClick={() => {
              const newZoom = Math.max(zoom / 1.25, MIN_ZOOM)
              if (!containerRef.current) return
              const rect = containerRef.current.getBoundingClientRect()
              const cx = rect.width / 2, cy = rect.height / 2
              const ratio = newZoom / zoom
              setPan(p => ({ x: cx - (cx - p.x) * ratio, y: cy - (cy - p.y) * ratio }))
              setZoom(newZoom)
            }}
            style={btnStyle}
          >−</button>
          <button onClick={resetView} style={btnStyle}>Fit</button>
        </div>
      )}
    </div>
  )
}

const btnStyle = {
  width: 32, height: 32,
  background: 'rgba(255,255,255,0.9)',
  border: '1px solid #d1d5db',
  borderRadius: 6,
  fontSize: 16,
  cursor: 'pointer',
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  fontWeight: 600,
  color: '#374151',
}
