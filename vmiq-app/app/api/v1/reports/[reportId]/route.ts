import { NextRequest, NextResponse } from 'next/server'
import pool from '@/lib/db'

// ── CSV helpers ────────────────────────────────────────────────

function toCSV(headers: string[], rows: any[][]): string {
  const escape = (v: any) => {
    if (v === null || v === undefined) return ''
    const s = String(v)
    if (s.includes(',') || s.includes('"') || s.includes('\n')) {
      return `"${s.replace(/"/g, '""')}"`
    }
    return s
  }
  const lines = [
    headers.join(','),
    ...rows.map(row => row.map(escape).join(',')),
  ]
  return lines.join('\n')
}

function csvResponse(filename: string, csv: string) {
  return new NextResponse(csv, {
    headers: {
      'Content-Type':        'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control':       'no-store',
    },
  })
}

function fmtDate(d: any) {
  return d ? new Date(d).toISOString().replace('T', ' ').substring(0, 19) : ''
}

function catFilter(category: string, alias = 'v') {
  if (!category || category === 'all') return ''
  return `AND COALESCE(${alias}.category,'Legacy') = '${category.replace(/'/g, "''")}'`
}

// ── Latest snapshot subquery ───────────────────────────────────
const LATEST = `
  SELECT DISTINCT ON (vcenter_id) id
  FROM vcenter_snapshots
  WHERE status='complete'
  ORDER BY vcenter_id, collected_at DESC
`

// ── Report handlers ────────────────────────────────────────────

async function vmInventory(category: string, powerstate: string) {
  const pw = powerstate !== 'all' ? `AND vm.powerstate = '${powerstate}'` : ''
  const { rows } = await pool.query(`
    SELECT
      COALESCE(v.category,'Legacy') AS "Category",
      v.name                         AS "vCenter",
      vm.name                        AS "VM Name",
      vm.powerstate                  AS "Power State",
      vm.vcpus                       AS "vCPUs",
      ROUND(vm.mem_mb/1024.0)        AS "Memory (GB)",
      ROUND(vm.disk_total_gb)        AS "Disk (GB)",
      vm.ip_address                  AS "IP Address",
      vm.os_fullname                 AS "Operating System",
      vm.hw_version                  AS "HW Version",
      vm.tools_status                AS "Tools Status",
      CASE WHEN vm.has_snapshots THEN 'Yes' ELSE 'No' END AS "Has Snapshots",
      CASE WHEN vm.has_rdm       THEN 'Yes' ELSE 'No' END AS "Has RDM",
      CASE WHEN vm.has_usb       THEN 'Yes' ELSE 'No' END AS "Has USB",
      CASE WHEN vm.has_cdrom     THEN 'Yes' ELSE 'No' END AS "Has CDROM",
      vm.annotation                  AS "Notes"
    FROM virtual_machines vm
    JOIN vcenter_snapshots s ON s.id = vm.snapshot_id
    JOIN vcenters v ON v.id = s.vcenter_id
    WHERE vm.snapshot_id IN (${LATEST})
    ${catFilter(category)} ${pw}
    ORDER BY v.category, v.name, vm.name
  `)
  return rows
}

