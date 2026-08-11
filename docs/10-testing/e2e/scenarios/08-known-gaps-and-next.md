# Scenario 08 — Known Gaps, Open Defects, and What to Cover Next

**This is not a test.** It is the living backlog: what is known-broken, what has never been
tested, and what to add next time. Read it at the **end** of a run and **update it** — move
fixed items to the history table, add anything new you found.

Last updated: **2026-08-12** (initial suite creation, after the ADR-065 Phase 1-3 verification).

---

## 1. Open defects — confirmed, reproducible, not fixed

| # | Defect | Impact | Where | Decision needed |
|---|---|---|---|---|
| ~~1~~ | ~~Worker cannot submit their own onboarding~~ | **FIXED 2026-08-12** — route widened to admit `worker`/`checker`; `requirePermission('employees:write')` deliberately dropped from it (those roles hold only `employees:read`) and the real boundary moved into `assertLifecycleAuthority`, which returns early **only** when `actor.userId === record.user_id`. Verified live: own-record submit succeeds; the same worker submitting another worker's record → 403; a checker on a worker's record → 403; unauthenticated → 401. Two `C-16` divergences pinned in `capability-violations.ts` with justification (see §7). | — | — |
| ~~2~~ | ~~No assign step in the UI~~ | **FIXED 2026-08-12** — `employeesApi.assign` + `AssignEmploymentInput` added; `ReviewQueueTable` now chains approve → an assign modal with a role-aware target picker (hotel for Manager, group for RM). **Not yet browser-verified** — add to the next scenario-07 run. | — | — |
| ~~3~~ | ~~Stale copy for active workers~~ | **FIXED 2026-08-12** — `/onboarding` description is now status-aware (active / rejected / under-review / pending). | — | — |
| 4 | **`consent.recordDecision()` atomicity gap** — `consentRecord.create` → `logAudit` → `notifyResponsibleManager`, all unwrapped, while the code's own `RULE-CONSENT-03` comment says the block-fact and notification-fact must fire together, "neither may fire without the other". | A declined consent can commit with no audit row and no manager notified. | `backend/src/modules/consent/service.ts:135-176` | No — wrap in `$transaction`, thread `tx` (the notification service already accepts one). Not tracked in any SIR row. |
| 5 | **Audit-outside-transaction sites** (per `ADR-029`, not `ADR-036`): `geo/service.ts:81-108` (1 site), `document-templates/service.ts` (~10), `attendance/service.ts` (`update`'s audit at ~:479, and `checkIn` ~:200-237 where a cross-module `assignmentService.update` is also unwrapped — a failure leaves attendance PRESENT while the assignment stays un-started). | Lost audit trails; one cross-module inconsistency. | as listed | No — mechanical fix, same pattern as the earlier HR/documents/calendar sweep. |
| 6 | **Orphaned S3 objects possible** — `storage.upload()` runs *before* the DB transaction with no compensating `storage.delete()`, so a DB/audit failure after a successful upload leaves an untracked object. | Storage leak; no data-integrity breach. | `backend/src/modules/documents/service.ts` `uploadDocument` | No — add a compensating delete, or move the upload inside a saga. |

## 2. Judgment calls awaiting the project owner

All three are **documented, deliberate** positions — not bugs — but were flagged as worth an
explicit yes/no:

1. **`retention`'s deletion audit log is readable by any authenticated user** (including a plain
   worker) — `retention/service.ts` `getDeletionAuditLog` takes no actor. Knowingly-taken posture
   per `SIR-RETENTION-003` (OPEN), but the practical exposure (a worker enumerating the platform's
   whole deletion history) may exceed what "trusted backend context only" anticipated. **Widest
   exposure of the three.**
2. **`document-templates` returns all templates platform-wide** to admin/manager/RM. Likely
   correct — templates are modeled as global blueprints with no hotel FK to filter on
   (`MODULE_SPEC.md:181`).
3. **`consent` read asymmetry** — Admin reads any worker; Manager/RM read none, not even their
   own group. Explicitly ratified in `ADR-037`/`SIR-CONSENT-011`.

## 3. Never tested by anyone

- **`retention/sweep-job.ts`** — the multi-module hard-delete fan-out. **The scariest untested
  code in the repo**: it deletes real data across modules, and `SIR-RETENTION-004` already flags
  an unresolved workload concern. Deserves its own scenario file.
