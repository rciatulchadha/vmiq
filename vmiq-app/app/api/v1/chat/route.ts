import { NextRequest, NextResponse } from 'next/server'
import pool from '@/lib/db'

// ── Fetch live context from DB to answer the question ──────────

async function getEstateContext(question: string): Promise<string> {
  const q = question.toLowerCase()
  const sections: string[] = []

  try {
    // Always include top-level summary
    const { rows: summary } = await pool.query(`
      WITH latest AS (
        SELECT DISTINCT ON (vcenter_id) id, vcenter_id
        FROM vcenter_snapshots WHERE status='complete'
        ORDER BY vcenter_id, collected_at DESC
      )
      SELECT
        COUNT(DISTINCT l.vcenter_id)                        AS vcenters,
        SUM(vm_count)                                       AS total_vms,
        COUNT(*) FILTER (WHERE v.category='ITCC')           AS itcc_vcenters,
        COUNT(*) FILTER (WHERE COALESCE(v.category,'Legacy')='Legacy') AS legacy_vcenters,
        MAX(s.collected_at)                                 AS last_updated
      FROM latest l
      JOIN vcenter_snapshots s ON s.id = l.id
      JOIN vcenters v ON v.id = l.vcenter_id
    `)
    sections.push(`ESTATE SUMMARY: ${JSON.stringify(summary[0])}`)

    // vCenter breakdown — always useful
    const { rows: vcs } = await pool.query(`
      WITH latest AS (
        SELECT DISTINCT ON (vcenter_id) id, vcenter_id
        FROM vcenter_snapshots WHERE status='complete'
        ORDER BY vcenter_id, collected_at DESC
      )
      SELECT v.name, COALESCE(v.category,'Legacy') AS category,
             s.vm_count, s.host_count, s.cluster_count,
             COALESCE(stats.powered_on,0) AS powered_on,
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
      ORDER BY v.category, v.name
    `)
    sections.push(`VCENTER BREAKDOWN:\n${vcs.map(v =>
      `  ${v.name} [${v.category}]: ${v.vm_count} VMs (${v.powered_on} on, ${v.powered_off} off), ${v.host_count} hosts, ${v.cluster_count} clusters`
    ).join('\n')}`)

    // OS distribution if asked
    if (q.includes('os') || q.includes('operating') || q.includes('windows') ||
        q.includes('linux') || q.includes('rhel') || q.includes('centos')) {
      const { rows: os } = await pool.query(`
        WITH latest AS (
          SELECT DISTINCT ON (vcenter_id) id FROM vcenter_snapshots
          WHERE status='complete' ORDER BY vcenter_id, collected_at DESC
        ),
        grouped AS (
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
        SELECT os_group, COUNT(*) AS count FROM grouped
        GROUP BY os_group ORDER BY count DESC
      `)
      sections.push(`OS DISTRIBUTION:\n${os.map(r => `  ${r.os_group}: ${r.count}`).join('\n')}`)
    }

    // Risk summary if asked
    if (q.includes('risk') || q.includes('rdm') || q.includes('snapshot') ||
        q.includes('usb') || q.includes('blocking') || q.includes('warning')) {
      const { rows: risks } = await pool.query(`
        WITH latest AS (
          SELECT DISTINCT ON (vcenter_id) id FROM vcenter_snapshots
          WHERE status='complete' ORDER BY vcenter_id, collected_at DESC
        )
        SELECT
          COUNT(*) FILTER (WHERE has_usb OR has_rdm OR vcpus>16) AS blocking,
          COUNT(*) FILTER (WHERE has_snapshots) AS with_snapshots,
          COUNT(*) FILTER (WHERE has_rdm)       AS with_rdm,
          COUNT(*) FILTER (WHERE has_usb)       AS with_usb,
          COUNT(*) FILTER (WHERE has_cdrom)     AS with_cdrom,
          COUNT(*) FILTER (WHERE is_suspended)  AS suspended
        FROM virtual_machines WHERE snapshot_id IN (SELECT id FROM latest)
      `)
      sections.push(`RISK SUMMARY: ${JSON.stringify(risks[0])}`)
    }

    // CMDB if asked
    if (q.includes('cmdb') || q.includes('ghost') || q.includes('drift') ||
        q.includes('reconcil') || q.includes('missing')) {
      const { rows: cmdb } = await pool.query(`
        SELECT
          COUNT(*) FILTER (WHERE match_status='vmware_only')    AS ghost_vms,
          COUNT(*) FILTER (WHERE match_status='drift_detected') AS drift_vms,
          COUNT(*) FILTER (WHERE drift_severity='critical')     AS critical_drift,
          COUNT(*) FILTER (WHERE drift_severity='warning')      AS warning_drift
        FROM cmdb_drift_results
        WHERE run_date = (SELECT MAX(run_date) FROM cmdb_drift_results)
      `)
      sections.push(`CMDB RECONCILIATION: ${JSON.stringify(cmdb[0])}`)
    }

    // Datastore if asked
    if (q.includes('datastore') || q.includes('storage') || q.includes('disk') ||
        q.includes('capacity') || q.includes('free')) {
      const { rows: ds } = await pool.query(`
        WITH latest AS (
          SELECT DISTINCT ON (vcenter_id) id FROM vcenter_snapshots
          WHERE status='complete' ORDER BY vcenter_id, collected_at DESC
        )
        SELECT COUNT(*) AS total,
          COUNT(*) FILTER (WHERE used_pct >= 90) AS critical,
          COUNT(*) FILTER (WHERE used_pct >= 75 AND used_pct < 90) AS warning,
          ROUND(SUM(capacity_gb)/1024) AS total_tb,
          ROUND(SUM(free_gb)/1024)     AS free_tb
        FROM datastores WHERE snapshot_id IN (SELECT id FROM latest) AND capacity_gb > 0
      `)
      sections.push(`DATASTORE SUMMARY: ${JSON.stringify(ds[0])}`)
    }

  } catch (err) {
    console.error('Context fetch error:', err)
  }

  return sections.join('\n\n')
}

