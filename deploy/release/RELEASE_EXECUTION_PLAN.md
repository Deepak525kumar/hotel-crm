# Release Execution Plan — Hotel CRM MVP

Last synchronized 2026-08-04 (Release Candidate documentation pass). Engineering implementation
is complete. The PM2 process topology (`ecosystem.config.js`), deploy script (`deploy.sh`), and
deploy pipeline (`.github/workflows/deploy.yml`) now agree with each other, and were rewritten to
match the process names and paths observed in live GitHub Actions deploy logs — **verified by
reading those logs during this pass** (`gh run list`/`gh run view --log`), not by direct EC2 host
access. No one has run `pm2 list` on the real host to confirm the two processes are actually
running under these exact names right now; that remains open (see `KNOWN_LIMITATIONS.md`). This
plan sequences deployment of code already merged to `main`, plus the operational configuration
(feature flags, push credentials) needed to turn on what's already built. No new features are
introduced by this plan.

---

## 1. Deployment sequence

**Backend + worker**: automated via `.github/workflows/deploy.yml` → `deploy.sh` (repository
root) on the EC2 host. Triggers on a `workflow_run` completion of CI, filtered to `backend/**`,
`deploy.sh`, root `package.json`/`package-lock.json`, or the deploy workflow file itself.

**Frontend**: deployed separately, on Vercel — not part of this EC2/PM2 pipeline. No repository
tooling automates this; it is managed directly through Vercel's own deployment flow (e.g. a
GitHub integration triggering on push to `main`, or manual promotion). See "Known gap" below for
one vestigial nginx artifact left over from an earlier PM2-hosted-frontend design that no longer
applies.

**Mobile**: app store submission for both Expo apps, entirely outside this repository's deploy
tooling.

Sequence for this release:

1. **Pre-flight** — confirm `main` is the intended commit; confirm CI is green (backend
   lint/typecheck/build/`prisma migrate deploy` (dry, against CI's ephemeral Postgres)/test;
   frontend lint/typecheck/build; mobile typecheck/test for both apps). As of this pass: backend
   99/99 suites, 1698/1698 tests pass; both mobile apps' typecheck and test suites pass; frontend
   typecheck and build pass.
2. **Backend deploy** (automated, `deploy.yml` → `deploy.sh` on the EC2 host):
   - `git fetch && git reset --hard origin/main` inside `/home/ubuntu/apps/hotel-crm`
   - `npm ci` at the repo root (skipped if `package-lock.json`/`backend/package.json` are
     unchanged since the previous deploy)
   - `cd backend && prisma generate && prisma migrate deploy` — schema migrations apply here,
     before any process restart
   - `cd .. && npm run build` — builds both backend and frontend. The frontend build is used only as a validation step; deployment of the frontend is handled by Vercel.
   - `pm2 reload ecosystem.config.js --env production --update-env && pm2 save` — reloads
     **both** declared PM2 apps (`hotel-crm-api`, `hotel-crm-worker`) together, in one call
3. **Deploy verification** (automated, `deploy.yml`): `curl -fsS http://localhost:3001/api/v1/health/ready`
   — checks database connectivity via `SELECT 1`, not just process liveness.
4. **Manual smoke tests** (§5 below) — run immediately after step 3 passes, before any feature
   flag is flipped.
5. **Feature flag rollout** (§2 below) — staged, not all-at-once.
6. **Push credential confirmation** (§4 below) — verify before relying on any push-driven flow.
7. **UAT** (`deploy/release/UAT_CHECKLIST.md`) — run against staging first, then production,
   before declaring the release complete.

---

## 2. Feature flag rollout order

All flags are read at process start (`backend/src/config/env.ts`); changing one requires an
`--update-env` PM2 reload, not a fresh deploy.

**Enable in this order, verifying each before the next:**

| Order | Flag | Why this position | Prerequisite | Reversible? |
|---|---|---|---|---|
| 1 | `FEATURE_EMPLOYMENT_RECORD` | Fully independent, additive, no prerequisites. | Migration `20260722_epic5_pr56_employment_record` applied (automatic via `prisma migrate deploy`). | Yes — routes 404 when off; existing `EmploymentRecord` rows are simply unreachable via API, not corrupted. |
| 2 | `FEATURE_GD02_MATRIX` | Most mature of the flags (4 dedicated test files); its formerly-documented "M-2 backfill" prerequisite is **retired** — `User.permissions` was already dropped by migration `20260727010000_drop_user_permissions`, and permissions are now derived at request time from role. Nothing to backfill. | None remaining. | Yes — reverting swaps back to legacy permission tokens; no data was written under the new path. |
| 3 | `FEATURE_JOBDISPATCH_PHASE2` | Independent, additive. No current frontend/mobile client code assumes it's already on. | None. | Yes — routes 404 when off; existing `CalendarEntry`/broadcast rows become unreachable, not corrupted. |
| — | `FEATURE_JOBDISPATCH_PHASE1` | **No action needed.** Confirmed vestigial: its guarded change (`WorkApplication` removal) already shipped unconditionally in a prior migration; the flag itself is read nowhere in `backend/src` outside its own definition. Flipping it has zero effect. | N/A | N/A |
| **HOLD** | `FEATURE_RM_ROLE` | **Do not enable in this release.** Code is complete server- and client-side — frontend (`RoleGate.tsx`, `SidebarNav.tsx`, `types.ts`, `RoleBadge.tsx`) and both mobile apps already handle `regional_manager` deliberately and correctly, per ADR-030 PR-3, which has shipped. The real blocker is narrower: `backend/src/scripts/run-regional-manager-promotion.ts` mutates `User.role` directly with **no corresponding demote script** anywhere in the repo. Once a manager is promoted, disabling the flag afterward does not revert the promotion. | None missing from the client side. The only open item is a risk decision: is a one-way, unscripted role promotion acceptable for this release, or does a demote path need to exist first? | **No** — the promotion script's effect is not undone by disabling the flag. This is the one flag held back, and it's a deliberate risk decision, not a code gap. |

**Rationale for staging one-at-a-time rather than all at once:** each flag's blast radius is
independent (no cross-flag reads found in `middleware/permissions.ts` or elsewhere), so there is
no technical requirement to batch them — but staggering isolates which flag caused an issue if
one appears.

---

## 3. Migration order

`prisma migrate deploy` applies all pending migrations in filename-timestamp order automatically.
Confirmed via `deploy.sh`: migrations run as their own step, between `prisma generate` and
`npm run build`, **before** any PM2 reload — so the running processes never see a schema newer
than what they're about to load.

Two migrations are called out because they are the riskiest in the current set and both have
verified `down.sql` rollback scripts (enforced by `.github/workflows/migration-harness.yml`;
confirmed via `bash scripts/migrate-harness.sh check-pairs`, all 34 migrations paired):

- `20260722_epic5_pr56_employment_record/down.sql` — drops the additive tables/enums; idempotent,
  cleanly reversible.
- `20260727010000_drop_user_permissions/down.sql` — restores from a pre-drop backup table
  (`_User_permissions_backup_20260727`); explicitly documented as **not reversible for
  permission changes made after the drop**. Not a concern for this release since nothing writes
  to a dropped column.

No manual SQL, no out-of-band data migration, and no maintenance-window requirement is indicated
by anything in the migrations directory for this release.

---

## 4. Environment configuration

Real secrets are **not** in this repository. The authoritative source is `backend/.env` on the
EC2 host, loaded via PM2's `node_args: '--env-file=./backend/.env'` (relative to
`cwd: /home/ubuntu/apps/hotel-crm`, i.e. resolving to `/home/ubuntu/apps/hotel-crm/backend/.env`)
— **not** `/etc/hotel-crm/.env`, which was the path used before the production-architecture
reconciliation and is now stale (see "Known gap" below).

**Feature flags** (see §2 for values/order):
- [ ] `FEATURE_EMPLOYMENT_RECORD=true`
- [ ] `FEATURE_GD02_MATRIX=true`
- [ ] `FEATURE_JOBDISPATCH_PHASE2=true`
- [ ] `FEATURE_RM_ROLE` — leave `false`/unset. Do not enable this release.
- [ ] `FEATURE_JOBDISPATCH_PHASE1` — irrelevant, leave as-is.

**Push notifications** (code is complete; these are the credentials that make delivery real
rather than a silent no-op fallback):
- [ ] `APNS_PRIVATE_KEY_BASE64`, `APNS_KEY_ID`, `APNS_TEAM_ID` — real values, not placeholders
- [ ] `APNS_BUNDLE_ID_WORKER=com.hotelcrm.workerapp`, `APNS_BUNDLE_ID_CHECKER=com.hotelcrm.checkerapp`
- [ ] `FIREBASE_SERVICE_ACCOUNT_KEY_BASE64`, `FIREBASE_PROJECT_ID` — real values
- [ ] Apple Developer account + bundle ID registrations for both apps are current (pure
      operational reminder, no code exists to track this)

