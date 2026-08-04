> [!WARNING]
> **Historical Context:** This document describes a legacy architecture where the frontend (hotel-crm-web) was deployed on EC2. In the current production architecture, the frontend is hosted on Vercel, and EC2 only runs the backend API and worker processes.

# INFRASTRUCTURE CRITICAL FIX VALIDATION

**Branch reviewed:** `claude/adoring-wright-dvz97n`
**Reference document:** `INFRASTRUCTURE_IMPLEMENTATION_COMPLIANCE_REPORT.md`
**Scope:** GAP-C1 through GAP-C6 only
**Date:** 2026-06-10

---

## Validation Results

| Gap | Title | Result |
|-----|-------|--------|
| GAP-C1 | `ci.yml` missing `on: workflow_call:` trigger | **PASS** |
| GAP-C2 | pm2 `env_file` not natively supported — app starts with missing env vars | **PASS** |
| GAP-C3 | Frontend never built or deployed — `hotel-crm-web` pm2 process has no binary to run | **PARTIAL** |
| GAP-C4 | `postgresql-client` not installed on Droplet | **PASS** |
| GAP-C5 | `awscli` not installed on Droplet | **PASS** |
| GAP-C6 | AWS credentials for DO Spaces not mapped for aws CLI (`AWS_ACCESS_KEY_ID` vs `DO_SPACES_KEY`) | **FAIL** |

---

## GAP-C1 — PASS

**Requirement:** Add `on: workflow_call:` trigger to `.github/workflows/ci.yml` so that `deploy-staging.yml` and `deploy-production.yml` can call it as a reusable workflow without immediately failing.

**Finding:** `.github/workflows/ci.yml` now declares `workflow_call:` in its `on:` block (line 8). The trigger is present and syntactically correct.

```yaml
on:
  push:
    branches: ['feature/**', 'fix/**', 'develop', 'main']
  pull_request:
    branches: ['develop', 'main']
  workflow_call:
```

**Verdict: PASS**

---

## GAP-C2 — PASS

**Requirement:** pm2 silently ignores `env_file` in `ecosystem.config.js`. The application must start with secrets from `/etc/hotel-crm/.env` loaded into the process environment. The fix must use a bash wrapper (`set -a && source <file> && exec <binary>`), a systemd `EnvironmentFile=`, or equivalent.

**Finding:** `ecosystem.config.js` replaces the previous `env_file` usage with a bash wrapper for both pm2 processes. Each app sets `script: 'bash'` and passes the sourcing command via `args`:

```javascript
script: 'bash',
args: [
  '-c',
  'set -a && . /etc/hotel-crm/.env && set +a && exec node /opt/hotel-crm/backend/dist/server.js',
],
```

The same pattern is applied to `hotel-crm-web`. `set -a` exports all sourced variables; `exec` replaces the shell so pm2 tracks the correct PID.

**Verdict: PASS**

---

## GAP-C3 — PARTIAL

**Requirement:** The frontend must be built and deployed on every deployment, and the `hotel-crm-web` pm2 process must be restarted so it serves the new build. This applies to all deployment paths: staging workflow, production workflow, and manual deploy script.

**Finding:**

| Deployment path | Frontend build | `hotel-crm-web` restart |
|-----------------|---------------|------------------------|
| `deploy-staging.yml` | Yes — `npm run build` in `frontend/` directory and again in SSH inline script | Yes — `pm2 restart hotel-crm-web --update-env` |
| `deploy-production.yml` | **No** — SSH inline script only contains backend steps (`cd backend`, `npm ci --omit=dev`, `npm run build`) | **No** — only `pm2 reload hotel-crm-api --update-env` |
| `scripts/deploy.sh` | **No** — script is 6 steps, all backend-only; no `cd frontend`, no `npm run build` for frontend, no `hotel-crm-web` reload | **No** |

The staging path is fully fixed. The production workflow and the manual deploy script both remain backend-only. Production deployments will leave the frontend on the previous build indefinitely, which is the same failure mode described in the compliance report.

**Verdict: PARTIAL**

---

## GAP-C4 — PASS

**Requirement:** `postgresql-client` must be installed on the Droplet. It is required by `rotate-secrets.sh` (uses `psql`) and `backup-db.sh` (uses `pg_dump`).

**Finding:** `scripts/setup-droplet.sh` now includes `postgresql-client` in the `apt-get install -y` package list:

```bash
apt-get install -y -qq \
  curl wget git unzip \
  nginx \
  docker.io docker-compose-plugin \
  ufw fail2ban \
  postgresql-client \
  awscli
```

**Verdict: PASS**

---

## GAP-C5 — PASS

**Requirement:** `awscli` must be installed on the Droplet. It is required by `backup-db.sh` to upload database dumps to DigitalOcean Spaces via the S3-compatible API.

**Finding:** `scripts/setup-droplet.sh` now includes `awscli` in the same `apt-get install -y` block (line immediately after `postgresql-client`). See listing under GAP-C4 above.

**Verdict: PASS**

---

## GAP-C6 — FAIL

**Requirement:** The aws CLI reads credentials from `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY`. The `.env` file stores them as `DO_SPACES_KEY` and `DO_SPACES_SECRET`. `scripts/backup-db.sh` must map these before invoking `aws s3 cp`, otherwise the CLI will receive no credentials and the upload will fail with an authentication error.

**Finding:** `scripts/backup-db.sh` sources `/etc/hotel-crm/.env` with `set -a` / `set +a` but performs no variable mapping. The `aws s3 cp` call immediately follows without exporting `AWS_ACCESS_KEY_ID` or `AWS_SECRET_ACCESS_KEY`:

```bash
set -a
source "$SECRET_ENV"
set +a

# ... no mapping block ...

pg_dump "$DATABASE_URL" \
  | aws s3 cp - "s3://${DO_SPACES_BUCKET_BACKUPS:-hotelcrm-backups}/$BACKUP_FILE" \
      --endpoint-url "https://${DO_SPACES_REGION:-fra1}.digitaloceanspaces.com" \
      --storage-class STANDARD_IA
```

The aws CLI will not find credentials. The backup will fail at upload. This is the exact defect described in the compliance report and it is unresolved.

**Verdict: FAIL**

---

## Summary

- **4 of 6 critical gaps resolved** (GAP-C1, GAP-C2, GAP-C4, GAP-C5)
- **1 partial** (GAP-C3): staging fixed; production workflow and manual deploy script still backend-only
- **1 unresolved** (GAP-C6): `DO_SPACES_KEY` / `DO_SPACES_SECRET` not mapped to `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` in `backup-db.sh`
