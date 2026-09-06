import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { fetchOverview } from '../lib/data'
import { secToMin, durationMin, pct, trendDelta } from '../lib/format'
import { lineColor, lineLabel } from '../lib/lines'
import LineBadge from '../components/LineBadge'
import Sparkline from '../components/Sparkline'

// The sparkline alone only shows shape, not whether that shape means "getting worse"
// or "getting better" -- this makes the direction explicit as a number.
function TrendBadge({ delta }) {
  if (delta === null) return null
  const minutes = delta / 60
  if (Math.abs(minutes) < 0.1) return <span className="trend-delta trend-flat">flat</span>
  const worse = delta > 0
  return (
    <span className={`trend-delta ${worse ? 'trend-worse' : 'trend-better'}`}>
      {worse ? '▲' : '▼'} {Math.abs(minutes).toFixed(1)} min
    </span>
  )
}

// `value` is what's both shown and sorted on -- previously delay columns sorted by
// the raw underlying delay while displaying a different derived trip time, so a
// click could visibly fail to reorder the column the user was looking at. Falling
// back to the raw delay only when trip time isn't available (mid-diversion lines)
// keeps that as a meaningful order rather than leaving them unsortable.
const COLUMNS = [
  { key: 'line', label: 'Line', defaultDir: 'asc', trendKey: null, type: 'string', value: (l) => lineLabel(l.line) },
  { key: 'availability_pct_last_year', label: 'Availability (12mo)', defaultDir: 'asc', trendKey: null, value: (l) => l.availability_pct_last_year, display: (l) => pct(l.availability_pct_last_year) },
  { key: 'delay_p90_sec', label: '90th pct. trip', defaultDir: 'desc', trendKey: 'delay_p50_sec', value: (l) => l.p90_trip_sec ?? l.delay_p90_sec, display: (l) => (l.p90_trip_sec !== null ? durationMin(l.p90_trip_sec) : secToMin(l.delay_p90_sec)) },
  { key: 'delay_p50_sec', label: 'Typical trip', defaultDir: 'desc', trendKey: 'delay_p50_sec', value: (l) => l.typical_trip_sec ?? l.delay_p50_sec, display: (l) => (l.typical_trip_sec !== null ? durationMin(l.typical_trip_sec) : secToMin(l.delay_p50_sec)) },
]

export default function Leaderboard() {
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)
  const [sortKey, setSortKey] = useState('availability_pct_last_year')
  const [sortAsc, setSortAsc] = useState(true)

  useEffect(() => {
    fetchOverview().then(setData).catch((e) => setError(e.message))
  }, [])

  const sorted = useMemo(() => {
    if (!data) return []
    const col = COLUMNS.find((c) => c.key === sortKey)
    const dir = sortAsc ? 1 : -1
    return [...data.lines].sort((a, b) => {
      const av = col.value(a)
      const bv = col.value(b)
      return col.type === 'string' ? dir * av.localeCompare(bv) : dir * (av - bv)
    })
  }, [data, sortKey, sortAsc])

  if (error) return <p className="error">Couldn't load data: {error}</p>
  if (!data) return <p className="loading">Loading…</p>

  const sortedCol = COLUMNS.find((c) => c.key === sortKey)

  function handleSort(col) {
    if (sortKey === col.key) {
      setSortAsc((asc) => !asc)
    } else {
      setSortKey(col.key)
      setSortAsc(col.defaultDir === 'asc')
    }
  }

  return (
    <div>
      <div className="page-header">
        <h1>Least Reliable Leaderboard</h1>
        <p className="page-subtitle">
          Ranked worst-to-best by the selected metric. Trip columns are based on the last {data.window_days} days. 
          While availability is based on the last {Math.round(data.availability_window_days / 30.44)} months. Click a column to
          sort by it and see more details about each line's performance. Click on a line to see more details about its reliability.
        </p>
      </div>

      <table className="leaderboard-table">
        <thead>
          <tr>
            <th>Rank</th>
            {COLUMNS.map((c) => (
              <th
                key={c.key}
                className={`sortable ${sortKey === c.key ? 'sorted' : ''}`}
                onClick={() => handleSort(c)}
              >
                {c.label}
                {sortKey === c.key && <span className="sort-arrow">{sortAsc ? ' ↑' : ' ↓'}</span>}
              </th>
            ))}
            <th title={sortedCol.trendKey ? 'Typical delay: second half of the window vs. the first half' : undefined}>
              {sortedCol.trendKey ? `${data.window_days}-day trend` : 'Trend'}
            </th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((l, i) => {
            const affectedDays = l.classifiable_days_last_year - l.normal_days_last_year
            return (
              <tr key={l.line}>
                <td className="rank-cell">{i + 1}</td>
                {COLUMNS.map((c) => (
                  <td key={c.key} className={sortKey === c.key ? 'sorted-cell' : ''}>
                    {c.key === 'line' ? (
                      <Link to={`/line/${encodeURIComponent(l.line)}`}>
                        <LineBadge line={l.line} />
                      </Link>
                    ) : (
                      c.display(l)
                    )}
                  </td>
                ))}
                <td>
                  {sortedCol.trendKey ? (
                    <div className="trend-cell">
                      <Sparkline data={l.trend} dataKey={sortedCol.trendKey} color={lineColor(l.line)} />
                      <TrendBadge delta={trendDelta(l.trend, sortedCol.trendKey)} />
                    </div>
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
