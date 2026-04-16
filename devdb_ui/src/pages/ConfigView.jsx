import { useState, useEffect, useCallback } from 'react'
import { API_BASE } from '../config'
import { TabBar } from '../components/config/configShared'
import { CommunityTab } from '../components/config/CommunityTab'
import { DevTab } from '../components/config/DevTab'
import { InstrumentTab } from '../components/config/InstrumentTab'
import { PhaseTab } from '../components/config/PhaseTab'

export default function ConfigView({ showTestCommunities }) {
  // Read one-shot jump written by AuditView "Go to Config" buttons
  const [configJump] = useState(() => {
    try {
      const j = JSON.parse(localStorage.getItem('devdb_config_jump') || 'null')
      localStorage.removeItem('devdb_config_jump')
      return j
    } catch { return null }
  })
  const [tab,          setTab]          = useState(configJump?.tab ?? 'community')
  const [phaseData,    setPhaseData]    = useState(null)
  const [commData,     setCommData]     = useState(null)
  const [devData,      setDevData]      = useState(null)
  const [globalMonths, setGlobalMonths] = useState(null)
  const [loading,      setLoading]      = useState(true)
  const [loadError,    setLoadError]    = useState(null)

  const load = useCallback(() => {
    setLoading(true)
    Promise.all([
      fetch(`${API_BASE}/admin/phase-config`).then(r => { if (!r.ok) throw new Error(r.status); return r.json() }),
      fetch(`${API_BASE}/admin/community-config`).then(r => { if (!r.ok) throw new Error(r.status); return r.json() }),
      fetch(`${API_BASE}/admin/dev-config`).then(r => { if (!r.ok) throw new Error(r.status); return r.json() }),
      fetch(`${API_BASE}/global-settings`).then(r => { if (!r.ok) throw new Error(r.status); return r.json() }),
    ])
      .then(([pd, cd, dd, gs]) => {
        setPhaseData(pd); setCommData(cd); setDevData(dd)
        setGlobalMonths(gs?.delivery_months ? [...gs.delivery_months] : null)
        setLoadError(null)
      })
      .catch(e => setLoadError(String(e)))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => { load() }, [load])

  // ── Community config save ──────────────────────────────────────────────────

  async function patchComm(entGroupId, kind, patch) {
    if (kind === 'ledger') {
      const res = await fetch(`${API_BASE}/entitlement-groups/${entGroupId}/ledger-config`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      })
      if (!res.ok) throw new Error(await res.text())
      const updated = await res.json()
      setCommData(prev => prev.map(r => r.ent_group_id === entGroupId
        ? { ...r, date_paper: updated.date_paper, date_ent: updated.date_ent }
        : r))
    } else if (kind === 'location') {
      const res = await fetch(`${API_BASE}/entitlement-groups/${entGroupId}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      })
      if (!res.ok) throw new Error(await res.text())
      const updated = await res.json()
      // Refresh county/SD names by reloading audit data
      setCommData(prev => prev.map(r => r.ent_group_id === entGroupId
        ? { ...r, county_id: updated.county_id, school_district_id: updated.school_district_id }
        : r))
      // Full reload to get updated names
      const full = await fetch(`${API_BASE}/admin/audit-data`).then(r => r.json())
      setCommData(full.communities)
    } else {
      const res = await fetch(`${API_BASE}/entitlement-groups/${entGroupId}/delivery-config`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      })
      if (!res.ok) throw new Error(await res.text())
      const updated = await res.json()
      setCommData(prev => prev.map(r => r.ent_group_id === entGroupId
        ? { ...r,
            auto_schedule_enabled:   updated.auto_schedule_enabled,
            delivery_months:         updated.delivery_months != null ? [...updated.delivery_months] : null,
            max_deliveries_per_year: updated.max_deliveries_per_year }
        : r))
    }
  }

  // ── Global delivery months save ────────────────────────────────────────────

  async function saveGlobal(months) {
    const res = await fetch(`${API_BASE}/global-settings`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ delivery_months: months }),
    })
    if (!res.ok) throw new Error(await res.text())
    const updated = await res.json()
    setGlobalMonths(updated?.delivery_months ? [...updated.delivery_months] : null)
  }

  // ── Dev params save ────────────────────────────────────────────────────────

  async function patchDev(devId, patch) {
    const res = await fetch(`${API_BASE}/developments/${devId}/sim-params`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    })
    if (!res.ok) throw new Error(await res.text())
    const updated = await res.json()
    setDevData(prev => prev.map(r => r.dev_id === devId
      ? { ...r,
          annual_starts_target: updated.annual_starts_target,
          max_starts_per_month: updated.max_starts_per_month }
      : r))
  }

  // ── Instrument spec_rate save ──────────────────────────────────────────────

  async function saveSpecRate(instrumentId, rate) {
    const res = await fetch(`${API_BASE}/instruments/${instrumentId}/spec-rate`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ spec_rate: rate }),
    })
    if (!res.ok) throw new Error(await res.text())
    setPhaseData(prev => ({
      ...prev,
      rows: prev.rows.map(r => r.instrument_id === instrumentId ? { ...r, spec_rate: rate } : r),
    }))
  }

  // ── Phase save helpers ─────────────────────────────────────────────────────

  function patchPhaseRow(phaseId, patch) {
    setPhaseData(prev => ({ ...prev, rows: prev.rows.map(r => r.phase_id === phaseId ? { ...r, ...patch } : r) }))
  }

  async function patchPhase(phaseId, field, value) {
    const res = await fetch(`${API_BASE}/admin/phase/${phaseId}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ [field]: value }),
    })
    if (!res.ok) throw new Error(await res.text())
    patchPhaseRow(phaseId, await res.json())
  }

  async function toggleLock(row, shouldLock) {
    const date_dev_actual = shouldLock ? row.date_dev_projected : null
    const res = await fetch(`${API_BASE}/admin/phase/${row.phase_id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ date_dev_actual }),
    })
    if (!res.ok) throw new Error(await res.text())
    patchPhaseRow(row.phase_id, await res.json())
  }

  async function saveProductSplit(phaseId, lotTypeId, count) {
    const res = await fetch(`${API_BASE}/admin/product-split/${phaseId}/${lotTypeId}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projected_count: count ?? 0 }),
    })
    if (!res.ok) throw new Error(await res.text())
    const row = phaseData?.rows.find(r => r.phase_id === phaseId)
    patchPhaseRow(phaseId, { product_splits: { ...(row?.product_splits ?? {}), [lotTypeId]: count ?? 0 } })
  }

  async function saveBuilderSplit(instrumentId, builderId, share) {
    const res = await fetch(`${API_BASE}/admin/builder-split/${instrumentId}/${builderId}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ share }),
    })
    if (!res.ok) throw new Error(await res.text())
    const affectedRows = phaseData?.rows.filter(r => r.instrument_id === instrumentId) ?? []
    for (const row of affectedRows) {
      const newSplits = { ...(row?.builder_splits ?? {}) }
      if (share == null) delete newSplits[builderId]; else newSplits[builderId] = share
      patchPhaseRow(row.phase_id, { builder_splits: newSplits })
    }
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  if (loading)   return <div style={{ padding: 24, color: '#6b7280', fontSize: 13 }}>Loading…</div>
  if (loadError) return <div style={{ padding: 24, color: '#dc2626', fontSize: 13 }}>{loadError}</div>

  return (
    <div style={{ padding: '14px 20px', fontFamily: 'system-ui, sans-serif', fontSize: 13 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
        <span style={{ fontSize: 15, fontWeight: 700, color: '#111827' }}>Configuration</span>
        <button onClick={load} style={{
          fontSize: 11, color: '#6b7280', background: 'none',
          border: '1px solid #e5e7eb', borderRadius: 4, padding: '2px 8px', cursor: 'pointer',
        }}>Refresh</button>
      </div>

      <TabBar active={tab} onChange={setTab} />

      {tab === 'community'  && commData  && (
        <CommunityTab rows={commData} showTest={showTestCommunities} onPatchComm={patchComm}
          globalMonths={globalMonths} onSaveGlobal={saveGlobal} />
      )}
      {tab === 'dev'        && devData   && (
        <DevTab rows={devData} showTest={showTestCommunities} onPatchDev={patchDev} />
      )}
      {tab === 'instrument' && phaseData && (
        <InstrumentTab phaseRows={phaseData.rows} showTest={showTestCommunities}
          builders={phaseData.builders ?? []}
          onSaveSpecRate={saveSpecRate} onSaveBuilderSplit={saveBuilderSplit}
          initialFilterComm={configJump?.ent_group_id ? String(configJump.ent_group_id) : null} />
      )}
      {tab === 'phase'      && phaseData && (
        <PhaseTab
          phaseData={phaseData} showTest={showTestCommunities}
          onPatchPhase={patchPhase} onSaveProductSplit={saveProductSplit}
          onToggleLock={toggleLock}
          onLotsAdded={load}
          initialFilterComm={configJump?.ent_group_id ? String(configJump.ent_group_id) : null}
        />
      )}
    </div>
  )
}
