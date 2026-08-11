# Scenario 08 — Known Gaps, Open Defects, and What to Cover Next

**This is not a test.** It is the living backlog: what is known-broken, what has never been
tested, and what to add next time. Read it at the **end** of a run and **update it** — move
fixed items to the history table, add anything new you found.

Last updated: **2026-08-12** (browser-verified assign UI + two new self-service visibility defects found and fixed via real Playwright clicking; see the run log for the full session).

---

## 1. Open defects — confirmed, reproducible, not fixed

| # | Defect | Impact | Where | Decision needed |
|---|---|---|---|---|
| ~~1~~ | ~~Worker cannot submit their own onboarding~~ | **FIXED 2026-08-12** — route widened to admit `worker`/`checker`; `requirePermission('employees:write')` deliberately dropped from it (those roles hold only `employees:read`) and the real boundary moved into `assertLifecycleAuthority`, which returns early **only** when `actor.userId === record.user_id`. Verified live: own-record submit succeeds; the same worker submitting another worker's record → 403; a checker on a worker's record → 403; unauthenticated → 401. Two `C-16` divergences pinned in `capability-violations.ts` with justification (see §7). | — | — |
| ~~2~~ | ~~No assign step in the UI~~ | **FIXED and BROWSER-VERIFIED 2026-08-12** — `employeesApi.assign` + `AssignEmploymentInput` added; `ReviewQueueTable` now chains approve → an assign modal with a role-aware target picker (hotel for Manager, group for RM). Real Playwright clicks through the full chain (login → upload 6 docs → submit → admin approve → pick target → confirm) for both a Manager applicant (`primary_hotel_id`) and a Regional Manager applicant (`hotel_group_id`), each verified by reading `Hotel.manager_user_id` / `HotelGroup.regional_manager_user_id` and `EmploymentRecord.status = ACTIVE` directly from Postgres, not just the screen. Found and fixed a real bug in the process (see #7 below). | — | — |
| ~~3~~ | ~~Stale copy for active workers~~ | **FIXED 2026-08-12** — `/onboarding` description is now status-aware (active / rejected / under-review / pending). | — | — |
| ~~7~~ | ~~Manager/RM applicant cannot view their own onboarding record before assignment~~ | **FOUND AND FIXED 2026-08-12** — `/onboarding` showed "Failed to load onboarding record" and the document checklist showed "Failed to load document status" for a Manager or Regional Manager applicant, 100% of the time, before they had been assigned a scope. Root cause: two separate visibility guards (`employee-management/service.ts`'s `assertVisibility`, called by `GET /employees/by-user/:user_id`; and `middleware/permissions.ts`'s `resolveWorkerScope`, called by `checkWorkerScope()` on the documents routes) both checked group/scope membership for `manager`/`regional_manager` actors with **no self-record branch** — but a pre-assignment applicant has no `hotel_group_id`/scope yet, so the check always failed even for the applicant's own record. This completely blocked self-service onboarding for every Manager/RM applicant; only a real browser session surfaced it (unit tests mock the DB layer and never hit this comparison with a null scope). Fixed by adding an explicit `record.user_id === actor.userId` / `actorId === workerId` early-return before the scope branch in both guards, mirroring the pattern `assertLifecycleAuthority` already used for self-submission. Verified live: Manager and RM applicants can now load `/onboarding`, see all 6 document categories, upload real files through the browser, and submit. Backend suite re-run clean (108/108, 2687/2687) after the fix. | Blocked 100% of Manager/RM self-service onboarding | `backend/src/modules/employee-management/service.ts` `assertVisibility`; `backend/src/middleware/permissions.ts` `resolveWorkerScope` | — |
| ~~8~~ | ~~Assign UI sent `null` for the unused target field, backend rejected it~~ | **FOUND AND FIXED 2026-08-12** — `ReviewQueueTable.handleAssign()` sent both `primary_hotel_id` and `hotel_group_id` in the request body, setting whichever one didn't apply to `null` rather than omitting it. The backend's Zod schema (`z.object({ hotel_group_id: z.string().optional(), primary_hotel_id: z.string().optional() })`) accepts `undefined` for "not provided" but **not** `null`, so every assign attempt from the UI failed with a 422, regardless of role. Caught only by driving the actual modal and reading the live network response — the API-level tests always called `assign()` with exactly one field, never reproducing this shape. Fixed by sending only the relevant field (omitting the other) and narrowing `AssignEmploymentInput`'s type from `string \| null \| undefined` to `string \| undefined` so this shape can't recur silently. Verified live for both Manager (hotel) and RM (group) targets, confirmed via a fresh Postgres read of `Hotel.manager_user_id` / `HotelGroup.regional_manager_user_id`. | Blocked 100% of assign attempts from the UI (both roles) | `frontend/components/onboarding/ReviewQueueTable.tsx` `handleAssign`; `frontend/lib/types.ts` `AssignEmploymentInput` | — |
| ~~9~~ | ~~Reject flow untested — uses `window.prompt()`~~ | **BROWSER-VERIFIED 2026-08-12** (not a defect, a test-harness note) — `handleReject()` uses a native `window.prompt()` for the rejection reason rather than a modal input. This works correctly for a real user but Playwright auto-dismisses native dialogs unless a `page.on('dialog', ...)` handler is attached; without one, clicking Reject silently no-ops (no request is even sent) with no visible error, which looks exactly like a broken button. Verified working once a dialog handler was added: click → prompt → reason submitted → `POST /employees/:id/reject` → record's status becomes `REJECTED`, confirmed in Postgres. Flagged so nobody re-discovers this as a false "Reject is broken" defect. **Product question, not a bug**: is `window.prompt()` the intended UX long-term, or should this become an in-modal text field for consistency with the rest of the app? | — | Cosmetic/UX — native prompt vs. in-app field |
| ~~4~~ | ~~**`consent.recordDecision()` atomicity gap** — `consentRecord.create` → `logAudit` → `notifyResponsibleManager`, all unwrapped~~ | **FIXED** — Wrapped in `$transaction`, threading `tx` through to notifications and audit logging. | — | — |
| ~~5~~ | ~~**Audit-outside-transaction sites** (per `ADR-029`, not `ADR-036`)~~ | **FIXED** — `geo/service.ts`, `document-templates/service.ts`, and `attendance/service.ts` all updated to wrap audits in `$transaction`. | — | — |
| ~~6~~ | ~~**Orphaned S3 objects possible** — `storage.upload()` runs *before* the DB transaction with no compensating `storage.delete()`~~ | **FIXED** — Wrapped the DB transaction in a `try/catch` and added a compensating `storage.delete()` on failure. | — | — |

## 2. Judgment calls awaiting the project owner

All three are **documented, deliberate** positions — not bugs — but were flagged as worth an
explicit yes/no:

1. **`retention`'s deletion audit log is readable by any authenticated user** (including a plain
   worker) — `retention/service.ts` `getDeletionAuditLog` takes no actor. Knowingly-taken posture
   per `SIR-RETENTION-003` (OPEN), but the practical exposure (a worker enumerating the platform's
   whole deletion history) may exceed what "trusted backend context only" anticipated. **Widest
   exposure of the three.**
