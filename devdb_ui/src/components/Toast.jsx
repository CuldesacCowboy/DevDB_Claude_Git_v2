import { useEffect } from 'react'

// type: 'success' | 'warning' | 'error'
export default function Toast({ id, type, message, subMessage, onDismiss }) {
  const autoDismissMs = type === 'error' ? 4000 : 2000

  useEffect(() => {
    const t = setTimeout(() => onDismiss(id), autoDismissMs)
    return () => clearTimeout(t)
  }, [id, autoDismissMs, onDismiss])

  const styles = {
    success: 'bg-green-50 border-green-300 text-green-800',
    warning: 'bg-yellow-50 border-yellow-300 text-yellow-800',
    error:   'bg-red-50 border-red-300 text-red-800',
  }

  return (
    <div
      onClick={() => onDismiss(id)}
      className={`
        rounded-lg border px-4 py-3 shadow-md text-sm cursor-pointer
        max-w-sm w-full
        ${styles[type] ?? styles.success}
      `}
    >
      <p className="font-medium">{message}</p>
      {subMessage && <p className="mt-1 text-xs opacity-80">{subMessage}</p>}
    </div>
  )
}
