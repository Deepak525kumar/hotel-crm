# Module Specification: `job-dispatch` (backend-work-requests, backend-work-applications, backend-assignments)

> Specification of ONE bounded capability — job dispatch & assignment — spanning three
> backend modules. This capability is **MID-PIVOT**. It carries two labeled layers:
> `[CURRENT STATE]` — already-implemented marketplace apply/accept behavior, reverse-specified
> at code base revision `f37a39b`; and `[TARGET STATE]` — the confirmed two-tier
> calendar-direct-assignment + skill-based-broadcast model that is authoritative but
> largely unbuilt. `[MIGRATION GAP]` marks the delta between them. Every material claim
> is bound to source: current-state claims cite `path:line @f37a39b`; target-state claims
> cite the confirmed authorities `PIVOT_DESIGN_DOCUMENT.md` (PIVOT §x) and
> `CONFIRMED_REQUIREMENTS_REGISTER.md` (CONFIRMED §x). This document records behavior and
> confirmed contract; it does not create product policy. All human-authority decisions are
> carried as explicit open decisions and are NOT resolved here.

## Document Control

| Field | Value |
|---|---|
| Spec ID / version | `SPEC-JOB-DISPATCH-001 / 0.3.2` |
| Status | `FROZEN` |
| Owner | `unassigned (SYNC-001, human authority required; PIVOT §13 names "Owner: Mayank (Lead), Reviewers: Ritik (PM)" for the design doc — corroborating only, not a knowledge-layer encoding)` |
| Authors / reviewers | Author: Module Author agent. Reviewers (G4 complete, original v0.3.0): Architecture (BLOCKED — human), Dependency (PASS_WITH_ACTIONS), Consistency (PASS_WITH_ACTIONS), Security (FAIL — 1 Critical/2 High), Performance (PASS_WITH_ACTIONS). **Correction v0.3.1 (2026-07-19, `ADR-021`) affected-reviewer re-verification:** Dependency (`PASS_WITH_ACTIONS`, upgraded from a `SPEC-CALENDAR-001`-side `BLOCKED`, FIND-DEP-001/002/003 resolved), Architecture (`PASS_WITH_ACTIONS`, boundary internally consistent, no new ownership ambiguity), Consistency (targeted re-check of the correction's cross-module attribution, see Review and Change Log). |
| Repository revision | Code base described: `f37a39bf8535973366f5b1ccc4f2ccbaa3c60090` (`f37a39b`). Candidate reviewed/committed at `22569f0` (also `f74f039`) — identical working trees to `f37a39b` (FIND-ARCH-005, FIND-CONS-003). Branch `claude/spec-freeze-job-dispatch-fuyxmw`. |
| Approved by / at | FROZEN at G2 Specification Freeze on 2026-07-15 by the commissioning human via the G2 Approval Workflow. Per the approving decision, the specification is frozen independently of implementation security findings: the open security findings recorded against this module remain **implementation/release prerequisites** (must be fixed or re-reviewed before G8 Release Readiness), NOT specification-freeze blockers. No temporary Risk Assessment was created. Cross-cutting G2 blockers cleared by ADR-001..010 (ratified 2026-07-15) and the cross-owner accept-transaction coupling disposed as superseded-by-pivot by ADR-018 (Accepted, 2026-07-15), clearing the Architecture `BLOCKED`. Security posture: the Critical (`PATCH /assignments/:id` unguarded) + 2 High findings stay OPEN as release prerequisites (must be fixed before G8; the Critical warrants immediate remediation on a security timeline). **Amended (Correction, v0.3.0→0.3.1) 2026-07-19 by the commissioning human, per `ADR-021`** (Calendar↔Job-Dispatch scheduling-ownership boundary, Accepted 2026-07-19): the re-authored `SPEC-CALENDAR-001@0.2.0`'s G4 Dependency re-review found this frozen document's `CalendarEntry`/`TREQ-009`/`TRULE-008`/notification text contradicted `ADR-021`'s premise that Job Dispatch would be left "unchanged" (`FIND-DEP-001/002/003`). This correction narrowly reconciles exactly those three points — `CalendarEntry` scoped to the assignment kind only, the sick/vacation auto-cancel converted from an atomic single transaction to consumption of Calendar's `EVT-CAL-SickVacationMarked`, and the sick/vacation manager notification ceded to Calendar — and touches no other requirement, rule, security finding, or open decision. FROZEN status is retained (narrow reconciliation of an already-ratified boundary decision, not a re-opening of unresolved scope); Status stays `FROZEN` per the same G2 authority, extended by this session's explicit "amend the frozen spec" direction. **Amended (Correction, v0.3.1→0.3.2) 2026-07-27, per `GD-05`** (Per-hotel "pause new jobs" toggle, Decided): closes `SIR-CRM-016`/`OD-CRM-16` (architecture review `FIND-002`, `SPEC-CRM-001`), which required this module to acknowledge its dependency on `Hotel.accepting_jobs` before `OD-CRM-04` could be implemented. `WorkRequestService.create()` (`work-requests/service.ts`) reads `Hotel.accepting_jobs` (owned/written exclusively by `backend-crm`) and rejects creation with `ForbiddenError` when it is `false`, per `GD-05`'s ratified enforcement boundary. This is a read-only cross-module dependency, consistent with this module's existing pattern of reading `Hotel.deleted_at` at the same call site — no new write, no new ownership claim. See `REQ-040`/`RULE-008` (unaffected — this is an additional precondition to `create()`, not a change to the transition model) and the new `TREQ`/`TRULE` row below. No other requirement, rule, security finding, or open decision is touched. FROZEN status retained (narrow reconciliation, same precedent as this document's own v0.3.0→0.3.1 correction). |
| Supersedes | Supersedes `SPEC-JOB-DISPATCH-001 / 0.1.0`. First specification for these three modules (registry `specification: UNKNOWN` prior). |

## Purpose and Scope

**Outcome:** Define the contract for the hotel's job dispatch & assignment capability across
its full pivot arc. This is ONE bounded capability implemented by three backend modules; it
is specified as a single capability (the three modules are NOT split).

- `[CURRENT STATE]` (implemented @f37a39b): a **marketplace apply/accept** flow — a hotel
  publishes a shift (`WorkRequest`), rostered workers browse and **apply** (`WorkApplication`),
  a manager **accepts** an application which atomically creates a confirmed `WorkerAssignment`
  and an `EXPECTED` `Attendance` row, and the assignment is driven through its lifecycle.
- `[TARGET STATE]` (confirmed, largely unbuilt — PIVOT §4.4/§5.5, CONFIRMED §13/§34): a
  **two-tier direct-dispatch** model. PRIMARY = manager places workers on a calendar
  day-by-day (**direct assignment, no accept step**). FALLBACK = manager raises a standalone
  **broadcast `JobRequest`** (skill × headcount) to eligible workers (matching skill ∧ free
  that day); **first-accept wins**; slot exhaustion notifies losers "requirement fulfilled";
  a 6-hour timer or manual action closes the request. The marketplace `WorkApplication` step
  is **removed**.

**In scope:**
- `backend/src/modules/work-requests/` — `[CURRENT]` create, publish, list, get, patch, roster fan-out; `[TARGET]` repurposed as broadcast `JobRequest` (PIVOT §9.1).
- `backend/src/modules/work-applications/` — `[CURRENT]` apply, list, review (accept/reject/withdraw), 7-step accept transaction; `[TARGET]` module and model **removed** (PIVOT §9.2).
- `backend/src/modules/assignments/` — `[CURRENT]` list, get, lifecycle transitions; `[TARGET]` created directly from calendar or broadcast accept, mandatory `application_id` dropped (PIVOT §9.1).
- Data contract for `WorkRequest`, `WorkApplication`, `WorkerAssignment`, and the migration-level CHECK and partial unique index that back capacity/double-booking invariants; `[TARGET]` new `CalendarEntry` and `JobRequest` models (PIVOT §9.3) and the daily-exclusivity partial unique index (PIVOT §9.4).

**Out of scope:**
- `backend/src/modules/attendance/`, `.../quality/`, `.../notifications/` internals (referenced only as consumed/written state or delivery sink). `[TARGET]` geofence attendance (PIVOT §7.4) is a separate capability; assignment→attendance direction is unchanged.
- Onboarding, contracts, consent gate, retention sweeps, i18n (PIVOT §7.1/§7.6/§7.7, §10 Phases 3–4).
- Rating computation (`WorkerOverallRating` is read-only here for the current apply-time snapshot; snapshot is retired in target).

**Non-goals:** Requirements discovery, product-policy invention, code planning, independent review, or resolving any open decision below.

## Evidence and Traceability

`[CURRENT STATE]` requirements (REQ-001..043) — reverse-specified at `f37a39b`:

