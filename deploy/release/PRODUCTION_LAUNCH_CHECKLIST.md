# Production Launch Checklist — Hotel CRM MVP

Last synchronized 2026-08-04 (Release Candidate documentation pass). Companion to
`RELEASE_EXECUTION_PLAN.md`. Check every box against the real deployed environment.

---

## Infrastructure

- [ ] EC2 instance provisioned at `/home/ubuntu/apps/hotel-crm`, security group allows 3001 only
      from trusted sources (per `deploy/aws-edge-checklist.md` §6) or is otherwise not directly
      internet-exposed
- [ ] ALB + ACM certificate issued and attached (or Nginx+Let's Encrypt for the no-ALB path) for
      the backend API domain
- [ ] AWS WAF web ACL attached with managed rule groups + rate-based rules
      (`deploy/aws-edge-checklist.md` §4–5)
- [ ] Route53/DNS records point at the correct target (`deploy/aws-edge-checklist.md` §2)
- [ ] Redis reachable from the API/worker processes (`REDIS_URL` correct;
      `docker-compose.prod.yml`'s Redis container running if that's the chosen path — confirmed
      **not** wired into `deploy.sh`/CI, so this is started/managed independently of the app
      deploy)
- [ ] **Run `pm2 list` on the real host and confirm `hotel-crm-api` and `hotel-crm-worker` are
      both online and stable.** This matches `ecosystem.config.js` as currently committed — the
      frontend is hosted separately on Vercel and is not managed by PM2 at all.
- [ ] Deploy directory on the host matches `deploy.sh`'s `PROJECT_DIR`
      (`/home/ubuntu/apps/hotel-crm`, confirmed correct against live deploy logs)
- [ ] **Known gap, not a blocker:** `nginx/hotelcrm.conf` still has a server block proxying the
      bare domain to `127.0.0.1:3000` — nothing runs there in the current PM2 topology (the
      frontend is on Vercel). Confirm this block is either removed or genuinely inert before
      assuming nginx config matches reality.

## Database

- [ ] `DATABASE_URL` in `backend/.env` (on the host) points at the real RDS endpoint,
      `sslmode=require`
- [ ] Confirm current migration state matches `backend/prisma/migrations/` (34 migrations as of
      this release) — `npx prisma migrate status` on the host, not assumed from the repo
- [ ] Backup schedule confirmed running (`scripts/backup-db.sh`, per its own cron comment:
      `0 3 * * 0`, weekly) — verify the cron entry actually exists on the host, this repo only
      contains the script
- [ ] `S3_BUCKET_BACKUPS` exists and is reachable if backups upload there

## Environment variables

- [ ] All vars in `backend/.env.example` have a real counterpart in `backend/.env` **on the
      host** — not `/etc/hotel-crm/.env`, which was the path used before the production-
      architecture reconciliation and is no longer where the running processes actually load
      from (`ecosystem.config.js`'s `node_args` now points at `./backend/.env`, relative to
      `cwd`). `.env.staging` in this repo is a placeholder template only, never read in
      production.
- [ ] `NODE_ENV=production`
- [ ] `JWT_SECRET`/`JWT_REFRESH_SECRET` are real, unique, non-placeholder values
- [ ] `CORS_ORIGIN`/`FRONTEND_URL` match the real deployed Vercel frontend domain
- [ ] `APNS_BUNDLE_ID_WORKER` / `APNS_BUNDLE_ID_CHECKER` — confirm the real env file uses these
      two variable names, not the retired `APNS_BUNDLE_ID`

## Feature flags

- [ ] **All 5 feature flags below use a canonical boolean value: `true`, `false`, `1`, or `0`.**
      As of the release-readiness fix (`env.ts#strictBooleanFlag`), any other spelling —
      `TRUE`, `False`, `yes`, `no`, `on`, `off`, or anything not in that exact set —
      now **fails application startup** with a validation error, rather than being silently
      miscoerced the way `z.coerce.boolean()` previously treated any non-empty string
      (including the literal string `"false"`) as `true`. Check every environment's actual
      `.env` file for the literal values, not just that a flag "looks set" — this is a real
      behavior change from the previous release, not merely a hardening note.
- [ ] `FEATURE_EMPLOYMENT_RECORD=true`
- [ ] `FEATURE_GD02_MATRIX=true`
- [ ] `FEATURE_JOBDISPATCH_PHASE2=true`
- [ ] `FEATURE_RM_ROLE` — confirmed **not** set to `true`. Do not enable this release (see
      Release Execution Plan §2 for why).
- [ ] `FEATURE_JOBDISPATCH_PHASE1` — no action; vestigial.
- [ ] Flags applied via `backend/.env` on the host, reloaded with
      `pm2 reload ecosystem.config.js --env production --update-env`

## Migrations

- [ ] `prisma migrate deploy` runs as part of `deploy.sh`, before the PM2 reload step — confirmed
      already correctly sequenced, no change needed
- [ ] `down.sql` exists for every migration (confirmed this pass — `check-pairs` reports all 34
      paired; enforced by `migration-harness.yml` in CI)
- [ ] No manual/out-of-band migration is required for this release (confirmed — the previously
      assumed GD02 "M-2 backfill" script is retired; `User.permissions` was already dropped)

## Secrets

- [ ] `backend/.env` on the host has permissions `640` or tighter
- [ ] `EC2_SSH_KEY`, `EC2_HOST`, `EC2_USER`, `PROJECT_PATH` GitHub Actions secrets are set and
      `PROJECT_PATH` matches `/home/ubuntu/apps/hotel-crm`
- [ ] **Do not rely on `scripts/rotate-secrets.sh` for a real rotation yet.** It targets
      `/etc/hotel-crm/.env` — a path no longer read by the running processes — and reloads only
      `hotel-crm-api`, missing `hotel-crm-worker`. Rotate manually (edit `backend/.env` on the
      host, then `pm2 reload ecosystem.config.js --env production --update-env`) until this
      script is updated to match the current topology.
- [ ] No real secret values exist anywhere in this git repository (spot-check: `git log -p --all
      -- backend/.env` should show no non-placeholder value ever committed to `.env`,
      `.env.staging`, or `.env.example`)

## CI/CD

- [ ] `.github/workflows/ci.yml` green on the release commit (backend test suite against live
      Postgres — currently 99/99 suites, 1698/1698 tests passing; frontend build/lint/typecheck;
      mobile typecheck+test for both apps)
- [ ] `.github/workflows/deploy.yml` — backend-only deploy pipeline, correctly referencing the
      root `deploy.sh` (the previous `scripts/deploy.sh` has been removed as redundant). Frontend
      deploys are automated separately by Vercel, not by this pipeline.
- [ ] `.github/workflows/migration-harness.yml` green (down.sql presence/validity check)

## Smoke tests

See `RELEASE_EXECUTION_PLAN.md` §5 for the full list. Minimum bar before declaring the deploy
successful:
- [ ] `/api/v1/health/ready` returns 200
- [ ] One login succeeds per role (worker, checker, manager, admin)
- [ ] Both `hotel-crm-api` and `hotel-crm-worker` are `online` in `pm2 list`, not crash-looping
- [ ] At least one notification-producing action creates a visible in-app `Notification` row,
      **and** its outbox row is confirmed to leave `PENDING` state via the outbox-admin metrics
      API — do not rely on the in-app row alone, since that's written before the worker ever runs

## Health checks

- [ ] `GET /api/v1/health` (liveness) — 200, unconditional
- [ ] `GET /api/v1/health/ready` (readiness) — 200, checks DB via `SELECT 1`; this is the deploy
      pipeline's verification target
- [ ] No equivalent Redis readiness check exists (`backend/src/lib/health.ts` checks DB only) —
      known gap, not blocking, tracked in Known Limitations

## Monitoring

- [ ] `SENTRY_DSN` set if desired — currently wired only into the worker process's
      `uncaughtException`/`unhandledRejection` handlers, **not** into per-notification
      push-delivery failures (those only produce `logger.warn`). Don't assume Sentry will alert
      on silent push failures.
- [ ] CloudWatch ALB metrics + 5xx/unhealthy-target alarm configured
      (`deploy/aws-edge-checklist.md` §8)
- [ ] WAF logging to CloudWatch/S3 enabled
- [ ] PM2 logs (`/home/ubuntu/.pm2/logs/*.log`) are shipped somewhere durable/searchable — no log
      aggregation is configured in this repo; confirm this is handled operationally or accept the
      gap for this release
- [ ] Decide who periodically checks the notification outbox admin API
      (`GET /notifications/outbox/metrics`, dead-letter list) — no automated alert or frontend UI
      exists for this today

## Rollback

- [ ] Whoever is on-call for this release knows the manual rollback procedure (SSH,
      `git checkout <previous-sha>`, re-run `deploy.sh`) — no scripted rollback job exists
- [ ] Migration rollback procedure (`docs/11-deployment/ci-cd/MIGRATION_ROLLBACK_HARNESS.md`) has
      been read by whoever might need to execute it, before it's needed under pressure
- [ ] Feature-flag rollback (flip to `false`, reload) understood as the fast path for
      flag-related issues, before reaching for a code rollback

## Post-deployment verification

- [ ] Checkpoints A–D from `RELEASE_EXECUTION_PLAN.md` §"Verification checkpoints" all passed
- [ ] Full UAT checklist (`deploy/release/UAT_CHECKLIST.md`) executed against production (or
      staging with equivalent config) for all four roles
- [ ] One real push notification confirmed received on a physical/test device for each mobile app
- [ ] No unexpected spike in 5xx rate or worker `DEAD_LETTER` count in the first 24 hours
