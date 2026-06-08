# IMPLEMENTATION MASTER PLAN V2
**Hotel CRM — MVP**
**Version**: 2.0
**Date**: 2026-06-08
**Status**: PENDING FREEZE APPROVAL
**Supersedes**: IMPLEMENTATION_MASTER_PLAN.md (v1 — invalidated by architecture audit)

---

# PART I — ARCHITECTURE CONSISTENCY REVIEW

## Pre-Plan Consistency Audit

Before generating this plan, the following were checked against the stated core workflow:

```
Admin → Hotel → Manager → Worker Invitation → HotelWorker Membership
→ WorkRequest → WorkApplication → WorkerAssignment
→ Attendance → QualityVerification → Rating
```

---

### FINDING 1 — WorkRequest Final Architecture Document: MISSING

**Referenced**: User prompt cites "WorkRequest Final Architecture" as a source document.
**Status in repo**: File does not exist. No file in `hotel-crm/` matches this name.
**Impact**: WorkRequest marketplace visibility rule is undefined.

Specific unanswered question:
> Is a WorkRequest visible to ALL users with WORKER role, or only to workers who hold an active HotelWorker membership for that hotel?

This is the difference between an open marketplace (any worker applies to any hotel) and a closed marketplace (only vetted, invited hotel members can see shifts).

**Resolution used in this plan**: WorkRequest is scoped to HotelWorker members of the posting hotel. A worker must hold `status: ACTIVE` in HotelWorker for hotel X before they can view or apply to WorkRequests from hotel X. This is the architecturally safer default. **Must be confirmed by decision-maker before Phase C begins.**

---

### FINDING 2 — Quality & Rating Architecture Document: MISSING

**Referenced**: User prompt cites "Quality & Rating Architecture" as a source document.
**Status in repo**: File does not exist.
**Impact**: QualityVerification and Rating anchor entities are undefined.

In V1 schema, both models anchor to `task_id`. With Tasks removed, the anchor must change.

The workflow `WorkerAssignment → Attendance → QualityVerification → Rating` implies:
- QualityVerification evaluates a completed WorkerAssignment (shift-level quality)
- Rating scores the worker for that assignment

**Resolution used in this plan**: Both QualityVerification and Rating anchor to `worker_assignment_id`. QualityVerification is Checker-initiated after Attendance status reaches `CLOCKED_OUT`. Rating follows QualityVerification. **Must be confirmed before Phase D begins.**

---

### FINDING 3 — WorkApplication: Not in Schema

**Status**: Model does not exist in `backend/prisma/schema.prisma`.
**V1 plan impact**: V1 bypassed WorkApplication entirely — workers went directly from "available" to WorkerAssignment. This was the critical audit finding.
**V2 requirement**: WorkApplication sits between WorkRequest and WorkerAssignment.

Unanswered lifecycle questions:
- Does accepting a WorkApplication **automatically** create a WorkerAssignment (service-layer side effect), or is assignment a separate manager action after acceptance?
- Can a worker **withdraw** a PENDING application?
- When `workers_needed` is reached, are remaining PENDING applications auto-rejected?

**Resolution used in this plan**: Accepting an application creates WorkerAssignment atomically in a DB transaction. Withdrawal of PENDING applications is permitted. Auto-rejection of excess applications fires after WorkRequest reaches `FILLED` status. **Must be confirmed before Phase C begins.**

---

### FINDING 4 — Attendance: Not in Schema

**Status**: Model does not exist. WorkerAssignment has `started_at` / `completed_at` timestamps, which V1 used as attendance proxies.
**V2 requirement**: Attendance is a discrete step in the workflow between WorkerAssignment and QualityVerification.

Unanswered question:
- Is Attendance a separate model (clock-in / clock-out as worker actions) or are the timestamps on WorkerAssignment sufficient?
- Does Attendance require GPS/location data?

**Resolution used in this plan**: Attendance is a separate model (`Attendance`) anchored 1:1 to WorkerAssignment. Clock-in and clock-out are explicit worker actions via API. No GPS required for MVP. **Must be confirmed before Phase C begins.**

---

### FINDING 5 — HotelWorker Membership: Not in Schema

**Status**: Current schema uses `hotel_ids String[]` on User model (primitive array). No HotelWorker junction model exists.
**V2 requirement**: The workflow explicitly names "Worker Invitation → HotelWorker Membership" as a frozen module.

The `hotel_ids[]` array must be **removed** from User and replaced with a proper HotelWorker join table. This is a breaking schema change that affects every query that currently filters by `hotel_ids`.

**Resolution**: HotelWorker model is designed in this plan (see Section 1). The `hotel_ids[]` field on User is deprecated and removed in Migration 002.

---

### FINDING 6 — V1 Schema Models Excluded from V2

The following models exist in the current schema but are **explicitly excluded** from V2 MVP:

| Model | V1 Schema Line | Exclusion Reason |
|-------|---------------|------------------|
| `Room` | 105–123 | Not in accepted architecture |
| `Task` | 125–153 | Not in accepted architecture |
| `TaskPhoto` | 162–173 | Not in accepted architecture |
| `DailyOperation` | 450–471 | Not in accepted architecture |

These models must be **removed** from schema.prisma before the first V2 migration runs. Keeping them alongside V2 models will create FK orphans and confuse the migration history.

---

### FINDING 7 — Checker Role: Implicitly Required, Not Redefined

The workflow involves QualityVerification and Rating submitted by a Checker. The `UserRole` enum (`WORKER`, `CHECKER`, `MANAGER`, `ADMIN`) is unchanged. However, with no Tasks or Rooms, the Checker's workflow changes: they now evaluate WorkerAssignments/shifts, not individual tasks.

**No blocker** — the CHECKER role is retained as-is. The change is only in what they evaluate.

---

### FINDING 8 — User.hotel_ids[] Conflict with HotelWorker

The `hotel_ids String[]` field on User (line 26 of schema) conflicts with the HotelWorker membership model. It will be removed as part of Migration 002. All middleware that reads `req.user.hotel_ids` for hotel scoping must be updated to query `HotelWorker` instead.

**Impact on frozen Auth module**: The `checkHotelAccess()` middleware needs to be rewritten. This is an internal implementation change within the frozen Auth module — the API contract does not change, only the data source for the access check.

---

## Blocking Decisions Summary

| ID | Decision Required | Blocks | Owner | Deadline |
|----|------------------|--------|-------|----------|
| BD-1 | WorkRequest marketplace scope: HotelWorker-scoped (closed) vs. open to all workers | Phase C | Principal Architect | Before Week 2 Day 1 |
| BD-2 | QualityVerification anchor: `worker_assignment_id` vs. `attendance_id` | Phase D | Principal Architect | Before Week 3 Day 1 |
| BD-3 | WorkApplication acceptance: auto-creates WorkerAssignment (atomic) vs. two-step manager action | Phase C | Principal Architect | Before Week 2 Day 1 |
| BD-4 | WorkApplication: auto-reject excess applications when FILLED? | Phase C | Principal Architect | Before Week 2 Day 1 |
| BD-5 | Attendance: GPS/location required for clock-in? | Phase C | Principal Architect | Before Week 2 Day 3 |

**All BD-1 through BD-5 must be resolved before the Week 1 → Week 2 handoff.**
The plan proceeds below using the resolutions stated in each Finding. If any resolution is overridden, the affected phases require re-estimation.

---

# PART II — IMPLEMENTATION MASTER PLAN V2

---

## 1. ARCHITECTURE ASSUMPTIONS

The following are the confirmed and assumed architectural truths on which this plan is built. Each assumption must be ratified before execution of the phase that depends on it.

### Confirmed (Frozen)

| # | Assumption | Source |
|---|-----------|--------|
| A-01 | Auth module: User, Session, JWT (HS256), RBAC permission codes, role enum (WORKER/CHECKER/MANAGER/ADMIN) | Frozen |
| A-02 | Hotel module: Hotel model with fields (id, name, city, country, address, timezone, is_active) | Frozen |
| A-03 | Hotel Worker Management: invitation-based HotelWorker membership model | Frozen (stated) |
| A-04 | Single modular monolith on Express + TypeScript + Prisma + PostgreSQL | Architecture decision |
| A-05 | DigitalOcean Frankfurt deployment (GDPR EU residency) | Architecture decision |
| A-06 | React Native + Expo for mobile (single app, role-based navigation) | Architecture decision |
| A-07 | Zod validation on all API inputs | Architecture decision |
| A-08 | Winston structured logging, no `console.log` in production | Architecture decision |
| A-09 | HR module (Contracts, Payroll, Documents) unchanged from V1 design | Not explicitly frozen, but no changes instructed |

### Pending Confirmation (Plan Assumptions)

| # | Assumption | Stated Resolution | Must Confirm By |
|---|-----------|------------------|-----------------|
| A-10 | WorkRequest is scoped to HotelWorker members of posting hotel | BD-1 resolution | Week 2 Day 1 |
| A-11 | WorkApplication acceptance atomically creates WorkerAssignment | BD-3 resolution | Week 2 Day 1 |
| A-12 | QualityVerification anchors to `worker_assignment_id` | BD-2 resolution | Week 3 Day 1 |
| A-13 | Attendance is a separate model with explicit clock-in/clock-out actions | BD-5 resolution | Week 2 Day 3 |
| A-14 | Rating anchors to `worker_assignment_id`, one per assignment | Derived from A-12 | Week 3 Day 1 |
| A-15 | Excess WorkApplications auto-rejected when WorkRequest reaches FILLED | BD-4 resolution | Week 2 Day 1 |
| A-16 | `User.hotel_ids[]` removed; hotel access derived from HotelWorker membership | Derived from workflow | Week 1 Day 1 |

### Explicitly Out of MVP Scope