| Claim/requirement | Source path, line, revision, or decision | Authority | Status |
|---|---|---|---|
| `REQ-001` create as DRAFT (default) | `work-requests/types.ts:32`; `work-requests/service.ts:56-75` @f37a39b | Code | Observed |
| `REQ-002` create directly OPEN (publish-on-create) | `work-requests/service.ts:56,71-72` @f37a39b | Code | Observed |
| `REQ-003` create against missing/deleted hotel -> NotFoundError | `work-requests/service.ts:53-54` @f37a39b | Code | Observed |
| `REQ-004` request captures position/workers_needed/shift window/rate/currency/description/requirements | `work-requests/service.ts:58-74`; `schema.prisma:236-260` @f37a39b | Code | Observed |
| `REQ-005` defaults workers_needed=1, currency=EUR | `work-requests/types.ts:23,28`; `service.ts:68`; `schema.prisma:243,250` @f37a39b | Code | Observed |
| `REQ-006` publish (DRAFT->OPEN) sets published_at | `work-requests/service.ts:71-72,184-186` @f37a39b | Code | Observed |
| `REQ-007` publish fans out WORK_REQUEST_PUBLISHED to ACTIVE roster (fire-and-forget) | `work-requests/service.ts:222-250` @f37a39b | Code | Observed |
| `REQ-008` terms editable only while DRAFT; else silently ignored | `work-requests/service.ts:196-209` @f37a39b | Code | Observed |
| `REQ-009` manual transitions DRAFT->{OPEN,CANCELLED}, OPEN->CANCELLED, PARTIALLY_FILLED->CANCELLED; illegal->ConflictError | `work-requests/service.ts:15-19,177-180` @f37a39b | Code | Observed |
| `REQ-010` cancel sets cancelled_at + cancellation_reason | `work-requests/service.ts:188-191` @f37a39b | Code | Observed |
| `REQ-011` cancel does NOT cascade to assignments/attendance nor reopen | `work-requests/service.ts:162-227` (no cascade logic) @f37a39b | Code (absence) | Observed; policy open (OQ-03) |
| `REQ-012` FILLED/PARTIALLY_FILLED system-driven by accept pipeline | `work-requests/service.ts:12-19`; `work-applications/service.ts:276-287` @f37a39b | Code | Observed |
| `REQ-013` EXPIRED set by external scheduled job (not in repo) | `work-requests/service.ts:13-14` (comment); no job in repo @f37a39b | Code + absence | Observed; RESOLVED-BY-TARGET (6h auto-close, PIVOT §5.6) |
| `REQ-014` version increments on each status-changing write | `work-requests/service.ts:211`; `schema.prisma:245` @f37a39b | Code | Observed |
| `REQ-015` list with filters hotel_id/status/position/shift_date, paginated | `work-requests/service.ts:85-124`; `types.ts:58-65`; `controller.ts:40-72` @f37a39b | Code | Observed |
| `REQ-016` non-mgmt list scoped to ACTIVE roster hotels; empty if none | `work-requests/service.ts:98-112` @f37a39b | Code | Observed |
| `REQ-017` getById NotFound if absent; non-mgmt Forbidden without ACTIVE membership | `work-requests/service.ts:131-144` @f37a39b | Code | Observed |
| `REQ-018` worker/checker getById embeds my_application (latest) | `work-requests/service.ts:148-157`; `types.ts:91` @f37a39b | Code | Observed |
| `REQ-019` create/patch RBAC = admin/manager only | `work-requests/routes.ts:18,21` @f37a39b | Code | Observed |
| `REQ-020` worker applies via nested POST | `work-applications/service.ts:37-111`; `routes.ts:14`; `v1/index.ts:27` @f37a39b | Code | Observed |
| `REQ-021` apply only when request OPEN or PARTIALLY_FILLED else ConflictError | `work-applications/service.ts:44-47` @f37a39b | Code | Observed |
| `REQ-022` applicant must be ACTIVE on hotel roster else ForbiddenError | `work-applications/service.ts:50-53` @f37a39b | Code | Observed |
| `REQ-023` one application per (request,worker); duplicate non-WITHDRAWN -> ConflictError | `work-applications/service.ts:56-61`; `schema.prisma:301` @f37a39b | Code | Observed |
| `REQ-024` re-apply after WITHDRAWN reuses row, resets review fields | `work-applications/service.ts:70-84` @f37a39b | Code | Observed |
| `REQ-025` rating snapshot at apply time from WorkerOverallRating (null if none) | `work-applications/service.ts:64-67,77,92`; `schema.prisma:291` @f37a39b | Code | Observed |
| `REQ-026` apply notifies creator APPLICATION_RECEIVED (fire-and-forget) | `work-applications/service.ts:103-108` @f37a39b | Code | Observed |
| `REQ-027` apply RBAC = worker only | `work-applications/routes.ts:14` @f37a39b | Code | Observed |
| `REQ-028` list applications: mgmt sees all (filter status); worker sees only own | `work-applications/service.ts:113-148` @f37a39b | Code | Observed |
| `REQ-029` update application only when status PENDING else ConflictError | `work-applications/service.ts:163-165` @f37a39b | Code | Observed |
| `REQ-030` workers may only withdraw own; other transitions Forbidden; admin/manager accept/reject/withdraw | `work-applications/service.ts:167-173` @f37a39b | Code | Observed |
| `REQ-031` reject sets review fields + rejection_reason; notifies APPLICATION_REJECTED | `work-applications/service.ts:179-200` @f37a39b | Code | Observed |
| `REQ-032` accept (status=ACCEPTED) dispatches atomic approve pipeline | `work-applications/service.ts:175-177` @f37a39b | Code | Observed |
| `REQ-033` approve requires request OPEN/PARTIALLY_FILLED else ConflictError | `work-applications/service.ts:211-215` @f37a39b | Code | Observed |
| `REQ-034` approve claims slot via optimistic updateMany (version + workers_confirmed<workers_needed); count 0 -> ConflictError | `work-applications/service.ts:219-230` @f37a39b | Code | Observed; UNTESTED (FIND-BRV-006) |
| `REQ-035` approve accepts application (status ACCEPTED, reviewer, reviewed_at) | `work-applications/service.ts:233-240` @f37a39b | Code | Observed; UNTESTED |
| `REQ-036` approve creates WorkerAssignment (CONFIRMED, confirmed_at, mandatory application_id) | `work-applications/service.ts:243-253`; `schema.prisma:324-327` @f37a39b | Code | Observed; UNTESTED |
| `REQ-037` approve pre-creates EXPECTED Attendance with denormalized expected_start/end | `work-applications/service.ts:256-273`; `schema.prisma:359-367` @f37a39b | Code | Observed; UNTESTED |
| `REQ-038` approve recomputes FILLED (set filled_at) vs PARTIALLY_FILLED | `work-applications/service.ts:276-287` @f37a39b | Code | Observed; UNTESTED |
| `REQ-039` approve emits APPLICATION_ACCEPTED + ASSIGNMENT_CONFIRMED to worker | `work-applications/service.ts:299-311` @f37a39b | Code | Observed; UNTESTED |
| `REQ-040` assignment transitions CONFIRMED->{IN_PROGRESS,CANCELLED}, IN_PROGRESS->{COMPLETED,CANCELLED}; illegal/no-op->ConflictError; timestamps per transition | `assignments/service.ts:6-9,92-108` @f37a39b | Code | Observed |
| `REQ-041` list/get assignment scoping: list workers=own only; getById own OR ACTIVE membership | `assignments/service.ts:41-45,67-78` @f37a39b | Code | Observed |
| `REQ-042` active double-booking prevented (partial unique index status IN CONFIRMED,IN_PROGRESS) | `migration.sql:580-582`; `schema.prisma:344-345` @f37a39b | Migration + Lead Architect (OQ-12) | Confirmed (High) |
| `REQ-043` capacity invariant 0 <= workers_confirmed <= workers_needed (CHECK) | `migration.sql:564-566`; `schema.prisma:266` @f37a39b | Migration + Lead Architect (OQ-12) | Confirmed (High) |
| Every mutation writes an AuditLog row via BaseService.logAudit | `work-requests/service.ts:77,215`; `work-applications/service.ts:99,188,294`; `assignments/service.ts:112` @f37a39b | Code | Observed |
| Response envelope `{status,data,pagination?,meta}` | `work-requests/controller.ts:30-34,56-68` @f37a39b | Code | Observed |
| No event bus; notifications synchronous fire-and-forget | `work-requests/service.ts:238-248`; `work-applications/service.ts:103,194,299,306` @f37a39b | Code + MODULE_REGISTRY (none-observed) | Observed |
| Cross-module writes inside accept tx (WorkRequest/WorkerAssignment/Attendance) | DEPENDENCY_GRAPH edges `edge-work-applications-writes-{work-request,worker-assignment,attendance}` (graph:116-136); `work-applications/service.ts:219,243,256,278,283` @f37a39b | Code + graph | Observed; coupling open (FIND-ARCH-003); MOOT in target (flow removed, PIVOT §5.5) |
| Modular-monolith architecture (ADR-003) | PIVOT §5.1, §11 ("Keep modular monolith"); `backend/src/modules/*` @f37a39b | Architecture decision | Confirmed |
| Prisma 5 ORM over PostgreSQL (ADR-004) | PIVOT §2.1, §11; `backend/prisma/schema.prisma` @f37a39b | Architecture decision | Confirmed |

`[TARGET STATE]` requirements (TREQ-001..013) — confirmed authorities, largely unbuilt:

| Claim/requirement | Source path, line, revision, or decision | Authority | Status |
|---|---|---|---|
| `TREQ-001` calendar direct assignment (manager places workers per day; NO accept step; appears on worker calendar; NO broadcast) | PIVOT §4.4, §5.5, §7.2; CONFIRMED §13 (Primary) | Confirmed authority | Target; unbuilt (MIG-GAP-03) |
| `TREQ-002` broadcast JobRequest fired only on a standalone manager request; skill(s) × headcount-per-skill | PIVOT §4.4, §7.3; CONFIRMED §13 (Fallback) | Confirmed authority | Target; unbuilt (MIG-GAP-04) |
| `TREQ-003` eligibility = matching skill ∧ free that day; only those workers notified | PIVOT §5.5; CONFIRMED §13 | Confirmed authority | Target; unbuilt (MIG-GAP-04) |
| `TREQ-004` first-accept wins; tie-break = earliest server-received timestamp; Redis slot lock (DB `SELECT..FOR UPDATE` fallback) | PIVOT §5.5, §5.7, §7.3; CONFIRMED §13 | Confirmed authority | Target; unbuilt (MIG-GAP-06) |
| `TREQ-005` when a skill's slots fill, later responders receive explicit "requirement fulfilled" notification (not silence, not error) | PIVOT §4.4, §7.3; CONFIRMED §13 | Confirmed authority | Target; unbuilt (MIG-GAP-04) |
| `TREQ-006` unfilled JobRequest auto-closes after 6 hours; manager may close manually sooner | PIVOT §4.4, §5.6; CONFIRMED §13 | Confirmed authority | Target; unbuilt (MIG-GAP-09) |
| `TREQ-007` daily exclusivity: one active assignment per worker per DAY (calendar OR broadcast); partial unique index | PIVOT §4.4, §9.4; CONFIRMED §12, §13 | Confirmed authority | Target; unbuilt (MIG-GAP-08) |
| `TREQ-008` role × scope RBAC, deny-by-default; new Regional Manager role; Hotel Manager scoped to one hotel; cross-hotel only within Hotel Group; JWT scope claim | PIVOT §5.3, §5.4; CONFIRMED §1, §11, §12 | Confirmed authority | Target; unbuilt (MIG-GAP-07, MIG-GAP-11) |
| `TREQ-009` on consuming Calendar's `EVT-CAL-SickVacationMarked` (Calendar-owned sick/vacation mark, `ADR-021`), cancel the same-day assignment; Calendar sends the manager notification | PIVOT §7.2; CONFIRMED §22; `ADR-021` | Confirmed authority | Target; unbuilt (MIG-GAP-10); event-driven per `ADR-021` Correction v0.3.1 |
| `TREQ-010` skills constrained to enum {Cleaner, Public Service, Kitchen Dishwasher, Waiter} (replaces free-text `position`) | CONFIRMED §4; PIVOT §4.4 | Confirmed authority | Target; unbuilt (MIG-GAP-05) |
| `TREQ-011` remove `WorkApplication` model and all worker-initiated application endpoints | PIVOT §5.5, §9.2; CONFIRMED §34, §37 (NON-GOALS) | Confirmed authority | Target; breaking change, Phase 1 (MIG-GAP-01) |
| `TREQ-012` `WorkerAssignment` created directly from calendar or broadcast accept; drop mandatory `application_id` FK | PIVOT §9.1 | Confirmed authority | Target; unbuilt (MIG-GAP-02) |
| `TREQ-013` no formal job-status state machine (Open→Assigned→InProgress removed); "rest handled manually" | CONFIRMED §13 (Removed); PIVOT §5.5 | Confirmed authority | Target; simplification (MIG-GAP-12) |

## Actors and Terminology

Role-token case mapping (FIND-CONS-001): the Prisma `UserRole` enum values are UPPER-CASE
(`WORKER`, `CHECKER`, `ADMIN`, `MANAGER`) while route/service guards compare lower-case
string literals (`'worker'`, `'admin'`, `'manager'`, `'checker'`); the auth layer normalizes
role to the guard casing. Statements below use the guard casing.

