# Scenario 03 — Authorization, Scope Isolation, and the Review Queue

Verifies `ADR-065` §6 item 6: a reviewer's queue is **filtered to their own scope**, not merely
gated by role. Also covers negative authorization across the hierarchy.

**Preconditions:** Scenario 00 complete, including the **second** hotel group + hotel. You need
pending, submitted applications in *both* groups to prove isolation rather than emptiness.

> **Trap:** an empty queue proves nothing on its own — it may mean isolation works, or that
> nothing was ever submitted. Always establish a **positive** case (the reviewer sees what they
> should) alongside the negative one.

---

## Step 1 — Manager's queue: positive and negative together

```bash
curl -s http://localhost:3001/api/v1/employees/review-queue -H "Authorization: Bearer $MT" \
  | python3 -c "import sys,json; print([r['employee_id'] for r in json.load(sys.stdin)['data']])"
```

**PASS:** contains the applicant targeting **this manager's own hotel**, and does **not**
contain the one targeting the second group's hotel.

Manager's filter keys on `target_primary_hotel_id` = their own hotel. If the queue is
unexpectedly empty, check that field is populated on the record — it being `null` (while
`target_hotel_group_id` is set) was the exact cause of a permanently-empty manager queue.

## Step 2 — Regional Manager's queue

**PASS:** an RM scoped to group A sees applications targeting hotels **within group A** and
nothing from group B. RM filters on `target_hotel_group_id`.

## Step 3 — Admin's queue

**Corrected 2026-09-02.** "Manager and RM only" was true only through 2026-08-12. The
2026-08-13 reviewer-routing rewrite (code comment at `employee-management/service.ts`
`getReviewQueue()`) replaced hand-written Prisma predicates with a shared resolver
(`resolveReviewerRecipients`) that routes by **who the applicant is and where they are
headed**, not by tier:
`Regional Manager applicant -> Admin`; `Manager applicant -> the RM of their target group
(Admin if none, or while RM role is disabled)`; `Worker/Checker applicant -> the manager of
their target hotel, else that group's RM, else Admin`. Admin is the reviewer of **last
resort** for every tier, so a Worker/Checker application whose target hotel has no manager
(and whose group has no RM) legitimately appears in Admin's queue too — re-verified
2026-09-02: an admin-created worker targeting an unmanaged hotel/group showed up in Admin's
queue with no other route available. This is intentional — the alternative is an application
no reviewer can ever see.

**PASS:** Admin sees every pending application with no scope restriction — Manager and
Regional Manager applications always, plus any Worker/Checker application that has no
in-scope Manager or RM to route to.

**Security check on this response:** it embeds the applicant `user`. Confirm the payload
contains **no `password_hash`** and no other sensitive field:

```bash
curl -s http://localhost:3001/api/v1/employees/review-queue -H "Authorization: Bearer $T" \
  | python3 -c "import sys; b=sys.stdin.read(); print('LEAK' if 'password_hash' in b else 'clean')"
```

## Step 4 — Roles with no queue access

```bash
for who in worker checker; do
  curl -s http://localhost:3001/api/v1/employees/review-queue -H "Authorization: Bearer $TOKEN_FOR_$who"
done
```

**PASS:** `403 FORBIDDEN` for both. A worker/checker must never enumerate applicants.

## Step 5 — Cross-scope action denial (not just visibility)

Hiding a row is not enough — the *action* must also be refused if the id is guessed:

```bash
# Manager in group A attempts to approve an applicant targeting group B
curl -s -X POST http://localhost:3001/api/v1/employees/<GROUP_B_APPLICANT>/approve \
  -H "Authorization: Bearer $MT" -H "Content-Type: application/json" -d '{}'
```

**PASS:** `403`. Verify the same for `reject`, `assign`, and `deactivate`.

## Step 6 — Document access by a reviewer

Per `ADR-061` + `ADR-066`, a reviewer reads applicant documents through the **existing**
documents module, scoped by `checkWorkerScope()`:

```bash
curl -s http://localhost:3001/api/v1/documents/workers/<APPLICANT_USER>/documents \
  -H "Authorization: Bearer $MT"          # in-scope manager -> 200 + list
curl -s http://localhost:3001/api/v1/documents/workers/<OTHER_GROUP_APPLICANT>/documents \
  -H "Authorization: Bearer $MT"          # out-of-scope -> 403
```

Also confirm a **worker cannot read another worker's** documents (self-scoped), and that a
worker **can** read their own.

## Step 7 — Frontend route-level gating

