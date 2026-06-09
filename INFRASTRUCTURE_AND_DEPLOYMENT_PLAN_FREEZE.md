# INFRASTRUCTURE AND DEPLOYMENT PLAN — FREEZE

**Product:** Hotel Management CRM  
**Company:** Zirove  
**Stack:** Node.js · Express · Prisma · PostgreSQL · DigitalOcean · Expo  
**Architecture:** Modular Monolith (MVP) → path to microservices  
**Region:** Frankfurt `fra1` — GDPR-compliant EU hosting  
**Date frozen:** 2026-06-09  
**Status:** ✅ APPROVED  

> This document is the **canonical infrastructure source of truth**.  
> It supersedes `INFRASTRUCTURE_AND_DEPLOYMENT_PLAN.md`, `PATCH_V1`, and `PATCH_V2`.  
> Do not modify this document. Raise a new PATCH document for any future changes.

---

## 1. Final Production Topology

### Architecture

```
                    ┌──────────────────────────────────┐
                    │            INTERNET               │
                    └────────────────┬─────────────────┘
                                     │
                    ┌────────────────▼─────────────────┐
                    │       Cloudflare  (Free)          │
                    │                                   │
                    │  CDN · Universal SSL · Basic WAF  │
                    │  DDoS protection · Analytics      │
                    │  SSL mode: Full Strict            │
                    │  DNS TTL: 60s on all A records    │
                    └────────────────┬─────────────────┘
                                     │ HTTPS (Cloudflare origin cert)
          ┌──────────────────────────▼──────────────────────────────────┐
          │                  DigitalOcean  fra1                          │
          │                                                              │
          │  ┌───────────────────────────────────────────────────────┐  │
          │  │    Droplet — 8GB RAM · 4 vCPU · Ubuntu 24.04 LTS     │  │
          │  │                                                        │  │
          │  │  ┌──────────────────────────────────────────────┐     │  │
          │  │  │  Nginx  (ports 80 / 443)                     │     │  │
          │  │  │  api.hotelcrm.app    →  Express :3001        │     │  │
          │  │  │  hotelcrm.app        →  Next.js  :3000       │     │  │
          │  │  │  Security headers · gzip · rate limiting     │     │  │
          │  │  └──────────────────────────────────────────────┘     │  │
          │  │                                                        │  │
          │  │  ┌─────────────────────┐  ┌─────────────────────┐    │  │
          │  │  │  Express API (pm2)  │  │  Next.js Web (pm2)  │    │  │
          │  │  │  Port 3001          │  │  Port 3000           │    │  │
          │  │  │  Internal only      │  │  Internal only       │    │  │
          │  │  └─────────────────────┘  └─────────────────────┘    │  │
          │  │                                                        │  │
          │  │  ┌──────────────────────────────────────────────┐     │  │
          │  │  │  Redis  (Docker · 127.0.0.1:6379)            │     │  │
          │  │  │  Non-critical cache · allkeys-lru · 512MB    │     │  │
          │  │  │  Failure: Express continues, latency +400ms  │     │  │
          │  │  └──────────────────────────────────────────────┘     │  │
          │  └───────────────────────────────────────────────────────┘  │
          │                            │                                 │
          │  ┌─────────────────────────▼───────────────────────────┐    │
          │  │  DO Managed PostgreSQL  (fra1)                       │    │
          │  │  4GB RAM · 2-node (primary + hot standby)           │    │
          │  │  SSL required · VPC-internal · PITR enabled         │    │
          │  │  Daily auto-snapshots · 30-day retention            │    │
          │  └─────────────────────────────────────────────────────┘    │
          │                                                              │
          │  ┌──────────────────────────────────────────────────────┐   │
          │  │  DO Spaces  (fra1)                                   │   │
          │  │  hotelcrm-uploads  (private · versioned)             │   │
          │  │  hotelcrm-backups  (private)                         │   │
          │  │  Pre-signed URLs · 15-min TTL · no public ACL        │   │
          │  │  Cross-region replication: fra1 → ams3               │   │
          │  └──────────────────────────────────────────────────────┘   │
          └─────────────────────────────────────────────────────────────┘

  Clients:
  ├── Mobile (single Expo app — role-based)   ──┐
  ├── Web Frontend (Next.js)                  ──┼──▶  Cloudflare → Nginx
  └── Admin Dashboard                         ──┘

  External Services:
  ├── APNs    Apple Push Notification Service (iOS)
  ├── FCM     Firebase Cloud Messaging (Android · free)
  ├── SendGrid Transactional email (free 100/day)
  ├── Sentry  Error tracking (free tier)
  └── Expo EAS Mobile builds + OTA (free tier)
```

### Nginx Configuration

```nginx
# /etc/nginx/sites-available/hotelcrm

ssl_certificate     /etc/ssl/cloudflare/cert.pem;
ssl_certificate_key /etc/ssl/cloudflare/key.pem;

# Rate limiting zones
limit_req_zone $binary_remote_addr zone=auth:10m rate=2r/s;
limit_req_zone $binary_remote_addr zone=api:10m  rate=20r/s;

# ── API ──────────────────────────────────────────────────────────
server {
    listen 443 ssl http2;
    server_name api.hotelcrm.app;

    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
    add_header X-Content-Type-Options    "nosniff"                              always;
    add_header X-Frame-Options           "DENY"                                 always;
    add_header Referrer-Policy           "strict-origin-when-cross-origin"      always;
    add_header Content-Security-Policy
        "default-src 'none'; connect-src 'self' https://fra1.digitaloceanspaces.com" always;

    location /api/v1/auth {
        limit_req zone=auth burst=10 nodelay;
        proxy_pass         http://127.0.0.1:3001;
        proxy_http_version 1.1;
        proxy_set_header   Host              $host;
        proxy_set_header   X-Real-IP         $remote_addr;
        proxy_set_header   X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto $scheme;
    }

    location /api/ {
        limit_req zone=api burst=50 nodelay;
        proxy_pass         http://127.0.0.1:3001;
        proxy_http_version 1.1;
        proxy_set_header   Host              $host;
        proxy_set_header   X-Real-IP         $remote_addr;
        proxy_set_header   X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto $scheme;
    }

    gzip on;
    gzip_types application/json application/javascript text/plain;
    gzip_min_length 1024;
}

# ── Web Frontend ──────────────────────────────────────────────────
server {
    listen 443 ssl http2;
    server_name hotelcrm.app www.hotelcrm.app;

    location / {
        proxy_pass         http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header   Host              $host;
        proxy_set_header   X-Real-IP         $remote_addr;
        proxy_set_header   X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto $scheme;
    }
}

# HTTP → HTTPS redirect
server {
    listen 80;
    server_name api.hotelcrm.app hotelcrm.app www.hotelcrm.app;
    return 301 https://$host$request_uri;
}
```

