> [!WARNING]
> **Historical Context:** This document describes a legacy architecture where the frontend (hotel-crm-web) was deployed on EC2. In the current production architecture, the frontend is hosted on Vercel, and EC2 only runs the backend API and worker processes.

# INFRASTRUCTURE IMPLEMENTATION COMPLIANCE REPORT

**Scope:** All infrastructure artifacts created on branch `claude/focused-cannon-qwznmo`  
**Reference documents:** INFRASTRUCTURE_AND_DEPLOYMENT_PLAN.md · PATCH_V1 · PATCH_V2  
**Date:** 2026-06-10  
**Analyst:** Claude Code  
**Analysis only — no files modified, no patches generated, no code written**

---

## PRELIMINARY NOTE — FREEZE DOCUMENT MISSING

`INFRASTRUCTURE_AND_DEPLOYMENT_PLAN_FREEZE.md` was listed as a reference in the task brief but **does not exist** in the repository. The compliance analysis is therefore performed against the closest authoritative equivalent:

- `INFRASTRUCTURE_AND_DEPLOYMENT_PLAN_PATCH_V2.md` — status: `IMPLEMENTATION-READY`, all BLOCKER and MAJOR issues resolved
- `INFRASTRUCTURE_AND_DEPLOYMENT_PLAN.md` — base plan
- `INFRASTRUCTURE_AND_DEPLOYMENT_PLAN_PATCH_V1.md` — audit findings

PATCH_V2 is treated as the freeze baseline for this report.

---

## SECTION 1 — ARTIFACT INVENTORY

| # | Artifact | Location | Type | Exists |
|---|---|---|---|---|
| 1 | `docker-compose.prod.yml` | `/` (repo root) | Docker Compose | ✅ |
| 2 | `ecosystem.config.js` | `/` (repo root) | PM2 Ecosystem | ✅ |
| 3 | `nginx/hotelcrm.conf` | `nginx/` | Nginx Config | ✅ |
| 4 | `ci.yml` | `.github/workflows/` | GitHub Actions | ✅ |
| 5 | `deploy-staging.yml` | `.github/workflows/` | GitHub Actions | ✅ |
| 6 | `deploy-production.yml` | `.github/workflows/` | GitHub Actions | ✅ |
| 7 | `cloudflare-checklist.md` | `deploy/` | Operational Checklist | ✅ |
| 8 | `setup-droplet.sh` | `scripts/` | Shell Script | ✅ |
| 9 | `deploy.sh` | `scripts/` | Shell Script | ✅ |
| 10 | `rotate-secrets.sh` | `scripts/` | Shell Script | ✅ |
| 11 | `backup-db.sh` | `scripts/` | Shell Script | ✅ |
| 12 | `backend/.env.example` | `backend/` | Env Template | ✅ |
| 13 | `backend/.env.staging` | `backend/` | Env Template | ✅ |

All 13 specified artifacts are present. The freeze document itself is absent.

---

## SECTION 2 — COMPLIANCE MATRIX

Each artifact is evaluated against nine criteria, then assigned a final verdict.

**Criteria key:**
- **F** = Matches infra freeze / PATCH_V2 decisions
- **P** = Production-ready
- **S** = No critical security gaps
- **D** = Dependencies fully accounted for
- **M** = Marketplace/backend architecture compatible
- **A** = Single mobile app compatible (PATCH-09)
- **DO** = DigitalOcean Droplet compatible
- **R** = Rollback readiness
- **C** = CI/CD chain integrity

---

### Artifact 1 — `docker-compose.prod.yml`

**Verdict: PASS_WITH_WARNINGS**

| Criterion | Status | Detail |
|---|---|---|
| F — Matches PATCH_V2 | ✅ | Redis-only service, bound to 127.0.0.1:6379, 512MB cap, allkeys-lru, restart:always — all per PATCH-01 |
| P — Production-ready | ⚠️ | `${REDIS_PASSWORD}` interpolation has no `env_file:` directive in the compose file. The variable must be present in the calling shell environment or a `.env` file co-located with the compose file. Neither is documented or provided. |
| S — Security | ✅ | Localhost bind prevents external exposure. Password auth enabled. |
| D — Dependencies | ✅ | Redis 7-alpine image, no external deps beyond Docker |
| M — Marketplace compat | ✅ | Redis used as cache layer only; no marketplace-specific coupling |
| A — Single app compat | ✅ | No mobile coupling |
| DO — Droplet compat | ✅ | Designed for Docker on Droplet per PATCH-01 |
| R — Rollback | ✅ | `appendonly yes` provides persistence; Redis is non-critical per plan |
| C — CI/CD chain | ⚠️ | No CI/CD artifact starts this compose file. setup-droplet.sh installs Docker but does not run `docker compose -f docker-compose.prod.yml up -d` |

**Warnings:**
1. No `.env` file or `env_file:` directive for `${REDIS_PASSWORD}` expansion. Running `docker compose -f docker-compose.prod.yml up -d` without the variable set produces a startup failure or empty password.
2. `appendonly yes` enables AOF persistence. PATCH-01 explicitly states Redis is non-critical and ephemeral. AOF adds disk write overhead inconsistent with the plan's intent. Not a blocker, but contradicts the plan's stated Redis posture.

---

### Artifact 2 — `ecosystem.config.js`

**Verdict: PASS_WITH_WARNINGS**

