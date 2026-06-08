# WorkRequest Final Architecture

**Version**: 1.0.0 — Authoritative  
**Date**: 2026-06-07  
**Status**: FROZEN — This document supersedes all prior WorkRequest/Staffing design documents  
**Scope**: MVP hospitality workforce marketplace  

---

## Frozen Architecture Decisions

The following domains are locked and must not be modified:

- **Auth** — User, Session, JWT, RBAC
- **Hotels** — Hotel model, hotel-scoped access control
- **Hotel Worker Management** — HotelWorker linking, contracts, documents, payroll

The following are **removed from MVP** and must not be referenced in implementation:

- Rooms (`Room` table)
- Tasks (`Task`, `TaskPhoto` tables)
- DailyOperation (`DailyOperation` table)

The quality verification and rating flows in the old schema were anchored to `Task`. This document re-anchors them to `WorkerAssignment`.

---

## 1. Final Domain Model

### Aggregate Roots

| Aggregate | Description | Owner Module |
|-----------|-------------|--------------|
| `User` | Auth identity + role | `auth` |
| `Hotel` | Property entity | `crm` |
| `HotelWorker` | Worker–hotel link | `crm` |
| `WorkRequest` | Shift/staffing need | `staffing` |
| `WorkApplication` | Worker interest signal | `staffing` |
| `WorkerAssignment` | Confirmed booking | `staffing` |
| `Attendance` | Check-in / check-out record | `staffing` |
| `QualityVerification` | Checker's work review | `quality` |
| `Rating` | Score applied to worker | `quality` |
| `WorkerOverallRating` | Aggregate worker score | `quality` |

### Supporting Entities (Frozen)

| Entity | Module | Notes |
|--------|--------|-------|
| `Session` | `auth` | JWT refresh tokens |
| `Contract` | `hr` | Worker contracts |
| `ContractTemplate` | `hr` | Per-hotel template |
| `ContractLineItem` | `hr` | Contract salary lines |
| `WorkerDocument` | `hr` | Passports, permits |
| `RequiredDocument` | `hr` | Per-hotel document policy |
| `Payroll` | `hr` | Payroll records |
| `PayrollLineItem` | `hr` | Payroll line items |
| `DataRetentionLog` | `hr` | GDPR deletion tracking |
| `Notification` | `notifications` | Push/in-app messages |
| `AuditLog` | `compliance` | Immutable event trail |
| `ConsentLog` | `compliance` | GDPR consent records |

### Relationship Summary

```
Hotel
  └── WorkRequest (many)
        └── WorkApplication (many) ← Worker
        └── WorkerAssignment (many) ← Worker
              └── Attendance (one)
              └── QualityVerification (one) ← Checker
                    └── Rating (one) → Worker
```

---

## 2. WorkRequest Lifecycle

A WorkRequest is a published staffing need for a hotel shift. Managers create it; workers apply to it.

### States

| State | Meaning |
|-------|---------|
| `DRAFT` | Created but not yet visible to workers |
| `OPEN` | Published; workers can submit applications |
| `PARTIALLY_FILLED` | Some workers accepted, fewer than `workers_needed` |
| `FILLED` | All `workers_needed` slots confirmed |
| `IN_PROGRESS` | Shift has started; at least one worker has checked in |
| `COMPLETED` | Shift ended; all assignments attendance-verified |
| `CANCELLED` | Permanently closed by manager or system |

### State Transition Table

| From | To | Trigger | Actor |
|------|----|---------|-------|
| `DRAFT` | `OPEN` | Manager publishes | MANAGER |
| `DRAFT` | `CANCELLED` | Manager discards draft | MANAGER |
| `OPEN` | `PARTIALLY_FILLED` | Manager accepts application; accepted_count < workers_needed | System |
| `OPEN` | `FILLED` | Manager accepts application; accepted_count = workers_needed | System |
| `OPEN` | `CANCELLED` | Manager cancels | MANAGER |
| `PARTIALLY_FILLED` | `FILLED` | Manager accepts application; accepted_count = workers_needed | System |
| `PARTIALLY_FILLED` | `CANCELLED` | Manager cancels | MANAGER |
| `FILLED` | `IN_PROGRESS` | First WorkerAssignment transitions to `CHECKED_IN` | System |
| `FILLED` | `CANCELLED` | Manager cancels (all assignments also cancelled) | MANAGER |
| `IN_PROGRESS` | `COMPLETED` | All WorkerAssignments reach `ATTENDANCE_VERIFIED` | System |
| `IN_PROGRESS` | `CANCELLED` | Manager cancels (exceptional; requires admin role) | ADMIN |

### Business Rules

- `workers_needed` must be ≥ 1.
- `shift_date` must be a future date at time of creation.
- `shift_end_time` must be later than `shift_start_time` (cross-midnight shifts allowed with explicit `crosses_midnight` flag).
- A WorkRequest in `COMPLETED` or `CANCELLED` state is terminal and immutable.
- Only hotels in the manager's `hotel_ids` can be targeted.
- Cancellation of a `FILLED` or `IN_PROGRESS` request triggers immediate notifications to all assigned workers.

---

## 3. WorkApplication Lifecycle

A WorkApplication is a worker's expression of interest in a WorkRequest. It is sometimes called "clicking Interested."

### States

