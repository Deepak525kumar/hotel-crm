# Known Limitations — Hotel CRM MVP

Last synchronized 2026-08-04 (Release Candidate documentation pass). Confirmed via repository
evidence. None of these block this release — they are documented so they are known-accepted, not
silently discovered later.

## Product / functional

- **`FEATURE_RM_ROLE` is not load-bearing for Regional Manager authorization** and should not be
  read as an "RM disabled" switch — a prior version of this note claimed RM was "built but disabled"
  behind this flag; that was inaccurate even before the lifecycle work below shipped. No middleware,
  route, service, or token-issuance path reads `FEATURE_RM_ROLE` (verified by repository-wide search,
  PR #338); it gates only the M-3 bulk-promotion script's rollout ordering. An admin has always been
  able to create or promote a live, fully-authorized `regional_manager` user with the flag off, via
  `POST /users` or `PUT /users/:id/role`. Consider retiring the flag or making it genuinely
  load-bearing — the current middle state (real but unflagged behavior, a flag that gates nothing it
  claims to) is itself a minor operational hazard, not a safety net.
- **Regional Manager lifecycle (promote/assign/transfer/demote) is fully built**, including a demote
  path (`backend/src/scripts/regional-manager-demotion.ts` + `npm run rm-role:demote`) that a prior
  version of this note said was missing — that gap is closed (PR #339). One hotel group per RM is a
  DB-enforced invariant (`HotelGroup.regional_manager_user_id` is `@unique`); demoting an RM who
  still owns a group is rejected until the group is transferred to a successor
  (`updateUserRole`/`ConflictError`, Regional Manager V1 Decision 11). Both the promotion→demotion
  check-then-act sequence and the group-transfer path are transaction-locked against each other
  (`SELECT ... FOR UPDATE`, consistent lock order) to close a TOCTOU race an earlier review round
  found and fixed before merge — see PR #339's review history for the race analysis.
- **Push notifications degrade silently if credentials are absent or a delivery fails.** Most
  notification types (job dispatch, shift reminders, attendance, calendar, HR, consent) are
  PUSH-only with no EMAIL fallback. If push is unconfigured, the only signal is a WARN-level log
  line — no metric, no Sentry event, no admin UI. The in-app notification row is still created,
  so nothing is lost, but a user who doesn't open the app promptly may miss a time-sensitive
  alert with no automated escalation.
- **Retention audit-log/eligibility routes have no role gate today** — flagged as a UAT test
  case, not confirmed as exploited or fixed in this release, since no reproduction was performed
  and fixing an access-control gap without confirming its real behavior would risk an incorrect
  fix.
- **Worker ratings screen may call a manager-gated analytics endpoint** — flagged as a UAT test
  case (see `UAT_CHECKLIST.md`, item W20), not confirmed as broken.
- **`getDocumentCompleteness`'s `is_work_permit` toggle is a UI-only workaround**, not a real
  per-worker backend field — documented in the component's own code comment. Two different
  viewers can see different "complete" verdicts for the same worker. Accepted, by design, until
  a real backend field exists.
- **HR payslip fulfillment sub-feature is still marked deferred in code comments** — the bulk of
  `backend/src/modules/hr/service.ts` is implemented and tested (contract lifecycle, scan/confirm,
  extend/lapse), but its own header comment still frames part of the payslip flow as "until PR 4."
  Confirm this is actually resolved before relying on payslip fulfillment in production — this is
  a documentation-vs-code discrepancy worth a direct check, not asserted as fixed or broken here.

## Deployment / infrastructure

- **`scripts/rotate-secrets.sh` targets a stale env-file path and misses one process.** It edits
  `/etc/hotel-crm/.env`, but the running processes now load env from `backend/.env` (relative to
  `cwd`) per `ecosystem.config.js`'s current `node_args`. It also reloads only `hotel-crm-api`,
  leaving `hotel-crm-worker` on stale secrets after a rotation. Treat this script as
  non-functional until it's updated to match the current topology — do not rely on it for a real
  secret rotation without first fixing it.
- **`nginx/hotelcrm.conf` still proxies the bare domain to a port-3000 frontend process that
  doesn't exist in this stack.** The frontend is deployed separately on Vercel; nothing in
  `ecosystem.config.js` or `deploy.sh` runs anything on port 3000. This nginx server block is
  vestigial, left over from an earlier PM2-hosted-frontend design. Not removed in this pass
  (config decision, not a documentation fix) — flagged so it isn't mistaken for a live path.
- **Frontend and mobile deploys are not automated by this repository's CI/CD.** The frontend
  deploys via Vercel's own pipeline (outside this repo's tooling); mobile ships via app store
  submission. `.github/workflows/deploy.yml` only ever covered the backend.
- **No scripted rollback job exists.** Rollback (code, migration, or flag) is a manual procedure
  — see `ROLLBACK_GUIDE.md`.
- **No Redis readiness check.** `/api/v1/health/ready` checks Postgres only; Redis being down
  would not be caught by the deploy pipeline's verification step.
- **No log aggregation is configured.** PM2 writes to local files on the host
  (`/home/ubuntu/.pm2/logs/*.log`); there is no shipping to CloudWatch Logs or an equivalent,
  unless set up outside this repository.
- **No automated Secrets Manager → EC2 sync.** `setup-ssm.sh` is a one-time IAM bootstrap. Ongoing
  secret changes are manual edits to `backend/.env` on the host, or via `rotate-secrets.sh` once
  that script is fixed (see above).
- **`scripts/setup-ec2.sh` (new-host provisioning) still disagrees with the reconciled
  `deploy.sh`/`ecosystem.config.js` on directory, user, and secrets path.** It provisions
  `/opt/hotel-crm` under a `deploy` user with secrets at `/etc/hotel-crm/.env`; the reconciled
  deploy tooling uses `/home/ubuntu/apps/hotel-crm` and `backend/.env`. This was not part of the
  production-topology reconciliation (which fixed `ecosystem.config.js` and `deploy.sh`, not the
  provisioning script). If a new host is ever provisioned from `setup-ec2.sh` as currently
  written, its output will not match what `deploy.sh` and the `PROJECT_PATH`/`EC2_USER` secrets
  expect — confirm and reconcile before relying on it for a real provisioning run.
- **No admin UI for the notification outbox.** The `outbox-admin` API (metrics, dead-letter list,
  requeue/discard) exists and is role-gated to admin, but nothing in the frontend consumes it —
  it's reachable only via direct authenticated API call today.
- **Sentry, if configured, does not receive push-delivery failures.** It's wired only into the
  worker process's uncaught-exception handlers. Per-notification send failures are logged, not
  forwarded to Sentry, regardless of `SENTRY_DSN` being set.
- **No documented APNs/Apple Developer account expiry tracking.** P8 keys don't expire, but the
  associated bundle ID/Developer account configuration can lapse; no calendar reminder or
  automated check exists for this anywhere in the repository.

## Testing

- **Frontend has zero automated test coverage** (no test script, no test files, ever). Confirmed
  not a documented Definition-of-Done requirement for this project — a legitimate gap to close in
  the future, not a release blocker.
- **One backend test suite (`hr-authz.test.ts`) has been observed to fail in a full-suite run,
  but passes cleanly when run in isolation.** This reads as test-ordering flakiness rather than a
  real defect — the full suite has otherwise run clean (99/99 suites, 1698/1698 tests) multiple
  times in this pass. Worth a follow-up to find and fix the shared-state leak, not treated as a
  release blocker here since the underlying code path is exercised correctly in isolation.

## Documentation

- **The `.claude/CLAUDE.md` "AI Engineering Platform Bootloader"** references `constitution/`,
  `workflows/`, `agents/`, `knowledge/`, `governance/`, `VERSION.yaml` directories/files at the
  repository root. Most of these do not exist at the root. However — correcting an earlier
  version of this document, which claimed the whole framework was aspirational — a real,
  populated knowledge and governance layer exists under `.claude/knowledge/` (including
  `MODULE_REGISTRY.yaml`, current as of this pass) and `.claude/governance/`
  (`SPECIFICATION_ISSUES_REGISTER.md`). Some of the bootloader's references are dead; others
  point to a real, current layer one directory over from where the bootloader names it.
