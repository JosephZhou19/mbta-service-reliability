import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend, ReferenceArea } from 'recharts'
import { formatDate } from '../lib/format'
import { effectColor } from '../lib/alertEffects'

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
// inspection: with dataKey="service_date" as a category axis, most status ranges'
// reference rects rendered at x=0 (the chart's left edge) instead of their actual date --
// only 2 of 11 for one Red-A chart resolved correctly. A numeric axis sidesteps that
// category lookup entirely; day differences interpolate as real pixel positions.
function toEpochDay(dateStr) {
  return Date.parse(dateStr + 'T00:00:00Z')
}

function fromEpochDay(t) {
  return new Date(t).toISOString().slice(0, 10)
}

const DAY_MS = 24 * 60 * 60 * 1000

// statusRanges (from alert_status.py) are rendered as shaded bands behind the delay
// lines rather than a separate chart -- the whole point of tracking both together is
// seeing whether a delay spike lines up with a real service alert or happened on an
// otherwise-normal day, which a shared chart shows at a glance instead of making the
// reader cross-reference two charts. Delay figures are NOT blanked out during a
// flagged period -- unlike the schedule-footprint/match-rate signals this replaced,
// not every alert effect necessarily makes the day's delay figure untrustworthy (e.g.
// SIGNIFICANT_DELAYS is a real, meaningful delay reading, not noise), so suppressing
// data is deferred to a future per-effect decision rather than applied uniformly here.
export default function TrendChart({ data, lines, yLabel, tooltipFormatter, domain, statusRanges = [] }) {
  const dataKeys = lines.map((l) => l.dataKey)
  const chartData = data.map((d) => ({ ...d, _t: toEpochDay(d.service_date) }))
  const yDomain = domain ?? robustDomain(chartData, dataKeys)

  return (
    <ResponsiveContainer width="100%" height={320}>
      <LineChart data={chartData} margin={{ top: 8, right: 16, left: 8, bottom: 8 }}>
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
        {statusRanges.map((r) => (
          <ReferenceArea key={`${r.start}-${r.effect}`} x1={toEpochDay(r.start)} x2={toEpochDay(r.end) + DAY_MS} fill={effectColor(r.effect)} fillOpacity={0.15} strokeOpacity={0} ifOverflow="visible" />
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
            connectNulls
          />
        ))}
      </LineChart>
    </ResponsiveContainer>
  )
}