### pm2 Ecosystem

```javascript
// /opt/hotel-crm/ecosystem.config.js
module.exports = {
  apps: [
    {
      name: 'hotel-crm-api',
      script: './backend/dist/server.js',
      cwd: '/opt/hotel-crm',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '700M',
      env_file: '/etc/hotel-crm/.env',
      env_production: { NODE_ENV: 'production', PORT: 3001 },
    },
    {
      name: 'hotel-crm-web',
      script: 'node_modules/.bin/next',
      args: 'start -p 3000',
      cwd: '/opt/hotel-crm/frontend',
      instances: 1,
      autorestart: true,
      watch: false,
      env_file: '/etc/hotel-crm/.env',
    },
  ],
};
```

### Redis Docker Compose

```yaml
# /opt/hotel-crm/docker-compose.prod.yml
services:
  redis:
    image: redis:7-alpine
    command: >
      redis-server
      --requirepass ${REDIS_PASSWORD}
      --maxmemory 512mb
      --maxmemory-policy allkeys-lru
    restart: always
    ports:
      - "127.0.0.1:6379:6379"
    volumes:
      - redis_data:/data

volumes:
  redis_data:
```

> Redis is **non-critical**. If it crashes, Express catches `ECONNREFUSED`, logs a warning at `WARN` level, and continues serving requests directly from PostgreSQL. No data is lost. Restart with `docker compose -f docker-compose.prod.yml restart redis`.

### DNS Records (Cloudflare)

| Record | Name | Value | Proxy |
|---|---|---|---|
| A | `api.hotelcrm.app` | `<Droplet IP>` | ON (orange cloud) |
| A | `hotelcrm.app` | `<Droplet IP>` | ON |
| A | `www.hotelcrm.app` | `<Droplet IP>` | ON |
| A | `status.hotelcrm.app` | UptimeRobot | OFF (DNS only) |

### Cloudflare Settings

| Setting | Value |
|---|---|
| SSL/TLS mode | Full (Strict) |
| Origin certificate | Cloudflare-issued, installed on Nginx |
| WAF | Managed rules ON (OWASP Core Rule Set) |
| DDoS | Automatic (always on) |
| Rate limiting | `/api/v1/auth`: 10K req/10min per IP |
| DNS TTL | 60s on all A records |

### DO Cloud Firewall (applied to Droplet)

```
Inbound:
  TCP 443  ← Cloudflare IP ranges only  (https://www.cloudflare.com/ips/)
  TCP 80   ← Cloudflare IP ranges only
  TCP 22   ← Developer/office IPs only  (never 0.0.0.0/0)

Outbound:
  All — permit  (APNs, FCM, SendGrid, DO Spaces, PostgreSQL VPC)
```

---

## 2. Final Staging Topology

Staging mirrors production at reduced capacity. It shares no resources with production.

```
Branch trigger:  develop → auto-deploy
Domain:          staging-api.hotelcrm.app

Droplet:         4GB RAM · 2 vCPU · Ubuntu 24.04 · fra1
PostgreSQL:      1GB RAM · single node · fra1 (hotelcrm_staging database)
DO Spaces:       shared bucket  hotelcrm-staging  (no cross-region replication)
Redis:           Docker on Droplet  (same as production)
Cloudflare:      staging-api.hotelcrm.app behind Cloudflare (same zone)
Nginx:           same config, staging domain only
```

### Environment Variables (staging)

- All the same keys as production
- Different values: `DATABASE_URL` → staging cluster, `NODE_ENV=staging`
- Same Sentry DSN (environment tag distinguishes staging errors)
- Same APNs credentials (use sandbox APNs endpoint: `NODE_ENV !== 'production'`)

### Staging Rules

- No production data ever copied to staging
- Staging DB seeded with synthetic test data only
- Staging EAS build profile uses `APP_ENV=staging` → `staging-api.hotelcrm.app`
- Staging OTA channel: `staging` (separate from production channel)

---

## 3. Final CI/CD Strategy

### Branch Model

```
main      ─── Production-ready only. Protected. PR from develop required.
develop   ─── Staging integration branch. Protected. PR from feature/* required.
feature/* ─── All development work. Branched from develop. CI on push.
fix/*     ─── Bug fixes. Same rules as feature/*.
hotfix/*  ─── Emergency production fixes. Branched from main. Requires Mayank approval.
```

### Pipeline Flow

```
Push to feature/* or fix/*
    └── CI workflow (lint · typecheck · migrate · test)

Merge to develop
    └── CI workflow
    └── deploy-staging workflow (automatic)

Merge to main  (PR from develop only)
    └── CI workflow
    └── deploy-production workflow (manual approval gate — Mayank)
    └── Tag release/YYYYMMDD-HHmmss
```

### `.github/workflows/ci.yml`

```yaml
name: CI

on:
  push:
    branches: ['feature/**', 'fix/**', 'hotfix/**', 'develop', 'main']
  pull_request:
    branches: ['develop', 'main']

jobs:
  ci:
    runs-on: ubuntu-latest
    services:
      postgres:
        image: postgres:15-alpine
        env:
          POSTGRES_USER: test
          POSTGRES_PASSWORD: test
          POSTGRES_DB: hotelcrm_test
        options: >-
          --health-cmd pg_isready
          --health-interval 10s
          --health-timeout 5s
          --health-retries 5

    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'
          cache-dependency-path: backend/package-lock.json

      - name: Install deps
        run: npm ci
        working-directory: backend

      - name: Typecheck
        run: npm run typecheck
        working-directory: backend

      - name: Lint
        run: npm run lint
        working-directory: backend

      - name: Prisma migrate (test DB)
        run: npx prisma migrate deploy
        working-directory: backend
        env:
          DATABASE_URL: postgresql://test:test@localhost:5432/hotelcrm_test

      - name: Tests
        run: npm test
        working-directory: backend
        env:
          DATABASE_URL:            postgresql://test:test@localhost:5432/hotelcrm_test
          NODE_ENV:                test
          JWT_SECRET:              test-access-secret-min-32-characters-long!!
          JWT_REFRESH_SECRET:      test-refresh-secret-min-32-chars-long!!
          JWT_ACCESS_EXPIRY:       1h
          JWT_REFRESH_EXPIRY:      7d
          APNS_PRIVATE_KEY_BASE64: dGVzdA==
          APNS_KEY_ID:             TESTKEY123
          APNS_TEAM_ID:            TESTTEAM
          APNS_BUNDLE_ID:          com.zirove.hotelcrm.test
          DO_SPACES_KEY:           test
          DO_SPACES_SECRET:        test
          DO_SPACES_BUCKET:        test-bucket
          DO_SPACES_ENDPOINT:      https://fra1.digitaloceanspaces.com
          FIREBASE_PROJECT_ID:     test-project
```

