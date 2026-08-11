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

**PASS:** all six category labels visible (Tax Number, Social Security Number, Health Insurance,
ID Card, Passport, Proof of Address) and **six `input[type=file]` elements** present.

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

**KNOWN OPEN DEFECT — expect this to fail as a worker.** `POST /submit-for-review` is gated
`requireRole(['admin','manager','regional_manager'])`, so a **worker gets 403**. The UI shows an
enabled button and the catch-all shows *"Ensure all required documents are uploaded"* — a
misleading message, since they were. Until resolved, verify submit **as a manager** to proceed,
and re-check whether the worker case has been fixed. See `08-known-gaps-and-next.md` item 1.

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

**KNOWN GAP:** there is **no assign UI and no `employeesApi.assign` fetcher**. `POST
/employees/:id/assign` is unreachable from the browser, so an approved Manager/RM stays
*Active, Unassigned* as far as a UI user is concerned. Re-check whether this has been built; if
so, test: approve → assign (hotel picker) → verify `Hotel.manager_user_id` in the DB.

## Step 10 — Console hygiene

**PASS:** no `pageerror`, and no console errors other than the benign pre-auth 401s.

---

## Pass criteria summary

- [ ] Nav gating correct for all five roles (esp. Admin has no "My Onboarding")
- [ ] `/onboarding` renders six categories and six file inputs, no pageerror
- [ ] Real browser uploads persist (verified in DB, not just on screen)
- [ ] Oversize and wrong-type files rejected with visible messages; `accept` attribute present
- [ ] Submit persists (as manager today; re-check worker)
- [ ] Manager queue → modal → approve works, verified in DB
- [ ] Queue excludes other groups' applicants
- [ ] Double-click yields at most one approval
- [ ] Worker at manager-only URL leaks nothing
- [ ] No unexpected console/page errors
- [ ] Harness deleted; `git status` clean (including `frontend/AGENTS.md`)

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
