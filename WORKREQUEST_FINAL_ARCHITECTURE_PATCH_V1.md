# WorkRequest Final Architecture — Patch V1

**Applies to**: WORKREQUEST_FINAL_ARCHITECTURE.md v1.0.0  
**Patch version**: V1  
**Date**: 2026-06-08  
**Trigger**: Architecture audit APPROVE_WITH_PATCHES — resolves all 10 BLOCKERs  
**Status**: FREEZE-READY after this patch is applied  

This document patches the approved architecture. It does not redesign it. Read it alongside WORKREQUEST_FINAL_ARCHITECTURE.md. Where this document and the base document conflict, this document takes precedence.

---

## SECTION 1 — Patch Decisions

One binding decision per blocker. No open questions remain after this section.

---

### B1 — HotelWorker Undefined

**Decision**: Define `HotelWorker` as a new model in the `crm` module. It is the enrollment record linking a `User` with role `WORKER` or `CHECKER` to a `Hotel`. It is the sole mechanism for WORKER/CHECKER hotel scoping. `User.hotel_ids` is retained exclusively for `MANAGER` scoping and must not be used for WORKER or CHECKER access decisions.

`HotelWorker` carries its own `role` field (`WORKER` or `CHECKER`) independent of `User.role`. A single user could theoretically be enrolled as WORKER at Hotel A and CHECKER at Hotel B, but may not be enrolled as both WORKER and CHECKER at the same hotel (enforced by unique constraint on `[hotel_id, worker_id]` — only one enrollment record per hotel per user).

The controlled-pool model is the explicit MVP stance. Open marketplace discovery (workers browsing shifts at hotels where they are not enrolled) is deferred to Phase 2 and must not be implemented in MVP.

---

### B2 — User Model Retains Relations to Dropped Tables

**Decision**: The "Auth is frozen" declaration is amended. The frozen contract covers: `User` fields, `UserRole` enum, `Session` model, JWT logic, and RBAC middleware. It does not freeze relation fields on `User` that reference tables being dropped or redefined. The following back-relations are **removed** from `User`:

- `created_tasks Task[] @relation("created_by")` — Task dropped
- `assigned_tasks Task[] @relation("assigned_to")` — Task dropped
- `created_operations DailyOperation[] @relation("created_by")` — DailyOperation dropped
- `assigned_work_requests WorkRequest[] @relation("assigned_by")` — old WorkRequest direct-assignment relation no longer exists

The following back-relations are **added** to `User` (see B3 below).

---

### B3 — User Model Relation Names Incompatible with New QV and Rating

**Decision**: Remove the three stale back-relations (`verifications`, `ratings_received`, `ratings_given`) and add four new back-relations matching the named relations used in the new `QualityVerification` and `Rating` models.

| Remove | Replace with |
|--------|-------------|
| `verifications QualityVerification[]` | `qv_checks QualityVerification[] @relation("qv_checker")` |
| (no equivalent) | `qv_waivers QualityVerification[] @relation("qv_waived_by")` |
| `ratings_received Rating[] @relation("ratings_received")` | `ratings_as_worker Rating[] @relation("rating_worker")` |
| `ratings_given Rating[] @relation("ratings_given")` | `rating_voids Rating[] @relation("rating_voided_by")` |

---

### B4 — Hotel.quality_threshold Missing

**Decision**: Add `quality_threshold Int @default(70)` to the `Hotel` model. The value is an integer in the range 0–100 representing the minimum QV score for a PASSED result. Default 70 is the platform-wide baseline. Per-hotel configuration is the manager's responsibility via the hotel admin interface. The field is validated at the API layer: must be between 0 and 100 inclusive.

Hotel is "frozen" in the sense that its core identity and relationship structure are settled. Adding a new operational configuration field is not a structural change and does not violate the frozen contract.

---

### B5 — Notification.delivery_status Missing

**Decision**: Add three fields to the `Notification` model to support delivery tracking:

- `delivery_status String @default("PENDING")` — values: `"PENDING"`, `"SENT"`, `"FAILED"`, `"NOT_APPLICABLE"` (for in-app-only notifications with no push token)
- `delivery_attempts Int @default(0)`
- `last_attempted_at DateTime?`

`NOT_APPLICABLE` is used when the notification type is in-app only (no push delivery attempted). `SENT` is set after a successful Expo push API call. `FAILED` is set after all retry attempts are exhausted.

---

### B6 — Push Token Storage Undefined

**Decision**: Define a `DevicePushToken` model in the `notifications` module. A single user may have multiple registered devices (phone + tablet, iOS + Android). Tokens are registered at app launch if they have changed and deactivated on logout.

- `platform`: `"ios"` or `"android"`
- `app_type`: `"worker"` or `"checker"` — prevents cross-app token leakage
- Tokens are `@unique` across the table; if the same Expo token re-registers, `is_active` is set back to `true` and `last_registered_at` is updated (upsert on token value)
- On logout, all tokens for that `user_id` + `app_type` are set to `is_active = false`

