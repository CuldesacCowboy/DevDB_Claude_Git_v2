// SitePlanView.jsx
// Main site plan page. Dev picker in toolbar; upload area or PDF viewer below.

import { useState, useEffect, useRef } from 'react'
import PdfCanvas from '../components/SitePlan/PdfCanvas'

const API = 'http://localhost:8000'

export default function SitePlanView() {
  const [developments, setDevelopments] = useState([])
  const [selectedDevId, setSelectedDevId] = useState('')
  const [plan, setPlan] = useState(null)      // null = none loaded; object = plan record
  const [loading, setLoading] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState(null)
  const fileInputRef = useRef(null)

  useEffect(() => {
    fetch(`${API}/developments`)
      .then(r => r.json())
      .then(devs => setDevelopments(devs.sort((a, b) => a.dev_name.localeCompare(b.dev_name))))
      .catch(() => setError('Could not load developments'))
  }, [])

  useEffect(() => {
    if (!selectedDevId) { setPlan(null); return }
    setLoading(true)
    setError(null)
    fetch(`${API}/site-plans/dev/${selectedDevId}`)
      .then(r => {
        if (r.status === 404) return null
        if (!r.ok) throw new Error('Server error')
        return r.json()
      })
      .then(data => { setPlan(data); setLoading(false) })
      .catch(() => { setError('Could not load site plan'); setLoading(false) })
  }, [selectedDevId])

  async function handleFileChange(e) {
    const file = e.target.files?.[0]
    if (!file) return
    await doUpload(file)
    // Reset so the same file can be re-selected if needed
    e.target.value = ''
  }

  async function doUpload(file) {
    setUploading(true)
    setError(null)
    try {
      const form = new FormData()
      form.append('file', file)
      const res = await fetch(`${API}/site-plans?dev_id=${selectedDevId}`, {
        method: 'POST',
        body: form,
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.detail || 'Upload failed')
      }
      const data = await res.json()
      setPlan(data)
    } catch (err) {
      setError(err.message)
    } finally {
      setUploading(false)
    }
  }

  function handleDragOver(e) { e.preventDefault() }

  function handleDrop(e) {
    e.preventDefault()
    const file = e.dataTransfer.files[0]
    if (file?.type === 'application/pdf') doUpload(file)
  }

  const pdfUrl = plan ? `${API}/site-plans/${plan.plan_id}/file` : null

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: 'calc(100vh - 44px)' }}>
      {/* Toolbar */}
      <div style={{
        padding: '0 16px', borderBottom: '1px solid #e5e7eb',
        background: '#fff', height: 44,
        display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0,
      }}>
        <select
          value={selectedDevId}
          onChange={e => setSelectedDevId(e.target.value)}
          style={{
            fontSize: 13, padding: '4px 8px',
            borderRadius: 4, border: '1px solid #d1d5db',
            minWidth: 220,
          }}
        >
          <option value=''>Select development...</option>
          {developments.map(d => (
            <option key={d.dev_id} value={d.dev_id}>{d.dev_name}</option>
          ))}
        </select>

        {plan && (
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
            style={toolbarBtnStyle}
          >
            Replace PDF
          </button>
        )}

        {error && (
          <span style={{ fontSize: 12, color: '#dc2626' }}>{error}</span>
        )}

        <input
          ref={fileInputRef}
          type='file'
          accept='.pdf'
          style={{ display: 'none' }}
          onChange={handleFileChange}
        />
      </div>

      {/* Main area */}
      <div style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
        {!selectedDevId && (
          <Placeholder>Select a development to view its site plan</Placeholder>
        )}

        {selectedDevId && loading && (
          <Placeholder>Loading...</Placeholder>
        )}

        {selectedDevId && !loading && !plan && (
          <div
            style={{
              display: 'flex', flexDirection: 'column',
              alignItems: 'center', justifyContent: 'center',
              height: '100%', gap: 16,
              background: '#f9fafb',
            }}
            onDragOver={handleDragOver}
            onDrop={handleDrop}
          >
            <div style={{
              border: '2px dashed #d1d5db', borderRadius: 12,
              padding: '48px 64px',
              display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12,
              background: '#fff',
            }}>
              <span style={{ fontSize: 14, color: '#6b7280' }}>No site plan uploaded for this development</span>
              <span style={{ fontSize: 12, color: '#9ca3af' }}>Drag and drop a PDF here, or</span>
              <button
                onClick={() => fileInputRef.current?.click()}
                disabled={uploading}
                style={{
                  fontSize: 13, padding: '8px 20px',
                  borderRadius: 6, border: '1px solid #2563eb',
                  color: '#2563eb', cursor: uploading ? 'default' : 'pointer',
                  background: '#fff', fontWeight: 500,
                }}
              >
                {uploading ? 'Uploading...' : 'Upload PDF'}
              </button>
            </div>
          </div>
        )}

        {plan && pdfUrl && (
          <PdfCanvas key={pdfUrl} pdfUrl={pdfUrl} />
        )}
      </div>
    </div>
  )
}

function Placeholder({ children }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      height: '100%', color: '#9ca3af', fontSize: 14,
      background: '#f9fafb',
    }}>
      {children}
    </div>
  )
}

const toolbarBtnStyle = {
  fontSize: 12, padding: '4px 10px',
  borderRadius: 4, border: '1px solid #d1d5db',
  cursor: 'pointer', background: '#f9fafb',
  color: '#374151',
}
