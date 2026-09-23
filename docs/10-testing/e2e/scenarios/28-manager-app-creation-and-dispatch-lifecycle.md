# Scenario 28 — Manager app: creating work, and the dispatch lifecycle

Covers the **write** surface the manager app added in PR #695 and #697 and
which had no scenario: raising a work request, raising a broadcast, placing a
worker on the calendar, and the eligibility rule that decides whether a
placement is allowed at all.

Scenario 25 covers approvals (people entering the system); this covers work
being created for them. Scenario 24 covers moving a placement that already
exists; this covers making one.

Governing records: `ADR-030` C-25/C-26, `ADR-021` (calendar vs dispatch
ownership), `ADR-023` §4 (employment-record group scope), and
`MoveCalendarEntrySchema`.

**Status:** New scenario, added 2026-09-23. **All steps run live the same day**
— results in `runs/2026-09-23-manager-app-hr-analytics.md`.

---

## Preconditions

Scenario 00's data, an **admin**, a **hotel-scoped manager**, and a second
hotel in a **different group** with at least one `ACTIVE` worker of its own.

> **`FEATURE_JOBDISPATCH_PHASE2` must be ON** for Steps 4–6; those routes
> **404** when it is off, and a 404 there is a configuration state, not a
> failure. Steps 1–3 work either way.
>
> **Grant `daily-access-gate` consent first** for every non-admin caller.

---

## Step 1 — A manager may raise a request only for a hotel they hold

```bash
BODY='{"hotel_id":"<HOTEL>","target_role":"WORKER","position":"cleaner",
       "workers_needed":2,"shift_date":"<TODAY>",
       "shift_start_time":"08:00","shift_end_time":"16:00"}'
curl -s -o /dev/null -w '%{http_code}\n' -X POST \
  -H "Authorization: Bearer $MANAGER_T" -H 'Content-Type: application/json' \
  -d "$BODY" http://localhost:3001/api/v1/work-requests
```

**PASS:** `201` for their own hotel; **`403`** for a hotel outside their scope,
with `"Cannot create a work request for this hotel"`.

**Reference run:** own `201`, other `403`.

**Why this one first:** a create path that ignores scope writes a row that then
appears on someone else's rota. The read-side scoping (scenario 26) would not
show it to the creator — so the defect would surface as another hotel's manager
finding work they never asked for.

## Step 2 — An end time BEFORE the start time is accepted, and that is correct

```bash
# 16:00 -> 08:00
curl -s -o /dev/null -w '%{http_code}\n' -X POST … \
  -d '{… "shift_start_time":"16:00","shift_end_time":"08:00"}'
```

**PASS:** `201`.

> **Do not file this.** It looks like missing validation and it is not: an end
> earlier than the start **is an overnight shift ending the next day**, which
> this codebase handles deliberately — `backend/src/modules/assignments/service.ts`
> resolves the scheduled end instant with exactly that rule, in as many words.
> A hotel runs night shifts; rejecting 22:00→06:00 would break real work.
>
> Recorded because a tester who assumes `end > start` will file a false
> positive here, and because anyone *adding* a cross-field refine to
> `CreateWorkRequestSchema` would break night shifts with a change that looks
> like a straightforward tightening.

## Step 3 — The numbers are validated

```bash
curl -s -o /dev/null -w '%{http_code}\n' -X POST … -d '{… "workers_needed":0}'
```

**PASS:** `422`. A request for nobody is not a request.

**Note the code: 422, not 400.** Validation rejects with 422 throughout this
API (scenario 26, Trap 4).

## Step 4 — A placement is refused unless the worker is eligible at that hotel

Requires `FEATURE_JOBDISPATCH_PHASE2=true`.

```bash
curl -s -o /dev/null -w '%{http_code}\n' -X POST \
  -H "Authorization: Bearer $ADMIN_T" -H 'Content-Type: application/json' \
  -d '{"worker_id":"<WORKER>","hotel_id":"<HOTEL>","day":"<TODAY>"}' \
  http://localhost:3001/api/v1/assignments/calendar-entries
```

