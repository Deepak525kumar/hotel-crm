# E2E Run — 2026-09-02 (fourth pass) — scenario 07, all 9 steps (Playwright)

- **Commit under test:** `bb9c7f37` (main) plus `fix/manager-queue-guard-and-reactivate-scope`
  (PR #622)
- **Environment:** local dev — backend (`:3001`), frontend (`:3000`, started this pass), real
  Postgres, real S3, headless Chromium via Playwright 1.62.1 (already installed)
- **Executed by:** Claude (agent), continuing the user's instruction to run the remaining
  scenarios and author new ones
- **Stack versions:** unchanged

## Results

All 9 steps run live, through a real browser against the real running stack, not API calls.
Two rounds of testing on the same day: Steps 1–5 first (closing two stale "known defect"
notes and one false alarm), then Steps 6–9 (closing a third stale note and finding one real,
fixed defect).

| Step | Result |
|---|---|
| 1 — Role-gated navigation | PASS, all 5 roles. worker/checker: "My Onboarding" yes, "Review Queue" no. manager/regional_manager: both yes. admin: "My Onboarding" **no** (correct, ADR-065 §6.9), "Review Queue" yes. Matches the documented table exactly |
| 2 — Worker `/onboarding` checklist renders | PASS, with a correction: 7 `input[type=file]` elements, not 6 — the 7th is the "Signed Contract" upload sharing the same page. Not a regression; the original count just didn't account for it |
| 3 — Real uploads through the browser | PASS. All 6 required documents uploaded via real `setInputFiles` calls; confirmed at the data layer (not just screen text, per the scenario's own rule): `document_count: 6`, `is_complete: true` |
| 4 — Client-side upload guards | PASS, both cases confirmed precisely via before/after DOM diff (not a loose regex, which had a false-positive risk from unrelated page text like "Employment type"): oversized file → `"File exceeds 10MB limit."`; wrong file type → `"Unsupported file type or unexpected field"` |
| 5 — Submit for Review | PASS, with a note. The button doesn't disable itself for a missing signed contract (only for missing documents) — clicking it in that state produces a real `409`, but the backend's exact message renders correctly in red text below the button. Initially misread as a silent-failure defect by a rushed first check with no scroll/timing care; a second, careful pass with a more precise selector confirmed it renders correctly |
| 6 — Manager: Review Queue → modal → Approve | PASS, fully. A real submitted applicant appeared in the manager's queue; clicking Review opened a modal with accurate per-document status (correctly showed one category as still not-uploaded — my own harness had skipped it, and the UI reflected the true state); "Signed contract received — approving will confirm it" banner rendered; clicking "Confirm contract & approve" produced zero network/page errors and transitioned the record — verified in Postgres: `status: ACTIVE`, `hotel_group_id`/`primary_hotel_id` set, `Contract.status: ACTIVE` with `confirmed_by_id` set. Cross-group exclusion also confirmed: a second applicant targeting a different group never appeared in this manager's queue |
| 7 — Double-click Approve (UI race) | PASS. Two near-simultaneous clicks on the Approve button produced only ONE network call — the frontend's own click-handling prevented the second click from ever reaching the server. Verified clean resulting state in Postgres: `version: 2`, exactly one `PENDING → ACTIVE` history row |
| 8 — Negative navigation | PASS, both cases. A worker hitting `/onboarding/review-queue` directly sees no applicant data — a clean "You do not have permission to view the review queue" message, not a data leak or crash. An already-`ACTIVE` worker visiting `/onboarding` correctly has no Submit button; the known stale surrounding copy (scenario 06 §H) was re-confirmed present, exactly where already tracked — no new action needed |
| 9 — Assign from the UI | **CLOSED (stale "no assign UI" claim), and found+fixed one real defect.** See below |

## New defects found

**`updateUserRole`'s Manager/Regional Manager assignment branches never synced
`EmploymentRecord`** — `backend/src/modules/users/service.ts`. MEDIUM severity: no
authorization impact (`resolveScope()` reads the live `Hotel`/`HotelGroup` pointer directly,
so a freshly-assigned Manager/RM's JWT scope and review-queue access were both genuinely
correct) — but real, user-visible impact: `listUsers()`'s scope filter reads
`EmploymentRecord.hotel_group_id`, and this write path never set it for Manager/RM
assignments (unlike the sibling worker/checker branch in the same function, which always has).
A Manager's own case happened to self-heal via a separate `managed_hotels` OR-branch reading
`Hotel.manager_user_id` directly; a Regional Manager's case had no equivalent, so a
freshly-assigned RM was invisible in every scoped `GET /users` listing — including their own.

Found while investigating scenario 07 Step 9's "no assign UI" claim: that claim turned out
false in two directions. There IS an inline post-approval assign flow
(`ReviewQueueTable.tsx`, calling `POST /employees/:id/assign` — driven live, `200`, correct
DB writes) but it's reachable only in the single moment right after Approve. There is ALSO a
persistent "Edit assignment" control on every user's own profile page, calling a *different*
endpoint (`PUT /users/:id/role`) — and driving that one live is what surfaced the sync gap:
promoted a real Active-Unassigned RM to a group through it, and their own `GET /users` call
came back without themselves in the list.

**Fixed:** added the same `EmploymentRecord` sync to both branches (`primary_hotel_id` plus a
derived `hotel_group_id` for Manager; `hotel_group_id` for Regional Manager), mirroring the
existing worker/checker pattern in the same function. Verified live end-to-end for both
roles, including the ungrouped-hotel edge case (Manager assigned to a hotel with no group of
its own correctly gets `primary_hotel_id` set and `hotel_group_id` left `null`, not guessed).
Three new unit tests in `users.test.ts`. Full backend suite: 148 suites, 3580 tests, serial,
all passing.

## Confirmed NOT defects (investigated, ruled out)

- **Scenario 07's "KNOWN OPEN DEFECT — worker gets 403 on submit"** — stale. The route is
  `requireRole(['admin', 'manager', 'regional_manager', 'worker', 'checker'])`
  (`employee-management/routes.ts`), with a comment explaining the deliberate design (workers/
  checkers hold only `employees:read`; self-submission is enforced inside
  `assertLifecycleAuthority` instead). This session alone made dozens of successful worker
  self-submit calls. `08-known-gaps-and-next.md` item 1 already correctly recorded this as
  fixed 2026-08-12 — only scenario 07's own note was stale. Corrected.
- **"Six `input[type=file]` elements"** — undercounted by one; see Step 2 above. Not a
  regression.
- **"Submit fails silently with no error shown"** — false alarm from my own first, rushed
  check (no wait for element visibility, loose text-diff timing). A second, careful check
  (explicit `waitFor({state: 'visible'})`, a precise `p.text-red-600` selector) confirmed the
  real backend message renders correctly. Recorded here specifically so this false alarm
  isn't rediscovered and mistaken for a real defect by a future run.
- **`08-known-gaps-and-next.md` item 10** ("document upload cannot be exercised end-to-end
  locally") — also stale, corrected in the same pass as a byproduct of noticing it while
  reading 08 for the submit-403 cross-reference. This session's AWS credentials are valid, and
  the positive upload path has been exercised dozens of times with real S3 objects confirmed
  via `head-object`. The row is kept (not deleted) because the underlying fact — a missing-
  credentials failure surfaces as an unhelpful bare `500` rather than a `503` with guidance —
  is still real for whichever environment next lacks credentials.

## Could not test / not run this pass

All 9 steps have now been run. Not attempted anywhere in this pass: scenario 05's own
double-click-approve step (this run's Step 7 exercised the review-queue's own UI race, not
whatever scenario 05 Step 6 covers independently — cross-check the two are actually the same
assertion, or run scenario 05 separately).

## Scenario files updated this run

- `07-frontend-ui-playwright.md` — Step 1 unchanged (matched exactly); Step 2 corrected (file
  input count); Step 5 extended with the submit-error-rendering note; Step 9 rewritten in full
  (the "no assign UI" claim was stale in two directions; the real defect and its fix
  documented); the stale "KNOWN OPEN DEFECT" (Step 5, worker submit) replaced with a "CLOSED,
  corrected" note and evidence
- `08-known-gaps-and-next.md` — item 10 corrected (environment-dependent, not a standing code
  defect)
- `README.md` — scenario 07's index entry updated to reflect Steps 1-5 run
