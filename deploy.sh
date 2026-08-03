#!/bin/bash
set -euo pipefail

PROJECT_DIR="/home/ubuntu/apps/hotel-crm"

echo "===== Starting Deployment ====="

cd "$PROJECT_DIR"

TARGET_SHA="${DEPLOY_SHA:-origin/main}"

echo "Deploying: $TARGET_SHA"

# Fetch latest code
git fetch origin

# Deploy exact SHA from GitHub Actions, otherwise latest main
if [ -n "${DEPLOY_SHA:-}" ]; then
    git checkout "$DEPLOY_SHA"
else
    git checkout main
    git reset --hard origin/main
fi

echo "Installing dependencies..."

# npm workspaces -> install once at root
npm ci

echo "Generating Prisma Client..."

cd backend
npx --no-install prisma generate

echo "Running Prisma Migrations..."

npx --no-install prisma migrate deploy

cd ..

echo "Building application..."

# Uses the root build script:
# backend -> npm run build
# frontend -> npm run build
npm run build

echo "Reloading PM2..."

pm2 reload hotelcrm-backend --update-env

pm2 save

echo "===== Deployment Successful ====="