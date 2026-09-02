# E2E Run — 2026-09-02 — post-production-deploy (onboarding, isolation, room log)

- **Commit under test:** `bb9c7f37` (main, includes #621 — backend suite now runs
  `--runInBand` as the merge gate)
- **Environment:** local dev (fresh `hotelcrm_dev`, reset and re-migrated this run — see
  Scenario 00 notes), backend against real S3/eu-central-1 (`hotelcrm-uploads`)
- **Executed by:** Claude (agent), at user's request — "run the E2E suite" following the
  four commits pushed straight to `main` on 2026-09-02 without PR review
  (`ef0f27f6`, `8dc58cfb`, `bb44b527`, `e94ba804`)
- **Stack versions:** backend Node/Express (local `npm run dev`), Postgres 15.19
  (Docker `postgres:15`), frontend not started this run (API-only pass; scenario 07 not run)

## Why this run

Four production-deployed commits had never been exercised by anything but unit tests, which
mock Prisma throughout: admin-creates-any-role, the shift-bounded room log rewrite, delete/
archive scope-vacating, and the archived-scope JWT hardening. Twice this session a unit-green
change was wrong against real data (the shift-window rule was inert against production's
`has_times = f`; a Zod schema silently discarded `skills`). This run verifies at the data
layer, not the API response, per the suite's own rule.

## Results

| Scenario | Result | Notes |
|---|---|---|
| 00 Environment | PASS (after fixes) | `hotelcrm_dev` was a stale empty `db push` schema (0 rows, no `_prisma_migrations`) — reset + `migrate deploy`, then the fresh-DB drift gate: `No difference detected`. Corrected §4's request shape and hierarchy (both stale since 2026-08-17); documented the consent gate, which the doc never mentioned |
| 01 Onboarding happy path | PASS | Steps 2–7 verified for Manager (used in place of a fresh Worker — see below) and for Worker/Checker separately; six-category 409, `categories` field, ID_CARD-or-PASSPORT rule, `signed_scan_uploaded` without `scanned_document_id`, clean history row all confirmed at the data layer. Corrected the CONTRACT_SCAN upload example (missing `original_filename`/`mime_type`) |
| 02 Manager/RM onboarding | PASS (after doc correction) | Full chain exercised: Admin→RM, Admin→Manager (new), peer-Manager-approve refused, RM-approve-Manager refused (flag off), Admin→RM-only for RM applications, peer-RM-approve-RM refused, assign() writes the cross-entity pointer only on explicit call. **Step 6's assertion was stale** (predated a real 2026-08-14 fix) — corrected in place |
| 03 Authorization isolation | PASS (2 doc corrections, 1 new-defect cross-ref) | Manager/RM/Admin queue filtering, no `password_hash` leak, worker/checker 403, cross-scope approve/reject/assign all 403, document access follows scope (worker self ok, cross-worker 403). Step 3 (admin queue routing) and Step 8 (guard message) were both stale against the 2026-08-13 routing rewrite — corrected. New defect found and pushed into scenario 06 (see below) |
| 04 Document upload/S3 | Exercised as a side effect, not run standalone | Real S3 uploads succeeded throughout (presigned URLs returned); one transient `Could not load credentials from any providers` mid-run, self-resolved by restarting the backend process — recorded as environment noise, not a defect (see below) |
| 05 Race conditions | Partially exercised | Room-log concurrent-claim race (18 Step 3) run for real: 1×201, 1×409, 1 row. Approve/reject double-submit not separately re-run this pass |
| 06 Edge cases/ambiguity | **1 new confirmed defect, 1 ambiguity resolved to a confirmed defect** | See below — reactivate()/Hotel.manager_user_id gap, and the missing manager-role `review-queue` guard |
| 09, 10, 11, 12, 16, 17 | Not run this pass | Time-boxed to the scenarios covering yesterday's four commits. Consent (11) was exercised heavily as an undocumented side dependency of every other scenario (see 00's correction) but not run as its own scenario |
| 18 Room log / room-first check | PASS | Steps 1–5 (and the scope matrix) run in full against real assignments, real Attendance check-in, and a real concurrent race. See below |
| 07 Frontend/Playwright | Not run | No browser session started this pass |

## New defects found

1. **`getReviewQueue()` has no scope guard for an unscoped/deactivated `manager`** —
   `backend/src/modules/employee-management/service.ts` (`getReviewQueue`, ~line 2022–2038)
   — MEDIUM (no data leak; observability/UX regression). A deactivated (or otherwise
   unscoped) manager calling `GET /employees/review-queue` gets `200 {"data":[]}` instead of
   the originally-implemented `403 "Manager must be scoped to a hotel"` (present at
   `0e6841cf`, ADR-065 Phase 2; dropped in the 2026-08-13 `resolveReviewerRecipients` rewrite;
   `regional_manager`'s equivalent guard survived, `manager`'s did not). Filed in scenario 06
   (A1) and cross-referenced from scenario 03 (Step 8).
