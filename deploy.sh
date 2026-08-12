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

if ! git diff --quiet "$PREV" "$NEW" -- package-lock.json backend/package.json; then
    echo "package-lock.json changed. Installing dependencies..."
    npm ci
else
    echo "Dependencies unchanged. Skipping npm ci."
fi

echo "Generating Prisma client..."
cd backend

npx --no-install prisma generate

echo "Running migrations..."
npx --no-install prisma migrate deploy

cd ..

echo "Building application..."
npm run build

echo "Restarting ecosystem..."
pm2 reload ecosystem.config.js --env production --update-env

pm2 save

echo "===== Deployment Successful ====="
