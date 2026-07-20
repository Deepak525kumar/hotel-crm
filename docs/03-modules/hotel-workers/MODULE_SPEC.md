# Module Specification: `hotel-workers` (backend-hotel-workers)

> Specification of ONE bounded backend capability — **hotel roster management** (enroll a worker
> onto a hotel's roster, list the roster, transition a roster entry's lifecycle status, remove a
> worker from the roster) — implemented by the single module `backend-hotel-workers`. This module
> owns `state-hotel-worker` (the `HotelWorker` Prisma model), read by five other modules
> (`work-requests`, `work-applications`, `assignments`, `users`, `analytics`) as the roster-membership
> fact that gates eligibility/scoping elsewhere; it does not itself gate any other module's behavior.
> No `CONFIRMED_REQUIREMENTS_REGISTER.md`/`PIVOT_DESIGN_DOCUMENT.md` section describes a target
> state for this capability's **lifecycle** beyond what is already implemented (PDD §"Hotel,
> HotelWorker" row: "Roster; HotelWorker lifecycle INVITED→ACTIVE→SUSPENDED→REMOVED" — the
> current-state lifecycle, not a pivot). The `HotelWorker` **record** is, however, slated for
> target-state **repurposing** into Employee Management's "employment record" (PDD §9.1;
> `SPEC-EMP-001`; `SPEC-JOB-DISPATCH-001` Roster term) — a retained-not-retired disposition whose
> owning-module question is unresolved and recorded here as `OD-HW-07`. This document therefore
> records **Current Repository Behaviour** only, cited `path:line` at the revision below; it does
> not create product policy and resolves no open decision.

## Document Control

| Field | Value |
|---|---|
| Spec ID / version | `SPEC-HOTELWORKERS-001 / 0.1.0` |
| Status | `REVIEW` (freeze candidate; G2 Specification Freeze pending — see Review and Change Log) |
| Owner | `unassigned` — reserved human authority (`SYNC-001`); no `CODEOWNERS` file exists and `backend/package.json` `"author"` is empty |
| Authors / reviewers | Author: Lead Architect (Documentation Workflow, auto-continue). Independent reviewers (architecture, dependency, consistency, security, performance): **pending** (G4). |
| Repository revision | `af3cee591b00953b390c6b3714a0db058fcc4f79` (`af3cee5`, `HEAD` at authoring) — `backend/src/modules/hotel-workers/**`, `backend/prisma/schema.prisma`, `backend/src/middleware/permissions.ts`, `backend/src/routes/v1/index.ts` read at this revision. |
| Approved by / at | — (G2 freeze requires the named human approver; not yet approved) |
| Supersedes | None. First specification for `backend-hotel-workers`; `.claude/knowledge/MODULE_REGISTRY.yaml:91` recorded `specification: UNKNOWN`. |

## Purpose and Scope

**Outcome:** Maintain each hotel's worker roster — which `User` accounts are affiliated with which
`Hotel`, at what position/rate, and their enrollment lifecycle (`INVITED → ACTIVE → SUSPENDED →
REMOVED`) — and expose that roster-membership fact for other modules to read. This is the sole
owner of `state-hotel-worker`; five other modules read it and none writes it.

**In scope:**

- Four HTTP routes at `backend/src/modules/hotel-workers/routes.ts:11-14`, all mounted at
  `/api/v1/crm/hotels/:hotel_id/workers` (`backend/src/routes/v1/index.ts:27`; a top-level
  path-prefix mount, not delegation through CRM's own sub-router — see Ownership and Boundaries
  for the resulting execution-coupling fact) and all behind `authMiddleware` + `checkHotelAccess()`
  (`routes.ts:8-9`).
- `HotelWorker` record lifecycle: enroll (create-or-reactivate via upsert), list (paginated,
  filterable), status transition (guarded state machine), remove (unconditional soft-removal) —
  `backend/src/modules/hotel-workers/service.ts`.
- Audit logging of every mutating action via the shared audit framework
  (`service.ts:74-78,142-147,171-174`).
- A `checkMembership` read helper (`service.ts:177-185`) — not an HTTP endpoint, an in-process
  method other modules' code could call, though no caller is discovered in this module's own file
  (see Dependencies for the actual consumption mechanism, which is a direct Prisma read of
  `state-hotel-worker` by each consumer, not a call into this method).

**Out of scope:** (owned elsewhere and referenced, never redefined — Constitution §6)

- **The `Hotel` reference itself.** Owned by `backend-crm`; this module only reads it
  (`service.ts:37,87`) to validate a target hotel exists before enrolling/listing.
- **The `User` account itself** (identity, role, credentials). Owned by `backend-auth`/`backend-users`;
  this module only reads it (`service.ts:40`) to validate a target worker account exists before
  enrolling — it does not validate the account's `role`, see Risks/Open Decisions.
- **Everything that reads roster membership as an eligibility/scoping input** — work-request/
  application creation and scoping (`backend-work-requests`, `backend-work-applications`),
  assignment scoping (`backend-assignments`), the `users` module's optional hotel-filter join
  (`backend-users`), and analytics rollups (`backend-analytics`). Each reads `state-hotel-worker`
  directly via its own Prisma queries; none is redefined here (see Dependencies).
