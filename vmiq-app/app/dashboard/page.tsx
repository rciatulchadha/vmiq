import {
  getGlobalSummary,
  getVMBreakdown,
  getVCenterSummary,
  getEstateSummary,
  getCMDBDriftSummary,
  getPipelineStatus,
  getOSDistribution,
  getDatastoreHealth,
  getLowUtilization,
} from '@/lib/queries'
import OSChart from '@/components/OSChart'
import VCenterTable from '@/components/VCenterTable'
import PipelineStatus from '@/components/PipelineStatus'
import DatastoreHealth from '@/components/DatastoreHealth'

export const dynamic = 'force-dynamic'

function fmt(n: number | string): string {
  return Number(n).toLocaleString()
}

function fmtEST(d: Date | string | null): string {
  if (!d) return '—'
  return new Date(d).toLocaleString('en-US', {
    timeZone: 'America/Toronto',
    month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
    hour12: true,
  }) + ' EST'
}

// Clickable stat card with optional href
function StatCard({
  icon, iconClass, label, value, sub, href, color,
}: {
  icon: string
  iconClass: string
  label: string
  value: string
  sub?: string
  href?: string
  color?: string
}) {
  const inner = (
    <div className="stat-card" style={{
      cursor: href ? 'pointer' : 'default',
      transition: 'box-shadow .15s',
      textDecoration: 'none',
      display: 'block',
    }}>
      <div className={`stat-icon ${iconClass}`}>{icon}</div>
      <div className="stat-label">{label}</div>
      <div className="stat-value" style={color ? { color } : {}}>
        {value}
      </div>
      {sub && <div className="stat-sub">{sub}</div>}
      {href && (
        <div style={{
          fontSize: 11, color: 'var(--blue)',
          marginTop: 6, fontWeight: 500,
        }}>
          View all →
        </div>
      )}
    </div>
  )

  if (href) {
    return <a href={href} style={{ textDecoration: 'none' }}>{inner}</a>
  }
  return inner
}

