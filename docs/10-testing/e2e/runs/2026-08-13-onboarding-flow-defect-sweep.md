# Run log — 2026-08-13 — Onboarding flow defect sweep

**Branch:** `fix/onboarding-audit-document-lock-and-contract-gate`
**Trigger:** eight defects reported from live use of the onboarding flow.
**Method:** source-level trace of each report through backend + frontend, then unit
regression tests (`backend`: 2714 passing). **No live-environment run was performed** —
see *Not verified end-to-end* below. Nothing here was verified at the data layer; the
scenarios in `../scenarios/` must still be executed against a live stack before this is
considered closed.

---

## Defects found and fixed

### D-1 — Approve was unreachable for every application (reported: "the approve button is not working")

`approve()` requires a **confirmed** contract (`assertApprovedContract` → status
ACTIVE/EXTENDED/PERMANENT). Nothing on the reviewer's surface ever confirmed one:
confirmation lived on the HR `ContractCard` (a separate screen), and the review-queue
modal disabled its own Approve button on the same unmet condition. So the queue's terminal
action was permanently dead — the reviewer could neither approve nor discover why.

**Fix:** approving IS the manager's review of the returned signed contract (RULE-HR-03), so
`approve()`/`rehire()` now call `hrService.confirmSignedContractIfPending()` first —
confirming the pending contract, attributed to the approving actor, with HR's own audit
record. No scan on file → no-op, and the existing gate produces the real message.

### D-2 — "Contract is uploaded, still says contract is not uploaded"

Two upload paths exist: the manager-posted scan (`POST /hr/workers/:id/contract-scan`,
which sets `Contract.scanned_document_id`) and the **applicant's own** `CONTRACT_SCAN`
document upload on My Onboarding (which sets no `Contract` column at all). Every applicant
uses the second. Confirmation, the HR card and the applicant's own card all keyed on the
first, so a returned, signed contract read as "not uploaded" everywhere.

**Fix:** `HrService.findSignedScanDocumentId()` resolves the applicant-uploaded scan (dated
at or after the contract it purports to sign — a scan against a *previous* contract does
not count). `confirmContractSigned()` adopts and persists it; `ContractDto` gained a derived
`signed_scan_uploaded` that every surface now renders from.

### D-3 — Admin saw every review request

The queue's admin branch claimed all `created_by.role = ADMIN` records. Under ADR-065 an
`EmploymentRecord` is created by whoever creates the *account*, which is usually the admin
— so "admin-created" was nearly every application, and admin became the default reviewer.

Worse, the queue and the notification recipient had drifted apart: a manager-created worker
application sat in the **creating manager's** queue while the "awaiting review" notification
went to that manager's **Regional Manager**. The person who could act was never told; the
person told saw an empty queue.

**Fix:** `resolveReviewerRecipients()` is now the single routing authority — the queue
filters its rows with the same function that picks the notification recipient, so they
cannot disagree. Routing is by who the applicant is and where they are headed, not by who
typed the account in:

| Applicant | Reviewer |
|---|---|
| Regional Manager | Admin |
| Manager | RM of the target group (Admin if none, or while `FEATURE_RM_ROLE` is off) |
| Worker / Checker | manager of the target hotel → else that group's RM → else Admin |

An applicant is never their own reviewer; Admin remains reviewer of last resort, so no
submitted application can become invisible to everyone.

### D-4 — Notifications reached admins but not managers

Same root cause as D-3 (the routing mismatch), now fixed by construction. Verified
separately: the in-app notification path (`NotificationService.enqueue` → `Notification`
row, `GET /notifications`) has **no role gating** at any layer, and the bell renders for
every authenticated user. PUSH transport is worker/checker-app only by design (APNs bundle
IDs are per app), which is a delivery-channel limit, not a role limit.

### D-5 — Re-onboarding demanded documents again

Owner decision (revising the 2026-08-13 audit decision that re-ran the completeness gate for
returning employees): re-onboarding checks the **contract only**. Profile and documents are
deliberately preserved across cycles, so `submitForReview()` now runs the document gate for
first-time applicants only. Documents stay visible to the reviewer, who can still reject.

### D-6 — Re-onboarding reviewer UI

The modal told the reviewer to "confirm the new contract in HR" — a screen that, per D-1/D-2,
could not confirm it. It now states the contract as the only open question and labels the
action by what will actually happen: **Reactivate** (contract still valid) or **Reactivate &
confirm new contract** (lapsed, new one issued and returned signed). Same for first-time
review: **Approve & activate** vs **Confirm contract & approve**.

### D-7 — Opaque failure when a Manager creates a user

`createUser()` replaced *every* failure of the employment-record step with "setting up the
onboarding record failed. Please try again." The real cause is almost always an
authorization/scope condition the creator can fix — e.g. `Manager must have a scoped
hotel_id to create an application` for a manager who heads no hotel yet — and "please try
again" is precisely wrong advice for it: the retry fails identically. Typed
(Forbidden/Conflict/Validation) errors now propagate; the generic sentence is kept only for
genuinely unexpected failures. My Onboarding's `alert()` on submit was the same bug and now
shows the server's message (which document is missing, or that the contract is unsigned).

### D-8 — "Cannot reject: only Admin can manage Manager applications while RM role is disabled"

Not a gate bug — a routing bug. `assertLifecycleAuthority` correctly refuses an RM acting on
a Manager application while `FEATURE_RM_ROLE` is off, but the old queue still *showed* that
RM the application (it matched `created_by_id = actor.userId`). The reviewer was handed a
record they were structurally forbidden to action. D-3's routing sends Manager applications
to Admin whenever the RM role is disabled, so the record and the authority now agree. The
gate itself is unchanged and still correct.

---

## Not verified end-to-end

- No live stack was run: no data-layer verification of any fix above. **This is a gap, not a
  pass** — scenarios 01/02 must be executed before release.
- The `PUSH` transport was reasoned about from source, not exercised.
- D-3's routing is covered by unit tests for the worker→hotel-manager and
  no-manager→admin cases only. The Manager-applicant→RM path (needs `FEATURE_RM_ROLE` on)
  and the multi-hotel/multi-group fan-out are untested.
- Re-onboarding was tested at the service layer with a still-valid contract. The
  lapsed-contract path (new contract issued at submit → applicant signs → reviewer confirms
  on approve) has no automated coverage.
