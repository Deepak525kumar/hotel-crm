# Scenario 01 — Worker / Checker Onboarding Happy Path

Verifies the core `ADR-065` gate: a Worker or Checker goes from creation to `ACTIVE` only
after document completeness **and** an approved contract, with scope assigned at the right
moment and never before.

**Preconditions:** Scenario 00 complete. A fresh worker user with **no** documents.

---

## Step 1 — Manager creates the employment record

```bash
MT=$(curl -s -X POST http://localhost:3001/api/v1/auth/login -H "Content-Type: application/json" \
  -d '{"email":"e2e-mgr@test.local","password":"E2EPass123!"}' \
  | python3 -c "import sys,json; print(json.load(sys.stdin)['data']['access_token'])")

curl -s -X POST http://localhost:3001/api/v1/employees -H "Authorization: Bearer $MT" \
  -H "Content-Type: application/json" \
  -d '{"user_id":"<WORKER_USER_ID>","employee_id":"E2E-W-01",
       "job_title":"Housekeeper","start_date":"2026-09-01"}' | python3 -m json.tool
```

**PASS:**
- `status: "PENDING"`
- `hotel_group_id: null` **and** `primary_hotel_id: null` — no operational scope yet
  (`ADR-065` Decision 2)
- `target_hotel_group_id` auto-filled to the **creating manager's own group**
- `target_primary_hotel_id` auto-filled to the **creating manager's own hotel**
  (`ADR-065` §6 item 7)
- `work_permit_required: false` by default

**Regression note:** the route was once `requireRole('admin')` only, so a Manager got 403 here
and the whole Manager-initiated-creation feature was unreachable. Also verify a Manager
**cannot** create a `MANAGER`-role application (expect
`"Manager may only create applications for Worker and Checker roles"`).

## Step 2 — Submit before uploading documents (must be blocked)

```bash
curl -s -X POST http://localhost:3001/api/v1/employees/E2E-W-01/submit-for-review \
  -H "Authorization: Bearer $MT"
```

**PASS:** `409 CONFLICT`, message naming **all six** missing categories:
`TAX_NUMBER, SOCIAL_SECURITY_NUMBER, HEALTH_INSURANCE, ID_CARD, PASSPORT, ADDRESS`.

**FAIL conditions:** message mentions `GENERAL` (the pre-`ADR-065` category, since removed),
or the submit succeeds, or `WORK_PERMIT` is listed while `work_permit_required` is false.

## Step 3 — Upload the six documents

Prefer the **real** endpoint (scenario 04 covers it fully). If S3 credentials are unavailable,
seed `WorkerDocument` rows via Prisma **and record that the real upload path was not exercised**.

```bash
curl -s "http://localhost:3001/api/v1/documents/workers/<WORKER_USER_ID>/documents/completeness" \
  -H "Authorization: Bearer $MT" | python3 -m json.tool
```

**PASS:** the response contains a **`categories`** map (per-category booleans) — the field is
`categories`, **not** `by_category`. A frontend that reads `by_category` crashes; that was a
real defect. Also expect `missing_categories`, `is_complete`, `document_count`.

## Step 4 — Submit for review (should now succeed)

```bash
curl -s -X POST http://localhost:3001/api/v1/employees/E2E-W-01/submit-for-review \
  -H "Authorization: Bearer $MT" | python3 -m json.tool
```

**PASS:** `status` stays `PENDING`; `submitted_for_review_at` becomes non-null (it is a
*sub-state* of PENDING, not a separate status). Scope fields still `null`.

## Step 5 — Approve without a contract (must be blocked)

```bash
curl -s -X POST http://localhost:3001/api/v1/employees/E2E-W-01/approve \
  -H "Authorization: Bearer $MT" -H "Content-Type: application/json" -d '{}'
```

**PASS:** `409 CONFLICT` — "does not have an approved contract (Active, Extended, or Permanent)".

## Step 6 — Create an approved contract, then approve

Seed a `Contract` with `status: 'ACTIVE'` for the worker (the real HR path needs a scan upload;
that is HR's own scenario, not this one). Then:

```bash
curl -s -X POST http://localhost:3001/api/v1/employees/E2E-W-01/approve \
  -H "Authorization: Bearer $MT" -H "Content-Type: application/json" -d '{}' | python3 -m json.tool
```

**PASS:** `status: "ACTIVE"`. `hotel_group_id` is resolved from the approving actor's own
scope for Worker/Checker (this is the **fused** path, deliberately unchanged by `ADR-065` —
see §3 item 6's final sentence). If the approver is an **Admin** with no scope and no explicit
`hotel_group_id` in the body, `null` here is **correct**, not a bug.

## Step 7 — Verify the status history

```ts
// scratch — delete after
const r = await prisma.employmentRecord.findUnique({
  where: { employee_id: 'E2E-W-01' },
  include: { status_history: { orderBy: { created_at: 'asc' } } },
});
console.log(r.status, r.version, r.status_history.map(h => `${h.from_status}->${h.to_status}`));
```

**PASS:** exactly **one** `PENDING -> ACTIVE` row; `version` incremented (≥2 after
submit+approve). Duplicate or impossible transitions indicate the concurrency bug from
scenario 05 has regressed.

## Step 8 — Checker parity

Repeat steps 1-7 with a `checker` user. Checker is the **same tier** as Worker: same approver
(Manager), same six-document checklist, same group-grain scope. Any behavioural difference is
a finding.

---

## Pass criteria summary

- [ ] Manager (not just Admin) can create a Worker/Checker record
- [ ] Manager **cannot** create a Manager-tier record
- [ ] `target_*` fields auto-fill from the creating manager's scope; operational scope stays null
- [ ] Submit blocked until all six documents exist; error names the correct categories
- [ ] Completeness response uses `categories`
- [ ] Approve blocked without an ACTIVE/EXTENDED/PERMANENT contract
- [ ] Approve succeeds with one clean history row and an incremented `version`
- [ ] Checker behaves identically to Worker

## Defects this scenario has caught

| Symptom | Root cause |
|---|---|
| Manager got 403 creating a Worker | Route was `requireRole('admin')`; service had no `manager` branch |
| Review Queue permanently empty for managers | `target_primary_hotel_id` was never populated at creation |
| Frontend `/onboarding` crashed | Frontend read `by_category`; backend sends `categories` |
| Worker activated with no documents/contract | Both gates were deleted in an earlier edit (caught by diff review) |
| `rehire()` bypassed the contract gate | Gate existed in `approve()` only |
