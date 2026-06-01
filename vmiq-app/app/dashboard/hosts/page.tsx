export const dynamic = 'force-dynamic'
import pool from '@/lib/db'
import { getVCenterOptions, getClusterOptions } from '@/lib/filters'
import FilterBar from '@/components/filters/FilterBar'

async function getHosts(p: { search:string; vcenter:string; category:string; cluster:string }) {
  const params: any[] = []; let idx = 1
  const conds = [`h.snapshot_id IN (
    SELECT DISTINCT ON (vcenter_id) id FROM vcenter_snapshots
    WHERE status='complete' ORDER BY vcenter_id, collected_at DESC
  )`]
  if (p.search)            { conds.push(`lower(h.name) LIKE $${idx}`);                          params.push(`%${p.search.toLowerCase()}%`); idx++ }
  if (p.vcenter  !=='all') { conds.push(`v.name = $${idx}`);                                    params.push(p.vcenter);   idx++ }
  if (p.category !=='all') { conds.push(`COALESCE(v.category,'Legacy') = $${idx}`);             params.push(p.category);  idx++ }
  if (p.cluster  !=='all') { conds.push(`c.name = $${idx}`);                                    params.push(p.cluster);   idx++ }

  const { rows } = await pool.query(`
    SELECT h.name, h.esxi_version, h.model, h.cpu_sockets, h.cpu_cores,
           h.mem_total_mb, h.connection_state, h.is_in_maintenance,
           c.name as cluster_name, v.name as vcenter_name,
           COALESCE(v.category,'Legacy') as category,
           COUNT(vm.id) as vm_count
    FROM esx_hosts h
    JOIN vcenter_snapshots s ON s.id = h.snapshot_id
    JOIN vcenters v ON v.id = s.vcenter_id
    LEFT JOIN clusters c ON c.id = h.cluster_id
    LEFT JOIN virtual_machines vm ON vm.snapshot_id = h.snapshot_id AND vm.host_id = h.id
    WHERE ${conds.join(' AND ')}
    GROUP BY h.id,h.name,h.esxi_version,h.model,h.cpu_sockets,h.cpu_cores,
             h.mem_total_mb,h.connection_state,h.is_in_maintenance,c.name,v.name,v.category
    ORDER BY v.name, c.name, h.name
  `, params)
  return rows
}

export default async function HostsPage({ searchParams }: {
  searchParams: { search?:string; vcenter?:string; category?:string; cluster?:string }
}) {
  const search   = searchParams.search   || ''
  const vcenter  = searchParams.vcenter  || 'all'
  const category = searchParams.category || 'all'
  const cluster  = searchParams.cluster  || 'all'

  const [hosts, vcenterOptions, clusterOptions] = await Promise.all([
    getHosts({ search, vcenter, category, cluster }),
    getVCenterOptions(),
    getClusterOptions(),
  ])

  return (
    <>
      <div className="topbar">
        <div className="topbar-title">ESXi Hosts</div>
        <div className="topbar-right"><span className="last-updated">{hosts.length} hosts</span></div>
      </div>
      <div className="page">
        <FilterBar
          allVCenters={vcenterOptions}
          allClusters={clusterOptions}
          showSearch showCategory showVCenter showCluster
          basePath="/dashboard/hosts"
        />
        <div className="card">
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Host Name</th><th>Category</th><th>vCenter</th><th>Cluster</th>
                  <th>ESXi Version</th><th>Model</th>
                  <th style={{ textAlign:'right' }}>Sockets</th>
                  <th style={{ textAlign:'right' }}>Cores</th>
                  <th style={{ textAlign:'right' }}>Mem (GB)</th>
                  <th style={{ textAlign:'right' }}>VMs</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {hosts.map((h: any, i: number) => (
                  <tr key={i}>
                    <td style={{ fontWeight:500 }}>{h.name}</td>
                    <td><span className={`badge ${h.category==='ITCC'?'badge-blue':'badge-amber'}`}>{h.category}</span></td>
                    <td style={{ fontSize:12, color:'var(--text2)' }}>{h.vcenter_name}</td>
                    <td style={{ fontSize:12, color:'var(--text2)' }}>{h.cluster_name||'—'}</td>
                    <td style={{ fontSize:12 }}>{h.esxi_version||'—'}</td>
                    <td style={{ fontSize:12, color:'var(--text2)', maxWidth:140, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{h.model||'—'}</td>
                    <td style={{ textAlign:'right' }}>{h.cpu_sockets||'—'}</td>
                    <td style={{ textAlign:'right' }}>{h.cpu_cores||'—'}</td>
                    <td style={{ textAlign:'right' }}>{h.mem_total_mb ? Math.round(h.mem_total_mb/1024) : '—'}</td>
                    <td style={{ textAlign:'right' }}>{h.vm_count}</td>
                    <td>{h.is_in_maintenance
                      ? <span className="badge badge-amber">Maintenance</span>
                      : <span className="badge badge-green">Connected</span>}
                    </td>
                  </tr>
                ))}
                {hosts.length===0 && <tr><td colSpan={11} style={{ textAlign:'center', padding:'32px', color:'var(--text3)' }}>No hosts found</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </>
  )
}
