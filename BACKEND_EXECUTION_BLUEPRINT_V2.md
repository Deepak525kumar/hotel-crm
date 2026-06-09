# BACKEND_EXECUTION_BLUEPRINT_V2
**Hotel CRM — Marketplace Architecture**
**Status**: Implementation-Ready | **Date**: 2026-06-09
**Stack**: Express.js + TypeScript + Prisma + PostgreSQL + Redis

> This blueprint supersedes BACKEND_EXECUTION_BLUEPRINT (legacy task-based architecture).
> Marketplace workflow is frozen. No architecture decisions are made here — only execution sequencing.

---

## Canonical Marketplace Workflow

```
Auth → Hotels → HotelWorker → WorkRequest → WorkApplication
     → WorkerAssignment → Attendance → QualityVerification
     → Rating → Notifications → Analytics
```

---

## 1. Prisma Migration Order

Run migrations in strict sequence. Each migration is atomic and must pass `prisma migrate deploy` before the next begins.

### Migration 001 — Schema Cleanup (BLOCKING)
**Purpose**: Remove legacy models that conflict with marketplace architecture.

**Drop from schema.prisma**:
- `Room` model + all relations
- `Task` model + all relations
- `TaskPhoto` model
- `DailyOperation` model
- `TaskStatus` enum
- `Calendar` model (if exists)
- Relations on `User`: `created_tasks`, `assigned_tasks`, `created_operations`
- Relations on `Hotel`: `rooms`, `tasks`, `daily_operations`

**Modify `QualityVerification`**: Remove `task_id` FK → replace with `assignment_id` FK (see Migration 004).
**Modify `Rating`**: Remove `task_id` FK → replace with `assignment_id` FK (see Migration 004).

```
File: prisma/migrations/001_drop_legacy_models/migration.sql
```

### Migration 002 — HotelWorker
**New model**: `HotelWorker` — join table linking a `User` (role=WORKER) to a `Hotel`.

```prisma
model HotelWorker {
  id              String   @id @default(cuid())
  hotel_id        String
  hotel           Hotel    @relation(fields: [hotel_id], references: [id], onDelete: Cascade)
  worker_id       String
  worker          User     @relation(fields: [worker_id], references: [id], onDelete: Cascade)
  status          HotelWorkerStatus @default(ACTIVE)
  joined_at       DateTime @default(now())
  left_at         DateTime?
  created_at      DateTime @default(now())
  updated_at      DateTime @updatedAt

  @@unique([hotel_id, worker_id])
  @@index([hotel_id])
  @@index([worker_id])
  @@index([status])
}

enum HotelWorkerStatus {
  ACTIVE
  INACTIVE
  SUSPENDED
}
```

Add back-relation on `User`: `hotel_workers HotelWorker[]`
Add back-relation on `Hotel`: `hotel_workers HotelWorker[]`

```
File: prisma/migrations/002_add_hotel_worker/migration.sql
```

### Migration 003 — WorkRequest (Expand)
**Existing model `WorkRequest` exists** — validate it has these fields, add missing ones:

Required fields:
```prisma
model WorkRequest {
  id              String   @id @default(cuid())
  hotel_id        String
  hotel           Hotel    @relation(...)
  created_by_id   String
  created_by      User     @relation("created_work_requests", ...)
  title           String
  description     String?
  shift_date      DateTime
  shift_start     DateTime
  shift_end       DateTime
  worker_count    Int      @default(1)
  position        String   // "housekeeper", "maintenance", "front_desk", etc.
  hourly_rate     Decimal? @db.Decimal(10, 2)
  currency        String   @default("EUR")
  status          WorkRequestStatus @default(OPEN)
  created_at      DateTime @default(now())
  updated_at      DateTime @updatedAt

  applications    WorkApplication[]
  assignments     WorkerAssignment[]
}

enum WorkRequestStatus {
  OPEN
  FILLED
  CANCELLED
  COMPLETED
}
```

```
File: prisma/migrations/003_update_work_request/migration.sql
```

### Migration 004 — WorkApplication
**New model**: `WorkApplication` — worker applies to an open WorkRequest.

```prisma
model WorkApplication {
  id              String   @id @default(cuid())
  work_request_id String
  work_request    WorkRequest @relation(fields: [work_request_id], references: [id], onDelete: Cascade)
  worker_id       String
  worker          User     @relation(fields: [worker_id], references: [id], onDelete: Cascade)
  status          ApplicationStatus @default(PENDING)
  message         String?
  reviewed_by_id  String?
  reviewed_by     User?    @relation("application_reviewer", fields: [reviewed_by_id], references: [id])
  reviewed_at     DateTime?
  created_at      DateTime @default(now())
  updated_at      DateTime @updatedAt

  assignment      WorkerAssignment?

  @@unique([work_request_id, worker_id])
  @@index([work_request_id])
  @@index([worker_id])
  @@index([status])
}

enum ApplicationStatus {
  PENDING
  APPROVED
  REJECTED
  WITHDRAWN
}
```

