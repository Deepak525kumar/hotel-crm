# Run log — 2026-08-13 — Calendar/Assignment/Broadcast integration audit

**Trigger:** four reports (from a separate analysis pass) claiming 22 defects
across Calendar, Assignments, Broadcasts, Attendance, and Quality/Ratings.
**Method:** every claim was independently re-verified by reading the actual
source (not taken on trust), then the highest-priority ones were confirmed
live against the running production instance. This log covers the first
fixed batch; the rest are tracked below as still open.

---

## Verified real, and fixed in this batch

### Ghost shifts (`listCalendarEntries`)

**Confirmed live in production** before fixing: the `/calendar` grid showed
"worker 1 — 1 worker staffed" at two hotels on days where that worker's
assignment was already `Cancelled` (auto-cancelled when they were marked
sick), sitting directly next to the correct "Sick" tag for the same
worker/day.

Root cause: `AssignmentService.listCalendarEntries()` queried `CalendarEntry`
with no join or filter against its 1:1 `WorkerAssignment.status`, and no
cancellation path (`update()`, calendar's own auto-cancel-on-sick-mark)
touched the `CalendarEntry` row. Fixed by adding
`assignment: { status: { notIn: [CANCELLED, REASSIGNED] } }` to the query's
`where` clause.

### `moveCalendarEntry` — missing absence check

Every other assignment-creation/move path (`placeOnCalendar`, `reassign`,
`acceptBroadcast`) calls `isWorkerAbsentOnDay()` before scheduling a worker
onto a day. `moveCalendarEntry` (the calendar grid's drag-and-drop handler)
never did — a manager could drag a shift directly onto a day the worker had
already declared sick/vacation. Fixed: added the identical check, only when
the target day actually differs from the entry's current day.

### `moveCalendarEntry` — broadcast slot desync

A broadcast-accepted assignment (`skill_slot_id` set) kept counting against
its **original day's** broadcast slot forever after being dragged to a
different day — `moveCalendarEntry` only ever wrote
`CalendarEntry.day`/`WorkerAssignment.day`, never touching `skill_slot_id`
or the slot's `confirmed_count`. Two compounding failures followed:

1. The original day's broadcast reads permanently "filled" for a worker who
   is no longer coming that day.
2. If the worker later cancels (including via calendar's own
   auto-cancel-on-sick-mark on the **new** day), the cancellation path
   decrements `confirmed_count` on the **original** slot — restocking a
   broadcast for a day that was never actually vacated by this move.

Fixed by detaching the assignment from the broadcast the moment its day
changes: decrement the original slot's `confirmed_count` and clear
`skill_slot_id`/`job_request_id` in the same transaction, converting it into
a plain calendar placement (the identical null/null shape `placeOnCalendar()`
already produces). This is the "cleanly detach" option from the original
report, not blocking the move outright — a manager rescheduling a shift by a
day is a legitimate action, and the broadcast that originally sourced the
worker has no further claim on where they end up.

**Test coverage:** `calendar-entries.test.ts` — new cases for the absence
block, the same-day no-op (must NOT consult absences or detach), broadcast
detachment on an actual day change, and non-broadcast placements being
left untouched. Full backend suite: 2726/2726 passing after this batch.

---

## Verified real, still open (tracked for the next batches)

- **Broadcast `list()` has no skill filter** — a worker sees every open
  broadcast at their hotel regardless of skill match; `acceptBroadcast()`
  correctly blocks the accept, but the UX is confusing. Confirmed by reading
  `list()`'s `where` clause construction.
- **`closeExpiredBroadcasts()` ignores fill state** — queries the raw stored
  `status` column with no check against `skill_slots`, so a fully-staffed
  broadcast still reads `OPEN` in the DB (by design — fill status is derived
  at read time, never stored) and gets swept into `EXPIRED` with a false
  "closed unfilled after 6 hours" notification.
- **`deriveFillStatus` hides partial fill under `EXPIRED`** — the same root
  cause compounds: a broadcast that was 2-of-3 filled when it expired shows
  purely as `EXPIRED`, with nothing surfacing that two workers had already
  accepted.
- **`refreshWorkerOverallRating`'s `totalAssignments` has no status filter**
  — `workerAssignment.count({worker_id})` counts CANCELLED and future-dated
  CONFIRMED assignments in the denominator, so a manager-cancelled shift or
  a worker picking up next week's shifts both drag down completion/on-time
  rate.
- **`UpdateAttendanceSchema` has no `check_in_at` field** — a manager has no
  way to correct a missed/failed check-in.
- **`verifyGeofence` discards coordinates for a non-geofenced hotel** —
  returns before the transaction that would persist a `WorkerGeoCheckin`
  audit row. Confirmed real, but the code's own comments show this was a
  deliberate call (OD-GEO-004), not an oversight — lower severity than the
  others, and the only one of the six that needs a schema migration
  (`distance_meters`/`inside_radius` are non-nullable columns) to fix
  properly.

## Not tested live

Native HTML5 drag-and-drop (the calendar grid's actual UI for
`moveCalendarEntry`) could not be reliably simulated by the available browser
automation — the two `moveCalendarEntry` fixes above were verified by
reading the code path directly and by unit test, not by dragging a tile in
the browser. The broadcast list/auto-close claims were verified by code
reading only, not re-confirmed live (would require either an ineligible
worker account or waiting out the 6-hour auto-close window).
