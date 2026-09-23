# Scenario 24 — Manager app: the rota, dispatch and attendance verification

Verifies the operational half of `mobile/manager-app`: moving a placement by
drag, marking and moving absences, work requests and broadcasts, and
attendance verification. Governing records: `ADR-075` D-6 (the calendar is
designed, not ported), `MoveCalendarEntrySchema` (day-only move, product
decision 2026-08-05), `ADR-030` C-25/C-26, and `CALENDAR_TIMEZONE`.

**Status:** New scenario, added 2026-09-22.

**Preconditions:** scenario 00's data. At least two placements on different
days for one hotel, one worker with an absence, one open work request.
**Record `FEATURE_JOBDISPATCH_PHASE2`'s state before starting** — with it off,
every placement route 404s and half this scenario is Not Run rather than
Failed.

> **Trap:** these routes 404 when the flag is off, they do not 403. A client
> cannot distinguish "not permitted" from "not built" from the status code
> alone, so a tester who assumes 404 = broken will file a bug against a
> deliberate configuration.

---

## Step 1 — The agenda opens on today, in Berlin

**PASS:** the Rota tab opens on today's date **as Europe/Berlin reckons it**,
not as the device does.

Set the device to UTC-11 and relaunch between 00:00 and 02:00 Berlin.

**PASS:** still the Berlin day.

**Why:** `new Date('YYYY-MM-DD')` is midnight UTC while "today" here is
Berlin, so the naive version hands a night-shift manager yesterday's rota and
places tomorrow's staff on the wrong date. Pinned by unit tests, but those
pin the helper — this pins the screen.

## Step 2 — Long-press and drag moves a placement

Long-press a placement row for ~400ms until it lifts (haptic), drag onto
another day in the strip, release.

**PASS:** the row springs home, the agenda refreshes, and the placement now
appears under the target day. **Verify in Postgres, not from the toast:**

```sql
SELECT id, day FROM "CalendarEntry" WHERE id = '<entry id>';
```

**PASS:** `day` equals the target. A success toast with an unchanged row is
the failure this check exists for.

**FAIL conditions:**
- Nothing happens at all on Android → `GestureHandlerRootView` is not mounted
  at the root. It was absent from this repository entirely before 2026-09-22,
  and nothing warns
- The list scrolls instead of lifting → the pan is activating without the
  long-press delay and is fighting the scroll view
- The row animates to the new day *before* the server responds → the row is
  moving itself; it must spring home and let the refreshed data place it

## Step 3 — A drop that is not a day does nothing

Drag a row and release it over the agenda body, over a hotel section header,
and off the edge of the strip.

**PASS:** no request is sent in any of the three cases, and `updated_at` on
the row is unchanged. **"Nearest day" is not acceptable** — a guess here moves
the wrong person's shift.

Release on the day the placement already occupies.

**PASS:** no request at all. Not a 200 with no change — nothing sent.

## Step 4 — The same move, without touching the screen

With VoiceOver (iOS) or TalkBack (Android) on, focus a placement row, open
the rotor/actions menu, choose "Move to another day".

**PASS:** the move happens. A drag is inoperable with a screen reader — there
is no gesture for "pick up and move to the 24th" — so this action is the only
path for those users and must work.

## Step 5 — Absences: mark, move, and the vacation-reason rule

Mark a worker sick for today. Then mark one vacation **without a reason**.

**PASS:** sick succeeds; vacation is rejected with a message naming the
reason field, not a generic failure. `MarkAbsenceSchema` refuses a VACATION
with no reason, and this client sending one without it was already a real
defect once (every vacation request came back 422).

Move the absence to another day.

```sql
SELECT day FROM "CalendarAbsence" WHERE id = '<absence id>';
```

**PASS:** the row moved.

## Step 6 — A cancelled placement is still visible

Cancel a placement.

**PASS:** it remains on the agenda, rendered distinctly, rather than
vanishing. A shift that disappears is indistinguishable from one that was
never made, and the manager cannot tell whether their cancel worked.

## Step 7 — Work requests and broadcasts are one list

**PASS:** the Requests screen lists both; the type filter narrows to
broadcasts via `is_broadcast`, not a second endpoint. Publish a draft; cancel
one with a reason.

```sql
SELECT status, cancellation_reason FROM "WorkRequest" WHERE id = '<id>';
```

**PASS:** the reason is persisted, not merely collected by the dialog.

## Step 8 — Attendance verification writes what it claims

Open an unverified record, set a status, add a note, tap Mark as verified.

```sql
SELECT status, is_verified, verified_by_id, verified_at
FROM "Attendance" WHERE id = '<id>';
```

**PASS:** all four correct, and `verified_by_id` is the **signed-in manager**
— the client never sends it, so a wrong value here means the server resolved
the actor from something other than the token.

**FAIL conditions:**
- `is_verified` true but `verified_by_id` null
- The list still shows the row as unverified after a pull-to-refresh

## Step 9 — Cross-scope attendance is refused

As a manager of hotel A, attempt to verify a record belonging to hotel B.

```bash
curl -s -o /dev/null -w '%{http_code}\n' -X PATCH \
  -H "Authorization: Bearer $MANAGER_A_T" -H 'Content-Type: application/json' \
  -d '{"is_verified":true}' http://localhost:3001/api/v1/attendance/$HOTEL_B_RECORD
```

**PASS:** `403`.

**Why this is the step that matters:** `PATCH /attendance/:id` has **no
route-level role gate**. The service is the entire authorization boundary, so
this assertion is the only thing standing between a manager and another
hotel's timesheets.

> **Run live 2026-09-23 — PASS.** Recorded as "could not test" for weeks
> because no attendance row existed at a second hotel. The fixture is not hard,
> it just has to be built from real paths, and `28` Step 6 is now the recipe:
> place an **eligible** worker at hotel B, have that worker check in (no
> coordinates needed — `CheckInSchema` takes latitude/longitude together or not
> at all), then attempt the verify as hotel A's manager.
>
> Observed: `403 "Cannot access this attendance record"`, `is_verified` still
> `false` and `verified_by_id` still null when read back from Postgres — and
> the same manager also gets **`403` on the GET**, so the record is not merely
> unwritable but invisible. Assert both; a boundary that refuses the write
> while serving the row still discloses another hotel's timesheet.

## Pass criteria summary

- [ ] Agenda opens on the Berlin day from a device in another timezone
- [ ] Drag moves a placement, **verified by a Postgres read**
- [ ] Drop off-strip / on the origin day sends nothing
- [ ] The accessibility action performs the same move
- [ ] Vacation without a reason is refused with a field-specific message
- [ ] Absence move persists
- [ ] A cancelled placement stays visible
- [ ] Requests and broadcasts are one list; cancellation reason persists
- [ ] Verification writes status, is_verified, verified_by_id, verified_at
- [ ] Cross-scope verification returns 403
- [ ] `FEATURE_JOBDISPATCH_PHASE2` state recorded in the run log

## Knowingly untested here

- **Recurring placement (×26).** The progress sheet reports per-occurrence
  results, but no run has exercised a partial failure against a real database
  — it needs a deliberate conflict mid-run, which no fixture creates yet.
- **Two managers dragging the same placement simultaneously.** There is no
  optimistic-concurrency guard on `CalendarEntry` move, so last write wins.
  Judged acceptable (a placement has one owner in practice) rather than
  serialised — flagged here rather than left to be rediscovered.
- **The month density grid.** Built as counts only; no run has checked its
  arithmetic against a month spanning a DST change.
