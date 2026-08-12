# E2E Run — 2026-08-12 — onboarding + calendar shift-summary + reject-modal

- **Commit under test:** `08f8164` (local `main`, after merging `origin/main` — see "Repository
  state" below; this merge commit is itself part of this run's work, not pre-existing)
- **Environment:** local dev (`docker compose` Postgres/Redis, backend `tsx watch` on :3001,
  frontend Next.js dev server on :3000)
- **Executed by:** Claude (agent session)
- **Stack versions:** backend Node/tsx (see `backend/package.json`), frontend Next.js 16,
  Postgres via `hotel-crm-postgres-1` container

## Repository state (found, not assumed)

Local `main` was 12 commits ahead of `origin/main` (the ADR-065 onboarding-gate work from an
earlier session) and 3 commits **behind** it (PR #412/#413, the daily-shift-summary feature this
task was asked to test). The running dev servers were built from the stale local `main`, which is
why `GET /calendar/shift-summary` 404'd at the very start of this run — **the feature under test
did not exist in the running code at all** until the branches were merged. Resolved with
`git merge origin/main` (four conflicts: `schema.prisma`'s `Hotel.shift_summaries` relation line,
`08-known-gaps-and-next.md`'s add/add history divergence — took origin/main's superset version,
`ReviewQueueTable.tsx`'s reject-modal vs `window.prompt()` — took origin/main's modal version per
this task's own briefing, `types.ts`'s `AssignEmploymentInput` nullability — took origin/main's
narrower `string | undefined` fix). Backend suite re-run clean (108/108) after the merge, before
any further changes, to confirm the merge itself introduced no regression.

## Results

| Scenario | Result | Notes |
|---|---|---|
| Worker onboarding (upload 6 docs → submit) | PASS | Real browser, real API, real DB. `submitted_for_review_at` confirmed non-null in Postgres. |
| Manager onboarding (upload 6 docs → submit) | PASS | Same, for a Manager applicant. `submitted_for_review_at` confirmed in Postgres. |
| Reject flow (React modal, not `window.prompt()`) | PASS | Confirmed the modal (a `<textarea>`, not a native dialog) renders and submits; `EmploymentRecord.status` transitioned `PENDING → REJECTED` in Postgres for the real applicant. |
| Approve → assign UI (Manager, hotel target) | PASS | Required provisioning a fresh applicant through the full real chain (Personalfragebogen → HR contract → contract-scan → contract-confirm → 6 documents → submit) because the approve gate's contract precondition is enforced unconditionally. `EmploymentRecord.status = ACTIVE`, `primary_hotel_id` set, and `Hotel.manager_user_id` confirmed pointing back to the user in Postgres. |
| Calendar shift-summary — Manager writes | PASS | Real browser form entry (42/30/12/5 + notes) against the newly-active Manager's own (fixed) hotel; identical row confirmed in Postgres. |
| Calendar shift-summary — Admin views (the reported gap) | PASS, after 2 real fixes | See "Fixes" below. Confirmed via browser render (no console errors) after picking the hotel from the **existing** `CalendarFilters` dropdown, not a new filter. |
| Calendar shift-summary — RM views | NOT INDEPENDENTLY VERIFIED | No RM test credentials available without disturbing an existing group's assigned RM or re-running the full onboarding chain a second time. Code-reviewed only (see scenario 10). |
| Calendar shift-summary — Worker/cross-hotel-Manager denial | PASS | Direct API: Worker → `403` (`requireRole`); Manager scoped to a different hotel → `403` (`checkHotelAccess`). |
| Backend test suite | PASS | 108 suites / 2688 tests, both before and after this run's fixes. |
| Frontend `tsc --noEmit` | PASS | Clean, both before and after fixes. |
| Frontend `eslint .` | PASS | Clean, both before and after fixes. |

## Fixes made this run

1. **`frontend/app/(protected)/calendar/page.tsx`** — the `<ShiftSummaryPanel>` was gated on
   `view === "day" && (hotelFilter || scopeHotelId)`. `scopeHotelId` is `null` for Admin and
   Regional Manager (only a Hotel Manager has a fixed single-hotel scope claim), so unless
   Admin/RM had already used the hotel dropdown, the panel silently never rendered — no visible
   sign a feature existed to look for, which is exactly the reported symptom. Fixed to gate on
   `canWrite && effectiveHotelFilter` (reusing the page's own existing filter-resolution variable)
   and, when no hotel is yet selected, render an explicit hint pointing at the **same**
   `CalendarFilters` dropdown Admin/RM already use elsewhere on this page — per the owner's own
   framing ("works with our current hotel filter perfectly"), no new/separate filter UI was added.

2. **`backend/src/modules/calendar/shift-summary/routes.ts`** — independent, more severe defect
   found only once the panel was actually rendering: `GET`/`PUT` returned bare
   `res.json(summaries)` / `res.json(summary)`, not this codebase's mandatory
   `{status:"success", data, meta}` envelope every other route (including this module's own
   sibling `CalendarController` methods) uses. `frontend/lib/api.ts`'s `apiFetch` unconditionally
   expects that envelope and returns `envelope.data` regardless — against a bare array/object that
   is `undefined`, with no thrown error. Effect: `ShiftSummaryPanel` showed "No summary added for
   this day" and threw `Cannot read properties of undefined (reading 'length')` in the console
   **even for the Manager who had just saved the row**, whose data was confirmed correct and
   present in Postgres the whole time. This broke the read for every role, not only Admin/RM — the
   originally-reported "Admin/RM can't see it" was a narrower symptom of a wider defect. Fixed by
   wrapping both success responses in the standard envelope and replacing the manual
   `res.status(400/401).json({error:...})` error paths with the shared `ValidationError`/
   `UnauthorizedError` classes (which the global error handler already turns into the same
   envelope shape), matching this codebase's universal convention.

Both fixes verified two ways: (i) real browser re-run showing the rendered numbers with no console
errors, for both the writing Manager and a separately-logged-in Admin; (ii) a direct Postgres read
of the `DailyShiftSummary` row before and after, confirming the data was correct throughout and
only the read path was broken.

## New defects found

1. Calendar shift-summary panel invisible to Admin/RM — `frontend/app/(protected)/calendar/page.tsx` — medium severity (feature unusable for its stated audience) — fixed this run, see above.
2. Calendar shift-summary GET/PUT skip the standard response envelope — `backend/src/modules/calendar/shift-summary/routes.ts` — higher severity than defect 1 (broke the read for the Manager who wrote the data too) — fixed this run, see above.
3. `FEATURE_JOBDISPATCH_PHASE2` (default off) breaks the entire Calendar page — `app/(protected)/calendar/page.tsx`'s `entriesError` gate hides everything (placements, absences, shift-summary) behind one flag unrelated to shift-summary itself — **not fixed, out of scope for this task**, logged in scenario 08 §5 as an environmental caveat and worth its own follow-up ticket.
4. `documents/storage.ts`'s real-S3 upload path fails hard (`500 INTERNAL_ERROR`, generic message) with no document row written when AWS credentials are absent/expired, rather than degrading or surfacing a clearer error — **not fixed** (would require touching the documents module, out of this task's stated scope); logged as an environmental caveat, not worked around with fake credentials.

## Could not test

1. **Document upload → S3 storage itself**, for the real bucket (`S3_BUCKET=hotelcrm-uploads`) —
   `aws sts get-caller-identity` failed (expired session), and the task instructions explicitly
   forbid configuring real credentials. Worked around **only** by temporarily unsetting
   `S3_BUCKET` in `backend/.env` to force the stub storage client for the rest of this run (so the
   submit/approve/reject/assign chain, which is the actual path under test, could be exercised
   through the real API) — reverted to the original value before finishing. Real S3 upload was
   never verified this run; that remains exactly as untested as scenario 04 already documents.
2. **Regional Manager's view of the shift-summary panel** — see Results table above. Code-reviewed
   only; not browser/DB-verified.
3. **Email/FCM-dependent notification paths** — unrelated to this task's scope and already logged
   as a known credential gap in `REMAINING_WORK.md`.

## Scenario files updated this run

- `scenarios/10-calendar-shift-summary.md` — added a "Run results" section with real pass/fail
  outcomes and evidence for all 4 steps.
- `scenarios/08-known-gaps-and-next.md` — moved the two shift-summary defects into the Fixed
  history table; corrected the AWS-credentials caveat (it does not always silently no-op — depends
  on whether `S3_BUCKET` is set); added new caveats for the `FEATURE_JOBDISPATCH_PHASE2`/Calendar
  coupling, the response-envelope convention, and `tsx watch` not reloading `.env`.
- `REMAINING_WORK.md` — removed the now-fixed "Gap in the Done calendar shift-summary feature" Open
  item; expanded the shift-summary feature's Done entry with the full fix account.
- This run log (new).