```
File: prisma/migrations/004_add_work_application/migration.sql
```

### Migration 005 — WorkerAssignment (Rebuild)
**Existing model `WorkerAssignment` exists** — rebuild to reference `WorkApplication`.

```prisma
model WorkerAssignment {
  id                  String   @id @default(cuid())
  work_request_id     String
  work_request        WorkRequest @relation(...)
  worker_id           String
  worker              User     @relation(...)
  application_id      String   @unique
  application         WorkApplication @relation(...)
  assigned_by_id      String
  assigned_by         User     @relation("assignment_assigner", ...)
  status              AssignmentStatus @default(ASSIGNED)
  assigned_at         DateTime @default(now())
  cancelled_at        DateTime?
  created_at          DateTime @default(now())
  updated_at          DateTime @updatedAt

  attendance          Attendance?
  verifications       QualityVerification[]
  ratings             Rating[]

  @@index([work_request_id])
  @@index([worker_id])
  @@index([status])
}

enum AssignmentStatus {
  ASSIGNED
  CONFIRMED
  IN_PROGRESS
  COMPLETED
  CANCELLED
  NO_SHOW
}
```

```
File: prisma/migrations/005_rebuild_worker_assignment/migration.sql
```

### Migration 006 — Attendance
**New model**: `Attendance` — tracks clock-in/out per assignment.

```prisma
model Attendance {
  id              String   @id @default(cuid())
  assignment_id   String   @unique
  assignment      WorkerAssignment @relation(fields: [assignment_id], references: [id], onDelete: Cascade)
  worker_id       String
  worker          User     @relation(fields: [worker_id], references: [id])
  hotel_id        String
  hotel           Hotel    @relation(fields: [hotel_id], references: [id])
  clock_in_at     DateTime?
  clock_out_at    DateTime?
  clock_in_lat    Float?
  clock_in_lng    Float?
  clock_out_lat   Float?
  clock_out_lng   Float?
  status          AttendanceStatus @default(EXPECTED)
  total_minutes   Int?
  notes           String?
  created_at      DateTime @default(now())
  updated_at      DateTime @updatedAt

  @@index([worker_id])
  @@index([hotel_id])
  @@index([status])
}

enum AttendanceStatus {
  EXPECTED
  CLOCKED_IN
  CLOCKED_OUT
  ABSENT
  EXCUSED
}
```

```
File: prisma/migrations/006_add_attendance/migration.sql
```

### Migration 007 — QualityVerification (Repoint)
**Modify existing**: Change `task_id` reference to `assignment_id`.

```prisma
model QualityVerification {
  id                    String   @id @default(cuid())
  assignment_id         String   // FK to WorkerAssignment (not Task)
  assignment            WorkerAssignment @relation(...)
  hotel_id              String
  hotel                 Hotel    @relation(...)
  verified_by_id        String
  verified_by           User     @relation(...)
  score                 Int      // 0-100
  notes                 String?
  photo_urls            String[] // DO Spaces URLs (replaces TaskPhoto)
  status                VerificationStatus @default(VERIFIED)
  created_at            DateTime @default(now())
  updated_at            DateTime @updatedAt
}

enum VerificationStatus {
  VERIFIED
  NEEDS_REWORK
  DISPUTED
}
```

```
File: prisma/migrations/007_repoint_quality_verification/migration.sql
```

### Migration 008 — Rating (Repoint)
**Modify existing**: Change `task_id` reference to `assignment_id`.

```prisma
model Rating {
  id              String   @id @default(cuid())
  assignment_id   String   @unique
  assignment      WorkerAssignment @relation(...)
  hotel_id        String
  hotel           Hotel    @relation(...)
  worker_id       String
  worker          User     @relation("ratings_received", ...)
  rated_by_id     String
  rated_by        User     @relation("ratings_given", ...)
  score           Int      // 1-5 stars
  comment         String?
  created_at      DateTime @default(now())
}
```

```
File: prisma/migrations/008_repoint_rating/migration.sql
```

### Migration 009 — Notifications (Validate)
**Existing `Notification` model** — validate fields are sufficient, add `reference_type` and `reference_id` if missing for deep-linking.

```
File: prisma/migrations/009_update_notifications/migration.sql
```

### Migration 010 — Indexes (Performance)
Add composite indexes for analytics queries after all models are stable.

```sql
-- Attendance analytics
CREATE INDEX idx_attendance_hotel_date ON "Attendance"(hotel_id, clock_in_at);
-- Application funnel
CREATE INDEX idx_application_request_status ON "WorkApplication"(work_request_id, status);
-- Rating leaderboard
CREATE INDEX idx_rating_worker_hotel ON "Rating"(worker_id, hotel_id, created_at DESC);
```

