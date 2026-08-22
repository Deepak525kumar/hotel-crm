# Module Specification: `employee-management`

## Document Control

| Field | Value |
|---|---|
| Spec ID / version | `SPEC-EMP-001 / 0.2.8` |
| Status | `FROZEN` |
| Owner | `unassigned` — reserved human authority (SYNC-001); no `CODEOWNERS` exists and `backend/package.json` author is empty |
| Authors / reviewers | Author: Module Author (documentation workflow). Independent reviewers (2026-07-20 G4 round, reused for freeze): Architecture `PASS_WITH_ACTIONS`, Dependency `PASS_WITH_ACTIONS`, Consistency `PASS_WITH_ACTIONS`, Performance `PASS_WITH_ACTIONS`, Security `PASS_WITH_ACTIONS` (upgraded from `FAIL` by the targeted 2026-07-20 re-verification against `ADR-023`; see Review and Change Log). |
| Repository revision | `1796c370ec2639ea801f8f057a15918b8cbd41fc` (`1796c37`) |
| Approved by / at | FROZEN at G2 Specification Freeze on 2026-07-20 by the commissioning human (this session's explicit conditional authorization: "if Security passes... execute the G2 freeze workflow"), reusing the existing G4 evidence. Security's 2 High findings (`FIND-001`/`FIND-002`) are RELEASE PREREQUISITES reviewed at G8, not freeze blockers, per the `SPEC-AUTH-001`/`SPEC-ATT-001` precedent explicitly cited by the re-verification. **Amended (Correction, v0.2.1→0.2.2) 2026-07-28, per `GD-12`** (`ADR-032`, Platform event-bus / inter-module transport, Decided via the Governance Resolution workflow): `OD-EMP-09` is now RESOLVED at the transport-convention level — every `EVT-EMP-*`/`IF-EMP-*` row's transport is a direct in-process call (synchronous effects) or the existing Outbox (asynchronous/durable effects), per `ADR-032`; no generic event bus exists or is introduced. No producer/consumer is built yet for any `EVT-EMP-*` event, so this amendment resolves the platform-level convention only — which mechanism each specific event uses remains to be assigned when its producer is actually built, per the criterion `ADR-032` states (atomic-with-trigger → direct call; eventually-delivered → Outbox). No other requirement, rule, or open decision is touched. FROZEN status retained. **Amended (Correction, v0.2.7→0.2.8) 2026-08-07, per the employment-lifecycle rework** (PR #354/#355/#356, `ADR-030` §3 note ³, `docs/14-governance/architecture-decisions/ADR-030-manager-write-authority-capability-model.md`): `REQ-EMP-002`/`RULE-EMP-02`/`RULE-EMP-03`/`RULE-EMP-12` and the State and Lifecycle section are updated to describe the shipped permanent, non-terminal employment lifecycle (`PENDING`/`ACTIVE`/`DEACTIVATED`/`REJECTED`/`DELETED`, `backend/prisma/schema.prisma`), which supersedes the terminal 5-state model (`Inactive`/`Under Review`/`Active`/`Rejected`/`Deactivated`, with `Rejected`/`Deactivated` as dead ends) this spec previously described. Authority for this correction is the shipped, tested, merged implementation plus the already-amended `ADR-030`, not a new `CONFIRMED_REQUIREMENTS_REGISTER.md`/`PIVOT_DESIGN_DOCUMENT.md` entry — **CRR/PDD are not updated by this correction and remain stale on this specific point**; a future documentation pass should reconcile them, but this correction does not block on that (same pragmatic-sync precedent as `ADR-030`'s own amendment, which cited the shipped code rather than re-deriving requirements from scratch). No other requirement, rule, boundary, or open decision in this spec is touched. FROZEN status retained. |
| Supersedes | Prior non-canonical *Employee Management Module — Business Specification* at this path, revision `7c71498` (retained as historical evidence in git history) |

> **Authoring note (not a normative section change).** This document is the canonical-template instance for the Employee Management module, authored per the [Documentation Workflow](../../../.claude/workflows/documentation.md) freeze sequence. It replaces the prior free-form business specification at this path with the fixed shape of [`MODULE_SPEC_TEMPLATE.md`](../../../.claude/templates/MODULE_SPEC_TEMPLATE.md); the template file itself is unmodified. Behaviour is derived **exclusively** from the two authoritative documents — `docs/00-foundations/CONFIRMED_REQUIREMENTS_REGISTER.md` (**CRR §n**) and `docs/00-foundations/PIVOT_DESIGN_DOCUMENT.md` (**PDD §n**) — plus the current worktree for repository facts. No behaviour is drawn from marketplace-era or `docs/legacy/**` sources.

## Purpose and Scope

**Outcome:** A single authoritative, legally compliant record of each **employee** (the Staff/Worker role) — identity linkage, core employment fields, lifecycle status, skills, and hotel blocklisting — exposed consistently to the rest of the Workforce Operations Platform, together with the unified profile-and-history view that serves as the platform's performance-review surface (CRR §4, §5; PDD §9.1).

**In scope:**

