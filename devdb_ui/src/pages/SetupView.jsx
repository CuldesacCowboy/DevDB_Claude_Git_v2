// SetupView.jsx
// Hierarchical setup tree: Community → Development → Instrument → Phase → Lots

import { useState, useEffect, useRef } from 'react'
import BulkLotInsertModal from '../components/BulkLotInsertModal'
import { API_BASE } from '../config'

// ─── small helpers ───────────────────────────────────────────────────────────

function totalLots(lot_type_counts) {
  return Object.values(lot_type_counts || {}).reduce(
    (s, v) => s + (v.real || 0) + (v.sim || 0), 0
  )
}

function ChevronIcon({ open }) {
  return (
    <span style={{
      display: 'inline-block', width: 12, marginRight: 4,
      transition: 'transform 0.15s',
      transform: open ? 'rotate(90deg)' : 'rotate(0deg)',
      color: '#9ca3af', fontSize: 10, lineHeight: 1,
    }}>▶</span>
  )
}

// ─── inline add forms ─────────────────────────────────────────────────────────

function AddForm({ fields, onSave, onCancel, saving, error }) {
  const [values, setValues] = useState(() =>
    Object.fromEntries(fields.map(f => [f.name, f.default ?? '']))
  )
  const firstRef = useRef(null)
  useEffect(() => { firstRef.current?.focus() }, [])

  async function handleSave(e) {
    e.preventDefault()
    await onSave(values)
  }

  return (
    <form onSubmit={handleSave}
      style={{
        display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 6,
        padding: '4px 8px', background: '#f8fafc', borderRadius: 4,
        border: '1px solid #e2e8f0', marginTop: 4,
      }}>
      {fields.map((f, i) =>
        f.options ? (
          <select
            key={f.name}
            value={values[f.name]}
            onChange={e => setValues(prev => ({ ...prev, [f.name]: e.target.value }))}
            required={f.required}
            style={{ fontSize: 12, padding: '2px 4px', borderRadius: 3, border: '1px solid #d1d5db' }}>
            {f.options.map(o => <option key={o} value={o}>{o}</option>)}
          </select>
        ) : (
          <input
            key={f.name}
            ref={i === 0 ? firstRef : null}
            type={f.type ?? 'text'}
            placeholder={f.label}
            value={values[f.name]}
            onChange={e => setValues(prev => ({ ...prev, [f.name]: e.target.value }))}
            required={f.required}
            style={{
              fontSize: 12, padding: '2px 6px', borderRadius: 3,
              border: '1px solid #d1d5db', width: f.width ?? 180,
            }}
          />
        )
      )}
      {error && <span style={{ fontSize: 11, color: '#dc2626' }}>{error}</span>}
      <button type="submit" disabled={saving}
        style={{ fontSize: 11, padding: '2px 10px', borderRadius: 3,
          background: '#2563eb', color: '#fff', border: 'none', cursor: 'pointer' }}>
        {saving ? '…' : 'Add'}
      </button>
      <button type="button" onClick={onCancel}
        style={{ fontSize: 11, padding: '2px 8px', borderRadius: 3,
          background: '#f1f5f9', color: '#6b7280', border: '1px solid #d1d5db', cursor: 'pointer' }}>
        Cancel
      </button>
    </form>
  )
}

function useAddForm(saveFn) {
  const [open, setOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)

  async function handleSave(values) {
    setSaving(true)
    setError(null)
    try {
      await saveFn(values)
      setOpen(false)
    } catch (e) {
      setError(e.message)
    } finally {
      setSaving(false)
    }
  }

  return { open, setOpen, saving, error, handleSave }
}

// ─── tree row styles ──────────────────────────────────────────────────────────

const ROW = {
  display: 'flex', alignItems: 'center', gap: 6,
  padding: '3px 6px', borderRadius: 4, cursor: 'pointer',
  fontSize: 13,
}

function AddButton({ label, onClick }) {
  return (
    <button onClick={onClick}
      style={{
        fontSize: 11, color: '#6b7280', background: 'none', border: 'none',
        cursor: 'pointer', padding: '1px 4px', borderRadius: 3,
        marginLeft: 4,
      }}
      onMouseEnter={e => { e.currentTarget.style.color = '#2563eb'; e.currentTarget.style.background = '#eff6ff' }}
      onMouseLeave={e => { e.currentTarget.style.color = '#6b7280'; e.currentTarget.style.background = 'none' }}>
      + {label}
    </button>
  )
}

