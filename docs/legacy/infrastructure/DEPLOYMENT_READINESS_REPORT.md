> [!WARNING]
> **Historical Context:** This document describes a legacy architecture where the frontend (hotel-crm-web) was deployed on EC2. In the current production architecture, the frontend is hosted on Vercel, and EC2 only runs the backend API and worker processes.

# Deployment Readiness Report — Hotel CRM (First Deployment)

**Date:** 2026-06-17
**Scope:** Deployment execution only. Application code, merged PRs, and feature logic were intentionally **not** reviewed.
**Target:** First-ever deployment (nothing has been deployed). Pipeline is designed as **staging-first** (`develop` → staging droplet), then **production** (`main` → production droplet with manual approval).

---

## 1. Deployment Readiness: **65%**

Tooling and configuration are largely authored and coherent. Readiness is held back by **two hard blockers that will fail the very first build** and the fact that **no infrastructure has been provisioned and no secrets/environments are configured**.

| Area | Status |
|------|--------|
| Deployment assets authored | ✅ ~90% |
| Build pipeline actually runnable | ❌ blocked (see B1) |
| Trigger path for first deploy | ❌ blocked (see B2) |
| Infrastructure provisioned | ❌ 0% (never deployed) |
| Secrets / GitHub Environments | ❌ unconfigured |

---

## 2. Deployment Asset Audit

| Asset | File(s) | Verdict |
|-------|---------|---------|
| Docker (dev) | `docker-compose.yml` | ✅ postgres+redis+adminer+mailhog for local dev |
| Docker (prod) | `docker-compose.prod.yml` | ✅ Redis only (Postgres is managed/external). Needs `REDIS_PASSWORD` from env |
| GitHub Actions — CI | `.github/workflows/ci.yml` | ✅ lint/typecheck/test (backend) + mobile matrix. Uses full `npm ci` (correct) |
| GitHub Actions — staging | `.github/workflows/deploy-staging.yml` | ⚠️ Triggers on `develop`; builds with `--omit=dev` (B1); SSH deploy to droplet |
| GitHub Actions — production | `.github/workflows/deploy-production.yml` | ⚠️ Triggers on `main`; `--omit=dev` (B1); `environment: production` for approval gate; tags release |
| PM2 | `ecosystem.config.js` | ✅ api + web apps; loads `/etc/hotel-crm/.env` via Node `--env-file`; log paths set |
| Env templates | `backend/.env.example`, `backend/.env.staging`, droplet template inside `setup-droplet.sh` | ✅ Backend covered. ⚠️ No **frontend** env provisioning (B5) |
| Env validation | `backend/src/config/env.ts` | ✅ Zod schema; requires `DATABASE_URL` + `JWT_SECRET`(≥32). Accepts `staging` |
| DB migrations | `backend/prisma/migrations/20260613120000_v2_marketplace_init/migration.sql` | ✅ One migration present with SQL; `prisma migrate deploy` wired into all deploy paths |
| Nginx | `nginx/hotelcrm.conf` | ✅ present (reverse proxy + Cloudflare origin TLS) |
| Provisioning | `scripts/setup-droplet.sh` | ✅ One-shot droplet bootstrap (node/nvm, pm2, nginx, ufw, secret template) |
| Manual deploy | `scripts/deploy.sh` | ⚠️ Same `--omit=dev` build issue (B1) |
| Ops scripts | `scripts/backup-db.sh`, `scripts/rotate-secrets.sh` | ✅ present |
| Cloudflare | `deploy/cloudflare-checklist.md` | ✅ present |

---

## 3. Blockers (must clear before first deploy)

### 🔴 B1 — `npm ci --omit=dev` breaks every build (CRITICAL)
Both deploy workflows **and** `scripts/deploy.sh` run `npm ci --omit=dev` immediately before `npm run build`, but the build toolchains live in **devDependencies**:
- **Backend:** `build` = `tsc`; `typescript` and `prisma` are devDeps. `postinstall` (`prisma generate`) also needs the `prisma` CLI. → install + build fail.
- **Frontend:** `next build` needs `typescript`, `@types/*`, `tailwindcss`, `@tailwindcss/postcss` (all devDeps). → build fails.

**Fix options:** build with full deps then prune (`npm ci` → `npm run build` → `npm prune --omit=dev`), or move the required build-time packages to `dependencies`. This affects `deploy-staging.yml`, `deploy-production.yml`, and `scripts/deploy.sh`.

### 🔴 B2 — No `develop` branch exists (CRITICAL for staging-first plan)
`deploy-staging.yml` triggers on `push: [develop]`. Remote has only `main`. The intended staging-first path has no trigger. → Create `develop` (off `main`) before any staging deploy.

### 🔴 B3 — Infrastructure not provisioned (expected, first deploy)
No staging droplet, no managed PostgreSQL cluster, no DO Spaces bucket, no Cloudflare origin cert installed. `setup-droplet.sh` is written but has never been run.

### 🟠 B4 — GitHub Secrets & Environments unconfigured
Workflows reference secrets that must exist before a run can succeed:
- Staging: `STAGING_DATABASE_URL`, `STAGING_DROPLET_IP`, `STAGING_SSH_KEY`
- Production: `PROD_DATABASE_URL`, `PROD_DROPLET_IP`, `PROD_SSH_KEY`
- GitHub **Environments** `staging` and `production` must be created; `production` needs the required-reviewers approval rule (the workflow assumes it).