| State | Meaning |
|-------|---------|
| `PENDING` | Worker applied; awaiting manager review |
| `ACCEPTED` | Manager selected this worker |
| `REJECTED` | Manager passed on this worker |
| `WITHDRAWN` | Worker withdrew their own application |
| `EXPIRED` | WorkRequest was filled or cancelled before decision |

### State Transition Table

| From | To | Trigger | Actor |
|------|----|---------|-------|
| — | `PENDING` | Worker submits application | WORKER |
| `PENDING` | `ACCEPTED` | Manager selects worker | MANAGER |
| `PENDING` | `REJECTED` | Manager rejects worker | MANAGER |
| `PENDING` | `WITHDRAWN` | Worker withdraws | WORKER |
| `PENDING` | `EXPIRED` | WorkRequest reaches `FILLED` or `CANCELLED` | System |
| `REJECTED` | `PENDING` | (not permitted) | — |
| `ACCEPTED` | (terminal) | No reversal | — |

### Business Rules

- A worker may submit at most one application per WorkRequest (enforced by unique constraint on `[work_request_id, worker_id]`).
- A worker cannot apply to a WorkRequest in `FILLED`, `IN_PROGRESS`, `COMPLETED`, or `CANCELLED` state.
- A worker can only apply if they are linked to the hotel via `HotelWorker` with `is_active = true`.
- When a worker is `ACCEPTED`, a `WorkerAssignment` is immediately created by the system.
- All remaining `PENDING` applications for a WorkRequest that just reached `FILLED` are automatically set to `EXPIRED`.
- Workers receive a notification when their application is accepted or rejected.

---

## 4. WorkerAssignment Lifecycle

A WorkerAssignment is the confirmed record binding a worker to a WorkRequest shift. It is created by the system upon acceptance of a WorkApplication.

### States

| State | Meaning |
|-------|---------|
| `ASSIGNED` | Confirmed; shift has not yet started |
| `CHECKED_IN` | Worker has checked in for the shift |
| `CHECKED_OUT` | Worker has checked out; work done |
| `ATTENDANCE_VERIFIED` | Manager has verified the check-in/check-out times |
| `CANCELLED` | Assignment voided before or during shift |

### State Transition Table

| From | To | Trigger | Actor |
|------|----|---------|-------|
| — | `ASSIGNED` | WorkApplication accepted | System |
| `ASSIGNED` | `CHECKED_IN` | Worker checks in | WORKER |
| `ASSIGNED` | `CANCELLED` | WorkRequest cancelled or manager removes worker | MANAGER / System |
| `CHECKED_IN` | `CHECKED_OUT` | Worker checks out | WORKER |
| `CHECKED_IN` | `CANCELLED` | Manager force-cancels mid-shift (exceptional) | MANAGER |
| `CHECKED_OUT` | `ATTENDANCE_VERIFIED` | Manager verifies attendance | MANAGER |
| `ATTENDANCE_VERIFIED` | (terminal) | No reversal | — |
| `CANCELLED` | (terminal) | No reversal | — |

### Business Rules

- A worker may not have more than one `ASSIGNED` or `CHECKED_IN` assignment for overlapping time windows at the same hotel. Overlapping is defined as shift dates and times overlapping.
- Check-in is only permitted within 30 minutes before `shift_start_time`. Check-in after `shift_end_time` is rejected.
- Check-out is only permitted after `shift_start_time`. Check-out before `shift_start_time` is rejected.
- Check-in and check-out are recorded as UTC timestamps in the `Attendance` record.
- When all `WorkerAssignment` records for a `WorkRequest` reach `ATTENDANCE_VERIFIED`, the system sets the `WorkRequest` to `COMPLETED`.
- Cancellation of an `ASSIGNED` assignment creates an `AuditLog` entry with reason.

---

## 5. Attendance Lifecycle

Attendance is a one-to-one child of `WorkerAssignment`. It records the actual times a worker was present.

### States

| State | Meaning |
|-------|---------|
| `NOT_STARTED` | Assignment exists; no check-in yet |
| `CHECKED_IN` | Worker clocked in |
| `CHECKED_OUT` | Worker clocked out |
| `VERIFIED` | Manager confirmed the times |
| `DISPUTED` | Manager flagged a discrepancy |

### State Transition Table

| From | To | Trigger | Actor |
|------|----|---------|-------|
| `NOT_STARTED` | `CHECKED_IN` | Worker submits check-in | WORKER |
| `CHECKED_IN` | `CHECKED_OUT` | Worker submits check-out | WORKER |
| `CHECKED_OUT` | `VERIFIED` | Manager verifies | MANAGER |
| `CHECKED_OUT` | `DISPUTED` | Manager flags discrepancy | MANAGER |
| `DISPUTED` | `VERIFIED` | Manager resolves dispute | MANAGER |

### Business Rules

- The `Attendance` record is created automatically (status `NOT_STARTED`) when the `WorkerAssignment` is created.
- `checked_in_at` is set from the server clock at the moment the request is processed, not from client-submitted time.
- `checked_out_at` is set from the server clock at the moment the request is processed.
- Manager may override `checked_in_at` and `checked_out_at` during verification; overrides are recorded in `AuditLog`.
- Total hours worked is computed as `(checked_out_at - checked_in_at)` in hours, stored as a computed column or derived at query time — it is never stored as editable input.
- A `VERIFIED` Attendance record triggers the creation of a `QualityVerification` record if one does not already exist for the assignment.

