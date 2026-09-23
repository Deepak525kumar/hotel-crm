# E2E Run — 2026-09-23 — manager app: round-3 DTO contracts, and scenarios 23–25

- **Commit under test:** `d96f0432` (branch `claude/manager-app-ui-overhaul-6158`, PR #698)
- **Environment:** local dev — backend :3001, Postgres 5432 (`hotelcrm_dev`), Redis
- **Executed by:** Claude Opus 5 (agent session)
- **Stack versions:** backend `npm run dev`, Prisma schema up to date, no frontend server started

## Feature flags as found

| Flag | State | Effect on this run |
|---|---|---|
| `FEATURE_EMPLOYMENT_RECORD` | `true` | `/employees` routes live |
| `FEATURE_JOBDISPATCH_PHASE2` | **absent (off)** → **set `true` for this run** | Calendar-entry routes 404 while off; enabled locally to exercise Step 1. **`backend/.env` was modified and a backup taken at `/tmp/backend.env.bak`.** |
| `FEATURE_RM_ROLE` | absent | RM accounts exist and authenticate regardless |
| `FEATURE_GD02_MATRIX` | absent (off) | `SIR-CRM-020` asymmetry recorded, not asserted |

## Results

| Scenario | Result | Notes |
|---|---|---|
| 00 Environment | **PASS** | Docker started, migrations applied (`20260922090000_push_app_manager` was pending), **migration integrity `No difference detected.`** |
| 23 Auth & capability gating | **PARTIAL — 2 steps were vacuous** | Steps 3, 6 PASS. Steps 4, 5 asserted **non-existent routes** (see defect 1) — re-run on the corrected paths: PASS |
| 24 Rota & operations | **PARTIAL** | Step 8 PASS at the data layer. Step 9 **NOT RUN** (no attendance row outside the manager's hotel); adjacent fail-closed case run instead |
| 25 People & platform | **PARTIAL** | Step 5 PASS (refused, nothing written) but the predicted status code was wrong — scenario clarified |
| **26 DTO contracts & History** | **PASS — all 10 steps** | New scenario, written and run this pass |

Steps 1–6 of scenario 23, and most of 24/25, are **device steps** and were not run:
no simulator or device in this session. That is a gap, not a pass.

## Scenario 26 — every step run live

| Step | Assertion | Result |
|---|---|---|
| 1 | Calendar entry nests `worker` + `hotel`, identity fields only | **PASS** — `Tomasz Nowak` / `Hotel Adler …`, no contact fields |
| 2 | `CANCELLED` placements stay visible | **PASS** |
| 3 | `/users?limit=200` → 422, `limit=100` → 200 | **PASS** |
| 4 | `status=ASSIGNED` → 422; `CONFIRMED`/`REASSIGNED` → 200 | **PASS** |
| 5 | `per_page=1` → 1 row; `limit=1` → 6 rows (silently dropped) | **PASS** |
| 6 | Work request nests `hotel` | **PASS** |
| 7 | Assignment detail carries `worker_name` | **PASS** — with `assigned_by_name` and nested `hotel` |
| 8 | Blocklist row names a person | **PASS** — `employee_id`, `user_id`, `worker_name` all present |
| 8b | User cuid as `employee_id` → 404 | **PASS** — `"Employment record not found"` |
| 9 | `cancellation_reason` persists | **PASS** — read back from Postgres, not from the 200 |
| 10 | `my-inspections` 0 vs `checks` 3, same admin | **PASS** |
| 10a | Scope: admin/manager/RM see their own; **no-scope manager → 0**; worker → 403 | **PASS** |
| 10b | `hotel_id` narrows, never widens (own 3, other 0) | **PASS** |

## New defects found

1. **Scenario 23 Steps 4 and 5 asserted routes that do not exist** — `docs/10-testing/e2e/scenarios/23-manager-app-auth-and-capability-gating.md` — **medium (test-suite defect, not product)** — fixed in this pass.
   `POST /quality/assignments/:id/checks` and `POST /rooms/mine` both return **404 for every caller**, so the steps "passed" without testing anything — including for a *checker*, the role that must be **allowed**. The real routes are `POST /quality/verifications`, `POST /quality/inspections` (both multipart) and `POST /rooms/assignments/:assignment_id/rooms`. Re-run on the corrected paths: **403 for manager and RM**, so the product gate was correct all along; only the evidence was worthless. This is exactly the failure mode the README warns about under "Re-check citations".

2. **Scenario 25 Step 5 predicted the wrong gate** — same directory, file 25 — **low** — clarified in this pass.
   It asserts refusal "at the route/schema boundary (400/404)". Observed: **403 "User not in your scope"**, because the scope gate fires before the `.strict()` schema gate. `ADR-030` D-4a is satisfied either way, but a tester seeing 403 could reasonably conclude the schema gate was missing. Both orderings are now documented.

No **product** defects were found by this run. The thirteen product defects it exercises were found by the owner's round-3 UI review and fixed in `44501b05`/`d96f0432`; scenario 26 exists so they are caught mechanically next time.

## Could not test

1. **Scenario 24 Step 9 (cross-scope attendance)** — only `E2E Hotel 1` has `Attendance` rows, and it is the test manager's own hotel, so the cross-boundary case has no target. **Needed:** an attendance row at a second hotel, created through the real check-in path. The adjacent boundary was run instead: a **manager with no scope claim** was refused (403) on a record an in-scope manager then verified successfully (200) — so the denial is the scope gate, not a blanket refusal.
2. **Every device step** in 23, 24 and 25 — gestures, multipart uploads, push, OS permission dialogs, RTL, offline, and anything that proves a *screen renders*. No simulator in this session. See `DEVICE_VERIFICATION_CHECKLIST.md`; scenario 26 is API-and-database only and proves nothing about rendering.
3. **The web "Failed to load this hotel" report (2026-09-23)** — not reproduced. `hotels:read` is held by all three management roles and `checkHotelAccess` reads correctly. **Needed:** the HTTP status of the failing `/crm/hotels/:id` request from the reporter's own session.
4. **Mobile hotel detail / hotel-group detail** — client types still omit most of what the server sends (same class as scenario 26 Step 7). Not yet fixed, so not yet asserted.

## Environment notes that cost time

- **`403 CONSENT_REQUIRED` is not an authorization failure.** Every non-admin call fails this way until the account grants the day's notice. Three debugging rounds were spent here before the cause was clear. The enforced instance is **`daily-access-gate`**; the database also holds historical `DAILY_PLATFORM_USE` rows, and granting that one changes nothing.
- **The calendar route is `/assignments/calendar-entries`**, not `/assignments/calendar/entries`. The wrong path 404s identically to the flag being off — and parsing an error envelope with `.get('data', [])` reports "0 rows" rather than a failure, which briefly read as an empty database. **Assert on HTTP status.**
- **Validation rejects with 422, not 400**, throughout.
- Login passwords in the seed data differ per account: `AdminPass123!` for `e2e-admin@test.local`, `E2EPass123!` for the rest. `ADR-070` throttles at 11 attempts per account — probe sparingly.

## Scenario files updated this run

- **Added** `scenarios/26-manager-app-dto-contracts-and-history.md` — 10 steps, all run live.
- **Corrected** `scenarios/23-…` Steps 4 and 5 to the routes that exist, with a note on why a 404 there is a vacuous pass.
- **Clarified** `scenarios/25-…` Step 5 with the two-gate ordering and the status code each produces.
- **Index** updated in `README.md`.

## Teardown

`FEATURE_JOBDISPATCH_PHASE2=true` was appended to `backend/.env` for this run.
**Restore it** (`cp /tmp/backend.env.bak backend/.env`) or remove the line, so the
local default matches production's off state. Two rows were written through real
paths and left in place: one `EmployeeBlocklistEntry` at E2E Hotel 1, and one
`WorkerAssignment` moved to `CANCELLED` with an E2E reason.
