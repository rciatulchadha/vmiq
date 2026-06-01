export const dynamic = 'force-dynamic'
import pool from '@/lib/db'

const RISK_TABS = [
  { key: 'all',        label: 'All Risks',        icon: '⚠️' },
  { key: 'rdm',        label: 'RDM Disks',        icon: '💾' },
  { key: 'snapshots',  label: 'Snapshots',        icon: '📸' },
  { key: 'usb',        label: 'USB Devices',      icon: '🔌' },
  { key: 'suspended',  label: 'Suspended VMs',    icon: '⏸️' },
  { key: 'cdrom',      label: 'CD-ROM',           icon: '💿' },
  { key: 'tools',      label: 'Tools Issues',     icon: '⚙️' },
  { key: 'high_vcpu',  label: 'High vCPU',        icon: '📊' },
]

function tabFilter(tab: string): string {
  switch (tab) {
    case 'rdm':       return 'AND vm.has_rdm = true'
    case 'snapshots': return 'AND vm.has_snapshots = true'
    case 'usb':       return 'AND vm.has_usb = true'
    case 'suspended': return 'AND vm.is_suspended = true'
    case 'cdrom':     return 'AND vm.has_cdrom = true'
    case 'tools':     return `AND vm.tools_status NOT IN ('toolsOk','guestToolsRunning','toolsRunning') AND vm.powerstate = 'poweredOn'`
    case 'high_vcpu': return 'AND vm.vcpus > 16'
    default:          return `AND (
      vm.has_rdm OR vm.has_usb OR vm.vcpus > 16 OR
      vm.is_suspended OR vm.has_snapshots OR vm.has_cdrom OR
      (vm.tools_status NOT IN ('toolsOk','guestToolsRunning','toolsRunning')
        AND vm.powerstate = 'poweredOn')
    )`
  }
}