| Item | Status | Future Phase |
|------|--------|--------------|
| Room model | REMOVED | Phase 2 (if required) |
| Task model | REMOVED | Phase 2 (if required) |
| TaskPhoto model | REMOVED | Phase 2 (if required) |
| DailyOperation model | REMOVED | Phase 2 (if required) |
| GPS/location on Attendance | OUT | Phase 2 |
| Contract PDF generation | OUT | Phase 2 |
| Automated payroll calculation | OUT | Phase 2 |
| E2E mobile testing | OUT | Phase 2 |

---

## 2. DEPENDENCY GRAPH

```
╔══════════════════════════════════════════════════════════════════╗
║                    LAYER 0 — FROZEN                              ║
║                                                                  ║
║  ┌──────────────┐   ┌────────────────┐   ┌────────────────────┐ ║
║  │    Auth      │   │     Hotels     │   │  Hotel Worker Mgmt │ ║
║  │ User,Session │   │  Hotel model   │   │  HotelWorker model │ ║
║  │ JWT, RBAC    │   │  CRUD + access │   │  Invite → Active   │ ║
║  └──────┬───────┘   └───────┬────────┘   └─────────┬──────────┘ ║
╚═════════╪═══════════════════╪════════════════════════╪═══════════╝
          │                   │                        │
          └───────────────────▼────────────────────────┘
                              │
╔═════════════════════════════▼════════════════════════════════════╗
║                   LAYER 1 — MARKETPLACE                          ║
║                                                                  ║
║  ┌──────────────────┐        ┌─────────────────────────────────┐ ║
║  │   WorkRequest    │───────►│        WorkApplication          │ ║
║  │ Manager posts    │        │  Worker applies from            │ ║
║  │ shift opening    │        │  HotelWorker membership         │ ║
║  └──────────────────┘        └──────────────┬──────────────────┘ ║
╚══════════════════════════════════════════════╪═══════════════════╝
                                               │ (on ACCEPTED)
╔══════════════════════════════════════════════▼═══════════════════╗
║                   LAYER 2 — ASSIGNMENT                           ║
║                                                                  ║
║  ┌───────────────────────────────────────────────────────────┐   ║
║  │                  WorkerAssignment                         │   ║
║  │  Manager assigns (auto from WorkApplication acceptance)   │   ║
║  │  ASSIGNED → IN_PROGRESS → COMPLETED / CANCELLED          │   ║
║  └───────────────────────────┬───────────────────────────────┘   ║
╚══════════════════════════════╪═══════════════════════════════════╝
                               │
╔══════════════════════════════▼═══════════════════════════════════╗
║                   LAYER 3 — ATTENDANCE                           ║
║                                                                  ║
║  ┌───────────────────────────────────────────────────────────┐   ║
║  │                     Attendance                            │   ║
║  │  Worker clocks in → CLOCKED_IN                           │   ║
║  │  Worker clocks out → CLOCKED_OUT                         │   ║
║  │  (triggers QualityVerification eligibility)              │   ║
║  └───────────────────────────┬───────────────────────────────┘   ║
╚══════════════════════════════╪═══════════════════════════════════╝
                               │
╔══════════════════════════════▼═══════════════════════════════════╗
║                   LAYER 4 — QUALITY                              ║
║                                                                  ║
║  ┌────────────────────────┐    ┌──────────────────────────────┐  ║
║  │  QualityVerification   │    │          Rating              │  ║
║  │  Checker scores shift  │───►│  Checker rates worker 0–5    │  ║
║  │  0–100 per assignment  │    │  per WorkerAssignment        │  ║
║  └────────────────────────┘    └──────────────────────────────┘  ║
╚══════════════════════════════════════════════════════════════════╝
                               │
╔══════════════════════════════▼═══════════════════════════════════╗
║                   LAYER 5 — SUPPORT                              ║
║   Notifications · HR (Contracts, Payroll, Documents)             ║
║   Analytics · AuditLog · ConsentLog                              ║
╚══════════════════════════════════════════════════════════════════╝
```

### Dependency Rules

1. No model in Layer N references a model from Layer N+1.
2. `Auth` (Layer 0) is imported by every module — never the reverse.
3. `HotelWorker` membership gates WorkRequest visibility and WorkApplication eligibility.
4. `WorkApplication` is the only path to `WorkerAssignment`. Direct assignment without an accepted application is prohibited at the service layer.
5. `Attendance` must exist (status `CLOCKED_OUT`) before a Checker can submit a QualityVerification.
6. `QualityVerification` must exist before a Rating can be submitted for the same WorkerAssignment.
7. `Notifications` is write-only from all modules. No module reads from Notifications.
8. `AuditLog` is write-only from all service layers via `BaseService`.
9. `HR` module has no dependency on Staffing or Quality — it runs in parallel.

---

## 3. BACKEND IMPLEMENTATION ORDER

### V2 DATA MODEL DEFINITION

Before implementation begins, the schema.prisma must be rebuilt. The following models define V2. These are inputs to Migration 001.

#### New Models (do not exist in current schema)

```prisma
// HOTEL WORKER MANAGEMENT (Layer 0 — Frozen)
model HotelWorker {
  id                    String             @id @default(cuid())
  hotel_id              String
  hotel                 Hotel              @relation(fields: [hotel_id], references: [id], onDelete: Cascade)
  worker_id             String
  worker                User               @relation(fields: [worker_id], references: [id], onDelete: Cascade)
  invited_by_manager_id String
  invited_by            User               @relation("invited_by", fields: [invited_by_manager_id], references: [id])
  status                HotelWorkerStatus  @default(INVITED)
  invited_at            DateTime           @default(now())
  joined_at             DateTime?
  removed_at            DateTime?
  removed_by_manager_id String?
  removed_by            User?              @relation("removed_by", fields: [removed_by_manager_id], references: [id])
  created_at            DateTime           @default(now())
  updated_at            DateTime           @updatedAt

  @@unique([hotel_id, worker_id])
  @@index([hotel_id])
  @@index([worker_id])
  @@index([status])
}

enum HotelWorkerStatus {
  INVITED
  ACTIVE
  INACTIVE
  REMOVED
}

// MARKETPLACE (Layer 1)
model WorkApplication {
  id                      String                  @id @default(cuid())
  work_request_id         String
  work_request            WorkRequest             @relation(fields: [work_request_id], references: [id], onDelete: Cascade)
  worker_id               String
  worker                  User                    @relation(fields: [worker_id], references: [id], onDelete: Cascade)
  status                  WorkApplicationStatus   @default(PENDING)
  applied_at              DateTime                @default(now())
  reviewed_at             DateTime?
  reviewed_by_manager_id  String?
  reviewed_by             User?                   @relation("reviewed_by", fields: [reviewed_by_manager_id], references: [id])
  worker_note             String?
  created_at              DateTime                @default(now())
  updated_at              DateTime                @updatedAt

  @@unique([work_request_id, worker_id])
  @@index([work_request_id])
  @@index([worker_id])
  @@index([status])
}

enum WorkApplicationStatus {
  PENDING
  ACCEPTED
  REJECTED
  WITHDRAWN
}

// ATTENDANCE (Layer 3)
model Attendance {
  id                    String            @id @default(cuid())
  worker_assignment_id  String            @unique
  worker_assignment     WorkerAssignment  @relation(fields: [worker_assignment_id], references: [id], onDelete: Cascade)
  worker_id             String
  worker                User              @relation(fields: [worker_id], references: [id], onDelete: Cascade)
  status                AttendanceStatus  @default(PENDING)
  clock_in_at           DateTime?
  clock_out_at          DateTime?
  created_at            DateTime          @default(now())
  updated_at            DateTime          @updatedAt

  @@index([worker_id])
  @@index([status])
}

enum AttendanceStatus {
  PENDING
  CLOCKED_IN
  CLOCKED_OUT
  ABSENT
}
```

#### Modified Models (exist in schema, require changes)

```
User:
  REMOVE: hotel_ids String[]
  REMOVE: created_tasks, assigned_tasks, created_operations relations
  ADD:    hotel_workers HotelWorker[]
          work_applications WorkApplication[]
          attendances Attendance[]

Hotel:
  REMOVE: rooms, tasks, daily_operations relations

WorkRequest:
  ADD:    applications WorkApplication[]
  (shift_date, shift_start_time, shift_end_time, position, workers_needed — retained)

WorkerAssignment:
  ADD:    work_application_id String @unique
          work_application WorkApplication @relation(...)
          attendance Attendance?
          quality_verification QualityVerification?
          rating Rating?
  REMOVE: daily_operations DailyOperation[] relation

QualityVerification:
  REPLACE: task_id / task → worker_assignment_id / worker_assignment (1:1)
  REMOVE: hotel_id FK (derive from WorkerAssignment.work_request.hotel_id)
  — OR KEEP hotel_id as denormalized field for query performance (recommended)

Rating:
  REPLACE: task_id / task → worker_assignment_id / worker_assignment (1:1)

WorkerOverallRating:
  UNCHANGED
```

#### Removed Models

```
Room, Task, TaskPhoto, DailyOperation — DELETE from schema.prisma before first migration
```

---

### Phase A — Foundation
**Week 1, Days 1–3**

**Prerequisites**: None. This is the entry point.

**Deliverables**:
- All V2 models present in schema.prisma (removed models gone, new models added, modified models updated)
- First Prisma migration generated and applied to dev DB
- Seed script with: 1 Admin, 2 Hotels, 2 Managers, 4 Workers, 2 Checkers, HotelWorker memberships
- All production dependencies installed
- Auth service fully implemented (signup, login, refresh, logout, /me, profile update)
- `checkHotelAccess()` middleware rewritten to query HotelWorker instead of User.hotel_ids

**Dependencies**: None

**Estimated Effort**: 4 days (2 engineers)

**Tasks**:

| # | Task | Owner | Effort |
|---|------|-------|--------|
| A1 | Install missing production deps: bcrypt, helmet, express-rate-limit, multer, @aws-sdk/client-s3, @sendgrid/mail, node-cron, jest, ts-jest, supertest | BE-2 | 0.5d |
| A2 | Rewrite schema.prisma: remove Room/Task/TaskPhoto/DailyOperation; add HotelWorker/WorkApplication/Attendance; modify User/Hotel/WorkRequest/WorkerAssignment/QualityVerification/Rating | BE-1 | 1d |
| A3 | Run `prisma migrate dev --name v2_init` — generates single migration for entire V2 schema | BE-1 | 0.5d |
| A4 | Seed script: all roles, hotels, memberships, one WorkRequest chain for integration testing | BE-2 | 1d |
| A5 | Complete Auth service (signup with bcrypt cost=12, login, refresh, logout, /me, profile update with Zod) | BE-1 | 1d |
| A6 | Rewrite `checkHotelAccess()` to query HotelWorker.status = ACTIVE instead of User.hotel_ids | BE-1 | 0.5d |
| A7 | Auth integration test: signup → login → refresh → logout → /me flow | QA | 0.5d |

**Missing dependencies to install**:
```
bcrypt @types/bcrypt
helmet
express-rate-limit
multer @types/multer
@aws-sdk/client-s3
@sendgrid/mail
node-cron
jest @types/jest ts-jest supertest @types/supertest
```

**Blocking Risks**:
- BD-1 (WorkRequest visibility) must be resolved before Phase C. Does NOT block Phase A.
- If schema.prisma rewrite introduces circular FK issues, migration generation will fail. Resolution: audit FK directions before running migrate.

---

### Phase B — Hotels & HotelWorker Management
**Week 1, Days 4–5**

**Prerequisites**: Phase A complete (schema migrated, Auth working)

**Deliverables**:
- Hotel CRUD (create, list, get, update, deactivate)
- HotelWorker invitation flow (invite, accept/join, list members, remove)
- Hotel-scoped access enforced via HotelWorker membership

**Dependencies**: Phase A (Auth, HotelWorker schema)

**Estimated Effort**: 3 days

**Tasks**:

| # | Task | File | Effort |
|---|------|------|--------|
| B1 | Hotel CRUD: create (Admin/Manager), list (scoped by HotelWorker for managers), get, update, deactivate | `modules/crm/service.ts` | 1d |
| B2 | HotelWorker invite: Manager sends invitation → creates HotelWorker with status INVITED → emits notification | `modules/crm/service.ts` | 1d |
| B3 | HotelWorker accept: Worker calls accept endpoint with their user_id → sets status ACTIVE, sets joined_at | `modules/crm/service.ts` | 0.5d |
| B4 | HotelWorker list: Manager lists all workers for their hotel (filter by status) | `modules/crm/service.ts` | 0.25d |
| B5 | HotelWorker remove: Manager removes worker from hotel (status → REMOVED, set removed_at) | `modules/crm/service.ts` | 0.25d |

**Blocking Risks**:
- HotelWorker invitation mechanism (email token vs. in-app acceptance) must be decided. **Plan assumes in-app: invitation creates HotelWorker record, worker calls `POST /hotel-workers/:id/accept` while authenticated.** If email-token flow is required, add 1 day for token generation, email delivery (SendGrid), and token validation endpoint.

---

### Phase C — Staffing: WorkRequest + WorkApplication + WorkerAssignment
**Week 2**

**Prerequisites**: Phase B complete. BD-1, BD-3, BD-4 resolved.

**Deliverables**:
- WorkRequest CRUD with hotel-worker-scoped visibility
- WorkApplication: apply, withdraw, accept, reject, list
- WorkerAssignment: auto-created on application acceptance (atomic transaction)
- WorkerAssignment lifecycle: start (IN_PROGRESS), complete (COMPLETED), cancel, reassign

**Dependencies**: Phase B (HotelWorker membership for eligibility check)

**Estimated Effort**: 5 days

**Tasks**:

| # | Task | File | Effort |
|---|------|------|--------|
| C1 | WorkRequest create: Manager creates shift request (position, shift_date, shift_start_time, shift_end_time, workers_needed, notes) | `modules/staffing/service.ts` | 0.5d |
| C2 | WorkRequest list: Worker sees only WorkRequests from hotels where they hold ACTIVE HotelWorker membership; Manager sees their hotel's requests | `modules/staffing/service.ts` | 0.5d |
| C3 | WorkRequest get, cancel | `modules/staffing/service.ts` | 0.25d |
| C4 | WorkApplication create (worker applies): validate HotelWorker(hotel_id, worker_id).status = ACTIVE; enforce unique(work_request_id, worker_id); WorkRequest must be OPEN or PARTIALLY_FILLED | `modules/staffing/service.ts` | 1d |
| C5 | WorkApplication withdraw: worker withdraws PENDING application; if WorkRequest was PARTIALLY_FILLED and drops below threshold, revert to OPEN | `modules/staffing/service.ts` | 0.5d |
| C6 | WorkApplication accept (Manager): in DB transaction: (1) set WorkApplication.status = ACCEPTED, (2) create WorkerAssignment with status ASSIGNED, (3) create Attendance record with status PENDING, (4) update WorkRequest status (OPEN→PARTIALLY_FILLED→FILLED), (5) if FILLED auto-reject remaining PENDING applications | `modules/staffing/service.ts` | 1.5d |
| C7 | WorkApplication reject (Manager): set status = REJECTED, emit notification to worker | `modules/staffing/service.ts` | 0.25d |
| C8 | WorkApplication list: Manager sees all applications for a request; Worker sees their own applications | `modules/staffing/service.ts` | 0.25d |
| C9 | WorkerAssignment start: worker calls start → status ASSIGNED → IN_PROGRESS; validate Attendance.status = PENDING (not yet clocked in — triggers clock-in) | `modules/staffing/service.ts` | 0.25d |
| C10 | WorkerAssignment reassign: cancel existing assignment, create new WorkApplication + WorkerAssignment for different worker (manager action) | `modules/staffing/service.ts` | 0.5d |

**Concurrency Critical Point (C6)**:
When two managers simultaneously accept the last available slot:
- Both read `current_accepted_count < workers_needed`
- Both attempt to create WorkerAssignment
- Resolution: Use a **SELECT FOR UPDATE** lock on the WorkRequest row inside the transaction. Prisma: `prisma.$transaction` with isolation level `Serializable`. The second transaction will fail with a serialization error → return HTTP 409.
- A dedicated integration test must simulate this race condition (see Section 9).

**Blocking Risks**:
- BD-1 not resolved: WorkRequest list scoping breaks the API contract.
- BD-3 not resolved: C6 acceptance flow cannot be finalized.
- BD-4 not resolved: C6 auto-reject step is undefined.

---

### Phase D — Attendance
**Week 3, Days 1–2**

**Prerequisites**: Phase C complete (WorkerAssignment and Attendance records exist). BD-5 resolved.

**Deliverables**:
- Worker clock-in action
- Worker clock-out action
- Attendance status transitions
- QualityVerification eligibility gate (cannot verify until CLOCKED_OUT)

**Dependencies**: Phase C (WorkerAssignment must exist and be ASSIGNED or IN_PROGRESS)

**Estimated Effort**: 1.5 days

**Tasks**:

| # | Task | File | Effort |
|---|------|------|--------|
| D1 | Clock-in: Worker calls clock-in → Attendance.status: PENDING → CLOCKED_IN; set clock_in_at; WorkerAssignment.status → IN_PROGRESS | `modules/staffing/service.ts` | 0.5d |
| D2 | Clock-out: Worker calls clock-out → Attendance.status: CLOCKED_IN → CLOCKED_OUT; set clock_out_at; WorkerAssignment.status → COMPLETED | `modules/staffing/service.ts` | 0.5d |
| D3 | Attendance get: Worker and Manager can read their Attendance record | `modules/staffing/service.ts` | 0.25d |
| D4 | Attendance absent: Manager can mark a worker ABSENT (missed shift); WorkerAssignment → CANCELLED | `modules/staffing/service.ts` | 0.25d |

**Blocking Risks**:
- BD-5: If GPS required, add `clock_in_latitude`, `clock_in_longitude`, `clock_out_latitude`, `clock_out_longitude` fields and 0.5d validation logic.

---

### Phase E — Quality & Rating
**Week 3, Days 3–5**

**Prerequisites**: Phase D complete. Attendance.status = CLOCKED_OUT gate implemented. BD-2 resolved.

**Deliverables**:
- QualityVerification: Checker submits shift-level quality score (0–100)
- Rating: Checker rates worker (0–5) after verification
- WorkerOverallRating: upsert aggregate on every Rating
- Leaderboard: global + hotel-scoped

**Dependencies**: Phase D (Attendance must reach CLOCKED_OUT before verification allowed)

**Estimated Effort**: 2.5 days

**Tasks**:

| # | Task | File | Effort |
|---|------|------|--------|
| E1 | QualityVerification submit: validate Attendance.status = CLOCKED_OUT for the WorkerAssignment; enforce unique(worker_assignment_id); score 0–100; status verified/needs_rework | `modules/quality/service.ts` | 1d |
| E2 | Rating submit: validate QualityVerification exists for assignment; enforce unique(worker_assignment_id); score 0–5; emit RATING_RECEIVED notification | `modules/quality/service.ts` | 0.5d |
| E3 | WorkerOverallRating upsert: recalculate average_score and total_ratings on every new Rating (use Prisma `upsert` inside transaction with Rating create) | `modules/quality/service.ts` | 0.5d |
| E4 | Leaderboard: global sorted by average_score DESC; hotel-scoped via HotelWorker join | `modules/quality/service.ts` | 0.5d |

