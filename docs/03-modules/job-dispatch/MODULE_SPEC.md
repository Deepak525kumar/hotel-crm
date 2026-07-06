# Module Specification: `job-dispatch` (backend-work-requests, backend-work-applications, backend-assignments)

> Current-state reverse specification of already-implemented behavior. Every material
> claim is bound to source at revision `f37a39b`. This document records observed
> behavior; it does not create product policy. All human-authority decisions are
> carried as explicit open decisions and are NOT resolved here.

## Document Control

| Field | Value |
|---|---|
| Spec ID / version | `SPEC-JOB-DISPATCH-001 / 0.1.0` |
| Status | `REVIEW` |
| Owner | `unassigned (SYNC-001, human authority required)` |
| Authors / reviewers | Author: Module Author agent. Reviewers (pending): Architecture, Dependency, Consistency, Security. |
| Repository revision | `f37a39bf8535973366f5b1ccc4f2ccbaa3c60090` (`f37a39b`), branch `claude/spec-freeze-job-dispatch-fuyxmw` |
| Approved by / at | Not approved. G2 freeze is reserved human authority; do NOT mark FROZEN. |
| Supersedes | None. First specification for these three modules (registry `specification: UNKNOWN`). |

## Purpose and Scope

**Outcome:** Define the observed contract for the marketplace dispatch flow: a hotel
publishes a shift (`WorkRequest`), rostered workers apply (`WorkApplication`), a
manager accepts an application which atomically creates a confirmed `WorkerAssignment`
and an `EXPECTED` `Attendance` row, and the assignment is driven through its lifecycle.

**In scope:**
- `backend/src/modules/work-requests/` (create, publish, list, get, patch, roster fan-out).
- `backend/src/modules/work-applications/` (apply, list, review: accept/reject/withdraw, 7-step accept transaction).
- `backend/src/modules/assignments/` (list, get, lifecycle transitions).
- Data contract for `WorkRequest`, `WorkApplication`, `WorkerAssignment`, and the migration-level CHECK and partial unique index that back the capacity/double-booking invariants.

**Out of scope:**
- `backend/src/modules/attendance/`, `.../quality/`, `.../notifications/` internals (referenced only as consumed/written state or delivery sink).
- The scheduled EXPIRED job (not present in repo — OQ-04).
- Rating computation (`WorkerOverallRating` is read-only here for the apply-time snapshot).

**Non-goals:** Requirements discovery, product-policy invention, code planning, independent review, or resolving any open decision below.

## Evidence and Traceability

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
| `REQ-013` EXPIRED set by external scheduled job (not in repo) | `work-requests/service.ts:13-14` (comment); no job in repo @f37a39b | Code + absence | Observed; owner open (OQ-04) |
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
| Cross-module writes inside accept tx (WorkRequest/WorkerAssignment/Attendance) | DEPENDENCY_GRAPH edges `edge-work-applications-writes-{work-request,worker-assignment,attendance}` (graph:116-136); `work-applications/service.ts:219,243,256,278,283` @f37a39b | Code + graph | Observed; coupling open (OQ-05) |

## Actors and Terminology

| Term/actor | Canonical definition | Source |
|---|---|---|
| Work request | A hotel-published shift opening carrying position, capacity (`workers_needed`), shift date/time window, and commercial terms; lifecycle DRAFT->OPEN/CANCELLED->PARTIALLY_FILLED/FILLED/EXPIRED. | `schema.prisma:236`; `work-requests/service.ts` (TERMINOLOGY promotion proposed) |
| Work application | A rostered worker's expression of interest in one work request; at most one live row per (request,worker); accepted applications are the sole gateway to an assignment. | `schema.prisma:279`; `work-applications/service.ts` |
| Assignment (WorkerAssignment) | A confirmed booking of a worker to a work request, created only from an accepted application (mandatory `application_id` FK), driven through CONFIRMED->IN_PROGRESS->COMPLETED / CANCELLED. | `schema.prisma:314`; `assignments/service.ts` |
| Roster | The set of `HotelWorker` memberships for a hotel; ACTIVE membership gates non-management visibility and the apply precondition. | `schema.prisma:206`; `work-requests/service.ts:101,135`; `work-applications/service.ts:50` |
| Slot | One unit of `workers_needed` capacity; claimed atomically at accept time via optimistic `updateMany` incrementing `workers_confirmed`. | `work-applications/service.ts:219-229`; `schema.prisma:243-244` |
| admin / manager (management) | Roles permitted to create/patch work requests and accept/reject applications; exempt from roster-scoping on reads. | `work-requests/routes.ts:18,21`; `work-applications/service.ts:122,167` |
| worker | Role permitted to apply and to withdraw own application; reads scoped to own resources/rostered hotels. | `work-applications/routes.ts:14`; `work-requests/service.ts:100,148` |
| checker | Non-management role treated as worker for read-scoping and `my_application` embedding. | `work-requests/service.ts:148` |

