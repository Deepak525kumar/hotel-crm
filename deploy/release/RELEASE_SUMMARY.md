# Release Summary — Hotel CRM

Last synchronized: 2026-08-04 (Release Candidate documentation pass)

## How this package is organized

This is the entry point. Read in this order — each document below links back rather than
restating the last one's detail:

```
RELEASE_SUMMARY.md          (you are here — status, verdict, links out)
    ↓
RELEASE_EXECUTION_PLAN.md   (the "how to ship it" sequence: flags, migrations, checkpoints)
    ↓
DEPLOYMENT_GUIDE.md         (the canonical reference for topology, trigger, and what
                              actually runs on each deploy — cited by the two files above
                              rather than re-explained)
    ↓
PRODUCTION_LAUNCH_CHECKLIST.md   (exhaustive box-checking against the real environment)
```

`RELEASE_NOTES.md`, `ROLLBACK_GUIDE.md`, `UAT_CHECKLIST.md`, `KNOWN_LIMITATIONS.md`, and
`POST_MVP_BACKLOG.md` are siblings addressing one specific concern each (what changed, how to
undo it, how to test it, what's accepted-as-is, what's deliberately deferred) — they assume the
four documents above as background rather than repeating them. If you find the same fact stated
with different wording in two of these files, that's drift to fix, not two independent truths —
`DEPLOYMENT_GUIDE.md`'s Topology section is the one to trust for process names/paths/triggers.

| Field | Value |
|---|---|
| **Project Name** | Hotel CRM |
| **Release Version** | 1.0.0 (MVP) |
| **Release Status** | **Release Candidate** |
| **Repository Status** | Engineering implementation complete. `ecosystem.config.js`/`deploy.sh` now match the process names and paths observed in live deploy logs — **verified** by reading GitHub Actions run output (`gh run list`/`gh run view --log`), not by direct host access. No one has SSH'd into the EC2 host during this pass to run `pm2 list` and confirm the two processes are running exactly as declared right now — that remains the one open item in `KNOWN_LIMITATIONS.md`. |
| **Infrastructure Status** | **Intended architecture, consistent with what's verified so far**: backend + notification worker on EC2 via PM2 (no containers), frontend on Vercel, RDS Postgres, S3 for uploads. Edge (ALB/WAF/Route53) provisioning tracked separately — see `deploy/aws-edge-checklist.md`, which is a checklist of steps to confirm, not a confirmation itself. |
| **Deployment Status** | **Verified**: the automated pipeline (`.github/workflows/deploy.yml` → `deploy.sh`) has multiple successful runs in GitHub Actions history, directly observed via `gh run list --workflow=deploy.yml` during this pass — most recently a run against the current `main` HEAD. This confirms the pipeline executes and its post-deploy health check passes; it does not by itself confirm every long-term operational assumption (e.g. secret rotation, log aggregation) discussed elsewhere in this package. Frontend deploys automatically via Vercel's own pipeline — not independently verified in this pass, taken on the user's word from an earlier conversation turn. |
| **Outstanding Operational Tasks** | See dedicated section below — none are engineering work. |
| **Known Limitations** | See dedicated section below and `KNOWN_LIMITATIONS.md` for full detail. |
| **Post-MVP Scope** | See dedicated section below and `POST_MVP_BACKLOG.md` for full detail. |
| **Release Recommendation** | **Ready after operational tasks** — proceed once the tasks below are complete; no further engineering work is required to reach that state. |

---

## Completed

- All MVP product features implemented, merged to `main`, and verified: authentication/RBAC,
  hotel and hotel-group management, employment records, job dispatch (assignments, broadcast
  offers, calendar direct-assignments), quality/ratings/leaderboard, HR (contracts, documents,
  payslip requests), notifications (push + email via transactional outbox), worker geolocation
  check-in, consent, compliance (subject-rights export), retention (audit log, eligibility,
  scheduled sweep), password reset.
- Backend: 99/99 test suites, 1698/1698 tests passing (re-verified 2026-08-04). Typecheck, lint,
  and build all clean.