2. **`document-templates` returns all templates platform-wide** to admin/manager/RM. Likely
   correct — templates are modeled as global blueprints with no hotel FK to filter on
   (`MODULE_SPEC.md:181`).
3. **`consent` read asymmetry** — Admin reads any worker; Manager/RM read none, not even their
   own group. Explicitly ratified in `ADR-037`/`SIR-CONSENT-011`.

## 3. Never tested by anyone

- ~~**`retention/sweep-job.ts`**~~ — **Scenario 09 added**. The multi-module hard-delete fan-out is now covered by an explicit scenario covering atomicity, large batched deletions, overlapping executions, and audit row creation without personal data.
- ~~The real HR contract flow~~ — **partially covered 2026-08-12**: `POST /hr/contracts` →
  `contract-scan` → `contract-confirm` was exercised through the real API (not seeded directly) as
  a prerequisite for testing the assign UI, and confirmed the contract-approval gate on
  `POST /employees/:id/approve` correctly blocks approval until a contract is `ACTIVE`. Still not
  covered: the malware-scan hook on `contract-scan` itself (was skipped by not being a defect this
  session was investigating), and the `contract-extend`/`contract-lapse` transitions.
- **Mobile apps** (`mobile/worker-app`) against these backend changes.
- **Outbox/notification delivery** — records are written, but no test confirms a notification is
  actually delivered for onboarding events.