- **Authentication, JWT issuance, role/scope claims, sessions.** Owned by Authentication
  (`backend/src/middleware/auth.ts`).
- **The RBAC/scope framework and the role→permission map**
  (`backend/src/middleware/permissions.ts`). This module reuses `authMiddleware`,
  `checkHotelAccess()`, and `requireRole()` unchanged.

## Evidence and Traceability

| Claim/requirement | Source path, line, revision | Authority | Status |
|---|---|---|---|
| `REQ-HW-001` The module is route-registered at `/api/v1/crm/hotels/:hotel_id/workers` with four endpoints | `backend/src/routes/v1/index.ts:27`; `backend/src/modules/hotel-workers/routes.ts:11-14` | Current repository | Confirmed current-state |
| `REQ-HW-002` Every route requires `authMiddleware` then `checkHotelAccess()`, applied module-wide before any per-route role gate | `routes.ts:8-9` | Current repository | Confirmed current-state |
| `REQ-HW-003` Every route additionally requires `requireRole(['admin','manager'])` — `checker` and `worker` never reach the service | `routes.ts:11-14` | Current repository | Confirmed current-state |
| `REQ-HW-004` `HotelWorker` carries exactly the confirmed field set, one row per (hotel, worker) pair enforced by a unique constraint | `schema.prisma:223-246` | Current repository | Confirmed current-state |
| `REQ-HW-005` Enrolling validates the target hotel and worker both exist, rejects a live duplicate, and upserts on the `(hotel_id, worker_id)` key | `service.ts:31-59` | Current repository | Confirmed current-state |
| `REQ-HW-006` Re-enrolling a `REMOVED` worker resets the row to `INVITED` via the same upsert path, clearing `left_at`/`joined_at` and re-stamping `invited_at` | `service.ts:46-58` | Current repository | Confirmed current-state |
| `REQ-HW-007` Listing is paginated and filterable by `status`/`position`, ordered by `invited_at` descending | `service.ts:83-107` | Current repository | Confirmed current-state |
| `REQ-HW-008` Status transitions follow an explicit guarded state machine; illegal transitions are rejected | `service.ts:118-124` | Current repository | Confirmed current-state |
| `REQ-HW-009` Transitioning to `ACTIVE` unconditionally re-stamps `joined_at` to now, including on reactivation from `SUSPENDED` | `service.ts:129-136` | Current repository | Confirmed current-state; business-fact, see `RULE-HW-05` |
| `REQ-HW-010` `DELETE` performs an unconditional soft-removal (`status=REMOVED`, `left_at=now`) with no state-machine guard, unlike `PATCH /:worker_id/status` | `service.ts:152-175` | Current repository | Confirmed current-state; business-fact, see `RULE-HW-06` |
| `REQ-HW-011` The response DTO exposes `role` (=`position`), `start_date`/`end_date` (derived), and `is_active` (derived); it never exposes the raw `status`, `hourly_rate`, `currency`, or `notes` fields | `service.ts:8-27`; `types.ts:29-38` | Current repository | Confirmed current-state |
| `REQ-HW-012` No hotel-scoping is ever enforced in practice: the only two roles that can reach the service (`admin`, `manager`) both unconditionally bypass `checkHotelAccess()` | `routes.ts:8-9,11-14`; `permissions.ts:103-108` | Current repository | Confirmed current-state; business-fact, see `RULE-HW-07` |
| `REQ-HW-013` Enrollment does not validate that the target `User.role` is `worker`; any existing account id may be enrolled | `service.ts:39-40` | Current repository | Confirmed current-state; business-fact, see `RULE-HW-08` |
| `REQ-HW-014` `state-hotel-worker` is read by five other modules and written by none but this one | `.claude/knowledge/DEPENDENCY_GRAPH.yaml` (state-hotel-worker row, `readers: [work-requests, work-applications, assignments, users, analytics]`) | Generated (repo-derived) | Confirmed current-state |
| `REQ-HW-015` A dedicated test suite exists and exercises every service method | `backend/src/__tests__/hotel-workers.test.ts` (216 lines, 5 `describe` blocks) | Current repository | Confirmed current-state |

## Actors and Terminology

| Term/actor | Canonical definition | Source |
|---|---|---|
| Roster | The set of `HotelWorker` rows for a given hotel — which workers are affiliated with it | PDD "Hotel, HotelWorker" row; `schema.prisma:223-246` |
| `HotelWorker` | A per-(hotel, worker) enrollment record: position, lifecycle status, rate/currency, notes, and timestamps | `schema.prisma:223-246` |
| Enrollment lifecycle | `INVITED → ACTIVE → SUSPENDED → REMOVED`, `SUSPENDED → ACTIVE`, or any of `{INVITED, ACTIVE, SUSPENDED} → REMOVED`; `REMOVED` is terminal via the guarded state machine (re-enrollment instead reuses the row, see `RULE-HW-02`) | `service.ts:118-124` |
| Admin / Manager | The two roles that can reach every endpoint in this module; the only two currently defined roles above `worker`/`checker` | `constants.ts` `ROLE_PERMISSIONS`; `routes.ts:11-14` |
| Checker / Worker | Roles that never reach this module's service (denied by `requireRole(['admin','manager'])` at the route) | `routes.ts:11-14` |

