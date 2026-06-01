export const dynamic = 'force-dynamic'
import pool from '@/lib/db'
import { getVCenterOptions } from '@/lib/filters'
import FilterBar from '@/components/filters/FilterBar'

async function getDrift(p: { tab:string; vcenter:string; category:string; severity:string; poweron:string; page:number }) {
  const limit = 50; const offset = (p.page-1)*limit
  const status = p.tab==='drift' ? 'drift_detected' : 'vmware_only'
  const params: any[] = [status]; let idx = 2
  const extra: string[] = []
  if (p.vcenter  !=='all') { extra.push(`v.name = $${idx}`);                        params.push(p.vcenter);   idx++ }
  if (p.category !=='all') { extra.push(`COALESCE(v.category,'Legacy') = $${idx}`); params.push(p.category);  idx++ }
  if (p.severity !=='all') { extra.push(`d.drift_severity = $${idx}`);              params.push(p.severity);  idx++ }
  if (p.poweron  !=='all') { extra.push(`vm.powerstate = $${idx}`);                 params.push(p.poweron);   idx++ }
  const ew = extra.length ? `AND ${extra.join(' AND ')}` : ''

  const [rows, count, summary] = await Promise.all([
    pool.query(`
      SELECT vm.name as vm_name, vm.powerstate,
             v.name as vcenter_name, COALESCE(v.category,'Legacy') as category,
             d.match_status, d.drift_fields, d.drift_severity, d.run_date
      FROM cmdb_drift_results d
      JOIN virtual_machines vm ON vm.id = d.vm_id
      JOIN vcenter_snapshots s ON s.id = vm.snapshot_id
      JOIN vcenters v ON v.id = s.vcenter_id
      WHERE d.run_date=(SELECT MAX(run_date) FROM cmdb_drift_results)
        AND d.match_status=$1 ${ew}
      ORDER BY d.drift_severity DESC, vm.name
      LIMIT ${limit} OFFSET ${offset}
    `, params),
    pool.query(`
      SELECT COUNT(*) FROM cmdb_drift_results d
      JOIN virtual_machines vm ON vm.id=d.vm_id
      JOIN vcenter_snapshots s ON s.id=vm.snapshot_id
      JOIN vcenters v ON v.id=s.vcenter_id
      WHERE d.run_date=(SELECT MAX(run_date) FROM cmdb_drift_results)
        AND d.match_status=$1 ${ew}
    `, params),
    pool.query(`
      SELECT
        COUNT(*) FILTER (WHERE match_status='vmware_only')    as ghost,
        COUNT(*) FILTER (WHERE match_status='drift_detected') as drift,
        COUNT(*) FILTER (WHERE match_status='drift_detected' AND drift_severity='critical') as critical,
        COUNT(*) FILTER (WHERE match_status='drift_detected' AND drift_severity='warning')  as warning,
        COUNT(*) FILTER (WHERE match_status='drift_detected' AND drift_severity='info')     as info,
        MAX(run_date) as run_date
      FROM cmdb_drift_results
      WHERE run_date=(SELECT MAX(run_date) FROM cmdb_drift_results)
    `),
  ])
  return { rows:rows.rows, total:Number(count.rows[0].count), summary:summary.rows[0], limit }
}

function fmt(n: number) { return Number(n).toLocaleString() }

function DriftFields({ fields }: { fields: any }) {
  if (!fields) return null
  const entries = typeof fields==='string' ? Object.entries(JSON.parse(fields)) : Object.entries(fields)
  return (
    <div style={{ display:'flex', gap:4, flexWrap:'wrap' }}>
      {entries.map(([f, v]: any) => (
        <div key={f} style={{ background:'var(--surface2)', border:'1px solid var(--border)', borderRadius:4, padding:'2px 7px', fontSize:11 }}>
          <span style={{ color:'var(--text2)' }}>{f}: </span>
          <span style={{ textDecoration:'line-through', color:'var(--text3)' }}>{String(v.cmdb)}</span>
          <span style={{ color:'var(--text2)' }}> → </span>
          <span style={{ color:'var(--red)', fontWeight:600 }}>{String(v.vmware)}</span>
        </div>
      ))}
    </div>
  )
}

