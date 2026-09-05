import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { fetchOverview } from '../lib/data'
import { secToMin, durationMin, pct } from '../lib/format'
import { lineColor } from '../lib/lines'
import LineBadge from '../components/LineBadge'
import Sparkline from '../components/Sparkline'

// Sorts by underlying delay in seconds, not the displayed trip time -- a naturally
// long line shouldn't rank "worse" just for being long. trendKey is null for
// availability since overview.json only has a single trailing value for it, not a
// daily series to sparkline.
const COLUMNS = [
  { key: 'availability_pct_last_year', label: 'Availability (12mo)', sortDir: 'asc', trendKey: null, display: (l) => pct(l.availability_pct_last_year) },
  { key: 'delay_p90_sec', label: '90th pct. trip', sortDir: 'desc', trendKey: 'delay_p50_sec', display: (l) => (l.p90_trip_sec !== null ? durationMin(l.p90_trip_sec) : secToMin(l.delay_p90_sec)) },
  { key: 'delay_p50_sec', label: 'Typical trip', sortDir: 'desc', trendKey: 'delay_p50_sec', display: (l) => (l.typical_trip_sec !== null ? durationMin(l.typical_trip_sec) : secToMin(l.delay_p50_sec)) },
]

export default function Leaderboard() {
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)
  const [sortKey, setSortKey] = useState('availability_pct_last_year')

  useEffect(() => {
    fetchOverview().then(setData).catch((e) => setError(e.message))
  }, [])

  const sorted = useMemo(() => {
    if (!data) return []
    const col = COLUMNS.find((c) => c.key === sortKey)
    const dir = col.sortDir === 'asc' ? 1 : -1
    return [...data.lines].sort((a, b) => dir * (a[sortKey] - b[sortKey]))
  }, [data, sortKey])

  if (error) return <p className="error">Couldn't load data: {error}</p>
  if (!data) return <p className="loading">Loading…</p>

  const sortedCol = COLUMNS.find((c) => c.key === sortKey)

  return (
    <div>
      <div className="page-header">
        <h1>Leaderboard</h1>
        <p className="page-subtitle">
          Ranked worst-to-best by the selected metric. Delay columns are trailing {data.window_days} days;
          availability is trailing {Math.round(data.availability_window_days / 30.44)} months. Click a column to sort by it.
        </p>
      </div>

      <table className="leaderboard-table">
        <thead>
          <tr>
            <th>Rank</th>
            <th>Line</th>
            {COLUMNS.map((c) => (
              <th
                key={c.key}
                className={`sortable ${sortKey === c.key ? 'sorted' : ''}`}
                onClick={() => setSortKey(c.key)}
              >
                {c.label}
              </th>
            ))}
            <th>{sortedCol.trendKey ? `${data.window_days}-day trend` : 'Trend'}</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((l, i) => {
            const affectedDays = l.classifiable_days_last_year - l.normal_days_last_year
            return (
              <tr key={l.line}>
                <td className="rank-cell">{i + 1}</td>
                <td>
                  <Link to={`/line/${encodeURIComponent(l.line)}`}>
                    <LineBadge line={l.line} />
                  </Link>
                </td>
                {COLUMNS.map((c) => (
                  <td key={c.key} className={sortKey === c.key ? 'sorted-cell' : ''}>{c.display(l)}</td>
                ))}
                <td>
                  {sortedCol.trendKey ? (
                    <Sparkline data={l.trend} dataKey={sortedCol.trendKey} color={lineColor(l.line)} />
                  ) : (
                    <span className="sparkline-empty">{affectedDays} affected day{affectedDays === 1 ? '' : 's'}</span>
                  )}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
