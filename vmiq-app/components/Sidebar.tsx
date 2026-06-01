'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'

const NAV = [
  {
    section: 'Overview',
    items: [
      { href: '/dashboard', label: 'Global Overview', icon: '⬡' },
    ],
  },
  {
    section: 'Inventory',
    items: [
      { href: '/dashboard/vcenters',   label: 'vCenters',         icon: '⬡' },
      { href: '/dashboard/inventory',  label: 'Virtual Machines', icon: '▣' },
      { href: '/dashboard/hosts',      label: 'ESXi Hosts',       icon: '◫' },
      { href: '/dashboard/clusters',   label: 'Clusters',         icon: '◈' },
      { href: '/dashboard/datastores', label: 'Datastores',       icon: '◧' },
    ],
  },
  {
    section: 'Intelligence',
    items: [
      { href: '/dashboard/cmdb',   label: 'CMDB Reconciliation', icon: '⊞' },
      { href: '/dashboard/risks',  label: 'Risk Dashboard',      icon: '⚠' },
      { href: '/dashboard/trends',  label: 'Trends',              icon: '↗' },
      { href: '/dashboard/reports', label: 'Reports',             icon: '⬇' },
    ],
  },
]

export default function Sidebar() {
  const pathname = usePathname()

  return (
    <aside className="sidebar">
      <div className="sidebar-logo">
        EVIT
        <span>Enterprise VMware Intelligence Tool</span>
      </div>
      <nav className="sidebar-nav">
        {NAV.map(group => (
          <div key={group.section}>
            <div className="nav-section">{group.section}</div>
            {group.items.map(item => (
              <Link
                key={item.href}
                href={item.href}
                className={`nav-item ${pathname === item.href ? 'active' : ''}`}
              >
                <span className="nav-icon">{item.icon}</span>
                {item.label}
              </Link>
            ))}
          </div>
        ))}
      </nav>
      <div style={{
        padding: '12px 16px',
        borderTop: '1px solid var(--border)',
        fontSize: '11px',
        color: 'var(--text3)',
      }}>
        ITEAST Estate
      </div>
    </aside>
  )
}
