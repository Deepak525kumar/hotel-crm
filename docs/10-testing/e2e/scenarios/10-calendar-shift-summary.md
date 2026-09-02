# Scenario 10: Calendar Daily Shift Summary

## Objective
Verify that the `DailyShiftSummary` component correctly fetches, renders, and saves the shift metrics and notes, and adheres to the strict hierarchical visibility rules.

## Pre-conditions
- Existing Hotel with ID `hotel-a`
- A Manager assigned to `hotel-a` (Actor: Manager-A)
- A Regional Manager assigned to `hotel-a`'s group (Actor: RM-A)
- A Worker assigned to `hotel-a` (Actor: Worker-A)
- Another Manager assigned to `hotel-b` in a different group (Actor: Manager-B)

## Test Steps & Assertions

1. **Manager edits their own hotel's shift summary**
   - **Action**: Log in as Manager-A. Navigate to Calendar, select "Day" view for today. Select "hotel-a" in the filter if not auto-selected.
   - **Expectation**: The "Daily Shift Summary" panel is visible above the calendar grid.
   - **Action**: Click "Add Details" (or "Edit"). Enter 10 Total, 5 Stay-over, 5 Checkout, 3 Workers, and Notes "Smooth shift". Click "Save Summary".
   - **Expectation**: The panel updates from Edit to Read view, displaying the entered numbers and notes correctly.

2. **Regional Manager edits their group's hotel**
   - **Action**: Log in as RM-A. Navigate to Calendar -> "Day" view -> Select "hotel-a".
   - **Expectation**: The summary saved by Manager-A in step 1 is visible.
   - **Action**: Click "Edit", append " (Reviewed by RM)" to the Notes, and save.
   - **Expectation**: The update succeeds and is visible.

3. **Worker attempts to view/edit**
   - **Action**: Log in as Worker-A. Navigate to Calendar.
   - **Expectation**: The UI does NOT render the Shift Summary panel (role gate in UI or missing hotel filter).
   - **Action**: Make a direct API `GET /api/v1/calendar/hotels/hotel-a/shift-summaries?start_date=...` request using Worker-A's token.
   - **Expectation**: Backend responds with `403 Forbidden` due to `requireRole` check.

4. **Peer Manager isolation**
   - **Action**: Log in as Manager-B. Navigate to Calendar.
   - **Action**: Try to fetch or mutate `hotel-a`'s shift summary via direct API calls.
   - **Expectation**: Backend responds with `403 Forbidden` due to `checkHotelAccess(hotel_id)` failing for a different hotel outside their scope.

## Run results — 2026-08-12

Executed against a real running stack (see `runs/2026-08-12-onboarding-calendar-shift-summary.md`
for the full run log). Summary:

- **Step 1 (Manager writes their own hotel's summary): PASS.** Real browser session, real
  onboarded-and-assigned Manager (created via the actual approve→assign UI chain, not seeded
  directly). Panel rendered `TOTAL ROOMS 42 | STAY-OVER 30 | CHECKOUT 12 | WORKERS 5` plus notes
  text after save; independently confirmed identical values in Postgres
  (`DailyShiftSummary` row, `created_by_id` = the Manager's user id).
- **Step 2 (RM edits their group's hotel): NOT INDEPENDENTLY VERIFIED.** No RM-role test
  credentials were available without vacating an existing group's already-assigned RM
  (`HotelGroup.regional_manager_user_id` is `@unique` — one RM per group) or running the full
  onboarding chain a second time for a fresh RM. `resolveHotelAccess`'s `regional_manager` branch
  was code-reviewed and found structurally identical to the already-verified `manager` branch
  (`backend/src/middleware/permissions.ts`), and Admin — which shares the same
  `checkHotelAccess()` gate via its own bypass — was verified end-to-end instead (see Step-2
  substitute below). Treat RM as code-reviewed, not browser/DB-verified.
- **Step 2 substitute — Admin views/edits the same data: PASS, after two real fixes.**
  Before the fixes, Admin saw nothing and no hint that a feature existed (root cause 1: the
  frontend gated the panel on `scopeHotelId`, which is always `null` for Admin/RM). After fixing
  the gate to reuse the page's existing hotel-filter state, a second, independent, more severe bug
  surfaced: the panel showed "No summary added" and threw a console error even though the row
  existed, because the backend routes returned a bare JSON body instead of this codebase's
  mandatory `{status, data, meta}` envelope, which broke the read for every role, not only
  Admin/RM. Both fixed in `backend/src/modules/calendar/shift-summary/routes.ts` and
  `frontend/app/(protected)/calendar/page.tsx` — see `REMAINING_WORK.md`'s Done section for the
  full account. Verified: Admin selects the hotel via the pre-existing `CalendarFilters` dropdown
  (no new filter UI) and sees the identical data with no console errors.
- **Step 3 (Worker denied): PASS.** Direct `GET /api/v1/calendar/hotels/:id/shift-summaries` as a
  real worker token → `403 FORBIDDEN "Insufficient permissions"` (route-level `requireRole` gate).
- **Step 4 (cross-hotel Manager denied): PASS.** Direct `GET` as a Manager scoped to a different
  hotel/group → `403 FORBIDDEN "Cannot access hotel <id>"` (`checkHotelAccess()` /
  `resolveHotelAccess()`'s `isHotelInScope` check).

## Run results — 2026-08-12 (second pass: RM gap closed)

**Step 2 is now browser + DB verified and SUPERSEDES the "NOT INDEPENDENTLY VERIFIED"
entry above.** A fresh RM was created through the real API chain rather than by vacating an
existing group's RM, which is what made the earlier run believe no RM credentials were
obtainable:

```
POST /users {role:'regional_manager'}                  -> 201   (Admin may ONLY create RMs)
POST /employees {user_id, employee_id, job_title}      -> 201   PENDING
POST /employees/:id/assign {hotel_group_id}            -> 200   writes HotelGroup.regional_manager_user_id
POST /auth/login                                       -> 200   scope {type:'hotel_group', hotel_group_id}
POST /crm/hotels + PATCH /crm/hotels/:id {hotel_group_id}  -> hotel inside the RM's group
PUT  /users/:mgr/role {role:'manager', hotel_id}       -> pins Hotel.manager_user_id
```
Use an **empty hotel group** (this run used `Eastside Group`) — `regional_manager_user_id` is
`@unique`, so a group that already has an RM cannot be reused.

Topology gotchas that cost time and are easy to hit again:
- `POST /crm/hotels` **ignores `hotel_group_id`** (it is update-only in `UpdateHotelSchema`) —
  a follow-up `PATCH` is mandatory or the RM's group check can never match.
- `PATCH /crm/hotels/:id` **silently ignores `manager_user_id`** (deliberately removed from the
  schema, person-centric redesign 2026-08-07). Returns `200` with the field unchanged. The sole
  writer is `PUT /users/:id/role`.
- User creation is hierarchical: **Admin may create only `regional_manager`; an RM only
  `manager`; a Manager creates workers/checkers.**

- **Step 2 (RM views + edits their group's hotel): PASS — real browser (Playwright), verified in
  Postgres.** RM logged in, Calendar → Day → picked the hotel from the existing `CalendarFilters`
  dropdown. Panel rendered the row a **Manager** had written: `TOTAL ROOMS 77 | STAY-OVER 50 |
  CHECKOUT 27 | WORKERS 9` plus the Manager's notes. RM then edited it (WORKERS → 11, notes
  appended " (Reviewed by RM)"), `PUT` returned `200`, and Postgres confirms the write with
  **`created_by` = the Manager and `updated_by` = the RM** — i.e. the RM genuinely read another
  role's row and updated that same row:

```
 total_rooms | total_people_working | notes                                                 | created_by                    | updated_by
          77 |                   11 | Written by MANAGER for RM read test. (Reviewed by RM)  | mgr-e2e-...@test.local        | rm-e2e-...@test.local
```

- **Step 2b (RM negative / cross-group isolation): PASS at both layers.** The RM's hotel picker
  offered only their own group's hotel (`["All hotels in group","RM-E2E Eastside Hotel …"]`) —
  the out-of-group hotel was never selectable. Forcing it anyway with a same-session in-browser
  `fetch()` (real cookies, not a curl token) returned `403 FORBIDDEN "Cannot access hotel <id>"`
  for **both `GET` and `PUT`**, and the out-of-group row was confirmed **unchanged** in Postgres
  (still `total_rooms 42`, original notes, `updated_by_id` untouched) — proving the 403 blocked
  the write rather than merely hiding the response.

### New defect found and fixed this pass

**The shift-summary panel was unreachable for EVERY role, not just RM.** It was rendered inside
the `else` arm of `{entriesError ? … : …}` in `frontend/app/(protected)/calendar/page.tsx`, so any
placement-grid failure hid it. That failure is the *default* state locally: the grid's data source
`GET /assignments/calendar-entries` is gated by **`FEATURE_JOBDISPATCH_PHASE2`, which is off by
default**, so it 404s (`"Assignment not found"` — the collection path falling through to the
`/:assignment_id` handler) and `entriesError` is always set. The page showed only "Failed to load
the calendar." with no shift summary anywhere.

Fixed by hoisting the panel **out** of the `entriesError` branch: the summary comes from
`GET /calendar/hotels/:hotel_id/shift-summaries`, an independent read, and must not be coupled to
the grid's error state. After the fix the panel renders correctly even while the grid still shows
its (expected, flag-off) error.

Why the earlier "Admin PASS" did not catch this: it necessarily ran with the entries fetch
succeeding, so `entriesError` was falsy and the coupling was invisible.

### Regression coverage added

`backend/src/__tests__/calendar-shift-summary-scope.test.ts` (8 tests) — the feature previously
had **zero** automated coverage for any role. Pins `resolveHotelAccess` for RM in-group / other
group / nonexistent hotel / **no scope claim (unassigned RM)** / missing hotel_id, plus the
manager and admin branches. The service layer does not re-check scope, so this middleware decision
is the feature's only authorization boundary.

## Run results — 2026-09-02 (third pass: malformed-body error class fixed)

The 08-12 passes above never exercised an invalid request body — this pass did, and found a
real, independently-fixable defect.

**PUT `/calendar/hotels/:hotel_id/shift-summaries/:date` with a missing/malformed field
returned a raw `500 INTERNAL_ERROR`, not the `422 VALIDATION_ERROR` every other endpoint in
this API returns.** `shift-summary/routes.ts` called `dailyShiftSummarySchema.parse(req.body)`
inline instead of using `validateBody()` (`middleware/validation.ts`) — the established
pattern that catches `ZodError` and converts it to a proper `ValidationError` with field-level
detail. The global error handler has no `ZodError` branch of its own, so the raw Zod throw fell
through to the generic 500 case. No internal detail leaked to the client (the 500 body was
already generic — `{"code":"INTERNAL_ERROR","message":"An unexpected error occurred"}`), so
this was a correctness/usability bug, not a disclosure one: a manager who mistypes or omits a
field on this form got no indication of what was wrong.

Reproduced and fixed live: `PUT .../shift-summaries/2026-09-02` with `total_people_working`
omitted now returns
`422 {"code":"VALIDATION_ERROR","details":[{"field":"total_people_working","message":"Required"}]}`.
The happy path (all required fields) still succeeds unchanged.

Also re-confirmed Step 2 (RM read + edit another role's summary) live against this session's
own fixtures — `updated_by_id` correctly recorded the RM after their edit — consistent with the
08-12 browser-verified result above. Step 2b (cross-group isolation) was not independently
re-run this pass; the 08-12 result plus this session's exhaustive re-verification of the same
`checkHotelAccess()` gate elsewhere (scenario 03 Step 5/6) stand as current evidence.
