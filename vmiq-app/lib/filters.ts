// Shared filter option fetchers used across all pages
import pool from './db'

export async function getVCenterOptions() {
  const { rows } = await pool.query(`
    SELECT DISTINCT v.name, COALESCE(v.category, 'Legacy') AS category
    FROM vcenters v
    JOIN vcenter_snapshots s ON s.vcenter_id = v.id
    WHERE s.status = 'complete'
    ORDER BY v.name
  `)
  return rows as { name: string; category: string }[]
}

export async function getClusterOptions() {
  const { rows } = await pool.query(`
    SELECT DISTINCT c.name, v.name AS vcenter
    FROM clusters c
    JOIN vcenter_snapshots s ON s.id = c.snapshot_id
    JOIN vcenters v ON v.id = s.vcenter_id
    WHERE s.status = 'complete'
    ORDER BY c.name
  `)
  return rows as { name: string; vcenter: string }[]
}

export async function getDatastoreTypeOptions() {
  const { rows } = await pool.query(`
    SELECT DISTINCT type
    FROM datastores
    WHERE type IS NOT NULL
    ORDER BY type
  `)
  return rows.map((r: any) => r.type) as string[]
}
