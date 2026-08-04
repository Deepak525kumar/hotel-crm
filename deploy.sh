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

cd ..

echo "Building application..."
npm run build

echo "Restarting ecosystem..."
pm2 reload ecosystem.config.js --env production --update-env

pm2 save

echo "===== Deployment Successful ====="
