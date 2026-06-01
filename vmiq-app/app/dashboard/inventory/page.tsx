export const dynamic = 'force-dynamic'
import pool from '@/lib/db'
import { getVCenterOptions } from '@/lib/filters'
import FilterBar from '@/components/filters/FilterBar'

async function getVMs(p: {
  search: string; powerstate: string; os: string
  vcenter: string; category: string; page: number
}) {
  const limit = 50; const offset = (p.page - 1) * limit
  const params: any[] = []; let idx = 1
  const conds = [`vm.snapshot_id IN (
    SELECT DISTINCT ON (vcenter_id) id FROM vcenter_snapshots
    WHERE status='complete' ORDER BY vcenter_id, collected_at DESC
  )`]

  if (p.search) {
    conds.push(`(lower(vm.name) LIKE $${idx} OR lower(vm.ip_address) LIKE $${idx})`)
    params.push(`%${p.search.toLowerCase()}%`); idx++
  }
  if (p.powerstate !== 'all') { conds.push(`vm.powerstate = $${idx}`); params.push(p.powerstate); idx++ }
  if (p.vcenter    !== 'all') { conds.push(`v.name = $${idx}`);        params.push(p.vcenter);    idx++ }
  if (p.category   !== 'all') { conds.push(`COALESCE(v.category,'Legacy') = $${idx}`); params.push(p.category); idx++ }
  if (p.os) {
    conds.push(`(CASE
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
      WHEN lower(vm.os_fullname) LIKE '%centos%9%'            THEN 'CentOS Stream 9'
      WHEN lower(vm.os_fullname) LIKE '%centos%8%'            THEN 'CentOS 8'
      WHEN lower(vm.os_fullname) LIKE '%centos%7%'            THEN 'CentOS 7'
      WHEN lower(vm.os_fullname) LIKE '%centos%'              THEN 'CentOS'
      WHEN lower(vm.os_fullname) LIKE '%ubuntu%'              THEN 'Ubuntu'
      WHEN lower(vm.os_fullname) LIKE '%oracle%'              THEN 'Oracle Linux'
      WHEN lower(vm.os_fullname) LIKE '%suse%'                THEN 'SUSE Linux'
      WHEN lower(vm.os_fullname) LIKE '%debian%'              THEN 'Debian'
      WHEN vm.os_fullname IS NULL OR trim(vm.os_fullname)=''  THEN 'Not Available'
      ELSE 'Other'
    END) = $${idx}`)
    params.push(p.os); idx++
  }

  const where = conds.join(' AND ')
  const [data, count] = await Promise.all([
    pool.query(`
      SELECT vm.name, vm.powerstate, vm.vcpus, vm.mem_mb,
             vm.disk_total_gb, vm.ip_address, vm.os_fullname,
             vm.hw_version, vm.has_snapshots, vm.has_rdm, vm.has_usb,
             v.name as vcenter_name,
             COALESCE(v.category,'Legacy') as category
      FROM virtual_machines vm
      JOIN vcenter_snapshots s ON s.id = vm.snapshot_id
      JOIN vcenters v ON v.id = s.vcenter_id
      WHERE ${where} ORDER BY vm.name
      LIMIT ${limit} OFFSET ${offset}
    `, params),
    pool.query(
      `SELECT COUNT(*) FROM virtual_machines vm
       JOIN vcenter_snapshots s ON s.id = vm.snapshot_id
       JOIN vcenters v ON v.id = s.vcenter_id
       WHERE ${where}`, params),
  ])
  return { vms: data.rows, total: Number(count.rows[0].count), limit }
}

function fmt(n: number) { return Number(n).toLocaleString() }

