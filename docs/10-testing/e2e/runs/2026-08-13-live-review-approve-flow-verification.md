# Run log — 2026-08-13 — Live review/approve flow verification (production)

**Branch:** `fix/edit-user-active-checkbox-label` (frontend gap fix), building on
`fix/onboarding-audit-document-lock-and-contract-gate` (#433) and
`fix/scoped-manager-view-self-created-account` (#434), both merged.
**Method:** live, browser-driven testing against `https://deepcleaninghub.de`
(production), using real accounts (`admin@hotelcrm.com`,
`regional_manager@hotelcrm.com`, `manager1@hotelcrm.com`, and applicant
accounts created directly in the app by the human operator). No direct DB
writes; every state change went through the real UI and real API.

---

## Verified working, live, end-to-end

Drove `managercccc@g.com` (a real Manager application, documents + signed
contract uploaded by the human operator) through the full pipeline as Admin:

1. **Approve-with-auto-confirm.** Review-queue modal showed "Signed contract
   received — approving will confirm it"; clicking **Confirm contract &
   approve** succeeded. Confirmed in the DB-backed profile view afterward:
   `EmploymentRecord.status = ACTIVE`, contract `ACTIVE` with
   `confirmed_by_id` set.
2. **Signed-contract badge** (`signed_scan_uploaded`). Applicant's own My
   Onboarding page correctly read "Signed copy received — awaiting
   confirmation" before approval.
3. **Review-queue routing.** The Manager application did **not** appear in
   the Regional Manager's queue (`FEATURE_RM_ROLE` is off in this
   environment) and correctly appeared in Admin's queue instead, alongside
   other RM/Manager-role applications — matching the documented fallback
   rule.
4. **Notification delivery.** Admin's notification bell showed "Application
   awaiting review" at the exact submission timestamp — recipient matches
   queue ownership.
5. **Assign flow.** Assigning the newly-approved manager to an
   already-manager-assigned hotel correctly failed ("Hotel already has a
   different manager assigned"); assigning to a free hotel succeeded.
6. **Reject flow.** Rejected `kam kam` (a separate real Manager application)
   with a reason; profile page correctly showed `Rejected` afterward.

## Code fix made this session

**Found:** the entire employment-lifecycle UI — Employment status,
Confirm/Approve/Reject, Deactivate/Reactivate, Delete/Restore
(re-onboarding), Contract card, Payslip requests — was gated to
`user.role === "worker"` on `frontend/app/(protected)/users/[id]/page.tsx`.
Checker, Manager, and Regional Manager accounts got **none** of this: the
profile page rendered only Account/Permissions/Assignment/Documents for
them, with no way to submit, approve, reject, deactivate, reactivate,
delete, or restore their employment record from the UI, and no visible
contract/payslip section — despite ADR-065 giving every non-admin role the
identical `EmploymentRecord` lifecycle, and every backend lifecycle endpoint
(`employee-management/service.ts`) being role-agnostic on the *subject*
(scoped only by the *actor*, via `assertLifecycleAuthority`).

**Fix:** changed both gates from `user.role === "worker"` to
`user.role !== "admin"`. Admin is excluded (no `EmploymentRecord` ever
exists for an admin account; `WorkerOnboardingCard` already renders its own
"No employment record found" state for that case). No backend change
needed — this was a frontend-only visibility gap.

**Not yet deployed/verified live** — needs a PR, merge, and redeploy before
the items below can be retested.

---

## Known gaps — to be tested later

These could not be exercised this session because this tool has no
file-upload capability (clicking Upload opens a native OS file picker
outside what the browser automation can drive), and because no existing
account provided the right starting state. Once the fix above is deployed:

- [ ] **Checker parity.** `checkerrrr@gmail.com` (Checker, Pending, zero
      documents) needs its 6 documents + signed contract uploaded (by a
      human), then pushed through submit → review → approve, to confirm the
      Checker path matches Worker's exactly.
- [ ] **Manager/RM/Checker employment lifecycle, post-fix.** Now that the
      gate is fixed, re-verify on a Manager/Checker/RM account: Employment
      status card renders, Confirm/Approve/Reject buttons work, Contract and
      Payslip Requests cards render — the same checks already passed for
      Worker accounts.
- [ ] **Re-onboarding (Delete → Restore cycle).** Every currently-"Active"
      Worker account in this environment (`worker 3`, `worker 10`,
      `mayank abcdefhd`, etc.) turned out to have **no EmploymentRecord at
      all** — they're pre-ADR-065 legacy accounts where the green "Active"
      badge is legitimately the account `is_active` flag, not employment
      status. There is currently no account with a real `EmploymentRecord`
      in `ACTIVE` status to Delete and Restore. Needs: take `managercccc`
      (now genuinely Active with a real EmploymentRecord, per this session)
      through Delete → Restore once the lifecycle-gate fix above is live and
      Manager accounts get the Delete/Restore buttons — confirm
      `employment_cycle` increments, documents are preserved and NOT
      re-demanded, and the submit-for-review gate becomes contract-only.
- [ ] **Employment-level Deactivate/Reactivate** ("temporary pause", distinct
      from the account-level `is_active` toggle already confirmed to exist
      on every profile). Same blocker as re-onboarding — needs an Active
      account with a real EmploymentRecord; retest once the gate fix is
      live, using `managercccc`.
- [ ] **RM-role-enabled routing path** (Manager applicant → RM of their own
      group, rather than the Admin fallback exercised this session). Needs
      `FEATURE_RM_ROLE` turned on in this environment, which it is not
      today.
