import { BrowserRouter, Routes, Route, NavLink } from 'react-router-dom'
import LotPhaseView from './pages/LotPhaseView'
import SitePlanView from './pages/SitePlanView'
import SimulationView from './pages/SimulationView'

export default function App() {
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

      <Routes>
        <Route path="/" element={<LotPhaseView />} />
        <Route path="/site-plan" element={<SitePlanView />} />
        <Route path="/simulation" element={<SimulationView />} />
      </Routes>
    </BrowserRouter>
  )
}
