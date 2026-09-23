# Scenario 26 — Manager app: DTO contracts, and the screens that were empty by construction

Verifies the round-3 defect class reported by the owner on 2026-09-23: screens
showing **raw cuids where a name belongs**, details that render four fields out
of twenty, a filter chip that rejects the whole list, an editor that silently
overwrites, and a History tab that is empty for every role that can open it.

**These were one bug repeated, not thirteen bugs.** In every case the client and
the server had agreed on a shape that neither had ever checked against the
other, and `tsc` then verified each against the fiction. A green suite proved
only that the code agreed with itself. That is why this scenario asserts almost
everything against a **running API and a Postgres read**, never against a type.

Governing records: `ADR-030` C-22/C-25/C-27 (blocklist, dispatch, quality
read), `ADR-065` (onboarding gate), `ADR-070` (login throttle),
`SPEC-CHATBOT-001` is not in scope here.

**Status:** New scenario, added 2026-09-23. **All steps run live the same day**
against a local stack at `44501b05`/`d96f0432` — results in
`runs/2026-09-23-manager-app-dto-contracts.md`.

---

## Preconditions

Scenario 00's stack and data, plus:

- At least one `CalendarEntry`, one `WorkerAssignment`, one `JobRequest` and
  one `QualityVerification` in the database.
- An `ACTIVE` `EmploymentRecord` whose `employee_id` you know (`EMP-…`).
- Tokens for **admin**, **hotel-scoped manager**, **regional manager**, a
  **manager with no scope claim**, and a **worker**.

> **Trap 1 — consent, not authorization.** Every non-admin call below returns
> `403 CONSENT_REQUIRED` until that account has granted today's notice. This
> looks exactly like a broken role gate and cost three debugging rounds on the
> first pass. Grant it first, and note the instance name is
> **`daily-access-gate`** — the database also contains historical
> `DAILY_PLATFORM_USE` rows, and granting *that* one changes nothing:
>
> ```bash
> curl -s -X POST http://localhost:3001/api/v1/consent/decisions \
>   -H "Authorization: Bearer $T" -H "Content-Type: application/json" \
>   -d '{"consent_instance":"daily-access-gate","decision":"GRANTED","notice_version":"v1"}'
> ```
>
> **Trap 2 — the flag.** `FEATURE_JOBDISPATCH_PHASE2` is **off by default**, and
> its routes **404** rather than 403. Steps 1 and 7 are Not Run, not Failed,
> while it is off. Record its state before starting.
>
> **Trap 3 — the route path.** It is `/assignments/calendar-entries`, not
> `/assignments/calendar/entries`. The wrong path 404s identically to the flag
> being off, and an error envelope parsed with `.get('data', [])` reads as
> "0 rows" rather than as a failure. Assert on the **HTTP status**, not on the
> row count.
>
> **Trap 4 — validation is 422, not 400.** Steps 3 and 4 reject with **422**.
> A tester expecting 400 will record a pass as a fail.

---

## Step 1 — A placement carries a person and a property, not two cuids

Requires `FEATURE_JOBDISPATCH_PHASE2=true`.

```bash
curl -s -H "Authorization: Bearer $ADMIN" \
  "http://localhost:3001/api/v1/assignments/calendar-entries?per_page=3"
```

**PASS:** HTTP 200, and each row carries a nested `worker` **and** `hotel`:

```json
{ "worker": { "id": "…", "first_name": "Tomasz", "last_name": "Nowak" },
  "hotel":  { "id": "…", "name": "Hotel Adler …", "city": "Essen" } }
```

**PASS:** those objects contain **identity fields only** — no phone, no email,
no address, no commercial terms. A rota row is not a licence to read a person's
contact details.

**FAIL:** `worker`/`hotel` absent while `worker_id`/`hotel_id` are present. That
is the original defect, reported as *"instead of seeing the name for the worker
assigned to a shift, I am seeing his ID"*.

**Why this is the fix and a client-side lookup is not.** The previous
workaround resolved names by calling `/users` and matching ids — see Step 3 for
why that could never work. `AttendanceDto` has nested its person since
2026-08; this is the same fix in the same shape.

## Step 2 — A cancelled placement stays visible

In the Step 1 response, confirm rows with `assignment_status: "CANCELLED"` are
**present**.

**PASS:** they are listed. **FAIL:** they vanish — a shift that disappears with
no trace is indistinguishable from one that was never made, and the manager
cannot tell whether their cancel worked (2026-08-13 regression).

## Step 3 — The page size that broke every name on the rota

