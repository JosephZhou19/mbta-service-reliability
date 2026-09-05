import { useEffect, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { fetchLineDetail } from '../lib/data'
import { lineLabel, lineColor, directionLabel } from '../lib/lines'
import TrendChart from '../components/TrendChart'

export default function LineDetail() {
  const { line } = useParams()
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)

  useEffect(() => {
    setData(null)
    fetchLineDetail(line).then(setData).catch((e) => setError(e.message))
  }, [line])

  if (error) return <p className="error">Couldn't load data for {line}: {error}</p>
  if (!data) return <p className="loading">Loading…</p>

  const color = lineColor(line)
  const directions = Object.keys(data.by_direction)

  return (
    <div>
      <div className="page-header">
        <Link to="/" className="back-link">← Overview</Link>
        <h1>{lineLabel(line)}</h1>
        <p className="page-subtitle">
          Trailing 12 months, one point per service day. The y-axis is clipped to a typical range so a
          handful of severe-delay days don't flatten the rest of the chart — hover any point for its
          exact value; nothing is hidden, just scaled for readability. Shaded bands mark days the line
          ran a reduced/construction schedule instead of its normal one.
        </p>
      </div>

      {data.closures.length > 0 && (
        <div className="chart-block">
          <h3>Reduced-service periods (trailing 12 months)</h3>
          <ul className="closure-list">
            {data.closures.map((c) => (
              <li key={c.start}>
                <span className="closure-dates">{c.start === c.end ? c.start : `${c.start} – ${c.end}`}</span>
                <span className="closure-days">{c.days} day{c.days === 1 ? '' : 's'}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {directions.map((dir) => (
        <section key={dir} className="direction-section">
          <h2>{directionLabel(line, dir)}</h2>

          <div className="chart-block">
            <h3>Delay (minutes late)</h3>
            <TrendChart
              data={data.by_direction[dir]}
              lines={[
                { dataKey: 'delay_p50_sec', name: 'p50', color },
                { dataKey: 'delay_p90_sec', name: 'p90', color: '#999' },
              ]}
              yLabel="seconds"
              tooltipFormatter={(v) => `${(v / 60).toFixed(1)} min`}
              closures={data.closures}
            />
          </div>
        </section>
      ))}
    </div>
  )
}
