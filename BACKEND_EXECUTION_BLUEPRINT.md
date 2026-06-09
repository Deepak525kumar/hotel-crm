# BACKEND EXECUTION BLUEPRINT
> Hotel CRM — Marketplace Architecture  
> Status: Implementation-ready. No architecture discussion.  
> Generated: 2026-06-09

---

## 0. CONSTRAINTS & CONVENTIONS

- All services extend `BaseService` (`/lib/base-service.ts`)
- All controllers return `{ status, data, meta }` via `res.success()` helper
- All mutations write to `AuditLog` via `this.audit()`
- Every Prisma migration is additive-only (no destructive column drops)
- Test coverage gate: 80% lines per module before merging
- Branch strategy: `feature/<module>-<task>` → PR → `develop` → `main`

---

## 1. MODULE BUILD ORDER

Build in strict dependency order. A module is "built" when its service, controller, routes, and types are fully implemented with tests passing.

```
[1]  lib/          → errors, jwt, utils, base-service          (no deps)
[2]  auth/         → User, Session tables                       (deps: lib)
[3]  crm/          → Hotel, Room, Task, TaskPhoto               (deps: auth)
[4]  staffing/     → WorkRequest, WorkerAssignment, DailyOp    (deps: crm, auth)
[5]  quality/      → QualityVerification, Rating                (deps: staffing, crm)
[6]  hr/           → Contract, Payroll, WorkerDocument          (deps: auth, crm)
[7]  notifications/ → Notification, push/email dispatch         (deps: auth, all writers)
[8]  analytics/    → read-only aggregates                       (deps: quality, staffing)
[9]  calendar/     → DailyOperation scheduling view             (deps: staffing, crm)
```

**Rule:** Never start module N until module N-1 unit tests are green.

---

## 2. ENDPOINT BUILD ORDER

Within each module, build endpoints in this sequence:  
`LIST → GET_ONE → CREATE → UPDATE → DELETE → ACTIONS`

### 2.1 Auth Module (`/api/v1/auth`)

| # | Method | Path | Service Method | Priority |
|---|--------|------|----------------|----------|
| 1 | POST | `/signup` | `AuthService.signup()` | P0 |
| 2 | POST | `/login` | `AuthService.login()` | P0 |
| 3 | POST | `/refresh` | `AuthService.refreshToken()` | P0 |
| 4 | GET | `/me` | `AuthService.getProfile()` | P0 |
| 5 | POST | `/logout` | `AuthService.logout()` | P0 |
| 6 | PUT | `/profile` | `AuthService.updateProfile()` | P1 |

### 2.2 CRM Module (`/api/v1/crm`)

| # | Method | Path | Service Method | Priority |
|---|--------|------|----------------|----------|
| 1 | GET | `/hotels` | `CrmService.listHotels()` | P0 |
| 2 | POST | `/hotels` | `CrmService.createHotel()` | P0 |
| 3 | GET | `/hotels/:id` | `CrmService.getHotel()` | P0 |
| 4 | PUT | `/hotels/:id` | `CrmService.updateHotel()` | P1 |
| 5 | GET | `/hotels/:id/rooms` | `CrmService.listRooms()` | P0 |
| 6 | POST | `/hotels/:id/rooms` | `CrmService.createRoom()` | P0 |
| 7 | PUT | `/hotels/:id/rooms/:rid` | `CrmService.updateRoom()` | P1 |
| 8 | GET | `/hotels/:id/tasks` | `CrmService.listTasks()` | P0 |
| 9 | POST | `/hotels/:id/tasks` | `CrmService.createTask()` | P0 |
| 10 | GET | `/tasks/:id` | `CrmService.getTask()` | P0 |
| 11 | PUT | `/tasks/:id` | `CrmService.updateTask()` | P1 |
| 12 | POST | `/tasks/:id/photos` | `CrmService.uploadTaskPhoto()` | P1 |
| 13 | DELETE | `/tasks/:id` | `CrmService.cancelTask()` | P2 |

### 2.3 Staffing Module (`/api/v1/staffing`)

| # | Method | Path | Service Method | Priority |
|---|--------|------|----------------|----------|
| 1 | GET | `/work-requests` | `StaffingService.listWorkRequests()` | P0 |
| 2 | POST | `/work-requests` | `StaffingService.createWorkRequest()` | P0 |
| 3 | GET | `/work-requests/:id` | `StaffingService.getWorkRequest()` | P0 |
| 4 | GET | `/available-workers` | `StaffingService.getAvailableWorkers()` | P0 |
| 5 | POST | `/work-requests/:id/assign-workers` | `StaffingService.assignWorkers()` | P0 |
| 6 | POST | `/assignments/:id/start` | `StaffingService.startAssignment()` | P0 |
| 7 | POST | `/assignments/:id/complete` | `StaffingService.completeAssignment()` | P0 |
| 8 | GET | `/assignments` | `StaffingService.listAssignments()` | P1 |
| 9 | PUT | `/work-requests/:id` | `StaffingService.updateWorkRequest()` | P1 |