## Requirements and Acceptance Criteria

| Requirement | Statement | Priority | Acceptance criteria | Rule IDs |
|---|---|---|---|---|
| `REQ-HW-001` | Expose `HotelWorker` roster management under `/api/v1/crm/hotels/:hotel_id/workers`, all authenticated. | MUST | The four routes at `routes.ts:11-14` require a valid bearer token (`authMiddleware`, `routes.ts:8`); an unauthenticated call returns 401. | `RULE-HW-01` |
| `REQ-HW-002` | List a hotel's roster with pagination and filters. | MUST | `GET /` validates the target hotel exists (404 if not); returns a paginated list filterable by `status`/`position`, ordered `invited_at desc`; response includes `pagination{page,per_page,total,total_pages,has_next,has_prev}`. | `RULE-HW-03` |
| `REQ-HW-003` | Enroll a worker onto a hotel's roster. | MUST | `POST /` validates the hotel and the target `User` both exist (404 otherwise); a live (non-`REMOVED`) duplicate enrollment 409s; otherwise creates (`INVITED`) or reactivates (resets to `INVITED`) via upsert on `(hotel_id, worker_id)`; writes an `ENROLL_WORKER` audit row. | `RULE-HW-02`, `RULE-HW-04` |
| `REQ-HW-004` | Transition a roster entry's status. | MUST | `PATCH /:worker_id/status` 404s if no enrollment exists; validates the transition against the guarded state machine (409 if illegal); on transition to `ACTIVE` stamps `joined_at=now`; on transition to `REMOVED` stamps `left_at=now`; writes an `UPDATE_WORKER_STATUS` audit row. | `RULE-HW-05` |
| `REQ-HW-005` | Remove a worker from a hotel's roster. | MUST | `DELETE /:worker_id` 404s if no enrollment exists; otherwise unconditionally sets `status=REMOVED`, `left_at=now` (no transition-table guard); writes a `REMOVE_WORKER` audit row; row is retained (soft-removal, not a delete). | `RULE-HW-06` |
| `REQ-HW-006` | Gate every route on both role and (nominal) hotel scope. | MUST (as observed) | Every route requires `requireRole(['admin','manager'])`; every route also runs `checkHotelAccess()` first, but that check unconditionally bypasses `admin`/`manager` (`permissions.ts:103-108`) — **net effect, hotel-scoping is never enforced for either role that can reach this module** (`RULE-HW-07`). | `RULE-HW-07` |
| `REQ-HW-007` | Do not validate the enrolled account's role. | MUST (as observed) | `enroll()` checks only that `input.worker_id` resolves to an existing `User` row (`service.ts:39-40`); it does not check `User.role === 'worker'`. Any existing account id — including an Admin's or Manager's own — can be enrolled onto a roster. | `RULE-HW-08` |

## Business Rules

| Rule | Preconditions | Outcome/invariant | Exceptions/precedence | Owner/source |
|---|---|---|---|---|
| `RULE-HW-01` | Any request reaches `/api/v1/crm/hotels/:hotel_id/workers/*` | `authMiddleware` runs first; unauthenticated → 401 | — | This module (`routes.ts:8`) |
| `RULE-HW-02` | `POST /` (enroll) | One `HotelWorker` row ever exists per `(hotel_id, worker_id)` (`@@unique`, `schema.prisma:241`); a live (status ≠ `REMOVED`) existing row → 409; a `REMOVED` existing row is instead reactivated in place (status→`INVITED`, `left_at`/`joined_at`→null, `invited_at`→now) | A brand-new pair creates a fresh `INVITED` row | This module (`service.ts:31-59`) |
| `RULE-HW-03` | `GET /` (list) | Returns rows for the target hotel only, optionally narrowed by `status`/`position`, paginated, ordered `invited_at desc` | Unknown hotel → 404 before any row is read | This module (`service.ts:83-107`) |
| `RULE-HW-04` | Enroll/list reach the service | The target hotel must exist (`service.ts:37,87`); for enroll, the target `User` must also exist (`service.ts:39-40`) | Either missing → 404 | This module + reads `backend-crm`'s `Hotel`, `backend-auth`/`backend-users`' `User` |
| `RULE-HW-05` | `PATCH /:worker_id/status` | Transition must be one of: `INVITED→{ACTIVE,REMOVED}`, `ACTIVE→{SUSPENDED,REMOVED}`, `SUSPENDED→{ACTIVE,REMOVED}` (`service.ts:118-124`); transitioning to `ACTIVE` **unconditionally** sets `joined_at=now` — reactivating from `SUSPENDED` overwrites any prior `joined_at`, losing the original join date; transitioning to `REMOVED` sets `left_at=now` | Any other transition (including `REMOVED→*`, since `REMOVED` has no entry in the allowed-map) → 409 `ConflictError` | This module (`service.ts:109-150`) |
| `RULE-HW-06` | `DELETE /:worker_id` | Unconditionally sets `status=REMOVED`, `left_at=now` — **no transition-table check**, unlike `RULE-HW-05`'s guarded PATCH path; callable regardless of current status (including already-`REMOVED`, which just re-stamps `left_at`) | Missing enrollment → 404 | This module (`service.ts:152-175`) |
| `RULE-HW-07` | Any route in this module | `checkHotelAccess()` runs before `requireRole(['admin','manager'])` in the middleware chain (`routes.ts:8-9,11-14`), but it unconditionally bypasses `admin`/`manager`/`checker` (`permissions.ts:103-108`); since only `admin`/`manager` ever pass the subsequent role gate, **every actor who reaches the service has already bypassed hotel-scoping** — an Admin or Manager may enroll/list/transition/remove roster entries at any hotel, not only ones they are otherwise associated with | `checker`/`worker` are denied by the role gate regardless, never reaching the (moot) hotel-scope question | This module + shared `permissions-middleware` (`routes.ts:8-9,11-14`; `permissions.ts:103-108`) |
| `RULE-HW-08` | `enroll()` reaches the service | Only `User` existence is checked (`service.ts:39-40`); the account's `role` is not validated to be `worker` | No control is invented here; recorded as a business fact | This module (`service.ts:39-40`) |

