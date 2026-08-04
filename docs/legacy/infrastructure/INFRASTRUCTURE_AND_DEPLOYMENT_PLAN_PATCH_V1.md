> [!WARNING]
> **Historical Context:** This document describes a legacy architecture where the frontend (hotel-crm-web) was deployed on EC2. In the current production architecture, the frontend is hosted on Vercel, and EC2 only runs the backend API and worker processes.

# INFRASTRUCTURE_AND_DEPLOYMENT_PLAN_PATCH_V1

**Type:** Consistency Audit & Patch  
**Audits:** `INFRASTRUCTURE_AND_DEPLOYMENT_PLAN.md`  
**Against:** Master Architecture v2.0 · RBAC Permission Matrix v1.0 · Event Flow Mapping v1.0 · Database Relationship Diagram v1.0 · API Standards v1.0 · Final Decisions Summary · Prisma Schema (repo)  
**Date:** 2026-06-09  
**Auditor:** Claude Code  

> **NOTE ON REFERENCED DOCUMENTS**  
> The audit request specifies 6 source documents: "Marketplace Architecture", "WorkRequest Architecture", "Quality & Rating Architecture", "Prisma Schema V2", "Backend Execution Blueprint V2", "Mobile Product Blueprint Patch V1". **None of these exist** by these names in the repository or Google Drive. Their content is embedded across MASTER_ARCHITECTURE_v2.0.md, EVENT_FLOW_MAPPING_v1.0.md, RBAC_PERMISSION_MATRIX_v1.0.md, and DATABASE_RELATIONSHIP_DIAGRAM_v1.0.md. **Prisma Schema V2 does not exist at all.** This is itself a BLOCKER gap documented below. The audit has been performed against the actual authoritative sources found.

---

## BLOCKER Issues

### BLOCKER-1 — Deployment Target Is Wrong: App Platform vs Droplet

**Section:** Production Topology, Cost Model  
**Severity:** BLOCKER — Wrong infrastructure will be provisioned  

The infra plan deploys to **DO App Platform** (2 × Professional XS instances, ~$24/month combined).

MASTER_ARCHITECTURE v2.0 Section 8 explicitly defines the approved topology as:

```
DigitalOcean Droplet (8GB RAM, 4 vCPU) — €48/month
  └── Nginx (reverse proxy)
       ├── Express.js monolith (port 3001)
       └── Next.js frontend (port 3000)
  └── Redis (Docker container, 0 additional cost)
```

App Platform and a Droplet are fundamentally different:

| Factor | App Platform (infra plan) | Droplet (master arch) |
|---|---|---|
| Redis | Managed Redis $15/mo extra | Docker on Droplet, €0 |
| Nginx | No Nginx, LB handles routing | Nginx reverse proxy required |
| Frontend | Separate service | Co-deployed on same Droplet |
| Cost | ~$167/month | ~€85/month |
| SSH access | None | Full root access |
| Docker Compose | Not applicable | Used for dev parity |

**Required Fix:** Replace the App Platform topology with a Droplet-based deployment matching Master Architecture Section 8.

---

### BLOCKER-2 — Cost Is 2× the Approved Budget

**Section:** Cost Model  
**Severity:** BLOCKER — Exceeds client-approved production cost  

| Source | Stated MVP Monthly Cost |
|---|---|
| MASTER_ARCHITECTURE v2.0 Section 1 | ~€87/month |
| MASTER_ARCHITECTURE v2.0 Section 8 (itemized) | ~€85/month |
| FINAL_DECISIONS_SUMMARY | €87/month |
| **INFRASTRUCTURE_AND_DEPLOYMENT_PLAN** | **~$167/month** |

The infra plan is approximately **2× the approved budget**. Primary drivers of the overrun:

- DO App Platform Professional XS × 2 = $24 (vs €0 additional for Droplet already at €48)
- DO Managed Redis = $15 (vs €0 — Redis runs on Droplet per Master Arch)
- DO Managed PostgreSQL db-s-2vcpu-4gb = $50 (vs €24 for 4GB Managed DB per Master Arch)
- EAS Production plan = $29 (not in approved cost breakdown)
- Sentry Team plan = $26 (Master Arch says Sentry free tier)