### `.github/workflows/deploy-staging.yml`

```yaml
name: Deploy Staging

on:
  push:
    branches: [develop]

jobs:
  deploy:
    runs-on: ubuntu-latest
    environment: staging

    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'
          cache-dependency-path: backend/package-lock.json

      - name: Install deps
        run: npm ci --omit=dev
        working-directory: backend

      - name: Build
        run: npm run build
        working-directory: backend

      - name: Run migrations (staging)
        run: npx prisma migrate deploy
        working-directory: backend
        env:
          DATABASE_URL: ${{ secrets.STAGING_DATABASE_URL }}

      - name: Deploy to Staging Droplet
        uses: appleboy/ssh-action@v1.2.0
        with:
          host:     ${{ secrets.STAGING_DROPLET_IP }}
          username: deploy
          key:      ${{ secrets.STAGING_SSH_KEY }}
          script: |
            set -e
            cd /opt/hotel-crm
            git fetch origin develop
            git checkout origin/develop
            cd backend
            npm ci --omit=dev
            npm run build
            pm2 restart hotel-crm-api --update-env
            sleep 5
            curl -sf http://localhost:3001/api/v1/health || exit 1
            echo "Staging deploy OK"
```

### `.github/workflows/deploy-production.yml`

```yaml
name: Deploy Production

on:
  push:
    branches: [main]

jobs:
  deploy:
    runs-on: ubuntu-latest
    environment: production    # manual approval required — Mayank

    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'
          cache-dependency-path: backend/package-lock.json

      - name: Install deps
        run: npm ci --omit=dev
        working-directory: backend

      - name: Build
        run: npm run build
        working-directory: backend

      - name: Run migrations (production)
        run: npx prisma migrate deploy
        working-directory: backend
        env:
          DATABASE_URL: ${{ secrets.PROD_DATABASE_URL }}

      - name: Deploy to Production Droplet
        uses: appleboy/ssh-action@v1.2.0
        with:
          host:     ${{ secrets.PROD_DROPLET_IP }}
          username: deploy
          key:      ${{ secrets.PROD_SSH_KEY }}
          script: |
            set -e
            cd /opt/hotel-crm
            git fetch origin main
            git checkout origin/main
            cd backend
            npm ci --omit=dev
            npm run build
            pm2 reload hotel-crm-api --update-env
            sleep 10
            curl -sf http://localhost:3001/api/v1/health || exit 1
            echo "Production deploy OK"

      - name: Tag release
        run: |
          git tag "release/$(date +%Y%m%d-%H%M%S)"
          git push origin --tags
```

### Required GitHub Secrets

| Secret | Used In | Value |
|---|---|---|
| `PROD_DROPLET_IP` | deploy-production | Production Droplet public IP |
| `PROD_SSH_KEY` | deploy-production | Private key for `deploy` user on production Droplet |
| `PROD_DATABASE_URL` | deploy-production | Production PostgreSQL connection string |
| `STAGING_DROPLET_IP` | deploy-staging | Staging Droplet public IP |
| `STAGING_SSH_KEY` | deploy-staging | Private key for `deploy` user on staging Droplet |
| `STAGING_DATABASE_URL` | deploy-staging | Staging PostgreSQL connection string |
| `DIGITALOCEAN_ACCESS_TOKEN` | optional doctl usage | DO API token read/write |

### Deployment Process (Zero-Downtime)

```
1. GitHub Actions SSH into Droplet
2. git checkout origin/main      (atomic — no partial state)
3. npm ci --omit=dev             (install production deps)
4. npm run build                 (TypeScript → dist/)
5. npx prisma migrate deploy     (additive only — runs in seconds, no lock)
6. pm2 reload hotel-crm-api      (graceful: new process starts → old drains → old stops)
7. Health check: GET /api/v1/health → must return HTTP 200 with { status: "ok" }
8. On health failure: pm2 automatically restarts from last good state
```

**Migration rule:** All migrations must be additive (new columns with defaults, new tables). Rename/drop operations use the expand-contract pattern across two separate deploys.

### Mobile (Single Expo App)

```bash
# mobile/hotel-crm-app/

# OTA update to staging (no store submission)
cd mobile/hotel-crm-app
eas update --branch staging --message "description of change"

# Production build → App Store + Google Play
eas build --platform all --profile production
eas submit --platform all
```

**`mobile/hotel-crm-app/eas.json`:**

```json
{
  "cli": { "version": ">= 7.0.0" },
  "build": {
    "development": {
      "env": { "APP_ENV": "development" },
      "developmentClient": true,
      "distribution": "internal"
    },
    "staging": {
      "env": { "APP_ENV": "staging" },
      "distribution": "internal"
    },
    "production": {
      "env": { "APP_ENV": "production" },
      "distribution": "store",
      "autoIncrement": true
    }
  },
  "submit": {
    "production": {
      "ios":     { "appleId": "dev@zirove.com", "ascAppId": "XXXXXXXXXX" },
      "android": { "serviceAccountKeyPath": "./google-service-account.json" }
    }
  }
}
```

**Role-based routing (single app):**

```
Login → JWT received → role claim inspected
  WORKER   → WorkerNavigator   (task list, photo capture, work assignments)
  CHECKER  → CheckerNavigator  (quality verification, ratings)
  MANAGER  → ManagerNavigator  (dashboard, HR, staffing)

APP_ENV switches:
  development → http://localhost:3001/api/v1
  staging     → https://staging-api.hotelcrm.app/api/v1
  production  → https://api.hotelcrm.app/api/v1
```

### Rollback Procedure

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
RULE: NEVER run on production:
  prisma migrate reset   ← destroys all data
  prisma db push         ← use migrate deploy only
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

