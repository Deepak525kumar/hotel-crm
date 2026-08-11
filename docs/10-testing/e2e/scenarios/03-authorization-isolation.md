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

**PASS:** Admin sees pending Manager **and** Regional Manager applications with no scope
restriction.

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

**PASS:** `403` *"Manager must be scoped to a hotel"*, and their fresh login shows
`scope_hotel_id: null`. A `DEACTIVATED` manager retaining hotel scope was a **live
authorization hole** — this is the regression test for it.

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
- [ ] Deactivated manager loses scope and queue access

## Defects this scenario has caught

| Symptom | Root cause |
|---|---|
| Manager queue always empty | Filtered on `target_primary_hotel_id`, never populated at creation |
| `password_hash` returned in the queue | `include: { user: true }` with no `select` |
| Deactivated manager kept full hotel authority | `deactivate()` never cleared `Hotel.manager_user_id` |
