// designTokens.js
// Single source of truth for hardcoded design values used across DevDB UI.
// Import named constants instead of repeating hex literals.

// ─── Panel chrome ─────────────────────────────────────────────────────────────
// Warm neutral backgrounds used for panel headers, bodies, and borders.
export const PANEL_HEADER_BG = '#F0EEE8'
export const PANEL_BODY_BG   = '#F7F6F3'
export const PANEL_BORDER    = '#E4E2DA'

// ─── Green inline editor ──────────────────────────────────────────────────────
// Teal-green dashed border style for editable fields (lot projected values,
// TDA names, checkpoint controls). Used in InstrumentContainer, TdaCard,
// CheckpointBand, LotPill, TakedownAgreementsView.
export const EDITOR_BORDER      = '#3B6D11'
export const EDITOR_BG          = '#EAF3DE'
export const EDITOR_TEXT        = '#27500A'

// Convenience object — spread onto a style prop for the green dashed input look.
export const greenEditorStyle = {
  border: `1px dashed ${EDITOR_BORDER}`,
  background: EDITOR_BG,
  color: EDITOR_TEXT,
}

// ─── Warm neutral text palette ────────────────────────────────────────────────
export const TEXT_MUTED      = '#888780'
export const TEXT_PRIMARY    = '#2C2C2A'
export const TEXT_FAINT      = '#B4B2A9'
export const DIVIDER_LIGHT   = '#DDDBD3'
export const DIVIDER_MED     = '#C8C6BE'

// ─── Toolbar button variants ──────────────────────────────────────────────────
// Each variant is { color, bg, border } matching the btn() factory in SitePlanView.
// Use with the Button component (variant prop) or call btn() directly with these.

export const BTN = {
  default:  { color: '#374151', bg: '#f9fafb', border: '#e5e7eb' },
  primary:  { color: '#2563eb', bg: '#eff6ff', border: '#bfdbfe' },
  danger:   { color: '#dc2626', bg: '#fef2f2', border: '#fecaca' },
  warning:  { color: '#b45309', bg: '#fffbeb', border: '#fde68a' },
  success:  { color: '#15803d', bg: '#f0fdf4', border: '#bbf7d0' },
  purple:   { color: '#7c3aed', bg: '#f5f3ff', border: '#ddd6fe' },
  teal:     { color: '#0d9488', bg: '#f0fdfa', border: '#99f6e4' },
  tealOn:   { color: '#0f766e', bg: '#f0fdfa', border: '#5eead4' },
}