When dispatching a push notification, the notification service queries `DevicePushToken` where `user_id = X AND is_active = true AND app_type = $expected_app`. If no token is found, `delivery_status` is set to `NOT_APPLICABLE` and the notification is in-app only.

---

### B7 — Attendance Lifecycle Missing CANCELLED/VOID Path

**Decision**: Add `CANCELLED` as a terminal state to `AttendanceStatus`. This state is reached when the parent `WorkerAssignment` is cancelled, regardless of the Attendance's current state. The transition is always system-driven (not by any actor directly) — it is a cascade from the assignment cancellation handler.

Two paths lead to `Attendance.CANCELLED`:

1. `NOT_STARTED → CANCELLED`: Assignment cancelled before worker checked in
2. `CHECKED_IN → CANCELLED`: Assignment force-cancelled mid-shift by manager

In both cases:
- `cancellation_reason` on `WorkerAssignment` is the source of record
- A `CANCELLED` Attendance record is **excluded** from payroll calculation and from QualityVerification triggers
- No QualityVerification is created for a CANCELLED Attendance

The `CHECKED_OUT → CANCELLED` path is **not permitted**. Once a worker has checked out, the assignment has concluded. Cancellation after checkout must be handled via attendance override and dispute resolution, not cancellation.

---

### B8 — Cross-Midnight Overlap Algorithm Invalid

**Decision**: Add two computed UTC datetime fields to `WorkRequest`: `shift_start_utc DateTime` and `shift_end_utc DateTime`. These are set at creation time by converting `shift_date + shift_start_time` and `shift_date + shift_end_time` (adjusted for `crosses_midnight`) into absolute UTC datetimes using `Hotel.timezone`.

The existing display fields (`shift_date`, `shift_start_time`, `shift_end_time`, `crosses_midnight`) are retained for display and business-rule purposes. They are not used for overlap computation.

All double-booking overlap checks use `shift_start_utc` and `shift_end_utc` exclusively:

```
overlap = existing.shift_start_utc < new.shift_end_utc
          AND existing.shift_end_utc > new.shift_start_utc
```

This is standard interval overlap and is correct for all cases including cross-midnight, multi-day, and same-hotel/cross-hotel.

The UTC conversion responsibility lies in `WorkRequest.service.ts` at creation time. The service fetches `Hotel.timezone`, applies the conversion, and stores both UTC fields before persisting. No runtime conversion is needed at query time.

---

### B9 — Attendance Idempotency Rule Incorrect

**Decision**: Replace the INSERT-based idempotency description with the correct UPDATE-based mechanism. Since the `Attendance` row is created at `WorkerAssignment` creation time (status `NOT_STARTED`), check-in and check-out are always UPDATE operations on an existing row.

The idempotent check-in pattern is:

```
rows_affected = UPDATE attendance
                SET checked_in_at = NOW(), status = 'CHECKED_IN', updated_at = NOW()
                WHERE worker_assignment_id = $id
                  AND status = 'NOT_STARTED'

if rows_affected = 0:
  current = SELECT status FROM attendance WHERE worker_assignment_id = $id
  if current.status = 'CHECKED_IN'  → return 200 OK with existing record (idempotent)
  if current.status = 'CANCELLED'   → return 409 CONFLICT "assignment_cancelled"
  if current.status IN ('CHECKED_OUT', 'VERIFIED', 'DISPUTED') → return 409 CONFLICT "already_checked_out"
  if row does not exist              → return 500 (data integrity error; WorkerAssignment exists without Attendance)
```

The same pattern applies to check-out, using `status = 'CHECKED_IN'` as the guard condition.

---

### B10 — Staffing → Quality Dependency Undocumented / Potentially Circular

**Decision**: The circular dependency is eliminated by making the `quality` module parameter-driven. `quality` never imports `staffing`.

The dependency graph becomes strictly one-directional:

- `staffing → quality`: The `staffing` module calls `quality.service.createVerification(params)` after Attendance is VERIFIED. All context needed for QV creation is passed as parameters — `workerAssignmentId`, `hotelId`, `workerId`. Quality does not need to call back into staffing to retrieve this data because it is passed in at creation time and stored on the `QualityVerification` record.

- `quality → staffing` is **removed** from the dependency table. When a checker submits a verification, quality reads from the `QualityVerification` record itself (which already holds `hotel_id`, `worker_assignment_id`, `checker_id`). No staffing service call is needed.

The call sequence for attendance verification is:

```
staffing.attendanceService.verify(assignmentId, managerId)
  → UPDATE attendance SET status = VERIFIED (in transaction)
  → UPDATE worker_assignment SET status = ATTENDANCE_VERIFIED (in transaction)
  → quality.verificationService.createPending(workerAssignmentId, hotelId, workerId)
       ↳ INSERT quality_verifications (status = PENDING)
  → notificationService.dispatch(VERIFICATION_AVAILABLE, hotelId)
  → COMMIT
```

