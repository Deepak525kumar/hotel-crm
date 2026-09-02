# E2E Run — 2026-09-02 (fourth pass) — scenario 07, Steps 1-5 (Playwright)

- **Commit under test:** `bb9c7f37` (main) plus `fix/manager-queue-guard-and-reactivate-scope`
  (PR #622)
- **Environment:** local dev — backend (`:3001`), frontend (`:3000`, started this pass), real
  Postgres, real S3, headless Chromium via Playwright 1.62.1 (already installed)
- **Executed by:** Claude (agent), continuing the user's instruction to run the remaining
  scenarios and author new ones
- **Stack versions:** unchanged

## Results

Steps 1–5 of 9 run live, all through a real browser against the real running stack, not API
calls. Two stale "known defect" notes were closed; one investigation initially looked like a
third but turned out to be a false alarm from a rushed first check.

| Step | Result |
|---|---|
| 1 — Role-gated navigation | PASS, all 5 roles. worker/checker: "My Onboarding" yes, "Review Queue" no. manager/regional_manager: both yes. admin: "My Onboarding" **no** (correct, ADR-065 §6.9), "Review Queue" yes. Matches the documented table exactly |
| 2 — Worker `/onboarding` checklist renders | PASS, with a correction: 7 `input[type=file]` elements, not 6 — the 7th is the "Signed Contract" upload sharing the same page. Not a regression; the original count just didn't account for it |
| 3 — Real uploads through the browser | PASS. All 6 required documents uploaded via real `setInputFiles` calls; confirmed at the data layer (not just screen text, per the scenario's own rule): `document_count: 6`, `is_complete: true` |
| 4 — Client-side upload guards | PASS, both cases confirmed precisely via before/after DOM diff (not a loose regex, which had a false-positive risk from unrelated page text like "Employment type"): oversized file → `"File exceeds 10MB limit."`; wrong file type → `"Unsupported file type or unexpected field"` |
| 5 — Submit for Review | PASS, with a note. The button doesn't disable itself for a missing signed contract (only for missing documents) — clicking it in that state produces a real `409`, but the backend's exact message renders correctly in red text below the button. Initially misread as a silent-failure defect by a rushed first check with no scroll/timing care; a second, careful pass with a more precise selector confirmed it renders correctly |

## New defects found

None. Two doc corrections and one closed false alarm — no code defects this pass.

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

- Steps 6–9: manager review-queue → modal → approve flow, the double-click approve race
  (cross-referenced to scenario 05), negative navigation for worker/already-active accounts,
  and the documented assign-UI gap (no `employeesApi.assign` fetcher exists — confirm this is
  still true). None attempted this pass; time-boxed to close out Steps 1–5 thoroughly rather
  than run all nine shallowly.

## Scenario files updated this run

- `07-frontend-ui-playwright.md` — Step 1 unchanged (matched exactly); Step 2 corrected (file
  input count); Step 5 extended with the submit-error-rendering note; the stale "KNOWN OPEN
  DEFECT" replaced with a "CLOSED, corrected" note and evidence
- `08-known-gaps-and-next.md` — item 10 corrected (environment-dependent, not a standing code
  defect)
- `README.md` — scenario 07's index entry updated to reflect Steps 1-5 run