// ─── Phase row ───────────────────────────────────────────────────────────────

function PhaseRow({ phase, lotTypes, onAddLots }) {
  const lots = totalLots(phase.lot_type_counts)
  return (
    <div style={{ paddingLeft: 24, paddingTop: 2, paddingBottom: 2 }}>
      <div style={{ ...ROW, cursor: 'default' }}>
        <span style={{ width: 8 }} />
        <span style={{ color: '#374151', flex: 1 }}>{phase.phase_name}</span>
        <span style={{ fontSize: 11, color: '#9ca3af', marginLeft: 8 }}>
          {lots} lot{lots !== 1 ? 's' : ''}
        </span>
        <button
          onClick={() => onAddLots(phase)}
          style={{
            fontSize: 11, color: '#059669', background: '#f0fdf4',
            border: '1px solid #bbf7d0', borderRadius: 3,
            padding: '1px 8px', cursor: 'pointer', marginLeft: 4,
          }}>
          + Lots
        </button>
      </div>
    </div>
  )
}

// ─── Instrument row ───────────────────────────────────────────────────────────

function InstrumentRow({ instr, phases, lotTypes, onAddPhase, onAddLots }) {
  const instrPhases = phases.filter(p => p.instrument_id === instr.instrument_id)
  const [open, setOpen] = useState(false)
  const addPhase = useAddForm(async (vals) => {
    await onAddPhase(instr.instrument_id, vals.phase_name)
  })

  return (
    <div style={{ paddingLeft: 24 }}>
      <div style={{ ...ROW, color: '#4b5563' }}
        onClick={() => setOpen(o => !o)}>
        <ChevronIcon open={open} />
        <span style={{ fontWeight: 500 }}>{instr.instrument_name}</span>
        <span style={{ fontSize: 10, color: '#9ca3af', background: '#f1f5f9',
          padding: '0 5px', borderRadius: 10, marginLeft: 4 }}>
          {instr.instrument_type}
        </span>
        <span style={{ fontSize: 11, color: '#9ca3af', marginLeft: 4 }}>
          {instrPhases.length} phase{instrPhases.length !== 1 ? 's' : ''}
        </span>
        {open && (
          <span onClick={e => e.stopPropagation()}>
            <AddButton label="phase" onClick={() => addPhase.setOpen(o => !o)} />
          </span>
        )}
      </div>

      {open && (
        <div>
          {addPhase.open && (
            <div style={{ paddingLeft: 24 }}>
              <AddForm
                fields={[{ name: 'phase_name', label: 'Phase name', required: true }]}
                onSave={addPhase.handleSave}
                onCancel={() => addPhase.setOpen(false)}
                saving={addPhase.saving}
                error={addPhase.error}
              />
            </div>
          )}
          {instrPhases.map(p => (
            <PhaseRow
              key={p.phase_id}
              phase={p}
              lotTypes={lotTypes}
              onAddLots={onAddLots}
            />
          ))}
          {instrPhases.length === 0 && !addPhase.open && (
            <div style={{ paddingLeft: 48, fontSize: 11, color: '#d1d5db', padding: '2px 0 2px 48px' }}>
              No phases
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ─── Development row ─────────────────────────────────────────────────────────

function DevRow({ dev, instruments, phases, lotTypes, onAddInstrument, onAddPhase, onAddLots }) {
  const devInstrs = instruments.filter(i => i.modern_dev_id === dev.dev_id)
  const [open, setOpen] = useState(false)
  const addInstr = useAddForm(async (vals) => {
    await onAddInstrument(dev.dev_id, vals.instrument_name, vals.instrument_type)
  })

  return (
    <div style={{ paddingLeft: 20 }}>
      <div style={{ ...ROW, color: '#374151' }}
        onClick={() => setOpen(o => !o)}>
        <ChevronIcon open={open} />
        <span style={{ fontWeight: 500 }}>{dev.dev_name}</span>
        {dev.marks_code && (
          <span style={{ fontSize: 10, color: '#6b7280', background: '#f9fafb',
            border: '1px solid #e5e7eb', padding: '0 5px', borderRadius: 10 }}>
            {dev.marks_code}
          </span>
        )}
        <span style={{ fontSize: 11, color: '#9ca3af', marginLeft: 4 }}>
          {devInstrs.length} instrument{devInstrs.length !== 1 ? 's' : ''}
        </span>
        {open && (
          <span onClick={e => e.stopPropagation()}>
            <AddButton label="instrument" onClick={() => addInstr.setOpen(o => !o)} />
          </span>
        )}
      </div>

      {open && (
        <div>
          {addInstr.open && (
            <div style={{ paddingLeft: 24 }}>
              <AddForm
                fields={[
                  { name: 'instrument_name', label: 'Instrument name', required: true },
                  { name: 'instrument_type', label: 'Type', required: true,
                    options: ['Plat', 'Site Condo', 'Other'], default: 'Plat' },
                ]}
                onSave={addInstr.handleSave}
                onCancel={() => addInstr.setOpen(false)}
                saving={addInstr.saving}
                error={addInstr.error}
              />
            </div>
          )}
          {devInstrs.map(instr => (
            <InstrumentRow
              key={instr.instrument_id}
              instr={instr}
              phases={phases}
              lotTypes={lotTypes}
              onAddPhase={onAddPhase}
              onAddLots={onAddLots}
            />
          ))}
          {devInstrs.length === 0 && !addInstr.open && (
            <div style={{ paddingLeft: 44, fontSize: 11, color: '#d1d5db', padding: '2px 0 2px 44px' }}>
              No instruments — add one to start
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ─── Community row ───────────────────────────────────────────────────────────

function CommunityRow({ comm, devs, instruments, phases, lotTypes,
  onAddDev, onAddInstrument, onAddPhase, onAddLots }) {
  const [open, setOpen] = useState(false)
  const addDev = useAddForm(async (vals) => {
    await onAddDev(comm.ent_group_id, vals.dev_name, vals.marks_code || null)
  })

  return (
    <div style={{
      border: '1px solid #e5e7eb', borderRadius: 6,
      marginBottom: 6, overflow: 'hidden',
    }}>
      {/* Community header */}
      <div
        style={{
          ...ROW, padding: '6px 10px', background: '#f9fafb',
          borderBottom: open ? '1px solid #e5e7eb' : 'none',
          cursor: 'pointer', fontWeight: 600, color: '#111827', fontSize: 13,
        }}
        onClick={() => setOpen(o => !o)}>
        <ChevronIcon open={open} />
        <span style={{ flex: 1 }}>{comm.ent_group_name}</span>
        <span style={{ fontSize: 11, color: '#9ca3af', fontWeight: 400 }}>
          {devs.length} dev{devs.length !== 1 ? 's' : ''}
        </span>
        {open && (
          <span onClick={e => e.stopPropagation()}>
            <AddButton label="development" onClick={() => addDev.setOpen(o => !o)} />
          </span>
        )}
      </div>

      {open && (
        <div style={{ padding: '4px 4px 6px' }}>
          {addDev.open && (
            <div style={{ paddingLeft: 20, paddingTop: 4 }}>
              <AddForm
                fields={[
                  { name: 'dev_name', label: 'Development name', required: true, width: 200 },
                  { name: 'marks_code', label: 'MARKS code (optional)', width: 140 },
                ]}
                onSave={addDev.handleSave}
                onCancel={() => addDev.setOpen(false)}
                saving={addDev.saving}
                error={addDev.error}
              />
            </div>
          )}
          {devs.map(dev => (
            <DevRow
              key={dev.dev_id}
              dev={dev}
              instruments={instruments}
              phases={phases}
              lotTypes={lotTypes}
              onAddInstrument={onAddInstrument}
              onAddPhase={onAddPhase}
              onAddLots={onAddLots}
            />
          ))}
          {devs.length === 0 && !addDev.open && (
            <div style={{ paddingLeft: 28, fontSize: 11, color: '#d1d5db', padding: '4px 0 4px 28px' }}>
              No developments assigned
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ─── SetupView ────────────────────────────────────────────────────────────────

export default function SetupView({ showTestCommunities }) {
  const [communities, setCommunities] = useState([])
  const [developments, setDevelopments] = useState([])
  const [instruments, setInstruments] = useState([])
  const [phases, setPhases] = useState([])
  const [lotTypes, setLotTypes] = useState([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(null)
  const [bulkPhase, setBulkPhase] = useState(null)
  const addComm = useAddForm(async (vals) => {
    const res = await fetch(`${API_BASE}/entitlement-groups`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ent_group_name: vals.comm_name }),
    })
    if (!res.ok) throw new Error((await res.json()).detail ?? 'Create failed')
    const data = await res.json()
    setCommunities(prev => [...prev, { ...data, is_test: false }])
  })

  async function load() {
    setLoading(true)
    setLoadError(null)
    try {
      const [eg, devs, instrs, cfg] = await Promise.all([
        fetch(`${API_BASE}/entitlement-groups`).then(r => r.json()),
        fetch(`${API_BASE}/developments`).then(r => r.json()),
        fetch(`${API_BASE}/instruments`).then(r => r.json()),
        fetch(`${API_BASE}/admin/phase-config`).then(r => r.json()),
      ])
      setCommunities(eg)
      setDevelopments(devs)
      setInstruments(instrs)
      setPhases(cfg.rows ?? [])
      setLotTypes(cfg.lot_types ?? [])
    } catch (e) {
      setLoadError(e.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  async function handleAddDev(communityId, devName, marksCode) {
    const res = await fetch(`${API_BASE}/developments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ dev_name: devName, marks_code: marksCode, community_id: communityId }),
    })
    if (!res.ok) throw new Error((await res.json()).detail ?? 'Create failed')
    const data = await res.json()
    setDevelopments(prev => [...prev, data])
  }

  async function handleAddInstrument(devId, name, type) {
    const res = await fetch(`${API_BASE}/instruments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ dev_id: devId, instrument_name: name, instrument_type: type }),
    })
    if (!res.ok) throw new Error((await res.json()).detail ?? 'Create failed')
    const data = await res.json()
    // Instrument returned has legacy_dev_id; attach modern_dev_id for tree joins
    setInstruments(prev => [...prev, { ...data, modern_dev_id: devId }])
  }

  async function handleAddPhase(instrumentId, name) {
    const res = await fetch(`${API_BASE}/phases`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ instrument_id: instrumentId, phase_name: name }),
    })
    if (!res.ok) throw new Error((await res.json()).detail ?? 'Create failed')
    const data = await res.json()
    setPhases(prev => [...prev, { ...data, lot_type_counts: {}, product_splits: {} }])
  }

  const visibleCommunities = communities.filter(c =>
    showTestCommunities ? c.is_test : !c.is_test
  )

  if (loading) return (
    <div style={{ padding: 40, color: '#9ca3af', fontSize: 13 }}>Loading…</div>
  )
  if (loadError) return (
    <div style={{ padding: 40, color: '#dc2626', fontSize: 13 }}>{loadError}</div>
  )

  return (
    <div style={{ padding: '24px 32px', maxWidth: 820, boxSizing: 'border-box' }}>
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: 16, gap: 12 }}>
        <h1 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: '#111827' }}>Setup</h1>
        <button
          onClick={() => addComm.setOpen(o => !o)}
          style={{
            fontSize: 12, color: '#2563eb', background: '#eff6ff',
            border: '1px solid #bfdbfe', borderRadius: 4,
            padding: '3px 10px', cursor: 'pointer',
          }}>
          + New community
        </button>
      </div>

      {addComm.open && (
        <div style={{ marginBottom: 10 }}>
          <AddForm
            fields={[{ name: 'comm_name', label: 'Community name', required: true, width: 240 }]}
            onSave={addComm.handleSave}
            onCancel={() => addComm.setOpen(false)}
            saving={addComm.saving}
            error={addComm.error}
          />
        </div>
      )}

      {visibleCommunities.length === 0 && (
        <div style={{ fontSize: 13, color: '#9ca3af' }}>No communities yet.</div>
      )}

      {visibleCommunities.map(comm => (
        <CommunityRow
          key={comm.ent_group_id}
          comm={comm}
          devs={developments.filter(d => d.community_id === comm.ent_group_id)}
          instruments={instruments}
          phases={phases}
          lotTypes={lotTypes}
          onAddDev={handleAddDev}
          onAddInstrument={handleAddInstrument}
          onAddPhase={handleAddPhase}
          onAddLots={setBulkPhase}
        />
      ))}

      {bulkPhase && (
        <BulkLotInsertModal
          phase={bulkPhase}
          knownLotTypes={lotTypes}
          onClose={() => setBulkPhase(null)}
          onInserted={() => { setBulkPhase(null); load() }}
        />
      )}
    </div>
  )
}
