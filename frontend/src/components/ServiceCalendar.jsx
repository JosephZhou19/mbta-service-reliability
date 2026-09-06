import { useLayoutEffect, useMemo, useRef, useState } from 'react'
import { effectColor, effectLabel, EFFECT_DESCRIPTION } from '../lib/alertEffects'
import { formatDate } from '../lib/format'

const DAY_MS = 24 * 60 * 60 * 1000
const CELL = 11
const GAP = 3
const MONTH_LABEL_HEIGHT = 16

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
  const containerRef = useRef(null)
  const tooltipRef = useRef(null)

  // The tooltip's initial position (tap point + offset) can push it past the edge
  // of a narrow phone screen -- measure it after render and clamp it back into
  // view, since its size varies with the reason text and can't be known up front.
  // Vertically it only ever slides *up* to fit, never past this component's own
  // top edge: a tap near the top of the grid with a long reason text used to flip
  // the tooltip above the tap point without knowing what else was on the page,
  // landing on top of the description text above the calendar entirely.
  useLayoutEffect(() => {
    const el = tooltipRef.current
    const container = containerRef.current
    if (!hover || !el || !container) return
    const margin = 8
    const { width, height } = el.getBoundingClientRect()
    const containerTop = container.getBoundingClientRect().top

    let left = hover.x + 14
    if (left + width > window.innerWidth - margin) left = hover.x - width - 14
    left = Math.min(Math.max(margin, left), window.innerWidth - width - margin)

    let top = Math.min(hover.y + 14, window.innerHeight - height - margin)
    top = Math.max(top, Math.max(margin, containerTop + margin))

    el.style.left = `${left}px`
    el.style.top = `${top}px`
  }, [hover])

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
  const gridHeight = 7 * (CELL + GAP)
  const totalHeight = MONTH_LABEL_HEIGHT + gridHeight

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

  // A tap fires as a click on every device (touch included), so it's the one
  // handler that reliably shows the tooltip on a phone -- hover has no touch
  // equivalent and was previously the only way to see a day's date there.
  function showTooltip(e, day) {
    if (day.inRange) setHover({ x: e.clientX, y: e.clientY, day })
  }

  return (
    <div ref={containerRef} className="service-calendar" style={{ maxWidth: gridWidth }}>
      <svg viewBox={`0 0 ${gridWidth} ${totalHeight}`} width="100%" className="service-calendar-grid">
        {monthLabels.map((m) => (
          <text key={m.weekIndex} x={m.weekIndex * (CELL + GAP)} y={MONTH_LABEL_HEIGHT - 5} className="calendar-month-label">
            {m.label}
          </text>
        ))}
        {weeks.map((week, wi) =>
          week.map((day) => (
            <rect
              key={day.date}
              x={wi * (CELL + GAP)}
              y={MONTH_LABEL_HEIGHT + day.dow * (CELL + GAP)}
              width={CELL}
              height={CELL}
              rx={2}
              fill={cellFill(day)}
              fillOpacity={cellOpacity(day)}
              onClick={(e) => showTooltip(e, day)}
              onMouseEnter={(e) => showTooltip(e, day)}
              onMouseMove={(e) => showTooltip(e, day)}
              onMouseLeave={() => setHover(null)}
            />
          )),
        )}
      </svg>
      {hover && (
        <div ref={tooltipRef} className="calendar-tooltip" style={{ left: hover.x + 14, top: hover.y + 14 }}>
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