SCENARIO A — Deploy failed BEFORE migrations ran
  → Code-only rollback:
  ssh deploy@<PROD_IP>
  cd /opt/hotel-crm && git checkout tags/<last-good-tag>
  cd backend && npm ci --omit=dev && npm run build
  pm2 reload hotel-crm-api --update-env
  curl -sf http://localhost:3001/api/v1/health

SCENARIO B — Deploy failed AFTER migrations (additive migration)
  → Migration is backward-compatible: code-only rollback (same as A)

SCENARIO C — Deploy failed AFTER migrations (breaking migration)
  → Forward-fix required:
  1. Branch: git checkout -b hotfix/description main
  2. Write forward migration restoring compatibility
  3. Verify locally against prod DB snapshot
  4. Mayank approves SQL
  5. Direct merge to main (hotfix bypass)
  6. Deploy via standard production workflow
  7. Document in RUNBOOK.md

SCENARIO D — Health check passes, users see errors
  → Check Sentry for new error spike
  → Check /api/v1/health for db/redis status
  → If db: "disconnected" — investigate PostgreSQL, do not rollback code
  → If redis: "degraded" — acceptable, monitor only

Post-incident: document date · what failed · fix · recovery time in RUNBOOK.md
```

---

## 4. Final Security Model

### Network Perimeter

```
Public Internet
    → Cloudflare (TLS termination, WAF, DDoS)
    → Droplet port 443 (Cloudflare IPs only via DO Firewall)
    → Nginx (origin cert, security headers, rate limiting)
    → Express :3001 (localhost only, never public)

Express → PostgreSQL:
    VPC-internal, SSL required (?sslmode=require), port 25060

Express → Redis:
    localhost:6379 only, password auth

Express → DO Spaces:
    HTTPS, private bucket, pre-signed URLs (15-min TTL, no public ACL)

Express → APNs / FCM / SendGrid:
    HTTPS outbound (permitted by DO Firewall)
```

### RBAC Enforcement

Four roles: `ADMIN` · `MANAGER` · `CHECKER` · `WORKER`

Every API request passes through:
1. `authMiddleware` — validates JWT, attaches `req.user`
2. `checkPermission(permission)` — validates role has the required permission code
3. `checkHotelAccess(hotelId)` — validates manager/worker is scoped to that hotel

Key scoping rules:
- Manager: can only access hotels listed in their `hotel_ids[]` array
- Worker: can only see/modify their own assigned tasks and data
- Checker: read access to all tasks in their hotel for verification
- Admin: system-wide access — only admin can create new users (signup endpoint)
- Payroll: `DELETE` operation is prohibited at the application layer (7-year tax retention)

### Application Security

```
Rate limiting (Nginx):
  Auth routes:  2 req/s per IP, burst 10
  API routes:   20 req/s per IP, burst 50

Rate limiting (Express — express-rate-limit):
  Auth routes:  100 req/15min per IP (defence-in-depth)
  API routes:   1000 req/min per IP

Input validation:
  All request bodies validated via Zod schemas before controller logic
  Server returns 422 VALIDATION_ERROR on schema failure

Encryption at rest:
  Payroll data:         AES-256 (encrypted_data BYTEA column, key ref in encryption_key_id)
  Worker documents:     Encrypted in DO Spaces (server-side encryption)
  Contract PDFs:        Encrypted in DO Spaces
  Passwords:            bcrypt (cost factor 12)

Encryption in transit:
  All external traffic: TLS 1.3 via Cloudflare
  Cloudflare → Nginx:   TLS (origin certificate, Full Strict mode)
  Nginx → PostgreSQL:   TLS (sslmode=require)
  Nginx → DO Spaces:    HTTPS

Audit logging:
  Every sensitive access (CONTRACT, PAYROLL, DOCUMENT, WORKER) logged to AuditLog table
  Fields: actor_id, actor_role, action, resource_type, resource_id, ip (hashed), timestamp
  Retention: 5 years (PostgreSQL, never bulk-deleted)
```

### PushToken Schema Requirement

The `PushToken` model must be present in `schema.prisma` before the notifications module is provisioned:

```prisma
model PushToken {
  id         String   @id @default(cuid())
  user_id    String
  user       User     @relation(fields: [user_id], references: [id], onDelete: Cascade)
  token      String   @unique
  platform   String   // "apns" | "fcm"
  device_id  String?
  created_at DateTime @default(now())
  updated_at DateTime @updatedAt

  @@index([user_id])
  @@index([platform])
}
```

Token cleanup (background job, daily): delete tokens with `updated_at` older than 90 days.  
On push delivery failure (invalid token): delete the `PushToken` row immediately.

---

## 5. Final Secrets Strategy

### Secrets Storage

All production secrets are stored in `/etc/hotel-crm/.env` on the Droplet.

```bash
# File permissions — enforced before first deploy
sudo chown deploy:deploy /etc/hotel-crm/.env
sudo chmod 600 /etc/hotel-crm/.env

# pm2 reads via ecosystem.config.js: env_file: '/etc/hotel-crm/.env'
# Secrets are NEVER in /opt/hotel-crm/backend/.env (git-accessible path)
# Secrets are NEVER in GitHub repository
# Secrets are NEVER in Docker image layers
```

Archive all production secrets (with rotation dates) in the team password manager (1Password or Bitwarden) under project `hotel-crm-production`.

### Complete Secrets Reference

| Secret | Purpose | Min Length | Rotation Cadence | Rotation Invalidates |
|---|---|---|---|---|
| `DATABASE_URL` | PostgreSQL connection | — | On breach / quarterly | Nothing (reconnects) |
| `JWT_SECRET` | Signs access tokens (1h) | 32 chars | Quarterly | All active access tokens |
| `JWT_REFRESH_SECRET` | Signs refresh tokens (7d) | 32 chars | Quarterly | All sessions → forced re-login |
| `REDIS_PASSWORD` | Redis auth | 24 chars | Quarterly | Redis reconnects |
| `DO_SPACES_KEY` | Spaces upload/download | — | Quarterly | File operations |
| `DO_SPACES_SECRET` | Spaces upload/download | — | Quarterly | File operations |
| `APNS_PRIVATE_KEY_BASE64` | APNs push (base64 .p8) | — | On key expiry / breach | Nothing (new key) |
| `APNS_KEY_ID` | APNs key identifier | — | With APNS key | — |
| `APNS_TEAM_ID` | Apple Developer Team | — | Never | — |
| `APNS_BUNDLE_ID` | App bundle identifier | — | Never | — |
| `FIREBASE_PROJECT_ID` | FCM Android push | — | Never | — |
| `SENDGRID_API_KEY` | Transactional email | — | Annually | Email delivery |
| `SENTRY_DSN` | Error tracking | — | Project change only | Error reporting |

### `.env.example` (committed to repository)

```bash
# Application
NODE_ENV=development
PORT=3001
API_VERSION=v1

