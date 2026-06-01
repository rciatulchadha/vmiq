interface VCenter {
  vcenter_name: string
  estate: string
  vm_count: number
  host_count: number
  cluster_count: number
  powered_on: number
  powered_off: number
  total_vcpus: number
  total_mem_gb: number
  collected_at: string
}

interface Props {
  vcenters: VCenter[]
}

function fmt(n: number | string) {
  return Number(n).toLocaleString()
}

function fmtDate(d: string) {
  if (!d) return '—'
  return new Date(d).toLocaleString('en-US', {
    timeZone: 'America/Toronto',
    month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
    hour12: true,
  }) + ' EST'
}

export default function VCenterTable({ vcenters }: Props) {
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>vCenter</th>
            <th>Estate</th>
            <th style={{ textAlign: 'right' }}>Clusters</th>
            <th style={{ textAlign: 'right' }}>Hosts</th>
            <th style={{ textAlign: 'right' }}>VMs</th>
            <th style={{ textAlign: 'right' }}>Powered on</th>
            <th style={{ textAlign: 'right' }}>vCPUs</th>
            <th style={{ textAlign: 'right' }}>Memory (GB)</th>
            <th>Last snapshot</th>
          </tr>
        </thead>
        <tbody>
          {vcenters.map(vc => {
            const onPct = vc.vm_count > 0
              ? Math.round((Number(vc.powered_on) / Number(vc.vm_count)) * 100)
              : 0
            return (
              <tr key={vc.vcenter_name}>
                <td>
                  <span style={{ fontWeight: 600 }}>{vc.vcenter_name}</span>
                </td>
                <td>
                  <span className="badge badge-blue">
                    {vc.estate || 'Unknown'}
                  </span>
                </td>
                <td style={{ textAlign: 'right' }}>
                  {fmt(vc.cluster_count)}
                </td>
                <td style={{ textAlign: 'right' }}>
                  {fmt(vc.host_count)}
                </td>
                <td style={{ textAlign: 'right' }}>
                  {fmt(vc.vm_count)}
                </td>
                <td style={{ textAlign: 'right' }}>
                  <div style={{ display: 'flex', alignItems: 'center',
                                justifyContent: 'flex-end', gap: 8 }}>
                    <div className="progress-bar" style={{ width: 60 }}>
                      <div
                        className="progress-fill"
                        style={{
                          width: `${onPct}%`,
                          background: onPct > 80
                            ? 'var(--green)'
                            : onPct > 50 ? 'var(--amber)' : 'var(--red)',
                        }}
                      />
                    </div>
                    <span style={{ fontSize: 12, color: 'var(--text2)',
                                   minWidth: 32 }}>
                      {onPct}%
                    </span>
                  </div>
                </td>
                <td style={{ textAlign: 'right' }}>
                  {fmt(vc.total_vcpus)}
                </td>
                <td style={{ textAlign: 'right' }}>
                  {fmt(Math.round(Number(vc.total_mem_gb)))}
                </td>
                <td style={{ color: 'var(--text3)', fontSize: 12 }}>
                  {fmtDate(vc.collected_at)}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
