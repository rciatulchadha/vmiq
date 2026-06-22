# EVIT — Enterprise VMware Intelligence Tool

## Overview

EVIT is a centralized VMware infrastructure intelligence platform built for large enterprise environments. It aggregates data from multiple vCenters across multiple estates, reconciles it against the ServiceNow CMDB, and presents a unified dashboard for infrastructure visibility, risk assessment, and reporting.

The platform is deployed on a self-hosted Red Hat OpenShift cluster and is designed with a security-first approach — no external API dependencies for core functionality, all data stays within the corporate network.

---

## Architecture

EVIT is structured across four OpenShift namespaces:

```
vmiq-data        PostgreSQL 15 + TimescaleDB, Redis
vmiq-ingestion   ETL CronJobs, file ingestion
vmiq-app         Next.js 14 dashboard
vmiq-ai          Reserved for local AI model (Ollama)
```

All persistent storage uses Ceph RBD (OCS) — no hostPath volumes, no node affinity constraints.

---

## Technology Stack

| Layer | Technology |
|---|---|
| Dashboard | Next.js 14 (React server components) |
| Database | PostgreSQL 15 + TimescaleDB |
| Cache | Redis |
| Storage | Ceph RBD via OpenShift Container Storage |
| Container registry | Quay.io |
| Platform | Red Hat OpenShift (self-hosted) |
| ETL | Python 3.12 (asyncpg, openpyxl) |
| Data sources | RVTools xlsx exports, ServiceNow CMDB CSV |

---

## Data Sources

### RVTools
- One xlsx file per vCenter, dropped nightly to `/uploads/ESTATE/`
- Contains: VM inventory, ESXi hosts, clusters, datastores, disks, NICs, snapshots
- Column naming convention: `vInfoVMName`, `vHostName`, `vClusterName` etc.

### ServiceNow CMDB
- Server CI export as CSV (`server_cmdb.csv`)
- 46,000+ CI records including virtual and physical servers
- Contains: CI name, status, OS, CPU, memory, IP, environment, discovery date

---

## Data Flow

### Nightly Pipeline

```
01:00  File sync
       RVTools xlsx files (14 per ITEAST estate) copied to
       /uploads/ITEAST/ on the uploads PVC via sync script

02:00  RVTools ETL (CronJob)
       - Scans /uploads/ESTATE/*.xlsx
       - Parses each file: vInfo, vHost, vCluster, vDatastore sheets
       - Writes to PostgreSQL:
           vcenter_snapshots → virtual_machines
                             → esx_hosts
                             → clusters
                             → datastores
       - Archives processed files to /uploads/ESTATE/archive/
       - One snapshot per vCenter per run

02:30  CMDB ETL (CronJob)
       - Reads /cmdb/ESTATE/server_cmdb.csv
       - Parses 46,000+ CI records
       - Writes to PostgreSQL:
           cmdb_snapshots → cmdb_ci_records
       - Archives processed file

03:00  Reconciliation (CronJob)
       - Reads latest vcenter_snapshots (all vCenters)
       - Reads latest cmdb_snapshot
       - Matches by: lower(trim(vm.name)) = lower(trim(ci.ci_name))
       - Classifies each VM as:
           vmware_only    → in VMware, not in CMDB (ghost VM)
           drift_detected → in both, attribute values differ
           clean          → matched, no differences (not stored)
       - Writes drift_fields as JSONB showing before/after values
       - Writes to: cmdb_drift_results

04:00  Data retention (CronJob)
       - Deletes snapshots older than RETENTION_DAYS (default 30)
       - CASCADE deletes all child records automatically
       - Vacuums tables to reclaim disk space

Morning Dashboard ready
       - All pages read from latest snapshots
       - Historical data preserved for trend analysis
       - EST timestamps shown throughout
```

---

## Database Schema

### RVTools chain (snapshot-based, append-only)

```
estates
  └── vcenters (category: ITCC | Legacy)
        └── vcenter_snapshots (one per vCenter per day)
              ├── virtual_machines
              ├── esx_hosts
              ├── clusters
              └── datastores
```

### CMDB chain

```
cmdb_snapshots (one per day)
  └── cmdb_ci_records (one row per CI)
```

### Reconciliation

```
cmdb_drift_results
  ├── vm_snapshot_id → vcenter_snapshots
  ├── cmdb_snapshot_id → cmdb_snapshots
  ├── vm_id → virtual_machines
  ├── match_status: vmware_only | drift_detected
  ├── drift_severity: critical | warning | info
  └── drift_fields: JSONB {"field": {"vmware": val, "cmdb": val}}
```

### Retention model
Every daily ETL run appends new rows — existing data is never overwritten. Deleting a snapshot cascades to all child tables. This enables 30-day trend analysis with a single `DISTINCT ON (vcenter_id) ORDER BY collected_at DESC` query pattern used throughout.

---

## Application Layer

### How the dashboard reads data

The Next.js app connects directly to PostgreSQL using the `pg` Node.js driver over TCP port 5432 — no REST API, no ORM, no intermediate service. All pages are server components that run SQL on every request (`force-dynamic`).

