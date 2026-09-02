# Scenario 20 — Archiving or Deleting a User, Hotel, or Group Must Not Leave a Ghost

**New scenario, added 2026-09-02.** Covers `ef0f27f6` ("deleting a user, hotel or group must
not leave the posting behind") and `e94ba804` ("an archived hotel or group must not confer
scope"), both deployed 2026-09-02 with **no dedicated scenario until now.** It exists because
these two commits fix the same underlying class of bug from two different directions (the
writer side and the reader side), found from a real production report:

> *"I deleted a hotel group, and the regional manager who was assigned to it kept showing as
> unassigned instead of being freed up — and separately, kept behaving as if they still had
> scope."*

**Preconditions:** Scenario 00 complete. Two hotel groups + hotels. An Admin, a Manager
assigned to Hotel A, a Regional Manager assigned to Group A, and at least one Worker with a
real `WorkerAssignment` at Hotel A on today's date.

**Verification status (read before trusting any step below): this scenario has never been
run end-to-end.** The steps are written from three weaker sources, and the distinction matters:

1. Unit-level test coverage that existed at implementation time (`hotel.test.ts`,
   `hotel-group.test.ts`, `users.test.ts` — the ghost-assignment and scope-vacating cases,
   per the implementing session's own record) — these mock Prisma and prove the code's
   *intent*, not its behavior against a real database.
2. A one-time production data audit, run via SQL after the fact (recorded in this repo's
   memory as `project_security_hardening_batch`-adjacent context): confirmed **current**
   production state has zero archived entities holding anyone, zero pointers at deleted
   users, zero dangling history rows. This is evidence the *invariant currently holds*, not
   evidence that a *new* delete/archive event today would preserve it — it is a snapshot, not
   a test.
3. Confirmation the fix code is present in the deployed build (grepped directly on the EC2
   host: `findFirst` with the composite filter, `deleted_at: null` in five places in
   `auth/service.ts`) — proof of *deployment*, not proof of *behavior*.

None of these three is a live HTTP walkthrough against a running stack, which is what every
other scenario in this suite requires before writing "PASS." Every `PASS:` line below states
what *should* happen and is annotated with which of the three weaker sources backs it — read
those annotations as "reasoned, not observed" until someone runs this file for real and
updates it with an actual run log per the suite's own template. **Do not report scenario 20 as
passing without running it.**

---

## Part 1 — Deleting/archiving must vacate the pointer AND close the history row

### Step 1 — Deleting a user with a live assignment

```bash
curl -s -X DELETE http://localhost:3001/api/v1/users/<MANAGER_USER_ID> -H "Authorization: Bearer $T"
```

**Expected (unverified — see status note above):** the user is soft-deleted (`User.deleted_at` set, `is_active: false`), **and**:
- `Hotel.manager_user_id` is `null` for every hotel this manager held
- `Hotel.manager_vacated_at` is set, `manager_vacancy_reason` is `'TERMINATED'` (not
  `'TEMPORARY'` — deletion is not a pause; contrast scenario 06 A1's deactivate case, which
  uses `'TEMPORARY'` for the identical field)
- the open `HotelManagerAssignmentHistory` row for this manager/hotel gets `unassigned_at` set
  (verify by reading it — a `null` `unassigned_at` after deletion means the history is lying
  about when the assignment actually ended)
- `bumpTokenGeneration` was called for this user — verify by confirming an existing session's
  refresh token for this user now fails (`401`), not merely that a fresh login would show
  different scope

Repeat for a Regional Manager, asserting the same three facts against
`HotelGroup.regional_manager_user_id` / `regional_manager_vacated_at` /
`regional_manager_vacancy_reason` / `RegionalManagerAssignmentHistory`.

### Step 2 — A worker's ghost row: pending assignments must not survive deletion

```bash
docker exec hotel-crm-postgres-1 psql -U hotelcrm -d hotelcrm_dev -c \
  "SELECT id, status FROM \"WorkerAssignment\" WHERE worker_id='<WORKER_USER_ID>' AND status NOT IN ('COMPLETED','CANCELLED','REASSIGNED');"
curl -s -X DELETE http://localhost:3001/api/v1/users/<WORKER_USER_ID> -H "Authorization: Bearer $T"
# re-run the same query
```

**Expected (unverified — see status note above):** every non-terminal assignment for the deleted worker is either cancelled
(`status: CANCELLED`, a `cancellation_reason` naming the deletion) or otherwise closed — **no
row remains in an active status pointing at a deleted user.** This is the "ghost assignment"
class of bug the commit's own title names: a hotel's schedule that still shows a shift for
someone who no longer has an account.

### Step 3 — Archiving (soft-deleting) a Hotel or HotelGroup vacates whoever held it

```bash
curl -s -X DELETE http://localhost:3001/api/v1/crm/hotels/<HOTEL_ID> -H "Authorization: Bearer $T"
```

**Expected (unverified — see status note above):** `Hotel.deleted_at` set, **and** if this hotel had a manager, that manager's own
`EmploymentRecord` scope is cleared too (not just the Hotel row — the manager should not be
left pointing at an archived hotel as if it still existed). Verify the manager's *next login*
shows no hotel scope, and that `GET /employees/review-queue` as that manager now `403`s
(scenario 03/06's own guard, restored in PR #622 — this is a second, independent path that
exercises the same guard).

Repeat for `DELETE /crm/hotel-groups/<GROUP_ID>` against its Regional Manager.

---

## Part 2 — An archived entity must confer NO scope, ever, from any angle

This is `e94ba804`'s half: even if Part 1's writes are all correct, a **stale JWT** issued
before the archive, or a **read path that doesn't filter `deleted_at`**, can still let an
archived hotel/group grant real access. Test both.

### Step 4 — `resolveScope()` must filter `deleted_at: null`

```bash
# archive Hotel A (still owned by Manager-A per Part 1)
curl -s -X DELETE http://localhost:3001/api/v1/crm/hotels/<HOTEL_A_ID> -H "Authorization: Bearer $T"

# Manager-A logs in FRESH (a stale token is a different, separate case — see Step 5)
curl -s -X POST http://localhost:3001/api/v1/auth/login -H "Content-Type: application/json" \
  -d '{"email":"manager-a@...","password":"..."}' \
  | python3 -c "import sys,json;d=json.load(sys.stdin)['data']['user'];print(d['scope_hotel_id'])"
```

**Expected (unverified — see status note above):** `null` — a fresh login for a manager whose only hotel is now archived shows no
scope, not the archived hotel's id. This is the literal regression `e94ba804` fixes:
`resolveScope()`'s query for a manager's hotel (`middleware`/`auth/service.ts`) previously had
no `deleted_at: null` filter, so an archived-but-still-`manager_user_id`-pointing hotel (a
state that should not exist per Part 1, but which is exactly the kind of thing a partial fix,
a race, or a direct DB edit can produce) would still resolve as real scope.

**Do not treat Part 1 passing as proof this is unnecessary.** The two fixes are independent
defenses: Part 1 makes the dangling pointer not exist under normal operation; Part 2 makes it
harmless even if it does. `e94ba804`'s own commit message frames this precisely — verify both,
not just the one that feels sufficient.

### Step 5 — A stale (pre-archive) access token must not retain access either

```bash
# Manager-A's token from BEFORE Hotel A was archived (do not re-login)
curl -s http://localhost:3001/api/v1/employees/review-queue -H "Authorization: Bearer $STALE_MT"
```

**Expected (unverified — see status note above):** `403`, not the manager's old, now-stale scope. Depends on `authMiddleware` doing a
live DB read on every request (`ADR-031` D-3) rather than trusting the JWT's own embedded
scope claim — the JWT's `scope` field is a cache of what `resolveScope()` said at login time,
and `authMiddleware` is what keeps that cache from outliving the fact it once described.
**If this fails while Step 4 passes**, the defect is specifically in `authMiddleware` not
re-deriving scope per-request, not in `resolveScope()` itself — a useful place to look first.

### Step 6 — The archived entity itself must not be silently reassignable through a stale reference

```bash
# admin attempts to assign a NEW manager to the archived hotel
curl -s -X POST http://localhost:3001/api/v1/employees/<NEW_MANAGER_EMP_ID>/assign \
  -H "Authorization: Bearer $T" -H 'Content-Type: application/json' \
  -d '{"hotel_id":"<ARCHIVED_HOTEL_ID>"}'
```

**Expected (unverified — see status note above):** refused (`404` "not found" is the more honest answer than `200` — an archived hotel
should behave as absent to a fresh assignment, not as a valid target). If this succeeds, a
newly-assigned manager could be silently bound to a hotel nobody can see or operate, which is
a dead end with no error to explain it.

---

## Pass criteria summary

**None of these are checked. This scenario has not been run — see the verification-status
note near the top.** Check a box only after a real HTTP walkthrough against a running stack
confirms it, and add a run log under `runs/` per the suite's template when you do.

- [ ] Deleting a Manager/RM vacates `Hotel.manager_user_id` / `HotelGroup.regional_manager_user_id`,
      sets `*_vacated_at`/`*_vacancy_reason: TERMINATED`, closes the open history row
- [ ] Deleting a Manager/RM bumps `token_generation` (existing sessions invalidated)
- [ ] Deleting a Worker cancels/closes every non-terminal `WorkerAssignment` — no ghost rows
- [ ] Archiving a Hotel/HotelGroup clears the held manager/RM's own scope, not just the
      Hotel/HotelGroup row
- [ ] `resolveScope()` filters `deleted_at: null` — an archived hotel/group confers no scope
      on a fresh login
- [ ] A stale pre-archive token also loses access (live DB read per request, not JWT-cached
      trust)
- [ ] Assigning a *new* manager/RM to an archived hotel/group is refused — the expected status
      code (`404` vs `409` vs something else) was not determined against real code, only
      reasoned about here

## Why this scenario is two parts, not one

A defect in either half alone is dangerous in a different way. Part 1 alone, without Part 2,
means the system is *usually* correct but has no defense if a dangling pointer ever occurs
by any other path (a direct DB edit, a future write path that forgets to vacate, a race). Part
2 alone, without Part 1, means the data model accumulates dangling pointers indefinitely while
authorization happens to paper over the symptom — which is worse than it sounds, because any
*other* consumer of `Hotel.manager_user_id` that isn't `resolveScope()` (a report, an export,
an admin dashboard reading the FK directly) would still show the ghost. Both were real,
independent commits for exactly this reason; this scenario tests both for exactly this reason
too.

## Governing decisions

- `ADR-031` D-3 — `authMiddleware` re-derives role/permissions from a live DB read on every
  request; the `scope` claim itself still comes from the JWT (Step 5 depends on this being
  true generally, and on `resolveScope()`'s own query being correct specifically)
- Deactivate's `vacateManagedScopes` (`employee-management/service.ts`) — the shared helper
  between `deactivate()` and `delete()`, so the two paths cannot drift; scenario 06 A1/A2 cover
  the deactivate/reactivate half of this same pointer's lifecycle