export default async function InventoryPage({ searchParams }: {
  searchParams: { search?: string; powerstate?: string; os?: string; vcenter?: string; category?: string; page?: string }
}) {
  const search     = searchParams.search     || ''
  const powerstate = searchParams.powerstate || 'all'
  const os         = searchParams.os         || ''
  const vcenter    = searchParams.vcenter    || 'all'
  const category   = searchParams.category   || 'all'
  const page       = Number(searchParams.page) || 1

  const [{ vms, total, limit }, vcenterOptions] = await Promise.all([
    getVMs({ search, powerstate, os, vcenter, category, page }),
    getVCenterOptions(),
  ])
  const pages = Math.ceil(total / limit)

  function pageUrl(pg: number) {
    const q = new URLSearchParams()
    if (search)               q.set('search',     search)
    if (powerstate !== 'all') q.set('powerstate', powerstate)
    if (os)                   q.set('os',         os)
    if (vcenter !== 'all')    q.set('vcenter',    vcenter)
    if (category !== 'all')   q.set('category',   category)
    q.set('page', String(pg))
    return `?${q.toString()}`
  }

  return (
    <>
      <div className="topbar">
        <div className="topbar-title">Virtual Machines</div>
        <div className="topbar-right">
          <span className="last-updated">{fmt(total)} VMs</span>
        </div>
      </div>
      <div className="page">
        {os && (
          <div style={{
            display:'flex', alignItems:'center', gap:10,
            background:'var(--blue-light)', border:'1px solid var(--border)',
            borderRadius:'var(--radius)', padding:'10px 14px', marginBottom:16, fontSize:13,
          }}>
            <span style={{ color:'var(--blue)', fontWeight:600 }}>Filtered by OS:</span>
            <span>{os}</span>
            <span style={{ color:'var(--text2)' }}>— {fmt(total)} VMs</span>
            <a href="/dashboard/inventory" style={{ marginLeft:'auto', color:'var(--blue)', fontSize:12, textDecoration:'none', fontWeight:500 }}>Clear</a>
          </div>
        )}

        <FilterBar
          allVCenters={vcenterOptions}
          showSearch showCategory showVCenter showPowerstate
          basePath="/dashboard/inventory"
          preserve={{ os }}
        />

        <div className="card">
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>VM Name</th>
                  <th>Category</th>
                  <th>vCenter</th>
                  <th>Power</th>
                  <th style={{ textAlign:'right' }}>vCPUs</th>
                  <th style={{ textAlign:'right' }}>Mem (GB)</th>
                  <th style={{ textAlign:'right' }}>Disk (GB)</th>
                  <th>IP Address</th>
                  <th>OS</th>
                  <th>HW Ver</th>
                  <th>Flags</th>
                </tr>
              </thead>
              <tbody>
                {vms.map((vm: any, i: number) => (
                  <tr key={i}>
                    <td style={{ fontWeight:500 }}>{vm.name}</td>
                    <td><span className={`badge ${vm.category === 'ITCC' ? 'badge-blue' : 'badge-amber'}`}>{vm.category}</span></td>
                    <td style={{ fontSize:12, color:'var(--text2)' }}>{vm.vcenter_name}</td>
                    <td>
                      <span className={`badge ${vm.powerstate==='poweredOn'?'badge-green':vm.powerstate==='poweredOff'?'badge-gray':'badge-amber'}`}>
                        {vm.powerstate==='poweredOn'?'On':vm.powerstate==='poweredOff'?'Off':'Suspended'}
                      </span>
                    </td>
                    <td style={{ textAlign:'right' }}>{vm.vcpus}</td>
                    <td style={{ textAlign:'right' }}>{Math.round(vm.mem_mb/1024)}</td>
                    <td style={{ textAlign:'right' }}>{Math.round(vm.disk_total_gb)}</td>
                    <td style={{ fontSize:12, color:'var(--text2)' }}>{vm.ip_address||'—'}</td>
                    <td style={{ fontSize:11, color:'var(--text2)', maxWidth:180, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{vm.os_fullname||'—'}</td>
                    <td style={{ fontSize:12 }}>{vm.hw_version||'—'}</td>
                    <td>
                      <div style={{ display:'flex', gap:3 }}>
                        {vm.has_snapshots && <span title="Snapshots">📸</span>}
                        {vm.has_rdm       && <span title="RDM">⚠️</span>}
                        {vm.has_usb       && <span title="USB">🔌</span>}
                      </div>
                    </td>
                  </tr>
                ))}
                {vms.length===0 && (
                  <tr><td colSpan={11} style={{ textAlign:'center', padding:'32px', color:'var(--text3)' }}>No VMs found</td></tr>
                )}
              </tbody>
            </table>
          </div>
          {pages > 1 && (
            <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'12px 16px', borderTop:'1px solid var(--border)', fontSize:13, color:'var(--text2)' }}>
              <span>Showing {((page-1)*limit)+1}–{Math.min(page*limit,total)} of {fmt(total)}</span>
              <div style={{ display:'flex', gap:6 }}>
                {page>1 && <a href={pageUrl(page-1)} style={{ padding:'4px 10px', borderRadius:'var(--radius)', border:'1px solid var(--border)', textDecoration:'none', color:'var(--text2)' }}>Prev</a>}
                <span style={{ padding:'4px 8px' }}>{page} / {pages}</span>
                {page<pages && <a href={pageUrl(page+1)} style={{ padding:'4px 10px', borderRadius:'var(--radius)', border:'1px solid var(--border)', textDecoration:'none', color:'var(--text2)' }}>Next</a>}
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  )
}
