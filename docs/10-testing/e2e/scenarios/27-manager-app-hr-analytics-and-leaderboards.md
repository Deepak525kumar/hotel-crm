# Scenario 27 — Manager app: HR contracts, analytics, and the two leaderboards

Covers the read surface that had no scenario at all: the HR contract list, the
analytics dashboard and hotel summary, and the **two different leaderboards**
this system serves behind two different permission tokens.

Every assertion here is about **which rows a caller gets**, not about
formatting. Each of these endpoints is scoped server-side, and a scoping bug
is a disclosure, not a display bug — this repository has already shipped one
(`listCalendarEntries` took `hotel_id` straight from the client until
2026-08-10) and one near-miss (the group branch of `inspectable-workers`).

Governing records: `ADR-030` §3 (capability matrix), `ADR-067` (worker
visibility of the quality leaderboard), and `backend/src/config/constants.ts`
(`ROLE_PERMISSIONS`, the only authority on what a role holds).

**Status:** New scenario, added 2026-09-23. **All steps run live the same day**
— results in `runs/2026-09-23-manager-app-hr-analytics.md`.

---

## Preconditions

Scenario 00's data, plus the five callers scenario 26 uses: **admin**,
**hotel-scoped manager**, **regional manager**, a **manager with no scope
claim**, and a **worker**. At least one `EmploymentRecord` with a contract and
one `QualityVerification`.

> **The no-scope manager is the point of this scenario, not an edge case.**
> Two of the checks below pass trivially for a correctly-scoped caller and are
> the only thing standing between an unassigned manager and the whole estate.
> If your fixture has no such account, create one — a manager whose
> `scope` claim is absent. Without it, Steps 1 and 3 are vacuous.

> **Trap:** grant `daily-access-gate` consent for every non-admin caller first,
> or every row below reads `403 CONSENT_REQUIRED` and looks like a role-gate
> failure. See scenario 26's preconditions.

---

## Step 1 — The HR contract list is scoped, and a worker cannot open it at all

```bash
curl -s -o /dev/null -w '%{http_code}\n' -H "Authorization: Bearer $T" \
  http://localhost:3001/api/v1/hr/contracts
```

| Caller | Expect |
|---|---|
| admin | `200`, every contract |
| hotel manager | `200`, **strictly fewer** — their hotel's people only |
| regional manager | `200`, their group's people |
| manager, no scope claim | `200` with **zero rows** |
| worker | **`403`** |

**Reference run:** admin `35`, hotel manager `9`, no-scope manager `0`.

**PASS:** the manager's count is strictly less than the admin's **and** greater
than zero. Equal counts mean the scope filter is not applied; zero for a
*scoped* manager means your fixture has no contracts at that hotel and the step
is vacuous — fix the fixture, do not record a pass.

**PASS:** the worker is refused by the route's `requireRole`, which names all
three management roles. `['admin','manager']` would omit `regional_manager`
silently — this codebase's most repeated bug.

**Why a contract list is worth a step.** It carries employment terms for named
people. A scope bug here discloses pay and status for every worker in the
company to any manager who can open the screen.

## Step 2 — Payslips are covered elsewhere, deliberately

`GET /hr/payroll` admits **worker and checker as well** (`requirePayslipReadAccess()`),
because a worker may read their own requests. The intake → fulfilment →
IDOR-guard path is `14-payslip-requests.md`; do not duplicate it here.

**Record only:** `/hr/payroll` returns `200` for admin, manager **and** worker,
and the worker's own list contains nothing that is not theirs. Reference run:
admin `3`, manager `2`, worker `0`.

## Step 3 — The analytics dashboard fails closed by DATA, not by status

```bash
curl -s -H "Authorization: Bearer $T" http://localhost:3001/api/v1/analytics/stats
```

**PASS:** admin sees platform-wide figures; the hotel manager sees strictly
smaller ones; the **no-scope manager gets `200` with every figure zero**.

**Reference run:** admin `assignments.total 49`, hotel manager `9`, no-scope
manager `0`.

> **Do not file the 200 as a bug.** This endpoint answers an unscoped caller
> with an empty dashboard rather than a `403`, while the hotel-keyed endpoints
> in Step 4 answer the same caller with `403`. That asymmetry is deliberate and
> both directions are safe: a dashboard of zeros discloses nothing. It is
> recorded here so the next tester does not "fix" it into an error, and so a
> genuine regression — a no-scope caller seeing **non-zero** figures — is
> unmistakable.