## Requirements and Acceptance Criteria

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
| REQ-013 | EXPIRED is set by an external scheduled job (absent from this repo). | Should | No in-repo path sets EXPIRED; documented as external. | RULE-001 |
| REQ-014 | version increments on each status-changing write. | Must | Any status change increments version by 1; term-only DRAFT edits do not. | RULE-001 |
| REQ-015 | Work requests can be listed with hotel_id/status/position/shift_date filters, paginated. | Must | List returns filtered, paginated data + pagination envelope. | RULE-011a |
| REQ-016 | Non-management list is scoped to hotels where the actor holds ACTIVE roster membership. | Must | Non-mgmt with no ACTIVE membership -> empty result; otherwise only rostered hotels. | RULE-011a |
| REQ-017 | getById returns NotFound if absent and Forbidden for non-mgmt without ACTIVE membership on the request's hotel. | Must | Missing -> NotFoundError; non-mgmt non-member -> ForbiddenError. | RULE-011a |
| REQ-018 | For worker/checker, getById embeds the latest my_application. | Should | DTO includes my_application (id,status,created_at) or null. | RULE-011b |
| REQ-019 | Create and patch are restricted to admin/manager. | Must | Other roles -> route-level 403 before service. | RULE-005 |
| REQ-020 | A worker applies to a work request via the nested endpoint. | Must | POST /work-requests/:id/applications creates a PENDING application, HTTP 201. | RULE-011e |
| REQ-021 | Applications are accepted only while the request is OPEN or PARTIALLY_FILLED. | Must | Apply to any other status -> ConflictError. | RULE-003 |
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
| REQ-042 | A worker cannot hold two active (CONFIRMED/IN_PROGRESS) assignments for the same request. | Must | Partial unique index rejects a second active row (DB-level). | RULE-010 |
| REQ-043 | workers_confirmed stays within [0, workers_needed]. | Must | CHECK constraint rejects any violating write. | RULE-006 |

## Business Rules

