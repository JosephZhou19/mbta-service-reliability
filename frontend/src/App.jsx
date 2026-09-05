import { HashRouter, Routes, Route, NavLink } from 'react-router-dom'
import Overview from './pages/Overview'
import Leaderboard from './pages/Leaderboard'
import LineDetail from './pages/LineDetail'

export default function App() {
  return (
    <HashRouter>
      <div className="app-shell">
        <header className="app-header">
          <span className="app-title">MBTA Service Reliability</span>
          <nav>
            <NavLink to="/" end>Overview</NavLink>
            <NavLink to="/leaderboard">Leaderboard</NavLink>
          </nav>
        </header>
        <main className="app-main">
          <Routes>
            <Route path="/" element={<Overview />} />
            <Route path="/leaderboard" element={<Leaderboard />} />
            <Route path="/line/:line" element={<LineDetail />} />
          </Routes>
        </main>
      </div>
    </HashRouter>
  )
}