### 2.4 Quality Module (`/api/v1/quality`)

| # | Method | Path | Service Method | Priority |
|---|--------|------|----------------|----------|
| 1 | POST | `/verifications` | `QualityService.createVerification()` | P0 |
| 2 | GET | `/verifications` | `QualityService.listVerifications()` | P0 |
| 3 | GET | `/verifications/:id` | `QualityService.getVerification()` | P1 |
| 4 | POST | `/ratings` | `QualityService.rateWorker()` | P0 |
| 5 | GET | `/leaderboard` | `QualityService.getGlobalLeaderboard()` | P0 |
| 6 | GET | `/leaderboard/by-hotel/:id` | `QualityService.getHotelLeaderboard()` | P0 |
| 7 | PUT | `/verifications/:id` | `QualityService.updateVerification()` | P2 |

### 2.5 HR Module (`/api/v1/hr`)

| # | Method | Path | Service Method | Priority |
|---|--------|------|----------------|----------|
| 1 | GET | `/contracts` | `HrService.listContracts()` | P0 |
| 2 | POST | `/contracts` | `HrService.createContract()` | P0 |
| 3 | GET | `/contracts/:id` | `HrService.getContract()` | P0 |
| 4 | PUT | `/contracts/:id` | `HrService.updateContract()` | P1 |
| 5 | POST | `/contracts/:id/sign` | `HrService.signContract()` | P1 |
| 6 | GET | `/payroll` | `HrService.listPayroll()` | P0 |
| 7 | POST | `/payroll` | `HrService.createPayroll()` | P0 |
| 8 | PUT | `/payroll/:id/approve` | `HrService.approvePayroll()` | P1 |
| 9 | PUT | `/payroll/:id/mark-paid` | `HrService.markPayrollPaid()` | P1 |
| 10 | POST | `/workers/:id/documents` | `HrService.uploadDocument()` | P0 |
| 11 | GET | `/workers/:id/documents` | `HrService.listDocuments()` | P0 |
| 12 | GET | `/contract-templates` | `HrService.listTemplates()` | P1 |
| 13 | POST | `/contract-templates` | `HrService.createTemplate()` | P1 |

### 2.6 Notifications Module (`/api/v1/notifications`)

| # | Method | Path | Service Method | Priority |
|---|--------|------|----------------|----------|
| 1 | GET | `/` | `NotificationService.listNotifications()` | P0 |
| 2 | POST | `/:id/read` | `NotificationService.markRead()` | P0 |
| 3 | POST | `/read-all` | `NotificationService.markAllRead()` | P1 |
| 4 | DELETE | `/:id` | `NotificationService.deleteNotification()` | P2 |

### 2.7 Analytics Module (`/api/v1/analytics`)

| # | Method | Path | Service Method | Priority |
|---|--------|------|----------------|----------|
| 1 | GET | `/stats` | `AnalyticsService.getDashboardStats()` | P0 |
| 2 | GET | `/leaderboard` | `AnalyticsService.getGlobalLeaderboard()` | P0 |
| 3 | GET | `/leaderboard/by-hotel/:id` | `AnalyticsService.getHotelLeaderboard()` | P0 |
| 4 | GET | `/hotel-summary/:id` | `AnalyticsService.getHotelSummary()` | P1 |

### 2.8 Calendar Module (`/api/v1/calendar`)

| # | Method | Path | Service Method | Priority |
|---|--------|------|----------------|----------|
| 1 | GET | `/hotels/:id/operations` | `CalendarService.listDailyOps()` | P0 |
| 2 | POST | `/hotels/:id/operations` | `CalendarService.createDailyOp()` | P0 |
| 3 | PUT | `/operations/:id` | `CalendarService.updateDailyOp()` | P1 |

---

## 3. SERVICE BUILD ORDER

Each service has internal method build ordering. Complete methods top-to-bottom; later methods depend on earlier ones.

### 3.1 AuthService

```
1. hashPassword(plain) → bcrypt.hash                                  [util]
2. verifyPassword(plain, hash) → bcrypt.compare                       [util]
3. generateTokenPair(user) → { accessToken, refreshToken }            [util]
4. signup(dto) → create User + Session, return tokens                 [mutation]
5. login(email, password) → verify + generateTokenPair                [mutation]
6. refreshToken(token) → rotate refresh token                         [mutation]
7. logout(userId, sessionId) → delete Session                         [mutation]
8. getProfile(userId) → User without password                         [query]
9. updateProfile(userId, dto) → update User                           [mutation]
```

### 3.2 CrmService