- Employee identity linkage to the platform account (account owned by Authentication/User Management; this module owns the employment-domain record and references the account) (CRR §1, §2; PDD §5.3).
- Core employment profile fields: Employee ID, Job Title, Start Date (CRR §4).
- Employee lifecycle status and its transitions — permanent, non-terminal (**corrected v0.2.8**, see State and Lifecycle): Pending → Active/Rejected, with Deactivated (temporary pause) and Deleted (left the company) both returning to Active — plus the manual "marked suitable" probation milestone (CRR §6–§10; PDD §9.1).
- Skill tags carried on the record — the fixed confirmed set and each tag's assessment basis — as the authoritative input other modules read (CRR §4, §13).
- Unified profile-and-history view: aggregation and presentation of work history, task scores, and rating history, with date and management filters (CRR §5).
- Personalfragebogen-sourced personal data carried on the employee record (collected by Onboarding; stored here as the employee's personal data) (CRR §6).
- Hotel blocklist: a hotel blocking specific staff from assignment there, with a logged reason (CRR §4).
- Bulk CSV import of staff, routed through the same hire-approval workflow as manual creation (CRR §4).
- Employee-data governance owned at the record: special-category field visibility, retention-tier classification of employee fields, subject-rights data provision, and immutable audit of employee-record actions (CRR §25–§30; PDD §5.4, §5.7).
- Provisional representation of the today-only red/green availability indicator; **final owning module is an open decision** (CRR §20 — see OD-EMP-07).

**Out of scope:** (owned elsewhere and referenced, never redefined — Constitution §6)

- Authentication, login, MFA, sessions, password reset, failed-login manager notification (Authentication module; CRR §2; PDD §5.3).
- The platform account/role/scope object and the RBAC framework itself (User Management / Authorization; CRR §1; PDD §5.4).
- Onboarding orchestration: the Personalfragebogen self-service form, the document-collection chatbot, and the pool/claim hire-approval mechanism (Onboarding module; CRR §6, §8, §10).
- Document storage, expiry tracking, and the non-EU work-permit requirement (Documents module; CRR §4, §7).
- Contract generation, storage, and the manager-confirmed hand-signed contract lifecycle (Contracts module; CRR §9).
- Weekly calendar, direct scheduling, and sick/vacation marking (Calendar/Scheduling module; CRR §13, §22).
- Broadcast job requests, direct assignment, skill-based eligibility computation, and daily assignment exclusivity enforcement (Job Dispatch module; CRR §13).
- Quality scoring, rating computation, rating tiers, recency weighting, warnings, and the rework flow (Quality module; CRR §14–§16).
- Geofenced clock-in/out and coordinate capture/retention (Attendance/Geo module; CRR §17).
- Push notification delivery (Notifications module; CRR §18), payslip request flow (owned by `backend-hr`/`SPEC-HR-001` per `ADR-014`; no standalone Payslips module — `docs/03-modules/payslips/` remains a non-owning placeholder; CRR §23), the daily GDPR consent gate (Consent module; CRR §24), the three-tier automatic deletion jobs (Retention module; CRR §25), policy governance and subject-rights automation (Compliance module; CRR §26, §27, §33), hotel/Hotel-Group records and the pause-jobs toggle (Hotels module; CRR §11), and basic analytics (Analytics module; CRR §21).

**Non-goals:** (confirmed out of the platform entirely — CRR §3, §4, §13, §22, §23, Explicit Non-Goals)

- Worker-initiated job applications, auto-matching/ranking, best-match suggestions, worker browsing/selection, marketplace analytics, and all marketplace terminology.
- Background checks; account lockout; login rate-limiting; CAPTCHA; MFA for regular staff.
- Department field; certifications and certification reminders; preferred-staff list; internal-transfer tracking; an employment-type *distinguishing* field; promotion history; training records; reward history.
- In-system payroll math; leave-balance tracking; leave-approval workflow; shift swaps; coverage planning; recurring jobs.
- Rooms/floors/buildings/zones; offline mode; SMS/email notification channels; multi-country support.

## Evidence and Traceability

| Claim/requirement | Source path, line, revision, or decision | Authority | Status |
|---|---|---|---|
| `REQ-EMP-001` One employment record per employee; core fields Employee ID, Job Title, Start Date | `docs/00-foundations/CONFIRMED_REQUIREMENTS_REGISTER.md` §4 (CRR §4) | Authoritative | Confirmed |
| `REQ-EMP-002` Employee lifecycle status is owned here | CRR §6–§10; `PIVOT_DESIGN_DOCUMENT.md` §9.1 (PDD §9.1) | Authoritative | Confirmed |
| `REQ-EMP-003` Fixed skill-tag set with per-tag assessment basis | CRR §4 | Authoritative | Confirmed |
| `REQ-EMP-004` Unified profile-and-history view is the performance-review surface | CRR §5 | Authoritative | Confirmed |
| `REQ-EMP-005` Hotel blocklist with logged reason | CRR §4 | Authoritative | Confirmed |
| `REQ-EMP-006` Bulk CSV import routed through hire-approval | CRR §4 | Authoritative | Confirmed |
| `REQ-EMP-007` Special-category field visibility restriction + per-access audit | CRR §27, §30; PDD §5.4 | Authoritative | Confirmed |
| `REQ-EMP-008` Retention-tier classification of employee fields | CRR §25; PDD §9.4 | Authoritative | Confirmed |
| `REQ-EMP-009` Provide employee data for subject-rights access/export | CRR §26 | Authoritative | Confirmed |
| `REQ-EMP-010` Immutable audit of employee-record actions; 5-year retention; no admin log viewer | CRR §30 | Authoritative | Confirmed |
| `REQ-EMP-011` Personalfragebogen-sourced personal data carried on the record | CRR §6 | Authoritative | Confirmed |
| `REQ-EMP-012` Permanent-employee model; not hotel-tied; assignable only within Hotel Group | CRR §4, §11, §12, §31 | Authoritative | Confirmed |
| `REQ-EMP-013` Regional Manager + Admin visibility across a group, incl. org chart | CRR §1 | Authoritative | Confirmed |
| `REQ-EMP-014` Today-only red/green availability indicator exists (inputs: same-day assignment + sick/vacation) | CRR §20 | Authoritative | Confirmed; **owning module open** (OD-EMP-07) |
| Confirmed five-role model; no Supervisor role | CRR §1; PDD §5.4 | Authoritative | Confirmed |
| Probation shape: 1-year fixed-term, 6-month probation, hand-signed; permanent after 2 years | CRR §9 (Open Items resolved) | Authoritative | Confirmed |
| Backend code module for HR/employee domain is `backend-hr` (currently a stub — every service method throws `NotImplementedError`) | `.claude/knowledge/DEPENDENCY_GRAPH.yaml:36`; `.claude/knowledge/MODULE_REGISTRY.yaml:154-164` | Generated (repo-derived) | Confirmed current-state (registry's `implementation_status: active-no-tests` vs. the graph's `lifecycle: stub` label a real cross-index terminology difference, not reconciled here — both describe the same zero-employee-domain-logic fact) |
| `backend-hr`'s `specification` field now maps `SPEC-EMP-001@0.1.1 (REVIEW)`; no FROZEN spec maps to it | `.claude/knowledge/MODULE_REGISTRY.yaml:154-164`; `.claude/knowledge/SPECIFICATION_INDEX.yaml` (`backend-hr` row) | Generated | Confirmed (registry pointer synchronized post-ADR-022; `DEP-EMP-001`/`DEP-EMP-002` citation defects corrected) |
| `ADR-022` (Accepted, ratified by merge of PR #166, 2026-07-20): `backend-hotel-workers` is retired from the target architecture; this module becomes the long-term owner of the employment record, repurposing the retired `HotelWorker` roster; hotel-scoping authorization migrates from `HotelWorker` ACTIVE-membership to the role×scope JWT model (`TREQ-008`, `REQ-USERS-022..024`) | `docs/14-governance/architecture-decisions/ADR-022-retire-hotel-workers-into-employee-management.md` | Authoritative (ratified Decision Record) | Confirmed — reciprocal statement added per ADR-022 §Consequences |
| `ADR-023` (Accepted, ratified by merge of PR #170, 2026-07-20): `HotelGroup` is a first-class entity owned by `backend-crm`; the employment record carries `hotel_group_id`, set at hire-approval; Regional Manager/Hotel Manager scope and the JWT `scope` claim shape are decided. Resolves `OD-EMP-05` | `docs/14-governance/architecture-decisions/ADR-023-hotel-group-domain-model.md` | Authoritative (ratified Decision Record) | Confirmed — consumed in this revision (Owned state, `REQ-EMP-012`, Trust boundaries/authorization, `OD-EMP-05`) |
| Authoritative documents live under `docs/00-foundations/`, not `docs/01-product/requirements/` | worktree at `1796c37` | Current repository | Confirmed (location discrepancy — OD-EMP-11) |

## Actors and Terminology

| Term/actor | Canonical definition | Source |
|---|---|---|
| Employee (Staff/Worker) | A permanent employee who performs jobs and earns only when assigned; the sole worker role (no Supervisor) | CRR §1, §4, §13, §31 |
| Checker | Distinct role that inspects work and assigns rework; not a renamed Supervisor | CRR §1 |
| Hotel Manager | Manager scoped to one hotel | CRR §1; PDD §5.4 |
| Regional Manager | New role; sees all Hotel-Manager data across the Hotel Group they manage | CRR §1; PDD §5.4 |
| Admin | System-wide access; hotel creation and account deletion | CRR §1, §11; PDD §5.4 |
| Employment record | The durable per-employee record owned by this module (repurposed retained roster record) | PDD §9.1 |
| Account | Authentication identity (email/username, role, scope) owned by Authentication/User Management and linked to the employment record | CRR §1, §2; PDD §5.3 |
| Skill tag | One of the fixed confirmed set: Cleaner, Public Service, Kitchen Dishwasher, Waiter | CRR §4 |
| Assessment basis | Cleaner → rooms cleaned; Public Service / Kitchen Dishwasher / Waiter → hours worked | CRR §4 |
| Profile-and-history view | Single unified view of work history, task scores, and rating history — this view *is* the performance review | CRR §5 |
| Availability indicator | Today-only red/green signal of whether the employee is available today | CRR §20 |
| Blocklist entry | Hotel-scoped block preventing a specific employee from assignment at that hotel, with a logged reason | CRR §4 |
| Personalfragebogen | German new-hire data form completed self-service at signup; source of the personal data carried on the record | CRR §6; PDD Appendix |
| Special-category data | Konfession (religion, for church tax), disability status, health data (sick notes) — restricted visibility | CRR §27 |
| Hotel Group | Set of hotels under one Regional Manager, within which a worker may be assigned | CRR §11, §12 |
| Hire-approval (pool/claim) | Onboarding-owned manager review that turns a completed application into an active employee | CRR §10 |

## Requirements and Acceptance Criteria

| Requirement | Statement | Priority | Acceptance criteria | Rule IDs |
|---|---|---|---|---|
| `REQ-EMP-001` | Maintain exactly one employment record per employee, linked to one platform account, holding core fields Employee ID, Job Title, Start Date. | MUST | A created employee has exactly one record and one account link; Employee ID, Job Title, Start Date are present and readable; no Department or employment-type distinguishing field exists. | `RULE-EMP-01` |
| `REQ-EMP-002` | Own the employee lifecycle status and permit only the confirmed transitions. **Corrected v0.2.8** (see Document Control): status is now permanent and non-terminal — every state can return to Active, so a returning employee is never a duplicate record. | MUST | Status is one of {Pending, Active, Deactivated, Rejected, Deleted}; every transition matches State and Lifecycle; no Suspended state and no rating/warning-driven automatic transition exist. | `RULE-EMP-02`, `RULE-EMP-03`, `RULE-EMP-12` |
| `REQ-EMP-003` | Hold each employee's skill tags, drawn only from the fixed set, with each tag's assessment basis available to consumers. | MUST | Skill tags accepted only from {Cleaner, Public Service, Kitchen Dishwasher, Waiter}; Cleaner carries rooms-cleaned basis, the others hours-worked; no certifications or expiry. | `RULE-EMP-04` |
| `REQ-EMP-004` | Compose and serve a single profile-and-history view (work history, task scores, rating history) with date and management filters, as the performance-review surface. | MUST | View aggregates referenced data owned elsewhere; date/management filters apply; no separate performance-review process exists; special-category fields never appear. **[G4 PERF-EMP-002, Medium]** This is a multi-module aggregation query with no stated pagination or cross-service call-budget limit; the eventual interface schema (`OD-EMP-09`) must specify a result-set/date-range bound and a maximum synchronous fan-out per request to avoid unbounded-fan-out risk as history depth and hotel count grow. | `RULE-EMP-08`, `RULE-EMP-09` |
| `REQ-EMP-005` | Maintain hotel blocklist entries, each requiring a logged reason. | MUST | A blocklist entry cannot be created without a reason; the entry and its reason are audit-logged; assignment consumers can read the block for a (hotel, employee). | `RULE-EMP-07` |
| `REQ-EMP-006` | Support bulk CSV import of staff, routing each created employee through the same hire-approval path as manual creation. | MUST | Imported employees start Pending and enter the standard hire-approval flow; manual and bulk paths reach Active identically. | `RULE-EMP-10` |
| `REQ-EMP-007` | Restrict special-category field visibility to the confirmed audiences and emit a distinct audit entry on each access. | MUST | Konfession is visible only to the payslip-request processor and Admin; disability status only to Admin; each view/edit yields its own audit entry; general profile never exposes these fields. **[G4 FIND-002, High]** At implementation, these fields must live behind a physically/logically separate accessor unreachable from the general profile serializer, with the audit write enforced synchronously in the same transaction/request lifecycle (not best-effort logging); a test must assert `IF-EMP-GetProfileHistory` never includes these fields. | `RULE-EMP-09` |
| `REQ-EMP-008` | Classify each employee field into its retention tier so the Retention module can delete it automatically at the correct horizon. | MUST | Shift coordinates → 6 months (Tier 1, attendance-linked); general personal/profile data → 5 years (Tier 2); payroll/tax-adjacent fields (IBAN, Tax ID, payslip-request records, wage records) → 6 years (Tier 3). | `RULE-EMP-11` |
| `REQ-EMP-009` | Provide the employee's data for subject-rights access/export requests fulfilled by Compliance. | SHOULD | On a Compliance-initiated request, this module returns the employee's owned fields; each collected field retains its stated legal basis. | `RULE-EMP-09` |
| `REQ-EMP-010` | Audit-log every important employee-record action immutably, retained 5 years, with no admin-facing log viewer. | MUST | Create, update, lifecycle transitions, blocklist, and special-category access are logged immutably via the existing audit framework; logs retained 5 years; no admin log-viewer screen is introduced. | `RULE-EMP-11`, `RULE-EMP-09` |
| `REQ-EMP-011` | Carry the Personalfragebogen-sourced personal data on the employee record (collected/validated by Onboarding). | MUST | The confirmed personal fields are stored; Teilzeit/Minijob is stored as information only with no system logic; formats are validated at capture by Onboarding, not redefined here. | `RULE-EMP-01`, `RULE-EMP-06` |
| `REQ-EMP-012` | Reflect the permanent-employee model: no worker is hotel-tied; a worker is assignable only within their Hotel Group. | MUST | Records carry no permanent hotel tie; the group association (the employment record's `hotel_group_id`, per `ADR-023`) bounds assignability; daily assignment exclusivity outcomes (owned by Job Dispatch) are reflected, not enforced, here. | `RULE-EMP-05`, `RULE-EMP-06` |
| `REQ-EMP-013` | Expose group-wide employee visibility, including the org chart, to Regional Manager and Admin. | MUST | Regional Manager sees employee data across their group; org chart ("who reports to whom") is visible only to Regional Manager and Admin. | `RULE-EMP-08` |
| `REQ-EMP-014` | Represent a today-only red/green availability indicator whose inputs are same-day assignment and sick/vacation state. | MUST | The indicator reflects today only and does not change with the calendar date being viewed; it derives solely from confirmed inputs. **Which module owns/derives it is an open decision (OD-EMP-07).** | `RULE-EMP-05`, `RULE-EMP-06` |

## Business Rules

| Rule | Preconditions | Outcome/invariant | Exceptions/precedence | Owner/source |
|---|---|---|---|---|
| `RULE-EMP-01` | Employee record exists | Exactly one employment record per employee, linked to one account; core fields present | No Department field; no employment-type distinguishing field | This module (CRR §4) |
| `RULE-EMP-02` | Onboarding completion criteria not yet satisfied | Record stays **Pending** (`submitted_for_review_at` null, the old Inactive sub-state); cannot work | Completion criteria differ by nationality (owned by Onboarding/Documents) | This module observes; Onboarding owns criteria (CRR §4, §7, §8) |
| `RULE-EMP-03` | Onboarding signals completion → hire-approval decision | Status remains **Pending** with `submitted_for_review_at` set (the old Under Review sub-state), then transitions Pending → Active or Rejected. **Corrected v0.2.8:** Rejected is no longer a dead end — Rejected → Active is a legal, direct rehire (no re-approval). See State and Lifecycle for the full transition graph, including Deactivated (temporary pause, direct return) and Deleted (left the company, returns via Deleted → Pending → Active). | Hire-approval mechanism (pool/claim) owned by Onboarding | This module owns resulting status (CRR §8, §10) |
| `RULE-EMP-04` | Skill tag assigned | Tag ∈ {Cleaner, Public Service, Kitchen Dishwasher, Waiter}; carries its assessment basis | No certifications, no expiring qualifications | This module (CRR §4) |
| `RULE-EMP-05` | Worker assigned anything for a day (calendar or broadcast) | Reflected as unavailable for further same-day assignment | Exclusivity **enforced** by Job Dispatch; this module reflects it | Job Dispatch owns; this module reflects (CRR §12, §13, §20) |
| `RULE-EMP-06` | Worker marks a day sick/vacation | Calendar owns the mark (`state-calendar-absence`) and emits `EVT-CAL-SickVacationMarked`; the same-day assignment is auto-cancelled by Job Dispatch/assignments on consuming that event, not by Calendar (`ADR-021`); availability reflects it | Vacation is a label only — no balance tracking | Calendar owns the mark + availability read-model; Job Dispatch owns the cancel; this module reflects (CRR §22, §20; `ADR-021`) |
| `RULE-EMP-07` | Hotel blocks a specific worker | Blocklist entry created **with a logged reason**; assignment at that hotel not permitted | Enforcement at assignment time by Job Dispatch | This module owns entry; Job Dispatch enforces (CRR §4) |
| `RULE-EMP-08` | Viewer requests a profile-and-history view | Visible to the worker (self) and every role above them (Checker, Hotel Manager, Regional Manager, Admin) within scope; this view *is* the performance review | Org chart visible only to Regional Manager + Admin | This module (CRR §5, §1) |
| `RULE-EMP-09` | Access to a special-category field | Allowed only for the restricted audience; each access individually audit-logged; never on the general profile | Konfession → payslip-request processor + Admin; disability → Admin only | This module enforces; Compliance owns policy (CRR §27, §30) |
| `RULE-EMP-10` | Bulk CSV import row is valid | Created staff enter the **same hire-approval** path as manual creation | Invalid-row/duplicate handling unresolved (OD-EMP-08) | This module (CRR §4) |
| `RULE-EMP-11` | Any important employee-record action; any field at rest | Action audit-logged immutably (5-year retention); each field classified into its retention tier for automatic deletion | Deletion executed by Retention module | This module classifies/logs; Retention deletes (CRR §25, §30) |
| `RULE-EMP-12` | Rating crosses a warning threshold (<70, then <50) | **No** status change in this module; worker notified, then manager notified; manual handling | No auto-suspension, no automated consequence | Quality owns warnings; this module's status model unaffected (CRR §16) |

## Ownership and Boundaries

**Module owner:** `unassigned` — accountable owner assignment is reserved human authority (SYNC-001, blocked: no `CODEOWNERS`, empty `backend/package.json` author). Code-level home is the `backend-hr` module (`backend/src/modules/hr`), currently a stub whose service methods throw `NotImplementedError` (`.claude/knowledge/DEPENDENCY_GRAPH.yaml:36`). The docs↔code module-id mapping is proposed, not asserted — see Proposed Knowledge Deltas and OD-EMP-10.

**Owned state:**

- The employment record and its core fields (Employee ID, Job Title, Start Date).
- The employment record's `hotel_group_id` (`ADR-023`): the employee's Hotel Group association, a foreign key to the `HotelGroup` entity owned by `backend-crm`. Set at the `Pending → Active` hire-approval transition (`RULE-EMP-03`) from the approving manager's own `hotel_group_id`; bounds assignability per `REQ-EMP-012`. Resolves `OD-EMP-05`. **Not** set on a direct reactivation/rehire (`Deactivated → Active`, `Rejected → Active`) — those transitions leave `hotel_group_id` unchanged, since only the initial `Pending → Active` approval resolves it (corrected v0.2.8, see State and Lifecycle).
- Employee lifecycle status and the manual "marked suitable" milestone flag.
- Skill tags and their assessment basis on the record.
- Personalfragebogen-sourced personal data carried on the record, including the restricted special-category fields (Konfession, disability status).
- Hotel blocklist entries and their reasons.
- Per-field retention-tier classification metadata for employee fields.

**Consumed state (owned elsewhere, referenced never redefined):** platform account/role/scope (Authentication/User Management); documents and expiry incl. non-EU work permit (Documents); contract and its signing status (Contracts); ratings, scores, tiers, warnings (Quality); attendance/work history and shift coordinates (Attendance/Geo); calendar assignments and sick/vacation state (Calendar); broadcast assignments and daily-exclusivity outcome (Job Dispatch); hotel and `HotelGroup` records (`backend-crm`, per `ADR-023`).

**ADR-022 state-ownership handover (target, not yet executed):** `state-hotel-worker` (the retained `HotelWorker` roster, `.claude/knowledge/DEPENDENCY_GRAPH.yaml:472-478`) is currently read directly by five modules — `backend-work-requests`, `backend-work-applications`, `backend-assignments`, `backend-users`, `backend-analytics` — none of which read through an EMP-owned interface. Per `ADR-022`, this state repurposes into the employment record owned here, and those five consumers must repoint to this module's own interfaces (`IF-EMP-GetSkills`, `IF-EMP-GetBlocklist`, etc.) once the migration's prerequisites land: the Hotel-Group model (decided, `ADR-023`; not yet built), and the role×scope JWT authorization build (`TREQ-008`/`REQ-USERS-022..024`). Until then, `backend-hotel-workers` remains the live authoritative writer/source (`ADR-022` compatibility layer); this module asserts no current ownership of `state-hotel-worker`.

**Permitted writes:** only to this module's owned state above, and only through its own interfaces. Lifecycle-status writes occur solely in response to signals from Onboarding (completion, approve/reject) and an Admin-driven deactivation; this module never writes account, document, contract, quality, attendance, calendar, or dispatch state.

**Boundary/non-responsibilities:** this module does **not** execute onboarding, hire-approval, document/contract handling, scheduling, dispatch/eligibility computation, quality/rating/warning logic, attendance/geofencing, notification delivery, consent gating, retention deletion, or subject-rights automation. It holds only the *resulting employee state* those processes produce and the read surface other modules consume. Availability-indicator ownership is explicitly **not** claimed here pending OD-EMP-07.

## Interfaces and Contracts

For each API, command, query, event, job, or UI contract:

> The authoritative documents describe a modular monolith with synchronous service calls and a notification/audit flow but **do not enumerate a formal interface schema**. The contracts below are the business-level interfaces implied by owned state and confirmed behaviour; concrete transport/versioned signatures are an open decision (OD-EMP-09). Direction is relative to this module.

| Contract ID/version | Direction | Input | Output | Errors | Auth | Compatibility |
|---|---|---|---|---|---|---|
| `IF-EMP-CreateEmployee / v0` | Inbound (command) | Account link + core fields (manual or bulk-import row) | Employee record in **Pending** status (**corrected v0.2.8**, was Inactive) | Validation failure; duplicate identity `[OPEN]` (OD-EMP-08) | Admin; other importing roles `[OPEN]` (OD-EMP-08) | New |
| `IF-EMP-GetProfileHistory / v0` | Inbound (query) | Employee id, optional date/management filters | Unified profile-and-history view (owned + referenced data), special-category fields excluded | Not found; scope denied | Self + roles above within scope (CRR §5) | New |
| `IF-EMP-GetSkills / v0` | Inbound (query) | Employee id (or skill filter) | Skill tags + assessment basis | Not found | Dispatch/manager scope | New |
| `IF-EMP-GetBlocklist / v0` | Inbound (query) | Hotel id and/or employee id | Blocklist entries with reasons | Scope denied | Manager scope / Job Dispatch | New |
| `IF-EMP-SetBlocklist / v0` | Inbound (command) | Hotel id, employee id, **reason (required)** | Blocklist entry (audit-logged) | Missing reason → rejected; scope denied | Hotel/Regional Manager, Admin | New |
| `IF-EMP-RemoveBlocklist / v0` | Inbound (command) | Hotel id, entry id | Blocklist entry removed (audit-logged) | Entry not found, or found but belongs to a different hotel than the one requested → 404 (not 403, to avoid confirming the id exists elsewhere); scope denied | Hotel/Regional Manager, Admin — same shape as `IF-EMP-SetBlocklist` | **New, v0.2.8** (PR #356 — blocklist entries previously had no removal path at all) |
| `IF-EMP-GetSpecialCategory / v0` | Inbound (query) | Employee id, field | Field value (each access audit-logged) | Denied + logged if lacking restricted permission | Restricted tier: Konfession → payslip processor + Admin; disability → Admin | New |
| `IF-EMP-ExportEmployeeData / v0` | Inbound (query, Compliance-initiated) | Employee id | Owned fields for subject-rights fulfilment | Not found | Compliance/Admin | New |
| `IF-EMP-SubmitForReview / v0` | Inbound (command) | Employee id | `submitted_for_review_at` set; status stays Pending (not a status transition) | Not Pending → rejected | Admin, or scoped Manager/Regional Manager | **Corrected v0.2.8** — replaces one branch of the retired `IF-EMP-LifecycleSignal` below |
| `IF-EMP-Approve / v0` | Inbound (command) | Employee id, optional hotel_group_id | Status → Active; `hotel_group_id` resolved (actor's own group, or explicit override) | Not submitted for review → rejected; illegal transition; scope denied | Admin, or scoped Manager/Regional Manager | **Corrected v0.2.8** |
| `IF-EMP-Reject / v0` | Inbound (command) | Employee id, optional reason | Status → Rejected | Illegal transition; scope denied | Admin, or scoped Manager/Regional Manager | **Corrected v0.2.8** |
| `IF-EMP-Deactivate / v0` | Inbound (command) | Employee id, **deactivation_reason (required)** | Status → Deactivated (temporary pause); future assignments cancelled | Missing reason → rejected; illegal transition; scope denied | Admin, or scoped Manager/Regional Manager (**corrected v0.2.8** — was Admin-only) | **Corrected v0.2.8** — no longer soft-deletes the record; see `IF-EMP-DeleteEmployee` |
| `IF-EMP-Reactivate / v0` | Inbound (command) | Employee id | Status → Active, direct, no re-approval | Illegal transition; scope denied | Admin, or scoped Manager/Regional Manager | **New, v0.2.8** |
| `IF-EMP-Rehire / v0` | Inbound (command) | Employee id | Status → Active, direct, no re-approval | Illegal transition; scope denied | Admin, or scoped Manager/Regional Manager | **New, v0.2.8** |
| `IF-EMP-DeleteEmployee / v0` | Inbound (command) | Employee id, **deleted_reason (required)** | Status → Deleted; record soft-deleted; account soft-deleted + sessions invalidated (unified); future assignments cancelled | Missing reason → rejected; illegal transition; Admin-only | Admin only — crosses the account boundary | **New, v0.2.8** — replaces the retired `IF-EMP-Deactivate`'s soft-delete semantics |
| `IF-EMP-Restore / v0` | Inbound (command) | Employee id | Status → Pending (re-approval required); account restored, sessions invalidated again on restore | Illegal transition; Admin-only | Admin only — crosses the account boundary | **New, v0.2.8** |
| ~~`IF-EMP-LifecycleSignal / v0`~~ | ~~Inbound (event-driven)~~ | ~~Onboarding completion / approve / reject signal~~ | ~~Status transition (Under Review / Active / Rejected)~~ | — | — | **Retired, v0.2.8** — this single generic `{signal, ...}` endpoint is replaced by the seven explicit `IF-EMP-SubmitForReview`/`Approve`/`Reject`/`Deactivate`/`Reactivate`/`Rehire`/`DeleteEmployee`/`Restore` interfaces above, since Deactivate/DeleteEmployee need required fields (`deactivation_reason`/`deleted_reason`) a generic body can't cleanly express. The prior Admin-only/internal-only authorization this row described (`ADR-030` D-4c/F-1) is itself superseded by the `ADR-030` §3 note ³ amendment — see State and Lifecycle and `ADR-030-manager-write-authority-capability-model.md`. |

## Events

> No formal event schema exists in the authoritative documents or codebase (no event bus is present — `.claude/knowledge/MODULE_REGISTRY.yaml` records `published_events: none-observed` for every module). The following are business-level domain events implied by owned state changes; the concrete event contract/transport is an open decision (OD-EMP-09).

| Event ID/version | Publisher | Trigger | Payload source | Consumers | Delivery/idempotency |
|---|---|---|---|---|---|
| `EVT-EMP-Created / v0` | employee-management | Record created (signup or bulk import; Pending) | Core fields + account link | Onboarding, Notifications, Audit | `[OPEN]` (OD-EMP-09) |
| `EVT-EMP-SubmittedForReview / v0` | employee-management | Onboarding signals completion | Employee id | Notifications, Audit | `[OPEN]` |
| `EVT-EMP-Activated / v0` | employee-management | Hire-approval approved (Pending → Active), or a direct reactivation/rehire (Deactivated/Rejected → Active) | Employee id | Job Dispatch, Calendar, Notifications, Audit | `[OPEN]` |
| `EVT-EMP-Rejected / v0` | employee-management | Hire-approval rejected | Employee id | Notifications, Audit | `[OPEN]` |
| `EVT-EMP-MarkedSuitable / v0` | employee-management | Manager confirms probation suitability | Employee id, manager | Audit | `[OPEN]` |
| `EVT-EMP-ProfileUpdated / v0` | employee-management | Core/personal field change | Changed fields | Audit | `[OPEN]` — stays open; no producing interface exists, and `ADR-030` (ratified 2026-07-25, `OQ-030-A`/D-4b) rules out a manager/RM field-level edit path as its producer. Not superseded by this correction, only confirmed unresolved by design. |
| `EVT-EMP-SkillsChanged / v0` | employee-management | Skill tags changed | Employee id, tags | Job Dispatch, Audit | `[OPEN]` |
| `EVT-EMP-Blocklisted / v0` | employee-management | Blocklist added/removed (**corrected v0.2.8**: removal is now a real interface, `IF-EMP-RemoveBlocklist`, not just a conceptual "removed") | Hotel, employee, reason | Job Dispatch, Audit | `[OPEN]` |
| `EVT-EMP-Deactivated / v0` | employee-management | **Corrected v0.2.8:** a temporary pause begins (Active → Deactivated) — no longer implies soft-deletion. See `EVT-EMP-Deleted` for the departure case this row previously conflated with pausing. | Employee id | Notifications, Audit | `[OPEN]` |
| `EVT-EMP-Deleted / v0` | employee-management | Record soft-deleted (person left the company); account soft-deleted + sessions invalidated in the same transaction | Employee id | Notifications, Audit | **New, v0.2.8** |
| `EVT-EMP-Restored / v0` | employee-management | A former employee is taken back on (Deleted → Pending); account restored | Employee id | Notifications, Audit | **New, v0.2.8** |

**Consumed events** (to keep profile/availability/history current; contract `[OPEN]`): Onboarding/Documents/Contracts — completion, contract signed, approve/reject → lifecycle transitions (CRR §8–§10); Job Dispatch — worker assigned for a day → history + availability input (CRR §12, §13, §20); Calendar — sick/vacation for a day → availability input (CRR §20, §22); Quality — new rating/score, warning thresholds crossed → profile view, display only (CRR §5, §15, §16); Attendance — clock-in/out recorded → work history (CRR §5, §17). An "availability changed" event is deliberately **not** claimed as published here (OD-EMP-07).

## Dependencies

| Dependency/edge | Reason | Contract | Compatibility | Failure behavior |
|---|---|---|---|---|
| Authentication / User Management | Account, role, scope, MFA, sessions link the employee | `auth-middleware`, RBAC/scope (reused) | compatible (reuse) | No auth → employee functions unavailable (access precondition) |
| Onboarding | Signals workflow completion and approve/reject; owns Personalfragebogen/chatbot/pool-claim | `IF-EMP-SubmitForReview`/`Approve`/`Reject` (candidate) — **corrected v0.2.8**, was the single retired `IF-EMP-LifecycleSignal` | conditional (schema `[OPEN]`) | No signal → record stays Pending |
| Documents | Documents + expiry + non-EU work permit gate activation | referenced (Documents-owned) | conditional | Missing required docs → cannot reach Active |
| Contracts | Manager-confirmed hand-signed contract activates the account | referenced (Contracts-owned) | conditional | No signed contract → cannot activate (CRR §9) |
| Calendar/Scheduling | Sick/vacation → availability input | consumed event (candidate) | conditional | Degraded availability freshness |
| Job Dispatch | Reads skills + blocklist; daily exclusivity → availability input | `IF-EMP-GetSkills`, `IF-EMP-GetBlocklist` | conditional | Eligibility/exclusivity affected downstream |
| Quality | Scores/ratings/tiers/warnings surfaced in profile view | consumed event (candidate) | conditional | Stale ratings in view; no status impact |
| Attendance/Geo | Clock-in/out + coordinates → work history; coordinate 6-month tier | consumed event (candidate) | conditional | Stale history in view |
| Notifications | Push delivery of employee-related events | `notification-service` (reused) | compatible | Events undelivered; state unaffected |
| HR (Payslips, `ADR-014`) | Payslip-request processor context for Konfession visibility — owned by `backend-hr`/`SPEC-HR-001`, no standalone Payslips module | referenced | conditional | Konfession visibility audience incomplete |
| Consent | Daily consent gate is an access precondition | referenced (Consent-owned) | compatible | Declined consent → access blocked + manager notified |
| Retention | Executes automatic tiered deletion of classified fields | classification metadata (this module) | conditional | Fields not deleted on schedule (compliance risk) |
| Compliance | Special-category policy + subject-rights automation | `IF-EMP-ExportEmployeeData` | conditional | Subject-rights fulfilment incomplete |
| Hotels | Hotel and `HotelGroup` records; group context (`backend-crm`, `ADR-023`) | referenced (`HotelGroup` entity, Hotels-owned) | conditional (`HotelGroup` decided by `ADR-023`; not yet built in `schema.prisma`) | Group association mechanism decided (`OD-EMP-05` RESOLVED); physical build pending |
| Platform/infrastructure | PostgreSQL system of record, Express/TS monolith, immutable audit log, Winston, AWS, EU object storage | shared infrastructure (`base-service`, `prisma-schema`) | compatible (reuse) | Standard platform failure modes |

## State and Lifecycle

> **Corrected v0.2.8** (see Document Control): this section previously described a terminal
> 5-state model where `Rejected`/`Deactivated` were dead ends and re-engagement created a **new**
> `EmploymentRecord`. That design shipped and was then superseded by the permanent, non-terminal
> lifecycle below (PR #354/#355/#356) — every state can return to `Active`, and a returning
> employee **reuses the existing `EmploymentRecord`**, never a duplicate. The prior terminal design
> is preserved in git history (this file's pre-`v0.2.8` revisions), not restated here.

**States (employee-level, owned here):**

- **Pending** — record exists (signup or bulk import); may be pre- or post-onboarding-submission.
  The old `Inactive`/`Under Review` distinction is now a sub-state on the same status
  (`EmploymentRecord.submitted_for_review_at`: `null` = old Inactive, "onboarding not complete,
  cannot work"; set = old Under Review, "application in the manager pool") rather than two
  separate statuses (CRR §4, §8, §10).
- **Active** — approved by a manager; may be scheduled and may accept broadcasts (CRR §10).
- **Deactivated** — a **temporary pause only** (leave, seasonal, suspension — a required
  `deactivation_reason` names which). The person is still employed; the employment record and its
  `hotel_group_id` are untouched. Always returns directly to Active, with no re-approval.
- **Rejected** — the manager rejected the application. Returns directly to Active (rehire), with
  no re-approval — the application was never approved, so there is no prior employment period to
  reopen.
- **Deleted** — the person left the company (resignation, termination, contract lapse — a required
  free-text `deleted_reason` names which). Unified with the platform account's own soft-delete
  (`User.deleted_at`/`is_active`/`token_generation`) — deleting the employment record also
  deactivates the account and invalidates its sessions, in the same transaction. Returns only via
  `Pending` (full re-approval required) — this is the one state whose return is a genuine rehire,
  not a direct reactivation.

**Transitions (each audit-logged; each arises from a confirmed event; enforced against
`ALLOWED_TRANSITIONS`, `backend/src/modules/employee-management/constants.ts`):**

- `(none) → Pending` — record created at signup or via bulk import (`submitted_for_review_at` null).
- `Pending → Pending` (sub-state only, not a status transition) — Onboarding signals workflow
  completion; sets `submitted_for_review_at`.
- `Pending → Active` — Onboarding approval decision. Requires `submitted_for_review_at` to be set
  first — an application that was never submitted cannot be approved.
- `Pending → Rejected` — Onboarding rejection decision.
- `Active → Deactivated` — a temporary pause begins (`deactivation_reason` required). Future
  assignments are cancelled (reopening any broadcast slot they held), but the employment record and
  `hotel_group_id` are untouched.
- `Deactivated → Active` — the pause ends; the person returns directly, no re-approval.
- `Rejected → Active` — a previously-declined applicant is taken on after all; direct, no
  re-approval (there was never a prior employment period to reopen).
- `Active → Deleted`, `Deactivated → Deleted`, `Rejected → Deleted` — the person leaves the
  company (`deleted_reason` required). Unified with the platform account's soft-delete (see States,
  above); future assignments and pending broadcast acceptances are cancelled; sessions invalidated.
  **Supersedes this section's prior text**, which described this as creating a new
  `EmploymentRecord` for re-engagement — it does not; see `Deleted → Pending` below.
- `Deleted → Pending` — a former employee is taken back on: a true rehire, reusing the **same**
  `EmploymentRecord` (never a duplicate). The account is restored (un-soft-deleted) but sessions are
  invalidated again on restore, not silently revalidated — access is for onboarding/profile
  completion only while Pending; full operational access resumes only once re-approved to Active.
  `employment_cycle` (an integer counter on `EmploymentRecord`) increments on this transition only,
  and only this one — every other transition leaves it unchanged. It exists purely for reporting
  ("how many times has this person been rehired," "current cycle," "tenure per cycle") without
  reconstructing the full transition history; `EmploymentStatusHistory` (below) remains the source
  of truth for cycle boundaries.
- `Active → Active (marked suitable)` — manager manually confirms probation suitability; **not** a
  distinct status and **not** automated. The resolved probation shape (1-year fixed-term contract,
  6-month probation clause, hand-signed; permanent after 2 years) adds no separate status. **Known
  dormancy (recorded by `ADR-030` §8, forward-note below):** the backing column,
  `EmploymentRecord.marked_suitable`, exists in `schema.prisma` and its migration but is written by
  **zero code paths** — it awaits the CRR §10:163 "manager marks suitable" capability, which
  `ADR-030` defers (D-4c, F-1, to `backend-onboarding`). A rehire (`Deleted → Pending`) explicitly
  clears this flag rather than carrying it forward, since probation is earned per employment cycle,
  not a permanent fact about the person. Recorded as known dormancy; no action needed now.

**History:** every transition writes exactly one row to `EmploymentStatusHistory`
(`from_status`, `to_status`, `reason`, `actor_user_id`, `employment_cycle`, `created_at`) in the
same transaction as the status change — enforced structurally: no code path outside the single
`applyTransition()` seam (`employee-management/service.ts`) may write
`EmploymentRecord.status`/`employment_cycle` directly. This is what makes the log complete (a
transition can never commit unlogged) rather than best-effort.

**Contract-lapse offboarding, corrected v0.2.8:** this section previously described
contract-lapse-caused offboarding as triggering `Deactivated`. Under the corrected model this is
wrong by definition — `Deactivated` now means a temporary pause, and a lapsed, non-renewed contract
means the person left. Contract-lapse offboarding (`SPEC-HR-001`'s `OD-HR-03`/`ADR-040`,
`GD-15`/`ADR-045`) now triggers `Active → Deleted` via the same direct in-process call (`ADR-032`),
which also soft-deletes the account and invalidates sessions — a real, intended escalation over the
prior behavior, not merely a status rename. Every other offboarding cause (voluntary resignation,
termination for cause) remains Admin-initiated manually, unchanged from the prior design.

**Invariants:** no Suspended state; no rating/warning-driven automatic transition out of Active (CRR §16); rating tiers (Elite/High/Standard/Low/Probation) are Quality-owned display labels, never lifecycle statuses (CRR §15); no account-lockout status (CRR §2); no state is terminal — every state has at least one path back to Active.

**Concurrency:** hire-approval claim/lock concurrency is resolved entirely inside Onboarding; this module receives only the resulting decision. Same-day assignment vs. sick/vacation atomicity is owned by Calendar/Job Dispatch (a single transaction there prevents an employee appearing both assigned and on-leave; PDD §7.2).

**Retention/migration:** soft deletion preserves operational/audit history within retention horizons; field-level retention tiers (6 months / 5 years / 6 years) drive automatic deletion by the Retention module. The employment record is repurposed from the retained roster/`HotelWorker` record with no destructive migration (pre-launch, no production employee data; PDD §9.1, §10).

## Failure, Security, Privacy, and Performance

**Failure modes/recovery:**

- Activation attempted before Onboarding signals completion → blocked; record stays Pending (`submitted_for_review_at` null).
- Onboarding completion criteria unmet for a nationality (non-EU work permit missing) → cannot reach Active.
- Assignment attempted for a blocklisted worker at that hotel → not permitted. **Corrected v0.2.8:** as of PR #356 this is genuinely enforced (`isWorkerEligibleForHotel()`, `backend/src/lib/roster-scope.ts`, the single choke point used by reassignment, broadcast-accept, and manual calendar placement) — this row previously described intended behavior the blocklist did not yet implement; it existed only as audit-log data with no enforcement anywhere.
- Special-category access without the restricted permission → denied and audit-logged.
- Bulk import with invalid rows → valid staff created and routed to approval; invalid-row/duplicate handling is unresolved (OD-EMP-08).
- Out-of-order or lost lifecycle signal from Onboarding → handling unresolved (OD-EMP-09).

**Trust boundaries/authorization:** reuse existing authentication (email/username + password; 7-day inactivity logout; forgot-password via email; MFA for Hotel Manager and above; not for Staff/Checker) — this module implements none of it. Deny-by-default authorization on role × hotel/group scope; cross-hotel access requires the actor's scope to include the target hotel. Special-category fields sit behind a **restricted permission tier** smaller than general staff-data access. No background checks, no account lockout, no rate-limiting, no CAPTCHA are introduced (CRR §2, §3; PDD §5.3, §5.4).

**[SECURITY DISCLOSURE, G4 FIND-001, High — RESOLVED at the design level by `ADR-023`]** The only existing hotel/group-scoping primitive in the codebase, `checkHotelAccess()` (`backend/src/middleware/permissions.ts:96-156`), bypasses scope checking entirely for `admin`/`manager`/`checker` roles, and the current `UserRole` enum has no Hotel-Manager/Regional-Manager distinction. Reusing this middleware unmodified for employee-management endpoints would grant every manager account unrestricted cross-hotel/cross-group access, directly violating this module's own `RULE-EMP-08`/`REQ-EMP-013` scope-confinement requirement. This is the same authorization primitive `ADR-022` migrates away from (role×scope JWT, `TREQ-008`/`REQ-USERS-022..024`); this module must **not** build on `checkHotelAccess()`'s current bypass behavior. `ADR-023` (Accepted, 2026-07-20) resolves the design gap that previously blocked this module's own deny-by-default scoping: `HotelGroup` is a first-class entity, the employment record's `hotel_group_id` field is the worker-side association, and Regional Manager/Hotel Manager scope resolves to their group/hotel respectively. This module's deny-by-default scoping is implementable against that model once the JWT-scope build (`ADR-022`) lands; no design decision remains outstanding. See `OD-EMP-05`'s RESOLVED disposition below.

Permission matrix (against the reused five-role RBAC model; deny-by-default):

| Capability | Staff | Checker | Hotel Manager | Regional Manager | Admin |
|---|---|---|---|---|---|
| View own profile & history | ✅ (self) | — | — | — | — |
| View a worker's profile & history | — | ✅ (assigned hotel) | ✅ (their hotel) | ✅ (their group) | ✅ (all) |
| Blocklist a worker at a hotel (with reason) | — | — | ✅ (their hotel) | ✅ (their group) | ✅ |
| Bulk-import staff | — | — | `[OPEN]` (OD-EMP-08) | `[OPEN]` (OD-EMP-08) | ✅ |
| View active workers today | — | — | ✅ | ✅ | ✅ |
| View org chart | — | — | — | ✅ | ✅ |
| View Konfession (special-category) | — | — | — | — | ✅ + payslip-request processor |
| View disability status (special-category) | — | — | — | — | ✅ |
| Approve/reject/deactivate/reactivate/rehire (**corrected v0.2.8**, `ADR-030` §3 note ³ — was Admin-only for the retired `IF-EMP-LifecycleSignal`/`IF-EMP-Deactivate`) | — | — | ✅ (their hotel/group) | ✅ (their group) | ✅ |
| Delete / restore employment (crosses the account boundary) | — | — | — | — | ✅ |

**Data classification/retention:** Germany-only; all documents/photos in EU/EEA object storage; no employee data leaves the EU/EEA. Three retention tiers classified here, deleted automatically by Retention: Tier 1 shift coordinates 6 months; Tier 2 general personal/profile data 5 years; Tier 3 payroll/tax-adjacent fields (IBAN, Steuer-ID, payslip-request records, wage records) 6 years. **[G4 FIND-003, Medium]** Blocklist `reason` (`RULE-EMP-07`) is currently unclassified into any tier and its free-text shape is not permission-restricted the way Konfession/disability are, despite being manager-authored narrative that may incidentally contain special-category-adjacent detail (e.g., a health or conduct allegation); recommend a structured reason-code enum at implementation, or an explicit no-special-category-content policy if free text is retained, pending a product decision. Special-category data is voluntary where applicable, tied to a named legal basis, never on the general profile, and audit-logged per access. Sick leave requires no doctor's note (Calendar owns; this record never holds sick-note health data). Daily GDPR consent gate is an access precondition (Consent-owned). Data-minimization is not actively pruned, but every collected field keeps a stated legal basis (CRR §24–§27, §30, §33; PDD §5.4, §5.7).

**Performance budgets/workload:** no explicit SLO is defined in the authoritative documents. Design intent: profile-and-history composition and skill/blocklist reads scale as hotels grow (search/filter by hotel; CRR §11, §21). Concrete budgets are deferred to implementation and are not asserted here (labelled unknown, Constitution §6).

**Observability/audit:** every important employee-record action logged immutably via the existing audit framework; blocklist actions logged with reason; lifecycle transitions logged; each special-category access logged individually; audit retained 5 years; **no admin-facing log-viewer screen** (CRR §30).

## Rollout and Compatibility

This module is part of the marketplace → Workforce Operations Platform forward refactor (pre-launch; no production employee data, so no dual-run migration; PDD §10). Sequence: foundation realignment (Regional Manager role + scope, response-envelope centralization, removal of `WorkApplication`, repurposing the retained record as the employment record) precedes the compliance/onboarding work that produces the employee lifecycle signals (PDD §10 Phases 1 and 3; roadmap M1 and M4).

**Feature flags:** each new capability sits behind the existing `FEATURE_*` env-flag convention so partial deploys are safe (PDD §10).

**Backward compatibility:** the only breaking change in the wider pivot is removing `WorkApplication`, done in Phase 1 before any client depends on it; the employment record repurposing is non-destructive. Removing (deactivating) a worker never destroys operational history (soft delete; CRR §30; PDD §9.1).

**Rollback:** because phases are additive and pre-launch, rollback is disabling the feature flag and redeploying the prior build (PDD §10). **[G4 FIND-03, cross-reference]** This module's own rollback is safe only while `checkHotelAccess()` remains the live hotel-scoping branch; `ADR-022`'s authorization migration plan requires strict ordering (role×scope JWT must be live before the `HotelWorker`-membership branch is removed), and any future rollback of an `ADR-022`-dependent EMP capability must not reverse that ordering out of sequence.

**Removal criteria:** not applicable — this is a foundational, permanently-owned domain module.

## Validation Plan

| Criterion | Test level/check | Environment/data | Evidence required |
|---|---|---|---|
| One record per employee; core fields present; no Department/employment-type field (`REQ-EMP-001`) | Unit + schema check | Seed employees | Record/link assertions; field-absence check |
| Only confirmed lifecycle transitions occur; no Suspended/auto-transition (`REQ-EMP-002`) | Unit (state machine) | Seed lifecycle fixtures | Transition table coverage incl. negative cases |
| Skill tags constrained to the fixed set with correct assessment basis (`REQ-EMP-003`) | Unit + boundary | Valid + invalid tags | Accept/reject evidence |
| Profile-and-history view aggregates correctly, excludes special-category, honors filters and role/scope visibility (`REQ-EMP-004`, `REQ-EMP-013`) | Integration + authorization | Multi-role, multi-hotel data | View contents + access-matrix results |
| Blocklist requires a reason; is audit-logged; readable by assignment (`REQ-EMP-005`) | Unit + integration | Hotel/worker pairs | Missing-reason rejection; audit entry; read result |
| Bulk import routes through hire-approval identically to manual (`REQ-EMP-006`) | Integration | CSV fixtures (valid rows) | Both paths reach Active; imported start Pending |
| Special-category visibility restricted; each access audit-logged (`REQ-EMP-007`) | Authorization + audit | Restricted vs. general roles | Deny-and-log for unauthorized; per-access entries |
| Retention-tier classification correct for each field (`REQ-EMP-008`) | Unit (classification) | Field catalog | Tier mapping table verified |
| Subject-rights export returns owned fields with legal basis (`REQ-EMP-009`) | Integration | Employee with full data | Export contents + legal-basis presence |
| Audit immutability, 5-year retention config, no admin viewer (`REQ-EMP-010`) | Integration + config check | Audit fixtures | Immutability + retention config; absence of viewer route |
| Personalfragebogen data stored; Teilzeit/Minijob inert (`REQ-EMP-011`) | Unit | Onboarding-sourced record | Stored values; no logic on employment type |
| Availability reflects today only from confirmed inputs (`REQ-EMP-014`) | Unit (once owner resolved) | Assigned + sick/vacation cases | Today-only behaviour; **blocked on OD-EMP-07** |

## Risks, Assumptions, and Open Decisions

| ID | Type | Description | Evidence/impact | Owner | Resolution/status |
|---|---|---|---|---|---|
| `OD-EMP-01` | Resolved | Probation legal shape | 1-year fixed-term, 6-month probation, hand-signed; probation stays a manual manager marking | Client | **Resolved** (CRR §9) — recorded, not blocking |
| `OD-EMP-02` | Resolved | Contract expiry length | 1yr initial, +1yr extension, permanent after 2yr | Client | **Resolved** (CRR §9) |
| `OD-EMP-03` | Resolved | Hotel-creation permission | Admin/HQ only | Client | **Resolved** (CRR §11) |
| `OD-EMP-04` | Open decision | Offboarding/termination + re-engagement workflow undefined. **RESOLVED (Option (c), hybrid) `GD-15`/`ADR-045`, 2026-07-28:** contract-lapse offboarding is automatic (in-process call from HR's `OD-HR-03` lapse trigger, `ADR-040`); all other offboarding causes remain Admin-manual. Re-engagement is a new `EmploymentRecord` for the existing `Worker`, not reactivation — prior employment history stays intact. | Soft-delete retained but no triggering workflow (PDD §9.1; CRR §30) | Product/Human | **RESOLVED — hybrid trigger (automatic for contract-lapse, manual otherwise); re-engagement via new `EmploymentRecord`, `ADR-045`** |
| `OD-EMP-05` | Resolved | Hotel-Group association mechanism | **RESOLVED by `ADR-023`** (Accepted, ratified by merge of PR #170, 2026-07-20). `HotelGroup` is a first-class entity owned by `backend-crm`; the employment record's `hotel_group_id` field (Owned state) is the worker-side mechanism, set at hire-approval from the approving manager's group. Also resolves the Security-review escalation (`FIND-001`, High) against this module's deny-by-default scoping — see Trust boundaries/authorization. Physical build (schema, JWT-scope authz) remains gated on `ADR-022`'s prerequisite sequencing. | Architecture/Human | **Resolved** (`ADR-023`) — recorded, not blocking; implementation remains a release/`ADR-022`-migration prerequisite |
| `OD-EMP-06` | Open decision | Staff self-edit after onboarding. **RESOLVED (Option (b)) `GD-15`/`ADR-046`, 2026-07-28 — recorded as a platform-wide boundary, not module-specific:** workers may self-edit only personal contact/preference fields — phone, email (if supported), preferred language, profile photo, emergency contact details, notification preferences. Every other field (employment, HR, scheduling, skills, job title, contract, payroll, role, organizational) remains Manager/Admin-controlled, platform-wide. | Only signup-time self-entry confirmed (CRR §6) | Product/Human | **RESOLVED — narrow self-edit allow-list (contact/preference fields only), platform-wide boundary, `ADR-046`** |
| `OD-EMP-07` | Open decision | Availability-indicator ownership/derivation | Indicator confirmed; no owning module named; Employee/Calendar/Job Dispatch all plausible (CRR §20) | Architecture/Human | Open — resolve once Calendar + Job Dispatch specs freeze; `REQ-EMP-014` validation blocked until then |
| `OD-EMP-08` | Open decision (permission-holder facet **RESOLVED by `ADR-030`**; invalid-row/duplicate-handling facet **RESOLVED by `ADR-047`**) | Bulk-import row handling + permission holder | Invalid-row/duplicate handling and importing roles beyond Admin unspecified (CRR §4). **[G4 Security FIND-004 / Performance PERF-EMP-003]** Resolution must additionally fix a max CSV size/row-count workload assumption, per-row failure isolation (a failing row must not corrupt/block others), and duplicate semantics that do not silently overwrite an existing employee's Personalfragebogen data. **Permission-holder facet resolved by `ADR-030`** (Accepted, 2026-07-25, §8): creation/bulk-import stays **Admin-only** (`employees:write`, C-15, MASTER); manager/Regional-Manager employee authority is **action-only, never field-level** (D-4b) and confers no importing right. The three ratified action-only transitions belong to unbuilt `backend-onboarding` (F-1) or `backend-hr`'s unbuilt route (F-2) — not delivered by this ADR. **Invalid-row/duplicate-handling facet RESOLVED (Option (b)) `GD-15`/`ADR-047`, 2026-07-28:** per-row isolation — valid rows import, invalid rows are skipped and reported in a per-row error summary (row number, reason); a duplicate row (matched by an existing worker identifier) is **always skipped and reported, never silently overwritten or merged**. No whole-file-atomic failure mode; no update-mode in this resolution. | Product/Human | **RESOLVED — both facets: permission-holder (`ADR-030`) and invalid-row/duplicate-handling, per-row isolation with duplicates always skipped (`ADR-047`)** |
| `OD-EMP-09` | **RESOLVED (`GD-12`/`ADR-032`, 2026-07-28)** | Formal domain-event / interface contract | Transport convention set: direct in-process call for synchronous effects; the existing Outbox for asynchronous/durable effects; no generic event bus. Each `EVT-EMP-*`/`IF-EMP-*` row's specific mechanism assignment remains pending until its producer/consumer is actually built (PDD §5.5) | Architecture/Human | **RESOLVED — transport convention set (`ADR-032`); per-event mechanism assignment remains ordinary implementation, deferred to build time** |
| `OD-EMP-10` | Open decision | Docs↔code module-id mapping | Registry records no spec maps to a registered id; `backend-hr` is the plausible code home but is a stub | Human (SYNC-001) | Open — proposed delta below, not asserted |
| `OD-EMP-11` | Assumption/Note | Authoritative-doc location discrepancy | Governing instruction cites `docs/01-product/requirements/`; files exist under `docs/00-foundations/` | Docs owner | Note — read from actual location; no behavioural impact |
| `OD-EMP-12` | Open decision | Org-chart / reporting-relationship model. **RESOLVED `GD-03`/`ADR-060`, 2026-07-29:** flat, hotel-scoped — no explicit `reports_to` FK or reporting-tree data model. Org-chart visibility (RM+Admin, already confirmed) is derived implicitly from existing hotel/hotel-group scope membership (`ADR-023`/`ADR-030`'s discriminated JWT `scope` claim), not a new hierarchy concept. Explicit reporting chains/approval hierarchies/escalations remain deferred until a confirmed business requirement needs one. | Visibility (RM+Admin) confirmed; underlying reporting model undefined (CRR §1). **[G4 PERF-EMP-004, Low — RESOLVED by `ADR-060`]** Query complexity is bounded by hotel/hotel-group membership cardinality, the same basis as every other scope-filtered query (`ADR-035`); no separate performance decision required. | Product/Human | **RESOLVED — flat hotel-scoped, no reporting tree, `ADR-060`** |
| `OD-EMP-13` | Open decision | Job Title value domain. **RESOLVED (Option (a)) `GD-15`/`ADR-048`, 2026-07-28:** controlled list, implemented as an Admin-managed lookup table (not a hard-coded enum). Admin may add or retire values without a deployment. An existing value referenced by any record is never deleted — retirement is via an `is_active` (or equivalent) flag: a retired value stays valid for historical records, is excluded from future assignment. | Field confirmed; free-text vs. controlled list unspecified (CRR §4) | Product/Human | **RESOLVED — Admin-managed lookup table, retire-not-delete, `ADR-048`** |
| `OD-EMP-14` | Open decision | Skill-set governance. **RESOLVED (Option (a)) `GD-15`/`ADR-048`, 2026-07-28:** same pattern as `OD-EMP-13` — Admin-managed lookup table, add/retire without deployment, retire-not-delete via `is_active` (or equivalent), historical assignments remain intact. | Tag set and bases fixed; whether administratively editable unspecified (CRR §4) | Product/Human | **RESOLVED — Admin-managed lookup table, retire-not-delete, `ADR-048`** |
| `OD-EMP-15` | Assumption | Owner unassigned | No `CODEOWNERS`; empty package author (SYNC-001) | Human | Open — freeze requires a named owner/approver |
| `OD-EMP-16` | Open decision | No performance budget defined. **RESOLVED `GD-11`/`ADR-035`, 2026-07-28** (documentation-synchronization correction applied here, discovered during `GD-15`'s audit — this row was never updated when `ADR-035` was ratified): platform workload baseline set (~100 hotels, ~5,000 workers, ~300 concurrent users); `IF-EMP-*` interfaces classify per query-class p95 targets (simple reads ≤150ms, scoped lists ≤400ms, cross-module aggregation ≤800ms). | **[G4 PERF-EMP-001, High]** No SLO/latency/throughput/workload-cardinality budget exists anywhere in CRR/PDD or this document for any `IF-EMP-*` interface; deferred to implementation with no provisional figure. | Architecture/Human | **RESOLVED — SLO baseline set, `ADR-035`** |

## Proposed Knowledge Deltas

- **`MODULE_REGISTRY.yaml`:** on freeze, set `specification` for the employee-management domain module to `SPEC-EMP-001`. Record the **proposed** docs↔code mapping employee-management ↔ `backend-hr` as an open item (OD-EMP-10); do **not** flip `backend-hr` away from its verified `stub`/`UNKNOWN` state without human confirmation (SYNC-001).
- **`DEPENDENCY_GRAPH.yaml`:** on freeze, add the candidate consumer edges declared here — Job Dispatch → employee-management (`reads-state`: skills, blocklist), Onboarding → employee-management (`writes-state`/signal: lifecycle), Compliance → employee-management (subject-rights read) — marked `compatibility: conditional` until interface schemas resolve (OD-EMP-09). **(G4 DEP-EMP-003)** Additionally add the `ADR-022` state-ownership handover edge — `backend-hotel-workers` → `backend-hr` for `state-hotel-worker` (`compatibility: conditional`, gated on the role×scope JWT build now that `OD-EMP-05` is decided) — and enumerate its five current direct readers (`backend-work-requests`, `backend-work-applications`, `backend-assignments`, `backend-users`, `backend-analytics`) as consumers requiring synchronized repointing to this module's interfaces once the migration executes. **(`ADR-023`, added this revision)** Add the target `employment-record reads-state HotelGroup` edge (`backend-crm`-owned, `compatibility: conditional` until the entity is built).
- **`TERMINOLOGY.md`:** promote, on human confirmation, canonical terms **Employee (permanent Staff/Worker)**, **Employment record**, **Skill tag / Assessment basis**, **Profile-and-history view**, **Availability indicator**, **Blocklist entry**, **Personalfragebogen**, **Konfession (special-category)**, **Hotel Group**; note that documentation module name *employee-management* must not be silently normalized to code module `backend-hr`.
- **`DECISION_INDEX.md`:** register the open architecture decisions OD-EMP-04, OD-EMP-07, OD-EMP-10, OD-EMP-12, OD-EMP-16 (new, G4 Performance PERF-EMP-001) as pending decision records. `OD-EMP-05` is RESOLVED (`ADR-023`) and `OD-EMP-09` is RESOLVED (`ADR-032`, 2026-07-28) — both move out of the pending list.
- **`SYNC_STATE.yaml`:** record this spec as `REVIEW` pending G4 independent reviews and G2 human approval; owner assignment remains blocked (SYNC-001).


## Status Addendum — Re-onboarding (2026-08-23, recorded not versioned)

Recorded per the append-only correction convention. The re-onboarding path shipped in PRs #468/#469
(2026-08-16) with no specification coverage; no requirement, rule, or open-decision id is renumbered
or restated here.

**What it is.** A worker who was deactivated (a *pause*, not a termination — `EmploymentStatus` is
permanent and non-terminal since the 2026-08-06 lifecycle rework) can be brought back without
repeating the full onboarding document gate, provided their contract situation warrants it.

**The mechanism is `employment_cycle`, and it is load-bearing.** Both return paths bump it:

| Transition | Path |
|---|---|
| `DELETED → PENDING` | full rehire, via `restore()` |
| `DEACTIVATED → PENDING` | re-onboarding after a pause whose contract no longer stands, via `triggerReonboarding()` |

`employment_cycle > 1` is what drives **both** `submitForReview()`'s document-gate skip and the
review queue's "reonboarding" labelling — a `PENDING` row's `employment_cycle` marks the start of
that cycle.

**RULE-EMP-REONB-01.** Every transition into `PENDING` from either return path MUST increment
`employment_cycle`. An earlier implementation omitted `DEACTIVATED → PENDING` from the increment,
which silently forced re-onboarding workers back through the very document-completeness gate the
feature exists to skip — `isReonboarding` read `employment_cycle === 1` for them. The defect was
invisible from the outside: the flow worked, it was merely wrong.

Evidence: `employee-management/service.ts:528-546` (the `isNewCycle` guard and its rationale);
`hr/service.ts:183-192` (the single definition of "this contract still stands", exported so the
approve/rehire gate and the re-onboarding path cannot drift), `hr/service.ts:300` (a returning
worker is issued a **new** default contract).

**Related, not owned here.** Contract standing is `backend-hr`'s (`ADR-012`); the nav lockout and
capability pin that accompany re-onboarding are client behaviour (`SPEC-FRONTEND-001`,
`SPEC-MOBILE-001`). The hierarchical approval that gates the return is `ADR-065`.

**Open.** No E2E scenario covers re-onboarding — recorded as a gap in
`docs/10-testing/e2e/README.md`.

## Review and Change Log

| Version | Date | Change | Findings resolved | Approver |
|---|---|---|---|---|
| 0.1.0 | 2026-07-05 | Initial canonical-template authoring from CRR/PDD; supersedes the prior free-form business specification at this path (rev `7c71498`). Freeze candidate submitted for G4 independent review (architecture, dependency, consistency) and G2 human approval. Author cannot self-approve blocking findings (Constitution §12); **FROZEN status is withheld pending human approval and disposition of open decisions OD-EMP-04..15.** | — (none dispositioned yet) | — (pending) |
| 0.1.1 | 2026-07-15 | Fast Documentation Workflow (Package B, `AUDIT-REPO-2026-07-14` `AUDIT-L4`): the Out of Scope list's payslip-request bullet and the Dependencies table's "Payslips" row both named "Payslips module" as if it were a standalone owning module, contradicting `ADR-014` (Accepted, 2026-07-13; `docs/03-modules/hr/MODULE_SPEC.md`'s `SIR-GLOB-017`-resolving precedent), which settled `backend-hr`/`SPEC-HR-001` as the payslip-request capability's canonical and exclusive owner with no standalone Payslips module. Corrected both references to attribute the capability to `backend-hr`/`SPEC-HR-001` per `ADR-014`, explicitly noting `docs/03-modules/payslips/` remains a non-owning placeholder; renamed the Dependencies table row from "Payslips" to "HR (Payslips, `ADR-014`)" for consistency with the sibling "Contracts"/"Documents" rows' referenced-elsewhere framing. No requirement/rule identifier renumbered, no open decision added or removed. Document Control bumped to `0.1.1`. Status remains as before this pass; G2 approval and OD-EMP-04..15 disposition remain pending. | AUDIT-L4 (`AUDIT-REPO-2026-07-14`). | — (pending; human approval unaffected by this correction) |
| 0.1.2 | 2026-07-20 | **Documentation Workflow: resolved every author-fixable finding from the completed 2026-07-20 G4 independent review round** (architecture `PASS_WITH_ACTIONS`, dependency `PASS_WITH_ACTIONS`, consistency `PASS_WITH_ACTIONS`, security `FAIL` 2 High, performance `PASS_WITH_ACTIONS`; evidence reused as-is, no review re-run). **Citations (`DEP-EMP-001`/`DEP-EMP-002`, Evidence table):** corrected the `MODULE_REGISTRY.yaml` line citation (was pointing at the unrelated `backend-attendance` block; now `:154-164`) and removed/replaced the stale "no frozen spec maps to any module id" claim (false at HEAD — several modules are FROZEN) with an accurate, current statement of `backend-hr`'s own `specification` pointer. **ADR-022 reciprocal statement (Architecture `FIND-01`, Consistency Finding 2):** added the required cross-reference — Evidence table row citing `ADR-022`'s Accepted status and its employment-record/authorization-migration consequences for this module. **State-ownership handover disclosure (Architecture `FIND-02`, High):** added a new Ownership-and-Boundaries paragraph naming the five current direct readers of `state-hotel-worker` (`backend-work-requests`, `backend-work-applications`, `backend-assignments`, `backend-users`, `backend-analytics`) and the `ADR-022` migration path that must repoint them. **Authorization-ordering cross-reference (Architecture `FIND-03`):** added to Rollout and Compatibility → Rollback, scoping this module's rollback safety to `ADR-022`'s strict JWT-before-membership-removal ordering. **Dependency-graph delta (`DEP-EMP-003`):** Proposed Knowledge Deltas' `DEPENDENCY_GRAPH.yaml` bullet extended with the `backend-hotel-workers` → `backend-hr` handover edge and its five affected consumers. **Security disclosures (`FIND-001` High, `FIND-002` High, `FIND-003` Medium):** added an explicit Trust-boundaries paragraph disclosing `checkHotelAccess()`'s admin/manager/checker scope bypass and its incompatibility with this module's own scoping requirement (cross-referenced to the now-escalated `OD-EMP-05`); strengthened `REQ-EMP-007`'s acceptance criteria with the separate-accessor/synchronous-audit/non-leakage-test requirement; added a blocklist-`reason` data-classification gap disclosure to Data classification/retention. **Performance disclosures (`PERF-EMP-001` High, `PERF-EMP-002` Medium, `PERF-EMP-003`/`PERF-EMP-004`):** added new open decision `OD-EMP-16` (no performance budget defined, non-blocking per the `OD-EMP-04..14` precedent); added a pagination/call-budget note to `REQ-EMP-004`; folded the bulk-import workload/duplicate-handling gap into `OD-EMP-08`'s description; added a cardinality forward-note to `OD-EMP-12`. **Not resolved by this pass — reserved human/architectural authority:** `OD-EMP-04..14` remain open as before (three now additionally cross-referenced/expanded, none newly blocking beyond `OD-EMP-05`'s existing acceptance-blocking status, now also disclosed as security-blocking); `OD-EMP-16` is new; owner assignment (`OD-EMP-15`/SYNC-001) unaffected. No requirement/rule/interface identifier renumbered. `DECISION_INDEX.md`'s pending-decision-record list for this spec and `.claude/governance/SPECIFICATION_ISSUES_REGISTER.md`'s `## Module: Employee Management` section synchronized in the same pass (new `SIR-EMP-014` for `OD-EMP-16`; `SIR-EMP-002` note extended for the Security-review escalation). Document Control bumped to `0.1.2`. Status remains `REVIEW`; **G2 freeze not performed and not requested by this pass** — Security `FAIL` (2 High) and the escalated `OD-EMP-05` remain open, human-authority items. | `DEP-EMP-001`, `DEP-EMP-002`, Architecture `FIND-01`/`FIND-02`/`FIND-03`, Consistency Finding 2, `DEP-EMP-003`, Security `FIND-001`/`FIND-002`/`FIND-003` (all recorded/disclosed, not code-resolved — see remaining human decisions), Performance `PERF-EMP-001`/`PERF-EMP-002`/`PERF-EMP-003`/`PERF-EMP-004`. | — (documentation-only pass; no human approval required for author-fixable disclosures; G2 freeze remains reserved human authority and is not granted here) |
| 0.1.3 | 2026-07-20 | **Documentation Workflow: consumed `ADR-023` (Accepted, ratified by merge of PR #170) to resolve `OD-EMP-05`.** Owned state gains the employment record's `hotel_group_id` field (foreign key to `backend-crm`'s `HotelGroup` entity, set at hire-approval). `REQ-EMP-012`'s acceptance criteria now name the concrete mechanism. Trust boundaries/authorization's `FIND-001` disclosure updated: the design gap is resolved by `ADR-023` (`HotelGroup` entity, RM/HM scope, discriminated JWT `scope` claim); physical build remains gated on `ADR-022`'s prerequisite sequencing. `OD-EMP-05` marked **Resolved**. Dependencies' Hotels row and Evidence table updated with an `ADR-023` citation (mirroring the `ADR-022` row). Proposed Knowledge Deltas' `DEPENDENCY_GRAPH.yaml`/`DECISION_INDEX.md` bullets updated to move `OD-EMP-05` out of the pending-decision list. No requirement/rule identifier renumbered. Immediately followed by a targeted Security re-verification (not a full G4 rerun) scoped only to `FIND-001`/`FIND-002`'s relationship to `ADR-023`: **Security upgraded `FAIL` → `PASS_WITH_ACTIONS`** — `FIND-001` downgraded to a disclosed G8 release/`ADR-022`-migration prerequisite (design gap closed by the ratified ADR); `FIND-002` (special-category controls, unimplemented) remains open but was already adequately and specifically disclosed in `REQ-EMP-007`'s acceptance criteria, so it does not independently block G2 either, per the identical `checkHotelAccess()`-bypass and absent-MFA precedent already established by `SPEC-ATT-001`/`SPEC-AUTH-001`. | `OD-EMP-05` (RESOLVED, `ADR-023`); Security `FIND-001` (downgraded to release prerequisite); Security `FIND-002` (recorded, adequately disclosed, non-blocking). | — (documentation-only pass; G2 freeze decision follows in the next row) |
| 0.2.0 | 2026-07-20 | **G2 Specification Freeze.** Frozen at G2 by the commissioning human (this session's explicit conditional authorization, contingent on the targeted Security re-verification passing — it returned `PASS_WITH_ACTIONS`), reusing the existing G4 evidence without reopening Architecture/Dependency/Consistency/Performance. No content change beyond Document Control (`Status` REVIEW→FROZEN, version 0.1.3→0.2.0, `Approved by / at` freeze record, reviewer-row Security disposition corrected from the stale `FAIL` to `PASS_WITH_ACTIONS`) and this row. Security's two High findings (`FIND-001`, `FIND-002`) are dispositioned as G8 release/implementation prerequisites, not freeze blockers — the identical pattern already used to freeze `SPEC-AUTH-001` (Critical + 4 High) and `SPEC-ATT-001` (1 High, same `checkHotelAccess()` finding class). Open decisions `OD-EMP-04/06/07(text-sync)/08/09/10/12/13/14/16` and owner assignment (`OD-EMP-15`/`SYNC-001`) remain implementation/release prerequisites reviewed by G8, consistent with every prior freeze in this repository. Knowledge synchronized in the same pass: `MODULE_REGISTRY.yaml`/`SPECIFICATION_INDEX.yaml` (→ `SPEC-EMP-001@0.2.0 (FROZEN)`), `MODULE_MEMORY.yaml` (`ART-MEM-backend-hr` produced), `SYNC_STATE.yaml`, and the Specification Issues Register. | G2 freeze — no new findings; carries forward v0.1.3 dispositions | Commissioning human (2026-07-20, G2, conditional on Security pass) |
| 0.2.0 (byproduct correction, recorded not versioned) | 2026-07-25 | Narrow correction applied as a byproduct of `ADR-030` §7 ratification (`OQ-030-A`, D-4b/D-4c) — not a standalone documentation pass, no version bump (nonsemantic correction, `LOOP_CONTROL.md` §7 exemption, mirroring the `SPEC-HR-001`/`SPEC-CALENDAR-001` `ADR-030` PR-1 correction precedent). Confirms, rather than changes: `OD-EMP-08` (bulk-import/creation permission holders) is unaffected — the owner's ratification governs employee-record *transitions*, a distinct question. Manager/Regional-Manager employee authority is ratified as **action-only, never field-level**: no employee field is manager-editable, and none may be introduced by inference from `employees:write`. The three ratified transitions (application approve/reject, probation suitability, signed-contract confirmation) are **not delivered by this module** — two belong to the unbuilt `backend-onboarding` module (this module's `IF-EMP-LifecycleSignal` remains the internal, admin-gated receiver only), and the third belongs to `backend-hr` once built (no ownership blocker; `ADR-012` already settles it). `EVT-EMP-ProfileUpdated` (`[OPEN]`) stays open — this ratification confirms it has no manager/RM-facing producer, not that one is now permitted. No requirement, rule, or interface identifier renumbered; no `OD-EMP-*` item newly opened or closed. | None resolved; `OD-EMP-08` confirmed unaffected; `EVT-EMP-ProfileUpdated` confirmed still open by design | — (byproduct correction; no new G4 round) |
| 0.2.1 (forward-note, recorded not versioned) — later superseded to 0.2.2 below | 2026-07-26 | **Forward-note per `ADR-030`** (Accepted, ratified 2026-07-25, session `claude/gd-02-manager-write-authority-b2g7rx` — PR-8 of its ratified rollout, §8 Compatibility). Where the 2026-07-25 byproduct correction above recorded `OD-EMP-08` as merely "unaffected," this note supersedes that framing with the actual `ADR-030` §8 disposition: `OD-EMP-08` **resolves** on its permission-holder facet — creation/bulk-import stays Admin-only; manager/RM employee authority is action-only, never field-level (D-4b); the three named actions belong to unbuilt `backend-onboarding` (F-1) or `backend-hr`'s unbuilt route (F-2), not delivered by this ADR. The invalid-row/duplicate-handling facet of `OD-EMP-08` is untouched and **remains open**. `EVT-EMP-ProfileUpdated` (`[OPEN]`) **stays open**, unchanged from the byproduct correction. **Drift artifact recorded (`ADR-030` §8, D-3-adjacent):** `EmploymentRecord.marked_suitable` exists in `schema.prisma` and its migration but is written by zero code paths, awaiting the CRR §10:163 capability `ADR-030` defers (F-1) — recorded as known dormancy at "State and Lifecycle" above, no action needed. Corrected in place at `OD-EMP-08` and "State and Lifecycle" above rather than left showing only the prior "unaffected" framing. No requirement, rule, or interface identifier renumbered; no G4 dimension re-run. No version bump — nonsemantic forward-note (`LOOP_CONTROL.md` §7 exemption), mirroring the `SPEC-QUAL-001`/`ADR-026` resolving-forward-note precedent. | `OD-EMP-08` permission-holder facet — resolved by `ADR-030`; `EVT-EMP-ProfileUpdated` — confirmed still open; `EmploymentRecord.marked_suitable` — recorded as known dormancy. | — (nonsemantic annotation; no approver action required; FROZEN status unaffected). |
| 0.2.2 | 2026-07-28 | **Amended (Correction), per `GD-12`/`ADR-032`** (Platform event-bus / inter-module transport, Decided via the Governance Resolution workflow). `OD-EMP-09` (formal domain-event/interface contract) marked RESOLVED at the transport-convention level: direct in-process call for synchronous effects, the existing Outbox for asynchronous/durable effects, no generic event bus. No `EVT-EMP-*` producer/consumer is built yet, so which specific mechanism each event uses remains deferred to that event's own build time — this amendment removes the platform-level blocker only, per the same disposition as `SPEC-CALENDAR-001`'s identical `GD-12` amendment. `DECISION_INDEX.md`'s pending-decision-record list updated to drop `OD-EMP-09` (resolved) alongside the already-resolved `OD-EMP-05`. No other requirement, rule, interface, or open decision touched. FROZEN status retained. | `OD-EMP-09` RESOLVED (`ADR-032`) | Commissioning human (2026-07-28, Governance Resolution workflow, Decision #1 of the current sequence) |
| 0.2.3 | 2026-07-28 | **`GD-15` sub-decision 7 of 10, per `ADR-045`** (Offboarding/re-engagement workflow, Decided via the Governance Resolution workflow, Option (c) hybrid, with the clarification that re-engagement creates a new record). `OD-EMP-04` resolved: contract-lapse-caused offboarding (per `SPEC-HR-001`'s `OD-HR-03`/`ADR-040`) triggers `Active → Deactivated` automatically via a direct in-process call from `backend-hr` (`ADR-032`'s transport convention); every other offboarding cause (resignation, termination for cause) remains Admin-initiated manually, since no upstream event exists for those causes. Re-engagement creates a **new `EmploymentRecord`** for the existing `Worker`, not a reactivation of the closed record — prior employment history/audit trail stays intact. `Active → Deactivated` transition description updated accordingly. No code changes. Three `GD-15` sub-decisions remain open (`OD-EMP-06/08/13/14`). | `OD-EMP-04` RESOLVED (`ADR-045`) | Commissioning human (2026-07-28, Governance Resolution workflow, `GD-15` sub-decision 7/10) |
| 0.2.4 | 2026-07-28 | **`GD-15` sub-decision 8 of 10, per `ADR-046`** (Worker self-edit boundary, Decided via the Governance Resolution workflow, Option (b), explicit allow-list, recorded platform-wide rather than module-specific per the commissioning human's explicit instruction). `OD-EMP-06` resolved: workers may self-edit only personal contact/preference fields — phone, email (if supported), preferred language, profile photo, emergency contact details, notification preferences. Every other field category (employment, HR, scheduling, skills, job title, contract, payroll, role, organizational) remains Manager/Admin-controlled, **platform-wide**, not limited to this module — any future module touching worker-owned fields must cite `ADR-046` rather than re-deciding this boundary. No code changes. Two `GD-15` sub-decisions remain open (`OD-EMP-08/13/14`). | `OD-EMP-06` RESOLVED (`ADR-046`) | Commissioning human (2026-07-28, Governance Resolution workflow, `GD-15` sub-decision 8/10) |
| 0.2.5 | 2026-07-28 | **`GD-15` sub-decision 9 of 10, per `ADR-047`** (Bulk-CSV invalid-row/duplicate handling, Decided via the Governance Resolution workflow, Option (b)). `OD-EMP-08`'s remaining invalid-row/duplicate-handling facet resolved: per-row isolation — valid rows import, invalid rows are skipped and reported in a per-row error summary; a duplicate row (matched by an existing worker identifier) is always skipped and reported, **never silently overwritten or merged**, directly closing the Personalfragebogen-data-loss risk this item's own text named. No whole-file-atomic failure mode; no bulk-update-of-existing-records mode in this resolution (explicitly deferred as its own future decision if needed). `OD-EMP-08` is now fully resolved on both facets (permission-holder via `ADR-030`; invalid-row/duplicate-handling via `ADR-047`). No code changes. One `GD-15` sub-decision remains open (`OD-EMP-13/14`). | `OD-EMP-08` RESOLVED (`ADR-047`) | Commissioning human (2026-07-28, Governance Resolution workflow, `GD-15` sub-decision 9/10) |
| 0.2.6 | 2026-07-28 | **`GD-15` sub-decision 10 of 10 (FINAL), per `ADR-048`** (Job Title & skill-tag governance, Decided via the Governance Resolution workflow, Option (a) for both, with an explicit retire-not-delete requirement). `OD-EMP-13` and `OD-EMP-14` both resolved with the identical pattern: Admin-managed lookup table (not a hard-coded enum) for each field; Admin may add or retire values without a deployment; an existing value referenced by any record is never deleted — retirement is via an `is_active` (or equivalent) flag, preserving historical-record integrity while excluding the retired value from future assignment. **`GD-15` (HR & Employee-Management module build scope) is now fully resolved — all ten sub-decisions closed:** `OD-HR-02` (`ADR-039`), `OD-HR-03`/`07` (`ADR-040`), `OD-HR-09` (`ADR-041`), `OD-HR-10` (`ADR-042`), `OD-HR-13` (`ADR-043`), `OD-HR-14` (`ADR-044`), `OD-EMP-04` (`ADR-045`), `OD-EMP-06` (`ADR-046`), `OD-EMP-08` (`ADR-047`), `OD-EMP-13`/`14` (`ADR-048`). No code changes. | `OD-EMP-13`, `OD-EMP-14` RESOLVED (`ADR-048`); `GD-15` fully resolved | Commissioning human (2026-07-28, Governance Resolution workflow, `GD-15` sub-decision 10/10, FINAL) |
| 0.2.7 | 2026-07-29 | **`GD-03` org-chart/reporting-model half, per `ADR-060`** (Decided via the Governance Resolution workflow, ratifying the commissioning human's explicit verbatim disposition). `OD-EMP-12` resolved: flat, hotel-scoped — no explicit `reports_to_user_id` FK or reporting-tree data model is introduced. Org-chart visibility (RM+Admin, already confirmed by `REQ-EMP-013`) is derived implicitly from existing hotel/hotel-group scope membership, reusing `ADR-023`/`ADR-030`'s already-established discriminated JWT `scope` claim rather than introducing a new authorization primitive. Job Dispatch's manager-assignment routing is built against hotel/hotel-group membership, not an org-chart tree. Explicit reporting chains/approval hierarchies/escalations remain deferred until a confirmed business requirement needs one — not invented here (Constitution §12). `PERF-EMP-004` resolves at the design level: query complexity is bounded by hotel/hotel-group cardinality, the same basis as every other scope-filtered query (`ADR-035`); no separate performance decision required. **`GD-03` (5-role model & Regional-Manager authority) is now fully resolved** — its permission-set half was already decided by `ADR-030` D-5 (2026-07-25); this record closes the data-model half `ADR-030` §7/§8 explicitly left open. This is also the named architectural eligibility gate `ADR-058` set for Job-Dispatch (`GD-20`/Epic 9): Job-Dispatch implementation is now architecturally eligible (scheduling/planning remains a distinct future pass, per `ADR-058` §4, not authorized here). `SPEC-AUTH-001`'s `OQ-AUTH-08` data-model half resolves identically (same underlying fact, not a separate decision). No code changes. | `OD-EMP-12` RESOLVED (`ADR-060`); `GD-03` fully resolved | Commissioning human (2026-07-29, Governance Resolution workflow) |
| 0.2.8 | 2026-08-07 | **Amended (Additive), person-centric assignment redesign.** Adds `EmploymentRecord.primary_hotel_id` (nullable FK to `Hotel`, `ON DELETE SET NULL`; migration `20260807000000_employment_primary_hotel`) — a worker's/checker's primary/home hotel, assigned from that person's own page via `PUT /users/:id/role`. **This is display and default-selection ONLY and is explicitly NOT an eligibility field.** `REQ-EMP-012` ("assignable only within their Hotel Group") is UNCHANGED and remains the sole eligibility rule: scheduling, roster, and blocklist decisions continue to resolve group-grain through `EmploymentRecord.hotel_group_id` via `lib/roster-scope.ts`, which must never read `primary_hotel_id`. A worker may still be scheduled at any hotel in their group regardless of this value — the two concepts are deliberately separate: **hotel group determines where a worker may work; primary hotel records where they normally belong.** Additive and nullable, so every pre-existing row is valid unchanged (`NULL` = no primary hotel selected). | Backend suite 103/103 suites, 2253/2253 tests; `tsc --noEmit` clean; `eslint` clean; `next build` succeeds | — (additive implementation change; `REQ-EMP-012` untouched, so no re-freeze required) |
| 0.2.8 (forward-note, recorded not versioned) | 2026-08-23 | **Status Addendum — Re-onboarding.** Records the re-onboarding path shipped in PRs #468/#469 with no specification coverage: the employment_cycle mechanism, both transitions that must increment it, and RULE-EMP-REONB-01 with the defect that motivated it (omitting DEACTIVATED -> PENDING silently forced re-onboarding workers back through the document gate the feature exists to skip). Documentation-accuracy addition only. | — (no findings) | — (recorded, not a versioned amendment) |
