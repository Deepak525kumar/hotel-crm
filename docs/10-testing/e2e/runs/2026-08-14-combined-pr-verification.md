# E2E Run — 2026-08-14 — combined verification of PR #455 / #459 / #458

- **Commit under test:** `b47d2f5` — `origin/main` (with #455 already merged as `2897393`)
  plus `claude/scheduling-integrity-fixes` (#459) plus `fix/system-wide-bug-sweep` (#458),
  merged locally. All three merge cleanly, individually and together (0 conflicts).
- **Environment:** local dev, **no Docker** — the daemon is unavailable in this container, so
  Postgres 16 and Redis were run natively. Substituting for `docker compose up` is a
  deviation from scenario 00 §1 and is recorded here rather than glossed.
- **Executed by:** Claude Opus 5 (Claude Code)
- **Stack versions:** backend on Node 22.22, Postgres 16.13, Redis (native)

## Flag states (scenario 00 asks these be recorded)

| Flag | State | Note |
|---|---|---|
| `FEATURE_EMPLOYMENT_RECORD` | `true` | required, confirmed by live request |
| `FEATURE_JOBDISPATCH_PHASE2` | **off by default** | had to be enabled mid-run — see gap 1 |
| `FEATURE_JOBDISPATCH_PHASE1` | off by default | enabled alongside Phase 2 |
| `FEATURE_RM_ROLE` | absent | |

## Results

| Scenario | Result | Notes |
|---|---|---|
| 00 Environment | **FAIL** | Stack came up and migrations applied, but the fresh-DB drift check does not report "No difference detected" — see defect 1. Pre-existing on `main`; run continued deliberately. |
| 01 Onboarding happy path | **PASS** (with doc-upload gap) | Gate behaves per ADR-065 end to end. |
| 02 Manager/RM onboarding | **PARTIAL** | RM lifecycle exercised; manager/worker/checker chain not completed — see gap 2. |
| 03 Authorization isolation | **NOT RUN** | out of budget this pass |
| 04 Document upload → S3 | **NOT RUN** | no AWS credentials in this container. Documents were seeded via Prisma; the real upload path was **not** exercised. Recorded as a gap, not a pass. |
| 05 Race conditions | **NOT RUN** | out of budget this pass |
| 06 Edge cases | **PARTIAL** | targeted checks only (see below) |
| 07 Frontend UI (Playwright) | **PARTIAL** | Superseded later the same day: #458's changed pages were driven in Chromium (login, dashboard, hotels, users/new, calendar, broadcasts, onboarding, users) — all 200, no crashes, no page errors, and bug 9 was verified end-to-end through the browser down to the database. Not a full scenario-07 walkthrough. |

## What was verified at the data layer

Every result below was confirmed by reading Postgres, not by trusting a `200`.

**Onboarding gate (scenario 01)**
- Submit before documents → `409` naming exactly the six required categories. No `GENERAL`,
  no `WORK_PERMIT` while `work_permit_required=false`.
- Completeness returns a `categories` map (not `by_category`).
- **ID/passport OR-rule integrates with the gate**: with `ID_CARD` and no `PASSPORT`,
  `missing_categories=[]`, `is_complete=true`, and submit-for-review no longer blocks on
  documents — it advances to the contract requirement. The gate and the completeness
  endpoint agree, which is the thing that could have diverged.
- Submit keeps `status=PENDING` with `submitted_for_review_at` set, scope still null
  (ADR-065 Decision 2). Approve → `ACTIVE`. Assign → `hotel_group_id` populated.

**Reassign calendar placement (#459) — the fix that previously had no live proof**

| Step | Result |
|---|---|
| Place W1 on calendar | `CalendarEntry` count = 1 |
| Reassign W1 → W2 | count still **1** (the bug produced 2), owner = W2 |
| Reassign back W2 → W1 | `201` — this is the case that previously failed with a **false** `409 "already has an assignment for this day"` |
| Final state | owner = W1 |

This closes the "verified by unit test only" caveat recorded in #459.

**Hotel lifecycle notifications (#458)** — verified separately before this run: reactivating a
hotel with a manager attached returned `400` with the status change rolled back until the
missing enum migration was added; after it, `200` with `HOTEL_ACTIVATED` / `HOTEL_DEACTIVATED`
rows written. See defect 2.

**Shift assignment notification (#458 bug 4)** — `ASSIGNMENT_CONFIRMED` rows written to the
placed workers on calendar placement (3 rows, 2 distinct recipients).

## Defects found this run

1. **Migration/schema drift on `DailyShiftSummary` (pre-existing, on `main`).**
   `20260812000000_add_daily_shift_summary/migration.sql:32` creates the FK
   `ON DELETE SET NULL`; `schema.prisma` declares `onDelete: Restrict`. Scenario 00's
   integrity gate fails on it, so every future run starts on a FAIL. Not caused by any PR
   under test. **Unfixed** — needs its own change.

2. **Enum values without a migration (#458, fixed during this pass).** Five values were added
   to `schema.prisma` with no `ALTER TYPE`. Because `notificationService.enqueue` runs inside
   the same transaction as the hotel status update, hotel deactivate/reactivate failed
   outright — `400`, status rolled back — for any hotel with a manager, RM or active workers.
   A hotel with nobody attached appeared to work, which is why it survived green CI: typecheck
   reads the generated client and the tests mock Prisma, so nothing applied migrations to a
   real database and then wrote a row. Fixed by
   `20260814000000_account_and_hotel_notification_types`; verified before/after.

3. **Worker app's Leaderboard screen is dead (pre-existing, no PR touches it).**
   `worker-app/src/app/ratings.tsx` calls `GET /analytics/leaderboard`, which is gated
   `requireRole(['admin','manager','regional_manager'])`. A worker gets `403`. Confirmed live.
   Every other endpoint the worker app calls returns `200` for a worker (assignments,
   work-requests, my-absences, notifications, my-stats, documents, consent, contract-status,
   payroll, auth/me). Needs a product decision, not just a code fix.

4. **`ACCOUNT_DEACTIVATED` / `ACCOUNT_REACTIVATED` are dead enum values (#458).** Nothing
   writes them. Hotel notifications are also in-app only — `enqueue` reads
   `input.transports ?? []` and the CRM call sites pass none, so no `OutboxEvent` and no push.

## Scenario files that are now stale

- **Scenario 01 steps 2 and 4** showed the **manager** calling `submit-for-review`. The route
  rejects that: *"Only the applicant may submit their own application for review; no role may
  submit on another user's behalf."* The commands must be re-written to authenticate as the
  applicant. Not corrected in this pass — flagged so the next run does not lose time on it.

## Could not test

1. **Real document upload to S3 (scenario 04)** — no AWS credentials. Documents seeded via
   Prisma; the upload path is unexercised.
2. **Frontend UI (scenario 07)** — not run. #458 changes 11 frontend files; none were
   exercised by any automated or manual check in this run.
3. **Scenarios 03 and 05** — not reached.
4. **Checker/worker creation chain (scenario 02)** — an RM's scope is baked into its JWT at
   login, so a token issued before `assign` still fails with *"Regional Manager must have a
   scoped hotel_group_id"*. Re-login is required. Workers were seeded directly instead, so the
   manager-creates-worker path is unverified this run.

## Scenario files updated this run

- `scenarios/01-onboarding-happy-path.md` — steps 2 and 4 now authenticate as the
  **applicant** (the route rejects a manager submitting on their behalf), record that the
  path segment is the human-facing `employee_id` rather than the record cuid, and add an
  explicit check that the submit gate and `getDocumentCompleteness` agree on the
  ID_CARD-or-PASSPORT rule.
