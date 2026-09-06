import { useEffect, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { fetchLineDetail, fetchOverview } from '../lib/data'
import { secToMin, durationMin, pct, delayTone, availabilityTone } from '../lib/format'
import { lineLabel, lineColor, directionLabel } from '../lib/lines'
import TrendChart from '../components/TrendChart'
import ServiceCalendar from '../components/ServiceCalendar'
import LineBadge from '../components/LineBadge'
import StatTile from '../components/StatTile'

export default function LineDetail() {
  const { line } = useParams()
  const [data, setData] = useState(null)
  const [summary, setSummary] = useState(null)
  const [error, setError] = useState(null)

  useEffect(() => {
    setData(null)
    setSummary(null)
    fetchLineDetail(line).then(setData).catch((e) => setError(e.message))
    fetchOverview().then((o) => setSummary(o.lines.find((l) => l.line === line) || null))
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
  // Axis ticks drop the " min" suffix that secToMin adds for the tooltip -- the axis
  // title already says "Minutes late," and the full text was wide enough to wrap.
  const yTick = (v) => secToMin(v).replace(' min', '')

  return (
    <div>
      <Link to="/" className="back-link">← Overview</Link>

      <div className="line-hero" style={{ '--line-color': color }}>
        <div>
          <h1><LineBadge line={line} /></h1>
        </div>
        {summary && (
          <div className="line-hero-stats">
            {summary.typical_trip_sec !== null ? (
              <StatTile
                label="Typical trip"
                value={durationMin(summary.typical_trip_sec)}
                sublabel={secToMin(summary.delay_p50_sec) + ' vs scheduled'}
                tone={delayTone(summary.delay_p50_sec)}
              />
            ) : (
              <StatTile label="Typical delay" value={secToMin(summary.delay_p50_sec)} tone={delayTone(summary.delay_p50_sec)} />
            )}
            {summary.p90_trip_sec !== null ? (
              <StatTile
                label="90th pct. trip"
                value={durationMin(summary.p90_trip_sec)}
                sublabel={secToMin(summary.delay_p90_sec) + ' vs scheduled'}
                tone={delayTone(summary.delay_p90_sec)}
              />
            ) : (
              <StatTile label="90th pct. delay" value={secToMin(summary.delay_p90_sec)} tone={delayTone(summary.delay_p90_sec)} />
            )}
            <StatTile label="Availability (12mo)" value={pct(summary.availability_pct_last_year)} tone={availabilityTone(summary.availability_pct_last_year)} />
            <StatTile label="Observations" value={summary.n_observations.toLocaleString()} />
          </div>
        )}
      </div>

      <h2>Disruption Calendar</h2>
      <p className="page-subtitle">
          Every day over the last 12 months, colored by what MBTA reported for this line. Tap or hover a
          box to see the date and, if something was going on, what the alert was.
      </p>
      <div className="chart-block">
        <ServiceCalendar startDate={startDate} endDate={endDate} statusRanges={data.status_ranges} />
      </div>

      <h2>Delay Trends</h2>
      <p className="page-subtitle">
        How far behind schedule trains ran each day, for the last 12 months. A handful of very bad days
        would flatten the rest of the chart at full scale, so the y-axis is zoomed in to the typical
        range — nothing's hidden, hover any point to see its real value. Drag the bar under a chart to
        zoom into a specific stretch of time.
      </p>
      {directions.map((dir) => (
        <section key={dir} className="direction-section">
          <h3>{directionLabel(line, dir)}</h3>

          <div className="chart-block">
            <TrendChart
              data={data.by_direction[dir]}
              lines={[
                { dataKey: 'delay_p50_sec', name: 'Typical day', color },
                { dataKey: 'delay_p90_sec', name: 'Bad day (90th pct.)', color: '#999' },
              ]}
              yLabel="Minutes late"
              yTickFormatter={yTick}
              tooltipFormatter={secToMin}
              statusRanges={data.status_ranges}
              zeroLine
            />
          </div>
        </section>
      ))}
    </div>
  )
}