---

## 6. QualityVerification Lifecycle

A QualityVerification is the checker's formal review of work done during a WorkerAssignment. It is created by the system when attendance is verified.

### States

| State | Meaning |
|-------|---------|
| `PENDING` | Verification task created; not yet started |
| `IN_PROGRESS` | Checker has opened the review |
| `PASSED` | Score meets or exceeds hotel passing threshold |
| `FAILED` | Score is below hotel passing threshold |
| `WAIVED` | Manager or admin waived verification (e.g., no checker available) |

### State Transition Table

| From | To | Trigger | Actor |
|------|----|---------|-------|
| — | `PENDING` | Attendance verified | System |
| `PENDING` | `IN_PROGRESS` | Checker begins review | CHECKER |
| `IN_PROGRESS` | `PASSED` | Checker submits score ≥ threshold | CHECKER |
| `IN_PROGRESS` | `FAILED` | Checker submits score < threshold | CHECKER |
| `PENDING` | `WAIVED` | Manager/Admin waives | MANAGER / ADMIN |
| `IN_PROGRESS` | `WAIVED` | Manager/Admin waives | MANAGER / ADMIN |
| `PASSED` | (terminal) | — | — |
| `FAILED` | (terminal) | — | — |
| `WAIVED` | (terminal) | — | — |

### Business Rules

- A `QualityVerification` is created with status `PENDING` and no checker assigned. Any active CHECKER at the same hotel may claim it.
- Score is an integer in the range 0–100.
- The passing threshold is configurable per hotel (`Hotel.quality_threshold`, default 70).
- A checker may not verify an assignment for a worker who is also a checker (no self-verification possible by role).
- A checker may not verify their own hotel's assignments if they are also a HotelWorker there (conflict of interest); this rule is enforced at the service layer.
- When a `QualityVerification` reaches terminal state (`PASSED`, `FAILED`, `WAIVED`), the system creates a `Rating` record.
- `photos` (stored as URLs in DO Spaces) may be attached to the verification record during `IN_PROGRESS`.

---

## 7. Rating Lifecycle

A Rating is the numerical score applied to a worker following a QualityVerification. The system creates it automatically; no actor creates it manually.

### States

| State | Meaning |
|-------|---------|
| `PENDING` | Created by system; awaiting finalization |
| `PUBLISHED` | Score applied to worker's overall rating |
| `VOIDED` | Admin has voided the rating (disputed or erroneous) |

### State Transition Table

| From | To | Trigger | Actor |
|------|----|---------|-------|
| — | `PENDING` | QualityVerification reaches terminal state | System |
| `PENDING` | `PUBLISHED` | System publishes and updates WorkerOverallRating | System |
| `PUBLISHED` | `VOIDED` | Admin voids (with mandatory reason) | ADMIN |
| `VOIDED` | `PUBLISHED` | Admin reinstates | ADMIN |

### Score Mapping

| QV Score (0–100) | Rating Stars (1–5) |
|------------------|--------------------|
| 0–19 | 1 |
| 20–39 | 2 |
| 40–59 | 3 |
| 60–79 | 4 |
| 80–100 | 5 |

If `QualityVerification` was `WAIVED`, the rating score is `null` and status goes directly to `PUBLISHED` with `is_waived = true`. Waived ratings are excluded from `WorkerOverallRating` calculations.

### WorkerOverallRating Update

When a `Rating` is `PUBLISHED`:
1. System calculates new `average_score = (sum of all published non-waived scores) / count`.
2. `WorkerOverallRating.average_score` and `total_ratings` are updated atomically in the same transaction.

---

## 8. Notifications

All notifications are persisted to the `Notification` table and delivered via push (Expo) to the relevant mobile app.

### Notification Event Catalog

| Event | Trigger | Recipients | Channel |
|-------|---------|-----------|---------|
| `WORK_REQUEST_PUBLISHED` | WorkRequest → `OPEN` | All active workers linked to the hotel | Push + In-app |
| `WORK_REQUEST_CANCELLED` | WorkRequest → `CANCELLED` | All workers with `ASSIGNED` or `CHECKED_IN` assignments | Push + In-app |
| `APPLICATION_ACCEPTED` | WorkApplication → `ACCEPTED` | Applicant worker | Push + In-app |
| `APPLICATION_REJECTED` | WorkApplication → `REJECTED` | Applicant worker | In-app |
| `APPLICATION_EXPIRED` | WorkApplication → `EXPIRED` | Applicant worker | In-app |
| `ASSIGNMENT_CANCELLED` | WorkerAssignment → `CANCELLED` | Assigned worker | Push + In-app |
| `CHECKIN_REMINDER` | 30 min before `shift_start_time` | Workers with `ASSIGNED` status | Push |
| `CHECKOUT_REMINDER` | At `shift_end_time` if still `CHECKED_IN` | Workers still checked in | Push |
| `ATTENDANCE_VERIFIED` | Attendance → `VERIFIED` | Worker | In-app |
| `VERIFICATION_AVAILABLE` | QualityVerification → `PENDING` | All active CHECKERs at the hotel | Push + In-app |
| `RATING_PUBLISHED` | Rating → `PUBLISHED` | Worker | Push + In-app |

