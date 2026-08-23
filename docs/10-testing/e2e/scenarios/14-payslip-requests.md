# Scenario 14 — Payslip Requests

Verifies the payslip request-to-fulfilment path: who may request, who may fulfil, the
`Requested → Fulfilled` transition, and the role gating that the UI and the backend must agree on.

Covers `SPEC-HR-001` (`RULE-HR-09`, `RULE-HR-12`, `IF-HR-RequestPayslip`,
`IF-HR-FulfilPayslipRequest`) and `ADR-014` (payslip ownership sits in the HR bounded context).

**Preconditions:** Scenario 00 complete. One Worker, one Checker, one Manager, one Admin.

> **Why this scenario exists.** Shipped across PRs #487–#491 with no E2E coverage. One of those PRs
> (#384) existed specifically to fix UI actions being offered to roles the backend rejects — a class
> of defect that only shows up when you check both layers, which is what this scenario does.

---

## Step 0 — A worker may request their own payslip

```bash
curl -s -X POST -H "Authorization: Bearer $WT" -H 'Content-Type: application/json' \
  -d '{"period_start":"2026-07-01","period_end":"2026-07-31"}' \
  http://localhost:3001/api/v1/hr/payslip-requests | jq '.data'
```

**PASS:** `201`, and a `PayslipRequest` row exists with status `Requested`.

**Verify at the data layer:**

```bash
docker compose exec -T postgres psql -U postgres -d hotel_crm -c \
  "SELECT id, worker_id, status, period_start, period_end FROM \"PayslipRequest\" ORDER BY created_at DESC LIMIT 3;"
```

## Step 1 — A Checker may request too; a Manager may not

```bash
curl -s -o /dev/null -w "checker -> %{http_code}\n" -X POST -H "Authorization: Bearer $CT" \
  -H 'Content-Type: application/json' -d '{"period_start":"2026-07-01","period_end":"2026-07-31"}' \
  http://localhost:3001/api/v1/hr/payslip-requests
curl -s -o /dev/null -w "manager -> %{http_code}\n" -X POST -H "Authorization: Bearer $MT" \
  -H 'Content-Type: application/json' -d '{"period_start":"2026-07-01","period_end":"2026-07-31"}' \
  http://localhost:3001/api/v1/hr/payslip-requests
```

**PASS:** checker `201`, manager `403`. The route is gated
`requireRole(['worker','checker'])` + `hr:payslip:request` — requesting is a *subject* action, and a
manager requesting their own payslip is not the modelled flow.

## Step 2 — Date validation

```bash
curl -s -o /dev/null -w "reversed -> %{http_code}\n" -X POST -H "Authorization: Bearer $WT" \
  -H 'Content-Type: application/json' -d '{"period_start":"2026-07-31","period_end":"2026-07-01"}' \
  http://localhost:3001/api/v1/hr/payslip-requests
curl -s -o /dev/null -w "future -> %{http_code}\n" -X POST -H "Authorization: Bearer $WT" \
  -H 'Content-Type: application/json' -d '{"period_start":"2027-01-01","period_end":"2027-01-31"}' \
  http://localhost:3001/api/v1/hr/payslip-requests
```

**PASS:** both `400`. A period that ends before it starts, or lies entirely in the future, is not a
payslip anyone can produce.

## Step 3 — Only a manager or admin may fulfil

```bash
REQ_ID=<id from Step 0>
curl -s -o /dev/null -w "worker fulfils -> %{http_code}\n" -X POST -H "Authorization: Bearer $WT" \
  http://localhost:3001/api/v1/hr/payroll/$REQ_ID/fulfil
curl -s -X POST -H "Authorization: Bearer $MT" \
  http://localhost:3001/api/v1/hr/payroll/$REQ_ID/fulfil | jq '.data.status'
```

**PASS:** worker `403`; manager returns status `Fulfilled`.

**This is the asymmetry to hold in your head:** the worker may *request* and may not *fulfil*; the
manager may *fulfil* and may not *request*. A UI that offers either action to the wrong role is the
defect PR #384 fixed, and it is easy to reintroduce.

## Step 4 — The UI agrees with the backend

In the browser, sign in as each of Worker, Checker, Manager, Admin and open the payslips surface
(`/payslips`, plus `PayslipRequestsCard` wherever it appears).

**PASS:** every action button visible to a role is one that role can actually perform. No button
that returns `403` when clicked.

**This step is the point of the scenario.** Steps 0–3 pass on a system whose UI is completely wrong;
only this step catches the mismatch, and it cannot be automated away with curl.

## Step 5 — Fulfilment is terminal and idempotent-safe

```bash
curl -s -o /dev/null -w "second fulfil -> %{http_code}\n" -X POST -H "Authorization: Bearer $MT" \
  http://localhost:3001/api/v1/hr/payroll/$REQ_ID/fulfil
```

**PASS:** `409` (or a documented no-op). A second fulfilment must not create a second payslip or
re-notify the worker.

---

## What this scenario does not cover

- **Payslip document *production*.** `ADR-014` models this as **manual manager fulfilment** — the
  manager produces and sends the document out of band. There is no generated artifact to assert on,
  and expecting one will produce a false failure.
- Notification delivery on fulfilment beyond the row being written; the outbox drain is scenario 09's
  territory.
- Retention/erasure of payslip records (`SPEC-RETENTION-001`).
