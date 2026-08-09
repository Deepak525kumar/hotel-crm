#!/bin/bash
set -euo pipefail

echo "===== Starting Deployment ====="

cd /home/ubuntu/apps/hotel-crm

echo "Fetching latest code..."

PREV=$(git rev-parse HEAD)

git fetch origin
git reset --hard origin/main

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

# document-templates review follow-up (2026-08-10, PR #398): the `playwright`
# npm package (installed above via npm ci) is NOT the same thing as the
# Chromium browser binary it drives -- that's a separate ~300MB download.
# Without this, PDF preview/finalize fails on first real use with no warning
# at deploy time (checkChromium(), lib/health.ts, surfaces this at
# /health/ready, but only AFTER a bad deploy already happened). `playwright
# install` is itself idempotent (checks its local cache, skips the download
# if already present) -- unconditional here, same as `prisma generate`
# above, rather than gated behind the package-lock.json diff check like
# `npm ci`: a fresh EC2 instance/AMI could be missing the Chromium cache
# even when package-lock.json hasn't changed since the last deploy.
echo "Ensuring Playwright's Chromium browser is installed..."
npx --no-install playwright install --with-deps chromium

cd ..

echo "Building application..."
npm run build

echo "Restarting ecosystem..."
pm2 reload ecosystem.config.js --env production --update-env

pm2 save

echo "===== Deployment Successful ====="
