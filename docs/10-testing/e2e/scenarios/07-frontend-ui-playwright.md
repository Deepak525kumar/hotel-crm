# Scenario 07 — Frontend UI Walkthrough (Playwright)

Drives the real browser against the running stack. **This is not optional or redundant with the
API scenarios** — the single worst defect found in this feature (`/onboarding` crashing to an
ErrorBoundary, making document upload impossible) was invisible to 2,687 passing unit tests,
`tsc --noEmit`, and `eslint`. Only a browser found it.

**Preconditions:** Scenario 00 complete, **both** servers running. Test through **`:3000`**
(the Next.js proxy) so httpOnly auth cookies work same-origin — never hit `:3001` directly from
the browser.

## Setup

```bash
npx playwright install chromium     # once
```

Write a throwaway harness (`e2e-ui.mjs` in the repo root), run it, then **delete it** and
confirm `git status` is clean. Next.js 16 may regenerate `frontend/AGENTS.md` on dev-server
start — revert that too; it is not your change.

Harness skeleton:

```js
import { chromium } from 'playwright';
const BASE = 'http://localhost:3000';
async function login(page, email, pw) {
  await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(700);
  await page.locator('input[type="email"], input[name="email"]').first().fill(email);
  await page.locator('input[type="password"]').first().fill(pw);
  await page.locator('button[type="submit"]').first().click();
  await page.waitForTimeout(3000);
  return !page.url().includes('/login');
}
// ALWAYS attach these — a silent React crash is otherwise invisible:
page.on('pageerror', e => console.log('PAGEERROR:', e.message));
page.on('console',  m => { if (m.type() === 'error') console.log('CONSOLE:', m.text()); });
```

> **Ignore the benign 401s.** `GET /auth/me` and `POST /auth/refresh` return 401 on the login
> page before authentication. That is normal startup behaviour, not a defect.

---

## Step 1 — Role-gated navigation

Log in as each role and read the sidebar text.

| Role | "My Onboarding" | "Review Queue" |
|---|---|---|
| worker | **yes** | **no** |
| checker | **yes** | **no** |
| manager | yes | yes |
| regional_manager | yes | yes |
| admin | **NO** (`ADR-065` §6.9) | yes |

Admin seeing "My Onboarding" is a **FAIL** — Admin has no onboarding.

## Step 2 — Worker: `/onboarding` renders the full checklist

**Corrected 2026-09-02** — verified live via Playwright. **PASS:** all six category labels
visible (Tax Number, Social Security Number, Health Insurance, ID Card, Passport, Proof of
Address) and **seven `input[type=file]` elements** present, not six — the seventh is the
"Signed Contract" (`CONTRACT_SCAN`) upload, which renders as part of the same page's
Contract card, below the six required-document rows. This is correct, existing behavior, not
a regression; the original "six" count simply didn't account for the contract upload sharing
the page. Also confirm the daily consent gate: an unconsented user sees the consent notice
instead of the checklist (correct, tested separately in scenario 11) — grant it first or this
step will read as a false failure.

**FAIL:** zero file inputs and/or a `pageerror` — this is the regression signature of the
`categories` vs `by_category` crash. Check the console output, not just the visible page.

## Step 3 — Real uploads through the browser

```js
await page.locator('input[type="file"]').first().setInputFiles('/tmp/e2e-doc.pdf');
```

**Important harness gotcha:** the list re-renders after each successful upload, so `nth(i)`
handles go stale and later uploads time out. Loop with a **re-query each pass** (reload
`/onboarding`, take the first enabled input, upload one, repeat) rather than iterating a
snapshot of the locators.

**PASS:** each category flips to "Uploaded"; verify against the API/DB that
`document_count` reached 6 — screen text alone is not proof.

## Step 4 — Client-side upload guards

| Input | Expected |
|---|---|
| 11 MB file | visible size error; upload rejected |
| `.txt` file | type-related message; input carries `accept=".pdf,image/jpeg,image/png,image/webp"` |

## Step 5 — Submit for Review

**PASS:** the button is enabled once the checklist is complete and the submit **actually
persists** (`submitted_for_review_at` non-null in the DB).

**Note, confirmed live 2026-09-02:** "checklist complete" (six documents) is not the only
gate — the signed contract is also required (see `01-onboarding-happy-path.md` Step 6), and
the button does **not** disable itself for a missing contract, only for missing documents.
Clicking Submit with docs-complete-but-no-contract produces a real `409` — but this is not a
silent failure: the backend's exact message
(`"Cannot submit for review: please download your contract, sign it, and upload the signed
copy first."`) renders correctly in red text directly below the button
(`app/(protected)/onboarding/page.tsx`'s `submitError` state), confirmed via a real click in a
real browser. Initially suspected as a silent-failure defect from an early, hastily-written
harness check; a second, more careful pass confirmed the error genuinely renders — recorded
here so this isn't rediscovered as a false alarm.

**CLOSED, corrected 2026-09-02.** The route now reads
`requireRole(['admin', 'manager', 'regional_manager', 'worker', 'checker'])`
(`employee-management/routes.ts`), with a comment explaining the deliberate omission of
`requirePermission('employees:write')` — workers/checkers only hold `employees:read`, and
self-submission authorization is enforced inside `assertLifecycleAuthority` in the service
layer instead. Extensively re-confirmed via direct API calls throughout the 2026-09-02
sessions: a worker's own `submit-for-review` call succeeds repeatedly (dozens of times) when
their own documents/contract are complete, refuses correctly when they aren't (409, naming
the missing categories), and refuses submitting on someone else's behalf ("Only the applicant
may submit their own application for review"). Verify **as a worker** going forward — a
manager-only submit no longer exercises the self-service path this step is actually testing.