```
1. listHotels(userId, role) → hotels scoped by role                   [query]
2. getHotel(hotelId, userId) → hotel + room counts + task counts      [query]
3. createHotel(dto) → Hotel with audit                                [mutation]
4. updateHotel(hotelId, dto) → patch fields                           [mutation]
5. listRooms(hotelId, filters) → paginated rooms                      [query]
6. createRoom(hotelId, dto) → Room                                    [mutation]
7. updateRoom(roomId, dto) → patch status/type                        [mutation]
8. listTasks(hotelId, filters) → paginated tasks with assignee        [query]
9. getTask(taskId) → task + photos + assignment                       [query]
10. createTask(hotelId, dto) → Task + fire notification               [mutation]
11. updateTask(taskId, dto) → status transitions with guards          [mutation]
12. uploadTaskPhoto(taskId, file) → S3 upload + TaskPhoto record      [mutation]
13. cancelTask(taskId) → soft cancel with reason                      [mutation]
```

### 3.3 StaffingService

```
1. listWorkRequests(hotelId, filters) → paginated                     [query]
2. getWorkRequest(requestId) → + assignments + workers                [query]
3. createWorkRequest(dto) → WorkRequest + fire notification           [mutation]
4. updateWorkRequest(requestId, dto) → patch                          [mutation]
5. getAvailableWorkers(date, hotelId) → unassigned workers            [query]
6. assignWorkers(requestId, workerIds[]) → bulk WorkerAssignment      [mutation]
7. startAssignment(assignmentId, workerId) → set started_at           [mutation]
8. completeAssignment(assignmentId, workerId) → set completed_at      [mutation]
9. listAssignments(filters) → worker's assignment history             [query]
```

### 3.4 QualityService

```
1. createVerification(dto) → QualityVerification + update task status [mutation]
2. listVerifications(filters) → paginated with task info              [query]
3. getVerification(id) → full detail                                  [query]
4. updateVerification(id, dto) → rework status update                 [mutation]
5. rateWorker(dto) → Rating + recompute WorkerOverallRating           [mutation]
6. getGlobalLeaderboard(limit) → top N workers by score               [query]
7. getHotelLeaderboard(hotelId, limit) → scoped to hotel              [query]
```

### 3.5 HrService

```
1. listTemplates(hotelId) → ContractTemplate[]                        [query]
2. createTemplate(dto) → ContractTemplate                             [mutation]
3. listContracts(filters) → paginated with worker info                [query]
4. getContract(id) → + line items + worker docs                       [query]
5. createContract(dto) → Contract + ContractLineItem[] + audit        [mutation]
6. updateContract(id, dto) → patch status/fields                      [mutation]
7. signContract(id, signerId) → hash + set signed_at                  [mutation]
8. listPayroll(filters) → paginated, decrypt sensitive fields         [query]
9. createPayroll(dto) → Payroll + PayrollLineItem[] + AES encrypt     [mutation]
10. approvePayroll(id, approverId) → status → approved                [mutation]
11. markPayrollPaid(id) → status → paid + audit                       [mutation]
12. uploadDocument(workerId, dto) → hash + WorkerDocument             [mutation]
13. listDocuments(workerId) → with expiry warnings                    [query]
14. checkExpiringDocuments() → cron: 30-day warning                   [cron]
```

### 3.6 NotificationService

```
1. create(userId, type, title, message, data?) → Notification row     [internal]
2. sendEmail(to, subject, html) → SendGrid/Resend dispatch            [internal]
3. sendPush(userId, title, body, data?) → APNS/FCM dispatch           [internal]
4. listNotifications(userId, filters) → paginated unread-first        [query]
5. markRead(notificationId, userId) → set is_read + read_at           [mutation]
6. markAllRead(userId) → bulk update                                   [mutation]
7. deleteNotification(id, userId) → soft delete                       [mutation]
```

### 3.7 AnalyticsService

```
1. getDashboardStats(userId, role) → counts + summaries               [query]
2. getGlobalLeaderboard(limit) → delegate to QualityService           [query]
3. getHotelLeaderboard(hotelId) → delegate to QualityService          [query]
4. getHotelSummary(hotelId) → tasks/rooms/workers aggregate           [query]
```

### 3.8 CalendarService

```
1. listDailyOps(hotelId, date?) → DailyOperation[] with rooms         [query]
2. createDailyOp(dto) → DailyOperation + link to assignment           [mutation]
3. updateDailyOp(id, dto) → patch status/tasks                        [mutation]
```

---

## 4. PRISMA MIGRATION ORDER

Run migrations in this sequence. Never squash until post-launch.

