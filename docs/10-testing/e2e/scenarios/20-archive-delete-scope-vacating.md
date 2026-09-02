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

**Verification status, updated 2026-09-02 (second pass): this scenario HAS now been run
end-to-end**, against a fresh set of throwaway fixtures (a fully-onboarded RM, Manager, and
Worker, plus a second disposable RM for the stale-token case) created specifically for this
file, on a local dev stack with a real Postgres instance. Steps 1–5 all show `PASS` with real,
observed output below. The original draft of this file (see git history) was written from
three weaker sources — implementation-time unit tests, a one-time production data audit, and
confirmation the fix code was deployed — none of which is a live HTTP walkthrough; that draft
correctly flagged itself as unverified rather than overclaiming, and this pass replaced that
flag with real results. Two things remain genuinely untested (Step 1's RM-deletion case
specifically, and Step 6) — marked as such where they occur, not silently dropped.

**One correction worth flagging on its own:** Step 5 (the stale-token case) turned out
stronger than originally reasoned — see that step for what was actually observed
(`401 TOKEN_REVOKED` via a token-generation bump on archive, not merely a `403` from a
per-request scope re-derivation).

---

## Part 1 — Deleting/archiving must vacate the pointer AND close the history row

### Step 1 — Deleting a user with a live assignment

```bash
curl -s -X DELETE http://localhost:3001/api/v1/users/<MANAGER_USER_ID> -H "Authorization: Bearer $T"
```

**PASS (verified 2026-09-02, live, manager case).** Ran for real against a fully-onboarded,
assigned throwaway manager: `User.deleted_at` set, `is_active: false`,
`Hotel.manager_user_id` → `null`, `manager_vacated_at` set,
`manager_vacancy_reason: 'TERMINATED'` (confirmed distinct from `'TEMPORARY'`, the deactivate
case), `HotelManagerAssignmentHistory`'s open row closed (`unassigned_at` set,
`reason: 'TERMINATED'`), and `token_generation` incremented from the default `0` to `1`
(confirmed against a sibling account that has never been deleted, still at `0`).

**Not separately re-run for the Regional Manager case in this pass** — the equivalent
`HotelGroup`/`RegionalManagerAssignmentHistory` write path was exercised instead via archive
(Step 3/Step 5 below use an RM), which is the more consequential of the two RM paths tested
this pass; deleting (not just archiving) an RM's own account specifically was not repeated.

### Step 2 — A worker's ghost row: pending assignments must not survive deletion

```bash
docker exec hotel-crm-postgres-1 psql -U hotelcrm -d hotelcrm_dev -c \
  "SELECT id, status FROM \"WorkerAssignment\" WHERE worker_id='<WORKER_USER_ID>' AND status NOT IN ('COMPLETED','CANCELLED','REASSIGNED');"
curl -s -X DELETE http://localhost:3001/api/v1/users/<WORKER_USER_ID> -H "Authorization: Bearer $T"
# re-run the same query
```

**PASS (verified 2026-09-02, live).** A `CONFIRMED` `WorkerAssignment` for a real, deleted
worker became `CANCELLED` with `cancellation_reason: "Employee deleted (Account deleted by
administrator)"` — a clear, deletion-attributed reason, not a bare status flip. No row
remained in a non-terminal status pointing at the deleted user.

### Step 3 — Archiving (soft-deleting) a Hotel or HotelGroup vacates whoever held it

```bash
curl -s -X DELETE http://localhost:3001/api/v1/crm/hotels/<HOTEL_ID> -H "Authorization: Bearer $T"
```

