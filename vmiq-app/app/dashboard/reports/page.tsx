export const dynamic = 'force-dynamic'
import pool from '@/lib/db'

async function getSummary() {
  const { rows } = await pool.query(`
    WITH latest AS (
      SELECT DISTINCT ON (vcenter_id) id
      FROM vcenter_snapshots WHERE status='complete'
      ORDER BY vcenter_id, collected_at DESC
    )
    SELECT
      COUNT(DISTINCT s.vcenter_id)               AS vcenters,
      SUM(s.vm_count)                            AS total_vms,
      MAX(s.collected_at)                        AS last_updated,
      COUNT(DISTINCT v.category)                 AS categories
    FROM vcenter_snapshots s
    JOIN vcenters v ON v.id = s.vcenter_id
    WHERE s.id IN (SELECT id FROM latest)
  `)
  return rows[0]
}

const REPORTS = [
  {
    id:          'vm-inventory',
    title:       'VM Inventory',
    description: 'All virtual machines with power state, OS, vCPU, memory, disk, IP, and flags.',
    category:    'Inventory',
    icon:        '▣',
    params:      [
      { name: 'category',   label: 'Category',    type: 'select', options: ['All','ITCC','Legacy'] },
      { name: 'powerstate', label: 'Power state',  type: 'select', options: ['All','poweredOn','poweredOff','suspended'] },
    ],
  },
  {
    id:          'host-inventory',
    title:       'ESXi Host Inventory',
    description: 'All ESXi hosts with version, model, CPU, memory, and VM count.',
    category:    'Inventory',
    icon:        '◫',
    params:      [
      { name: 'category', label: 'Category', type: 'select', options: ['All','ITCC','Legacy'] },
    ],
  },
  {
    id:          'cluster-summary',
    title:       'Cluster Summary',
    description: 'Cluster capacity — hosts, VMs, allocated vCPU and memory.',
    category:    'Inventory',
    icon:        '◈',
    params:      [
      { name: 'category', label: 'Category', type: 'select', options: ['All','ITCC','Legacy'] },
    ],
  },
  {
    id:          'datastore-capacity',
    title:       'Datastore Capacity',
    description: 'Datastore utilisation — capacity, free space, and usage percentage.',
    category:    'Capacity',
    icon:        '◧',
    params:      [
      { name: 'category', label: 'Category', type: 'select', options: ['All','ITCC','Legacy'] },
    ],
  },
  {
    id:          'vm-os-summary',
    title:       'OS Distribution Summary',
    description: 'VM count grouped by operating system across all vCenters.',
    category:    'Summary',
    icon:        '⊡',
    params:      [
      { name: 'category', label: 'Category', type: 'select', options: ['All','ITCC','Legacy'] },
    ],
  },
  {
    id:          'vcenter-summary',
    title:       'vCenter Summary',
    description: 'Per-vCenter totals — VMs, hosts, clusters, vCPUs, memory.',
    category:    'Summary',
    icon:        '⬡',
    params:      [
      { name: 'category', label: 'Category', type: 'select', options: ['All','ITCC','Legacy'] },
    ],
  },
  {
    id:          'risk-report',
    title:       'Risk Report',
    description: 'All VMs with blocking or warning risks — RDM, USB, snapshots, tools issues.',
    category:    'Risk',
    icon:        '⚠',
    params:      [
      { name: 'category',  label: 'Category',   type: 'select', options: ['All','ITCC','Legacy'] },
      { name: 'risk_level',label: 'Risk level', type: 'select', options: ['All','blocking','warning'] },
    ],
  },
  {
    id:          'ghost-vms',
    title:       'Ghost VMs Report',
    description: 'VMs present in VMware but not registered in CMDB.',
    category:    'CMDB',
    icon:        '⊞',
    params:      [
      { name: 'category', label: 'Category', type: 'select', options: ['All','ITCC','Legacy'] },
    ],
  },
  {
    id:          'cmdb-drift',
    title:       'CMDB Attribute Drift',
    description: 'VMs where VMware attributes differ from CMDB values.',
    category:    'CMDB',
    icon:        '⊟',
    params:      [
      { name: 'category', label: 'Category',  type: 'select', options: ['All','ITCC','Legacy'] },
      { name: 'severity', label: 'Severity',  type: 'select', options: ['All','critical','warning','info'] },
    ],
  },
  {
    id:          'vm-snapshot-report',
    title:       'VMs with Snapshots',
    description: 'All powered-on VMs that have active snapshots.',
    category:    'Risk',
    icon:        '📸',
    params:      [
      { name: 'category', label: 'Category', type: 'select', options: ['All','ITCC','Legacy'] },
    ],
  },
]

const CATEGORY_COLORS: Record<string, string> = {
  'Inventory': 'var(--blue)',
  'Capacity':  'var(--purple)',
  'Summary':   'var(--green)',
  'Risk':      'var(--red)',
  'CMDB':      'var(--amber)',
}