```
migration_001_auth_users
  → creates: User, Session
  → indexes: email(unique), role, hotel_ids(GIN)

migration_002_crm_core
  → creates: Hotel, Room
  → indexes: hotel.is_active, room.hotel_id, room.status

migration_003_crm_tasks
  → creates: Task, TaskPhoto
  → indexes: task.hotel_id, task.assigned_to, task.status, task.priority
  → foreign keys: task.hotel_id→Hotel, task.room_id→Room, task.assigned_to→User

migration_004_staffing
  → creates: WorkRequest, WorkerAssignment, DailyOperation
  → indexes: work_request.hotel_id+shift_date, assignment.worker_id+status
  → foreign keys: WorkerAssignment.work_request_id, DailyOperation.room_id

migration_005_quality
  → creates: QualityVerification, Rating, WorkerOverallRating
  → indexes: verification.task_id, rating.worker_id, overall_rating.worker_id(unique)
  → foreign keys: verification.task_id→Task, rating.worker_id→User

migration_006_hr_contracts
  → creates: ContractTemplate, Contract, ContractLineItem
  → indexes: contract.worker_id+hotel_id+status, contract.expires_at
  → foreign keys: contract.worker_id→User, contract.hotel_id→Hotel

migration_007_hr_payroll
  → creates: Payroll, PayrollLineItem
  → indexes: payroll.worker_id+period_start, payroll.status
  → foreign keys: payroll.worker_id→User

migration_008_hr_documents
  → creates: WorkerDocument, RequiredDocument
  → indexes: worker_doc.worker_id+type, worker_doc.expires_at
  → foreign keys: worker_doc.worker_id→User

migration_009_notifications
  → creates: Notification
  → indexes: notification.user_id+is_read, notification.created_at
  → foreign keys: notification.user_id→User

migration_010_compliance
  → creates: AuditLog, ConsentLog, DataRetentionLog
  → indexes: audit.actor_id, audit.resource_type+resource_id, audit.created_at
  → foreign keys: audit.actor_id→User

migration_011_perf_indexes
  → adds composite indexes for common query patterns:
    Task(hotel_id, status, created_at)
    WorkerAssignment(worker_id, started_at, completed_at)
    Rating(worker_id, created_at)
    Notification(user_id, is_read, created_at)

migration_012_seed_data (dev/staging only)
  → inserts: 1 ADMIN user, 2 Hotels, 10 Rooms, 3 WORKER users, 1 CHECKER, 1 MANAGER
```

**Migration commands:**
```bash
# Create
npx prisma migrate dev --name <migration_name>

# Apply (staging/prod)
npx prisma migrate deploy

# Reset dev only
npx prisma migrate reset
```

---

## 5. INTEGRATION TESTING ORDER

Tests execute in dependency order. Each layer must pass before the next starts.

### Layer 1: Infrastructure
```
test/infra/db.test.ts
  → prisma.$connect() succeeds
  → all 23 tables exist via $queryRaw
  → indexes exist on critical columns

test/infra/redis.test.ts
  → redis.ping() returns PONG (skip if REDIS_URL unset)

test/infra/env.test.ts
  → all required env vars present and valid
  → JWT_SECRET min length enforced
```

### Layer 2: Auth Flows (requires Layer 1)
```
test/auth/signup.test.ts
  → POST /auth/signup → 201 with tokens
  → duplicate email → 409
  → invalid email format → 422
  → password too short → 422

test/auth/login.test.ts
  → POST /auth/login → 200 with tokens
  → wrong password → 401
  → unknown email → 401
  → account disabled → 403

test/auth/token.test.ts
  → POST /auth/refresh → rotates refresh token
  → expired refresh → 401
  → GET /me with valid token → 200
  → GET /me with expired token → 401
  → POST /auth/logout → deletes session

test/auth/profile.test.ts
  → PUT /auth/profile → 200 with updated fields
  → cannot change email to existing → 409
```

### Layer 3: CRM Flows (requires Layer 2)
```
test/crm/hotels.test.ts
  → ADMIN can create hotel → 201
  → MANAGER cannot create hotel → 403
  → GET /hotels scoped by hotel_ids for MANAGER
  → ADMIN sees all hotels

test/crm/rooms.test.ts
  → create room under hotel → 201
  → list rooms filtered by status
  → update room status → 200
  → hotel scope enforced for MANAGER

test/crm/tasks.test.ts
  → create task assigns to worker → 201
  → worker can view own task
  → worker cannot view other hotel task → 403
  → task status transitions: ASSIGNED → IN_PROGRESS → COMPLETED
  → invalid transition rejected → 400
  → photo upload creates TaskPhoto record → 201
```

### Layer 4: Staffing Flows (requires Layer 3)
```
test/staffing/work-requests.test.ts
  → MANAGER creates work request → 201
  → WORKER cannot create work request → 403
  → available workers excludes already-assigned
  → assign workers fills slots → 200
  → over-assigning beyond workers_needed → 400

test/staffing/assignments.test.ts
  → start assignment sets started_at → 200
  → complete assignment sets completed_at → 200
  → worker can only start own assignment → 403
  → double-start rejected → 409
```