| Term/actor | Canonical definition | Source |
|---|---|---|
| Work request | `[CURRENT]` A hotel-published shift opening carrying position, capacity (`workers_needed`), shift date/time window, and commercial terms; lifecycle DRAFT->OPEN/CANCELLED->PARTIALLY_FILLED/FILLED/EXPIRED. | `schema.prisma:236`; `work-requests/service.ts` (TERMINOLOGY promotion proposed) |
| Work application | `[CURRENT; RETIRED in target]` A rostered worker's expression of interest in one work request; at most one live row per (request,worker); accepted applications are the sole gateway to an assignment. Removed in target (PIVOT §9.2). | `schema.prisma:279`; `work-applications/service.ts` |
| Assignment (WorkerAssignment) | A confirmed booking of a worker to work. `[CURRENT]` created only from an accepted application (mandatory `application_id` FK), driven CONFIRMED->IN_PROGRESS->COMPLETED/CANCELLED. `[TARGET]` created directly from calendar or broadcast accept; `application_id` dropped (PIVOT §9.1). | `schema.prisma:314`; `assignments/service.ts` |
| Roster | The set of `HotelWorker` memberships for a hotel; ACTIVE membership gates non-management visibility and the current apply precondition. `[TARGET]` HotelWorker becomes the permanent-employment record (PIVOT §9.1). | `schema.prisma:206`; `work-requests/service.ts:101,135`; `work-applications/service.ts:50` |
| Slot | One unit of `workers_needed` capacity; `[CURRENT]` claimed via optimistic `updateMany`; `[TARGET]` claimed via Redis slot lock (DB `FOR UPDATE` fallback), one per skill (PIVOT §5.5, §7.3). | `work-applications/service.ts:219-229`; `schema.prisma:243-244` |
| admin / manager (management) | `[CURRENT]` Roles permitted to create/patch work requests and accept/reject applications; exempt from roster-scoping on reads and NOT hotel-scoped. | `work-requests/routes.ts:18,21`; `work-applications/service.ts:122,167` |
| worker | Role permitted to apply and to withdraw own application; reads scoped to own resources/rostered hotels. | `work-applications/routes.ts:14`; `work-requests/service.ts:100,148` |
| checker | Non-management role treated as worker for read-scoping and `my_application` embedding. | `work-requests/service.ts:148` |
| Hotel Group `[TARGET]` | A set of hotels aggregated under one Regional Manager, with shared billing; the boundary of permitted cross-hotel assignment. | PIVOT §4.3, §14 (Glossary); CONFIRMED §11, §12 |
| Regional Manager `[TARGET]` | NEW role: all Hotel-Manager actions across an entire Hotel Group; cannot create hotels or modify groups. | PIVOT §4.1, §5.4; CONFIRMED §1, §11 |
| Hotel Manager `[TARGET]` | Manager scoped to exactly ONE hotel (schedule, raise job requests, approve onboarding, manage hotel). | PIVOT §5.4; CONFIRMED §1, §11 |
| Scope `[TARGET]` | The hotel or hotel-group a user may act within, carried as a JWT claim; second authorization dimension alongside role. | PIVOT §5.3, §5.4 |
| Broadcast / JobRequest `[TARGET]` | Gap-fill dispatch to eligible workers (skill × headcount); first-accept wins; 6h auto-close. | PIVOT §4.4, §7.3, §14 (Glossary); CONFIRMED §13 |
| Calendar direct assignment `[TARGET]` | Primary path: manager places workers per day; no accept step; new `CalendarEntry` model. | PIVOT §4.4, §7.2, §9.3; CONFIRMED §13 |
| Daily exclusivity `[TARGET]` | Once assigned anything for a day, a worker is blocked from any further assignment that whole day. | PIVOT §4.4, §9.4, §14 (Glossary); CONFIRMED §12, §13 |
| Skill `[TARGET]` | One of {Cleaner, Public Service, Kitchen Dishwasher, Waiter}; replaces free-text `position`. | CONFIRMED §4 |

## Requirements and Acceptance Criteria

`[CURRENT STATE]` requirements (all Observed @f37a39b unless noted):

| Requirement | Statement | Priority | Acceptance criteria | Rule IDs |
|---|---|---|---|---|
| REQ-001 | A work request is created as DRAFT by default. | Must | POST with no/`DRAFT` status persists status=DRAFT, published_at=null, HTTP 201. | RULE-001 |
| REQ-002 | A work request may be created directly as OPEN (publish-on-create). | Must | POST with status=OPEN persists status=OPEN and sets published_at. | RULE-001 |
| REQ-003 | Creation against a missing/soft-deleted hotel fails. | Must | Unknown or `deleted_at` hotel -> NotFoundError (no row created). | — |
| REQ-004 | A work request records position, workers_needed, shift date, start/end time, hourly_rate, currency, description, requirements. | Must | Persisted row + DTO echo all supplied fields. | — |
| REQ-005 | workers_needed defaults to 1 and currency to EUR. | Should | Omitted fields default to 1 / "EUR". | RULE-006 |
| REQ-006 | Publishing (DRAFT->OPEN) stamps published_at once. | Must | First OPEN transition sets published_at; not overwritten if already set. | RULE-001 |
| REQ-007 | Publishing notifies every ACTIVE roster worker with WORK_REQUEST_PUBLISHED. | Should | Each ACTIVE `HotelWorker` receives one notification; delivery failure does not roll back publish. | RULE-012 |
| REQ-008 | Commercial terms are mutable only while DRAFT; in any other state term fields are silently ignored. | Must | PATCH of term fields on OPEN+ request returns 200 with terms unchanged (no error). | RULE-002 |
| REQ-009 | Manual status transitions are limited to DRAFT->{OPEN,CANCELLED}, OPEN->CANCELLED, PARTIALLY_FILLED->CANCELLED. | Must | Any other manual transition -> ConflictError. | RULE-001 |
| REQ-010 | Cancelling stamps cancelled_at and stores cancellation_reason. | Must | Transition to CANCELLED sets cancelled_at=now and cancellation_reason (nullable). | RULE-001 |
| REQ-011 | Cancelling a work request does not cascade to assignments/attendance nor reopen it. | Must | After cancel, existing assignments/attendance are unchanged; workers_confirmed unchanged. | RULE-001 |
| REQ-012 | FILLED and PARTIALLY_FILLED are driven only by the accept pipeline. | Must | No manual PATCH reaches FILLED/PARTIALLY_FILLED (absent from transition table). | RULE-001, RULE-007 |
| REQ-013 | EXPIRED is set by an external scheduled job (absent from this repo). | Should | No in-repo path sets EXPIRED; documented as external. RESOLVED-BY-TARGET: target replaces with a 6h auto-close job (TREQ-006). | RULE-001 |
| REQ-014 | version increments on each status-changing write. | Must | Any status change increments version by 1; term-only DRAFT edits do not. | RULE-001 |
| REQ-015 | Work requests can be listed with hotel_id/status/position/shift_date filters, paginated. | Must | List returns filtered, paginated data + pagination envelope. | RULE-011a |
| REQ-016 | Non-management list is scoped to hotels where the actor holds ACTIVE roster membership. | Must | Non-mgmt with no ACTIVE membership -> empty result; otherwise only rostered hotels. | RULE-011a |
| REQ-017 | getById returns NotFound if absent and Forbidden for non-mgmt without ACTIVE membership on the request's hotel. | Must | Missing -> NotFoundError; non-mgmt non-member -> ForbiddenError. | RULE-011a |
| REQ-018 | For worker/checker, getById embeds the latest my_application. | Should | DTO includes my_application (id,status,created_at) or null. | RULE-011b |
| REQ-019 | Create and patch are restricted to admin/manager. | Must | Other roles -> route-level 403 before service. | RULE-005 |
| REQ-020 | A worker applies to a work request via the nested endpoint. | Must | POST /work-requests/:id/applications creates a PENDING application, HTTP 201. | RULE-011e |
| REQ-021 | Applications may be **submitted** only while the request is OPEN or PARTIALLY_FILLED. | Must | Apply (submit) to any other status -> ConflictError. (Verb standardized per FIND-CONS-002: "submit" for worker apply; "accept/approve" reserved for manager acceptance.) | RULE-003 |
| REQ-022 | The applicant must be ACTIVE on the hotel roster. | Must | Non-member applicant -> ForbiddenError. | RULE-011e |
| REQ-023 | Only one application per (request,worker) may be live. | Must | Duplicate with status != WITHDRAWN -> ConflictError; enforced by @@unique. | RULE-004 |
| REQ-024 | Re-applying after WITHDRAWN reuses the existing row and resets review fields. | Must | WITHDRAWN row is updated to PENDING with reviewer/rejection fields cleared. | RULE-004 |
| REQ-025 | The worker's overall rating is snapshotted onto the application at apply time. | Should | worker_rating_snapshot = average_score or null if no rating exists. | RULE-013 |
| REQ-026 | Applying notifies the request creator with APPLICATION_RECEIVED. | Should | One fire-and-forget notification to created_by_id; failure does not roll back apply. | RULE-012 |
| REQ-027 | Apply is restricted to the worker role. | Must | Non-worker -> route-level 403. | RULE-005 |
| REQ-028 | Management lists all applications (filterable by status); a worker sees only their own. | Must | Non-mgmt result is the single own application or empty. | RULE-011b |
| REQ-029 | An application may be updated only while PENDING. | Must | Update of non-PENDING -> ConflictError. | RULE-003 |
| REQ-030 | Workers may only withdraw their own application; management may accept/reject/withdraw. | Must | Worker non-owner -> Forbidden; worker non-WITHDRAWN target -> Forbidden; mgmt unrestricted by owner. | RULE-005 |
| REQ-031 | Rejecting stamps review fields and rejection_reason and notifies the worker. | Must | Status REJECTED sets reviewed_at/reviewed_by; APPLICATION_REJECTED sent. | RULE-005, RULE-012 |
| REQ-032 | Accepting an application dispatches the atomic approve pipeline. | Must | status=ACCEPTED routes into approve() transaction. | RULE-003, RULE-009 |
| REQ-033 | Approve requires the request to still be OPEN or PARTIALLY_FILLED. | Must | Approve on any other status -> ConflictError. | RULE-003 |
| REQ-034 | Approve claims a slot with an optimistic conditional update. | Must | updateMany WHERE version=known AND workers_confirmed<workers_needed; count 0 -> ConflictError. | RULE-006, RULE-007 |
| REQ-035 | Approve marks the application ACCEPTED with reviewer and timestamp. | Must | Application status=ACCEPTED, reviewed_by_id=actor, reviewed_at=now. | RULE-003 |
| REQ-036 | Approve creates a CONFIRMED assignment linked to the application. | Must | WorkerAssignment created with status=CONFIRMED, confirmed_at, non-null application_id. | RULE-009 |
| REQ-037 | Approve pre-creates an EXPECTED attendance row with denormalized shift window. | Must | Attendance created status=EXPECTED, expected_start/end derived from shift. | RULE-009 |
| REQ-038 | Approve recomputes fill status. | Must | workers_confirmed>=workers_needed -> FILLED + filled_at; else PARTIALLY_FILLED. | RULE-007 |
| REQ-039 | Approve emits APPLICATION_ACCEPTED and ASSIGNMENT_CONFIRMED to the worker. | Should | Two fire-and-forget notifications post-commit; failure does not roll back. | RULE-012 |
| REQ-040 | Assignments transition CONFIRMED->{IN_PROGRESS,CANCELLED} and IN_PROGRESS->{COMPLETED,CANCELLED}, stamping timestamps. | Must | Illegal or no-op transition -> ConflictError; started_at/completed_at/cancelled_at set per target. | RULE-008 |
| REQ-041 | Assignment reads are scoped: workers list only their own; getById permits own or ACTIVE membership. | Must | Worker list filtered to worker_id=self; getById non-owner non-member -> Forbidden. | RULE-011c, RULE-011d |
| REQ-042 | A worker cannot hold two active (CONFIRMED/IN_PROGRESS) assignments for the same request. | Must | Partial unique index rejects a second active row (DB-level). Note: current index keys on (request,worker), NOT per-day — target changes this (TREQ-007, MIG-GAP-08). | RULE-010 |
| REQ-043 | workers_confirmed stays within [0, workers_needed]. | Must | CHECK constraint rejects any violating write. | RULE-006 |
| REQ-044 | Work-request creation is rejected when the target hotel has paused accepting new jobs. | Must | `create()` reads `Hotel.accepting_jobs` (owned by `backend-crm`, `SPEC-CRM-001` `RULE-CRM-09`); `false` -> ForbiddenError, checked immediately after the existing `deleted_at` check. | RULE-014 |

`[TARGET STATE]` requirements (confirmed authority; unbuilt unless noted):

