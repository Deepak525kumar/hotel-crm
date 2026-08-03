#!/bin/bash
set -euo pipefail

PROJECT_DIR="/home/ubuntu/apps/hotel-crm"

echo "===== Starting Deployment ====="

cd "$PROJECT_DIR"

# Deploy the exact commit that triggered the workflow.
if [ -n "${DEPLOY_SHA:-}" ]; then
    echo "Deploying commit: $DEPLOY_SHA"
    git fetch origin
    git checkout "$DEPLOY_SHA"
else
    echo "Deploying latest main"
    git fetch origin
    git checkout main
    git reset --hard origin/main
fi

echo "Installing dependencies..."
npm ci

echo "Generating Prisma client..."
cd backend
npx --no-install prisma generate

echo "Running Prisma migrations..."
npx --no-install prisma migrate deploy

cd ..

echo "Building project..."
npm run build

echo "Reloading PM2..."
pm2 reload hotelcrm-backend --update-env
pm2 save

echo "===== Deployment Successful ====="