| Rule | Preconditions | Outcome/invariant | Exceptions/precedence | Owner/source |
|---|---|---|---|---|
| RULE-001 | Manual PATCH/create of a WorkRequest | Allowed manual transitions: create->DRAFT or ->OPEN(direct); DRAFT->{OPEN,CANCELLED}; OPEN->CANCELLED; PARTIALLY_FILLED->CANCELLED. FILLED/PARTIALLY_FILLED are system-driven; EXPIRED is external. Cancel stamps cancelled_at and does NOT cascade to assignments/attendance nor reopen. | Illegal transition -> ConflictError. Cascade/reopen policy is an open decision (OQ-03). | `unassigned (SYNC-001)`; `work-requests/service.ts:15-19,177-191` |
| RULE-002 | PATCH of a WorkRequest | Commercial/term fields are mutable IFF status==DRAFT. In any other state term fields are silently ignored (200, no error); only status may change. | Concurrent DRAFT term edits are unguarded by version (OQ-11). | `unassigned (SYNC-001)`; `work-requests/service.ts:196-209` |
| RULE-003 | Apply, or accept/reject/withdraw of an application | Applications are created/approved only while the request is OPEN or PARTIALLY_FILLED; updates require the application to be PENDING. | Otherwise ConflictError. Approve-on-closed is UNTESTED (FIND-BRV-009). | `unassigned (SYNC-001)`; `work-applications/service.ts:44-47,163-165,213-215` |
| RULE-004 | Apply to a request | At most one application per (request,worker); only a WITHDRAWN row may re-apply (row reused). | PENDING/ACCEPTED/REJECTED block re-apply -> ConflictError. REJECTED permanent lock is an open decision (OQ-06). | `unassigned (SYNC-001)`; `work-applications/service.ts:56-84`; `schema.prisma:301` |
| RULE-005 | Update of an application | A worker may only withdraw their own application; admin/manager may accept, reject, OR withdraw any pending application (worker-branch guards apply only when isWorker). | Route RBAC limits create/patch of requests and apply to management/worker respectively. | `unassigned (SYNC-001)`; `work-applications/service.ts:167-173`; `work-requests/routes.ts:18,21` |
| RULE-006 | Slot claim + all WorkRequest writes | Invariant 0 <= workers_confirmed <= workers_needed, enforced by app-layer predicate and DB CHECK. | Claim predicate returning count 0 -> ConflictError. | `unassigned (SYNC-001)`; `work-applications/service.ts:219-230`; `migration.sql:564-566` |
| RULE-007 | Accept transaction commit | FILLED (with filled_at) iff workers_confirmed>=workers_needed after claim; otherwise PARTIALLY_FILLED. | — | `unassigned (SYNC-001)`; `work-applications/service.ts:276-287` |
| RULE-008 | Update of an assignment | Lifecycle CONFIRMED->{IN_PROGRESS,CANCELLED}; IN_PROGRESS->{COMPLETED,CANCELLED}. COMPLETED and CANCELLED are terminal. Cancel stamps cancelled_at only — it does NOT decrement workers_confirmed nor reopen the request. | Illegal/no-op -> ConflictError. NO_SHOW and REASSIGNED are declared but UNREACHABLE (OQ-08); cancel side-effect is open (OQ-02). | `unassigned (SYNC-001)`; `assignments/service.ts:6-9,92-108`; `schema.prisma:55-62` |
| RULE-009 | Assignment creation | Every assignment traces to an accepted application via a non-null `application_id` FK (onDelete Restrict); no bypass path exists. | — | `unassigned (SYNC-001)`; `schema.prisma:324-327`; `work-applications/service.ts:243-253` |
| RULE-010 | Two active assignments for same (request,worker) | A worker may hold at most one CONFIRMED/IN_PROGRESS assignment per request. | DB partial unique index rejects the second active row. | `unassigned (SYNC-001)`; `migration.sql:580-582` |
| RULE-011a | Non-mgmt list/get of a WorkRequest | Requires ACTIVE HotelWorker membership on the request's hotel; management exempt. | List -> filtered/empty; getById non-member -> ForbiddenError. | `unassigned (SYNC-001)`; `work-requests/service.ts:98-112,134-144` |
| RULE-011b | Non-mgmt list of WorkApplications; my_application embed | Ownership only: a worker sees exactly their own application. | Non-owner sees nothing. | `unassigned (SYNC-001)`; `work-applications/service.ts:122-130`; `work-requests/service.ts:148-157` |
| RULE-011c | Non-mgmt getById of a WorkerAssignment | Permitted if actor is the assigned worker OR holds ACTIVE membership on the assignment's hotel. | Neither -> ForbiddenError. | `unassigned (SYNC-001)`; `assignments/service.ts:67-78` |
| RULE-011d | Non-mgmt list of WorkerAssignments | Ownership only: results forced to worker_id=self. | — | `unassigned (SYNC-001)`; `assignments/service.ts:41-45` |
| RULE-011e | Apply precondition (distinct from read-visibility) | Applying requires ACTIVE HotelWorker membership on the request's hotel. | Non-member -> ForbiddenError. | `unassigned (SYNC-001)`; `work-applications/service.ts:50-53` |
| RULE-012 | Any notification emission | Delivery is best-effort synchronous fire-and-forget; it never participates in or rolls back the originating transaction (all notifications sent post-commit / catch-swallowed). | Delivery failure is silent. | `unassigned (SYNC-001)`; `work-requests/service.ts:238-248`; `work-applications/service.ts:103,299` |
| RULE-013 | Apply time | Worker overall rating is snapshotted onto the application (null when none exists). | — | `unassigned (SYNC-001)`; `work-applications/service.ts:64-67` |

## Ownership and Boundaries

**Module owner:** `unassigned (SYNC-001, human authority required)`. No CODEOWNERS file exists and `backend/package.json` author is empty; owner assignment is reserved human authority and is NOT invented here.

