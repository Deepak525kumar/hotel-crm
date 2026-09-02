#!/bin/bash
set -euo pipefail

echo "===== Starting Deployment ====="

cd /home/ubuntu/apps/hotel-crm

echo "Fetching latest code..."

PREV=$(git rev-parse HEAD)

git fetch origin
git reset --hard origin/main

# Self-modifying-script guard: this script just rewrote the very file bash
# is currently interpreting (git reset --hard above can change this file's
# own content/size). A plain `./deploy.sh` invocation reads the script
# incrementally by byte offset as it executes, NOT fully into memory up
# front -- so any line after the reset can be read from the wrong offset
# into the NEW file content, silently running stale bytes left over from
# whatever this file used to contain (this is exactly how a since-removed
# Playwright/Chromium install step from an old revision of this script kept
# reappearing in deploy logs long after it was deleted from every branch).
# DEPLOY_REEXEC breaks the read/execute loop: re-invoke the freshly-checked-
# out file as a brand new process, which opens and reads it cleanly from
# byte zero, then let that process finish the rest of the deployment.
if [ -z "${DEPLOY_REEXEC:-}" ]; then
  exec env DEPLOY_REEXEC=1 DEPLOY_PREV_SHA="$PREV" bash "$0" "$@"
fi

PREV="$DEPLOY_PREV_SHA"
NEW=$(git rev-parse HEAD)

# Where deploy.yml rsyncs the CI-built backend/dist before invoking this
# script. Kept outside the repo working tree so `git reset --hard` above can
# never touch it.
STAGED_DIST="${STAGED_DIST:-/home/ubuntu/deploy-staging/dist}"

# Install the BACKEND workspace's PRODUCTION dependencies only.
#
# This was a bare `npm ci` from the repo root, which in an npm-workspaces
# monorepo installs every workspace: backend + frontend (Next.js) + both
# Expo/React Native mobile apps, dev dependencies included. Measured on this
# host: 1.5 GB of node_modules, 849 hoisted packages, on a 1.9 GB box -- and
# the peak RSS during the install itself (~1.27 GB) is what drove the machine
# a gigabyte into swap on every deploy and got `npm ci` OOM-killed outright
# on 2026-08-03. None of it was ever needed here: the frontend runs on Vercel
# and the mobile apps ship through EAS/the daiwi portal. This host only ever
# runs backend/dist.
#
# Measured tree sizes: 1396 packages (what this used to install) -> 196
# (backend, production only). `--include-workspace-root` is deliberately NOT
# passed: the root package.json carries expo/react/react-native as its own
# production dependencies, so including it would pull the mobile tree back in.
if ! git diff --quiet "$PREV" "$NEW" -- package-lock.json backend/package.json; then
    echo "Lockfile or backend manifest changed. Installing production dependencies..."
    npm ci --omit=dev --workspace backend
else
    echo "Dependencies unchanged. Skipping npm ci."
fi

# Prisma stays on the HOST deliberately, both steps:
#   - `generate` produces a platform-specific query-engine binary, so it must
#     run where the code will actually execute. CI builds on Node 20 while
#     this host runs Node 22 (see deploy.yml's own note) -- generating here
#     removes that mismatch as a source of "Unable to require query engine"
#     failures entirely, rather than relying on the two staying compatible.
#   - `migrate deploy` needs live database connectivity, which this host has
#     and GitHub's runners do not (RDS is not publicly reachable).
# Neither is memory-heavy; neither is what the OOM kill was about.
echo "Generating Prisma client..."
cd backend

npx --no-install prisma generate

echo "Running migrations..."
npx --no-install prisma migrate deploy

cd ..

# Take the build produced in CI (deploy.yml) rather than compiling here.
#
# Falls back to building on the host when no staged artifact is present, so a
# failed/skipped transfer degrades to the previous behaviour instead of
# restarting pm2 onto a stale or missing dist. The fallback needs
# devDependencies (typescript) that the production install above omits, hence
# the extra install on that path only -- still backend-scoped (595 packages),
# never the full 1396-package monorepo.
if [ -d "$STAGED_DIST" ]; then
    echo "Installing CI-built application from $STAGED_DIST..."
    rm -rf backend/dist
    mv "$STAGED_DIST" backend/dist
    rmdir "$(dirname "$STAGED_DIST")" 2>/dev/null || true
else
    echo "WARNING: no staged build at $STAGED_DIST -- building on the host (fallback)."
    npm ci --workspace backend
    npm run build --workspace backend
fi

echo "Restarting ecosystem..."
pm2 reload ecosystem.config.js --env production --update-env

pm2 save

echo "===== Deployment Successful ====="
