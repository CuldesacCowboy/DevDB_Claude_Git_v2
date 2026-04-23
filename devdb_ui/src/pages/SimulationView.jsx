import { useState, useEffect, useCallback, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { API_BASE } from '../config'
import { useOverrides } from '../hooks/useOverrides'
import OverridesPanel from '../components/overrides/OverridesPanel'
import SyncReconciliationModal from '../components/overrides/SyncReconciliationModal'
import { LedgerTable } from '../components/simulation/LedgerTable'
import { LedgerGraph } from '../components/simulation/LedgerGraph'
import { UtilizationPanel } from '../components/simulation/UtilizationPanel'
import { DeliveryScheduleTab } from '../components/simulation/DeliveryScheduleTab'
import { RulesValidatorTab } from '../components/simulation/RulesValidatorTab'
import { LotLedger } from '../components/simulation/LotLedger'
import {
  LedgerConfigSection, GlobalSettingsSection,
  DeliveryConfigSection, StartsTargetsSection, LocationSection,
} from '../components/simulation/SimSettings'
import { buildLedgerRows, fmt } from '../components/simulation/simShared'

// Fetch helper — throws on non-2xx so .catch() blocks see real API errors.
async function fetchOk(url) {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`${res.status} from ${url}`)
  return res.json()
}

// ─── Main view ───────────────────────────────────────────────────────────────

