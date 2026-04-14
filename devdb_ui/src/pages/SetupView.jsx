// SetupView.jsx
// Hierarchical setup tree: Community → Development → Instrument → Phase → Lot Types
// Heavy sub-components live in src/components/setup/.

import { useState, useEffect, useContext } from 'react'
import { API_BASE } from '../config'
import {
  LotRefreshContext, ExpandAllContext,
  useLocalOpen, SUB, SUB_LABELS, phaseTotal, phaseHasLots,
  SubCell, SortHeader, ChevronIcon, InlineEdit,
  AddForm, useAddForm, ROW, AddButton,
  useDeleteConfirm, DeleteButton, DeleteConfirmBanner,
} from '../components/setup/setupShared'
import PhaseRow from '../components/setup/PhaseRow'

// ─── Instrument row ───────────────────────────────────────────────────────────

function InstrumentRow({ instr, phases, lotTypes, onAddPhase, onRenameInstr, onRenamePhase, onDeleteInstr, onChangeInstrType, onRefresh }) {
  const instrPhases = phases.filter(p => p.instrument_id === instr.instrument_id)
  const [open, setOpen] = useLocalOpen(`setup_open_instr_${instr.instrument_id}`)
  const [hovered, setHovered] = useState(false)
  const [editingType, setEditingType] = useState(false)
  const addPhase = useAddForm(async (vals) => {
    await onAddPhase(instr.instrument_id, vals.phase_name)
  })
  const { tick: xTick, value: xVal } = useContext(ExpandAllContext)
  useEffect(() => { if (xTick > 0) setOpen(xVal) }, [xTick]) // eslint-disable-line

  const instrP = instrPhases.length
  const instrL = instrPhases.reduce((s, p) => s + phaseTotal(p), 0)
  const instrLots = instrPhases.reduce((s, p) => {
    return s + Object.values(p.lot_type_counts ?? {}).reduce((t, c) => t + (c.marks ?? 0) + (c.pre ?? 0), 0)
  }, 0)

  const delInstr = useDeleteConfirm(async () => {
    const res = await fetch(`${API_BASE}/instruments/${instr.instrument_id}`, { method: 'DELETE' })
    if (!res.ok) throw new Error((await res.json()).detail ?? 'Delete failed')
    onDeleteInstr?.()
  })

  return (
    <div style={{ paddingLeft: 36, borderLeft: '3px solid #e0e7ff', marginLeft: 8, marginBottom: 2, background: 'rgba(238,242,255,0.35)', borderRadius: '0 4px 4px 0' }}>
      <div style={{ ...ROW, color: '#4b5563' }}
        onClick={() => { if (!delInstr.confirming) setOpen(o => !o) }}
        onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}
        tabIndex={0} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setOpen(o => !o) } }}>
        <ChevronIcon open={open} />
        <span style={{ fontWeight: 500, flex: 1, minWidth: 0 }}>
          <InlineEdit value={instr.instrument_name} onSave={onRenameInstr} />
        </span>
        {editingType ? (
          <select
            autoFocus
            value={instr.instrument_type || ''}
            onChange={async e => {
              const t = e.target.value
              setEditingType(false)
              await onChangeInstrType?.(t)
            }}
            onBlur={() => setEditingType(false)}
            onClick={e => e.stopPropagation()}
            style={{ fontSize: 10, border: '1px solid #6366f1', borderRadius: 10, padding: '0 4px', outline: 'none', cursor: 'pointer' }}>
            {['Plat', 'Site Condo', 'Traditional Condo', 'Metes & Bounds Splits', 'Other'].map(t => <option key={t} value={t}>{t}</option>)}
          </select>
        ) : (
          <span
            onClick={e => { e.stopPropagation(); setEditingType(true) }}
            title="Click to change type"
            style={{ fontSize: 10, color: '#9ca3af', background: '#f1f5f9',
              padding: '0 5px', borderRadius: 10, marginLeft: 4, cursor: 'pointer' }}>
            {instr.instrument_type || '—'}
          </span>
        )}
        <span onClick={e => e.stopPropagation()}
          style={{ opacity: hovered || open ? 1 : 0, pointerEvents: hovered || open ? undefined : 'none', transition: 'opacity 0.1s' }}>
          <AddButton label="phase" onClick={() => { setOpen(true); addPhase.setOpen(true) }} />
        </span>
        <DeleteButton visible={hovered && !delInstr.confirming} onClick={() => delInstr.setConfirming(true)} />
        <div style={{ display: 'flex', flexShrink: 0 }}>
          <div style={{ width: SUB.D, flexShrink: 0, borderLeft: '2px solid #e5e7eb' }} />
          <div style={{ width: SUB.I, flexShrink: 0 }} />
          <SubCell n={instrP} w={SUB.P} onClick={e => { e.stopPropagation(); setOpen(true) }} />
          <SubCell n={instrL} w={SUB.L} onClick={e => { e.stopPropagation(); setOpen(true) }} />
        </div>
      </div>

      {delInstr.confirming && (
        <DeleteConfirmBanner
          label={`"${instr.instrument_name}"`}
          warning={instrLots > 0 ? `${instrP} phase${instrP !== 1 ? 's' : ''}, ${instrLots} lot${instrLots !== 1 ? 's' : ''} unassigned` : instrP > 0 ? `${instrP} phase${instrP !== 1 ? 's' : ''} deleted` : undefined}
          onConfirm={delInstr.handleConfirm}
          onCancel={() => delInstr.setConfirming(false)}
          deleting={delInstr.deleting}
          error={delInstr.error}
        />
      )}

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
              onDelete={onRefresh}
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

