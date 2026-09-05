import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend, ReferenceArea } from 'recharts'
import { formatDate } from '../lib/format'

// A handful of genuine outlier days (unbounded seconds, e.g. a severe single-day
// delay) can otherwise stretch the axis so far that the normal range is crushed into
// an unreadable sliver. Clip to the 2nd-98th percentile of the actual values with a
// little padding. This does not hide data: every real point still renders, the
// tooltip on hover always shows its exact true value, and a point beyond the clipped
// range just runs off the visible edge instead of flattening the whole chart -- it's
// choosing an axis that serves the common case, not discarding anything.
function robustDomain(data, dataKeys) {
  const values = []
  for (const d of data) {
    for (const key of dataKeys) {
      const v = d[key]
      if (v !== null && v !== undefined && !Number.isNaN(v)) values.push(v)
    }
  }
  if (values.length < 5) return ['auto', 'auto']
  values.sort((a, b) => a - b)
  const at = (q) => values[Math.min(values.length - 1, Math.floor(q * (values.length - 1)))]
  const lo = at(0.02)
  const hi = at(0.98)
  const pad = (hi - lo) * 0.12 || 60
  return [Math.floor(lo - pad), Math.ceil(hi + pad)]
}

// 'YYYY-MM-DD' parses as UTC midnight per the ISO 8601 spec, so this is a stable,
// timezone-independent numeric x-value -- unlike a category-string axis, where recharts'
// ReferenceArea silently fails to resolve most x1/x2 values to a position. Confirmed by
// inspection: with dataKey="service_date" as a category axis, most closures' reference
// rects rendered at x=0 (the chart's left edge) instead of their actual date -- only 2 of
// 11 for one Red-A chart resolved correctly. A numeric axis sidesteps that category
// lookup entirely; day differences interpolate as real pixel positions.
function toEpochDay(dateStr) {
  return Date.parse(dateStr + 'T00:00:00Z')
}

function fromEpochDay(t) {
  return new Date(t).toISOString().slice(0, 10)
}

const DAY_MS = 24 * 60 * 60 * 1000

// Delay figures computed during a reduced-service/diversion day, OR a service-anomaly
// day, aren't trustworthy -- confirmed by inspection during the DST bug investigation
// that realtime-to-schedule matching degrades badly on those days (observation counts
// collapsing, wildly implausible medians), because the trips actually running often
// don't correspond cleanly to the schedule they're being matched against. A service
// anomaly is by definition a day where that same collapse happened (that's the signal
// used to detect it), so it needs the same treatment. Rather than plot that noise, null
// out every line's value on those dates so the chart shows a real gap -- the shaded band
// explains why, instead of a data point implying a reading that isn't real.
function maskFlaggedDates(data, ranges, dataKeys) {
  if (!ranges.length) return data
  return data.map((d) => {
    const flagged = ranges.some((r) => d.service_date >= r.start && d.service_date <= r.end)
    if (!flagged) return d
    const masked = { ...d }
    for (const key of dataKeys) masked[key] = null
    return masked
  })
}

// closures and anomalies (from service_availability.py -- see its module docstring for
// what distinguishes the two) are rendered as shaded bands behind the delay lines rather
// than a separate chart -- the whole point of tracking both metrics together is seeing
// whether a delay spike lines up with a real schedule reduction or happened on an
// otherwise-normal day, which a side-by-side chart makes the reader do the correlating
// for themselves.
export default function TrendChart({ data, lines, yLabel, tooltipFormatter, domain, closures = [], anomalies = [] }) {
  const dataKeys = lines.map((l) => l.dataKey)
  const maskedData = maskFlaggedDates(maskFlaggedDates(data, closures, dataKeys), anomalies, dataKeys).map((d) => ({ ...d, _t: toEpochDay(d.service_date) }))
  const yDomain = domain ?? robustDomain(maskedData, dataKeys)

  return (
    <ResponsiveContainer width="100%" height={320}>
      <LineChart data={maskedData} margin={{ top: 8, right: 16, left: 8, bottom: 8 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
        <XAxis
          dataKey="_t"
          type="number"
          domain={['dataMin', 'dataMax']}
          tickFormatter={(t) => formatDate(fromEpochDay(t))}
          minTickGap={40}
          stroke="var(--text-muted)"
        />
        <YAxis stroke="var(--text-muted)" domain={yDomain} label={{ value: yLabel, angle: -90, position: 'insideLeft', fill: 'var(--text-muted)' }} />
        <Tooltip
          labelFormatter={(t) => formatDate(fromEpochDay(t))}
          formatter={tooltipFormatter}
          contentStyle={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 6 }}
        />
        <Legend />
        {closures.map((c) => (
          <ReferenceArea key={`c-${c.start}`} x1={toEpochDay(c.start)} x2={toEpochDay(c.end) + DAY_MS} fill="var(--bad)" fillOpacity={0.15} strokeOpacity={0} ifOverflow="visible" />
        ))}
        {anomalies.map((a) => (
          <ReferenceArea key={`a-${a.start}`} x1={toEpochDay(a.start)} x2={toEpochDay(a.end) + DAY_MS} fill="var(--warn)" fillOpacity={0.15} strokeOpacity={0} ifOverflow="visible" />
        ))}
        {lines.map((l) => (
          <Line
            key={l.dataKey}
            type="monotone"
            dataKey={l.dataKey}
            name={l.name}
            stroke={l.color}
            strokeWidth={1.75}
            dot={false}
            isAnimationActive={false}
          />
        ))}
      </LineChart>
    </ResponsiveContainer>
  )
}