## Ownership and Boundaries

**Module owner:** `unassigned` — accountable owner assignment is reserved human authority (`SYNC-001`;
no `CODEOWNERS`, empty `backend/package.json` author). Code home is `backend/src/modules/hotel-workers`,
registered id `backend-hotel-workers`, `lifecycle: active`, `implementation_status: active`
(`.claude/knowledge/MODULE_REGISTRY.yaml:82-91`).

**Owned state (current):**

- `HotelWorker` (`schema.prisma:223-246`; `state-hotel-worker`,
  `.claude/knowledge/DEPENDENCY_GRAPH.yaml` state-domains). All columns per `REQ-HW-004`. This
  module performs the full lifecycle surface (enroll/list/transition/remove); it is the sole writer.

**Consumed state (owned elsewhere, referenced never redefined):**

- `Hotel` (owner `backend-crm`) — read only, existence/soft-delete check on enroll and list
  (`service.ts:37,87`). This module never writes `Hotel`.
- `User` (owner `backend-auth`/`backend-users`, per `ADR-017`) — read only, existence check on
  enroll (`service.ts:40`). This module never writes `User`.

**Permitted writes:** only `HotelWorker` (create/upsert/update — never a hard delete) and
`AuditLog` (append-only, via shared `BaseService.logAudit`). This module never writes `Hotel`,
`User`, `Session`, or any other module's state.

**Readers of owned state (five, none is a writer):** `backend-work-requests`
(`work-requests/service.ts:101,135,233`), `backend-work-applications`
(`work-applications/service.ts:50`), `backend-assignments` (`assignments/service.ts:69`),
`backend-users` (`users/service.ts:16`, optional `hotel_id` join filter), `backend-analytics`
(`analytics/service.ts:26-35`). Each reads `state-hotel-worker` via its own direct Prisma query;
none calls this module's `checkMembership()` method, which itself has no discovered caller within
this module's own files (recorded as an unused/candidate-only helper, not a defect — see
Risks/Assumptions).

**Boundary/non-responsibilities:** this module does not own `Hotel`, `User`, work-request/
application/assignment state, attendance, quality, or analytics computation; it supplies the
roster-membership fact those modules read, never redefining their behavior.

**Execution-coupling note (platform-wide, not specific to this module):** this module's routes are
mounted at `/api/v1/crm/hotels/:hotel_id/workers` — a path nested under the `/crm` prefix but
registered as an **independent top-level mount** (`routes/v1/index.ts:26-27`), not a route
delegated through `backend-crm`'s own sub-router. Because Express's `crmRoutes` sub-router applies
`router.use(authMiddleware)` unconditionally to any request matching its `/crm` prefix
(`crm/routes.ts:8`) before falling through when no route inside it matches, every request to this
module's endpoints transits CRM's own `authMiddleware` a second time before reaching this module's
own identical `authMiddleware` (`routes.ts:8`) — a harmless (idempotent) but uncontracted
execution-level coupling. This is the same platform-wide pattern already recorded for
`work-requests`/`work-applications` and tracked once, not module-by-module (`SIR-GLOB-011`,
`OD-CRM-15`); this document cross-references it rather than duplicating it (`OD-HW-01`).

## Interfaces and Contracts

All contracts are **Current Repository Behaviour**. Direction is relative to this module.
Transport is REST/JSON over the platform response envelope; contracts are **unversioned in code**
(no explicit contract version/registry entry), matching the platform-wide baseline/UNKNOWN
compatibility posture recorded for sibling modules (e.g. `SPEC-JOB-DISPATCH-001` `FIND-DEP-003`).