## Step 6 — Manager: Review Queue → Review modal → Approve

**PASS:** the submitted applicant appears; clicking **Review** opens a modal showing applicant
details; **Approve & Activate** is enabled and clicking it transitions the record to `ACTIVE`
(**verify in the DB**).

Also confirm the queue does **not** list applicants from another hotel group.

## Step 7 — Double-click Approve (UI race)

See scenario 05 step 6. At most one successful approval; one history row.

## Step 8 — Negative navigation

- Worker → `/onboarding/review-queue` directly: **no applicant data rendered**.
- Already-`ACTIVE` worker → `/onboarding`: **no Submit button**. (Known: the surrounding copy
  is still stale — scenario 06 §H.)

## Step 9 — Assign from the UI

**CLOSED, corrected 2026-09-02 — the "no assign UI" claim is stale in two directions.**

**Path 1, inline post-approval:** `employeesApi.assign` (`POST /employees/:id/assign`) IS
called from the UI — `components/onboarding/ReviewQueueTable.tsx`'s post-approval modal,
which appears immediately after clicking Approve and offers a hotel/group picker. Driven live
via a real browser click: `POST /employees/:id/assign` returned `200`, and
`Hotel.manager_user_id` / `HotelGroup.regional_manager_user_id` updated correctly in Postgres.
This modal is reachable **only** in the single moment right after approval, not later — an
already-Active-Unassigned record no longer appears in the review queue (the queue filters on
`PENDING` + `submitted_for_review_at`), so this path cannot re-assign someone approved earlier.

**Path 2, persistent, on the user's own profile page:** a separate "Edit assignment" control
exists on `/users/:id` at all times, calling `PUT /users/:id/role` (`updateUserRole` —
`users/service.ts`, the older person-centric-redesign write path, distinct from `assign()`).
Driven live: opened a real Active-Unassigned RM's profile, clicked "Edit assignment", picked a
group, saved — `200`, `HotelGroup.regional_manager_user_id` correctly set.

**REAL DEFECT found via Path 2, fixed in the same pass.** `updateUserRole`'s Manager/RM
assignment branches wrote the live cross-entity pointer (`Hotel.manager_user_id` /
`HotelGroup.regional_manager_user_id`) but never synced
`EmploymentRecord.hotel_group_id`/`primary_hotel_id` — unlike the sibling worker/checker
branch in the same function, which has always done both. `listUsers()`'s scope filter matches
a Manager's own visibility via a `managed_hotels` OR-branch (self-healing off
`Hotel.manager_user_id`), but has **no equivalent** for a Regional Manager's group ownership —
so a freshly-assigned RM was invisible in every scoped user listing, **including their own**,
despite holding real, working authority (`resolveScope()` reads the Hotel/HotelGroup pointer
directly, so JWT scope and review-queue access were both genuinely correct — only `listUsers()`
visibility broke). This is the same class of bug `08-known-gaps-and-next.md` item 11 already
records for a different symptom (a newly-created applicant invisible pre-approval) — same root
cause shape (a live scope column left unsynced by one write path while another assumes it),
different write path.

Fixed by adding the same sync for Manager (`primary_hotel_id`, plus `hotel_group_id` derived
from the hotel — `null` when the hotel itself has no group, verified live) and Regional
Manager (`hotel_group_id`) branches, mirroring the existing worker/checker pattern. Verified
live end-to-end for both roles: a freshly-promoted RM assigned via this endpoint now
correctly appears in their own `GET /users` listing; a freshly-promoted Manager assigned to
an ungrouped hotel correctly gets `primary_hotel_id` set with `hotel_group_id` left `null`
rather than guessed. Three new unit tests in `users.test.ts`. Full backend suite: 148 suites,
3580 tests, serial, all passing.

## Step 10 — Console hygiene

**PASS:** no `pageerror`, and no console errors other than the benign pre-auth 401s.

---

## Pass criteria summary

- [x] Nav gating correct for all five roles (esp. Admin has no "My Onboarding") — verified live
- [x] `/onboarding` renders six categories and **seven** file inputs (the 7th is the Signed
      Contract upload, sharing the page — corrected from the original "six"), no pageerror
- [x] Real browser uploads persist (verified in DB, not just on screen)
- [x] Oversize and wrong-type files rejected with visible messages; `accept` attribute present
- [x] Submit persists (verified **as a worker** — the self-service path this criterion is
      actually about; the old "as manager today" caveat is stale, see Step 5)
- [x] Manager queue → modal → approve works, verified in DB
- [x] Queue excludes other groups' applicants
- [x] Double-click yields at most one approval
- [x] Worker at manager-only URL leaks nothing
- [x] No unexpected console/page errors
- [x] Harness deleted; `git status` clean (including `frontend/AGENTS.md`) — confirmed after
      every run this pass

## Not yet covered — candidates for next time

- **Reject** flow from the UI (only Approve has been exercised)
- Presigned-document **viewing from the review modal** (does the reviewer's "view document"
  link actually open the file?)
- Manager's and RM's **own** "My Onboarding" pages (only the Worker's was walked)
- Mobile/responsive layout and keyboard-only navigation
- Accessibility: labels on file inputs, focus management in the modal, screen-reader status text
- Session expiry mid-flow (token expires between upload and submit)
- Slow/failed network: upload timeout, offline behaviour, partial-upload recovery
- Multi-tab: same user approving in two tabs simultaneously
- Browsers other than Chromium

## Defects this scenario has caught

| Symptom | Root cause |
|---|---|
| `/onboarding` entirely broken, no file inputs | Frontend read `by_category`; backend sends `categories` |
| Worker cannot submit (403) with a misleading error | Route excludes worker/checker; catch-all message wrong |
| No way to assign from the UI | `employeesApi.assign` fetcher never written |
