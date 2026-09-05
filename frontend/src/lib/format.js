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