- **`document-instances`** (fillable forms / digital signature) interaction with onboarding.
- **Production-like data volumes** — every test has run with a handful of records.

## 4. Prioritised list for the next run

1. **Run scenarios 00-09 in full** and log results.
2. **Finish the HR contract flow** — `contract-extend`/`contract-lapse`, and the malware-scan hook
   on `contract-scan` specifically.
5. **Sustained concurrency** (scenario 05's "not yet covered" list) — 10-50 parallel mutations,
   three-way races, `assign` vs `deactivate`.
6. **UI coverage gaps still open** — document viewing from the review modal, Manager/RM's own
   "My Onboarding" pages (only Worker's and Manager's applicant-side views were walked this run),
   session expiry mid-flow, accessibility, multi-tab.
7. **Edge cases in scenario 06's list** — hotel re-parenting mid-application, bulk-import
   partial failures, contract expiry while active, timezone boundaries.
8. **Decide on `window.prompt()` for Reject** (§1 item 9) — cosmetic, low priority.

## 5. Environmental caveats that have produced false results

- **Docker containers vanish after a Docker restart** → `docker compose up -d`, not `docker start`.
- **Missing AWS credentials** silently turn document tests into no-ops (stub storage still writes
  the DB row). Always confirm `aws sts get-caller-identity` first.
- **`FEATURE_EMPLOYMENT_RECORD=false`** makes every `/employees` route 404 — the suite passes
  vacuously. Verify with a live request.
- **Stale scenario data**: a record consumed by an earlier step makes a later race/queue test
  silently vacuous ("queue empty" ≠ "isolation works"). Use fresh records per test.
- **`tsc` + unit tests + lint all passing proves little about the browser** — the worst defect
  found in this feature passed all three.
- **Zod's `.optional()` accepts `undefined`, not `null`.** A frontend that sends `{ field: null }`
  for "not applicable" against a `z.string().optional()` schema gets a 422, not the pass-through
  a JS developer might expect. This silently broke the entire assign UI (2026-08-12) and unit
  tests never caught it because they called the service directly with a clean single-field object,
  never reproducing the real request shape a browser click produces.
- **Playwright auto-dismisses native `window.confirm()`/`prompt()`/`alert()` dialogs** unless a
  `page.on('dialog', ...)` handler is attached. Without one, a button wired to `window.prompt()`
  looks completely inert — no network request, no visible error — which is easy to misdiagnose as
  a broken button rather than a missing test harness hook.
- **A visibility/scope guard that checks group membership will always deny a pre-assignment
  applicant reading their own record**, because `hotel_group_id`/scope is null until assignment.
  Any new manager/RM-facing self-service route needs an explicit `record.user_id === actor.userId`
  check *before* the scope check, not instead of it. This exact gap existed in two independent
  guards (`assertVisibility` and `resolveWorkerScope`) simultaneously — grep for `isScopedManagerRole`
  and `isWorkerInGroupScope` call sites if adding a new one, since a third could exist unfound.

## 7. Pinned capability-matrix divergences (read before "fixing" a failing capability test)

`backend/src/__tests__/capability-policy.test.ts` asserts every route gate against the
transcribed `ADR-030` §3 matrix, and `support/capability-violations.ts` pins the known
divergences. The suite requires the pinned set to match the actual set **exactly**, so both
introducing a new divergence *and* closing an existing one fail the build until the pin file is
deliberately edited. That is intentional — a silent pass/fail flip is worse than a loud list.

Currently pinned (all `ADR-065`-driven, all awaiting an `ADR-030` §3 matrix amendment — the
forward-note `ADR-065` §7 already records as owed):

- `C-15:manager@…POST /` and `C-15:regional_manager@…POST /` — Manager/RM may create records
- `C-16:worker@…submit-for-review` and `C-16:checker@…submit-for-review` — self-service submit

**If a capability test fails**, do not edit the matrix or delete the assertion. Either the change
is legitimate (add a pin with its authority and remediation owner) or it is an accidental
authorization widening (revert the code).

## 6. Fixed — history (do not re-investigate, but do regression-test)

| Defect | Fixed in |
|---|---|
| Manager blocked from creating Worker/Checker records | `981229b` |
| Manager Review Queue permanently empty (`target_primary_hotel_id` never set) | `981229b` |
| 4 of 7 document categories impossible to upload (stale enum in validator) | `981229b` |
| `assign()` never wrote `Hotel.manager_user_id`/`HotelGroup.regional_manager_user_id` | `981229b` |
| `password_hash` leaked in `getReviewQueue` | `981229b` |
| `password_hash` leaked in `assign` | `3f7bae4` |
| `password_hash` leaked in all lifecycle transitions (3rd occurrence) + structural backstop | `6a06563` |
| `assign()` no reassignment handling (silent multi-hotel corruption; RM 409) | `25219f1` |
| Read-then-write race corrupting `EmploymentStatusHistory` (no `version` column) | `19f009d` |
| `deactivate()` didn't vacate the hotel → deactivated manager kept full authority | `19f009d` |
| `FEATURE_RM_ROLE` never consulted (RM could approve with flag off) | `19f009d` |
| `assign {}` silent 200 no-op; generic not-found message | `19f009d` |
| Manager/RM applicant cannot view own onboarding record pre-assignment (`assertVisibility` + `resolveWorkerScope` both lacked a self-record branch) | uncommitted, 2026-08-12 session — `backend/src/modules/employee-management/service.ts`, `backend/src/middleware/permissions.ts` |
| Assign UI 422s on every attempt (`null` sent for the unused target field against a `z.string().optional()` schema) | uncommitted, 2026-08-12 session — `frontend/components/onboarding/ReviewQueueTable.tsx`, `frontend/lib/types.ts` |
| Migration over-cleanup removing statements a fresh DB needs | reverted in `5f4fa70` |
| Malware-scan seam absent on the WorkerDocument path (`OD-DOC-016`) | `fdf2096` (ADR-066 Option A) |
| `/onboarding` crash — `by_category` vs `categories` | `6bd4b17` |
| Worker activation gates (documents + contract) deleted | restored pre-`06510ff` |
| `rehire()` bypassed the contract gate | `dadf129` |
| `consent.recordDecision()` atomicity gap | uncommitted — `backend/src/modules/consent/service.ts` |
| Audit-outside-transaction sites (`geo`, `document-templates`, `attendance`) | uncommitted — `backend/src/modules/geo`, `backend/src/modules/document-templates`, `backend/src/modules/attendance` |
| Orphaned S3 objects in `uploadDocument` | uncommitted — `backend/src/modules/documents/service.ts` |

---

## Maintenance rule

**Every time this suite is run, update it in the same pass:**
- Move newly-fixed items from §1 into §6 with the commit hash.
- Add newly-found defects to §1 with a reproduction.
- Tick off anything from §3/§4 that got covered, and add whatever new gaps you noticed.
- Append a run log under `runs/` (template in `../README.md`) — never overwrite a previous one.

A defect found and fixed but **not recorded here will be rediscovered from scratch**. That has
already happened more than once in this project.