export default async function DashboardPage() {
  const [summary, vms, vcenters, estates, cmdb, pipelines, osData, dsData, lowUtil] =
    await Promise.all([
      getGlobalSummary(),
      getVMBreakdown(),
      getVCenterSummary(),
      getEstateSummary(),
      getCMDBDriftSummary(),
      getPipelineStatus(),
      getOSDistribution(),
      getDatastoreHealth(),
      getLowUtilization(),
    ])

  const poweredOnPct = vms.total > 0
    ? Math.round((Number(vms.powered_on) / Number(vms.total)) * 100)
    : 0

  return (
    <>
      <div className="topbar">
        <div className="topbar-title">Global Overview</div>
        <div className="topbar-right">
          <span className="last-updated">
            Last updated: {fmtEST(summary.last_updated)}
          </span>
        </div>
      </div>

      <div className="page">

        {/* ── Summary stat cards — clickable ────────────── */}
        <div className="stat-grid mb-6">
          <StatCard
            icon="⬡" iconClass="icon-blue"
            label="vCenters"
            value={fmt(summary.vcenter_count)}
            sub="ITEAST estate"
            href="/dashboard/vcenters"
          />
          <StatCard
            icon="◈" iconClass="icon-purple"
            label="Clusters"
            value={fmt(summary.cluster_count)}
            sub="Across all vCenters"
            href="/dashboard/clusters"
          />
          <StatCard
            icon="◫" iconClass="icon-blue"
            label="ESXi Hosts"
            value={fmt(summary.host_count)}
            sub="Across all vCenters"
            href="/dashboard/hosts"
          />
          <StatCard
            icon="▣" iconClass="icon-green"
            label="Virtual Machines"
            value={fmt(vms.total)}
            sub={`${fmt(vms.powered_on)} powered on`}
            href="/dashboard/inventory"
          />
          <StatCard
            icon="⚙" iconClass="icon-blue"
            label="Total vCPUs"
            value={fmt(vms.total_vcpus)}
            sub="Allocated"
          />
          <StatCard
            icon="▤" iconClass="icon-purple"
            label="Total Memory"
            value={`${Math.round(Number(vms.total_mem_gb) / 1024)} TB`}
            sub={`${fmt(vms.total_mem_gb)} GB`}
          />
          <StatCard
            icon="◧" iconClass="icon-amber"
            label="Total Storage"
            value={`${Math.round(Number(vms.total_disk_gb) / 1024)} TB`}
            sub="Provisioned"
            href="/dashboard/datastores"
          />
          <StatCard
            icon="⊞" iconClass="icon-red"
            label="CMDB Ghost VMs"
            value={fmt(cmdb.ghost_vms ?? 0)}
            sub="Not in CMDB"
            href="/dashboard/cmdb"
            color="var(--red)"
          />
          <StatCard
            icon="📉" iconClass="icon-amber"
            label="Low vCPU Util"
            value={fmt(lowUtil.low_vcpu)}
            sub="< 50% allocation used"
            href="/dashboard/inventory?utilization=low_vcpu"
          />
          <StatCard
            icon="📉" iconClass="icon-amber"
            label="Low Mem Util"
            value={fmt(lowUtil.low_mem)}
            sub="< 50% allocation used"
            href="/dashboard/inventory?utilization=low_mem"
          />
        </div>

        {/* ── VM breakdown + pipeline status ────────────── */}
        <div className="grid-2 mb-6">
          <div className="card">
            <div className="card-header">
              <span className="card-title">VM breakdown</span>
              <span style={{ fontSize: 12, color: 'var(--text3)' }}>
                {poweredOnPct}% powered on
              </span>
            </div>
            <div className="card-body">
              <div style={{ marginBottom: 16 }}>
                <div style={{
                  display: 'flex', justifyContent: 'space-between',
                  fontSize: 12, marginBottom: 6, color: 'var(--text2)',
                }}>
                  <span>Powered on</span>
                  <span>{fmt(vms.powered_on)}</span>
                </div>
                <div className="progress-bar">
                  <div className="progress-fill" style={{
                    width: `${poweredOnPct}%`,
                    background: 'var(--green)',
                  }} />
                </div>
              </div>
              <table style={{ width: '100%' }}>
                <tbody>
                  {[
                    ['Powered on',  vms.powered_on,   'badge-green'],
                    ['Powered off', vms.powered_off,  'badge-gray'],
                    ['Suspended',   vms.suspended,    'badge-amber'],
                    ['Windows VMs', vms.windows_count,'badge-blue'],
                    ['Linux VMs',   vms.linux_count,  'badge-blue'],
                  ].map(([label, value, badge]) => (
                    <tr key={String(label)}>
                      <td style={{
                        padding: '7px 0', color: 'var(--text2)',
                        borderBottom: '1px solid var(--border)', fontSize: 13,
                      }}>
                        {label}
                      </td>
                      <td style={{
                        padding: '7px 0', textAlign: 'right',
                        borderBottom: '1px solid var(--border)',
                      }}>
                        <span className={`badge ${badge}`}>
                          {fmt(Number(value))}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          <PipelineStatus pipelines={pipelines} />
        </div>

        {/* ── OS distribution + CMDB summary ────────────── */}
        <div className="grid-2 mb-6">
          <OSChart data={osData} />
          <div className="card">
            <div className="card-header">
              <span className="card-title">CMDB reconciliation</span>
              <span style={{ fontSize: 12, color: 'var(--text3)' }}>
                {fmtEST(cmdb.last_run)}
              </span>
            </div>
            <div className="card-body">
              <div style={{
                display: 'grid',
                gridTemplateColumns: '1fr 1fr',
                gap: 12, marginBottom: 16,
              }}>
                {[
                  {
                    label: 'Ghost VMs', value: cmdb.ghost_vms ?? 0,
                    sub: 'In VMware, missing from CMDB',
                    color: 'var(--red)', bg: 'var(--red-light)',
                    href: '/dashboard/cmdb?tab=ghost',
                  },
                  {
                    label: 'Attribute drift', value: cmdb.drift_total ?? 0,
                    sub: 'Values differ between sources',
                    color: 'var(--amber)', bg: 'var(--amber-light)',
                    href: '/dashboard/cmdb?tab=drift',
                  },
                ].map(item => (
                  <a key={item.label} href={item.href}
                     style={{ textDecoration: 'none' }}>
                    <div style={{
                      background: item.bg,
                      borderRadius: 'var(--radius)',
                      padding: 14, cursor: 'pointer',
                    }}>
                      <div style={{
                        fontSize: 24, fontWeight: 700, color: item.color,
                      }}>
                        {fmt(item.value)}
                      </div>
                      <div style={{
                        fontSize: 12, fontWeight: 600,
                        color: item.color, marginTop: 2,
                      }}>
                        {item.label}
                      </div>
                      <div style={{
                        fontSize: 11, color: 'var(--text3)', marginTop: 4,
                      }}>
                        {item.sub}
                      </div>
                    </div>
                  </a>
                ))}
              </div>
              <table style={{ width: '100%' }}>
                <tbody>
                  {[
                    ['Critical drift', cmdb.drift_critical ?? 0, 'badge-red'],
                    ['Warning drift',  cmdb.drift_warning  ?? 0, 'badge-amber'],
                    ['Info drift',     cmdb.drift_info     ?? 0, 'badge-blue'],
                  ].map(([label, value, badge]) => (
                    <tr key={String(label)}>
                      <td style={{
                        padding: '7px 0', color: 'var(--text2)',
                        borderBottom: '1px solid var(--border)', fontSize: 13,
                      }}>
                        {label}
                      </td>
                      <td style={{
                        padding: '7px 0', textAlign: 'right',
                        borderBottom: '1px solid var(--border)',
                      }}>
                        <span className={`badge ${badge}`}>
                          {fmt(Number(value))}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        {/* ── vCenter table ──────────────────────────────── */}
        <div className="card mb-6">
          <div className="card-header">
            <span className="card-title">
              vCenter inventory ({vcenters.length} vCenters)
            </span>
          </div>
          <VCenterTable vcenters={vcenters} />
        </div>

        {/* ── Datastore health ───────────────────────────── */}
        <div className="card">
          <div className="card-header">
            <span className="card-title">
              Top datastores by utilisation
            </span>
            <a href="/dashboard/datastores" style={{
              fontSize: 12, color: 'var(--blue)',
              textDecoration: 'none', fontWeight: 500,
            }}>
              View all →
            </a>
          </div>
          <DatastoreHealth datastores={dsData} />
        </div>

      </div>
    </>
  )
}
