import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { fetchOverview } from '../lib/data'
import { secToMin, durationMin, pct } from '../lib/format'
import { lineColor } from '../lib/lines'
import LineBadge from '../components/LineBadge'
import StatTile from '../components/StatTile'

// Tone is still driven by the delay component, not the absolute trip length — a
// naturally long line (Green-D, ~65 min) isn't "bad" for being long; what matters
// is how much longer than scheduled it's actually running.
function delayTone(sec) {
  if (sec === null || sec === undefined) return 'neutral'
  if (sec <= 60) return 'good'
  if (sec <= 240) return 'warn'
  return 'bad'
}

// availability_pct_last_year means "no MBTA alert of any kind was active," a strict
// bar that puts real values in the 0-90% range rather than 85-99% -- thresholds scaled
// accordingly so the page doesn't render every line as "bad."
function availabilityTone(p) {
  if (p === null || p === undefined) return 'neutral'
  if (p >= 50) return 'good'
  if (p >= 20) return 'warn'
  return 'bad'
}

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
        <p className="page-subtitle">
          Delay is trailing {data.window_days} days, as of {data.as_of}. Trip time is a guesstimate
          (typical scheduled length for the line + typical delay) — not a per-route answer, and not
          available for a line mid-diversion long enough to still lack a normal-length day to measure
          from. Availability is the trailing {Math.round(data.availability_window_days / 30.44)}-month
          share of days MBTA had no active service alert for the line, of any kind — see a line's page
          for what specifically happened on the rest.
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
