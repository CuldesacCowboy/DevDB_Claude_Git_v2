// ErrorBoundary.jsx
// Catches unhandled render errors in any child component and shows a fallback
// instead of crashing the entire app to a white screen.
// Must be a class component — React hooks cannot catch render-phase errors.

import { Component } from 'react'

export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { error: null }
  }

  static getDerivedStateFromError(error) {
    return { error }
  }

  render() {
    if (this.state.error) {
      return (
        <div style={{
          flex: 1, display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'center',
          padding: 40, gap: 12,
        }}>
          <div style={{ fontSize: 15, fontWeight: 600, color: '#111827' }}>
            Something went wrong
          </div>
          <div style={{ fontSize: 12, color: '#6b7280', maxWidth: 480, textAlign: 'center', lineHeight: 1.6 }}>
            {this.state.error?.message || 'An unexpected error occurred.'}
          </div>
          <button
            onClick={() => this.setState({ error: null })}
            style={{
              marginTop: 8, padding: '6px 16px', borderRadius: 6,
              border: '1px solid #d1d5db', background: '#f9fafb',
              fontSize: 12, color: '#374151', cursor: 'pointer',
            }}
          >
            Try again
          </button>
        </div>
      )
    }
    return this.props.children
  }
}
