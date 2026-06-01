export const dynamic = 'force-dynamic'
import pool from '@/lib/db'

async function getVCenters() {
  const { rows } = await pool.query(`
    WITH latest AS (
      SELECT DISTINCT ON (vcenter_id)
        id, vcenter_id, collected_at,
        vm_count, host_count, cluster_count, status
      FROM vcenter_snapshots
      WHERE status = 'complete'
      ORDER BY vcenter_id, collected_at DESC
    )
    SELECT
      v.id,
      v.name              AS vcenter_name,
      v.fqdn,
      e.name              AS estate,
      ls.vm_count,
      ls.host_count,
      ls.cluster_count,
      ls.collected_at,
      ls.status,
      COALESCE(stats.powered_on, 0)    AS powered_on,
      COALESCE(stats.powered_off, 0)   AS powered_off,
      COALESCE(stats.total_vcpus, 0)   AS total_vcpus,
      COALESCE(stats.total_mem_gb, 0)  AS total_mem_gb,
      COALESCE(stats.total_disk_gb, 0) AS total_disk_gb,
      COALESCE(stats.windows_vms, 0)   AS windows_vms,
      COALESCE(stats.linux_vms, 0)     AS linux_vms,
      COALESCE(stats.has_snapshots, 0) AS has_snapshots,
      COALESCE(stats.has_rdm, 0)       AS has_rdm
    FROM vcenters v
    JOIN latest ls ON ls.vcenter_id = v.id
    LEFT JOIN estates e ON e.id = v.estate_id
    LEFT JOIN LATERAL (
      SELECT
        COUNT(*) FILTER (WHERE powerstate = 'poweredOn')   AS powered_on,
        COUNT(*) FILTER (WHERE powerstate = 'poweredOff')  AS powered_off,
        SUM(vcpus)                                          AS total_vcpus,
        SUM(mem_mb) / 1024                                  AS total_mem_gb,
        SUM(disk_total_gb)                                  AS total_disk_gb,
        COUNT(*) FILTER (
          WHERE lower(os_fullname) LIKE '%windows%'
             OR lower(os_type)     LIKE '%windows%'
        )                                                   AS windows_vms,
        COUNT(*) FILTER (
          WHERE lower(os_fullname) LIKE '%linux%'
             OR lower(os_fullname) LIKE '%red hat%'
             OR lower(os_fullname) LIKE '%centos%'
        )                                                   AS linux_vms,
        COUNT(*) FILTER (WHERE has_snapshots = true)        AS has_snapshots,
        COUNT(*) FILTER (WHERE has_rdm = true)              AS has_rdm
      FROM virtual_machines
      WHERE snapshot_id = ls.id
    ) stats ON true
    ORDER BY e.name NULLS LAST, v.name
  `)
  return rows
}

function fmt(n: number) { return Number(n).toLocaleString() }

function fmtDate(d: string) {
  if (!d) return '—'
  return new Date(d).toLocaleString('en-US', {
    timeZone: 'America/Toronto',
    month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
    hour12: true,
  }) + ' EST'
}

