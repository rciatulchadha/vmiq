export const dynamic = 'force-dynamic'
import pool from '@/lib/db'
import TrendChart from '@/components/TrendChart'

async function getTrends() {
  const { rows } = await pool.query(`
    WITH daily_latest AS (
      -- Take only the LATEST snapshot per vCenter per day.
      -- Prevents double-counting when ETL runs more than once per day.
      SELECT DISTINCT ON (DATE(collected_at), vcenter_id)
        id,
        vcenter_id,
        DATE(collected_at)  AS run_date,
        vm_count,
        host_count,
        cluster_count
      FROM vcenter_snapshots
      WHERE status = 'complete'
        AND collected_at >= NOW() - INTERVAL '30 days'
      ORDER BY
        DATE(collected_at),
        vcenter_id,
        collected_at DESC        -- latest snapshot wins for that vCenter/day
    )
    SELECT
      run_date,
      SUM(vm_count)               AS total_vms,
      SUM(host_count)             AS total_hosts,
      SUM(cluster_count)          AS total_clusters,
      COUNT(DISTINCT vcenter_id)  AS vcenter_count
    FROM daily_latest
    GROUP BY run_date
    ORDER BY run_date ASC
  `)
  return rows
}

export default async function TrendsPage() {
  const trends = await getTrends()

  return (
    <>
      <div className="topbar">
        <div className="topbar-title">Trends</div>
        <div className="topbar-right">
          <span className="last-updated">Last 30 days</span>
        </div>
      </div>
      <div className="page">
        {trends.length < 2 ? (
          <div className="card card-pad" style={{
            textAlign: 'center', padding: '48px', color: 'var(--text3)',
          }}>
            <div style={{ fontSize: 32, marginBottom: 12 }}>📈</div>
            <div style={{ fontSize: 15, fontWeight: 500, marginBottom: 8 }}>
              Not enough data for trends yet
            </div>
            <div style={{ fontSize: 13 }}>
              Trend charts appear after at least 2 days of ETL runs.
              Come back tomorrow!
            </div>
          </div>
        ) : (
          <TrendChart data={trends} />
        )}
      </div>
    </>
  )
}