**Owned state (per DEPENDENCY_GRAPH state-domains):**
- `state-work-request` (`schema.prisma:236`) — owned by backend-work-requests.
- `state-work-application` (`schema.prisma:279`) — owned by backend-work-applications.
- `state-worker-assignment` (`schema.prisma:314`) — owned by backend-assignments.

**Consumed state (read):**
- `state-hotel` (`work-requests/service.ts:53`) — hotel existence/soft-delete check.
- `state-hotel-worker` (`work-requests/service.ts:101,135,233`; `work-applications/service.ts:50`; `assignments/service.ts:69`) — roster membership for scoping and apply precondition.
- `state-worker-overall-rating` (`work-applications/service.ts:64`) — apply-time rating snapshot.
- `state-audit-log` (write, cross-cutting via BaseService) — audit trail.

**Permitted writes:** Each module writes its own owned state. NOTABLE cross-module write coupling (observed): the accept transaction in backend-work-applications WRITES state owned by other modules inside a single `$transaction`:
- `state-work-request` (owner backend-work-requests) — slot claim + fill recompute (`work-applications/service.ts:219,278,283`).
- `state-worker-assignment` (owner backend-assignments) — assignment creation (`work-applications/service.ts:243`).
- `state-attendance` (owner backend-attendance) — EXPECTED pre-creation (`work-applications/service.ts:256`).
These correspond to DEPENDENCY_GRAPH edges `edge-work-applications-writes-{work-request,worker-assignment,attendance}`. Whether this coupling is an approved architecture decision is an OPEN DECISION (OQ-05); it is documented here as observed behavior only, not endorsed as policy.

**Boundary/non-responsibilities:** This capability does not own attendance check-in/verification, quality verification, rating computation, or notification delivery mechanics. It does not implement the EXPIRED scheduled job. It does not perform hotel-scoping on create/patch (OQ-07) and performs NO ownership/role authorization on assignment updates (OQ-01).

## Interfaces and Contracts

Base router mounts at `v1/index.ts:26-28`. All routes require `authMiddleware`. Envelope: `{ status:"success", data, pagination?, meta:{timestamp,request_id} }`. Error types map to HTTP via the shared error layer: `ValidationError` (400, Zod field details), `NotFoundError` (404), `ForbiddenError` (403), `ConflictError` (409).

| Contract ID/version | Direction | Input | Output | Errors | Auth | Compatibility |
|---|---|---|---|---|---|---|
| `POST /work-requests` v1 | inbound | `CreateWorkRequestSchema` (hotel_id, position, workers_needed<=1000, shift_date YYYY-MM-DD, HH:MM times, hourly_rate?, currency(3)?, description?, requirements?, status DRAFT/OPEN, expires_at?) | 201 `WorkRequestDto` | ValidationError, NotFoundError(hotel) | requireRole(admin,manager) | Additive DTO; enums frozen to schema |
| `GET /work-requests` v1 | inbound | `ListWorkRequestsQuerySchema` (hotel_id?, status?, position?, shift_date?, page, per_page<=100) | 200 `WorkRequestDto[]` + pagination | ValidationError | any authenticated (service-scoped, RULE-011a) | Stable |
| `GET /work-requests/:id` v1 | inbound | path id | 200 `WorkRequestDto` (+my_application for worker/checker) | NotFoundError, ForbiddenError | any authenticated (RULE-011a) | Additive (`my_application` optional) |
| `PATCH /work-requests/:id` v1 | inbound | `UpdateWorkRequestSchema` (term fields?, status?, cancellation_reason?) | 200 `WorkRequestDto` | ValidationError, NotFoundError, ConflictError | requireRole(admin,manager) | Term fields silently ignored unless DRAFT (RULE-002) |
| `POST /work-requests/:id/applications` v1 | inbound | `ApplyWorkRequestSchema` (cover_note<=1000?) | 201 `WorkApplicationDto` | ValidationError, NotFoundError, ConflictError, ForbiddenError | requireRole(worker) | Stable |
| `GET /work-requests/:id/applications` v1 | inbound | `ListApplicationsQuerySchema` (status?, page, per_page<=100) | 200 `WorkApplicationDto[]` + pagination | ValidationError, NotFoundError | any authenticated (mgmt=all, worker=own; RULE-011b) | Stable |
| `PATCH /work-requests/:id/applications/:applicationId` v1 | inbound | `UpdateApplicationSchema` (status ACCEPTED/REJECTED/WITHDRAWN?, rejection_reason?, cancellation_reason?) | 200 `WorkApplicationDto` (ACCEPTED runs approve tx) | ValidationError, NotFoundError, ConflictError, ForbiddenError | any authenticated; service guards (worker=own withdraw only; mgmt=accept/reject/withdraw; RULE-005). NO route-level role guard. | Stable |
| `GET /assignments` v1 | inbound | `ListAssignmentsQuerySchema` (hotel_id?, work_request_id?, worker_id?, status?, page, per_page<=100) | 200 `AssignmentDto[]` + pagination | ValidationError | any authenticated (worker=own; RULE-011d) | Stable |
| `GET /assignments/:id` v1 | inbound | path id | 200 `AssignmentDto` | NotFoundError, ForbiddenError | any authenticated (RULE-011c) | Stable |
| `PATCH /assignments/:id` v1 | inbound | `UpdateAssignmentSchema` (status IN_PROGRESS/COMPLETED/CANCELLED?, cancellation_reason?) | 200 `AssignmentDto` | ValidationError, NotFoundError, ConflictError | any authenticated. **NO ownership/role/hotel authorization guard in route or service** (OQ-01, security-critical). | Stable transition table; authz gap unresolved |

