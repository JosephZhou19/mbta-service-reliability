import { useMemo } from 'react'

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
// day-of-week, trailing-12-months date range. Chosen over the date-range pill list it
// replaces because clustering and frequency (is this line reduced constantly, or in a
// few multi-week blocks?) reads at a glance from a shape, where a list of ranges makes
// the reader do that pattern-matching themselves one line at a time.
export default function ServiceCalendar({ startDate, endDate, closures }) {
  const reducedDates = useMemo(() => {
    const s = new Set()
    for (const c of closures) {
      for (let d = parseDate(c.start); d <= parseDate(c.end); d = new Date(d.getTime() + DAY_MS)) {
        s.add(fmt(d))
      }
    }
    return s
  }, [closures])

  const { weeks, monthLabels } = useMemo(() => {
    const start = parseDate(startDate)
    const end = parseDate(endDate)
    const gridStart = new Date(start)
    gridStart.setDate(gridStart.getDate() - gridStart.getDay())

    const days = []
    for (let d = new Date(gridStart); d <= end; d = new Date(d.getTime() + DAY_MS)) {
      const dateStr = fmt(d)
      const inRange = d >= start && d <= end
      days.push({ date: dateStr, dow: d.getDay(), inRange, reduced: reducedDates.has(dateStr) })
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
  }, [startDate, endDate, reducedDates])

  const gridWidth = weeks.length * (CELL + GAP)

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
              className={!day.inRange ? 'cal-out' : day.reduced ? 'cal-reduced' : 'cal-normal'}
            >
              {day.inRange && <title>{day.date}{day.reduced ? ' — reduced service' : ''}</title>}
            </rect>
          )),
        )}
      </svg>
      <div className="service-calendar-legend">
        <span className="legend-swatch cal-normal" /> normal service
        <span className="legend-swatch cal-reduced" /> reduced service
      </div>
    </div>
  )
}