| Criterion | Status | Detail |
|---|---|---|
| F — Matches PATCH_V2 | ✅ | Two apps (hotel-crm-api, hotel-crm-web), correct ports (3001, 3000), correct paths, 700M/512M memory limits per PATCH-01 |
| P — Production-ready | ⚠️ | pm2 does not natively support `env_file` as an ecosystem.config.js key in standard pm2 v5. See warning below. |
| S — Security | ✅ | Secrets are referenced from an external file, not embedded |
| D — Dependencies | ⚠️ | `hotel-crm-web` uses `node_modules/.bin/next` which requires `npm install` in the frontend directory. No artifact performs this step. |
| M — Marketplace compat | ✅ | Backend API process is correctly isolated on port 3001 |
| A — Single app compat | ✅ | No EAS or mobile process in ecosystem file |
| DO — Droplet compat | ✅ | Matches Droplet topology from PATCH-01 |
| R — Rollback | ⚠️ | `pm2 reload` is used in deploy.sh but `pm2 reload` does not guarantee previous-version fallback if the new process fails to start |
| C — CI/CD chain | ⚠️ | `hotel-crm-web` pm2 process is never started, stopped, or reloaded by any GitHub Actions workflow |

**Warnings:**
1. **`env_file` is not a pm2 native key.** pm2 ecosystem config supports `env`, `env_production`, `env_staging` inline blocks, and per-process environment variables. The `env_file` key is silently ignored by pm2 in most versions. Secrets from `/etc/hotel-crm/.env` will not be loaded into the process environment through this mechanism. The application will start with missing env vars and crash. This requires a workaround: either source the file before calling pm2 start, configure systemd `EnvironmentFile=`, or use a wrapper start script.
2. Frontend dependency installation is completely absent from all deployment artifacts. `hotel-crm-web` will fail to start on first deploy because `node_modules/.bin/next` will not exist.

---

### Artifact 3 — `nginx/hotelcrm.conf`

**Verdict: PASS_WITH_WARNINGS**

| Criterion | Status | Detail |
|---|---|---|
| F — Matches PATCH_V2 | ✅ | Cloudflare origin cert, rate limiting zones, security headers, proxy to 3001/3000, HTTP→HTTPS redirect — all per PATCH-01 |
| P — Production-ready | ⚠️ | Three gaps documented below |
| S — Security | ⚠️ | Rate limiting uses `$binary_remote_addr` which resolves to Cloudflare proxy IPs, not client IPs. All users share one rate limit bucket per Cloudflare PoP. |
| D — Dependencies | ✅ | Only requires Nginx and the Cloudflare origin cert files to exist |
| M — Marketplace compat | ✅ | No marketplace-specific routing. `/api/` catch-all is correct for a monolith. |
| A — Single app compat | ✅ | No mobile-specific routes |
| DO — Droplet compat | ✅ | Designed for single Droplet with collocated services |
| R — Rollback | ✅ | Nginx config changes are independent of app deployment |
| C — CI/CD chain | ✅ | No CI/CD integration needed for static config file |

**Warnings:**
1. **Rate limiting applies to Cloudflare proxy IPs, not client IPs.** `limit_req_zone $binary_remote_addr` behind a CDN proxy rates the Cloudflare PoP IP, not the real attacker. To fix, the Nginx `real_ip_module` must be configured with Cloudflare IP ranges and `real_ip_header CF-Connecting-IP`. This is entirely absent from the config and from setup-droplet.sh.
2. **No CSP header on the web frontend vhost.** The API vhost has a Content-Security-Policy. The `hotelcrm.app` / `www.hotelcrm.app` server block does not. PATCH_V2 SEC-PATCH-4 explicitly requires CSP in the Nginx server block.
3. **`ssl_ciphers HIGH:!aNULL:!MD5` is an outdated specification.** Mozilla's Intermediate compatibility profile (the recommended baseline for 2024+) requires explicit cipher ordering with ECDHE suites preferred. The current spec allows weak DH groups and older ciphers that should be excluded.

---

### Artifact 4 — `.github/workflows/ci.yml`

**Verdict: FAIL**