# Database (DigitalOcean Managed PostgreSQL)
DATABASE_URL=postgresql://user:password@db.fra1.ondigitalocean.com:25060/hotelcrm?sslmode=require

# Redis
REDIS_URL=redis://:password@localhost:6379

# JWT — two separate secrets (access + refresh)
JWT_SECRET=your-access-token-secret-min-32-characters-here
JWT_REFRESH_SECRET=your-refresh-token-secret-min-32-chars
JWT_ACCESS_EXPIRY=1h
JWT_REFRESH_EXPIRY=7d

# DigitalOcean Spaces
DO_SPACES_KEY=your-spaces-access-key
DO_SPACES_SECRET=your-spaces-secret-key
DO_SPACES_BUCKET=hotelcrm-uploads
DO_SPACES_REGION=fra1
DO_SPACES_ENDPOINT=https://fra1.digitaloceanspaces.com

# APNs (iOS push) — base64-encoded .p8 key, never the raw file
APNS_PRIVATE_KEY_BASE64=base64-encoded-p8-key-content
APNS_KEY_ID=XXXXXXXXXX
APNS_TEAM_ID=XXXXXXXXXX
APNS_BUNDLE_ID=com.zirove.hotelcrm

# Firebase (Android push)
FIREBASE_PROJECT_ID=your-firebase-project-id

# Email
SENDGRID_API_KEY=your-sendgrid-api-key

# Error Tracking
SENTRY_DSN=https://your-key@sentry.io/project-id

# CORS
CORS_ORIGIN=https://hotelcrm.app
FRONTEND_URL=https://hotelcrm.app

# Logging
LOG_LEVEL=info
```

### `src/config/env.ts` (fail-fast validation)

```typescript
import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV:                z.enum(['development', 'staging', 'production']),
  PORT:                    z.coerce.number().default(3001),
  DATABASE_URL:            z.string().url(),
  REDIS_URL:               z.string().optional(),
  JWT_SECRET:              z.string().min(32),
  JWT_REFRESH_SECRET:      z.string().min(32),
  JWT_ACCESS_EXPIRY:       z.string().default('1h'),
  JWT_REFRESH_EXPIRY:      z.string().default('7d'),
  DO_SPACES_KEY:           z.string().min(1),
  DO_SPACES_SECRET:        z.string().min(1),
  DO_SPACES_BUCKET:        z.string().min(1),
  DO_SPACES_REGION:        z.string().default('fra1'),
  DO_SPACES_ENDPOINT:      z.string().url(),
  APNS_PRIVATE_KEY_BASE64: z.string().min(1),
  APNS_KEY_ID:             z.string().min(1),
  APNS_TEAM_ID:            z.string().min(1),
  APNS_BUNDLE_ID:          z.string().min(1),
  FIREBASE_PROJECT_ID:     z.string().min(1),
  SENDGRID_API_KEY:        z.string().optional(),
  SENTRY_DSN:              z.string().url().optional(),
  CORS_ORIGIN:             z.string().url(),
  LOG_LEVEL:               z.enum(['error', 'warn', 'info', 'debug']).default('info'),
});

export const env = envSchema.parse(process.env);
// Server refuses to start if any required secret is absent or malformed.
```

### APNs Key Encoding

```bash
# One-time: encode .p8 to base64 (run locally, never on server)
base64 < ~/Downloads/AuthKey_XXXXXXXXXX.p8 | tr -d '\n'
# Paste output as APNS_PRIVATE_KEY_BASE64 value

# Runtime decode in notifications service
const keyBuffer = Buffer.from(env.APNS_PRIVATE_KEY_BASE64, 'base64');
```

### APNs Key Rotation Procedure

```
1. Generate new key — Apple Developer Console → Keys → (+) → APNs
2. Download AuthKey_NEWID.p8 locally only
3. base64 < AuthKey_NEWID.p8 | tr -d '\n'
4. SSH to Droplet → edit /etc/hotel-crm/.env
   APNS_PRIVATE_KEY_BASE64=<new value>
   APNS_KEY_ID=<new key id>
5. pm2 reload hotel-crm-api --update-env
6. Send test push to a registered device — confirm delivery
7. Revoke old key in Apple Developer Console
8. shred -u ~/Downloads/AuthKey_NEWID.p8
9. Record rotation in compliance register
```

### JWT Rotation Procedure

```bash
# Generate new secrets
openssl rand -base64 48 | tr -d '\n'   # new JWT_SECRET
openssl rand -base64 48 | tr -d '\n'   # new JWT_REFRESH_SECRET

# Update /etc/hotel-crm/.env on Droplet
# pm2 reload hotel-crm-api --update-env

# JWT_REFRESH_SECRET rotation invalidates ALL refresh tokens — force re-login:
psql $DATABASE_URL -c 'DELETE FROM "Session";'
# Users will re-login on their next app open
```

---

## 6. Final Backup and DR Strategy

### PostgreSQL Backup Tiers

| Tier | Method | Frequency | Retention | RPO |
|---|---|---|---|---|
| Automated snapshots | DO Managed DB | Daily 02:00 UTC | 30 days (prod) / 7 days (staging) | 24h |
| Point-in-time recovery | Continuous WAL streaming | — | 7 days | 5 min |
| Weekly export | `pg_dump` → DO Spaces | Sunday 03:00 UTC | 90 days | — |

DO Managed PostgreSQL PITR is enabled on the standard 2-node cluster tier (no additional action required).

### Weekly Export Cron (on Droplet)

```bash
# /etc/cron.d/hotelcrm-backup
0 3 * * 0 deploy /opt/hotel-crm/scripts/backup.sh

# /opt/hotel-crm/scripts/backup.sh
#!/bin/bash
set -e
source /etc/hotel-crm/.env
FILENAME="hotelcrm-$(date +%Y%m%d).dump"
pg_dump "$DATABASE_URL" --format=custom --compress=9 \
  | aws s3 cp - "s3://hotelcrm-backups/weekly/$FILENAME" \
    --endpoint-url https://fra1.digitaloceanspaces.com
