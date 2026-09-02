# Scenario 14 — Payslip Requests

**New scenario, added 2026-09-02** (closing a long-standing gap first recorded 2026-08-22 —
this feature shipped in PRs #487–#491 with `ADR-014`/`SPEC-HR-001` as its governing
specification but no E2E scenario until now). All steps below were run live against a real
Postgres/S3 stack on 2026-09-02.

**Preconditions:** Scenario 00 complete. A Worker with a real `EmploymentRecord.start_date`,
approved and assigned to a Manager's hotel. `ADR-039`'s own scope note: this feature tracks
*requests for* a payslip and their fulfilment status — it does **not** compute payroll. There
is no payslip content anywhere in this system; "fulfil" means a human confirms they emailed
one outside the platform.

---

## Step 1 — Worker requests their own payslip

```bash
curl -s -X POST http://localhost:3001/api/v1/hr/payslip-requests -H "Authorization: Bearer $WT" \
  -H 'Content-Type: application/json' -d '{"period_start":"2026-09-02","period_end":"2026-09-02"}'
```

**PASS (verified live):** `201`, `status: "REQUESTED"`.

**The date validation is real and worth trying to break, not just trust:**
- `period_start` before `EmploymentRecord.start_date` → `422`
  `"Payslip request cannot start before the worker joining date"`. Confirmed to the
  **timestamp**, not just the calendar date — a `period_start` on the same calendar date as
  `start_date` but logically "before" the exact join moment can still be refused; test the
  boundary with a period that starts the same day the worker was created.
- `period_end` in the future → `422` `"Payslip request cannot end in the future"`. A
  full-month period (`period_end` at month's end) will be refused on any day before that
  month has actually ended — this is correct behavior, not a bug, but it is easy to trip over
  when picking test dates. Use a period fully within already-elapsed time.

`worker_id` is **never** a client-supplied field on this route (`OD-HR-10`/`FIND-SEC-HR-03`
IDOR guard) — it is always `req.auth.userId`. There is no request body field that could smuggle
a different worker's id in.

## Step 2 — Manager sees the request; another worker does not (IDOR)

```bash
curl -s "http://localhost:3001/api/v1/hr/payroll?limit=50" -H "Authorization: Bearer $MT"
curl -s "http://localhost:3001/api/v1/hr/payroll?limit=50" -H "Authorization: Bearer $OTHER_WORKER_T"
```

**PASS (verified live):** the requesting worker's Manager sees the request in their
hotel-group-scoped list; a **different, unrelated worker** does not see it in their own
(self-scoped) list. This is the same IDOR-guard shape as `getContractStatus` and several other
`hr/` endpoints in this codebase — worth checking specifically because it is a recurring class
of bug in this module, not assuming the guard exists because the docstring says it does.

## Step 3 — Manager fulfils the request

```bash
curl -s -X POST http://localhost:3001/api/v1/hr/payroll/$REQUEST_ID/fulfil -H "Authorization: Bearer $MT" \
  -H 'Content-Type: application/json' -d '{}'
```

**PASS (verified live):** `200`, `status: "FULFILLED"`. Verify at the data layer, not the
response: `fulfilled_by_id` and `fulfilled_at` both set on the `PayslipRequest` row.

## Step 4 — Cross-group fulfil is refused

```bash
# a Manager scoped to a DIFFERENT hotel group attempts to fulfil
curl -s -X POST http://localhost:3001/api/v1/hr/payroll/$REQUEST_ID/fulfil -H "Authorization: Bearer $OTHER_GROUP_MT" \
  -H 'Content-Type: application/json' -d '{}'
```

**PASS (verified live):** `403 "Cannot fulfil a payslip request outside your scope"`. Worth
calling out specifically: `PayslipRequest` carries no `hotel_id`/`hotel_group_id` column of its
own (per the route's own comment) — scope enforcement is entirely indirect, resolved inside
`hrService.fulfilPayslipRequest()` via `request → worker_id → EmploymentRecord.hotel_group_id
→ caller's own scope`. A route-level `checkWorkerScope()` cannot gate this endpoint directly
(the path param is a request id, not a worker id), so this chain is the **only** thing standing
between a manager and another group's payslip requests — confirm it holds rather than assuming
route-level middleware is doing the work here, since for this one endpoint it structurally
cannot.

## Step 5 — Manager-initiated creation on a worker's behalf

```bash
curl -s -X POST http://localhost:3001/api/v1/hr/payroll -H "Authorization: Bearer $MT" \
  -H 'Content-Type: application/json' \
  -d '{"worker_id":"<WORKER_ID>","period_start":"2026-09-02","period_end":"2026-09-02"}'
```

**PASS (verified live):** `201`, `status: "REQUESTED"` — this is the separate,
Manager/Admin-initiated route (`POST /hr/payroll`, distinct from the worker's own `POST
/hr/payslip-requests`); it accepts `worker_id` in the body deliberately, unlike the
self-service route.

**PASS (verified live):** creating on behalf of a worker **outside** the manager's hotel group
→ `403 "Cannot access worker <id>"` — this route DOES have a `worker_id` in the body, so
`checkWorkerScope()` at the route layer catches it directly (contrast Step 4, where the same
class of cross-scope check has to happen inside the service instead).

## Step 6 — Frontend surface

Not run this pass (no browser session used for this scenario). The profile page (`/users/:id`)
renders a "Payslip Requests" card with a "New request" button and an empty-state message —
observed as a byproduct of an unrelated scenario 07 investigation, not independently
walked through. Confirm: the card's list, the New Request form's date fields, and whether a
Manager can trigger both the create and fulfil actions from this same surface.

---

## Pass criteria summary

- [x] Worker self-request succeeds; `worker_id` is never client-suppliable
- [x] `period_start` before joining date refused
- [x] `period_end` in the future refused
- [x] Manager (in-scope) sees the request; an unrelated worker does not (IDOR)
- [x] Manager fulfils; `fulfilled_by_id`/`fulfilled_at` set, verified at the data layer
- [x] Cross-group fulfil refused, via the request→worker→group indirection
- [x] Manager-initiated creation on a worker's behalf succeeds
- [x] Manager-initiated creation for an out-of-scope worker refused
- [ ] Frontend "Payslip Requests" card — not independently verified this pass

## Governing specifications

- `ADR-014`, `SPEC-HR-001` — the feature's own governing records (per the README's original
  gap-tracking entry)
- `ADR-039` — scope: tracks requests and fulfilment only, no payroll computation
- `ADR-042` — `hr:payslip:request` permission, self-scoped worker route
- `ADR-043` — Admin sees all; Manager/RM scoped via `resolveNonAdminScopeFilter`
- `OD-HR-10` / `FIND-SEC-HR-03` — the IDOR guard pattern this module uses repeatedly
- `RULE-HR-09` / `OD-HR-13` — the fulfil endpoint's indirect scope resolution
