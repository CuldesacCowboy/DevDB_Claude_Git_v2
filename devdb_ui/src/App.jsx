import { useState, useEffect } from 'react'
import { BrowserRouter, Routes, Route, NavLink } from 'react-router-dom'
import LotPhaseView from './pages/LotPhaseView'
import SitePlanView from './pages/SitePlanView'
import SimulationView from './pages/SimulationView'
import ErrorBoundary from './components/ErrorBoundary'

const LS_KEY = 'devdb_active_community'
const LS_TEST_KEY = 'devdb_show_test_communities'

export default function App() {
  const [selectedGroupId, setSelectedGroupId] = useState(() => {
    try {
      const v = localStorage.getItem(LS_KEY) || localStorage.getItem('devdb_siteplan_last_group')
      return v ? Number(v) : null
    } catch { return null }
  })

  const [showTestCommunities, setShowTestCommunities] = useState(() => {
    try { return localStorage.getItem(LS_TEST_KEY) === 'true' } catch { return false }
  })

  useEffect(() => {
    if (selectedGroupId) {
      try { localStorage.setItem(LS_KEY, String(selectedGroupId)) } catch {}
    }
  }, [selectedGroupId])

  useEffect(() => {
    try { localStorage.setItem(LS_TEST_KEY, String(showTestCommunities)) } catch {}
  }, [showTestCommunities])

  return (
    <BrowserRouter>
      <nav style={{
        display: 'flex', alignItems: 'center',
        borderBottom: '1px solid #e5e7eb', paddingLeft: 16,
        background: '#fff', height: 44,
      }}>
        <span style={{ fontWeight: 700, fontSize: 15, color: '#111827', marginRight: 16 }}>
          DevDB
        </span>
        <NavLink to="/" end style={({ isActive }) => ({
          padding: '0 16px', height: '44px',
          display: 'flex', alignItems: 'center',
          fontSize: 13, fontWeight: 500,
          color: isActive ? '#2563eb' : '#6b7280',
          borderBottom: isActive ? '2px solid #2563eb' : '2px solid transparent',
          textDecoration: 'none',
        })}>
          Lot · Phase
        </NavLink>
        <NavLink to="/site-plan" style={({ isActive }) => ({
          padding: '0 16px', height: '44px',
          display: 'flex', alignItems: 'center',
          fontSize: 13, fontWeight: 500,
          color: isActive ? '#2563eb' : '#6b7280',
          borderBottom: isActive ? '2px solid #2563eb' : '2px solid transparent',
          textDecoration: 'none',
        })}>
          Site Plan
        </NavLink>
        <NavLink to="/simulation" style={({ isActive }) => ({
          padding: '0 16px', height: '44px',
          display: 'flex', alignItems: 'center',
          fontSize: 13, fontWeight: 500,
          color: isActive ? '#2563eb' : '#6b7280',
          borderBottom: isActive ? '2px solid #2563eb' : '2px solid transparent',
          textDecoration: 'none',
        })}>
          Simulation
        </NavLink>
      </nav>

      <ErrorBoundary>
        <Routes>
          <Route path="/" element={<LotPhaseView selectedGroupId={selectedGroupId} setSelectedGroupId={setSelectedGroupId} showTestCommunities={showTestCommunities} setShowTestCommunities={setShowTestCommunities} />} />
          <Route path="/site-plan" element={<SitePlanView selectedGroupId={selectedGroupId} setSelectedGroupId={setSelectedGroupId} showTestCommunities={showTestCommunities} />} />
          <Route path="/simulation" element={<SimulationView selectedGroupId={selectedGroupId} setSelectedGroupId={setSelectedGroupId} showTestCommunities={showTestCommunities} />} />
        </Routes>
      </ErrorBoundary>
    </BrowserRouter>
  )
}
