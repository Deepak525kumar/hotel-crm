# Scenario 02 — Manager and Regional Manager Onboarding

Verifies the hierarchical approval chain and the **two-step approve-then-assign** rule that
distinguishes Manager/RM from Worker/Checker (`ADR-065` §3 items 4 and 6).

**Preconditions:** Scenario 00 complete. **Record the `FEATURE_RM_ROLE` state** — it changes
expected results in step 4.

---

## The approval chain under test

| Applicant role | May be approved by | May **not** be approved by |
|---|---|---|
| Worker / Checker | Manager, Regional Manager, Admin | worker, checker |
| Manager | Regional Manager (flag on), Admin | a peer Manager; RM when `FEATURE_RM_ROLE` is off |
| Regional Manager | **Admin only** | Manager, **another RM** |
| Admin | n/a — Admin has no onboarding | — |

## Step 1 — Create a Manager application

As **Admin**, `target_hotel_group_id` is **required** (Admin has no own scope to default from):

```bash
curl -s -X POST http://localhost:3001/api/v1/employees -H "Authorization: Bearer $T" \
  -H "Content-Type: application/json" \
  -d '{"user_id":"<MGR_USER>","employee_id":"E2E-M-01","job_title":"Hotel Manager",
       "start_date":"2026-09-01","target_hotel_group_id":"<GROUP>"}'
```

**PASS:** created `PENDING`, scope null, `target_hotel_group_id` as supplied.
Omitting it as Admin **must** fail: *"Admin must explicitly provide a target_hotel_group_id
when creating a Manager application"*.

As **Regional Manager** (flag on), `target_hotel_group_id` **auto-fills from the RM's own
group**; supplying a *different* group must be rejected.

## Step 2 — Same document gate as everyone else

Manager/RM are **not** exempt (`ADR-065` §6 item 2, as corrected). Submit before uploading:

**PASS:** `409` naming the same six categories. A Manager/RM-specific exemption is a **FAIL** —
that was an early misreading; "bypass the chatbot" never meant "bypass documents".

## Step 3 — Peer Manager cannot approve a Manager

```bash
curl -s -X POST http://localhost:3001/api/v1/employees/E2E-M-01/approve \
  -H "Authorization: Bearer $MT" -H "Content-Type: application/json" -d '{}'
```

**PASS:** `403` — *"only Admin or Regional Manager can manage Manager applications"*.

Also verify `rehire` enforces the same rule (it is a second path to `ACTIVE`):
`POST /employees/E2E-M-01/rehire` as a peer Manager → `403` with the same class of message.

## Step 4 — RM approving a Manager depends on the flag

- **`FEATURE_RM_ROLE` off (default):** RM → `403`
  *"only Admin can manage Manager applications while RM role is disabled"*; Admin → succeeds.
- **Flag on:** an RM scoped to the target group → succeeds; an RM scoped elsewhere → `403`.

**Regression note:** this check did not exist at first — `isRmRoleEnabled()` had exactly one
consumer (an unrelated script) and RM approval was unconditional. Verify the flag is genuinely
consulted; don't infer it from the env file.

## Step 5 — Regional Manager application

- Created by **Admin only**.
- `target_hotel_group_id` is **not required** and may stay `null` — RM applications are always
  reviewed by Admin, so there is no scoped reviewer to route to (`ADR-065` §6 item 9).
- A **peer RM** attempting to approve → `403` *"only Admin can manage Regional Manager
  applications"*. This is the important case: RM-approves-RM must not be possible.

## Step 6 — Approve writes NO scope (the critical assertion)

```bash
curl -s -X POST http://localhost:3001/api/v1/employees/E2E-M-01/approve \
  -H "Authorization: Bearer $T" -H "Content-Type: application/json" -d '{}' | python3 -m json.tool
curl -s http://localhost:3001/api/v1/crm/hotels/<HOTEL> -H "Authorization: Bearer $T" \
  | python3 -c "import sys,json; print('manager_user_id:', json.load(sys.stdin)['data']['manager_user_id'])"
```

**PASS:** record is `ACTIVE` with `hotel_group_id: null`, `primary_hotel_id: null`, **and**
`Hotel.manager_user_id` still `null`. The state is *Active, Unassigned*.

**Why:** approval carries no information about *which* hotel the approver intends — that is a
separate input only they can supply (`ADR-065` §3 item 6). Worker/Checker's fused behaviour is
deliberately different; do not "harmonise" them.

