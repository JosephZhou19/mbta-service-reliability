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

// Delay figures computed during a reduced-service/diversion day aren't trustworthy --
// confirmed by inspection during the DST bug investigation that realtime-to-schedule
// matching degrades badly on those days (observation counts collapsing, wildly
// implausible medians), because the trips actually running often don't correspond
// cleanly to the schedule they're being matched against. Rather than plot that noise,
// null out every line's value on a closure date so the chart shows a real gap there --
// the red band explains why, instead of a data point implying a reading that isn't real.
function maskClosureDates(data, closures, dataKeys) {
  if (!closures.length) return data
  return data.map((d) => {
    const reduced = closures.some((c) => d.service_date >= c.start && d.service_date <= c.end)
    if (!reduced) return d
    const masked = { ...d }
    for (const key of dataKeys) masked[key] = null
    return masked
  })
}

// closures (reduced-service date ranges, from service_availability.py) are rendered as
// shaded bands behind the delay lines rather than a separate chart -- the whole point of
// tracking both metrics together is seeing whether a delay spike lines up with a real
// schedule reduction or happened on an otherwise-normal day, which a side-by-side chart
// makes the reader do the correlating for themselves.
export default function TrendChart({ data, lines, yLabel, tooltipFormatter, domain, closures = [] }) {
  const dataKeys = lines.map((l) => l.dataKey)
  const maskedData = maskClosureDates(data, closures, dataKeys)
  const yDomain = domain ?? robustDomain(maskedData, dataKeys)

  return (
    <ResponsiveContainer width="100%" height={320}>
      <LineChart data={maskedData} margin={{ top: 8, right: 16, left: 8, bottom: 8 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
        <XAxis
          dataKey="service_date"
          tickFormatter={formatDate}
          minTickGap={40}
          stroke="var(--text-muted)"
        />
        <YAxis stroke="var(--text-muted)" domain={yDomain} label={{ value: yLabel, angle: -90, position: 'insideLeft', fill: 'var(--text-muted)' }} />
        <Tooltip
          labelFormatter={formatDate}
          formatter={tooltipFormatter}
          contentStyle={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 6 }}
        />
        <Legend />
        {closures.map((c) => (
          <ReferenceArea key={c.start} x1={c.start} x2={c.end} fill="var(--bad)" fillOpacity={0.12} strokeOpacity={0} ifOverflow="visible" />
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
