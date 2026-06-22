import { NextRequest, NextResponse } from 'next/server'
import pool from '@/lib/db'

// ── Helpers ────────────────────────────────────────────────────
function num(n: any) { return Number(n).toLocaleString() }
function match(text: string, kws: string[]) {
  return kws.some(kw => text.includes(kw))
}

// ══════════════════════════════════════════════════════════════
// LAYER 1 — Local rule engine (instant, no data leaves cluster)
// Fast pattern-matched queries for common questions.
// Returns null if question not recognised.
// ══════════════════════════════════════════════════════════════
async function localQuery(q: string): Promise<string | null> {
  const t = q.toLowerCase()

  if (match(t, ['how many vm', 'total vm', 'vm count', 'number of vm'])) {
    const { rows } = await pool.query(`
      WITH latest AS (
        SELECT DISTINCT ON (vcenter_id) id FROM vcenter_snapshots
        WHERE status='complete' ORDER BY vcenter_id, collected_at DESC
      )
      SELECT COUNT(*) AS total,
        COUNT(*) FILTER (WHERE powerstate='poweredOn')  AS on_count,
        COUNT(*) FILTER (WHERE powerstate='poweredOff') AS off_count
      FROM virtual_machines WHERE snapshot_id IN (SELECT id FROM latest)
    `)
    const r = rows[0]
    return `There are **${num(r.total)} VMs** in total.\n• Powered on: ${num(r.on_count)}\n• Powered off: ${num(r.off_count)}`
  }

  if (match(t, ['itcc vm', 'itcc virtual', 'vms in itcc', 'itcc count', 'how many itcc'])) {
    const { rows } = await pool.query(`
      WITH latest AS (
        SELECT DISTINCT ON (vcenter_id) id FROM vcenter_snapshots
        WHERE status='complete' ORDER BY vcenter_id, collected_at DESC
      )
      SELECT v.name AS vcenter, COUNT(*) AS vm_count,
        COUNT(*) FILTER (WHERE vm.powerstate='poweredOn') AS powered_on
      FROM virtual_machines vm
      JOIN vcenter_snapshots s ON s.id = vm.snapshot_id
      JOIN vcenters v ON v.id = s.vcenter_id
      WHERE vm.snapshot_id IN (SELECT id FROM latest)
        AND COALESCE(v.category,'Legacy') = 'ITCC'
      GROUP BY v.name ORDER BY vm_count DESC
    `)
    const total = rows.reduce((a: number, r: any) => a + Number(r.vm_count), 0)
    const lines = rows.map((r: any) => `  • ${r.vcenter}: ${num(r.vm_count)} VMs (${num(r.powered_on)} on)`)
    return `There are **${num(total)} ITCC VMs** across ${rows.length} vCenters:\n${lines.join('\n')}`
  }

  if (match(t, ['legacy vm', 'legacy virtual', 'vms in legacy', 'legacy count', 'how many legacy'])) {
    const { rows } = await pool.query(`
      WITH latest AS (
        SELECT DISTINCT ON (vcenter_id) id FROM vcenter_snapshots
        WHERE status='complete' ORDER BY vcenter_id, collected_at DESC
      )
      SELECT v.name AS vcenter, COUNT(*) AS vm_count,
        COUNT(*) FILTER (WHERE vm.powerstate='poweredOn') AS powered_on
      FROM virtual_machines vm
      JOIN vcenter_snapshots s ON s.id = vm.snapshot_id
      JOIN vcenters v ON v.id = s.vcenter_id
      WHERE vm.snapshot_id IN (SELECT id FROM latest)
        AND COALESCE(v.category,'Legacy') = 'Legacy'
      GROUP BY v.name ORDER BY vm_count DESC
    `)
    const total = rows.reduce((a: number, r: any) => a + Number(r.vm_count), 0)
    const lines = rows.map((r: any) => `  • ${r.vcenter}: ${num(r.vm_count)} VMs (${num(r.powered_on)} on)`)
    return `There are **${num(total)} Legacy VMs** across ${rows.length} vCenters:\n${lines.join('\n')}`
  }

  if (match(t, ['per vcenter', 'each vcenter', 'by vcenter', 'vcenter breakdown', 'which vcenter has most'])) {
    const { rows } = await pool.query(`
      WITH latest AS (
        SELECT DISTINCT ON (vcenter_id) id FROM vcenter_snapshots
        WHERE status='complete' ORDER BY vcenter_id, collected_at DESC
      )
      SELECT v.name AS vcenter, COALESCE(v.category,'Legacy') AS category,
        COUNT(*) AS vm_count,
        COUNT(*) FILTER (WHERE vm.powerstate='poweredOn') AS powered_on
      FROM virtual_machines vm
      JOIN vcenter_snapshots s ON s.id = vm.snapshot_id
      JOIN vcenters v ON v.id = s.vcenter_id
      WHERE vm.snapshot_id IN (SELECT id FROM latest)
      GROUP BY v.name, v.category ORDER BY vm_count DESC
    `)
    const lines = rows.map((r: any) =>
      `  • [${r.category}] ${r.vcenter}: ${num(r.vm_count)} VMs (${num(r.powered_on)} on)`)
    return `VM count per vCenter:\n${lines.join('\n')}`
  }

  if (match(t, ['powered on', 'powered off', 'power state', 'running vm', 'stopped vm'])) {
    const { rows } = await pool.query(`
      WITH latest AS (
        SELECT DISTINCT ON (vcenter_id) id FROM vcenter_snapshots
        WHERE status='complete' ORDER BY vcenter_id, collected_at DESC
      )
      SELECT
        COUNT(*) FILTER (WHERE powerstate='poweredOn')  AS on_count,
        COUNT(*) FILTER (WHERE powerstate='poweredOff') AS off_count,
        COUNT(*) FILTER (WHERE powerstate='suspended')  AS suspended,
        COUNT(*) AS total
      FROM virtual_machines WHERE snapshot_id IN (SELECT id FROM latest)
    `)
    const r = rows[0]
    return `Power state breakdown:\n• Powered on: **${num(r.on_count)}** (${Math.round(r.on_count/r.total*100)}%)\n• Powered off: **${num(r.off_count)}** (${Math.round(r.off_count/r.total*100)}%)\n• Suspended: **${num(r.suspended)}**`
  }

  if (match(t, ['how many host', 'esxi host', 'host count'])) {
    const { rows } = await pool.query(`
      WITH latest AS (
        SELECT DISTINCT ON (vcenter_id) id FROM vcenter_snapshots
        WHERE status='complete' ORDER BY vcenter_id, collected_at DESC
      )
      SELECT COALESCE(v.category,'Legacy') AS category, COUNT(*) AS host_count
      FROM esx_hosts h
      JOIN vcenter_snapshots s ON s.id = h.snapshot_id
      JOIN vcenters v ON v.id = s.vcenter_id
      WHERE h.snapshot_id IN (SELECT id FROM latest)
      GROUP BY v.category ORDER BY v.category
    `)
    const total = rows.reduce((a: number, r: any) => a + Number(r.host_count), 0)
    const lines = rows.map((r: any) => `  • ${r.category}: ${num(r.host_count)} hosts`)
    return `There are **${num(total)} ESXi hosts** total:\n${lines.join('\n')}`
  }

  if (match(t, ['os ', 'operating system', 'windows', 'linux', 'rhel', 'centos'])) {
    const { rows } = await pool.query(`
      WITH latest AS (
        SELECT DISTINCT ON (vcenter_id) id FROM vcenter_snapshots
        WHERE status='complete' ORDER BY vcenter_id, collected_at DESC
      ), grouped AS (
        SELECT CASE
          WHEN lower(os_fullname) LIKE '%windows server 2022%' THEN 'Windows Server 2022'
          WHEN lower(os_fullname) LIKE '%windows server 2019%' THEN 'Windows Server 2019'
          WHEN lower(os_fullname) LIKE '%windows server 2016%' THEN 'Windows Server 2016'
          WHEN lower(os_fullname) LIKE '%windows server 2012%' THEN 'Windows Server 2012'
          WHEN lower(os_fullname) LIKE '%windows%'             THEN 'Windows Other'
          WHEN lower(os_fullname) LIKE '%red hat%9%'           THEN 'RHEL 9'
          WHEN lower(os_fullname) LIKE '%red hat%8%'           THEN 'RHEL 8'
          WHEN lower(os_fullname) LIKE '%red hat%7%'           THEN 'RHEL 7'
          WHEN lower(os_fullname) LIKE '%red hat%'             THEN 'RHEL Other'
          WHEN lower(os_fullname) LIKE '%centos%'              THEN 'CentOS'
          WHEN lower(os_fullname) LIKE '%ubuntu%'              THEN 'Ubuntu'
          WHEN lower(os_fullname) LIKE '%oracle%'              THEN 'Oracle Linux'
          WHEN os_fullname IS NULL OR trim(os_fullname)=''     THEN 'Not Available'
          ELSE 'Other'
        END AS os_group
        FROM virtual_machines WHERE snapshot_id IN (SELECT id FROM latest)
      )
      SELECT os_group, COUNT(*) AS cnt FROM grouped
      GROUP BY os_group ORDER BY cnt DESC LIMIT 12
    `)
    const lines = rows.map((r: any) => `  • ${r.os_group}: ${num(r.cnt)}`)
    return `OS distribution:\n${lines.join('\n')}`
  }

  if (match(t, ['risk', 'blocking', 'rdm', 'snapshot risk', 'usb device'])) {
    const { rows } = await pool.query(`
      WITH latest AS (
        SELECT DISTINCT ON (vcenter_id) id FROM vcenter_snapshots
        WHERE status='complete' ORDER BY vcenter_id, collected_at DESC
      )
      SELECT
        COUNT(*) FILTER (WHERE has_usb OR has_rdm OR vcpus>16) AS blocking,
        COUNT(*) FILTER (WHERE has_snapshots)                   AS snapshots,
        COUNT(*) FILTER (WHERE has_rdm)                        AS rdm,
        COUNT(*) FILTER (WHERE has_usb)                        AS usb,
        COUNT(*) FILTER (WHERE is_suspended)                   AS suspended,
        COUNT(*) FILTER (WHERE has_cdrom)                      AS cdrom
      FROM virtual_machines WHERE snapshot_id IN (SELECT id FROM latest)
    `)
    const r = rows[0]
    return `Risk summary:\n• Blocking: **${num(r.blocking)}** (RDM, USB, high vCPU)\n• Has snapshots: ${num(r.snapshots)}\n• RDM disks: ${num(r.rdm)}\n• USB devices: ${num(r.usb)}\n• Suspended: ${num(r.suspended)}\n• CD-ROM: ${num(r.cdrom)}`
  }

  if (match(t, ['ghost', 'cmdb', 'drift', 'reconcil', 'missing from cmdb'])) {
    const { rows } = await pool.query(`
      SELECT
        COUNT(*) FILTER (WHERE match_status='vmware_only')    AS ghost,
        COUNT(*) FILTER (WHERE match_status='drift_detected') AS drift,
        COUNT(*) FILTER (WHERE drift_severity='critical')     AS critical,
        COUNT(*) FILTER (WHERE drift_severity='warning')      AS warning
      FROM cmdb_drift_results
      WHERE run_date = (SELECT MAX(run_date) FROM cmdb_drift_results)
    `)
    const r = rows[0]
    return `CMDB reconciliation:\n• Ghost VMs (in VMware, not CMDB): **${num(r.ghost)}**\n• Attribute drift: **${num(r.drift)}**\n  - Critical: ${num(r.critical)}\n  - Warning: ${num(r.warning)}`
  }

  if (match(t, ['datastore', 'storage capacity', 'free space', 'disk space'])) {
    const { rows } = await pool.query(`
      WITH latest AS (
        SELECT DISTINCT ON (vcenter_id) id FROM vcenter_snapshots
        WHERE status='complete' ORDER BY vcenter_id, collected_at DESC
      )
      SELECT COUNT(*) AS total,
        COUNT(*) FILTER (WHERE used_pct >= 90) AS critical,
        COUNT(*) FILTER (WHERE used_pct >= 75 AND used_pct < 90) AS warning,
        ROUND(SUM(capacity_gb)/1024) AS total_tb,
        ROUND(SUM(free_gb)/1024)     AS free_tb
      FROM datastores
      WHERE snapshot_id IN (SELECT id FROM latest) AND capacity_gb > 0
    `)
    const r = rows[0]
    return `Datastore summary:\n• Total: **${num(r.total)}** datastores\n• Total capacity: **${num(r.total_tb)} TB**\n• Free: **${num(r.free_tb)} TB**\n• Critical (>90%): ${num(r.critical)}\n• Warning (>75%): ${num(r.warning)}`
  }

  if (match(t, ['how many vcenter', 'vcenter count', 'number of vcenter'])) {
    const { rows } = await pool.query(`
      SELECT COUNT(*) AS total,
        COUNT(*) FILTER (WHERE COALESCE(category,'Legacy')='ITCC')   AS itcc,
        COUNT(*) FILTER (WHERE COALESCE(category,'Legacy')='Legacy') AS legacy
      FROM vcenters
    `)
    const r = rows[0]
    return `There are **${num(r.total)} vCenters** — ITCC: ${num(r.itcc)}, Legacy: ${num(r.legacy)}`
  }

  if (match(t, ['snapshot', 'vms with snapshot', 'has snapshot'])) {
    const { rows } = await pool.query(`
      WITH latest AS (
        SELECT DISTINCT ON (vcenter_id) id FROM vcenter_snapshots
        WHERE status='complete' ORDER BY vcenter_id, collected_at DESC
      )
      SELECT COUNT(*) AS cnt FROM virtual_machines
      WHERE snapshot_id IN (SELECT id FROM latest) AND has_snapshots=true
    `)
    return `**${num(rows[0].cnt)} VMs** have active snapshots. Consolidate before migration. See Risk Dashboard → Snapshots tab.`
  }

  if (match(t, ['last run', 'pipeline', 'last update', 'etl status', 'when was data'])) {
    const { rows } = await pool.query(`
      SELECT pipeline, status, started_at, finished_at, records_out
      FROM pipeline_run_log
      WHERE run_date >= CURRENT_DATE - INTERVAL '2 days'
      ORDER BY started_at DESC LIMIT 5
    `)
    if (!rows.length) return 'No pipeline runs found in the last 2 days.'
    const labels: Record<string, string> = {
      rvtools: 'RVTools ETL', cmdb: 'CMDB ETL', reconciliation: 'Reconciliation',
    }
    const lines = rows.map((r: any) =>
      `  • ${labels[r.pipeline]||r.pipeline}: ${r.status} — ${new Date(r.started_at).toLocaleString('en-US',{timeZone:'America/Toronto',month:'short',day:'numeric',hour:'2-digit',minute:'2-digit',hour12:true})} EST`)
    return `Recent pipeline runs:\n${lines.join('\n')}`
  }

  // Not recognised — return null to fall through to Azure
  return null
}

