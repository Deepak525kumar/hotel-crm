#!/usr/bin/env bash
#
# Deploys the Version Control service on the EC2 host. Idempotent — safe to
# re-run after any change.
#
#   cd /home/ubuntu/apps/hotel-crm/daiwi && ./scripts/deploy.sh
#
# Prerequisites, each done once and NOT repeated here because they involve
# secrets or superuser rights:
#   1. scripts/provision-db.sql has been run (creates the hotelcrm_vc role).
#   2. .env.production.local exists with PUBLIC_BASE_URL, DATABASE_URL, SESSION_SECRET.
#   3. AWS credentials for the scoped IAM user are in .env.production.local
#      (AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY) or supplied by the instance role.
set -euo pipefail

cd "$(dirname "$0")/.."
ROOT="$(pwd)"

echo "===== Version Control deploy ====="
echo "     dir: $ROOT"
echo "    node: $(node --version)"

echo
echo "→ Writing production environment"
./scripts/use-env.sh production

echo
echo "→ Installing dependencies"
# Dev dependencies are needed: the build runs tsc, and prisma's CLI performs the
# migration. They are pruned afterwards.
npm ci

echo
echo "→ Generating Prisma client"
npx --no-install prisma generate

echo
echo "→ Applying migrations"
# `migrate deploy` never resets and never prompts — the only migration command
# that belongs on a production host.
npx --no-install prisma migrate deploy

echo
echo "→ Building"
npm run build

echo
echo "→ Preparing the upload scratch directory"
# Uploads land here before being parsed and shipped to S3. On its own volume path
# so a runaway upload cannot fill the CRM's working directories.
STORAGE_ROOT="$(grep -E '^STORAGE_ROOT=' .env | cut -d= -f2- | tr -d '"')"
sudo mkdir -p "$STORAGE_ROOT/tmp"
sudo chown -R "$(id -un):$(id -gn)" "$STORAGE_ROOT"
chmod 700 "$STORAGE_ROOT"

echo
echo "→ Clearing any temp files left by an interrupted upload"
find "$STORAGE_ROOT/tmp" -type f -mmin +120 -delete 2>/dev/null || true

echo
echo "→ Pruning dev dependencies"
npm prune --omit=dev

echo
echo "→ Restarting under PM2"
cd "$ROOT/.."
pm2 startOrReload ecosystem.config.js --only hotel-crm-version-control --env production --update-env
pm2 save

echo
echo "→ Health check"
for attempt in $(seq 1 10); do
  if curl -fsS --max-time 3 http://127.0.0.1:3002/healthz > /dev/null; then
    echo "   healthy"
    break
  fi
  if [[ $attempt -eq 10 ]]; then
    echo "   FAILED — service did not come up. Recent logs:" >&2
    pm2 logs hotel-crm-version-control --lines 40 --nostream >&2
    exit 1
  fi
  sleep 2
done

echo
echo "===== Deploy complete ====="
echo "  admin   $(grep -E '^PUBLIC_BASE_URL=' "$ROOT/.env" | cut -d= -f2-)/version-control"
echo "  install $(grep -E '^PUBLIC_BASE_URL=' "$ROOT/.env" | cut -d= -f2-)/install"