With the UI running (scenario 07 covers this in depth), confirm at minimum:
- A **worker** navigating directly to `/onboarding/review-queue` sees **no applicant data**.
- **Admin** has no "My Onboarding" nav entry (`ADR-065` §6.9 — Admin has no onboarding).
- A worker has no "Review Queue" nav entry.

## Step 8 — Deactivated actor loses scope

Covered in depth in scenario 06, but assert the authorization consequence here:

```bash
# after deactivating the manager
curl -s http://localhost:3001/api/v1/employees/review-queue -H "Authorization: Bearer $MT_FRESH"
```

**PASS:** `scope_hotel_id: null` on a fresh login. A `DEACTIVATED` manager retaining hotel
scope was a **live authorization hole** — the `scope: null` half of this assertion is the
regression test for it, and still holds (re-verified 2026-09-02).

**FAIL, found 2026-09-02, unfixed:** `review-queue` does **not** return `403` for a
deactivated (or otherwise unscoped) manager — it returns `200` with `data: []`. The original
`0e6841cf` (ADR-065 Phase 2) implementation had an explicit guard, symmetric with the RM one
still present today:
```ts
if (actor.role === 'manager') {
  if (actor.scope?.type !== 'hotel') {
    throw new ForbiddenError('Manager must be scoped to a hotel');
  }
  ...
```
It was dropped in the 2026-08-13 `resolveReviewerRecipients` rewrite (`getReviewQueue()`,
`employee-management/service.ts`) and never reinstated — only `regional_manager`'s guard
survives there today (`'Regional Manager must be scoped to a hotel group'`). No security
impact — the filter still returns zero rows either way, confirmed by direct test (deactivated
manager's `review-queue` call: `200 {"data":[]}`) — but it is a real, silent regression: the
RM side got its own dedicated fix for this exact complaint (`d3319faf`, "tell a Regional
Manager why their review queue is empty"); the Manager side lost its explicit message and
nothing has restored it. Fix: reinstate the `manager` branch's `ForbiddenError`, mirroring the
RM one, in `getReviewQueue()`.

---

## Pass criteria summary

- [ ] Manager sees own-hotel applicants only (positive **and** negative case shown)
- [ ] RM sees own-group applicants only
- [ ] Admin sees Manager + RM applications
- [ ] No `password_hash` in the review-queue payload
- [ ] Worker/Checker get 403 on the queue
- [ ] Cross-scope `approve`/`reject`/`assign`/`deactivate` all 403
- [ ] Reviewer document access follows scope; worker self-access works, cross-worker doesn't
- [ ] Worker at the manager-only URL renders no applicant data
- [ ] Admin has no "My Onboarding"; worker has no "Review Queue"
- [x] Deactivated manager loses scope (`scope_hotel_id: null`) — **but** see the open defect
      below: the queue call itself returns `200 []`, not the documented `403`

## Defects this scenario has caught

| Symptom | Root cause |
|---|---|
| Manager queue always empty | Filtered on `target_primary_hotel_id`, never populated at creation |
| `password_hash` returned in the queue | `include: { user: true }` with no `select` |
| Deactivated manager kept full hotel authority | `deactivate()` never cleared `Hotel.manager_user_id` |
| **OPEN (found 2026-09-02):** deactivated/unscoped manager gets a silent `200 []` from `review-queue` instead of an explicit `403` | The 2026-08-13 `resolveReviewerRecipients` rewrite dropped the original per-role scope guard for `manager` (present at `0e6841cf`) and never reinstated it; only `regional_manager`'s survives. No data leaks — filter still yields zero rows — but the manager gets no explanation, unlike the RM case (`d3319faf` fixed the identical complaint for RM only). Fix: restore the `manager` branch's `ForbiddenError` in `getReviewQueue()`. |
| **Doc-only (found 2026-09-02):** `deactivate()`/`reactivate()` asymmetry | `deactivate()` correctly clears `Hotel.manager_user_id` via `vacateManagedScopes`; `reactivate()` restores `EmploymentRecord.status`/`hotel_group_id`/`primary_hotel_id` but never restores `Hotel.manager_user_id`. `resolveScope()` (`auth/service.ts`) reads `Hotel.manager_user_id`, not the employment record's own fields — so a reactivated manager is `ACTIVE` and "scoped" on their own record, yet has **zero operational authority** (fresh login: `scope_hotel_id: null`) until an admin calls `assign()` again. Contradicts `reactivate()`'s own docstring ("no re-approval and no group re-resolution... the record is immediately assignable again"). See scenario 06 (deactivate/reactivate lifecycle) for the primary write-up; flagged here because it is what this scenario's own Step 8 setup hit directly. |