echo "Backup complete: $FILENAME"
```

### DO Spaces Backup Policy

- `hotelcrm-uploads`: versioning ON — 30-day version retention
- Cross-region replication: `fra1` → `ams3` (async, for DR)
- Lifecycle: transition objects to ARCHIVE tier after 180 days
- No public ACL on any object; pre-signed URLs only (15-min TTL)

### Backup Validation

Monthly restore drill (first Monday of each month — GitHub Actions cron):

```bash
# Restore latest weekly dump to throwaway cluster
doctl databases create hotel-crm-restore-test \
  --engine pg --version 15 --size db-s-1vcpu-1gb --region fra1

pg_restore --clean --if-exists -d $RESTORE_DATABASE_URL \
  hotelcrm-$(date +%Y%m%d).dump

# Validate schema integrity
npx prisma db pull --force  # compare against schema.prisma

# Tear down
doctl databases delete hotel-crm-restore-test
```

### RPO / RTO Targets

| Tier | Event | RPO | RTO |
|---|---|---|---|
| P1 — DB corruption / botched migration | PITR restore | 5 min | 1 hour |
| P2 — App crash / OOM | pm2 auto-restart | 0 | < 1 min |
| P3 — DO fra1 region outage | Weekly export restore to ams3 | 24h | 4 hours |
| P4 — Secrets exposure | Immediate rotation | N/A | 30 min |

### DR Runbooks

#### P1 — Database Recovery (PITR)

```bash
# 1. List available restore points
doctl databases backup list <prod-db-id>

# 2. Restore to new cluster
doctl databases restore <prod-db-id> \
  --restore-from-timestamp "2026-06-09T02:00:00Z" \
  --name hotel-crm-restored

# 3. Update DATABASE_URL in /etc/hotel-crm/.env to restored cluster
# 4. pm2 reload hotel-crm-api --update-env
# 5. Verify: curl http://localhost:3001/api/v1/health → db: "connected"
# 6. Run prisma db pull to confirm schema integrity
```

#### P2 — App Process Recovery

```bash
# pm2 auto-restarts on crash — usually self-healing within seconds
# If pm2 itself fails:
pm2 resurrect                          # restore last saved process list
# If Droplet rebooted:
pm2 startup                            # re-register pm2 with systemd
pm2 start /opt/hotel-crm/ecosystem.config.js --env production
pm2 save
```

#### P3 — Region Failover to ams3

```bash
# Pre-conditions (set up during provisioning):
#   hotelcrm-backups bucket replicating fra1 → ams3
#   Standby ams3 Droplet provisioned (same spec, same app, no traffic)

# 1. Restore latest weekly dump to ams3 Managed DB
pg_restore --clean --if-exists -d $AMS3_DATABASE_URL \
  hotelcrm-$(date +%Y%m%d).dump

# 2. Update /etc/hotel-crm/.env on ams3 Droplet:
#    DATABASE_URL → ams3 cluster
#    (all other secrets are identical — copied from fra1 .env)

# 3. pm2 start /opt/hotel-crm/ecosystem.config.js --env production

# 4. Update Cloudflare DNS A record:
#    api.hotelcrm.app → <ams3 Droplet IP>
#    (TTL 60s — propagates in ~1 minute)

# 5. Update status.hotelcrm.app UptimeRobot with incident note
```

Expected total RTO: 2–4 hours (restore + DNS propagation).

#### P4 — Secrets Breach Response

```bash
# Execute within 30 minutes of confirmed breach

# 1. Rotate JWT_REFRESH_SECRET → all sessions invalidated
openssl rand -base64 48 | tr -d '\n'
# Edit /etc/hotel-crm/.env → pm2 reload hotel-crm-api --update-env
psql $DATABASE_URL -c 'DELETE FROM "Session";'

# 2. Rotate DO Spaces key pair in DO control panel
# Edit /etc/hotel-crm/.env → pm2 reload hotel-crm-api --update-env

# 3. Rotate DB password in DO Managed DB control panel
# Update DATABASE_URL in /etc/hotel-crm/.env → pm2 reload

# 4. Audit scope review
psql $DATABASE_URL -c \
  "SELECT * FROM \"AuditLog\"
   WHERE timestamp > NOW() - INTERVAL '48h'
   ORDER BY timestamp DESC LIMIT 1000;"

# 5. GDPR notification (if personal data accessed):
#    Notify affected users within 72 hours (GDPR Article 33)
#    Notify BfDI (Germany DPA) if breach is reportable
```

### DR Communication Plan

| Event | 0–15 min | 1 hour | Resolution |
|---|---|---|---|
| DB outage | Slack #incidents | Email hotel managers | Post-mortem within 48h |
| App outage | UptimeRobot → Slack | Update status.hotelcrm.app | RCA in 24h |
| Data breach | Internal escalation + legal | Notify affected users (GDPR 72h) | DPA notification if required |

---

## 7. Final GDPR Requirements

### Legal Prerequisites (production launch blockers)

All items must be completed before any production personal data is stored.

```
[ ] 1. Execute DigitalOcean DPA
       URL: https://cloud.digitalocean.com/account/legal
       Owner: Deepak Kumar (Data Controller)
       Action: Download → countersign → store signed copy in compliance register

[ ] 2. Verify EU data residency
       All DO resources provisioned in region fra1 (Frankfurt, Germany)
       Document: Screenshot of each resource region in DO dashboard

[ ] 3. Update privacy policy
       Add DigitalOcean as a named sub-processor
       Include: DO DPA URL · data types · retention periods
       Publish before first user registration

[ ] 4. Appoint Data Protection Contact
       Name: Mayank Malhotra (Lead Developer — technical DPC)
       Register contact in privacy policy

[ ] 5. Create compliance register
       Location: Google Drive / HotelCRM / Compliance
       Contents: DPA date · DO account ID · DPC name · first data ingestion date

[ ] 6. ConsentLog active before first signup
       POST /api/v1/auth/signup must write to consent_logs before creating User row
