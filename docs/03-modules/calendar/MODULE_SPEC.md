# Module Specification: `calendar`

## Document Control

| Field | Value |
|---|---|
| Spec ID / version | `SPEC-CALENDAR-001 / 0.1.0` |
| Status | `REVIEW` (freeze candidate; G2 Specification-Freeze pending — see Review and Change Log) |
| Owner | `unassigned` — reserved human authority (SYNC-001); no `CODEOWNERS` exists and `backend/package.json` author is empty |
| Authors / reviewers | Author: Lead Architect (specification-freeze workflow). Independent reviewers (architecture, dependency, consistency, security): **pending** (G4) |
| Repository revision | `c47df395f9c7c03252fbe79e765edf183e7959f8` (`c47df39`, worktree). Calendar sources (`backend/src/modules/calendar/**`) and `backend/prisma/schema.prisma` read at this revision. |
| Approved by / at | — (G2 freeze requires the named human approver; not yet approved) |
| Supersedes | None. No prior specification maps to `backend-calendar`; `docs/03-modules/calendar/` previously held only `.gitkeep`, and `MODULE_REGISTRY.yaml:176` records `specification: UNKNOWN`. |

> **Authoring note (not a normative section change).** This is the canonical-template instance for the Calendar & Availability Management module, authored per the [Documentation Workflow](../../../.claude/workflows/documentation.md) freeze sequence and the fixed shape of [`MODULE_SPEC_TEMPLATE.md`](../../../.claude/templates/MODULE_SPEC_TEMPLATE.md); the template file itself is unmodified. **Current Repository Behaviour** is derived exclusively from the current worktree (Prisma schema, module source, routing, middleware, tests). **Target Behaviour** is derived exclusively from the two authoritative business documents — `docs/00-foundations/CONFIRMED_REQUIREMENTS_REGISTER.md` (**CRR §n**) and `docs/00-foundations/PIVOT_DESIGN_DOCUMENT.md` (**PDD §n**). The three planes — **Current**, **Target**, **Migration Gap** — are kept explicitly separate throughout. No behaviour is drawn from marketplace-era or `docs/legacy/**` sources. This specification does **not** redesign the adjacent Job Dispatch, Assignments, Employee Management, or Notifications modules; it references them and records boundary conflicts as Open Decisions.

## Purpose and Scope

**Outcome:** The authoritative scheduling surface of the Workforce Operations Platform — the per-worker, per-day **calendar** that managers use to place workers directly (the primary assignment path), that workers use to view their own days and to self-mark **sick** or **vacation**, and the derived **today-only red/green availability** signal other modules read. Today this behaviour is **entirely unbuilt**: the `calendar` code module is a route-registered stub whose only shape models manager-entered reception data, not scheduling (CRR §13, §20, §22; PDD §4.5, §7.2, §9.3).

**In scope:**

- **Current:** A route-registered `calendar` module mounted at `/api/v1/calendar` exposing two authenticated, hotel-scoped endpoints (`GET`/`POST /hotels/:hotel_id/operations`); both delegate to `CalendarService` methods that throw `NotImplementedError` (HTTP 501) (`backend/src/modules/calendar/{routes,controller,service}.ts`; `backend/src/routes/v1/index.ts:34`).
- **Current:** A single type, `DailyOperation { id, date, room_count, checkout_count, stay_over_count, notes? }` (`backend/src/modules/calendar/types.ts`), which shapes **manager-entered daily reception/operations data** (checked-out rooms, long-stay guests — CRR §19), **not** calendar scheduling entries. This drift is recorded as OD-CAL-10.
- **Target:** The **weekly-plan calendar** — a manager places/selects workers for a hotel day-by-day as a **direct assignment with no worker accept/decline step**; the placement simply appears on the worker's calendar and does **not** trigger a broadcast (CRR §13 §192–§198; PDD §4.4, §7.2).
- **Target:** A worker's **own-calendar view** (CRR §13 §197; PDD §4.5).
- **Target:** **Sick/vacation self-marking** — a worker marks a **current or future** day as `sick` or `vacation` (type mandatory); the manager is notified; **auto-cancels** any existing assignment for that day; no cap, no advance notice, no approval; vacation is a label only with **no balance tracking** (CRR §22; PDD §4.5).
- **Target:** **Daily assignment exclusivity** — once a worker is assigned anything for a day (via calendar **or** broadcast), they are blocked from any further assignment for that entire day (CRR §13 §214–§216; PDD §4.4). **The enforcement locus is an Open Decision (OD-CAL-02).**
- **Target:** The **today-only red/green availability indicator** — Red = not available today, Green = available today; derived from the confirmed inputs (same-day assignment + sick/vacation) and **not** re-computed for the calendar date being viewed (CRR §20; PDD §4.10). **Ownership of this indicator is proposed here and requires human confirmation (OD-CAL-01; resolves SPEC-EMP-001 OD-EMP-07).**
- **Target:** The `CalendarEntry` persistence model (per-worker per-day assignment/sick/vacation) and the partial unique index that enforces one active assignment per worker per day (PDD §9.3, §9.4).

**Out of scope:** (owned elsewhere and referenced, never redefined — Constitution §6)

