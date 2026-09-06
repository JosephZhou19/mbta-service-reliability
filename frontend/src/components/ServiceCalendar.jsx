import { useMemo, useState } from 'react'
import { effectColor, effectLabel, EFFECT_DESCRIPTION } from '../lib/alertEffects'
import { formatDate } from '../lib/format'

const DAY_MS = 24 * 60 * 60 * 1000
const CELL = 11
const GAP = 3

function parseDate(s) {
  return new Date(s + 'T00:00:00')
}

function fmt(d) {
  return d.toISOString().slice(0, 10)
}

// A GitHub-contributions-style day grid: one column per calendar week, one row per
// day-of-week. Shows clustering/frequency at a glance, where a list of date ranges
// would make the reader do that pattern-matching themselves.
//
// statusRanges comes from alert_status.py: contiguous date ranges tagged with the
// winning MBTA alert effect plus a representative reason. Colors are shared with
// TrendChart via lib/alertEffects.js.
export default function ServiceCalendar({ startDate, endDate, statusRanges = [] }) {
  const [hover, setHover] = useState(null)

  const dayStatus = useMemo(() => {
    const m = new Map()
    for (const r of statusRanges) {
      for (let d = parseDate(r.start); d <= parseDate(r.end); d = new Date(d.getTime() + DAY_MS)) {
        m.set(fmt(d), r)
      }
    }
    return m
  }, [statusRanges])

  const { weeks, monthLabels } = useMemo(() => {
    const start = parseDate(startDate)
    const end = parseDate(endDate)
    const gridStart = new Date(start)
    gridStart.setDate(gridStart.getDate() - gridStart.getDay())

    const days = []
    for (let d = new Date(gridStart); d <= end; d = new Date(d.getTime() + DAY_MS)) {
      const dateStr = fmt(d)
      const inRange = d >= start && d <= end
      days.push({ date: dateStr, dow: d.getDay(), inRange, status: dayStatus.get(dateStr) })
    }

    const weeks = []
    for (let i = 0; i < days.length; i += 7) weeks.push(days.slice(i, i + 7))

    const monthLabels = []
    let lastMonth = null
    weeks.forEach((week, wi) => {
      const firstInRangeDay = week.find((d) => d.inRange)
      if (!firstInRangeDay) return
      const month = parseDate(firstInRangeDay.date).toLocaleDateString('en-US', { month: 'short' })
      if (month !== lastMonth) {
        monthLabels.push({ weekIndex: wi, label: month })
        lastMonth = month
      }
    })

    return { weeks, monthLabels }
  }, [startDate, endDate, dayStatus])

  const gridWidth = weeks.length * (CELL + GAP)

  const legendEffects = useMemo(
    () => [...new Set(statusRanges.map((r) => r.effect))].sort((a, b) => effectLabel(a).localeCompare(effectLabel(b))),
    [statusRanges],
  )

  function cellFill(day) {
    if (!day.inRange) return 'transparent'
    if (day.status) return effectColor(day.status.effect)
    return 'var(--good)'
  }

  function cellOpacity(day) {
    if (!day.inRange) return 1
    return day.status ? 1 : 0.35
  }

  return (
    <div className="service-calendar" style={{ width: gridWidth }}>
      <div className="service-calendar-months">
        {monthLabels.map((m) => (
          <span key={m.weekIndex} style={{ left: m.weekIndex * (CELL + GAP) }}>{m.label}</span>
        ))}
      </div>
      <svg width={gridWidth} height={7 * (CELL + GAP)} className="service-calendar-grid">
        {weeks.map((week, wi) =>
          week.map((day) => (
            <rect
              key={day.date}
              x={wi * (CELL + GAP)}
              y={day.dow * (CELL + GAP)}
              width={CELL}
              height={CELL}
              rx={2}
              fill={cellFill(day)}
              fillOpacity={cellOpacity(day)}
              onMouseEnter={(e) => day.inRange && setHover({ x: e.clientX, y: e.clientY, day })}
              onMouseMove={(e) => day.inRange && setHover({ x: e.clientX, y: e.clientY, day })}
              onMouseLeave={() => setHover(null)}
            />
          )),
        )}
      </svg>
      {hover && (
        <div className="calendar-tooltip" style={{ left: hover.x + 14, top: hover.y + 14 }}>
          <strong>{formatDate(hover.day.date)}</strong>
          {hover.day.status ? (
            <>
              <div>{effectLabel(hover.day.status.effect)}</div>
              {hover.day.status.reason && <div className="calendar-tooltip-reason">{hover.day.status.reason}</div>}
            </>
          ) : (
            <div>Normal service</div>
          )}
        </div>
      )}
      <dl className="service-calendar-legend">
        <div className="legend-row">
          <dt><span className="legend-swatch" style={{ background: 'var(--good)', opacity: 0.35 }} />Normal</dt>
          <dd>No active MBTA alert for the line that day.</dd>
        </div>
        {legendEffects.map((effect) => (
          <div className="legend-row" key={effect}>
            <dt><span className="legend-swatch" style={{ background: effectColor(effect) }} />{effectLabel(effect)}</dt>
            <dd>{EFFECT_DESCRIPTION[effect] || ''}</dd>
          </div>
        ))}
      </dl>
    </div>
  )
}
