export default function StatTile({ label, value, sublabel, tone = 'neutral' }) {
  return (
    <div className={`stat-tile stat-tile-${tone}`}>
      <div className="stat-tile-label">{label}</div>
      <div className="stat-tile-value">{value}</div>
      {sublabel && <div className="stat-tile-sublabel">{sublabel}</div>}
    </div>
  )
}