**Blocking Risks**:
- BD-2 not resolved: QualityVerification anchor entity (worker_assignment_id vs. attendance_id) is undefined. Phase E cannot finalize schema or API without this decision.

---

### Phase F — Notifications
**Week 4, Days 1–2**

**Prerequisites**: Phases A–E complete (all entities emitting notifications exist).

**Deliverables**:
- Notification service with `emit()` method
- Push notification delivery (APNS + FCM) as fire-and-forget
- Device token storage (migration 002 adds device_token, device_platform to User)
- All notification types wired into source services

**Dependencies**: All prior phases (notification types reference IDs from each module)

**Estimated Effort**: 2.5 days

**Tasks**:

| # | Task | File | Effort |
|---|------|------|--------|
| F1 | Notification `emit(userId, type, title, message, data)`: persist to DB, then async push | `modules/notifications/service.ts` | 0.5d |
| F2 | APNS + FCM delivery (fire-and-forget, log failures, never block the calling service) | `modules/notifications/service.ts` | 1d |
| F3 | GET /notifications (paginated, unread first); POST /notifications/:id/read; POST /notifications/read-all | `modules/notifications/` | 0.5d |
| F4 | Wire notifications: HOTEL_WORKER_INVITED, WORK_REQUEST_PUBLISHED, WORK_APPLICATION_RECEIVED, WORK_APPLICATION_ACCEPTED, WORK_APPLICATION_REJECTED, WORKER_ASSIGNMENT_CREATED, WORKER_ASSIGNMENT_CANCELLED, QUALITY_VERIFIED, RATING_RECEIVED | All services | 0.5d |

**Note on device tokens**: Add `device_token String?` and `device_platform String?` (`ios`/`android`) to User model in Migration 002 (Week 3, before Phase F).

**Blocking Risks**:
- APNS sandbox certificate must be obtained before testing. If unavailable, stub the push delivery and mark as tech debt.
- FCM server key must be available. If unavailable, same stub approach.

---

### Phase G — Analytics
**Week 4, Days 3–4**

**Prerequisites**: Phases C–E complete (assignments, attendance, quality data exists).

**Deliverables**:
- Dashboard stats endpoint (workers on shift today, assignments pending, verifications pending, leaderboard snapshot)
- Hotel summary endpoint
- Worker profile stats (own assignments, own ratings history)

**Dependencies**: WorkerAssignment, Attendance, QualityVerification, Rating all populated in DB.

**Estimated Effort**: 1.5 days

| # | Task | File | Effort |
|---|------|------|--------|
| G1 | Stats: active assignments today, pending verifications, unread ratings, hotel worker count | `modules/analytics/service.ts` | 0.5d |
| G2 | Hotel summary: assignments by status for date range, average quality score, top-rated workers | `modules/analytics/service.ts` | 0.5d |
| G3 | Worker profile stats: total assignments, average rating, rating history | `modules/analytics/service.ts` | 0.5d |

---

### Phase H — HR Module
**Week 4, Day 5 – Week 5, Day 2**

**Prerequisites**: Phase A (seed data with workers and hotels exists).

**Deliverables**:
- Contract CRUD (create from template, sign, terminate)
- ContractTemplate CRUD
- WorkerDocument upload (encrypted URL to DO Spaces, SHA-256 hash)
- Payroll (create, approve, pay with AES-256 encryption)
- Document expiry cron job
- DataRetentionLog creation

**Dependencies**: Phase A only (HR is parallel to Staffing/Quality).

**Estimated Effort**: 5 days

| # | Task | File | Effort |
|---|------|------|--------|
| H1 | ContractTemplate CRUD | `modules/hr/service.ts` | 0.5d |
| H2 | Contract create from template, sign, terminate, list | `modules/hr/service.ts` | 1d |
| H3 | WorkerDocument upload to DO Spaces (presigned URL, SHA-256 hash, soft delete) | `modules/hr/service.ts` | 1d |
| H4 | Payroll create, approve, pay (AES-256 on encrypted_data field) | `modules/hr/service.ts` | 1d |
| H5 | DataRetentionLog: create on contract/payroll creation (3yr/7yr retention) | `modules/hr/service.ts` | 0.5d |
| H6 | Document expiry cron (daily): query WorkerDocument.expiry_date, emit notifications for expiring/expired docs | `modules/hr/service.ts` | 0.5d |
| H7 | AuditLog on all HR read/download operations | `modules/hr/service.ts` | 0.5d |

**Blocking Risks**:
- AES-256 encryption key must be available in environment before H4 can be tested end-to-end.
- DO Spaces credentials required for H3.

---

### Phase I — Security Hardening
**Week 5, Day 3**

**Prerequisites**: Phases A–H functionally complete.

**Deliverables**:
- Helmet.js headers on all routes
- Rate limiting on `/api/v1/auth/*` (10 req/min/IP)
- CORS locked to production origin
- Zod schema audit (all request bodies validated)
- ConsentLog on first login

**Estimated Effort**: 1.5 days

| # | Task | File | Effort |
|---|------|------|--------|
| I1 | Helmet.js, CORS lockdown, rate limiting | `app.ts`, `middleware/` | 0.5d |
| I2 | Zod audit: every controller method must have a validated schema for req.body | All controllers | 0.5d |
| I3 | ConsentLog: write PRIVACY_POLICY + HR_DATA_PROCESSING entries on first successful login | `modules/auth/service.ts` | 0.25d |
| I4 | Presigned URL generation for all DO Spaces document/photo access (remove any direct public URLs) | `modules/hr/service.ts` | 0.25d |

---

## 4. MOBILE IMPLEMENTATION ORDER

> The two existing apps (`worker-app`, `checker-app`) must be **merged** into a single Expo app with role-based navigation before feature work begins. This is the first mobile task (M0).

### Phase M0 — Foundation (Week 1)

**Prerequisites**: Phase A backend (Auth API working at staging URL)

| # | Task | Effort |
|---|------|--------|
| M0.1 | Merge worker-app + checker-app → single `mobile/app`; Expo Router role guard at root | 1d |
| M0.2 | Remove `@supabase/supabase-js` dependency; wire API client (fetch wrapper with JWT interceptor, token refresh on 401) | 0.5d |
| M0.3 | Auth store (Zustand): login, logout, token refresh, persist tokens to `expo-secure-store` | 1d |
| M0.4 | Login screen; role-based root redirect: WORKER → worker tabs, CHECKER → checker tabs, MANAGER → manager tabs | 0.5d |

### Phase M1 — Worker Screens (Week 2–3)

**Prerequisites**: M0 done; Phases B, C, D backend APIs live at staging.

| # | Screen | Backend Dep | Effort |
|---|--------|------------|--------|
| M1.1 | Home: list of my hotel memberships + upcoming assignments | B, C | 0.5d |
| M1.2 | Open shifts: WorkRequests available for my hotels | C2 | 0.5d |
| M1.3 | Shift detail + Apply button (creates WorkApplication) | C4 | 0.5d |
| M1.4 | My applications: pending/accepted/rejected list | C8 | 0.5d |
| M1.5 | My assignments: upcoming / in-progress / completed | C9 | 0.5d |
| M1.6 | Assignment detail: shift info, Clock In button (only if status ASSIGNED) | D1 | 0.5d |
| M1.7 | Clock Out screen: confirmation → triggers D2 | D2 | 0.5d |
| M1.8 | My ratings: personal rating history and leaderboard position | E4 | 0.5d |
| M1.9 | Notifications list + mark read | F3 | 0.5d |

### Phase M2 — Checker Screens (Week 3–4)

**Prerequisites**: M0 done; Phases D, E backend APIs live at staging.

| # | Screen | Backend Dep | Effort |
|---|--------|------------|--------|
| M2.1 | Home: list of CLOCKED_OUT assignments pending verification (hotel-scoped) | D, E | 0.5d |
| M2.2 | Assignment verification: view assignment details, enter quality score 0–100, notes, submit | E1 | 1d |
| M2.3 | Worker rating: 0–5 stars, optional comment, submit (after verification) | E2 | 0.5d |
| M2.4 | Leaderboard: hotel leaderboard sorted by rating | E4 | 0.5d |
| M2.5 | Notifications list | F3 | 0.25d |

### Phase M3 — Manager Screens (Week 4–5)

> If time-constrained, defer M3 to web dashboard (Next.js frontend). The API is ready regardless.

**Prerequisites**: M0 done; Phases B, C, F, G backend APIs live at staging.

| # | Screen | Backend Dep | Effort |
|---|--------|------------|--------|
| M3.1 | Hotel workers: list members, invite new worker, remove worker | B | 1d |
| M3.2 | Create WorkRequest (shift form: date, times, position, workers needed) | C1 | 0.5d |
| M3.3 | Applications review: list applications per request, accept / reject | C6, C7 | 1d |
| M3.4 | Assignments overview: all assignments for hotel by date | C | 0.5d |
| M3.5 | Analytics dashboard: stats, pending verifications, leaderboard | G | 0.5d |
| M3.6 | HR documents: view/upload worker documents | H3 | 0.5d |

---

## 5. DATABASE MIGRATION ORDER

All migrations generated via `prisma migrate dev --name <slug>`.

| # | Name | Changes | Week |
|---|------|---------|------|
| 001 | `v2_init` | Drop: Room, Task, TaskPhoto, DailyOperation. Remove User.hotel_ids[]. Add: HotelWorker (with enum), WorkApplication (with enum), Attendance (with enum). Modify: WorkRequest (add applications relation), WorkerAssignment (add work_application_id FK, attendance/quality/rating relations), QualityVerification (replace task_id → worker_assignment_id), Rating (replace task_id → worker_assignment_id). Full V2 schema in one migration since no production data exists. | Week 1, Day 2 |
| 002 | `add_device_tokens` | Add `device_token String?`, `device_platform String?` to User | Week 3 (before Phase F) |
| 003 | `add_performance_indexes` | Composite indexes: (hotel_id, shift_date) on WorkRequest; (worker_id, status) on WorkApplication; (worker_id, status) on WorkerAssignment; (worker_id, status) on Attendance | Week 5 |