```
File: prisma/migrations/010_performance_indexes/migration.sql
```

---

## 2. Module Build Order

Build in dependency order. Each module depends on modules above it.

| Order | Module | Directory | Depends On |
|-------|--------|-----------|------------|
| 1 | Auth | `src/modules/auth/` | — |
| 2 | Hotels | `src/modules/crm/` | Auth |
| 3 | HotelWorker | `src/modules/hotel-worker/` | Auth, Hotels |
| 4 | WorkRequest | `src/modules/staffing/work-request/` | Auth, Hotels |
| 5 | WorkApplication | `src/modules/staffing/work-application/` | HotelWorker, WorkRequest |
| 6 | WorkerAssignment | `src/modules/staffing/worker-assignment/` | WorkApplication |
| 7 | Attendance | `src/modules/attendance/` | WorkerAssignment |
| 8 | QualityVerification | `src/modules/quality/verification/` | WorkerAssignment, Attendance |
| 9 | Rating | `src/modules/quality/rating/` | QualityVerification |
| 10 | Notifications | `src/modules/notifications/` | All modules above |
| 11 | Analytics | `src/modules/analytics/` | All modules above |

### Module File Structure (each module)
```
src/modules/<module>/
  routes.ts         — Express route definitions + middleware bindings
  controller.ts     — HTTP handlers, req/res only, no business logic
  service.ts        — Business logic, Prisma queries
  types.ts          — Zod schemas + TypeScript interfaces
  __tests__/
    service.test.ts
    integration.test.ts
```

---

## 3. Endpoint Build Order

Build endpoints within each module in this sequence: **Create → Read → Update → Delete → Specialized**.

### Module 1: Auth
| # | Method | Path | Description |
|---|--------|------|-------------|
| 1 | POST | `/api/v1/auth/register` | Create user account |
| 2 | POST | `/api/v1/auth/login` | Issue JWT + refresh token |
| 3 | POST | `/api/v1/auth/refresh` | Rotate refresh token |
| 4 | POST | `/api/v1/auth/logout` | Revoke session |
| 5 | GET | `/api/v1/auth/me` | Get current user |
| 6 | PATCH | `/api/v1/auth/me` | Update profile |
| 7 | POST | `/api/v1/auth/change-password` | Change password |

### Module 2: Hotels
| # | Method | Path | Description |
|---|--------|------|-------------|
| 1 | POST | `/api/v1/hotels` | Create hotel (ADMIN) |
| 2 | GET | `/api/v1/hotels` | List hotels (scoped to user) |
| 3 | GET | `/api/v1/hotels/:hotelId` | Get hotel detail |
| 4 | PATCH | `/api/v1/hotels/:hotelId` | Update hotel |
| 5 | DELETE | `/api/v1/hotels/:hotelId` | Soft-delete hotel (ADMIN) |

### Module 3: HotelWorker
| # | Method | Path | Description |
|---|--------|------|-------------|
| 1 | POST | `/api/v1/hotels/:hotelId/workers` | Enroll worker at hotel (MANAGER) |
| 2 | GET | `/api/v1/hotels/:hotelId/workers` | List workers at hotel |
| 3 | GET | `/api/v1/hotels/:hotelId/workers/:workerId` | Get worker detail |
| 4 | PATCH | `/api/v1/hotels/:hotelId/workers/:workerId` | Update worker status |
| 5 | DELETE | `/api/v1/hotels/:hotelId/workers/:workerId` | Remove worker from hotel |
| 6 | GET | `/api/v1/workers/me/hotels` | Worker: list my hotels |

### Module 4: WorkRequest
| # | Method | Path | Description |
|---|--------|------|-------------|
| 1 | POST | `/api/v1/hotels/:hotelId/work-requests` | Create work request (MANAGER) |
| 2 | GET | `/api/v1/hotels/:hotelId/work-requests` | List hotel's work requests |
| 3 | GET | `/api/v1/work-requests` | Browse open requests (WORKER) |
| 4 | GET | `/api/v1/work-requests/:requestId` | Get request detail |
| 5 | PATCH | `/api/v1/work-requests/:requestId` | Update request |
| 6 | DELETE | `/api/v1/work-requests/:requestId` | Cancel request |

### Module 5: WorkApplication
| # | Method | Path | Description |
|---|--------|------|-------------|
| 1 | POST | `/api/v1/work-requests/:requestId/applications` | Worker applies |
| 2 | GET | `/api/v1/work-requests/:requestId/applications` | List applications (MANAGER) |
| 3 | GET | `/api/v1/applications/me` | Worker: my applications |
| 4 | PATCH | `/api/v1/applications/:applicationId/approve` | Manager approves |
| 5 | PATCH | `/api/v1/applications/:applicationId/reject` | Manager rejects |
| 6 | DELETE | `/api/v1/applications/:applicationId` | Worker withdraws |