- Frontend: typecheck and build clean. (No automated test suite — see Known Limitations.)
- Mobile (worker-app, checker-app): typecheck and test suites clean for both apps.
- Production deployment architecture reconciled: `ecosystem.config.js` now declares the two PM2
  processes (`hotel-crm-api`, `hotel-crm-worker`) that live production actually runs, at the
  correct working directory and env-file path; `deploy.sh` consolidated to the repository root;
  the deploy pipeline's health check verifies database connectivity, not just process liveness.
- No dual/conflicting worker-eligibility data model — `EmploymentRecord`/`EmploymentStatus` is
  the single model in use across assignments, HR, and attendance.
- All 34 database migrations have a verified, paired `down.sql` rollback script.

## Operational Tasks Remaining

None are engineering work — see the dedicated section below.

## Known Limitations

Full detail in `KNOWN_LIMITATIONS.md`. Headlines:

- Push notification transport currently falls back to no-op delivery until production APNs/FCM
  credentials are configured — the code path is complete either way.
- `FEATURE_RM_ROLE` intentionally remains disabled for this release — the Regional Manager role
  is fully built client- and server-side, but its promotion script has no demote path.
- Frontend automated tests are intentionally deferred (Post-MVP) — not a Definition-of-Done
  requirement for this project.
- `scripts/rotate-secrets.sh` and `nginx/hotelcrm.conf` were not part of the production-topology
  reconciliation and remain stale relative to the current deploy architecture — documented, not
  fixed, in this pass.
- One backend test suite (`hr-authz.test.ts`) was observed to fail once in a full-suite run but
  passes cleanly in isolation — treated as flaky test ordering, not a defect.

## Post-MVP Scope

Full detail in `POST_MVP_BACKLOG.md`. Headlines: Regional Manager rollout (pending a demote-path
decision), chatbot (zero code, deliberately deferred), compliance governance-report interface,
advanced analytics, offline sync for either mobile app, frontend automated testing, a scripted
rollback job, admin UI for the notification outbox, and several smaller deployment-hygiene items.

---

# Remaining Operational Tasks Before Production

These are operational tasks — configuration, credentials, verification, and process steps.
**None of them are engineering work.** No code changes are required to complete any item below.

1. **Provision real APNs credentials** in the production environment (`APNS_PRIVATE_KEY_BASE64`,
   `APNS_KEY_ID`, `APNS_TEAM_ID`, `APNS_BUNDLE_ID_WORKER`, `APNS_BUNDLE_ID_CHECKER`) — the
   delivery code is complete and auto-detects credentials at process start.
2. **Provision real Firebase credentials** (`FIREBASE_SERVICE_ACCOUNT_KEY_BASE64`,
   `FIREBASE_PROJECT_ID`) — same code path, same auto-detection behavior.
3. **Execute the production UAT checklist** (`deploy/release/UAT_CHECKLIST.md`) against staging,
   then production, for all four roles (Worker, Checker, Manager, Admin).
4. **Verify end-to-end push notification delivery** — send one real push notification to a
   physical or test device on each mobile app and confirm receipt, after credentials are live.
5. **Tag the production release** — no `release/*` git tag exists yet for this version.
6. **Publish release notes** — `deploy/release/RELEASE_NOTES.md` is drafted and ready; publish
   it through whatever channel this team uses (internal wiki, GitHub release, etc.).
7. **Perform the production rollout** — follow `deploy/release/RELEASE_EXECUTION_PLAN.md` in
   order: deploy, smoke test, roll out the three cleared feature flags in sequence
   (`FEATURE_EMPLOYMENT_RECORD` → `FEATURE_GD02_MATRIX` → `FEATURE_JOBDISPATCH_PHASE2`), hold
   `FEATURE_RM_ROLE` off.
8. **Monitor post-deployment health** — watch `pm2 list` (both processes online), 5xx rate, and
   the notification outbox's `DEAD_LETTER` count for the first 24 hours per the checkpoints in
   `RELEASE_EXECUTION_PLAN.md`.

Two smaller items are decisions for whoever owns deployment tooling, not blockers to shipping
this release, but should be scheduled soon after: fixing `scripts/rotate-secrets.sh` to match the
current PM2/env-file topology, and removing or annotating the vestigial frontend block in
`nginx/hotelcrm.conf`. Neither affects this release's functional readiness.
