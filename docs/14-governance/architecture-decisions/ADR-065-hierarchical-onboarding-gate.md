# ADR-065: Hierarchical Onboarding Gate — Universal Activation Preceding Scope Assignment

- **Status:** Accepted — ratified by the project owner, 2026-08-11.
- **Date:** 2026-08-11
- **Scope:** Onboarding and Activation lifecycle / Authorization model / Domain structure. Establishes a universal onboarding and activation gate for all non-Admin roles (Worker, Checker, Manager, Regional Manager). Explicitly enforces that operational organizational assignment must only be written *after* the activation is fully approved. Admin remains exempt from onboarding.
- **Supersedes:** Any prior module specification stating or implying that Managers or Regional Managers receive operational scope during account creation. Amends `ADR-030` and `ADR-022`/`ADR-023`/`ADR-025` to clarify that role assignment does not immediately confer scope.
- **Change class:** Material data-model/lifecycle decision requiring a Decision Record per Constitution §6/§7.

---

## 1. Grounding Facts

- `User` creation is currently handled via two paths: public signup for Workers (`backend/src/modules/auth/service.ts:271`), and administrative creation for Managers/Admins (`backend/src/modules/users/service.ts:153`). The latter immediately assigns the role and creates an active user.
- The `EmploymentRecord` (`backend/prisma/schema.prisma:641-697`) is created with an initial status of `PENDING` (`backend/src/modules/employee-management/service.ts:96`).
- `EmploymentRecord` contains foreign keys for operational scope: `hotel_group_id` (`schema.prisma:668`) and `primary_hotel_id` (`schema.prisma:677`).
- Existing Activation Gates: `backend/src/modules/employee-management/service.ts` enforces rigorous gates before a Worker can be activated: document completeness (lines 424-438) and an approved contract (lines 488-502).

## 2. Problem

Currently, the platform's robust onboarding gate (Personalfragebogen, required documents, chatbot flow, hand-signed contract, and pool/claim hiring review) is applied exclusively to the **Worker** role. Checker, Manager, and Regional Manager roles lack an onboarding model entirely. They receive their organizational scope (e.g., `hotel_group_id`) immediately upon administrative creation, bypassing the compliance and document gates.

This creates a vulnerability where a Manager or Regional Manager who has not passed legal/compliance checks or signed a contract could technically hold operational scope within the platform, violating the core principle that all employees must be fully vetted before receiving system access.

## 3. Decision

1. **Universal Onboarding Gate:** All non-Admin users (Worker, Checker, Manager, Regional Manager) must undergo a structured onboarding process. They remain in an `Inactive`/`Pending` state until fully approved. The existing Worker gates (document completeness, approved contract) are explicitly preserved and must be enforced.
2. **Strict Post-Activation Scope Assignment:** Under no circumstances may an operational organizational assignment foreign key (`hotel_group_id`, `manager_user_id`, `primary_hotel_id`) be written to a domain entity (such as `User`, `EmploymentRecord`, or `Hotel`) before the user has successfully completed onboarding and transitioned to `Active`.
3. **Application Routing via Target Scope:** To allow the pool/claim hiring review to function for unassigned users, the onboarding *application* (rather than the operational domain record) will hold a `target_scope_id` (e.g., the ID of the Hotel Group they are applying to). This allows the system to route the application to the correct manager's shared inbox without granting the applicant premature operational scope.
4. **Approval Hierarchy:** The approval and contract-signing confirmation for each role must follow this strict hierarchy:
   - **Worker and Checker:** Reviewed and approved by the target Hotel Group's **Manager** or **Regional Manager**.
   - **Manager:** Reviewed and approved by the target Hotel Group's **Regional Manager** or an **Admin**.
   - **Regional Manager:** Reviewed and approved exclusively by an **Admin**.
