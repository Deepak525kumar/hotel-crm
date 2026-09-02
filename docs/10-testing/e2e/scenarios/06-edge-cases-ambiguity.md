# Scenario 06 — Edge Cases, Lifecycle Transitions, and Specification Ambiguity

Covers the transitions and boundary states that are easy to miss because they are not the happy
path, plus places where the specification is genuinely ambiguous and behaviour should be
**recorded rather than assumed correct**.

**Preconditions:** Scenario 00 complete.

---

## A. Deactivation and reactivation

### A1 — Deactivating a Manager must vacate their hotel

```bash
curl -s -X POST http://localhost:3001/api/v1/employees/E2E-M-01/deactivate \
  -H "Authorization: Bearer $T" -H "Content-Type: application/json" \
  -d '{"deactivation_reason":"TEMPORARY_LEAVE"}'
```

Valid reasons are `TEMPORARY_LEAVE`, `SEASONAL`, `SUSPENDED` (not `SICK_LEAVE` — that 422s).

**PASS:** record `DEACTIVATED`; `Hotel.manager_user_id` → `null`; `manager_vacated_at` set;
`manager_vacancy_reason` = `TEMPORARY`.

**And the authorization consequence (the reason this matters):** re-login as that manager —
`scope_hotel_id` must be `null`. A `DEACTIVATED` manager who still holds hotel scope can still
approve applicants; that was a live hole, and `scope_hotel_id: null` still holds
(re-verified 2026-09-02).

