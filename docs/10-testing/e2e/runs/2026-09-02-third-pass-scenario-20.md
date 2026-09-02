# E2E Run — 2026-09-02 (third pass) — scenario 20, live for the first time

- **Commit under test:** `bb9c7f37` (main) plus the branch `fix/manager-queue-guard-and-reactivate-scope`
  (PR #622), whose own fix this pass produces
- **Environment:** local dev (`hotelcrm_dev`), fresh throwaway fixtures created specifically
  for this scenario (RM/Manager/Worker fully onboarded through a dedicated third hotel group,
  plus two more disposable RMs for the stale-token and archived-target cases)
- **Executed by:** Claude (agent), continuing the user's instruction to run through untested
  scenarios and push any fixes found into the same PR
- **Stack versions:** unchanged from the day's earlier runs

## Why this run

Scenario 20 (archive/delete scope-vacating) was authored earlier the same day from
implementation-time evidence — unit tests, a one-time production data audit, and confirmation
the fix was deployed — explicitly marked as unverified, with an honest note that none of that
is equivalent to a live HTTP walkthrough. This run is that walkthrough.

## Results

All six steps in the scenario were run live. Five passed exactly as documented (one — Step
5 — passed via a *stronger* mechanism than originally predicted, corrected in the scenario
file). Step 6 found a real, previously-unknown defect, fixed in the same pass.

| Step | Result |
|---|---|
| 1 — Delete a Manager with a live hotel assignment | PASS. `User.deleted_at` set, `is_active: false`, `Hotel.manager_user_id` → `null`, `manager_vacated_at` set, `manager_vacancy_reason: TERMINATED`, `HotelManagerAssignmentHistory`'s open row closed, `token_generation` bumped `0` → `1` |
| 2 — Delete a Worker with a live `CONFIRMED` assignment | PASS. Assignment became `CANCELLED` with `cancellation_reason: "Employee deleted (Account deleted by administrator)"` — no ghost row |
| 3 — Archive a HotelGroup held by an RM | PASS, with a correction: `HotelGroup.regional_manager_user_id` cleared correctly; the RM's own `EmploymentRecord.hotel_group_id` is deliberately left set (same pattern as deactivate/reactivate — see scenario 06) rather than a bug |
| 4 — `resolveScope()` filters `deleted_at: null` | PASS. RM's fresh login after their group's archive showed `scope_hotel_group_id: None`; `review-queue` correctly `403`'d |
| 5 — Stale pre-archive token | PASS, stronger than predicted. A token captured and confirmed working immediately before an archive, reused immediately after with no re-login, got `401 TOKEN_REVOKED` — `deleteHotelGroup()`/`deleteHotel()` call `bumpTokenGeneration` in the same transaction as the archive, the identical mechanism user-deletion uses. Original doc text predicted a `403` from per-request scope re-derivation; corrected to describe the actual, stronger mechanism |
| 6 — Assigning a new manager/RM to an archived hotel/group | **FAIL, then fixed.** See below |

## New defect found and fixed

**`assign()` would bind a live Manager/RM to an archived Hotel/HotelGroup** —
`backend/src/modules/employee-management/service.ts`, `assign()`'s `targetHotel`/`targetGroup`
lookups. LOW-MEDIUM severity: no authorization impact was observed (`resolveScope()`'s
`deleted_at` filter, verified in Step 4, means the newly-assigned RM's fresh login still
showed no real scope), but it is a real, reproducible data-integrity defect — a live person
ends up recorded as running an entity that no longer exists, in a field other consumers might
reasonably trust.

**Root cause:** `targetHotel = await tx.hotel.findUnique({ where: { id: ... } })` (and the
equivalent `hotelGroup` lookup) had no `deleted_at` filter. An archived hotel/group has
`manager_user_id`/`regional_manager_user_id` set to `null` — because archiving correctly
vacates it (`crm/service.ts` `deleteHotel`/`deleteHotelGroup`) — so the existing "already has
a different manager/RM assigned" conflict check read that `null` as "free" rather than
"doesn't exist," and let the write through.

**Reproduced live before fixing:** created and fully onboarded a throwaway RM, archived their
group, then created a *second* throwaway RM and called `assign()` targeting the same archived
group. Got `200 success`; `HotelGroup.regional_manager_user_id` was written to point at the
new RM despite the group being archived. Confirmed the new RM's own fresh login still showed
no real scope from it (Part 2's defense working as designed) — but the write itself was wrong.

**Fixed:** both lookups now check `!target || target.deleted_at` and throw the existing
`NotFoundError('Target hotel or hotel group not found')` — the same message already used for
"the id doesn't exist at all," since an archived entity should behave identically to an
absent one from `assign()`'s perspective. The fix sits inside the same `$transaction` as the
`EmploymentRecord` update, so throwing here rolls back that write too — verified live: the
identical repro (assign a third throwaway RM to the same archived group) now returns
`404`, and the `EmploymentRecord`'s `hotel_group_id` stayed `null` with `version` unchanged
(no partial write).

**Regression tests added:** `backend/src/__tests__/onboarding-assign-requires-approval.test.ts`
— chosen because it already pins the sibling privilege-escalation defect this one resembles
(assign() as the sole writer of real scope, with a gap that let it write somewhere it
shouldn't). Three new tests: refuse a Manager→archived-hotel assign, refuse an
RM→archived-group assign, and confirm a live (non-archived) target still works. All pass.
Full backend suite: 148 suites, 3574 tests, serial, all passing. `npx tsc --noEmit` clean.

## Why this defect is a clean illustration of the scenario's own "why two parts" argument

The scenario file argues that Part 1 (writer-side correctness) and Part 2 (reader-side
defense) are independent and both necessary — a defect in either alone is dangerous in a
different way. This run produced exactly that situation for real: a genuine Part-1-adjacent
gap (`assign()` writing to an archived target) existed, and Part 2's `deleted_at` filter in
`resolveScope()` caught it in practice, so the observable impact was zero. That is the
system working as designed — but "Part 2 caught it" is not a reason to leave Part 1 broken;
it is validation that both layers earn their keep, which is what this run demonstrates with a
real defect rather than a hypothetical one.

## Could not test

- Deleting (not archiving) a Regional Manager's own account specifically — the equivalent RM
  write path was exercised via archive instead (Step 3), not via `DELETE /users/:rm_id`
- The Manager/Hotel half of Step 4 (archiving a `Hotel` directly rather than a `HotelGroup`,
  then confirming the *Manager's* fresh login shows no scope) — only the RM/HotelGroup half
  was run; the code path is structurally identical (confirmed by reading `auth/service.ts`)
  but not independently re-verified live

## Scenario files updated this run

- `20-archive-delete-scope-vacating.md` — every step updated from "expected, unverified" to
  real observed results; Step 3's over-strong original claim corrected; Step 5's mechanism
  corrected to the stronger, actually-observed one; Step 6 rewritten in full with the real
  defect, its fix, and the live re-verification; all pass-criteria boxes checked with what was
  actually confirmed