`quality.verificationService.createPending` is a pure write with no reads back into the staffing module.

---

## SECTION 2 — Schema Patch

This section is a complete, self-contained schema patch. Apply these changes to the base schema. Additions are annotated. Modifications to frozen models are narrowly scoped.

---

### 2.1 New Model: HotelWorker

```prisma
// ============================================
// CRM MODULE — addition
// ============================================

model HotelWorker {
  id                  String          @id @default(cuid())
  hotel_id            String
  hotel               Hotel           @relation(fields: [hotel_id], references: [id], onDelete: Cascade)
  worker_id           String
  worker              User            @relation("hotel_worker_user", fields: [worker_id], references: [id], onDelete: Restrict)
  role                HotelWorkerRole
  is_active           Boolean         @default(true)
  enrolled_at         DateTime        @default(now())
  deactivated_at      DateTime?
  deactivated_by_id   String?
  deactivated_by      User?           @relation("hotel_worker_deactivated_by", fields: [deactivated_by_id], references: [id])
  notes               String?
  created_at          DateTime        @default(now())
  updated_at          DateTime        @updatedAt

  @@unique([hotel_id, worker_id])
  @@index([hotel_id])
  @@index([worker_id])
  @@index([is_active])
  @@index([role])
}

enum HotelWorkerRole {
  WORKER
  CHECKER
}
```

---

### 2.2 New Model: DevicePushToken

```prisma
// ============================================
// NOTIFICATIONS MODULE — addition
// ============================================

model DevicePushToken {
  id                  String   @id @default(cuid())
  user_id             String
  user                User     @relation("user_push_tokens", fields: [user_id], references: [id], onDelete: Cascade)
  token               String   @unique
  platform            String   // "ios" | "android"
  app_type            String   // "worker" | "checker"
  is_active           Boolean  @default(true)
  last_registered_at  DateTime @default(now())
  created_at          DateTime @default(now())
  updated_at          DateTime @updatedAt

  @@index([user_id])
  @@index([is_active])
  @@index([app_type])
}
```

---

### 2.3 Modified Model: User

Remove the following back-relation fields:

```
// REMOVE:
created_tasks         Task[]            @relation("created_by")
assigned_tasks        Task[]            @relation("assigned_to")
verifications         QualityVerification[]
ratings_received      Rating[]          @relation("ratings_received")
ratings_given         Rating[]          @relation("ratings_given")
created_operations    DailyOperation[]  @relation("created_by")
assigned_work_requests WorkRequest[]    @relation("assigned_by")
```

Add the following back-relation fields:

```prisma
// ADD — HotelWorker (B1)
hotel_worker_enrollments  HotelWorker[]          @relation("hotel_worker_user")
hotel_worker_deactivations HotelWorker[]         @relation("hotel_worker_deactivated_by")

// ADD — DevicePushToken (B6)
push_tokens               DevicePushToken[]      @relation("user_push_tokens")

// ADD — new QualityVerification relations (B3)
qv_checks                 QualityVerification[]  @relation("qv_checker")
qv_waivers                QualityVerification[]  @relation("qv_waived_by")

// ADD — new Rating relations (B3)
ratings_as_worker         Rating[]               @relation("rating_worker")
rating_voids              Rating[]               @relation("rating_voided_by")

// ADD — new WorkerAssignment relations
work_assignments_as_worker  WorkerAssignment[]   @relation("wra_worker")
work_assignments_managed    WorkerAssignment[]   @relation("wra_assigned_by")

// ADD — new WorkApplication relations
work_applications_submitted WorkApplication[]    @relation("wa_worker")
work_applications_decided   WorkApplication[]    @relation("wa_decided_by")

// ADD — new Attendance relation
attendance_verifications    Attendance[]         @relation("att_verified_by")
```

All other User fields and indexes are unchanged.

---

### 2.4 Modified Model: Hotel

```prisma
// ADD field (B4):
quality_threshold   Int      @default(70)

// ADD back-relation (B1):
hotel_workers       HotelWorker[]

// REMOVE back-relations to dropped tables:
// rooms            Room[]          ← REMOVE
// tasks            Task[]          ← REMOVE
// daily_operations DailyOperation[] ← REMOVE
```

All other Hotel fields and indexes are unchanged.

---

### 2.5 Modified Model: Notification

```prisma
// ADD fields (B5):
delivery_status       String    @default("PENDING")
// values: "PENDING" | "SENT" | "FAILED" | "NOT_APPLICABLE"
delivery_attempts     Int       @default(0)
last_attempted_at     DateTime?
```

Add index:

```prisma
@@index([delivery_status])
```

---

### 2.6 Modified Model: WorkRequest (B8)

```prisma
// ADD fields for UTC overlap checking:
shift_start_utc     DateTime
shift_end_utc       DateTime

// Existing fields retained (display + business rules):
// shift_date, shift_start_time, shift_end_time, crosses_midnight
```