### Layer 5: Quality Flows (requires Layer 4)
```
test/quality/verifications.test.ts
  → CHECKER creates verification → 201
  → score out of 0-100 range → 422
  → verify non-completed task → 400
  → verification updates task status

test/quality/ratings.test.ts
  → CHECKER rates worker → 201
  → WorkerOverallRating upserted correctly
  → rating out of 0-5 → 422
  → WORKER cannot rate → 403

test/quality/leaderboard.test.ts
  → global leaderboard returns top N sorted
  → hotel leaderboard scoped correctly
  → empty hotel returns []
```

### Layer 6: HR Flows (requires Layer 2)
```
test/hr/contracts.test.ts
  → create contract with line items → 201
  → sign contract sets signed_at + hash → 200
  → cannot sign already-signed contract → 409
  → contract scoped to hotel for MANAGER

test/hr/payroll.test.ts
  → create payroll encrypts sensitive fields → 201
  → list payroll decrypts for authorized user
  → approve payroll changes status → 200
  → mark paid requires approved status → 400

test/hr/documents.test.ts
  → upload document creates record with hash → 201
  → list documents shows expiry warnings
  → expired document flagged in response
```

### Layer 7: Notifications (requires Layer 3, 4, 5, 6)
```
test/notifications/delivery.test.ts
  → task creation fires notification to assigned worker
  → assignment fires notification to worker
  → verification fires notification to task creator
  → payroll approval fires notification to worker

test/notifications/api.test.ts
  → list notifications unread-first → 200
  → mark single read → 200
  → mark all read → 200
  → cannot read another user's notification → 403
```

### Layer 8: Analytics & Calendar
```
test/analytics/stats.test.ts
  → ADMIN gets full stats across all hotels
  → MANAGER gets stats for assigned hotels only
  → stats counts match actual DB records

test/calendar/operations.test.ts
  → create daily operation linked to assignment
  → list operations filtered by date
  → update operation status
```

### Layer 9: RBAC Matrix
```
test/rbac/permission-matrix.test.ts
  → for each endpoint × role combination:
    WORKER: can access own resources only
    CHECKER: quality endpoints + own profile
    MANAGER: hotel-scoped CRM + HR + staffing
    ADMIN: all endpoints unrestricted
  → hotel_ids isolation: MANAGER A cannot access Hotel B
  → wildcard permission hotel:* grants all hotel actions
```

### Layer 10: End-to-End Scenarios
```
test/e2e/full-workflow.test.ts
  Scenario A — Task Lifecycle:
    signup worker → create hotel → assign room → create task →
    assign to worker → worker starts → worker completes + photo →
    checker verifies → rating created → leaderboard updated

  Scenario B — HR Workflow:
    create worker → upload passport → create contract →
    sign contract → create payroll → approve payroll → mark paid →
    audit log contains all 6 actions

  Scenario C — Staffing Marketplace:
    manager creates work request (3 workers needed) →
    query available workers → assign 3 workers →
    all start assignments → all complete → work request status = FILLED
```

---

## 6. CI/CD ORDER

### 6.1 GitHub Actions Pipeline (`.github/workflows/`)

#### `ci.yml` — Runs on every PR to `develop` and `main`

```yaml
Stage 1: validate (parallel)
  - lint           → tsc --noEmit + eslint
  - format         → prettier --check
  - audit          → npm audit --audit-level=high

Stage 2: test (sequential after Stage 1)
  services:
    postgres:15    → hotelcrm_test DB
    redis:7        → test cache

  steps:
    - migrate      → prisma migrate deploy
    - unit-tests   → jest --testPathPattern=unit --coverage
    - int-tests    → jest --testPathPattern=integration
    - e2e-tests    → jest --testPathPattern=e2e

  coverage gate:
    lines: 80%
    branches: 70%

Stage 3: build (sequential after Stage 2)
  - build          → tsc -p tsconfig.build.json
  - docker-build   → docker build --target production
  - docker-scan    → trivy image scan (CRITICAL fail)

Stage 4: report
  - upload coverage to Codecov
  - comment PR with test summary
```

#### `deploy-staging.yml` — Runs on merge to `develop`

```yaml
Stage 1: build
  - build production Docker image
  - tag: ghcr.io/deepak525kumar/hotel-crm/backend:staging-<sha>
  - push to GitHub Container Registry

Stage 2: migrate
  - connect to DO staging cluster
  - run: prisma migrate deploy
  - verify migration count matches expected

Stage 3: deploy
  - rolling update to staging app (1 replica)
  - health check: GET /health → 200 within 60s
  - smoke test: GET /api/v1/status → 200

Stage 4: notify
  - Slack message: staging deployed + SHA + migration count
```

#### `deploy-prod.yml` — Runs on merge to `main` (manual approval required)