### Delivery Rules

- Notifications are dispatched asynchronously via a notification service after the database transaction commits.
- Failed push deliveries are retried up to 3 times with exponential backoff (5s, 25s, 125s).
- If all retries fail, the `Notification` record is kept with `delivery_status = 'FAILED'` for audit.
- Workers without a registered push token receive in-app notifications only.
- `CHECKIN_REMINDER` and `CHECKOUT_REMINDER` are scheduled tasks, not event-driven.

---

## 9. RBAC

### Role Definitions

| Role | Primary App | Description |
|------|-------------|-------------|
| `WORKER` | Mobile (worker-app) | Hotel staff who fill shifts |
| `CHECKER` | Mobile (checker-app) | Quality inspectors |
| `MANAGER` | Web frontend | Hotel operators who post requirements |
| `ADMIN` | Web frontend | Platform administrators |

### Permission Matrix

| Action | WORKER | CHECKER | MANAGER | ADMIN |
|--------|--------|---------|---------|-------|
| View WorkRequests for their hotel | ✅ | ✅ | ✅ | ✅ |
| Create WorkRequest | ❌ | ❌ | ✅ (own hotels) | ✅ |
| Publish WorkRequest | ❌ | ❌ | ✅ (own hotels) | ✅ |
| Cancel WorkRequest | ❌ | ❌ | ✅ (own hotels) | ✅ |
| Submit WorkApplication | ✅ (own) | ❌ | ❌ | ❌ |
| Withdraw WorkApplication | ✅ (own) | ❌ | ❌ | ❌ |
| View WorkApplications | ❌ | ❌ | ✅ (own hotels) | ✅ |
| Accept/Reject WorkApplication | ❌ | ❌ | ✅ (own hotels) | ✅ |
| View own WorkerAssignment | ✅ | ❌ | ❌ | ✅ |
| Check in | ✅ (own) | ❌ | ❌ | ❌ |
| Check out | ✅ (own) | ❌ | ❌ | ❌ |
| Verify attendance | ❌ | ❌ | ✅ (own hotels) | ✅ |
| Dispute attendance | ❌ | ❌ | ✅ (own hotels) | ✅ |
| Claim QualityVerification | ❌ | ✅ (own hotels) | ❌ | ✅ |
| Submit QualityVerification score | ❌ | ✅ (own hotels) | ❌ | ✅ |
| Waive QualityVerification | ❌ | ❌ | ✅ (own hotels) | ✅ |
| View Ratings | ✅ (own) | ✅ (verified by them) | ✅ (own hotels) | ✅ |
| Void Rating | ❌ | ❌ | ❌ | ✅ |
| View Notifications | ✅ (own) | ✅ (own) | ✅ (own) | ✅ |
| View AuditLog | ❌ | ❌ | ✅ (own hotels, limited) | ✅ (full) |

### Hotel Scoping Rule

Every `MANAGER` action is scoped to `Hotel.id ∈ user.hotel_ids`. Any request targeting a hotel not in the manager's `hotel_ids` returns `403 FORBIDDEN`. This check is performed in the `permissions` middleware before business logic runs.

Every `CHECKER` action is scoped to hotels where they have an active `HotelWorker` record with role `CHECKER`.

Every `WORKER` action is scoped to hotels where they have an active `HotelWorker` record with role `WORKER`.

---

## 10. Audit Events

The `AuditLog` table records all sensitive or state-changing operations. Audit entries are immutable — they are never updated or deleted.

### Mandatory Audit Events

| Action Code | Trigger | Resource Type |
|-------------|---------|---------------|
| `WORK_REQUEST_CREATED` | WorkRequest created | `WORK_REQUEST` |
| `WORK_REQUEST_PUBLISHED` | WorkRequest → OPEN | `WORK_REQUEST` |
| `WORK_REQUEST_CANCELLED` | WorkRequest → CANCELLED | `WORK_REQUEST` |
| `WORK_APPLICATION_SUBMITTED` | WorkApplication created | `WORK_APPLICATION` |
| `WORK_APPLICATION_ACCEPTED` | WorkApplication → ACCEPTED | `WORK_APPLICATION` |
| `WORK_APPLICATION_REJECTED` | WorkApplication → REJECTED | `WORK_APPLICATION` |
| `WORKER_ASSIGNMENT_CREATED` | WorkerAssignment created | `WORKER_ASSIGNMENT` |
| `WORKER_ASSIGNMENT_CANCELLED` | WorkerAssignment → CANCELLED | `WORKER_ASSIGNMENT` |
| `ATTENDANCE_CHECKIN` | Attendance → CHECKED_IN | `ATTENDANCE` |
| `ATTENDANCE_CHECKOUT` | Attendance → CHECKED_OUT | `ATTENDANCE` |
| `ATTENDANCE_VERIFIED` | Attendance → VERIFIED | `ATTENDANCE` |
| `ATTENDANCE_DISPUTED` | Attendance → DISPUTED | `ATTENDANCE` |
| `ATTENDANCE_OVERRIDE` | Manager overrides time | `ATTENDANCE` |
| `QUALITY_VERIFICATION_STARTED` | QualityVerification → IN_PROGRESS | `QUALITY_VERIFICATION` |
| `QUALITY_VERIFICATION_SUBMITTED` | QualityVerification → PASSED/FAILED | `QUALITY_VERIFICATION` |
| `QUALITY_VERIFICATION_WAIVED` | QualityVerification → WAIVED | `QUALITY_VERIFICATION` |
| `RATING_PUBLISHED` | Rating → PUBLISHED | `RATING` |
| `RATING_VOIDED` | Rating → VOIDED | `RATING` |
| `RATING_REINSTATED` | Rating → PUBLISHED from VOIDED | `RATING` |

