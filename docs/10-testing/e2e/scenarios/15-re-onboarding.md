# Scenario 15 — Re-onboarding of a Deactivated Employee

**New scenario, added 2026-09-02** (closing a gap first recorded 2026-08-22 — shipped in PRs
#468, #469, governed by `ADR-065` "partially" per the original gap note). All steps below were
run live against a real Postgres/S3 stack on 2026-09-02.

**What this is, precisely:** `triggerReonboarding` is the `DEACTIVATED → PENDING` transition,
distinct from `reactivate()` (`DEACTIVATED → ACTIVE` directly, covered in scenario 06 A2/A1).
The two exist for different situations and the system enforces which one applies — it is not
the caller's choice:

- **Contract still valid** → only `reactivate()` is allowed. Direct, no re-approval, no new
  contract, immediately working again.
- **Contract expired/invalid** → only `triggerReonboarding()` is allowed. A new contract cycle,
  documents preserved, contract-only re-check.

**Preconditions:** Scenario 00 complete. A Worker fully onboarded and `ACTIVE`, then
`DEACTIVATED`. To exercise the re-onboarding (not reactivate) path specifically, their
`Contract.expires_at` needs to actually be in the past — a fresh test contract never is, so
seed it directly (`UPDATE "Contract" SET expires_at = '2026-01-01' WHERE worker_id = ...`).
This is seeding an unrelated precondition (contract aging), not the mechanism under test,
consistent with this suite's own convention elsewhere.

**Trap already hit authoring this scenario:** `Contract` has both an `end_date` column (the
stated end of the contract) and a separate `expires_at` column ("populated once status flips
to ACTIVE" — `schema.prisma`'s own comment). `isContractValid()` (`hr/service.ts`) checks
**`expires_at`**, not `end_date`. Seeding the wrong column produces no error and no visible
difference — `triggerReonboarding` simply keeps refusing with the same "contract still valid"
message, which reads exactly like a real defect until you check which column the function
actually reads.

---

## Step 1 — `triggerReonboarding` is refused while the contract is still valid

```bash
curl -s -X POST http://localhost:3001/api/v1/employees/deactivate -H "Authorization: Bearer $T" \
  -H 'Content-Type: application/json' -d '{"deactivation_reason":"SEASONAL"}'
curl -s -X POST http://localhost:3001/api/v1/employees/$EMP_ID/trigger-reonboarding \
  -H "Authorization: Bearer $WT" -H 'Content-Type: application/json' -d '{}'
```

**PASS (verified live):** `409 "This employee's contract is still valid; use reactivate()
instead of re-onboarding."` — with the contract's real `expires_at` still in the future.

## Step 2 — With an expired contract, re-onboarding succeeds and preserves documents

Seed `Contract.expires_at` into the past (see the precondition note above), then:

```bash
curl -s -X POST http://localhost:3001/api/v1/employees/$EMP_ID/trigger-reonboarding \
  -H "Authorization: Bearer $WT" -H 'Content-Type: application/json' -d '{}'
```

**PASS (verified live):** `200`, `status: "PENDING"`. Verify at the data layer, not the
response:
- `EmploymentRecord.employment_cycle` incremented (confirmed `1 → 2`)
- `submitted_for_review_at` reset to `null`
- **all 6 `WorkerDocument` rows still present** — re-onboarding does not delete or require
  re-upload of the static documents, only the contract
- a **new** `Contract` row created, `status: PENDING`, `confirmed_by_id: null` — the old
  expired contract row is left as historical record, not mutated in place

## Step 3 — Submit is blocked until the NEW contract is signed, even though documents are complete

```bash
curl -s -X POST http://localhost:3001/api/v1/employees/$EMP_ID/submit-for-review \
  -H "Authorization: Bearer $WT"
```

**PASS (verified live):** `409 "Cannot submit for review: a new contract has been issued.
Please download, sign and upload the current contract."` — a distinct, clearer message than
the first-onboarding-cycle contract gate (scenario 01 Step 5's message), specific to the
re-onboarding case. Confirms the "documents preserved, contract-only re-check" design:
document completeness alone is not enough to pass this gate a second time.

Upload a fresh `CONTRACT_SCAN` (self-upload, RULE B, same as scenario 01 Step 6) and retry —
**PASS (verified live):** `200`, `submitted_for_review_at` set.

## Step 4 — Approve completes the new cycle exactly like the first

```bash
curl -s -X POST http://localhost:3001/api/v1/employees/$EMP_ID/approve \
  -H "Authorization: Bearer $T" -H 'Content-Type: application/json' -d '{}'
```

**PASS (verified live):** `200`, `status: "ACTIVE"`. Same approval mechanics as scenario 01
Step 6 — nothing re-onboarding-specific here, confirming the two cycles converge back to the
identical approval path.

## Step 5 — Navigation lockout for a DEACTIVATED account

Real browser session, logged in as the deactivated worker.

**PASS (verified live, Playwright):** landing on `/onboarding` automatically (not
`/dashboard`), showing:

> *"Your employment record is not currently active. Welcome back — the documents from your
> previous engagement are still on file and do not need to be uploaded again. Only your
> contract is re-checked."*

**This is a real route guard, not just a hidden nav link.** Directly navigating to `/calendar`
(a normal working surface, not gated by role) while `DEACTIVATED` **still renders the same
`/onboarding` lockout screen**, confirmed via `page.goto()` bypassing any in-app link. The
sidebar shows only Settings/Log out — no working-surface nav items — matching the README's
"nav lockout" description exactly.

---

## Pass criteria summary

- [x] `triggerReonboarding` refused while the contract is valid, naming `reactivate()` as the
      correct path
- [x] With an expired contract, `triggerReonboarding` succeeds: `PENDING`,
      `employment_cycle` incremented, `submitted_for_review_at` reset
- [x] All static documents preserved (not deleted, not required again)
- [x] A new `Contract` row is created (`PENDING`, unconfirmed); the old expired one is left as
      history, not mutated
- [x] Submit is blocked on the new contract specifically, even with documents complete —
      distinct, correct error message
- [x] Uploading the new signed contract unblocks submit
- [x] Approve completes the cycle identically to first-time onboarding
- [x] A `DEACTIVATED` account is route-guarded to `/onboarding` regardless of which URL is
      requested directly — confirmed a real guard, not merely a hidden nav link

## Governing decisions

- `ADR-065` — the onboarding gate this re-uses; re-onboarding is explicitly a **second pass**
  through the same document-completeness + contract-confirmation mechanics, not a separate gate
- Scenario 06 A1/A2 — the sibling `reactivate()` path (`DEACTIVATED → ACTIVE` direct), and the
  real defect found and fixed there 2026-09-02 (reactivate not restoring `Hotel.manager_user_id`
  / `HotelGroup.regional_manager_user_id`) — worth checking whether the analogous cross-entity
  pointer matters for a re-onboarded Worker/Checker too. It likely does not (Worker/Checker's
  approve() is the fused, one-step path per scenario 02's own note — there is no separate
  `assign()` step whose pointer could go stale) but this was not independently re-verified in
  this pass.