- **Broadcast job requests** (gap-fill dispatch), the skill × headcount request, eligible-worker computation, first-accept slot locking, the 6-hour auto-close, and "requirement fulfilled" messaging. Owned by the **Job Dispatch / work-requests** module (CRR §13 Fallback; PDD §4.4, §7.3). Calendar only supplies/reads the same-day-assignment fact that gates exclusivity.
- **The assignment record itself** (`WorkerAssignment`) and its lifecycle. Owned by the **assignments** module (`state-worker-assignment`, `DEPENDENCY_GRAPH.yaml`). Whether a direct calendar placement creates a `WorkerAssignment`, a `CalendarEntry`, or both is a boundary Open Decision (OD-CAL-03).
- **Skill-based eligibility** for broadcasts (matching skill ∧ free that day). Owned by Job Dispatch, reading skills from Employee Management (CRR §13; SPEC-EMP-001 `IF-EMP-GetSkills`).
- **Push-notification delivery** of the sick/vacation manager alert. Owned by the **Notifications** module (push-only; CRR §18); Calendar triggers, Notifications delivers (OD-CAL-06).
- **Authentication, JWT issuance, role/scope claims, sessions, MFA.** Owned by Authentication/User Management (`backend/src/middleware/auth.ts`; PDD §5.3).
- **The RBAC/scope framework** and the role → permission map (`backend/src/middleware/permissions.ts`; PDD §5.4). Calendar reuses `authMiddleware` and `checkHotelAccess()`.
- **The Hotel reference** and Hotel-Group scoping (owned by `crm`; SPEC-CRM-001) and the **employee/roster record** and its skills/lifecycle (owned by Employee Management; SPEC-EMP-001). Calendar references both.
- **Manager-entered reception/operations data** (checked-out rooms, long-stay guests — CRR §19; `ReceptionData` model, PDD §9.3). The current stub's `/operations` shape models this; its owning module is an Open Decision (OD-CAL-10).
- **Attendance/geofencing, quality/ratings, analytics (incl. sick/vacation counts per hotel), retention deletion, consent gating** — each its own module; each merely reads calendar/availability facts (CRR §17, §21, §25; PDD §7.4–7.6).

**Non-goals:** (confirmed out of the platform entirely — CRR §22, §13 Removed-from-jobs, Explicit Non-Goals)

- **Leave-balance tracking** and any remaining-leave-days accounting (CRR §22 §306; Explicit Non-Goals). Vacation is a label only.
- **Leave-approval workflow** — no approval step; the manager is only notified after the fact (CRR §22 §305, §307).
- **Shift swaps** and **coverage planning** (CRR §22 §308–§309; Explicit Non-Goals).
- **Recurring / repeating schedule patterns** — manual day-by-day entry only (CRR §13 §226, §22 §310).
- **A formal job status state machine** (Open→Assigned→In Progress→…) — the rest is handled manually (CRR §13 §225).
- **Rooms/floors/buildings/zones** scheduling (CRR §11; PDD §9.5 notes only future extensibility, out of scope now).
- **Doctor's note / sick-note health data** — sick is a plain calendar flag to avoid storing sensitive health data (CRR §22, §27 §353).

## Evidence and Traceability

Each requirement maps: **Repository Evidence → Business Rule → Acceptance Criteria → Open Decision (if any) → Knowledge Delta**. The `Status` column names the plane the row governs (Current / Target / Non-goal).

| Claim/requirement | Source path, line, revision, or decision | Authority | Status |
|---|---|---|---|
| `REQ-CAL-001` `calendar` module is route-registered and mounted at `/api/v1/calendar` | `backend/src/routes/v1/index.ts:34`; `backend/src/modules/calendar/routes.ts` | Current repository | Confirmed current-state |
| `REQ-CAL-002` The only two endpoints are `GET`/`POST /hotels/:hotel_id/operations`, both `authMiddleware` + `checkHotelAccess()` guarded | `backend/src/modules/calendar/routes.ts:7-14` | Current repository | Confirmed current-state |
| `REQ-CAL-003` Both service methods throw `NotImplementedError` → HTTP 501; no persistence, no scheduling logic exists | `backend/src/modules/calendar/service.ts:5-11`; `backend/src/lib/errors.ts:77-83` | Current repository | Confirmed current-state |
| `REQ-CAL-004` The only shape is `DailyOperation {room_count, checkout_count, stay_over_count, notes?}` — reception/operations data, not scheduling | `backend/src/modules/calendar/types.ts:1-8`; cf. CRR §19 | Current repository | Confirmed current-state; drift (OD-CAL-10) |
| `REQ-CAL-005` No `CalendarEntry`, availability, sick, or vacation model exists; schema is still marketplace-era (`WorkApplication` present, `WorkerAssignment.application_id` mandatory) | `grep -rniE "calendarentry|availability|sick|vacation" backend/prisma` → 0; `backend/prisma/schema.prisma:279,314-326` | Current repository | Confirmed current-state (Migration Gap) |
| `REQ-CAL-006` Manager builds a weekly plan via a calendar interface, placing workers per day as a **direct** assignment (no accept step) that appears on the worker's calendar and triggers no broadcast | CRR §13 (§192–§198); PDD §4.4 (§105), §7.2 | Authoritative (business) | Confirmed target |
| `REQ-CAL-007` A worker can view their own calendar | CRR §13 (§197); PDD §4.5 (§111) | Authoritative (business) | Confirmed target |
| `REQ-CAL-008` A worker can mark a current or future day `sick` or `vacation` (type mandatory); the manager is notified; no cap, advance notice, or approval | CRR §22 (§298–§307); PDD §4.5 (§112) | Authoritative (business) | Confirmed target |
| `REQ-CAL-009` Marking a day sick or vacation **auto-cancels** any existing assignment for that day, atomically | CRR §22 (§302); PDD §4.5 (§113), §7.2 (§273) | Authoritative (business) | Confirmed target |
| `REQ-CAL-010` Daily exclusivity: once assigned anything for a day (calendar **or** broadcast), the worker is blocked from any further assignment that entire day | CRR §12 (§187), §13 (§214–§216); PDD §4.4 (§108), §9.4 (§399) | Authoritative (business) | Confirmed target; **enforcement locus open (OD-CAL-02)** |
| `REQ-CAL-011` Today-only red/green availability indicator; Red = unavailable today, Green = available today; not date-of-view sensitive | CRR §20 (§282–§286); PDD §4.10 (§133–§134) | Authoritative (business) | Confirmed target; **ownership proposed here (OD-CAL-01)** |
| `REQ-CAL-012` Vacation is a label only — no balance tracking; no leave-approval, shift swaps, coverage planning, or recurring patterns | CRR §22 (§306–§310); Explicit Non-Goals (§439) | Authoritative (business) | Confirmed non-goal fencing |
| `REQ-CAL-013` `CalendarEntry` (per-worker per-day assignment/sick/vacation) is the added persistence model, with a partial unique index enforcing one active assignment per worker per day | PDD §9.3 (§393), §9.4 (§399) | Authoritative (business) | Confirmed target (Migration Gap) |
| Backend code module for the calendar domain is `backend-calendar` (route-registered stub); no frozen spec currently maps to it | `MODULE_REGISTRY.yaml:167-177`; `DEPENDENCY_GRAPH.yaml:39,512` | Generated (repo-derived) | Confirmed current-state |
| Knowledge contradiction: registry marks calendar `active`/`active-no-tests` ("implemented") while dependency graph marks it `stub` (all methods throw) | `MODULE_REGISTRY.yaml:171-172` vs `DEPENDENCY_GRAPH.yaml:39,512,515` | Generated (repo-derived) | Contradiction — OD-CAL-05 |
| SPEC-EMP-001 explicitly defers availability-indicator ownership to Calendar + Job Dispatch freeze | `docs/03-modules/employee-management/MODULE_SPEC.md:308` (OD-EMP-07) | Documentation | Cross-spec dependency — OD-CAL-01 |
| Authoritative business documents live under `docs/00-foundations/` | worktree at `c47df39` | Current repository | Confirmed (same location discrepancy noted in SPEC-EMP-001 OD-EMP-11, SPEC-CRM-001) |