**FAIL:** the no-scope manager sees any non-zero figure. That is a disclosure.

## Step 4 — Hotel-keyed analytics refuse a hotel you do not hold

```bash
curl -s -o /dev/null -w '%{http_code}\n' -H "Authorization: Bearer $MANAGER_T" \
  http://localhost:3001/api/v1/analytics/hotel-summary/$OTHER_HOTEL
curl -s -o /dev/null -w '%{http_code}\n' -H "Authorization: Bearer $MANAGER_T" \
  http://localhost:3001/api/v1/analytics/leaderboard/by-hotel/$OTHER_HOTEL
```

**PASS:** `403` from both, for the manager **and** the RM, against a hotel
outside their scope; `200` against their own.

**PASS:** the no-scope manager gets `403` from both, and the worker `403`.

**Reference run:** own hotel `200` / other hotel `403` for manager and RM;
`403` for the no-scope manager and the worker.

**Why both:** they are two different modules (`analytics` and `quality`
aggregates) reached through the same `checkHotelAccess()` gate. Asserting only
one leaves the other's gate unproven, and they have drifted apart before.

## Step 5 — There are TWO leaderboards, and a worker may see exactly one

This is the step most likely to be got wrong by someone reading the code
quickly, because both endpoints are called "leaderboard".

```bash
curl -s -o /dev/null -w '%{http_code}\n' -H "Authorization: Bearer $WORKER_T" \
  http://localhost:3001/api/v1/analytics/leaderboard   # expect 403
curl -s -o /dev/null -w '%{http_code}\n' -H "Authorization: Bearer $WORKER_T" \
  http://localhost:3001/api/v1/quality/leaderboard     # expect 200
```

**PASS:** `403` then `200`.

- `/analytics/leaderboard` counts tasks and needs `analytics:read`, which a
  worker does **not** hold.
- `/quality/leaderboard` aggregates `WorkerRating` and needs `quality:read`,
  which a worker **does** hold — `ADR-067` deliberately lets a worker see
  where they stand.

### Step 5a — ADR-067's two limits, asserted

```bash
curl -s -H "Authorization: Bearer $WORKER_T" \
  http://localhost:3001/api/v1/quality/leaderboard
```

**PASS — own group only:** the worker's row count is **strictly less** than the
admin's. Reference run: worker `2`, admin `13`.

**PASS — no contact fields:** no row, and no nested `worker` object, contains
`email`, `phone`, `contact_email` or `contact_phone`. Reference run: the nested
worker carries `id`, `first_name`, `last_name`, `employment_record` and nothing
else.

**FAIL:** the worker's count equals the admin's → the group filter is gone, and
every worker can see the standing of everyone in the company.

**FAIL:** any contact field present → `ADR-067` breached. This is the one
assertion here that is a privacy defect rather than a scoping defect, and it
cannot be caught by a row count.

## Step 6 — Notifications are readable by every role

```bash
curl -s -o /dev/null -w '%{http_code}\n' -H "Authorization: Bearer $T" \
  http://localhost:3001/api/v1/notifications
```

**PASS:** `200` for all five callers. This endpoint is self-scoped by
construction — it filters on the caller's own id and accepts no actor
parameter — so "everyone gets 200" is the correct result, not a missing gate.

**Not covered here:** that the *contents* are the caller's own. Delivery and
fan-out are `16-push-notification-delivery.md`; the manager app's own topic is
`25` Step 10.

---

## Knowingly untested here

- **Every screen.** This scenario asserts API responses only. That the HR tab
  renders a contract, that the dashboard tiles show these numbers, and that the
  leaderboard is legible at 375pt are all `25` Step 8 and device work — see
  `DEVICE_VERIFICATION_CHECKLIST.md`.
- **Contract upload (the signed scan).** A real multipart path; it belongs with
  the other three in the device checklist, and `04-document-upload-s3.md` owns
  the S3 assertions.
- **Payslip intake and fulfilment** — `14-payslip-requests.md`, deliberately
  not duplicated (Step 2).
- **Whether the numbers are correct.** Every assertion here is about *which
  rows*, not about whether a total is arithmetically right. A dashboard that
  scopes perfectly and counts wrongly passes this scenario — `analytics`' own
  unit tests own that, and the `DashboardStats` defect (a client type
  describing four fields the endpoint has never returned) is pinned by
  `mobile/manager-app/src/__tests__/analytics-contract.test.ts`.
