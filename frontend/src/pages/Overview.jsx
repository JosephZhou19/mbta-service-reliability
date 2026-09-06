import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { fetchOverview } from '../lib/data'
import { secToMin, durationMin, pct, delayTone, availabilityTone } from '../lib/format'
import { lineColor } from '../lib/lines'
import LineBadge from '../components/LineBadge'
import StatTile from '../components/StatTile'

export default function Overview() {
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)

  useEffect(() => {
    fetchOverview().then(setData).catch((e) => setError(e.message))
  }, [])

  if (error) return <p className="error">Couldn't load data: {error}</p>
  if (!data) return <p className="loading">Loading…</p>

  return (
    <div>
      <div className="page-header">
        <h1>System Overview</h1>
        <p className="page-lede">
          How reliable is the MBTA? This website summarizes the system's performance over the last year. 
          Click on a line to see more details about its reliability, or click the leaderboard link to see which lines are least reliable.
        </p>
        <p className="page-subtitle">
          The MBTA releases scheduled estimates of how long each trip should take. 
          We compare those to the actual trip times, and summarize the results. 
          The MBTA also releases service alerts when there are disruptions, and we track how often each line is affected by service disruptions.
        </p>
      </div>

      <div className="overview-grid">
        {data.lines.map((l) => (
          <Link to={`/line/${encodeURIComponent(l.line)}`} className="overview-card" key={l.line} style={{ '--line-color': lineColor(l.line) }}>
            <LineBadge line={l.line} />
            <div className="overview-card-stats">
              {l.typical_trip_sec !== null ? (
                <>
                  <StatTile
                    label="Typical trip"
                    value={durationMin(l.typical_trip_sec)}
                    sublabel={secToMin(l.delay_p50_sec) + ' vs scheduled'}
                    tone={delayTone(l.delay_p50_sec)}
                  />
                  <StatTile
                    label="90th pct. trip"
                    value={durationMin(l.p90_trip_sec)}
                    sublabel={secToMin(l.delay_p90_sec) + ' vs scheduled'}
                    tone={delayTone(l.delay_p90_sec)}
                  />
                </>
              ) : (
                <>
                  <StatTile label="Typical delay" value={secToMin(l.delay_p50_sec)} tone={delayTone(l.delay_p50_sec)} />
                  <StatTile label="90th pct. delay" value={secToMin(l.delay_p90_sec)} tone={delayTone(l.delay_p90_sec)} />
                </>
              )}
              <StatTile label="Availability" value={pct(l.availability_pct_last_year)} tone={availabilityTone(l.availability_pct_last_year)} />
            </div>
            <div className="overview-card-footer">{l.n_observations.toLocaleString()} observations</div>
          </Link>
        ))}
      </div>
    </div>
  )
}
