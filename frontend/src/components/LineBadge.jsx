import { lineColor, lineLabel } from '../lib/lines'

export default function LineBadge({ line, compact = false }) {
  return (
    <span className="line-badge" style={{ '--line-color': lineColor(line) }}>
      <span className="line-badge-dot" />
      {compact ? line : lineLabel(line)}
    </span>
  )
}
