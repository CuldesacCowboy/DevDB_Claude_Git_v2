// Button.jsx
// Shared toolbar/action button component for DevDB.
// Replaces the btn() factory function and btnGray object in SitePlanView.
//
// Usage:
//   <Button variant="danger" onClick={...}>Delete All</Button>
//   <Button variant="teal" active onClick={...}>Show Groups</Button>
//   <Button onClick={...}>Cancel</Button>   ← defaults to "default" variant

import { BTN } from '../utils/designTokens'

const BASE_STYLE = {
  fontSize: 12,
  padding: '4px 10px',
  borderRadius: 4,
  cursor: 'pointer',
  fontWeight: 500,
  border: '1px solid transparent',
}

export function Button({ variant = 'default', active = false, style, children, ...props }) {
  const v = BTN[active ? variant + 'On' : variant] || BTN[variant] || BTN.default
  return (
    <button
      style={{
        ...BASE_STYLE,
        color: v.color,
        background: v.bg,
        border: `1px solid ${v.border}`,
        ...style,
      }}
      {...props}
    >
      {children}
    </button>
  )
}