**Production rule**: Never `db:push` in production. Always `prisma migrate deploy`.

**Rollback strategy**: Prisma does not support automatic rollback. For production, maintain a pre-migration DB snapshot (DigitalOcean managed DB point-in-time restore). Apply manually if rollback needed within 1-hour window.

---

## 6. API ROLLOUT ORDER

APIs are released in groups matching backend phases. "Released" = implemented + tested + Zod-validated.

### Group 1 — Auth (Week 1)
```
POST   /api/v1/auth/signup
POST   /api/v1/auth/login
POST   /api/v1/auth/refresh
POST   /api/v1/auth/logout
GET    /api/v1/auth/me
PUT    /api/v1/auth/profile
```

### Group 2 — Hotels & HotelWorker (Week 1)
```
GET    /api/v1/hotels
POST   /api/v1/hotels                                (Admin/Manager)
GET    /api/v1/hotels/:hotel_id
PATCH  /api/v1/hotels/:hotel_id
DELETE /api/v1/hotels/:hotel_id/deactivate

POST   /api/v1/hotels/:hotel_id/workers/invite       (Manager → Worker)
GET    /api/v1/hotels/:hotel_id/workers              (Manager: list members)
POST   /api/v1/hotel-workers/:id/accept              (Worker: accept invitation)
DELETE /api/v1/hotels/:hotel_id/workers/:worker_id   (Manager: remove worker)
```

### Group 3 — Staffing (Week 2)
```
POST   /api/v1/work-requests
GET    /api/v1/work-requests                         (?hotel_id=&status=&date=)
GET    /api/v1/work-requests/:id
PATCH  /api/v1/work-requests/:id/cancel

POST   /api/v1/work-requests/:id/applications        (Worker: apply)
GET    /api/v1/work-requests/:id/applications        (Manager: list applicants)
GET    /api/v1/applications                          (Worker: my applications)
PATCH  /api/v1/applications/:id/withdraw             (Worker)
PATCH  /api/v1/applications/:id/accept               (Manager)
PATCH  /api/v1/applications/:id/reject               (Manager)

GET    /api/v1/assignments                           (Worker: my assignments)
GET    /api/v1/assignments/:id
PATCH  /api/v1/assignments/:id/cancel                (Manager)
PATCH  /api/v1/assignments/:id/reassign              (Manager)
```

### Group 4 — Attendance (Week 3)
```
POST   /api/v1/assignments/:id/clock-in              (Worker)
POST   /api/v1/assignments/:id/clock-out             (Worker)
GET    /api/v1/assignments/:id/attendance             (Worker + Manager + Checker)
PATCH  /api/v1/assignments/:id/attendance/absent     (Manager)
```

### Group 5 — Quality & Rating (Week 3)
```
POST   /api/v1/assignments/:id/verification          (Checker)
GET    /api/v1/assignments/:id/verification
POST   /api/v1/assignments/:id/rating                (Checker)
GET    /api/v1/assignments/:id/rating
GET    /api/v1/workers/:worker_id/rating             (aggregate)
GET    /api/v1/leaderboard                           (?hotel_id=)
```

### Group 6 — Notifications (Week 4)
```
GET    /api/v1/notifications
POST   /api/v1/notifications/:id/read
POST   /api/v1/notifications/read-all
```

### Group 7 — Analytics (Week 4)
```
GET    /api/v1/analytics/stats
GET    /api/v1/analytics/hotels/:hotel_id/summary
GET    /api/v1/analytics/workers/:worker_id/stats
```

### Group 8 — HR (Week 4–5)
```
GET    /api/v1/hr/contract-templates
POST   /api/v1/hr/contract-templates
GET    /api/v1/hr/contracts
POST   /api/v1/hr/contracts
GET    /api/v1/hr/contracts/:id
PATCH  /api/v1/hr/contracts/:id/sign
PATCH  /api/v1/hr/contracts/:id/terminate
POST   /api/v1/hr/workers/:worker_id/documents
GET    /api/v1/hr/workers/:worker_id/documents
DELETE /api/v1/hr/documents/:id
GET    /api/v1/hr/payroll
POST   /api/v1/hr/payroll
PATCH  /api/v1/hr/payroll/:id/approve
PATCH  /api/v1/hr/payroll/:id/pay
```

---

## 7. NOTIFICATION ROLLOUT ORDER

All notifications are persisted to DB before any push attempt. Push is fire-and-forget.

| Phase | Type | Trigger | Recipient |
|-------|------|---------|-----------|
| B | `HOTEL_WORKER_INVITED` | Manager invites worker | Worker |
| C | `WORK_REQUEST_PUBLISHED` | Manager creates WorkRequest | All ACTIVE HotelWorker members of hotel |
| C | `WORK_APPLICATION_RECEIVED` | Worker applies | Manager who created WorkRequest |
| C | `WORK_APPLICATION_ACCEPTED` | Manager accepts application | Worker |
| C | `WORK_APPLICATION_REJECTED` | Manager rejects application | Worker |
| C | `WORKER_ASSIGNMENT_CREATED` | Assignment created on accept | Worker |
| C | `WORKER_ASSIGNMENT_CANCELLED` | Manager cancels assignment | Worker |
| D | `ATTENDANCE_CLOCK_IN` | Worker clocks in | Manager (for their hotel) |
| D | `ATTENDANCE_CLOCK_OUT` | Worker clocks out | Manager + Checker (shift available for verification) |
| E | `QUALITY_VERIFIED` | Checker submits verification | Worker |
| E | `RATING_RECEIVED` | Checker submits rating | Worker |
| H | `DOCUMENT_EXPIRING_SOON` | Cron: expiry within 30 days | Manager |
| H | `DOCUMENT_EXPIRED` | Cron: expiry date passed | Manager |

---

## 8. TESTING STRATEGY

### Framework (set up in Phase A)
```bash
npm install --save-dev jest @types/jest ts-jest supertest @types/supertest

# jest.config.ts
{
  preset: "ts-jest",
  testEnvironment: "node",
  coverageThreshold: { global: { lines: 80, functions: 80 } },
  setupFilesAfterFramework: ["./tests/setup.ts"],
  testPathPattern: ["tests/unit", "tests/integration"]
}
```

Use a **dedicated test database** (`DATABASE_URL_TEST` in `.env.test`). Reset between integration test suites via `prisma migrate reset --force --skip-seed`.

### Test Types

**Unit Tests** — `tests/unit/*.service.test.ts`
- Mock Prisma client: `jest.mock('../lib/db')`
- Target: every public method in every service
- Test: business logic, status transition guards, permission checks, error cases
- Coverage target: ≥80% lines

**Integration Tests** — `tests/integration/*.routes.test.ts`
- Real test DB with Supertest
- Full request → DB → response cycle
- Must cover: auth middleware, RBAC enforcement, hotel scoping, 4xx/5xx responses

**Critical Integration Flows** (all must have dedicated test files):
1. Full staffing flow: create WorkRequest → apply → accept → clock-in → clock-out → verify → rate → check leaderboard
2. WorkApplication rejection: apply → reject → verify worker cannot clock in
3. Hotel worker lifecycle: invite → accept → post request → remove → verify removed worker cannot apply
4. HotelWorker scoping: Worker at Hotel A cannot see WorkRequests from Hotel B
5. Auth flow: signup → login → refresh → logout → verify refresh token invalid

### Priority Order

| Priority | Module | Reason |
|----------|--------|--------|
| P0 | Auth + Hotel scoping | Every other test depends on valid tokens and scoping |
| P0 | WorkRequest → WorkApplication → WorkerAssignment (happy path + concurrency) | Core business logic, double-booking risk |
| P1 | Attendance clock-in/clock-out transitions | Gating for Quality |
| P1 | QualityVerification + Rating (with Attendance gate) | Score correctness, aggregate upsert |
| P2 | HotelWorker invitation lifecycle | Membership-gated features |
| P2 | Notifications (emit + persistence) | Silent failure risk |
| P3 | HR module | Complex but isolated |
| P3 | Analytics | Read-only aggregations |

---

## 9. CONCURRENCY TESTING STRATEGY

The following race conditions are inherent in the marketplace model and MUST have dedicated concurrency tests before Phase C ships.

### RC-1 — Simultaneous WorkApplication Acceptance (CRITICAL)

**Scenario**: Two managers simultaneously call `PATCH /applications/:id/accept` for the last available slot on a WorkRequest.

**Expected**: One succeeds (HTTP 200), one fails (HTTP 409). WorkRequest.workers_needed is not exceeded.

**Test**:
```typescript
// Use Promise.all to fire two accept requests with ~0ms gap
const [r1, r2] = await Promise.all([
  acceptApplication(app1Id, managerToken),
  acceptApplication(app1Id, managerToken2)
]);
expect([r1.status, r2.status].sort()).toEqual([200, 409]);
const wr = await getWorkRequest(workRequestId);
expect(wr.filled_count).toBe(wr.workers_needed);
```

**Implementation guard**: `SELECT FOR UPDATE` on WorkRequest row inside the acceptance transaction. Prisma: `prisma.$transaction(async (tx) => { ... }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable })`.

### RC-2 — Simultaneous WorkApplication Submit (UNIQUE constraint)

**Scenario**: Same worker submits two applications to the same WorkRequest simultaneously.

**Expected**: One succeeds (HTTP 201), one fails (HTTP 409 via unique constraint `(work_request_id, worker_id)`).

**Implementation guard**: DB unique constraint on `WorkApplication(work_request_id, worker_id)` + catch Prisma `P2002` error → HTTP 409.

