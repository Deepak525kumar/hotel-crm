# Module Specification: `employee-management`

## Document Control

| Field | Value |
|---|---|
| Spec ID / version | `SPEC-EMP-001 / 0.1.3` |
| Status | `REVIEW` (freeze candidate; G2 Specification-Freeze pending — see Review and Change Log) |
| Owner | `unassigned` — reserved human authority (SYNC-001); no `CODEOWNERS` exists and `backend/package.json` author is empty |
| Authors / reviewers | Author: Module Author (documentation workflow). Independent reviewers (2026-07-20 G4 round): Architecture `PASS_WITH_ACTIONS`, Dependency `PASS_WITH_ACTIONS`, Consistency `PASS_WITH_ACTIONS`, Performance `PASS_WITH_ACTIONS`, Security **`FAIL`** (2 High, blocking G2 — see Review and Change Log). |
| Repository revision | `1796c370ec2639ea801f8f057a15918b8cbd41fc` (`1796c37`) |
| Approved by / at | — (G2 freeze requires the named human approver; not yet approved) |
| Supersedes | Prior non-canonical *Employee Management Module — Business Specification* at this path, revision `7c71498` (retained as historical evidence in git history) |

> **Authoring note (not a normative section change).** This document is the canonical-template instance for the Employee Management module, authored per the [Documentation Workflow](../../../.claude/workflows/documentation.md) freeze sequence. It replaces the prior free-form business specification at this path with the fixed shape of [`MODULE_SPEC_TEMPLATE.md`](../../../.claude/templates/MODULE_SPEC_TEMPLATE.md); the template file itself is unmodified. Behaviour is derived **exclusively** from the two authoritative documents — `docs/00-foundations/CONFIRMED_REQUIREMENTS_REGISTER.md` (**CRR §n**) and `docs/00-foundations/PIVOT_DESIGN_DOCUMENT.md` (**PDD §n**) — plus the current worktree for repository facts. No behaviour is drawn from marketplace-era or `docs/legacy/**` sources.

## Purpose and Scope

**Outcome:** A single authoritative, legally compliant record of each **employee** (the Staff/Worker role) — identity linkage, core employment fields, lifecycle status, skills, and hotel blocklisting — exposed consistently to the rest of the Workforce Operations Platform, together with the unified profile-and-history view that serves as the platform's performance-review surface (CRR §4, §5; PDD §9.1).

**In scope:**