```yaml
Stage 1: pre-flight
  - require manual approval from 2 reviewers
  - verify staging smoke tests passed
  - check no pending migrations drift

Stage 2: backup
  - trigger DigitalOcean DB backup snapshot
  - wait for snapshot confirmation

Stage 3: migrate
  - connect to DO production cluster
  - run: prisma migrate deploy
  - rollback trigger: if exit code != 0, alert + halt

Stage 4: deploy
  - blue/green deploy to production (2 replicas)
  - health check with 3-minute timeout
  - rollback: if health fails, revert deployment

Stage 5: verify
  - smoke tests against production
  - Sentry deployment marker created
  - Slack: production deployed + SHA
```

#### `cron-maintenance.yml` — Runs daily at 02:00 UTC

```yaml
- check-expiring-documents    → HrService.checkExpiringDocuments()
- cleanup-expired-sessions    → delete Sessions where expires_at < now
- archive-old-audit-logs      → move 2yr+ logs to cold storage table
- gdpr-retention-check        → DataRetentionLog review
```

### 6.2 Docker Build Stages

```dockerfile
Stage 1: deps
  FROM node:20-alpine
  COPY package*.json
  RUN npm ci --only=production

Stage 2: builder
  FROM node:20-alpine
  COPY . .
  RUN npm ci && npx tsc -p tsconfig.build.json

Stage 3: runner (production)
  FROM node:20-alpine
  COPY --from=deps /app/node_modules
  COPY --from=builder /app/dist
  COPY --from=builder /app/prisma
  RUN npx prisma generate
  CMD ["node", "dist/server.js"]
```

### 6.3 Environment Promotion

```
local dev  →  docker-compose up (postgres + redis + mailhog)
             ↓ merge PR
develop    →  staging (DigitalOcean App, 1 replica, shared DB)
             ↓ manual approval
main       →  production (DigitalOcean App, 2 replicas, managed DB)
```

---

## 7. SPRINT BREAKDOWN

Sprint length: 2 weeks. Each sprint has a P0 gate — nothing merges to `develop` unless P0 tasks are complete and tested.

---

### SPRINT 1: Foundation + Auth
**Goal:** Working auth API, token flow, environment validated end-to-end.

| Task | Owner Area | Files | Est |
|------|-----------|-------|-----|
| S1-1 | Implement `AuthService.signup()` | `auth/service.ts` | 4h |
| S1-2 | Implement `AuthService.login()` | `auth/service.ts` | 2h |
| S1-3 | Implement `AuthService.refreshToken()` | `auth/service.ts` | 2h |
| S1-4 | Implement `AuthService.logout()` | `auth/service.ts` | 1h |
| S1-5 | Implement `AuthService.getProfile()` | `auth/service.ts` | 1h |
| S1-6 | Implement `AuthService.updateProfile()` | `auth/service.ts` | 2h |
| S1-7 | Wire auth controller methods to services | `auth/controller.ts` | 3h |
| S1-8 | Add Zod validation schemas for auth DTOs | `auth/types.ts` | 2h |
| S1-9 | Write auth integration tests (Layers 1+2) | `test/auth/` | 6h |
| S1-10 | Setup GitHub Actions CI (`ci.yml`) | `.github/workflows/` | 4h |
| S1-11 | Run migrations 001 + seed data | `prisma/` | 1h |
| S1-12 | P0 gate: all auth tests green + CI passes | — | — |

**Sprint 1 Deliverable:** `POST /auth/signup`, `POST /auth/login`, `POST /auth/refresh`, `GET /me`, `POST /auth/logout` all working with JWT.

---

### SPRINT 2: CRM Core
**Goal:** Hotels and rooms CRUD, task creation and status flow.

| Task | Owner Area | Files | Est |
|------|-----------|-------|-----|
| S2-1 | Run migrations 002 + 003 | `prisma/` | 1h |
| S2-2 | Implement `CrmService.listHotels()` + `createHotel()` | `crm/service.ts` | 3h |
| S2-3 | Implement `CrmService.getHotel()` + `updateHotel()` | `crm/service.ts` | 2h |
| S2-4 | Implement `CrmService.listRooms()` + `createRoom()` + `updateRoom()` | `crm/service.ts` | 4h |
| S2-5 | Implement `CrmService.listTasks()` + `createTask()` | `crm/service.ts` | 4h |
| S2-6 | Implement `CrmService.getTask()` + `updateTask()` status machine | `crm/service.ts` | 3h |
| S2-7 | DigitalOcean Spaces client setup | `lib/storage.ts` | 3h |
| S2-8 | Implement `CrmService.uploadTaskPhoto()` | `crm/service.ts` | 3h |
| S2-9 | Wire CRM controllers | `crm/controller.ts` | 4h |
| S2-10 | Add Zod schemas for all CRM DTOs | `crm/types.ts` | 3h |
| S2-11 | Hotel scope enforcement tests | `test/crm/` | 5h |
| S2-12 | Task status transition tests | `test/crm/tasks.test.ts` | 3h |
| S2-13 | P0 gate: all CRM tests green | — | — |