export default async function CMDBPage({ searchParams }: {
  searchParams: { tab?:string; vcenter?:string; category?:string; severity?:string; poweron?:string; page?:string }
}) {
  const tab      = searchParams.tab      || 'ghost'
  const vcenter  = searchParams.vcenter  || 'all'
  const category = searchParams.category || 'all'
  const severity = searchParams.severity || 'all'
  const poweron  = searchParams.poweron  || 'all'
  const page     = Number(searchParams.page) || 1

  const [{ rows, total, summary, limit }, vcenterOptions] = await Promise.all([
    getDrift({ tab, vcenter, category, severity, poweron, page }),
    getVCenterOptions(),
  ])
  const pages = Math.ceil(total / limit)

  function pageUrl(pg: number) {
    const q = new URLSearchParams()
    q.set('tab', tab)
    if (vcenter  !=='all') q.set('vcenter',  vcenter)
    if (category !=='all') q.set('category', category)
    if (severity !=='all') q.set('severity', severity)
    if (poweron  !=='all') q.set('poweron',  poweron)
    q.set('page', String(pg))
    return `?${q.toString()}`
  }

  return (
    <>
      <div className="topbar">
        <div className="topbar-title">CMDB Reconciliation</div>
        <div className="topbar-right">
          <span className="last-updated">Run: {summary.run_date ? new Date(summary.run_date).toLocaleDateString('en-CA') : 'Never'}</span>
        </div>
      </div>
      <div className="page">
        <div className="stat-grid mb-6" style={{ gridTemplateColumns:'repeat(5,1fr)' }}>
          {[
            { label:'Ghost VMs',      value:summary.ghost,    color:'var(--red)',   bg:'var(--red-light)'   },
            { label:'Total drift',    value:summary.drift,    color:'var(--amber)', bg:'var(--amber-light)' },
            { label:'Critical drift', value:summary.critical, color:'var(--red)',   bg:'var(--red-light)'   },
            { label:'Warning drift',  value:summary.warning,  color:'var(--amber)', bg:'var(--amber-light)' },
            { label:'Info drift',     value:summary.info,     color:'var(--blue)',  bg:'var(--blue-light)'  },
          ].map(c => (
            <div key={c.label} className="stat-card" style={{ background:c.bg }}>
              <div className="stat-label">{c.label}</div>
              <div className="stat-value" style={{ color:c.color }}>{fmt(c.value??0)}</div>
            </div>
          ))}
        </div>

        <div style={{ display:'flex', borderBottom:'1px solid var(--border)', marginBottom:16 }}>
          {[
            { key:'ghost', label:`Ghost VMs (${fmt(summary.ghost??0)})` },
            { key:'drift', label:`Attribute drift (${fmt(summary.drift??0)})` },
          ].map(t => (
            <a key={t.key} href={`?tab=${t.key}&page=1`} style={{
              padding:'8px 16px', fontSize:13, textDecoration:'none',
              borderBottom: tab===t.key ? '2px solid var(--blue)' : '2px solid transparent',
              color: tab===t.key ? 'var(--text)' : 'var(--text2)',
              fontWeight: tab===t.key ? 600 : 400,
            }}>{t.label}</a>
          ))}
        </div>

        <FilterBar
          allVCenters={vcenterOptions}
          showCategory showVCenter
          showSeverity={tab==='drift'}
          showPowerOn
          basePath="/dashboard/cmdb"
          preserve={{ tab }}
        />

        <div className="card">
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>VM Name</th><th>vCenter</th><th>Category</th>
                  <th>VM Power</th><th>Severity</th>
                  {tab==='drift' && <th>Drifted Fields</th>}
                </tr>
              </thead>
              <tbody>
                {rows.map((r: any, i: number) => (
                  <tr key={i}>
                    <td style={{ fontWeight:500 }}>{r.vm_name}</td>
                    <td style={{ fontSize:12, color:'var(--text2)' }}>{r.vcenter_name}</td>
                    <td><span className={`badge ${r.category==='ITCC'?'badge-blue':'badge-amber'}`}>{r.category}</span></td>
                    <td>
                      <span className={`badge ${r.powerstate==='poweredOn'?'badge-green':r.powerstate==='poweredOff'?'badge-gray':'badge-amber'}`}>
                        {r.powerstate==='poweredOn'?'On':r.powerstate==='poweredOff'?'Off':'Suspended'}
                      </span>
                    </td>
                    <td>
                      <span className={`badge ${r.drift_severity==='critical'?'badge-red':r.drift_severity==='warning'?'badge-amber':'badge-blue'}`}>
                        {r.drift_severity}
                      </span>
                    </td>
                    {tab==='drift' && <td><DriftFields fields={r.drift_fields}/></td>}
                  </tr>
                ))}
                {rows.length===0 && (
                  <tr><td colSpan={6} style={{ textAlign:'center', padding:'32px', color:'var(--text3)' }}>No {tab==='ghost'?'ghost VMs':'drift'} found</td></tr>
                )}
              </tbody>
            </table>
          </div>
          {pages>1 && (
            <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'12px 16px', borderTop:'1px solid var(--border)', fontSize:13, color:'var(--text2)' }}>
              <span>Showing {((page-1)*limit)+1}–{Math.min(page*limit,total)} of {fmt(total)}</span>
              <div style={{ display:'flex', gap:6 }}>
                {page>1 && <a href={pageUrl(page-1)} style={{ padding:'4px 10px', borderRadius:'var(--radius)', border:'1px solid var(--border)', textDecoration:'none', color:'var(--text2)' }}>Prev</a>}
                <span style={{ padding:'4px 8px' }}>{page}/{pages}</span>
                {page<pages && <a href={pageUrl(page+1)} style={{ padding:'4px 10px', borderRadius:'var(--radius)', border:'1px solid var(--border)', textDecoration:'none', color:'var(--text2)' }}>Next</a>}
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  )
}