// ── Chat API handler ───────────────────────────────────────────

export async function POST(req: NextRequest) {
  try {
    const { messages } = await req.json()
    if (!messages || !Array.isArray(messages)) {
      return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
    }

    const lastMessage = messages[messages.length - 1]?.content || ''
    const context     = await getEstateContext(lastMessage)

    const systemPrompt = `You are EVIT Assistant, an AI helper for the Enterprise VMware Intelligence Tool.
You help VMware administrators understand their virtual infrastructure.

You have access to live data from the database. Use the following context to answer questions accurately.
Always provide specific numbers when available. Be concise and direct.
Format numbers with commas for readability (e.g. 67,557 not 67557).
When listing vCenters or breakdowns, use bullet points.

LIVE ESTATE DATA:
${context}

Rules:
- Only answer questions about this VMware estate
- If asked for data not in context, say you don't have that specific data but suggest which dashboard page has it
- Never make up numbers — only use the data provided above
- Keep answers concise — 3-5 sentences or a short list`

    // ── Azure OpenAI ──────────────────────────────────────────────
    // Required env vars (set in OCP secret vmiq-app-secret):
    //   AZURE_OPENAI_ENDPOINT  = https://YOUR-RESOURCE.openai.azure.com
    //   AZURE_OPENAI_KEY       = your-api-key
    //   AZURE_OPENAI_DEPLOYMENT = your-deployment-name (e.g. gpt-4o)
    //   AZURE_OPENAI_API_VERSION = 2024-02-01

    const azureEndpoint   = process.env.AZURE_OPENAI_ENDPOINT
    const azureKey        = process.env.AZURE_OPENAI_KEY
    const azureDeployment = process.env.AZURE_OPENAI_DEPLOYMENT || 'gpt-4o'
    const azureApiVersion = process.env.AZURE_OPENAI_API_VERSION || '2024-02-01'

    if (!azureEndpoint || !azureKey) {
      console.error('Missing AZURE_OPENAI_ENDPOINT or AZURE_OPENAI_KEY')
      return NextResponse.json(
        { error: 'AI service not configured. Set AZURE_OPENAI_ENDPOINT and AZURE_OPENAI_KEY in the app secret.' },
        { status: 503 }
      )
    }

    const azureUrl = `${azureEndpoint}/openai/deployments/${azureDeployment}/chat/completions?api-version=${azureApiVersion}`

    const response = await fetch(azureUrl, {
      method:  'POST',
      headers: {
        'Content-Type': 'application/json',
        'api-key':      azureKey,
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

    const data = await response.json()

    if (!response.ok) {
      console.error('Azure OpenAI error:', data)
      return NextResponse.json(
        { error: data.error?.message || 'AI service error' }, { status: 500 })
    }

    const text = data.choices?.[0]?.message?.content || 'No response'

    return NextResponse.json({ response: text })

  } catch (err: any) {
    console.error('Chat error:', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