| Contract ID/version | Direction | Input | Output | Errors | Auth | Compatibility |
|---|---|---|---|---|---|---|
| `IF-HW-ListWorkers / v1` | Inbound (query) `GET /api/v1/crm/hotels/:hotel_id/workers` | path `hotel_id`; query `status?`(INVITED\|ACTIVE\|SUSPENDED\|REMOVED), `position?`, `page`(≥1, def 1), `per_page`(1–100, def 20) | `{status, data:HotelWorkerDto[], pagination:{page,per_page,total,total_pages,has_next,has_prev}, meta}` | 401 unauthenticated; 403 non-admin/manager; 404 unknown hotel; 422 invalid query | `authMiddleware` + `checkHotelAccess()` + `requireRole(['admin','manager'])` | Current (`routes.ts:11`; `controller.ts:9-33`; `service.ts:83-107`) |
| `IF-HW-EnrollWorker / v1` | Inbound (command) `POST /api/v1/crm/hotels/:hotel_id/workers` | path `hotel_id`; body `{worker_id, position, hourly_rate?, currency?, notes?}` | `201 {status, data:HotelWorkerDto, meta}`; writes an `ENROLL_WORKER` audit row | 401; 403; 404 (hotel or worker not found); 409 live duplicate; 422 invalid body | `authMiddleware` + `checkHotelAccess()` + `requireRole(['admin','manager'])` | Current (`routes.ts:12`; `controller.ts:36-58`; `service.ts:31-81`) |
| `IF-HW-UpdateWorkerStatus / v1` | Inbound (command) `PATCH /api/v1/crm/hotels/:hotel_id/workers/:worker_id/status` | path `hotel_id`, `worker_id`; body `{status}` | `{status, data:HotelWorkerDto, meta}`; writes an `UPDATE_WORKER_STATUS` audit row | 401; 403; 404 no enrollment; 409 illegal transition; 422 invalid body | `authMiddleware` + `checkHotelAccess()` + `requireRole(['admin','manager'])` | Current (`routes.ts:13`; `controller.ts:59-82`; `service.ts:109-150`) |
| `IF-HW-RemoveWorker / v1` | Inbound (command) `DELETE /api/v1/crm/hotels/:hotel_id/workers/:worker_id` | path `hotel_id`, `worker_id` | `204 No Content`; soft-removal; writes a `REMOVE_WORKER` audit row | 401; 403; 404 no enrollment | `authMiddleware` + `checkHotelAccess()` + `requireRole(['admin','manager'])` | Current (`routes.ts:14`; `controller.ts:83-93`; `service.ts:152-175`) |

## Events

No event bus exists (`published_events: none-observed`, `consumed_events: none-observed`,
`.claude/knowledge/MODULE_REGISTRY.yaml:89-90`), matching the platform-wide fact recorded for every
other module. This module publishes and consumes no events.

## Dependencies

| Dependency/edge | Reason | Contract | Compatibility | Failure behavior |
|---|---|---|---|---|
| `backend-crm` (`Hotel`) | Existence/soft-delete check on enroll and list | Prisma read `state-hotel` (`edge-hotel-workers-reads-hotel`, `DEPENDENCY_GRAPH.yaml`) | baseline/UNKNOWN | Unknown hotel → 404 |
| `backend-auth`/`backend-users` (`User`) | Existence check on enroll | Prisma read `state-user` (`edge-hotel-workers-reads-user`, `DEPENDENCY_GRAPH.yaml`) | baseline/UNKNOWN | Unknown worker → 404 |
| `backend-work-requests` (reader) | Roster-membership scoping for work-request visibility/eligibility | Prisma read `state-hotel-worker` (`edge-work-requests-reads-hotel-worker`) | baseline/UNKNOWN | Consumer-side |
| `backend-work-applications` (reader) | Apply-precondition roster-membership check | Prisma read `state-hotel-worker` (`edge-work-applications-reads-hotel-worker`) | baseline/UNKNOWN | Consumer-side |
| `backend-assignments` (reader) | Assignment read-scoping | Prisma read `state-hotel-worker` (`edge-assignments-reads-hotel-worker`) | baseline/UNKNOWN | Consumer-side |
| `backend-users` (reader) | Optional `hotel_id` list-filter join | Prisma read `state-hotel-worker` (`edge-users-reads-hotel-worker`) | baseline/UNKNOWN | Consumer-side |
| `backend-analytics` (reader) | Leaderboard/rollup computation | Prisma read `state-hotel-worker` (`edge-analytics-reads-hotel-worker`) | baseline/UNKNOWN | Consumer-side |
| Platform/infrastructure | PostgreSQL system of record; Express/TS modular monolith; shared `base-service` (audit) | shared infrastructure (reuse) | compatible (reuse) | Standard platform failure modes |

`[Client consumers]`: no `frontend-web`/mobile client reference to this module's endpoints was
found in a repo-wide grep of `frontend/lib/api.ts` or either mobile app's API client; recorded as
an assumption pending independent confirmation (`ASM-HW-01`), not asserted as a proven absence.

## State and Lifecycle

