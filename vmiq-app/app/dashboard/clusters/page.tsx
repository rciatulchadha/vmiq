export const dynamic = 'force-dynamic'
import pool from '@/lib/db'
import { getVCenterOptions } from '@/lib/filters'
import FilterBar from '@/components/filters/FilterBar'

async function getClusters(p: { search:string; vcenter:string; category:string }) {
  const params: any[] = []; let idx = 1
  const conds = [`c.snapshot_id IN (
    SELECT DISTINCT ON (vcenter_id) id FROM vcenter_snapshots
    WHERE status='complete' ORDER BY vcenter_id, collected_at DESC
  )`]
  if (p.search)            { conds.push(`lower(c.name) LIKE $${idx}`);              params.push(`%${p.search.toLowerCase()}%`); idx++ }
  if (p.vcenter  !=='all') { conds.push(`v.name = $${idx}`);                        params.push(p.vcenter);   idx++ }
  if (p.category !=='all') { conds.push(`COALESCE(v.category,'Legacy') = $${idx}`); params.push(p.category);  idx++ }

  const { rows } = await pool.query(`
    SELECT c.name, c.cpu_total_mhz, c.mem_total_mb, c.host_count, c.vm_count,
           v.name as vcenter_name, COALESCE(v.category,'Legacy') as category,
           COALESCE(SUM(vm.vcpus),0) as allocated_vcpus,
           COALESCE(SUM(vm.mem_mb),0) as allocated_mem_mb,
           COUNT(DISTINCT vm.id) FILTER (WHERE vm.powerstate='poweredOn') as powered_on
    FROM clusters c
    JOIN vcenter_snapshots s ON s.id = c.snapshot_id
    JOIN vcenters v ON v.id = s.vcenter_id
    LEFT JOIN virtual_machines vm ON vm.snapshot_id=c.snapshot_id AND vm.cluster_id=c.id
    WHERE ${conds.join(' AND ')}
    GROUP BY c.id,c.name,c.cpu_total_mhz,c.mem_total_mb,c.host_count,c.vm_count,v.name,v.category
    ORDER BY v.name, c.name
  `, params)
  return rows
}

function fmt(n: number) { return Number(n).toLocaleString() }

export default async function ClustersPage({ searchParams }: {
  searchParams: { search?:string; vcenter?:string; category?:string }
}) {
  const search   = searchParams.search   || ''
  const vcenter  = searchParams.vcenter  || 'all'
  const category = searchParams.category || 'all'

  const [clusters, vcenterOptions] = await Promise.all([
    getClusters({ search, vcenter, category }),
    getVCenterOptions(),
  ])

  return (
    <>
      <div className="topbar">
        <div className="topbar-title">Clusters</div>
        <div className="topbar-right"><span className="last-updated">{clusters.length} clusters</span></div>
      </div>
      <div className="page">
        <FilterBar allVCenters={vcenterOptions} showSearch showCategory showVCenter basePath="/dashboard/clusters" />
        <div className="card">
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Cluster</th><th>Category</th><th>vCenter</th>
                  <th style={{ textAlign:'right' }}>Hosts</th>
                  <th style={{ textAlign:'right' }}>VMs</th>
                  <th style={{ textAlign:'right' }}>Powered On</th>
                  <th style={{ textAlign:'right' }}>Alloc vCPUs</th>
                  <th style={{ textAlign:'right' }}>Total Mem (GB)</th>
                  <th style={{ textAlign:'right' }}>Alloc Mem (GB)</th>
                </tr>
              </thead>
              <tbody>
                {clusters.map((c: any, i: number) => {
                  const pct = c.mem_total_mb > 0 ? Math.round((c.allocated_mem_mb/c.mem_total_mb)*100) : 0
                  return (
                    <tr key={i}>
                      <td style={{ fontWeight:500 }}>{c.name}</td>
                      <td><span className={`badge ${c.category==='ITCC'?'badge-blue':'badge-amber'}`}>{c.category}</span></td>
                      <td style={{ fontSize:12, color:'var(--text2)' }}>{c.vcenter_name}</td>
                      <td style={{ textAlign:'right' }}>{c.host_count||0}</td>
                      <td style={{ textAlign:'right' }}>{fmt(c.vm_count||0)}</td>
                      <td style={{ textAlign:'right' }}><span className="badge badge-green">{fmt(c.powered_on)}</span></td>
                      <td style={{ textAlign:'right' }}>{fmt(c.allocated_vcpus)}</td>
                      <td style={{ textAlign:'right', color:'var(--text2)' }}>{c.mem_total_mb ? fmt(Math.round(c.mem_total_mb/1024)) : '—'}</td>
                      <td>
                        <div style={{ display:'flex', alignItems:'center', justifyContent:'flex-end', gap:8 }}>
                          <div className="progress-bar" style={{ width:60 }}>
                            <div className="progress-fill" style={{ width:`${Math.min(pct,100)}%`, background:pct>90?'var(--red)':pct>70?'var(--amber)':'var(--green)' }}/>
                          </div>
                          <span style={{ fontSize:12, minWidth:40 }}>{fmt(Math.round(c.allocated_mem_mb/1024))}</span>
                        </div>
                      </td>
                    </tr>
                  )
                })}
                {clusters.length===0 && <tr><td colSpan={9} style={{ textAlign:'center', padding:'32px', color:'var(--text3)' }}>No clusters found</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </>
  )
}