function DevRow({ dev, instruments, phases, lotTypes, onAddInstrument, onAddPhase, onRenameDev, onRenameInstr, onChangeInstrType, onRenamePhase, onDeleteDev, onRefresh }) {
  const devInstrs = instruments.filter(i => i.dev_id === dev.dev_id)
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
  const devLots = devPhases.reduce((s, p) => {
    return s + Object.values(p.lot_type_counts ?? {}).reduce((t, c) => t + (c.marks ?? 0) + (c.pre ?? 0), 0)
  }, 0)

  const delDev = useDeleteConfirm(async () => {
    const res = await fetch(`${API_BASE}/developments/${dev.dev_id}`, { method: 'DELETE' })
    if (!res.ok) throw new Error((await res.json()).detail ?? 'Delete failed')
    onDeleteDev?.()
  })

  return (
    <div style={{ paddingLeft: 28, borderLeft: '3px solid #e5e7eb', marginLeft: 6, marginTop: 3 }}>
      <div style={{ ...ROW, color: '#374151' }}
        onClick={() => { if (!delDev.confirming) setOpen(o => !o) }}
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
        <DeleteButton visible={hovered && !delDev.confirming} onClick={() => delDev.setConfirming(true)} />
        <div style={{ display: 'flex', flexShrink: 0 }}>
          <div style={{ width: SUB.D, flexShrink: 0, borderLeft: '2px solid #e5e7eb' }} />
          <SubCell n={devI} w={SUB.I} onClick={e => { e.stopPropagation(); setOpen(true) }} />
          <SubCell n={devP} w={SUB.P} onClick={e => { e.stopPropagation(); setOpen(true) }} />
          <SubCell n={devL} w={SUB.L} onClick={e => { e.stopPropagation(); setOpen(true) }} />
        </div>
      </div>

      {delDev.confirming && (
        <DeleteConfirmBanner
          label={`"${dev.dev_name}"`}
          warning={devLots > 0
            ? `${devI} instrument${devI !== 1 ? 's' : ''}, ${devP} phase${devP !== 1 ? 's' : ''}, ${devLots} lot${devLots !== 1 ? 's' : ''} unassigned`
            : devP > 0 ? `${devI} instrument${devI !== 1 ? 's' : ''}, ${devP} phase${devP !== 1 ? 's' : ''} deleted` : undefined}
          onConfirm={delDev.handleConfirm}
          onCancel={() => delDev.setConfirming(false)}
          deleting={delDev.deleting}
          error={delDev.error}
        />
      )}

      {open && (
        <div>
          {addInstr.open && (
            <div style={{ paddingLeft: 24 }}>
              <AddForm
                fields={[
                  { name: 'instrument_name', label: 'Instrument name', required: true },
                  { name: 'instrument_type', label: 'Type', required: true,
                    options: ['Plat', 'Site Condo', 'Traditional Condo', 'Metes & Bounds Splits', 'Other'], default: 'Plat' },
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
              onChangeInstrType={type => onChangeInstrType?.(instr.instrument_id, type)}
              onRenamePhase={onRenamePhase}
              onDeleteInstr={onRefresh}
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
  onRenameComm, onRenameDev, onRenameInstr, onChangeInstrType, onRenamePhase,
  onDeleteComm, onDeleteDev, onRefresh }) {
  const [open, setOpen] = useLocalOpen(`setup_open_comm_${comm.ent_group_id}`)
  const [hovered, setHovered] = useState(false)
  const addDev = useAddForm(async (vals) => {
    await onAddDev(comm.ent_group_id, vals.dev_name, vals.marks_code || null)
  })
  const { tick: xTick, value: xVal } = useContext(ExpandAllContext)
  useEffect(() => { if (xTick > 0) setOpen(xVal) }, [xTick]) // eslint-disable-line

  const commInstrIds = new Set(
    instruments.filter(i => devs.some(d => d.dev_id === i.dev_id)).map(i => i.instrument_id)
  )
  const commPhases = phases.filter(p => commInstrIds.has(p.instrument_id))
  const commD = devs.length
  const commI = commInstrIds.size
  const commP = commPhases.length
  const commL = commPhases.reduce((s, p) => s + phaseTotal(p), 0)
  const commLots = commPhases.reduce((s, p) => {
    return s + Object.values(p.lot_type_counts ?? {}).reduce((t, c) => t + (c.marks ?? 0) + (c.pre ?? 0), 0)
  }, 0)
  const phasesWithLots = commPhases.filter(p => phaseHasLots(p)).length

  const delComm = useDeleteConfirm(async () => {
    const res = await fetch(`${API_BASE}/entitlement-groups/${comm.ent_group_id}`, { method: 'DELETE' })
    if (!res.ok) throw new Error((await res.json()).detail ?? 'Delete failed')
    onDeleteComm?.()
  })
  const dotColor = commP === 0 ? '#d1d5db'
    : phasesWithLots === commP ? '#10b981'
    : phasesWithLots === 0    ? '#f87171'
    : '#f59e0b'
  const dotIcon = commP === 0 ? '○'
    : phasesWithLots === commP ? '✓'
    : phasesWithLots === 0    ? '✗'
    : '◐'
  const dotTitle = commP === 0 ? 'No phases'
    : phasesWithLots === commP ? 'All phases have lots'
    : phasesWithLots === 0    ? 'No phases have lots'
    : `${phasesWithLots} of ${commP} phases have lots`

  return (
    <div style={{
      border: '1px solid #e5e7eb', borderRadius: 6,
      marginBottom: 12, overflow: 'hidden',
    }}>
      <div
        style={{
          ...ROW, padding: '6px 6px 6px 10px', background: '#f9fafb',
          borderBottom: open ? '1px solid #e5e7eb' : 'none',
          cursor: 'pointer', fontWeight: 600, color: '#111827', fontSize: 13,
        }}
        onClick={() => { if (!delComm.confirming) setOpen(o => !o) }}
        onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}
        tabIndex={0} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setOpen(o => !o) } }}>
        <span title={dotTitle} style={{ color: dotColor, fontSize: 13, lineHeight: 1, flexShrink: 0, marginRight: 2, fontWeight: 700 }}>{dotIcon}</span>
        <ChevronIcon open={open} />
        <span style={{ flex: 1 }}>
          <InlineEdit value={comm.ent_group_name} onSave={onRenameComm} />
        </span>
        <span onClick={e => e.stopPropagation()}
          style={{ opacity: hovered || open ? 1 : 0, pointerEvents: hovered || open ? undefined : 'none', transition: 'opacity 0.1s' }}>
          <AddButton label="development" onClick={() => { setOpen(true); addDev.setOpen(true) }} />
        </span>
        <DeleteButton visible={hovered && !delComm.confirming} onClick={() => delComm.setConfirming(true)} />
        <div style={{ display: 'flex', flexShrink: 0 }}>
          <SubCell n={commD} w={SUB.D} left />
          <SubCell n={commI} w={SUB.I} />
          <SubCell n={commP} w={SUB.P} />
          <SubCell n={commL} w={SUB.L} />
        </div>
      </div>

      {delComm.confirming && (
        <DeleteConfirmBanner
          label={`"${comm.ent_group_name}"`}
          warning={commLots > 0
            ? `${commD} dev${commD !== 1 ? 's' : ''}, ${commP} phase${commP !== 1 ? 's' : ''}, ${commLots} lot${commLots !== 1 ? 's' : ''} unassigned`
            : commD > 0 ? `${commD} dev${commD !== 1 ? 's' : ''} and all nested objects deleted` : undefined}
          onConfirm={delComm.handleConfirm}
          onCancel={() => delComm.setConfirming(false)}
          deleting={delComm.deleting}
          error={delComm.error}
        />
      )}

      {open && (
        <div style={{ padding: '6px 0 10px 6px' }}>
          {addDev.open && (
            <div style={{ paddingLeft: 28, paddingTop: 4 }}>
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
              onChangeInstrType={onChangeInstrType}
              onRenamePhase={onRenamePhase}
              onDeleteDev={onDeleteDev ? () => onDeleteDev(dev.dev_id) : undefined}
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
        fetch(`${API_BASE}/entitlement-groups`).then(r => { if (!r.ok) throw new Error(`entitlement-groups ${r.status}`); return r.json() }),
        fetch(`${API_BASE}/developments`).then(r => { if (!r.ok) throw new Error(`developments ${r.status}`); return r.json() }),
        fetch(`${API_BASE}/instruments`).then(r => { if (!r.ok) throw new Error(`instruments ${r.status}`); return r.json() }),
        fetch(`${API_BASE}/admin/phase-config`).then(r => { if (!r.ok) throw new Error(`phase-config ${r.status}`); return r.json() }),
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
    setInstruments(prev => [...prev, { ...data }])
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
      body: JSON.stringify({ name }),
    })
    if (!res.ok) throw new Error((await res.json()).detail ?? 'Rename failed')
    setInstruments(prev => prev.map(i => i.instrument_id === instrId ? { ...i, instrument_name: name } : i))
  }

  async function handleChangeInstrType(instrId, type) {
    const res = await fetch(`${API_BASE}/instruments/${instrId}/type`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ instrument_type: type }),
    })
    if (!res.ok) throw new Error((await res.json()).detail ?? 'Update failed')
    setInstruments(prev => prev.map(i => i.instrument_id === instrId ? { ...i, instrument_type: type } : i))
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

  // Delete handlers — use silent reload so the removed item disappears cleanly
  async function handleDeleteComm(commId) {
    load(true)
  }

  async function handleDeleteDev(devId) {
    load(true)
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
    const cIIds = new Set(instruments.filter(i => cDevs.some(d => d.dev_id === i.dev_id)).map(i => i.instrument_id))
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
    <div style={{ display: 'flex', flexDirection: 'column', height: 'calc(100vh - 45px)', overflow: 'hidden' }}>

      {/* ── Locked header ── */}
      <div style={{ flexShrink: 0, padding: '24px 32px 0', maxWidth: 1020, boxSizing: 'border-box', background: '#fff' }}>
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

        {visibleCommunities.length > 0 && (() => {
          const totals = Object.values(commStats).reduce(
            (acc, s) => ({ D: acc.D + s.D, I: acc.I + s.I, P: acc.P + s.P, L: acc.L + s.L }),
            { D: 0, I: 0, P: 0, L: 0 }
          )
          return (
            <div style={{ background: '#fff', marginBottom: 4 }}>
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
      </div>

      {/* ── Scrollable community rows ── */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '0 32px 24px', maxWidth: 1020, boxSizing: 'border-box' }}>
        {visibleCommunities.length === 0 && (
          <div style={{ fontSize: 13, color: '#9ca3af', paddingTop: 8 }}>No communities yet.</div>
        )}

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
            onChangeInstrType={handleChangeInstrType}
            onRenamePhase={handleRenamePhase}
            onDeleteComm={() => handleDeleteComm(comm.ent_group_id)}
            onDeleteDev={handleDeleteDev}
            onRefresh={() => load(true)}
          />
        ))}
      </div>

    </div>
    </ExpandAllContext.Provider>
    </LotRefreshContext.Provider>
  )
}