- Employee identity linkage to the platform account (account owned by Authentication/User Management; this module owns the employment-domain record and references the account) (CRR §1, §2; PDD §5.3).
- Core employment profile fields: Employee ID, Job Title, Start Date (CRR §4).
- Employee lifecycle status and its transitions: Inactive → Under Review → Active/Rejected → Deactivated, plus the manual "marked suitable" probation milestone (CRR §6–§10; PDD §9.1).
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
| `REQ-EMP-002` | Own the employee lifecycle status and permit only the confirmed transitions. | MUST | Status is one of {Inactive, Under Review, Active, Rejected, Deactivated}; every transition matches State and Lifecycle; no Suspended state and no rating/warning-driven automatic transition exist. | `RULE-EMP-02`, `RULE-EMP-03`, `RULE-EMP-12` |
| `REQ-EMP-003` | Hold each employee's skill tags, drawn only from the fixed set, with each tag's assessment basis available to consumers. | MUST | Skill tags accepted only from {Cleaner, Public Service, Kitchen Dishwasher, Waiter}; Cleaner carries rooms-cleaned basis, the others hours-worked; no certifications or expiry. | `RULE-EMP-04` |
| `REQ-EMP-004` | Compose and serve a single profile-and-history view (work history, task scores, rating history) with date and management filters, as the performance-review surface. | MUST | View aggregates referenced data owned elsewhere; date/management filters apply; no separate performance-review process exists; special-category fields never appear. **[G4 PERF-EMP-002, Medium]** This is a multi-module aggregation query with no stated pagination or cross-service call-budget limit; the eventual interface schema (`OD-EMP-09`) must specify a result-set/date-range bound and a maximum synchronous fan-out per request to avoid unbounded-fan-out risk as history depth and hotel count grow. | `RULE-EMP-08`, `RULE-EMP-09` |
| `REQ-EMP-005` | Maintain hotel blocklist entries, each requiring a logged reason. | MUST | A blocklist entry cannot be created without a reason; the entry and its reason are audit-logged; assignment consumers can read the block for a (hotel, employee). | `RULE-EMP-07` |
| `REQ-EMP-006` | Support bulk CSV import of staff, routing each created employee through the same hire-approval path as manual creation. | MUST | Imported employees start Inactive and enter the standard hire-approval flow; manual and bulk paths reach Active identically. | `RULE-EMP-10` |
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
| `RULE-EMP-02` | Onboarding completion criteria not yet satisfied | Record stays **Inactive**; cannot work | Completion criteria differ by nationality (owned by Onboarding/Documents) | This module observes; Onboarding owns criteria (CRR §4, §7, §8) |
| `RULE-EMP-03` | Onboarding signals completion → hire-approval decision | Status transitions Inactive → Under Review → Active or Rejected | Hire-approval mechanism (pool/claim) owned by Onboarding | This module owns resulting status (CRR §8, §10) |
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
- The employment record's `hotel_group_id` (`ADR-023`): the employee's Hotel Group association, a foreign key to the `HotelGroup` entity owned by `backend-crm`. Set at the `Under Review → Active` hire-approval transition (`RULE-EMP-03`) from the approving manager's own `hotel_group_id`; bounds assignability per `REQ-EMP-012`. Resolves `OD-EMP-05`.
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
| `IF-EMP-CreateEmployee / v0` | Inbound (command) | Account link + core fields (manual or bulk-import row) | Employee record in **Inactive** status | Validation failure; duplicate identity `[OPEN]` (OD-EMP-08) | Admin; other importing roles `[OPEN]` (OD-EMP-08) | New |
| `IF-EMP-GetProfileHistory / v0` | Inbound (query) | Employee id, optional date/management filters | Unified profile-and-history view (owned + referenced data), special-category fields excluded | Not found; scope denied | Self + roles above within scope (CRR §5) | New |
| `IF-EMP-GetSkills / v0` | Inbound (query) | Employee id (or skill filter) | Skill tags + assessment basis | Not found | Dispatch/manager scope | New |
| `IF-EMP-GetBlocklist / v0` | Inbound (query) | Hotel id and/or employee id | Blocklist entries with reasons | Scope denied | Manager scope / Job Dispatch | New |
| `IF-EMP-SetBlocklist / v0` | Inbound (command) | Hotel id, employee id, **reason (required)** | Blocklist entry (audit-logged) | Missing reason → rejected; scope denied | Hotel/Regional Manager, Admin | New |
| `IF-EMP-GetSpecialCategory / v0` | Inbound (query) | Employee id, field | Field value (each access audit-logged) | Denied + logged if lacking restricted permission | Restricted tier: Konfession → payslip processor + Admin; disability → Admin | New |
| `IF-EMP-ExportEmployeeData / v0` | Inbound (query, Compliance-initiated) | Employee id | Owned fields for subject-rights fulfilment | Not found | Compliance/Admin | New |
| `IF-EMP-Deactivate / v0` | Inbound (command) | Employee id | Record soft-deleted; history retained | Scope denied | Admin | New |
| `IF-EMP-LifecycleSignal / v0` | Inbound (event-driven) | Onboarding completion / approve / reject signal | Status transition (Under Review / Active / Rejected) | Out-of-order signal `[OPEN]` (OD-EMP-09) | Internal (Onboarding) | New |

## Events

> No formal event schema exists in the authoritative documents or codebase (no event bus is present — `.claude/knowledge/MODULE_REGISTRY.yaml` records `published_events: none-observed` for every module). The following are business-level domain events implied by owned state changes; the concrete event contract/transport is an open decision (OD-EMP-09).

| Event ID/version | Publisher | Trigger | Payload source | Consumers | Delivery/idempotency |
|---|---|---|---|---|---|
| `EVT-EMP-Created / v0` | employee-management | Record created (signup or bulk import; Inactive) | Core fields + account link | Onboarding, Notifications, Audit | `[OPEN]` (OD-EMP-09) |
| `EVT-EMP-SubmittedForReview / v0` | employee-management | Onboarding signals completion | Employee id | Notifications, Audit | `[OPEN]` |
| `EVT-EMP-Activated / v0` | employee-management | Hire-approval approved | Employee id | Job Dispatch, Calendar, Notifications, Audit | `[OPEN]` |
| `EVT-EMP-Rejected / v0` | employee-management | Hire-approval rejected | Employee id | Notifications, Audit | `[OPEN]` |
| `EVT-EMP-MarkedSuitable / v0` | employee-management | Manager confirms probation suitability | Employee id, manager | Audit | `[OPEN]` |
| `EVT-EMP-ProfileUpdated / v0` | employee-management | Core/personal field change | Changed fields | Audit | `[OPEN]` |
| `EVT-EMP-SkillsChanged / v0` | employee-management | Skill tags changed | Employee id, tags | Job Dispatch, Audit | `[OPEN]` |
| `EVT-EMP-Blocklisted / v0` | employee-management | Blocklist added/removed | Hotel, employee, reason | Job Dispatch, Audit | `[OPEN]` |
| `EVT-EMP-Deactivated / v0` | employee-management | Record soft-deleted | Employee id | Notifications, Audit | `[OPEN]` |

