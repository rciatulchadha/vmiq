'use client'
import { useState, useEffect } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'

export interface VCenterOption { name: string; category: string }
export interface ClusterOption  { name: string; vcenter: string }

interface Props {
  allVCenters:    VCenterOption[]
  allClusters?:   ClusterOption[]
  allTypes?:      string[]
  showSearch?:    boolean
  showCategory?:  boolean
  showVCenter?:   boolean
  showCluster?:   boolean
  showPowerstate?:boolean
  showType?:      boolean
  showSeverity?:  boolean
  showPowerOn?:   boolean
  basePath:       string
  preserve?:      Record<string, string>
}

const sel: React.CSSProperties = {
  padding: '7px 10px', borderRadius: 'var(--radius)',
  border: '1px solid var(--border)', fontSize: 13,
  background: 'var(--bg)', color: 'var(--text)', cursor: 'pointer',
}
const inp: React.CSSProperties = {
  ...sel, width: 200,
}

export default function FilterBar({
  allVCenters, allClusters = [], allTypes = [],
  showSearch, showCategory, showVCenter, showCluster,
  showPowerstate, showType, showSeverity, showPowerOn,
  basePath, preserve = {},
}: Props) {
  const router       = useRouter()
  const sp           = useSearchParams()

  const [search,     setSearch]     = useState(sp.get('search')     ?? '')
  const [category,   setCategory]   = useState(sp.get('category')   ?? 'all')
  const [vcenter,    setVcenter]    = useState(sp.get('vcenter')    ?? 'all')
  const [cluster,    setCluster]    = useState(sp.get('cluster')    ?? 'all')
  const [powerstate, setPowerstate] = useState(sp.get('powerstate') ?? 'all')
  const [type,       setType]       = useState(sp.get('type')       ?? 'all')
  const [severity,   setSeverity]   = useState(sp.get('severity')   ?? 'all')
  const [powerOn,    setPowerOn]    = useState(sp.get('poweron')    ?? 'all')

  // vCenters filtered by category
  const filteredVC = category === 'all'
    ? allVCenters
    : allVCenters.filter(v => v.category === category)

  // Clusters filtered by selected vCenter
  const filteredCL = vcenter === 'all'
    ? allClusters
    : allClusters.filter(c => c.vcenter === vcenter)

  // Reset vCenter when category changes and current vCenter no longer valid
  useEffect(() => {
    if (vcenter !== 'all' && !filteredVC.find(v => v.name === vcenter)) {
      setVcenter('all')
    }
  }, [category])

  // Reset cluster when vCenter changes
  useEffect(() => { setCluster('all') }, [vcenter])

  function go(overrides: Record<string, string> = {}) {
    const q = new URLSearchParams()
    Object.entries(preserve).forEach(([k, v]) => { if (v) q.set(k, v) })
    const vals = { search, category, vcenter, cluster, powerstate, type, severity, poweron: powerOn, ...overrides }
    if (vals.search)                 q.set('search',     vals.search)
    if (vals.category   !== 'all')   q.set('category',   vals.category)
    if (vals.vcenter    !== 'all')   q.set('vcenter',    vals.vcenter)
    if (vals.cluster    !== 'all')   q.set('cluster',    vals.cluster)
    if (vals.powerstate !== 'all')   q.set('powerstate', vals.powerstate)
    if (vals.type       !== 'all')   q.set('type',       vals.type)
    if (vals.severity   !== 'all')   q.set('severity',   vals.severity)
    if (vals.poweron    !== 'all')   q.set('poweron',    vals.poweron)
    q.set('page', '1')
    router.push(`${basePath}?${q.toString()}`)
  }

  function clear() {
    setSearch(''); setCategory('all'); setVcenter('all')
    setCluster('all'); setPowerstate('all'); setType('all')
    setSeverity('all'); setPowerOn('all')
    router.push(basePath)
  }

  const dirty = search || category !== 'all' || vcenter !== 'all' ||
    cluster !== 'all' || powerstate !== 'all' || type !== 'all' ||
    severity !== 'all' || powerOn !== 'all'

  return (
    <div style={{
      display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center',
      background: 'var(--surface)', border: '1px solid var(--border)',
      borderRadius: 'var(--radius)', padding: '14px 16px', marginBottom: 20,
    }}>
      {showSearch && (
        <input value={search} onChange={e => setSearch(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && go()}
          placeholder="Search name or IP..." style={inp} />
      )}

      {showCategory && (
        <select value={category} onChange={e => setCategory(e.target.value)} style={sel}>
          <option value="all">All categories</option>
          <option value="ITCC">ITCC</option>
          <option value="Legacy">Legacy</option>
        </select>
      )}

      {showVCenter && (
        <select value={vcenter} onChange={e => setVcenter(e.target.value)} style={sel}>
          <option value="all">
            {category !== 'all' ? `All ${category} vCenters` : 'All vCenters'}
          </option>
          {filteredVC.map(v => (
            <option key={v.name} value={v.name}>{v.name}</option>
          ))}
        </select>
      )}

      {showCluster && (
        <select value={cluster} onChange={e => setCluster(e.target.value)} style={sel}>
          <option value="all">
            {vcenter !== 'all' ? `All clusters (${vcenter.split('.')[0]})` : 'All clusters'}
          </option>
          {filteredCL.map(c => (
            <option key={c.name} value={c.name}>{c.name}</option>
          ))}
        </select>
      )}

      {showPowerstate && (
        <select value={powerstate} onChange={e => setPowerstate(e.target.value)} style={sel}>
          <option value="all">All power states</option>
          <option value="poweredOn">Powered on</option>
          <option value="poweredOff">Powered off</option>
          <option value="suspended">Suspended</option>
        </select>
      )}

      {showType && (
        <select value={type} onChange={e => setType(e.target.value)} style={sel}>
          <option value="all">All types</option>
          {allTypes.map(t => <option key={t} value={t}>{t}</option>)}
        </select>
      )}

      {showSeverity && (
        <select value={severity} onChange={e => setSeverity(e.target.value)} style={sel}>
          <option value="all">All severities</option>
          <option value="critical">Critical</option>
          <option value="warning">Warning</option>
          <option value="info">Info</option>
        </select>
      )}

      {showPowerOn && (
        <select value={powerOn} onChange={e => setPowerOn(e.target.value)} style={sel}>
          <option value="all">All VM power states</option>
          <option value="poweredOn">Powered on</option>
          <option value="poweredOff">Powered off</option>
        </select>
      )}

      <button onClick={() => go()} style={{
        padding: '7px 16px', borderRadius: 'var(--radius)',
        background: 'var(--blue)', color: '#fff',
        border: 'none', fontSize: 13, cursor: 'pointer', fontWeight: 500,
      }}>
        Apply
      </button>

      {dirty && (
        <button onClick={clear} style={{
          padding: '7px 12px', borderRadius: 'var(--radius)',
          border: '1px solid var(--border)', background: 'transparent',
          fontSize: 13, cursor: 'pointer', color: 'var(--text2)',
        }}>
          Clear all
        </button>
      )}
    </div>
  )
}