## Actors and Terminology

| Term/actor | Canonical definition | Source |
|---|---|---|
| Calendar / Weekly plan | The per-worker, per-day scheduling surface a manager edits to place workers directly; the **primary** assignment path | CRR §13 (§192); PDD §4.4, §7.2 |
| Direct assignment | A calendar placement that takes effect with **no** worker accept/decline step and triggers **no** broadcast | CRR §13 (§195–§198) |
| Broadcast (job request) | The **fallback** gap-fill dispatch path, owned by Job Dispatch — referenced here only as an exclusivity input | CRR §13 (§200–§212); PDD §4.4 |
| Calendar entry | A per-worker, per-day record whose kind is `assignment`, `sick`, or `vacation` (target model `CalendarEntry`) | PDD §9.3 (§393) |
| Sick flag | A worker-set day marker of kind `sick`; a plain flag storing **no** doctor's note / health data | CRR §22 (§298), §27 (§353) |
| Vacation flag | A worker-set day marker of kind `vacation`; a **label only** with no balance tracking | CRR §22 (§298, §306) |
| Daily exclusivity | The invariant that a worker assigned anything on a day cannot take another assignment that day (calendar or broadcast) | CRR §13 (§214–§216); PDD §4.4 (§108) |
| Availability indicator | The **today-only** red/green signal of whether a worker is available today; Red = unavailable, Green = available | CRR §20; PDD §4.10 |
| Staff (Worker) | Permanent employee who views their own calendar and self-marks sick/vacation; role token `WORKER` | CRR §1; SPEC-EMP-001 |
| Hotel Manager | Manager who builds the weekly plan for their hotel; role token `MANAGER` | CRR §1, §13; PDD §5.4 |
| Regional Manager | New role overseeing a Hotel Group; scheduling scope across the group is undefined (**no enum token exists yet**) | CRR §1; SPEC-CRM-001 (role gap) |
| Daily operations / reception data | Manager-entered checked-out rooms / long-stay guests (CRR §19); the concept the **current stub** shape models — distinct from calendar scheduling | CRR §19; `types.ts:1-8`; PDD §9.3 (`ReceptionData`) |

## Requirements and Acceptance Criteria

Requirements are grouped by plane. `REQ-CAL-C0x` = **Current** repository state; `REQ-CAL-T0x` = **Target** behaviour.