// ══════════════════════════════════════════════════════════════
// LAYER 2 — Azure OpenAI (for complex / unrecognised questions)
// Fetches relevant DB context first, then calls Azure GPT-4o.
// ══════════════════════════════════════════════════════════════
async function getContext(question: string): Promise<string> {
  const t = question.toLowerCase()
  const parts: string[] = []

  try {
    // Always include estate summary
    const { rows: s } = await pool.query(`
      WITH latest AS (
        SELECT DISTINCT ON (vcenter_id) id, vcenter_id FROM vcenter_snapshots
        WHERE status='complete' ORDER BY vcenter_id, collected_at DESC
      )
      SELECT
        COUNT(DISTINCT l.vcenter_id)                                 AS vcenters,
        SUM(s.vm_count)                                              AS total_vms,
        COUNT(*) FILTER (WHERE COALESCE(v.category,'Legacy')='ITCC')   AS itcc_vcenters,
        COUNT(*) FILTER (WHERE COALESCE(v.category,'Legacy')='Legacy') AS legacy_vcenters
      FROM latest l
      JOIN vcenter_snapshots s ON s.id = l.id
      JOIN vcenters v ON v.id = l.vcenter_id
    `)
    parts.push(`ESTATE: ${JSON.stringify(s[0])}`)

    // Always include vCenter breakdown (anonymised — no FQDNs)
    const { rows: vcs } = await pool.query(`
      WITH latest AS (
        SELECT DISTINCT ON (vcenter_id) id, vcenter_id FROM vcenter_snapshots
        WHERE status='complete' ORDER BY vcenter_id, collected_at DESC
      )
      SELECT
        COALESCE(v.category,'Legacy') AS category,
        s.vm_count,
        s.host_count,
        s.cluster_count,
        COALESCE(stats.powered_on,0)  AS powered_on,
        COALESCE(stats.powered_off,0) AS powered_off
      FROM latest l
      JOIN vcenter_snapshots s ON s.id = l.id
      JOIN vcenters v ON v.id = l.vcenter_id
      LEFT JOIN LATERAL (
        SELECT
          COUNT(*) FILTER (WHERE powerstate='poweredOn')  AS powered_on,
          COUNT(*) FILTER (WHERE powerstate='poweredOff') AS powered_off
        FROM virtual_machines WHERE snapshot_id = l.id
      ) stats ON true
      ORDER BY v.category, s.vm_count DESC
    `)
    // Anonymise — send category + counts only, no vCenter names
    const itcc    = vcs.filter((v: any) => v.category === 'ITCC')
    const legacy  = vcs.filter((v: any) => v.category === 'Legacy')
    const fmtList = (list: any[]) => list.map((v: any, i: number) =>
      `VC-${String(i+1).padStart(2,'0')} [${v.category}]: ${v.vm_count} VMs, ${v.host_count} hosts, ${v.cluster_count} clusters, ${v.powered_on} on/${v.powered_off} off`
    ).join('\n  ')
    parts.push(`VCENTER BREAKDOWN:\n  ${fmtList([...itcc,...legacy])}`)

    // Conditional sections
    if (match(t, ['risk','rdm','usb','snapshot','blocking','warning'])) {
      const { rows: r } = await pool.query(`
        WITH latest AS (SELECT DISTINCT ON (vcenter_id) id FROM vcenter_snapshots WHERE status='complete' ORDER BY vcenter_id, collected_at DESC)
        SELECT COUNT(*) FILTER (WHERE has_usb OR has_rdm OR vcpus>16) AS blocking,
          COUNT(*) FILTER (WHERE has_snapshots) AS snapshots, COUNT(*) FILTER (WHERE has_rdm) AS rdm,
          COUNT(*) FILTER (WHERE has_usb) AS usb, COUNT(*) FILTER (WHERE is_suspended) AS suspended
        FROM virtual_machines WHERE snapshot_id IN (SELECT id FROM latest)
      `)
      parts.push(`RISKS: ${JSON.stringify(r[0])}`)
    }

    if (match(t, ['cmdb','ghost','drift','reconcil','missing'])) {
      const { rows: r } = await pool.query(`
        SELECT COUNT(*) FILTER (WHERE match_status='vmware_only') AS ghost,
          COUNT(*) FILTER (WHERE match_status='drift_detected') AS drift,
          COUNT(*) FILTER (WHERE drift_severity='critical') AS critical
        FROM cmdb_drift_results
        WHERE run_date=(SELECT MAX(run_date) FROM cmdb_drift_results)
      `)
      parts.push(`CMDB: ${JSON.stringify(r[0])}`)
    }

    if (match(t, ['datastore','storage','capacity','disk'])) {
      const { rows: r } = await pool.query(`
        WITH latest AS (SELECT DISTINCT ON (vcenter_id) id FROM vcenter_snapshots WHERE status='complete' ORDER BY vcenter_id, collected_at DESC)
        SELECT COUNT(*) AS total, COUNT(*) FILTER (WHERE used_pct>=90) AS critical,
          ROUND(SUM(capacity_gb)/1024) AS total_tb, ROUND(SUM(free_gb)/1024) AS free_tb
        FROM datastores WHERE snapshot_id IN (SELECT id FROM latest) AND capacity_gb>0
      `)
      parts.push(`DATASTORES: ${JSON.stringify(r[0])}`)
    }

  } catch (err: any) {
    console.error('[chat] context fetch error:', err.code)
  }

  return parts.join('\n\n')
}