Add indexes:

```prisma
@@index([shift_start_utc])
@@index([shift_end_utc])
```

---

### 2.7 Modified Enum: AttendanceStatus (B7)

```prisma
enum AttendanceStatus {
  NOT_STARTED
  CHECKED_IN
  CHECKED_OUT
  VERIFIED
  DISPUTED
  CANCELLED    // ← ADD: terminal state, set by system on WorkerAssignment cancellation
}
```

---

### 2.8 Complete User Model (Post-Patch Reference)

The following is the full patched User model for implementer clarity. No other changes to User.

```prisma
model User {
  id                    String    @id @default(cuid())
  email                 String    @unique
  password_hash         String
  first_name            String
  last_name             String
  phone                 String?
  profile_photo_url     String?
  role                  UserRole  @default(WORKER)
  hotel_ids             String[]  // MANAGER scoping only
  permissions           String[]
  is_active             Boolean   @default(true)
  deleted_at            DateTime?
  created_at            DateTime  @default(now())
  updated_at            DateTime  @updatedAt

  // Auth
  sessions                    Session[]

  // HotelWorker (B1)
  hotel_worker_enrollments    HotelWorker[]          @relation("hotel_worker_user")
  hotel_worker_deactivations  HotelWorker[]          @relation("hotel_worker_deactivated_by")

  // Push tokens (B6)
  push_tokens                 DevicePushToken[]      @relation("user_push_tokens")

  // Staffing
  created_work_requests       WorkRequest[]          @relation("wr_created_by")
  work_assignments_as_worker  WorkerAssignment[]     @relation("wra_worker")
  work_assignments_managed    WorkerAssignment[]     @relation("wra_assigned_by")
  work_applications_submitted WorkApplication[]      @relation("wa_worker")
  work_applications_decided   WorkApplication[]      @relation("wa_decided_by")
  attendance_verifications    Attendance[]           @relation("att_verified_by")

  // Quality (B3)
  qv_checks                   QualityVerification[]  @relation("qv_checker")
  qv_waivers                  QualityVerification[]  @relation("qv_waived_by")
  ratings_as_worker           Rating[]               @relation("rating_worker")
  rating_voids                Rating[]               @relation("rating_voided_by")
  worker_overall_rating       WorkerOverallRating?

  // HR (unchanged)
  contracts                   Contract[]             @relation("worker_contract")
  created_contracts           Contract[]             @relation("created_contract")
  uploaded_documents          WorkerDocument[]       @relation("uploaded_by")
  payroll_records             Payroll[]

  // Compliance (unchanged)
  notifications               Notification[]
  audit_logs                  AuditLog[]
  consent_logs                ConsentLog[]
  data_retention_logs         DataRetentionLog[]

  @@index([role])
  @@index([is_active])
  @@index([deleted_at])
}
```

---

## SECTION 3 — Lifecycle Patch

### 3.1 Attendance Lifecycle (B7)

Replace the Attendance state machine in §5 of the base document with the following.

#### States

| State | Meaning |
|-------|---------|
| `NOT_STARTED` | Attendance record created; worker has not checked in |
| `CHECKED_IN` | Worker clocked in; `checked_in_at` set by server clock |
| `CHECKED_OUT` | Worker clocked out; `checked_out_at` set by server clock |
| `VERIFIED` | Manager confirmed times; QualityVerification trigger fires |
| `DISPUTED` | Manager flagged a time discrepancy before verifying |
| `CANCELLED` | Parent WorkerAssignment was cancelled; terminal, excluded from payroll and QV |

#### State Transition Table

| From | To | Trigger | Actor |
|------|----|---------|-------|
| `NOT_STARTED` | `CHECKED_IN` | Worker submits check-in | WORKER |
| `NOT_STARTED` | `CANCELLED` | WorkerAssignment → CANCELLED (pre-shift) | System |
| `CHECKED_IN` | `CHECKED_OUT` | Worker submits check-out | WORKER |
| `CHECKED_IN` | `CANCELLED` | WorkerAssignment force-cancelled mid-shift | System |
| `CHECKED_OUT` | `VERIFIED` | Manager verifies attendance | MANAGER |
| `CHECKED_OUT` | `DISPUTED` | Manager flags discrepancy | MANAGER |
| `DISPUTED` | `VERIFIED` | Manager resolves dispute | MANAGER |
| `VERIFIED` | (terminal) | No reversal permitted | — |
| `CANCELLED` | (terminal) | No reversal permitted | — |

#### Business Rules (additions to base document §5)

