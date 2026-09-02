# Scenario 08 — Known Gaps, Open Defects, and What to Cover Next

**This is not a test.** It is the living backlog: what is known-broken, what has never been
tested, and what to add next time. Read it at the **end** of a run and **update it** — move
fixed items to the history table, add anything new you found.

Last updated: **2026-08-13** (contract feature + review-routing + document-templates removal batch
— see `runs/2026-08-13-contract-feature-and-review-routing.md`. Not a full suite run: scoped
verification of the features changed this session, per explicit instruction not to re-run the
whole E2E suite).

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
| ~~10~~ | ~~Document upload cannot be exercised end-to-end locally — S3 misconfiguration produces a bare 500~~ | **ENVIRONMENT-DEPENDENT, not a code defect — confirmed resolvable 2026-09-02.** This item was true for whichever local environment lacked AWS credentials when it was written; it does not describe the code. With valid credentials present (confirmed via `aws sts get-caller-identity`), the positive upload path works end-to-end and was exercised dozens of times across the 2026-09-02 sessions — real presigned URLs that resolve `200`, real objects confirmed via `aws s3api head-object` with `ContentLength` matching the uploaded file exactly (see scenario 04). Leaving this row rather than deleting it: the underlying fact (`storage.upload()` throws a bare `500`/`StorageError` with no actionable message when credentials are genuinely absent, rather than a clearer `503` or setup hint) is still real and still worth fixing — it just isn't the blocking, always-true gap this row originally described. Re-check credentials (`aws sts get-caller-identity`) before assuming this row applies again. | A future environment with no AWS credentials will hit this same confusing bare 500 | `backend/src/modules/documents/storage.ts` `getStorageClient` | Map a credentials/storage-config failure to `503` with an actionable message, distinct from a generic `500` |
| ~~11~~ | ~~**Second admin-side document-upload surface — live Upload button on another user's profile**~~ | **FOUND AND FIXED 2026-08-12** (found by browser-verifying RULE B, not by tests). `components/documents/DocumentsCard.tsx` — rendered on `app/(protected)/users/[id]/page.tsx` for ANY user — had an unconditional "Upload" button calling `documentsApi.upload(workerId, …)` with an arbitrary `workerId`. This is a SECOND upload surface distinct from `components/onboarding/DocumentUploadList`, and grepping the onboarding folder alone misses it. The backend (RULE B) correctly denied the call, so this was a live button in front of a denied route rather than an open hole — but that is exactly the UI/route split this project has repeatedly gotten wrong in the other direction. Fixed by gating the button (and the misleading "Upload … for this worker" empty-state copy) on `viewerId === workerId`, defaulting to hidden while the auth store hydrates. Verified in the browser: Upload-button count on another user's profile went from 1 to 0, while the applicant's own `/onboarding` controls still render. **Lesson: when auditing a capability, enumerate call sites of the API function (`documentsApi.upload`), not files in the feature folder.** | — | `frontend/components/documents/DocumentsCard.tsx` | — |
| ~~4~~ | ~~**`consent.recordDecision()` atomicity gap** — `consentRecord.create` → `logAudit` → `notifyResponsibleManager`, all unwrapped~~ | **FIXED** — Wrapped in `$transaction`, threading `tx` through to notifications and audit logging. | — | — |
| ~~5~~ | ~~**Audit-outside-transaction sites** (per `ADR-029`, not `ADR-036`)~~ | **FIXED** — `geo/service.ts`, `document-templates/service.ts`, and `attendance/service.ts` all updated to wrap audits in `$transaction`. | — | — |
| ~~6~~ | ~~**Orphaned S3 objects possible** — `storage.upload()` runs *before* the DB transaction with no compensating `storage.delete()`~~ | **FIXED** — Wrapped the DB transaction in a `try/catch` and added a compensating `storage.delete()` on failure. | — | — |
| 11 | **A newly created Worker/Checker is invisible to the Manager who created it, until that applicant submits for review** | Creation itself succeeds (`201`, correct `EmploymentRecord` + `Contract`, both `PENDING`). But `EmploymentRecord.hotel_group_id` is deliberately `null` until approval (`ADR-065` Decision 2), and the scope checks on the surfaces the creator lands on read **`hotel_group_id`**, not `target_hotel_group_id`. Three symptoms, one cause: (a) the UI redirects to `/users/<id>` after create, and that page renders **"Failed to load employment status"** and **"Failed to load contract status"** — `GET /employees/by-user/:id` → `403 "Record is outside your scope"` and `GET /hr/workers/:id/contract-status` → `403 "Cannot access worker …"`; (b) the new user does **not** appear in the Users tab (`GET /users` applies the same scope filter); (c) it is not in the Review Queue either — that is **by design**, `getReviewQueue` filters `submitted_for_review_at: { not: null }` (`employee-management/service.ts:1991-1993`). Net effect: the manager creates the account, sees two error banners, and then cannot see or track it anywhere until the applicant logs in, uploads six documents and submits. **The fix already exists and is simply not applied here:** `isWorkerInReviewerScope()` (`lib/scope.ts:166`, added 2026-08-13 for the review-queue gap) falls back to `target_hotel_group_id` when `hotel_group_id` is null, and falls through to the strict check once it is set. Today only `documents/routes.ts:88` uses it. | Looks like a failed creation to the operator; the created account appears lost. High confusion cost, and the natural next action (open the user, add documents) is unavailable | `lib/scope.ts` `isWorkerInGroupScope` (strict) vs `isWorkerInReviewerScope` (PENDING-aware); `employee-management/routes.ts:28` `GET /by-user/:user_id`; `hr/routes.ts:204` `contract-status`; `users` list scope filter | Route the two detail-page reads (and the Users list) through `isWorkerInReviewerScope`, matching `documents/routes.ts`. Decide separately whether an unsubmitted applicant should also appear in some manager-facing list — the Review Queue's `submitted_for_review_at` filter is deliberate, so that is a product question, not a bug |
| 14 | **Shift-summary PUT returns `500` on an invalid body instead of `422`** | `PUT /calendar/hotels/:hotel_id/shift-summaries/:date` calls `dailyShiftSummarySchema.parse(req.body)` (`calendar/shift-summary/routes.ts:68`) — the throwing form. The raised `ZodError` is not an `AppError`, so the error handler falls through to its generic branch and answers `500 INTERNAL_ERROR` with "An unexpected error occurred". Reproduced with `{"total_rooms":"abc"}`; the backend log shows a bare `ZodError`. Every other route in this repo uses `safeParse` + `ValidationError` (see `assignments/controller.ts`'s `zodDetails`, or the `validateQuery` middleware). Note the field names are also easy to get wrong from the scenario text — they are `stay_over_rooms`/`total_people_working`, not `stayover_rooms`/`workers_assigned` — and getting them wrong is exactly what produces the misleading 500. | A client sending a malformed summary is told the server broke, with no field-level detail, and the failure looks like an outage rather than bad input. Also pollutes error tracking with a non-incident | `backend/src/modules/calendar/shift-summary/routes.ts:68` (`.parse`, should be `.safeParse` + `ValidationError`); contrast `middleware/validation.ts` | Swap to `safeParse` and raise `ValidationError` with the Zod issues, matching the rest of the codebase. Cheap, contained fix |

## 2. Judgment calls awaiting the project owner

The following are **documented, deliberate** positions — not bugs — but were flagged as worth an
explicit yes/no:

1. ~~**`retention`'s deletion audit log is readable by any authenticated user**~~ — **FIXED
   2026-08-21**: `GET /retention/audit-log` is now gated `requireRole('admin')`
   (`retention/routes.ts:15`), closing the `OD-RETENTION-05` half of `SIR-RETENTION-003`. The
   `OD-RETENTION-10` half (this module's own internal authorization to call into each consuming
   module's delete mechanism during the sweep) remains genuinely OPEN, unaffected by this fix.
2. ~~**`document-templates` returns all templates platform-wide**~~ — **MOOT, 2026-08-13**: the
   Document Templates / Document Instances module was removed entirely (product decision — see
   `runs/2026-08-13-contract-feature-and-review-routing.md`), superseded by the HR Contract
   feature's mandatory full-time/part-time employment type and single default-contract PDF.
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
- **Concurrent transactions against the merged rating path** — PR #498 added a
  `SELECT … FOR UPDATE` on `User` inside `refreshWorkerOverallRating()`, and PR #495's
  `completeRework()` now takes that lock inside its own transaction. The absence of a
  deadlock was established by reading lock order across all six callsites, **not** by
  running concurrent transactions. Worth one real test before this path carries load.
- **Presigned-URL expiry** — the 15-minute TTL on evidence/document URLs is never allowed
  to elapse in any scenario, so a clock-skew or TTL regression would pass everywhere.

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
- **Missing AWS credentials do NOT always silently no-op.** The earlier note here ("stub storage
  still writes the DB row") only holds when `S3_BUCKET` is unset, which routes to
  `stubStorageClient`. When `S3_BUCKET` IS set (as it is in this repo's `backend/.env`, pointing
  at a real bucket) but the SDK's own default credential chain has no valid credentials/session
  (`aws login` expired, 2026-08-12), every upload hits the **real** S3 client path and fails hard
  with `CredentialsProviderError`, surfaced to the caller as a generic `500 INTERNAL_ERROR` — no
  document row is written at all, blocking `submit-for-review` for every applicant with a
  `409 "required documents are missing"`. Always confirm `aws sts get-caller-identity` first; if
  it fails and you need to exercise the rest of the onboarding pipeline (not S3 upload itself),
  temporarily commenting out `S3_BUCKET` in `.env` (never delete real credentials, never invent
  fake ones) forces the stub and unblocks the submit/approve/reject/assign chain — but that
  explicitly means document **storage** itself was not verified end-to-end, and must be reported
  as a gap, not folded into a pass. Restart `tsx watch` after any `.env` edit — it does not
  hot-reload environment variables, only source files.
- **`FEATURE_EMPLOYMENT_RECORD=false`** makes every `/employees` route 404 — the suite passes
  vacuously. Verify with a live request.
- **`FEATURE_JOBDISPATCH_PHASE2` (default off) breaks the ENTIRE calendar page, not just
  calendar-entries.** `GET /assignments/calendar-entries` 404s with the flag off (`"Assignment not
  found"`, a misleading message — it's a route-not-registered 404, not a real not-found). The
  calendar page's `entriesError` gate (`app/(protected)/calendar/page.tsx`) then hides its whole
  body behind `{entriesError ? <error card> : <everything, including ShiftSummaryPanel>}`, so with
  the flag off the shift-summary panel — and the placements grid, absences, everything — is
  unreachable for every role, which looks identical to "the feature doesn't exist" from the UI.
  This flag was unset in `backend/.env` for this session (default off, matching production
  posture) and had to be temporarily enabled to test the shift-summary panel at all; it was
  reverted before finishing. This coupling (an unrelated Job Dispatch flag gating the whole
  Calendar page, not just its own feature) is itself worth a follow-up ticket — out of scope to
  fix in this pass, noted here so the next session doesn't waste time re-diagnosing "why is the
  calendar broken."
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
- **A route that skips the `{status, data, meta}` response envelope breaks silently on the
  frontend, not loudly.** `frontend/lib/api.ts`'s `apiFetch` treats whatever JSON it gets back AS
  the envelope and returns `envelope.data`; a route that does `res.json(bareArrayOrObject)`
  instead of `res.json({status:'success', data, meta})` makes every caller receive `undefined` —
  no thrown error, no non-2xx status, just a value that blows up wherever the caller assumes a
  shape (`res.length`, `res.map`, etc.), often several lines away from the actual defect. This hit
  `calendar/shift-summary/routes.ts` (a plain `Router()` file, not the class-based controller
  pattern every sibling module uses) on **both** its GET and PUT handlers, and its manual
  `res.status(400/401).json({error:...})` error paths used a different, also-nonstandard shape.
  When adding a new route as a raw `Router()` handler rather than through a class controller,
  explicitly diff its response shape against a sibling controller method before considering it
  done — `tsc`, lint, and even a `200`/`201` from `curl` all looked completely fine here; only
  reading the actual JSON body (or a real browser console) caught it.
- **A local dev backend's `tsx watch` does not reload `.env` changes** — only source-file changes.
  Any environment-variable edit (feature flags, credentials, `S3_BUCKET`, etc.) needs a manual
  process restart (`pkill -f "tsx watch src/server.ts"` then re-launch) to take effect; otherwise
  you'll be debugging against the OLD env for several requests before noticing nothing changed.

## 7. Pinned capability-matrix divergences (read before "fixing" a failing capability test)

`backend/src/__tests__/capability-policy.test.ts` asserts every route gate against the
transcribed `ADR-030` §3 matrix, and `support/capability-violations.ts` pins the known
divergences. The suite requires the pinned set to match the actual set **exactly**, so both
introducing a new divergence *and* closing an existing one fail the build until the pin file is
deliberately edited. That is intentional — a silent pass/fail flip is worse than a loud list.

Currently pinned (six, all awaiting an `ADR-030` §3 matrix amendment):

- `C-10:manager@users:POST /` and `C-10:regional_manager@users:POST /` — **added 2026-08-12**
  (RULE A). `POST /users` widened from Admin-only to admit manager/RM; the target role each may
  mint is enforced in `users/service.ts` via `lib/role-hierarchy.ts#canCreateRole`, which this
  suite's seam (`requireRole`/`requirePermission` only) cannot see. Conflicts with `ADR-030` D-4
  ("account creation Admin-only, permanently", `SIR-USERS-002`).
- `C-15:manager@…POST /` and `C-15:regional_manager@…POST /` — Manager/RM may create records.
  Authority **restated 2026-08-12**: `ADR-065`'s broad `createEmployee` grant is now NARROWED by
  RULE A to exactly one level down. Route gate unchanged; target-role check added in
  `employee-management/service.ts`.
- `C-16:worker@…submit-for-review` and `C-16:checker@…submit-for-review` — self-service submit,
  **strengthened 2026-08-12** (RULE B) to self-ONLY for every role, admin included.

### RULE A / RULE B — project-owner decision, 2026-08-12

Two authorization rules were ratified by the owner and implemented in the same pass. Both
conflict with existing ADRs, and **the ADR amendments are still owed** (tracked in
`REMAINING_WORK.md`) — the code, the pins in `support/capability-violations.ts`, and
`backend/src/lib/role-hierarchy.ts`'s header are the authority trail until then.

**RULE A — "create is 1-level-down only."** `admin → regional_manager`,
`regional_manager → manager`, `manager → worker|checker`, `worker`/`checker` → nobody. Enforced
on BOTH creation surfaces (`users/service.ts#createUser`,
`employee-management/service.ts#createEmployee`) against the shared table in
`backend/src/lib/role-hierarchy.ts`. Previously the employment-record route admitted
admin/manager/RM with **no check on the target role at all** — that was the hole.

Consequences worth knowing before writing a test that assumes the old behaviour:
- **Nobody can create an `admin` account any more**, admin included (admin is one level below
  nothing). This subsumes the old `HOTFIX-AUTH-003` guard.
- **No peer creation** — a manager cannot create a manager.
- **Admin can no longer create a worker/checker employment record.** Admin → RM only. Since
  `bulkImport` is Admin-only and routes every row through `createEmployee`, admin bulk-import is
  likewise RM-only now.

**RULE B — "nobody may perform another user's onboarding."** Document upload and
submit-for-review are SELF-SERVICE ONLY, for every role including admin.
- submit-for-review: the self-check in `assertLifecycleAuthority` now precedes the `admin`
  early-return. **The ordering is the security property** — the old ordering let admin
  short-circuit past the self-check, which was the bypass.
- upload: enforced at BOTH the route (`documents/routes.ts#requireSelfWorker`) and the service.
  This REVERSES `GD-16`'s "manager-upload (actor 2)" allowance and the 2026-08-04
  Regional-Manager widening.
- **NOT in scope:** approve/assign/reject/deactivate/reactivate/rehire remain hierarchy actions
  (a Manager's application is still approved by an RM or Admin) and are NOT narrowed to
  1-level-down. `onboarding-self-only.test.ts` asserts this explicitly so a future
  over-application of RULE B to the whole lifecycle fails loudly.
- One deliberate exemption: `DocumentService.uploadDocument`'s `systemGenerated` flag, for the
  HR contract-scan and rendered-template-PDF paths (documents ABOUT a worker, not that worker's
  onboarding). **Unreachable from HTTP** — no controller sets it. Never plumb it to a
  request-controlled value.

**If a capability test fails**, do not edit the matrix or delete the assertion. Either the change
is legitimate (add a pin with its authority and remediation owner) or it is an accidental
authorization widening (revert the code).

## 6. Fixed — history (do not re-investigate, but do regression-test)
### 2026-08-24 — Two rating paths, one unevidenced; and four i18n keys that never existed

Found during a code-level audit of the checker app against its backend routes.

**Mobile shipped a second, spec-violating rating path.** `rating/[id].tsx` was a **1–5 star
picker** (`score × 20`) writing to `Rating`, alongside `quality/[id].tsx`'s CRR-compliant 0–100
photo-required screen writing to `QualityVerification`. CRR §15 says "Quality score is 0–100
(**not** a 5-star system)". Worse, only `Rating` feeds `WorkerOverallRating` — so the compliant
screen could not move a worker's standing, while the non-compliant one could, with no photo.
Retired the screen, its route registration, and its nav link.

**`Rating` had no photo capability at all**, so CRR §15 was unenforceable on the one model that
drives the leaderboard. Added `Rating.photo_urls` (migration
`20260824211701_add_rating_photo_evidence`, with paired `down.sql`), S3 upload via the existing
`uploadPhotos()` with a new `'rating'` key kind, a `GET /quality/ratings/:id/photos` retrieval
endpoint mirroring the verification one (**including its checker-assignment gate rather than JWT
scope** — checkers never receive a scope), a required photo picker in the web ratings modal, and
enforcement in `createRating()` placed after authorization. `POST /quality/ratings` now accepts
multipart; `criteria_scores` is JSON-stringified into one field because multipart cannot carry a
nested object. `createRating()` was also restructured so the assignment lookup and authorization
run outside the transaction, keeping the S3 upload off the row locks — matching
`createVerification()`.

**Four i18n keys were referenced but never defined.** `quality.photos`, `quality.photosHint`,
`quality.tooManyPhotos`, `quality.photoTooLarge` are used by the photo UI on **both** clients but
existed in **none** of the 12 locale files, so those labels rendered as raw key strings
(`quality.photos`) in all six languages. Added across web and mobile, with `photoRequired` and
`evidence`. Pre-existing and unrelated to the rating work — found only because the new picker
reused the same keys.

Regression tests: `quality-scope-authz.test.ts` "refuses a rating with no photo, even in scope";
`inspection-checklist-http.test.ts` "rejects a rating with no photo (CRR §15)".

### 2026-08-24 — Checker evidence flow: photo requirement unenforced, and checkers locked out of their own photos

Both found while walking scenario 12 against a live stack, both fixed the same day.

**A rating could be submitted with no photo.** `POST /quality/verifications` returned `201` and
stored `photo_urls = {}`. `createVerification()` carried the CRR §15 comment above its `photos`
parameter but never length-checked it, while the worker half of the same clause
(`completeRework`) did enforce it. Fixed by adding the matching guard, placed **after** the
authorization branches so an out-of-scope actor still gets `403`, not a validation hint.
Regression test: `quality-scope-authz.test.ts` "refuses a rating with no photo, even in scope".

**A Checker could never read evidence photos, including its own.**
`GET /quality/verifications/:id/photos` gated `checker` through
`isHotelInScope(actor.scope, …)`, but `auth/service.ts#resolveScope` mints a scope only for
admin/RM/manager — a checker's JWT always carries `scope: null`, so the check could never pass.
This broke the checker app's verification screen outright. Fixed by gating the checker on the
same rule `createVerification` already uses for that role (an active assignment at that hotel),
which needs no JWT scope and keeps read and write consistent. Deliberately **not** fixed by
teaching `resolveScope` to mint a checker scope — that would change every scope-gated route at
once. Regression tests: `quality-photos-authz.test.ts` "admits a checker … WITHOUT any JWT
scope" / "REFUSES a checker with no active assignment at that hotel".


| Defect | Fixed in |
|---|---|
| Multipart `score` rejected as a string — every photo-bearing quality rating failed validation, invisible to JSON-bodied unit tests | `87c565c` (#495) — `quality/types.ts`, `z.coerce.number()` |
| IDOR: any worker could read any other worker's quality evidence photos (workers hold `quality:read` per ADR-067, so manager-scoped authorization was not a gate) | `87c565c` (#495) — `getVerificationPhotos`, deny-by-default |
| `completion_rate` / `on_time_rate` could exceed 100% — rework rows counted in the numerator but not the denominator (recurred twice in one PR: fixing one metric reintroduced it in its sibling) | `87c565c` (#495) — ADR-069 `rework_of_assignment_id: null` on both sides |
| Rework escalation reported a worker overdue to their Manager and Checker even when they completed between the job's SELECT and its CLAIM | `87c565c` (#495) — claim re-checks `rework_completed_at` |
| Calendar shift-summary panel invisible to Admin/RM (gated on `scopeHotelId`, always null for those roles) | uncommitted, 2026-08-12 session — `frontend/app/(protected)/calendar/page.tsx` |
| Calendar shift-summary GET/PUT responses skip the standard `{status,data,meta}` envelope, breaking the read for every role (not just Admin/RM) with a silent `undefined` and a console `TypeError` | uncommitted, 2026-08-12 session — `backend/src/modules/calendar/shift-summary/routes.ts` |
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
| Review queue routed to admin/scope-only instead of the creator's own superior — a manager's own worker-application could effectively self-review by scope, and the reviewer had no visibility into who actually created the application | uncommitted, 2026-08-13 session — `backend/src/modules/employee-management/service.ts` `getReviewQueue`; new `EmploymentRecord.created_by_id` column |
| Reviewer (manager/RM) opening the rebuilt Review Queue modal for ANY not-yet-approved applicant got a 403 on document completeness, 100% of the time — `isWorkerInGroupScope()` denies by design whenever `EmploymentRecord.hotel_group_id` is null, which is true for every application still PENDING review (the group is only set on approval). Found while browser/API-verifying the rebuilt `ReviewQueueTable`, not by a unit test (those mock the DB layer). Fixed with a new read-only, reviewer-scoped primitive (`isWorkerInReviewerScope`, falls back to `target_hotel_group_id`/`target_primary_hotel_id` pre-approval) rather than widening the shared `checkWorkerScope()`/`resolveWorkerScope()` used by write routes elsewhere (HR contract-scan/confirm/extend/lapse) — verified live: RM can now view a pending applicant's document completeness; an out-of-scope manager is still denied. | uncommitted, 2026-08-13 session — `backend/src/lib/scope.ts` `isWorkerInReviewerScope`; `backend/src/modules/documents/routes.ts` `scopeWorkerReadRoute` |
| `ReviewQueueTable.tsx` used raw `<table>`/`<thead>` instead of the shared `Table`/`THead`/`TBody`/`TR`/`TH`/`TD` components, `<Badge color="blue">` (not a real prop — `Badge` only accepts `tone`), a hand-rolled `<textarea>` instead of `Textarea`, and `useHotels`/`useHotelGroups` destructured as a bare array (`data:`) when the hooks return `{ hotels, groups, ... }` — the "Assign" modal's hotel/group `<Select>` was silently always empty. Also: the review-queue page bypassed `RoleGate` with a hand-rolled `useAuth()` check. | uncommitted, 2026-08-13 session — `frontend/components/onboarding/ReviewQueueTable.tsx`, `frontend/app/(protected)/onboarding/review-queue/page.tsx` |
| Worker document uploads had no delete/replace path — re-uploading the same category created a second row rather than replacing the first (no unique constraint on `(worker_id, category)`), and reviewers had a write-shaped gap risk since the module previously granted no write route to any non-worker role at all but was worth closing explicitly | uncommitted, 2026-08-13 session — `backend/src/modules/documents/service.ts` `deleteDocument`; `backend/src/modules/documents/routes.ts`; `frontend/components/documents/DocumentsCard.tsx` |

---

## Maintenance rule

**Every time this suite is run, update it in the same pass:**
- Move newly-fixed items from §1 into §6 with the commit hash.
- Add newly-found defects to §1 with a reproduction.
- Tick off anything from §3/§4 that got covered, and add whatever new gaps you noticed.
- Append a run log under `runs/` (template in `../README.md`) — never overwrite a previous one.

A defect found and fixed but **not recorded here will be rediscovered from scratch**. That has
already happened more than once in this project.
