import { useEffect } from 'react'

// ── Right-click context menu ──────────────────────────────────────
// items: Array of { label, onClick, danger?, disabled? } or { divider: true }
export default function ContextMenu({ x, y, items, onClose }) {
  useEffect(() => {
    function onKey(e) { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  // Clamp menu to viewport so it doesn't overflow edges
  const menuW = 210
  const clampedX = Math.min(x, window.innerWidth - menuW - 8)

  return (
    <>
      {/* Backdrop: click anywhere outside to close */}
      <div
        style={{ position: 'fixed', inset: 0, zIndex: 1999 }}
        onClick={onClose}
        onContextMenu={e => { e.preventDefault(); onClose() }}
      />
      {/* Menu panel */}
      <div style={{
        position: 'fixed', left: clampedX, top: y, zIndex: 2000,
        background: '#fff',
        border: '1px solid #e5e7eb',
        borderRadius: 7,
        boxShadow: '0 4px 16px rgba(0,0,0,0.13)',
        padding: '4px 0',
        minWidth: menuW,
        userSelect: 'none',
      }}>
        {items.map((item, i) =>
          item.divider ? (
            <div key={i} style={{ height: 1, background: '#f3f4f6', margin: '3px 0' }} />
          ) : (
            <button
              key={i}
              onClick={item.disabled ? undefined : () => { item.onClick(); onClose() }}
              style={{
                display: 'block', width: '100%', textAlign: 'left',
                padding: '6px 16px', fontSize: 13,
                color: item.disabled ? '#d1d5db' : item.danger ? '#dc2626' : '#374151',
                background: 'none', border: 'none',
                cursor: item.disabled ? 'default' : 'pointer',
                fontWeight: item.header ? 600 : 400,
              }}
            >
              {item.label}
            </button>
          )
        )}
      </div>
    </>
  )
}