### AuditLog Fields

| Field | Type | Description |
|-------|------|-------------|
| `id` | cuid | Primary key |
| `actor_id` | String? | User performing action (null for System) |
| `actor_role` | String? | Role at time of action |
| `action` | String | One of the action codes above |
| `resource_id` | String | ID of the affected record |
| `resource_type` | String | Table/entity name |
| `details` | Json? | State before/after, reason, IP, etc. |
| `ip_address` | String? | Client IP |
| `timestamp` | DateTime | Server UTC clock |

---

## 11. State Transition Tables (Summary)

### WorkRequest

```
DRAFT ──publish──► OPEN ──accept(partial)──► PARTIALLY_FILLED ──accept(full)──► FILLED ──checkin──► IN_PROGRESS ──all_verified──► COMPLETED
  │                 │                              │                                │
  └──cancel──► CANCELLED ◄──────────────cancel─────┘                 cancel────────┘
```

### WorkApplication

```
(new) ──submit──► PENDING ──accept──► ACCEPTED (terminal)
                     │
                     ├──reject──► REJECTED (terminal)
                     ├──withdraw──► WITHDRAWN (terminal)
                     └──expire──► EXPIRED (terminal)
```

### WorkerAssignment

```
(new) ──system──► ASSIGNED ──checkin──► CHECKED_IN ──checkout──► CHECKED_OUT ──verify──► ATTENDANCE_VERIFIED (terminal)
                      │                     │
                      └──cancel──► CANCELLED (terminal)
                                   │
                      ─────────────┘
```

### Attendance

```
NOT_STARTED ──checkin──► CHECKED_IN ──checkout──► CHECKED_OUT ──verify──► VERIFIED (terminal)
                                                        │
                                                        └──dispute──► DISPUTED ──resolve──► VERIFIED
```

### QualityVerification

```
(new) ──system──► PENDING ──claim──► IN_PROGRESS ──score≥threshold──► PASSED (terminal)
                     │                   │
                     │                   └──score<threshold──► FAILED (terminal)
                     └──waive──► WAIVED (terminal)
                  IN_PROGRESS ──waive──► WAIVED (terminal)
```

### Rating

```
(new) ──system──► PENDING ──publish──► PUBLISHED ──void──► VOIDED
                                           ▲                  │
                                           └──reinstate────────┘
```

---

## 12. Concurrency Rules

### Rule 1: WorkRequest Slot Acceptance (Optimistic Locking)

When a manager accepts a `WorkApplication`, the system must prevent over-booking (accepting more workers than `workers_needed`).

**Implementation**: Use a database-level advisory lock or `SELECT FOR UPDATE` on the `WorkRequest` row when counting accepted assignments. The acceptance check and the `WorkApplication` update must occur in the same transaction.

```
BEGIN;
  SELECT * FROM work_requests WHERE id = $id FOR UPDATE;
  current_count = SELECT COUNT(*) FROM worker_assignments
                  WHERE work_request_id = $id AND status NOT IN ('CANCELLED');
  IF current_count >= workers_needed THEN ROLLBACK; RAISE 'SLOTS_FULL';
  UPDATE work_applications SET status = 'ACCEPTED' WHERE id = $app_id;
  INSERT INTO worker_assignments ...;
  IF current_count + 1 = workers_needed THEN
    UPDATE work_requests SET status = 'FILLED';
  ELSE
    UPDATE work_requests SET status = 'PARTIALLY_FILLED';
  END IF;
COMMIT;
```

### Rule 2: Worker Double-Booking Prevention

A worker may not be assigned to two shifts with overlapping time windows at the same hotel.

**Implementation**: Before creating a `WorkerAssignment`, query for any `WorkerAssignment` with status `ASSIGNED` or `CHECKED_IN` where the time windows overlap. This check is performed under a row-level lock on the worker's existing assignments.

Overlap is defined as: `shift_date = new_shift_date AND shift_start_time < new_shift_end_time AND shift_end_time > new_shift_start_time`.

### Rule 3: Attendance Idempotency

Check-in and check-out operations are idempotent. If a worker submits a check-in twice (e.g., network retry), the second call returns `200 OK` with the existing `Attendance` record rather than erroring. The timestamp is not overwritten on the second call.

**Implementation**: Use a unique constraint on `attendance.worker_assignment_id`. The insert uses `INSERT ... ON CONFLICT DO NOTHING`, and the existing record is returned.

### Rule 4: QualityVerification Claiming

Multiple checkers may attempt to claim the same `PENDING` verification simultaneously.

**Implementation**: The claim update is an atomic `UPDATE quality_verifications SET status = 'IN_PROGRESS', checker_id = $checker_id WHERE id = $id AND status = 'PENDING'`. If `rows_affected = 0`, the verification is already claimed; return `409 CONFLICT`.

### Rule 5: Rating Publication

