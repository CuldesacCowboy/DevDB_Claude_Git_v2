// SetupView.jsx
// Hierarchical setup tree: Community → Development → Instrument → Phase → Lot Types
// Heavy sub-components live in src/components/setup/.

import { useState, useEffect, useContext } from 'react'
import { API_BASE } from '../config'
import {
  LotRefreshContext, ExpandAllContext,
  useLocalOpen, SUB, SUB_LABELS, phaseTotal,
  SubCell, SortHeader, ChevronIcon, InlineEdit,
  AddForm, useAddForm, ROW, AddButton,
} from '../components/setup/setupShared'
import PhaseRow from '../components/setup/PhaseRow'

// ─── Instrument row ───────────────────────────────────────────────────────────

function InstrumentRow({ instr, phases, lotTypes, onAddPhase, onRenameInstr, onRenamePhase, onRefresh }) {
  const instrPhases = phases.filter(p => p.instrument_id === instr.instrument_id)
  const [open, setOpen] = useLocalOpen(`setup_open_instr_${instr.instrument_id}`)
  const [hovered, setHovered] = useState(false)
  const addPhase = useAddForm(async (vals) => {
    await onAddPhase(instr.instrument_id, vals.phase_name)
  })
  const { tick: xTick, value: xVal } = useContext(ExpandAllContext)
  useEffect(() => { if (xTick > 0) setOpen(xVal) }, [xTick]) // eslint-disable-line

  const instrP = instrPhases.length
  const instrL = instrPhases.reduce((s, p) => s + phaseTotal(p), 0)

  return (
    <div style={{ paddingLeft: 24 }}>
      <div style={{ ...ROW, color: '#4b5563' }}
        onClick={() => setOpen(o => !o)}
        onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}
        tabIndex={0} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setOpen(o => !o) } }}>
        <ChevronIcon open={open} />
        <span style={{ fontWeight: 500, flex: 1, minWidth: 0 }}>
          <InlineEdit value={instr.instrument_name} onSave={onRenameInstr} />
        </span>
        <span style={{ fontSize: 10, color: '#9ca3af', background: '#f1f5f9',
          padding: '0 5px', borderRadius: 10, marginLeft: 4 }}>
          {instr.instrument_type}
        </span>
        <span onClick={e => e.stopPropagation()}
          style={{ opacity: hovered || open ? 1 : 0, pointerEvents: hovered || open ? undefined : 'none', transition: 'opacity 0.1s' }}>
          <AddButton label="phase" onClick={() => { setOpen(true); addPhase.setOpen(true) }} />
        </span>
        <div style={{ display: 'flex', flexShrink: 0 }}>
          <div style={{ width: SUB.D, flexShrink: 0, borderLeft: '2px solid #e5e7eb' }} />
          <div style={{ width: SUB.I, flexShrink: 0 }} />
          <SubCell n={instrP} w={SUB.P} onClick={e => { e.stopPropagation(); setOpen(true) }} />
          <SubCell n={instrL} w={SUB.L} onClick={e => { e.stopPropagation(); setOpen(true) }} />
        </div>
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
              phases={phases}
              lotTypes={lotTypes}
              onRename={name => onRenamePhase(p.phase_id, name)}
              onRefresh={onRefresh}
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

// ─── Development row ──────────────────────────────────────────────────────────

