import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend, ReferenceArea } from 'recharts'
import { formatDate } from '../lib/format'
import { effectColor, MASKS_DELAY_DATA } from '../lib/alertEffects'

// A handful of outlier days can stretch the axis so far the normal range is crushed
// into a sliver. Clip to the 2nd-98th percentile with padding -- every point still
// renders and the tooltip shows its exact value; an outlier just runs off the edge.
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

// Numeric epoch, not a category-string axis: recharts' ReferenceArea silently fails
// to resolve most x1/x2 values against a category axis (confirmed: only 2 of 11
// status-range rects positioned correctly). A numeric axis interpolates real pixel
// positions instead.
function toEpochDay(dateStr) {
  return Date.parse(dateStr + 'T00:00:00Z')
}

function fromEpochDay(t) {
  return new Date(t).toISOString().slice(0, 10)
}

const DAY_MS = 24 * 60 * 60 * 1000

// Only effects in MASKS_DELAY_DATA (see lib/alertEffects.js) null out the delay
// figure; everything else still plots normally even while shaded.
function maskUntrustworthyDates(data, statusRanges, dataKeys) {
  const maskedRanges = statusRanges.filter((r) => MASKS_DELAY_DATA.has(r.effect))
  if (!maskedRanges.length) return data
  return data.map((d) => {
    const flagged = maskedRanges.some((r) => d.service_date >= r.start && d.service_date <= r.end)
    if (!flagged) return d
    const masked = { ...d }
    for (const key of dataKeys) masked[key] = null
    return masked
  })
}

// statusRanges are shaded bands behind the delay lines, not a separate chart -- shows
// at a glance whether a delay spike lines up with a real service alert.
export default function TrendChart({ data, lines, yLabel, tooltipFormatter, domain, statusRanges = [] }) {
  const dataKeys = lines.map((l) => l.dataKey)
  const chartData = maskUntrustworthyDates(data, statusRanges, dataKeys).map((d) => ({ ...d, _t: toEpochDay(d.service_date) }))
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
          />
        ))}
      </LineChart>
    </ResponsiveContainer>
  )
}