```
Browser request
      ↓
OCP Route (TLS edge)
      ↓
OAuth Proxy sidecar (LDAP SSO)
      ↓ injects x-forwarded-user header
Next.js server component
      ↓ calls lib/queries.ts
pg connection pool (max 10)
      ↓ TCP :5432
PostgreSQL 15
```

### Dashboard pages

| Page | What it shows |
|---|---|
| Global Overview | Summary cards, vCenter table, OS distribution chart, CMDB summary, pipeline status, datastore health |
| vCenters | Card per vCenter with VM counts, power state, resources, risk flags |
| Virtual Machines | Filterable VM table — category, vCenter, power state, OS |
| ESXi Hosts | Host inventory with cluster, version, CPU, memory |
| Clusters | Cluster capacity and allocation |
| Datastores | Utilisation sorted by usage percentage |
| CMDB Reconciliation | Ghost VMs tab + attribute drift tab with field-level diff |
| Risk Dashboard | 8 tabs — RDM, snapshots, USB, suspended, CD-ROM, tools, high vCPU |
| Reports | 10 CSV download reports with filters |
| Trends | VM/host/cluster growth charts over 30 days |

### Filters
All inventory pages use a shared `FilterBar` client component. Dropdowns are dynamically dependent:
- Selecting **ITCC** category instantly filters the vCenter dropdown to ITCC vCenters only
- Selecting a vCenter on the Hosts page instantly filters the Cluster dropdown to that vCenter's clusters
- No page reload required — React state updates drive the dropdown content

---

## Security

### Authentication
OCP OAuth Proxy sidecar handles LDAP SSO. Users log in once with corporate credentials. The proxy injects `x-forwarded-user` on every request. The Next.js middleware validates this header on all API routes and dashboard pages.

### API security
- All SQL queries use parameterised placeholders (`$1`, `$2`) — no string interpolation
- All filter inputs are whitelist-validated before use
- Rate limiting: chat 20 req/min, reports 30 req/min per IP
- Error responses return generic messages only — no stack traces or query details exposed

### Security headers
Every response includes: `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Content-Security-Policy`, `Referrer-Policy`, `X-XSS-Protection`.

### Data boundary
All data stays within the OCP cluster. The local rule-based chatbot queries PostgreSQL directly — no external AI API calls, no data leaves the network.

---

## Chatbot

The chatbot is a local rule-based query engine. It pattern-matches common questions and runs SQL directly against PostgreSQL. No external API, no data transmission, no API keys.

Supported questions include VM counts by category, vCenter breakdowns, power state summaries, OS distribution, risk summaries, CMDB ghost VM counts, datastore capacity, and pipeline run status.

---

## Reports

Ten CSV reports downloadable from the Reports page:

| Category | Reports |
|---|---|
| Inventory | VM Inventory, ESXi Host Inventory, Cluster Summary |
| Capacity | Datastore Capacity |
| Summary | OS Distribution, vCenter Summary |
| Risk | Risk Report, VMs with Snapshots |
| CMDB | Ghost VMs, CMDB Attribute Drift |

All reports support category filtering (ITCC / Legacy) and additional filters relevant to each report type.

---

## vCenter Categories

vCenters are tagged as either **ITCC** or **Legacy** via the `vcenters.category` column. This drives filtering across all dashboard pages and reports. Categories are currently set directly in the database and are planned to be sourced from the CMDB in a future release.

---

## Estates

The platform supports multiple estates (ITEAST, ITWEST, ITCENTRAL). Each estate has its own subdirectory under `/uploads/` and `/cmdb/`. The ETL jobs scan all estate subdirectories automatically. All data is consolidated into a single dashboard with estate-level filtering available.

---

## Operational Notes

### Adding a new estate
1. Create subdirectory: `/uploads/NEWNAME/` and `/cmdb/NEWNAME/`
2. Drop RVTools files and CMDB CSV into the respective folders
3. Trigger ETL — the estate is created automatically in the database
4. Dashboard shows the new estate immediately

### Changing data retention
```bash
oc patch configmap vmiq-retention-config -n vmiq-data \
  --type='json' -p='[{"op":"replace","path":"/data/RETENTION_DAYS","value":"60"}]'
```

### Manual ETL trigger
```bash
oc create job rvtools-manual-$(date +%s) \
  --from=cronjob/rvtools-etl -n vmiq-ingestion
```

### Clearing today's data and reloading
```bash
oc exec -n vmiq-data statefulset/vmiq-postgres -- \
  psql -U vmiquser -d vmiq -c "
DELETE FROM vcenter_snapshots WHERE DATE(collected_at) = CURRENT_DATE;
DELETE FROM cmdb_snapshots    WHERE DATE(fetched_at)   = CURRENT_DATE;
DELETE FROM cmdb_drift_results WHERE run_date           = CURRENT_DATE;
DELETE FROM pipeline_run_log  WHERE run_date            = CURRENT_DATE;"
```