### Module 6: WorkerAssignment
| # | Method | Path | Description |
|---|--------|------|-------------|
| 1 | POST | `/api/v1/applications/:applicationId/assign` | Create assignment from approved application |
| 2 | GET | `/api/v1/hotels/:hotelId/assignments` | List hotel assignments |
| 3 | GET | `/api/v1/assignments/me` | Worker: my assignments |
| 4 | GET | `/api/v1/assignments/:assignmentId` | Get assignment detail |
| 5 | PATCH | `/api/v1/assignments/:assignmentId/status` | Update assignment status |
| 6 | DELETE | `/api/v1/assignments/:assignmentId` | Cancel assignment |

### Module 7: Attendance
| # | Method | Path | Description |
|---|--------|------|-------------|
| 1 | POST | `/api/v1/assignments/:assignmentId/attendance/clock-in` | Worker clocks in |
| 2 | POST | `/api/v1/assignments/:assignmentId/attendance/clock-out` | Worker clocks out |
| 3 | GET | `/api/v1/assignments/:assignmentId/attendance` | Get attendance record |
| 4 | GET | `/api/v1/hotels/:hotelId/attendance` | Hotel attendance list (MANAGER) |
| 5 | PATCH | `/api/v1/attendance/:attendanceId` | Manager corrects record |

### Module 8: QualityVerification
| # | Method | Path | Description |
|---|--------|------|-------------|
| 1 | POST | `/api/v1/assignments/:assignmentId/verifications` | Checker submits verification |
| 2 | GET | `/api/v1/assignments/:assignmentId/verifications` | Get verification for assignment |
| 3 | GET | `/api/v1/hotels/:hotelId/verifications` | List hotel verifications |
| 4 | PATCH | `/api/v1/verifications/:verificationId` | Update verification (CHECKER) |

### Module 9: Rating
| # | Method | Path | Description |
|---|--------|------|-------------|
| 1 | POST | `/api/v1/assignments/:assignmentId/ratings` | Submit rating (CHECKER/MANAGER) |
| 2 | GET | `/api/v1/assignments/:assignmentId/ratings` | Get assignment rating |
| 3 | GET | `/api/v1/workers/:workerId/ratings` | Worker rating history |
| 4 | GET | `/api/v1/workers/:workerId/rating-summary` | Worker aggregate rating |

### Module 10: Notifications
| # | Method | Path | Description |
|---|--------|------|-------------|
| 1 | GET | `/api/v1/notifications` | List my notifications |
| 2 | PATCH | `/api/v1/notifications/:id/read` | Mark as read |
| 3 | PATCH | `/api/v1/notifications/read-all` | Mark all as read |
| 4 | DELETE | `/api/v1/notifications/:id` | Delete notification |

### Module 11: Analytics
| # | Method | Path | Description |
|---|--------|------|-------------|
| 1 | GET | `/api/v1/analytics/hotels/:hotelId/overview` | Hotel KPI summary |
| 2 | GET | `/api/v1/analytics/hotels/:hotelId/attendance` | Attendance metrics |
| 3 | GET | `/api/v1/analytics/hotels/:hotelId/quality` | Verification score trends |
| 4 | GET | `/api/v1/analytics/workers/leaderboard` | Worker rating leaderboard |
| 5 | GET | `/api/v1/analytics/work-requests/fill-rate` | Request fill rate metrics |

---

## 4. Service Build Order

Within each module, build services in this dependency order.

### Auth Services
1. `hashPassword(plain)` / `verifyPassword(plain, hash)` — bcrypt
2. `createUser(dto)` — register
3. `validateCredentials(email, password)` — login
4. `issueTokenPair(userId)` — JWT access + refresh
5. `refreshTokens(refreshToken)` — rotation
6. `revokeSession(sessionId)` — logout
7. `getCurrentUser(userId)` — profile

### Hotel Services
1. `createHotel(dto, actorId)` — scoped to ADMIN
2. `getHotelsForUser(userId, role)` — hotel_ids scope enforcement
3. `getHotelById(hotelId, actorId)` — auth check
4. `updateHotel(hotelId, dto, actorId)`
5. `deleteHotel(hotelId, actorId)` — soft delete

### HotelWorker Services
1. `enrollWorker(hotelId, workerId, actorId)` — creates HotelWorker row
2. `getHotelWorkers(hotelId, filters)` — with pagination
3. `getWorkerAtHotel(hotelId, workerId)`
4. `updateWorkerStatus(hotelId, workerId, status, actorId)`
5. `removeWorker(hotelId, workerId, actorId)` — sets left_at
6. `getWorkerHotels(workerId)` — worker's hotel list
7. `isWorkerEnrolled(hotelId, workerId)` — guard used by application service

