# Scenario 05 — Race Conditions and Concurrency

Verifies `ADR-036` (optimistic concurrency) as applied to `EmploymentRecord`, plus UI-level
double-submit guards.

**Preconditions:** Scenario 00 complete. You need **fresh, submitted** records per test — a
consumed record silently makes a race test vacuous.

> **How to read results.** A correct outcome is: **one** request succeeds, the other fails with
> `409 "Record has been modified by another process."`, and the append-only
> `EmploymentStatusHistory` shows **exactly one** transition. Two successes, or two history
> rows, is a failure even if the final `status` looks right.

---

## Step 1 — Concurrent approve + reject on the same record

```bash
curl -s -X POST http://localhost:3001/api/v1/employees/E2E-RACE-1/approve \
  -H "Authorization: Bearer $T" -H "Content-Type: application/json" -d '{}' \
  -o /tmp/r1.json -w "approve: %{http_code}\n" &
curl -s -X POST http://localhost:3001/api/v1/employees/E2E-RACE-1/reject \
  -H "Authorization: Bearer $T" -H "Content-Type: application/json" -d '{"reason":"race"}' \
  -o /tmp/r2.json -w "reject:  %{http_code}\n" &
wait
```

Then inspect the history:

```ts
const r = await prisma.employmentRecord.findUnique({
  where: { employee_id: 'E2E-RACE-1' },
  include: { status_history: { orderBy: { created_at: 'asc' } } },
});
console.log(r.status, r.version, r.status_history.map(h => `${h.from_status}->${h.to_status}`));
```

**PASS:** one `200`, one `409`; **one** history row; `version` incremented once.

**Historical FAIL (the bug this test exists for):** both returned `200` and the history showed
`PENDING -> REJECTED` **and** `PENDING -> ACTIVE` — two transitions both claiming to start from
`PENDING`, a physically impossible sequence in the table the schema calls "the source of truth
for employment-cycle boundaries". Root cause: `findRecordOrThrow` read the status outside the
transaction, and the write had no version guard.

## Step 2 — Concurrent identical approvals (double-submit)

Fire two `approve` calls at once on a fresh submitted record.

**PASS:** one `200`, one `409`; exactly one `PENDING -> ACTIVE` row.
**Historical FAIL:** two `200`s and two identical `PENDING -> ACTIVE` rows.

## Step 3 — Concurrent `assign` to two different hotels

```bash
curl -s -X POST .../employees/E2E-M-01/assign -d '{"primary_hotel_id":"<HOTEL_A>"}' ... &
curl -s -X POST .../employees/E2E-M-01/assign -d '{"primary_hotel_id":"<HOTEL_B>"}' ... &
wait
```

Then read **both** hotels and the employment record.

**PASS:** the manager is recorded on **exactly one** hotel; the other has
`manager_user_id: null`; `EmploymentRecord.primary_hotel_id` agrees with the winning hotel.
No state where one person manages two hotels simultaneously.

**Note:** it is acceptable for both requests to return `200` here as long as the *data* ends
consistent (the later write vacated the earlier) — but a superseded `200` is mildly misleading,
so record it. What is **not** acceptable is both hotels pointing at the same manager.

## Step 4 — Concurrent `submit-for-review`

Two simultaneous submits on the same `PENDING` record.

**PASS:** one succeeds; the other `409`s. `submitted_for_review_at` set once.

## Step 5 — Cross-endpoint race: `assign` vs `deactivate`

Fire `assign` and `deactivate` simultaneously on the same active manager. These touch the same
`Hotel.manager_user_id` from opposite directions (one setting, one clearing).

**PASS:** the final state is internally consistent — either assigned-and-active, or
deactivated-and-vacated. A state where the record is `DEACTIVATED` but the Hotel still points at
them (or vice versa) is a **FAIL**. This combination has **not** been exercised before; treat
any finding as new.

## Step 6 — UI double-click on Approve (Playwright)

```js
const ap = page.locator('button:has-text("Approve")').first();
await Promise.all([ap.click({force:true}).catch(()=>{}), ap.click({force:true}).catch(()=>{})]);
```

Count `/approve` HTTP responses via `page.on('response', ...)`.

**PASS (either is acceptable):**
- Only **one** request fires — the UI disables the button while submitting; **or**
- Two fire and the second returns `409` — backend locking holds.

**FAIL:** two successful (200/201) responses, or duplicate history rows.

## Step 7 — Verify the version column exists and increments

```bash
grep -n "version" backend/prisma/schema.prisma | grep -i employment
```

`EmploymentRecord.version Int @default(0)` must exist. Absent = the `ADR-036` fix has been
reverted and every test above is meaningless.

---

## Pass criteria summary

- [ ] approve+reject → one 200, one 409, one history row
- [ ] approve+approve → one 200, one 409, one history row
- [ ] assign+assign → exactly one hotel holds the manager; record agrees
- [ ] submit+submit → one succeeds, one 409s
- [ ] assign+deactivate → internally consistent final state (**new coverage**)
- [ ] UI double-click produces at most one successful approval
- [ ] `EmploymentRecord.version` present and incrementing

## Not yet covered — candidates for next time

- **Sustained concurrency**, not just request pairs: 10-50 parallel mutations on one record
  (e.g. with `hey`/`autocannon`) to surface lock contention and deadlocks.
- **Three-way races** (approve + reject + deactivate simultaneously).
- **Multi-user races**: two *different* managers acting on the same applicant.
- **Concurrency in other modules**: attendance check-in/update (`ADR-036`'s original target),
  quality verification, calendar absence writes.
- **Transaction-failure injection**: kill the DB mid-transaction and confirm rollback.
- **Idempotency**: no endpoint currently takes an idempotency key; retried POSTs after a
  network timeout are unguarded.

## Defects this scenario has caught

| Symptom | Root cause |
|---|---|
| Impossible double transition in history | No version guard; status read outside the transaction |
| Duplicate identical transitions | Same |
| One manager silently managing two hotels | `assign()` never vacated the previous hotel |