export default async function VCentersPage() {
  const vcenters = await getVCenters()

  const totals = vcenters.reduce((acc, vc) => ({
    vms:      acc.vms      + Number(vc.vm_count),
    hosts:    acc.hosts    + Number(vc.host_count),
    clusters: acc.clusters + Number(vc.cluster_count),
  }), { vms: 0, hosts: 0, clusters: 0 })

  return (
    <>
      <div className="topbar">
        <div className="topbar-title">vCenter Inventory</div>
        <div className="topbar-right">
          <span className="last-updated">
            {vcenters.length} vCenters · {fmt(totals.vms)} VMs
          </span>
        </div>
      </div>

      <div className="page">

        {/* Summary */}
        <div className="stat-grid mb-6" style={{ gridTemplateColumns: 'repeat(4,1fr)' }}>
          {[
            { label: 'vCenters',  value: vcenters.length,  iconClass: 'icon-blue',   icon: '⬡' },
            { label: 'Clusters',  value: totals.clusters,  iconClass: 'icon-purple', icon: '◈' },
            { label: 'ESXi Hosts',value: totals.hosts,     iconClass: 'icon-blue',   icon: '◫' },
            { label: 'Total VMs', value: totals.vms,       iconClass: 'icon-green',  icon: '▣' },
          ].map(s => (
            <div key={s.label} className="stat-card">
              <div className={`stat-icon ${s.iconClass}`}>{s.icon}</div>
              <div className="stat-label">{s.label}</div>
              <div className="stat-value">{fmt(s.value)}</div>
            </div>
          ))}
        </div>

        {/* vCenter cards */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(420px, 1fr))',
          gap: 16,
        }}>
          {vcenters.map(vc => {
            const poweredOnPct = vc.vm_count > 0
              ? Math.round((Number(vc.powered_on) / Number(vc.vm_count)) * 100)
              : 0

            return (
              <div key={vc.id} className="card">
                {/* Card header */}
                <div className="card-header">
                  <div>
                    <div className="card-title">{vc.vcenter_name}</div>
                    <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 2 }}>
                      {vc.fqdn || vc.vcenter_name}
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                    <span className="badge badge-blue">
                      {vc.estate || 'ITEAST'}
                    </span>
                    <span className="badge badge-green">Active</span>
                  </div>
                </div>

                <div className="card-body">
                  {/* Key metrics row */}
                  <div style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(3,1fr)',
                    gap: 12, marginBottom: 16,
                  }}>
                    {[
                      { label: 'Clusters', value: vc.cluster_count || 0, icon: '◈' },
                      { label: 'ESXi Hosts', value: vc.host_count || 0, icon: '◫' },
                      { label: 'VMs', value: vc.vm_count || 0, icon: '▣' },
                    ].map(m => (
                      <div key={m.label} style={{
                        background: 'var(--surface2)',
                        borderRadius: 6, padding: '10px 12px',
                        textAlign: 'center',
                      }}>
                        <div style={{ fontSize: 18, marginBottom: 2 }}>{m.icon}</div>
                        <div style={{
                          fontSize: 20, fontWeight: 700, color: 'var(--text)',
                        }}>
                          {fmt(m.value)}
                        </div>
                        <div style={{ fontSize: 11, color: 'var(--text3)' }}>
                          {m.label}
                        </div>
                      </div>
                    ))}
                  </div>

                  {/* VM power state bar */}
                  <div style={{ marginBottom: 14 }}>
                    <div style={{
                      display: 'flex', justifyContent: 'space-between',
                      fontSize: 12, color: 'var(--text2)', marginBottom: 5,
                    }}>
                      <span>Powered on</span>
                      <span>
                        {fmt(vc.powered_on)} / {fmt(vc.vm_count)}
                        <span style={{ marginLeft: 6, color: 'var(--green)', fontWeight: 600 }}>
                          {poweredOnPct}%
                        </span>
                      </span>
                    </div>
                    <div className="progress-bar">
                      <div className="progress-fill" style={{
                        width: `${poweredOnPct}%`,
                        background: poweredOnPct > 80 ? 'var(--green)'
                                  : poweredOnPct > 50 ? 'var(--amber)'
                                  : 'var(--red)',
                      }} />
                    </div>
                  </div>

                  {/* Resource summary */}
                  <div style={{
                    display: 'grid', gridTemplateColumns: '1fr 1fr 1fr',
                    gap: 8, marginBottom: 14,
                    fontSize: 12,
                  }}>
                    {[
                      { label: 'vCPUs',   value: fmt(vc.total_vcpus) },
                      { label: 'Mem (GB)', value: fmt(Math.round(Number(vc.total_mem_gb))) },
                      { label: 'Disk (GB)', value: fmt(Math.round(Number(vc.total_disk_gb))) },
                    ].map(r => (
                      <div key={r.label} style={{
                        background: 'var(--surface2)',
                        borderRadius: 4, padding: '6px 8px',
                      }}>
                        <div style={{ color: 'var(--text3)', fontSize: 10 }}>{r.label}</div>
                        <div style={{ fontWeight: 600, color: 'var(--text)', marginTop: 1 }}>
                          {r.value}
                        </div>
                      </div>
                    ))}
                  </div>

                  {/* OS breakdown */}
                  <div style={{
                    display: 'flex', gap: 8, marginBottom: 14, flexWrap: 'wrap',
                  }}>
                    <span className="badge badge-blue">
                      🪟 {fmt(vc.windows_vms)} Windows
                    </span>
                    <span className="badge badge-blue">
                      🐧 {fmt(vc.linux_vms)} Linux
                    </span>
                    {Number(vc.has_snapshots) > 0 && (
                      <span className="badge badge-amber">
                        📸 {fmt(vc.has_snapshots)} snapshots
                      </span>
                    )}
                    {Number(vc.has_rdm) > 0 && (
                      <span className="badge badge-red">
                        ⚠️ {fmt(vc.has_rdm)} RDM
                      </span>
                    )}
                  </div>

                  {/* Footer */}
                  <div style={{
                    fontSize: 11, color: 'var(--text3)',
                    borderTop: '1px solid var(--border)',
                    paddingTop: 10,
                    display: 'flex', justifyContent: 'space-between',
                  }}>
                    <span>Last snapshot: {fmtDate(vc.collected_at)}</span>
                    <a
                      href={`/dashboard/inventory`}
                      style={{ color: 'var(--blue)', textDecoration: 'none', fontWeight: 500 }}
                    >
                      View VMs →
                    </a>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </>
  )
}