### WorkRequest Services
1. `createWorkRequest(hotelId, dto, actorId)`
2. `listWorkRequests(filters, actorId)` — open requests visible to workers
3. `getWorkRequest(requestId, actorId)`
4. `updateWorkRequest(requestId, dto, actorId)`
5. `cancelWorkRequest(requestId, actorId)`
6. `autoFillCheck(requestId)` — sets status=FILLED when worker_count reached

### WorkApplication Services
1. `applyToRequest(requestId, workerId)` — validates: request OPEN, worker enrolled at hotel, no duplicate application
2. `listApplicationsForRequest(requestId, actorId)`
3. `getMyApplications(workerId, filters)`
4. `approveApplication(applicationId, actorId)` — triggers assignment creation
5. `rejectApplication(applicationId, actorId, reason)`
6. `withdrawApplication(applicationId, workerId)`

### WorkerAssignment Services
1. `createAssignment(applicationId, actorId)` — called by approveApplication
2. `listHotelAssignments(hotelId, filters, actorId)`
3. `getMyAssignments(workerId, filters)`
4. `getAssignment(assignmentId, actorId)`
5. `updateAssignmentStatus(assignmentId, status, actorId)`
6. `cancelAssignment(assignmentId, actorId)`

### Attendance Services
1. `clockIn(assignmentId, workerId, geoCoords)` — validates: assignment is ASSIGNED/CONFIRMED, no existing clock-in
2. `clockOut(assignmentId, workerId, geoCoords)` — validates: clocked in, sets total_minutes
3. `getAttendanceForAssignment(assignmentId, actorId)`
4. `listHotelAttendance(hotelId, dateRange, actorId)`
5. `correctAttendance(attendanceId, dto, actorId)` — MANAGER only, creates audit log

### QualityVerification Services
1. `submitVerification(assignmentId, dto, checkerId)` — validates: assignment COMPLETED, checker authorized at hotel
2. `getVerificationForAssignment(assignmentId, actorId)`
3. `listHotelVerifications(hotelId, filters, actorId)`
4. `updateVerification(verificationId, dto, checkerId)`

### Rating Services
1. `submitRating(assignmentId, dto, raterId)` — validates: verification exists (score >= threshold), no existing rating
2. `getRatingForAssignment(assignmentId, actorId)`
3. `getWorkerRatingHistory(workerId, filters)`
4. `getWorkerRatingSummary(workerId)` — avg + count + distribution
5. `updateWorkerOverallRating(workerId)` — called internally after rating creation

### Notification Services
1. `createNotification(userId, type, payload)` — internal, called by other services
2. `listNotifications(userId, filters)`
3. `markRead(notificationId, userId)`
4. `markAllRead(userId)`
5. `deleteNotification(notificationId, userId)`

**Notification triggers** (cross-module calls to `NotificationService.createNotification`):
- WorkApplication created → notify hotel MANAGER
- Application approved/rejected → notify WORKER
- WorkerAssignment created → notify WORKER
- Attendance clock-in → notify MANAGER
- QualityVerification submitted → notify MANAGER + WORKER
- Rating submitted → notify WORKER

### Analytics Services
1. `getHotelOverview(hotelId, dateRange)` — open requests, fill rate, avg score
2. `getAttendanceMetrics(hotelId, dateRange)` — on-time %, absent %, avg hours
3. `getQualityMetrics(hotelId, dateRange)` — avg score, rework %, trend
4. `getWorkerLeaderboard(hotelId, limit)` — ordered by avg rating
5. `getWorkRequestFillRate(hotelId, dateRange)` — % filled, avg time-to-fill

---

## 5. Integration Testing Order

Tests must run in workflow sequence. Each test suite seeds its own data and tears down after.

### Test Suite 1: Auth Flow
```
register → login → get /me → refresh token → logout
```
- Verify JWT issued with correct role claims
- Verify refresh token rotation invalidates old token
- Verify /me returns correct user after token refresh

### Test Suite 2: Hotel Management
```
ADMIN creates hotel → MANAGER assigned → MANAGER views hotel
```
- Verify hotel_ids scoping (manager cannot see other hotels)
- Verify soft delete hides hotel from list

### Test Suite 3: HotelWorker Enrollment
```
MANAGER enrolls WORKER at hotel → WORKER sees hotel in /workers/me/hotels
→ MANAGER lists hotel workers → MANAGER suspends worker
```
- Verify duplicate enrollment returns 409
- Verify suspended worker cannot apply to requests

### Test Suite 4: WorkRequest Lifecycle
```
MANAGER creates WorkRequest (OPEN) → WORKER browses open requests
→ MANAGER cancels request → request disappears from browse
```
- Verify worker at different hotel cannot see hotel-specific request details
- Verify OPEN request visible to enrolled worker

