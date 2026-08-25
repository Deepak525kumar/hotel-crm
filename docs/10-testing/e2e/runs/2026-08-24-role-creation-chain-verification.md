# E2E Run — 2026-08-24 — role-creation chain (checker-first, then all roles)

- **Commit under test:** `f77537e` (branch `feat/chatbot-scaffold` = `origin/main` + the chatbot scaffold, `FEATURE_CHATBOT` off)
- **Environment:** local dev
- **Executed by:** Claude (agent session)
- **Stack versions:** backend on :3001, frontend on :3000, Postgres 16 (`hotel-crm-postgres-1`), Redis
- **Trigger:** "I was trying to create a checker and couldn't check if the flow is working properly."

## Flag states (recorded per scenario 00)

| Flag | State |
|---|---|
| `FEATURE_EMPLOYMENT_RECORD` | `true` (confirmed by live request, not just the env file) |
| `FEATURE_CONSENT_GATE` | on (default) — blocked every non-admin actor until granted |
| `FEATURE_RM_ROLE` | absent → off. RM creation and approval still worked. |
| `FEATURE_CHATBOT` | `false` (this branch's addition; `/api/v1/chatbot` 404s, as intended) |

## Results

| Scenario | Result | Notes |
|---|---|---|
| 00 Environment | **PASS** | Migrations applied (incl. `20260824112010`); fresh-DB drift check `No difference detected` |
| 01 Happy path (checker + worker) | **PASS** (docs seeded) | Full lifecycle to `ACTIVE`; real upload path **not** exercised — see Could not test |
| 02 Manager / RM lifecycle | **PASS** | Approve writes no scope; `assign` is the separate action; both cross-entity writes verified |
| 03 Authorization isolation (partial) | **PASS** | Role capability matrix below; not the full scenario 03 |
| 07 Frontend UI (partial) | **PASS with 1 defect** | Nav gating + role dropdown correct; creation works; the post-create page fails — defect 1 |

## The question that prompted this run

**An Admin cannot create a Checker.** `POST /api/v1/users` as admin returns:

```
403 FORBIDDEN — "A admin may only create users with role: regional_manager (attempted: checker)"
```

This is `ADR-065`'s hierarchy working as designed, not a defect. The chain is:

```
admin → regional_manager → manager → worker | checker
```

and each tier must be **fully onboarded and assigned** before it can create the next. A `PENDING`
RM with no group is refused with *"Regional Manager must have a scoped hotel_group_id to create a
Manager application"*. So reaching a Checker requires two complete onboarding lifecycles first.

Two further gates surprised this run and are worth knowing before blaming the code:

1. **The consent gate blocks everything.** Every non-admin actor 403s with `CONSENT_REQUIRED`
   until they `POST /consent/decisions`. This hits immediately after login and looks like a
   permissions bug.
2. **`POST /users` requires `phone`, `job_title`, `start_date`, `employment_type`**, each
   surfacing as a separate 422 (already recorded in scenario 00).

## Verified end-to-end, at the data layer

Chain built fresh: QA Group → QA Hotel → RM → Manager → Checker + Worker.

| Assertion | Result |
|---|---|
| `Hotel.hotel_group_id` set by the separate PATCH | PASS |
| RM created `PENDING`, no scope | PASS |
| RM `ACTIVE` after docs + scan + submit + approve | PASS |
| RM assign → `HotelGroup.regional_manager_user_id` set | PASS (read from `HotelGroup`) |
| Manager `target_hotel_group_id` auto-filled from RM's group | PASS (`ADR-065` §6 item 7) |
| Manager assign → `Hotel.manager_user_id` set | PASS (read from `Hotel`) |
| No `password_hash` in any assign response | PASS |
| **Checker created by manager** | **PASS** — `PENDING`, both target fields auto-filled |
| Checker `ACTIVE`, `hotel_group_id` resolved from approving manager | PASS (fused path, `ADR-065` §3 item 6) |
| Checker `Contract` → `ACTIVE`, `confirmed_by_id` = manager, `scanned_document_id` linked | PASS (all three read from DB) |
| Worker identical | PASS |
| Submit blocked before contract scan | PASS — *"download your contract, sign it, and upload the signed copy first"* |
| Approve blocked before submit | PASS |
| Completeness returns `categories` (not `by_category`) | PASS |

### Role capability matrix (live probes)

| Role | `/auth/me` | `/assignments` | `/crm/hotels` | `/employees/review-queue` | `/quality/leaderboard` | `/users` | `POST /quality/ratings` |
|---|---|---|---|---|---|---|---|
| admin | 200 | 200 | 200 | 200 | 200 | 200 | — |
| regional_manager | 200 | 200 | 200 | 200 | 200 | 200 | — |
| manager | 200 | 200 | 200 | 200 | 200 | 200 | — |
| checker | 200 | 200 | 200 | **403** | 200 | **403** | **422** (holds `quality:write`) |
| worker | 200 | 200 | 200 | **403** | 200 | **403** | **403** (correctly denied) |

The checker's 422 on `POST /quality/ratings` is the intended result: it passed the
`quality:write` permission gate and failed only body validation. The worker's 403 on the same
route confirms the split.

## New defects found

1. **A newly created Worker/Checker is invisible to the Manager who created it** — **HIGH** —
   filed as `08-known-gaps-and-next.md` defect 11.
   Creation succeeds (`201`; `EmploymentRecord` + `Contract` both `PENDING`), but the UI redirects
   to `/users/<id>`, which renders **"Failed to load employment status"** and **"Failed to load
   contract status"** — two `403`s (`GET /employees/by-user/:id` → *"Record is outside your
   scope"*, `GET /hr/workers/:id/contract-status` → *"Cannot access worker …"*). The new user is
   also absent from the Users tab. Root cause: `hotel_group_id` is `null` until approval
   (`ADR-065` Decision 2) and these scope checks read it rather than falling back to
   `target_hotel_group_id`. `isWorkerInReviewerScope()` (`lib/scope.ts:166`) already does exactly
   that fallback but is used only by `documents/routes.ts:88`.
   *Not* in the Review Queue either — that part is by design (`getReviewQueue` filters
   `submitted_for_review_at: { not: null }`, `employee-management/service.ts:1991-1993`).
   **This is what a user reports as "creating a checker gave me an error".**

2. **Stale citation, scenario 01 Step 6** — documentation — *fixed this run*.
   The scenario instructed `GET /hr/workers/<id>/contract`; no such route exists
   (`hr/routes.ts:204-257` exposes `contract-status`, `contract-download`, `contract-scan`,
   `contract-confirm`, `contract-extend`, `contract-lapse`). The bare path returns a generic
   `404 Resource not found`, which reads as "the contract is missing" when the contract row is
   in fact present and `PENDING`. Corrected in the scenario file.

## Checker evidence flow (scenario 12) — run after `aws login`

With working credentials the **real S3 path was exercised**: a document upload returned `201` and
the object was confirmed in `s3://hotelcrm-uploads` via `head-object` (69 bytes, versioned). The
earlier "could not test" on uploads is therefore closed for this run.

| Step | Result |
|---|---|
| 1 — rating without a photo | **FAIL → fixed.** Returned `201`, must be `400/422` (CRR §15). See Fixed section |
| 2 — rating with photo, `score` survives multipart | **PASS** — `score` came back as `int 45`, the defect this step exists for |
| 3 — evidence photos readable by the right people | **FAIL → fixed.** Checker got `403` on its own photos. Subject worker `200`, admin `200`. Unrelated-worker IDOR case **untested** (no known password for a foreign-group worker) |
| 4 — assign rework, linked assignment | **PASS** — new row links to both the original assignment and the verification; `REWORK_REQUIRED` queued |
| 5 — assigning rework twice | **PASS** — `409`, and exactly one rework row |
| 6 — worker closes rework | **PASS** — `422` without a photo, `200` with one; `rework_completed_at` set on `QualityVerification` |
| 7 — cross-worker completion | **PASS** — `403` |
| 8 — 20-minute escalation | **not run** |
| 9 — ADR-069 metric exclusion | **not run** |

Note for the next run: scenario 12 Step 6's SQL reads `rework_completed_at`/`rework_escalated_at`
off `WorkerAssignment`; they live on **`QualityVerification`**. `WorkerAssignment` carries only
`rework_of_assignment_id` and `rework_verification_id`.

## Checker mobile app

Launched in the iOS simulator (iPhone 17 Pro, Expo 57 / RN 0.86) against the local backend; the
**Checker Portal login screen rendered**, and `tsc --noEmit` is clean over `src/` (the only
errors are missing jest types in `__tests__`/`__mocks__`). Screens present: `quality/[id]`,
`rating/[id]`, `verification/[id]`, `attendance/[id]`, `documents`, `hr`, `consent`,
`leaderboard`, `absences`, `notifications`, `profile`.

**Not driven end-to-end.** Synthetic taps via Quartz did not reach the Simulator despite
Accessibility being granted, and neither `idb` nor `cliclick` is installed. **Worker selection,
in-app photo capture, and the rating screen are therefore UNTESTED — recorded as a gap, not a
pass.** Installing `idb-companion` + `fb-idb` would unblock this.

## Second pass — scenarios 05, 06, 09, 10, 11 and 12 steps 8-9

Run after the CRR §15 fixes landed. Day had rolled over, so every non-admin needed fresh
daily consent first — worth knowing, it presents as a blanket 403 on a previously-working setup.

| Scenario | Result |
|---|---|
| 05·2 concurrent identical approvals | **PASS** — 200/409, `version` 2, exactly one `PENDING→ACTIVE` history row |
| 05·3 concurrent assign to two hotels | **PASS** — 200/409, manager recorded on exactly one hotel |
| 05·4 concurrent submit-for-review | **PASS** — 200/409, `submitted_for_review_at` set once |
| 06 transfer | **PASS** — old hotel vacated, new assigned, one vacancy-history row |
| 06 deactivate | **PASS** — hotel vacated, `manager_vacated_at` set, status `DEACTIVATED` |
| 06 reactivate | **PASS** — returns to `ACTIVE`; hotel **not** reassigned, matching the scenario's recorded ambiguity |
| 09 retention sweep | **Covered by unit tests, not run live** — no `RetentionCategory` rows exist in dev, so the live sweep has nothing to select. `__tests__/retention-sweep-job.test.ts` already covers 9.1-9.4 including the concurrency race and transaction atomicity |
| 10 shift summary | **PASS functionally, 1 defect** — manager write 200, RM edit 200, verified in DB; worker 403, foreign-group RM 403. Invalid body returns **500 instead of 422** → defect 14 |
| 11·4 decline/re-accept | **PASS** — 403 after decline, escape hatches 200, immediate 200 after re-grant (proves cache invalidation), both rows retained |
| 11·6 admin never gated | **PASS** — admin 200 on gated routes. Two `ConsentRecord` rows exist for the admin but are dated 20-21 Aug, predating this session; the gate is not creating them |
| 12·8 escalation | **PASS** — `rework_escalated_at` set once, exactly 2 `REWORK_OVERDUE` notifications to **both** Manager and Checker (CRR §14), no duplicates on a second run |
| 12·8 completion race | **PASS** — an overdue-but-completed rework produced **0** notifications and `rework_escalated_at` stayed null; the compare-and-swap does re-check `rework_completed_at` |
| 12·9 ADR-069 metrics | **PASS** — `completion_rate` and `on_time_rate` both ≤ 1.0 with a rework row present |

Note: scenario 10's field names are `stay_over_rooms`/`total_people_working`, not the
`stayover_rooms`/`workers_assigned` the prose implies — and getting them wrong is what surfaced
defect 14.

## Observations (not defects)

1. **The four pre-existing `CHECKER` users have no `EmploymentRecord`** (`checker1/2/3@test.local`,
   `ruleA-mgr-checker@test.local`, created 2026-08-11/12) while `is_active = true`. They therefore
   have no resolvable scope. They look like direct seeds from before the employment-record flow
   rather than a code defect, but a checker in that state will behave as though onboarding never
   happened. Worth deciding whether to backfill or delete them.
2. **The S3 upload failure mode is correct.** With expired credentials the upload returned `500`
   and wrote **no** `WorkerDocument` row — verified. That is the right behaviour and notably not
   the historical stub bug where a `200` was returned while nothing reached the bucket.

## Could not test

1. **Real document upload to S3** — local AWS credentials are expired
   (`CredentialsProviderError: Your session has expired`, surfacing from
   `documents/storage.ts:116`). This is an **environment problem, not a code defect**.
   Per scenario 01 Step 3, `WorkerDocument` rows (six categories + `CONTRACT_SCAN`) were seeded
   via Prisma instead, and the upload path is therefore **unexercised** in this run.
   Scenario 04 needs a session with working credentials.
2. **Frontend UI walkthrough (scenario 07)** — partially run; see the Frontend verification section. Steps 3-9 (real browser uploads, submit, review-modal approve, double-click race) not attempted.
3. **Scenarios 05, 06, 09-12** — out of scope for the question asked.

## Scenario files updated this run

- `scenarios/01-onboarding-happy-path.md` — corrected the `/hr/workers/<id>/contract` citation to
  `/contract-status`, with a note on why the wrong path is misleading.
