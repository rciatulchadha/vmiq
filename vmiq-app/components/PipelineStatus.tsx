interface Pipeline {
  pipeline: string
  status: string
  started_at: string
  finished_at: string
  records_out: number
  error_message: string
}

interface Props {
  pipelines: Pipeline[]
}

function statusBadge(status: string) {
  const map: Record<string, string> = {
    success: 'badge-green',
    complete: 'badge-green',
    running:  'badge-blue',
    failed:   'badge-red',
    partial:  'badge-amber',
  }
  return map[status] ?? 'badge-gray'
}

function fmtDate(d: string) {
  if (!d) return '—'
  return new Date(d).toLocaleString('en-US', {
    timeZone: 'America/Toronto',
    month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
    hour12: true,
  }) + ' EST'
}

function duration(start: string, end: string) {
  if (!start || !end) return ''
  const ms = new Date(end).getTime() - new Date(start).getTime()
  const s  = Math.round(ms / 1000)
  if (s < 60) return `${s}s`
  return `${Math.round(s / 60)}m ${s % 60}s`
}

const LABELS: Record<string, string> = {
  rvtools:         'RVTools ETL',
  cmdb:            'CMDB ETL',
  reconciliation:  'Reconciliation',
}

export default function PipelineStatus({ pipelines }: Props) {
  // Show latest run per pipeline type
  const latest: Record<string, Pipeline> = {}
  for (const p of pipelines) {
    if (!latest[p.pipeline] || p.started_at > latest[p.pipeline].started_at) {
      latest[p.pipeline] = p
    }
  }

  const rows = Object.values(latest).sort(
    (a, b) => a.started_at > b.started_at ? -1 : 1)

  return (
    <div className="card">
      <div className="card-header">
        <span className="card-title">Pipeline status</span>
        <span style={{ fontSize: 12, color: 'var(--text3)' }}>
          Last 24 hours
        </span>
      </div>
      <div className="card-body">
        {rows.length === 0 ? (
          <div style={{
            textAlign: 'center', padding: '32px 0',
            color: 'var(--text3)', fontSize: 13,
          }}>
            No pipeline runs found
          </div>
        ) : (
          rows.map(p => (
            <div key={p.pipeline} className="pipeline-row">
              <div>
                <div className="pipeline-name">
                  {LABELS[p.pipeline] ?? p.pipeline}
                </div>
                <div className="pipeline-time">
                  {fmtDate(p.started_at)}
                  {p.finished_at && ` · ${duration(p.started_at, p.finished_at)}`}
                  {p.records_out > 0 && ` · ${Number(p.records_out).toLocaleString()} records`}
                </div>
                {p.error_message && (
                  <div style={{
                    fontSize: 11, color: 'var(--red)',
                    marginTop: 3, maxWidth: 280,
                    whiteSpace: 'nowrap', overflow: 'hidden',
                    textOverflow: 'ellipsis',
                  }}>
                    {p.error_message}
                  </div>
                )}
              </div>
              <span className={`badge ${statusBadge(p.status)}`}>
                {p.status}
              </span>
            </div>
          ))
        )}
      </div>
    </div>
  )
}