Rating publication and `WorkerOverallRating` update are atomic. Both happen in the same transaction using a `SELECT FOR UPDATE` on the `WorkerOverallRating` row.

---

## 13. Database Schema

The following schema replaces the staffing and quality portions of the existing schema. Auth, Hotel, HR, and compliance tables remain as-is (frozen).

### Removed Tables

The following tables from the old schema are **dropped**:
- `rooms`
- `tasks`
- `task_photos`
- `daily_operations`

The `quality_verifications` and `ratings` tables are redefined below. The `worker_overall_ratings` table is retained with no changes.

### New / Replaced Tables

```sql
-- ============================================
-- STAFFING MODULE
-- ============================================

model WorkRequest {
  id                    String             @id @default(cuid())
  hotel_id              String
  hotel                 Hotel              @relation(fields: [hotel_id], references: [id], onDelete: Restrict)
  created_by_manager_id String
  created_by            User               @relation("wr_created_by", fields: [created_by_manager_id], references: [id])
  position              String             -- "cleaner", "housekeeper", "porter", "waitstaff"
  workers_needed        Int
  shift_date            DateTime           -- date only (UTC midnight)
  shift_start_time      String             -- HH:MM (local hotel time)
  shift_end_time        String             -- HH:MM (local hotel time)
  crosses_midnight      Boolean            @default(false)
  notes                 String?
  status                WorkRequestStatus  @default(DRAFT)
  published_at          DateTime?
  filled_at             DateTime?
  completed_at          DateTime?
  cancelled_at          DateTime?
  cancellation_reason   String?
  created_at            DateTime           @default(now())
  updated_at            DateTime           @updatedAt

  applications          WorkApplication[]
  assignments           WorkerAssignment[]

  @@index([hotel_id])
  @@index([status])
  @@index([shift_date])
  @@index([created_by_manager_id])
}

enum WorkRequestStatus {
  DRAFT
  OPEN
  PARTIALLY_FILLED
  FILLED
  IN_PROGRESS
  COMPLETED
  CANCELLED
}

model WorkApplication {
  id              String                @id @default(cuid())
  work_request_id String
  work_request    WorkRequest           @relation(fields: [work_request_id], references: [id], onDelete: Cascade)
  worker_id       String
  worker          User                  @relation("wa_worker", fields: [worker_id], references: [id], onDelete: Restrict)
  status          WorkApplicationStatus @default(PENDING)
  applied_at      DateTime              @default(now())
  decided_at      DateTime?             -- when manager acted
  decided_by_id   String?               -- manager who accepted/rejected
  decided_by      User?                 @relation("wa_decided_by", fields: [decided_by_id], references: [id])
  note            String?               -- worker's optional note
  rejection_reason String?              -- manager's optional rejection reason
  updated_at      DateTime              @updatedAt

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
  EXPIRED
}

model WorkerAssignment {
  id                     String                 @id @default(cuid())
  work_request_id        String
  work_request           WorkRequest            @relation(fields: [work_request_id], references: [id], onDelete: Restrict)
  worker_id              String
  worker                 User                   @relation("wra_worker", fields: [worker_id], references: [id], onDelete: Restrict)
  application_id         String                 @unique
  application            WorkApplication        @relation(fields: [application_id], references: [id])
  assigned_by_manager_id String
  assigned_by            User                   @relation("wra_assigned_by", fields: [assigned_by_manager_id], references: [id])
  status                 WorkerAssignmentStatus @default(ASSIGNED)
  assigned_at            DateTime               @default(now())
  cancelled_at           DateTime?
  cancellation_reason    String?
  updated_at             DateTime               @updatedAt

  attendance             Attendance?
  quality_verification   QualityVerification?

  @@index([work_request_id])
  @@index([worker_id])
  @@index([status])
}

enum WorkerAssignmentStatus {
  ASSIGNED
  CHECKED_IN
  CHECKED_OUT
  ATTENDANCE_VERIFIED
  CANCELLED
}

model Attendance {
  id                       String           @id @default(cuid())
  worker_assignment_id     String           @unique
  worker_assignment        WorkerAssignment @relation(fields: [worker_assignment_id], references: [id], onDelete: Cascade)
  status                   AttendanceStatus @default(NOT_STARTED)
  checked_in_at            DateTime?        -- server UTC clock
  checked_out_at           DateTime?        -- server UTC clock
  verified_at              DateTime?
  verified_by_manager_id   String?
  verified_by              User?            @relation("att_verified_by", fields: [verified_by_manager_id], references: [id])
  override_reason          String?          -- if manager overrides times
  dispute_reason           String?
  created_at               DateTime         @default(now())
  updated_at               DateTime         @updatedAt

  @@index([status])
}

enum AttendanceStatus {
  NOT_STARTED
  CHECKED_IN
  CHECKED_OUT
  VERIFIED
  DISPUTED
}

-- ============================================
-- QUALITY MODULE (redefined)
-- ============================================

model QualityVerification {
  id                       String                      @id @default(cuid())
  worker_assignment_id     String                      @unique
  worker_assignment        WorkerAssignment            @relation(fields: [worker_assignment_id], references: [id], onDelete: Restrict)
  hotel_id                 String
  hotel                    Hotel                       @relation(fields: [hotel_id], references: [id], onDelete: Restrict)
  checker_id               String?                     -- null until claimed
  checker                  User?                       @relation("qv_checker", fields: [checker_id], references: [id])
  status                   QualityVerificationStatus   @default(PENDING)
  score                    Int?                        -- 0–100; null until submitted
  notes                    String?
  photo_urls               String[]                    -- DO Spaces URLs
  waived_by_id             String?
  waived_by                User?                       @relation("qv_waived_by", fields: [waived_by_id], references: [id])
  waiver_reason            String?
  started_at               DateTime?
  submitted_at             DateTime?
  created_at               DateTime                    @default(now())
  updated_at               DateTime                    @updatedAt

  rating                   Rating?

  @@index([hotel_id])
  @@index([checker_id])
  @@index([status])
}

enum QualityVerificationStatus {
  PENDING
  IN_PROGRESS
  PASSED
  FAILED
  WAIVED
}

model Rating {
  id                        String       @id @default(cuid())
  quality_verification_id   String       @unique
  quality_verification      QualityVerification @relation(fields: [quality_verification_id], references: [id], onDelete: Restrict)
  worker_id                 String
  worker                    User         @relation("rating_worker", fields: [worker_id], references: [id], onDelete: Restrict)
  hotel_id                  String
  hotel                     Hotel        @relation(fields: [hotel_id], references: [id], onDelete: Restrict)
  stars                     Int?         -- 1–5; null if waived
  raw_score                 Int?         -- original QV score 0–100
  is_waived                 Boolean      @default(false)
  status                    RatingStatus @default(PENDING)
  voided_by_id              String?
  voided_by                 User?        @relation("rating_voided_by", fields: [voided_by_id], references: [id])
  void_reason               String?
  published_at              DateTime?
  created_at                DateTime     @default(now())
  updated_at                DateTime     @updatedAt

  @@index([worker_id])
  @@index([hotel_id])
  @@index([status])
}

enum RatingStatus {
  PENDING
  PUBLISHED
  VOIDED
}

-- WorkerOverallRating — unchanged from existing schema
model WorkerOverallRating {
  id            String   @id @default(cuid())
  worker_id     String   @unique
  worker        User     @relation(fields: [worker_id], references: [id], onDelete: Restrict)
  average_score Float
  total_ratings Int      @default(0)
  updated_at    DateTime @updatedAt

  @@index([worker_id])
}
```

