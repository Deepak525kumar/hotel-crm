# E2E Run — 2026-08-13 — contract feature, review routing, document-templates removal

- **Commit under test:** uncommitted (working tree)
- **Environment:** local dev
- **Executed by:** Claude (agent session)
- **Stack versions:** backend (tsx watch, Node 25), frontend (Next.js 16.3.0 / Turbopack), Postgres (local `hotelcrm_dev`)

**Scope note:** this was NOT a full suite run. Per explicit instruction, only the features
changed this session were verified — the four user-reported issues (reviewer UI consistency,
missing mandatory Contract feature, worker document edit/replace, review-queue routing to
admin-only) plus the removal of the Document Templates module. Scenarios 00-07 were not
re-executed.

## What changed this session

1. **Document Templates / Document Instances module removed entirely** (7 Prisma models, backend
   module, 6 frontend pages, permission tokens, Playwright/Chromium dependency) — replaced by:
2. **Contract feature**: `EmploymentType` (FULL_TIME/PART_TIME) mandatory on `EmploymentRecord`
   and `Contract`; `hrService.generateDefaultContract()` auto-invoked from
   `employeeManagementService.createEmployee()`, 6-month default `end_date`; single static
   contract PDF served via `GET /hr/workers/:worker_id/contract-download`; `submitForReview()`
   gated on a Contract row existing.
3. **Review routing fix**: `EmploymentRecord.created_by_id` added; `getReviewQueue()` rewritten to
   route to the creator's own superior (manager's applications → that manager's RM; RM's
   applications → admin; legacy/no-RM-assigned rows → admin fallback) instead of the applicant's
   own target scope.
4. **Document edit/replace**: `DELETE /documents/documents/:document_id`, self-only; wired into
   `DocumentsCard.tsx`.
5. **Reviewer UI rebuild**: `ReviewQueueTable.tsx` and its page rewritten on the shared design
   system (`Table`/`THead`/`TBody`/`TR`/`TH`/`TD`, `Badge` with `tone` not `color`, `Textarea`,
   `RoleGate`), plus a real bug found and fixed in the process (see below).

## Results (scoped, not the numbered scenario suite)

| Check | Result | Notes |
|---|---|---|
| Backend `tsc --noEmit` | PASS | Clean after all changes |
| Backend full Jest suite | PASS | 112/112 suites, 2705/2705 tests |
| Frontend `tsc --noEmit` | PASS | Clean after `.next` cache clear (stale references to deleted routes) |
| Migration apply (hand-authored, backfilled) | PASS | `20260813000000_contracts_and_review_routing`; `prisma migrate status` confirms in sync; `down.sql` reconstructs the removed module's schema exactly |
| Manager creates worker application (real API, real DB) | PASS | `employment_type`, `created_by_id`, `target_hotel_group_id`/`target_primary_hotel_id` all correctly persisted |
| Contract auto-generated on create | PASS | Verified via direct Postgres read: `end_date` = `start_date` + exactly 6 months, `employment_type` copied from the record |
| Contract PDF download (worker self) | PASS | `Content-Length` matches the source asset byte-for-byte (130927 bytes) |
| Worker uploads 6 required documents + submits for review | PASS | `submitForReview` succeeded (contract-exists gate passed) |
| Review routing: manager-created app, RM assigned → RM's queue only | PASS | Confirmed present in RM's queue, absent from the creating manager's own queue and absent from admin's queue (RM already claimed it) |
| Review routing: manager-created app, no RM assigned → admin fallback | PASS | Confirmed present in admin's queue, absent from the manager's own queue |
| Worker deletes own document | PASS | 200, doc removed, completeness recalculated correctly on re-check |
| Reviewer (RM) attempts to delete a worker's document | PASS (denied) | 403 at the role-gate — RM is not in the allowed-role list for the delete route at all |
| Reviewer (RM) attempts to upload on a worker's behalf | PASS (denied) | 403, pre-existing RULE B self-check, unaffected by this session's changes |
| Reviewer (RM) views a PENDING (not-yet-approved) applicant's document completeness | **FAIL → FOUND DEFECT → FIXED, then PASS** | See below |
| Out-of-scope manager (different group) denied the same read | PASS | Confirmed still denied after the fix — the fix is scope-widening only within the reviewer's actual group, not a blanket bypass |

## New defects found (this session)

1. **Reviewer 403 on document completeness for any not-yet-approved applicant** —
   `backend/src/lib/scope.ts` `isWorkerInGroupScope` / `backend/src/modules/documents/routes.ts` —
   High (blocked the core "review the application" action for every application, 100% of the
   time) — found by live API verification while validating the rebuilt Review Queue, not by a
   unit test (unit tests mock the DB layer and never exercise this null-scope comparison). Root
   cause: `isWorkerInGroupScope` denies by design whenever `EmploymentRecord.hotel_group_id` is
   null, which is true for every PENDING application (the group is only set on approval) — so a
   manager/RM opening the review modal for literally any applicant got a 403 on the document
   checklist. Fixed with a new read-only primitive (`isWorkerInReviewerScope`, falls back to
   `target_hotel_group_id`/`target_primary_hotel_id`) applied only to the three GET routes in
   `documents/routes.ts`, not the shared `checkWorkerScope()`/`resolveWorkerScope()` that also
   gates write routes elsewhere. **Filed in scenario 08 §6 (history) and §1 is unaffected since
   this was found and fixed in the same session, not left open.**

## Could not test

1. **Full browser/Playwright walkthrough of the rebuilt Review Queue UI** — no `chromium-cli` or
   equivalent browser driver was available in this environment. Compensated with: full
   `tsc --noEmit` typecheck of the exact component tree (would catch any prop/type mismatch
   against the actual `Table`/`Badge`/`Select`/`Textarea` component signatures), manual
   cross-reference of every UI-component prop against its source, and exhaustive curl-level
   verification of every API call the component makes (login, create, contract download, document
   upload/delete, submit-for-review, review-queue for three distinct actors). The component logic
   itself (data fetching, conditional rendering, action wiring) was verified against real backend
   responses shaped exactly as the rebuilt component expects. **Recommend a real Playwright pass
   next time a browser driver is available** — this is a genuine gap, not a pass.
2. **Manager/RM assign flow after approving a contract-gated application** — not exercised this
   session (out of scope: this session's approve() contract-gate already existed and was not
   changed).
3. **Mobile apps** (`mobile/worker-app`) against these changes — unchanged from prior runs' note.

## Scenario files updated this run

- `08-known-gaps-and-next.md`: added the review-routing fix and the reviewer-scope-read fix and
  the ReviewQueueTable UI-consistency fixes and the document delete/replace fix to §6 (history);
  marked judgment call #2 (document-templates platform-wide visibility) moot since the module was
  removed; updated the "last updated" line.
