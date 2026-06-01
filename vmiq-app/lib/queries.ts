import pool from './db'

// ── Global summary ─────────────────────────────────────────────
export async function getGlobalSummary() {
  const { rows } = await pool.query(`
    WITH latest_snapshots AS (
      SELECT DISTINCT ON (vcenter_id)
        id, vcenter_id, collected_at, vm_count, host_count, cluster_count
      FROM vcenter_snapshots
      WHERE status = 'complete'
      ORDER BY vcenter_id, collected_at DESC
    )
    SELECT
      COUNT(DISTINCT ls.vcenter_id)                    AS vcenter_count,
      COALESCE(SUM(ls.cluster_count), 0)               AS cluster_count,
      COALESCE(SUM(ls.host_count), 0)                  AS host_count,
      COALESCE(SUM(ls.vm_count), 0)                    AS vm_count,
      MAX(ls.collected_at)                             AS last_updated
    FROM latest_snapshots ls
  `)
  return rows[0]
}

// ── VM breakdown ───────────────────────────────────────────────
export async function getVMBreakdown() {
  const { rows } = await pool.query(`
    WITH latest AS (
      SELECT DISTINCT ON (vcenter_id) id
      FROM vcenter_snapshots
      WHERE status = 'complete'
      ORDER BY vcenter_id, collected_at DESC
    )
    SELECT
      COUNT(*)                                              AS total,
      COUNT(*) FILTER (WHERE vm.powerstate = 'poweredOn')  AS powered_on,
      COUNT(*) FILTER (WHERE vm.powerstate = 'poweredOff') AS powered_off,
      COUNT(*) FILTER (WHERE vm.powerstate = 'suspended')  AS suspended,
      COUNT(*) FILTER (
        WHERE lower(vm.os_fullname) LIKE '%windows%'
           OR lower(vm.os_type) LIKE '%windows%'
      )                                                     AS windows_count,
      COUNT(*) FILTER (
        WHERE lower(vm.os_fullname) LIKE '%linux%'
           OR lower(vm.os_fullname) LIKE '%red hat%'
           OR lower(vm.os_fullname) LIKE '%centos%'
           OR lower(vm.os_fullname) LIKE '%ubuntu%'
           OR lower(vm.os_type) LIKE '%linux%'
      )                                                     AS linux_count,
      COALESCE(SUM(vm.vcpus), 0)                           AS total_vcpus,
      COALESCE(SUM(vm.mem_mb), 0) / 1024                   AS total_mem_gb,
      COALESCE(SUM(vm.disk_total_gb), 0)                   AS total_disk_gb
    FROM virtual_machines vm
    WHERE vm.snapshot_id IN (SELECT id FROM latest)
  `)
  return rows[0]
}

// ── Per-vCenter summary ────────────────────────────────────────
export async function getVCenterSummary() {
  const { rows } = await pool.query(`
    WITH latest AS (
      SELECT DISTINCT ON (vcenter_id)
        id, vcenter_id, collected_at,
        vm_count, host_count, cluster_count
      FROM vcenter_snapshots
      WHERE status = 'complete'
      ORDER BY vcenter_id, collected_at DESC
    )
    SELECT
      v.name                                    AS vcenter_name,
      e.name                                    AS estate,
      ls.vm_count,
      ls.host_count,
      ls.cluster_count,
      ls.collected_at,
      COALESCE(vm_stats.powered_on, 0)          AS powered_on,
      COALESCE(vm_stats.powered_off, 0)         AS powered_off,
      COALESCE(vm_stats.total_vcpus, 0)         AS total_vcpus,
      COALESCE(vm_stats.total_mem_gb, 0)        AS total_mem_gb
    FROM latest ls
    JOIN vcenters v ON v.id = ls.vcenter_id
    LEFT JOIN estates e ON e.id = v.estate_id
    LEFT JOIN LATERAL (
      SELECT
        COUNT(*) FILTER (WHERE powerstate = 'poweredOn')  AS powered_on,
        COUNT(*) FILTER (WHERE powerstate = 'poweredOff') AS powered_off,
        SUM(vcpus)                                         AS total_vcpus,
        SUM(mem_mb) / 1024                                AS total_mem_gb
      FROM virtual_machines
      WHERE snapshot_id = ls.id
    ) vm_stats ON true
    ORDER BY e.name NULLS LAST, v.name
  `)
  return rows
}