2. **`reactivate()` does not restore `Hotel.manager_user_id`, leaving a reactivated manager
   with zero operational authority** — `backend/src/modules/employee-management/service.ts`
   (`reactivate`, ~line 1309; contrast `deactivate`'s `vacateManagedScopes` call, ~line 1173)
   — HIGH (silent capability loss on a designed, documented recovery path —
   `DeactivationReason.TEMPORARY_LEAVE` exists specifically for this). `resolveScope()`
   (`auth/service.ts:286`) derives a manager's JWT scope from `Hotel.manager_user_id`, which
   `deactivate()` correctly clears but `reactivate()` never restores (it only restores
   `EmploymentRecord.status`, leaving `hotel_group_id`/`primary_hotel_id` — which were never
   cleared in the first place — looking populated and correct). Net effect: a manager
   returning from a documented temporary pause is `ACTIVE`, their own employment record looks
   fully scoped, and yet every scope-gated action (e.g. `approve`) fails with `"you do not
   manage a hotel group"` until an admin makes an undocumented second `assign()` call. This
   directly contradicts `reactivate()`'s own docstring ("no re-approval and no group
   re-resolution... the record is immediately assignable again"). Filed in scenario 06 (A2,
   previously an open ambiguity — now resolved to a confirmed defect against the code's own
   stated intent).

Both are real and reproducible against a fresh DB with no seeding shortcuts on the
authorization path itself (only the *prerequisite* assignment/check-in fixtures were seeded
via Prisma — see "Could not test" below).

## Confirmed NOT defects (investigated, ruled out)

- Scenario 02 Step 6 ("approve writes NO scope") and scenario 03 Step 3 (admin queue is
  Manager/RM-only) were both **stale documentation**, not regressions — both predate real,
  deliberate, already-shipped fixes (2026-08-14 PR #453; 2026-08-13 reviewer-routing
  rewrite). Corrected in place per the suite's own rule (spec/reality mismatch → fix the
  doc, don't assume the doc was right).
- Scenario 18 Step 2's documented `400` is actually `422` in this API — matches the
  convention used everywhere else for `ValidationError`; not a defect, a stale status code
  in the doc (left unfixed pending a fuller doc pass — noted here so it isn't rediscovered
  as a surprise).
- `POST /consent/decisions` accepting a made-up `consent_instance` string
  (`"DAILY_PLATFORM_USE"`) and returning `200` was my own harness error (guessed instead of
  reading `modules/consent/types.ts`), not a defect — but worth noting as a robustness gap:
  the endpoint does not validate `consent_instance` against a known enum, so a typo'd
  instance from a hypothetical buggy client would silently record a decision that gates
  nothing. Not filed as a defect (no real client sends anything but the hardcoded
  `"daily-access-gate"` — verified in `frontend/lib/types.ts` and both consent components) —
  flagged here only for awareness.

## Could not test

1. **Real document-upload path via `curl`/multipart, three times, transiently failed
   with `"Could not load credentials from any providers"`** — backend's own AWS SDK
   credential cache going stale mid-session (~18 minutes after process start), unrelated to
   the `aws` CLI's own credentials (confirmed live via `aws sts get-caller-identity`).
   Resolved by restarting the backend dev process. Not a product defect — flagged as
   environment noise for whoever runs this suite next locally; a long-running local dev
   backend may need periodic restarts if AWS SSO session tokens are involved.
2. **Assignment creation/broadcast/accept lifecycle** — scenario 18 needs `WorkerAssignment`
   + `CalendarEntry` rows in a specific state (checked-in, real day) that the real broadcast/
   accept flow (`job-requests` module) would take significant additional setup to reach.
   Seeded directly via Prisma instead (assignment `CONFIRMED`→ real `PATCH /assignments/:id`/
   `POST /attendance` check-in was still exercised through the real endpoint). This is
   exactly the kind of "unrelated prerequisite" the suite's own rules permit seeding — the
   thing under test (room-log gating, collision, concurrency, scope) was exercised for real
   in every case. Broadcast/accept itself was not verified this pass.
3. **Frontend/mobile surfaces** — no browser or Expo session started. Scenario 03 Step 7
   (route-level gating) and all of scenario 07 remain untested this pass.
4. **Checker parity (scenario 01 Step 8)** — checker was walked through the full lifecycle
   as part of scenario 18 setup (documents, submit, approve), which incidentally exercises
   most of Step 8, but no side-by-side diff against the worker path was done.

## Scenario files updated this run

- `00-environment-setup.md` — §4 request shape (multipart, no job_title/start_date/
  employment_type, mandatory photo), creation hierarchy (admin creates all four non-admin
  roles as of 2026-09-01/02, not RM-only), and the previously-undocumented daily consent
  gate dependency
- `01-onboarding-happy-path.md` — Step 6's CONTRACT_SCAN upload example corrected
  (`original_filename`/`mime_type` required)
- `02-manager-rm-onboarding.md` — Step 6 rewritten: approve now promotes `target_*` onto the
  record (2026-08-14 fix), `Hotel.manager_user_id` remains assign()-only
- `03-authorization-isolation.md` — Step 3 (admin's queue includes orphaned Worker/Checker
  applications as reviewer-of-last-resort, not just Manager/RM), Step 8 (queue-403 claim was
  wrong — cross-referenced to the real finding in scenario 06), pass-criteria and defects
  table updated
- `06-edge-cases-ambiguity.md` — A1 corrected (queue call is `200 []` not `403` — new
  defect), A2 upgraded from open ambiguity to confirmed defect with root cause and repro,
  pass-criteria updated