### Notification Type Additions

The existing `Notification.type` field accepts additional values for the new workflow:

```
WORK_REQUEST_PUBLISHED
WORK_REQUEST_CANCELLED
APPLICATION_ACCEPTED
APPLICATION_REJECTED
APPLICATION_EXPIRED
ASSIGNMENT_CANCELLED
CHECKIN_REMINDER
CHECKOUT_REMINDER
ATTENDANCE_VERIFIED
VERIFICATION_AVAILABLE
RATING_PUBLISHED
```

---

## 14. API Ownership Boundaries

Each module owns its routes exclusively. Cross-module data is accessed via service imports (in-process), never via HTTP between modules.

### Module → Route Ownership

| Module | Route Prefix | Owns |
|--------|-------------|------|
| `auth` | `/api/v1/auth` | Login, logout, refresh token, me |
| `crm` | `/api/v1/hotels` | CRUD hotels |
| `crm` | `/api/v1/hotels/:hotelId/workers` | List/add/remove hotel workers |
| `staffing` | `/api/v1/work-requests` | CRUD work requests |
| `staffing` | `/api/v1/work-requests/:id/applications` | List applications for a request |
| `staffing` | `/api/v1/applications` | Worker submits/withdraws application |
| `staffing` | `/api/v1/applications/:id/accept` | Manager accepts application |
| `staffing` | `/api/v1/applications/:id/reject` | Manager rejects application |
| `staffing` | `/api/v1/assignments` | List assignments |
| `staffing` | `/api/v1/assignments/:id/checkin` | Worker checks in |
| `staffing` | `/api/v1/assignments/:id/checkout` | Worker checks out |
| `staffing` | `/api/v1/assignments/:id/attendance/verify` | Manager verifies attendance |
| `staffing` | `/api/v1/assignments/:id/attendance/dispute` | Manager disputes attendance |
| `quality` | `/api/v1/verifications` | List pending verifications (checker) |
| `quality` | `/api/v1/verifications/:id/claim` | Checker claims verification |
| `quality` | `/api/v1/verifications/:id/submit` | Checker submits score |
| `quality` | `/api/v1/verifications/:id/waive` | Manager/Admin waives verification |
| `quality` | `/api/v1/ratings` | List ratings |
| `quality` | `/api/v1/ratings/:id/void` | Admin voids rating |
| `notifications` | `/api/v1/notifications` | List + mark read |
| `hr` | `/api/v1/workers/:id/contracts` | Contract management |
| `hr` | `/api/v1/workers/:id/documents` | Document management |
| `hr` | `/api/v1/workers/:id/payroll` | Payroll records |

### Cross-Module Service Dependencies

| Caller Module | Calls Into | Reason |
|--------------|------------|--------|
| `staffing` | `crm` | Validate hotel membership on application |
| `staffing` | `notifications` | Dispatch events after state transitions |
| `quality` | `staffing` | Fetch assignment context for verification |
| `quality` | `notifications` | Dispatch verification/rating events |
| `quality` | `crm` | Read hotel quality threshold |
| Any | `compliance` | Write AuditLog entries |

