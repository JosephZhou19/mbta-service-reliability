export function secToMin(sec) {
  if (sec === null || sec === undefined || Number.isNaN(sec)) return '—'
  const sign = sec < 0 ? '-' : '+'
  const abs = Math.abs(sec) / 60
  return `${sign}${abs.toFixed(1)} min`
}

// Absolute duration ("35 min"), for a guesstimated actual trip time — not a delta,
// so no +/- sign like secToMin.
export function durationMin(sec) {
  if (sec === null || sec === undefined || Number.isNaN(sec)) return '—'
  return `${(sec / 60).toFixed(0)} min`
}

export function pct(value) {
  if (value === null || value === undefined || Number.isNaN(value)) return '—'
  return `${value.toFixed(1)}%`
}

// This data spans multiple years — omitting the year (as a bare "Apr 3" tick)
// reads as chronologically backwards once ticks cross a year boundary (e.g.
// "Apr 2023" then "Jan 2024" looks like it went back in time without it).
// Always include a 2-digit year to disambiguate.
export function formatDate(dateStr) {
  const d = new Date(dateStr + 'T00:00:00')
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' })
}

// Second-half vs. first-half average of a daily series -- a single day-to-day delta
// is mostly noise (see the leaderboard sparklines), but comparing the two halves of
// the trailing window smooths that into an actual direction worth reporting.
export function trendDelta(series, key) {
  const values = series.map((d) => d[key]).filter((v) => v !== null && v !== undefined)
  if (values.length < 4) return null
  const avg = (arr) => arr.reduce((a, b) => a + b, 0) / arr.length
  const mid = Math.floor(values.length / 2)
  return avg(values.slice(mid)) - avg(values.slice(0, mid))
}

// Tone is driven by the delay component, not the absolute trip length — a naturally
// long line (Green-D, ~65 min) isn't "bad" for being long; what matters is how much
// longer than scheduled it's actually running.
export function delayTone(sec) {
  if (sec === null || sec === undefined) return 'neutral'
  if (sec <= 60) return 'good'
  if (sec <= 240) return 'warn'
  return 'bad'
}

// availability_pct_last_year means "no MBTA alert of any kind was active," a strict
// bar that puts real values in the 0-90% range rather than 85-99% -- thresholds scaled
// accordingly so a line doesn't render as "bad" just for this being a strict measure.
export function availabilityTone(p) {
  if (p === null || p === undefined) return 'neutral'
  if (p >= 50) return 'good'
  if (p >= 20) return 'warn'
  return 'bad'
}