// ── Estate summary ─────────────────────────────────────────────
export async function getEstateSummary() {
  const { rows } = await pool.query(`
    WITH latest AS (
      SELECT DISTINCT ON (vcenter_id) id, vcenter_id
      FROM vcenter_snapshots
      WHERE status = 'complete'
      ORDER BY vcenter_id, collected_at DESC
    )
    SELECT
      COALESCE(e.name, 'Unknown')    AS estate,
      COUNT(DISTINCT v.id)           AS vcenter_count,
      COALESCE(SUM(vm.vcpus), 0)    AS total_vcpus,
      COALESCE(SUM(vm.mem_mb), 0) / 1024  AS total_mem_gb,
      COALESCE(SUM(vm.disk_total_gb), 0)  AS total_disk_gb,
      COUNT(vm.id)                   AS total_vms,
      COUNT(vm.id) FILTER (
        WHERE vm.powerstate = 'poweredOn') AS powered_on
    FROM latest ls
    JOIN vcenters v ON v.id = ls.vcenter_id
    LEFT JOIN estates e ON e.id = v.estate_id
    LEFT JOIN virtual_machines vm ON vm.snapshot_id = ls.id
    GROUP BY e.name
    ORDER BY e.name
  `)
  return rows
}

// ── CMDB drift summary ─────────────────────────────────────────
export async function getCMDBDriftSummary() {
  const { rows } = await pool.query(`
    SELECT
      COUNT(*) FILTER (WHERE match_status = 'vmware_only')    AS ghost_vms,
      COUNT(*) FILTER (WHERE match_status = 'drift_detected') AS drift_total,
      COUNT(*) FILTER (
        WHERE match_status = 'drift_detected'
          AND drift_severity = 'critical')                    AS drift_critical,
      COUNT(*) FILTER (
        WHERE match_status = 'drift_detected'
          AND drift_severity = 'warning')                     AS drift_warning,
      COUNT(*) FILTER (
        WHERE match_status = 'drift_detected'
          AND drift_severity = 'info')                        AS drift_info,
      MAX(run_date)                                           AS last_run
    FROM cmdb_drift_results
    WHERE run_date = (SELECT MAX(run_date) FROM cmdb_drift_results)
  `)
  return rows[0]
}

// ── Pipeline status ────────────────────────────────────────────
export async function getPipelineStatus() {
  const { rows } = await pool.query(`
    SELECT
      pipeline,
      status,
      started_at,
      finished_at,
      records_out,
      error_message
    FROM pipeline_run_log
    WHERE run_date >= CURRENT_DATE - INTERVAL '1 day'
    ORDER BY started_at DESC
  `)
  return rows
}

// ── Datastore health ───────────────────────────────────────────
export async function getDatastoreHealth() {
  const { rows } = await pool.query(`
    WITH latest AS (
      SELECT DISTINCT ON (vcenter_id) id
      FROM vcenter_snapshots
      WHERE status = 'complete'
      ORDER BY vcenter_id, collected_at DESC
    )
    SELECT
      name,
      type,
      capacity_gb,
      free_gb,
      used_pct,
      vm_count
    FROM datastores
    WHERE snapshot_id IN (SELECT id FROM latest)
      AND capacity_gb > 0
    ORDER BY used_pct DESC
    LIMIT 20
  `)
  return rows
}

