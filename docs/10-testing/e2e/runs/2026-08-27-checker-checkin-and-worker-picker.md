# E2E Run — 2026-08-27 — checker check-in and the Start-checking worker picker

- **Commit under test:** branch `claude/checker-app-auth-access-1ra86h` (PR #576), on top of `e263bc0`
- **Environment:** local PostgreSQL 16.13 cluster in the session container (`pg_ctlcluster 16 main`)
  — **not** Docker: the Docker client is installed but there is no daemon socket, so
  `docker compose up postgres` fails with "failed to connect to the docker API at
  unix:///var/run/docker.sock". Backend on `npm run dev`, port 3001. Schema by
  `prisma migrate deploy` (all migrations applied). No mobile app run — no simulator here.
- **Executed by:** agent (Claude Code), at the owner's request to test against a live database.

**Scope:** the two behaviours PR #576 changes on the server — `POST /attendance` admitting
`checker`, and `GET /quality/inspectable-workers` — plus the client-side Start-checking gate
evaluated against captured live responses. NOT a run of the numbered scenarios.

## Results

| Scenario | Result | Notes |
|---|---|---|
| 00–12 | NOT RUN | Out of scope for this pass |
| — checker check-in | **PASS** | 201, real row written; verified in the database |
| — worker check-in (regression) | **PASS** | 201 — the widened gate did not disturb it |
| — manager check-in refused | **PASS** | 403 `Insufficient permissions` |
| — cross-worker check-in refused | **PASS** | 403 `Can only check in to your own assignment` |
| — worker picker, scoping | **PASS** | Returns only the in-scope worker |
| — worker picker, permission | **PASS** | 403 for a WORKER (`quality:write`) |
| — Start-checking gate | **DEFECT FOUND, FIXED** | See below |

### Verified at the data layer

```
  assignment_id  |  role   | status | checked_in
-----------------+---------+--------+-----------
 e2e-asg-worker  | WORKER  | LATE   | t
 e2e-asg-checker | CHECKER | LATE   | t
```

A CHECKER-role attendance row with `check_in_at` set is the thing that could not exist before this
PR. Check-out was then exercised too (`PATCH /attendance/:id` → 200, `check_out_at` non-null in the
database).

The picker returned exactly one worker — the one sharing the checker's hotel — with the
out-of-scope worker (a different hotel) and the checker themselves both absent, unprompted by any
client-side filtering.

## Defect found: the Start-checking gate read other people's attendance

`GET /attendance` is **not** self-scoped for a checker — it backs the attendance-verification
queue, so it returns other workers' rows. The live response to the checker contained two rows: their
own, and a worker's.

`resolveCheckingEligibility()` had been written against the assumption that the list was the
caller's own (its own comment said so). It therefore treated *any* checked-in row as evidence the
checker was on shift — so a checker who had never checked in would have had Start checking unlocked
by an unrelated worker checking in.

Unit tests did not catch it: they were written from the same wrong assumption, with fixtures that
only ever contained the caller's rows. **Only the live response exposed it.**

Fixed by taking the signed-in user's id and filtering on `worker_id` first. Two tests added — one
pinning that another worker's row alone never allows, one that the checker's own row is picked out
of a mixed list — plus the gate was re-run against the captured before/after payloads.

## Method note, for the next person

Three preconditions bite before any of this works, and each returns a plausible-but-misleading
error:

1. **Daily consent** (`RULE-CONSENT-01`) 403s every non-exempt route with `CONSENT_REQUIRED`. Grant
   it through `POST /consent/request` then `POST /consent/decisions`. The instance identifier is
   the string **`daily-access-gate`**, not the constant's name `DAILY_ACCESS_GATE` — passing the
   latter succeeds and grants consent for an instance nothing checks, leaving the gate still
   closed while `GET /consent/status` cheerfully reports `granted`.
2. **A scheduled start.** Check-in refuses an assignment with neither a `JobRequest` nor a calendar
   entry ("shift lacks a scheduled start time"). Seed a `JobRequest` with `shift_date` and
   `shift_start_time` and point the assignment at it.
3. **Roster eligibility.** `isWorkerEligibleForHotel` requires an ACTIVE `EmploymentRecord` whose
   `hotel_group_id` covers the hotel, so the hotel needs a group and every user a record in it.
   Without it: "You are no longer eligible to work at this hotel".

A stale `Attendance` row left by a failed attempt also masks progress: the row is created before
the scheduled-start check throws, and on the next attempt the existing row (with a null
`expected_start`) takes a different branch and fails differently. Delete the row between attempts.

Users, hotel, group, employment records and assignments were seeded directly — signup only ever
mints a WORKER, so there is no API path that creates a CHECKER. Everything under test (login,
consent, check-in, check-out, the picker) went over real HTTP.

## Could not test

- **No app run.** The gate was exercised as a function against real API payloads, not by tapping
  Start checking on a device. The screen wiring (`user?.id` reaching the gate) is typechecked only.
- **No Docker.** Postgres was a local cluster; nothing here exercises the compose stack, Redis, or
  the Platform Worker.
- **Geofence untested.** Check-ins were sent without coordinates; the hotel had no geofence
  configured, so that branch never ran.