DTO shapes: `WorkRequestDto` (`work-requests/types.ts:69-92`), `WorkApplicationDto` (`work-applications/types.ts:26-38`), `AssignmentDto` (`assignments/types.ts:23-37`).

## Events

No event bus exists (MODULE_REGISTRY `published_events: none-observed` for all three modules). "Events" below are synchronous, best-effort, fire-and-forget calls to `notificationService.sendNotification` — never transactional (RULE-012). Delivery failures are `.catch(() => {})`-swallowed.

| Event ID/version | Publisher | Trigger | Payload source | Consumers | Delivery/idempotency |
|---|---|---|---|---|---|
| `WORK_REQUEST_PUBLISHED` | backend-work-requests | DRAFT->OPEN publish commit | `service.ts:240-246` (work_request_id, hotel_id) | Each ACTIVE roster worker | Fire-and-forget; not idempotent; failure swallowed |
| `APPLICATION_RECEIVED` | backend-work-applications | apply() success | `service.ts:103-108` (application_id, work_request_id) | Request creator | Fire-and-forget; failure swallowed |
| `APPLICATION_REJECTED` | backend-work-applications | reject update | `service.ts:194-199` (application_id, work_request_id, rejection_reason) | Applicant worker | Fire-and-forget; failure swallowed |
| `APPLICATION_ACCEPTED` | backend-work-applications | approve tx post-commit | `service.ts:299-304` (application_id, work_request_id) | Applicant worker | Post-commit; failure swallowed; UNTESTED |
| `ASSIGNMENT_CONFIRMED` | backend-work-applications | approve tx post-commit | `service.ts:306-311` (assignment_id, work_request_id) | Applicant worker | Post-commit; failure swallowed; UNTESTED |

Declared-but-NEVER-emitted `NotificationType` values relevant to this capability (`schema.prisma:89-111`): `WORK_REQUEST_CANCELLED`, `WORK_REQUEST_EXPIRING_SOON`, `APPLICATION_WITHDRAWN`, `ASSIGNMENT_CANCELLED`, `SHIFT_REMINDER`, `CHECK_IN_REMINDER` — no code path emits these (OQ-10 covers cancel/withdraw types).

## Dependencies

No new edges proposed; the following existing DEPENDENCY_GRAPH edges are referenced.