## Step 7 — Assign (the second, separate action)

```bash
curl -s -X POST http://localhost:3001/api/v1/employees/E2E-M-01/assign -H "Authorization: Bearer $T" \
  -H "Content-Type: application/json" \
  -d '{"hotel_group_id":"<GROUP>","primary_hotel_id":"<HOTEL>"}' | python3 -m json.tool
```

**PASS:** `EmploymentRecord.hotel_group_id`/`primary_hotel_id` set **and**
`Hotel.manager_user_id` now equals the user id — **verify by reading the Hotel**, not just the
response. For an RM, check `HotelGroup.regional_manager_user_id` instead.

**FAIL conditions (all real past defects):**
- Response `200` but `Hotel.manager_user_id` still null → the cross-entity write is missing
- Any `password_hash` in the response body
- Empty body `{}` returning `200` instead of a validation error
- A nonexistent hotel id yielding a generic *"Resource not found"* rather than
  *"Target hotel or hotel group not found"*

## Step 8 — Field names matter

`assign` takes **`primary_hotel_id`**, not `hotel_id`. Sending `hotel_id` is silently ignored
(no validation error) and looks like a successful no-op. If that is still true, note it.

---

## Step 9 — Review-queue routing (each application in exactly ONE queue)

Rewritten 2026-08-13. The queue is filtered by the **same** function that picks the
"awaiting review" notification recipient (`resolveReviewerRecipients`), so the queue a record
lands in and the person notified about it cannot disagree — they previously did. Routing is by
**who the applicant is and where they are headed**, never by who created the account (under
ADR-065 that is whoever created the *user*, usually an admin):

| Applicant | Reviewer |
|---|---|
| Regional Manager | Admin |
| Manager | RM of the target group; Admin if none, or while `FEATURE_RM_ROLE` is off |
| Worker / Checker | manager of the target hotel → else that group's RM → else Admin |

Submit one application of each tier, then `GET /employees/review-queue` as **each** of admin,
the target hotel's manager, and the group's RM.

**PASS:**
- every submitted application appears in exactly **one** actor's queue (compare the three
  responses — an id in two of them is a finding, and means two reviewers can act and the
  second gets a stale-state error)
- a Worker application with a managed target hotel does **not** appear in admin's queue
- admin's queue contains an application only when no manager/RM can review it
- the recipient of the `ONBOARDING_SUBMITTED` notification (check the `Notification` table)
  is an actor whose queue actually contains that record
- an applicant never reviews their own application

## Pass criteria summary

- [ ] Admin must supply `target_hotel_group_id` for a Manager app; RM auto-fills its own
- [ ] Manager/RM subject to the identical six-document gate
- [ ] Peer Manager blocked from approving a Manager (via both `approve` and `rehire`)
- [ ] Peer RM blocked from approving an RM; Admin succeeds
- [ ] `FEATURE_RM_ROLE` genuinely gates RM's Manager-approval authority
- [ ] RM application accepted with `target_hotel_group_id` null
- [ ] Approve leaves **all** scope pointers null, including `Hotel.manager_user_id`
- [ ] Assign writes both the EmploymentRecord fields and the Hotel/HotelGroup FK
- [ ] No `password_hash` in any lifecycle or assign response

## Defects this scenario has caught

| Symptom | Root cause |
|---|---|
| `assign` returned 200 but the hotel had no manager | Only wrote EmploymentRecord, never `Hotel.manager_user_id` |
| RM approved a Manager with the flag off | `isRmRoleEnabled()` never consulted in the authority check |
| `password_hash` in responses (three separate times) | `include: { user: true }` without a `select` |
| `assign {}` returned a silent 200 no-op | No `.refine()` requiring at least one target |
| Admin saw every review request | Admin's branch claimed all admin-created records; under ADR-065 that is nearly all of them |
| Reviewer notified could not see the record; reviewer who could was never told | Queue routing and notification routing were two independent implementations that drifted |
| RM shown a Manager application they were forbidden to reject | Queue matched on `created_by_id` while the authority check refuses an RM while `FEATURE_RM_ROLE` is off |
| Manager/Checker/RM's own profile page showed no Employment status, no Confirm/Approve/Reject, no Contract/Payslip cards at all | `users/[id]/page.tsx` gated all of it on `user.role === "worker"`; every lifecycle endpoint is actually role-agnostic on the subject (2026-08-13, found in live QA) |