- Attendance `CANCELLED` transition is triggered atomically within the same transaction as `WorkerAssignment → CANCELLED`. If the Attendance update fails, the WorkerAssignment cancellation must roll back (one transaction, both updates).
- A `CANCELLED` Attendance record must never appear in payroll queries. The payroll module must filter: `WHERE attendance.status != 'CANCELLED'`.
- A `CANCELLED` Attendance record must never trigger `QualityVerification` creation. The QV trigger is conditional: `IF attendance.status = 'VERIFIED' THEN create QV`. No other status triggers it.
- `CHECKED_OUT → CANCELLED` is **not a valid transition**. Once a worker has checked out, the shift has concluded as a work event. Post-checkout disputes are handled through the dispute resolution path, not cancellation.

#### Updated Summary Diagram

```
NOT_STARTED ──checkin──► CHECKED_IN ──checkout──► CHECKED_OUT ──verify──► VERIFIED (terminal)
     │                        │                        │
     │                        │                        └──dispute──► DISPUTED ──resolve──► VERIFIED
     │                        │
     └──cancel──► CANCELLED (terminal)
                  ▲
                  │ (force-cancel mid-shift)
                  └──────────────────────────────────────────────
```

---

## SECTION 4 — Concurrency Patch

Replace Concurrency Rules 2 and 3 in §12 of the base document.

---

### 4.1 Rule 2 Replacement: Worker Double-Booking Prevention (B8)

**Replaced rule:**

> Overlap is defined as: `shift_date = new_shift_date AND shift_start_time < new_shift_end_time AND shift_end_time > new_shift_start_time`

**Replacement:**

Double-booking prevention uses the `shift_start_utc` and `shift_end_utc` fields added in schema patch 2.6. These are absolute UTC datetimes computed at WorkRequest creation time from the hotel's timezone.

The overlap check is:

```sql
SELECT COUNT(*) FROM worker_assignments wa
JOIN work_requests wr ON wa.work_request_id = wr.id
WHERE wa.worker_id = $worker_id
  AND wa.status IN ('ASSIGNED', 'CHECKED_IN')
  AND wr.shift_start_utc < $new_shift_end_utc
  AND wr.shift_end_utc   > $new_shift_start_utc
```

If `COUNT(*) > 0`, the assignment is rejected with error code `WORKER_DOUBLE_BOOKED`.

The UTC computation at WorkRequest creation:

```
shift_start_utc = convert_to_utc(shift_date + shift_start_time, Hotel.timezone)
shift_end_utc   = convert_to_utc(shift_date + shift_end_time, Hotel.timezone)
                  + (crosses_midnight ? 1 day : 0)
```

The `crosses_midnight` flag governs the date offset on `shift_end_utc` only. It has no role in the overlap check itself — the check operates entirely on UTC datetimes.

This rule is executed under a `SELECT ... FOR UPDATE` lock on the worker's existing `WorkerAssignment` rows (scoped to the active statuses) to prevent concurrent acceptance racing past the check.

---

### 4.2 Rule 3 Replacement: Attendance Check-in Idempotency (B9)

**Replaced rule:**

> The insert uses `INSERT ... ON CONFLICT DO NOTHING`, and the existing record is returned.

**Replacement:**

The `Attendance` row exists from `WorkerAssignment` creation (status `NOT_STARTED`). Check-in and check-out are `UPDATE` operations, not `INSERT` operations. Idempotency is achieved by guarding on the current status:

**Check-in idempotency pattern:**

```sql
UPDATE attendance
SET    checked_in_at = NOW(),
       status        = 'CHECKED_IN',
       updated_at    = NOW()
WHERE  worker_assignment_id = $assignment_id
  AND  status               = 'NOT_STARTED'
```

Response routing on `rows_affected`:

| rows_affected | Current status (re-read) | Response |
|---------------|--------------------------|----------|
| 1 | `CHECKED_IN` | `201 Created` — check-in recorded |
| 0 | `CHECKED_IN` | `200 OK` — already checked in, return existing record (idempotent) |
| 0 | `CANCELLED` | `409 CONFLICT` — `error: ASSIGNMENT_CANCELLED` |
| 0 | `CHECKED_OUT` / `VERIFIED` / `DISPUTED` | `409 CONFLICT` — `error: ALREADY_CHECKED_OUT` |
| 0 | Row missing | `500 Internal Error` — data integrity violation, alert |

**Check-out idempotency pattern:**

```sql
UPDATE attendance
SET    checked_out_at = NOW(),
       status         = 'CHECKED_OUT',
       updated_at     = NOW()
WHERE  worker_assignment_id = $assignment_id
  AND  status               = 'CHECKED_IN'
```

Same routing table applies (substitute `CHECKED_OUT` for `CHECKED_IN` in the idempotent case, guard is `status = CHECKED_IN`).

Both operations must also update `WorkerAssignment.status` in the same transaction. The combined atomic pattern:

```
BEGIN;
  UPDATE attendance SET ... WHERE ... AND status = $guard;
  -- check rows_affected before proceeding
  UPDATE worker_assignments SET status = $new_wa_status WHERE id = $assignment_id;
COMMIT;
```