async function hostInventory(category: string) {
  const { rows } = await pool.query(`
    SELECT
      COALESCE(v.category,'Legacy') AS "Category",
      v.name                         AS "vCenter",
      c.name                         AS "Cluster",
      h.name                         AS "Host Name",
      h.esxi_version                 AS "ESXi Version",
      h.model                        AS "Model",
      h.vendor                       AS "Vendor",
      h.cpu_sockets                  AS "CPU Sockets",
      h.cpu_cores                    AS "CPU Cores",
      ROUND(h.mem_total_mb/1024.0)   AS "Memory (GB)",
      h.connection_state             AS "Connection State",
      CASE WHEN h.is_in_maintenance THEN 'Yes' ELSE 'No' END AS "In Maintenance",
      COUNT(vm.id)                   AS "VM Count"
    FROM esx_hosts h
    JOIN vcenter_snapshots s ON s.id = h.snapshot_id
    JOIN vcenters v ON v.id = s.vcenter_id
    LEFT JOIN clusters c ON c.id = h.cluster_id
    LEFT JOIN virtual_machines vm ON vm.snapshot_id = h.snapshot_id AND vm.host_id = h.id
    WHERE h.snapshot_id IN (${LATEST})
    ${catFilter(category)}
    GROUP BY v.category,v.name,c.name,h.name,h.esxi_version,h.model,h.vendor,
             h.cpu_sockets,h.cpu_cores,h.mem_total_mb,h.connection_state,h.is_in_maintenance
    ORDER BY v.category, v.name, c.name, h.name
  `)
  return rows
}

async function clusterSummary(category: string) {
  const { rows } = await pool.query(`
    SELECT
      COALESCE(v.category,'Legacy')   AS "Category",
      v.name                           AS "vCenter",
      c.name                           AS "Cluster",
      c.host_count                     AS "Host Count",
      c.vm_count                       AS "VM Count",
      COALESCE(SUM(vm.vcpus),0)        AS "Allocated vCPUs",
      ROUND(COALESCE(SUM(vm.mem_mb),0)/1024.0) AS "Allocated Memory (GB)",
      ROUND(c.mem_total_mb/1024.0)     AS "Total Memory (GB)",
      c.cpu_total_mhz                  AS "Total CPU (MHz)"
    FROM clusters c
    JOIN vcenter_snapshots s ON s.id = c.snapshot_id
    JOIN vcenters v ON v.id = s.vcenter_id
    LEFT JOIN virtual_machines vm ON vm.snapshot_id=c.snapshot_id AND vm.cluster_id=c.id
    WHERE c.snapshot_id IN (${LATEST})
    ${catFilter(category)}
    GROUP BY v.category,v.name,c.name,c.host_count,c.vm_count,c.mem_total_mb,c.cpu_total_mhz
    ORDER BY v.category, v.name, c.name
  `)
  return rows
}

async function datastoreCapacity(category: string) {
  const { rows } = await pool.query(`
    SELECT
      COALESCE(v.category,'Legacy') AS "Category",
      v.name                         AS "vCenter",
      d.name                         AS "Datastore",
      d.type                         AS "Type",
      ROUND(d.capacity_gb)           AS "Capacity (GB)",
      ROUND(d.free_gb)               AS "Free (GB)",
      ROUND(d.capacity_gb - d.free_gb) AS "Used (GB)",
      d.used_pct                     AS "Used (%)",
      d.vm_count                     AS "VM Count"
    FROM datastores d
    JOIN vcenter_snapshots s ON s.id = d.snapshot_id
    JOIN vcenters v ON v.id = s.vcenter_id
    WHERE d.snapshot_id IN (${LATEST})
      AND d.capacity_gb > 0
    ${catFilter(category)}
    ORDER BY d.used_pct DESC
  `)
  return rows
}