| Requirement | Statement | Priority | Acceptance criteria | Rule IDs |
|---|---|---|---|---|
| TREQ-001 | Manager places workers on a calendar day-by-day as a DIRECT assignment — no worker accept/decline; the shift appears on the worker's calendar; no broadcast fires. | Must | A calendar placement creates a `CalendarEntry`/assignment directly; no application row; no broadcast notification emitted. | TRULE-001 |
| TREQ-002 | A broadcast `JobRequest` fires only when a manager raises a standalone request specifying skill(s) and headcount per skill. | Must | JobRequest persists skill×headcount; calendar edits never emit a broadcast. | TRULE-002 |
| TREQ-003 | Only workers with a matching skill who are free that day are eligible and notified. | Must | Eligible set = {skill matches ∧ no assignment that day}; only they receive push. | TRULE-002, TRULE-006 |
| TREQ-004 | First acceptance wins each slot; ties broken by earliest server-received timestamp; arbitration via Redis slot lock, DB `SELECT..FOR UPDATE` fallback when Redis is down. | Must | Under concurrent accepts on the last slot, exactly one succeeds (earliest timestamp); Redis-down path still yields exactly one winner. | TRULE-003 |
| TREQ-005 | When a skill's slots are full, later responders receive an explicit "requirement fulfilled" notification (not silence, not an error). | Must | Post-fill accept returns a "requirement fulfilled" message; no assignment created. | TRULE-004 |
| TREQ-006 | An unfilled JobRequest auto-closes 6 hours after creation; the manager may close it manually sooner. | Must | Scheduled job closes at +6h and notifies the manager; manual close available earlier. | TRULE-005 |
| TREQ-007 | A worker assigned anything for a day (calendar OR broadcast) is blocked from any further assignment that whole day (daily exclusivity), enforced by a partial unique index (one active assignment per worker per day). | Must | Second same-day assignment rejected at DB level; eligibility computation excludes already-assigned workers. | TRULE-006 |
| TREQ-008 | Authorization is two-dimensional (role × scope), deny-by-default; the new Regional Manager role acts across a Hotel Group; a Hotel Manager is scoped to one hotel; cross-hotel assignment is permitted only within the worker's Hotel Group; scope is a JWT claim. | Must | Actor outside target hotel's scope -> denied; Regional Manager permitted across group; Hotel Manager denied on out-of-hotel action. | TRULE-007 |
| TREQ-009 | On consuming Calendar's `EVT-CAL-SickVacationMarked` (a worker marking a current/future day sick or vacation, owned by `backend-calendar`'s `state-calendar-absence` per `ADR-021`), cancel any existing same-day assignment. **Amended by `ADR-021` (2026-07-19, Correction v0.3.1):** the sick/vacation mark itself and the manager notification are Calendar's, not this module's; this module owns only the resulting assignment cancellation. | Must | On consuming `EVT-CAL-SickVacationMarked` (worker, day, kind), the same-day `WorkerAssignment` for that worker is cancelled within this module's own boundary; no state persists where the worker is both on-leave and assigned that day, once consumed. | TRULE-008 |
| TREQ-010 | Worker skills are constrained to the enum {Cleaner, Public Service, Kitchen Dishwasher, Waiter}; broadcast skill selection draws from this list (replacing free-text `position`). | Must | Skill values validated against the enum; broadcast per-skill headcount references enum members. | TRULE-009 |
| TREQ-011 | The `WorkApplication` model and all worker-initiated application endpoints are removed. | Must | No apply endpoint; no `WorkApplication` table; worker-initiated application is a confirmed NON-GOAL. | (retires RULE-003/004/013) |
| TREQ-012 | `WorkerAssignment` is created directly from a calendar placement or broadcast accept; the mandatory `application_id` FK is dropped. | Must | Assignment rows exist with no application linkage; creation path does not require an application. | (retires RULE-009) |
| TREQ-013 | No formal job-status state machine is enforced (Open→Assigned→InProgress removed); remaining status handling is manual. | Should | No system-enforced multi-state job lifecycle beyond assignment existence + attendance. | TRULE-005 |

## Business Rules

`[CURRENT STATE]` rules (RULE-001..013) — BRV corrections from v0.1.0 preserved; RETIRED-by-pivot flagged:

| Rule | Preconditions | Outcome/invariant | Exceptions/precedence | Owner/source |
|---|---|---|---|---|
| RULE-001 | Manual PATCH/create of a WorkRequest | Allowed manual transitions: create->DRAFT or ->OPEN(direct); DRAFT->{OPEN,CANCELLED}; OPEN->CANCELLED; PARTIALLY_FILLED->CANCELLED. FILLED/PARTIALLY_FILLED are system-driven; EXPIRED is external. Cancel stamps cancelled_at and does NOT cascade to assignments/attendance nor reopen. | Illegal transition -> ConflictError. `[TARGET]` WorkRequest repurposed as JobRequest; marketplace status machine RETIRED (CONFIRMED §13, TREQ-013). | `unassigned (SYNC-001)`; `work-requests/service.ts:15-19,177-191` |
| RULE-002 | PATCH of a WorkRequest | Commercial/term fields are mutable IFF status==DRAFT. In any other state term fields are silently ignored (200, no error); only status may change. | Concurrent DRAFT term edits are unguarded by version (was OQ-11; superseded — DRAFT/term model retired in target). | `unassigned (SYNC-001)`; `work-requests/service.ts:196-209` |
| RULE-003 `[RETIRED in target]` | Apply, or accept/reject/withdraw of an application | Applications are created/approved only while the request is OPEN or PARTIALLY_FILLED; updates require the application to be PENDING. | Otherwise ConflictError. Approve-on-closed is UNTESTED (FIND-BRV-009). RETIRED by TREQ-011 (applications removed). | `unassigned (SYNC-001)`; `work-applications/service.ts:44-47,163-165,213-215` |
| RULE-004 `[RETIRED in target]` | Apply to a request | At most one application per (request,worker); only a WITHDRAWN row may re-apply (row reused). | PENDING/ACCEPTED/REJECTED block re-apply -> ConflictError. (Former OQ-06 "REJECTED permanent lock" MOOT — applications removed.) RETIRED by TREQ-011. | `unassigned (SYNC-001)`; `work-applications/service.ts:56-84`; `schema.prisma:301` |
| RULE-005 | Update of an application | A worker may only withdraw their own application; admin/manager may accept, reject, OR withdraw any pending application (worker-branch guards apply only when isWorker). | Route RBAC limits create/patch of requests and apply to management/worker respectively. `[TARGET]` application-update authz RETIRED; superseded by role×scope (TRULE-007). | `unassigned (SYNC-001)`; `work-applications/service.ts:167-173`; `work-requests/routes.ts:18,21` |
| RULE-006 | Slot claim + all WorkRequest writes | Invariant 0 <= workers_confirmed <= workers_needed, enforced by app-layer predicate and DB CHECK. | Claim predicate returning count 0 -> ConflictError. `[TARGET]` slot arbitration moves to Redis lock (TRULE-003). | `unassigned (SYNC-001)`; `work-applications/service.ts:219-230`; `migration.sql:564-566` |
| RULE-007 `[RETIRED in target]` | Accept transaction commit | FILLED (with filled_at) iff workers_confirmed>=workers_needed after claim; otherwise PARTIALLY_FILLED. | — RETIRED: accept-transaction fill recompute removed with the marketplace flow (TREQ-011/012/013). | `unassigned (SYNC-001)`; `work-applications/service.ts:276-287` |
| RULE-008 | Update of an assignment | Lifecycle CONFIRMED->{IN_PROGRESS,CANCELLED}; IN_PROGRESS->{COMPLETED,CANCELLED}. COMPLETED and CANCELLED are terminal. Cancel stamps cancelled_at only — it does NOT decrement workers_confirmed nor reopen the request. | Illegal/no-op -> ConflictError. NO_SHOW/REASSIGNED declared but UNREACHABLE (superseded — target simplifies job status, TREQ-013); cancel side-effect is a target design detail (OQ-02, partially resolved by TREQ-009's event-driven sick/vacation cancel, `ADR-021`). | `unassigned (SYNC-001)`; `assignments/service.ts:6-9,92-108`; `schema.prisma:55-62` |
| RULE-009 `[RETIRED in target]` | Assignment creation | Every assignment traces to an accepted application via a non-null `application_id` FK (onDelete Restrict); no bypass path exists. | — RETIRED by TREQ-012: assignment created directly from calendar/broadcast; `application_id` dropped. | `unassigned (SYNC-001)`; `schema.prisma:324-327`; `work-applications/service.ts:243-253` |
| RULE-010 | Two active assignments for same (request,worker) | A worker may hold at most one CONFIRMED/IN_PROGRESS assignment per request. | DB partial unique index rejects the second active row. `[TARGET]` re-keyed to one active assignment per worker per DAY (TRULE-006). | `unassigned (SYNC-001)`; `migration.sql:580-582` |
| RULE-011a | Non-mgmt list/get of a WorkRequest | Requires ACTIVE HotelWorker membership on the request's hotel; management exempt. | List -> filtered/empty; getById non-member -> ForbiddenError. `[TARGET]` management read-scoping tightened to role×scope (TRULE-007). | `unassigned (SYNC-001)`; `work-requests/service.ts:98-112,134-144` |
| RULE-011b | Non-mgmt list of WorkApplications; my_application embed | Ownership only: a worker sees exactly their own application. | Non-owner sees nothing. `[TARGET]` RETIRED with applications. | `unassigned (SYNC-001)`; `work-applications/service.ts:122-130`; `work-requests/service.ts:148-157` |
| RULE-011c | Non-mgmt getById of a WorkerAssignment | Permitted if actor is the assigned worker OR holds ACTIVE membership on the assignment's hotel. | Neither -> ForbiddenError. | `unassigned (SYNC-001)`; `assignments/service.ts:67-78` |
| RULE-011d | Non-mgmt list of WorkerAssignments | Ownership only: results forced to worker_id=self. | — | `unassigned (SYNC-001)`; `assignments/service.ts:41-45` |
| RULE-011e | Apply precondition (distinct from read-visibility) | Applying requires ACTIVE HotelWorker membership on the request's hotel. | Non-member -> ForbiddenError. `[TARGET]` RETIRED with applications. | `unassigned (SYNC-001)`; `work-applications/service.ts:50-53` |
| RULE-012 | Any notification emission | Delivery is best-effort synchronous fire-and-forget; it never participates in or rolls back the originating transaction (all notifications sent post-commit / catch-swallowed). | Delivery failure is silent. `[TARGET]` push-only channel (CONFIRMED §18); broadcast notifies only eligible workers. | `unassigned (SYNC-001)`; `work-requests/service.ts:238-248`; `work-applications/service.ts:103,299` |
| RULE-013 `[RETIRED in target]` | Apply time | Worker overall rating is snapshotted onto the application (null when none exists). | — RETIRED with applications (TREQ-011). | `unassigned (SYNC-001)`; `work-applications/service.ts:64-67` |
| RULE-014 | Work-request creation | Rejected when `Hotel.accepting_jobs` is `false` (`GD-05`, `SPEC-CRM-001` `RULE-CRM-09`) — a read-only cross-module dependency on CRM-owned state, checked before the manager hotel-scope check. | ForbiddenError; does not affect existing/DRAFT requests, only new creation. | This module reads; `backend-crm` owns/writes (Current: `work-requests/service.ts`; `GD-05`, 2026-07-27) |

`[TARGET STATE]` rules (TRULE-001..009) — confirmed authority:

| Rule | Preconditions | Outcome/invariant | Exceptions/precedence | Owner/source |
|---|---|---|---|---|
| TRULE-001 | Manager places a worker on a calendar day | Direct assignment created; worker calendar reflects it; NO accept/decline step; NO broadcast fired. | Blocked if worker already assigned/sick/vacation that day (TRULE-006). | PIVOT §4.4, §7.2; CONFIRMED §13 |
| TRULE-002 | Manager raises a standalone JobRequest | Broadcast targets only workers with matching skill who are free that day; per-skill headcount honored; calendar edits never broadcast. | Ineligible workers not notified. | PIVOT §4.4, §7.3; CONFIRMED §13 |
| TRULE-003 | Concurrent broadcast accepts | First accept to acquire the slot lock wins; ties broken by earliest server-received timestamp; Redis slot lock, DB `SELECT..FOR UPDATE` fallback if Redis down. | Losers do not get an assignment (TRULE-004). No client retry semantics defined (see Performance). | PIVOT §5.5, §5.7, §7.3; CONFIRMED §13 |
| TRULE-004 | A skill's slots are full | Later responders receive an explicit "requirement fulfilled" notification. | Not an error, not silence. | PIVOT §4.4, §7.3; CONFIRMED §13 |
| TRULE-005 | JobRequest open | Auto-closes 6h after creation via scheduled job (notifies manager); manager may close manually sooner. | Prevents zombie requests. | PIVOT §4.4, §5.6; CONFIRMED §13 |
| TRULE-006 | Any assignment (calendar or broadcast) for a day | One active assignment per worker per day; further same-day assignment blocked (partial unique index). | DB rejects second same-day active row. | PIVOT §4.4, §9.4; CONFIRMED §12, §13 |
| TRULE-007 | Any authorized action | role × scope, deny-by-default; cross-hotel only within the actor's/worker's Hotel Group; hotel creation Admin/HQ only; scope carried in JWT. | Out-of-scope action denied. Resolves former OQ-07 (hotel scoping REQUIRED). | PIVOT §5.3, §5.4; CONFIRMED §1, §11, §12 |
| TRULE-008 | This module consumes Calendar's `EVT-CAL-SickVacationMarked` (worker marked a current/future day sick or vacation — Calendar's own act, per `ADR-021`) | Any same-day assignment is cancelled by this module on consuming the event; manager notification is sent by Calendar, not this module. | No state persists where a worker is both on-leave and assigned that day, once the event is consumed; convergence is eventual (event-driven), not a cross-module atomic transaction (`ADR-021`, superseding the prior single-transaction model). | PIVOT §7.2; CONFIRMED §22; `ADR-021` (Accepted 2026-07-19) |
| TRULE-009 | Skill selection (profile or broadcast) | Skills constrained to {Cleaner, Public Service, Kitchen Dishwasher, Waiter}. | Values outside enum rejected. | CONFIRMED §4 |