Cross-module calls use direct TypeScript function imports. No HTTP calls between modules.

---

## 15. Final MVP Workflow

This section describes the complete end-to-end journey for a single shift.

### Step 1 — Manager Creates Work Requirement

**Actor**: MANAGER  
**Interface**: Web frontend  
**API**: `POST /api/v1/work-requests`

Manager selects hotel, position, date, shift times, and number of workers needed. WorkRequest is created in `DRAFT` state. Manager reviews and publishes.

**API**: `PATCH /api/v1/work-requests/:id` with `{ status: "OPEN" }`

WorkRequest transitions to `OPEN`. System dispatches `WORK_REQUEST_PUBLISHED` notification to all active workers linked to the hotel.

---

### Step 2 — Workers Receive Notification and Click Interested

**Actor**: WORKER  
**Interface**: Mobile (worker-app)  
**API**: `POST /api/v1/applications` with `{ work_request_id }`

Worker sees the push notification, opens the app, reviews shift details, and taps "Interested." WorkApplication created in `PENDING` state. Worker may optionally include a note.

---

### Step 3 — Manager Reviews Interested Workers

**Actor**: MANAGER  
**Interface**: Web frontend  
**API**: `GET /api/v1/work-requests/:id/applications`

Manager views a list of `PENDING` applications for the request. Each application shows worker name, overall rating, and number of shifts completed at this hotel.

---

### Step 4 — Manager Selects Workers

**Actor**: MANAGER  
**Interface**: Web frontend  
**API**: `POST /api/v1/applications/:id/accept` (once per selected worker)

Manager accepts workers one by one until all `workers_needed` slots are filled. Each acceptance:
1. Sets WorkApplication to `ACCEPTED`.
2. Creates a `WorkerAssignment` (status `ASSIGNED`).
3. Creates an `Attendance` record (status `NOT_STARTED`).
4. Updates WorkRequest to `PARTIALLY_FILLED` or `FILLED`.
5. Sends `APPLICATION_ACCEPTED` notification to accepted worker.
6. Remaining `PENDING` applications auto-expire when WorkRequest reaches `FILLED`.

---

### Step 5 — Worker Checks In

**Actor**: WORKER  
**Interface**: Mobile (worker-app)  
**API**: `POST /api/v1/assignments/:id/checkin`

Worker taps "Check In" on shift day. System:
1. Validates check-in is within the 30-minute window before `shift_start_time`.
2. Sets `Attendance.checked_in_at` to server UTC clock.
3. Sets `Attendance.status` to `CHECKED_IN`.
4. Sets `WorkerAssignment.status` to `CHECKED_IN`.
5. If this is the first check-in for the WorkRequest, sets WorkRequest to `IN_PROGRESS`.

---

### Step 6 — Worker Checks Out

**Actor**: WORKER  
**Interface**: Mobile (worker-app)  
**API**: `POST /api/v1/assignments/:id/checkout`

Worker taps "Check Out" at end of shift. System:
1. Sets `Attendance.checked_out_at` to server UTC clock.
2. Sets `Attendance.status` to `CHECKED_OUT`.
3. Sets `WorkerAssignment.status` to `CHECKED_OUT`.

---

### Step 7 — Manager Verifies Attendance

**Actor**: MANAGER  
**Interface**: Web frontend  
**API**: `POST /api/v1/assignments/:id/attendance/verify`

Manager reviews actual check-in/check-out times. May override times with a mandatory reason (recorded in AuditLog). Confirms hours worked. System:
1. Sets `Attendance.status` to `VERIFIED`.
2. Sets `WorkerAssignment.status` to `ATTENDANCE_VERIFIED`.
3. Creates `QualityVerification` record (status `PENDING`) linked to the assignment.
4. Sends `VERIFICATION_AVAILABLE` notification to active CHECKERs at the hotel.
5. If all assignments for the WorkRequest are now `ATTENDANCE_VERIFIED`, sets WorkRequest to `COMPLETED`.

---

### Step 8 — Checker Performs Quality Verification

**Actor**: CHECKER  
**Interface**: Mobile (checker-app)  
**API**: `POST /api/v1/verifications/:id/claim` → `POST /api/v1/verifications/:id/submit`

Checker sees pending verification in app. Claims it. Inspects the work. Submits a score (0–100) and optional notes and photos.

System:
1. `claim` sets `QualityVerification.status` to `IN_PROGRESS`, assigns `checker_id`.
2. `submit` evaluates score against hotel's `quality_threshold` (default 70).
3. Sets `QualityVerification.status` to `PASSED` or `FAILED`.
4. Creates `Rating` record (status `PENDING`).

---

### Step 9 — System Updates Ratings

**Actor**: System (automatic)  
**Trigger**: QualityVerification reaches terminal state

System:
1. Maps QV score to 1–5 stars using the score mapping table.
2. Sets `Rating.status` to `PUBLISHED`.
3. Updates `WorkerOverallRating` (average_score, total_ratings) in a single transaction with row lock.
4. Sends `RATING_PUBLISHED` push notification to the worker.

Worker can view their updated rating in the app.

---

*End of WORKREQUEST_FINAL_ARCHITECTURE.md*