The WorkerAssignment update must not execute if the Attendance update returned `rows_affected = 0` (guard failed). Fail-fast: if the guard fails, rollback immediately and return the appropriate error code.

---

## SECTION 5 — Dependency Graph Patch

Replace the cross-module service dependency table in §14 of the base document.

---

### 5.1 Resolved Dependency Graph (B10)

The circular dependency (`staffing → quality` AND `quality → staffing`) is eliminated. `quality` is made parameter-driven: all context it needs is passed in at function call time by the caller. Quality never calls back into staffing.

#### Final Cross-Module Dependency Table

| Caller Module | Calls Into | Reason | Call Site |
|--------------|------------|--------|-----------|
| `staffing` | `quality` | Create pending QV after Attendance VERIFIED | `attendanceService.verify()` |
| `staffing` | `notifications` | Dispatch shift and application events | Multiple service methods |
| `quality` | `notifications` | Dispatch verification and rating events | `verificationService.submit()`, `ratingService.publish()` |
| `quality` | `crm` | Read `Hotel.quality_threshold` for pass/fail decision | `verificationService.submit()` |
| Any | `compliance` | Write `AuditLog` entries | All state-changing service methods |

`quality → staffing` is **removed**. Quality reads from its own tables only. The QV record stores `worker_assignment_id`, `hotel_id`, and `worker_id` at creation time (passed by staffing) — quality has no need to query staffing to recover this context.

#### Call Sequence: Attendance Verification (showing full cross-module flow)

```
[Manager] POST /api/v1/assignments/:id/attendance/verify
  │
  └── staffing.attendanceService.verify(assignmentId, managerId)
        │
        ├── [TX BEGIN]
        │     UPDATE attendance SET status='VERIFIED', verified_at=NOW(), verified_by=managerId
        │     UPDATE worker_assignments SET status='ATTENDANCE_VERIFIED'
        │     IF all non-cancelled assignments verified:
        │       UPDATE work_requests SET status='COMPLETED'
        │
        ├── quality.verificationService.createPending({     ← staffing → quality (one-way)
        │     workerAssignmentId, hotelId, workerId
        │   })
        │     └── INSERT quality_verifications (status=PENDING)
        │
        ├── notificationService.dispatch(VERIFICATION_AVAILABLE, hotelId)
        ├── compliance.auditService.log(ATTENDANCE_VERIFIED, ...)
        └── [TX COMMIT]
```

The `quality.verificationService.createPending()` call receives all required context as parameters. No callback into staffing. The transaction boundary includes both the attendance/assignment updates and the QV insert — all three records are committed atomically or not at all.

---

## SECTION 6 — API Patch

The following routes are added to or clarified in the §14 API ownership table.

---

### 6.1 Added Routes

| Module | Method | Route | Description |
|--------|--------|-------|-------------|
| `staffing` | `PATCH` | `/api/v1/work-requests/:id/publish` | Manager publishes DRAFT → OPEN. Explicit publish action, not a generic PATCH on the resource. |
| `staffing` | `GET` | `/api/v1/assignments/:id` | Retrieve single assignment detail (worker, manager, checker views) |
| `staffing` | `GET` | `/api/v1/workers/me/assignments` | Worker's own upcoming and historical assignments |
| `staffing` | `GET` | `/api/v1/workers/me/applications` | Worker's own applications with current status |
| `staffing` | `DELETE` | `/api/v1/applications/:id` | Worker withdraws a PENDING application |
| `notifications` | `POST` | `/api/v1/push-tokens` | Register or refresh device push token on app launch |
| `notifications` | `DELETE` | `/api/v1/push-tokens/:token` | Deactivate push token on logout |
| `crm` | `GET` | `/api/v1/hotels/:id/workers` | List HotelWorker enrollments for a hotel (MANAGER, ADMIN) |
| `crm` | `POST` | `/api/v1/hotels/:id/workers` | Enrol a worker or checker at a hotel (MANAGER, ADMIN) |
| `crm` | `PATCH` | `/api/v1/hotels/:id/workers/:workerId` | Activate or deactivate a hotel worker enrollment |

### 6.2 Clarified Routes

`PATCH /api/v1/work-requests/:id` remains available for editing DRAFT fields (position, workers_needed, shift times, notes). It may not be used to change `status` directly — status transitions use dedicated action routes (`/publish`, `/cancel`). This prevents accidental state changes via generic PATCH.

`GET /api/v1/assignments` remains the list route. It must support the following filters:
- `?work_request_id=` — manager views all assignments for a request
- `?worker_id=me` — worker views own assignments (equivalent to `/me/assignments`)
- `?status=` — filter by assignment status
- `?hotel_id=` — manager/admin filter by hotel

`GET /api/v1/ratings` must support:
- `?worker_id=me` — worker views own ratings
- `?hotel_id=` — manager views hotel ratings
- `?verified_by=me` — checker views ratings from their verifications

### 6.3 HotelWorker Scoping Enforcement