async function getRisks(tab: string, page: number) {
  const limit  = 50
  const offset = (page - 1) * limit
  const filter = tabFilter(tab)

  const [risks, counts] = await Promise.all([
    pool.query(`
      WITH latest AS (
        SELECT DISTINCT ON (vcenter_id) id
        FROM vcenter_snapshots
        WHERE status='complete'
        ORDER BY vcenter_id, collected_at DESC
      )
      SELECT
        vm.name,
        vm.powerstate,
        vm.vcpus,
        vm.mem_mb,
        vm.has_rdm,
        vm.has_usb,
        vm.has_snapshots,
        vm.has_cdrom,
        vm.is_suspended,
        vm.tools_status,
        vm.hw_version,
        vm.ip_address,
        v.name  AS vcenter_name,
        e.name  AS estate,
        CASE
          WHEN vm.has_usb      THEN 'blocking'
          WHEN vm.has_rdm      THEN 'blocking'
          WHEN vm.vcpus > 16   THEN 'blocking'
          WHEN vm.is_suspended THEN 'warning'
          WHEN vm.has_snapshots THEN 'warning'
          WHEN vm.has_cdrom    THEN 'warning'
          WHEN vm.tools_status NOT IN ('toolsOk','guestToolsRunning','toolsRunning')
            AND vm.powerstate = 'poweredOn' THEN 'warning'
          ELSE 'info'
        END AS risk_level,
        CASE
          WHEN vm.has_usb      THEN 'USB Device'
          WHEN vm.has_rdm      THEN 'RDM Disk'
          WHEN vm.vcpus > 16   THEN 'High vCPU'
          WHEN vm.is_suspended THEN 'Suspended'
          WHEN vm.has_snapshots THEN 'Snapshot'
          WHEN vm.has_cdrom    THEN 'CD-ROM'
          WHEN vm.tools_status NOT IN ('toolsOk','guestToolsRunning','toolsRunning')
            AND vm.powerstate = 'poweredOn' THEN 'Tools Issue'
          ELSE 'Other'
        END AS risk_category,
        CASE
          WHEN vm.has_usb
            THEN 'vUSB device attached — blocks live migration'
          WHEN vm.has_rdm
            THEN 'RDM disk — incompatible with most migration targets'
          WHEN vm.vcpus > 16
            THEN 'High vCPU count (' || vm.vcpus || ') — verify target host'
          WHEN vm.is_suspended
            THEN 'VM is suspended — resume or power off first'
          WHEN vm.has_snapshots
            THEN 'Active snapshots present — consolidate before migration'
          WHEN vm.has_cdrom
            THEN 'CD-ROM connected — disconnect before migration'
          WHEN vm.tools_status NOT IN ('toolsOk','guestToolsRunning','toolsRunning')
            AND vm.powerstate = 'poweredOn'
            THEN 'VMware Tools not running (' || COALESCE(vm.tools_status,'unknown') || ')'
          ELSE 'Review required'
        END AS risk_description
      FROM virtual_machines vm
      JOIN vcenter_snapshots s ON s.id = vm.snapshot_id
      JOIN vcenters v ON v.id = s.vcenter_id
      LEFT JOIN estates e ON e.id = v.estate_id
      WHERE vm.snapshot_id IN (SELECT id FROM latest)
      ${filter}
      ORDER BY
        CASE WHEN vm.has_usb OR vm.has_rdm OR vm.vcpus > 16 THEN 1
             ELSE 2 END,
        vm.name
      LIMIT ${limit} OFFSET ${offset}
    `),

    pool.query(`
      WITH latest AS (
        SELECT DISTINCT ON (vcenter_id) id
        FROM vcenter_snapshots
        WHERE status='complete'
        ORDER BY vcenter_id, collected_at DESC
      )
      SELECT
        COUNT(*) FILTER (WHERE vm.has_usb OR vm.has_rdm OR vm.vcpus > 16)
          AS blocking,
        COUNT(*) FILTER (WHERE
          (vm.is_suspended OR vm.has_snapshots OR vm.has_cdrom OR
           (vm.tools_status NOT IN ('toolsOk','guestToolsRunning','toolsRunning')
            AND vm.powerstate = 'poweredOn'))
          AND NOT (vm.has_usb OR vm.has_rdm OR vm.vcpus > 16)
        ) AS warning,
        COUNT(*) FILTER (WHERE vm.has_usb)       AS usb_count,
        COUNT(*) FILTER (WHERE vm.has_rdm)       AS rdm_count,
        COUNT(*) FILTER (WHERE vm.vcpus > 16)    AS high_vcpu,
        COUNT(*) FILTER (WHERE vm.has_snapshots) AS snapshots,
        COUNT(*) FILTER (WHERE vm.is_suspended)  AS suspended,
        COUNT(*) FILTER (WHERE vm.has_cdrom)     AS cdrom_count,
        COUNT(*) FILTER (WHERE
          vm.tools_status NOT IN ('toolsOk','guestToolsRunning','toolsRunning')
          AND vm.powerstate = 'poweredOn'
        ) AS tools_issues
      FROM virtual_machines vm
      WHERE vm.snapshot_id IN (SELECT id FROM latest)
    `),
  ])

  const c = counts.rows[0]
  const tabCounts: Record<string, number> = {
    all:       Number(c.blocking) + Number(c.warning),
    rdm:       Number(c.rdm_count),
    snapshots: Number(c.snapshots),
    usb:       Number(c.usb_count),
    suspended: Number(c.suspended),
    cdrom:     Number(c.cdrom_count),
    tools:     Number(c.tools_issues),
    high_vcpu: Number(c.high_vcpu),
  }

  return { risks: risks.rows, counts: c, tabCounts, page, limit }
}

function fmt(n: number) { return Number(n).toLocaleString() }

