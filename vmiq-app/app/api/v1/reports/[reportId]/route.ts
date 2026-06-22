import { NextRequest, NextResponse } from 'next/server'
import pool from '@/lib/db'

// ── Allowed filter values (whitelist validation) ───────────────
const ALLOWED_CATEGORIES  = ['all', 'ITCC', 'Legacy']
const ALLOWED_POWERSTATE  = ['all', 'poweredOn', 'poweredOff', 'suspended']
const ALLOWED_SEVERITY    = ['all', 'critical', 'warning', 'info']
const ALLOWED_RISK_LEVEL  = ['all', 'blocking', 'warning']

function validate(value: string, allowed: string[], fallback = 'all'): string {
  return allowed.includes(value) ? value : fallback
}

// ── CSV helpers ────────────────────────────────────────────────
function toCSV(headers: string[], rows: any[][]): string {
  const escape = (v: any) => {
    if (v === null || v === undefined) return ''
    const s = String(v)
    return s.includes(',') || s.includes('"') || s.includes('\n')
      ? `"${s.replace(/"/g, '""')}"`
      : s
  }
  return [
    headers.join(','),
    ...rows.map(row => row.map(escape).join(',')),
  ].join('\n')
}

function csvResponse(filename: string, csv: string) {
  return new NextResponse(csv, {
    headers: {
      'Content-Type':        'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control':       'no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  })
}

// ── Latest snapshot subquery ───────────────────────────────────
const LATEST_SUBQ = `
  SELECT DISTINCT ON (vcenter_id) id
  FROM vcenter_snapshots
  WHERE status = 'complete'
  ORDER BY vcenter_id, collected_at DESC
`

// ── Parameterised category filter builder ─────────────────────
function catCondition(
  category: string,
  params: any[],
  alias = 'v'
): string {
  if (category === 'all') return ''
  params.push(category)
  return `AND COALESCE(${alias}.category, 'Legacy') = $${params.length}`
}

// ── Report functions — all use parameterised queries ──────────

async function vmInventory(category: string, powerstate: string) {
  const params: any[] = []
  const catCond = catCondition(category, params)
  let pwCond = ''
  if (powerstate !== 'all') {
    params.push(powerstate)
    pwCond = `AND vm.powerstate = $${params.length}`
  }
  const { rows } = await pool.query(`
    SELECT
      COALESCE(v.category,'Legacy')  AS "Category",
      v.name                          AS "vCenter",
      vm.name                         AS "VM Name",
      vm.powerstate                   AS "Power State",
      vm.vcpus                        AS "vCPUs",
      ROUND(vm.mem_mb/1024.0)         AS "Memory (GB)",
      ROUND(vm.disk_total_gb)         AS "Disk (GB)",
      vm.ip_address                   AS "IP Address",
      vm.os_fullname                  AS "Operating System",
      vm.hw_version                   AS "HW Version",
      vm.tools_status                 AS "Tools Status",
      CASE WHEN vm.has_snapshots THEN 'Yes' ELSE 'No' END AS "Has Snapshots",
      CASE WHEN vm.has_rdm       THEN 'Yes' ELSE 'No' END AS "Has RDM",
      CASE WHEN vm.has_usb       THEN 'Yes' ELSE 'No' END AS "Has USB",
      CASE WHEN vm.has_cdrom     THEN 'Yes' ELSE 'No' END AS "Has CDROM"
    FROM virtual_machines vm
    JOIN vcenter_snapshots s ON s.id = vm.snapshot_id
    JOIN vcenters v ON v.id = s.vcenter_id
    WHERE vm.snapshot_id IN (${LATEST_SUBQ})
    ${catCond} ${pwCond}
    ORDER BY v.category, v.name, vm.name
  `, params)
  return rows
}

async function hostInventory(category: string) {
  const params: any[] = []
  const catCond = catCondition(category, params)
  const { rows } = await pool.query(`
    SELECT
      COALESCE(v.category,'Legacy')  AS "Category",
      v.name                          AS "vCenter",
      c.name                          AS "Cluster",
      h.name                          AS "Host Name",
      h.esxi_version                  AS "ESXi Version",
      h.model                         AS "Model",
      h.vendor                        AS "Vendor",
      h.cpu_sockets                   AS "CPU Sockets",
      h.cpu_cores                     AS "CPU Cores",
      ROUND(h.mem_total_mb/1024.0)    AS "Memory (GB)",
      h.connection_state              AS "Connection State",
      CASE WHEN h.is_in_maintenance THEN 'Yes' ELSE 'No' END AS "In Maintenance",
      COUNT(vm.id)                    AS "VM Count"
    FROM esx_hosts h
    JOIN vcenter_snapshots s ON s.id = h.snapshot_id
    JOIN vcenters v ON v.id = s.vcenter_id
    LEFT JOIN clusters c ON c.id = h.cluster_id
    LEFT JOIN virtual_machines vm
      ON vm.snapshot_id = h.snapshot_id AND vm.host_id = h.id
    WHERE h.snapshot_id IN (${LATEST_SUBQ})
    ${catCond}
    GROUP BY v.category, v.name, c.name, h.name, h.esxi_version,
             h.model, h.vendor, h.cpu_sockets, h.cpu_cores,
             h.mem_total_mb, h.connection_state, h.is_in_maintenance
    ORDER BY v.category, v.name, c.name, h.name
  `, params)
  return rows
}

async function clusterSummary(category: string) {
  const params: any[] = []
  const catCond = catCondition(category, params)
  const { rows } = await pool.query(`
    SELECT
      COALESCE(v.category,'Legacy')    AS "Category",
      v.name                            AS "vCenter",
      c.name                            AS "Cluster",
      c.host_count                      AS "Host Count",
      c.vm_count                        AS "VM Count",
      COALESCE(SUM(vm.vcpus),0)         AS "Allocated vCPUs",
      ROUND(COALESCE(SUM(vm.mem_mb),0)/1024.0) AS "Allocated Memory (GB)",
      ROUND(c.mem_total_mb/1024.0)      AS "Total Memory (GB)",
      c.cpu_total_mhz                   AS "Total CPU (MHz)"
    FROM clusters c
    JOIN vcenter_snapshots s ON s.id = c.snapshot_id
    JOIN vcenters v ON v.id = s.vcenter_id
    LEFT JOIN virtual_machines vm
      ON vm.snapshot_id = c.snapshot_id AND vm.cluster_id = c.id
    WHERE c.snapshot_id IN (${LATEST_SUBQ})
    ${catCond}
    GROUP BY v.category, v.name, c.name, c.host_count,
             c.vm_count, c.mem_total_mb, c.cpu_total_mhz
    ORDER BY v.category, v.name, c.name
  `, params)
  return rows
}

async function datastoreCapacity(category: string) {
  const params: any[] = []
  const catCond = catCondition(category, params)
  const { rows } = await pool.query(`
    SELECT
      COALESCE(v.category,'Legacy') AS "Category",
      v.name                         AS "vCenter",
      d.name                         AS "Datastore",
      d.type                         AS "Type",
      ROUND(d.capacity_gb)           AS "Capacity (GB)",
      ROUND(d.free_gb)               AS "Free (GB)",
      ROUND(d.capacity_gb-d.free_gb) AS "Used (GB)",
      d.used_pct                     AS "Used (%)",
      d.vm_count                     AS "VM Count"
    FROM datastores d
    JOIN vcenter_snapshots s ON s.id = d.snapshot_id
    JOIN vcenters v ON v.id = s.vcenter_id
    WHERE d.snapshot_id IN (${LATEST_SUBQ})
      AND d.capacity_gb > 0
    ${catCond}
    ORDER BY d.used_pct DESC
  `, params)
  return rows
}

async function vmOsSummary(category: string) {
  const params: any[] = []
  const catCond = catCondition(category, params)
  const { rows } = await pool.query(`
    WITH latest AS (${LATEST_SUBQ}),
    grouped AS (
      SELECT
        COALESCE(v.category,'Legacy') AS category,
        v.name AS vcenter,
        CASE
          WHEN lower(vm.os_fullname) LIKE '%windows server 2022%' THEN 'Windows Server 2022'
          WHEN lower(vm.os_fullname) LIKE '%windows server 2019%' THEN 'Windows Server 2019'
          WHEN lower(vm.os_fullname) LIKE '%windows server 2016%' THEN 'Windows Server 2016'
          WHEN lower(vm.os_fullname) LIKE '%windows server 2012%' THEN 'Windows Server 2012'
          WHEN lower(vm.os_fullname) LIKE '%windows%'             THEN 'Windows Other'
          WHEN lower(vm.os_fullname) LIKE '%red hat%9%'           THEN 'RHEL 9'
          WHEN lower(vm.os_fullname) LIKE '%red hat%8%'           THEN 'RHEL 8'
          WHEN lower(vm.os_fullname) LIKE '%red hat%7%'           THEN 'RHEL 7'
          WHEN lower(vm.os_fullname) LIKE '%red hat%'             THEN 'RHEL Other'
          WHEN lower(vm.os_fullname) LIKE '%centos%'              THEN 'CentOS'
          WHEN lower(vm.os_fullname) LIKE '%ubuntu%'              THEN 'Ubuntu'
          WHEN lower(vm.os_fullname) LIKE '%oracle%'              THEN 'Oracle Linux'
          WHEN vm.os_fullname IS NULL OR trim(vm.os_fullname)=''  THEN 'Not Available'
          ELSE 'Other'
        END AS os_group
      FROM virtual_machines vm
      JOIN vcenter_snapshots s ON s.id = vm.snapshot_id
      JOIN vcenters v ON v.id = s.vcenter_id
      WHERE vm.snapshot_id IN (SELECT id FROM latest)
      ${catCond}
    )
    SELECT category AS "Category", vcenter AS "vCenter",
           os_group AS "OS Group", COUNT(*) AS "VM Count"
    FROM grouped
    GROUP BY category, vcenter, os_group
    ORDER BY category, vcenter, COUNT(*) DESC
  `, params)
  return rows
}

async function vcenterSummary(category: string) {
  const params: any[] = []
  const catCond = catCondition(category, params)
  const { rows } = await pool.query(`
    SELECT
      COALESCE(v.category,'Legacy')      AS "Category",
      v.name                              AS "vCenter",
      s.vm_count                          AS "Total VMs",
      s.host_count                        AS "Total Hosts",
      s.cluster_count                     AS "Total Clusters",
      COALESCE(stats.powered_on,0)        AS "VMs Powered On",
      COALESCE(stats.powered_off,0)       AS "VMs Powered Off",
      COALESCE(stats.total_vcpus,0)       AS "Total vCPUs",
      ROUND(COALESCE(stats.total_mem_gb,0)) AS "Total Memory (GB)",
      ROUND(COALESCE(stats.total_disk_gb,0)) AS "Total Disk (GB)",
      COALESCE(stats.windows_vms,0)       AS "Windows VMs",
      COALESCE(stats.linux_vms,0)         AS "Linux VMs",
      COALESCE(stats.snapshot_vms,0)      AS "VMs with Snapshots",
      COALESCE(stats.rdm_vms,0)           AS "VMs with RDM",
      TO_CHAR(s.collected_at AT TIME ZONE 'America/Toronto',
              'YYYY-MM-DD HH24:MI') || ' EST' AS "Snapshot Time"
    FROM vcenters v
    JOIN (
      SELECT DISTINCT ON (vcenter_id)
        id, vcenter_id, collected_at,
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
        COUNT(*) FILTER (WHERE lower(os_fullname) LIKE '%red hat%'
          OR lower(os_fullname) LIKE '%centos%'
          OR lower(os_fullname) LIKE '%linux%')         AS linux_vms,
        COUNT(*) FILTER (WHERE has_snapshots)           AS snapshot_vms,
        COUNT(*) FILTER (WHERE has_rdm)                 AS rdm_vms
      FROM virtual_machines WHERE snapshot_id = s.id
    ) stats ON true
    WHERE 1=1 ${catCond}
    ORDER BY v.category, v.name
  `, params)
  return rows
}

async function riskReport(category: string, risk_level: string) {
  const params: any[] = []
  const catCond = catCondition(category, params)
  let rlCond = ''
  if (risk_level === 'blocking') {
    rlCond = 'AND (vm.has_usb OR vm.has_rdm OR vm.vcpus > 16)'
  } else if (risk_level === 'warning') {
    rlCond = 'AND NOT (vm.has_usb OR vm.has_rdm OR vm.vcpus > 16)'
  }
  const { rows } = await pool.query(`
    SELECT
      COALESCE(v.category,'Legacy') AS "Category",
      v.name                         AS "vCenter",
      vm.name                        AS "VM Name",
      vm.powerstate                  AS "Power State",
      CASE
        WHEN vm.has_usb OR vm.has_rdm OR vm.vcpus > 16 THEN 'blocking'
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
      vm.os_fullname                 AS "Operating System"
    FROM virtual_machines vm
    JOIN vcenter_snapshots s ON s.id = vm.snapshot_id
    JOIN vcenters v ON v.id = s.vcenter_id
    WHERE vm.snapshot_id IN (${LATEST_SUBQ})
      AND (vm.has_usb OR vm.has_rdm OR vm.vcpus > 16 OR
           vm.is_suspended OR vm.has_snapshots OR vm.has_cdrom)
    ${catCond} ${rlCond}
    ORDER BY v.category, v.name, vm.name
  `, params)
  return rows
}

async function ghostVMs(category: string) {
  const params: any[] = []
  const catCond = catCondition(category, params)
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
    ${catCond}
    ORDER BY v.category, v.name, vm.name
  `, params)
  return rows
}

async function cmdbDrift(category: string, severity: string) {
  const params: any[] = []
  const catCond = catCondition(category, params)
  let sevCond = ''
  if (severity !== 'all') {
    params.push(severity)
    sevCond = `AND d.drift_severity = $${params.length}`
  }
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
    ${catCond} ${sevCond}
    ORDER BY d.drift_severity, v.name, vm.name
  `, params)
  return rows
}

async function snapshotReport(category: string) {
  const params: any[] = []
  const catCond = catCondition(category, params)
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
    WHERE vm.snapshot_id IN (${LATEST_SUBQ})
      AND vm.has_snapshots = true
    ${catCond}
    ORDER BY v.category, v.name, vm.name
  `, params)
  return rows
}

// ── Route handler ──────────────────────────────────────────────
export async function GET(
  req: NextRequest,
  { params }: { params: { reportId: string } }
) {
  const { reportId } = params
  const sp = req.nextUrl.searchParams

  // Whitelist-validate all filter inputs
  const category  = validate(sp.get('category')   || 'all', ALLOWED_CATEGORIES)
  const severity  = validate(sp.get('severity')   || 'all', ALLOWED_SEVERITY)
  const powerst   = validate(sp.get('powerstate') || 'all', ALLOWED_POWERSTATE)
  const riskLvl   = validate(sp.get('risk_level') || 'all', ALLOWED_RISK_LEVEL)
  const date      = new Date().toISOString().split('T')[0]
  const filename  = `evit-${reportId}-${date}.csv`

  try {
    let rows: any[] = []

    switch (reportId) {
      case 'vm-inventory':      rows = await vmInventory(category, powerst); break
      case 'host-inventory':    rows = await hostInventory(category);        break
      case 'cluster-summary':   rows = await clusterSummary(category);       break
      case 'datastore-capacity':rows = await datastoreCapacity(category);    break
      case 'vm-os-summary':     rows = await vmOsSummary(category);          break
      case 'vcenter-summary':   rows = await vcenterSummary(category);       break
      case 'risk-report':       rows = await riskReport(category, riskLvl); break
      case 'ghost-vms':         rows = await ghostVMs(category);             break
      case 'cmdb-drift':        rows = await cmdbDrift(category, severity);  break
      case 'vm-snapshot-report':rows = await snapshotReport(category);       break
      default:
        return NextResponse.json(
          { error: 'Unknown report type' }, { status: 404 })
    }

    if (rows.length === 0) {
      return csvResponse(filename, 'No data found for the selected filters.\n')
    }

    const headers = Object.keys(rows[0])
    const data    = rows.map(r => headers.map(h => r[h]))
    return csvResponse(filename, toCSV(headers, data))

  } catch (err: any) {
    // Log error code internally — never expose to client
    console.error(`[report:${reportId}] code=${err.code} routine=${err.routine}`)
    return NextResponse.json(
      { error: 'Report generation failed. Check server logs.' },
      { status: 500 }
    )
  }
}