```

### Data Retention Policy

| Category | Retention | Deletion Method | Table | Notes |
|---|---|---|---|---|
| Contracts | Employment + 3 years | Soft delete + anonymize | `Contract` | |
| Payroll | 7 years from creation | Archive only — never delete | `Payroll` | Tax law override |
| Worker documents | Employment + 1 year | Soft delete + remove from Spaces | `WorkerDocument` | |
| Ratings | 2 years | Soft delete | `Rating` | |
| Audit logs | 5 years | **Never bulk-delete** | `AuditLog` | GDPR compliance record |
| Application logs | 90 days | Auto-purge (log drain) | stdout | Operational only |
| Sessions | On expiry / logout | Hard delete | `Session` | |
| Push tokens | 90 days inactive | Hard delete (background job) | `PushToken` | |

> **Critical distinction:** The 90-day application log retention applies to **stdout logs only**. The `AuditLog` PostgreSQL table is the 5-year compliance record and is never subject to any log truncation, log drain policy, or bulk data cleanup operation.

### Data Subject Rights Implementation

```
Right to access:       GET /api/v1/auth/account/export    → JSON dump of all user data
Right to erasure:      DELETE /api/v1/auth/account/data-erase → soft delete + anonymize
Right to portability:  Same as access endpoint (machine-readable JSON)
Consent withdrawal:    Handled via account deletion flow
```

### Encryption at Rest for Sensitive Data

| Data | Method | Location |
|---|---|---|
| Payroll details | AES-256 (encrypted_data BYTEA column) | PostgreSQL |
| Contract PDFs | Server-side encryption | DO Spaces |
| Worker documents | Server-side encryption | DO Spaces |
| Passwords | bcrypt (cost 12) | PostgreSQL |

Encryption keys are referenced via `encryption_key_id` in the `Payroll` table — the actual key is stored in `/etc/hotel-crm/.env` and never in the database.

### GDPR Incident Obligation

Under GDPR Article 33: personal data breaches must be reported to the competent DPA within **72 hours** of discovery. For Germany (fra1 region): Bundesbeauftragte für den Datenschutz und die Informationsfreiheit (BfDI).

---

## 8. Final Deployment Checklist

### Phase 0 — Legal (before any data is stored)

```
[ ] Execute DigitalOcean DPA and store signed copy
[ ] Confirm all resources in fra1 region (screenshot evidence)
[ ] Appoint Data Protection Contact
[ ] Update privacy policy with DigitalOcean as sub-processor
[ ] Publish updated privacy policy
[ ] Create compliance register in Google Drive
```

### Phase 1 — Infrastructure Provisioning

```
Droplet:
[ ] Create DO project: hotel-crm — region: fra1
[ ] Provision Droplet: 8GB RAM, 4 vCPU, Ubuntu 24.04 LTS, fra1
[ ] Create non-root deploy user: useradd -m -s /bin/bash deploy
[ ] Add CI/CD SSH public key to /home/deploy/.ssh/authorized_keys
[ ] Apply DO Cloud Firewall: 443/80 ← Cloudflare IPs; 22 ← dev IPs only
[ ] Install: nginx, Node.js v20 (nvm), npm, pm2, docker, docker-compose
[ ] pm2 startup (register pm2 with systemd)

PostgreSQL:
[ ] Provision DO Managed PostgreSQL: 4GB RAM, 2-node, fra1
[ ] Create databases: hotelcrm_prod and hotelcrm_staging
[ ] Create least-privilege users (no superuser)
[ ] Enable PITR (verify in DO dashboard — enabled by default on 2-node)
[ ] Save connection strings (not to repo — to /etc/hotel-crm/.env)

DO Spaces:
[ ] Create bucket: hotelcrm-uploads — fra1 — private ACL
[ ] Create bucket: hotelcrm-backups — fra1 — private ACL
[ ] Enable versioning on hotelcrm-uploads (30-day)
[ ] Configure cross-region replication: fra1 → ams3
[ ] Generate Spaces access key pair → save to /etc/hotel-crm/.env

Cloudflare:
[ ] Add domain — point nameservers to Cloudflare
[ ] Create DNS A records (see Section 1)
[ ] Generate Cloudflare origin certificate → install at /etc/ssl/cloudflare/
[ ] Set SSL mode: Full (Strict)
[ ] Enable WAF managed rules
[ ] Set DNS TTL: 60s on all A records
```

### Phase 2 — Application Setup

```
Secrets:
[ ] Generate JWT_SECRET: openssl rand -base64 48 | tr -d '\n'
[ ] Generate JWT_REFRESH_SECRET: openssl rand -base64 48 | tr -d '\n'
[ ] Encode APNs .p8 key to base64 → save as APNS_PRIVATE_KEY_BASE64
[ ] Populate /etc/hotel-crm/.env with all secrets (chmod 600)
[ ] Archive all secrets in 1Password/Bitwarden under hotel-crm-production

Database:
[ ] Clone repo to /opt/hotel-crm
[ ] cd backend && npm ci
[ ] Add PushToken model to schema.prisma (see Section 4)
[ ] npx prisma migrate deploy (runs all migrations against hotelcrm_prod)
[ ] npx prisma db pull → verify schema matches schema.prisma

Application:
[ ] npm run build (TypeScript → dist/)
[ ] pm2 start ecosystem.config.js --env production
[ ] pm2 save
[ ] curl http://localhost:3001/api/v1/health → { "status": "ok", "db": "connected" }

Nginx:
[ ] Write /etc/nginx/sites-available/hotelcrm (see Section 1)
[ ] ln -s sites-available/hotelcrm sites-enabled/
[ ] nginx -t && systemctl reload nginx
[ ] curl https://api.hotelcrm.app/api/v1/health → HTTP 200

Redis:
[ ] docker compose -f /opt/hotel-crm/docker-compose.prod.yml up -d
[ ] docker logs hotel-crm_redis_1 → "Ready to accept connections"
```

### Phase 3 — Observability and CI/CD

```
Sentry:
[ ] Create Sentry project (free tier) — save DSN to /etc/hotel-crm/.env
[ ] npm install @sentry/node @sentry/profiling-node (backend)
[ ] Configure Sentry in src/server.ts (see original plan Section 4)
[ ] Verify: trigger a test error — confirm it appears in Sentry dashboard

Monitoring:
[ ] Configure DO Monitoring alerts: CPU >80%, memory >85%, DB disk >75%
[ ] Create UptimeRobot monitor: https://api.hotelcrm.app/api/v1/health (5-min interval)
[ ] Configure UptimeRobot Slack webhook → #alerts channel
[ ] Configure public status page: status.hotelcrm.app

Logging:
[ ] Confirm Winston JSON stdout is configured (see original plan Section 5)
[ ] pm2 install pm2-logrotate (7-day rotation on Droplet)
[ ] Optional: configure Logtail log drain for 30-day searchable history