### Test Suite 5: WorkApplication Lifecycle
```
WORKER applies → MANAGER sees application → MANAGER approves
→ WorkerAssignment created automatically
→ Second WORKER applies → MANAGER rejects
→ Third WORKER applies → WORKER withdraws
```
- Verify duplicate application returns 409
- Verify unenrolled worker application returns 403
- Verify application to non-OPEN request returns 400

### Test Suite 6: WorkerAssignment Lifecycle
```
Assignment created (from Test Suite 5) → WORKER confirms
→ WORKER starts shift (IN_PROGRESS) → WORKER completes shift
```
- Verify only assigned worker can update their own assignment status
- Verify MANAGER can cancel assignment

### Test Suite 7: Attendance Flow
```
WORKER clocks in (with geo) → GET attendance (shows CLOCKED_IN)
→ WORKER clocks out → GET attendance (shows CLOCKED_OUT, total_minutes calculated)
→ MANAGER views hotel attendance
```
- Verify double clock-in returns 409
- Verify clock-out without clock-in returns 400
- Verify total_minutes calculated correctly

### Test Suite 8: QualityVerification Flow
```
CHECKER submits verification (score: 85) for completed assignment
→ MANAGER views verifications → CHECKER updates score
```
- Verify WORKER cannot submit verification
- Verify verification on non-COMPLETED assignment returns 400
- Verify score outside 0-100 returns 422

### Test Suite 9: Rating Flow
```
CHECKER submits rating (score: 4) → GET worker rating summary
→ WorkerOverallRating updated
```
- Verify rating on assignment without verification returns 400
- Verify duplicate rating returns 409
- Verify WorkerOverallRating.average_score recalculated correctly

### Test Suite 10: Notification Delivery
```
Run through application approved event → verify WORKER has unread notification
→ WORKER marks read → verify count drops
```

### Test Suite 11: End-to-End Marketplace Workflow
```
Full happy path: Register WORKER + MANAGER → create hotel → enroll worker
→ create work request → worker applies → manager approves → assignment created
→ worker clocks in/out → checker verifies → checker rates
→ notification created at each step → analytics reflect data
```

---

## 6. CI/CD Order

### Pipeline Stages (run in sequence)

```yaml
# .github/workflows/backend.yml

stages:
  - lint
  - type-check
  - unit-test
  - migrate-test-db
  - integration-test
  - build
  - deploy-staging
  - smoke-test-staging
  - deploy-production
```

### Stage Definitions

**Stage 1: lint**
```bash
cd backend && npm run lint
```
Fail fast: ESLint with `@typescript-eslint/recommended`. No warnings allowed in CI.

**Stage 2: type-check**
```bash
cd backend && npx tsc --noEmit
```
All TypeScript errors are blocking. Must pass before tests run.

**Stage 3: unit-test**
```bash
cd backend && npm run test:unit
```
Runs `src/**/*.test.ts` excluding `integration.test.ts`. Uses in-memory mocks for Prisma.

**Stage 4: migrate-test-db**
```bash
cd backend && DATABASE_URL=$TEST_DB_URL npx prisma migrate deploy
```
Applies all migrations to the CI test database. Runs before integration tests.

**Stage 5: integration-test**
```bash
cd backend && DATABASE_URL=$TEST_DB_URL npm run test:integration
```
Runs suites in order defined in Section 5. Each suite uses transactions that roll back.

**Stage 6: build**
```bash
cd backend && npm run build
```
TypeScript compile to `dist/`. Artifact stored for deployment.

**Stage 7: deploy-staging**
- Push Docker image to DigitalOcean Container Registry
- Run `prisma migrate deploy` against staging DB
- Restart staging container via DigitalOcean API

**Stage 8: smoke-test-staging**
```bash
# Health check + auth round-trip
curl -f https://staging.api.hotelcrm.com/health
./scripts/smoke-test.sh $STAGING_URL
```
`smoke-test.sh` performs: login → /me → create work request → cleanup.

**Stage 9: deploy-production**
- Manual approval gate (GitHub environment protection rule)
- Same steps as staging deployment targeting production DB and container

### Branch Strategy
```
feature/* → develop (auto: lint, type-check, unit-test)
develop   → staging (auto: all stages through smoke-test-staging)
staging   → main (manual approval: deploy-production)
```

---

## 7. Sprint Breakdown

**Sprint duration**: 1 week
**Definition of Done**: Migrations applied, endpoints implemented, service tests passing, integration test suite for module passing, PR merged to `develop`.

---

### Sprint 1: Foundation + Auth
**Goal**: Running Express app with JWT auth, Prisma connected, test infrastructure.