| Dependency/edge | Reason | Contract | Compatibility | Failure behavior |
|---|---|---|---|---|
| `edge-work-requests-notifications`, `edge-work-applications-notifications` | Roster/review notifications | `notificationService.sendNotification` | Stable | Best-effort; swallowed (RULE-012) |
| `edge-work-requests-reads-hotel` | Hotel existence/soft-delete at create | Prisma read `state-hotel` | Stable | Missing/deleted -> NotFoundError |
| `edge-work-requests-reads-hotel-worker`, `edge-work-applications-reads-hotel-worker`, `edge-assignments-reads-hotel-worker` | Roster scoping + apply precondition | Prisma read `state-hotel-worker` | Stable | No ACTIVE membership -> empty/Forbidden |
| `edge-work-requests-reads-work-application` | my_application embed | Prisma read `state-work-application` | Stable | Absent -> null |
| `edge-work-applications-reads-work-request` | Status/version checks | Prisma read `state-work-request` | Stable | Missing -> NotFoundError |
| `edge-work-applications-reads-worker-overall-rating` | Apply-time snapshot | Prisma read `state-worker-overall-rating` | Stable | Absent -> null snapshot |
| `edge-work-applications-writes-work-request` | Slot claim + fill recompute in accept tx | Prisma write `state-work-request` (cross-owner) | OPEN (OQ-05) | Rolls back whole tx on conflict |
| `edge-work-applications-writes-worker-assignment` | Assignment creation in accept tx | Prisma write `state-worker-assignment` (cross-owner) | OPEN (OQ-05) | Rolls back whole tx |
| `edge-work-applications-writes-attendance` | EXPECTED attendance pre-creation | Prisma write `state-attendance` (cross-owner) | OPEN (OQ-05) | Rolls back whole tx |
| `edge-attendance-reads-worker-assignment`, `edge-quality-reads-worker-assignment`, `edge-analytics-reads-*` | Downstream consumers of owned state | Prisma reads | Stable | Consumer-side |

## State and Lifecycle

**WorkRequest state machine** (`work-requests/service.ts:15-19`; `schema.prisma:38-45`):
- Entry: create -> DRAFT (default) or -> OPEN (direct publish).
- Manual: DRAFT->OPEN (stamps published_at, fans out publish notification, increments version); DRAFT->CANCELLED; OPEN->CANCELLED; PARTIALLY_FILLED->CANCELLED (stamps cancelled_at + reason, increments version).
- System (accept pipeline): OPEN/PARTIALLY_FILLED -> PARTIALLY_FILLED or FILLED (stamps filled_at) via slot recompute.
- External: -> EXPIRED via scheduled job absent from repo (OQ-04).
- Terminal-ish: CANCELLED, FILLED, EXPIRED have no outgoing manual transition. CANCELLED does not cascade (REQ-011/OQ-03).
- Invariants: RULE-006 (capacity CHECK), version optimistic lock on status-changing writes only (OQ-11: term-only DRAFT edits unguarded).

**WorkApplication state machine** (`schema.prisma:47-53`; `work-applications/service.ts`):
- Entry: apply -> PENDING (new row, or reused WITHDRAWN row reset to PENDING).
- PENDING -> ACCEPTED (approve tx), REJECTED (stamps review + reason), WITHDRAWN (worker or mgmt).
- WITHDRAWN -> PENDING (re-apply reuse). ACCEPTED/REJECTED are terminal in-code; re-apply blocked (OQ-06 for REJECTED).
- EXPIRED enum value declared but UNREACHABLE in repo (OQ-08).
- Update guarded to PENDING only (RULE-003).

**WorkerAssignment state machine** (`assignments/service.ts:6-9`; `schema.prisma:55-62`):
- Entry: created CONFIRMED only by the accept transaction (RULE-009).
- CONFIRMED -> IN_PROGRESS (started_at) or CANCELLED (cancelled_at + reason).
- IN_PROGRESS -> COMPLETED (completed_at) or CANCELLED.
- COMPLETED and CANCELLED are terminal. NO_SHOW and REASSIGNED declared but UNREACHABLE (OQ-08). `previous_assignment_id` reassignment chain exists in schema but no service writes it (OQ-09).

**Concurrency (optimistic version model):** Slot claim uses `updateMany WHERE id AND version=known AND workers_confirmed<workers_needed`, incrementing both `workers_confirmed` and `version`; a returned count of 0 (lost race or full) raises ConflictError and aborts the transaction (`work-applications/service.ts:219-230`). Active double-booking is additionally prevented by the DB partial unique index (RULE-010). Term edits on DRAFT are not version-guarded (OQ-11).

**Atomic 7-step accept transaction** (`work-applications/service.ts:217-290`): (1) optimistic slot claim; (2) mark application ACCEPTED; (3) create CONFIRMED WorkerAssignment with mandatory application_id; (4) pre-create EXPECTED Attendance with denormalized window; (5) re-read WorkRequest; (6) set FILLED+filled_at or PARTIALLY_FILLED; (7) return accepted app + assignment. Two notifications fire AFTER commit. Any step's throw rolls back all writes including the cross-owner writes to WorkRequest/WorkerAssignment/Attendance.