**Sprint 2 Deliverable:** Full hotel/room/task CRUD with permission scoping and photo upload.

---

### SPRINT 3: Staffing Marketplace
**Goal:** Work request lifecycle, worker assignment, shift start/complete.

| Task | Owner Area | Files | Est |
|------|-----------|-------|-----|
| S3-1 | Run migration 004 | `prisma/` | 1h |
| S3-2 | Implement `StaffingService.listWorkRequests()` + `createWorkRequest()` | `staffing/service.ts` | 4h |
| S3-3 | Implement `StaffingService.getAvailableWorkers()` | `staffing/service.ts` | 3h |
| S3-4 | Implement `StaffingService.assignWorkers()` with capacity guard | `staffing/service.ts` | 4h |
| S3-5 | Implement `StaffingService.startAssignment()` + `completeAssignment()` | `staffing/service.ts` | 3h |
| S3-6 | Implement `StaffingService.listAssignments()` | `staffing/service.ts` | 2h |
| S3-7 | Wire staffing controllers | `staffing/controller.ts` | 3h |
| S3-8 | Zod schemas for staffing DTOs | `staffing/types.ts` | 2h |
| S3-9 | Write staffing integration tests (Layer 4) | `test/staffing/` | 6h |
| S3-10 | E2E Scenario C test (staffing marketplace) | `test/e2e/` | 4h |
| S3-11 | P0 gate: staffing tests + E2E Scenario C green | — | — |

**Sprint 3 Deliverable:** Full staffing marketplace — post request, find workers, assign, track.

---

### SPRINT 4: Quality + HR
**Goal:** Verification flow, worker ratings, leaderboard, contracts and payroll.

| Task | Owner Area | Files | Est |
|------|-----------|-------|-----|
| S4-1 | Run migrations 005, 006, 007, 008 | `prisma/` | 1h |
| S4-2 | Implement `QualityService` (all 7 methods) | `quality/service.ts` | 8h |
| S4-3 | Wire quality controllers | `quality/controller.ts` | 2h |
| S4-4 | Write quality tests (Layer 5) | `test/quality/` | 5h |
| S4-5 | AES-256 encryption utility for payroll | `lib/crypto.ts` | 3h |
| S4-6 | Implement `HrService` contracts (methods 1–7) | `hr/service.ts` | 8h |
| S4-7 | Implement `HrService` payroll (methods 8–11) | `hr/service.ts` | 6h |
| S4-8 | Implement `HrService` documents (methods 12–14) | `hr/service.ts` | 4h |
| S4-9 | Wire HR controllers | `hr/controller.ts` | 3h |
| S4-10 | Write HR tests (Layer 6) | `test/hr/` | 8h |
| S4-11 | E2E Scenario B (HR workflow) | `test/e2e/` | 4h |
| S4-12 | P0 gate: quality + HR tests + E2E B green | — | — |

**Sprint 4 Deliverable:** Quality verification, leaderboard, contracts, encrypted payroll, document management.

---

### SPRINT 5: Notifications + Analytics + Calendar
**Goal:** Notification dispatch wired into all writers, analytics dashboard, calendar ops.

| Task | Owner Area | Files | Est |
|------|-----------|-------|-----|
| S5-1 | Run migrations 009 + 010 | `prisma/` | 0.5h |
| S5-2 | Implement `NotificationService.create()` + `sendEmail()` + `sendPush()` | `notifications/service.ts` | 6h |
| S5-3 | Wire notification dispatches in CRM, Staffing, HR, Quality services | all services | 5h |
| S5-4 | Implement notification API (list, mark read, mark all) | `notifications/service.ts` | 3h |
| S5-5 | Wire notification controller | `notifications/controller.ts` | 2h |
| S5-6 | Implement `AnalyticsService` (all 4 methods) | `analytics/service.ts` | 5h |
| S5-7 | Wire analytics controller | `analytics/controller.ts` | 1h |
| S5-8 | Implement `CalendarService` (all 3 methods) | `calendar/service.ts` | 4h |
| S5-9 | Wire calendar controller | `calendar/controller.ts` | 1h |
| S5-10 | Write notification tests (Layer 7) | `test/notifications/` | 4h |
| S5-11 | Write analytics + calendar tests (Layer 8) | `test/analytics/`, `test/calendar/` | 3h |
| S5-12 | Add SendGrid/Resend email templates | `lib/email-templates/` | 4h |
| S5-13 | Configure APNS + Firebase push credentials | `lib/push.ts` | 3h |
| S5-14 | E2E Scenario A (full task lifecycle) | `test/e2e/` | 4h |
| S5-15 | P0 gate: all Layer 7+8 tests + E2E A green | — | — |

