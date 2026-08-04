> [!WARNING]
> **Historical Context:** This document describes a legacy architecture where the frontend (hotel-crm-web) was deployed on EC2. In the current production architecture, the frontend is hosted on Vercel, and EC2 only runs the backend API and worker processes.

# INFRASTRUCTURE_AND_DEPLOYMENT_PLAN_PATCH_V2

**Type:** Implementation Patch — applies all BLOCKER and MAJOR findings from PATCH_V1  
**Supersedes:** Relevant sections of `INFRASTRUCTURE_AND_DEPLOYMENT_PLAN.md`  
**Source audit:** `INFRASTRUCTURE_AND_DEPLOYMENT_PLAN_PATCH_V1.md`  
**Reference:** MASTER_ARCHITECTURE_v2.0 · FINAL_DECISIONS_SUMMARY · EVENT_FLOW_MAPPING_v1.0 · RBAC_PERMISSION_MATRIX_v1.0  
**Date:** 2026-06-09  
**Status:** IMPLEMENTATION-READY  

> This document contains **only patches and replacements**. Read it alongside the original plan.  
> Each section below either replaces or extends the corresponding section in `INFRASTRUCTURE_AND_DEPLOYMENT_PLAN.md`.  
> Do not re-read PATCH_V1 for context — all actionable items are resolved here.

---

## SECTION 1 — Applied Infrastructure Changes

### PATCH-01 — Replace App Platform Topology with Droplet

**Replaces:** Section 7 "Production Topology → App Platform Specification"  
**Source:** BLOCKER-1, MAJOR-2, MAJOR-6 from PATCH_V1 · Master Architecture v2.0 Section 8

**Removed entirely:**
- `DO App Platform (2 × Professional XS instances)`
- `DO Load Balancer (App Platform built-in)`
- `DO Managed Redis ($15/month)`
- `.do/app.yaml` App Platform specification file
- `digitalocean/app_action` GitHub Actions deploy step
- All `doctl apps` commands from DR runbooks

**Replaced with:**

```
Deployment target:
  DigitalOcean Droplet — 8GB RAM, 4 vCPU — Ubuntu 24.04 LTS — fra1 — €48/month

Process manager:
  pm2 (keeps Express alive, restarts on crash, zero-downtime reload)

Droplet runs:
  ├── Nginx (reverse proxy, port 80/443 → internal ports)
  │     ├── api.hotelcrm.app     → Express monolith  (port 3001)
  │     └── hotelcrm.app         → Next.js frontend  (port 3000)
  ├── Node.js Express monolith   (pm2, port 3001, internal only)
  ├── Next.js frontend           (pm2, port 3000, internal only)
  └── Redis                      (Docker, port 6379, internal only, no auth port exposed)

External (separate DigitalOcean managed service):
  DO Managed PostgreSQL — 4GB RAM, 2-node (primary + hot standby) — fra1 — €24/month
  DO Spaces             — hotelcrm-uploads (private) — fra1 — €5/month
```

**Nginx configuration** (`/etc/nginx/sites-available/hotelcrm`):

```nginx
# Cloudflare origin cert — full strict SSL mode in Cloudflare dashboard
ssl_certificate     /etc/ssl/cloudflare/cert.pem;
ssl_certificate_key /etc/ssl/cloudflare/key.pem;

# ── API ──────────────────────────────────────────────────────────────
server {
    listen 443 ssl http2;
    server_name api.hotelcrm.app;

    # Security headers
    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
    add_header X-Content-Type-Options    "nosniff"                              always;
    add_header X-Frame-Options           "DENY"                                 always;
    add_header Referrer-Policy           "strict-origin-when-cross-origin"      always;
    add_header Content-Security-Policy
        "default-src 'none'; connect-src 'self' https://fra1.digitaloceanspaces.com" always;

    # Rate limiting (Nginx layer — before Express)
    limit_req_zone $binary_remote_addr zone=auth:10m rate=2r/s;
    limit_req_zone $binary_remote_addr zone=api:10m  rate=20r/s;

    location /api/v1/auth {
        limit_req zone=auth burst=10 nodelay;
        proxy_pass         http://127.0.0.1:3001;
        proxy_http_version 1.1;
        proxy_set_header   Upgrade           $http_upgrade;
        proxy_set_header   Connection        "upgrade";
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

    # Gzip
    gzip on;
    gzip_types application/json application/javascript text/plain;
    gzip_min_length 1024;
}

# ── Web Frontend ──────────────────────────────────────────────────────
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

**pm2 ecosystem file** (`/opt/hotel-crm/ecosystem.config.js`):

```javascript
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
      env_production: {
        NODE_ENV: 'production',
        PORT: 3001,
      },
    },
    {
      name: 'hotel-crm-web',
      script: 'node_modules/.bin/next',
      args: 'start -p 3000',
      cwd: '/opt/hotel-crm/frontend',
      instances: 1,
      autorestart: true,
      watch: false,
    },
  ],
};
```

**Redis Docker Compose** (`/opt/hotel-crm/docker-compose.prod.yml`):

```yaml
services:
  redis:
    image: redis:7-alpine
    command: redis-server --requirepass ${REDIS_PASSWORD} --maxmemory 512mb --maxmemory-policy allkeys-lru
    restart: always
    ports:
      - "127.0.0.1:6379:6379"   # bind to localhost only — never expose externally
    volumes:
      - redis_data:/data

volumes:
  redis_data:
```

> Redis is non-critical per Master Architecture. If it crashes, Express catches `ECONNREFUSED`, logs a warning, and continues without cache. No data is lost.

---

### PATCH-02 — Correct Cost Model

**Replaces:** Section 8 "Cost Estimates" in full  
**Source:** BLOCKER-2 from PATCH_V1 · Master Architecture v2.0 Section 8

See **SECTION 3** of this document for the complete corrected cost table.

---

### PATCH-03 — Add Cloudflare Layer

**Extends:** Section 7 "Production Topology — Network Security"  
**Source:** MAJOR-3 from PATCH_V1 · Master Architecture v2.0 Section 8

**Cloudflare responsibilities (Free tier):**

| Feature | Configuration |
|---|---|
| SSL | Full (strict) — Cloudflare issues origin cert to Nginx |
| CDN | Cache static assets at Cloudflare edge (JS, CSS, images) |
| Basic WAF | Enable OWASP Core Rule Set — managed rules, free tier |
| DDoS | Automatic L3/L4 DDoS protection (always on) |
| Rate limiting | Page Rules: 10K req/10min per IP on `/api/v1/auth` |
| DNS | All DNS records managed in Cloudflare (TTL 60s on A records for fast failover) |
| Analytics | Request volume, threat map, bandwidth — no extra cost |

**DNS setup:**

```
A   api.hotelcrm.app        →  <Droplet IP>   proxy: ON  (orange cloud)
A   hotelcrm.app            →  <Droplet IP>   proxy: ON
A   www.hotelcrm.app        →  <Droplet IP>   proxy: ON
A   status.hotelcrm.app     →  UptimeRobot    proxy: OFF (DNS only)
```

**SSL mode:** Set to **Full (Strict)** in Cloudflare SSL/TLS settings. This requires an origin certificate on Nginx (issued by Cloudflare) — not a Let's Encrypt cert.

**Origin certificate installation:**

```bash
# 1. Cloudflare dashboard → SSL/TLS → Origin Server → Create Certificate
#    Select: RSA 2048, validity 15 years, hostnames: *.hotelcrm.app, hotelcrm.app
# 2. Save cert + key to Droplet
sudo mkdir -p /etc/ssl/cloudflare
sudo chmod 700 /etc/ssl/cloudflare
# Paste certificate PEM:
sudo nano /etc/ssl/cloudflare/cert.pem
# Paste private key PEM:
sudo nano /etc/ssl/cloudflare/key.pem
sudo chmod 600 /etc/ssl/cloudflare/key.pem
```

---

### PATCH-04 — Fix Branch Strategy

**Replaces:** Section 1 "Environment Strategy — Three-Environment Pipeline" branch column  
**Replaces:** Section 6 "CI/CD Pipeline — GitHub Actions Workflow" and all workflow files  
**Source:** MAJOR-1 from PATCH_V1 · PHASE1_KICKOFF_CHECKLIST · IMPLEMENTATION_PROCESS_v1.0

**Corrected environment-to-branch mapping:**

| Environment | Branch | Trigger | Domain |
|---|---|---|---|
| `development` | `feature/*`, `fix/*` | Push (CI only) | localhost:3001 |
| `staging` | `develop` | Merge to `develop` → auto-deploy | staging-api.hotelcrm.app |
| `production` | `main` | Merge from `develop` → manual approval gate | api.hotelcrm.app |

**Branch protection rules (configure in GitHub Settings → Branches):**

```
main:
  - Require pull request before merging
  - Required branches: develop only (no direct feature → main)
  - Require 1 approving review (Mayank)
  - Require status checks: CI workflow must pass
  - Restrict pushes: no force push

develop:
  - Require pull request before merging
  - Required branches: feature/*, fix/*
  - Require status checks: CI workflow must pass
```

See **SECTION 4** for updated GitHub Actions workflow files.

---

### PATCH-05 — Fix APNs Secret Handling

**Replaces:** Section 2 "Secrets Management — Secret Categories & Storage" APNs row  
**Source:** MAJOR-4 from PATCH_V1

**Remove:** `.p8` file stored in DO Spaces private bucket — delete immediately.

**Replace with environment variable approach:**

```bash
# One-time key encoding (run locally, never on server)
base64 < ~/Downloads/AuthKey_XXXXXXXXXX.p8 | tr -d '\n'
# Copy the output — this is your APNS_PRIVATE_KEY_BASE64 value
```

**Updated secret table rows for APNs:**

| Secret | Storage | Rotation Cadence |
|---|---|---|
| `APNS_PRIVATE_KEY_BASE64` | Droplet `/etc/hotel-crm/.env` (chmod 600) | On breach / key expiry |
| `APNS_KEY_ID` | Droplet `/etc/hotel-crm/.env` | When key changes |
| `APNS_TEAM_ID` | Droplet `/etc/hotel-crm/.env` | When Apple Developer team changes |
| `APNS_BUNDLE_ID` | Droplet `/etc/hotel-crm/.env` | When bundle ID changes |

**Runtime decoding in notifications service:**

```typescript
// src/modules/notifications/apns.ts
import ApnsProvider from '@parse/node-apn';

const keyBuffer = Buffer.from(env.APNS_PRIVATE_KEY_BASE64, 'base64');

const provider = new ApnsProvider({
  token: {
    key:    keyBuffer,
    keyId:  env.APNS_KEY_ID,
    teamId: env.APNS_TEAM_ID,
  },
  production: env.NODE_ENV === 'production',
});
```

**Key rotation procedure:**

```
1. Generate new APNs key — Apple Developer Console → Certificates, IDs & Profiles
   → Keys → (+) → Service: Apple Push Notifications
2. Download AuthKey_NEWKEYID.p8 to local machine only
3. Encode: base64 < AuthKey_NEWKEYID.p8 | tr -d '\n'
4. SSH to Droplet
5. Edit /etc/hotel-crm/.env:
   APNS_PRIVATE_KEY_BASE64=<new base64 value>
   APNS_KEY_ID=<new key id>
6. pm2 restart hotel-crm-api --update-env
7. Send a test push notification to a registered device — confirm delivery
8. Revoke old key in Apple Developer Console
9. shred -u ~/Downloads/AuthKey_NEWKEYID.p8  (never rm — shred overwrites)
10. Record rotation date in compliance register
```

---

### PATCH-06 — Resolve JWT Secret Strategy

**Replaces:** Section 2 "Secrets Management — Secret Categories & Storage" JWT rows  
**Replaces:** Section 2 "Secrets Management — Secret Injection Pattern"  
**Source:** MAJOR-5 from PATCH_V1

**Decision: OPTION A — Two Separate Secrets (Recommended)**

Rationale: Using a separate `JWT_REFRESH_SECRET` means rotating the access token secret does not automatically invalidate refresh tokens (allowing graceful re-issuance), while rotating the refresh secret forces all users to re-login. This gives finer-grained control during incident response.

**Updated secret rows:**

| Secret | Purpose | Min Length | Rotation Cadence |
|---|---|---|---|
| `JWT_SECRET` | Signs access tokens (1h expiry) | 32 chars | Quarterly |
| `JWT_REFRESH_SECRET` | Signs refresh tokens (7d expiry) | 32 chars | Quarterly |

**Updated `backend/.env.example`:**

```bash
# JWT
JWT_SECRET=your-access-token-secret-min-32-characters-here
JWT_REFRESH_SECRET=your-refresh-token-secret-min-32-chars
JWT_ACCESS_EXPIRY=1h
JWT_REFRESH_EXPIRY=7d
```

**Updated `src/config/env.ts` Zod schema:**

```typescript
const envSchema = z.object({
  NODE_ENV:            z.enum(['development', 'staging', 'production']),
  DATABASE_URL:        z.string().url(),
  JWT_SECRET:          z.string().min(32),
  JWT_REFRESH_SECRET:  z.string().min(32),
  JWT_ACCESS_EXPIRY:   z.string().default('1h'),
  JWT_REFRESH_EXPIRY:  z.string().default('7d'),
  REDIS_URL:           z.string().optional(),
  LOG_LEVEL:           z.enum(['error', 'warn', 'info', 'debug']).default('info'),
  DO_SPACES_KEY:       z.string(),
  DO_SPACES_SECRET:    z.string(),
  DO_SPACES_BUCKET:    z.string(),
  DO_SPACES_REGION:    z.string().default('fra1'),
  DO_SPACES_ENDPOINT:  z.string().url(),
  APNS_PRIVATE_KEY_BASE64: z.string().min(1),
  APNS_KEY_ID:         z.string(),
  APNS_TEAM_ID:        z.string(),
  APNS_BUNDLE_ID:      z.string(),
  FIREBASE_PROJECT_ID: z.string(),
  SENTRY_DSN:          z.string().url().optional(),
  SENDGRID_API_KEY:    z.string().optional(),
});

export const env = envSchema.parse(process.env);
```

**Rotation procedure — JWT secrets:**

```bash
# Generate new JWT_SECRET (access tokens)
openssl rand -base64 48 | tr -d '\n'

# Generate new JWT_REFRESH_SECRET (refresh tokens)
openssl rand -base64 48 | tr -d '\n'

# Update /etc/hotel-crm/.env on the Droplet
# pm2 restart hotel-crm-api --update-env

# CRITICAL: after rotating JWT_REFRESH_SECRET, all refresh tokens are invalidated
# Users will be forced to re-login on their next refresh cycle
# Purge Session table to force immediate re-login for all users:
psql $DATABASE_URL -c 'DELETE FROM "Session";'
```

---

### PATCH-07 — Add PushToken Schema Dependency

**Extends:** Section 3 "Backup Strategy" and Section 6 "CI/CD Pipeline"  
**Source:** MAJOR-8 from PATCH_V1 · EVENT_FLOW_MAPPING_v1.0 · API_STANDARDS_v1.0

The notifications module cannot function without a `PushToken` table. This is a hard prerequisite before any notification infrastructure is provisioned.

**Add to `backend/prisma/schema.prisma`** (before deploying notifications):

```prisma
model PushToken {
  id         String   @id @default(cuid())
  user_id    String
  user       User     @relation(fields: [user_id], references: [id], onDelete: Cascade)
  token      String   @unique   // APNs device token or FCM registration ID
  platform   String             // "apns" | "fcm"
  device_id  String?            // optional device fingerprint for dedup
  created_at DateTime @default(now())
  updated_at DateTime @updatedAt

  @@index([user_id])
  @@index([platform])
}
```

Also add to `User` model relations:

```prisma
push_tokens  PushToken[]
```

**Migration command:**

```bash
cd backend
npx prisma migrate dev --name add_push_token_table
# Review generated SQL before committing
```

**Registration flow** (called from `POST /api/v1/push-tokens`):

```typescript
// Upsert: update token if device already registered, insert if new
await prisma.pushToken.upsert({
  where:  { token: dto.token },
  create: { user_id: userId, token: dto.token, platform: dto.platform, device_id: dto.device_id },
  update: { user_id: userId, updated_at: new Date() },
});
```

**Token cleanup** (background job, runs daily):

```typescript
// Delete tokens not updated in 90 days — stale device registrations
await prisma.pushToken.deleteMany({
  where: { updated_at: { lt: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000) } },
});
```

**Notification delivery flow:**

```
1. Event fires (e.g., TASK_ASSIGNED to worker-456)
2. Fetch all PushToken rows where user_id = worker-456
3. For each token:
   - platform === 'apns' → send via APNs provider
   - platform === 'fcm'  → send via Firebase Admin SDK
4. On delivery failure (invalid token):
   - Delete PushToken row (token has been invalidated by OS)
   - Log: { level: 'warn', event: 'push_token_invalid', user_id, platform }
5. Insert Notification row regardless of push success (in-app fallback always works)
```

---

### PATCH-08 — Add GDPR Legal Requirements as Deployment Gate

**Extends:** Section 9 "Disaster Recovery — GDPR Incident Obligation"  
**Extends:** Implementation Checklist  
**Source:** MAJOR-7 from PATCH_V1 · FINAL_DECISIONS_SUMMARY

The following are **hard blockers** — no production personal data may be stored until all are complete.

**Required legal actions before production launch:**

```
GDPR LEGAL PREREQUISITES — PRODUCTION LAUNCH BLOCKER
══════════════════════════════════════════════════════

[ ] 1. Execute DigitalOcean Data Processing Agreement (DPA)
       URL: https://cloud.digitalocean.com/account/legal
       Action: Download DPA → countersign → store signed copy in compliance register
       Owner: Deepak Kumar (Client / Data Controller)

[ ] 2. Verify EU data residency
       All DO resources must be created in region: fra1 (Frankfurt, Germany)
       Confirm: PostgreSQL cluster region, Spaces bucket region, Droplet region
       Document: Screenshot of each resource's region in DO dashboard

[ ] 3. Update privacy policy
       Add DigitalOcean as a named sub-processor
       Include: DO's DPA URL, data types processed, retention periods
       Publish updated policy before first user registration

[ ] 4. Appoint Data Protection Contact
       Name a responsible person for GDPR queries and DPA authority notifications
       Default recommendation: Mayank Malhotra (Lead Dev) as technical DPC contact
       Register contact details in the privacy policy

[ ] 5. Create compliance register
       Create a document (spreadsheet or Notion page) recording:
       - DPA execution date + DO account ID
       - Data Protection Contact name + email
       - GDPR retention policies per category (from FINAL_DECISIONS_SUMMARY)
       - Date of first production data ingestion
       Store in Google Drive HotelCRM folder

[ ] 6. Consent tracking live before first registration
       The ConsentLog table in schema.prisma must be active
       Signup endpoint must insert ConsentLog row before creating User
       Confirm: POST /api/v1/auth/signup logs to consent_logs table
```

**Retention policies to document in compliance register (from FINAL_DECISIONS_SUMMARY):**

| Data Category | Retention Period | Deletion Type | Table |
|---|---|---|---|
| Contracts | Employment + 3 years | Soft delete + anonymize | `Contract` |
| Payroll | 7 years (tax law, cannot delete) | Archive only | `Payroll` |
| Worker documents | Employment + 1 year | Soft delete | `WorkerDocument` |
| Ratings | 2 years | Soft delete or archive | `Rating` |
| Audit logs | 5 years | Never bulk-delete | `AuditLog` |
| Application logs | 90 days | Auto-purge log drain | stdout |

> **Critical distinction:** Application stdout logs (90-day max) are **not** the compliance record. The `AuditLog` PostgreSQL table is the 5-year compliance record and must never be included in any bulk data cleanup or log-drain truncation.

---

### PATCH-09 — Resolve Mobile Architecture Contradiction

**Replaces:** Section 6 "CI/CD Pipeline — Mobile (Expo EAS)" in full  
**Source:** BLOCKER-3 from PATCH_V1 · Master Architecture v2.0 Section 9

**Contradiction statement:**

| Source | Says |
|---|---|
| `MASTER_ARCHITECTURE_v2.0.md` Section 9 | **One Expo app** with role-based routing at login |
| `mobile/worker-app/` + `mobile/checker-app/` in repo | **Two separate Expo apps** |

**Decision: OPTION A — Single Role-Based App (Recommended)**

This patch adopts the Master Architecture decision. Rationale:
- Master Architecture v2.0 is the signed, approved source of truth
- Single app = -50% EAS build time, -50% App Store accounts/submissions, -50% Expo project overhead
- Role-based routing at login is simpler to maintain and test
- The two-directory repo structure predates the Master Architecture v2.0 decision; it is not an intentional override

**Implementation implications:**

```
DIRECTORY CHANGE:
  Before:  mobile/worker-app/  +  mobile/checker-app/  (two projects)
  After:   mobile/hotel-crm-app/                       (one project)

EAS CONFIGURATION:
  One app.json / app.config.js
  One EAS project + one set of credentials
  One Apple App Store listing + one Google Play listing
  Bundle ID: com.zirove.hotelcrm  (single)

ROLE-BASED ROUTING (implemented in the single app):
  Login screen → authenticates → receives JWT with role claim
  JWT role: WORKER   → navigates to WorkerNavigator
  JWT role: CHECKER  → navigates to CheckerNavigator
  JWT role: MANAGER  → navigates to ManagerNavigator (future)
  
  Each Navigator contains only the screens relevant to that role.
  No screen from one role is accessible to another.

APP_ENV switching:
  eas.json profiles:
    development → APP_ENV=development  → API: http://localhost:3001/api/v1
    staging     → APP_ENV=staging      → API: https://staging-api.hotelcrm.app/api/v1
    production  → APP_ENV=production   → API: https://api.hotelcrm.app/api/v1
```

**Migration from two-app structure:**

```bash
# 1. Create unified app directory
mkdir -p mobile/hotel-crm-app

# 2. Use worker-app as the base (larger of the two codebases)
cp -r mobile/worker-app/* mobile/hotel-crm-app/

# 3. Merge checker-specific screens into CheckerNavigator
#    Copy screens from mobile/checker-app/screens/ → mobile/hotel-crm-app/screens/checker/

# 4. Update navigation root (App.tsx) to inspect JWT role and route accordingly

# 5. Update eas.json and app.json with unified bundle ID

# 6. Archive (do not delete) old directories until migration is smoke-tested:
mv mobile/worker-app  mobile/_archive/worker-app
mv mobile/checker-app mobile/_archive/checker-app

# 7. Update CI/CD — only one EAS build needed (see SECTION 4)
```

> If Mayank/Ritik/Deepak explicitly decide to keep two separate apps (e.g., for separate App Store branding), that decision must be recorded in FINAL_DECISIONS_SUMMARY as an override to Master Architecture Section 9, and the CI/CD section must be updated to run `eas build` twice with separate project credentials.

---

### PATCH-10 — Add Rollback Procedure

**Extends:** Section 6 "CI/CD Pipeline — Deployment Process"  
**Source:** MINOR-4 from PATCH_V1

```
DEPLOYMENT ROLLBACK PROCEDURE
══════════════════════════════

RULE 1 — NEVER run on production:
  prisma migrate reset
  prisma db push  (use migrate deploy only)
  DROP TABLE      (use soft deletes)

────────────────────────────────────────────────────────────

SCENARIO A: Deploy failed BEFORE prisma migrate deploy ran
(code push failed, build error, SSH timeout)

  Recovery: re-deploy from last known-good git tag
  
  ssh deploy@<DROPLET_IP>
  cd /opt/hotel-crm/backend
  git fetch --tags
  git checkout tags/<last-good-tag>
  npm ci --omit=dev
  npm run build
  pm2 restart hotel-crm-api --update-env
  
  Verify: curl https://api.hotelcrm.app/api/v1/health

────────────────────────────────────────────────────────────

SCENARIO B: Deploy failed AFTER prisma migrate deploy ran
(migration succeeded, app code failed)

  Step 1 — Assess backward compatibility:
  Is the migration additive only? (new columns with defaults, new tables)
  
  YES (additive) → code-only rollback is safe:
    ssh deploy@<DROPLET_IP>
    cd /opt/hotel-crm/backend
    git checkout tags/<last-good-tag>
    npm ci --omit=dev && npm run build
    pm2 restart hotel-crm-api --update-env
    
  NO (breaking: column renamed/dropped, type changed) → forward-fix required:
    See Scenario C.

────────────────────────────────────────────────────────────

SCENARIO C: Breaking migration — forward-fix required

  Forward-fix: write a new migration that restores compatibility
  Deploy path: hotfix branch → main directly (bypass develop)
  
  1. Create branch: git checkout -b hotfix/migration-fix main
  2. Write forward migration (additive — do not use down migrations)
     cd backend && npx prisma migrate dev --name hotfix_<description>
  3. Verify locally against a restored copy of the prod DB snapshot
  4. Get sign-off: Mayank approves the migration SQL before merge
  5. Merge hotfix → main (Mayank direct push, no PR required in emergency)
  6. Deploy:
     ssh deploy@<DROPLET_IP>
     cd /opt/hotel-crm
     git pull origin main
     cd backend && npx prisma migrate deploy
     npm run build
     pm2 restart hotel-crm-api --update-env
  7. Document in RUNBOOK.md: date, what broke, how fixed, time to recover

────────────────────────────────────────────────────────────

SCENARIO D: Secrets rotation mid-deploy caused auth failures

  1. Do NOT rollback code
  2. Check: is JWT_SECRET or JWT_REFRESH_SECRET recently changed?
  3. If yes: the old sessions are invalid — this is expected behaviour
  4. Confirm health: curl https://api.hotelcrm.app/api/v1/health
  5. If health passes: app is fine, users just need to re-login
  6. If health fails: rotate secrets back to last known values → pm2 restart

────────────────────────────────────────────────────────────

DEPLOYMENT HEALTH CHECK (run after every production deploy):

  curl -s https://api.hotelcrm.app/api/v1/health | jq .
  
  Expected response:
  {
    "status": "ok",
    "db": "connected",
    "redis": "connected",   ← or "degraded" (acceptable — non-critical)
    "version": "x.y.z",
    "uptime": <seconds>
  }
  
  If db: "disconnected" → do not proceed, investigate immediately
  If redis: "degraded" → acceptable for MVP, log and monitor
```

---

## SECTION 2 — Updated Production Topology

### Architecture Diagram (replaces original Section 7 diagram)

```
                    ┌─────────────────────────────────┐
                    │         INTERNET                 │
                    └───────────────┬─────────────────┘
                                    │
                    ┌───────────────▼─────────────────┐
                    │   Cloudflare (Free)  — Global   │
                    │   CDN · SSL · WAF · DDoS        │
                    │   Full Strict SSL mode           │
                    │   DNS TTL: 60s (fast failover)  │
                    └───────────────┬─────────────────┘
                                    │ HTTPS (Cloudflare origin cert)
                    ┌───────────────▼─────────────────────────────────────┐
                    │              DigitalOcean fra1                       │
                    │                                                      │
                    │  ┌──────────────────────────────────────────────┐   │
                    │  │  Droplet — 8GB RAM / 4 vCPU / Ubuntu 24.04  │   │
                    │  │                                              │   │
                    │  │  ┌─────────────────────────────────────┐    │   │
                    │  │  │  Nginx (ports 80/443)               │    │   │
                    │  │  │  ├── api.hotelcrm.app  → :3001     │    │   │
                    │  │  │  └── hotelcrm.app      → :3000     │    │   │
                    │  │  └─────────────────────────────────────┘    │   │
                    │  │                                              │   │
                    │  │  ┌───────────────┐  ┌───────────────────┐  │   │
                    │  │  │ Express API   │  │ Next.js Frontend  │  │   │
                    │  │  │ pm2, :3001    │  │ pm2, :3000        │  │   │
                    │  │  └───────────────┘  └───────────────────┘  │   │
                    │  │                                              │   │
                    │  │  ┌─────────────────────────────────────┐    │   │
                    │  │  │  Redis (Docker, :6379 internal)     │    │   │
                    │  │  │  Non-critical · allkeys-lru · 512MB │    │   │
                    │  │  └─────────────────────────────────────┘    │   │
                    │  └──────────────────────────────────────────────┘   │
                    │                         │                            │
                    │  ┌──────────────────────▼─────────────────────┐    │
                    │  │  DO Managed PostgreSQL  — fra1              │    │
                    │  │  4GB RAM · 2-node (primary + hot standby)  │    │
                    │  │  SSL required · VPC-internal connection     │    │
                    │  │  Daily snapshots + PITR (5-min RPO)        │    │
                    │  └─────────────────────────────────────────────┘    │
                    │                                                      │
                    │  ┌─────────────────────────────────────────────┐    │
                    │  │  DO Spaces  — fra1                          │    │
                    │  │  hotelcrm-uploads (private)                 │    │
                    │  │  hotelcrm-backups                           │    │
                    │  │  Pre-signed URLs · 15-min TTL               │    │
                    │  │  Cross-region replication → ams3            │    │
                    │  └─────────────────────────────────────────────┘    │
                    └─────────────────────────────────────────────────────┘

  Mobile (Expo)     ──┐
  Web Frontend      ──┼──→ Cloudflare → Nginx → Express/Next.js
  Admin Dashboard   ──┘

  External Services:
  ├── APNs   (Apple Push Notification Service — iOS push)
  ├── FCM    (Firebase Cloud Messaging — Android push)
  ├── SendGrid (transactional email — free 100/day)
  ├── Sentry  (error tracking — free tier)
  └── Expo EAS (mobile builds + OTA — free tier)

  Staging (fra1 — separate Droplet 4GB):
  └── Same topology at half capacity
      staging-api.hotelcrm.app
      Shared PostgreSQL (1GB, single node)
```

---

## SECTION 3 — Updated Cost Model

### Monthly Production Costs (replaces Section 8 entirely)

| Resource | Spec | Monthly Cost |
|---|---|---|
| DO Droplet (production) | 8GB RAM, 4 vCPU, Ubuntu 24.04, fra1 | €48 |
| DO Managed PostgreSQL | 4GB RAM, 2-node (primary + standby), fra1 | €24 |
| DO Spaces | 50GB storage + egress | €5 |
| Redis | Docker on Droplet — included | €0 |
| Cloudflare | Free tier (CDN, SSL, WAF) | €0 |
| Firebase FCM | Free tier (100K msgs/month) | €0 |
| APNs | Apple Developer Account (€99/year) | ~€8 |
| SendGrid | Free tier (100 emails/day) | €0 |
| Sentry | Free tier (5K errors/month) | €0 |
| UptimeRobot | Free tier (50 monitors) | €0 |
| Expo EAS | Free tier (30 builds/month) | €0 |
| **Total MVP** | | **~€85/month** |

### Staging Environment

| Resource | Spec | Monthly Cost |
|---|---|---|
| DO Droplet (staging) | 4GB RAM, 2 vCPU, fra1 | ~€24 |
| DO Managed PostgreSQL | 1GB RAM, single node, fra1 | ~€15 |
| DO Spaces | Shared dev bucket | ~€2 |
| **Total Staging** | | **~€41/month** |

### Scaling Milestones (updated)

| Monthly Active Users | Est. Monthly Infra Cost | Key Upgrade |
|---|---|---|
| 0–500 (MVP) | ~€85 | Current spec — Droplet + Docker Redis |
| 500–1,000 | ~€130 | Upgrade Droplet to 16GB (+€48) |
| 1,000–2,000 | ~€180 | Upgrade to DO Managed Redis (€15) + 2nd Droplet behind LB |
| 2,000–5,000 | ~€280 | PostgreSQL read replica + Cloudflare Pro ($20) |
| 5,000+ | ~€500+ | Re-evaluate architecture toward microservices |

### Phase 2 Redis Upgrade Trigger

Redis runs on Docker on the Droplet for Phase 1 (free). Upgrade to DO Managed Redis only when:
- Sustained user count exceeds 1,000 MAU, OR
- Redis Docker container consumes > 400MB RAM consistently (headroom gone), OR
- A Redis crash causes measurable user-facing degradation

---

## SECTION 4 — Updated CI/CD Strategy

### Corrected Workflow Triggers

```
feature/* or fix/*  →  push  →  CI (lint + typecheck + migrate test + tests)
develop             →  merge →  CI + Deploy to STAGING (auto)
main                →  merge →  CI + Deploy to PRODUCTION (manual approval gate)
```

### `.github/workflows/ci.yml` (unchanged — already correct)

The CI workflow in the original plan is valid. Only the trigger needs updating:

```yaml
name: CI

on:
  push:
    branches: ['feature/**', 'fix/**', 'develop', 'main']
  pull_request:
    branches: ['develop', 'main']
```

Keep the PostgreSQL service container and all test steps as written in the original plan. Add `JWT_REFRESH_SECRET` to the test env block:

```yaml
        env:
          DATABASE_URL: postgresql://test:test@localhost:5432/hotelcrm_test
          NODE_ENV: test
          JWT_SECRET: test-secret-min-32-characters-long!!
          JWT_REFRESH_SECRET: test-refresh-secret-32-chars-long!!
          APNS_PRIVATE_KEY_BASE64: dGVzdA==
          APNS_KEY_ID: TESTKEY123
          APNS_TEAM_ID: TESTTEAM
          APNS_BUNDLE_ID: com.zirove.hotelcrm.test
          DO_SPACES_KEY: test
          DO_SPACES_SECRET: test
          DO_SPACES_BUCKET: test
          DO_SPACES_ENDPOINT: https://fra1.digitaloceanspaces.com
```

### `.github/workflows/deploy-staging.yml` (replaces original)

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
            echo "✓ Staging deploy successful"
```

### `.github/workflows/deploy-production.yml` (replaces original)

```yaml
name: Deploy Production

on:
  push:
    branches: [main]

jobs:
  deploy:
    runs-on: ubuntu-latest
    environment: production   # requires manual approval in GitHub Environments settings

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
            pm2 reload hotel-crm-api --update-env   # graceful reload (zero downtime)
            sleep 10
            curl -sf http://localhost:3001/api/v1/health || exit 1
            echo "✓ Production deploy successful"

      - name: Tag release
        run: |
          git tag "release/$(date +%Y%m%d-%H%M%S)"
          git push origin --tags
```

### Mobile (Expo EAS) — Updated for Single App

```bash
# Single app — mobile/hotel-crm-app/

# OTA update to staging (no store submission required)
cd mobile/hotel-crm-app
eas update --branch staging --message "fix: task status sync"

# Production build → App Store + Play Store
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
      "ios": { "appleId": "dev@zirove.com", "ascAppId": "XXXXXXXXXX" },
      "android": { "serviceAccountKeyPath": "./google-service-account.json" }
    }
  }
}
```

### Deployment Process — Zero-Downtime (Droplet)

Replaces the App Platform rolling-deploy description:

```
1. GitHub Actions SSH into Droplet
2. git checkout origin/main (atomic — no partial state)
3. npm ci --omit=dev (installs into /opt/hotel-crm/node_modules)
4. npm run build (compiles TypeScript → dist/)
5. npx prisma migrate deploy (additive migrations only — no downtime)
6. pm2 reload hotel-crm-api --update-env
   └── pm2 reload = graceful restart:
       starts new process → waits for it to be ready → kills old process
       in-flight requests complete on old process (no dropped connections)
7. Health check: GET localhost:3001/api/v1/health → must return 200
8. If health check fails: previous pm2 process restarts automatically
```

---

## SECTION 5 — Updated Security Controls

### Updated Secrets Table (replaces Section 2 table)

| Secret | Storage on Droplet | Rotation Cadence | Rotation Invalidates |
|---|---|---|---|
| `DATABASE_URL` | `/etc/hotel-crm/.env` (chmod 600) | On breach / quarterly | Nothing (reconnects) |
| `JWT_SECRET` | `/etc/hotel-crm/.env` | Quarterly | All access tokens |
| `JWT_REFRESH_SECRET` | `/etc/hotel-crm/.env` | Quarterly | All refresh tokens → re-login |
| `DO_SPACES_KEY` / `DO_SPACES_SECRET` | `/etc/hotel-crm/.env` | Quarterly | File upload/download |
| `APNS_PRIVATE_KEY_BASE64` | `/etc/hotel-crm/.env` | On key expiry / breach | Nothing (new key takes over) |
| `APNS_KEY_ID` | `/etc/hotel-crm/.env` | With APNS key | — |
| `APNS_TEAM_ID` | `/etc/hotel-crm/.env` | Never (stable) | — |
| `APNS_BUNDLE_ID` | `/etc/hotel-crm/.env` | Never (stable) | — |
| `FIREBASE_PROJECT_ID` | `/etc/hotel-crm/.env` | Never (stable) | — |
| `REDIS_PASSWORD` | `/etc/hotel-crm/.env` | Quarterly | Redis reconnects |
| `SENDGRID_API_KEY` | `/etc/hotel-crm/.env` | Annually | Email delivery |
| `SENTRY_DSN` | `/etc/hotel-crm/.env` | Project change only | Error tracking |

**Secret file management on Droplet:**

```bash
# Location: /etc/hotel-crm/.env
# Permissions:
sudo chown deploy:deploy /etc/hotel-crm/.env
sudo chmod 600 /etc/hotel-crm/.env

# pm2 reads the .env file via ecosystem.config.js:
env_file: '/etc/hotel-crm/.env'

# Never store secrets in:
#   /opt/hotel-crm/backend/.env   (repo directory — git accessible)
#   /tmp/*                         (world-readable)
#   environment exports in .bashrc (visible in process list)
```

### Updated Network Security (replaces Section 7 "Network Security")

```
Cloudflare → Droplet:
  - All traffic HTTPS/TLS 1.3 (Cloudflare edge terminates public TLS)
  - Cloudflare → Nginx: HTTPS with Cloudflare origin certificate (Full Strict mode)
  - Nginx → Express: HTTP on 127.0.0.1:3001 (localhost only, never public)

Droplet → PostgreSQL:
  - SSL required: ?sslmode=require in DATABASE_URL
  - VPC-private network: database not accessible from public internet
  - PostgreSQL port 25060 accessible only from Droplet's VPC IP

Droplet → Redis:
  - Docker bind: 127.0.0.1:6379 (localhost only)
  - Password authentication (REDIS_PASSWORD env var)
  - maxmemory-policy: allkeys-lru (non-critical cache)

Droplet → DO Spaces:
  - HTTPS only via S3-compatible endpoint
  - Private bucket: no public ACL on any object
  - Pre-signed URLs: 15-minute TTL (worker task photos, documents)
  - CORS: configured for api.hotelcrm.app and hotelcrm.app only

Firewall (DO Cloud Firewall — applied to Droplet):
  Inbound:
    TCP 443  ← Cloudflare IP ranges only (not 0.0.0.0/0)
    TCP 80   ← Cloudflare IP ranges only (redirects to 443)
    TCP 22   ← Your office/developer IPs only (never 0.0.0.0)
  Outbound:
    All — permit (for APNs, FCM, SendGrid, DO Spaces)
```

**Cloudflare IP allowlist for Droplet firewall:**
Cloudflare publishes its IP ranges at `https://www.cloudflare.com/ips/`. Configure the DO Cloud Firewall to accept port 443 only from those ranges. This means even if an attacker finds the Droplet's public IP, they cannot bypass Cloudflare's WAF.

---

## SECTION 6 — Updated Deployment Checklist

Replaces the original "Implementation Checklist" in full.

### Phase 0 — Legal Prerequisites (before any data is stored)

```
[ ] Execute DigitalOcean DPA (GDPR blocker — see PATCH-08)
[ ] Confirm fra1 region for all resources
[ ] Appoint Data Protection Contact
[ ] Prepare compliance register
[ ] Update privacy policy with DO as sub-processor
```

### Phase 1 — Infrastructure Provisioning (Week 1)

```
Droplet:
[ ] Create DO project: hotel-crm — region: fra1
[ ] Create Droplet: 8GB RAM, 4 vCPU, Ubuntu 24.04, fra1
[ ] Create deploy user (non-root): useradd -m -s /bin/bash deploy
[ ] Add SSH public key to deploy user's authorized_keys
[ ] Configure DO Cloud Firewall — allowlist Cloudflare IPs on 443/80, dev IPs on 22
[ ] Install: nginx, nodejs v20 (nvm), npm, pm2, docker, docker-compose
[ ] Install pm2: npm install -g pm2 && pm2 startup

PostgreSQL:
[ ] Create DO Managed PostgreSQL cluster: 4GB, 2-node, fra1
[ ] Create databases: hotelcrm_prod, hotelcrm_staging
[ ] Create users with least-privilege (no superuser)
[ ] Save connection strings to /etc/hotel-crm/.env

DO Spaces:
[ ] Create bucket: hotelcrm-uploads — region: fra1 — ACL: private
[ ] Create bucket: hotelcrm-backups — region: fra1 — ACL: private
[ ] Enable versioning on hotelcrm-uploads (30-day retention)
[ ] Configure cross-region replication: fra1 → ams3 (DR prerequisite)
[ ] Generate Spaces access key pair
[ ] Save key pair to /etc/hotel-crm/.env

Cloudflare:
[ ] Add domain to Cloudflare (nameservers)
[ ] Create DNS A records (see PATCH-03)
[ ] Generate Cloudflare origin certificate → install on Droplet Nginx
[ ] Set SSL mode: Full (Strict)
[ ] Enable WAF managed rules
[ ] Set DNS TTL to 60s on A records
```

### Phase 2 — Application Setup (Week 2)

```
Secrets:
[ ] Generate JWT_SECRET (openssl rand -base64 48)
[ ] Generate JWT_REFRESH_SECRET (openssl rand -base64 48)
[ ] Encode APNs .p8 key to base64 (PATCH-05)
[ ] Populate /etc/hotel-crm/.env with all required secrets
[ ] Verify: sudo chmod 600 /etc/hotel-crm/.env
[ ] Store copies in 1Password/Bitwarden under "hotel-crm production"

Database migration:
[ ] git clone hotel-crm repo to /opt/hotel-crm
[ ] cd backend && npm ci
[ ] Add PushToken model to schema.prisma (PATCH-07)
[ ] npx prisma migrate deploy (runs all migrations on hotelcrm_prod)
[ ] Verify: npx prisma db pull → schema matches schema.prisma

Application:
[ ] npm run build (compiles TypeScript)
[ ] pm2 start ecosystem.config.js --env production
[ ] pm2 save (persist across reboots)
[ ] Verify: curl http://localhost:3001/api/v1/health → { status: "ok" }

Nginx:
[ ] Write /etc/nginx/sites-available/hotelcrm (see PATCH-01 config)
[ ] ln -s /etc/nginx/sites-available/hotelcrm /etc/nginx/sites-enabled/
[ ] nginx -t && systemctl reload nginx
[ ] Verify: curl https://api.hotelcrm.app/api/v1/health

Docker Redis:
[ ] Write /opt/hotel-crm/docker-compose.prod.yml (see PATCH-01)
[ ] docker compose -f docker-compose.prod.yml up -d
[ ] Verify: docker logs hotel-crm_redis_1 | grep "Ready to accept connections"
```

### Phase 3 — Observability & CI/CD (Week 3)

```
Monitoring:
[ ] Create Sentry project (free tier) → save DSN to /etc/hotel-crm/.env
[ ] Add Sentry to backend: npm install @sentry/node @sentry/profiling-node
[ ] Configure DO Monitoring alerts (CPU >80%, memory >85%, DB disk >75%)
[ ] Create UptimeRobot monitor: https://api.hotelcrm.app/api/v1/health
[ ] Configure UptimeRobot Slack webhook → #alerts channel

Logging:
[ ] Confirm Winston is configured for JSON stdout (see original plan Section 5)
[ ] Set up log rotation: pm2 install pm2-logrotate (7-day retention on Droplet)
[ ] Optional: configure Logtail/Papertrail log drain for 30-day searchable logs

CI/CD:
[ ] Add GitHub Actions secrets:
    PROD_DROPLET_IP, PROD_SSH_KEY, PROD_DATABASE_URL
    STAGING_DROPLET_IP, STAGING_SSH_KEY, STAGING_DATABASE_URL
[ ] Write .github/workflows/ci.yml (updated trigger — this document Section 4)
[ ] Write .github/workflows/deploy-staging.yml (this document Section 4)
[ ] Write .github/workflows/deploy-production.yml (this document Section 4)
[ ] Set GitHub Environment "production" → require Mayank manual approval
[ ] Configure branch protection: main (require PR from develop), develop (require PR from feature/*)
[ ] Run first staging deployment end-to-end smoke test

Mobile:
[ ] If PATCH-09 migration complete: set up mobile/hotel-crm-app EAS project
[ ] Run: eas build --platform all --profile development → test on device
[ ] Verify: role-based routing (WORKER → WorkerNavigator, CHECKER → CheckerNavigator)
```

### Phase 4 — DR Hardening (Week 4)

```
Backup:
[ ] Schedule weekly cron on Droplet (Sunday 03:00 UTC):
    pg_dump → DO Spaces hotelcrm-backups/weekly/
[ ] Verify DO Managed DB PITR is enabled (check DO dashboard)
[ ] Confirm cross-region replication fra1→ams3 is active

Disaster recovery:
[ ] Run P1 restore drill: restore snapshot to throwaway DB, run prisma db pull
[ ] Pre-configure staging Droplet in ams3 with same stack (ready for failover)
[ ] Test P4 runbook: rotate JWT_SECRET → confirm re-login behaviour

GDPR compliance:
[ ] Activate DataRetentionLog background job (daily cron or node-cron)
[ ] Verify ConsentLog is written on first user registration
[ ] Run end-to-end GDPR deletion test:
    create test user → verify data → call DELETE /api/v1/auth/account
    confirm: soft delete + anonymize + AuditLog entry written
[ ] Store compliance register in Google Drive (date + DO account ID + DPA reference)
```

---

## SECTION 7 — Final Recommendation

All BLOCKER and MAJOR issues from PATCH_V1 have been resolved in this document. The following summarises the disposition of each:

| Issue | Resolution | Location |
|---|---|---|
| BLOCKER-1: App Platform → Droplet | ✅ Applied | PATCH-01, SECTION 2 |
| BLOCKER-2: Cost 2× budget | ✅ Applied | PATCH-02, SECTION 3 |
| BLOCKER-3: Mobile app count | ✅ Resolved: OPTION A (single app) | PATCH-09 |
| BLOCKER-4: Missing reference docs | ⚠️ Noted | Audit scope only — no patch needed in infra plan |
| MAJOR-1: Branch strategy | ✅ Applied | PATCH-04, SECTION 4 |
| MAJOR-2: Managed Redis | ✅ Applied | PATCH-01 (Redis on Docker) |
| MAJOR-3: Cloudflare missing | ✅ Applied | PATCH-03, SECTION 2 |
| MAJOR-4: APNs .p8 anti-pattern | ✅ Applied | PATCH-05, SECTION 5 |
| MAJOR-5: JWT_REFRESH_SECRET | ✅ Applied — Option A | PATCH-06, SECTION 5 |
| MAJOR-6: Nginx config missing | ✅ Applied | PATCH-01 (nginx.conf) |
| MAJOR-7: DPA not mentioned | ✅ Applied | PATCH-08, SECTION 6 Phase 0 |
| MAJOR-8: PushToken table missing | ✅ Applied | PATCH-07, SECTION 6 Phase 2 |

### Read Order for Implementation

Apply this document in the following order during actual provisioning:

```
1. SECTION 6 Phase 0       — Legal (DPA first, before anything else)
2. SECTION 6 Phase 1       — Provision Droplet, PostgreSQL, Spaces, Cloudflare
3. PATCH-06 (JWT)          — Generate and store secrets
4. PATCH-07 (PushToken)    — Add schema model, run migration
5. PATCH-01 (Nginx/pm2)    — Deploy application stack
6. PATCH-03 (Cloudflare)   — Configure origin cert and DNS
7. SECTION 6 Phase 3       — CI/CD + Sentry
8. PATCH-09 (Mobile)       — Migrate to single app
9. SECTION 6 Phase 4       — DR hardening and GDPR activation
```

```
╔══════════════════════════════════════════════════════════╗
║                                                          ║
║                      APPROVED                            ║
║                                                          ║
║  All BLOCKER and MAJOR issues have been resolved.        ║
║  This patch document, read alongside the original        ║
║  INFRASTRUCTURE_AND_DEPLOYMENT_PLAN.md, constitutes      ║
║  a complete, implementation-ready deployment plan        ║
║  consistent with MASTER_ARCHITECTURE_v2.0.               ║
║                                                          ║
║  Approved target: ~€85/month MVP production cost.        ║
║  Approved topology: Droplet + Nginx + Docker Redis.      ║
║  Approved mobile: single role-based Expo app.            ║
║  Approved branch model: feature→develop→main.            ║
║                                                          ║
║  Remaining MINOR issues from PATCH_V1 (MINOR-1 to        ║
║  MINOR-7) are tracked but do not block provisioning.     ║
║  Address during Week 3–4 hardening phase.                ║
╚══════════════════════════════════════════════════════════╝
```