**Required Fix:** Re-baseline cost model to match Master Architecture Section 8 approved budget. Key corrections: (a) Single Droplet 8GB, (b) Redis on Docker on Droplet, (c) PostgreSQL 4GB €24/month tier, (d) Sentry free tier, (e) EAS free tier for MVP.

---

### BLOCKER-3 — Mobile App Architecture: Two Apps vs One App

**Section:** CI/CD (EAS Build section), Production Topology  
**Severity:** BLOCKER — Builds wrong product  

The infra plan assumes **two separate Expo apps** (worker-app and checker-app):

```yaml
# From infra plan:
eas build --platform all --profile production  # run for BOTH apps
```

MASTER_ARCHITECTURE v2.0 Section 9 states:

> **"Decision: One React Native (Expo) app with role switching at login."**  
> App flow shows Worker Login → Worker Dashboard AND Checker Login → Checker Dashboard within the **same app**.

The repo currently has `mobile/worker-app/` and `mobile/checker-app/` as separate directories — this contradicts the approved architecture decision.

**Impact:** Two separate EAS builds, two separate App Store submissions, double maintenance cost, contradicts the decision made to keep "-50% code, faster iteration."

**Required Fix:** 
1. Resolve the contradiction: either (a) update Master Architecture to approve 2 apps (if the repo structure was a deliberate later decision), or (b) consolidate into a single role-based app per the approved decision.
2. The infra plan's CI/CD section must reflect the correct number of EAS builds.
3. This cannot be decided by the infra plan alone — requires explicit decision from Mayank/Ritik/Deepak.

---

### BLOCKER-4 — Referenced Architecture Documents Do Not Exist

**Section:** Audit Scope  
**Severity:** BLOCKER — Cannot audit against non-existent documents  

The following documents referenced in the audit request do not exist in any location (repo or Google Drive):

| Document | Status |
|---|---|
| Marketplace Architecture | NOT FOUND |
| WorkRequest Architecture | NOT FOUND |
| Quality & Rating Architecture | NOT FOUND |
| **Prisma Schema V2** | **NOT FOUND** |
| Backend Execution Blueprint V2 | NOT FOUND |
| Mobile Product Blueprint Patch V1 | NOT FOUND |

**Prisma Schema V2 is the highest risk gap.** If V2 includes schema changes (new tables, column renames, type changes), those changes may require migration steps not covered in the current infra plan. Since it doesn't exist, any V2 features that land later will have no migration path documented.

**Required Fix:** These documents must be created before a final infrastructure audit can be signed off. The current audit is based on the v1 documents. A re-audit is required once V2 documents exist.

---

## MAJOR Issues

### MAJOR-1 — Branch Strategy Conflict

**Section:** Environment Strategy, CI/CD  

The infra plan defines:
```
feature/*  →  CI only
main       →  CI + Deploy to STAGING
release/*  →  CI + Deploy to PRODUCTION
```

PHASE1_KICKOFF_CHECKLIST and IMPLEMENTATION_PROCESS_v1.0 define:
```
main     — production ready only
develop  — staging/testing
feature/* — feature branches FROM develop
```

The infra plan is missing the `develop` branch entirely and misassigns `main` as the staging trigger. Under the approved branch model, merging to `main` should trigger production, not staging. This creates a situation where staging PRs cannot be properly promoted.

**Required Fix:**
```yaml
# Correct CI/CD trigger mapping:
feature/* → push → CI (lint + typecheck + tests)
develop   → merge → CI + Deploy to STAGING
main      → merge (from develop, after staging approval) → Deploy to PRODUCTION
```

---

### MAJOR-2 — Redis Provisioning Contradicts Approved Architecture

**Section:** Production Topology, Cost Model  

The infra plan includes "DO Managed Redis — 1GB — ~$15/month" as a production component.

MASTER_ARCHITECTURE v2.0 Section 8 states explicitly:

> "Redis (Docker on Droplet) — 1GB allocated — €0 (runs on Droplet)"

And:

> "DO NOT: Set up Redis replication or clustering"  
> "Phase 2: Upgrade Redis (When Scaling Beyond 1000 Users) → Upgrade to DigitalOcean Managed Redis (€10-20/month)"

Redis is approved as a Docker container on the Droplet for Phase 1, consuming no additional cost. Managed Redis is a Phase 2 scaling action only.

**Required Fix:** Remove Managed Redis from the MVP production topology. Use Docker Redis on the Droplet. Add Managed Redis to the Phase 2 scaling section.

---

### MAJOR-3 — Cloudflare Is Missing from Topology

**Section:** Production Topology, Security  

MASTER_ARCHITECTURE v2.0 Section 8 architecture diagram shows Cloudflare as the first layer:

```
Cloudflare (Free)
CDN + SSL + Basic WAF
       ↓
DigitalOcean Droplet (8GB)
```

The infra plan routes traffic directly through a DO Load Balancer and uses DO App Platform TLS termination. Cloudflare is not mentioned anywhere in the infra plan.

**Impact:** Missing Cloudflare means:
- No CDN layer (higher latency for mobile apps fetching static assets)
- No Basic WAF (losing free DDoS protection)
- SSL is managed by DO instead of Cloudflare (no free universal SSL)
- No free analytics/threat monitoring

**Required Fix:** Add Cloudflare as the ingress layer in front of the Droplet/Nginx. Since the approved architecture uses the free Cloudflare tier, this costs €0 and should be included in the topology.

---

### MAJOR-4 — APNs Private Key (.p8) Storage Is an Anti-Pattern

**Section:** Secrets Management  

The infra plan states:
> "APNS_KEY_ID / TEAM_ID — DO App Platform + `.p8` file in DO Spaces (private bucket)"

Storing APNs `.p8` private keys in object storage — even in a private bucket — is an anti-pattern and violates Apple's developer guidelines. Object storage is not a secrets vault. A bucket misconfiguration, a leaked presigned URL, or a DO API key compromise would expose the APNs signing key, allowing anyone to send push notifications as your app.

**Required Fix:** The APNs `.p8` key should be:
1. Base64-encoded: `base64 < AuthKey_XXXXXXXX.p8`
2. Stored as an encrypted environment variable: `APNS_PRIVATE_KEY_BASE64=<base64 output>`
3. Decoded at runtime in the notifications service

Remove the `.p8` file from DO Spaces entirely.

---

### MAJOR-5 — JWT_REFRESH_SECRET Is Undefined in the Project

**Section:** Secrets Management  

The infra plan lists `JWT_REFRESH_SECRET` as a required production secret with its own rotation cadence. However:

- `backend/.env.example` only defines `JWT_SECRET` (one secret)
- No `JWT_REFRESH_SECRET` appears in the Prisma schema, env example, or MASTER_ARCHITECTURE
- The `Session` table stores `refresh_token` values but the schema has no separate signing key field

This creates an ambiguity: is the refresh token signed with `JWT_SECRET` or a separate `JWT_REFRESH_SECRET`? If the backend code signs refresh tokens with `JWT_SECRET`, the infra plan's rotation procedure is wrong (rotating one without the other would not invalidate refresh tokens). If separate secrets are intended, the env example and backend code must be updated.

**Required Fix:** Decide and document: single JWT secret or separate access/refresh secrets. Update `.env.example`, `src/config/env.ts` validation, and the infra plan to match.

---

### MAJOR-6 — No Nginx Configuration Defined

**Section:** Production Topology  

The approved topology (Droplet + Nginx) requires Nginx to proxy:
- Port 443 → Express.js (port 3001) for API
- Port 443 → Next.js (port 3000) for web frontend

The infra plan contains no Nginx configuration, no `nginx.conf` snippet, no reference to how Nginx is deployed or configured on the Droplet. Without Nginx, the Express server would need to bind on port 443 directly (requires root), or the topology is broken.

**Required Fix:** Add a Nginx configuration section covering: SSL termination, upstream proxy to Express (3001) and Next.js (3000), rate limiting at Nginx level, gzip compression, and security headers.

---

### MAJOR-7 — DPA with DigitalOcean Not Mentioned

**Section:** Security, GDPR  

