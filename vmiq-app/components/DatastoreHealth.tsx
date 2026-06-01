interface Datastore {
  name: string
  type: string
  capacity_gb: number
  free_gb: number
  used_pct: number
  vm_count: number
}

interface Props {
  datastores: Datastore[]
}

export default function DatastoreHealth({ datastores }: Props) {
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Datastore</th>
            <th>Type</th>
            <th style={{ textAlign: 'right' }}>Capacity</th>
            <th style={{ textAlign: 'right' }}>Free</th>
            <th style={{ minWidth: 160 }}>Used</th>
            <th style={{ textAlign: 'right' }}>VMs</th>
          </tr>
        </thead>
        <tbody>
          {datastores.map(ds => {
            const pct  = Math.round(Number(ds.used_pct))
            const color = pct >= 90 ? 'var(--red)'
                        : pct >= 75 ? 'var(--amber)'
                        : 'var(--green)'
            return (
              <tr key={ds.name}>
                <td style={{ fontWeight: 500 }}>{ds.name}</td>
                <td>
                  <span className="badge badge-gray">
                    {ds.type || '—'}
                  </span>
                </td>
                <td style={{ textAlign: 'right', color: 'var(--text2)' }}>
                  {Math.round(Number(ds.capacity_gb))} GB
                </td>
                <td style={{ textAlign: 'right', color: 'var(--text2)' }}>
                  {Math.round(Number(ds.free_gb))} GB
                </td>
                <td>
                  <div style={{
                    display: 'flex', alignItems: 'center', gap: 8,
                  }}>
                    <div className="progress-bar" style={{ flex: 1 }}>
                      <div
                        className="progress-fill"
                        style={{ width: `${pct}%`, background: color }}
                      />
                    </div>
                    <span style={{
                      fontSize: 12, fontWeight: 600,
                      color, minWidth: 36,
                    }}>
                      {pct}%
                    </span>
                  </div>
                </td>
                <td style={{ textAlign: 'right' }}>
                  {Number(ds.vm_count).toLocaleString()}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
