import { useEffect, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { fetchLineDetail } from '../lib/data'
import { lineLabel, lineColor, directionLabel } from '../lib/lines'
import TrendChart from '../components/TrendChart'
import ServiceCalendar from '../components/ServiceCalendar'

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
  // Calendar's date range comes from the actual delay series, not a hardcoded "last
  // 365 days from today" — keeps it correct even if the pipeline hasn't run today yet.
  const allDates = directions.flatMap((dir) => data.by_direction[dir].map((d) => d.service_date))
  const startDate = allDates.reduce((a, b) => (a < b ? a : b))
  const endDate = allDates.reduce((a, b) => (a > b ? a : b))

  return (
    <div>
      <div className="page-header">
        <Link to="/" className="back-link">← Overview</Link>
        <h1>{lineLabel(line)}</h1>
        <p className="page-subtitle">
          Trailing 12 months, one point per service day. The y-axis is clipped to a typical range so a
          handful of severe-delay days don't flatten the rest of the chart — hover any point for its
          exact value; nothing is hidden, just scaled for readability. Shaded bands (and the calendar
          below) mark days MBTA had an active service alert for this line — see the legend for what
          each color means.
        </p>
      </div>

      <div className="chart-block">
        <h3>Service calendar (trailing 12 months)</h3>
        <ServiceCalendar startDate={startDate} endDate={endDate} statusRanges={data.status_ranges} />
      </div>

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
              statusRanges={data.status_ranges}
            />
          </div>
        </section>
      ))}
    </div>
  )
}