FINAL_DECISIONS_SUMMARY explicitly lists:
> "DPA with DigitalOcean (legal compliance)" as part of the GDPR full framework

The infra plan describes GDPR technical controls extensively but never mentions executing a Data Processing Agreement with DigitalOcean. Without a signed DPA, storing EU personal data on DO infrastructure is a GDPR violation regardless of technical controls.

**Required Fix:** Add a GDPR Legal Prerequisites section to the infra plan covering: (a) sign DigitalOcean DPA before any production data is stored, (b) confirm fra1 (Frankfurt, Germany) EU data residency, (c) record DPA in the project's compliance register.

---

### MAJOR-8 — Push Token Storage Table Is Missing from Prisma Schema

**Section:** Database Architecture, Notifications  

API_STANDARDS_v1.0 defines:
```
POST /api/v1/push-tokens — Register push token (mobile)
```

EVENT_FLOW_MAPPING_v1.0 describes the full notification flow:
```
Event trigger → Create notification record → Send APNs → Send FCM → Send email → In-app
```

However, the current `schema.prisma` has **no PushToken table**. Push tokens (APNs device tokens, FCM registration IDs) must be persisted per user-device pair to send notifications. Without this table, the notifications module cannot function.

**Impact:** The infra plan's monitoring and alerting for push notification delivery rate is meaningless if the notification system cannot actually store tokens.

**Required Fix:** Add a `PushToken` model to the Prisma schema before any notification infrastructure is provisioned:

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

---

## MINOR Issues

### MINOR-1 — DO Spaces Region Label Inconsistency

**Section:** Storage Strategy  

PHASE1_KICKOFF_CHECKLIST and WEEK1_ENVIRONMENT_SETUP_GUIDE reference `Region: Frankfurt (eur1)`. The correct DigitalOcean region slug for Frankfurt is `fra1`, not `eur1`. The infra plan correctly uses `fra1`. The kickoff checklist contains the wrong identifier and should be corrected to avoid provisioning resources in the wrong region.

---

### MINOR-2 — Sentry Plan Mismatch

**Section:** Monitoring, Cost Model  

The infra plan specifies "Sentry Team plan — ~$26/month." MASTER_ARCHITECTURE v2.0 Section 8 lists Sentry as part of TIER 2 deliverables and implicitly uses the **free tier** (no cost shown in the €85/month breakdown). For an MVP with a 3-4 person dev team, Sentry's free tier (5K errors/month, 1 user, 30-day retention) is sufficient. The Team plan should be a Phase 2 upgrade trigger when error volume exceeds free limits.

---

### MINOR-3 — Background Job Monitoring Not Defined

**Section:** Monitoring  

EVENT_FLOW_MAPPING_v1.0 defines daily background jobs:
- Data retention cleanup (auto-delete per `DataRetentionLog`)
- Contract/document expiry notifications
- Payroll period reminders

The infra plan has no monitoring or alerting for these jobs. A silently failing retention job is a GDPR compliance risk (data not deleted on schedule) and an operational risk (workers not notified of expiring documents).

**Required Fix:** Add health-check logging for each background job run. Alert on: job failed to execute, job processed 0 rows when >0 expected, job duration >5 minutes.

---

### MINOR-4 — No Rollback Strategy for Failed Deployments

**Section:** CI/CD  

The infra plan covers zero-downtime rolling deploys and the expand-contract migration pattern but defines no rollback procedure when a deployment fails after a migration has already run. Rolling back application code after a `prisma migrate deploy` is non-trivial because the new schema may not be compatible with the old code.

**Required Fix:** Document the standard rollback procedure:
1. Deploy previous image version (DO reverts container image)
2. Assess whether migration is backward-compatible with old code
3. If not: create a forward-fix migration, deploy as hotfix
4. Never use `prisma migrate reset` on production

---

### MINOR-5 — Audit Log Retention vs Application Log Retention Conflation

**Section:** Logging, GDPR  