**Retention/migration:** Rows persist; no soft-delete on these three models. Onward migration governed by `20260613120000_v2_marketplace_init` (SP-3/SP-5/SP-9 constraints). No data migration introduced by this spec.

## Failure, Security, Privacy, and Performance

**Failure modes/recovery:** Conflict/validation/not-found/forbidden surface as typed HTTP errors. Accept-transaction failures roll back atomically. Notification delivery failures are swallowed and never roll back (RULE-012) — a published request or accepted application can succeed while its notification is silently lost.

**Trust boundaries/authorization:** Route RBAC guards create/patch work-request (admin,manager) and apply (worker). Read scoping is enforced in-service by roster membership/ownership (RULE-011a-e). CRITICAL GAP: `PATCH /assignments/:id` has NO route-level role guard AND no service-level ownership/role/hotel check — any authenticated user can transition ANY assignment; the route comment claiming "service-level guards" is inaccurate (OQ-01, security-critical). Create/patch work-request have role but NO hotel-scoping — any admin/manager acts on any hotel (OQ-07). This spec does NOT define the missing authorization rule; it is escalated as a human-authority decision.

**Data classification/retention:** Applications carry a `worker_rating_snapshot` (worker performance data) and `cover_note` (worker-authored). Audit rows persist actor id/role and entity ids for every mutation.

**Performance budgets/workload:** No explicit budgets in code. Publish fan-out issues one notification per ACTIVE roster worker in parallel (`Promise.all`) — unbounded by roster size. Hot-path index `@@index([hotel_id, status, shift_date])` (`schema.prisma:273`) supports open-shift queries. Slot contention resolved by single-row optimistic update.

**Observability/audit:** Every mutation calls `BaseService.logAudit` -> AuditLog (CREATE/UPDATE/APPLY/APPLICATION_*/UPDATE_ASSIGNMENT). No metrics/tracing observed. Responses carry `request_id` in `meta`.

## Rollout and Compatibility

Behavior is already deployed at `f37a39b`; this is a reverse specification, not a change. Schema/constraints are established by migration `20260613120000_v2_marketplace_init` (CHECK `migration.sql:564-566`, partial unique index `migration.sql:580-582`). No feature flags observed. Backward compatibility: DTO enums are frozen to `schema.prisma` (see `work-requests/types.ts:3-14` audit note that the older OPEN/CLOSED API enum is superseded). No rollback or removal criteria are defined by code; introducing any behavioral change requires a new spec version and G2 approval. Removal criteria and rollback plan are unspecified (mark as unknown).

## Validation Plan

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
| Authorization on PATCH /assignments (OQ-01) | Security test (to add) | arbitrary authenticated user | MUST fail once rule exists — no rule/test today |

## Risks, Assumptions, and Open Decisions