### 🟠 B5 — Frontend secret/runtime env not provisioned
`setup-droplet.sh` writes only the **backend** secret file (`/etc/hotel-crm/.env`). PM2 starts `hotel-crm-web` with only `NODE_ENV`/`PORT`. No frontend API base URL / `NEXT_PUBLIC_*` provisioning exists. Currently low-impact (frontend is still the default scaffold — no Supabase/backend calls wired), but must be resolved before the UI talks to the API.

---

## 4. Deployment Order / Sequence

```
Phase 0  Fix blockers B1 (build) + B2 (develop branch)   [repo work]
Phase 1  Provision staging infra (B3)                     [DigitalOcean + Cloudflare]
Phase 2  Configure GitHub secrets + environments (B4)     [GitHub settings]
Phase 3  First STAGING deploy via push to `develop`       [CI gate → migrate → SSH deploy]
Phase 4  Smoke-test staging (health endpoints)
Phase 5  Promote to PRODUCTION via PR develop→main + approval
```

Within a single deploy run the order is fixed by the workflow:
`CI gate → prisma migrate deploy → build → SSH (git pull, install, build, pm2 reload) → health checks → (prod) tag release`.

---

## 5. Exact Checklist

### A. Staging Database (DigitalOcean Managed PostgreSQL 15)
- [ ] Create managed PG cluster (region `fra1` to match Spaces).
- [ ] Create DB `hotelcrm_staging` and an app user.
- [ ] Capture connection string with `?sslmode=require`.
- [ ] Add droplet IP / VPC to the cluster trusted sources.
- [ ] (Migrations run automatically via `prisma migrate deploy` in the workflow.)

### B. Staging Droplet (Ubuntu 24.04)
- [ ] Create droplet; add provisioning SSH key.
- [ ] `bash scripts/setup-droplet.sh staging` (installs node/nvm, pm2, nginx, ufw, fail2ban; creates `deploy` user, dirs, secret template).
- [ ] Install Cloudflare origin cert → `/etc/ssl/cloudflare/`.
- [ ] `cp nginx/hotelcrm.conf /etc/nginx/sites-available/hotelcrm` → symlink → `nginx -t && systemctl enable --now nginx`.
- [ ] `git clone` repo into `/opt/hotel-crm` as `deploy`; checkout `develop`.
- [ ] Start Redis: `docker compose -f docker-compose.prod.yml up -d` (needs `REDIS_PASSWORD`).
- [ ] Restrict UFW 80/443 to Cloudflare IP ranges.

### C. Environment Variables (`/etc/hotel-crm/.env`, chmod 640 root:deploy)
- [ ] `NODE_ENV=staging`, `PORT=3001`
- [ ] `DATABASE_URL` (staging cluster, sslmode=require)
- [ ] `REDIS_URL` + `REDIS_PASSWORD` (matching docker-compose.prod)
- [ ] `JWT_SECRET`, `JWT_REFRESH_SECRET` — `openssl rand -base64 48`
- [ ] `CORS_ORIGIN` / `FRONTEND_URL` = `https://staging.hotelcrm.app`
- [ ] DO Spaces: `DO_SPACES_KEY/SECRET/BUCKET/REGION/ENDPOINT`
- [ ] `EMAIL_SERVICE` + `SENDGRID_API_KEY`
- [ ] APNs (`*_BASE64/KEY_ID/TEAM_ID/BUNDLE_ID`), `FIREBASE_PROJECT_ID`, `SENTRY_DSN`, `LOG_LEVEL`
- [ ] **Frontend** runtime env (resolve B5 before UI integration).

### D. GitHub Secrets / Environments
- [ ] Create Environments `staging` and `production`; add required reviewers to `production`.
- [ ] Secrets: `STAGING_DATABASE_URL`, `STAGING_DROPLET_IP`, `STAGING_SSH_KEY`.
- [ ] Secrets: `PROD_DATABASE_URL`, `PROD_DROPLET_IP`, `PROD_SSH_KEY`.
- [ ] Ensure the `STAGING_SSH_KEY` corresponds to a key authorized for the `deploy` user.

### E. Deployment Workflow
- [ ] Land B1 build fix on `develop`.
- [ ] Push to `develop` → CI gate runs → migrate → SSH deploy → health checks pass.
- [ ] Verify `https://staging.hotelcrm.app` and `/api/v1/health`.
- [ ] Open PR `develop` → `main`; merge triggers production workflow → approve in Environment gate.

---

## 6. Exact Next Action

**Fix B1 + create B2** in the repo, in this order, since nothing else can succeed until the build runs:

1. In `deploy-staging.yml`, `deploy-production.yml`, and `scripts/deploy.sh`, change the build sequence to install full deps then prune:
   `npm ci && npm run build && npm prune --omit=dev` (backend and frontend), **or** move `typescript`/`prisma` (backend) and `typescript`/`tailwindcss`/`@tailwindcss/postcss`/`@types/*` (frontend) into `dependencies`.
2. `git checkout -b develop main && git push -u origin develop`.

Then proceed to Phase 1 (provision staging) → Phase 2 (secrets) → Phase 3 (first staging deploy).

> Note: B1 fixes are **identified here, not applied** — this report is an audit deliverable per the task scope.
