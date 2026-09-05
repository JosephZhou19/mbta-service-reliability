import { LineChart, Line, ResponsiveContainer, YAxis } from 'recharts'

// Small inline trend line for the leaderboard — no axes/labels, just shape.
export default function Sparkline({ data, dataKey, color }) {
  const values = data.map((d) => d[dataKey]).filter((v) => v !== null && v !== undefined)
  if (values.length < 2) return <div className="sparkline-empty">not enough data</div>

  return (
    <ResponsiveContainer width={100} height={32}>
      <LineChart data={data}>
        <YAxis domain={['dataMin', 'dataMax']} hide />
        <Line
          type="monotone"
          dataKey={dataKey}
          stroke={color}
          strokeWidth={1.5}
          dot={false}
          isAnimationActive={false}
          connectNulls
        />
      </LineChart>
    </ResponsiveContainer>
  )
}