| ID | Type | Description | Evidence/impact | Owner | Resolution/status |
|---|---|---|---|---|---|
| OQ-01 | decision | No ownership/role/hotel guard on `PATCH /assignments/:id`; any authenticated user can transition any assignment. Route comment claims non-existent "service-level guards". | `assignments/service.ts:83-118`; `assignments/routes.ts:14`. Security-critical (HIGH). | human/unassigned | OPEN — missing authorization rule; do NOT invent |
| OQ-02 | decision | Cancelling an assignment does not decrement workers_confirmed nor reopen the request. | `assignments/service.ts:105-108` (no counter write) | human/unassigned | OPEN |
| OQ-03 | decision | Cancelling a work request does not cascade to assignments/attendance. | `work-requests/service.ts:162-227` | human/unassigned | OPEN |
| OQ-04 | decision | EXPIRED transition (WorkRequest + ApplicationStatus.EXPIRED) is driven by a scheduled job absent from the repo; owner unknown. | `work-requests/service.ts:13-14` | human/unassigned | OPEN |
| OQ-05 | decision | Accept transaction writes state owned by other modules (WorkRequest, WorkerAssignment, Attendance) — is this coupling an approved architecture decision? | `work-applications/service.ts:219,243,256,278,283`; DEPENDENCY_GRAPH remaining_human_decisions | human/unassigned | OPEN |
| OQ-06 | decision | A REJECTED applicant is permanently barred from re-applying (only WITHDRAWN may). Intended? | `work-applications/service.ts:59-61` | human/unassigned | OPEN |
| OQ-07 | decision | Create/patch are role-guarded but NOT hotel-scoped — any admin/manager acts on any hotel. | `work-requests/routes.ts:18,21`; `service.ts` (no hotel-membership check) | human/unassigned | OPEN |
| OQ-08 | decision | AssignmentStatus.NO_SHOW/REASSIGNED and ApplicationStatus.EXPIRED are declared but unreachable in current code. | `schema.prisma:52,59,61`; `assignments/service.ts:6-9` | human/unassigned | OPEN |
| OQ-09 | decision | `previous_assignment_id` reassignment chain exists in schema but no service writes it; no reassignment flow. | `schema.prisma:334-336`; assignments/service.ts (no writer) | human/unassigned | OPEN |
| OQ-10 | decision | NotificationType WORK_REQUEST_CANCELLED, APPLICATION_WITHDRAWN, ASSIGNMENT_CANCELLED declared but never emitted. | `schema.prisma:92,98,101`; no emit sites | human/unassigned | OPEN |
| OQ-11 | decision | Optimistic version guards only status-changing writes; concurrent DRAFT term edits are unguarded. | `work-requests/service.ts:211` | human/unassigned | OPEN |
| SYNC-001 | decision | All module/state/contract owners are `unassigned` (no CODEOWNERS; empty package author). Blocks accountable ownership for capability/rules/state. | MODULE_REGISTRY.yaml header; DEPENDENCY_GRAPH nodes | human/unassigned | OPEN — reserved human authority |
| OQ-12 | decision | Migration constraints (CHECK capacity, partial unique active-slot) back REQ-042/043. | `migration.sql:564-566,580-582` | human (Lead Architect) | RESOLVED (High) — REQ-042/043 CONFIRMED |
| ASM-01 | assumption | Roles are `admin`, `manager`, `worker`, `checker`; management = admin+manager per code branches. Not independently confirmed against an auth spec. | `work-requests/service.ts:100,148` | human/unassigned | Assumption, not requirement |

## Proposed Knowledge Deltas

Proposed only — NOT applied. Application requires the appropriate synchronization gate.

- **MODULE_REGISTRY.yaml:** set `specification` for `backend-work-requests`, `backend-work-applications`, and `backend-assignments` from `UNKNOWN` -> `SPEC-JOB-DISPATCH-001@0.1.0 (REVIEW)`. Do not alter `owner` (remains `unassigned`, SYNC-001).
- **DEPENDENCY_GRAPH.yaml:** NO new nodes or edges. This spec references existing edges only, notably `edge-work-applications-writes-{work-request,worker-assignment,attendance}` (cross-owner accept-tx writes, still in `remaining_human_decisions` per OQ-05). No graph mutation proposed.
- **TERMINOLOGY.md:** promote definitions from "Definition unresolved" to canonical for: `Work request`, `Work application`; and ADD canonical entries for `Assignment` (WorkerAssignment), `Roster` (ACTIVE HotelWorker membership set), and `Slot` (unit of workers_needed capacity), sourced to `schema.prisma` and this spec's Actors and Terminology section.
- **DECISION_INDEX.md:** NO new decision record proposed. All judgment calls remain OPEN human-authority items (OQ-01..OQ-11, SYNC-001) carried in this spec; a decision record should be created only when a human resolves one.
- **SYNC_STATE.yaml:** none proposed by the author; synchronization owner records the spec issuance if/when this candidate advances.

## Review and Change Log

| Version | Date | Change | Findings resolved | Approver |
|---|---|---|---|---|
| 0.1.0 | 2026-07-06 | Initial current-state reverse specification at `f37a39b`. Incorporates REQ-001..043 and RULE-001..013 (RULE-011 split into 011a-011e). Folds author-fixable dispositions FIND-BRV-003/004/005/007/008; records FIND-BRV-006/009 as UNTESTED in the Validation Plan. Carries OQ-01..OQ-11 + SYNC-001 as open decisions; OQ-12 resolved (REQ-042/043 confirmed). | FIND-BRV-003, FIND-BRV-004, FIND-BRV-005, FIND-BRV-007, FIND-BRV-008 (author-fixable folded) | None — status REVIEW, not approved. G2 freeze reserved to human. |