## Ownership and Boundaries

**Module owner:** `unassigned (SYNC-001, human authority required)`. No CODEOWNERS file exists and
`backend/package.json` author is empty; owner assignment is reserved human authority and is NOT
invented here. PIVOT §13 names "Owner: Mayank (Lead), Reviewers: Ritik (PM)" for the design
document — corroborating evidence for the human decision, but not an authoritative knowledge-layer
(MODULE_REGISTRY / CODEOWNERS) encoding.

**Owned state (per DEPENDENCY_GRAPH state-domains):**
- `state-work-request` (`schema.prisma:236`) — owned by backend-work-requests. `[TARGET]` repurposed as `JobRequest`.
- `state-work-application` (`schema.prisma:279`) — owned by backend-work-applications. `[TARGET]` REMOVED (PIVOT §9.2).
- `state-worker-assignment` (`schema.prisma:314`) — owned by backend-assignments. `[TARGET]` drop `application_id`; add `CalendarEntry` (PIVOT §9.1, §9.3).

**Consumed state (read):**
- `state-hotel` (`work-requests/service.ts:53`) — hotel existence/soft-delete check; also `accepting_jobs` pause-toggle check (`GD-05`, `RULE-014`, `SPEC-CRM-001` `RULE-CRM-09`).
- `state-hotel-worker` (`work-requests/service.ts:101,135,233`; `work-applications/service.ts:50`; `assignments/service.ts:69`) — roster membership for scoping and apply precondition.
- `state-worker-overall-rating` (`work-applications/service.ts:64`) — apply-time rating snapshot (`[TARGET]` retired).
- `state-audit-log` (write, cross-cutting via BaseService) — audit trail.

**Permitted writes:** Each module writes its own owned state. `[CURRENT]` NOTABLE cross-module write
coupling (observed): the accept transaction in backend-work-applications WRITES state owned by other
modules inside a single `$transaction`:
- `state-work-request` (owner backend-work-requests) — slot claim + fill recompute (`work-applications/service.ts:219,278,283`).
- `state-worker-assignment` (owner backend-assignments) — assignment creation (`work-applications/service.ts:243`).
- `state-attendance` (owner backend-attendance) — EXPECTED pre-creation (`work-applications/service.ts:256`).
These correspond to DEPENDENCY_GRAPH edges `edge-work-applications-writes-{work-request,worker-assignment,attendance}`.
`[MIGRATION GAP]` This coupling is MOOT in the target: the accept transaction and `WorkApplication` are
removed and the assignment is created directly (PIVOT §5.5, §9.1). Whether the current coupling warrants
a Decision Record or is simply recorded as superseded-by-pivot is an open human/architecture decision
(FIND-ARCH-003). It is documented here as observed behavior only, not endorsed as policy.

**Boundary/non-responsibilities:** This capability does not own attendance check-in/verification, quality
verification, rating computation, or notification delivery mechanics. `[CURRENT]` It does not implement the
EXPIRED scheduled job; it does not perform hotel-scoping on create/patch and performs NO ownership/role
authorization on assignment updates (FIND-SEC-001, current-state CRITICAL). `[TARGET]` It does not own the
calendar UI, onboarding, consent, or retention; it does own calendar/broadcast assignment creation and
daily exclusivity.

## Interfaces and Contracts

Base router mounts at `v1/index.ts:26-28`. All routes require `authMiddleware`. Envelope:
`{ status:"success", data, pagination?, meta:{timestamp,request_id} }`. Error types map to HTTP via the
shared error layer: `ValidationError` (400, Zod field details), `NotFoundError` (404), `ForbiddenError`
(403), `ConflictError` (409). Compatibility vocabulary (FIND-DEP-003): these contracts are **unversioned**
in code (no explicit contract version/registry entry), so their compatibility posture is recorded as
**baseline/UNKNOWN**, not "Additive/Stable"; any change must be assessed against a future versioned baseline.

`[CURRENT STATE]` endpoints (implemented @f37a39b):

| Contract ID/version | Direction | Input | Output | Errors | Auth | Compatibility |
|---|---|---|---|---|---|---|
| `POST /work-requests` (unversioned) | inbound | `CreateWorkRequestSchema` (hotel_id, position, workers_needed<=1000, shift_date YYYY-MM-DD, HH:MM times, hourly_rate?, currency(3)?, description?, requirements?, status DRAFT/OPEN, expires_at?) | 201 `WorkRequestDto` | ValidationError, NotFoundError(hotel) | requireRole(admin,manager) | baseline/UNKNOWN |
| `GET /work-requests` (unversioned) | inbound | `ListWorkRequestsQuerySchema` (hotel_id?, status?, position?, shift_date?, page, per_page<=100) | 200 `WorkRequestDto[]` + pagination | ValidationError | any authenticated (service-scoped, RULE-011a) | baseline/UNKNOWN |
| `GET /work-requests/:id` (unversioned) | inbound | path id | 200 `WorkRequestDto` (+my_application for worker/checker) | NotFoundError, ForbiddenError | any authenticated (RULE-011a) | baseline/UNKNOWN |
| `PATCH /work-requests/:id` (unversioned) | inbound | `UpdateWorkRequestSchema` (term fields?, status?, cancellation_reason?) | 200 `WorkRequestDto` | ValidationError, NotFoundError, ConflictError | requireRole(admin,manager) | baseline/UNKNOWN; term fields silently ignored unless DRAFT (RULE-002) |
| `POST /work-requests/:id/applications` (unversioned) `[TARGET: REMOVED]` | inbound | `ApplyWorkRequestSchema` (cover_note<=1000?) | 201 `WorkApplicationDto` | ValidationError, NotFoundError, ConflictError, ForbiddenError | requireRole(worker) | baseline/UNKNOWN; REMOVED in target Phase 1 (TREQ-011, breaking) |
| `GET /work-requests/:id/applications` (unversioned) `[TARGET: REMOVED]` | inbound | `ListApplicationsQuerySchema` (status?, page, per_page<=100) | 200 `WorkApplicationDto[]` + pagination | ValidationError, NotFoundError | any authenticated (mgmt=all, worker=own; RULE-011b) | baseline/UNKNOWN; REMOVED in target (TREQ-011) |
| `PATCH /work-requests/:id/applications/:applicationId` (unversioned) `[TARGET: REMOVED]` | inbound | `UpdateApplicationSchema` (status ACCEPTED/REJECTED/WITHDRAWN?, rejection_reason?, cancellation_reason?) | 200 `WorkApplicationDto` (ACCEPTED runs approve tx) | ValidationError, NotFoundError, ConflictError, ForbiddenError | any authenticated; service guards (worker=own withdraw only; mgmt=accept/reject/withdraw; RULE-005). NO route-level role guard. | baseline/UNKNOWN; REMOVED in target (TREQ-011) |
| `GET /assignments` (unversioned) | inbound | `ListAssignmentsQuerySchema` (hotel_id?, work_request_id?, worker_id?, status?, page, per_page<=100) | 200 `AssignmentDto[]` + pagination | ValidationError | any authenticated (worker=own; RULE-011d) | baseline/UNKNOWN |
| `GET /assignments/:id` (unversioned) | inbound | path id | 200 `AssignmentDto` | NotFoundError, ForbiddenError | any authenticated (RULE-011c) | baseline/UNKNOWN |
| `PATCH /assignments/:id` (unversioned) | inbound | `UpdateAssignmentSchema` (status IN_PROGRESS/COMPLETED/CANCELLED?, cancellation_reason?) | 200 `AssignmentDto` | ValidationError, NotFoundError, ConflictError | any authenticated. **NO ownership/role/hotel authorization guard in route or service** (FIND-SEC-001, current-state CRITICAL). Route comment claims non-existent "service-level guards" (FIND-SEC-005; code fix, Phase 1). | baseline/UNKNOWN; authz gap unresolved (open decision) |

DTO shapes: `WorkRequestDto` (`work-requests/types.ts:69-92`), `WorkApplicationDto` (`work-applications/types.ts:26-38`),
`AssignmentDto` (`assignments/types.ts:23-37`).

`[TARGET STATE]` interfaces (unbuilt; shapes not yet authored): broadcast `JobRequest` endpoints
(raise request with skill×headcount, accept-first, manual close) and calendar direct-assignment
endpoints are TARGET and UNBUILT (PIVOT §4.4, §7.2, §7.3; §10 Phase 2). Their contracts are not
specified here beyond the confirmed behavior in Requirements/Rules; they will be authored when
the target milestone (M2 Dispatch, PIVOT §12) begins. WorkApplication endpoints (above) are
removed in Phase 1.

## Events

No event bus exists (MODULE_REGISTRY `published_events: none-observed`, `consumed_events: none-observed`
for all three modules). `[CURRENT]` "Events" below are synchronous, best-effort, fire-and-forget calls to
`notificationService.sendNotification` — never transactional (RULE-012). Delivery failures are
`.catch(() => {})`-swallowed. `[TARGET]` this capability additionally **consumes** `EVT-CAL-SickVacationMarked`
(published by `backend-calendar`; see `SPEC-CALENDAR-001` Events) to drive `TREQ-009`/`TRULE-008`'s
same-day assignment cancellation — unbuilt, contract `[OPEN]`, same status as every other target-plane
event in this document (`ADR-021`, Correction v0.3.1).

| Event ID/version | Publisher | Trigger | Payload source | Consumers | Delivery/idempotency |
|---|---|---|---|---|---|
| `WORK_REQUEST_PUBLISHED` | backend-work-requests | DRAFT->OPEN publish commit | `service.ts:240-246` (work_request_id, hotel_id) | Each ACTIVE roster worker | Fire-and-forget; not idempotent; failure swallowed |
| `APPLICATION_RECEIVED` `[TARGET: retired]` | backend-work-applications | apply() success | `service.ts:103-108` (application_id, work_request_id) | Request creator | Fire-and-forget; failure swallowed |
| `APPLICATION_REJECTED` `[TARGET: retired]` | backend-work-applications | reject update | `service.ts:194-199` (application_id, work_request_id, rejection_reason) | Applicant worker | Fire-and-forget; failure swallowed |
| `APPLICATION_ACCEPTED` `[TARGET: retired]` | backend-work-applications | approve tx post-commit | `service.ts:299-304` (application_id, work_request_id) | Applicant worker | Post-commit; failure swallowed; UNTESTED |
| `ASSIGNMENT_CONFIRMED` | backend-work-applications | approve tx post-commit | `service.ts:306-311` (assignment_id, work_request_id) | Applicant worker | Post-commit; failure swallowed; UNTESTED |