**Other:**
- [ ] `DATABASE_URL` points at the real production RDS endpoint
- [ ] `JWT_SECRET`/`JWT_REFRESH_SECRET` are real, non-placeholder, environment-specific values
- [ ] `SENDGRID_API_KEY` (or equivalent) real value — EMAIL is the only channel for password reset
- [ ] `SENTRY_DSN` set if delivery-failure visibility via Sentry is wanted — note (§6) that even
      when set, push-delivery failures do not currently call `captureException`; Sentry receives
      only uncaught worker-process exceptions today, not per-notification failures.

---

## 5. Smoke tests (run immediately post-deploy, before flag rollout)

1. `GET /api/v1/health/ready` → 200, confirms DB connectivity.
2. Login as one seeded user per role (worker, checker, manager, admin) → confirm `POST /auth/login`
   returns a token and `GET /auth/me` reflects the right role.
3. Worker: open the mobile app, confirm dashboard (`GET /analytics/my-stats`) loads.
4. Manager (web): load the hotels list (`GET /crm/hotels`) and one hotel detail page.
5. Checker: open the attendance queue (`GET /attendance?is_verified=false`), confirm it loads
   (even if empty).
6. `pm2 list` on the host — confirm both `hotel-crm-api` and `hotel-crm-worker` show `online`,
   not `errored`, with a sane uptime.
7. Trigger one real notification-producing action (e.g. mark an absence) and confirm a
   `Notification` row is created (`GET /notifications` for that user), then confirm its outbox
   row transitions out of `PENDING` via the outbox-admin metrics API — this confirms
   `hotel-crm-worker` is actually draining the queue, not just running.

## Verification checkpoints (gate before proceeding to the next stage)

- **Checkpoint A** (after backend deploy, before flag rollout): smoke tests 1–2 pass; both PM2
  processes online.
- **Checkpoint B** (after each flag flip): the specific new capability works for the intended
  role; no new 5xx rate increase for at least one full business-hours window.
- **Checkpoint C** (after push credentials confirmed): send one real push notification to a test
  device on each mobile app (worker, checker) and confirm receipt.
- **Checkpoint D** (before declaring release complete): full UAT checklist
  (`deploy/release/UAT_CHECKLIST.md`) passes for all four roles.

---

## 6. Rollback strategy

**Application code:** no scripted rollback job exists in `deploy.yml` today. The manual recovery
path: SSH to the host, `git checkout <previous-sha>`, re-run `./deploy.sh`. Adding a scripted
rollback job is a legitimate future improvement, tracked in `POST_MVP_BACKLOG.md`, not built here.

**Database:** every migration has a paired, CI-checked `down.sql`. Follow
`docs/11-deployment/ci-cd/MIGRATION_ROLLBACK_HARNESS.md`'s documented procedure exactly — do not
improvise SQL by hand given the one explicitly-irreversible migration in the recent set
(`20260727010000_drop_user_permissions`, reversible for schema but not for post-drop data).

**Feature flags:** the cheapest rollback — flip the flag back to `false` in `backend/.env` (on
the host) and `pm2 reload ecosystem.config.js --env production --update-env`. Confirmed safe for
`FEATURE_EMPLOYMENT_RECORD`, `FEATURE_GD02_MATRIX`, `FEATURE_JOBDISPATCH_PHASE2`. **Do not treat
`FEATURE_RM_ROLE` this way if it is ever enabled** — its promotion script's effect on `User.role`
is not undone by disabling the flag.

**Push notifications:** no rollback needed — credentials are additive; removing them reverts to
the existing no-op fallback behavior.

---

## 7. Fixes applied this release

1. **Deploy pipeline health check** — `.github/workflows/deploy.yml`'s post-deploy verification
   now targets `/api/v1/health/ready` (checks DB connectivity via `SELECT 1`), not just
   `/api/v1/health` (process-liveness only).
2. **Stale APNs bundle-ID environment variable names** — `backend/.env.example`,
   `backend/.env.staging`, `scripts/setup-ec2.sh`'s provisioning template, and
   `.github/workflows/ci.yml`'s test-job environment all referenced the retired single
   `APNS_BUNDLE_ID` variable; the code has read the split `APNS_BUNDLE_ID_WORKER` /
   `APNS_BUNDLE_ID_CHECKER` since push notifications were split per mobile app. All four fixed.
3. **PM2 process topology reconciled with production reality** — `ecosystem.config.js` now
   declares exactly the two processes (`hotel-crm-api`, `hotel-crm-worker`) that live production
   actually runs, at the correct `cwd` and env-file path. `deploy.sh` (now living at the
   repository root; the previous `scripts/deploy.sh` was removed as redundant) reloads both
   together via `pm2 reload ecosystem.config.js`. This resolves what was previously an open,
   unconfirmed risk in this plan.

