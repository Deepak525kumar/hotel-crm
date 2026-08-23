# Scenario 15 — Re-onboarding a Deactivated Worker

Verifies that a paused worker can return without repeating the full document gate, that
`employment_cycle` increments on **both** return paths, and that the nav lockout holds while they are
mid-cycle.

Covers `SPEC-EMP-001` (`RULE-EMP-REONB-01`, re-onboarding addendum), `ADR-065` (hierarchical
approval), and `ADR-012` (contract standing is HR's).

**Preconditions:** Scenario 00 complete. One **active, approved** Worker with a standing contract,
plus a Manager who can act on them.

> **Why this scenario exists.** Shipped in PRs #468/#469 with no coverage. The bug this guards
> against is invisible from the outside: an earlier implementation incremented `employment_cycle` on
> one return path but not the other, which silently sent re-onboarding workers back through the
> entire document gate the feature exists to skip. **The flow still worked. It was merely wrong.**

---

## Step 0 — Record the starting cycle

```bash
docker compose exec -T postgres psql -U postgres -d hotel_crm -c \
  "SELECT er.id, er.status, er.employment_cycle FROM \"EmploymentRecord\" er
   JOIN \"User\" u ON u.id = er.user_id WHERE u.email = '$WORKER_EMAIL';"
```

**PASS:** status `ACTIVE`, `employment_cycle = 1`. Write the value down; every later step compares
against it.

## Step 1 — Deactivate is a pause, not a termination

```bash
curl -s -X POST -H "Authorization: Bearer $MT" -H 'Content-Type: application/json' \
  -d '{"reason":"TEMPORARY_LEAVE"}' \
  http://localhost:3001/api/v1/employees/$EMP_ID/deactivate | jq '.data.status'
```

**PASS:** status `DEACTIVATED`, `employment_cycle` **still 1** (the pause is not a new cycle), and a
row appended to `EmploymentStatusHistory`.

```bash
docker compose exec -T postgres psql -U postgres -d hotel_crm -c \
  "SELECT from_status, to_status, employment_cycle, performed_by_id FROM \"EmploymentStatusHistory\"
   WHERE employment_record_id = '$EMP_ID' ORDER BY created_at DESC LIMIT 3;"
```

`EmploymentStatus` is **permanent and non-terminal** since the 2026-08-06 rework — there is no
terminal state a worker cannot return from.

## Step 2 — Their session ends

```bash
curl -s -o /dev/null -w "%{http_code}\n" -H "Authorization: Bearer $WT" \
  http://localhost:3001/api/v1/auth/me
```

**PASS:** `401`. Deactivation ends live sessions; a paused worker must not keep browsing on a token
issued before the pause.

## Step 3 — Trigger re-onboarding — the cycle MUST increment

```bash
curl -s -X POST -H "Authorization: Bearer $MT" \
  http://localhost:3001/api/v1/employees/$EMP_ID/trigger-reonboarding | jq '.data.status'
docker compose exec -T postgres psql -U postgres -d hotel_crm -c \
  "SELECT status, employment_cycle FROM \"EmploymentRecord\" WHERE id = '$EMP_ID';"
```

**PASS:** status `PENDING` **and `employment_cycle = 2`.**

**FAIL — this is the exact regression `RULE-EMP-REONB-01` exists for:** status `PENDING` with
`employment_cycle` still `1`. Everything downstream keys off `employment_cycle > 1`, so a worker left
at cycle 1 is treated as a first-time applicant and is pushed back through the full
document-completeness gate. **Nothing errors. The feature just quietly stops working.**

## Step 4 — The document gate is skipped for a returning worker

Sign in as the worker again (a fresh login — the old token is dead from Step 2) and submit:

```bash
curl -s -X POST -H "Authorization: Bearer $WT2" \
  http://localhost:3001/api/v1/employees/$EMP_ID/submit-for-review | jq '.data.status'
```

**PASS:** `UNDER_REVIEW`, **without** re-uploading the documents already on file. Compare against
scenario 01, where a first-time worker at cycle 1 is blocked until the checklist is complete.

## Step 5 — The review queue labels them as re-onboarding

```bash
curl -s -H "Authorization: Bearer $MT" \
  "http://localhost:3001/api/v1/employees?status=UNDER_REVIEW" | jq '.data[] | {id, employment_cycle, reonboarding}'
```

**PASS:** the entry is flagged as re-onboarding. Then confirm the same in the browser at
`/onboarding/review-queue` — a reviewer needs to see *why* the document checklist looks different,
or they will read the skip as a defect and reject a legitimate return.

## Step 6 — Nav lockout while mid-cycle

While the worker sits at `PENDING`/`UNDER_REVIEW`, sign in as them in the browser.

**PASS:** they are held on the onboarding surface. Operational navigation is not reachable, and
deep-linking to `/assignments` or `/calendar` does not escape the lockout. `ADR-065`'s rule is that
activation precedes scope — a not-yet-active user has no operational surface.

## Step 7 — Approval restores them, cycle intact

```bash
curl -s -X POST -H "Authorization: Bearer $MT" \
  http://localhost:3001/api/v1/employees/$EMP_ID/approve | jq '.data.status'
```

**PASS:** `ACTIVE`, `employment_cycle` **still 2** (approval closes the cycle, it does not open a new
one), organizational scope assigned **only now** (`ADR-065`), and the worker can reach operational
surfaces again.

## Step 8 — Contract standing is HR's decision, not this module's

```bash
curl -s -H "Authorization: Bearer $MT" \
  http://localhost:3001/api/v1/hr/workers/$WORKER_ID/contract-status | jq '.data'
```

**PASS:** a returning worker whose old contract no longer stands has a **new** default contract
issued. `hr/service.ts` holds the single exported definition of "this contract still stands" so that
the approve/rehire gate and the re-onboarding path cannot drift apart — if you find two answers to
that question, that is the defect.

---

## What this scenario does not cover

- The `DELETED → PENDING` rehire path via `restore()`. It shares `RULE-EMP-REONB-01` and the same
  increment, and is worth adding here rather than as a separate scenario.
- Whether notifications fire correctly on each transition (scenario 09's territory).
- Re-onboarding initiated by the worker rather than a manager — the route permits `worker`, but the
  flow has not been walked from that direction.