CI/CD:
[ ] Add GitHub Secrets: PROD_DROPLET_IP, PROD_SSH_KEY, PROD_DATABASE_URL,
    STAGING_DROPLET_IP, STAGING_SSH_KEY, STAGING_DATABASE_URL
[ ] Write .github/workflows/ci.yml (Section 3)
[ ] Write .github/workflows/deploy-staging.yml (Section 3)
[ ] Write .github/workflows/deploy-production.yml (Section 3)
[ ] Set GitHub Environment "production": require Mayank manual approval
[ ] Branch protection: main (PR from develop, 1 reviewer, CI pass)
[ ] Branch protection: develop (PR from feature/*, CI pass)
[ ] Run first full staging deploy and smoke-test

Mobile:
[ ] Set up mobile/hotel-crm-app EAS project (single app — role-based)
[ ] Configure eas.json build profiles (development / staging / production)
[ ] eas build --platform all --profile development → test on device
[ ] Verify role routing: WORKER role → WorkerNavigator, CHECKER → CheckerNavigator
```

### Phase 4 — DR Hardening and GDPR Activation

```
Backup:
[ ] Write /opt/hotel-crm/scripts/backup.sh
[ ] Configure /etc/cron.d/hotelcrm-backup (Sunday 03:00 UTC)
[ ] Verify PITR is enabled in DO PostgreSQL dashboard
[ ] Confirm cross-region replication fra1 → ams3 is active

DR:
[ ] Run P1 restore drill: restore snapshot → throwaway DB → prisma db pull
[ ] Provision ams3 standby Droplet (same stack, no live traffic, ready for failover)
[ ] Run P4 drill: rotate JWT_SECRET → verify re-login behavior
[ ] Set Cloudflare DNS TTL to 60s (failover prerequisite)

GDPR:
[ ] Activate DataRetentionLog background job (node-cron, daily 00:00 UTC)
[ ] Activate contract/document expiry notification job (daily)
[ ] Verify ConsentLog is written on signup: POST /api/v1/auth/signup → check consent_logs
[ ] Run GDPR deletion test: create user → call DELETE /api/v1/auth/account/data-erase
    → verify: soft delete in DB, AuditLog entry written, Spaces files marked for deletion
[ ] Update compliance register with first production data ingestion date
```

---

## 9. Final Cost Model

### Monthly Production Costs

| Resource | Specification | Monthly Cost |
|---|---|---|
| DO Droplet | 8GB RAM · 4 vCPU · Ubuntu 24.04 · fra1 | €48 |
| DO Managed PostgreSQL | 4GB RAM · 2-node (primary + standby) · fra1 | €24 |
| DO Spaces | 50GB storage + egress · fra1 | €5 |
| Redis | Docker on Droplet — no additional cost | €0 |
| Cloudflare | Free tier (CDN · SSL · WAF · DDoS) | €0 |
| Firebase FCM | Free tier (100K messages/month) | €0 |
| APNs | Apple Developer Account €99/year (amortized) | ~€8 |
| SendGrid | Free tier (100 emails/day) | €0 |
| Sentry | Free tier (5K errors/month · 30-day retention) | €0 |
| UptimeRobot | Free tier (50 monitors · 5-min interval) | €0 |
| Expo EAS | Free tier (30 builds/month) | €0 |
| **Total MVP** | | **~€85/month** |

### Monthly Staging Costs

| Resource | Specification | Monthly Cost |
|---|---|---|
| DO Droplet (staging) | 4GB RAM · 2 vCPU · fra1 | ~€24 |
| DO Managed PostgreSQL (staging) | 1GB RAM · single node · fra1 | ~€15 |
| DO Spaces (staging) | Shared dev bucket | ~€2 |
| **Total Staging** | | **~€41/month** |

### Total Monthly Infrastructure Cost

| Environment | Cost |
|---|---|
| Production | ~€85 |
| Staging | ~€41 |
| **Grand Total** | **~€126/month** |

### Scaling Milestones

| Monthly Active Users | Est. Monthly Infra Cost | Key Upgrade Required |
|---|---|---|
| 0–500 (current MVP) | ~€85 | No change |
| 500–1,000 | ~€130 | Upgrade Droplet to 16GB RAM |
| 1,000–2,000 | ~€180 | Add DO Managed Redis (€15) · 2nd Droplet behind load balancer |
| 2,000–5,000 | ~€280 | PostgreSQL read replica · Cloudflare Pro ($20) |
| 5,000+ | ~€500+ | Architecture review — evaluate microservices extraction |

### Phase 2 Cost Additions (not in MVP budget)

| Trigger | Upgrade | Additional Cost |
|---|---|---|
| Redis crashes > 2×/week | DO Managed Redis 1GB | +€15/month |
| DB queries > 500ms average | PostgreSQL read replica | +€24/month |
| Error volume > 5K/month | Sentry Team plan | +€26/month |
| Mobile downloads > 10K | Expo EAS Production plan | +€29/month |
| API traffic > 100K req/day | Cloudflare Pro | +€20/month |

---

## Approval Record

| Role | Name | Status |
|---|---|---|
| Lead Developer | Mayank Malhotra | ✅ Approved |
| Project Manager | Ritik Garg | ✅ Approved |
| Client | Deepak Kumar | ✅ Approved |

**Document frozen:** 2026-06-09  
**Next review trigger:** Any architectural change, cost overrun >20%, or new security requirement.  
**Raise a new PATCH document** — do not modify this file.

```
╔═══════════════════════════════════════════════════════════════╗
║                                                               ║
║                         APPROVED                             ║
║                                                               ║
║  This document is the canonical infrastructure source of      ║
║  truth for Hotel CRM Phase 1 MVP.                             ║
║                                                               ║
║  Topology:     DigitalOcean Droplet 8GB · Nginx · pm2        ║
║  Database:     DO Managed PostgreSQL 4GB · 2-node · fra1     ║
║  Cache:        Redis Docker on Droplet (non-critical)         ║
║  CDN / SSL:    Cloudflare Free (Full Strict SSL)              ║
║  Mobile:       Single role-based Expo app                     ║
║  Branch model: feature/* → develop → main                     ║
║  Target cost:  ~€85/month production                          ║
║  Region:       Frankfurt fra1 (GDPR EU)                       ║
║                                                               ║
╚═══════════════════════════════════════════════════════════════╝
```