The infra plan defines application log retention as "30 days hot / 90 days cold" and separately states AuditLog (PostgreSQL) is "the authoritative trail for compliance." However, FINAL_DECISIONS states audit logging for **5 years**. The distinction between application logs (operational, 90-day max) and compliance audit logs (PostgreSQL `AuditLog` table, 5-year retention) is correct but not explicit enough. A developer could misread the logging section and truncate compliance logs along with application logs.

**Required Fix:** Add an explicit callout: "The 90-day retention policy applies to application stdout logs only. The `AuditLog` PostgreSQL table is subject to the 5-year GDPR compliance retention policy and must never be bulk-deleted."

---

### MINOR-6 — No Worker Availability Color-Coding Infrastructure Support

**Section:** Storage / Database  

The PRD v1.0 and v2.0 both list "Worker Availability Color Coding (Red/Green per day)" as a feature. The Prisma schema has no `WorkerAvailability` or `HolidaySickLeave` table. The DATABASE_OPTIMIZATION_GUIDE references `holidays_sick_leave` table with indexes, but this table doesn't exist in `schema.prisma`.

This is a schema gap that affects the staffing module's WorkRequest architecture and will require a migration before the staffing features can be fully built.

---

### MINOR-7 — EAS Build Not Accounted For in CI/CD Timeline

**Section:** CI/CD  

The infra plan's CI/CD section defines EAS OTA updates and store builds but doesn't address:
- EAS build time (~20-40 min per platform) adds significant latency to the release pipeline
- No caching strategy for Expo dependencies in CI
- No smoke-test of the mobile app build before publishing an OTA update

---

## Required Infrastructure Patches

### INFRA-PATCH-1 — Replace App Platform with Droplet

Replace the entire "App Platform Specification" section with a Droplet-based deployment:

```
Target: DigitalOcean Droplet — 8GB RAM, 4 vCPU — €48/month — fra1

Stack on Droplet:
  Nginx (reverse proxy + SSL termination from Cloudflare origin cert)
  ├── Node.js/Express monolith (pm2, port 3001)
  ├── Next.js frontend (port 3000) [or served via Nginx static]
  └── Redis (Docker, port 6379, internal only)

External:
  DO Managed PostgreSQL — 4GB RAM — €24/month — fra1 (2-node: primary + standby)
  DO Spaces — fra1 — €5/month
  Cloudflare — Free — CDN + SSL + WAF (in front of Droplet)
```

---

### INFRA-PATCH-2 — Correct Cost Model

Replace the cost table with the Master Architecture-aligned budget:

| Resource | Spec | Monthly Cost |
|---|---|---|
| DO Droplet | 8GB RAM, 4 vCPU | €48 |
| DO Managed PostgreSQL | 4GB RAM, 2-node (primary + standby) | €24 |
| DO Spaces | 50GB + egress | €5 |
| Cloudflare | Free CDN + SSL + WAF | €0 |
| Firebase FCM | Free tier (100K msgs/month) | €0 |
| APNs | Apple Developer Account (~€8 amortized) | €8 |
| SendGrid | Free tier (100 emails/day) | €0 |
| Sentry | Free tier | €0 |
| **Total MVP** | | **~€85/month** |

Staging environment (single smaller Droplet + shared PostgreSQL): ~€25/month

---

### INFRA-PATCH-3 — Add Cloudflare Layer

Add to Section 7 (Production Topology):

```
Internet
    ↓
Cloudflare (Free tier — fra1 CDN edge)
  - Universal SSL (HTTPS)
  - Basic WAF rules (OWASP top 10)
  - Rate limiting (free: 10K req/10min)
  - DDoS mitigation
  - Analytics
    ↓
DigitalOcean Droplet (fra1)
  - Cloudflare origin certificate on Nginx
  - Full strict SSL mode in Cloudflare
```

---

### INFRA-PATCH-4 — Add PushToken to Prisma Schema

See MAJOR-8 above. Add `PushToken` model to `backend/prisma/schema.prisma` and create a migration before provisioning the notifications infrastructure.

---

### INFRA-PATCH-5 — Replace APNs .p8 Storage

Remove `.p8` from DO Spaces. Store as base64 env var:

```bash
# One-time: encode the key
base64 < AuthKey_XXXXXXXXXX.p8 | tr -d '\n'

# Add to production environment variables:
APNS_PRIVATE_KEY_BASE64=<base64 output>
APNS_KEY_ID=XXXXXXXXXX
APNS_TEAM_ID=XXXXXXXXXX
APNS_BUNDLE_ID=com.zirove.hotelcrm
```

---

## Required CI/CD Patches

### CICD-PATCH-1 — Fix Branch Strategy to Match Master Architecture

Replace the three GitHub Actions workflow triggers with:

```yaml
# CI — runs on all PRs and branch pushes
on:
  push:
    branches: ['feature/**', 'fix/**', 'develop']
  pull_request:
    branches: ['develop', 'main']

# deploy-staging.yml — triggered on merge to develop
on:
  push:
    branches: [develop]

# deploy-production.yml — triggered on merge to main (from develop)
on:
  push:
    branches: [main]
  # manual approval gate via GitHub Environments still applies
```

Branch protection rules:
- `main`: require PR from `develop`, require CI pass, require 1 reviewer
- `develop`: require PR from `feature/*`, require CI pass

---

### CICD-PATCH-2 — Replace App Platform Deploy Action with SSH Droplet Deploy

```yaml
# deploy-staging.yml (corrected)
- name: Deploy to Droplet (staging)
  uses: appleboy/ssh-action@v1
  with:
    host: ${{ secrets.STAGING_DROPLET_IP }}
    username: deploy
    key: ${{ secrets.STAGING_SSH_KEY }}
    script: |
      cd /opt/hotel-crm/backend
      git pull origin develop
      npm ci --omit=dev
      npx prisma migrate deploy
      pm2 restart hotel-crm-api --update-env
```

---

### CICD-PATCH-3 — Add Rollback Documentation

Add a "Rollback Procedure" subsection to the CI/CD section:

```
If a production deployment fails after prisma migrate deploy has run:

1. Identify whether migration is backward-compatible with previous code
   - If YES: rollback code only (pm2 restart with previous git tag)
   - If NO: forward-fix required (create migration + hotfix deploy)

2. Code-only rollback:
   git checkout <previous-tag> -- backend/dist/
   pm2 restart hotel-crm-api

3. Forward-fix (migration not reversible):
   - Write a forward migration that restores compatibility
   - Deploy as hotfix to main directly (bypass develop with Mayank approval)
   - Document the incident in RUNBOOK.md

NEVER run: prisma migrate reset (destroys production data)
```

---

### CICD-PATCH-4 — Fix EAS Build for Single App (Pending BLOCKER-3 Resolution)

Once BLOCKER-3 is resolved (single app vs two apps), update the CI/CD EAS section accordingly. If the decision is confirmed as 2 separate apps, the EAS workflow must run `eas build` twice with distinct app IDs and profiles. If consolidated to 1 app, a single build with environment-based API URL switching is sufficient.

---

## Required Security Patches

### SEC-PATCH-1 — Resolve JWT_REFRESH_SECRET Ambiguity

Before production provisioning, standardize the JWT secret model:

**Option A (Recommended): Two separate secrets**
```
JWT_SECRET          — signs access tokens (1h expiry)
JWT_REFRESH_SECRET  — signs refresh tokens (7d expiry)
```
Add `JWT_REFRESH_SECRET` to `.env.example` and to `src/config/env.ts` Zod validation.

**Option B: Single secret**
Remove `JWT_REFRESH_SECRET` from the infra plan secrets table. Document that `JWT_SECRET` rotation invalidates both token types simultaneously.

Do not leave this ambiguous — a mismatch between the infra plan and the code will result in a broken refresh flow in production.

---

### SEC-PATCH-2 — APNs Key Rotation Procedure

Replace the object-storage-based APNs key management with:

```
1. Generate new APNs key in Apple Developer Console
2. Base64-encode: base64 < AuthKey_NEW.p8 | tr -d '\n'
3. Update APNS_PRIVATE_KEY_BASE64 in production environment
4. Update APNS_KEY_ID if new key has different ID
5. Rolling restart — notifications continue uninterrupted during deploy
6. Revoke old key in Apple Developer Console (after confirming new key works)
7. Delete old .p8 file from local machine (shred, not rm)
```