| Task | Owner | Hours |
|------|-------|-------|
| Run Migration 001 (drop legacy models) | Backend | 2h |
| Validate schema compiles, generate Prisma client | Backend | 1h |
| Implement Auth module (all 7 endpoints) | Backend | 6h |
| Auth service unit tests | Backend | 3h |
| Auth integration test suite (Suite 1) | Backend | 3h |
| CI pipeline: lint + type-check + unit-test stages | DevOps | 3h |
| Docker Compose working for local dev | DevOps | 2h |

**Exit criteria**: `POST /auth/login` returns JWT; `/auth/me` validates token; CI green.

---

### Sprint 2: Hotels + HotelWorker
**Goal**: Hotel management and worker enrollment working end-to-end.

| Task | Owner | Hours |
|------|-------|-------|
| Run Migration 002 (HotelWorker model) | Backend | 1h |
| Hotels module (5 endpoints + service) | Backend | 5h |
| HotelWorker module (6 endpoints + service) | Backend | 6h |
| Hotel + HotelWorker integration tests (Suites 2–3) | Backend | 4h |
| RBAC middleware: hotel_ids scope enforcement | Backend | 3h |
| CI: integrate-test stage wired up | DevOps | 2h |

**Exit criteria**: MANAGER can enroll WORKER; hotel_ids scoping enforced; Suites 2–3 green.

---

### Sprint 3: WorkRequest + WorkApplication
**Goal**: Open marketplace — workers can browse and apply to shifts.

| Task | Owner | Hours |
|------|-------|-------|
| Run Migration 003 (WorkRequest expand) | Backend | 1h |
| Run Migration 004 (WorkApplication) | Backend | 1h |
| WorkRequest module (6 endpoints + service) | Backend | 5h |
| WorkApplication module (6 endpoints + service) | Backend | 7h |
| Guard: unenrolled worker cannot apply | Backend | 2h |
| Guard: request auto-fills when worker_count reached | Backend | 2h |
| Integration tests Suites 4–5 | Backend | 4h |

**Exit criteria**: Full application lifecycle functional; duplicate/invalid applications rejected; Suite 4–5 green.

---

### Sprint 4: WorkerAssignment + Attendance
**Goal**: Shift assignment confirmed and tracked with clock-in/out.

| Task | Owner | Hours |
|------|-------|-------|
| Run Migration 005 (WorkerAssignment rebuild) | Backend | 1h |
| Run Migration 006 (Attendance) | Backend | 1h |
| WorkerAssignment module (6 endpoints + service) | Backend | 5h |
| Attendance module (5 endpoints + service) | Backend | 6h |
| Geo-validation for clock-in (configurable radius) | Backend | 3h |
| Integration tests Suites 6–7 | Backend | 4h |
| Mobile API contract doc for clock-in endpoint | Backend | 2h |

**Exit criteria**: Worker clocks in/out; total_minutes computed; MANAGER sees attendance dashboard; Suites 6–7 green.

---

### Sprint 5: QualityVerification + Rating
**Goal**: Post-shift quality loop closed — verification, scoring, and rating.

| Task | Owner | Hours |
|------|-------|-------|
| Run Migration 007 (QualityVerification repoint) | Backend | 1h |
| Run Migration 008 (Rating repoint) | Backend | 1h |
| QualityVerification module (4 endpoints + service) | Backend | 5h |
| Rating module (4 endpoints + service) | Backend | 5h |
| WorkerOverallRating aggregation (upsert on rating create) | Backend | 2h |
| Integration tests Suites 8–9 | Backend | 4h |

**Exit criteria**: Checker can verify and rate a completed assignment; WorkerOverallRating updated atomically; Suites 8–9 green.

---

### Sprint 6: Notifications + Analytics
**Goal**: Cross-cutting notification hooks wired in; analytics endpoints operational.

| Task | Owner | Hours |
|------|-------|-------|
| Run Migration 009 (Notifications validate/update) | Backend | 1h |
| Run Migration 010 (Performance indexes) | Backend | 1h |
| Notifications module (4 endpoints + service) | Backend | 4h |
| Wire notification triggers in all upstream services | Backend | 5h |
| Analytics module (5 endpoints + service) | Backend | 6h |
| Integration tests Suites 10–11 | Backend | 5h |
| Staging deploy + smoke test | DevOps | 3h |

**Exit criteria**: Full end-to-end Suite 11 green; notifications fire on every event; analytics queries return correct aggregations; staging smoke test passing.

---

### Sprint 7: Hardening + Production
**Goal**: Security review, performance validation, production deploy.

| Task | Owner | Hours |
|------|-------|-------|
| Security audit: RBAC matrix vs all endpoints | Backend | 4h |
| Input validation audit: Zod schemas on all endpoints | Backend | 3h |
| Rate limiting on auth endpoints | Backend | 2h |
| Redis caching for analytics queries (TTL 5min) | Backend | 3h |
| Load test: 100 concurrent requests on core endpoints | Backend | 3h |
| GDPR audit: soft deletes, audit logs on HR data | Backend | 3h |
| Production deploy with manual approval gate | DevOps | 2h |
| Runbook: rollback procedure documented | DevOps | 2h |

