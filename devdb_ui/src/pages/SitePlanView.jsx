// SitePlanView.jsx
// Main site plan page. Entitlement group picker + mode controls in toolbar.

import { useState, useEffect, useRef } from 'react'
import PdfCanvas from '../components/SitePlan/PdfCanvas'

const API = '/api'

export default function SitePlanView() {
  const [entGroups, setEntGroups]       = useState([])
  const [selectedGroupId, setSelectedGroupId] = useState('')
  const [plan, setPlan]                 = useState(null)
  const [loading, setLoading]           = useState(false)
  const [uploading, setUploading]       = useState(false)
  const [error, setError]               = useState(null)
  const [mode, setMode]                 = useState('view')  // 'view' | 'trace'
  const fileInputRef = useRef(null)

  useEffect(() => {
    fetch(`${API}/entitlement-groups`)
      .then(r => r.json())
      .then(gs => setEntGroups(gs.sort((a, b) => a.ent_group_name.localeCompare(b.ent_group_name))))
      .catch(() => setError('Could not load entitlement groups'))
  }, [])

  useEffect(() => {
    if (!selectedGroupId) { setPlan(null); setMode('view'); return }
    setLoading(true)
    setError(null)
    fetch(`${API}/site-plans/ent-group/${selectedGroupId}`)
      .then(r => { if (r.status === 404) return null; if (!r.ok) throw new Error(); return r.json() })
      .then(data => { setPlan(data); setLoading(false) })
      .catch(() => { setError('Could not load site plan'); setLoading(false) })
  }, [selectedGroupId])

  async function handleFileChange(e) {
    const file = e.target.files?.[0]
    if (!file) return
    await doUpload(file)
    e.target.value = ''
  }

  async function doUpload(file) {
    setUploading(true)
    setError(null)
    setMode('view')
    try {
      const form = new FormData()
      form.append('file', file)
      const res = await fetch(`${API}/site-plans?ent_group_id=${selectedGroupId}`, { method: 'POST', body: form })
      if (!res.ok) { const b = await res.json().catch(() => ({})); throw new Error(b.detail || 'Upload failed') }
      setPlan(await res.json())
    } catch (err) { setError(err.message) }
    finally { setUploading(false) }
  }

  async function clearParcel() {
    if (!plan) return
    try {
      const res = await fetch(`${API}/site-plans/${plan.plan_id}/parcel`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ parcel_json: null }),
      })
      if (res.ok) setPlan(p => ({ ...p, parcel_json: null }))
    } catch { /* ignore */ }
  }

  const initialParcel = plan?.parcel_json ? JSON.parse(plan.parcel_json) : null
  const pdfUrl = plan ? `${API}/site-plans/${plan.plan_id}/file` : null

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: 'calc(100vh - 44px)' }}>

      {/* Toolbar */}
      <div style={{
        padding: '0 16px', borderBottom: '1px solid #e5e7eb',
        background: '#fff', height: 44,
        display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0,
      }}>
        {/* Project picker */}
        <select
          value={selectedGroupId}
          onChange={e => { setSelectedGroupId(e.target.value); setMode('view') }}
          style={{ fontSize: 13, padding: '4px 8px', borderRadius: 4, border: '1px solid #d1d5db', minWidth: 220 }}
        >
          <option value=''>Select project...</option>
          {entGroups.map(g => (
            <option key={g.ent_group_id} value={g.ent_group_id}>{g.ent_group_name}</option>
          ))}
        </select>

        {/* Divider */}
        {plan && <div style={{ width: 1, height: 20, background: '#e5e7eb' }} />}

        {/* Parcel controls — only when a plan is loaded */}
        {plan && mode === 'view' && (
          <>
            <button onClick={() => setMode('trace')} style={toolbarBtn('#2563eb', '#eff6ff', '#bfdbfe')}>
              {plan.parcel_json ? 'Retrace Parcel' : 'Trace Parcel'}
            </button>
            {plan.parcel_json && (
              <button onClick={() => setMode('edit')} style={toolbarBtn('#374151', '#f9fafb', '#e5e7eb')}>
                Edit Parcel
              </button>
            )}
            {plan.parcel_json && (
              <button onClick={clearParcel} style={toolbarBtn('#dc2626', '#fef2f2', '#fecaca')}>
                Clear Parcel
              </button>
            )}
          </>
        )}

        {plan && mode === 'trace' && (
          <>
            <span style={{ fontSize: 12, color: '#92400e', fontWeight: 500 }}>
              Click to place vertices · click first vertex or Close to finish
            </span>
            <button onClick={() => setMode('view')} style={toolbarBtn('#374151', '#f9fafb', '#e5e7eb')}>
              Cancel
            </button>
          </>
        )}

        {plan && mode === 'edit' && (
          <>
            <span style={{ fontSize: 12, color: '#1d4ed8', fontWeight: 500 }}>
              Drag vertices to move · click edge to add · right-click vertex to delete
            </span>
            <button onClick={() => setMode('view')} style={toolbarBtn('#1d4ed8', '#eff6ff', '#bfdbfe')}>
              Done Editing
            </button>
          </>
        )}

        {/* Divider */}
        {plan && <div style={{ width: 1, height: 20, background: '#e5e7eb' }} />}

        {plan && (
          <button onClick={() => fileInputRef.current?.click()} disabled={uploading} style={toolbarBtnGray}>
            Replace PDF
          </button>
        )}

        {error && <span style={{ fontSize: 12, color: '#dc2626' }}>{error}</span>}

        <input ref={fileInputRef} type='file' accept='.pdf' style={{ display: 'none' }} onChange={handleFileChange} />
      </div>

      {/* Main area */}
      <div style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
        {!selectedGroupId && <Placeholder>Select a project to view its site plan</Placeholder>}
        {selectedGroupId && loading && <Placeholder>Loading...</Placeholder>}

        {selectedGroupId && !loading && !plan && (
          <div
            style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', background: '#f9fafb' }}
            onDragOver={e => e.preventDefault()}
            onDrop={e => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f?.type === 'application/pdf') doUpload(f) }}
          >
            <div style={{ border: '2px dashed #d1d5db', borderRadius: 12, padding: '48px 64px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12, background: '#fff' }}>
              <span style={{ fontSize: 14, color: '#6b7280' }}>No site plan uploaded for this project</span>
              <span style={{ fontSize: 12, color: '#9ca3af' }}>Drag and drop a PDF here, or</span>
              <button
                onClick={() => fileInputRef.current?.click()}
                disabled={uploading}
                style={{ fontSize: 13, padding: '8px 20px', borderRadius: 6, border: '1px solid #2563eb', color: '#2563eb', cursor: uploading ? 'default' : 'pointer', background: '#fff', fontWeight: 500 }}
              >
                {uploading ? 'Uploading...' : 'Upload PDF'}
              </button>
            </div>
          </div>
        )}

        {plan && pdfUrl && (
          <PdfCanvas
            key={pdfUrl}
            pdfUrl={pdfUrl}
            planId={plan.plan_id}
            initialParcel={initialParcel}
            mode={mode}
            onModeChange={setMode}
            onParcelSaved={points => setPlan(p => ({ ...p, parcel_json: JSON.stringify(points) }))}
          />
        )}
      </div>
    </div>
  )
}

function Placeholder({ children }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: '#9ca3af', fontSize: 14, background: '#f9fafb' }}>
      {children}
    </div>
  )
}

function toolbarBtn(color, bg, border) {
  return {
    fontSize: 12, padding: '4px 10px', borderRadius: 4,
    border: `1px solid ${border}`, color, background: bg,
    cursor: 'pointer', fontWeight: 500,
  }
}

const toolbarBtnGray = {
  fontSize: 12, padding: '4px 10px', borderRadius: 4,
  border: '1px solid #d1d5db', color: '#374151', background: '#f9fafb',
  cursor: 'pointer',
}