Declared-but-NEVER-emitted `NotificationType` values relevant to this capability (`schema.prisma:89-111`):
`WORK_REQUEST_CANCELLED`, `WORK_REQUEST_EXPIRING_SOON`, `APPLICATION_WITHDRAWN`, `ASSIGNMENT_CANCELLED`,
`SHIFT_REMINDER`, `CHECK_IN_REMINDER` — no code path emits these (superseded: target redesigns
notifications push-only, CONFIRMED §18; application-type notifications retired with TREQ-011).

`[TARGET]` New notification triggers implied by confirmed behavior (unbuilt): broadcast "job available"
to eligible workers (TREQ-003), "requirement fulfilled" to losers (TREQ-005), 6h auto-close manager
notification (TREQ-006). Channel is push-only (CONFIRMED §18). **The sick/vacation manager notification
is Calendar's, not this module's** (`ADR-021`, Correction v0.3.1) — this module's only sick/vacation-adjacent
action is consuming `EVT-CAL-SickVacationMarked` to cancel the assignment (`TREQ-009`); it sends no
notification for that event.

## Dependencies

`[CURRENT]` existing DEPENDENCY_GRAPH edges referenced (no new backend edges proposed by this spec):

| Dependency/edge | Reason | Contract | Compatibility | Failure behavior |
|---|---|---|---|---|
| `edge-work-requests-notifications`, `edge-work-applications-notifications` | Roster/review notifications | `notificationService.sendNotification` | baseline/UNKNOWN | Best-effort; swallowed (RULE-012) |
| `edge-work-requests-reads-hotel` | Hotel existence/soft-delete at create | Prisma read `state-hotel` | baseline/UNKNOWN | Missing/deleted -> NotFoundError |
| `edge-work-requests-reads-hotel-worker`, `edge-work-applications-reads-hotel-worker`, `edge-assignments-reads-hotel-worker` | Roster scoping + apply precondition | Prisma read `state-hotel-worker` | baseline/UNKNOWN | No ACTIVE membership -> empty/Forbidden |
| `edge-work-requests-reads-work-application` | my_application embed | Prisma read `state-work-application` | baseline/UNKNOWN | Absent -> null |
| `edge-work-applications-reads-work-request` | Status/version checks | Prisma read `state-work-request` | baseline/UNKNOWN | Missing -> NotFoundError |
| `edge-work-applications-reads-worker-overall-rating` | Apply-time snapshot | Prisma read `state-worker-overall-rating` | baseline/UNKNOWN | Absent -> null snapshot |
| `edge-work-applications-writes-work-request` | Slot claim + fill recompute in accept tx | Prisma write `state-work-request` (cross-owner) | baseline/UNKNOWN; coupling FIND-ARCH-003 (MOOT in target) | Rolls back whole tx on conflict |
| `edge-work-applications-writes-worker-assignment` | Assignment creation in accept tx | Prisma write `state-worker-assignment` (cross-owner) | baseline/UNKNOWN; MOOT in target | Rolls back whole tx |
| `edge-work-applications-writes-attendance` | EXPECTED attendance pre-creation | Prisma write `state-attendance` (cross-owner) | baseline/UNKNOWN; MOOT in target | Rolls back whole tx |
| `edge-attendance-reads-worker-assignment`, `edge-quality-reads-worker-assignment`, `edge-analytics-reads-*` | Downstream consumers of owned state | Prisma reads | baseline/UNKNOWN | Consumer-side |

`[CURRENT]` client consumers of the inbound endpoints (FIND-DEP-002 — recorded for completeness):
- `frontend-web` (Next.js manager/admin web app) consumes work-request/assignment endpoints.
- `mobile-worker-app` (Expo/RN Employee App) consumes work-request and application endpoints — notably the apply/list-my-application path (`mobile/worker-app/src/lib/api.ts:173-181`; `app/job/[id].tsx:36,57`). The corresponding `edge-mobile-worker-work-applications` edge is MISSING from DEPENDENCY_GRAPH (FIND-DEP-001) — proposed as a knowledge delta below. These consumers are the reason WorkApplication removal (TREQ-011) is a breaking change (mitigated by being pre-launch, PIVOT §10).

