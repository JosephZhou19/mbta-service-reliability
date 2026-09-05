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

function expandRanges(ranges) {
  const s = new Set()
  for (const c of ranges) {
    for (let d = parseDate(c.start); d <= parseDate(c.end); d = new Date(d.getTime() + DAY_MS)) {
      s.add(fmt(d))
    }
  }
  return s
}

// A GitHub-contributions-style day grid: one column per calendar week, one row per
// day-of-week, trailing-12-months date range. Chosen over the date-range pill list it
// replaces because clustering and frequency (is this line reduced constantly, or in a
// few multi-week blocks?) reads at a glance from a shape, where a list of ranges makes
// the reader do that pattern-matching themselves one line at a time.
//
// Three tiers, not two: reduced (red) is schedule-confirmed -- a stop normally served on
// this line is missing from the published schedule that day. anomaly (orange) is a
// second, lower-confidence signal -- the published schedule looked completely normal,
// but far fewer real trips than usual could be matched to it, which happened for real
// (confirmed on Green-B/C, Aug 22-26 2024: 97.6% of that day's matched trips were
// unscheduled placeholder trip_ids, yet the GTFS schedule was byte-for-byte unchanged)
// but isn't a published change we can point to the way reduced is. Reduced takes
// precedence if a day is somehow eligible for both (it shouldn't be, given how the
// backend computes it, but the two are drawn from separate signals).
export default function ServiceCalendar({ startDate, endDate, closures, anomalies = [] }) {
  const reducedDates = useMemo(() => expandRanges(closures), [closures])
  const anomalyDates = useMemo(() => expandRanges(anomalies), [anomalies])

  const { weeks, monthLabels } = useMemo(() => {
    const start = parseDate(startDate)
    const end = parseDate(endDate)
    const gridStart = new Date(start)
    gridStart.setDate(gridStart.getDate() - gridStart.getDay())

    const days = []
    for (let d = new Date(gridStart); d <= end; d = new Date(d.getTime() + DAY_MS)) {
      const dateStr = fmt(d)
      const inRange = d >= start && d <= end
      const reduced = reducedDates.has(dateStr)
      const anomaly = !reduced && anomalyDates.has(dateStr)
      days.push({ date: dateStr, dow: d.getDay(), inRange, reduced, anomaly })
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
  }, [startDate, endDate, reducedDates, anomalyDates])

  const gridWidth = weeks.length * (CELL + GAP)

  function cellClass(day) {
    if (!day.inRange) return 'cal-out'
    if (day.reduced) return 'cal-reduced'
    if (day.anomaly) return 'cal-anomaly'
    return 'cal-normal'
  }

  function cellTitle(day) {
    if (!day.inRange) return null
    if (day.reduced) return `${day.date} — reduced service`
    if (day.anomaly) return `${day.date} — service anomaly`
    return day.date
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
              className={cellClass(day)}
            >
              {day.inRange && <title>{cellTitle(day)}</title>}
            </rect>
          )),
        )}
      </svg>
      <dl className="service-calendar-legend">
        <div className="legend-row">
          <dt><span className="legend-swatch cal-normal" />Normal</dt>
          <dd>Ran its usual, full published schedule with typical realtime coverage.</dd>
        </div>
        <div className="legend-row">
          <dt><span className="legend-swatch cal-reduced" />Reduced service</dt>
          <dd>A stop normally served on this line is missing from that day's published schedule — a confirmed construction/diversion pattern.</dd>
        </div>
        <div className="legend-row">
          <dt><span className="legend-swatch cal-anomaly" />Service anomaly</dt>
          <dd>The published schedule looked normal, but far fewer real trips than usual could be matched to it — something happened operationally, though we can't confirm exactly what from the schedule alone.</dd>
        </div>
      </dl>
    </div>
  )
}