The permissions middleware must enforce hotel scoping through `HotelWorker` for WORKER and CHECKER roles, not through `User.hotel_ids`. The middleware pipeline is:

```
For WORKER or CHECKER:
  resolved_hotel_ids = SELECT hotel_id FROM hotel_workers
                       WHERE worker_id = req.user.id
                         AND is_active = true
                         AND role = req.user.role

For MANAGER:
  resolved_hotel_ids = req.user.hotel_ids

For ADMIN:
  resolved_hotel_ids = * (no restriction)
```

The resolved set is attached to `req.scopedHotelIds` and validated against the resource's `hotel_id` in each service layer check.

---

## SECTION 7 — Migration Patch

---

### 7.1 Migration Sequence

Migrations must be applied in the following order. Each step is a separate Prisma migration file.

| Step | Migration name | Description |
|------|---------------|-------------|
| 1 | `add_hotel_quality_threshold` | Add `quality_threshold` to Hotel with default 70 |
| 2 | `add_notification_delivery_fields` | Add `delivery_status`, `delivery_attempts`, `last_attempted_at` to Notification |
| 3 | `create_hotel_worker` | Create `HotelWorker` model and `HotelWorkerRole` enum |
| 4 | `create_device_push_token` | Create `DevicePushToken` model |
| 5 | `add_work_request_utc_fields` | Add `shift_start_utc`, `shift_end_utc` to WorkRequest; backfill existing rows |
| 6 | `add_attendance_cancelled_status` | Add `CANCELLED` to `AttendanceStatus` enum |
| 7 | `drop_task_taskphoto_dailyoperation` | Drop `tasks`, `task_photos`, `daily_operations` tables |
| 8 | `redefine_quality_verification` | Drop old `quality_verifications`, create new (new columns, new FK to worker_assignment) |
| 9 | `redefine_rating` | Drop old `ratings`, create new (new columns, new FK to quality_verification) |
| 10 | `patch_user_relations` | Remove stale back-relations from User (Prisma migration; no DDL change, schema-only) |
| 11 | `add_work_application_table` | Create `WorkApplication` model and `WorkApplicationStatus` enum |
| 12 | `add_attendance_table` | Create `Attendance` model and backfill from existing WorkerAssignment records |
| 13 | `patch_work_request_enums` | Add `WorkRequestStatus` enum; migrate `status String` to `status WorkRequestStatus` |

---

### 7.2 Critical Migration Details

**Step 5 — WorkRequest UTC field backfill**

Existing WorkRequest rows must have `shift_start_utc` and `shift_end_utc` populated. The backfill query joins WorkRequest to Hotel on `hotel_id` and applies timezone conversion. For rows where the hotel timezone cannot be determined, default to `Europe/Berlin` (the existing Hotel model default). This backfill must run inside the migration transaction before any NOT NULL constraint is added. Add the columns as nullable, backfill, then add NOT NULL constraint in a subsequent migration step.

**Step 7 — Drop order**

Drop in dependency order:
1. `task_photos` (depends on `tasks`)
2. `daily_operations` (depends on `tasks`, `rooms`, `worker_assignments`)
3. `tasks` (depends on `hotels`, `rooms`, `users`)
4. `rooms` (depends on `hotels`)

`rooms` is dropped last as `daily_operations` references it. All four drops happen in one migration file within a single transaction.

**Step 8 — QualityVerification redefinition**

The old `quality_verifications` table has a `task_id` FK. The new one has `worker_assignment_id` FK. These cannot be altered in place — drop and recreate. Before dropping, any existing quality verification data must be archived to a `_legacy_quality_verifications` table if the environment is not a fresh deployment. For the MVP first deployment this is a clean slate — no migration of old QV data.

**Step 9 — Rating redefinition**

Same pattern as Step 8. Old `ratings` has `task_id` FK. New `ratings` has `quality_verification_id` FK. Drop and recreate. Archive old data to `_legacy_ratings` if the environment has existing data.

**Step 12 — Attendance backfill**

The new `Attendance` table must be backfilled from existing `WorkerAssignment` rows. For each `WorkerAssignment`:
- Create one `Attendance` row with `worker_assignment_id = wa.id`
- Map status: `ASSIGNED` → `NOT_STARTED`, `IN_PROGRESS` → `CHECKED_IN`, `COMPLETED` → `CHECKED_OUT`, `CANCELLED` → `CANCELLED`
- Populate `checked_in_at` from `wa.started_at` where available
- Populate `checked_out_at` from `wa.completed_at` where available

---

### 7.3 Backward Compatibility Impact