function DevRow({ dev, instruments, phases, lotTypes, onAddInstrument, onAddPhase, onRenameDev, onRenameInstr, onRenamePhase, onRefresh }) {
  const devInstrs = instruments.filter(i => i.modern_dev_id === dev.dev_id)
  const [open, setOpen] = useLocalOpen(`setup_open_dev_${dev.dev_id}`)
  const [hovered, setHovered] = useState(false)
  const addInstr = useAddForm(async (vals) => {
    await onAddInstrument(dev.dev_id, vals.instrument_name, vals.instrument_type)
  })
  const { tick: xTick, value: xVal } = useContext(ExpandAllContext)
  useEffect(() => { if (xTick > 0) setOpen(xVal) }, [xTick]) // eslint-disable-line

  const devInstrIds = new Set(devInstrs.map(i => i.instrument_id))
  const devPhases = phases.filter(p => devInstrIds.has(p.instrument_id))
  const devI = devInstrs.length
  const devP = devPhases.length
  const devL = devPhases.reduce((s, p) => s + phaseTotal(p), 0)

  return (
    <div style={{ paddingLeft: 20 }}>
      <div style={{ ...ROW, color: '#374151' }}
        onClick={() => setOpen(o => !o)}
        onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}
        tabIndex={0} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setOpen(o => !o) } }}>
        <ChevronIcon open={open} />
        <span style={{ fontWeight: 500, flex: 1, minWidth: 0 }}>
          <InlineEdit value={dev.dev_name} onSave={onRenameDev} />
        </span>
        {dev.marks_code && (
          <span style={{ fontSize: 10, color: '#6b7280', background: '#f9fafb',
            border: '1px solid #e5e7eb', padding: '0 5px', borderRadius: 10 }}>
            {dev.marks_code}
          </span>
        )}
        <span onClick={e => e.stopPropagation()}
          style={{ opacity: hovered || open ? 1 : 0, pointerEvents: hovered || open ? undefined : 'none', transition: 'opacity 0.1s' }}>
          <AddButton label="instrument" onClick={() => { setOpen(true); addInstr.setOpen(true) }} />
        </span>
        <div style={{ display: 'flex', flexShrink: 0 }}>
          <div style={{ width: SUB.D, flexShrink: 0, borderLeft: '2px solid #e5e7eb' }} />
          <SubCell n={devI} w={SUB.I} onClick={e => { e.stopPropagation(); setOpen(true) }} />
          <SubCell n={devP} w={SUB.P} onClick={e => { e.stopPropagation(); setOpen(true) }} />
          <SubCell n={devL} w={SUB.L} onClick={e => { e.stopPropagation(); setOpen(true) }} />
        </div>
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
              onRenameInstr={name => onRenameInstr(instr.instrument_id, name)}
              onRenamePhase={onRenamePhase}
              onRefresh={onRefresh}
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

// ─── Community row ────────────────────────────────────────────────────────────