**`HotelWorker` state machine** (`service.ts:109-150`; `schema.prisma:230,240-245`):

- Entry: `POST /` creates a fresh row at `INVITED`, or reactivates an existing `REMOVED` row back
  to `INVITED` via the same upsert (`RULE-HW-02`).
- `INVITED → ACTIVE` (stamps `joined_at=now`) or `INVITED → REMOVED` (stamps `left_at=now`).
- `ACTIVE → SUSPENDED` or `ACTIVE → REMOVED` (stamps `left_at=now`).
- `SUSPENDED → ACTIVE` (**re-stamps** `joined_at=now`, overwriting the original) or
  `SUSPENDED → REMOVED` (stamps `left_at=now`).
- `REMOVED` has no outgoing transition via `PATCH /status` (absent from the allowed-map,
  `service.ts:118-124` → 409); the only path back to `INVITED` is a fresh `POST /` enroll call,
  which bypasses the transition-table entirely (`RULE-HW-02`).
- `DELETE /:worker_id` reaches `REMOVED`+`left_at=now` **unconditionally**, from any status,
  without consulting the transition table at all (`RULE-HW-06`) — a second, unguarded path to the
  same terminal state `PATCH /status` reaches only from `{INVITED,ACTIVE,SUSPENDED}`.

**Invariants:** exactly one `HotelWorker` row per `(hotel_id, worker_id)` ever (`@@unique`,
`schema.prisma:241`, enforced at the DB level and relied upon by the upsert); `joined_at` is not a
stable "first activation" timestamp — it is overwritten on every transition into `ACTIVE`
(`RULE-HW-05`).

**Concurrency:** no optimistic-lock/version field exists on `HotelWorker`; a concurrent
enroll-vs-status-transition race is not guarded beyond the DB unique constraint and Prisma's
single-statement atomicity per call — no multi-step transaction spans these operations.

**Retention/migration:** no soft-delete concept beyond the `REMOVED` status itself; rows are never
hard-deleted by this module. No migration gap — current-state matches the only lifecycle PDD
describes for this capability.

## Failure, Security, Privacy, and Performance

**Failure modes/recovery:** unknown hotel → 404 (enroll, list); unknown worker → 404 (enroll);
live duplicate enrollment → 409 (enroll); illegal status transition → 409 (`PATCH /status` only);
missing enrollment → 404 (`PATCH /status`, `DELETE`); invalid body/query → 422. No partial-write
failure mode exists — each service method is a single Prisma call (or two independent reads
followed by one write), so there is no multi-step rollback to reason about.

**Trust boundaries/authorization:** reuse of `authMiddleware` + `checkHotelAccess()` +
`requireRole(['admin','manager'])`. As `RULE-HW-07` records, this combination means **no actual
hotel-scoping is enforced for either role that can reach this module** — an Admin or Manager can
manage any hotel's roster, not only their own. This is the same shape of finding as
`SIR-USERS-005`/`SIR-QUAL-003`/`SIR-QUAL-004` (privileged-role bypass of a nominal hotel-scope
check), not the unbounded any-authenticated-actor shape of `SIR-ANLY-001`. Described
severity-neutrally here; no control is invented (`OD-HW-02`).

**Data classification/retention:** `HotelWorker` carries operational roster data (position, rate,
currency, notes) and timestamps; no special-category personal data. `hourly_rate`/`currency`/`notes`
are persisted but never returned by any endpoint (`REQ-HW-011`) — an internal-only field set from
the API's perspective today.