| Requirement | Statement | Priority | Acceptance criteria | Rule IDs |
|---|---|---|---|---|
| `REQ-CAL-C01` | The `calendar` module is route-registered at `/api/v1/calendar` and applies `authMiddleware` globally and `checkHotelAccess()` per route. | MUST (current) | Unauthenticated request → 401; a route exists at `GET`/`POST /hotels/:hotel_id/operations`; mount verified at `routes/v1/index.ts:34`. | `RULE-CAL-C1` |
| `REQ-CAL-C02` | Both endpoints are non-functional stubs. | MUST (current) | Any authenticated, hotel-authorized call returns **HTTP 501** with the `NotImplementedError` envelope; no row is created or read. | `RULE-CAL-C2` |
| `REQ-CAL-C03` | No scheduling/availability persistence or logic exists; the only shape (`DailyOperation`) models reception data. | MUST (current) | No `CalendarEntry`/availability/sick/vacation identifier appears in `backend/prisma` or `backend/src`; `DailyOperation` fields are `room_count/checkout_count/stay_over_count/notes?`. | `RULE-CAL-C2` |
| `REQ-CAL-T01` | Provide a manager weekly-plan calendar that places workers per hotel day-by-day as a direct assignment with no worker accept step and no broadcast side-effect. | MUST (target) | A manager placement creates a `CalendarEntry` (kind `assignment`) for a (worker, hotel, day); the worker performs no accept action; no `JobRequest`/broadcast is emitted; the entry appears on the worker's calendar. | `RULE-CAL-01`, `RULE-CAL-05` |
| `REQ-CAL-T02` | Let a worker view their own calendar. | MUST (target) | A worker reads their own per-day entries within scope; a worker cannot read another worker's calendar. | `RULE-CAL-02` |
| `REQ-CAL-T03` | Let a worker self-mark a current or future day `sick` or `vacation`, with the type mandatory, no cap, no advance-notice, and no approval; notify the manager. | MUST (target) | Marking a **past** day is rejected; kind must be exactly `sick` or `vacation`; the entry is stored and the responsible manager is notified (delivery via Notifications); no approval gate exists. | `RULE-CAL-03`, `RULE-CAL-06` |
| `REQ-CAL-T04` | On a sick/vacation mark, atomically auto-cancel any existing assignment for that worker on that day. | MUST (target) | In a single transaction, the sick/vacation entry is written and the same-day assignment is cancelled; no interleaving leaves a worker both assigned and on-leave. | `RULE-CAL-04`, `RULE-CAL-07` |
| `REQ-CAL-T05` | Enforce daily exclusivity: a worker assigned anything (calendar or broadcast) on a day cannot receive another assignment that day. | MUST (target) | A second same-day assignment attempt is rejected; the guarantee holds across the calendar path and the broadcast path; a partial unique index backs it at the DB level. **Enforcement locus open (OD-CAL-02).** | `RULE-CAL-05` |
| `REQ-CAL-T06` | Derive and expose a today-only red/green availability indicator from same-day assignment and sick/vacation state. | MUST (target) | Indicator = Red iff the worker is assigned today or marked sick/vacation today, else Green; the value does not change with the calendar date being viewed. **Ownership proposed here; confirm via OD-CAL-01.** | `RULE-CAL-08` |
| `REQ-CAL-T07` | Enforce the confirmed non-goals: vacation is a label only (no balance), and no leave-approval, shift swaps, coverage planning, or recurring patterns exist. | MUST (target) | No remaining-leave counter is tracked; no approval/swap/coverage/recurrence surface is introduced; all entry creation is manual, day-by-day. | `RULE-CAL-03`, `RULE-CAL-06` |
| `REQ-CAL-T08` | Persist scheduling state in a `CalendarEntry` model (per-worker per-day, kind ∈ {assignment, sick, vacation}) with the daily-exclusivity partial unique index. | MUST (target) | The model exists with one active `assignment`-kind entry per (worker, day) enforced by a partial unique index; sick/vacation entries carry the day and kind. **Relationship to `WorkerAssignment` open (OD-CAL-03).** | `RULE-CAL-05` |

## Business Rules

Rules prefixed `RULE-CAL-Cx` describe **Current** state; `RULE-CAL-0x` describe **Target** behaviour.

| Rule | Preconditions | Outcome/invariant | Exceptions/precedence | Owner/source |
|---|---|---|---|---|
| `RULE-CAL-C1` | Request reaches `/api/v1/calendar/hotels/:hotel_id/operations` | `authMiddleware` then `checkHotelAccess()` run; unauthenticated → 401; admin/manager/checker bypass hotel-membership check | Worker without hotel access → 403 | Current repo (`routes.ts:7-14`; `permissions.ts:96-108`) |
| `RULE-CAL-C2` | Authorized call reaches the service | Method throws `NotImplementedError` → HTTP 501; no side effect | None | Current repo (`service.ts:5-11`) |
| `RULE-CAL-01` | Manager edits the weekly plan for a hotel/day | A direct `assignment`-kind entry is created for the (worker, hotel, day); no accept step; no broadcast fired | Broadcast is a separate, manager-initiated path (Job Dispatch) | Target (CRR §13; PDD §4.4) |
| `RULE-CAL-02` | Worker requests calendar | Worker sees only their own per-day entries within scope | Managers/higher roles see their scope (OD-CAL-11) | Target (CRR §13 §197) |
| `RULE-CAL-03` | Worker marks a day sick/vacation | Day must be **today or future**; kind ∈ {sick, vacation}; stored; no approval, no cap, no advance notice; vacation carries no balance | Past-day mark rejected | Target (CRR §22) |
| `RULE-CAL-04` | A sick/vacation mark lands on a day with an existing assignment | The same-day assignment is **auto-cancelled** in the same transaction | Atomicity mandatory (PDD §7.2) | Target (CRR §22 §302; PDD §7.2) |
| `RULE-CAL-05` | Worker already has an active assignment for a day | Any further same-day assignment (calendar or broadcast) is blocked; a partial unique index enforces one active assignment per worker per day | Enforcement locus open (OD-CAL-02); relationship to `WorkerAssignment` open (OD-CAL-03) | Target (CRR §13 §214–§216; PDD §9.4) |
| `RULE-CAL-06` | Worker completes a sick/vacation mark | The responsible manager is notified (after the fact; Calendar triggers, Notifications delivers) | No approval; notification is informational | Target (CRR §22 §301; CRR §18) |
| `RULE-CAL-07` | Concurrent same-day assignment and sick/vacation mark | A single transaction prevents a worker appearing both assigned and on-leave | Shared invariant with Job Dispatch/assignments | Target (PDD §7.2, §9.4) |
| `RULE-CAL-08` | Availability read for a worker | Red iff assigned today **or** marked sick/vacation today; else Green; **today-only**, independent of the viewed calendar date | Ownership/derivation locus proposed here (OD-CAL-01) | Target (CRR §20; PDD §4.10) |

## Ownership and Boundaries

**Module owner:** `unassigned` — accountable owner assignment is reserved human authority (SYNC-001; no `CODEOWNERS`, empty `backend/package.json` author). Code-level home is the `backend-calendar` module (`backend/src/modules/calendar`), currently a route-registered **stub** whose service methods throw `NotImplementedError` (`DEPENDENCY_GRAPH.yaml:39,512`). The registry's `active`/"implemented" label (`MODULE_REGISTRY.yaml:171-172`) contradicts this and is flagged as OD-CAL-05.

**Owned state (Target):**

