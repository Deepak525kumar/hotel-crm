# E2E Run — 2026-08-12 — RM shift-summary verification + onboarding entry points

- **Commit under test:** `08f8164` (working tree, uncommitted changes present from a
  concurrent session touching `users/`, `documents/`, `employee-management/`)
- **Environment:** local dev — Postgres + Redis in Docker, backend :3001, frontend :3000
- **Executed by:** AI agent (Claude), driven browser via Playwright
- **Database:** `hotelcrm_dev` as user `hotelcrm` — note the psql invocation quoted in some
  task briefs (`-U postgres -d hotel_crm`) does **not** exist on this stack; use
  `docker exec hotel-crm-postgres-1 psql -U hotelcrm -d hotelcrm_dev`.

## Scope of this run

Two targeted objectives, not a full 00-08 sweep:
1. Close the **Regional Manager** gap on the calendar daily-shift-summary (scenario 10 step 2),
   which the previous run recorded as code-reviewed only.
2. Verify the new **self-service onboarding entry points** (sidebar nav + dashboard CTA).

## Results

| Scenario | Result | Notes |
|---|---|---|
| 10 step 2 — RM views group hotel's summary | **PASS** | Browser + Postgres; read a Manager-authored row |
| 10 step 2 — RM edits it | **PASS** | `updated_by` = RM, `created_by` = Manager in DB |
| 10 step 2b — RM cross-group denied | **PASS** | Not offered in picker; forced fetch → 403 GET+PUT; row unchanged |
| Onboarding entry points — RM applicant (unassigned) | **PASS** | Nav item + pill + dashboard CTA all present |
| Onboarding entry points — PENDING submitted | **PASS** | "Under Review" pill, CTA reads "View my onboarding" |
| Onboarding entry points — ACTIVE | **PASS** | CTA gone, nav degrades to neutral link (no nag) |
| Onboarding entry points — Admin / no record | **PASS** | Neither surface renders |
| Backend suite | **PASS** | 112 suites / 2829 tests |
| Frontend `tsc --noEmit`, `eslint .` | **PASS** | Both clean |

## New defects found

1. **Shift-summary panel hidden for every role whenever the placement grid errors** —
   `frontend/app/(protected)/calendar/page.tsx` — **high** — *fixed this pass.* The panel lived
   inside the `entriesError` else-arm. `GET /assignments/calendar-entries` is gated by
   `FEATURE_JOBDISPATCH_PHASE2` (off by default) and 404s, so `entriesError` is always set
   locally and the feature was unreachable for admin, manager and RM alike. Two independent
   reads must not share one error flag. Regression test added for the authorization side
   (`backend/src/__tests__/calendar-shift-summary-scope.test.ts`, 8 tests — the feature had none).

2. **`POST /employees/:id/assign` succeeds on a PENDING, never-submitted, never-approved
   application** — `backend/src/modules/employee-management/service.ts` — **medium/high,
   NOT fixed** (that module is being edited concurrently by another session; reported instead
   of touched). Reproduction from this run:
   ```
   POST /employees/E2E-RM-…/approve  -> 409 "Cannot approve an application that has not been submitted for review"
   POST /employees/E2E-RM-…/assign   -> 200
   ```
   Postgres after the `assign`:
   ```
    employee_id       | status  | submitted_for_review_at | hotel_group_id
    E2E-RM-1786532297 | PENDING |                         | cmsolxb2j000t1011uw2dgiin
   ```
   and `HotelGroup.regional_manager_user_id` was set to that user. So assignment wrote **both**
   the EmploymentRecord scope and the cross-entity group FK — granting a real, usable
   `{type:'hotel_group'}` JWT scope claim — for an application that was explicitly refused
   approval seconds earlier. `approve` guards the lifecycle; `assign` does not. Scenario 02
   step 6/7 asserts approve-then-assign ordering but never asserts that `assign` *requires* an
   approved record, so this passes the existing suite.
   *(Note: this run then deliberately used that scope for the RM verification above. That does
   not weaken the shift-summary findings — those routes gate on role + hotel scope only and
   never read EmploymentRecord status — but the RM used is not a lifecycle-clean RM.)*

3. **`Badge color=…` silently ignored on `/onboarding`** — `frontend/app/(protected)/onboarding/page.tsx`
   — **low** — *fixed this pass.* `Badge` accepts `tone`, not `color`; the status badge rendered
   grey in every state and `color` leaked to the DOM. Now sourced from the shared hook.

4. **Two SWR caches for one resource** — **low** — *fixed this pass.* `/onboarding` used the
   string key `/employees/by-user/:id` while `useEmploymentRecord` uses the tuple
   `["employment-record", id]`, so submitting for review never revalidated the other surfaces.
   The page now uses the shared hook, so nav badge + dashboard CTA update with it.

## Could not test

1. **Real document upload (`POST /documents/workers/:id/documents`) → 500.** Not a code defect:
   `S3_BUCKET` is configured (`hotelcrm-uploads`) while AWS credentials are not, so the storage
   client attempts a real call and fails. Probed directly to confirm rather than inferred:
   ```
   S3_BUCKET = "hotelcrm-uploads" | AWS_REGION = "eu-central-1"
   UPLOAD FAILED: CredentialsProviderError | Your session has expired. Please reauthenticate.
   ```
   Note the code comment on `uploadDocument` claims "If S3_BUCKET is not configured, the stub
   no-ops" — that fallback does **not** apply here, because the bucket *is* set and only the
   credentials are missing. Consequence: the six-document gate cannot be satisfied locally, so
   **no employment record can reach `ACTIVE` through the genuine path** on this stack.
   Per this suite's rules this is recorded as a gap, not worked around for the path under test.

2. **Consequently:** the ACTIVE and submitted-for-review onboarding states used for the Task 1
   UI checks were reached by a direct `UPDATE` on `EmploymentRecord`. That is a *prerequisite*
   for the surface under test (does the UI react to status), not a substitute for the path under
   test — the status-transition path itself is **not** verified by this run.

3. **The placement grid / `/assignments/calendar-entries`** was never exercised
   (`FEATURE_JOBDISPATCH_PHASE2` off). Only its always-erroring state was, incidentally, via
   defect 1.

## Scenario files updated this run

- `scenarios/10-calendar-shift-summary.md` — added a second "Run results — 2026-08-12" section
  superseding step 2's NOT-VERIFIED entry with browser+DB evidence; recorded the exact RM
  creation chain, the three topology gotchas (`createHotel` ignores `hotel_group_id`;
  `PATCH /crm/hotels` silently ignores `manager_user_id`; hierarchical user creation), defect 1,
  and the new regression suite.