**Observability/audit:** every mutating action (`enroll`, `updateStatus`, `remove`) writes an audit
row via `BaseService.logAudit` (`service.ts:74-78,142-147,171-174`); `listByHotel` performs no
audit write (read-only, consistent with the platform's convention of not audit-logging plain reads
elsewhere, e.g. `SIR-USERS-019`'s disposition for `listUsers`).

**Performance budgets/workload:** no explicit SLO is defined in the authoritative documents (labeled
unknown, Constitution §6). `listByHotel` is indexed on `hotel_id`, `worker_id`, `status`, and
`position` individually (`schema.prisma:242-245`); no composite index covers the common
`(hotel_id, status)` list-filter combination together, though each individual predicate is indexed.

## Rollout and Compatibility

This module is already fully implemented and in production shape (`lifecycle: active`); its CRUD/
lifecycle behavior has no migration gap or unbuilt target state — PDD's own "Hotel, HotelWorker"
row describes exactly the lifecycle already implemented. The **record itself** does carry a
target-state disposition: it is slated for repurposing into Employee Management's employment record
(retained, not retired; `OD-HW-07`) — an owning-module decision that precedes, and is out of scope
for, this current-state specification. **Backward compatibility:** no client
consumer was discovered in this pass (`ASM-HW-01`); any interface change should still be treated as
potentially breaking until that assumption is independently confirmed. **Rollback:** standard
revert-and-redeploy; no feature flag gates this module today.

## Validation Plan

| Criterion | Test level/check | Environment/data | Evidence required |
|---|---|---|---|
| Module mounted; auth + role guards applied (`REQ-HW-001`) | Integration + route check | Running app | 401 unauthenticated; 403 non-admin/manager; route present at `routes/v1/index.ts:27` |
| List paginated/filtered (`REQ-HW-002`) | Unit (existing) | `hotel-workers.test.ts:123-147` | Filtered/paginated result matches query |
| Enroll: not-found, conflict, create, reactivate (`REQ-HW-003`) | Unit (existing) | `hotel-workers.test.ts:55-121` | 404/409 paths + create/reactivate DTO shape covered |
| Status transition: guarded state machine (`REQ-HW-004`) | Unit (existing) | `hotel-workers.test.ts:148-176` | Illegal transition 409; legal transition stamps `joined_at` |
| Remove: unconditional soft-removal (`REQ-HW-005`) | Unit (existing) | `hotel-workers.test.ts:178-198` | `status=REMOVED`, `left_at` set regardless of prior status |
| No hotel-scoping in practice for admin/manager (`REQ-HW-006`) | Security test (to add) | Admin/manager acting on an unaffiliated hotel | Currently succeeds — **no test asserts a denial, since none exists in code to assert** |
| Enrolled account role unvalidated (`REQ-HW-007`) | Unit (to add) | Enroll with a non-`worker`-role `User` id | Currently succeeds — no test covers this today |

## Risks, Assumptions, and Open Decisions

| ID | Type | Description | Evidence/impact | Owner | Resolution/status |
|---|---|---|---|---|---|
| `OD-HW-01` | Architecture (cross-reference) | **Route-nesting execution coupling**, platform-wide, not specific to this module — see `SIR-GLOB-011`/`OD-CRM-15`. This module's routes are independently mounted but path-nested under `/crm`, causing CRM's `authMiddleware` to execute unconditionally before falling through. Currently harmless (idempotent middleware). | `backend/src/routes/v1/index.ts:26-27`; `backend/src/modules/crm/routes.ts:8` | Human/Architecture (Lead Architect, platform-wide) | Open — non-blocking for this artifact; tracked once at `SIR-GLOB-011`, not duplicated |
| `OD-HW-02` | Risk | **No hotel-scoping enforced for admin/manager** (`RULE-HW-07`). Same bypass shape as `SIR-USERS-005`/`SIR-QUAL-003/004`. No control is invented here. | `routes.ts:8-9,11-14`; `permissions.ts:103-108` | Human/Security | Open — cross-hotel roster-management surface, same class as sibling modules' already-accepted findings |
| `OD-HW-03` | Gap | **Enrolled account's role is never validated** (`RULE-HW-08`). An Admin or Manager id could itself be "enrolled" as a hotel worker with no rejection. Not observed to be exploited by any code path; recorded as a business fact. | `service.ts:39-40` | Human/Product | Open — confirm whether this is intentional (e.g. an Admin covering a shift) or an oversight |
| `OD-HW-04` | Gap | **`joined_at` is overwritten on every `→ACTIVE` transition**, including reactivation from `SUSPENDED` (`RULE-HW-05`). A consumer relying on `joined_at` as a stable "original hire/join date" would be misled after any suspend/reactivate cycle. | `service.ts:129-136` | Human/Product | Open — confirm whether `joined_at` is intended to mean "most recent activation" (current behavior) or "original join date" |
| `OD-HW-05` | Owner | **Owner unassigned.** No `CODEOWNERS`; empty `backend/package.json` author (`SYNC-001`). | `.claude/knowledge/MODULE_REGISTRY.yaml:82-91` | Human | Open — freeze requires a named owner/approver |
| `OD-HW-06` | Note | **`checkMembership()` appears to have no caller.** Every consumer module reads `state-hotel-worker` directly via its own Prisma query rather than calling this method; it may be dead code, or intended for a not-yet-built in-process consumer. Not asserted as unused — a repo-wide call-site grep was performed within this module's directory only. | `service.ts:177-185` | Human/Architecture | Open — informational, non-blocking |
| `OD-HW-07` | Architecture (target supersession) | **Target-state ownership of the repurposed `HotelWorker` record.** `SPEC-EMP-001` (Employee Management, REVIEW) designates `HotelWorker` as its target "employment record" ("repurposed retained roster record"), and `SPEC-JOB-DISPATCH-001` notes "`HotelWorker` becomes the permanent-employment record" (PIVOT §9.1). This module (`backend-hotel-workers`) is the **current-state** authoritative writer with a full live implementation; whether it persists as a standalone module or its state+capability is **absorbed by Employee Management** when the employment record is built is an unresolved target-state architectural decision. **Not a current-state collision** — the target owner (`backend-hr`/Employee Management) is an unbuilt stub, and current ownership is unambiguous — but it is the central open question about this module's future and likely warrants a Decision Record before the employment-record migration is implemented. | `docs/03-modules/employee-management/MODULE_SPEC.md:88,234`; `docs/03-modules/job-dispatch/MODULE_SPEC.md` (Roster term); `.claude/knowledge/DEPENDENCY_GRAPH.yaml` (backend-hr stub); PDD §9.1 | Human/Architecture | Open — target-state boundary; not blocking this current-state freeze candidate, but a coordinated `backend-hotel-workers`↔`backend-employee-management` ownership decision is required before the target migration |

Assumptions:

| ID | Type | Description | Evidence | Status |
|---|---|---|---|---|
| `ASM-HW-01` | assumption | No `frontend-web`/mobile client consumer of this module's endpoints was found via a grep of `frontend/lib/api.ts` and both mobile apps' API clients during this authoring pass; not exhaustively re-verified beyond that grep. | Repo-wide grep, no match found in the files checked | Assumption pending independent confirmation |

## Proposed Knowledge Deltas

- **`MODULE_REGISTRY.yaml`:** on freeze, set `specification` for `backend-hotel-workers` from
  `UNKNOWN` to `SPEC-HOTELWORKERS-001@0.1.0 (REVIEW)`. Do not alter `owner` (remains `unassigned`,
  `SYNC-001`).
- **`SPECIFICATION_INDEX.yaml`:** add a `backend-hotel-workers` row mirroring the above.
- **`DEPENDENCY_GRAPH.yaml`/`STATE_OWNERSHIP_INDEX.yaml`/`OWNERSHIP_INDEX.yaml`/`BOUNDARY_INDEX.yaml`:**
  no new edge is proposed — all five reader edges (`edge-{work-requests,work-applications,
  assignments,users,analytics}-reads-hotel-worker`) and the `state-hotel-worker` authoritative-writer
  record already exist and are confirmed accurate by this pass; no delta required.
- **`TERMINOLOGY.md`:** promote, on human confirmation, the canonical terms **Roster** and
  **Enrollment lifecycle** (`INVITED`/`ACTIVE`/`SUSPENDED`/`REMOVED`), sourced to this document.
- **`DECISION_INDEX.md`:** no new ADR proposed by this document. `OD-HW-01` cross-references the
  already-registered platform-wide `SIR-GLOB-011`/`OD-CRM-15`; `OD-HW-02..06` are module-scoped
  open decisions routed to the Specification Issues Register, not architecture decisions.
- **`SYNC_STATE.yaml`:** record this spec as `REVIEW` pending G4 independent reviews and G2 human
  approval; owner assignment remains blocked (`SYNC-001`).

## Review and Change Log

| Version | Date | Change | Findings resolved | Approver |
|---|---|---|---|---|
| 0.1.0 | 2026-07-20 | Initial canonical-template authoring of `SPEC-HOTELWORKERS-001` from the current worktree (`af3cee5`, `HEAD`), per the auto-continue Documentation Workflow (dependency order, after `SPEC-CALENDAR-001`'s freeze merged). No `CONFIRMED_REQUIREMENTS_REGISTER.md`/`PIVOT_DESIGN_DOCUMENT.md` target-state content exists for this capability beyond the already-implemented lifecycle; this document is Current-state only. G1.5 Boundary Collision check performed before authoring: **PASS for current-state ownership, one target-state overlap recorded.** `SPEC-CRM-001` explicitly disclaims current `HotelWorker` ownership (`docs/03-modules/crm/MODULE_SPEC.md:136`, "not owned here... owning module is `backend-hotel-workers`"). A **target-state** ownership overlap was additionally identified (correcting a first-pass omission): `SPEC-EMP-001` designates the repurposed `HotelWorker` record as its target "employment record" (`docs/03-modules/employee-management/MODULE_SPEC.md:88,234`), consistent with `SPEC-JOB-DISPATCH-001`'s Roster term (PIVOT §9.1). This is not a current-state collision — current ownership by `backend-hotel-workers` is unambiguous and the target owner (`backend-hr`/Employee Management) is an unbuilt stub — so authoring the current-state spec proceeds, with the future disposition recorded as `OD-HW-07`. This authoring was itself gated by an explicit human-directed active-vs-legacy determination (2026-07-20): the module was confirmed an **active** architectural component (live full implementation, mounted, authoritative writer of `state-hotel-worker` read by five modules and by the live `checkHotelAccess()` authz middleware), not marketplace legacy — the retired marketplace artifact is `WorkApplication`, not `HotelWorker`. Documents the four-route roster CRUD/lifecycle surface as implemented; records the hotel-scoping bypass fact (`RULE-HW-07`/`OD-HW-02`, same class as `SIR-USERS-005`/`SIR-QUAL-003/004`), the unvalidated-enrollee-role gap (`RULE-HW-08`/`OD-HW-03`), the `joined_at`-overwrite-on-reactivation fact (`RULE-HW-05`/`OD-HW-04`), the unconditional-`DELETE`-vs-guarded-`PATCH` asymmetry (`RULE-HW-06`), and cross-references the platform-wide route-nesting execution coupling (`OD-HW-01`→`SIR-GLOB-011`) rather than re-deriving it. Freeze candidate submitted for G4 independent review and G2 human approval. Author cannot self-approve blocking findings (Constitution §12); **FROZEN status is withheld pending G4 completion and human approval.** | — (none dispositioned yet; G4 not yet begun) | — (pending) |