---

### SEC-PATCH-3 — Add DPA Requirement as Deployment Gate

Add the following to the Phase 1 implementation checklist as a hard prerequisite before any production data is stored:

```
Legal Prerequisites (BLOCKING — must complete before production launch):
[ ] Execute DigitalOcean Data Processing Agreement (DPA)
    URL: https://www.digitalocean.com/legal/data-processing-agreement
[ ] Confirm fra1 (Frankfurt, Germany) data residency for all resources
[ ] Record DPA execution date and DO account ID in compliance register
[ ] Appoint Data Protection Contact (Mayank or designated person)
[ ] Update privacy policy to reference DigitalOcean as sub-processor
```

---

### SEC-PATCH-4 — Add Nginx Security Headers

When deploying Nginx on the Droplet, include:

```nginx
# In nginx.conf server block:
add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
add_header X-Content-Type-Options "nosniff" always;
add_header X-Frame-Options "DENY" always;
add_header X-XSS-Protection "1; mode=block" always;
add_header Referrer-Policy "strict-origin-when-cross-origin" always;
add_header Content-Security-Policy "default-src 'self'; connect-src 'self' https://fra1.digitaloceanspaces.com" always;
```

---

## Section-by-Section Audit Summary

| Section | Status | Primary Finding |
|---|---|---|
| A — Environment Strategy | ⚠️ MAJOR | Branch strategy mismatched (`main`→staging wrong; `develop` branch missing) |
| B — Database Architecture | ⚠️ MAJOR | DB tier ($50) over-spec vs approved (€24); PgBouncer not explicitly configured; PushToken table missing |
| C — Secrets Management | ⚠️ MAJOR | APNs .p8 anti-pattern; JWT_REFRESH_SECRET undefined in codebase; otherwise solid |
| D — Storage Strategy | ✅ MINOR | Region label `eur1` vs `fra1` in some docs; pre-signed URL TTL correct |
| E — Monitoring | ⚠️ MINOR | Missing push notification failure alerts; background job monitoring absent |
| F — Logging | ⚠️ MINOR | Audit log vs application log retention conflation; DataRetentionLog job not monitored |
| G — CI/CD | 🔴 BLOCKER | Branch triggers wrong; deploy target wrong (App Platform vs Droplet); no rollback strategy |
| H — Disaster Recovery | ✅ MINOR | RPO/RTO targets reasonable; PITR correct; missing mobile offline behavior documentation |
| I — Security | ⚠️ MAJOR | APNs key storage anti-pattern; DPA missing; Cloudflare WAF absent |
| J — Cost Model | 🔴 BLOCKER | $167/month vs approved €85/month — 2× budget overrun |

---

## Final Status

```
╔══════════════════════════════════════════════════════════╗
║                                                          ║
║         APPROVED_WITH_PATCHES                            ║
║                                                          ║
║  4 BLOCKER issues must be resolved before provisioning.  ║
║  8 MAJOR issues must be resolved before launch.          ║
║  7 MINOR issues should be resolved before launch.        ║
║                                                          ║
║  The plan's security posture, GDPR framework, logging    ║
║  strategy, and PITR backup approach are sound and        ║
║  consistent with the architecture.                       ║
║                                                          ║
║  The plan cannot be executed as written. The deployment  ║
║  target (App Platform), cost model ($167/mo), mobile     ║
║  app count assumption (2 apps), and branch strategy      ║
║  all contradict MASTER_ARCHITECTURE_v2.0, which is the   ║
║  signed, approved source of truth.                       ║
║                                                          ║
║  Required before re-audit:                               ║
║  1. Resolve BLOCKER-3 (1 app vs 2 apps) with team sign-off║
║  2. Apply INFRA-PATCH-1 (Droplet topology)               ║
║  3. Apply INFRA-PATCH-2 (correct cost model)             ║
║  4. Create missing V2 documents or remove references     ║
║  5. Apply SEC-PATCH-1 (JWT secret ambiguity)             ║
║  6. Apply SEC-PATCH-2 (APNs key storage)                 ║
╚══════════════════════════════════════════════════════════╝
```