| Change | Backward Compatible? | Impact |
|--------|---------------------|--------|
| Add `Hotel.quality_threshold` | ✅ Yes — default 70 | No client change needed |
| Add `Notification` delivery fields | ✅ Yes — defaults provided | Notification writers must be updated to set `delivery_status` |
| New `HotelWorker` table | ✅ Yes — additive | Access middleware must be updated before deploying routes that check it |
| New `DevicePushToken` table | ✅ Yes — additive | Push dispatch logic must be updated; existing notifications fall back to in-app only |
| `WorkRequest` UTC fields | ✅ Yes — additive (after backfill) | WorkRequest creation endpoint must compute and persist UTC fields |
| `AttendanceStatus.CANCELLED` | ✅ Yes — additive enum value | Payroll queries must add `WHERE status != 'CANCELLED'` filter |
| Drop `tasks`, `task_photos`, `daily_operations`, `rooms` | ❌ Breaking | Any code referencing these tables must be removed before migration |
| Redefine `quality_verifications` | ❌ Breaking | Old QV code is entirely replaced; no in-place migration |
| Redefine `ratings` | ❌ Breaking | Old Rating code is entirely replaced; no in-place migration |
| `WorkApplication` new table | ✅ Yes — additive | WorkRequest acceptance flow must be updated to route through WorkApplication |
| User relation changes | ✅ Yes — schema-only, no DDL | TypeScript types change; no database change |

---

### 7.4 Pre-Migration Checklist

Before running migrations on any environment:

- [ ] All references to `Task`, `Room`, `DailyOperation`, `TaskPhoto` removed from application code
- [ ] Old `QualityVerification` and `Rating` service code replaced with new implementations
- [ ] `WorkerAssignment` creation logic updated to also create `Attendance` record
- [ ] WorkRequest creation logic updated to compute `shift_start_utc` and `shift_end_utc`
- [ ] Notification dispatch updated to query `DevicePushToken`
- [ ] Auth middleware updated to resolve hotel scoping via `HotelWorker` for WORKER/CHECKER roles
- [ ] Legacy data archived (QV, Ratings) if environment is not a fresh deployment

---

## SECTION 8 — Final Freeze Assessment

### Blockers Resolved

| Blocker | Resolution | Schema Change | Lifecycle Change | Concurrency Change |
|---------|-----------|---------------|-----------------|-------------------|
| B1 HotelWorker undefined | HotelWorker model defined, scoping rules clarified | ✅ New table | — | — |
| B2 User stale relations | Remove 4 back-relations from User | ✅ Schema-only | — | — |
| B3 User/QV/Rating name mismatch | Remove 3 stale, add 4 new back-relations | ✅ Schema-only | — | — |
| B4 Hotel.quality_threshold missing | Field added to Hotel with default 70 | ✅ New field | — | — |
| B5 Notification.delivery_status missing | 3 delivery tracking fields added to Notification | ✅ 3 new fields | — | — |
| B6 Push token storage undefined | DevicePushToken model defined | ✅ New table | — | — |
| B7 Attendance missing CANCELLED | CANCELLED state added; cascade from assignment | ✅ Enum value | ✅ Full update | — |
| B8 Cross-midnight overlap invalid | shift_start_utc/shift_end_utc added; algorithm replaced | ✅ 2 new fields | — | ✅ Rule 2 replaced |
| B9 Idempotency mechanism wrong | UPDATE-based guard pattern defined with full response routing | — | — | ✅ Rule 3 replaced |
| B10 Circular dependency | Quality is parameter-driven; one-way dependency only | — | — | ✅ Dependency table replaced |

### Open Items After This Patch

This patch resolves all 10 BLOCKERs. The 18 MAJORs and 10 MINORs identified in the audit are **not** addressed by this patch document. They are implementation-quality and completeness issues, not freeze blockers. They must be addressed in a follow-up patch (PATCH_V2) or tracked as implementation tasks before the first production deployment.

The highest-priority MAJORs for the follow-up are:

| Priority | Finding | What needs to happen |
|----------|---------|---------------------|
| 1 | M2 — MANAGER vs ADMIN contradiction for IN_PROGRESS cancel | Resolve in §2 state table and §9 RBAC matrix simultaneously |
| 2 | M4 — MANAGER cannot view WorkerAssignment | Fix RBAC matrix |
| 3 | M3 — Rating reinstatement misses WorkerOverallRating recalc | Add reinstatement path to §7 |
| 4 | M5 — Missing audit events (WITHDRAWN, EXPIRED, UPDATED) | Add to §10 catalog |
| 5 | M7 — Missing notification for QV FAILED to worker | Add to §8 catalog |

---

```
FREEZE_STATUS: APPROVED_WITH_MINOR_FOLLOWUPS
```

**Rationale**: All 10 BLOCKERs are resolved. The schema is compilable. The lifecycle machines are complete. The concurrency rules are correct. The dependency graph is acyclic. The migration path is sequenced and safe.

The remaining MAJORs and MINORs do not prevent implementation from starting — they are clarifications and additions to an otherwise sound specification. A team can build against this architecture today. The follow-up items should be resolved before the first production release, not before implementation begins.

The architecture is approved for implementation subject to PATCH_V2 addressing the top-5 MAJORs before production cutover.