export default function SimulationView({ selectedGroupId, setSelectedGroupId, showTestCommunities, globalSettingsOpen, onCloseGlobalSettings }) {
  const navigate = useNavigate()
  const entGroupId = selectedGroupId
  const setEntGroupId = setSelectedGroupId
  const [entGroups, setEntGroups]   = useState([])
  const [runStatus, setRunStatus]   = useState(null)
  const [runErrors, setRunErrors]   = useState([])
  const [tdaGaps, setTdaGaps]       = useState([])
  const [byDev, setByDev]           = useState([])
  const [utilization, setUtilization] = useState([])
  const [loading, setLoading]       = useState(false)
  const [missingSplits, setMissingSplits] = useState([])
  const [staleParams, setStaleParams]     = useState([])
  const [deliveryConfig, setDeliveryConfig]   = useState(null)
  const [ledgerConfig, setLedgerConfig]       = useState(null)
  const [globalSettings, setGlobalSettings]   = useState(null)
  const [view, setView]             = useState('ledger')
  const [ledgerSubView, setLedgerSubView] = useState('graph')   // 'table' | 'graph'
  const [lots, setLots]             = useState([])
  const [lotsLoading, setLotsLoading] = useState(false)
  const [showReconModal, setShowReconModal] = useState(false)

  const {
    overrides, loading: ovLoading,
    reconciliation,
    fetchOverrides, applyOverrides, clearOverride, clearBatch,
    fetchReconciliation, exportOverrides,
  } = useOverrides(entGroupId)
  const [deliverySchedule, setDeliverySchedule]               = useState([])
  const [deliveryScheduleLoading, setDeliveryScheduleLoading] = useState(false)
  const [deliveryDirty, setDeliveryDirty]                     = useState(false)
  const [rulesValidation, setRulesValidation]                 = useState([])
  const [rulesLoading, setRulesLoading]                       = useState(false)
  const [modalOpen, setModalOpen]           = useState(false)
  const [selectedDevIds, setSelectedDevIds] = useState(null)
  const [countyFilter, setCountyFilter]     = useState(null)
  const [sdFilter, setSdFilter]             = useState(null)
  const [period, setPeriod]                 = useState('monthly')
  const [weeklyByDev, setWeeklyByDev]       = useState([])
  const [weeklyLoading, setWeeklyLoading]   = useState(false)
  const [loadError, setLoadError]           = useState(null)
  const [lastRunAt, setLastRunAt]           = useState(null)

  const countyOptions = useMemo(() => [...new Map(
    byDev.filter(r => r.community_county_id).map(r => [r.community_county_id, r.community_county_name])
  ).entries()].map(([id, name]) => ({ id, name })), [byDev])

  const sdOptions = useMemo(() => [...new Map(
    byDev.filter(r => r.community_sd_id).map(r => [r.community_sd_id, r.community_sd_name])
  ).entries()].map(([id, name]) => ({ id, name })), [byDev])

  const filteredByDev = useMemo(() => byDev.filter(r =>
    (!countyFilter || r.community_county_id === countyFilter) &&
    (!sdFilter     || r.community_sd_id     === sdFilter)
  ), [byDev, countyFilter, sdFilter])

  const devList = useMemo(
    () => [...new Map(filteredByDev.map(r => [r.dev_id, r.dev_name])).entries()].map(([id, name]) => ({ id, name })),
    [filteredByDev],
  )

const loadLedger = useCallback((id) => {
    setLoading(true)
    setLoadError(null)
    setWeeklyByDev([])   // invalidate weekly cache when ledger reloads
    Promise.all([
      fetchOk(`${API_BASE}/ledger/${id}/by-dev`),
      fetchOk(`${API_BASE}/ledger/${id}/utilization`),
    ])
      .then(([devRows, utilRows]) => {
        setByDev(Array.isArray(devRows) ? devRows : [])
        setUtilization(Array.isArray(utilRows) ? utilRows : [])
      })
      .catch((err) => { setByDev([]); setUtilization([]); setLoadError(`Could not load ledger data — ${err.message}`) })
      .finally(() => setLoading(false))
  }, [])

  const loadWeekly = useCallback((id) => {
    setWeeklyLoading(true)
    fetchOk(`${API_BASE}/ledger/${id}/weekly`)
      .then(rows => setWeeklyByDev(Array.isArray(rows) ? rows : []))
      .catch(() => setWeeklyByDev([]))
      .finally(() => setWeeklyLoading(false))
  }, [])

  const loadConfig = useCallback((id) => {
    Promise.all([
      fetchOk(`${API_BASE}/entitlement-groups/${id}/delivery-config`),
      fetchOk(`${API_BASE}/entitlement-groups/${id}/ledger-config`),
    ])
      .then(([dc, lc]) => { setDeliveryConfig(dc); setLedgerConfig(lc) })
      .catch(() => {})
  }, [])

  const loadGlobalSettings = useCallback(() => {
    fetchOk(`${API_BASE}/global-settings`)
      .then(data => setGlobalSettings(data))
      .catch(() => {})
  }, [])

  const checkSplits = useCallback((id) => {
    Promise.all([
      fetchOk(`${API_BASE}/entitlement-groups/${id}/split-check`),
      fetchOk(`${API_BASE}/entitlement-groups/${id}/param-check`),
    ])
      .then(([splits, params]) => {
        setMissingSplits(Array.isArray(splits) ? splits : [])
        setStaleParams(Array.isArray(params) ? params : [])
      })
      .catch(() => { setMissingSplits([]); setStaleParams([]) }) // advisory — warnings only
  }, [])

  const loadLots = useCallback((id) => {
    setLotsLoading(true)
    fetchOk(`${API_BASE}/ledger/${id}/lots`)
      .then(data => setLots(Array.isArray(data) ? data : []))
      .catch((err) => { setLots([]); setLoadError(`Could not load lot ledger — ${err.message}`) })
      .finally(() => setLotsLoading(false))
  }, [])

  const loadRulesValidation = useCallback((id) => {
    setRulesLoading(true)
    fetchOk(`${API_BASE}/ledger/${id}/rules-validation`)
      .then(data => setRulesValidation(Array.isArray(data) ? data : []))
      .catch(() => setRulesValidation([]))
      .finally(() => setRulesLoading(false))
  }, [])

  const loadDeliverySchedule = useCallback((id) => {
    setDeliveryScheduleLoading(true)
    fetchOk(`${API_BASE}/ledger/${id}/delivery-schedule`)
      .then(data => setDeliverySchedule(Array.isArray(data) ? data : []))
      .catch((err) => { setDeliverySchedule([]); setLoadError(`Could not load delivery schedule — ${err.message}`) })
      .finally(() => setDeliveryScheduleLoading(false))
  }, [])

  useEffect(() => {
    fetch(`${API_BASE}/entitlement-groups`).then(r => r.json())
      .then(data => { setEntGroups(data); if (data.length && !selectedGroupId) { const first = data.find(g => showTestCommunities ? g.is_test : !g.is_test) ?? data[0]; setEntGroupId(first.ent_group_id) } })
      .catch(() => {})
  }, [])

  useEffect(() => {
    if (!entGroupId) return
    setLoadError(null)
    checkSplits(entGroupId)
    loadLedger(entGroupId)
    loadConfig(entGroupId)
    loadGlobalSettings()
    fetchOverrides()
    loadDeliverySchedule(entGroupId)
    loadRulesValidation(entGroupId)
    loadLots(entGroupId)
    setRunErrors([])
    setTdaGaps([])
    setSelectedDevIds(null)
    setCountyFilter(null)
    setSdFilter(null)
  }, [entGroupId, checkSplits, loadLedger, loadConfig, fetchOverrides, loadDeliverySchedule])

  async function handleRun() {
    if (!entGroupId) return
    setRunStatus('running')
    try {
      const res = await fetch(`${API_BASE}/simulations/run`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ent_group_id: entGroupId }),
      })
      if (!res.ok) {
        const raw = await res.text()
        let msg = raw
        try { const j = JSON.parse(raw); msg = j.detail ?? raw } catch {}
        setRunStatus({ ok: false, error: msg })
        setLastRunAt(new Date())
        return
      }
      const data = await res.json()
      setRunStatus({ ok: true, iterations: data.iterations, elapsed_ms: data.elapsed_ms })
      setRunErrors(data.errors || [])
      setTdaGaps(data.tda_gaps || [])
      setLastRunAt(new Date())
      setLoadError(null)
      setDeliveryDirty(false)
      loadLedger(entGroupId)
      loadLots(entGroupId)
      loadDeliverySchedule(entGroupId)
      loadRulesValidation(entGroupId)
      checkSplits(entGroupId)
    } catch (e) { setRunStatus({ ok: false, error: e.message }); setLastRunAt(new Date()) }
  }

  // Fetch real weekly data on demand (lazy — only when W is selected).
  useEffect(() => {
    if (period === 'weekly' && entGroupId && weeklyByDev.length === 0 && !weeklyLoading) {
      loadWeekly(entGroupId)
    }
  }, [period, entGroupId, weeklyByDev.length, weeklyLoading, loadWeekly])

  const filteredWeekly = useMemo(() => {
    if (!weeklyByDev.length) return []
    return weeklyByDev.filter(r =>
      (!countyFilter || r.community_county_id === countyFilter) &&
      (!sdFilter     || r.community_sd_id     === sdFilter)
    )
  }, [weeklyByDev, countyFilter, sdFilter])

  const ledgerRows = useMemo(() => {
    if (period === 'weekly') {
      return buildLedgerRows(filteredWeekly, selectedDevIds, 'weekly', ledgerConfig?.date_paper ?? null, utilization)
    }
    return buildLedgerRows(filteredByDev, selectedDevIds, period, ledgerConfig?.date_paper ?? null, utilization)
  }, [filteredByDev, filteredWeekly, selectedDevIds, period, ledgerConfig, utilization])

  const filteredUtilization = useMemo(() => {
    if (selectedDevIds === null) return utilization
    return utilization.filter(p => selectedDevIds.includes(p.dev_id))
  }, [utilization, selectedDevIds])

  const hasData = byDev.length > 0

  const isRunning = runStatus === 'running'

  // Pre-run validation warnings shown near Run button (non-blocking advisory).
  const runWarnings = useMemo(() => {
    const w = []
    if (ledgerConfig !== null && !ledgerConfig.date_paper)
      w.push('Plan start date is not set — ledger will not render (Settings → Plan Start Date)')
    const missingDevs = staleParams.filter(p => p.status === 'missing')
    if (missingDevs.length > 0)
      w.push(`${missingDevs.length} development${missingDevs.length !== 1 ? 's' : ''} have no starts target configured`)
    return w
  }, [ledgerConfig, staleParams])

  function toggleDev(devId) {
    if (selectedDevIds === null) {
      setSelectedDevIds([devId])
    } else if (selectedDevIds.includes(devId)) {
      const next = selectedDevIds.filter(d => d !== devId)
      setSelectedDevIds(next.length === 0 || next.length === devList.length ? null : next)
    } else {
      const next = [...selectedDevIds, devId]
      setSelectedDevIds(next.length === devList.length ? null : next)
    }
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: 'calc(100vh - 45px)', overflow: 'hidden', fontFamily: 'system-ui, sans-serif', fontSize: 13 }}>

      {/* ── Locked header ── */}
      <div style={{ flexShrink: 0, padding: '16px 24px 0', maxWidth: 1300, boxSizing: 'border-box', background: '#fff' }}>

      {/* ── Top bar ── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16, flexWrap: 'wrap' }}>
        <select value={entGroupId ?? ''}
          onChange={e => { setEntGroupId(Number(e.target.value)); setRunStatus(null) }}
          style={{ fontSize: 13, padding: '4px 8px', borderRadius: 4, border: '1px solid #d1d5db' }}>
          {entGroups.filter(g => showTestCommunities ? g.is_test : !g.is_test).map(g => (
            <option key={g.ent_group_id} value={g.ent_group_id}>
              {g.ent_group_name ?? `Group ${g.ent_group_id}`}{g.status ? ` [${g.status}]` : ''}
            </option>
          ))}
        </select>

        <button onClick={() => setModalOpen(true)}
          title="Community settings"
          style={{ fontSize: 15, lineHeight: 1, padding: '4px 10px', borderRadius: 4,
                   border: '1px solid #d1d5db', background: '#fff',
                   color: '#6b7280', cursor: 'pointer' }}>
          ⚙
        </button>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <button onClick={handleRun} disabled={!entGroupId || isRunning}
            style={{ padding: '5px 16px', borderRadius: 4, fontSize: 13, fontWeight: 600,
                     background: isRunning ? '#93c5fd' : '#2563eb',
                     color: '#fff', border: 'none', cursor: isRunning ? 'default' : 'pointer',
                     display: 'flex', alignItems: 'center', gap: 8 }}>
            {isRunning && (
              <span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: '50%',
                             border: '2px solid rgba(255,255,255,0.5)', borderTopColor: '#fff',
                             animation: 'spin 0.8s linear infinite' }} />
            )}
            {isRunning ? 'Running…' : 'Run Simulation'}
          </button>
          {runWarnings.length > 0 && !isRunning && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              {runWarnings.map((w, i) => (
                <span key={i} style={{ fontSize: 11, color: '#b45309', display: 'flex', alignItems: 'center', gap: 4 }}>
                  ⚠ {w}
                </span>
              ))}
            </div>
          )}
        </div>

        {/* Run result card */}
        {runStatus && !isRunning && (
          <div style={{
            display: 'flex', alignItems: 'center', gap: 8,
            padding: '5px 12px', borderRadius: 6, fontSize: 12,
            background: runStatus.ok ? '#f0fdf4' : '#fef2f2',
            border: `1px solid ${runStatus.ok ? '#bbf7d0' : '#fecaca'}`,
          }}>
            <span style={{ fontWeight: 600, color: runStatus.ok ? '#15803d' : '#dc2626' }}>
              {runStatus.ok ? '✓ Run complete' : '✕ Run failed'}
            </span>
            {runStatus.ok && (
              <span style={{ color: '#6b7280' }}>
                {runStatus.iterations} iteration{runStatus.iterations !== 1 ? 's' : ''} · {runStatus.elapsed_ms}ms
              </span>
            )}
            {!runStatus.ok && (
              <span style={{ color: '#dc2626', fontSize: 11 }}>see details below</span>
            )}
            {lastRunAt && (
              <span style={{ color: '#9ca3af', fontSize: 11 }}>
                {lastRunAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </span>
            )}
            <button onClick={() => setRunStatus(null)}
              style={{ marginLeft: 4, background: 'none', border: 'none', cursor: 'pointer',
                       color: '#9ca3af', fontSize: 14, lineHeight: 1, padding: '0 2px' }}>
              ×
            </button>
          </div>
        )}

      </div>
      {/* ── Run error panel ── */}
      {runStatus?.ok === false && runStatus.error && (
        <div style={{
          margin: '0 0 8px', padding: '10px 14px',
          background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 6,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
            <span style={{ fontWeight: 600, fontSize: 12, color: '#dc2626' }}>Run error</span>
            <button
              onClick={() => navigator.clipboard.writeText(runStatus.error)}
              style={{ fontSize: 11, padding: '1px 8px', borderRadius: 4,
                       border: '1px solid #fca5a5', background: '#fff',
                       color: '#dc2626', cursor: 'pointer' }}>
              Copy
            </button>
            <span style={{ flex: 1 }} />
            <button onClick={() => setRunStatus(null)}
              style={{ background: 'none', border: 'none', cursor: 'pointer',
                       color: '#9ca3af', fontSize: 14, lineHeight: 1, padding: '0 2px' }}>
              ×
            </button>
          </div>
          <pre style={{
            margin: 0, fontSize: 11, color: '#7f1d1d',
            fontFamily: 'monospace', whiteSpace: 'pre-wrap', wordBreak: 'break-word',
            maxHeight: 300, overflowY: 'auto',
            background: '#fff5f5', borderRadius: 4, padding: '8px 10px',
            border: '1px solid #fecaca',
          }}>{runStatus.error}</pre>
        </div>
      )}

      {/* ── Data load error banner ── */}
      {loadError && (
        <div style={{
          marginBottom: 12, padding: '8px 14px',
          background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 6,
          display: 'flex', alignItems: 'center', gap: 10,
        }}>
          <span style={{ fontSize: 12, color: '#dc2626', flex: 1 }}>{loadError}</span>
          <button
            onClick={() => setLoadError(null)}
            style={{ fontSize: 11, padding: '2px 8px', borderRadius: 4, border: '1px solid #fca5a5',
                     background: 'transparent', color: '#dc2626', cursor: 'pointer' }}
          >
            Dismiss
          </button>
        </div>
      )}

      {/* ── Starts targets — read-only summary ── */}
      {staleParams.length > 0 && (
        <div style={{ marginBottom: 12, display: 'flex', flexWrap: 'wrap', gap: '4px 16px', alignItems: 'center' }}>
          {staleParams.map(p => {
            const dotColor = { ok: '#16a34a', stale: '#d97706', missing: '#dc2626' }[p.status] ?? '#9ca3af'
            const target = p.annual_starts_target != null ? `${p.annual_starts_target}/yr` : '—'
            const cap    = p.max_starts_per_month  != null ? ` · ${p.max_starts_per_month}/mo` : ''
            return (
              <span key={p.dev_id} style={{ fontSize: 11, color: '#6b7280', display: 'flex', alignItems: 'center', gap: 4 }}>
                <span style={{ width: 6, height: 6, borderRadius: '50%', background: dotColor, display: 'inline-block', flexShrink: 0 }} />
                {p.dev_name} <span style={{ color: '#374151' }}>{target}{cap}</span>
              </span>
            )
          })}
          <button onClick={() => setModalOpen(true)} style={{
            fontSize: 11, color: '#2563eb', background: 'none', border: 'none',
            cursor: 'pointer', padding: 0,
          }}>edit</button>
        </div>
      )}

      {/* ── Run errors ── */}
      {runErrors.length > 0 && (
        <div style={{ marginBottom: 12, padding: '8px 14px', background: '#fef3c7',
                      border: '1px solid #f59e0b', borderRadius: 6, fontSize: 12 }}>
          <div style={{ fontWeight: 600, color: '#92400e', marginBottom: 4 }}>Simulation ran with warnings:</div>
          <ul style={{ margin: 0, paddingLeft: 18, color: '#78350f', lineHeight: 1.7 }}>
            {runErrors.map((e, i) => <li key={i}>{e}</li>)}
          </ul>
        </div>
      )}

      {/* ── TDA checkpoint gaps ── */}
      {tdaGaps.length > 0 && (
        <div style={{ marginBottom: 12, padding: '8px 14px', background: '#fef2f2',
                      border: '1px solid #fca5a5', borderRadius: 6, fontSize: 12 }}>
          <div style={{ fontWeight: 600, color: '#991b1b', marginBottom: 4 }}>
            {tdaGaps.length} TDA checkpoint{tdaGaps.length !== 1 ? 's' : ''} at risk after simulation:
          </div>
          <ul style={{ margin: 0, paddingLeft: 18, color: '#7f1d1d', lineHeight: 1.8 }}>
            {tdaGaps.map((g, i) => (
              <li key={i}>
                <b>{g.tda_name}</b> CP{g.checkpoint_number} ({g.checkpoint_date})
                {' — '}
                {g.projected}/{g.required} lots projected
                <span style={{ marginLeft: 6, background: '#fee2e2', color: '#991b1b',
                               borderRadius: 10, padding: '0 6px', fontWeight: 700, fontSize: 11 }}>
                  gap {g.gap}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* ── Missing splits ── */}
      {missingSplits.length > 0 && (
        <div style={{ marginBottom: 12, padding: '8px 14px', background: '#fffbeb',
                      border: '1px solid #fbbf24', borderRadius: 6, fontSize: 12 }}>
          <div style={{ fontWeight: 600, color: '#92400e', marginBottom: 3 }}>
            {missingSplits.length} phase{missingSplits.length !== 1 ? 's' : ''} have no product splits (D-100):
          </div>
          <ul style={{ margin: 0, paddingLeft: 18, color: '#78350f', lineHeight: 1.7 }}>
            {missingSplits.map(p => <li key={p.phase_id}><b>{p.phase_name}</b> — {p.instrument_name}</li>)}
          </ul>
        </div>
      )}

      {/* ── View tabs ── */}
      <div style={{ display: 'flex', gap: 2, marginBottom: 12, alignItems: 'center' }}>
        {[
          ['ledger',      'Ledger'],
          ['lots',        'Lot List'],
          ['delivery',    'Delivery Schedule'],
          ['rules',       'Rules Validator'],
          ['utilization', 'Phase Utilization'],
          ['overrides',   null],
        ].map(([v, label]) => {
          const isOverrides = v === 'overrides'
          const count = overrides.length
          return (
            <button key={v} onClick={() => {
              setView(v)
              if (v === 'lots'     && entGroupId) loadLots(entGroupId)
              if (v === 'delivery' && entGroupId) loadDeliverySchedule(entGroupId)
              if (v === 'rules'    && entGroupId) loadRulesValidation(entGroupId)
              if (v === 'overrides' && entGroupId) fetchOverrides()
            }}
              style={{ padding: '4px 14px', fontSize: 12, borderRadius: 4, border: '1px solid #d1d5db',
                       cursor: 'pointer',
                       background: view === v ? (isOverrides ? '#92400e' : '#1e40af') : '#f9fafb',
                       color: view === v ? '#fff' : (isOverrides && count > 0 ? '#92400e' : '#374151'),
                       fontWeight: view === v ? 600 : (isOverrides && count > 0 ? 600 : 400) }}>
              {isOverrides
                ? <>Plan{count > 0 && <span style={{ marginLeft: 5, background: view === v ? 'rgba(255,255,255,0.3)' : '#fef3c7', color: view === v ? '#fff' : '#92400e', borderRadius: 10, fontSize: 10, padding: '0 5px', fontWeight: 700 }}>{count}</span>}</>
                : label}
            </button>
          )
        })}
      </div>

      </div>{/* end locked header */}

      {/* ── Tab content ── */}
      <div style={{ flex: 1, overflow: 'hidden', padding: '0 24px', maxWidth: 1300, boxSizing: 'border-box' }}>

      {/* ── Ledger ── */}
      {view === 'ledger' && (
        <div style={{ height: '100%', overflowY: 'auto' }}>
        <>
          {loading && <div style={{ color: '#6b7280', fontSize: 12 }}>Loading…</div>}
          {!loading && !hasData && (
            <div style={{ color: '#9ca3af', fontSize: 12 }}>No ledger data. Run a simulation to populate results.</div>
          )}
          {!loading && hasData && (
            <>
              {/* Controls row */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 10, flexWrap: 'wrap' }}>

                {/* County + SD filters */}
                {countyOptions.length > 1 && (
                  <select value={countyFilter ?? ''}
                    onChange={e => { setCountyFilter(e.target.value ? Number(e.target.value) : null); setSdFilter(null) }}
                    style={{ fontSize: 11, padding: '3px 6px', borderRadius: 4,
                             border: countyFilter ? '1px solid #2563eb' : '1px solid #d1d5db',
                             background: countyFilter ? '#eff6ff' : '#fff',
                             color: countyFilter ? '#1d4ed8' : '#374151' }}>
                    <option value="">All counties</option>
                    {countyOptions.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                )}
                {sdOptions.length > 1 && (
                  <select value={sdFilter ?? ''}
                    onChange={e => setSdFilter(e.target.value ? Number(e.target.value) : null)}
                    style={{ fontSize: 11, padding: '3px 6px', borderRadius: 4,
                             border: sdFilter ? '1px solid #2563eb' : '1px solid #d1d5db',
                             background: sdFilter ? '#eff6ff' : '#fff',
                             color: sdFilter ? '#1d4ed8' : '#374151' }}>
                    <option value="">All school districts</option>
                    {sdOptions.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                )}

                {/* Dev filter pills */}
                <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                  <span style={{ fontSize: 11, color: '#9ca3af', marginRight: 2 }}>Dev</span>
                  <button onClick={() => setSelectedDevIds(null)}
                    style={{ padding: '3px 10px', fontSize: 11, borderRadius: 12, border: '1px solid',
                             borderColor: selectedDevIds === null ? '#1e40af' : '#d1d5db',
                             background: selectedDevIds === null ? '#dbeafe' : '#fff',
                             color: selectedDevIds === null ? '#1e40af' : '#374151',
                             cursor: 'pointer', fontWeight: selectedDevIds === null ? 600 : 400 }}>All</button>
                  {devList.map(({ id, name }) => {
                    const active = selectedDevIds !== null && selectedDevIds.includes(id)
                    return (
                      <button key={id} onClick={() => toggleDev(id)}
                        style={{ padding: '3px 10px', fontSize: 11, borderRadius: 12, border: '1px solid',
                                 borderColor: active ? '#1e40af' : '#d1d5db',
                                 background: active ? '#dbeafe' : '#fff',
                                 color: active ? '#1e40af' : '#374151',
                                 cursor: 'pointer', fontWeight: active ? 600 : 400 }}>
                        {name}
                      </button>
                    )
                  })}
                </div>

                {/* Period toggle */}
                <div style={{ display: 'flex', gap: 2 }}>
                  {[['weekly','W'],['monthly','M'],['quarterly','Q'],['annual','Y']].map(([v, label]) => (
                    <button key={v} onClick={() => setPeriod(v)}
                      style={{ padding: '3px 10px', fontSize: 11, borderRadius: 4, border: '1px solid #d1d5db',
                               cursor: 'pointer', background: period === v ? '#1e40af' : '#f9fafb',
                               color: period === v ? '#fff' : '#374151', fontWeight: period === v ? 600 : 400 }}>
                      {label}
                    </button>
                  ))}
                </div>

                {/* Ledger / Graph sub-toggle */}
                <div style={{ display: 'flex', gap: 0, borderRadius: 4, overflow: 'hidden',
                              border: '1px solid #d1d5db', flexShrink: 0 }}>
                  {[['graph','Chart'],['table','Table']].map(([v, label]) => (
                    <button key={v} onClick={() => setLedgerSubView(v)}
                      style={{ padding: '3px 12px', fontSize: 11, border: 'none', cursor: 'pointer',
                               background: ledgerSubView === v ? '#1e40af' : '#f9fafb',
                               color: ledgerSubView === v ? '#fff' : '#374151',
                               fontWeight: ledgerSubView === v ? 600 : 400 }}>
                      {label}
                    </button>
                  ))}
                </div>

                <span style={{ fontSize: 11, color: '#9ca3af', marginLeft: 'auto', fontStyle: 'italic' }}>
                  {period === 'weekly' && weeklyLoading ? 'Loading weekly…' : `${ledgerRows.length} ${period === 'weekly' ? 'weeks' : period === 'monthly' ? 'months' : period === 'quarterly' ? 'quarters' : 'years'}`}
                  {selectedDevIds !== null && ` · ${selectedDevIds.length} dev${selectedDevIds.length !== 1 ? 's' : ''}`}
                </span>
                {ledgerConfig !== null && (
                  ledgerConfig.date_paper
                    ? <span style={{ fontSize: 11, color: '#9ca3af' }}>
                        From {fmt(ledgerConfig.date_paper)}
                        <button onClick={() => setModalOpen(true)}
                          style={{ marginLeft: 5, fontSize: 11, color: '#2563eb', background: 'none',
                                   border: 'none', cursor: 'pointer', padding: 0 }}>
                          edit
                        </button>
                      </span>
                    : <button onClick={() => setModalOpen(true)}
                        style={{ fontSize: 11, color: '#dc2626', background: 'none',
                                 border: 'none', cursor: 'pointer', padding: 0 }}>
                        Set start date ↗
                      </button>
                )}
              </div>

              {ledgerSubView === 'table'
                ? <LedgerTable rows={ledgerRows} floors={deliveryConfig} period={period} lots={lots} deliverySchedule={deliverySchedule} />
                : <LedgerGraph rows={ledgerRows} period={period} deliverySchedule={deliverySchedule} selectedDevIds={selectedDevIds} />
              }
            </>
          )}
        </>
        </div>
      )}

      {/* ── Lot List ── */}
      {view === 'lots' && (
        <LotLedger
          lots={lots}
          loading={lotsLoading}
          communityName={entGroups.find(g => g.ent_group_id === entGroupId)?.ent_group_name ?? ''}
          onApplyOverride={async (lotId, changes) => {
            await applyOverrides(lotId, changes)
            loadLots(entGroupId)
          }}
          onClearOverride={async (lotId, dateField) => {
            await clearOverride(lotId, dateField)
            loadLots(entGroupId)
          }}
          onRefreshLots={() => loadLots(entGroupId)}
        />
      )}

      {/* ── Plan / Overrides ── */}
      {view === 'overrides' && (
        <div style={{ height: '100%', overflowY: 'auto' }}>
        <OverridesPanel
          overrides={overrides}
          loading={ovLoading}
          onClear={(lotId, dateField) => clearOverride(lotId, dateField)}
          onClearAll={() => {
            const lotIds = [...new Set(overrides.map(o => o.lot_id))]
            clearBatch({ lotIds })
          }}
          onExport={async () => {
            const rows = await exportOverrides()
            if (!rows.length) { alert('No overrides to export.'); return }
            const headers = ['Lot','Dev','Phase','Field','Activity','MARKS Current','Override','Delta Days','Note']
            const csv = [
              headers.join(','),
              ...rows.map(r => [
                r.lot_number, r.dev_name, r.phase_name, r.label, r.marks_activity,
                r.current_marks ?? '', r.override_value, r.delta_days ?? '', r.override_note ?? '',
              ].map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')),
            ].join('\n')
            const blob = new Blob([csv], { type: 'text/csv' })
            const url = URL.createObjectURL(blob)
            const a = document.createElement('a'); a.href = url; a.download = 'itk_changes.csv'; a.click()
            URL.revokeObjectURL(url)
          }}
          onCheckReconciliation={async () => {
            await fetchReconciliation()
            setShowReconModal(true)
          }}
        />
        </div>
      )}

      {/* ── Delivery Schedule ── */}
      {view === 'delivery' && (
        <div style={{ height: '100%', overflowY: 'auto' }}>
          <DeliveryScheduleTab
            rows={deliverySchedule}
            loading={deliveryScheduleLoading}
            dirty={deliveryDirty}
            onPatchPhase={async (phaseId, field, value) => {
              const res = await fetch(`${API_BASE}/admin/phase/${phaseId}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ [field]: value }),
              })
              if (!res.ok) return
              const updated = await res.json()
              setDeliverySchedule(prev => prev.map(r =>
                r.phase_id === phaseId ? { ...r, ...updated } : r
              ))
              setDeliveryDirty(true)
            }}
          />
        </div>
      )}

      {/* ── Rules Validator ── */}
      {view === 'rules' && (
        <div style={{ height: '100%', overflowY: 'auto' }}>
          <RulesValidatorTab rules={rulesValidation} loading={rulesLoading}
            onNavigate={target => {
              if (target.to === 'delivery') { setView('delivery'); loadDeliverySchedule(entGroupId) }
              else if (target.to === 'config') {
                localStorage.setItem('devdb_config_jump', JSON.stringify({
                  tab: target.tab || 'community', ent_group_id: entGroupId,
                }))
                navigate('/configure')
              }
              else if (target.to === 'setup') { navigate('/setup') }
            }}
          />
        </div>
      )}

      {/* ── Phase Utilization ── */}
      {view === 'utilization' && (
        <div style={{ height: '100%', overflowY: 'auto' }}>
          {loading && <div style={{ color: '#6b7280', fontSize: 12 }}>Loading…</div>}
          {!loading && <UtilizationPanel phases={filteredUtilization} />}
        </div>
      )}

      {/* ── Sync reconciliation modal ── */}
      {showReconModal && reconciliation.length > 0 && (
        <SyncReconciliationModal
          rows={reconciliation}
          onClearSelected={async (ids) => {
            await clearBatch({ overrideIds: ids })
            setShowReconModal(false)
          }}
          onDismiss={() => setShowReconModal(false)}
        />
      )}

      {/* ── Global settings modal (triggered from nav) ── */}
      {globalSettingsOpen && (
        <div onClick={onCloseGlobalSettings} style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.25)',
          zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <div onClick={e => e.stopPropagation()} style={{
            background: '#fff', borderRadius: 8, padding: 24,
            width: 580, maxHeight: '85vh', overflowY: 'auto',
            boxShadow: '0 8px 32px rgba(0,0,0,0.18)',
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
              <span style={{ fontWeight: 700, fontSize: 15, color: '#111827' }}>Global Settings</span>
              <button onClick={onCloseGlobalSettings} style={{
                fontSize: 18, lineHeight: 1, background: 'none', border: 'none',
                cursor: 'pointer', color: '#9ca3af', padding: '0 4px',
              }}>×</button>
            </div>
            <GlobalSettingsSection
              globalSettings={globalSettings}
              onSaved={loadGlobalSettings}
              disabled={isRunning}
            />
          </div>
        </div>
      )}

      {/* ── Community settings modal ── */}
      {modalOpen && (
        <div onClick={() => setModalOpen(false)} style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.25)',
          zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <div onClick={e => e.stopPropagation()} style={{
            background: '#fff', borderRadius: 8, padding: 24,
            width: 580, maxHeight: '85vh', overflowY: 'auto',
            boxShadow: '0 8px 32px rgba(0,0,0,0.18)',
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
              <span style={{ fontWeight: 700, fontSize: 15, color: '#111827' }}>Community Settings</span>
              <button onClick={() => setModalOpen(false)} style={{
                fontSize: 18, lineHeight: 1, background: 'none', border: 'none',
                cursor: 'pointer', color: '#9ca3af', padding: '0 4px',
              }}>×</button>
            </div>

            {ledgerConfig !== null && (
              <div style={{ marginBottom: 20, paddingBottom: 20, borderBottom: '1px solid #e5e7eb' }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: '#374151', marginBottom: 10 }}>Ledger dates</div>
                <LedgerConfigSection
                  entGroupId={entGroupId}
                  datePaper={ledgerConfig.date_paper}
                  dateEnt={ledgerConfig.date_ent}
                  earliestDeliveryDate={ledgerConfig.earliest_delivery_date ?? null}
                  totalLots={ledgerConfig.total_lots ?? 0}
                  onSaved={() => { loadConfig(entGroupId); loadLedger(entGroupId) }}
                  disabled={isRunning}
                />
              </div>
            )}

            {deliveryConfig !== null && (
              <div style={{ marginBottom: 20, paddingBottom: 20, borderBottom: '1px solid #e5e7eb' }}>
                <DeliveryConfigSection
                  entGroupId={entGroupId}
                  deliveryConfig={deliveryConfig}
                  globalSettings={globalSettings}
                  onSaved={() => loadConfig(entGroupId)}
                  disabled={isRunning}
                />
              </div>
            )}

            {entGroupId && (
              <div style={{ marginBottom: 20, paddingBottom: 20, borderBottom: '1px solid #e5e7eb' }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: '#374151', marginBottom: 10 }}>Location</div>
                <LocationSection
                  entGroupId={entGroupId}
                  onSaved={() => loadLedger(entGroupId)}
                  disabled={isRunning}
                />
              </div>
            )}

            <div>
              <div style={{ fontSize: 12, fontWeight: 600, color: '#374151', marginBottom: 10 }}>Annual starts pace</div>
              <StartsTargetsSection
                entGroupId={entGroupId}
                params={staleParams}
                onSaved={() => checkSplits(entGroupId)}
                disabled={isRunning}
              />
            </div>
          </div>
        </div>
      )}

      </div>{/* end tab content */}
    </div>
  )
}
