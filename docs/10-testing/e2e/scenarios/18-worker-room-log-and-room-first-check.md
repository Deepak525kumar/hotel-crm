# 18 — The worker's room log, and the checker's room-first inspection

**Added 2026-09-01** with the room-log feature (owner decision). Covers the gap
that existed until then: a worker had no way to record WHICH rooms they
cleaned. `RoomsCompletedEntry` was a *manager*-entered integer, and
`QualityVerification.room_number` was free text a checker typed from memory, so
nothing connected "the rooms a worker cleaned" to "the room being inspected".

Read `12-checker-photo-evidence-and-rework.md` first: this scenario changes how
an inspection *starts*, and that one still owns the evidence/rework assertions
(including the auto-pass, which landed in the same change).

**What is deliberately NOT here:** there is no canonical `Room` table. A room's
identity is `(hotel_id, day, room_key)` — scoped to a hotel so "412" at two
hotels can never collide, and to a day because the room is cleaned again
tomorrow. Any test that assumes a per-hotel room catalogue is testing a design
that was explicitly rejected.

## Setup

Reuse `00-environment-setup.md`. You need, on the same day and hotel:
a worker (`$WT`) with an assignment they have **checked in** to, a second
worker (`$W2T`) at the same hotel, a checker (`$CT`) with their own active
assignment at that hotel, a manager (`$MT`) scoped to it, a regional manager
(`$RMT`) over its group, and a manager scoped to a **different** hotel
(`$MT_OTHER`).

```bash
API=http://localhost:3001/api/v1
```

## Step 1 — The worker logs a room

```bash
curl -s -X POST -H "Authorization: Bearer $WT" -H 'Content-Type: application/json' \
  -d '{"room_number":"412"}' $API/rooms/assignments/$ASSIGNMENT_ID/rooms
```

**PASS:** `201`, and the row exists with `room_key = '412'`, `day` equal to the
**assignment's** day (never a client-supplied date), and `verification_id NULL`:

```bash
docker exec hotel-crm-postgres-1 psql -U hotelcrm -d hotelcrm_dev -t -c \
  "SELECT room_number, room_key, day, worker_id, verification_id FROM \"RoomLog\";"
```

Verify at the data layer, not on the `201`. A response body proves the request
shape was accepted; only the row proves `worker_id`/`hotel_id`/`day` were taken
from the assignment rather than from the request.

## Step 2 — Logging is gated on being checked in

Repeat Step 1 against an assignment still `CONFIRMED` (not checked in).

**PASS:** `400`, and **no row is written**. A room logged by someone who never
arrived is worse than a missing room: it is a false record of work.

## Step 3 — One log per room per day, across workers

With room 412 already logged by worker 1, have **worker 2** log `412` at the
same hotel, same day:

```bash
curl -s -X POST -H "Authorization: Bearer $W2T" -H 'Content-Type: application/json' \
  -d '{"room_number":"412"}' $API/rooms/assignments/$ASSIGNMENT2_ID/rooms
```

**PASS:** `409`, the message **names the worker who already has it**, and there
is still exactly **one** `RoomLog` row for that room/day.

Then repeat with `" 412 "` and `"412 "`/`"412A"` variants:
- `" 412 "` → `409` (trim + upper-case is the collision key);
- `"0412"` → `201`. A leading zero is deliberately significant: hotels exist
  that use `012` and `12` as different rooms, and a wrong merge silently
  collapses two workers' work into one record and cannot be undone.

Fire two concurrent claims of a fresh room number (`&` both curls).

**PASS:** exactly one `201` and one `409`, one row. The guard is a database
unique index (`RoomLog_hotel_id_day_room_key_key`), not a service-layer read —
a read-then-write passes sequentially and creates two rows under concurrency.

## Step 4 — A worker cannot touch another worker's log

```bash
curl -s -o /dev/null -w "%{http_code}\n" -X PUT -H "Authorization: Bearer $W2T" \
  -H 'Content-Type: application/json' -d '{"room_number":"999"}' $API/rooms/logs/$ROOM_LOG_ID
curl -s -o /dev/null -w "%{http_code}\n" -X DELETE -H "Authorization: Bearer $W2T" \
  $API/rooms/logs/$ROOM_LOG_ID
```

**PASS:** `403` on both, nothing changed in the database. The rule is keyed on
**identity**, not role — repeat the DELETE as an **admin** and expect `403`
too. An admin editing a worker's own accountability record would be falsifying
it; the manager's read-only view exists for oversight instead.

## Step 5 — The checker's picker is derived from the logs, and scoped

```bash
curl -s -H "Authorization: Bearer $CT" "$API/rooms/for-check" | jq '.data'
```

**PASS:** room 412 appears under `awaiting_check`, carrying `worker_id` and
`worker_name` — this is what auto-fills the worker on the inspection, replacing
the checker typing a room number from memory.

Now the scope matrix. Each row must be checked positively **and** negatively,
or a service that denies everyone would pass:

| Caller | Expected |
| --- | --- |
| `$CT` (checker rostered at the hotel today) | sees the hotel's rooms |
| `$CT` on a day they have **no active assignment** | sees **nothing** (a checker's visibility comes from being on site; their JWT carries no scope claim) |
| `$CT` with `?hotel_id=<other hotel>` | **`403`**, not an empty list — an empty list would let a checker enumerate which hotels exist and have activity by probing ids |
| `$MT` (manager of the hotel) | sees only that hotel |
| `$MT_OTHER` | sees **nothing** of this hotel; `?hotel_id=<this hotel>` → `403` |
| `$RMT` | sees every hotel in the group, and only those |
| admin | sees everything |
| `$WT` (worker) | `403` — a worker reads their own rooms via `/rooms/mine`, which takes no worker id at all |

Also check `/rooms/mine` returns **only the caller's** rooms while
`/rooms/for-hotels` (manager/RM) returns per-worker counts confined to their
scope, and that `/rooms/suggestions?hotel_id=` refuses a hotel the caller has
never worked at (`403`).

## Step 6 — Inspecting through the picker links the room to the check

Submit an inspection carrying `room_log_id` (multipart, photo required):

```bash
curl -s -X POST -H "Authorization: Bearer $CT" \
  -F "assignment_id=$ASSIGNMENT_ID" -F "worker_id=$WORKER_ID" \
  -F "room_number=412" -F "room_log_id=$ROOM_LOG_ID" \
  -F "score=90" -F "outcome=complete" -F "photos=@fixture.jpg" \
  $API/quality/inspections
```

**PASS:** `201`, and `RoomLog.verification_id` now points at the new check:

```bash
docker exec hotel-crm-postgres-1 psql -U hotelcrm -d hotelcrm_dev -t -c \
  "SELECT rl.room_number, rl.verification_id, qv.status
     FROM \"RoomLog\" rl LEFT JOIN \"QualityVerification\" qv ON qv.id = rl.verification_id;"
```

This link is the whole mechanism: `RoomLog` stores **no status of its own**, so
a room's state (`AWAITING_CHECK` / `PASSED` / `NEEDS_REWORK` /
`REWORK_SUBMITTED`) is derived from this verification. A lost link means the
room reads "awaiting check" forever while an inspection sits against it.

Now the mismatch cases — send `room_log_id` from one room with another room's
`assignment_id`, `worker_id`, or `room_number`:

**PASS:** `400` each time, and **no verification row is created**. Attributing
an inspection — and the rework that follows it — to the wrong worker is the one
error nobody downstream can detect, which is why the server cross-checks rather
than trusting either side.

A `room_number` differing only in case or surrounding whitespace must be
**accepted** (same room key), or the picker breaks the moment a client trims
what it displays.

## Step 7 — The log locks once inspected

Retry Step 4's PUT/DELETE as the **owning** worker, now that the room has been
checked.

**PASS:** `409` on both. Before the check, the same calls succeed — that is the
editable window, and it exists so a mis-tap is self-service to fix. After it,
freezing the row is what stops an inspection being orphaned from its room.

## Step 8 — A room nobody logged is still inspectable

Submit an inspection for a room number that has **no** `RoomLog`, omitting
`room_log_id` entirely.

**PASS:** `201`, verification created, no `RoomLog` touched. This is the
picker's "room not on the list" fallback. Without it a room a worker forgot to
log, or skipped entirely, would be literally uninspectable — the worst case to
hide.

## Step 9 — Rework state round-trip

Send room 412 back (`POST /quality/rework`), then complete it as the worker.

**PASS, in `/rooms/mine`:**
- while the round is open: state `NEEDS_REWORK`, and `rework_assignment_id` is
  populated — this is what the worker's "Go to rework" tap navigates to, and it
  must appear in the `needs_rework` list **regardless of day**, because
  `createReworkAssignment` dates the rework shift *today* even when the room
  was cleaned yesterday. A day-filtered list alone hides the one item with a
  20-minute escalation clock on it;
- after the worker submits: state `REWORK_SUBMITTED` (not plain `PASSED`), and
  `rework_assignment_id` back to `null`.

**PASS, in `/rooms/for-check`:** the room moves into the `reworked` group, not
`already_checked`. That group is the checker's "review photos" list — with
auto-pass it is the only place a human is invited to look at the fix, so an
empty group here means the review affordance has silently disappeared.

**PASS:** a rework assignment must **refuse** its own room log
(`POST /rooms/assignments/<rework assignment>/rooms` → `400`). Rework changes
the ORIGINAL room's state; a second log would put room 412 in the picker twice
and double-count the day's rooms.

## Step 10 — Analytics keeps its history

```bash
curl -s -H "Authorization: Bearer $MT" "$API/analytics/stats" | jq '.data.rooms_completed'
```

**PASS:** the total is legacy `RoomsCompletedEntry` sums **plus** `RoomLog`
counts. The two are mutually exclusive per assignment, so they cannot
double-count — and reading room logs alone would collapse every historical
figure to zero, which reads as data loss on any trend.

## Pass criteria summary

1. A log's identity fields come from the assignment, never the request.
2. Logging requires being checked in.
3. One room per hotel per day, enforced by a unique index, message names the holder.
4. Only the owning worker may edit/remove, and only before the room is checked — admin included in the denial.
5. Every role sees exactly its own scope; an out-of-scope `hotel_id` is a `403`, never an empty list.
6. `room_log_id` links the check and is cross-checked; mismatches write nothing.
7. An unlogged room stays inspectable.
8. Rework state round-trips through `NEEDS_REWORK` → `REWORK_SUBMITTED`, surfaced to the checker for review.
9. Analytics preserves historical counts.

## Knowingly untested here

- **Concurrent inspection of the same room by two checkers.** There is no
  unique constraint on `(assignment_id, room_number)` for verifications (a
  re-check after rework is legitimate), so two simultaneous checks of one room
  produce two verifications and the log points at whichever committed last. No
  data is lost; the older check is simply no longer the room's state. Judged
  acceptable rather than serialised — flagged here rather than left to be
  rediscovered.
- **The mobile room tab and the checker's picker UI** are covered only by unit
  tests and manual walk-through; `07-frontend-ui-playwright.md` covers the web.
- **Timezone boundary.** "Today" is anchored to Europe/Berlin
  (`todayInCalendarTimezone`, OD-CAL-04) and pinned by a unit test, but no E2E
  run has exercised a 00:00–02:00 Berlin window against a real database.
