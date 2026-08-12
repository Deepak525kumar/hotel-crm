# Run log — RULE A / RULE B authorization change (2026-08-12)

**Scope:** implementation + verification of two project-owner-ratified authorization rules.
Not a full suite run — a targeted change with focused live verification.

- **RULE A** — "create is 1-level-down only": `admin → regional_manager`,
  `regional_manager → manager`, `manager → worker|checker`, `worker`/`checker` → nobody.
- **RULE B** — "nobody may perform another user's onboarding": document upload and
  submit-for-review are self-service only, for every role including admin.
  Approve/assign/reject deliberately unchanged (still hierarchy actions).

See scenario `08-known-gaps-and-next.md` §7 for the full rule statement, the pinned
capability-matrix divergences, and the owed ADR amendments.

## Environment

Stack already running and healthy; not restarted. Postgres credentials are
`hotelcrm`/`hotelcrm_dev` (**not** `postgres`/`hotel_crm` — several older docs and task
descriptions state the wrong values):

```
docker exec hotel-crm-postgres-1 psql -U hotelcrm -d hotelcrm_dev -c "..."
```

## Automated results

| Check | Result |
|---|---|
| `cd backend && npx tsc --noEmit` | clean |
| `cd backend && npx jest` | **112 suites / 2829 tests, all passing** (baseline 108 / 2688) |
| `cd frontend && npx tsc --noEmit` | clean |
| `cd frontend && npx eslint .` | clean |

New suites: `role-hierarchy.test.ts` (46), `create-hierarchy-authz.test.ts` (55 — every
(actor, target) pair on both creation surfaces), `onboarding-self-only.test.ts` (24).

## Live verification (API + data layer)

Every denial was confirmed by reading Postgres, not by trusting the status code.

**RULE A — all five (actor → target) outcomes exercised via the real `POST /users` route:**

| Attempt | Result | DB |
|---|---|---|
| admin → worker | 403 `A admin may only create users with role: regional_manager (attempted: worker)` | no row |
| admin → admin | 403 | no row |
| admin → regional_manager | 201 | row present, `REGIONAL_MANAGER` |
| manager → worker | 201 | row present, `WORKER` |
| manager → checker | 201 | row present, `CHECKER` |
| manager → manager | 403 `...only create users with role: worker, checker (attempted: manager)` | no row |
| manager → regional_manager | 403 | no row |
| regional_manager → manager | 201 | row present, `MANAGER` |
| regional_manager → worker | 403 `A regional_manager may only create users with role: manager` | no row |

Final DB state contained **exactly the 4 allowed rows** and none of the 5 denied ones:

```
            email             |       role
------------------------------+------------------
 ruleA-mgr-checker@test.local | CHECKER
 ruleA-mgr-worker@test.local  | WORKER
 ruleA-rm-mgr@test.local      | MANAGER
 ruleA-rm-verify@test.local   | REGIONAL_MANAGER
```

**RULE B — submit-for-review**, both directions on record `SELF-92`:

- Admin on another user's record → `403 Only the applicant may submit their own application for
  review...`; `submitted_for_review_at` **still NULL** in Postgres.
- The applicant on their own record → `200`; `submitted_for_review_at = 2026-08-12 11:20:34.206`.

**RULE B — document upload:**

- Admin uploading for `worker1` → `403 Documents may only be uploaded by the worker they belong
  to...`. Data layer: doc count unchanged at 7, newest row still dated `2026-08-11` — nothing
  written.
- Self upload → passes authorization and reaches the storage layer, where it hits the
  pre-existing S3 misconfiguration (open defect #10). **The positive upload path could not be
  verified end-to-end in this environment; recorded as a gap, not a pass.** Confirmed
  pre-existing by `git stash`ing the documents changes and reproducing the identical 500.
  The 403-vs-500 split is itself the evidence that authorization ran and produced the right
  answer in each case.

## Browser verification (Playwright, localhost:3000)

| Check | Observed |
|---|---|
| Admin `/users/new` role selector | options `["regional_manager"]` only, label "Regional Manager", selector disabled (single fixed option), hint "You may only create Regional Manager accounts." |
| Manager `/users/new` | options `["worker","checker"]`, selector enabled |
| Worker `/users/new` | permission fallback shown, **0** role `<select>` elements |
| Admin on applicant's profile (PENDING, unsubmitted) | "Paperwork/checks pending" block present (so the render branch IS active), "Confirm onboarding complete" **absent**, self-only explanation present, Upload buttons **0** |
| Applicant's own `/onboarding` | "Submit for Review" present; document controls render |

The admin-profile check initially showed **1** Upload button — that was a real gap
(`DocumentsCard`, now open-defect #11, fixed and re-verified to 0). The record was deliberately
reset to PENDING/unsubmitted first, so the submit button's absence is meaningful rather than an
artifact of an already-submitted record.

## Test-fixture note

Passwords for `selftest91`, `selftest92`, `manager1`, `rm1` were reset to a known value by
direct DB write. Authentication was **not** the path under test — the login route was still
exercised normally afterwards to obtain real JWTs. No authorization check was bypassed by a
direct DB write.

## Follow-ups owed

- **ADR amendments**: `ADR-065` (broad `createEmployee`, narrowed by RULE A), `ADR-030` §3 C-15
  and C-10 + D-4 (`SIR-USERS-002`, account creation Admin-only), `GD-16`/`OD-DOC-007`
  (manager-upload, reversed by RULE B). Tracked in `REMAINING_WORK.md`.
- Open defect #10 (S3 config) blocks positive-path upload verification.