**Consumed events** (to keep profile/availability/history current; contract `[OPEN]`): Onboarding/Documents/Contracts — completion, contract signed, approve/reject → lifecycle transitions (CRR §8–§10); Job Dispatch — worker assigned for a day → history + availability input (CRR §12, §13, §20); Calendar — sick/vacation for a day → availability input (CRR §20, §22); Quality — new rating/score, warning thresholds crossed → profile view, display only (CRR §5, §15, §16); Attendance — clock-in/out recorded → work history (CRR §5, §17). An "availability changed" event is deliberately **not** claimed as published here (OD-EMP-07).

## Dependencies

| Dependency/edge | Reason | Contract | Compatibility | Failure behavior |
|---|---|---|---|---|
| Authentication / User Management | Account, role, scope, MFA, sessions link the employee | `auth-middleware`, RBAC/scope (reused) | compatible (reuse) | No auth → employee functions unavailable (access precondition) |
| Onboarding | Signals workflow completion and approve/reject; owns Personalfragebogen/chatbot/pool-claim | `IF-EMP-LifecycleSignal` (candidate) | conditional (schema `[OPEN]`) | No signal → record stays Inactive |
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

**States (employee-level, owned here):**

- **Inactive** — record exists (signup or bulk import); onboarding not complete; cannot work (CRR §4, §8).
- **Under Review** — onboarding complete; application in the manager pool, possibly claimed (CRR §10).
- **Active** — approved by a manager; may be scheduled and may accept broadcasts (CRR §10).
- **Rejected** — the manager rejected the application (CRR §10).
- **Deactivated (soft-deleted)** — retained for history/audit; no longer an operating employee (PDD §9.1).

**Transitions (each audit-logged; each arises from a confirmed event):**

- `(none) → Inactive` — record created at signup or via bulk import.
- `Inactive → Under Review` — Onboarding signals workflow completion.
- `Under Review → Active` — Onboarding approval decision.
- `Under Review → Rejected` — Onboarding rejection decision.
- `Active → Active (marked suitable)` — manager manually confirms probation suitability; **not** a distinct status and **not** automated. The resolved probation shape (1-year fixed-term contract, 6-month probation clause, hand-signed; permanent after 2 years) adds no separate status.
- `Active → Deactivated` — Admin-driven soft-deletion. **Triggering offboarding/termination and any re-engagement workflow are undefined in the authoritative documents (OD-EMP-04).**

**Invariants:** no Suspended state; no rating/warning-driven automatic transition out of Active (CRR §16); rating tiers (Elite/High/Standard/Low/Probation) are Quality-owned display labels, never lifecycle statuses (CRR §15); no account-lockout status (CRR §2).

**Concurrency:** hire-approval claim/lock concurrency is resolved entirely inside Onboarding; this module receives only the resulting decision. Same-day assignment vs. sick/vacation atomicity is owned by Calendar/Job Dispatch (a single transaction there prevents an employee appearing both assigned and on-leave; PDD §7.2).

**Retention/migration:** soft deletion preserves operational/audit history within retention horizons; field-level retention tiers (6 months / 5 years / 6 years) drive automatic deletion by the Retention module. The employment record is repurposed from the retained roster/`HotelWorker` record with no destructive migration (pre-launch, no production employee data; PDD §9.1, §10).

## Failure, Security, Privacy, and Performance

**Failure modes/recovery:**

