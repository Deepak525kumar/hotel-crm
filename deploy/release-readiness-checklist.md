# Release Readiness Checklist — Hotel CRM MVP

Generated from the 2026-08-04 MVP audit and its follow-up verification pass. This checklist
covers the **operational** items confirmed by repository evidence — no code changes are
required for any item below; every referenced feature is already implemented and merged to
`main`. What remains is deployment configuration, decided and applied outside this repository
(on the EC2 host's `/etc/hotel-crm/.env` or AWS Secrets Manager — neither is visible from the
repo, so each box below must be checked against the real deployed environment, not this file).

---

## 1. Feature flags — enable/disable decision per environment

All five flags are **code-complete**. "Off" does not mean "unfinished"; it means "not yet
turned on for this environment." Decide per flag, per environment, then set it in the real
`/etc/hotel-crm/.env` (staging EC2) and production equivalent — `backend/.env.staging` in this
repo is a **placeholder template**, not the live config, and there is no `.env.production` file
in the repo by design (real secrets never get committed).

| Flag | Code status | Recommendation | Notes |
|---|---|---|---|
| `FEATURE_EMPLOYMENT_RECORD` | Complete | **Enable** | Already `true` in local dev. Gates `/employees` route mounting only; onboarding UI (PR #330) depends on it. |
| `FEATURE_RM_ROLE` | Complete | **Enable** | Enum + scope-claim issuance already shipped unconditionally (PR-2); this flag only gates the *read* path. Mobile apps already accept `regional_manager` in `ALLOWED_ROLES`. Safe to turn on. |
| `FEATURE_GD02_MATRIX` | Complete, most mature of the five (4 dedicated test files) | **Enable after running the M-2 backfill migration** on stored `User.permissions` — this is the one real prerequisite, and it's a data migration step, not missing code. |
| `FEATURE_JOBDISPATCH_PHASE1` | Complete but **vestigial** — reads nowhere in `backend/src` outside its own definition | **No action needed either way.** Its guarded changes (`WorkApplication` removal) already shipped unconditionally. Flipping this flag has zero effect. Candidate for deletion as pure cleanup, not a release blocker. |
| `FEATURE_JOBDISPATCH_PHASE2` | Complete (10-commit PR sequence, stable) | **Enable** | Gates `/assignments/calendar-entries` and `/job-requests/broadcasts`; frontend UI for calendar-entries already exists and depends on it. |

**Action for this task:** decision authored above; applying it to the real staging/production
environment is outside this repository's reach (no secrets committed here) and must be done by
whoever holds `/etc/hotel-crm/.env` access. This checklist entry stands in place of that step.

---

## 2. Push notification delivery — credential provisioning

**Code status: complete.** `ApnsProviderClient`/`FcmProviderClient` (`backend/src/modules/notifications/push-provider.ts`)
make real HTTP calls to Apple/Google; `resolvePushTransportHandler` (`outbox-transport.ts:418-487`)
wires them in automatically whenever credentials are present, exactly mirroring how the EMAIL
transport already behaves. `LoggingNoopTransportHandler` is only the *unconfigured-environment
fallback* — not "the" push handler. Device-token registration and deep-link tap-through are
fully implemented in both mobile apps.

**What's actually missing:** confirmation that these environment variables hold real values (not
the placeholders committed in `backend/.env.staging`) in every deployed environment:

- [ ] `APNS_PRIVATE_KEY_BASE64`, `APNS_KEY_ID`, `APNS_TEAM_ID`, `APNS_BUNDLE_ID` — staging
- [ ] `FIREBASE_PROJECT_ID` (+ service account credential) — staging
- [ ] Same four APNs vars + Firebase project — production
- [ ] Confirm bundle ID matches the actual App Store / Play Console app identifiers for each app (worker-app, checker-app)

**Why this matters more than a typical config gap:** most domain notification producers
(job dispatch, shift reminders, attendance, calendar, HR, consent) enqueue **PUSH-only** —
there is no EMAIL fallback for these types. If APNs/FCM credentials are absent in a real
deployment, those notifications silently degrade to "recorded in-app, never pushed to a device,"
with no error surfaced anywhere. Verify credentials are live before relying on push-driven
flows in production.

---

## 3. Frontend automated tests

**Status: not a Definition-of-Done requirement in this repository.** No constitution,
checklist, or module spec document mandates per-app test coverage; the absence of a frontend
test suite is a pre-existing, undocumented gap with no history of ever being required or
removed (confirmed via `git log`). Backend and both mobile apps have real, CI-blocking Jest
suites; frontend's CI job (`.github/workflows/ci.yml`) only runs typecheck/lint/build.

**Classification: Post-MVP.** Not a release blocker under any binding rule found in the repo.
If the team wants to raise the bar going forward, that is a new decision to make explicitly
(e.g. a new checklist entry or ADR) — not something this audit can retroactively treat as an
already-existing requirement.

---

## 4. Housekeeping (optional, non-blocking)

- [ ] Consider deleting the vestigial `FEATURE_JOBDISPATCH_PHASE1` flag and its dead `isJobDispatchPhase1Enabled()` accessor — zero behavioral effect either way, pure cleanup.
- [ ] Consider adding an APNs/FCM credential check to `deploy/aws-edge-checklist.md` or a deploy smoke test, since there is currently no automated way to detect "push silently degraded to no-op" in a live environment.

---

## Final sign-off

Once section 1's flag decisions are applied and section 2's push credentials are confirmed live
in the target environment, there is no remaining repository-evidenced reason to withhold
release. Section 3 is explicitly not a gate.