export default async function RisksPage({
  searchParams,
}: {
  searchParams: { tab?: string; page?: string }
}) {
  const tab  = searchParams.tab  || 'all'
  const page = Number(searchParams.page) || 1
  const { risks, counts, tabCounts, limit } = await getRisks(tab, page)

  return (
    <>
      <div className="topbar">
        <div className="topbar-title">Risk Dashboard</div>
        <div className="topbar-right">
          <span className="last-updated">Latest RVTools snapshot</span>
        </div>
      </div>

      <div className="page">

        {/* Summary cards */}
        <div className="stat-grid mb-6">
          {[
            { label:'Blocking',       value:counts.blocking,   color:'var(--red)',   bg:'var(--red-light)',   tab:'all'       },
            { label:'Warnings',       value:counts.warning,    color:'var(--amber)', bg:'var(--amber-light)', tab:'all'       },
            { label:'RDM Disks',      value:counts.rdm_count,  color:'var(--red)',   bg:'var(--red-light)',   tab:'rdm'       },
            { label:'USB Devices',    value:counts.usb_count,  color:'var(--red)',   bg:'var(--red-light)',   tab:'usb'       },
            { label:'Has Snapshots',  value:counts.snapshots,  color:'var(--amber)', bg:'var(--amber-light)', tab:'snapshots' },
            { label:'Suspended VMs',  value:counts.suspended,  color:'var(--amber)', bg:'var(--amber-light)', tab:'suspended' },
            { label:'CD-ROM',         value:counts.cdrom_count,color:'var(--amber)', bg:'var(--amber-light)', tab:'cdrom'     },
            { label:'Tools Issues',   value:counts.tools_issues,color:'var(--amber)',bg:'var(--amber-light)', tab:'tools'     },
          ].map(card => (
            <a key={card.label} href={`?tab=${card.tab}&page=1`}
               style={{ textDecoration: 'none' }}>
              <div className="stat-card"
                   style={{ background: card.bg, cursor: 'pointer' }}>
                <div className="stat-label">{card.label}</div>
                <div className="stat-value" style={{ color: card.color }}>
                  {fmt(card.value)}
                </div>
              </div>
            </a>
          ))}
        </div>

        {/* Risk category tabs */}
        <div style={{
          display: 'flex', gap: 0, flexWrap: 'wrap',
          borderBottom: '1px solid var(--border)',
          marginBottom: 16,
        }}>
          {RISK_TABS.map(t => (
            <a key={t.key} href={`?tab=${t.key}&page=1`} style={{
              display: 'flex', alignItems: 'center', gap: 5,
              padding: '8px 14px', fontSize: 12,
              borderBottom: tab === t.key
                ? '2px solid var(--blue)'
                : '2px solid transparent',
              color: tab === t.key ? 'var(--text)' : 'var(--text2)',
              fontWeight: tab === t.key ? 600 : 400,
              textDecoration: 'none',
              whiteSpace: 'nowrap',
            }}>
              <span>{t.icon}</span>
              {t.label}
              {tabCounts[t.key] > 0 && (
                <span style={{
                  fontSize: 10,
                  background: tab === t.key ? 'var(--blue-light)' : 'var(--surface2)',
                  color: tab === t.key ? 'var(--blue)' : 'var(--text3)',
                  padding: '1px 5px', borderRadius: 8,
                }}>
                  {fmt(tabCounts[t.key])}
                </span>
              )}
            </a>
          ))}
        </div>

        {/* Risk table */}
        <div className="card">
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>VM Name</th>
                  <th>vCenter</th>
                  <th>Risk Level</th>
                  <th>Category</th>
                  <th>Description</th>
                  <th style={{textAlign:'right'}}>vCPUs</th>
                  <th style={{textAlign:'right'}}>Mem (GB)</th>
                  <th>Power</th>
                  <th>IP</th>
                </tr>
              </thead>
              <tbody>
                {risks.map((r, i) => (
                  <tr key={i}>
                    <td style={{fontWeight:500}}>{r.name}</td>
                    <td style={{fontSize:12,color:'var(--text2)'}}>
                      {r.vcenter_name}
                    </td>
                    <td>
                      <span className={`badge ${
                        r.risk_level === 'blocking' ? 'badge-red' : 'badge-amber'
                      }`}>
                        {r.risk_level}
                      </span>
                    </td>
                    <td>
                      <span className="badge badge-gray">{r.risk_category}</span>
                    </td>
                    <td style={{fontSize:12,color:'var(--text2)',maxWidth:280}}>
                      {r.risk_description}
                    </td>
                    <td style={{textAlign:'right'}}>{r.vcpus}</td>
                    <td style={{textAlign:'right'}}>
                      {Math.round(r.mem_mb / 1024)}
                    </td>
                    <td>
                      <span className={`badge ${
                        r.powerstate === 'poweredOn'  ? 'badge-green' :
                        r.powerstate === 'poweredOff' ? 'badge-gray'  : 'badge-amber'
                      }`}>
                        {r.powerstate === 'poweredOn'  ? 'On'  :
                         r.powerstate === 'poweredOff' ? 'Off' : 'Suspended'}
                      </span>
                    </td>
                    <td style={{fontSize:11,color:'var(--text3)'}}>
                      {r.ip_address || '—'}
                    </td>
                  </tr>
                ))}
                {risks.length === 0 && (
                  <tr>
                    <td colSpan={9} style={{
                      textAlign:'center', padding:'48px',
                      color:'var(--text3)', fontSize:14,
                    }}>
                      ✅ No risks found in this category
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {risks.length === limit && (
            <div style={{
              display:'flex', justifyContent:'flex-end',
              padding:'12px 16px',
              borderTop:'1px solid var(--border)', gap:6,
            }}>
              {page > 1 && (
                <a href={`?tab=${tab}&page=${page-1}`} style={{
                  padding:'4px 10px', borderRadius:'var(--radius)',
                  border:'1px solid var(--border)',
                  textDecoration:'none', color:'var(--text2)', fontSize:13,
                }}>← Prev</a>
              )}
              <a href={`?tab=${tab}&page=${page+1}`} style={{
                padding:'4px 10px', borderRadius:'var(--radius)',
                border:'1px solid var(--border)',
                textDecoration:'none', color:'var(--text2)', fontSize:13,
              }}>Next →</a>
            </div>
          )}
        </div>
      </div>
    </>
  )
}