| Criterion | Status | Detail |
|---|---|---|
| F — Matches PATCH_V2 | ✅ | Correct branch triggers (feature/**, fix/**, develop, main), PR targets, all env vars including JWT_REFRESH_SECRET and APNS_PRIVATE_KEY_BASE64 |
| P — Production-ready | ❌ | Missing `workflow_call` trigger — this is a blocking defect |
| S — Security | ✅ | No secrets in plaintext; test values are safe stubs |
| D — Dependencies | ⚠️ | No frontend typecheck or lint step |
| M — Marketplace compat | ✅ | Backend CI only; marketplace modules tested through standard test suite |
| A — Single app compat | ✅ | No mobile CI here (EAS is separate) |
| DO — Droplet compat | N/A | CI runs on GitHub runners, not the Droplet |
| R — Rollback | ✅ | CI gate prevents broken code reaching staging/production |
| C — CI/CD chain | ❌ | CRITICAL: deploy-staging.yml and deploy-production.yml call `uses: ./.github/workflows/ci.yml` which requires `on: workflow_call:` to be defined in ci.yml. It is not defined. Both deploy workflows will immediately fail with "The workflow must have a workflow_call trigger" |

**Failure reason:**
The `workflow_call` trigger is absent from ci.yml's `on:` block. GitHub Actions reusable workflows require the called workflow to explicitly declare `on: workflow_call:`. Since both deploy workflows have `uses: ./.github/workflows/ci.yml` as their CI gate job, **every deployment to staging and production will fail immediately** without running any steps. This is a complete CI/CD chain breakage.

---

### Artifact 5 — `.github/workflows/deploy-staging.yml`

**Verdict: FAIL**

| Criterion | Status | Detail |
|---|---|---|
| F — Matches PATCH_V2 | ✅ | Triggers on develop, uses appleboy/ssh-action, health check, environment:staging — per CICD-PATCH-1 and CICD-PATCH-2 |
| P — Production-ready | ❌ | Two blocking defects |
| S — Security | ✅ | Secrets via GitHub Secrets; no plaintext credentials |
| D — Dependencies | ❌ | Frontend is never built or deployed |
| M — Marketplace compat | ✅ | Backend-only deploy is correct for monolith |
| A — Single app compat | ✅ | No mobile steps needed in server deploy |
| DO — Droplet compat | ✅ | SSH to Droplet, pm2 restart, health check — all correct for Droplet topology |
| R — Rollback | ⚠️ | No automatic rollback. If health check fails, the broken code remains on the Droplet. |
| C — CI/CD chain | ❌ | Depends on ci.yml workflow_call — fails immediately due to ci.yml defect |

**Failure reasons:**
1. **`uses: ./.github/workflows/ci.yml` requires `workflow_call`** — same fatal defect as ci.yml.
2. **Frontend is not deployed.** The SSH script only handles `cd backend`. The `hotel-crm-web` pm2 process is never restarted after a deploy. The Next.js frontend will remain on the previous version indefinitely.

**Additional warning:** The SSH script executes `git checkout origin/develop` which produces a detached HEAD state on the Droplet. While functionally correct for deployment, it means the Droplet cannot be used as a reference for current deployed version via `git describe`.

---

### Artifact 6 — `.github/workflows/deploy-production.yml`

**Verdict: FAIL**

| Criterion | Status | Detail |
|---|---|---|
| F — Matches PATCH_V2 | ✅ | Triggers on main, manual approval gate via environment:production, pm2 reload (graceful), auto-tags release — per CICD-PATCH-2 |
| P — Production-ready | ❌ | Three blocking defects |
| S — Security | ✅ | Secrets via GitHub Secrets |
| D — Dependencies | ❌ | Frontend not deployed |
| M — Marketplace compat | ✅ | |
| A — Single app compat | ✅ | |
| DO — Droplet compat | ✅ | pm2 reload is the correct zero-downtime mechanism for production |
| R — Rollback | ❌ | Health check failure handler calls `pm2 restart hotel-crm-api` which restarts the **new broken code**, not the previous version. This is not a rollback. |
| C — CI/CD chain | ❌ | Same workflow_call defect |

**Failure reasons:**
1. **`uses: ./.github/workflows/ci.yml` requires `workflow_call`** — same fatal defect.
2. **False rollback.** The health-check failure branch executes `pm2 restart hotel-crm-api`. This restarts the same broken binary that just failed the health check. A real rollback requires reverting the git checkout to the previous tag and rebuilding. The current code gives a false impression of rollback capability. PATCH_V2 PATCH-10 (Scenario A/B) defines the correct rollback procedure; the workflow does not implement it.
3. **Tag push lacks `permissions: contents: write`.** The `git push origin "$TAG"` step will fail with a 403 error unless the workflow explicitly declares `permissions: contents: write`. The default GITHUB_TOKEN has read-only permissions for contents in most org configurations. This means every production deploy will succeed on the Droplet but fail to create the release tag, making version tracking impossible.

---

### Artifact 7 — `deploy/cloudflare-checklist.md`

**Verdict: PASS_WITH_WARNINGS**

| Criterion | Status | Detail |
|---|---|---|
| F — Matches PATCH_V2 | ✅ | Covers Full Strict SSL, WAF, DDoS, origin cert, DNS TTL, analytics, DR failover — all per PATCH-03 |
| P — Production-ready | ⚠️ | One factual error regarding TTL behaviour on free Cloudflare plan |
| S — Security | ✅ | Origin cert procedure correct, WAF + Bot Fight Mode documented |
| D — Dependencies | ✅ | Self-contained operational document |
| M — Marketplace compat | ✅ | No application-level coupling |
| A — Single app compat | ✅ | |
| DO — Droplet compat | ✅ | Cloudflare → Nginx → Droplet architecture correctly described |
| R — Rollback | ✅ | DR failover DNS procedure in Section 9 correctly describes the Cloudflare DNS update path |
| C — CI/CD chain | N/A | Operational document, no CI/CD coupling |

**Warnings:**
1. **TTL 60s claim is inaccurate for Cloudflare Free proxied records.** Section 2 states "Auto (60s)" in the DNS table and instructs the operator to set TTL to 60s. On the Cloudflare Free plan, proxied DNS records use Cloudflare's automatic TTL (typically 300 seconds). Manual TTL of 60s on proxied records requires the Cloudflare Pro plan or above. The checklist should note this limitation and set the expectation at 300s (5 min) propagation for Free plan, not 60s.
2. **DO Cloud Firewall Cloudflare IP restriction is a TODO in setup-droplet.sh but is presented as implemented in the checklist.** Section 6 references "enforced at DO firewall level — see deployment scripts." The setup-droplet.sh script only prints a comment instructing the operator to manually apply the restriction. This creates a gap between the checklist promise and the actual state of the Droplet after running setup scripts.

---

### Artifact 8 — `scripts/setup-droplet.sh`

**Verdict: PASS_WITH_WARNINGS**

| Criterion | Status | Detail |
|---|---|---|
| F — Matches PATCH_V2 | ✅ | Ubuntu 24.04, deploy user, NVM+Node 20, pm2, Docker, Nginx, UFW, /etc/hotel-crm/.env template — all per PATCH_V2 Section 6 Phase 1 |
| P — Production-ready | ⚠️ | Four missing system dependencies |
| S — Security | ⚠️ | UFW is configured with broad 80/443 rules (0.0.0.0/0) with only a comment noting they should be restricted to Cloudflare IPs |
| D — Dependencies | ❌ | `postgresql-client` not installed (needed by rotate-secrets.sh, backup-db.sh). `awscli` not installed (needed by backup-db.sh). |
| M — Marketplace compat | ✅ | System-level setup has no application coupling |
| A — Single app compat | ✅ | |
| DO — Droplet compat | ✅ | Targets correct Ubuntu version, installs correct stack |
| R — Rollback | ✅ | Idempotent enough for re-runs; existing .env not overwritten |
| C — CI/CD chain | ⚠️ | GitHub Actions SSH deploys may fail because NVM's node binary path is not in PATH for non-interactive shells. When appleboy/ssh-action runs a script, it uses a non-login non-interactive shell that does not source ~/.bashrc or ~/.bash_profile, so NVM and pm2 are not in PATH. |

**Warnings:**
1. **`postgresql-client` is not installed.** `rotate-secrets.sh` calls `psql` and `backup-db.sh` calls `pg_dump`. Neither binary is present after running setup-droplet.sh. Both scripts will fail at runtime.
2. **`awscli` is not installed.** `backup-db.sh` uses `aws s3 cp`. The script will fail with "command not found" on every backup run.
3. **UFW does not restrict 80/443 to Cloudflare IP ranges.** The script opens ports 80 and 443 to 0.0.0.0/0 with a comment to manually restrict them. Until restricted, the Droplet's Nginx is directly reachable by any IP, bypassing Cloudflare's WAF entirely. This contradicts the security model in PATCH_V2 Section 5.
4. **NVM in non-interactive SSH sessions.** When GitHub Actions uses appleboy/ssh-action to execute deployment scripts, the shell does not source `~/.bashrc`. The pm2 and node binaries (installed via NVM under ~/.nvm) will not be in PATH, causing `npm`, `npx`, and `pm2` commands to fail with "command not found." Requires either: installing Node via NodeSource apt repository instead of NVM, or adding NVM initialization to `~/.bash_profile` and using `-i` (interactive) shell in ssh-action.
5. **Docker Redis not started.** setup-droplet.sh does not run `docker compose -f docker-compose.prod.yml up -d`. First application start will fail to connect to Redis until manually started.
6. **No cron job for backup-db.sh.** The plan (PATCH_V2 Section 6 Phase 4) requires a Sunday 03:00 UTC cron. setup-droplet.sh does not install it.
7. **fail2ban is installed but not configured.** SSH brute force protection is installed but the default configuration is minimal. No jails are enabled for SSH in the script.
8. **pm2 startup command capture is fragile.** The pattern `pm2 startup ... | grep "sudo" | bash` relies on the output format of pm2 startup not changing. The `|| true` silently swallows failures, meaning pm2 may not be configured to survive Droplet reboots.

---

### Artifact 9 — `scripts/deploy.sh`

**Verdict: PASS_WITH_WARNINGS**

| Criterion | Status | Detail |
|---|---|---|
| F — Matches PATCH_V2 | ✅ | git fetch → checkout → npm ci → build → prisma migrate deploy → pm2 reload → health check — matches PATCH_V2 Section 4 deployment process |
| P — Production-ready | ⚠️ | Frontend never built or deployed |
| S — Security | ✅ | Sources secrets from /etc/hotel-crm/.env at migration time only |
| D — Dependencies | ⚠️ | Depends on NVM being in PATH (same issue as setup-droplet.sh); frontend npm install absent |
| M — Marketplace compat | ✅ | |
| A — Single app compat | ✅ | |
| DO — Droplet compat | ✅ | Correct for Droplet with pm2 |
| R — Rollback | ⚠️ | Script has no rollback path. On health check failure, it exits non-zero but leaves the broken deployment in place. |
| C — CI/CD chain | ⚠️ | pm2 `env_file` concern applies here too (see ecosystem.config.js analysis) |

**Warnings:**
1. **Frontend not deployed.** No `npm install` or `next build` for the frontend. `hotel-crm-web` pm2 process is not restarted. A full deployment leaves the frontend on a stale build.
2. **No frontend dependency step.** If the frontend Next.js app has dependency changes in a release, they will not be installed.
3. **`pm2 reload hotel-crm-api --update-env`** — if pm2 does not natively respect `env_file` in ecosystem.config.js (see artifact 2 warning), `--update-env` will not load updated secrets from `/etc/hotel-crm/.env`. The running process keeps its stale env vars. This is the most consequential consequence of the pm2 env_file limitation.
4. **Docker Redis health not verified.** The script does not check whether Redis is running before starting the app. On a fresh Droplet, the app will start with Redis unavailable. The plan says this is non-critical (Express should continue), but it should at least be logged.

---

### Artifact 10 — `scripts/rotate-secrets.sh`

**Verdict: PASS_WITH_WARNINGS**

| Criterion | Status | Detail |
|---|---|---|
| F — Matches PATCH_V2 | ✅ | JWT rotation, in-place sed replacement, pm2 reload, session purge — per PATCH-06 and PATCH_V2 Section 5 |
| P — Production-ready | ⚠️ | Session purge logic does not discriminate between access and refresh token rotation |
| S — Security | ✅ | openssl rand generation is cryptographically strong; sed pattern is safe (base64 chars do not include the `|` delimiter) |
| D — Dependencies | ❌ | Calls `psql` which is not installed by setup-droplet.sh |
| M — Marketplace compat | ✅ | |
| A — Single app compat | ✅ | |
| DO — Droplet compat | ✅ | |
| R — Rollback | ❌ | No backup of old secret values before overwriting. A failed rotation cannot be reversed without the old values, which are overwritten in-place. |
| C — CI/CD chain | N/A | Manual operational script |

**Warnings:**
1. **Session purge is unconditional.** When rotating only the access token (`bash rotate-secrets.sh access`), the script still purges all Session rows, forcing all users to re-login immediately. Access tokens expire in 1h; a session purge is only required when `JWT_REFRESH_SECRET` is rotated. The plan (PATCH-06) explicitly states: purge sessions when rotating the refresh secret.
2. **No pre-rotation backup.** The old secret value is overwritten by sed with no copy made. If the rotation needs to be reversed (e.g., app fails to start after rotation due to an env loading bug), the old value is unrecoverable. Recommend writing old value to a temp file or 1Password before overwriting.
3. **`psql` not installed** by setup-droplet.sh. The session purge step will fail with "command not found."
4. **No APNs key rotation.** PATCH-05 defines a full 10-step APNs key rotation procedure. No corresponding script or runbook is provided among the artifacts.
5. **`pm2 reload hotel-crm-api --update-env`** — same env_file limitation as noted in ecosystem.config.js and deploy.sh. If pm2 does not load the updated .env file, the app continues running with the old secret after reload.

---

### Artifact 11 — `scripts/backup-db.sh`

**Verdict: PASS_WITH_WARNINGS**

| Criterion | Status | Detail |
|---|---|---|
| F — Matches PATCH_V2 | ✅ | pg_dump custom format, compress=9, DO Spaces upload, STANDARD_IA — per PATCH_V2 Section 6 Phase 4 |
| P — Production-ready | ⚠️ | Two missing system dependencies; no alerting on failure |
| S — Security | ✅ | Sources credentials from /etc/hotel-crm/.env; no credentials hardcoded |
| D — Dependencies | ❌ | `pg_dump` not installed (needs `postgresql-client`). `aws` CLI not installed. AWS credentials for DO Spaces not configured. |
| M — Marketplace compat | ✅ | |
| A — Single app compat | ✅ | |
| DO — Droplet compat | ✅ | Designed for Droplet → DO Spaces workflow |
| R — Rollback | ✅ | Backup is a DR artifact enabling PATCH_V2 P1 recovery runbook |
| C — CI/CD chain | ⚠️ | Cron job not installed by any artifact |

**Warnings:**
1. **`pg_dump` not installed.** Needs `postgresql-client` package. Will fail immediately on first run.
2. **`aws` CLI not installed.** Needs `awscli` or `python3-pip && pip install awscli`. Will fail immediately on first run.
3. **AWS credentials not configured.** The `aws s3 cp` command needs `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY` (which map to DO Spaces keys). While `DO_SPACES_KEY` and `DO_SPACES_SECRET` are loaded from the .env file, the aws CLI expects them as `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY`. The script uses `DO_SPACES_KEY` variable names which aws CLI does not read. An `aws configure` step or variable mapping (`AWS_ACCESS_KEY_ID=$DO_SPACES_KEY`) is missing.
4. **`DO_SPACES_BUCKET_BACKUPS` is undocumented.** The script references this variable but it appears in neither `.env.example` nor `.env.staging`. The fallback default `hotelcrm-backups` works, but the variable name mismatch with `DO_SPACES_BUCKET` (the upload bucket) could cause confusion or the wrong bucket being used.
5. **No failure notification.** PATCH_V1 MINOR-3 specifically flags that silently failing background jobs are a GDPR compliance risk. If pg_dump or the S3 upload fails, the cron job exits non-zero and logs to `/home/ubuntu/.pm2/logs/backup.log` — but no alert is raised. A failed weekly backup unnoticed for weeks means the RPO guarantee is void.
6. **No backup verification.** The script does not check file size, validate the dump is non-zero, or attempt a test restore. The plan's Phase 4 DR hardening section requires a monthly restore drill; no automation artifact exists for it.
7. **Cron job not installed** by any artifact.

---

### Artifact 12 — `backend/.env.example`

**Verdict: PASS_WITH_WARNINGS**

| Criterion | Status | Detail |
|---|---|---|
| F — Matches PATCH_V2 | ✅ | JWT_REFRESH_SECRET present (PATCH-06), APNS_PRIVATE_KEY_BASE64 present with encoding instructions (PATCH-05) |
| P — Production-ready | ⚠️ | Two missing variables |
| S — Security | ✅ | No real secrets; safe placeholder values only |
| D — Dependencies | ⚠️ | Missing REDIS_PASSWORD key |
| M — Marketplace compat | ✅ | All API-layer environment variables present |
| A — Single app compat | ✅ | Mobile env vars handled by EAS build profiles, not .env.example |
| DO — Droplet compat | ✅ | DO Spaces variables correct |
| R — Rollback | N/A | Template document |
| C — CI/CD chain | ✅ | ci.yml test env vars are a superset of .env.example; no conflicts |

**Warnings:**
1. **`REDIS_PASSWORD` is absent.** The `docker-compose.prod.yml` interpolates `${REDIS_PASSWORD}`, the `setup-droplet.sh` secret template includes it, and `backend/.env.staging` includes it in the Redis URL. But `backend/.env.example` omits the standalone `REDIS_PASSWORD` key. Developers setting up local environments using .env.example as the template will have no indication this variable is needed.
2. **`DO_SPACES_BUCKET_BACKUPS` is absent.** This variable is referenced in `backup-db.sh`. It is present nowhere in any env template.
3. **`FIREBASE_CREDENTIALS` vs `FIREBASE_PROJECT_ID` inconsistency.** The original plan's secrets table lists `FIREBASE_CREDENTIALS` as a base64-encoded JSON credential blob. The .env.example only has `FIREBASE_PROJECT_ID`. PATCH-06's Zod schema also only specifies `FIREBASE_PROJECT_ID`. It is unclear whether Firebase Admin SDK authentication uses a credential JSON or project ID alone. If the Admin SDK is used (required for FCM sends), a full service account credential file/base64 is necessary.

---

### Artifact 13 — `backend/.env.staging`

**Verdict: PASS_WITH_WARNINGS**

| Criterion | Status | Detail |
|---|---|---|
| F — Matches PATCH_V2 | ✅ | NODE_ENV=staging, JWT_SECRET + JWT_REFRESH_SECRET, APNS_PRIVATE_KEY_BASE64, staging bundle ID, Redis URL with password |
| P — Production-ready | ⚠️ | Template only; actual values must be placed on Droplet at /etc/hotel-crm/.env |
| S — Security | ✅ | Contains only REPLACE_ME placeholders; no real values committed |
| D — Dependencies | ⚠️ | REDIS_PASSWORD absent as standalone key; DO_SPACES_BUCKET_BACKUPS absent |
| M — Marketplace compat | ✅ | |
| A — Single app compat | ✅ | Staging bundle ID `com.zirove.hotelcrm.staging` consistent with single-app model |
| DO — Droplet compat | ✅ | Redis URL points to 127.0.0.1 per Docker on Droplet topology |
| R — Rollback | N/A | Template document |
| C — CI/CD chain | ⚠️ | deploy-staging.yml uses `${{ secrets.STAGING_DATABASE_URL }}` directly; this file is a manual reference template but the relationship between the two is not documented |

**Warnings:**
1. **`REDIS_PASSWORD` not present as a standalone variable.** The REDIS_URL includes `:REDIS_PASSWORD@` as a placeholder, but the standalone `REDIS_PASSWORD` variable needed by docker-compose.prod.yml is absent.
2. **`DO_SPACES_BUCKET_BACKUPS` absent.** Same gap as .env.example.
3. **Comment says "Real secrets live in /etc/hotel-crm/.env on the Staging Droplet."** This is correct but the relationship between this file (a Git-tracked template) and the actual Droplet secret file is not operationally linked by any script. A developer could confuse this file for the actual runtime config.

---

## SECTION 3 — COMPLIANCE MATRIX SUMMARY

| # | Artifact | Freeze Match | Security | Prod-Ready | Dependencies | Rollback | CI/CD Chain | Verdict |
|---|---|---|---|---|---|---|---|---|
| 1 | docker-compose.prod.yml | ✅ | ✅ | ⚠️ | ✅ | ✅ | ⚠️ | **PASS_WITH_WARNINGS** |
| 2 | ecosystem.config.js | ✅ | ✅ | ⚠️ | ⚠️ | ⚠️ | ⚠️ | **PASS_WITH_WARNINGS** |
| 3 | nginx/hotelcrm.conf | ✅ | ⚠️ | ⚠️ | ✅ | ✅ | ✅ | **PASS_WITH_WARNINGS** |
| 4 | ci.yml | ✅ | ✅ | ❌ | ⚠️ | ✅ | ❌ | **FAIL** |
| 5 | deploy-staging.yml | ✅ | ✅ | ❌ | ❌ | ⚠️ | ❌ | **FAIL** |
| 6 | deploy-production.yml | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | **FAIL** |
| 7 | cloudflare-checklist.md | ✅ | ✅ | ⚠️ | ✅ | ✅ | N/A | **PASS_WITH_WARNINGS** |
| 8 | setup-droplet.sh | ✅ | ⚠️ | ⚠️ | ❌ | ✅ | ⚠️ | **PASS_WITH_WARNINGS** |
| 9 | deploy.sh | ✅ | ✅ | ⚠️ | ⚠️ | ⚠️ | ⚠️ | **PASS_WITH_WARNINGS** |
| 10 | rotate-secrets.sh | ✅ | ✅ | ⚠️ | ❌ | ❌ | N/A | **PASS_WITH_WARNINGS** |
| 11 | backup-db.sh | ✅ | ✅ | ⚠️ | ❌ | ✅ | ⚠️ | **PASS_WITH_WARNINGS** |
| 12 | backend/.env.example | ✅ | ✅ | ⚠️ | ⚠️ | N/A | ✅ | **PASS_WITH_WARNINGS** |
| 13 | backend/.env.staging | ✅ | ✅ | ⚠️ | ⚠️ | N/A | ⚠️ | **PASS_WITH_WARNINGS** |

**Result summary:** 3 FAIL · 10 PASS_WITH_WARNINGS · 0 PASS

---

## SECTION 4 — REMAINING IMPLEMENTATION GAPS

Gaps are classified by severity:

### CRITICAL — Will prevent the system from functioning at all

| ID | Gap | Affects |
|---|---|---|
| GAP-C1 | `ci.yml` missing `on: workflow_call:` trigger | deploy-staging.yml, deploy-production.yml — both fail immediately |
| GAP-C2 | pm2 `env_file` not natively supported — app starts with missing env vars | ecosystem.config.js, deploy.sh, rotate-secrets.sh |
| GAP-C3 | Frontend never built or deployed — `hotel-crm-web` pm2 process has no binary to run | ecosystem.config.js, deploy-staging.yml, deploy-production.yml, deploy.sh |
| GAP-C4 | `postgresql-client` not installed on Droplet | rotate-secrets.sh (psql), backup-db.sh (pg_dump) |
| GAP-C5 | `awscli` not installed on Droplet | backup-db.sh |
| GAP-C6 | AWS credentials for DO Spaces not mapped for aws CLI (`AWS_ACCESS_KEY_ID` vs `DO_SPACES_KEY`) | backup-db.sh |

### HIGH — Will cause incorrect or insecure behaviour in production

| ID | Gap | Affects |
|---|---|---|
| GAP-H1 | Rate limiting zones use `$binary_remote_addr` behind Cloudflare — all clients share one bucket per PoP | nginx/hotelcrm.conf |
| GAP-H2 | UFW only opens 80/443 broadly with a manual-step comment — Cloudflare IP restriction not automated | setup-droplet.sh, security posture |
| GAP-H3 | `deploy-production.yml` health-check "rollback" restarts the broken code, not the previous version | deploy-production.yml |
| GAP-H4 | `deploy-production.yml` missing `permissions: contents: write` — tag push will fail on every production deploy | deploy-production.yml |
| GAP-H5 | `rotate-secrets.sh` purges all sessions even on access-token-only rotation — unnecessary forced re-login | rotate-secrets.sh |
| GAP-H6 | No pre-rotation backup of old secret values — rotation cannot be reversed | rotate-secrets.sh |
| GAP-H7 | NVM not in PATH for non-interactive SSH sessions — GitHub Actions Droplet deploys will fail | setup-droplet.sh, deploy-staging.yml, deploy-production.yml |
| GAP-H8 | No backup failure alerting — silently failing weekly backup is a GDPR compliance risk | backup-db.sh |

### MEDIUM — Gaps that reduce reliability or completeness vs the plan

| ID | Gap | Affects |
|---|---|---|
| GAP-M1 | CSP header absent from web frontend Nginx vhost | nginx/hotelcrm.conf |
| GAP-M2 | `ssl_ciphers` spec is outdated; does not follow Mozilla Intermediate profile | nginx/hotelcrm.conf |
| GAP-M3 | Docker Redis not started by any script after first provision | docker-compose.prod.yml, setup-droplet.sh |
| GAP-M4 | Cron job for backup-db.sh not installed by any artifact | backup-db.sh, setup-droplet.sh |
| GAP-M5 | `REDIS_PASSWORD` absent from .env.example and .env.staging as a standalone key | .env.example, .env.staging |
| GAP-M6 | `DO_SPACES_BUCKET_BACKUPS` variable undocumented in all env templates | backup-db.sh, .env.example, .env.staging |
| GAP-M7 | `FIREBASE_CREDENTIALS` vs `FIREBASE_PROJECT_ID` ambiguity — FCM Admin SDK likely requires full credential blob | .env.example |
| GAP-M8 | `appendonly yes` on Redis contradicts plan's non-critical ephemeral cache intent, adds disk overhead | docker-compose.prod.yml |
| GAP-M9 | fail2ban installed but not configured; no SSH jail enabled | setup-droplet.sh |
| GAP-M10 | pm2 startup command capture is fragile; `|| true` silently swallows pm2 boot persistence failure | setup-droplet.sh |
| GAP-M11 | Detached HEAD state on Droplet after `git checkout origin/develop` / `origin/main` | deploy-staging.yml, deploy-production.yml, deploy.sh |
| GAP-M12 | No backup verification (file size check, non-zero bytes) before upload | backup-db.sh |
| GAP-M13 | Cloudflare TTL "60s" inaccurate for Free plan proxied records (actual: ~300s) | cloudflare-checklist.md |
| GAP-M14 | No APNs key rotation script despite full 10-step procedure defined in PATCH-05 | Scripts (missing artifact) |
| GAP-M15 | `sleep 5` in deploy-staging.yml health check may be too short for cold Node.js start | deploy-staging.yml |

### LOW — Minor gaps and documentation inconsistencies

| ID | Gap | Affects |
|---|---|---|
| GAP-L1 | `API_VERSION=v1` in .env.example not in PATCH-06 Zod schema | .env.example |
| GAP-L2 | .env.staging comment about secrets on Droplet not operationally linked to any script | .env.staging |
| GAP-L3 | No `pm2-logrotate` installation step (referenced in PATCH_V2 Section 6 Phase 3) | setup-droplet.sh |
| GAP-L4 | No `staging-api.hotelcrm.app` server block in nginx/hotelcrm.conf (staging uses a separate Droplet — acceptable, but undocumented) | nginx/hotelcrm.conf |
| GAP-L5 | No monthly backup restore drill automation (PATCH_V2 Phase 4 checklist item) | Missing artifact |
| GAP-L6 | GDPR DataRetentionLog background job not covered by any deployment artifact | Missing artifact |

---

## SECTION 5 — ESTIMATED EFFORT TO PRODUCTION READINESS

### Tier 1 — CRITICAL blockers (must fix before first deployment attempt)

| Gap | Estimated Effort | Owner Skill |
|---|---|---|
| GAP-C1: Add `workflow_call` to ci.yml | 5 minutes | Junior |
| GAP-C2: Fix pm2 env loading (env_file or systemd EnvironmentFile or dotenv wrapper) | 2–4 hours | Mid-level |
| GAP-C3: Add frontend build/deploy to all deployment scripts and workflows | 3–5 hours | Mid-level |
| GAP-C4: Add postgresql-client to setup-droplet.sh | 5 minutes | Junior |
| GAP-C5: Add awscli to setup-droplet.sh | 10 minutes | Junior |
| GAP-C6: Map DO_SPACES_KEY → AWS_ACCESS_KEY_ID in backup-db.sh | 10 minutes | Junior |
| **Tier 1 total** | **~6–10 hours** | |

### Tier 2 — HIGH severity (fix before first production traffic)

| Gap | Estimated Effort | Owner Skill |
|---|---|---|
| GAP-H1: Add real_ip_module config to Nginx for Cloudflare IP pass-through | 30 minutes | Mid-level |
| GAP-H2: Automate Cloudflare IP allowlist in UFW (curl ips-v4 + ufw rules) | 1 hour | Mid-level |
| GAP-H3: Fix production health-check rollback (git checkout previous tag + rebuild) | 2 hours | Mid-level |
| GAP-H4: Add `permissions: contents: write` to deploy-production.yml | 5 minutes | Junior |
| GAP-H5: Fix rotate-secrets.sh session purge logic to be conditional on refresh rotation | 30 minutes | Junior |
| GAP-H6: Add pre-rotation secret backup in rotate-secrets.sh | 30 minutes | Junior |
| GAP-H7: Fix NVM for non-interactive SSH (switch to NodeSource apt or add to bash_profile) | 1–2 hours | Mid-level |
| GAP-H8: Add backup failure alerting (Slack webhook or email on cron failure) | 1–2 hours | Mid-level |
| **Tier 2 total** | **~7–10 hours** | |

### Tier 3 — MEDIUM gaps (fix during Week 3–4 hardening phase)

| Gap | Estimated Effort |
|---|---|
| GAP-M1: CSP for frontend vhost | 30 min |
| GAP-M2: Updated ssl_ciphers (Mozilla Intermediate) | 15 min |
| GAP-M3: Start Docker Redis in setup-droplet.sh | 10 min |
| GAP-M4: Install cron job in setup-droplet.sh | 15 min |
| GAP-M5/M6: Add REDIS_PASSWORD + DO_SPACES_BUCKET_BACKUPS to env templates | 10 min |
| GAP-M7: Clarify Firebase credential type, update .env.example | 1–2 hours |
| GAP-M8: Remove appendonly from docker-compose.prod.yml | 5 min |
| GAP-M9: Configure fail2ban SSH jail | 30 min |
| GAP-M10: Fix pm2 startup persistence | 30 min |
| GAP-M11: Use `git switch --detach` with explicit cleanup | 15 min |
| GAP-M12: Add backup verification step | 30 min |
| GAP-M13: Correct Cloudflare TTL note in checklist | 5 min |
| GAP-M14: Write rotate-apns.sh script | 1–2 hours |
| GAP-M15: Increase staging health check sleep to 15s | 5 min |
| **Tier 3 total** | **~6–8 hours** | |

### Tier 4 — LOW gaps (polish, Week 4)

| Gap | Estimated Effort |
|---|---|
| GAP-L1 through GAP-L6 | ~3–4 hours combined |

---

### Total Estimated Effort

| Tier | Effort | State |
|---|---|---|
| Tier 1 — Critical | 6–10 hours | **Blocks any deployment** |
| Tier 2 — High | 7–10 hours | **Blocks production traffic** |
| Tier 3 — Medium | 6–8 hours | Hardening phase |
| Tier 4 — Low | 3–4 hours | Polish |
| **Total to production-ready** | **~22–32 hours** | |

---

## SECTION 6 — FINAL ASSESSMENT

### Architecture compliance

All 13 artifacts correctly implement the **Droplet topology** (not App Platform), **Cloudflare ingress**, **Docker Redis on Droplet**, **two-secret JWT model**, and **APNS_PRIVATE_KEY_BASE64 pattern** as required by PATCH_V2. The plan decisions are faithfully translated into code and config. The architecture intent is sound.

### What is broken

The CI/CD pipeline is **non-functional as written**. The single missing `workflow_call` trigger in ci.yml means neither staging nor production can be deployed via GitHub Actions. The pm2 env_file issue means the application cannot securely receive its secrets on first start. The frontend deployment gap means only half the application stack would be deployed even after fixing the above.

### What is missing

Three system-level dependencies are absent from setup-droplet.sh (postgresql-client, awscli, pm2 startup robustness for non-interactive shells). Without these, weekly backups will never run, secret rotation will fail, and GitHub Actions deploys will likely fail with "command not found."

### What is ready

The configuration artifacts (Nginx, Docker Compose, env templates, Cloudflare checklist) are architecturally correct and require only targeted fixes rather than rewrites. The deployment scripts have correct structure and logic; their gaps are additive (missing steps) rather than fundamentally wrong. All security decisions from PATCH_V2 are correctly reflected.

### Production readiness verdict

> **NOT READY FOR DEPLOYMENT**  
> 6 critical gaps must be resolved before the first deployment attempt.  
> 8 high-severity gaps must be resolved before production traffic.  
> Estimated remediation: 22–32 hours of engineering work.