**PASS:** `201` for a worker whose employment record's **hotel group** contains
that hotel; **`403 "This worker is not eligible at this hotel"`** for one whose
does not — *even as admin*. Eligibility is not an authorization check on the
caller; it is a fact about the worker, and admin does not bypass it.

**Reference run:** a worker from group A placed at a group-B hotel → `403`; a
worker from group B → `201`.

> **The trap that cost time writing this scenario.** Eligibility is resolved
> from the worker's `EmploymentRecord.hotel_group_id`
> (`lib/roster-scope.ts` → `resolveWorkerGroupScope`), **not** from the
> `HotelWorker` roster table, despite the roster being the thing that reads
> like a roster. Inserting a `HotelWorker` row to make a worker eligible does
> nothing at all.
>
> **There is also no API that writes `HotelWorker`** — nothing in
> `backend/src/` creates one. Existing rows come from seed scripts. If a future
> change makes eligibility depend on that table, it will depend on data the
> application cannot produce.

## Step 5 — A placement creates a real assignment, CONFIRMED

**PASS:** the `201` body nests an `assignment` with `status: "CONFIRMED"`,
`work_request_id: null` and `job_request_id: null` — a calendar-placed shift
belongs to neither. Verify in Postgres rather than from the body:

```sql
SELECT status, day, hotel_id FROM "WorkerAssignment" WHERE id = '<id>';
```

**FAIL:** a `CalendarEntry` with no matching `WorkerAssignment`, or a status
other than `CONFIRMED`. The two are created together in one transaction; a
calendar row without its assignment is a shift nobody is actually on.

## Step 6 — The chain a cross-scope test needs, built only from real paths

This step exists because scenario 24 Step 9 was **recorded as "could not test"
for weeks** — there was no attendance row at a second hotel to attempt. Build
one here:

1. Place an **eligible** worker at hotel B (Step 4) → `201`, assignment id.
2. As that worker, check in:
   ```bash
   curl -s -X POST -H "Authorization: Bearer $WORKER_T" \
     -H 'Content-Type: application/json' \
     -d '{"assignment_id":"<id>"}' http://localhost:3001/api/v1/attendance
   ```
   **PASS:** `201`, `status: "PRESENT"`. Coordinates are **optional** —
   `CheckInSchema` requires latitude and longitude together *or not at all*, so
   a check-in without geo is valid and does not need a device.
3. Now run **scenario 24 Step 9** against that record.

**PASS (24 Step 9, executed 2026-09-23):** the hotel-A manager gets `403`
`"Cannot access this attendance record"` on the PATCH, `is_verified` stays
`false` and `verified_by_id` stays null in Postgres — and the same manager also
gets `403` on the **GET**, so the record is not merely unwritable but unreadable.

**Why this matters:** `PATCH /attendance/:id` has **no route-level role gate**.
The service is the entire authorization boundary, so this is the only thing
standing between a manager and another hotel's timesheets.

---

## Knowingly untested here

- **The forms themselves.** That the new-request screen validates before
  sending, that the broadcast form's skill-slot rows add and remove, and that
  either is usable at 375pt are device work — see
  `DEVICE_VERIFICATION_CHECKLIST.md` and scenario 25 Step 8.
- **Broadcast acceptance.** Raising a broadcast is covered; a worker accepting
  one, the skill-slot matching and the confirmed-count arithmetic are
  `job-requests`' own suite and are not asserted here.
- **Notification fan-out.** Creating a request enqueues outbox events; whether
  a device receives anything is `16-push-notification-delivery.md`, and outbox
  status is explicitly **not** evidence of delivery.
- **Cleanup.** Rows created by this scenario are left in place deliberately, so
  a failed run can be inspected. Name them recognisably and record them in the
  run log.
