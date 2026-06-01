'use client'
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, ResponsiveContainer,
} from 'recharts'

interface Props {
  data: {
    run_date: string
    total_vms: number
    total_hosts: number
    total_clusters: number
  }[]
}

export default function TrendChart({ data }: Props) {
  const chartData = data.map(d => ({
    date:     new Date(d.run_date).toLocaleDateString('en-CA',
                { month:'short', day:'numeric' }),
    VMs:      Number(d.total_vms),
    Hosts:    Number(d.total_hosts),
    Clusters: Number(d.total_clusters),
  }))

  return (
    <div style={{display:'flex',flexDirection:'column',gap:20}}>
      <div className="card">
        <div className="card-header">
          <span className="card-title">VM count over time</span>
        </div>
        <div className="card-body" style={{height:300}}>
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
              <XAxis dataKey="date" fontSize={11} tick={{fill:'var(--text3)'}} />
              <YAxis fontSize={11} tick={{fill:'var(--text3)'}}
                     tickFormatter={v => v.toLocaleString()} />
              <Tooltip
                formatter={(v: number) => [v.toLocaleString(), 'VMs']}
                contentStyle={{
                  borderRadius:8, border:'1px solid var(--border)', fontSize:12,
                }}
              />
              <Line type="monotone" dataKey="VMs"
                    stroke="#2563eb" strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="grid-2">
        <div className="card">
          <div className="card-header">
            <span className="card-title">Host count over time</span>
          </div>
          <div className="card-body" style={{height:220}}>
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis dataKey="date" fontSize={11} tick={{fill:'var(--text3)'}} />
                <YAxis fontSize={11} tick={{fill:'var(--text3)'}} />
                <Tooltip contentStyle={{
                  borderRadius:8, border:'1px solid var(--border)', fontSize:12,
                }}/>
                <Line type="monotone" dataKey="Hosts"
                      stroke="#16a34a" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="card">
          <div className="card-header">
            <span className="card-title">Cluster count over time</span>
          </div>
          <div className="card-body" style={{height:220}}>
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis dataKey="date" fontSize={11} tick={{fill:'var(--text3)'}} />
                <YAxis fontSize={11} tick={{fill:'var(--text3)'}} />
                <Tooltip contentStyle={{
                  borderRadius:8, border:'1px solid var(--border)', fontSize:12,
                }}/>
                <Line type="monotone" dataKey="Clusters"
                      stroke="#7c3aed" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>
    </div>
  )
}