- `CalendarEntry` — the per-worker, per-day scheduling record whose kind is `assignment`, `sick`, or `vacation` (PDD §9.3). This module is the authoritative writer of the **sick/vacation** dimension.
- The **daily availability** derivation (today-only red/green), **proposed** as owned here per the module's mandate "Calendar & Availability Management" (OD-CAL-01; resolves SPEC-EMP-001 OD-EMP-07).

**Consumed state (owned elsewhere, referenced never redefined):** the **Hotel** reference and Hotel-Group scope (`crm`; SPEC-CRM-001); the **employee/roster** record, skills, and blocklist (Employee Management; SPEC-EMP-001); the **`WorkerAssignment`** record and its cancellation mechanics (assignments module); **broadcast** eligibility and the same-day-assignment fact from the broadcast path (Job Dispatch); **account/role/scope** (Authentication/User Management); **push delivery** (Notifications).

**Permitted writes (Target):** only to this module's owned state (`CalendarEntry` sick/vacation entries; and, pending OD-CAL-03, direct-placement `assignment` entries) and only through its own interfaces. The auto-cancel of a same-day assignment (`RULE-CAL-04`) writes assignment state that the assignments module owns — this cross-boundary write is the crux of OD-CAL-03 and must be resolved before implementation. This module never writes account, hotel, employee, quality, attendance, or notification state.

**Boundary/non-responsibilities:** this module does **not** run broadcast dispatch, compute skill eligibility, own the `WorkerAssignment` lifecycle, deliver notifications, gate consent, compute analytics, or handle manager reception/operations data (CRR §19) — even though the **current stub** is misnamed toward the latter (OD-CAL-10). Availability-indicator ownership is **claimed provisionally** and is subject to human confirmation.

## Interfaces and Contracts

> **Current:** the only concrete interface is the two stub endpoints below, both returning HTTP 501. **Target** contracts are the business-level interfaces implied by owned state and confirmed behaviour; concrete transport/versioned signatures are an Open Decision (OD-CAL-08), consistent with SPEC-EMP-001 OD-EMP-09 and the absence of any enumerated interface schema in the authoritative documents. Direction is relative to this module.

| Contract ID/version | Direction | Input | Output | Errors | Auth | Compatibility |
|---|---|---|---|---|---|---|
| `IF-CAL-GetOperations / current` | Inbound (query) | `hotel_id` (path), `date` (query) | — (stub) | **501 Not Implemented** | `authMiddleware` + `checkHotelAccess()` | Current stub; shape is reception data (OD-CAL-10) |
| `IF-CAL-CreateOperation / current` | Inbound (command) | `hotel_id` (path), body | — (stub) | **501 Not Implemented** | `authMiddleware` + `checkHotelAccess()` | Current stub |
| `IF-CAL-GetOwnCalendar / v0` | Inbound (query) | Worker id (self), date range | The worker's per-day entries | Not found; scope denied | Self (Worker) | New (target) |
| `IF-CAL-PlaceAssignment / v0` | Inbound (command) | Manager id, hotel id, worker id, day | `CalendarEntry` (kind `assignment`); no accept step; no broadcast | Exclusivity violation (same-day already assigned); scope denied | Hotel Manager (scope); Regional Manager `[OPEN]` (OD-CAL-11) | New (target); creates/links `WorkerAssignment` `[OPEN]` (OD-CAL-03) |
| `IF-CAL-MarkSickVacation / v0` | Inbound (command) | Worker id (self), day, kind ∈ {sick, vacation} | `CalendarEntry` (kind sick/vacation); same-day assignment auto-cancelled; manager notified | Past-day rejected; invalid kind rejected | Self (Worker) | New (target) |
| `IF-CAL-GetAvailability / v0` | Inbound (query) | Worker id (or set) | Today-only red/green per worker | Not found | Manager/dispatch scope; self | New (target); **owner proposed here (OD-CAL-01)** |

## Events

> **Current:** no events are published or consumed (`MODULE_REGISTRY.yaml:174-175` records `published_events: none-observed`, `consumed_events: none-observed`; no event bus exists — every module records the same). The following are **Target** business-level domain events implied by owned-state changes; the concrete event contract/transport is an Open Decision (OD-CAL-08).

| Event ID/version | Publisher | Trigger | Payload source | Consumers | Delivery/idempotency |
|---|---|---|---|---|---|
| `EVT-CAL-AssignmentPlaced / v0` | calendar | Manager places a worker on a day (direct) | Worker, hotel, day | Employee Management (availability input), Notifications, Audit | `[OPEN]` (OD-CAL-08) |
| `EVT-CAL-SickVacationMarked / v0` | calendar | Worker marks a current/future day sick/vacation | Worker, day, kind | Notifications (manager alert), assignments (auto-cancel), Analytics (counts), Audit | `[OPEN]` |
| `EVT-CAL-AssignmentAutoCancelled / v0` | calendar | Sick/vacation mark cancels a same-day assignment | Worker, day, prior assignment | assignments, Notifications, Audit | Must be atomic with the mark (PDD §7.2) |
| `EVT-CAL-AvailabilityChanged / v0` | calendar | Same-day assignment or sick/vacation state changes for today | Worker, today, red/green | Employee Management (profile indicator), dashboards | `[OPEN]`; **contingent on OD-CAL-01** |

**Consumed events (Target; contract `[OPEN]`):** Job Dispatch — a broadcast acceptance assigns a worker for a day → exclusivity + availability input (CRR §13); assignments — assignment cancellation/creation → calendar/availability freshness; Employee Management — employee deactivation → suppress calendar surface.

## Dependencies

