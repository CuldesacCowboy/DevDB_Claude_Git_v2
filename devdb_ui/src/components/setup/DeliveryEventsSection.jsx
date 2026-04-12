// setup/DeliveryEventsSection.jsx
// Delivery events panel embedded in each CommunityRow.
// Lists, creates, edits, and deletes delivery events; assigns/unassigns phases.

import { useState, useEffect, useCallback } from 'react'
import { API_BASE } from '../../config'

const fmtDate = iso => iso ? new Date(iso + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—'

// ─── Inline editable field ────────────────────────────────────────────────────
function InlineField({ value, placeholder, type = 'text', onSave, width = 160 }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value ?? '')

  useEffect(() => { setDraft(value ?? '') }, [value])

  async function commit() {
    const v = type === 'date' ? draft : draft.trim()
    setEditing(false)
    if (v !== (value ?? '')) await onSave(v || null)
  }

  if (editing) return (
    <input
      autoFocus
      type={type}
      value={draft}
      onChange={e => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={e => {
        if (e.key === 'Enter') commit()
        if (e.key === 'Escape') { setDraft(value ?? ''); setEditing(false) }
        e.stopPropagation()
      }}
      onClick={e => e.stopPropagation()}
      style={{
        fontSize: 12, padding: '2px 6px', borderRadius: 3,
        border: '1px solid #2563eb', outline: 'none', width,
      }}
    />
  )

  return (
    <span
      onDoubleClick={e => { e.stopPropagation(); setEditing(true) }}
      onClick={e => { e.stopPropagation(); setEditing(true) }}
      title="Click to edit"
      style={{ cursor: 'text', borderBottom: '1px dashed #d1d5db', paddingBottom: 1 }}
    >
      {value ? (type === 'date' ? fmtDate(value) : value) : <span style={{ color: '#d1d5db' }}>{placeholder}</span>}
    </span>
  )
}

// ─── Single delivery event row ────────────────────────────────────────────────
function EventRow({ event, allPhases, entGroupId, onUpdated, onDeleted }) {
  const [saving, setSaving] = useState(false)
  const [addPhaseId, setAddPhaseId] = useState('')
  const [showAddPhase, setShowAddPhase] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)

  const assignedSet = new Set(event.phase_ids)
  const availablePhases = allPhases.filter(p => !assignedSet.has(p.phase_id))

  async function patchEvent(updates) {
    setSaving(true)
    try {
      await fetch(`${API_BASE}/entitlement-groups/${entGroupId}/delivery-events/${event.delivery_event_id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates),
      })
      onUpdated()
    } finally {
      setSaving(false)
    }
  }

  async function assignPhase(phaseId) {
    await fetch(
      `${API_BASE}/entitlement-groups/${entGroupId}/delivery-events/${event.delivery_event_id}/phases/${phaseId}`,
      { method: 'POST' },
    )
    setAddPhaseId('')
    setShowAddPhase(false)
    onUpdated()
  }

  async function unassignPhase(phaseId) {
    await fetch(
      `${API_BASE}/entitlement-groups/${entGroupId}/delivery-events/${event.delivery_event_id}/phases/${phaseId}`,
      { method: 'DELETE' },
    )
    onUpdated()
  }

  async function deleteEvent() {
    await fetch(
      `${API_BASE}/entitlement-groups/${entGroupId}/delivery-events/${event.delivery_event_id}`,
      { method: 'DELETE' },
    )
    onDeleted()
  }

  const displayDate = event.date_dev_actual || event.date_dev_projected

  return (
    <div style={{
      padding: '6px 10px', borderRadius: 4, border: '1px solid #e5e7eb',
      background: '#fff', marginBottom: 4,
    }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, flexWrap: 'wrap' }}>
        {/* Name */}
        <div style={{ minWidth: 140 }}>
          <InlineField
            value={event.event_name}
            placeholder="Event name"
            onSave={v => patchEvent({ event_name: v || 'Delivery Event' })}
            width={160}
          />
          {event.is_auto_created && (
            <span style={{ fontSize: 9, color: '#9ca3af', marginLeft: 6 }}>auto</span>
          )}
        </div>

        {/* Date */}
        <div style={{ minWidth: 110 }}>
          <InlineField
            value={event.date_dev_actual}
            placeholder="Set date"
            type="date"
            onSave={v => patchEvent({ date_dev_actual: v })}
            width={130}
          />
          {!event.date_dev_actual && event.date_dev_projected && (
            <span style={{ fontSize: 10, color: '#93c5fd', marginLeft: 4, fontStyle: 'italic' }}>
              proj: {fmtDate(event.date_dev_projected)}
            </span>
          )}
        </div>

        {/* Phases */}
        <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 4, flex: 1 }}>
          {event.phase_ids.map(pid => {
            const ph = allPhases.find(p => p.phase_id === pid)
            return (
              <span key={pid} style={{
                display: 'inline-flex', alignItems: 'center', gap: 3,
                fontSize: 10, padding: '1px 6px', borderRadius: 10,
                background: '#eff6ff', color: '#2563eb', border: '1px solid #bfdbfe',
              }}>
                {ph ? ph.phase_name : `Phase ${pid}`}
                <button
                  onClick={() => unassignPhase(pid)}
                  style={{ fontSize: 9, color: '#93c5fd', background: 'none', border: 'none', cursor: 'pointer', padding: 0, lineHeight: 1 }}
                >✕</button>
              </span>
            )
          })}

          {showAddPhase ? (
            <span onClick={e => e.stopPropagation()} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              <select
                autoFocus
                value={addPhaseId}
                onChange={e => setAddPhaseId(e.target.value)}
                style={{ fontSize: 11, padding: '1px 4px', borderRadius: 3, border: '1px solid #d1d5db' }}
              >
                <option value="">Pick a phase…</option>
                {availablePhases.map(p => (
                  <option key={p.phase_id} value={p.phase_id}>{p.phase_name}</option>
                ))}
              </select>
              <button
                onClick={() => addPhaseId && assignPhase(Number(addPhaseId))}
                disabled={!addPhaseId}
                style={{ fontSize: 10, padding: '1px 6px', borderRadius: 3, border: 'none',
                  background: addPhaseId ? '#2563eb' : '#93c5fd', color: '#fff', cursor: addPhaseId ? 'pointer' : 'default' }}
              >Add</button>
              <button
                onClick={() => { setShowAddPhase(false); setAddPhaseId('') }}
                style={{ fontSize: 10, color: '#9ca3af', background: 'none', border: 'none', cursor: 'pointer' }}
              >✕</button>
            </span>
          ) : availablePhases.length > 0 ? (
            <button
              onClick={e => { e.stopPropagation(); setShowAddPhase(true) }}
              style={{ fontSize: 10, color: '#6b7280', background: 'none', border: '1px dashed #d1d5db',
                borderRadius: 10, padding: '1px 8px', cursor: 'pointer' }}
            >+ phase</button>
          ) : null}
        </div>

        {/* Delete */}
        <div style={{ marginLeft: 'auto', flexShrink: 0 }}>
          {confirmDelete ? (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11 }}>
              <span style={{ color: '#991b1b' }}>Delete?</span>
              <button onClick={deleteEvent}
                style={{ fontSize: 10, padding: '1px 8px', borderRadius: 3, border: 'none',
                  background: '#dc2626', color: '#fff', cursor: 'pointer' }}>Yes</button>
              <button onClick={() => setConfirmDelete(false)}
                style={{ fontSize: 10, padding: '1px 6px', borderRadius: 3,
                  border: '1px solid #d1d5db', background: '#fff', color: '#6b7280', cursor: 'pointer' }}>No</button>
            </span>
          ) : (
            <button
              onClick={e => { e.stopPropagation(); setConfirmDelete(true) }}
              style={{ fontSize: 10, color: '#f87171', background: 'none', border: 'none', cursor: 'pointer', opacity: 0.5 }}
              onMouseEnter={e => { e.currentTarget.style.opacity = 1 }}
              onMouseLeave={e => { e.currentTarget.style.opacity = 0.5 }}
            >🗑</button>
          )}
        </div>
      </div>
    </div>
  )
}

// ─── Section ──────────────────────────────────────────────────────────────────
export default function DeliveryEventsSection({ entGroupId, allPhases }) {
  const [open, setOpen] = useState(false)
  const [events, setEvents] = useState([])
  const [loading, setLoading] = useState(false)
  const [newName, setNewName] = useState('')
  const [newDate, setNewDate] = useState('')
  const [addOpen, setAddOpen] = useState(false)
  const [addSaving, setAddSaving] = useState(false)

  const load = useCallback(async () => {
    if (!entGroupId) return
    setLoading(true)
    try {
      const res = await fetch(`${API_BASE}/entitlement-groups/${entGroupId}/delivery-events`)
      setEvents(res.ok ? await res.json() : [])
    } finally {
      setLoading(false)
    }
  }, [entGroupId])

  useEffect(() => { if (open) load() }, [open, load])

  async function handleCreate(e) {
    e.preventDefault()
    if (!newName.trim()) return
    setAddSaving(true)
    try {
      await fetch(`${API_BASE}/entitlement-groups/${entGroupId}/delivery-events`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ event_name: newName.trim(), date_dev_actual: newDate || null }),
      })
      setNewName(''); setNewDate(''); setAddOpen(false)
      await load()
    } finally {
      setAddSaving(false)
    }
  }

  return (
    <div style={{ marginTop: 8, borderTop: '1px solid #f1f5f9', paddingTop: 6 }}>
      <div
        onClick={e => { e.stopPropagation(); setOpen(o => !o) }}
        style={{
          display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer',
          padding: '3px 8px', borderRadius: 4, userSelect: 'none',
          color: '#6b7280', fontSize: 12,
        }}
      >
        <span style={{ fontSize: 10 }}>{open ? '▾' : '▸'}</span>
        <span style={{ fontWeight: 600 }}>Delivery Events</span>
        {events.length > 0 && (
          <span style={{ fontSize: 11, color: '#9ca3af' }}>{events.length}</span>
        )}
      </div>

      {open && (
        <div style={{ paddingLeft: 16, paddingRight: 8, paddingBottom: 8 }} onClick={e => e.stopPropagation()}>
          {loading ? (
            <div style={{ fontSize: 11, color: '#9ca3af', padding: '4px 0' }}>Loading…</div>
          ) : events.length === 0 ? (
            <div style={{ fontSize: 11, color: '#d1d5db', padding: '4px 0' }}>
              No delivery events. Create one below, or run a simulation to auto-generate.
            </div>
          ) : (
            events.map(ev => (
              <EventRow
                key={ev.delivery_event_id}
                event={ev}
                allPhases={allPhases}
                entGroupId={entGroupId}
                onUpdated={load}
                onDeleted={load}
              />
            ))
          )}

          {/* Add new event form */}
          {addOpen ? (
            <form onSubmit={handleCreate} style={{
              display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap',
              padding: '6px 8px', background: '#f8fafc', borderRadius: 4,
              border: '1px solid #e2e8f0', marginTop: 4,
            }}>
              <input
                autoFocus
                placeholder="Event name"
                value={newName}
                onChange={e => setNewName(e.target.value)}
                required
                style={{ fontSize: 12, padding: '2px 6px', borderRadius: 3, border: '1px solid #d1d5db', width: 180 }}
              />
              <input
                type="date"
                value={newDate}
                onChange={e => setNewDate(e.target.value)}
                style={{ fontSize: 12, padding: '2px 6px', borderRadius: 3, border: '1px solid #d1d5db' }}
              />
              <button type="submit" disabled={addSaving}
                style={{ fontSize: 11, padding: '2px 10px', borderRadius: 3,
                  background: '#2563eb', color: '#fff', border: 'none', cursor: 'pointer' }}>
                {addSaving ? '…' : 'Add'}
              </button>
              <button type="button" onClick={() => setAddOpen(false)}
                style={{ fontSize: 11, padding: '2px 8px', borderRadius: 3,
                  background: '#f1f5f9', color: '#6b7280', border: '1px solid #d1d5db', cursor: 'pointer' }}>
                Cancel
              </button>
            </form>
          ) : (
            <button
              onClick={() => setAddOpen(true)}
              style={{
                marginTop: 4, fontSize: 11, color: '#2563eb', background: '#eff6ff',
                border: '1px solid #bfdbfe', borderRadius: 4, padding: '2px 10px', cursor: 'pointer',
              }}
            >
              + New delivery event
            </button>
          )}
        </div>
      )}
    </div>
  )
}