### RC-3 — Clock-In After Cancellation

**Scenario**: Worker clocks in at the same time manager cancels the assignment.

**Expected**: Clock-in fails with HTTP 409 if WorkerAssignment.status is not ASSIGNED.

**Implementation guard**: Check `WorkerAssignment.status = ASSIGNED` inside the clock-in transaction before writing Attendance.

### RC-4 — Simultaneous Rating for Same Assignment

**Scenario**: Two checkers simultaneously submit ratings for the same WorkerAssignment.

**Expected**: One succeeds, one fails (HTTP 409) via unique constraint `Rating(worker_assignment_id)`.

**Implementation guard**: DB unique constraint + catch `P2002` → HTTP 409.

---

## 10. SECURITY TESTING STRATEGY

### Mandatory Before Production Deployment

**Authorization Boundary Tests** (automated, in integration suite):

| Test | What It Verifies |
|------|-----------------|
| Worker at Hotel A cannot GET WorkRequests from Hotel B | HotelWorker scope enforcement |
| Worker cannot accept own WorkApplication (manager-only) | Role enforcement |
| Worker cannot submit QualityVerification (checker-only) | Role enforcement |
| REMOVED HotelWorker cannot apply to WorkRequests | Status gate enforcement |
| INVITED (not yet ACTIVE) HotelWorker cannot apply | Status gate enforcement |
| Worker cannot view another worker's HR documents | Resource ownership |
| Unauthenticated requests to protected routes return 401 | Auth middleware |
| Expired JWT returns 401 (not 403) | Token expiry handling |
| Tampered JWT returns 401 | Signature verification |

**Manual Security Review** (Week 5, pre-deployment):

| Area | Check |
|------|-------|
| SQL Injection | All DB access via Prisma parameterized queries (no raw SQL without validation) |
| Mass Assignment | Zod strips unknown fields on all request bodies |
| IDOR (Insecure Direct Object Reference) | Every GET/PATCH/DELETE verifies the requesting user has access to the resource via hotel scope or ownership |
| Sensitive Data Logging | Grep for `password`, `token`, `secret` in log output; must not appear |
| DO Spaces | Verify all documents/files use presigned URLs (expiry ≤ 1 hour); no public bucket ACL |
| Payroll Encryption | Verify `encrypted_data` field is never returned in API responses; only decrypted on authorized download |
| Rate Limiting | Verify auth endpoints reject after 10 req/min per IP |

---

## 11. AUDIT VERIFICATION STRATEGY

The following operations MUST write to AuditLog (enforced via BaseService or explicit service calls). Verified by integration tests that assert AuditLog record count.

| Operation | actor_role | action | resource_type |
|-----------|-----------|--------|---------------|
| GET contract | manager | VIEW | CONTRACT |
| Download contract PDF | manager | DOWNLOAD | CONTRACT |
| GET payroll record | manager | VIEW | PAYROLL |
| PATCH payroll/approve | manager | MODIFY | PAYROLL |
| PATCH payroll/pay | manager | MODIFY | PAYROLL |
| POST worker document | manager | MODIFY | DOCUMENT |
| GET worker document | manager | VIEW | DOCUMENT |
| DELETE worker document | manager | DELETE | DOCUMENT |
| GET worker profile (manager) | manager | VIEW | WORKER |
| PATCH worker removal from hotel | manager | MODIFY | HOTEL_WORKER |

**Verification test pattern**:
```typescript
const before = await db.auditLog.count();
await makeRequest(protectedRoute, managerToken);
const after = await db.auditLog.count();
expect(after).toBe(before + 1);
const log = await db.auditLog.findFirst({ orderBy: { timestamp: 'desc' } });
expect(log.resource_type).toBe('CONTRACT');
expect(log.action).toBe('VIEW');
```

**GDPR-specific audit requirements**:
- DataRetentionLog created within the same transaction as Contract/Payroll creation (not async)
- ConsentLog written on first login, verified by integration test
- Soft delete (`deleted_at`) on Contract, WorkerDocument, Payroll — verified that hard-deleted records return 404 on GET

---

## 12. DEPLOYMENT STRATEGY

### Environments

| Environment | Purpose | DB | When |
|-------------|---------|-----|------|
| `development` | Local dev, Docker Compose | Local PostgreSQL 15 | Always |
| `test` | CI and local test suite | Separate local PostgreSQL instance | Always |
| `staging` | Pre-production integration + QA | DigitalOcean Managed PG (separate instance) | Week 3 |
| `production` | Live | DigitalOcean Managed PG (primary) | Week 6 |

### Local Development (Docker Compose)

```yaml
services:
  postgres:     port 5432  (hotelcrm_dev)
  redis:        port 6379
  adminer:      port 8082
  mailhog:      port 8025
```

### Staging Setup (Week 3 — BE-2 responsibility)

1. Provision DigitalOcean Droplet (2GB RAM, Frankfurt)
2. Install: Node.js 20, PM2, Nginx, Certbot
3. Configure Nginx reverse proxy → `localhost:3001`
4. SSL: Let's Encrypt via Certbot
5. Set all env vars from `.env.example`
6. `prisma migrate deploy` (not db:push)
7. Seed with staging data
8. Configure GitHub Actions: on push to `main` → run tests → deploy to staging

### Production Deployment (Week 6)

1. Provision DigitalOcean Managed PostgreSQL 15 (Frankfurt)
2. Provision DigitalOcean Redis 7 (Frankfurt)
3. Provision DigitalOcean Spaces bucket (`hotel-crm-prod`, Frankfurt, CDN enabled)
4. Provision production Droplet (separate from staging)
5. `prisma migrate deploy` (zero-downtime: Prisma migrate is additive in V2)
6. Seed one Admin user
7. PM2 cluster mode (2 instances)
8. Confirm health check: `GET /api/v1/health` returns `{"status":"ok","db":"connected"}`

### CI/CD Pipeline (GitHub Actions)

```yaml
on: push to main
jobs:
  test:
    - npm ci
    - prisma migrate deploy (test DB)
    - npm run test:coverage (must pass ≥80%)
  deploy-staging:
    needs: test
    - ssh to staging droplet
    - git pull
    - npm ci --production
    - prisma migrate deploy
    - pm2 reload all
  deploy-production:
    needs: deploy-staging
    when: manual trigger only
```

### Mobile Release (Expo EAS)

```bash
# Staging
eas build --platform all --profile preview
# TestFlight (iOS) + Play Console internal (Android)

# Production
eas build --platform all --profile production
eas submit --platform all
```

---

## 13. PRODUCTION READINESS CHECKLIST