| Dependency/edge | Reason | Contract | Compatibility | Failure behavior |
|---|---|---|---|---|
| Authentication / User Management | Authenticates the request; supplies role/scope | `auth-middleware` (reused, `DEPENDENCY_GRAPH.yaml:380`) | compatible (reuse) | No auth → 401; calendar unavailable |
| RBAC / permissions | Hotel-scope authorization for placement/read | `permissions-middleware` → `checkHotelAccess()` (reused, `DEPENDENCY_GRAPH.yaml:398`) | compatible (reuse) | Out-of-scope → 403 |
| CRM (Hotels) | Hotel reference + Hotel-Group scope for placement | referenced (Hotels-owned; SPEC-CRM-001) | conditional (RM scope not yet modeled) | Unknown hotel → placement rejected |
| Employee Management | Worker identity, skills, active status; consumes availability | referenced (SPEC-EMP-001); `IF-CAL-GetAvailability` | conditional (schema `[OPEN]`) | Inactive/unknown worker → not schedulable |
| assignments | `WorkerAssignment` create (direct path) + auto-cancel on sick/vacation | cross-boundary write `[OPEN]` (OD-CAL-03) | **conditional (ownership unresolved)** | Ambiguous ownership → double-write / drift risk |
| Job Dispatch / work-requests | Broadcast acceptance is the other exclusivity input | consumed fact/event (candidate) | conditional | Exclusivity gap if inputs unsynchronized |
| Notifications | Manager alert on sick/vacation; push-only | `notification-service` (reused) | compatible | Alert undelivered; calendar state unaffected |
| Analytics | Sick/vacation counts per hotel; active-workers/day | referenced (Analytics-owned; CRR §21) | compatible | Stale analytics only |
| Platform/infrastructure | PostgreSQL system of record; Express/TS modular monolith; `base-service`; immutable audit; scheduled jobs (node-cron/BullMQ) for adjacent timers | shared infrastructure (reuse) | compatible (reuse) | Standard platform failure modes |

## State and Lifecycle

**Current (repository):** no domain state. The two endpoints are stubs; a call transits `authMiddleware → checkHotelAccess() → CalendarService.*` and terminates in `NotImplementedError` (HTTP 501). No `CalendarEntry` table, no availability derivation, no scheduled job.

**Target — `CalendarEntry` states (per worker, per day):**

- **assignment** — a manager-placed (or broadcast-accepted) working day. Subject to daily exclusivity: at most one **active** assignment per (worker, day) (PDD §9.4).
- **sick** — worker-marked day; auto-cancels any same-day assignment; stores no health data.
- **vacation** — worker-marked day; label only; no balance tracking.

**Target — transitions (each audit-logged; each from a confirmed action):**

- `(none) → assignment` — manager direct placement (`RULE-CAL-01`), or (referenced) broadcast acceptance in Job Dispatch.
- `(none) → sick | vacation` — worker self-mark on a current/future day (`RULE-CAL-03`).
- `assignment → cancelled` — a same-day sick/vacation mark auto-cancels the assignment, **atomically** with the mark (`RULE-CAL-04`, `RULE-CAL-07`).
- A **past** day cannot receive a new sick/vacation mark (`RULE-CAL-03`).

**Invariants:** at most one active `assignment`-kind entry per (worker, day), enforced by a partial unique index (PDD §9.4); a worker is never simultaneously `assignment` and `sick`/`vacation` on the same day (atomic auto-cancel); the availability indicator is **today-only** and independent of the viewed date (`RULE-CAL-08`); no leave balance is tracked; no recurring entries are generated.

**Concurrency:** the sick/vacation-vs-assignment race is resolved in a **single transaction** (PDD §7.2). The broadcast last-slot race is resolved in Job Dispatch (Redis slot lock, `SELECT … FOR UPDATE` fallback; PDD §7.3) — **not** here. The shared daily-exclusivity invariant is ultimately guarded by the DB partial unique index; the module that owns the write path is OD-CAL-02.

**Retention/migration:** pre-launch, no production calendar data (PDD §10); introducing `CalendarEntry` is additive. Sick flags store no sick-note/health data by design (CRR §27 §353). Sick/vacation counts feed analytics but are not separately retained by this module.

## Failure, Security, Privacy, and Performance

**Failure modes/recovery:**

- **Current:** every functional call returns 501; there is no data path to fail. (This is itself the top migration risk: the module is named/registered but does nothing.)
- **Target:** past-day sick/vacation mark → rejected; second same-day assignment → rejected (exclusivity); sick/vacation mark where auto-cancel cannot complete → whole transaction rolls back (no partial state); manager notification undelivered → calendar state stands, alert retried by Notifications; unknown hotel/worker → placement rejected.

**Trust boundaries/authorization:** reuse existing authentication (`authMiddleware`) and hotel-scope authorization (`checkHotelAccess()` — admin/manager/checker bypass the membership check, `permissions.ts:103-108`). Deny-by-default on role × hotel/group scope. A worker may read/write only their **own** calendar (self sick/vacation); managers place workers within their hotel scope. The Regional-Manager scheduling scope across a Hotel Group is unmodeled (no enum token — SPEC-CRM-001 role gap; OD-CAL-11).

Permission matrix (Target; reused five-role RBAC, deny-by-default):

| Capability | Staff (Worker) | Checker | Hotel Manager | Regional Manager | Admin |
|---|---|---|---|---|---|
| View own calendar | ✅ (self) | — | — | — | — |
| Mark own day sick/vacation (today/future) | ✅ (self) | — | — | — | — |
| Place a worker on the calendar (direct) | — | — | ✅ (their hotel) | `[OPEN]` (OD-CAL-11) | ✅ |
| View a worker's calendar | — | `[OPEN]` | ✅ (their hotel) | ✅ (their group) | ✅ (all) |
| Read availability indicator | — | ✅ (scope) | ✅ (their hotel) | ✅ (their group) | ✅ (all) |

**Data classification/retention:** Germany-only; no data leaves the EU/EEA (PDD §5.7). Sick is a plain flag with **no** health data (avoids special-category storage — CRR §27 §353). Calendar entries are general operational data; the daily GDPR consent gate (Consent module) is an access precondition (CRR §24). No new special-category field is introduced here.

