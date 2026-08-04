# Deployment Guide — Hotel CRM MVP

Last synchronized 2026-08-04 (Release Candidate documentation pass). This guide describes how a
deploy actually executes today, verified against live production deploy logs and the current
repository state. For the decision-making behind sequencing and flag order, see
`RELEASE_EXECUTION_PLAN.md`. For the exhaustive box-checking list, see
`PRODUCTION_LAUNCH_CHECKLIST.md`.

> **History note.** An earlier pass through this repository found a real mismatch between the
> committed `ecosystem.config.js` (which declared three processes, including a PM2-managed
> frontend) and what live production deploy logs proved was actually running. That mismatch has
> since been resolved directly in the repository — `ecosystem.config.js` was rewritten to match
> production reality, and the deploy script was consolidated to the repository root. This guide
> reflects the current, reconciled state; it does not carry forward the earlier open question.

## Topology

| Component | Host | Process Manager |
|---|---|---|
| API | EC2 (`/home/ubuntu/apps/hotel-crm`) | PM2, app name `hotel-crm-api`, port 3001 |
| Outbox worker | EC2 (same host) | PM2, app name `hotel-crm-worker`, no HTTP port |
| Frontend | Vercel | Vercel's own deployment pipeline — not PM2, not EC2 |

`ecosystem.config.js` (repository root) declares exactly these two PM2 apps. Both are reloaded
together by `deploy.sh`'s `pm2 reload ecosystem.config.js` — there is no separate reload step per
process, and no PM2 entry for a frontend process, because the frontend does not run on this host.

**One vestigial artifact from before this reconciliation:** `nginx/hotelcrm.conf` still has a
server block proxying `hotelcrm.app`/`www.hotelcrm.app` to `127.0.0.1:3000`. Nothing in
`ecosystem.config.js` or `deploy.sh` runs anything on port 3000 today. This block was not touched
by the reconciliation and is not confirmed to still be in active use — treat it as a known,
undecided cleanup item (see `KNOWN_LIMITATIONS.md`), not as evidence that a frontend process
exists on this host.

**Also not yet reconciled:** `scripts/rotate-secrets.sh` still targets `/etc/hotel-crm/.env` and
reloads only `hotel-crm-api`. The running processes now load env from `backend/.env` (relative to
`cwd`), per `ecosystem.config.js`'s `node_args`. This script has not been updated to match and
should not be relied on for a real secret rotation until it is.

## Prerequisite: PM2 bootstrap (only if ever provisioning a genuinely new host)

If a host has never run `pm2 start` for this app, `pm2 reload <name-or-file>` will fail — reload
cannot start a process that doesn't exist yet. Confirm via `pm2 list` before assuming a bootstrap
is needed; running `pm2 start ecosystem.config.js` against a host that already has these
processes running under different, unexpected names would create duplicates rather than a clean
bootstrap. This is a first-provisioning step, not part of the normal deploy cycle.

## Trigger

`.github/workflows/deploy.yml` fires on a `workflow_run` completion of the CI workflow, filtered
to changes under `backend/**`, `deploy.sh`, root `package.json`/`package-lock.json`, or the
deploy workflow file itself. **Frontend-only or mobile-only changes do not trigger this
pipeline** — the frontend deploys automatically via Vercel's own GitHub integration, entirely
outside this repository's CI/CD tooling.

## What happens on trigger

1. GitHub Actions checks out the repo, starts an SSH agent with `secrets.EC2_SSH_KEY`, adds the
   host to `known_hosts`.
2. SSHes in as `secrets.EC2_USER`, `cd`s to `secrets.PROJECT_PATH`, exports `DEPLOY_SHA` to the
   triggering commit, and runs `./deploy.sh`.
3. `deploy.sh` (repository root):
   - `git fetch && git reset --hard origin/main` inside `/home/ubuntu/apps/hotel-crm`
   - `npm ci` at the repo root (skipped if `package-lock.json`/`backend/package.json` are
     unchanged since the previous deploy)
   - `cd backend && npx prisma generate && npx prisma migrate deploy` — schema migrations apply
     here, before anything restarts
   - `cd .. && npm run build` — builds both backend and frontend. The frontend build is used only as a validation step; deployment of the frontend is handled by Vercel.
   - `pm2 reload ecosystem.config.js --env production --update-env && pm2 save` — reloads both
     `hotel-crm-api` and `hotel-crm-worker` together
4. GitHub Actions runs its own verification step: SSHes in again and curls
   `http://localhost:3001/api/v1/health/ready` (checks DB connectivity, not just process
   liveness). A non-2xx response fails the Actions run, though it does **not** automatically roll
   anything back — see the Rollback Guide.

## Manual deploy (if ever needed outside CI)

```bash
ssh <user>@<host>
cd /home/ubuntu/apps/hotel-crm
export DEPLOY_SHA=<commit-sha>   # optional; omit to deploy latest main
./deploy.sh
curl -fsS http://localhost:3001/api/v1/health/ready
pm2 list   # confirm both hotel-crm-api and hotel-crm-worker show "online"
```

## Applying feature flags

Feature flags are environment variables, not code. To change one:

```bash
ssh <user>@<host>
sudo vim backend/.env      # relative to the app directory; file should be chmod 640
pm2 reload ecosystem.config.js --env production --update-env
```

No redeploy, rebuild, or migration is needed for a flag change alone. Apply flags in the order
given in `RELEASE_EXECUTION_PLAN.md` §2, verifying each before moving to the next.

## Applying push notification credentials

Same mechanism as feature flags — edit `backend/.env` on the host with real
`APNS_*`/`FIREBASE_*` values (see Production Launch Checklist's Environment Variables section for
the exact names, including the `APNS_BUNDLE_ID_WORKER`/`APNS_BUNDLE_ID_CHECKER` split), then
`pm2 reload ecosystem.config.js --env production --update-env`. The push transport auto-detects
configured providers at process start — no flag exists for this. Both processes reload together,
so `hotel-crm-worker` (which actually sends the notifications) picks up the new credentials at
the same time as the API process.

## Secrets

Real secrets never live in this repository. They live in `backend/.env` on the host (loaded via
PM2's `--env-file` node arg, per `ecosystem.config.js`'s current `node_args:
'--env-file=./backend/.env'`) or AWS Secrets Manager. `setup-ssm.sh` at the repo root is a
one-time bootstrap (IAM role/instance-profile attachment to a specific instance), not an ongoing
sync mechanism. `scripts/rotate-secrets.sh` still targets the old path (`/etc/hotel-crm/.env`)
and only reloads one of the two processes — it has not been updated to match the current
topology and should not be relied on until it is (see `KNOWN_LIMITATIONS.md`). Rotate manually
instead: edit `backend/.env` directly, then `pm2 reload ecosystem.config.js --env production
--update-env`.