async function vmOsSummary(category: string) {
  const { rows } = await pool.query(`
    WITH latest AS (${LATEST}),
    grouped AS (
      SELECT
        COALESCE(v.category,'Legacy') AS category,
        v.name AS vcenter,
        CASE
          WHEN lower(vm.os_fullname) LIKE '%windows server 2022%' THEN 'Windows Server 2022'
          WHEN lower(vm.os_fullname) LIKE '%windows server 2019%' THEN 'Windows Server 2019'
          WHEN lower(vm.os_fullname) LIKE '%windows server 2016%' THEN 'Windows Server 2016'
          WHEN lower(vm.os_fullname) LIKE '%windows server 2012%' THEN 'Windows Server 2012'
          WHEN lower(vm.os_fullname) LIKE '%windows server 2008%' THEN 'Windows Server 2008'
          WHEN lower(vm.os_fullname) LIKE '%windows%'             THEN 'Windows Other'
          WHEN lower(vm.os_fullname) LIKE '%red hat%9%'           THEN 'RHEL 9'
          WHEN lower(vm.os_fullname) LIKE '%red hat%8%'           THEN 'RHEL 8'
          WHEN lower(vm.os_fullname) LIKE '%red hat%7%'           THEN 'RHEL 7'
          WHEN lower(vm.os_fullname) LIKE '%red hat%6%'           THEN 'RHEL 6'
          WHEN lower(vm.os_fullname) LIKE '%red hat%'             THEN 'RHEL Other'
          WHEN lower(vm.os_fullname) LIKE '%centos%'              THEN 'CentOS'
          WHEN lower(vm.os_fullname) LIKE '%ubuntu%'              THEN 'Ubuntu'
          WHEN lower(vm.os_fullname) LIKE '%oracle%'              THEN 'Oracle Linux'
          WHEN lower(vm.os_fullname) LIKE '%suse%'                THEN 'SUSE Linux'
          WHEN vm.os_fullname IS NULL OR trim(vm.os_fullname)=''  THEN 'Not Available'
          ELSE 'Other'
        END AS os_group
      FROM virtual_machines vm
      JOIN vcenter_snapshots s ON s.id = vm.snapshot_id
      JOIN vcenters v ON v.id = s.vcenter_id
      WHERE vm.snapshot_id IN (SELECT id FROM latest)
      ${catFilter(category)}
    )
    SELECT category AS "Category", vcenter AS "vCenter",
           os_group AS "OS Group", COUNT(*) AS "VM Count"
    FROM grouped
    GROUP BY category, vcenter, os_group
    ORDER BY category, vcenter, COUNT(*) DESC
  `)
  return rows
}

async function vcenterSummary(category: string) {
  const { rows } = await pool.query(`
    SELECT
      COALESCE(v.category,'Legacy')     AS "Category",
      v.name                             AS "vCenter",
      s.vm_count                         AS "Total VMs",
      s.host_count                       AS "Total Hosts",
      s.cluster_count                    AS "Total Clusters",
      COALESCE(stats.powered_on,0)       AS "VMs Powered On",
      COALESCE(stats.powered_off,0)      AS "VMs Powered Off",
      COALESCE(stats.total_vcpus,0)      AS "Total vCPUs",
      ROUND(COALESCE(stats.total_mem_gb,0)) AS "Total Memory (GB)",
      ROUND(COALESCE(stats.total_disk_gb,0)) AS "Total Disk (GB)",
      COALESCE(stats.windows_vms,0)      AS "Windows VMs",
      COALESCE(stats.linux_vms,0)        AS "Linux VMs",
      COALESCE(stats.snapshot_vms,0)     AS "VMs with Snapshots",
      COALESCE(stats.rdm_vms,0)          AS "VMs with RDM",
      s.collected_at                     AS "Snapshot Time"
    FROM vcenters v
    JOIN (
      SELECT DISTINCT ON (vcenter_id) id, vcenter_id, collected_at,
             vm_count, host_count, cluster_count
      FROM vcenter_snapshots WHERE status='complete'
      ORDER BY vcenter_id, collected_at DESC
    ) s ON s.vcenter_id = v.id
    LEFT JOIN LATERAL (
      SELECT
        COUNT(*) FILTER (WHERE powerstate='poweredOn')  AS powered_on,
        COUNT(*) FILTER (WHERE powerstate='poweredOff') AS powered_off,
        SUM(vcpus)                                       AS total_vcpus,
        SUM(mem_mb)/1024                                AS total_mem_gb,
        SUM(disk_total_gb)                              AS total_disk_gb,
        COUNT(*) FILTER (WHERE lower(os_fullname) LIKE '%windows%') AS windows_vms,
        COUNT(*) FILTER (WHERE lower(os_fullname) LIKE '%linux%'
          OR lower(os_fullname) LIKE '%red hat%'
          OR lower(os_fullname) LIKE '%centos%')        AS linux_vms,
        COUNT(*) FILTER (WHERE has_snapshots)           AS snapshot_vms,
        COUNT(*) FILTER (WHERE has_rdm)                 AS rdm_vms
      FROM virtual_machines WHERE snapshot_id = s.id
    ) stats ON true
    WHERE 1=1 ${catFilter(category)}
    ORDER BY v.category, v.name
  `)
  return rows
}

