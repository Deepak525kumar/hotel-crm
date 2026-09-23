# E2E Run — 2026-09-23 (second pass) — manager app: HR, analytics, creation, and the cross-scope step that had never run

- **Commit under test:** `ed239144` (branch `claude/manager-app-dto-contracts-2609`, PR #699)
- **Environment:** local dev — backend :3001, Postgres `hotelcrm_dev`, Redis
- **Executed by:** Claude Opus 5 (agent session)
- **Flags:** `FEATURE_EMPLOYMENT_RECORD=true`; `FEATURE_JOBDISPATCH_PHASE2` **enabled for this run** and restored to off afterwards

## Results

| Scenario | Result | Notes |
|---|---|---|
| 00 Environment | **PASS** | Stack restarted; migrations already current |
| **27 HR, analytics, leaderboards** | **PASS — all 6 steps** | New scenario, written and run this pass |
| **28 Creation & dispatch lifecycle** | **PASS — all 6 steps** | New scenario, written and run this pass |
| **24 Step 9** (cross-scope attendance) | **PASS — first execution ever** | Was "could not test" since the scenario was written |

## Scenario 27 — measured values

| Assertion | admin | hotel mgr | no-scope mgr | worker |
|---|---|---|---|---|
| `GET /hr/contracts` | 200, **35** | 200, **9** | 200, **0** | **403** |
| `GET /hr/payroll` | 200, 3 | 200, 2 | — | 200, **0** |
| `GET /analytics/stats` | `assignments.total 49` | **9** | **all zero** | 403 |
| `GET /analytics/hotel-summary/:own` | 200 | 200 | 403 | 403 |
| `…/hotel-summary/:other` | — | **403** | — | — |
| `…/leaderboard/by-hotel/:other` | — | **403** | — | — |
| `GET /analytics/leaderboard` | 200 | 200 | 200 | **403** |
| `GET /quality/leaderboard` | 200, **13** | 200 | 200 | 200, **2** |
| `GET /notifications` | 200 | 200 | 200 | 200 |

**The finding worth keeping:** the two leaderboards behave differently for a
worker *by design* — 403 on `/analytics/leaderboard` (no `analytics:read`),
200 on `/quality/leaderboard` (`ADR-067`), and there the worker sees 2 rows
against the admin's 13, with the nested worker object carrying `id`,
`first_name`, `last_name`, `employment_record` and **no contact field of any
kind**. Both ADR-067 limits hold.

**Recorded, not filed:** `/analytics/stats` answers a no-scope manager with
`200` and every figure zero, while the hotel-keyed endpoints answer the same
caller with `403`. Both fail closed; the asymmetry is deliberate and is now
documented in the scenario so neither gets "fixed" into the other. A no-scope
caller seeing a **non-zero** figure would be the real defect.

## Scenario 28 — measured values

- `POST /work-requests` — own hotel `201`, hotel outside scope **`403`**
  ("Cannot create a work request for this hotel")
- `shift_start_time 16:00` / `shift_end_time 08:00` → **`201`, and correct** —
  an overnight shift, handled deliberately in
  `assignments/service.ts` ("If end time is earlier than start time, it's an
  overnight shift ending the next day"). **Nearly filed as missing validation**;
  the repo's own comment is the authority and says otherwise.
- `workers_needed: 0` → **`422`**
- `POST /assignments/calendar-entries` — ineligible worker **`403`** *even as
  admin*; eligible worker `201` with a nested `CONFIRMED` assignment,
  `work_request_id` and `job_request_id` both null
- `POST /attendance` (worker, no coordinates) → `201`, `status: PRESENT`

## Scenario 24 Step 9 — executed for the first time

Built the missing fixture from real paths only: placed `e2e-worker2` (whose
employment record's group contains hotel 2) at hotel 2 → the worker checked
themselves in → attempted the verify as hotel 1's manager.

- `PATCH /attendance/:id` → **403** `"Cannot access this attendance record"`
- Postgres: `is_verified` still `false`, `verified_by_id` still null
- `GET /attendance/:id` → **403** as well

Both directions asserted. A boundary that refuses the write while still serving
the row would disclose another hotel's timesheet, so the read check is not
redundant.

## New defects found

**None in the product.** Three things that *looked* like defects and are not,
each now written into the scenario that would otherwise rediscover it:

1. End-before-start on a work request — an overnight shift (28 Step 2).
2. `/analytics/stats` returning 200 to an unscoped caller — zeros, not data
   (27 Step 3).
3. `HotelWorker` rows having no effect on eligibility — eligibility comes from
   `EmploymentRecord.hotel_group_id`, and **no API writes `HotelWorker` at
   all** (28 Step 4). Worth remembering if eligibility is ever moved onto that
   table, because the application cannot currently populate it.

## Could not test

1. **Every device step** in 23/24/25, and the form behaviour in 28 — no
   simulator in this session. 27 and 28 are API-and-database only and prove
   nothing about rendering. See `DEVICE_VERIFICATION_CHECKLIST.md`.
2. **Broadcast acceptance** (skill-slot matching, confirmed-count arithmetic) —
   out of scope for 28, covered by `job-requests`' unit suite only.
3. **The contract signed-scan upload** — a real multipart path; belongs with
   the other three in the device checklist.

## Rows left behind

In `hotelcrm_dev`, from real paths, left in place deliberately:
- two `JobRequest` rows at E2E Hotel 1 (one with the 16:00→08:00 overnight times)
- one `CalendarEntry` + `WorkerAssignment` (`CONFIRMED`) for `e2e-worker2` at E2E Hotel 2
- one `Attendance` row (`PRESENT`) for that assignment

A `HotelWorker` row inserted while diagnosing eligibility was **deleted again**
once it proved to have no effect.

## Scenario files updated this run

- **Added** `scenarios/27-manager-app-hr-analytics-and-leaderboards.md` (6 steps, all run)
- **Added** `scenarios/28-manager-app-creation-and-dispatch-lifecycle.md` (6 steps, all run)
- **Updated** `scenarios/24-…` Step 9: first execution, the result, and a pointer to 28 Step 6 for the fixture recipe
- **Index** updated in `README.md`; manager-app set is now 23–28

---

## Addendum — same day, third pass: the last three screens

Built S-30, S-36 and S-37, and exercised the report exports against the live
API while doing so.

### A defect the screen work uncovered

`POST /reports/export` requires `dataset`, `format`, `from` **and** `to`. The
mobile client sent `{ dataset: 'attendance' }` and nothing else, so **every
team export the app could make was rejected** — and because the route used a
bare `.parse()`, a missing field threw a raw ZodError that the handler
rendered as `500 INTERNAL_ERROR`. It read as the server being broken rather
than the request being incomplete.

| Request | Before | After |
|---|---|---|
| `{dataset}` only | `500 INTERNAL_ERROR` | **`422`**, naming `format`, `from`, `to` |
| full valid body | `500` | reaches generation and upload |

Both halves fixed: the route validates with `safeParse` → `ValidationError`
(matching the `parseRange` helper already in that file), and the client's
`exportTeam` signature now requires all four fields. Pinned by two new tests
in `mobile/manager-app/src/__tests__/api-contract.test.ts`, one of which
asserts the screen offers **every** dataset the server declares.

### Could not test — recorded, not a pass

**The upload itself.** All four datasets now pass validation and fail at
`storage.upload()` with `"Your session has expired. Please reauthenticate."`
— an **AWS STS** message: the local AWS session is expired. That is an
environment problem, not a code defect, and it is the reason this addendum
does not claim the export works end to end. What is proven is that the
request now reaches generation instead of being rejected before it starts.
Re-run with valid AWS credentials to close it.

### Screens added

- **S-37 `/reports`** — all four datasets, preset ranges, xlsx/pdf. Preset
  ranges rather than a date picker: the server requires both bounds, refuses
  `from > to` and caps the span at 366 days, and a preset cannot express any
  of those mistakes — nor does it add a native module (`mobile/CLAUDE.md`
  rule 4). Reachable from More → Analytics.
- **S-30 `/notification/[id]`** — the list could mark a row read and nothing
  else. Reads from the list rather than a new endpoint (there is no
  `GET /notifications/:id`), and reuses `resolvePushTapRoute` so an in-app tap
  and a push tap cannot disagree about where a notification leads.
- **S-36 `/admin/hotels/new` and `/admin/hotel-groups/new`** — create and edit
  in one screen each, admin-gated client-side on `admin` alone rather than
  mirroring `SIR-CRM-020`'s flag-dependent server quirk.

Manager-app suite: 175 → **182** tests, with `route-targets-exist` and
`more-menu` picking up the new routes automatically.