function CommunityRow({ comm, devs, instruments, phases, lotTypes,
  onAddDev, onAddInstrument, onAddPhase,
  onRenameComm, onRenameDev, onRenameInstr, onRenamePhase,
  onRefresh }) {
  const [open, setOpen] = useLocalOpen(`setup_open_comm_${comm.ent_group_id}`)
  const [hovered, setHovered] = useState(false)
  const addDev = useAddForm(async (vals) => {
    await onAddDev(comm.ent_group_id, vals.dev_name, vals.marks_code || null)
  })
  const { tick: xTick, value: xVal } = useContext(ExpandAllContext)
  useEffect(() => { if (xTick > 0) setOpen(xVal) }, [xTick]) // eslint-disable-line

  const commInstrIds = new Set(
    instruments.filter(i => devs.some(d => d.dev_id === i.modern_dev_id)).map(i => i.instrument_id)
  )
  const commPhases = phases.filter(p => commInstrIds.has(p.instrument_id))
  const commD = devs.length
  const commI = commInstrIds.size
  const commP = commPhases.length
  const commL = commPhases.reduce((s, p) => s + phaseTotal(p), 0)
  const phasesWithLots = commPhases.filter(p => phaseTotal(p) > 0).length
  const dotColor = commP === 0 ? '#e5e7eb'
    : phasesWithLots === commP ? '#10b981'
    : phasesWithLots === 0    ? '#f87171'
    : '#f59e0b'
  const dotTitle = commP === 0 ? 'No phases'
    : phasesWithLots === commP ? 'All phases have projected lots'
    : phasesWithLots === 0    ? 'No phases have projected lots'
    : `${phasesWithLots} of ${commP} phases have projected lots`

  return (
    <div style={{
      border: '1px solid #e5e7eb', borderRadius: 6,
      marginBottom: 6, overflow: 'hidden',
    }}>
      <div
        style={{
          ...ROW, padding: '6px 6px 6px 10px', background: '#f9fafb',
          borderBottom: open ? '1px solid #e5e7eb' : 'none',
          cursor: 'pointer', fontWeight: 600, color: '#111827', fontSize: 13,
        }}
        onClick={() => setOpen(o => !o)}
        onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}
        tabIndex={0} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setOpen(o => !o) } }}>
        <span style={{ width: 8, height: 8, borderRadius: '50%', flexShrink: 0, display: 'inline-block', background: dotColor, marginRight: 2 }} title={dotTitle} />
        <ChevronIcon open={open} />
        <span style={{ flex: 1 }}>
          <InlineEdit value={comm.ent_group_name} onSave={onRenameComm} />
        </span>
        <span onClick={e => e.stopPropagation()}
          style={{ opacity: hovered || open ? 1 : 0, pointerEvents: hovered || open ? undefined : 'none', transition: 'opacity 0.1s' }}>
          <AddButton label="development" onClick={() => { setOpen(true); addDev.setOpen(true) }} />
        </span>
        <div style={{ display: 'flex', flexShrink: 0 }}>
          <SubCell n={commD} w={SUB.D} left />
          <SubCell n={commI} w={SUB.I} />
          <SubCell n={commP} w={SUB.P} />
          <SubCell n={commL} w={SUB.L} />
        </div>
      </div>

      {open && (
        <div style={{ padding: '4px 0 6px 4px' }}>
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
              onRenameDev={name => onRenameDev(dev.dev_id, name)}
              onRenameInstr={onRenameInstr}
              onRenamePhase={onRenamePhase}
              onRefresh={onRefresh}
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
  const [refreshTick, setRefreshTick] = useState(0)
  const [commSort, setCommSort] = useState({ key: null, dir: 1 })
  const [expandCtx, setExpandCtx] = useState({ tick: 0, value: null })

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

  async function load(silent = false) {
    if (!silent) setLoading(true)
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
      setRefreshTick(t => t + 1)
    } catch (e) {
      setLoadError(e.message)
    } finally {
      if (!silent) setLoading(false)
    }
  }

  useEffect(() => { load() }, []) // eslint-disable-line

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
    setInstruments(prev => [...prev, { ...data, modern_dev_id: devId }])
  }

  async function handleRenameComm(commId, name) {
    const res = await fetch(`${API_BASE}/entitlement-groups/${commId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ent_group_name: name }),
    })
    if (!res.ok) throw new Error((await res.json()).detail ?? 'Rename failed')
    setCommunities(prev => prev.map(c => c.ent_group_id === commId ? { ...c, ent_group_name: name } : c))
  }

  async function handleRenameDev(devId, name) {
    const res = await fetch(`${API_BASE}/developments/${devId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ dev_name: name }),
    })
    if (!res.ok) throw new Error((await res.json()).detail ?? 'Rename failed')
    setDevelopments(prev => prev.map(d => d.dev_id === devId ? { ...d, dev_name: name } : d))
  }

  async function handleRenameInstr(instrId, name) {
    const res = await fetch(`${API_BASE}/instruments/${instrId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ instrument_name: name }),
    })
    if (!res.ok) throw new Error((await res.json()).detail ?? 'Rename failed')
    setInstruments(prev => prev.map(i => i.instrument_id === instrId ? { ...i, instrument_name: name } : i))
  }

  async function handleRenamePhase(phaseId, name) {
    const res = await fetch(`${API_BASE}/phases/${phaseId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phase_name: name }),
    })
    if (!res.ok) throw new Error((await res.json()).detail ?? 'Rename failed')
    setPhases(prev => prev.map(p => p.phase_id === phaseId ? { ...p, phase_name: name } : p))
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

  const commStats = {}
  for (const comm of visibleCommunities) {
    const cDevs = developments.filter(d => d.community_id === comm.ent_group_id)
    const cIIds = new Set(instruments.filter(i => cDevs.some(d => d.dev_id === i.modern_dev_id)).map(i => i.instrument_id))
    const cPhases = phases.filter(p => cIIds.has(p.instrument_id))
    commStats[comm.ent_group_id] = {
      D: cDevs.length, I: cIIds.size, P: cPhases.length,
      L: cPhases.reduce((s, p) => s + phaseTotal(p), 0),
    }
  }

  const sortedCommunities = commSort.key
    ? [...visibleCommunities].sort((a, b) => {
        const av = commSort.key === 'name' ? a.ent_group_name : (commStats[a.ent_group_id]?.[commSort.key] ?? 0)
        const bv = commSort.key === 'name' ? b.ent_group_name : (commStats[b.ent_group_id]?.[commSort.key] ?? 0)
        return commSort.dir * (typeof av === 'string' ? av.localeCompare(bv) : av - bv)
      })
    : visibleCommunities

  if (loading) return (
    <div style={{ padding: 40, color: '#9ca3af', fontSize: 13 }}>Loading…</div>
  )
  if (loadError) return (
    <div style={{ padding: 40, color: '#dc2626', fontSize: 13 }}>{loadError}</div>
  )

  return (
    <LotRefreshContext.Provider value={refreshTick}>
    <ExpandAllContext.Provider value={expandCtx}>
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
        <span style={{ flex: 1 }} />
        {[['Expand all', true], ['Collapse all', false]].map(([label, val]) => (
          <button key={label}
            onClick={() => setExpandCtx(prev => ({ tick: prev.tick + 1, value: val }))}
            style={{
              fontSize: 11, color: '#6b7280', background: 'none',
              border: '1px solid #e5e7eb', borderRadius: 4,
              padding: '2px 8px', cursor: 'pointer',
            }}>
            {label}
          </button>
        ))}
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

      {visibleCommunities.length > 0 && (() => {
        const totals = Object.values(commStats).reduce(
          (acc, s) => ({ D: acc.D + s.D, I: acc.I + s.I, P: acc.P + s.P, L: acc.L + s.L }),
          { D: 0, I: 0, P: 0, L: 0 }
        )
        return (
          <div style={{ position: 'sticky', top: 0, zIndex: 10, background: '#fff', marginBottom: 4 }}>
            <div style={{ display: 'flex', alignItems: 'center', paddingRight: 6, borderBottom: '1px solid #e5e7eb', paddingBottom: 4 }}>
              <SortHeader label="Community" sortKey="name" sort={commSort} onSort={setCommSort}
                style={{ flex: 1, textAlign: 'left' }} />
              {(['D', 'I', 'P', 'L']).map((key, idx) => (
                <SortHeader key={key} label={SUB_LABELS[key]} sortKey={key}
                  sort={commSort} onSort={setCommSort}
                  style={{
                    width: SUB[key], flexShrink: 0,
                    justifyContent: 'flex-end', padding: '0 5px',
                    ...(idx === 0 ? { borderLeft: '2px solid #e5e7eb' } : {}),
                  }} />
              ))}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', paddingRight: 6, paddingTop: 3, paddingBottom: 3, borderBottom: '2px solid #e5e7eb' }}>
              <span style={{ flex: 1, fontSize: 11, color: '#9ca3af', paddingLeft: 4 }}>Total</span>
              {(['D', 'I', 'P', 'L']).map((key, idx) => (
                <div key={key} style={{
                  width: SUB[key], flexShrink: 0, textAlign: 'right', padding: '0 5px',
                  fontSize: 11, fontWeight: 600, color: '#374151',
                  ...(idx === 0 ? { borderLeft: '2px solid #e5e7eb' } : {}),
                }}>{totals[key]}</div>
              ))}
            </div>
          </div>
        )
      })()}

      {sortedCommunities.map(comm => (
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
          onRenameComm={name => handleRenameComm(comm.ent_group_id, name)}
          onRenameDev={handleRenameDev}
          onRenameInstr={handleRenameInstr}
          onRenamePhase={handleRenamePhase}
          onRefresh={() => load(true)}
        />
      ))}

    </div>
    </ExpandAllContext.Provider>
    </LotRefreshContext.Provider>
  )
}