const CATEGORY_BG: Record<string, string> = {
  'Inventory': 'var(--blue-light)',
  'Capacity':  'var(--purple-light)',
  'Summary':   'var(--green-light)',
  'Risk':      'var(--red-light)',
  'CMDB':      'var(--amber-light)',
}

export default async function ReportsPage() {
  const summary = await getSummary()
  const groups  = [...new Set(REPORTS.map(r => r.category))]

  function fmtDate(d: any) {
    if (!d) return '—'
    return new Date(d).toLocaleString('en-US', {
      timeZone: 'America/Toronto',
      month: 'short', day: 'numeric',
      hour: '2-digit', minute: '2-digit', hour12: true,
    }) + ' EST'
  }

  return (
    <>
      <div className="topbar">
        <div className="topbar-title">Reports</div>
        <div className="topbar-right">
          <span className="last-updated">
            Data as of: {fmtDate(summary?.last_updated)}
          </span>
        </div>
      </div>

      <div className="page">

        {/* Summary banner */}
        <div style={{
          display: 'flex', gap: 16, marginBottom: 28,
          background: 'var(--surface)',
          border: '1px solid var(--border)',
          borderRadius: 'var(--radius)',
          padding: '16px 20px',
          alignItems: 'center',
        }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)', marginBottom: 4 }}>
              {Number(summary?.total_vms || 0).toLocaleString()} VMs across{' '}
              {Number(summary?.vcenters || 0)} vCenters
            </div>
            <div style={{ fontSize: 12, color: 'var(--text3)' }}>
              Select a report below, apply filters, then download as CSV
            </div>
          </div>
          <div style={{ fontSize: 11, color: 'var(--text3)', textAlign: 'right' }}>
            {REPORTS.length} reports available
          </div>
        </div>

        {/* Report groups */}
        {groups.map(group => (
          <div key={group} style={{ marginBottom: 32 }}>
            <div style={{
              display: 'flex', alignItems: 'center', gap: 10,
              marginBottom: 14,
            }}>
              <div style={{
                width: 4, height: 20, borderRadius: 2,
                background: CATEGORY_COLORS[group] || 'var(--blue)',
              }} />
              <h2 style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)' }}>
                {group}
              </h2>
              <span style={{ fontSize: 12, color: 'var(--text3)' }}>
                {REPORTS.filter(r => r.category === group).length} reports
              </span>
            </div>

            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))',
              gap: 14,
            }}>
              {REPORTS.filter(r => r.category === group).map(report => (
                <ReportCard key={report.id} report={report} />
              ))}
            </div>
          </div>
        ))}
      </div>
    </>
  )
}

function ReportCard({ report }: { report: typeof REPORTS[0] }) {
  const color = CATEGORY_COLORS[report.category] || 'var(--blue)'
  const bg    = CATEGORY_BG[report.category]     || 'var(--blue-light)'

  return (
    <div className="card" style={{ overflow: 'visible' }}>
      <div className="card-body">
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, marginBottom: 10 }}>
          <div style={{
            width: 36, height: 36, borderRadius: 8,
            background: bg, color, fontSize: 18,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            flexShrink: 0,
          }}>
            {report.icon}
          </div>
          <div>
            <div style={{ fontWeight: 600, fontSize: 13, color: 'var(--text)' }}>
              {report.title}
            </div>
            <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 3, lineHeight: 1.4 }}>
              {report.description}
            </div>
          </div>
        </div>

        {/* Inline filter form */}
        <form
          action={`/api/v1/reports/${report.id}`}
          method="GET"
          style={{ display: 'flex', flexDirection: 'column', gap: 8 }}
        >
          {report.params.map(param => (
            <div key={param.name} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <label style={{
                fontSize: 11, color: 'var(--text2)',
                width: 80, flexShrink: 0,
              }}>
                {param.label}
              </label>
              <select
                name={param.name}
                style={{
                  flex: 1, padding: '5px 8px',
                  borderRadius: 'var(--radius)',
                  border: '1px solid var(--border)',
                  fontSize: 12, background: 'var(--bg)',
                  color: 'var(--text)',
                }}
              >
                {param.options.map((opt: string) => (
                  <option key={opt} value={opt === 'All' ? 'all' : opt}>
                    {opt}
                  </option>
                ))}
              </select>
            </div>
          ))}

          {/* Download button */}
          <button
            type="submit"
            style={{
              marginTop: 6,
              padding: '8px 16px',
              borderRadius: 'var(--radius)',
              background: color, color: '#fff',
              border: 'none', fontSize: 12,
              cursor: 'pointer', fontWeight: 500,
              display: 'flex', alignItems: 'center',
              justifyContent: 'center', gap: 6,
            }}
          >
            ↓ Download CSV
          </button>
        </form>
      </div>
    </div>
  )
}