5. **Contract Ownership:** The reviewing authority (the approver designated above) is responsible for marking the hand-signed contract as "signed & valid".
6. **Assignment Trigger — Two Distinct Actions, Not Fused (2026-08-11):** Approval and operational
   assignment are two separate actions, each requiring its own explicit trigger — not one action
   that performs both. Rationale: approval alone carries no information about *which* Hotel the
   approving Regional Manager (or Admin) intends to assign a newly-active Manager to — the target
   Hotel is a genuinely new input only the approver can supply at assignment time, not something
   `approve()` can infer. Concretely: (a) the approver calls an approve action; the record
   transitions `Pending → Active` with no scope fields written (per Decision 2); (b) the approver
   (or another authorized actor) separately calls an assign action, supplying the target Hotel (for
   Manager) or Hotel Group (for Regional Manager) explicitly; that action writes the real
   `Hotel.manager_user_id`/`HotelGroup.regional_manager_user_id` (per `ADR-025`/`ADR-023`) and, for
   Manager, the corresponding `EmploymentRecord.hotel_group_id`. Until step (b) completes, the
   record is `Active, Unassigned` — active but not yet operationally scoped. This differs from
   Worker/Checker's existing pattern, where `hotel_group_id` resolution is fused into the same
   `approve()` transaction (`employee-management/service.ts`'s `resolveApprovalGroupId`) — that
   existing Worker/Checker mechanism is unchanged by this ADR; this two-step requirement applies to
   Manager/Regional Manager specifically, because unlike Worker/Checker's already-known
   `hotel_group_id` (resolved from the approving manager's own scope), Manager/RM's assignment
   target is not derivable from the approver's identity alone.

## 4. Rationale

- **Compliance:** Enforcing the onboarding gate across the hierarchy ensures every operational employee, from cleaner to Regional Manager, has submitted their required details and signed their contract before receiving access.
- **Security & Authorization:** Preventing scope assignment until activation hardens the authorization model. A `Pending` user is guaranteed to have no operational scope in their JWT claim, completely mitigating premature access risks. Furthermore, Review Queue isolation, not just approval-role gating, is required to prevent a Manager/RM from viewing applicant data (Personalfragebogen, documents, contract) outside their own assigned scope — enforcing strict data-privacy and least-privilege.
- **Consistency:** Normalizes the lifecycle and state transitions for all roles under a single, unified state machine, removing fragmented edge cases and manual admin creation paths.

*Related, Out-of-Scope Fix:* The `primary_hotel_id` meaning changes here directly enable the resolution of the quality module's hotel-matching defect (`OQ-09`/`FIND-SEC-002`). That fix enforces assignment-day-hotel-matching (a Checker may only verify a Worker if both have an active `WorkerAssignment` at the same `hotel_id` on the same day) and is documented separately in the Quality module spec.

## 5. Risks

- **UX Friction for Management:** Forcing Managers and Regional Managers through a structured onboarding flow increases the friction of adding administrative staff compared to the current instant-creation flow.
- **Data Model Complexity:** Introducing `target_scope_id` requires careful separation from operational scope fields (like `hotel_group_id`) to ensure standard RBAC middleware doesn't inadvertently grant access based on the target scope.

## 6. Resolved Items (Implementation Details)

1. **Manager/RM EmploymentRecord Re-use:** We will reuse the `EmploymentRecord` entity for Manager and Regional Manager roles. The existing `PENDING` status effectively models their unassigned state.
2. **Document Requirements — Correction (2026-08-11, superseding the original text of this item):**
   Every non-Admin role (Worker, Checker, Manager, Regional Manager) requires the same document
   completeness gate and Familiarization Period is Worker/Checker-specific probation trial work,
   not a document requirement — Manager/RM never had a Familiarization Period to begin with, so
   there is nothing to "bypass" there; the original text of this item incorrectly implied a
   document-requirement exemption for Manager/RM, which is corrected here. **Grounding fact:**
   `backend/src/modules/chatbot/` contains only a `.placeholder` file — the Chatbot-guided
   document-collection flow (`SPEC-CHATBOT-001`, `ADR-013`) does not exist in the repository at
   this revision, for any role. Until the Chatbot module is built (post-MVP), every non-Admin role
   submits required documents via a **manual upload path** (the existing direct-upload mechanism
   already used by `documentService`, not a chatbot conversation). No role — Worker, Checker,
   Manager, or Regional Manager — may reach `Active` status without satisfying the same document-
   completeness gate (`documentService.getDocumentCompleteness`) that already gates Worker today.
   When the Chatbot module is eventually built, it becomes the input mechanism for every non-Admin
   role identically — this decision does not carve out a permanent exemption for any role, only a
   temporary manual-upload substitute for the not-yet-built chatbot conversation flow.
3. **Target Scope ID Location:** A new, distinct nullable column `target_hotel_group_id` will be added to `EmploymentRecord` (and optionally `target_primary_hotel_id` if needed) to route applications without interfering with the operational `hotel_group_id` field.
4. **Worker/Checker Creation Flow & Scope (confirms `ADR-022`, refines schema):** Worker/Checker onboarding is initiated by a Manager (not public self-signup). `EmploymentRecord.primary_hotel_id` is set to the initiating Manager's Hotel at creation and remains user-editable afterward (by the assigned Manager/RM/Admin). Worker and Checker are assigned identically upon activation: `EmploymentRecord.hotel_group_id` is the authoritative, eligibility-governing scope (group-grain, per `ADR-022`'s "not hotel-tied" principle). Both fields are written only at the `Pending → Active` transition (Decision 2), never before. This refines `schema.prisma`'s "display-only" comment for `primary_hotel_id`: while it MUST NOT be read by eligibility logic for accepting shifts, it now has two real uses: (1) routing the application to the correct creating Manager's Review Queue, and (2) as input for the assignment-day quality checks.
5. **UI Surfaces:** The frontend layout mapping of "My Onboarding" and "Review Queue" per role is documented natively in `SPEC-ONBOARDING-001` (§6.9), establishing that self-service upload is universal and Admin remains exempt.
6. **Review Queue Isolation:** A reviewer's Review Queue is strictly filtered to their own assigned scope, not merely gated by role. A Manager's queue contains only applications whose target scope resolves to that Manager's own Hotel — zero visibility into applications targeting any other Hotel, even in the same Hotel Group. A Regional Manager's queue contains only applications whose target resolves to a Hotel within that RM's own HotelGroup — zero visibility outside that group. This isolation applies to Review Queue visibility and approval authority only; it does not restrict Worker/Checker's post-activation ability to work cross-hotel within their assigned Hotel Group, which remains governed by the existing `hotel_group_id` mechanism unchanged. The new endpoints should reuse the existing `isHotelInScope`/`isWorkerInGroupScope` helpers in `backend/src/lib/scope.ts` to enforce this boundary.
7. **Manager Application: Target Field Defaulting (2026-08-11):** When a Regional Manager creates a
   Manager application, `target_hotel_group_id` defaults to **the creating Regional Manager's own**
   `hotel_group_id` — auto-filled by the system, not a value the RM types in. This mirrors the
   existing Worker/Checker pattern where `primary_hotel_id` defaults to the creating Manager's own
   Hotel (§6 item 4). `target_primary_hotel_id` (the specific Hotel the new Manager will eventually
   run) is left empty at creation time — which specific Hotel is a separate decision made later, at
   `assign()` time (Decision 6), not at application-creation time. Both `target_hotel_group_id` and
   `target_primary_hotel_id` remain editable afterward by an authorized actor (Manager/RM/Admin),
   exactly as `primary_hotel_id` already is for Worker/Checker (§6 item 4) — they are **not** a
   one-time routing value that gets cleared once consumed; they persist as the live, current
   default/target values even after a real assignment has been written via `assign()`. When an Admin
   (rather than an RM) creates a Manager application, per the same default-to-creator's-own-scope
   principle, no `hotel_group_id` exists on an Admin to default from — `target_hotel_group_id` must
   be supplied explicitly by the Admin at creation time in that case (Admin has no scope to
   auto-fill from, unlike an RM).
8. **Document Category Redesign — Replaces `GENERAL`/`WORK_PERMIT` (2026-08-11):** The `DocumentCategory`
   enum (`schema.prisma` ~line 1244, currently `GENERAL`/`WORK_PERMIT`) is replaced with a
   named-document checklist model, applying identically to every non-Admin role (Worker, Checker,
   Manager, Regional Manager) per Decision 1 (Universal Onboarding Gate) — there is no role-specific
   variant of this checklist.
   - **New required categories (all mandatory, no `GENERAL` catch-all):** `TAX_NUMBER`,
     `SOCIAL_SECURITY_NUMBER` (Sozialversicherungsnummer), `HEALTH_INSURANCE`, `ID_CARD`,
     `PASSPORT`, `ADDRESS` (proof of address). `ID_CARD` and `PASSPORT` are **both** independently
     required — this is not an either/or; a complete application has both, unlike a typical
     one-or-the-other identity-document pattern.
   - **`WORK_PERMIT` is retained as a category**, but its *requirement mechanism* changes: it is no
     longer derived from the applicant's `personal_data.nationality` field
     (`employee-management/service.ts` ~lines 433-440, the existing
     German/non-German nationality check in `submitForReview()`). Instead, work-permit-required
     becomes an **explicit checkbox/flag set by the creating actor at application-creation time**
     (e.g. a new `work_permit_required: Boolean` field on `EmploymentRecord`, defaulted to `false`,
     set explicitly by whoever creates the application — the Manager creating a Worker/Checker, or
     the RM/Admin creating a Manager/RM application). `submitForReview()`'s completeness check reads
     this stored flag going forward, not nationality.
   - **Completeness semantics:** an application is document-complete when all of `TAX_NUMBER`,
     `SOCIAL_SECURITY_NUMBER`, `HEALTH_INSURANCE`, `ID_CARD`, `PASSPORT`, `ADDRESS` are present, plus
     `WORK_PERMIT` if and only if the stored `work_permit_required` flag is `true` for that record.
     The UI-facing shape of this check is a checklist (which named documents are uploaded, which are
     missing) rather than a binary complete/incomplete signal — `documentService.getDocumentCompleteness`'s
     response shape should surface per-category status, not just an aggregate boolean, to support
     this.
   - **Contract remains separate and unaffected:** the contract gate (`assertApprovedContract`,
     hand-signed contract confirmation) is a distinct requirement from this document checklist, per
     Decision 1 — this item does not change contract handling in any way.
   - This is a breaking schema/behavior change to a shared enum consumed by the existing
     Worker-onboarding flow (`docs/03-modules/onboarding/MODULE_SPEC.md` §6.2 "Document
     Requirements") — that spec's document-requirements section must be updated to match this new
     category list in the same documentation pass that precedes Phase 2 code for this piece,
     following this repo's established docs-first discipline.
   - **Migration backfill (2026-08-11):** this repository is pre-MVP/actively-developed; no
     production data with `category = 'GENERAL'` is assumed to exist. The migration does not need
     to backfill/remap existing `GENERAL` rows to one of the new categories — if such rows do exist
     at migration time, the enum-mismatch failure is an acceptable, loud signal rather than a
     silent data-integrity risk. Do not invent a `GENERAL → X` mapping; if real data is
     discovered that contradicts this assumption, stop and escalate rather than picking a mapping.
9. **Regional Manager Application: No Target Field Required (2026-08-11):** Unlike a Manager
   application (Decision 7 above), a Regional Manager application does not require
   `target_hotel_group_id` at creation, and it may be left `null`. Rationale: `target_hotel_group_id`
   exists specifically to route a pending application to the correct scoped reviewer's queue
   (Manager applications route to the RM whose group contains the target; Worker/Checker
   applications route to the Manager whose hotel is targeted). A Regional Manager application has
   no equivalent routing need — it is reviewed exclusively by Admin (Decision 4), who sees every
   pending RM application regardless of any group, with nothing to filter by. The eventual Hotel
   Group assignment for a newly-active RM still happens later, via the same `assign()` action
   (Decision 6), unchanged.

| Authority | Effect |
|---|---|
| `ADR-023` | Generalizes its already-established "assignment at approval, not creation" timing pattern from Worker to Manager/RM. Compatible, not modified. |
| `ADR-025` | Same nullable-until-assigned shape `Hotel.manager_user_id` already has; ADR-065 adds a precondition on when that write may occur. Compatible, not modified. |
| `ADR-030` | New "approve onboarding" capability fits within RM's existing operational (non-MASTER) capability set; forward-note that ADR-030's capability matrix may need a cross-reference update at its own next revision. |
| `ADR-022` | Extends the "not hotel-tied, group-grain" EmploymentRecord model to Manager/RM; note the asymmetry that Manager's eventual assignment target is a single Hotel (via ADR-025) even though routing is at HotelGroup grain. |
| `ADR-061` | **Resolved (2026-08-11):** the forward-note this row previously carried is settled. Manager/RM onboarding documents (Personalfragebogen, contract scan) reuse the existing `WorkerDocument`/`documents` module mechanism as-is — no separate access-control path. The reviewing Regional Manager/Admin sees a Manager/RM applicant's documents through the same `checkWorkerScope()`-gated route shape (`GET /workers/:worker_id/documents`-equivalent) already governing Worker/Checker document access, scoped by the same `isHotelInScope`/`isWorkerInGroupScope` boundary used for Review Queue isolation (§6 item 6). `ADR-061`'s own Regional-Manager document-access widening (2026-08-04) already extends this correctly — no further RBAC change needed there. |