**Corrected 2026-09-02 — the `review-queue` half of this PASS was wrong.** Re-tested against a
fresh DB: `GET /employees/review-queue` as the deactivated manager returns `200 {"data":[]}`,
**not** `403`. `getReviewQueue()` (`employee-management/service.ts`) throws an explicit
`ForbiddenError` for an unscoped `regional_manager` (`'Regional Manager must be scoped to a
hotel group'`) but has no equivalent branch for `manager` — the original `0e6841cf` (ADR-065
Phase 2) implementation had one (`'Manager must be scoped to a hotel'`), dropped in the
2026-08-13 `resolveReviewerRecipients` routing rewrite and never reinstated. **No security
impact** — the empty result is still correct, zero applicants leak — but it is a real,
un-flagged regression, and the asymmetry with RM is the tell: RM got a dedicated fix for
exactly this UX complaint (`d3319faf`, "tell a Regional Manager why their review queue is
empty"); Manager quietly lost the same guard and nothing has restored it. Fix: reinstate the
`manager` branch's `ForbiddenError` in `getReviewQueue()`, mirroring the RM one.

### A2 — Reactivation

**Corrected 2026-09-02 — this was filed as an open ambiguity; it is not ambiguous.**
`reactivate()`'s own docstring states: *"Direct, with no re-approval and no group
re-resolution... the record is immediately assignable again."* That claim is false as the
code stands. Root cause, traced 2026-09-02: `deactivate()` clears `Hotel.manager_user_id` via
`vacateManagedScopes` (correct — someone else may cover the hotel while the manager is away)
but never touches `EmploymentRecord.hotel_group_id`/`primary_hotel_id` (also correct, and
exactly what makes A2's premise *look* true). `reactivate()` flips status back to `ACTIVE` and
touches neither field. But `resolveScope()` (`auth/service.ts:286`) — the function that
actually produces the JWT's `scope` claim, and thus every scope-gated permission — reads
**`Hotel.manager_user_id`**, not the employment record's own group/hotel columns. So a
reactivated manager is `ACTIVE`, shows a fully-populated `EmploymentRecord`, and yet has
**zero operational authority**: fresh login shows `scope_hotel_id: null`, and any scope-gated
action (e.g. `approve`) fails with `"you do not manage a hotel group"` — until an admin makes
a **manual, undocumented, un-prompted** second `assign()` call to restore the pointer the
docstring claims was never needed.

Reproduced end-to-end 2026-09-02 (fresh DB, real API calls, no seeding): approve+assign a
manager → deactivate (`TEMPORARY_LEAVE`) → reactivate → fresh login shows
`scope_hotel_id: null` and `EmploymentRecord.hotel_group_id`/`primary_hotel_id` both still
set → `approve` on any application fails `FORBIDDEN "you do not manage a hotel group"` →
explicit `assign()` with the *same* group/hotel required to restore function.

**PASS criterion should be:** after `reactivate()`, a fresh login shows the SAME
`scope_hotel_id` the manager held before deactivation, with no further action required. As
implemented, this **FAILS**. Fix candidates: (a) `reactivate()` restores
`Hotel.manager_user_id` = `record.user_id` when `record.primary_hotel_id` is set (mirrors
`vacateManagedScopes`'s clear with a symmetric restore), or (b) update the docstring and
require an explicit `assign()` after every reactivation, and surface that requirement in the
UI so it isn't silently missed the way it is today.

### A3 — Same for a Regional Manager
Deactivating an RM must clear `HotelGroup.regional_manager_user_id` equivalently.

## B. Rejection and re-entry

### B1 — Rejected record cannot be resubmitted
`POST /submit-for-review` on a `REJECTED` record → `409` *"Only a Pending employment record may
be submitted for review"*. **PASS.**

### B2 — `rehire` takes REJECTED → ACTIVE directly
This is legal by design (`RULE-EMP-03`: "Rejected → Active is a legal, direct rehire, no
re-approval"). **But assert both gates still apply:**
- Contract gate fires (`assertApprovedContract` is called from `rehire`, not just `approve`)
- Manager-tier authority is enforced (a peer Manager rehiring a Manager → `403`)

**Ambiguity to record:** `rehire` bypasses the *review* step entirely. Confirm that is intended
for Manager/RM applications, where review is the whole point of the hierarchy.

### B3 — Rejected then corrected documents
The spec marks re-application as `[OPEN]` (`OPQ-4`). Record what actually happens if a rejected
applicant uploads a corrected document — nothing should crash, but the flow is undefined.

## C. Reassignment

### C1 — Reassign a Manager to a different hotel
**PASS:** old hotel vacated (`manager_vacated_at` set, reason `TRANSFERRED`), new hotel assigned,
`HotelManagerAssignmentHistory` closed out on the old row and opened on the new.

### C2 — Assign to a hotel that already has a different manager
**PASS:** `409` *"Hotel already has a different manager assigned"* — a clear domain error, not a
raw Prisma constraint message.

### C3 — Reassign an RM to a different group
**PASS:** old group vacated, new group assigned. Note `HotelGroup.regional_manager_user_id` is
`@unique` (one group per RM), so a missing vacate step surfaces as a confusing 409 — that was the
original bug.

### C4 — Self-healing of pre-existing bad state
If a manager is (from historical corruption) recorded on two hotels, a single `assign` should
vacate **all** stale hotels via the `findMany` cleanup. Worth re-checking after any data fix.

## D. Already-terminal states

- `approve` on an already-`ACTIVE` record → `ValidationError` (illegal transition), no write.
- `deactivate` on a `PENDING` record → confirm and record the behaviour.
- `delete` (soft) is Admin-only; a scoped manager → `403`.
- `restore` after delete → confirm `employment_cycle` semantics (increments only on
  `DELETED → PENDING`).

## E. Work-permit conditionality

- `work_permit_required: false` → the six mandatory categories only; `WORK_PERMIT` **not** in
  `missing_categories`.
- `work_permit_required: true` → seven required; submit blocked until the permit is uploaded.
- The flag is an **explicit input at creation**, no longer derived from
  `personal_data.nationality` (`ADR-065` §6 item 8). Confirm nationality has no effect.
- **Ambiguity to record:** who may *edit* `work_permit_required` after creation, and via which
  endpoint? Not specified.

## F. Feature-flag matrix

| Flag | Off (default) | On |
|---|---|---|
| `FEATURE_EMPLOYMENT_RECORD` | all `/employees` routes 404 | routes live |
| `FEATURE_RM_ROLE` | RM cannot approve a Manager (Admin only) | RM in-scope can |

Test **both** states of `FEATURE_RM_ROLE` if feasible; at minimum record which was active.

## G. Target-field lifecycle ambiguity

`target_hotel_group_id`/`target_primary_hotel_id` are **not cleared** after `assign` — they
persist as live, editable defaults (`ADR-065` §6 item 7). Confirm they still hold values
post-assignment and that nothing reads them as an authorization input.

**Open question to record:** if a Manager's hotel is later moved to a *different* Hotel Group,
the stale `target_hotel_group_id` on a pending application may no longer match. Untested.

## H. Stale UI copy (known, unfixed)

An already-`ACTIVE` worker visiting `/onboarding` still sees *"Complete your required
documentation to activate your account"* plus the full checklist. The Submit button correctly
disappears, but the surrounding copy contradicts their status. Cosmetic; recorded so it isn't
rediscovered as new.

---

## Pass criteria summary

- [x] Deactivate vacates the hotel/group **and** revokes scope — **but** queue access is a
      silent `200 []`, not the documented `403` (open defect, A1)
- [ ] **OPEN:** Reactivate restores the SAME scope the manager held before deactivation with no
      further action (A2 — currently requires a manual, undocumented `assign()`)
- [ ] Reactivate restores ACTIVE; assignment-restore behaviour recorded
- [ ] RM deactivation clears the group pointer
- [ ] Rejected cannot resubmit; `rehire` enforces contract + tier authority
- [ ] Reassignment vacates the old holder and writes history both sides
- [ ] Assigning over an occupied hotel gives a clear 409
- [ ] Terminal-state transitions rejected without writes
- [ ] Work-permit conditionality correct in both states; nationality irrelevant
- [ ] Flag states recorded
- [ ] `target_*` fields persist post-assignment

## Not yet covered — candidates for next time

- A Manager's hotel being re-parented to another Hotel Group mid-application (§G)
- `bulk-import` beyond a single-row smoke test — duplicate rows, partial-failure semantics
- Soft-delete/restore interaction with an active hotel assignment
- Contract **expiry** while a worker is active (HR lifecycle intersecting onboarding)
- Timezone boundaries on `start_date` / `WorkerAssignment.day` (`@db.Date` vs local midnight)
- Very long/unicode/emoji names and 255-char filenames through the whole stack
- A user holding *two* roles' worth of state (e.g. promoted worker → manager) — is the old
  employment record reused or duplicated?