**PASS, verified 2026-09-02 live — with a correction to what "cleared too" means.** Ran for
real (`DELETE /crm/hotel-groups/<GROUP_ID>` against a real, assigned RM):
`HotelGroup.deleted_at` set, `HotelGroup.regional_manager_user_id` → `null`. **The RM's own
`EmploymentRecord.hotel_group_id` was NOT cleared** — it stayed pointing at the now-archived
group. This is not a bug; it is the same deliberate pattern already established and
documented for deactivate()/reactivate() (scenario 06 A1/A2): the `EmploymentRecord`'s own
association is treated as "who this person is affiliated with," while *live authority* is
derived entirely from the cross-entity pointer (`HotelGroup.regional_manager_user_id` /
`Hotel.manager_user_id`) at request time. The original wording above ("scope is cleared too")
was too strong — what actually matters, and what Step 4 confirms, is that the residual
`EmploymentRecord` pointer is harmless because nothing authoritative reads it directly.

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

**PASS (verified 2026-09-02, live, RM case).** Ran for real: a Regional Manager's group was
archived, and their immediately-following fresh login showed `scope_hotel_group_id: None`
(not the archived group's id), and their own `GET /employees/review-queue` call correctly
`403`'d with `"Regional Manager must be scoped to a hotel group"`. This is the literal
regression `e94ba804` fixes — confirmed against a real archive event this pass performed
itself, not only against the pre-existing production data the fix was originally verified
against. Manager case (`Hotel` rather than `HotelGroup`) not separately re-run this pass —
`resolveScope()`'s manager branch and RM branch use the identical `deleted_at: null` filter
pattern (confirmed by reading `auth/service.ts` directly), so this is lower-risk to leave
unverified than most of the other unchecked items in this file, but it is still unchecked.

**Do not treat Part 1 passing as proof this is unnecessary.** The two fixes are independent
defenses: Part 1 makes the dangling pointer not exist under normal operation; Part 2 makes it
harmless even if it does. `e94ba804`'s own commit message frames this precisely — verify both,
not just the one that feels sufficient.

### Step 5 — A stale (pre-archive) access token must not retain access either

```bash
# RM's token, captured and confirmed working IMMEDIATELY BEFORE the archive (do not re-login)
curl -s http://localhost:3001/api/v1/employees/review-queue -H "Authorization: Bearer $STALE_RMT"
```

**PASS (verified 2026-09-02, live).** Ran for real: a Regional Manager's token was captured
and confirmed working (`200 review-queue`) immediately before their `HotelGroup` was
archived, with no re-login in between. The same token, reused right after the archive, got:

```
401 {"code":"TOKEN_REVOKED","message":"Token has been revoked"}
```

**This is a stronger, and different, mechanism than this step originally predicted.** The
original text here reasoned that `authMiddleware`'s live per-request DB read
(`ADR-031` D-3) would re-derive scope and produce a `403`. What actually happens is one layer
earlier: `deleteHotelGroup()`/`deleteHotel()` (`crm/service.ts:717` / `:402`) call
`bumpTokenGeneration(tx, group.regional_manager_user_id)` / `(tx, hotel.manager_user_id)` in
the same transaction as the archive — the identical mechanism `delete()` on a user uses (Part
1, Step 1). A stale token is rejected outright at the token layer before scope is ever
re-evaluated; it never gets far enough to matter whether `resolveScope()` would have filtered
it correctly. Verify `403` only as a fallback path (e.g. a scope check that somehow runs
against a token generation that hasn't rolled over yet) — the primary, observed, and stronger
guarantee is `401 TOKEN_REVOKED`.

**If this ever regresses to a `403` instead of a `401`,** that alone is not a failure — it
would mean the token-generation bump stopped firing but `resolveScope()`'s own `deleted_at`
filter (Step 4) still caught it. **If it regresses to a `200` with stale access, that is the
real failure**, and the two independent layers (token bump, scope filter) mean either one
alone failing should still be caught by the other — check which one actually broke rather than
assuming.

### Step 6 — The archived entity itself must not be silently reassignable through a stale reference

```bash
# admin attempts to assign a NEW regional manager to the archived group
curl -s -X POST http://localhost:3001/api/v1/employees/<NEW_RM_EMP_ID>/assign \
  -H "Authorization: Bearer $T" -H 'Content-Type: application/json' \
  -d '{"hotel_group_id":"<ARCHIVED_GROUP_ID>"}'
```

**REAL DEFECT, found live 2026-09-02, fixed in the same pass.** Before the fix: `200 success`
— a fully-onboarded RM was assigned to an archived `HotelGroup`, and
`HotelGroup.regional_manager_user_id` was written to point at them.
`assign()`'s `targetGroup`/`targetHotel` lookups (`employee-management/service.ts`) had no
`deleted_at` filter, so an archived group — whose `regional_manager_user_id` is `null`
*precisely because archiving vacates it* — passed the "already has a different RM" check as
if it were free.

**Impact was bounded, not zero.** Confirmed live: the newly-assigned RM's fresh login still
showed `scope_hotel_group_id: None` — `resolveScope()`'s own `deleted_at` filter (`e94ba804`,
Part 2 above) makes the write harmless for authorization purposes. But the write itself was
still wrong: it left `HotelGroup.regional_manager_user_id` pointing at a live person on a dead
entity, which is misleading to anyone reading the raw data (an audit, a report, a future
consumer of that field that isn't `resolveScope()`) even though the system behaves correctly
today. This is a textbook demonstration of the "why two parts" argument above: Part 2's defense
covered for Part 1's (a different, related) gap, exactly as designed, and the fix belongs in
Part 1 rather than being skipped because Part 2 happened to catch it.

**Fixed:** both lookups now check `!target || target.deleted_at` and throw the same
`NotFoundError('Target hotel or hotel group not found')` already used for "doesn't exist at
all" — an archived hotel/group now behaves as absent to `assign()`, consistently with every
other write path in this module. Verified live: the identical repro (assign a fresh RM to the
same archived group) now returns `404`, and the transaction rolled back cleanly — no partial
`EmploymentRecord` write, confirmed at the data layer (`hotel_group_id` stayed `null`,
`version` did not increment). Three new unit tests in
`onboarding-assign-requires-approval.test.ts` (the file that already pins the sibling
privilege-escalation defect this one resembles) pin the refusal for both Manager/Hotel and
RM/HotelGroup, plus a positive case confirming a live (non-archived) target still works.

---

## Pass criteria summary

Updated 2026-09-02 (second pass) after actually running this scenario. Run log:
`runs/2026-09-02-third-pass-scenario-20.md`.

- [x] Deleting a Manager vacates `Hotel.manager_user_id`, sets `manager_vacated_at`/
      `manager_vacancy_reason: TERMINATED`, closes the open history row — verified live.
      RM-deletion case (as opposed to RM-archive, which was covered) not separately re-run
- [x] Deleting a Manager bumps `token_generation` (existing sessions invalidated) — verified
      live (`0` → `1`, confirmed against a never-deleted sibling account)
- [x] Deleting a Worker cancels/closes every non-terminal `WorkerAssignment` — no ghost rows —
      verified live
- [x] Archiving a HotelGroup clears `HotelGroup.regional_manager_user_id` — verified live, with
      a correction: the RM's own `EmploymentRecord.hotel_group_id` is deliberately NOT cleared
      (same pattern as deactivate/reactivate) and this is fine because of the next item
- [x] `resolveScope()` filters `deleted_at: null` — an archived hotel/group confers no scope
      on a fresh login — verified live (RM case; Manager/Hotel case not separately re-run, but
      code-confirmed to use the identical filter pattern)
- [x] A stale pre-archive token also loses access — verified live, and **stronger than
      predicted**: `401 TOKEN_REVOKED` via a `bumpTokenGeneration` call inside the same
      archive transaction, not merely a `403` from per-request scope re-derivation
- [x] Assigning a *new* manager/RM to an archived hotel/group is refused — **was a real
      defect** (`200` success, wrote a live pointer onto an archived entity), found and fixed
      live this pass; re-verified after the fix returns `404` with a clean transaction rollback

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