**Sprint 5 Deliverable:** Fully wired notification system, analytics dashboard endpoint, calendar operations.

---

### SPRINT 6: Security, Compliance & Production Hardening
**Goal:** RBAC matrix verified, audit logs complete, GDPR compliant, prod deploy.

| Task | Owner Area | Files | Est |
|------|-----------|-------|-----|
| S6-1 | Run migration 011 (perf indexes) | `prisma/` | 0.5h |
| S6-2 | Add Helmet.js security headers | `app.ts` | 1h |
| S6-3 | Add rate limiting (100 req/min per IP) via `express-rate-limit` | `middleware/rateLimit.ts` | 2h |
| S6-4 | Restrict CORS to production domains only | `app.ts` | 1h |
| S6-5 | Add Sentry error tracking + deployment markers | `lib/sentry.ts` | 3h |
| S6-6 | RBAC matrix integration test (Layer 9) | `test/rbac/` | 8h |
| S6-7 | Audit log completeness test (all 23 mutation types logged) | `test/compliance/` | 4h |
| S6-8 | GDPR consent flow test | `test/compliance/` | 2h |
| S6-9 | DataRetentionLog cron job test | `test/cron/` | 2h |
| S6-10 | Implement cron maintenance jobs | `src/cron/` | 4h |
| S6-11 | Setup `deploy-staging.yml` + first staging deploy | `.github/workflows/` | 4h |
| S6-12 | Setup `deploy-prod.yml` with manual approval gate | `.github/workflows/` | 3h |
| S6-13 | Setup `cron-maintenance.yml` | `.github/workflows/` | 2h |
| S6-14 | Production secrets setup in DigitalOcean | DO dashboard | 2h |
| S6-15 | Load test: 100 concurrent users for 5min (k6) | `test/load/` | 4h |
| S6-16 | P0 gate: RBAC matrix 100% pass + staging deploy green | — | — |

**Sprint 6 Deliverable:** Production-hardened backend. Staging live. Production deploy pipeline ready.

---

## SPRINT SUMMARY

| Sprint | Weeks | Focus | P0 Gate |
|--------|-------|-------|---------|
| 1 | 1–2 | Auth + CI setup | Auth tests green |
| 2 | 3–4 | CRM core | CRM tests + hotel scoping |
| 3 | 5–6 | Staffing marketplace | E2E Scenario C |
| 4 | 7–8 | Quality + HR | E2E Scenario B |
| 5 | 9–10 | Notifications + Analytics | E2E Scenario A |
| 6 | 11–12 | Security + Production | RBAC matrix + staging live |

**Total estimated: 12 weeks (3 sprints to MVP, 6 sprints to production)**

MVP milestone (end Sprint 3): Auth + CRM + Staffing = core marketplace running.

---

## APPENDIX: TASK FILE MAPPING

```
backend/src/
├── lib/
│   ├── storage.ts          → S3/DO Spaces client          [Sprint 2]
│   ├── crypto.ts           → AES-256 encrypt/decrypt      [Sprint 4]
│   ├── email-templates/    → HTML email templates         [Sprint 5]
│   ├── push.ts             → APNS + FCM dispatch          [Sprint 5]
│   └── sentry.ts           → Sentry init                  [Sprint 6]
├── middleware/
│   └── rateLimit.ts        → express-rate-limit           [Sprint 6]
├── cron/
│   ├── expiring-docs.ts    → 30-day document warnings     [Sprint 5]
│   ├── session-cleanup.ts  → expired session purge        [Sprint 6]
│   └── gdpr-retention.ts   → DataRetentionLog check       [Sprint 6]
└── modules/
    ├── auth/service.ts     → [Sprint 1]
    ├── crm/service.ts      → [Sprint 2]
    ├── staffing/service.ts → [Sprint 3]
    ├── quality/service.ts  → [Sprint 4]
    ├── hr/service.ts       → [Sprint 4]
    ├── notifications/service.ts → [Sprint 5]
    ├── analytics/service.ts → [Sprint 5]
    └── calendar/service.ts → [Sprint 5]

test/
├── infra/          → Layer 1 [Sprint 1]
├── auth/           → Layer 2 [Sprint 1]
├── crm/            → Layer 3 [Sprint 2]
├── staffing/       → Layer 4 [Sprint 3]
├── quality/        → Layer 5 [Sprint 4]
├── hr/             → Layer 6 [Sprint 4]
├── notifications/  → Layer 7 [Sprint 5]
├── analytics/      → Layer 8 [Sprint 5]
├── calendar/       → Layer 8 [Sprint 5]
├── rbac/           → Layer 9 [Sprint 6]
├── compliance/     → Layer 10 [Sprint 6]
├── e2e/            → Layer 10 [Sprint 3–5]
├── cron/           → [Sprint 6]
└── load/           → [Sprint 6]
```
