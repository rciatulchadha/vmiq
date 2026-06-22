#!/bin/bash -x
# ════════════════════════════════════════════════════════════
# EVIT secrets bootstrap — RUN ONCE MANUALLY, NEVER COMMIT
#
# These secrets are referenced by the ArgoCD-managed manifests
# but are deliberately NOT stored in Git. Run this script once
# per environment (or whenever credentials rotate).
#
# Usage: ./bootstrap-secrets.sh
# ════════════════════════════════════════════════════════════
set -e

echo "Creating EVIT secrets — you will be prompted for each value"
echo ""

# ── 1. PostgreSQL — fresh deploy, choose new credentials ────────
# These same values are used TWICE:
#   - POSTGRES_DB/USER/PASSWORD  → consumed by the StatefulSet itself
#     to initialise the database on first boot
#   - DATABASE_URL                → consumed by vmiq-app and all ETL
#     CronJobs to connect to it
# Host is always the in-cluster headless service — no need to ask.
PG_HOST="vmiq-postgres-svc.vmiq-data.svc.cluster.local"
PG_PORT=5432

read -p "PostgreSQL database [vmiq]: " PG_DB
PG_DB=${PG_DB:-vmiq}
read -p "PostgreSQL username [vmiquser]: " PG_USER
PG_USER=${PG_USER:-vmiquser}
read -sp "PostgreSQL password (choose a new one — fresh DB): " PG_PASS
echo ""

DATABASE_URL="postgresql://${PG_USER}:${PG_PASS}@${PG_HOST}:${PG_PORT}/${PG_DB}"

for ns in vmiq-app vmiq-ingestion vmiq-data; do
  oc create secret generic vmiq-postgres-secret \
    --from-literal=POSTGRES_DB="${PG_DB}" \
    --from-literal=POSTGRES_USER="${PG_USER}" \
    --from-literal=POSTGRES_PASSWORD="${PG_PASS}" \
    --from-literal=DATABASE_URL="${DATABASE_URL}" \
    -n "${ns}" \
    --dry-run=client -o yaml | oc apply -f -
  echo "  ✓ vmiq-postgres-secret created in ${ns}"
done

echo ""

# ── 2. Azure OpenAI ────────────────────────────────────────────
read -p "Azure OpenAI endpoint (https://YOUR-RESOURCE.openai.azure.com): " AZ_ENDPOINT
read -sp "Azure OpenAI API key: " AZ_KEY
echo ""
read -p "Azure OpenAI deployment name [gpt-4o]: " AZ_DEPLOY
AZ_DEPLOY=${AZ_DEPLOY:-gpt-4o}
read -p "Azure OpenAI API version [2024-11-01-preview]: " AZ_VERSION
AZ_VERSION=${AZ_VERSION:-2024-11-01-preview}

oc create secret generic vmiq-azure-secret \
  --from-literal=AZURE_OPENAI_ENDPOINT="${AZ_ENDPOINT}" \
  --from-literal=AZURE_OPENAI_KEY="${AZ_KEY}" \
  --from-literal=AZURE_OPENAI_DEPLOYMENT="${AZ_DEPLOY}" \
  --from-literal=AZURE_OPENAI_API_VERSION="${AZ_VERSION}" \
  -n vmiq-app \
  --dry-run=client -o yaml | oc apply -f -
echo "  ✓ vmiq-azure-secret created in vmiq-app"

echo ""

# ── 3. Quay pull secret (if repos are private) ────────────────
read -p "Quay username: " QUAY_USER
read -sp "Quay password / robot token: " QUAY_PASS
echo ""

for ns in vmiq-app vmiq-ingestion vmiq-ai; do
  oc create secret docker-registry quay-pull-secret \
    --docker-server=quay.io \
    --docker-username="${QUAY_USER}" \
    --docker-password="${QUAY_PASS}" \
    -n "${ns}" \
    --dry-run=client -o yaml | oc apply -f -
  oc secrets link default quay-pull-secret --for=pull -n "${ns}" 2>/dev/null || true
  echo "  ✓ quay-pull-secret created in ${ns}"
done

echo ""
echo "All secrets created. ArgoCD-managed workloads can now start successfully."