async function azureQuery(messages: any[]): Promise<string> {
  const endpoint   = process.env.AZURE_OPENAI_ENDPOINT
  const apiKey     = process.env.AZURE_OPENAI_KEY
  const deployment = process.env.AZURE_OPENAI_DEPLOYMENT || 'gpt-4o'
  const apiVersion = process.env.AZURE_OPENAI_API_VERSION || '2024-11-01-preview'

  if (!endpoint || !apiKey) {
    return 'Azure OpenAI is not configured. Set AZURE_OPENAI_ENDPOINT and AZURE_OPENAI_KEY in the app secret.'
  }

  const lastQuestion = messages[messages.length - 1]?.content || ''
  const context      = await getContext(lastQuestion)

  const systemPrompt = `You are EVIT Assistant, an AI for the Enterprise VMware Intelligence Tool.
Help VMware administrators understand their virtual infrastructure.

Use the following live estate data to answer accurately. Never make up numbers.
Format numbers with commas. Use bullet points for lists. Keep answers concise.
If asked for data not in context, say it is not available and suggest the relevant dashboard page.

LIVE ESTATE DATA:
${context}`

  const url = `${endpoint}/openai/deployments/${deployment}/chat/completions?api-version=${apiVersion}`

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'api-key':      apiKey,
    },
    body: JSON.stringify({
      max_tokens:  1024,
      temperature: 0.2,
      messages: [
        { role: 'system', content: systemPrompt },
        ...messages.map((m: any) => ({
          role:    m.role,
          content: m.content,
        })),
      ],
    }),
  })

  const data = await res.json()

  if (!res.ok) {
    console.error('[chat] Azure error:', data?.error?.code)
    return 'AI service error. Please try again.'
  }

  return data.choices?.[0]?.message?.content || 'No response received.'
}

// ══════════════════════════════════════════════════════════════
// POST handler — tries local engine first, falls back to Azure
// ══════════════════════════════════════════════════════════════
export async function POST(req: NextRequest) {
  try {
    const { messages } = await req.json()
    if (!messages || !Array.isArray(messages)) {
      return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
    }

    const question = messages[messages.length - 1]?.content || ''

    // Try local rule engine first — instant, no data leaves cluster
    const localAnswer = await localQuery(question)
    if (localAnswer) {
      return NextResponse.json({ response: localAnswer, source: 'local' })
    }

    // Fall through to Azure OpenAI for complex/unrecognised questions
    const azureAnswer = await azureQuery(messages)
    return NextResponse.json({ response: azureAnswer, source: 'azure' })

  } catch (err: any) {
    console.error('[chat] error:', err.code)
    return NextResponse.json({
      response: 'Sorry, something went wrong. Please try again.',
    })
  }
}
