'use client'
import { useRouter } from 'next/navigation'
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from 'recharts'

const COLORS = [
  '#2563eb','#7c3aed','#16a34a','#d97706','#dc2626',
  '#0891b2','#9333ea','#65a30d','#ea580c','#0284c7',
  '#c026d3','#b45309','#0d9488','#be123c','#6b7280',
]

interface Props {
  data: { os_group: string; count: number }[]
}

export default function OSChart({ data }: Props) {
  const router = useRouter()

  const chartData = data.map(d => ({
    name:  d.os_group,
    value: Number(d.count),
  }))

  const total = data.reduce((a, d) => a + Number(d.count), 0)

  function handleClick(os: string) {
    if (!os) return
    router.push(`/dashboard/inventory?${new URLSearchParams({ os, page: '1' })}`)
  }

  return (
    <div className="card">
      <div className="card-header">
        <span className="card-title">OS distribution</span>
        <span style={{ fontSize: 12, color: 'var(--text3)' }}>
          {total.toLocaleString()} VMs · click to filter
        </span>
      </div>
      <div className="card-body">

        {/* Donut chart — no built-in legend */}
        <div style={{ height: 220 }}>
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={chartData}
                cx="50%"
                cy="50%"
                innerRadius={60}
                outerRadius={100}
                paddingAngle={2}
                dataKey="value"
                onClick={(entry) => handleClick(entry?.name)}
                style={{ cursor: 'pointer' }}
              >
                {chartData.map((_, i) => (
                  <Cell key={`cell-${i}`} fill={COLORS[i % COLORS.length]} />
                ))}
              </Pie>
              <Tooltip
                formatter={(value: number, name: string) => [
                  `${value.toLocaleString()} VMs`,
                  name,
                ]}
                contentStyle={{
                  borderRadius: 8,
                  border: '1px solid var(--border)',
                  fontSize: 12,
                }}
              />
            </PieChart>
          </ResponsiveContainer>
        </div>

        {/* Legend table — scrollable, two columns */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: '2px 16px',
          maxHeight: 200,
          overflowY: 'auto',
          marginTop: 12,
          paddingTop: 12,
          borderTop: '1px solid var(--border)',
        }}>
          {chartData.map((entry, i) => {
            const pct = total > 0
              ? ((entry.value / total) * 100).toFixed(1)
              : '0'
            return (
              <div
                key={entry.name}
                onClick={() => handleClick(entry.name)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 7,
                  padding: '4px 6px',
                  borderRadius: 6,
                  cursor: 'pointer',
                  transition: 'background .1s',
                }}
                onMouseEnter={e =>
                  (e.currentTarget.style.background = 'var(--surface2)')}
                onMouseLeave={e =>
                  (e.currentTarget.style.background = 'transparent')}
              >
                {/* Colour dot */}
                <span style={{
                  width: 8, height: 8,
                  borderRadius: '50%',
                  background: COLORS[i % COLORS.length],
                  flexShrink: 0,
                }} />
                {/* OS name */}
                <span style={{
                  fontSize: 11,
                  color: 'var(--text2)',
                  flex: 1,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}>
                  {entry.name}
                </span>
                {/* Count + pct */}
                <span style={{
                  fontSize: 11,
                  color: 'var(--text3)',
                  flexShrink: 0,
                  fontVariantNumeric: 'tabular-nums',
                }}>
                  {entry.value.toLocaleString()}
                  <span style={{ marginLeft: 3, fontSize: 10 }}>
                    ({pct}%)
                  </span>
                </span>
              </div>
            )
          })}
        </div>

      </div>
    </div>
  )
}