- **The real HR contract flow** — every scenario above seeds `Contract` rows directly. The actual
  `contract-scan` upload → `contract-confirm` path (and `ADR-044`'s malware hook on it) has never
  been exercised end-to-end.
- **Mobile apps** (`mobile/worker-app`) against these backend changes.
- **Outbox/notification delivery** — records are written, but no test confirms a notification is
  actually delivered for onboarding events.
- **`document-instances`** (fillable forms / digital signature) interaction with onboarding.
- **Production-like data volumes** — every test has run with a handful of records.

## 4. Prioritised list for the next run

1. **Re-verify all six open defects in §1** — are they fixed? Anything regressed?
2. **Run scenarios 00-07 in full** and log results.
3. **New: `retention/sweep-job.ts`** — write scenario 09 for it.
4. **New: real HR contract flow** — scenario 10.
5. **Sustained concurrency** (scenario 05's "not yet covered" list) — 10-50 parallel mutations,
   three-way races, `assign` vs `deactivate`.
6. **UI coverage gaps** (scenario 07's list) — Reject flow, document viewing from the modal,
   Manager/RM's own onboarding pages, session expiry mid-flow, accessibility.
7. **Edge cases in scenario 06's list** — hotel re-parenting mid-application, bulk-import
   partial failures, contract expiry while active, timezone boundaries.

## 5. Environmental caveats that have produced false results

- **Docker containers vanish after a Docker restart** → `docker compose up -d`, not `docker start`.
- **Missing AWS credentials** silently turn document tests into no-ops (stub storage still writes
  the DB row). Always confirm `aws sts get-caller-identity` first.
- **`FEATURE_EMPLOYMENT_RECORD=false`** makes every `/employees` route 404 — the suite passes
  vacuously. Verify with a live request.
- **Stale scenario data**: a record consumed by an earlier step makes a later race/queue test
  silently vacuous ("queue empty" ≠ "isolation works"). Use fresh records per test.
- **`tsc` + unit tests + lint all passing proves little about the browser** — the worst defect
  found in this feature passed all three.

## 7. Pinned capability-matrix divergences (read before "fixing" a failing capability test)

`backend/src/__tests__/capability-policy.test.ts` asserts every route gate against the
transcribed `ADR-030` §3 matrix, and `support/capability-violations.ts` pins the known
divergences. The suite requires the pinned set to match the actual set **exactly**, so both
introducing a new divergence *and* closing an existing one fail the build until the pin file is
deliberately edited. That is intentional — a silent pass/fail flip is worse than a loud list.

Currently pinned (all `ADR-065`-driven, all awaiting an `ADR-030` §3 matrix amendment — the
forward-note `ADR-065` §7 already records as owed):

- `C-15:manager@…POST /` and `C-15:regional_manager@…POST /` — Manager/RM may create records
- `C-16:worker@…submit-for-review` and `C-16:checker@…submit-for-review` — self-service submit

**If a capability test fails**, do not edit the matrix or delete the assertion. Either the change
is legitimate (add a pin with its authority and remediation owner) or it is an accidental
authorization widening (revert the code).

## 6. Fixed — history (do not re-investigate, but do regression-test)

| Defect | Fixed in |
|---|---|
| Manager blocked from creating Worker/Checker records | `981229b` |
| Manager Review Queue permanently empty (`target_primary_hotel_id` never set) | `981229b` |
| 4 of 7 document categories impossible to upload (stale enum in validator) | `981229b` |
| `assign()` never wrote `Hotel.manager_user_id`/`HotelGroup.regional_manager_user_id` | `981229b` |
| `password_hash` leaked in `getReviewQueue` | `981229b` |
| `password_hash` leaked in `assign` | `3f7bae4` |
| `password_hash` leaked in all lifecycle transitions (3rd occurrence) + structural backstop | `6a06563` |
| `assign()` no reassignment handling (silent multi-hotel corruption; RM 409) | `25219f1` |
| Read-then-write race corrupting `EmploymentStatusHistory` (no `version` column) | `19f009d` |
| `deactivate()` didn't vacate the hotel → deactivated manager kept full authority | `19f009d` |
| `FEATURE_RM_ROLE` never consulted (RM could approve with flag off) | `19f009d` |
| `assign {}` silent 200 no-op; generic not-found message | `19f009d` |
| Migration over-cleanup removing statements a fresh DB needs | reverted in `5f4fa70` |
| Malware-scan seam absent on the WorkerDocument path (`OD-DOC-016`) | `fdf2096` (ADR-066 Option A) |
| `/onboarding` crash — `by_category` vs `categories` | `6bd4b17` |
| Worker activation gates (documents + contract) deleted | restored pre-`06510ff` |
| `rehire()` bypassed the contract gate | `dadf129` |

---

## Maintenance rule

**Every time this suite is run, update it in the same pass:**
- Move newly-fixed items from §1 into §6 with the commit hash.
- Add newly-found defects to §1 with a reproduction.
- Tick off anything from §3/§4 that got covered, and add whatever new gaps you noticed.
- Append a run log under `runs/` (template in `../README.md`) — never overwrite a previous one.

A defect found and fixed but **not recorded here will be rediscovered from scratch**. That has
already happened more than once in this project.
