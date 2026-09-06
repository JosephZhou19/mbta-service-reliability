import { HashRouter, Routes, Route, NavLink, Link } from 'react-router-dom'
import Overview from './pages/Overview'
import Leaderboard from './pages/Leaderboard'
import LineDetail from './pages/LineDetail'

export default function App() {
  return (
    <HashRouter>
      <div className="app-shell">
        <header className="app-header">
          <Link to="/" className="app-brand">
            <span className="app-mark">T</span>
            <span className="app-title">MBTA Service Reliability</span>
          </Link>
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
        <footer className="app-footer">
          <span>Independent project, not affiliated with the MBTA. Data from MBTA's public LAMP performance platform.</span>
          <a href="https://github.com/JosephZhou19/mbta-service-reliability" target="_blank" rel="noreferrer">View source on GitHub</a>
        </footer>
      </div>
    </HashRouter>
  )
}