```bash
curl -s -o /dev/null -w "%{http_code}\n" -H "Authorization: Bearer $ADMIN" \
  "http://localhost:3001/api/v1/users?limit=200"   # expect 422
curl -s -o /dev/null -w "%{http_code}\n" -H "Authorization: Bearer $ADMIN" \
  "http://localhost:3001/api/v1/users?limit=100"   # expect 200
```

**PASS:** `422` then `200`.

**Why this matters more than it looks.** `ListUsersQuerySchema` caps `limit` at
100 and `validateQuery` **throws rather than clamping**. The manager app's name
resolver asked for 200, so the request never returned, and every name on the
rota fell back to its cuid. The symptom looked like a missing-name bug in the
DTO; the cause was a request that 422'd. **Two independent causes produced one
identical symptom** — fixing either alone would have left the screen wrong.

## Step 4 — A filter chip that is not a member of the enum

```bash
curl -s -o /dev/null -w "%{http_code}\n" -H "Authorization: Bearer $ADMIN" \
  "http://localhost:3001/api/v1/assignments?status=ASSIGNED"    # expect 422
curl -s -o /dev/null -w "%{http_code}\n" -H "Authorization: Bearer $ADMIN" \
  "http://localhost:3001/api/v1/assignments?status=CONFIRMED"   # expect 200
curl -s -o /dev/null -w "%{http_code}\n" -H "Authorization: Bearer $ADMIN" \
  "http://localhost:3001/api/v1/assignments?status=REASSIGNED"  # expect 200
```

**PASS:** `422`, `200`, `200`. `ASSIGNED` has never been a member of
`AssignmentStatus` (the stored default is `CONFIRMED`) — it was the **first**
filter chip in the app, so the most likely tap rejected the entire list.

**Regression guard:** `mobile/manager-app/src/__tests__/api-contract.test.ts`
pins the chip list against `schema.prisma`'s own enum block, so a member added
or removed there fails the mobile suite.

## Step 5 — A parameter the server silently drops

```bash
curl -s -H "Authorization: Bearer $ADMIN" "…/work-requests?per_page=1" # 1 row
curl -s -H "Authorization: Bearer $ADMIN" "…/work-requests?limit=1"    # NOT 1 row
```

**PASS:** `per_page=1` returns exactly 1 row; `limit=1` returns the default page
(6 rows in the reference data). zod drops the unknown key **without
complaining**, so the mobile client's page-size control did nothing at all and
nothing anywhere reported a problem.

**FAIL:** both return the same count — then `per_page` is being ignored too, and
pagination is not working at all.

## Step 6 — A work request names its hotel

```bash
curl -s -H "Authorization: Bearer $ADMIN" "…/work-requests?per_page=1"
```

**PASS:** the row carries `hotel: { id, name, city }`.

**Why:** the web broadcast list called `useHotel(hotel_id)` **once per row** and
rendered an em dash whenever that N+1 fetch failed or was in flight — while the
web's own `WorkRequest` type had already declared a `hotel` the server never
sent. The name now travels with the row that was already scoped to produce it.

## Step 7 — The assignment detail has a person on it

```bash
curl -s -H "Authorization: Bearer $ADMIN" "…/assignments/<id>"
```

**PASS:** `worker_name` is populated, alongside `assigned_by_name`, `hotel` and
the lifecycle timestamps.

**FAIL:** `worker_name` is `null` or absent while `assigned_by_name` is set.
That was the defect exactly: `enrichContext()` **declared** `workerName` and
never assigned it, so it resolved the hotel, the shift times and the *assigner's*
name and left the assigned person undefined. A screen with three of four names
filled in reads as a rendering bug, which is why it survived.

## Step 8 — A blocklist row names a person

Create one through the **real write path** — never a direct DB insert:

```bash
curl -s -X POST "…/employees/hotels/$HOTEL/blocklist" \
  -H "Authorization: Bearer $ADMIN" -H "Content-Type: application/json" \
  -d '{"employee_id":"EMP-…","reason":"repeated no-shows"}'     # expect 201
curl -s -H "Authorization: Bearer $ADMIN" "…/employees/hotels/$HOTEL/blocklist"
```

**PASS:** the listed row carries `employee_id`, `user_id`, `worker_name` and
`reason` — not merely `employment_record_id`.

**Why:** the endpoint returned **raw Prisma rows**, whose only person reference
is `employment_record_id` — not a name, not a user id, and not the
human-facing `employee_id`. The app rendered blank rows keyed by `undefined`
(duplicate React keys) because it had declared an `employee_id` field that had
never been on this wire.

### Step 8b — The cuid that made every add fail

