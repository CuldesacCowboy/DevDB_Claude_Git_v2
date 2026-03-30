import { BrowserRouter, Routes, Route, NavLink } from 'react-router-dom'
import LotPhaseView from './pages/LotPhaseView'
import TakedownAgreementsView from './pages/TakedownAgreementsView'

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
        {[
          { to: '/', label: 'Lot · Phase' },
          { to: '/takedown-agreements', label: 'Takedown Agreements' },
        ].map(({ to, label }) => (
          <NavLink key={to} to={to} end={to === '/'} style={({ isActive }) => ({
            padding: '0 16px', height: '44px',
            display: 'flex', alignItems: 'center',
            fontSize: 13, fontWeight: 500,
            color: isActive ? '#2563eb' : '#6b7280',
            borderBottom: isActive ? '2px solid #2563eb' : '2px solid transparent',
            textDecoration: 'none',
          })}>
            {label}
          </NavLink>
        ))}
      </nav>

      <Routes>
        <Route path="/" element={<LotPhaseView />} />
        <Route path="/takedown-agreements" element={<TakedownAgreementsView />} />
      </Routes>
    </BrowserRouter>
  )
}