**Performance budgets/workload:** no explicit SLO is defined in the authoritative documents. Design intent: availability and eligible-worker reads must be fast enough for broadcast eligibility computation, aided by the `(skill, hotel_id)`/availability index (PDD §9.4 §400). Concrete budgets are deferred to implementation and not asserted here (labelled unknown, Constitution §6).

**Observability/audit:** placement, sick/vacation marks, and auto-cancellations are logged immutably through the shared audit framework (`base-service.logAudit`, `base-service.ts:7-31`), consistent with sibling modules; no admin-facing log-viewer screen is introduced (CRR §30).

## Rollout and Compatibility

This module is part of the marketplace → Workforce Operations Platform forward refactor (pre-launch; no production data, so no dual-run migration — PDD §10). Calendar/scheduling is **roadmap M2 "Dispatch"** (PDD §10 Phase 2; roadmap §453), landing alongside broadcast `JobRequest`, the Redis slot lock, the 6-hour auto-close, and daily exclusivity. Phase 2 depends on **Phase 1 foundation realignment** (Regional-Manager role + scope, response-envelope centralization, removing `WorkApplication`, repointing `WorkerAssignment` to direct creation — PDD §10 Phase 1) which has **not** yet occurred in the worktree (schema still marketplace-era).

**Sequencing dependency:** `REQ-CAL-T01`/`REQ-CAL-T08` (direct placement, `CalendarEntry`, exclusivity index) require `WorkerAssignment.application_id` to become non-mandatory and `CalendarEntry` to be added — both Phase-1/Phase-2 schema changes not present at `c47df39`.

**Feature flags:** new capability sits behind the existing `FEATURE_*` env-flag convention so partial deploys are safe (PDD §10).

**Backward compatibility:** the current `/operations` stub has no consumers (`DEPENDENCY_GRAPH.yaml:512,515` — "no discovered client consumer"), so replacing or removing its reception-data shape is non-breaking; its disposition is OD-CAL-10.

**Rollback:** additive and pre-launch — rollback is disabling the feature flag and redeploying the prior build (PDD §10).

**Removal criteria:** not applicable — calendar/scheduling is a permanently-owned primary capability once built.

## Validation Plan

| Criterion | Test level/check | Environment/data | Evidence required |
|---|---|---|---|
| Module mounted; auth + hotel-scope guards applied (`REQ-CAL-C01`) | Integration + route check | Running app | 401 unauthenticated; route present at `routes/v1/index.ts:34` |
| Both endpoints return 501; no side effect (`REQ-CAL-C02`, `REQ-CAL-C03`) | Integration | Authorized caller | 501 body; no row created/read |
| Direct placement creates an assignment entry with no accept step and no broadcast (`REQ-CAL-T01`) | Integration | Manager + worker + hotel | Entry created; no `JobRequest`; worker took no action |
| Worker sees only own calendar (`REQ-CAL-T02`) | Authorization | Multi-worker data | Self-only visibility; cross-worker denied |
| Sick/vacation: past-day rejected, type mandatory, manager notified, no approval (`REQ-CAL-T03`) | Unit + integration | Today/future/past cases | Past rejected; kind validation; notification emitted |
| Auto-cancel is atomic (`REQ-CAL-T04`) | Integration (transaction) | Assigned day + concurrent mark | No state with both assigned and on-leave; rollback on failure |
| Daily exclusivity across calendar + broadcast (`REQ-CAL-T05`) | Integration + DB constraint | Same-day double-assign attempts | Second assignment rejected; partial unique index enforced. **Blocked on OD-CAL-02** |
| Availability is today-only from confirmed inputs (`REQ-CAL-T06`) | Unit | Assigned/sick/vacation/free cases | Red/green correct; independent of viewed date. **Blocked on OD-CAL-01** |
| Non-goals absent: no balance/approval/swap/coverage/recurrence (`REQ-CAL-T07`) | Static + review | Codebase scan | Absence of the named surfaces |
| `CalendarEntry` model + exclusivity index exist (`REQ-CAL-T08`) | Schema/migration check | Migrated DB | Model + partial unique index present. **Blocked on OD-CAL-03** |

## Risks, Assumptions, and Open Decisions