async function riskReport(category: string, risk_level: string) {
  const rl = risk_level !== 'all'
    ? `AND CASE WHEN vm.has_usb OR vm.has_rdm OR vm.vcpus>16 THEN 'blocking' ELSE 'warning' END = '${risk_level}'`
    : ''
  const { rows } = await pool.query(`
    SELECT
      COALESCE(v.category,'Legacy') AS "Category",
      v.name                         AS "vCenter",
      vm.name                        AS "VM Name",
      vm.powerstate                  AS "Power State",
      CASE
        WHEN vm.has_usb     THEN 'blocking'
        WHEN vm.has_rdm     THEN 'blocking'
        WHEN vm.vcpus > 16  THEN 'blocking'
        ELSE 'warning'
      END                            AS "Risk Level",
      CASE
        WHEN vm.has_usb      THEN 'USB Device'
        WHEN vm.has_rdm      THEN 'RDM Disk'
        WHEN vm.vcpus > 16   THEN 'High vCPU'
        WHEN vm.is_suspended THEN 'Suspended'
        WHEN vm.has_snapshots THEN 'Snapshot'
        WHEN vm.has_cdrom    THEN 'CD-ROM'
        ELSE 'Tools Issue'
      END                            AS "Risk Category",
      vm.vcpus                       AS "vCPUs",
      ROUND(vm.mem_mb/1024.0)        AS "Memory (GB)",
      vm.ip_address                  AS "IP Address",
      vm.os_fullname                 AS "Operating System",
      CASE WHEN vm.has_snapshots THEN 'Yes' ELSE 'No' END AS "Snapshots",
      CASE WHEN vm.has_rdm       THEN 'Yes' ELSE 'No' END AS "RDM",
      CASE WHEN vm.has_usb       THEN 'Yes' ELSE 'No' END AS "USB"
    FROM virtual_machines vm
    JOIN vcenter_snapshots s ON s.id = vm.snapshot_id
    JOIN vcenters v ON v.id = s.vcenter_id
    WHERE vm.snapshot_id IN (${LATEST})
      AND (vm.has_usb OR vm.has_rdm OR vm.vcpus>16 OR
           vm.is_suspended OR vm.has_snapshots OR vm.has_cdrom OR
           vm.tools_status NOT IN ('toolsOk','guestToolsRunning','toolsRunning'))
    ${catFilter(category)} ${rl}
    ORDER BY v.category, v.name, vm.name
  `)
  return rows
}

async function ghostVMs(category: string) {
  const { rows } = await pool.query(`
    SELECT
      COALESCE(v.category,'Legacy') AS "Category",
      v.name                         AS "vCenter",
      vm.name                        AS "VM Name",
      vm.powerstate                  AS "Power State",
      vm.vcpus                       AS "vCPUs",
      ROUND(vm.mem_mb/1024.0)        AS "Memory (GB)",
      vm.ip_address                  AS "IP Address",
      vm.os_fullname                 AS "Operating System",
      d.run_date                     AS "First Detected"
    FROM cmdb_drift_results d
    JOIN virtual_machines vm ON vm.id = d.vm_id
    JOIN vcenter_snapshots s ON s.id = vm.snapshot_id
    JOIN vcenters v ON v.id = s.vcenter_id
    WHERE d.run_date = (SELECT MAX(run_date) FROM cmdb_drift_results)
      AND d.match_status = 'vmware_only'
    ${catFilter(category)}
    ORDER BY v.category, v.name, vm.name
  `)
  return rows
}