### Infrastructure
- [ ] DigitalOcean Managed PostgreSQL 15 provisioned (Frankfurt, EU)
- [ ] DigitalOcean Redis 7 provisioned (Frankfurt)
- [ ] DigitalOcean Spaces bucket `hotel-crm-prod` created with CDN enabled
- [ ] Production Droplet provisioned (min 2GB RAM, 2 vCPU)
- [ ] Nginx reverse proxy configured (HTTP → HTTPS redirect)
- [ ] SSL certificate active (Let's Encrypt, auto-renew configured)
- [ ] Cloudflare DNS A record pointed at Droplet IP
- [ ] DigitalOcean firewall: only ports 22, 80, 443 open
- [ ] Staging environment running and verified (separate Droplet + DB)

### Application
- [ ] `NODE_ENV=production` in environment
- [ ] `JWT_SECRET` ≥ 64 chars, random, stored in DigitalOcean Secrets or .env on server (not in repo)
- [ ] `DATABASE_URL` includes `?sslmode=require`
- [ ] `connection_limit=10` set in DATABASE_URL
- [ ] All env vars from `.env.example` populated in production
- [ ] `npm run build` produces zero TypeScript errors
- [ ] `prisma migrate deploy` runs cleanly from zero on fresh DB
- [ ] Seed admin user created
- [ ] `GET /api/v1/health` returns 200 with `{"db":"connected"}`
- [ ] No `throw new Error('Not implemented')` in any service (grep verified)
- [ ] No `console.log` in any service file (grep verified)

### Security
- [ ] Helmet.js active (X-Frame-Options, CSP, HSTS headers present in response)
- [ ] Rate limiting: 10 req/min on `/api/v1/auth/*` (verified with load test)
- [ ] CORS: `origin` locked to production domain only
- [ ] Passwords: bcrypt with cost factor 12 (verified in Auth service)
- [ ] DO Spaces: bucket has NO public ACL; all access via presigned URLs
- [ ] Presigned URL expiry ≤ 3600 seconds
- [ ] Payroll `encrypted_data` never returned in API response (grep verified)
- [ ] AuditLog writing verified for all HR operations (integration test green)
- [ ] ConsentLog written on first login (integration test green)

### Mobile Release
- [ ] Expo EAS Build: production profile configured
- [ ] `app.json`: bundle identifier `com.hotelcrm.app`, version `1.0.0`
- [ ] API base URL: `https://api.hotelcrm.com` (not staging URL)
- [ ] APNS production certificate in EAS secrets
- [ ] FCM server key in EAS secrets
- [ ] TestFlight build approved by Apple (allow 2–3 day review time)
- [ ] Play Console internal track build submitted

### Observability
- [ ] Sentry DSN configured (error tracking active in production)
- [ ] Structured JSON logs flowing to DigitalOcean log drain or Papertrail
- [ ] UptimeRobot monitoring `GET /api/v1/health` (alert if down >2 min)
- [ ] DigitalOcean Managed DB: daily backups confirmed enabled
- [ ] PM2 process monitoring: `pm2 monit` accessible

### GDPR / Compliance
- [ ] Privacy policy URL live and accessible from mobile app
- [ ] ConsentLog: PRIVACY_POLICY + HR_DATA_PROCESSING written on first login
- [ ] DataRetentionLog: created on every Contract and Payroll record creation
- [ ] Document expiry cron job: running daily, tested with test records
- [ ] Data deletion procedure: documented and tested in staging
- [ ] DO Spaces: documents stored in `eu-central-1` region (Frankfurt, GDPR compliant)

### Runbook
- [ ] Deploy procedure documented: `git pull → npm run build → prisma migrate deploy → pm2 reload all`
- [ ] Rollback procedure: `pm2 reload all` with prior build + point-in-time DB restore if needed
- [ ] On-call contact list: min 1 engineer reachable for 48h post-launch
- [ ] DB restore procedure: tested in staging (restore from backup, verify data)

---

## 14. MVP COMPLETION CRITERIA

MVP is complete when **all** of the following acceptance criteria pass:

### Workflow Gate: Full Happy Path

1. Admin can create a Hotel
2. Manager (scoped to that Hotel) can invite a Worker
3. Worker receives notification and accepts the invitation (HotelWorker status → ACTIVE)
4. Manager creates a WorkRequest for a future shift
5. Worker sees the WorkRequest in their open shifts list
6. Worker applies (WorkApplication created with status PENDING)
7. Manager sees the application and accepts it
8. WorkerAssignment is created automatically; Attendance record created with status PENDING
9. Worker receives push notification: shift accepted
10. Worker clocks in (Attendance → CLOCKED_IN; WorkerAssignment → IN_PROGRESS)
11. Worker clocks out (Attendance → CLOCKED_OUT; WorkerAssignment → COMPLETED)
12. Checker sees the completed assignment in pending verification queue
13. Checker submits QualityVerification (score 0–100)
14. Checker submits Rating (0–5 stars)
15. Worker receives push notification: rating received
16. WorkerOverallRating is updated
17. Leaderboard shows the worker with correct ranking

### Technical Gates

- [ ] All P0 and P1 integration tests pass on CI
- [ ] Test coverage ≥ 80% on backend service layer
- [ ] Zero `Not implemented` errors reachable via any documented API endpoint
- [ ] Zod validation rejects malformed request bodies on all endpoints (verified by test)
- [ ] RBAC: Worker cannot submit QualityVerification; Checker cannot create WorkRequest; verified by test
- [ ] Hotel scoping: Worker at Hotel A cannot see Hotel B WorkRequests; verified by test
- [ ] Concurrency: RC-1 and RC-2 tests pass
- [ ] AuditLog writes verified for all HR operations
- [ ] `prisma migrate deploy` runs cleanly on a fresh database

### Operational Gates

- [ ] Staging environment accessible at `https://staging-api.hotelcrm.com`
- [ ] Health check endpoint returns 200 with DB connectivity status
- [ ] At least one full happy-path smoke test executed manually on staging
- [ ] `.env.example` matches all variables required in production

---

## 15. CRITICAL PATH ANALYSIS

The critical path is the minimum sequence of dependent work that gates production launch.

```
Week 1:
  A2 (schema rewrite) → A3 (migration) → A5 (auth service) → A6 (hotel access rewrite)
                                        └→ B2 (HotelWorker invite) → B3 (accept)

Week 2:
  C4 (WorkApplication create) → C6 (accept + atomic transaction) → C9 (assignment lifecycle)
  [BD-1, BD-3, BD-4 must be resolved by Week 2 Day 1]

Week 3:
  D1 (clock-in) → D2 (clock-out) → [Attendance gate]
                                  └→ E1 (QualityVerification) → E2 (Rating) → E3 (upsert)

Week 4:
  F1 (notification emit) → F2 (push delivery)
  G (analytics — parallel, non-blocking)

Week 5:
  I (security hardening) → staging deploy → QA regression

Week 6:
  Bug fixes → production deploy → smoke tests
```

**Single longest sequential chain** (cannot be parallelized):
```
Auth → HotelWorker (invite+accept) → WorkRequest → WorkApplication → WorkerAssignment
→ Attendance (clock-in) → Attendance (clock-out) → QualityVerification → Rating → Leaderboard
```

**This chain must not slip. Any delay to any node delays production launch by the same amount.**

---

## 16. PARALLELIZATION OPPORTUNITIES

### After Phase A (Week 1 complete)

| Track | Work | Unblocked By |
|-------|------|-------------|
| **BE-1** | Phase C: WorkRequest + WorkApplication + WorkerAssignment | Phase A |
| **BE-2** | Phase H: HR module (zero dependency on Staffing/Quality) | Phase A only |
| **MOB** | M0 + M1.1–M1.5 (worker screens up to clock-in) | Phase A (Auth API live) |
| **QA** | Auth + Hotel integration tests | Phase A |

### After Phase C (Week 2 complete)

| Track | Work | Unblocked By |
|-------|------|-------------|
| **BE-1** | Phase D (Attendance) → Phase E (Quality) | Phase C |
| **BE-2** | Phase F (Notifications) — can wire into C, D, E after the fact | Phase A (emit API) |
| **MOB** | M1.6–M1.9 (clock-in/out, ratings, notifications) | Phase D |
| **QA** | WorkRequest + WorkApplication + WorkerAssignment tests | Phase C |

### Always Parallel (no dependency on feature phases)

- DevOps: staging environment setup — no code dependency
- Migration 003 (performance indexes) — can run any week after 001
- Security hardening (Phase I) — starts after functional phases done but independent of each other
- Documentation: API_STANDARDS.md, RBAC_PERMISSION_MATRIX.md

---

## 17. TEAM ALLOCATION RECOMMENDATIONS

Assumes 4 engineers: 2 Backend (BE-1, BE-2), 1 Mobile (MOB), 1 QA.

### Backend Engineer 1 — Core Workflow
**Weeks 1–2**: Phase A (schema, migration, auth, hotel access rewrite), Phase B (Hotels, HotelWorker), Phase C (Staffing)
**Week 3**: Phase D (Attendance), Phase E (Quality, Rating, Leaderboard)
**Week 4**: Phase G (Analytics), integration support
**Week 5**: Phase I security hardening, bug fixes
**Owns**: `modules/auth`, `modules/crm` (Hotels + HotelWorker), `modules/staffing`, `modules/quality`, `modules/analytics`

### Backend Engineer 2 — HR, Notifications, DevOps
**Week 1**: Phase A joint (A1 deps install, A4 seed), HR schema review
**Weeks 2–3**: Phase H (HR: contracts, documents, payroll, GDPR cron)
**Week 4**: Phase F (Notifications + push delivery), staging environment setup
**Week 5**: CI/CD pipeline, production environment provisioning
**Owns**: `modules/hr`, `modules/notifications`, deployment config, security middleware

### Mobile Engineer — All Apps
**Week 1**: M0 (merge apps, API client, auth store)
**Weeks 2–3**: M1 (Worker screens, full clock-in/out flow)
**Weeks 3–4**: M2 (Checker screens), M3.1–M3.3 (Manager invite, WorkRequest, Applications)
**Week 5**: M3.4–M3.6 (Manager overview, analytics, HR), push notification handling, EAS build setup
**Owns**: `mobile/app` (unified), all screens, Zustand stores, API integration layer

### QA Engineer — Testing & Validation
**Week 1**: Jest/Supertest framework setup, Auth integration tests
**Week 2**: Hotel + HotelWorker tests, WorkRequest + WorkApplication tests
**Week 3**: Attendance tests, Quality + Rating tests, RC-1/RC-2 concurrency tests
**Week 4**: HR test suite, Notifications tests, security boundary tests
**Week 5**: Full regression pass on staging, audit verification tests, performance baseline
**Owns**: `backend/tests/`, test DB config, CI test integration, staging smoke tests

---

## 18. RISK REGISTER

### R1 — WorkApplication Acceptance Race Condition (CRITICAL)

**Probability**: High (concurrent multi-manager hotels)
**Impact**: Critical (workers_needed exceeded, data integrity violation)
**Mitigation**: `SELECT FOR UPDATE` with `Serializable` isolation on WorkRequest row in acceptance transaction. Catch serialization error → HTTP 409. RC-1 concurrency test mandatory before Phase C ships.
**Owner**: BE-1 · **Week**: 2
**Residual risk after mitigation**: Low

---

### R2 — BD-1/BD-3/BD-4 Not Resolved Before Week 2 (HIGH)

**Probability**: Medium
**Impact**: High — Phase C cannot be finalized; Worker mobile screens M1.2–M1.5 cannot proceed
**Mitigation**: Schedule 30-minute architecture decision sync on Week 1 Day 5. All three blocking decisions (BD-1, BD-3, BD-4) must produce written decisions committed to the repo before Week 2 Day 1.
**Owner**: Principal Architect · **Week**: 1 (Day 5 deadline)
**Residual risk**: Low if sync is scheduled

---

### R3 — HotelWorker Scoping Bug in checkHotelAccess() (HIGH)

**Probability**: Medium
**Impact**: High — workers can see/apply to other hotels' WorkRequests (data leak)
**Mitigation**: Rewrite `checkHotelAccess()` as part of Phase A6. Write explicit hotel-scoping integration test (hotel B worker cannot see hotel A data) as a P0 test in QA Week 1.
**Owner**: BE-1 · **Week**: 1
**Residual risk**: Low

---

### R4 — QualityVerification Anchor (BD-2) Overridden Late (MEDIUM)

**Probability**: Low-Medium
**Impact**: Medium — if BD-2 is overridden to `attendance_id` after Phase E is built against `worker_assignment_id`, Phase E requires rework
**Mitigation**: Resolve BD-2 before Week 3 Day 1. Phase E does not start until decision is confirmed in writing.
**Owner**: Principal Architect · **Week**: 2 (Day 5 deadline)
**Residual risk**: Low if deadline is met

---

### R5 — Push Notification Delivery Infrastructure (MEDIUM)

**Probability**: Medium
**Impact**: Medium — workers don't receive real-time notifications (degraded, not broken: all notifications persist in DB)
**Mitigation**: Implement as fire-and-forget with structured error logging. If APNS/FCM credentials unavailable, stub delivery and log. Mobile app polls notifications endpoint as fallback.
**Owner**: BE-2 · **Week**: 4
**Residual risk**: Low (DB persistence is ground truth)

---

### R6 — Mobile App Merger Regression (MEDIUM)

**Probability**: Medium
**Impact**: Medium — merger could break Expo Router config and delay Week 2 mobile work
**Mitigation**: Merger is M0.1, Day 1. If it exceeds 1.5 days, keep two apps and create shared `packages/` workspace for API client and Zustand stores instead of full merge.
**Owner**: MOB · **Week**: 1
**Residual risk**: Low (fallback plan well-defined)

---

### R7 — HR Payroll Encryption Key Management (MEDIUM)

**Probability**: Low
**Impact**: High — lost encryption key = unrecoverable payroll data
**Mitigation**: Use `encryption_key_id` field on Payroll to version keys. Store keys in environment variables (not DB) for MVP. Document key rotation procedure in ops runbook before Phase H ships.
**Owner**: BE-2 · **Week**: 4
**Residual risk**: Medium (key rotation is manual in MVP; Phase 2 should add secrets manager)

---

### R8 — Prisma Serializable Isolation Not Available on DigitalOcean Managed PG (LOW)

**Probability**: Low
**Impact**: High — RC-1 race condition mitigation fails
**Mitigation**: Verify `SET TRANSACTION ISOLATION LEVEL SERIALIZABLE` works on DigitalOcean Managed PG before Phase C ships. If not available, fall back to advisory locks (`pg_try_advisory_xact_lock`).
**Owner**: BE-1 · **Week**: 2 Day 1 (verify before implementing C6)
**Residual risk**: Low

---

## 19. TECHNICAL DEBT REGISTER

Items deferred from MVP that must be addressed before Phase 2 work begins.

| ID | Item | Created In | Impact if Unaddressed | Priority |
|----|------|------------|----------------------|----------|
| TD-1 | Encryption key rotation: MVP uses env vars. Needs HashiCorp Vault or AWS KMS for key rotation | Phase H | Critical (data unrecoverable on key loss) | P0 for Phase 2 |
| TD-2 | Push notification reliability: fire-and-forget has no retry logic. Failed pushes are logged but not retried | Phase F | Workers miss time-sensitive notifications | P1 |
| TD-3 | E2E mobile tests: Maestro or Detox tests not implemented | MVP scope | Regressions caught only in manual QA | P1 |
| TD-4 | WorkRequest marketplace visibility rule (BD-1): assumed closed (HotelWorker-scoped). If an open marketplace is required later, WorkRequest visibility logic must change | Phase C | Major refactor if assumption wrong | P0 (must confirm before Phase C) |
| TD-5 | Attendance GPS/location: clock-in/out has no location verification | Phase D | Cannot detect fraudulent attendance | P2 |
| TD-6 | Swagger/OpenAPI documentation: no API docs generated | All phases | Mobile team and integrators must read source | P2 |
| TD-7 | Redis caching: installed but unused. Hot queries (leaderboard, analytics stats) could benefit from cache with short TTL | Not implemented | Performance degradation at scale | P3 |
| TD-8 | Worker photo upload: removed with Task/TaskPhoto. If shift-level photo evidence is required in future, a new model is needed | Phase D | No visual evidence for quality disputes | P2 |
| TD-9 | DataRetentionLog auto-deletion: cron sends reminders but does not auto-delete. Manual deletion required | Phase H | GDPR non-compliance if reminders ignored | P1 |
| TD-10 | ConsentLog versioning: consent version is hardcoded "v1.0". Needs UI for re-consent on policy updates | Phase A | Legal risk on policy updates | P1 |
| TD-11 | `User.hotel_ids[]` removal may break any in-flight mobile sessions using old JWT payload. Old tokens encode hotel_ids array, new auth checks HotelWorker. Need to ensure migration window is handled | Phase A | Auth failures for users with cached tokens | P0 (handle in Phase A deployment) |

---

## 20. FUTURE PHASE 2 ROADMAP

The following features are explicitly out of MVP scope. They are listed here to ensure architecture decisions in MVP do not close off these paths.

### Group P2-A — Operations Layer (Deferred)

If shift-level granularity proves insufficient and room/task-level tracking is required:

- `Room` model (re-introduce as optional sub-entity of Hotel)
- `ShiftTask` model (not legacy Task — a work item within a WorkerAssignment)
- `ShiftTaskPhoto` (before/after evidence per task)
- DailyOperation equivalent as a derived view, not a stored model

**Architecture note**: These would sit between Layer 2 (Assignment) and Layer 3 (Attendance) in the dependency graph. QualityVerification would then anchor to `ShiftTask` instead of `WorkerAssignment`. This is a schema migration, not a rebuild — plan accordingly.

### Group P2-B — Open Marketplace

If BD-1 is resolved as "open marketplace" (any worker applies, not just HotelWorker members):

- Remove HotelWorker eligibility gate from WorkApplication creation
- Add Hotel profile/discovery endpoint for workers
- WorkRequest becomes publicly discoverable

### Group P2-C — Advanced HR

- Contract PDF generation (Puppeteer/WeasyPrint)
- Automated payroll calculation from attendance hours
- Payroll approval workflow (multi-step)
- Data deletion automation (DataRetentionLog → auto-delete on retention_end_date)

### Group P2-D — Platform Features

- Web dashboard (Next.js) for Managers (currently mobile M3, may be deferred to web)
- Multi-language support (i18n — German, Turkish, Polish)
- Worker performance analytics (trend lines, comparison cohorts)
- Bulk WorkRequest creation (shift templates)
- Reassignment workflow with worker notification and re-application

### Group P2-E — Infrastructure

- Redis caching: leaderboard (TTL 60s), analytics stats (TTL 300s)
- Encryption key rotation via HashiCorp Vault or AWS KMS
- Horizontal scaling: migrate from single Droplet to DigitalOcean App Platform
- Push notification retry queue (Bull/Redis)
- Real-time updates via WebSocket or SSE (live assignment status for Managers)

---

# PART III — FREEZE RECOMMENDATION

## Assessment

| Dimension | Status | Notes |
|-----------|--------|-------|
| Core workflow completeness | COMPLETE | All 9 workflow steps (Auth → Hotel → HotelWorker → WorkRequest → WorkApplication → WorkerAssignment → Attendance → QualityVerification → Rating) have defined implementation phases |
| Schema consistency | COMPLETE (with patches) | 3 new models designed (HotelWorker, WorkApplication, Attendance); 4 old models removed; 2 modified models updated |
| Blocking decisions | 5 identified | BD-1 through BD-5 listed with deadlines; none block Week 1 work |
| Concurrency risks | ADDRESSED | RC-1 through RC-4 documented with implementation guards and mandatory tests |
| Security posture | ADDRESSED | Hotel scoping, RBAC, IDOR, audit log, GDPR requirements all covered |
| Mobile path | COMPLETE | M0–M3 phases defined with backend dependencies explicitly mapped |
| Test strategy | COMPLETE | Unit, integration, concurrency, security, audit verification all defined |
| Deployment path | COMPLETE | Dev → Staging → Production with CI/CD defined |
| Phase 2 roadmap | COMPLETE | Future features documented without closing off architectural paths |

## Blocking Decisions Required Before Execution

The following MUST be resolved in a synchronous decision meeting on **Week 1 Day 5** (latest):

| ID | Question | Who Decides | Impact if Skipped |
|----|---------|-------------|------------------|
| BD-1 | WorkRequest visibility: HotelWorker-scoped (closed) vs. open marketplace | Principal Architect | Phase C API contract wrong |
| BD-2 | QualityVerification anchor: `worker_assignment_id` vs. `attendance_id` | Principal Architect | Phase E schema wrong |
| BD-3 | WorkApplication acceptance: atomic auto-create WorkerAssignment vs. two-step | Principal Architect | Phase C transaction logic wrong |
| BD-4 | Auto-reject excess applications when WorkRequest FILLED: yes/no | Principal Architect | Phase C C6 step incomplete |
| BD-5 | Attendance: GPS location required for MVP | Principal Architect | Phase D schema incomplete |

## Recommendation

```
╔══════════════════════════════════════════════════════════════════╗
║                                                                  ║
║              APPROVE_WITH_PATCHES                                ║
║                                                                  ║
║  This plan is architecturally sound and executable.              ║
║                                                                  ║
║  Required patches before execution begins:                       ║
║                                                                  ║
║  1. Resolve BD-1 through BD-5 in a single decision sync          ║
║     on Week 1 Day 5. Record decisions as commits to this         ║
║     document.                                                    ║
║                                                                  ║
║  2. Confirm WorkRequest Final Architecture document              ║
║     exists or adopt the WorkRequest schema defined in            ║
║     this plan as the canonical definition.                       ║
║                                                                  ║
║  3. Confirm Quality & Rating Architecture document               ║
║     exists or adopt the QualityVerification/Rating               ║
║     schema defined in this plan as canonical.                    ║
║                                                                  ║
║  4. Verify TD-11 (hotel_ids[] JWT payload migration              ║
║     strategy) before Phase A deployment.                         ║
║                                                                  ║
║  V1 IMPLEMENTATION_MASTER_PLAN.md is invalidated.               ║
║  Do not execute against it.                                      ║
║                                                                  ║
╚══════════════════════════════════════════════════════════════════╝
```

---

*This document is the execution contract for Hotel CRM MVP. Any change to workflow, schema, or phase order requires a Principal Architect sign-off and a commit to this document before the affected phase begins.*