| ID | Type | Description | Evidence/impact | Owner | Resolution/status |
|---|---|---|---|---|---|
| `OD-CAL-01` | Open decision | **Availability-indicator ownership/derivation.** Module is named "Calendar & Availability"; this spec proposes Calendar owns/derives the today-only red/green signal. Inputs span Calendar (sick/vacation) and Job Dispatch/assignments (same-day assignment). | CRR §20; PDD §4.10; SPEC-EMP-001 OD-EMP-07 defers to Calendar+Dispatch freeze | Architecture/Human | Open — **proposal**; confirming this here resolves OD-EMP-07; blocks `REQ-CAL-T06` validation |
| `OD-CAL-02` | Open decision | **Daily-exclusivity enforcement locus.** DB partial unique index is confirmed, but the owning write path (Calendar vs assignments vs Job Dispatch) is unspecified. | CRR §13 §214–§216; PDD §7.2, §9.4; SPEC-EMP-001 RULE-EMP-05 says "Job Dispatch enforces" | Architecture/Human | Open — blocks `REQ-CAL-T05` |
| `OD-CAL-03` | Open decision | **`CalendarEntry` ↔ `WorkerAssignment` relationship.** Does direct placement create a `WorkerAssignment`, a `CalendarEntry`, or both? Auto-cancel writes assignment state this module does not own. | PDD §9.1 (`WorkerAssignment` from calendar), §9.3 (`CalendarEntry`) | Architecture/Human | Open — cross-boundary write; blocks `REQ-CAL-T01`, `REQ-CAL-T08` |
| `OD-CAL-04` | Open decision | **"Today" / timezone + current-vs-future boundary.** CRR/PDD do not define the timezone anchoring "today" or the current/future cutoff (`Europe/Berlin` default vs worker-local). | CRR §20, §22 §299; Hotel `timezone` default `Europe/Berlin` (SPEC-CRM-001) | Product/Architecture/Human | Open — affects `REQ-CAL-T03`, `REQ-CAL-T06` |
| `OD-CAL-05` | Contradiction | **Knowledge drift on lifecycle.** Registry marks calendar `active`/`active-no-tests` ("implemented"); dependency graph + code mark it `stub` (throws). | `MODULE_REGISTRY.yaml:171-172` vs `DEPENDENCY_GRAPH.yaml:39,512` | Human (SYNC-001) | Open — reconcile registry to `stub` on human confirmation |
| `OD-CAL-06` | Open decision | **Manager-notification contract for sick/vacation.** Calendar triggers, Notifications delivers; event/transport unspecified. | CRR §22 §301; §18 | Architecture/Human | Open — affects `EVT-CAL-SickVacationMarked` |
| `OD-CAL-07` | Open decision | **Which manager roles may edit the calendar / cross-hotel scope.** Regional-Manager scheduling scope across a Hotel Group is unmodeled (no enum token). | CRR §12, §13; SPEC-CRM-001 role gap | Product/Human | Open — affects permission matrix, `IF-CAL-PlaceAssignment` |
| `OD-CAL-08` | Open decision | **Formal interface/event schema.** No interface or event schema is enumerated in the authoritative documents; contracts here are candidate-level. | PDD §5.5; SPEC-EMP-001 OD-EMP-09 | Architecture/Human | Open — affects Interfaces, Events |
| `OD-CAL-09` | Open decision | **Owner unassigned.** No `CODEOWNERS`; empty `backend/package.json` author. | SYNC-001; `TERMINOLOGY.md:51` | Human | Open — freeze requires a named owner/approver |
| `OD-CAL-10` | Open decision | **Current-stub semantic drift.** The `/operations` endpoints + `DailyOperation` shape model manager reception data (CRR §19; PDD `ReceptionData`), not calendar scheduling. Decide: repurpose, remove, or relocate to an operations module. | `types.ts:1-8`; `service.ts:5-11`; CRR §19; PDD §9.3 | Product/Architecture/Human | Open — no consumer today, so change is non-breaking |
| `OD-CAL-11` | Open decision | **Auto-cancel ripple to broadcasts.** When a sick/vacation mark cancels a same-day broadcast-sourced assignment, whether the freed slot reopens/re-broadcasts is unspecified. | CRR §22 §302; §13 broadcast | Product/Human | Open — affects `RULE-CAL-04` scope |
| `OD-CAL-12` | Assumption/Note | **Authoritative-doc location discrepancy.** Governing instruction cites `docs/01-product/requirements/`; the CRR/PDD live under `docs/00-foundations/`. | worktree at `c47df39`; matches SPEC-EMP-001 OD-EMP-11, SPEC-CRM-001 | Docs owner | Note — read from actual location; no behavioural impact |

## Proposed Knowledge Deltas

- **`MODULE_REGISTRY.yaml`:** on freeze, set `specification` for `backend-calendar` to `SPEC-CALENDAR-001`. **Reconcile the lifecycle label**: change `implementation_status: active-no-tests` / "implemented" to reflect the verified **stub** state (all methods throw `NotImplementedError`), aligning with `DEPENDENCY_GRAPH.yaml:39` — on human confirmation (OD-CAL-05, SYNC-001).
- **`DEPENDENCY_GRAPH.yaml`:** on freeze, register the candidate edges declared here — Calendar → Employee Management (availability output), Calendar → Notifications (sick/vacation alert), Calendar ↔ assignments (direct-placement create + auto-cancel), Job Dispatch → Calendar (broadcast acceptance as exclusivity/availability input) — marked `compatibility: conditional` until OD-CAL-02/03/08 resolve.
- **`TERMINOLOGY.md`:** promote, on human confirmation, canonical terms **Calendar / Weekly plan**, **Direct assignment**, **Calendar entry**, **Sick flag / Vacation flag (label only)**, **Daily exclusivity**, **Availability indicator (today-only)**; note that the current stub's "daily operations / reception data" concept is **distinct** from calendar scheduling and must not be conflated (OD-CAL-10).
- **`DECISION_INDEX.md`:** register OD-CAL-01 (availability ownership; couples to OD-EMP-07), OD-CAL-02 (exclusivity locus), OD-CAL-03 (CalendarEntry↔WorkerAssignment), OD-CAL-08 (interface/event schema), OD-CAL-10 (reception-data disposition) as pending decision records.
- **`SYNC_STATE.yaml`:** record this spec as `REVIEW` pending G4 independent reviews and G2 human approval; owner assignment remains blocked (SYNC-001).
- **Cross-spec:** note in `SPEC-EMP-001` that OD-EMP-07 (availability ownership) now has a concrete proposal in SPEC-CALENDAR-001 OD-CAL-01 awaiting the same human decision.

## Review and Change Log

| Version | Date | Change | Findings resolved | Approver |
|---|---|---|---|---|
| 0.1.0 | 2026-07-06 | Initial canonical-template authoring from the current worktree (Current plane) and CRR/PDD (Target plane), per the specification-freeze workflow. First specification to map to `backend-calendar` (`MODULE_REGISTRY.yaml:176` was `UNKNOWN`). Freeze candidate submitted for G4 independent review (architecture, dependency, consistency, security) and G2 human approval. Author cannot self-approve blocking findings (Constitution §12); **FROZEN status is withheld pending human approval and disposition of open decisions OD-CAL-01..12.** | — (none dispositioned yet) | — (pending) |