async function cmdbDrift(category: string, severity: string) {
  const sv = severity !== 'all' ? `AND d.drift_severity = '${severity}'` : ''
  const { rows } = await pool.query(`
    SELECT
      COALESCE(v.category,'Legacy') AS "Category",
      v.name                         AS "vCenter",
      vm.name                        AS "VM Name",
      vm.powerstate                  AS "Power State",
      d.drift_severity               AS "Severity",
      d.drift_fields::text           AS "Drifted Fields (JSON)",
      d.run_date                     AS "Run Date"
    FROM cmdb_drift_results d
    JOIN virtual_machines vm ON vm.id = d.vm_id
    JOIN vcenter_snapshots s ON s.id = vm.snapshot_id
    JOIN vcenters v ON v.id = s.vcenter_id
    WHERE d.run_date = (SELECT MAX(run_date) FROM cmdb_drift_results)
      AND d.match_status = 'drift_detected'
    ${catFilter(category)} ${sv}
    ORDER BY d.drift_severity, v.name, vm.name
  `)
  return rows
}

async function snapshotReport(category: string) {
  const { rows } = await pool.query(`
    SELECT
      COALESCE(v.category,'Legacy') AS "Category",
      v.name                         AS "vCenter",
      vm.name                        AS "VM Name",
      vm.powerstate                  AS "Power State",
      vm.vcpus                       AS "vCPUs",
      ROUND(vm.mem_mb/1024.0)        AS "Memory (GB)",
      vm.ip_address                  AS "IP Address",
      vm.os_fullname                 AS "Operating System"
    FROM virtual_machines vm
    JOIN vcenter_snapshots s ON s.id = vm.snapshot_id
    JOIN vcenters v ON v.id = s.vcenter_id
    WHERE vm.snapshot_id IN (${LATEST})
      AND vm.has_snapshots = true
    ${catFilter(category)}
    ORDER BY v.category, v.name, vm.name
  `)
  return rows
}

// ── Route handler ──────────────────────────────────────────────

export async function GET(
  req: NextRequest,
  { params }: { params: { reportId: string } }
) {
  const { reportId } = params
  const sp       = req.nextUrl.searchParams
  const category = sp.get('category')  || 'all'
  const severity = sp.get('severity')  || 'all'
  const powerst  = sp.get('powerstate')|| 'all'
  const riskLvl  = sp.get('risk_level')|| 'all'
  const date     = new Date().toISOString().split('T')[0]

  try {
    let rows: any[] = []
    let filename    = `evit-${reportId}-${date}.csv`

    switch (reportId) {
      case 'vm-inventory':
        rows = await vmInventory(category, powerst); break
      case 'host-inventory':
        rows = await hostInventory(category); break
      case 'cluster-summary':
        rows = await clusterSummary(category); break
      case 'datastore-capacity':
        rows = await datastoreCapacity(category); break
      case 'vm-os-summary':
        rows = await vmOsSummary(category); break
      case 'vcenter-summary':
        rows = await vcenterSummary(category); break
      case 'risk-report':
        rows = await riskReport(category, riskLvl); break
      case 'ghost-vms':
        rows = await ghostVMs(category); break
      case 'cmdb-drift':
        rows = await cmdbDrift(category, severity); break
      case 'vm-snapshot-report':
        rows = await snapshotReport(category); break
      default:
        return NextResponse.json({ error: 'Unknown report' }, { status: 404 })
    }

    if (rows.length === 0) {
      const csv = 'No data found for the selected filters.\n'
      return csvResponse(filename, csv)
    }

    const headers = Object.keys(rows[0])
    const data    = rows.map(r => headers.map(h => r[h]))
    const csv     = toCSV(headers, data)
    return csvResponse(filename, csv)

  } catch (err: any) {
    console.error(`Report error [${reportId}]:`, err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