**Exit criteria**: All integration tests green on production DB; load test p99 < 500ms; no RBAC bypasses found in audit.

---

## Appendix A: RBAC Permission Matrix

| Endpoint Group | WORKER | CHECKER | MANAGER | ADMIN |
|----------------|--------|---------|---------|-------|
| Auth (own account) | ✓ | ✓ | ✓ | ✓ |
| Hotels: create/delete | ✗ | ✗ | ✗ | ✓ |
| Hotels: read/update | hotel_ids | hotel_ids | hotel_ids | all |
| HotelWorker: enroll/remove | ✗ | ✗ | hotel_ids | ✓ |
| HotelWorker: list | own | ✗ | hotel_ids | ✓ |
| WorkRequest: create | ✗ | ✗ | hotel_ids | ✓ |
| WorkRequest: browse | enrolled | enrolled | hotel_ids | ✓ |
| WorkApplication: create | enrolled | ✗ | ✗ | ✗ |
| WorkApplication: review | ✗ | ✗ | hotel_ids | ✓ |
| WorkerAssignment: view | own | hotel_ids | hotel_ids | ✓ |
| Attendance: clock-in/out | own | ✗ | ✗ | ✗ |
| Attendance: correct | ✗ | ✗ | hotel_ids | ✓ |
| QualityVerification: submit | ✗ | hotel_ids | ✗ | ✗ |
| QualityVerification: view | own | hotel_ids | hotel_ids | ✓ |
| Rating: submit | ✗ | hotel_ids | hotel_ids | ✓ |
| Rating: view | own | hotel_ids | hotel_ids | ✓ |
| Analytics | ✗ | ✗ | hotel_ids | ✓ |
| Notifications | own | own | own | ✓ |

---

## Appendix B: Data Flow per Workflow Event

```
WORKER applies
  └─ WorkApplicationService.applyToRequest()
       ├─ guard: isWorkerEnrolled(hotelId, workerId)
       ├─ guard: WorkRequest.status === OPEN
       ├─ guard: no duplicate WorkApplication
       ├─ creates WorkApplication { status: PENDING }
       └─ NotificationService.createNotification(managerId, "APPLICATION_RECEIVED", ...)

MANAGER approves application
  └─ WorkApplicationService.approveApplication()
       ├─ sets WorkApplication.status = APPROVED
       ├─ creates WorkerAssignment { status: ASSIGNED }
       ├─ calls WorkRequestService.autoFillCheck()
       └─ NotificationService.createNotification(workerId, "APPLICATION_APPROVED", ...)

WORKER clocks in
  └─ AttendanceService.clockIn()
       ├─ guard: WorkerAssignment.status in [ASSIGNED, CONFIRMED]
       ├─ guard: no existing clock-in
       ├─ creates Attendance { status: CLOCKED_IN, clock_in_at: now() }
       ├─ sets WorkerAssignment.status = IN_PROGRESS
       └─ NotificationService.createNotification(managerId, "WORKER_CLOCKED_IN", ...)

CHECKER submits verification
  └─ QualityVerificationService.submitVerification()
       ├─ guard: WorkerAssignment.status === COMPLETED
       ├─ guard: checker enrolled at hotel
       ├─ creates QualityVerification { score, status }
       └─ NotificationService.createNotification(workerId, "VERIFICATION_SUBMITTED", ...)

CHECKER submits rating
  └─ RatingService.submitRating()
       ├─ guard: QualityVerification exists for assignment
       ├─ guard: no existing Rating for assignment
       ├─ creates Rating
       ├─ calls RatingService.updateWorkerOverallRating(workerId)  [upsert]
       └─ NotificationService.createNotification(workerId, "RATING_RECEIVED", ...)
```

---

## Appendix C: Environment Variables Required

```bash
# Database
DATABASE_URL=postgresql://user:pass@host:5432/hotelcrm
TEST_DB_URL=postgresql://user:pass@host:5432/hotelcrm_test

# JWT
JWT_SECRET=<256-bit-random>
JWT_ACCESS_EXPIRES_IN=15m
JWT_REFRESH_EXPIRES_IN=7d

# Redis (optional, for caching analytics)
REDIS_URL=redis://localhost:6379

# DigitalOcean Spaces (for verification photos)
DO_SPACES_KEY=<key>
DO_SPACES_SECRET=<secret>
DO_SPACES_ENDPOINT=https://fra1.digitaloceanspaces.com
DO_SPACES_BUCKET=hotelcrm-media

# App
NODE_ENV=production
PORT=3000
LOG_LEVEL=info
```

---

*End of BACKEND_EXECUTION_BLUEPRINT_V2*