`[TARGET]` new dependencies (unbuilt):
- **Redis** — broadcast slot locks / first-accept arbitration; non-critical, with a DB `SELECT..FOR UPDATE` fallback (PIVOT §5.5, §5.7, §7.3). New runtime dependency for this capability.
- **New models** — `CalendarEntry` (per-worker per-day **assignment kind only** — sick/vacation is Calendar's own `state-calendar-absence` model, owned by `backend-calendar` per `ADR-021`, Accepted 2026-07-19, Correction v0.3.1) and `JobRequest` (broadcast; skills×headcount; 6h auto-close), PIVOT §9.3; plus the daily-exclusivity partial unique index (PIVOT §9.4), both owned and enforced by this capability.
- **Scheduled jobs** — job-request auto-close (6h) via node-cron / BullMQ on Redis (PIVOT §5.6).
- **`EVT-CAL-SickVacationMarked` (consumed)** — published by `backend-calendar` (`SPEC-CALENDAR-001`); triggers this module's same-day assignment cancellation (`TREQ-009`/`TRULE-008`). Contract `[OPEN]`; event-driven, not a cross-module transaction (`ADR-021`, Correction v0.3.1).
- Architecture anchors: modular-monolith (ADR-003, PIVOT §5.1/§11) and Prisma-over-PostgreSQL (ADR-004, PIVOT §2.1/§11) are retained.

## State and Lifecycle

`[CURRENT STATE]` state machines (@f37a39b):

**WorkRequest state machine** (`work-requests/service.ts:15-19`; `schema.prisma:38-45`):
- Entry: create -> DRAFT (default) or -> OPEN (direct publish).
- Manual: DRAFT->OPEN (stamps published_at, fans out publish notification, increments version); DRAFT->CANCELLED; OPEN->CANCELLED; PARTIALLY_FILLED->CANCELLED (stamps cancelled_at + reason, increments version).
- System (accept pipeline): OPEN/PARTIALLY_FILLED -> PARTIALLY_FILLED or FILLED (stamps filled_at) via slot recompute.
- External: -> EXPIRED via scheduled job absent from repo (RESOLVED-BY-TARGET: 6h auto-close, TREQ-006).
- Terminal-ish: CANCELLED, FILLED, EXPIRED have no outgoing manual transition. CANCELLED does not cascade (REQ-011/OQ-03).
- Invariants: RULE-006 (capacity CHECK), version optimistic lock on status-changing writes only.

**WorkApplication state machine** `[TARGET: model removed]` (`schema.prisma:47-53`; `work-applications/service.ts`):
- Entry: apply -> PENDING (new row, or reused WITHDRAWN row reset to PENDING).
- PENDING -> ACCEPTED (approve tx), REJECTED (stamps review + reason), WITHDRAWN (worker or mgmt).
- WITHDRAWN -> PENDING (re-apply reuse). ACCEPTED/REJECTED terminal in-code.
- EXPIRED enum value declared but UNREACHABLE. Update guarded to PENDING only (RULE-003).

**WorkerAssignment state machine** (`assignments/service.ts:6-9`; `schema.prisma:55-62`):
- Entry: `[CURRENT]` created CONFIRMED only by the accept transaction (RULE-009); `[TARGET]` created directly from calendar/broadcast (TREQ-012).
- CONFIRMED -> IN_PROGRESS (started_at) or CANCELLED (cancelled_at + reason).
- IN_PROGRESS -> COMPLETED (completed_at) or CANCELLED.
- COMPLETED and CANCELLED are terminal. NO_SHOW and REASSIGNED declared but UNREACHABLE. `previous_assignment_id` reassignment chain exists in schema but no service writes it (superseded — no reassignment flow in target).

**Concurrency (`[CURRENT]` optimistic version model):** Slot claim uses
`updateMany WHERE id AND version=known AND workers_confirmed<workers_needed`, incrementing both
`workers_confirmed` and `version`; a returned count of 0 (lost race or full) raises ConflictError and
aborts the transaction (`work-applications/service.ts:219-230`). Active double-booking is additionally
prevented by the DB partial unique index (RULE-010). `[TARGET]` concurrency arbitration moves to a Redis
slot lock (first-accept wins, earliest-timestamp tie-break), with a DB `SELECT..FOR UPDATE` fallback
(TRULE-003; PIVOT §5.5, §5.7).

**`[CURRENT]` Atomic 7-step accept transaction** (`work-applications/service.ts:217-290`): (1) optimistic
slot claim; (2) mark application ACCEPTED; (3) create CONFIRMED WorkerAssignment with mandatory
application_id; (4) pre-create EXPECTED Attendance with denormalized window; (5) re-read WorkRequest;
(6) set FILLED+filled_at or PARTIALLY_FILLED; (7) return accepted app + assignment. Two notifications fire
AFTER commit. Any step's throw rolls back all writes including the cross-owner writes.
`[MIGRATION GAP]` This entire transaction is removed in the target (TREQ-011/012).

**`[TARGET]` direct-assignment + broadcast flow** (PIVOT §5.5, §7.2, §7.3; CONFIRMED §13): (a) Calendar —
manager writes a `CalendarEntry`/assignment directly; no acceptance; subject to daily exclusivity
(TRULE-006). (b) Broadcast — manager raises a `JobRequest` (skill×headcount); system computes eligible
workers (skill ∧ free that day); targeted push; first accept acquires a Redis slot lock and creates the
`WorkerAssignment`; losers get "requirement fulfilled"; 6h timer or manual action closes the request.
Per CONFIRMED §13 there is **no formal job-status state machine** in the target (Open→Assigned→InProgress
removed); remaining status handling is manual (TREQ-013).

**Retention/migration:** `[CURRENT]` Rows persist; no soft-delete on these three models. Schema governed by
`20260613120000_v2_marketplace_init` (SP-3/SP-5/SP-9 constraints). `[TARGET]` forward refactor, no data
migration (pre-launch, PIVOT §10); Phase 1 removes `WorkApplication` and repoints `WorkerAssignment`.

## Failure, Security, Privacy, and Performance

**Failure modes/recovery:** `[CURRENT]` Conflict/validation/not-found/forbidden surface as typed HTTP
errors. Accept-transaction failures roll back atomically. Notification delivery failures are swallowed
and never roll back (RULE-012) — a published request or accepted application can succeed while its
notification is silently lost. `[TARGET]` broadcast concurrency resolved by Redis lock (first-accept);
Redis-down degrades to a short DB transaction lock (PIVOT §5.7).

**Trust boundaries/authorization:** `[CURRENT]` Route RBAC guards create/patch work-request
(admin,manager) and apply (worker). Read scoping is enforced in-service by roster membership/ownership
(RULE-011a-e). CRITICAL GAP (FIND-SEC-001): `PATCH /assignments/:id` has NO route-level role guard AND
no service-level ownership/role/hotel check — any authenticated user can transition ANY assignment; the
route comment claiming "service-level guards" is inaccurate (FIND-SEC-005). This is exploitable NOW.
Create/patch work-request have role but NO hotel-scoping — any admin/manager acts on any hotel
(FIND-SEC-002/003, cross-tenant, High). `[TARGET]` direction RESOLVED: two-dimensional role × scope,
deny-by-default, Regional Manager added, cross-hotel only within Hotel Group (TREQ-008/TRULE-007). The
residual questions (remediate current defects pre-pivot vs accept-risk until Phase 1 removes/replaces the
flow) are carried as open decisions below. This spec does NOT invent the missing current-state rule.

**Data classification/retention:** `[CURRENT]` Applications carry a `worker_rating_snapshot` (worker
performance data) and `cover_note` (worker-authored). Audit rows persist actor id/role and entity ids for
every mutation (immutable, retained 5y per CONFIRMED §30). `[TARGET]` assignment feeds attendance whose
clock coordinates carry a 6-month TTL (CONFIRMED §17; separate capability).

**Performance budgets/workload:**
- **No explicit budgets or SLOs are defined in code or authority docs.** `[ESCALATION]` No SLO for dispatch/accept latency or broadcast fan-out is defined; setting one is a human decision, currently blocked on ownership (SYNC-001). Recorded per FIND-PERF-004; see open decisions.
- Workload assumptions (FIND-PERF-004, explicit, unconfirmed): roster size per hotel and concurrent-accept volume are UNKNOWN; single-tenant-per-client deployment (PIVOT §5.1) suggests modest scale, but no figures are confirmed.
- FIND-PERF-001 (owned capacity risk): publish fan-out issues one notification per ACTIVE roster worker in parallel (`Promise.all`, `work-requests/service.ts:222-250`) and is **awaited on the request path** — cost is O(roster); large rosters degrade publish latency. `[TARGET]` broadcast targets only eligible (skill ∧ free) workers, bounding fan-out.
- FIND-PERF-002 (contention): concurrent multi-slot accepts serialize on the single-row optimistic `updateMany`; losers get ConflictError with **no server-side retry** — clients must retry. `[TARGET]` Redis slot lock changes this arbitration (TRULE-003); retry semantics for the target path are undefined and should be specified at M2.
- FIND-PERF-003 (Low, tracked): redundant in-transaction `findUnique` re-read of WorkRequest before fill recompute (`work-applications/service.ts` step 5).
- FIND-PERF-005 (Low, tracked): list endpoints use offset pagination with an unindexed `created_at` sort; may degrade on large tables.
- Hot-path index `@@index([hotel_id, status, shift_date])` (`schema.prisma:273`) supports open-shift queries. `[TARGET]` PIVOT §9.4 adds `(skill, hotel_id)` + availability indexing for fast eligible-worker computation.

**Observability/audit:** Every mutation calls `BaseService.logAudit` -> AuditLog
(CREATE/UPDATE/APPLY/APPLICATION_*/UPDATE_ASSIGNMENT). No metrics/tracing observed. Responses carry
`request_id` in `meta`.

## Rollout and Compatibility

`[CURRENT]` Behavior is already deployed at `f37a39b`; the current-state layer is a reverse specification,
not a change. Schema/constraints are established by migration `20260613120000_v2_marketplace_init`
(CHECK `migration.sql:564-566`, partial unique index `migration.sql:580-582`). No feature flags observed
for these modules today.

`[TARGET]` Migration strategy (PIVOT §10) — a **forward refactor**, not a dual-running migration, because
the system is **pre-launch with no production employee data**:
- **Phase 1 — Foundation realignment:** add Regional Manager role + scope to auth/RBAC; refactor the
  success envelope behind `sendSuccess()`/`sendPaginated()`; **REMOVE `WorkApplication`**; repoint
  `WorkerAssignment` to direct creation; re-label the schema off "marketplace".
- **Phase 2 — Core dispatch:** Calendar + daily exclusivity + sick/vacation auto-cancel; Broadcast
  JobRequest + Redis slot lock + 6h auto-close.
- **Feature-flagged:** each new module gated by the existing `FEATURE_*` env convention; partial deploys
  are safe.
- **Backward compatibility:** the **only breaking change is the removal of `WorkApplication`**, done in
  Phase 1 **before any client depends on it** (pre-launch).
- **Rollback:** because phases are additive and pre-launch, rollback = disable the flag + redeploy the
  prior build.
- **Success criteria per phase (PIVOT §10, §12):** module tests green; envelope conformance passes;
  RBAC/scope tests pass; concurrency + exclusivity tests pass at M2.

### `[MIGRATION GAP]` enumeration (current code vs target authority)

| Gap ID | Current state (evidence) | Target requirement (evidence) | Phase |
|---|---|---|---|
| MIG-GAP-01 | `WorkApplication` model + apply/list/review endpoints implemented (`work-applications/*`; `schema.prisma:279`) | Remove `WorkApplication` and all worker-initiated application endpoints (PIVOT §5.5, §9.2; CONFIRMED §34, §37) — TREQ-011 | 1 (breaking) |
| MIG-GAP-02 | `WorkerAssignment` requires mandatory `application_id` FK (`schema.prisma:324-327`; `work-applications/service.ts:243`) | Drop `application_id`; create assignment directly from calendar/broadcast (PIVOT §9.1) — TREQ-012 | 1 |
| MIG-GAP-03 | No calendar direct-assignment path (`calendar` module is non-dispatch; no `CalendarEntry`) | Manager places workers per day, no accept step; new `CalendarEntry` (PIVOT §4.4, §7.2, §9.3; CONFIRMED §13) — TREQ-001 | 2 |
| MIG-GAP-04 | Marketplace `WorkRequest` (publish + apply) is the only fan-out (`work-requests/service.ts:222-250`) | Repurpose as broadcast `JobRequest` (skill×headcount; eligibility skill ∧ free; "requirement fulfilled") (PIVOT §7.3, §9.1; CONFIRMED §13) — TREQ-002/003/005 | 2 |
| MIG-GAP-05 | `position` is free text (`schema.prisma:236-260`; `CreateWorkRequestSchema`) | Skills constrained to enum {Cleaner, Public Service, Kitchen Dishwasher, Waiter} (CONFIRMED §4) — TREQ-010 | 2 |
| MIG-GAP-06 | Slot arbitration via single-row optimistic `updateMany` (`work-applications/service.ts:219-230`); no Redis | First-accept via Redis slot lock, DB `FOR UPDATE` fallback (PIVOT §5.5, §5.7, §7.3) — TREQ-004 | 2 |
| MIG-GAP-07 | Roles admin/manager/worker/checker; managers NOT hotel-scoped (`work-requests/routes.ts:18,21`; no scope check) | role × scope, deny-by-default; new Regional Manager; Hotel Manager one-hotel; cross-hotel within group; JWT scope (PIVOT §5.3, §5.4; CONFIRMED §1, §11, §12) — TREQ-008 | 1 (role), 2 (scope) |
| MIG-GAP-08 | Partial unique index keyed on active (request,worker) (`migration.sql:580-582`) | Re-key: one active assignment per worker per DAY (daily exclusivity) (PIVOT §9.4) — TREQ-007 | 2 |
| MIG-GAP-09 | EXPIRED via external job absent from repo; `expires_at` arbitrary (`work-requests/service.ts:13-14`) | 6h auto-close scheduled job + manual close (PIVOT §4.4, §5.6) — TREQ-006 | 2 |
| MIG-GAP-10 | No same-day assignment auto-cancel path | On consuming Calendar's `EVT-CAL-SickVacationMarked` (Calendar-owned `state-calendar-absence` mark; Calendar sends the manager notification), cancel the same-day assignment (PIVOT §7.2; CONFIRMED §22) — TREQ-009. **Amended by `ADR-021`** (Correction v0.3.1): no longer a cross-module atomic transaction; event-driven, eventual convergence. | 2 |
| MIG-GAP-11 | `PATCH /assignments/:id` unguarded — any authenticated user drives any assignment (`assignments/service.ts:83-118`; `routes.ts:14`) | Assignment actions behind role × scope, deny-by-default (PIVOT §5.4) — TREQ-008; current-state CRITICAL (FIND-SEC-001) | 1/2 (see open decision) |
| MIG-GAP-12 | Marketplace framing + WorkRequest/Assignment status machine (DRAFT/OPEN/PARTIALLY_FILLED/FILLED; CONFIRMED/IN_PROGRESS/COMPLETED) | Re-label off "marketplace"; no formal job-status state machine (CONFIRMED §13; PIVOT §10 Phase 1) — TREQ-013 | 1 |

## Validation Plan

`[CURRENT STATE]` criteria:

| Criterion | Test level/check | Environment/data | Evidence required |
|---|---|---|---|
| REQ-001/002/003 create paths | Unit/integration | `work-requests.test.ts` | Persisted status + published_at; NotFound on bad hotel |
| REQ-008 terms-locked-when-OPEN (RULE-002) | Integration | seeded OPEN request | PATCH ignores term fields, 200, unchanged terms |
| REQ-009/010/014 transitions + version | Integration | seeded requests per state | ConflictError on illegal; cancelled_at/version increments |
| REQ-011 cancel non-cascade (RULE-001) | Integration | request with assignment | assignment/attendance/workers_confirmed unchanged after cancel |
| REQ-016/017/018 read scoping (RULE-011a/b) | Integration | rostered vs non-rostered actors | empty/Forbidden as specified; my_application embed |
| REQ-021/022/023/024 apply guards (RULE-003/004/011e) | Integration | roster + duplicate/WITHDRAWN rows | Conflict/Forbidden; row reuse on re-apply |
| REQ-025/026 snapshot + notify | Integration | worker with/without rating | snapshot value; APPLICATION_RECEIVED attempted |
| REQ-029/030/031 update guards (RULE-003/005) | Integration | PENDING vs non-PENDING; worker vs mgmt | Conflict/Forbidden; reject notify |
| REQ-034 slot claim + conflict (RULE-006) | Integration + concurrency | concurrent approves on capacity-1 request | one success, one ConflictError | **CURRENTLY UNTESTED — FIND-BRV-006** |
| REQ-035-039 accept transaction (RULE-007/009/012) | Integration | OPEN request + PENDING app | ACCEPTED app, CONFIRMED assignment, EXPECTED attendance, FILLED/PARTIALLY_FILLED, 2 notifications | **CURRENTLY UNTESTED — FIND-BRV-006** |
| REQ-033 approve-on-closed (RULE-003 approve-side) | Integration | CANCELLED/FILLED request | ConflictError | **CURRENTLY UNTESTED — FIND-BRV-009** |
| REQ-040 assignment lifecycle (RULE-008) | Integration | assignments per state | timestamps set; Conflict on illegal/no-op |
| REQ-041 assignment read scoping (RULE-011c/d) | Integration | owner/member/other | own-only list; Forbidden getById |
| REQ-042 active double-booking (RULE-010) | DB/integration | two active rows same (request,worker) | DB rejects second active row | **UNTESTED via accept path — FIND-BRV-006** |
| REQ-043 capacity CHECK (RULE-006) | DB constraint test | forced over-fill | CHECK violation | **UNTESTED — FIND-BRV-006** |
| Authorization on PATCH /assignments (FIND-SEC-001) | Security test (to add) | arbitrary authenticated user | MUST fail once rule exists — no rule/test today |

`[TARGET STATE]` criteria (to be authored at M2; recorded as expectations, not yet executable):
TREQ-004 concurrency (exactly one winner under concurrent last-slot accepts, Redis + DB-fallback paths);
TREQ-007 daily-exclusivity DB rejection; TREQ-008 role×scope deny-by-default + cross-group denial;
TREQ-009 event-driven sick/vacation same-day cancel (on consuming `EVT-CAL-SickVacationMarked`, `ADR-021`); TREQ-006 6h auto-close job. Success gates per PIVOT §10/§12.

## Risks, Assumptions, and Open Decisions

Genuine remaining human-authority items (status OPEN). Most prior current-state OQs are resolved by the
confirmed target authority and are recorded as RESOLVED-BY-TARGET / SUPERSEDED below (traceability only).

| ID | Type | Description | Evidence/impact | Owner | Resolution/status |
|---|---|---|---|---|---|
| OQ-01 / FIND-SEC-001 | decision | `PATCH /assignments/:id` has NO authz guard — any authenticated user can drive any assignment lifecycle; exploitable NOW. Target direction resolved (role × scope, TREQ-008), but the current code is live-vulnerable. Decision: remediate the current Critical immediately vs accept-risk until Phase-1 pivot removes/replaces the flow. | `assignments/service.ts:83-118`; `routes.ts:14`. Severity **CRITICAL** (raised from HIGH per FIND-SEC-006). | human/unassigned | **OPEN — CRITICAL** |
| FIND-SEC-002/003 | decision | Work-request create/patch and application approve/reject are role-guarded but NOT hotel-scoped -> cross-tenant. Target REQUIRES scope (TREQ-008/TRULE-007, resolving the "should managers be scoped" question). Residual decision: remediate the current cross-tenant defect pre-pivot vs accept-risk until Phase-1/2 scope lands. | `work-requests/routes.ts:18,21` + no hotel-membership check. Severity High (current-state). | human/unassigned | **OPEN — High** |
| SYNC-001 / FIND-ARCH-002 | decision | All module/state/contract owners are `unassigned` (no CODEOWNERS; empty package author). PIVOT §13 names a lead (Mayank) as corroborating, but the authoritative knowledge-layer (MODULE_REGISTRY/CODEOWNERS) encoding is a human action. Blocks accountable ownership and SLO-setting. | MODULE_REGISTRY.yaml header; DEPENDENCY_GRAPH nodes; PIVOT §13 | human | **OPEN** |
| FIND-ARCH-003 | decision | The current cross-owner accept-transaction coupling (3 state domains) warrants either a Decision Record OR an explicit "superseded-by-pivot" record (the coupling is MOOT in target since the flow is removed). Which to record is a human/architecture call. | `work-applications/service.ts:219,243,256`; DEPENDENCY_GRAPH cross-owner write edges; PIVOT §5.5/§9.1 | human/architecture | **OPEN** |
| ESC-PERF-01 / FIND-PERF-004 | decision | No performance SLO is defined for dispatch/accept latency or broadcast fan-out, and workload figures (roster size, concurrent-accept volume) are unconfirmed. Setting an SLO is a human decision, currently blocked on ownership (SYNC-001). | Code has no budgets; PIVOT/CONFIRMED define none. | human/unassigned | **OPEN — escalation** |

RESOLVED-BY-TARGET / SUPERSEDED (moved out of open decisions; retained for traceability):

| Prior ID | Prior description | Resolution |
|---|---|---|
| OQ-04 | EXPIRED transition owner/job unknown | RESOLVED-BY-TARGET: 6h auto-close scheduled job (TREQ-006; PIVOT §5.6). Current absence = MIG-GAP-09. |
| OQ-05 | Accept-tx cross-owner coupling approved? | RESOLVED-BY-TARGET: MOOT — accept tx and `WorkApplication` removed; assignment created directly (TREQ-011/012; PIVOT §5.5). Current-state architecture observation only (see FIND-ARCH-003 for the record type). |
| OQ-06 | REJECTED applicant permanently barred? | RESOLVED-BY-TARGET: MOOT — applications removed (TREQ-011). |
| OQ-07 | Create/patch not hotel-scoped — intended? | RESOLVED-BY-TARGET: hotel/group scoping is REQUIRED (TREQ-008/TRULE-007; PIVOT §5.4). Current lack = MIG-GAP-07 + current-state FIND-SEC-002/003 (residual remediation decision above). |
| OQ-02 / OQ-03 | Assignment cancel / request cancel cascade semantics | PARTIALLY RESOLVED-BY-TARGET: on consuming Calendar's `EVT-CAL-SickVacationMarked`, this module auto-cancels the same-day assignment (TREQ-009/TRULE-008; PIVOT §7.2; event-driven per `ADR-021`, not a cross-module atomic transaction). Broader broadcast slot reopen semantics are a target design detail for M2; no marketplace PARTIALLY_FILLED in target. |
| OQ-08 | NO_SHOW/REASSIGNED/EXPIRED enums unreachable | SUPERSEDED: target has no formal job-status state machine (TREQ-013; CONFIRMED §13). |
| OQ-09 | `previous_assignment_id` reassignment chain unused | SUPERSEDED: no reassignment flow in target; assignment creation reworked (TREQ-012). |
| OQ-10 | Declared-but-unemitted marketplace NotificationTypes | SUPERSEDED: notifications redesigned push-only (CONFIRMED §18); application types retired with TREQ-011. |
| OQ-11 | DRAFT term edits unguarded by version | SUPERSEDED: WorkRequest repurposed as JobRequest; marketplace DRAFT/term model retired (MIG-GAP-12). |
| OQ-12 | Migration CHECK + active-slot unique index back REQ-042/043 | RESOLVED (High) at v0.1.0. Note: the active-slot index is re-keyed per-day in target (MIG-GAP-08). |

Assumptions:

| ID | Type | Description | Evidence | Status |
|---|---|---|---|---|
| ASM-01 | assumption | Current code roles are `admin`, `manager`, `worker`, `checker` (management = admin+manager); role tokens are lower-cased guard strings mapped from UPPER-CASE `UserRole` enum (FIND-CONS-001). | `work-requests/service.ts:100,148`; Prisma `UserRole` | Assumption for current-state; target role model authoritatively defined (CONFIRMED §1). |

## Proposed Knowledge Deltas

Proposed only — NOT applied. Application requires the appropriate synchronization gate.

- **MODULE_REGISTRY.yaml:** set `specification` for `backend-work-requests`, `backend-work-applications`,
  and `backend-assignments` from `UNKNOWN` -> `SPEC-JOB-DISPATCH-001@0.2.0 (REVIEW)`. Do not alter `owner`
  (remains `unassigned`, SYNC-001; PIVOT §13 lead noted as corroborating only).
- **DEPENDENCY_GRAPH.yaml (proposed):**
  - ADD missing edge `edge-mobile-worker-work-applications` (mobile-worker-app -> `state-work-application` /
    apply endpoints), evidence `mobile/worker-app/src/lib/api.ts:173-181`, `app/job/[id].tsx:36,57`
    (FIND-DEP-001). This edge is retired when TREQ-011 lands, but the graph must reflect current reality.
  - NOTE (future, do not add yet): target introduces Redis (broadcast slot locks), and new `CalendarEntry`
    and `JobRequest` state domains + a 6h auto-close scheduled job (PIVOT §5.5, §5.6, §9.3). The current
    cross-owner accept-tx write edges become removable when the accept flow is deleted (Phase 1).
  - ADD (per `ADR-021`, Correction v0.3.1): this capability **consumes** `EVT-CAL-SickVacationMarked`
    (published by `backend-calendar`) to drive `TREQ-009`/`TRULE-008`'s same-day assignment cancellation.
    Mirrors `SPEC-CALENDAR-001`'s own publisher-side proposed delta so the bidirectional edge has a
    proposal from both endpoints; contract `[OPEN]` (OD-CAL-08), target-plane only, no code yet.
- **TERMINOLOGY.md:** promote to canonical: `Work request`, `Work application` (mark "current-state,
  retired in target"), `Assignment` (WorkerAssignment), `Roster`, `Slot`. ADD role-token case mapping
  (`UserRole.WORKER` == guard `'worker'`, etc., FIND-CONS-001) and standardized verb note (worker
  "submit"; manager "accept/approve", FIND-CONS-002). ADD new target terms: `Hotel Group`,
  `Regional Manager`, `Hotel Manager`, `Scope`, `Broadcast / JobRequest`, `Calendar direct assignment`,
  `Daily exclusivity`, `Skill` — sourced to PIVOT §4.x/§5.4/§14 and CONFIRMED §1/§4/§12/§13.
- **DECISION_INDEX.md:** reference ADR-003 (modular monolith, PIVOT §5.1/§11) and ADR-004 (Prisma ORM,
  PIVOT §2.1/§11) as existing anchors (FIND-ARCH-004). A NEW Decision Record MAY be requested by
  architecture/human for the current cross-owner accept-tx coupling, OR that coupling recorded as
  "superseded-by-pivot" (FIND-ARCH-003) — proposed, not created here.
- **SYNC_STATE.yaml:** none proposed by the author; the synchronization owner records spec issuance if/when
  this candidate advances.

## Review and Change Log

| Version | Date | Change | Findings resolved | Approver |
|---|---|---|---|---|
| 0.1.0 | 2026-07-06 | Initial current-state reverse specification at `f37a39b`. REQ-001..043, RULE-001..013 (RULE-011 split 011a-e). Folded FIND-BRV-003/004/005/007/008; recorded FIND-BRV-006/009 UNTESTED. Carried OQ-01..OQ-11 + SYNC-001; OQ-12 resolved. | FIND-BRV-003/004/005/007/008 | None — REVIEW, not approved. |
| 0.2.0 | 2026-07-06 | Added Current/Target/Migration-Gap/Open-Decision separation. Added TARGET requirements TREQ-001..013, TARGET rules TRULE-001..009 (all cited to PIVOT/CONFIRMED); labeled current requirements/rules [CURRENT] and flagged RETIRED-by-pivot (RULE-003/004/007/009/011b/011e/013). Added MIGRATION GAP enumeration MIG-GAP-01..12. Reduced open decisions to 5 genuine human items; moved OQ-04/05/06/07 (and 02/03/08/09/10/11) to RESOLVED-BY-TARGET/SUPERSEDED. Folded author-fixable G4: FIND-ARCH-004 (ADR-003/004), FIND-ARCH-005/CONS-003 (revision reconciliation f37a39b vs 22569f0), FIND-DEP-002 (client consumers), FIND-DEP-003 (compatibility = baseline/UNKNOWN), FIND-CONS-001 (role-token case map), FIND-CONS-002 (verb standardization; REQ-021 "submitted"), FIND-SEC-006 (OQ-01 -> CRITICAL), FIND-PERF-001/002/003/004/005 (fan-out capacity, no-retry contention, no-SLO escalation, tracked lows). Proposed knowledge deltas updated (registry@0.2.0, FIND-DEP-001 missing edge, terminology promotions + target terms). | FIND-ARCH-004, FIND-ARCH-005, FIND-DEP-002, FIND-DEP-003, FIND-CONS-001, FIND-CONS-002, FIND-CONS-003, FIND-SEC-006, FIND-PERF-001, FIND-PERF-002, FIND-PERF-003, FIND-PERF-004, FIND-PERF-005 (author-fixable folded). Human-authority items (FIND-SEC-001/002/003, FIND-ARCH-001/002/003, FIND-BRV-001/006/009) carried as open decisions/notes. | None — status REVIEW, G2 freeze reserved to human. |
| 0.3.1 | 2026-07-19 | **Correction, amending the FROZEN v0.3.0** per `ADR-021` (Calendar↔Job-Dispatch scheduling-ownership boundary, Accepted 2026-07-19). `SPEC-CALENDAR-001@0.2.0`'s G4 Dependency re-review (`SYNC-042`) found this document's `CalendarEntry`/`TREQ-009`/`TRULE-008`/notification text contradicted `ADR-021`'s "Job Dispatch unchanged" premise: `CalendarEntry` was defined here as "assignment/sick/vacation" (overlapping Calendar's new `state-calendar-absence`); the sick/vacation auto-cancel was modeled as this module's own atomic single transaction with zero declared consumed events (contradicting Calendar's event-driven design); and this module claimed to publish the sick/vacation manager notification Calendar now owns. Narrowly reconciled exactly those three points: `CalendarEntry` scoped to the assignment kind only (Dependencies); `TREQ-009`/`TRULE-008` changed from an atomic transaction to consumption of Calendar's `EVT-CAL-SickVacationMarked` (Requirements, Business Rules, Events, `MIG-GAP-10`, Validation Plan, `OQ-02/03`); the sick/vacation manager notification ceded to Calendar (Events). No other requirement, rule, interface, security finding, or open decision touched; the Critical/High security findings and all other open decisions carry forward unchanged. Status remains `FROZEN` — this is a narrow reconciliation of an already-ratified boundary decision (`ADR-021`), not a re-opening of unresolved scope, authorized by the same G2 authority extended via this session's explicit "amend the frozen spec" direction. | `FIND-DEP-001`, `FIND-DEP-002`, `FIND-DEP-003` (all from `SPEC-CALENDAR-001`'s G4 re-run) | Commissioning human (2026-07-19) |