```bash
curl -s -X POST "…/employees/hotels/$HOTEL/blocklist" \
  -H "Authorization: Bearer $ADMIN" -H "Content-Type: application/json" \
  -d '{"employee_id":"<a User cuid>","reason":"…"}'
```

**PASS:** `404 NOT_FOUND — "Employment record not found"`.

This is what the manager app sent for every blocklist add: the picker lists
users, and their `id` is a cuid, while `findRecordOrThrow` looks up
`employmentRecord.employee_id` ("EMP-W-001"). **Every add 404'd, always.** The
client now resolves the record through `/employees/by-user` first.

**Do not "fix" this by making the endpoint accept a cuid.** The 404 is correct;
the caller was wrong.

## Step 9 — A cancellation reason survives the round trip

```bash
curl -s -X PATCH "…/assignments/$ID" -H "Authorization: Bearer $ADMIN" \
  -H "Content-Type: application/json" \
  -d '{"status":"CANCELLED","cancellation_reason":"hotel closed the floor"}'
```

**Verify in Postgres, not from the 200:**

```sql
SELECT status, cancellation_reason, cancelled_at IS NOT NULL
FROM "WorkerAssignment" WHERE id = '<id>';
```

**PASS:** `CANCELLED | hotel closed the floor | t`.

**Why:** the app collected the reason, made it **mandatory** in the dialog, and
then discarded it client-side with `void reason` — while
`UpdateAssignmentSchema` had accepted `cancellation_reason` all along. Every
cancelled shift in production carries a null reason that somebody typed. A 200
proved nothing here; only the column does.

## Step 10 — The History tab, and why it was empty for everyone who could open it

This is the step worth reading twice: **nothing was broken, and the screen was
still wrong.**

```bash
curl -s -H "Authorization: Bearer $ADMIN" "…/quality/my-inspections"   # checks = 0
curl -s -H "Authorization: Bearer $ADMIN" "…/quality/checks"           # checks > 0
```

**PASS:** `my-inspections` returns 0 and `checks` returns rows, for the same
caller, at the same moment.

`/quality/my-inspections` filters on `verified_by_id = caller`. That is exactly
right for a checker and **empty forever** for a manager, RM or admin, none of
whom record inspections — so the tab was blank by construction and read as
broken rather than inapplicable. `/quality/checks` answers the question those
roles are actually asking: *which checks were recorded at my hotels.*

### Step 10a — Scope, four ways

| Caller | Scope claim | Expect |
|---|---|---|
| admin | `global` | every check |
| hotel manager | `hotel` | that hotel's checks only |
| regional manager | `hotel_group` | that group's checks only |
| manager | **none** | **0 checks, HTTP 200** |
| worker | — | **403 FORBIDDEN** |

**PASS (the one that matters):** a scoped manager with **no scope claim** gets
**zero rows, not every row**. An absent claim is not "see everything"; it fails
closed, matching `assignments/service.ts`.

**PASS:** the worker is refused by the route's `requireRole`, which names all
three management roles — `['admin','manager']` would omit `regional_manager`
silently, this codebase's most repeated bug.

### Step 10b — A requested hotel narrows and can never widen

```bash
curl -s -H "Authorization: Bearer $MANAGER" "…/quality/checks?hotel_id=$OWN_HOTEL"    # rows
curl -s -H "Authorization: Bearer $MANAGER" "…/quality/checks?hotel_id=$OTHER_HOTEL"  # 0
```

**PASS:** own hotel returns rows; another hotel returns **0**, not that hotel's
checks. `hotel_id` is ANDed with the scope filter, never substituted for it — a
stale bookmark reads as an empty list, not as a disclosure.

**FAIL:** the other hotel returns its checks → the filter is replacing the scope
instead of intersecting it. Treat as a security defect, not a display bug.

---

## Knowingly untested here

- **Anything requiring a device.** Gestures, the three multipart paths, push
  delivery, OS permission dialogs, RTL text and offline behaviour are in
  `DEVICE_VERIFICATION_CHECKLIST.md`. Every step here is an API-and-database
  assertion; none of it proves a screen renders.
- **The web hotel-detail failure** reported on 2026-09-23 ("Failed to load this
  hotel"). Not reproduced: permissions check out for all three roles and
  `checkHotelAccess` reads correctly. It needs the **HTTP status of the failing
  `/crm/hotels/:id` request** from the reporter's session. Recorded as a gap in
  `08-known-gaps-and-next.md`, never as a pass.
- **Mobile hotel detail and hotel-group detail**, whose client types still omit
  most of what the server sends — the same defect class as Step 7, not yet
  fixed at the time of writing.
