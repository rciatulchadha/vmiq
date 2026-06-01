export const dynamic = 'force-dynamic'
import pool from '@/lib/db'
import { getVCenterOptions, getDatastoreTypeOptions } from '@/lib/filters'
import FilterBar from '@/components/filters/FilterBar'

async function getDatastores(p: { search:string; vcenter:string; category:string; type:string }) {
  const params: any[] = []; let idx = 1
  const conds = [`d.snapshot_id IN (
    SELECT DISTINCT ON (vcenter_id) id FROM vcenter_snapshots
    WHERE status='complete' ORDER BY vcenter_id, collected_at DESC
  )`, `d.capacity_gb > 0`]
  if (p.search)           { conds.push(`lower(d.name) LIKE $${idx}`);               params.push(`%${p.search.toLowerCase()}%`); idx++ }
  if (p.vcenter !=='all') { conds.push(`v.name = $${idx}`);                         params.push(p.vcenter);   idx++ }
  if (p.category!=='all') { conds.push(`COALESCE(v.category,'Legacy') = $${idx}`);  params.push(p.category);  idx++ }
  if (p.type    !=='all') { conds.push(`d.type = $${idx}`);                         params.push(p.type);      idx++ }

  const { rows } = await pool.query(`
    SELECT d.name, d.type, d.capacity_gb, d.free_gb, d.used_pct, d.vm_count,
           v.name as vcenter_name, COALESCE(v.category,'Legacy') as category
    FROM datastores d
    JOIN vcenter_snapshots s ON s.id = d.snapshot_id
    JOIN vcenters v ON v.id = s.vcenter_id
    WHERE ${conds.join(' AND ')}
    ORDER BY d.used_pct DESC NULLS LAST
  `, params)
  return rows
}

export default async function DatastoresPage({ searchParams }: {
  searchParams: { search?:string; vcenter?:string; category?:string; type?:string }
}) {
  const search   = searchParams.search   || ''
  const vcenter  = searchParams.vcenter  || 'all'
  const category = searchParams.category || 'all'
  const type     = searchParams.type     || 'all'

  const [datastores, vcenterOptions, typeOptions] = await Promise.all([
    getDatastores({ search, vcenter, category, type }),
    getVCenterOptions(),
    getDatastoreTypeOptions(),
  ])

  const critical = datastores.filter((d: any) => Number(d.used_pct) >= 90).length
  const warning  = datastores.filter((d: any) => Number(d.used_pct) >= 75 && Number(d.used_pct) < 90).length

  return (
    <>
      <div className="topbar">
        <div className="topbar-title">Datastores</div>
        <div className="topbar-right"><span className="last-updated">{datastores.length} datastores</span></div>
      </div>
      <div className="page">
        <div className="stat-grid mb-6" style={{ gridTemplateColumns:'repeat(3,1fr)' }}>
          <div className="stat-card"><div className="stat-label">Total</div><div className="stat-value">{datastores.length}</div></div>
          <div className="stat-card"><div className="stat-label">Critical (&gt;90%)</div><div className="stat-value" style={{ color:'var(--red)' }}>{critical}</div></div>
          <div className="stat-card"><div className="stat-label">Warning (&gt;75%)</div><div className="stat-value" style={{ color:'var(--amber)' }}>{warning}</div></div>
        </div>

        <FilterBar
          allVCenters={vcenterOptions}
          allTypes={typeOptions}
          showSearch showCategory showVCenter showType
          basePath="/dashboard/datastores"
        />

        <div className="card">
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Datastore</th><th>Category</th><th>vCenter</th><th>Type</th>
                  <th style={{ textAlign:'right' }}>Capacity (GB)</th>
                  <th style={{ textAlign:'right' }}>Free (GB)</th>
                  <th style={{ minWidth:160 }}>Used</th>
                  <th style={{ textAlign:'right' }}>VMs</th>
                </tr>
              </thead>
              <tbody>
                {datastores.map((d: any, i: number) => {
                  const pct = Math.round(Number(d.used_pct))
                  const col = pct>=90?'var(--red)':pct>=75?'var(--amber)':'var(--green)'
                  return (
                    <tr key={i}>
                      <td style={{ fontWeight:500 }}>{d.name}</td>
                      <td><span className={`badge ${d.category==='ITCC'?'badge-blue':'badge-amber'}`}>{d.category}</span></td>
                      <td style={{ fontSize:12, color:'var(--text2)' }}>{d.vcenter_name}</td>
                      <td><span className="badge badge-gray">{d.type||'—'}</span></td>
                      <td style={{ textAlign:'right' }}>{Math.round(Number(d.capacity_gb))}</td>
                      <td style={{ textAlign:'right', color:col }}>{Math.round(Number(d.free_gb))}</td>
                      <td>
                        <div style={{ display:'flex', alignItems:'center', gap:8 }}>
                          <div className="progress-bar" style={{ flex:1 }}>
                            <div className="progress-fill" style={{ width:`${pct}%`, background:col }}/>
                          </div>
                          <span style={{ fontSize:12, fontWeight:600, color:col, minWidth:36 }}>{pct}%</span>
                        </div>
                      </td>
                      <td style={{ textAlign:'right' }}>{d.vm_count}</td>
                    </tr>
                  )
                })}
                {datastores.length===0 && <tr><td colSpan={8} style={{ textAlign:'center', padding:'32px', color:'var(--text3)' }}>No datastores found</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </>
  )
}