// ── OS distribution ────────────────────────────────────────────
// All VMs included. Not Available shown for missing OS.
// Other/Not Available sorted to end of chart.
export async function getOSDistribution() {
  const { rows } = await pool.query(`
    WITH latest AS (
      SELECT DISTINCT ON (vcenter_id) id
      FROM vcenter_snapshots
      WHERE status = 'complete'
      ORDER BY vcenter_id, collected_at DESC
    ),
    grouped AS (
      SELECT
        CASE
          WHEN lower(os_fullname) LIKE '%windows server 2022%' THEN 'Windows Server 2022'
          WHEN lower(os_fullname) LIKE '%windows server 2019%' THEN 'Windows Server 2019'
          WHEN lower(os_fullname) LIKE '%windows server 2016%' THEN 'Windows Server 2016'
          WHEN lower(os_fullname) LIKE '%windows server 2012%' THEN 'Windows Server 2012'
          WHEN lower(os_fullname) LIKE '%windows server 2008%' THEN 'Windows Server 2008'
          WHEN lower(os_fullname) LIKE '%windows%'             THEN 'Windows Other'
          WHEN lower(os_fullname) LIKE '%red hat%9%'           THEN 'RHEL 9'
          WHEN lower(os_fullname) LIKE '%red hat%8%'           THEN 'RHEL 8'
          WHEN lower(os_fullname) LIKE '%red hat%7%'           THEN 'RHEL 7'
          WHEN lower(os_fullname) LIKE '%red hat%6%'           THEN 'RHEL 6'
          WHEN lower(os_fullname) LIKE '%red hat%'             THEN 'RHEL Other'
          WHEN lower(os_fullname) LIKE '%centos%9%'            THEN 'CentOS Stream 9'
          WHEN lower(os_fullname) LIKE '%centos%8%'            THEN 'CentOS 8'
          WHEN lower(os_fullname) LIKE '%centos%7%'            THEN 'CentOS 7'
          WHEN lower(os_fullname) LIKE '%centos%'              THEN 'CentOS'
          WHEN lower(os_fullname) LIKE '%ubuntu%22%'           THEN 'Ubuntu 22'
          WHEN lower(os_fullname) LIKE '%ubuntu%20%'           THEN 'Ubuntu 20'
          WHEN lower(os_fullname) LIKE '%ubuntu%'              THEN 'Ubuntu'
          WHEN lower(os_fullname) LIKE '%oracle linux%9%'      THEN 'Oracle Linux 9'
          WHEN lower(os_fullname) LIKE '%oracle linux%8%'      THEN 'Oracle Linux 8'
          WHEN lower(os_fullname) LIKE '%oracle linux%7%'      THEN 'Oracle Linux 7'
          WHEN lower(os_fullname) LIKE '%oracle%'              THEN 'Oracle Linux'
          WHEN lower(os_fullname) LIKE '%suse%'                THEN 'SUSE Linux'
          WHEN lower(os_fullname) LIKE '%debian%'              THEN 'Debian'
          WHEN lower(os_fullname) LIKE '%freebsd%'             THEN 'FreeBSD'
          WHEN os_fullname IS NULL OR trim(os_fullname) = ''  THEN 'Not Available'
          ELSE 'Other'
        END AS os_group
      FROM virtual_machines
      WHERE snapshot_id IN (SELECT id FROM latest)
    )
    SELECT os_group, COUNT(*) AS count
    FROM grouped
    GROUP BY os_group
    ORDER BY
      CASE os_group
        WHEN 'Not Available' THEN 999
        WHEN 'Other'         THEN 998
        ELSE 0
      END,
      COUNT(*) DESC
  `)
  return rows
}

// ── Low utilization count ──────────────────────────────────────
// VMs where provisioned vCPU or memory < 50% of what they could
// use based on host capacity. Since we don't have real-time
// utilization data from RVTools, we proxy this as:
//   low_vcpu: VMs with vcpus == 1 (chronically undersized or idle)
//   low_mem:  VMs with mem_mb < 2048 (less than 2GB)
// Adjust thresholds to match your environment's definition.
export async function getLowUtilization() {
  const { rows } = await pool.query(`
    WITH latest AS (
      SELECT DISTINCT ON (vcenter_id) id
      FROM vcenter_snapshots
      WHERE status = 'complete'
      ORDER BY vcenter_id, collected_at DESC
    )
    SELECT
      COUNT(*) FILTER (
        WHERE vcpus <= 2
          AND powerstate = 'poweredOn'
      ) AS low_vcpu,
      COUNT(*) FILTER (
        WHERE mem_mb < 4096
          AND powerstate = 'poweredOn'
      ) AS low_mem
    FROM virtual_machines
    WHERE snapshot_id IN (SELECT id FROM latest)
  `)
  return rows[0]
}