- Activation attempted before Onboarding signals completion → blocked; record stays Inactive.
- Onboarding completion criteria unmet for a nationality (non-EU work permit missing) → cannot reach Active.
- Assignment attempted for a blocklisted worker at that hotel → not permitted (enforced by Job Dispatch using this module's blocklist).
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
| Account deletion (deactivation) | — | — | — | — | ✅ |

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
| Bulk import routes through hire-approval identically to manual (`REQ-EMP-006`) | Integration | CSV fixtures (valid rows) | Both paths reach Active; imported start Inactive |
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
| `OD-EMP-04` | Open decision | Offboarding/termination + re-engagement workflow undefined | Soft-delete retained but no triggering workflow (PDD §9.1; CRR §30) | Product/Human | Open — blocks Deactivated-transition acceptance |
| `OD-EMP-05` | Resolved | Hotel-Group association mechanism | **RESOLVED by `ADR-023`** (Accepted, ratified by merge of PR #170, 2026-07-20). `HotelGroup` is a first-class entity owned by `backend-crm`; the employment record's `hotel_group_id` field (Owned state) is the worker-side mechanism, set at hire-approval from the approving manager's group. Also resolves the Security-review escalation (`FIND-001`, High) against this module's deny-by-default scoping — see Trust boundaries/authorization. Physical build (schema, JWT-scope authz) remains gated on `ADR-022`'s prerequisite sequencing. | Architecture/Human | **Resolved** (`ADR-023`) — recorded, not blocking; implementation remains a release/`ADR-022`-migration prerequisite |
| `OD-EMP-06` | Open decision | Staff self-edit after onboarding | Only signup-time self-entry confirmed (CRR §6) | Product/Human | Open — affects permission matrix |
| `OD-EMP-07` | Open decision | Availability-indicator ownership/derivation | Indicator confirmed; no owning module named; Employee/Calendar/Job Dispatch all plausible (CRR §20) | Architecture/Human | Open — resolve once Calendar + Job Dispatch specs freeze; `REQ-EMP-014` validation blocked until then |
| `OD-EMP-08` | Open decision | Bulk-import row handling + permission holder | Invalid-row/duplicate handling and importing roles beyond Admin unspecified (CRR §4). **[G4 Security FIND-004 / Performance PERF-EMP-003]** Resolution must additionally fix a max CSV size/row-count workload assumption, per-row failure isolation (a failing row must not corrupt/block others), and duplicate semantics that do not silently overwrite an existing employee's Personalfragebogen data. | Product/Human | Open — affects `REQ-EMP-006`, permission matrix |
| `OD-EMP-09` | Open decision | Formal domain-event / interface contract | No event schema/transport enumerated; interfaces are candidate-level (PDD §5.5) | Architecture/Human | Open — affects Interfaces and Contracts, Events |
| `OD-EMP-10` | Open decision | Docs↔code module-id mapping | Registry records no spec maps to a registered id; `backend-hr` is the plausible code home but is a stub | Human (SYNC-001) | Open — proposed delta below, not asserted |
| `OD-EMP-11` | Assumption/Note | Authoritative-doc location discrepancy | Governing instruction cites `docs/01-product/requirements/`; files exist under `docs/00-foundations/` | Docs owner | Note — read from actual location; no behavioural impact |
| `OD-EMP-12` | Open decision | Org-chart / reporting-relationship model | Visibility (RM+Admin) confirmed; underlying reporting model undefined (CRR §1). **[G4 PERF-EMP-004, Low]** Query complexity for group-wide/org-chart reads scales with Hotel Group size and cannot be assessed until this model is defined; request the data model + expected group cardinality when resolving. | Product/Human | Open — affects `REQ-EMP-013` structure |
| `OD-EMP-13` | Open decision | Job Title value domain | Field confirmed; free-text vs. controlled list unspecified (CRR §4) | Product/Human | Open — affects `REQ-EMP-001` |
| `OD-EMP-14` | Open decision | Skill-set governance | Tag set and bases fixed; whether administratively editable unspecified (CRR §4) | Product/Human | Open — affects `REQ-EMP-003` |
| `OD-EMP-15` | Assumption | Owner unassigned | No `CODEOWNERS`; empty package author (SYNC-001) | Human | Open — freeze requires a named owner/approver |
| `OD-EMP-16` | Open decision | No performance budget defined | **[G4 PERF-EMP-001, High]** No SLO/latency/throughput/workload-cardinality budget exists anywhere in CRR/PDD or this document for any `IF-EMP-*` interface; deferred to implementation with no provisional figure. | Architecture/Human | Open — non-blocking for this spec revision if accepted as an explicit known risk (consistent with `OD-EMP-04..14`'s disposition); requires workload assumptions (target QPS, employee/hotel/group cardinality, acceptable p95/p99) before `backend-hr` implementation begins |

## Proposed Knowledge Deltas

- **`MODULE_REGISTRY.yaml`:** on freeze, set `specification` for the employee-management domain module to `SPEC-EMP-001`. Record the **proposed** docs↔code mapping employee-management ↔ `backend-hr` as an open item (OD-EMP-10); do **not** flip `backend-hr` away from its verified `stub`/`UNKNOWN` state without human confirmation (SYNC-001).
- **`DEPENDENCY_GRAPH.yaml`:** on freeze, add the candidate consumer edges declared here — Job Dispatch → employee-management (`reads-state`: skills, blocklist), Onboarding → employee-management (`writes-state`/signal: lifecycle), Compliance → employee-management (subject-rights read) — marked `compatibility: conditional` until interface schemas resolve (OD-EMP-09). **(G4 DEP-EMP-003)** Additionally add the `ADR-022` state-ownership handover edge — `backend-hotel-workers` → `backend-hr` for `state-hotel-worker` (`compatibility: conditional`, gated on the role×scope JWT build now that `OD-EMP-05` is decided) — and enumerate its five current direct readers (`backend-work-requests`, `backend-work-applications`, `backend-assignments`, `backend-users`, `backend-analytics`) as consumers requiring synchronized repointing to this module's interfaces once the migration executes. **(`ADR-023`, added this revision)** Add the target `employment-record reads-state HotelGroup` edge (`backend-crm`-owned, `compatibility: conditional` until the entity is built).
- **`TERMINOLOGY.md`:** promote, on human confirmation, canonical terms **Employee (permanent Staff/Worker)**, **Employment record**, **Skill tag / Assessment basis**, **Profile-and-history view**, **Availability indicator**, **Blocklist entry**, **Personalfragebogen**, **Konfession (special-category)**, **Hotel Group**; note that documentation module name *employee-management* must not be silently normalized to code module `backend-hr`.
- **`DECISION_INDEX.md`:** register the open architecture decisions OD-EMP-04, OD-EMP-07, OD-EMP-09, OD-EMP-10, OD-EMP-12, OD-EMP-16 (new, G4 Performance PERF-EMP-001) as pending decision records. `OD-EMP-05` is RESOLVED (`ADR-023`) and moves out of the pending list.
- **`SYNC_STATE.yaml`:** record this spec as `REVIEW` pending G4 independent reviews and G2 human approval; owner assignment remains blocked (SYNC-001).

## Review and Change Log

| Version | Date | Change | Findings resolved | Approver |
|---|---|---|---|---|
| 0.1.0 | 2026-07-05 | Initial canonical-template authoring from CRR/PDD; supersedes the prior free-form business specification at this path (rev `7c71498`). Freeze candidate submitted for G4 independent review (architecture, dependency, consistency) and G2 human approval. Author cannot self-approve blocking findings (Constitution §12); **FROZEN status is withheld pending human approval and disposition of open decisions OD-EMP-04..15.** | — (none dispositioned yet) | — (pending) |
| 0.1.1 | 2026-07-15 | Fast Documentation Workflow (Package B, `AUDIT-REPO-2026-07-14` `AUDIT-L4`): the Out of Scope list's payslip-request bullet and the Dependencies table's "Payslips" row both named "Payslips module" as if it were a standalone owning module, contradicting `ADR-014` (Accepted, 2026-07-13; `docs/03-modules/hr/MODULE_SPEC.md`'s `SIR-GLOB-017`-resolving precedent), which settled `backend-hr`/`SPEC-HR-001` as the payslip-request capability's canonical and exclusive owner with no standalone Payslips module. Corrected both references to attribute the capability to `backend-hr`/`SPEC-HR-001` per `ADR-014`, explicitly noting `docs/03-modules/payslips/` remains a non-owning placeholder; renamed the Dependencies table row from "Payslips" to "HR (Payslips, `ADR-014`)" for consistency with the sibling "Contracts"/"Documents" rows' referenced-elsewhere framing. No requirement/rule identifier renumbered, no open decision added or removed. Document Control bumped to `0.1.1`. Status remains as before this pass; G2 approval and OD-EMP-04..15 disposition remain pending. | AUDIT-L4 (`AUDIT-REPO-2026-07-14`). | — (pending; human approval unaffected by this correction) |
| 0.1.2 | 2026-07-20 | **Documentation Workflow: resolved every author-fixable finding from the completed 2026-07-20 G4 independent review round** (architecture `PASS_WITH_ACTIONS`, dependency `PASS_WITH_ACTIONS`, consistency `PASS_WITH_ACTIONS`, security `FAIL` 2 High, performance `PASS_WITH_ACTIONS`; evidence reused as-is, no review re-run). **Citations (`DEP-EMP-001`/`DEP-EMP-002`, Evidence table):** corrected the `MODULE_REGISTRY.yaml` line citation (was pointing at the unrelated `backend-attendance` block; now `:154-164`) and removed/replaced the stale "no frozen spec maps to any module id" claim (false at HEAD — several modules are FROZEN) with an accurate, current statement of `backend-hr`'s own `specification` pointer. **ADR-022 reciprocal statement (Architecture `FIND-01`, Consistency Finding 2):** added the required cross-reference — Evidence table row citing `ADR-022`'s Accepted status and its employment-record/authorization-migration consequences for this module. **State-ownership handover disclosure (Architecture `FIND-02`, High):** added a new Ownership-and-Boundaries paragraph naming the five current direct readers of `state-hotel-worker` (`backend-work-requests`, `backend-work-applications`, `backend-assignments`, `backend-users`, `backend-analytics`) and the `ADR-022` migration path that must repoint them. **Authorization-ordering cross-reference (Architecture `FIND-03`):** added to Rollout and Compatibility → Rollback, scoping this module's rollback safety to `ADR-022`'s strict JWT-before-membership-removal ordering. **Dependency-graph delta (`DEP-EMP-003`):** Proposed Knowledge Deltas' `DEPENDENCY_GRAPH.yaml` bullet extended with the `backend-hotel-workers` → `backend-hr` handover edge and its five affected consumers. **Security disclosures (`FIND-001` High, `FIND-002` High, `FIND-003` Medium):** added an explicit Trust-boundaries paragraph disclosing `checkHotelAccess()`'s admin/manager/checker scope bypass and its incompatibility with this module's own scoping requirement (cross-referenced to the now-escalated `OD-EMP-05`); strengthened `REQ-EMP-007`'s acceptance criteria with the separate-accessor/synchronous-audit/non-leakage-test requirement; added a blocklist-`reason` data-classification gap disclosure to Data classification/retention. **Performance disclosures (`PERF-EMP-001` High, `PERF-EMP-002` Medium, `PERF-EMP-003`/`PERF-EMP-004`):** added new open decision `OD-EMP-16` (no performance budget defined, non-blocking per the `OD-EMP-04..14` precedent); added a pagination/call-budget note to `REQ-EMP-004`; folded the bulk-import workload/duplicate-handling gap into `OD-EMP-08`'s description; added a cardinality forward-note to `OD-EMP-12`. **Not resolved by this pass — reserved human/architectural authority:** `OD-EMP-04..14` remain open as before (three now additionally cross-referenced/expanded, none newly blocking beyond `OD-EMP-05`'s existing acceptance-blocking status, now also disclosed as security-blocking); `OD-EMP-16` is new; owner assignment (`OD-EMP-15`/SYNC-001) unaffected. No requirement/rule/interface identifier renumbered. `DECISION_INDEX.md`'s pending-decision-record list for this spec and `.claude/governance/SPECIFICATION_ISSUES_REGISTER.md`'s `## Module: Employee Management` section synchronized in the same pass (new `SIR-EMP-014` for `OD-EMP-16`; `SIR-EMP-002` note extended for the Security-review escalation). Document Control bumped to `0.1.2`. Status remains `REVIEW`; **G2 freeze not performed and not requested by this pass** — Security `FAIL` (2 High) and the escalated `OD-EMP-05` remain open, human-authority items. | `DEP-EMP-001`, `DEP-EMP-002`, Architecture `FIND-01`/`FIND-02`/`FIND-03`, Consistency Finding 2, `DEP-EMP-003`, Security `FIND-001`/`FIND-002`/`FIND-003` (all recorded/disclosed, not code-resolved — see remaining human decisions), Performance `PERF-EMP-001`/`PERF-EMP-002`/`PERF-EMP-003`/`PERF-EMP-004`. | — (documentation-only pass; no human approval required for author-fixable disclosures; G2 freeze remains reserved human authority and is not granted here) |
