# Implementation Process

**Source**: MASTER_ARCHITECTURE_v2.0 Section 15  
**Status**: MVP Phase 1 (6-8 weeks)  
**Tier Approach**: Demo-Ready → Stable MVP → Production

---

## 🎯 Phase 1 Timeline Overview

### Tier 1: Demo-Ready (Week 4)
- **Deliverable**: Working MVP for client presentation
- **Acceptance**: Core features functional, may have rough edges
- **Target Users**: Internal team + client demo

### Tier 2: Stable MVP (Weeks 5-8)
- **Deliverable**: Production-ready for single hotel
- **Acceptance**: All edge cases handled, tested, hardened
- **Target Users**: Real hotel staff (small group)

### Tier 3: Production (Optional, Weeks 8-10)
- **Deliverable**: Full production deployment
- **Acceptance**: Load tested, security audited, DR tested
- **Target Users**: All hotels on platform

**Official Timeline**: 6-8 weeks (Tier 1 + Tier 2)  
**Demo Checkpoint**: End of Week 4 (Tier 1)

---

## 📋 Module Implementation Order

### Why This Order?

1. **Auth First**: Everything depends on authentication
2. **CRM (Hotels) Second**: Base entity for all operations
3. **CRM (Tasks) Third**: Core workflow
4. **Quality Fourth**: Task completion verification
5. **HR Fifth**: Worker data management (smaller scope)
6. **Staffing Sixth**: Complex concurrency logic (isolated at end)
7. **Notifications Last**: Triggers from all other modules

---

## 🔐 Week 1: Foundation + Auth + Hotels

### Monday: Project Setup & Database

**Tasks**:
- [ ] Verify Prisma schema is in place
- [ ] Verify `.env` with DATABASE_URL (DigitalOcean PostgreSQL)
- [ ] Run `npx prisma migrate dev` to create tables
- [ ] Verify connection: `npx prisma db push`
- [ ] Open `npx prisma studio` and confirm all 23 tables exist

**Deliverable**: Working database, all tables present

**Time**: 2 hours

---

### Monday-Tuesday: Auth Module

**Requirements** (from API_STANDARDS.md + RBAC_PERMISSION_MATRIX.md):
- POST /auth/signup (open endpoint)
- POST /auth/login (open endpoint)
- POST /auth/refresh (authenticated)
- GET /auth/me (authenticated)
- PUT /auth/profile (authenticated)
- JWT tokens (1h access, 7d refresh)
- Role-based user roles (WORKER, CHECKER, MANAGER, ADMIN)

**Implementation Checklist**:
- [ ] Setup middleware: `authenticateJWT` (verify JWT)
- [ ] Setup middleware: `validateRequest` (Zod validation)
- [ ] Create auth controller with 5 endpoints
- [ ] Hash passwords with bcrypt (minimum 10 rounds)
- [ ] Generate JWT on login (sign with JWT_SECRET)
- [ ] Store refresh token in sessions table
- [ ] Return access + refresh tokens to client
- [ ] Test: signup → login → refresh → me endpoint

**Database Relations**:
- User (1) ← → (N) Session

**File Structure**:
```
backend/src/modules/auth/
├── routes.ts       (5 routes)
├── controller.ts   (5 endpoint handlers)
├── service.ts      (business logic: hash, verify, tokens)
├── model.ts        (DB queries via Prisma)
└── types.ts        (TypeScript types: LoginRequest, etc)
```

**Testing**:
- [ ] POST /signup with valid email → 201 Created
- [ ] POST /signup with duplicate email → 400 Bad Request
- [ ] POST /login with correct password → 200 + tokens
- [ ] POST /login with wrong password → 401 Unauthorized
- [ ] GET /me without token → 401 Unauthorized
- [ ] GET /me with valid token → 200 + user data
- [ ] POST /refresh with valid refresh token → 200 + new access token

**Effort**: 4-6 hours

---

### Wednesday: Hotels Module

**Requirements** (from API_STANDARDS.md):
- GET /hotels (list manager's hotels or all if admin)
- POST /hotels (create hotel, admin only)
- GET /hotels/:id (get hotel, manager or admin)
- PUT /hotels/:id (update hotel, manager or admin)

**Implementation Checklist**:
- [ ] Create Hotel controller with 4 endpoints
- [ ] Middleware: `requireRole(['MANAGER', 'ADMIN'])`
- [ ] Middleware: `requireHotelScope()` (manager sees own hotels only)
- [ ] GET /hotels: filter by user.hotel_ids if manager
- [ ] POST /hotels: admin only, create new hotel
- [ ] Test hotel scoping: manager can't see other hotels

**Database Relations**:
- Hotel (1) ← → (N) Rooms
- Hotel (1) ← → (N) Tasks
- User (manager): hotel_ids field stores array of hotel IDs

**File Structure**:
```
backend/src/modules/crm/
├── routes.ts       (Hotels, Rooms, Tasks routes)
├── hotels/
│   ├── controller.ts   (4 hotel endpoints)
│   ├── service.ts
│   ├── model.ts
│   └── types.ts
├── rooms/
│   ├── controller.ts   (room endpoints)
│   ├── service.ts
│   ├── model.ts
│   └── types.ts
└── tasks/
    ├── controller.ts   (task endpoints)
    ├── service.ts
    ├── model.ts
    └── types.ts
```

**Permission Matrix** (from RBAC_PERMISSION_MATRIX.md):
| Endpoint | Worker | Checker | Manager | Admin |
|----------|--------|---------|---------|-------|
| GET /hotels | ❌ | ❌ | ✅* | ✅ |
| POST /hotels | ❌ | ❌ | ❌ | ✅ |
| GET /hotels/:id | ❌ | ❌ | ✅* | ✅ |

**Testing**:
- [ ] Worker: GET /hotels → 403 Forbidden
- [ ] Manager: GET /hotels → 200, see only own hotels
- [ ] Admin: GET /hotels → 200, see all hotels
- [ ] Manager: GET /other-hotel → 403 Forbidden
- [ ] Admin: POST /hotels → 201 Created

**Effort**: 3-4 hours

**Cumulative**: 7-10 hours

---

### Thursday-Friday: Rooms Module

**Requirements**:
- GET /hotels/:id/rooms (list rooms in hotel)
- POST /hotels/:id/rooms (create room)
- GET /rooms/:id (get room)
- PUT /rooms/:id (update room status: clean/dirty/occupied/maintenance)

**Implementation Checklist**:
- [ ] Create Room controller with 4 endpoints
- [ ] Validate hotel_id ownership (manager or admin only)
- [ ] Unique constraint check: (hotel_id, number) must be unique
- [ ] Room status validation (clean|dirty|occupied|maintenance)
- [ ] Test: Manager can create room only for own hotel

**Database Relations**:
- Hotel (1) ← → (N) Rooms
- Room (1) ← → (N) Tasks
- Unique: (hotel_id, room_number)

**Permission Matrix**:
| Endpoint | Worker | Checker | Manager | Admin |
|----------|--------|---------|---------|-------|
| GET /rooms | ✅* | ✅* | ✅* | ✅ |
| POST /rooms | ❌ | ❌ | ✅* | ✅ |

**Testing**:
- [ ] GET /rooms for non-existent hotel → 404
- [ ] Manager: POST room to own hotel → 201
- [ ] Manager: POST room to other hotel → 403
- [ ] Worker: GET room list for their hotel → 200
- [ ] Duplicate room number in hotel → 400 Conflict

**Effort**: 2-3 hours

**Cumulative by Friday**: 9-13 hours

---

## 📌 Week 2: Tasks + Quality + Photos

### Monday-Tuesday: Tasks Module

**Requirements**:
- POST /tasks (create task, manager only)
- GET /tasks (list tasks, filtered by role)
- GET /tasks/:id (get task details)
- PUT /tasks/:id/complete (complete task, worker only)

**Implementation Checklist**:
- [ ] Create Task controller with 4 endpoints
- [ ] Task status enum: ASSIGNED → IN_PROGRESS → COMPLETED
- [ ] Manager: POST /tasks creates with status ASSIGNED
- [ ] Worker: sees only assigned tasks
- [ ] Checker: sees all tasks (for verification)
- [ ] Test: Worker completes task, checker verifies

**Database Relations**:
- Hotel (1) ← → (N) Tasks
- Room (1) ← → (N) Tasks
- Task (1) ← → (N) TaskPhotos
- User (manager) creates task
- User (worker) assigned task
- Task (1) ← → (1) QualityVerification (optional)

**Permission Matrix** (Task Endpoints):
| Endpoint | Worker | Checker | Manager | Admin |
|----------|--------|---------|---------|-------|
| POST /tasks | ❌ | ❌ | ✅* | ✅ |
| GET /tasks | ✅* | ✅* | ✅* | ✅ |
| PUT /tasks/:id/complete | ✅* | ❌ | ✅ | ✅ |

**Status Transitions**:
```
ASSIGNED (created by manager)
   ↓
IN_PROGRESS (worker starts work)
   ↓
COMPLETED (worker finishes, uploads photos)
   ↓
(Checker verifies and rates)
```

**Testing**:
- [ ] Manager: POST /tasks → 201, status ASSIGNED
- [ ] Worker: GET /tasks → 200, only own tasks
- [ ] Worker: PUT /tasks/:id/complete → 200, status COMPLETED
- [ ] Checker: GET /tasks → 200, all tasks
- [ ] Worker: cannot POST /tasks → 403

**Effort**: 4-5 hours

---

### Tuesday-Wednesday: Photo Upload

**Requirements**:
- POST /tasks/:id/photos (upload task photo)
- Photos stored in DigitalOcean Spaces (encrypted)

**Implementation Checklist**:
- [ ] Setup DigitalOcean Spaces credentials (DO_SPACES_KEY, etc)
- [ ] Create multipart/form-data handler
- [ ] Upload file to Spaces: `hotelcrm-uploads/tasks/:task-id/:filename`
- [ ] Store URL in task_photos table
- [ ] Return photo URL to client
- [ ] Test: Upload 3 photos, verify in Spaces

**File Storage**:
- Bucket: `hotelcrm-uploads`
- Path: `tasks/{task-id}/{timestamp}-{filename}`
- Permissions: Private (authenticated reads only)
- CDN: Via Cloudflare

**Permission Matrix**:
| Endpoint | Worker | Checker | Manager | Admin |
|----------|--------|---------|---------|-------|
| POST /photos | ✅* | ❌ | ✅ | ✅ |

**Testing**:
- [ ] POST /photos with JPG → 201, URL returned
- [ ] POST /photos with invalid file → 400 Bad Request
- [ ] Unauth user: POST /photos → 401
- [ ] Verify photo accessible via returned URL

**Effort**: 2-3 hours

---

### Wednesday-Friday: Quality Module

**Requirements**:
- POST /quality/verifications (submit verification, checker only)
- POST /quality/ratings (rate worker, checker only)
- GET /quality/leaderboard (public, all authenticated)

**Implementation Checklist**:
- [ ] Checker views completed task with photos
- [ ] Checker scores 0-100 (QualityVerification)
- [ ] Checker rates worker 0-100 (Rating)
- [ ] System auto-aggregates WorkerOverallRating
- [ ] Leaderboard sorted by avg_rating DESC
- [ ] Test: Verify → Rate → Leaderboard updates

**Database Relations**:
- Task (1) ← → (1) QualityVerification
- Task (1) ← → (1) Rating
- Worker (1) ← → (1) WorkerOverallRating
- Leaderboard: Join Rating + User, aggregate

**Permission Matrix**:
| Endpoint | Worker | Checker | Manager | Admin |
|----------|--------|---------|---------|-------|
| POST /verifications | ❌ | ✅ | ❌ | ❌ |
| POST /ratings | ❌ | ✅ | ❌ | ❌ |
| GET /leaderboard | ✅ | ✅ | ✅ | ✅ |

**Aggregation Logic**:
```sql
-- Auto-calculated after each rating
UPDATE worker_overall_rating 
SET 
  average_rating = (SELECT AVG(score) FROM ratings WHERE given_to_id = worker_id),
  total_ratings = (SELECT COUNT(*) FROM ratings WHERE given_to_id = worker_id),
  last_updated = NOW()
WHERE worker_id = ?;

-- Leaderboard query
SELECT wor.*, u.first_name, u.last_name
FROM worker_overall_rating wor
JOIN users u ON wor.worker_id = u.id
WHERE u.deleted_at IS NULL
ORDER BY wor.average_rating DESC
LIMIT 100;
```

**Testing**:
- [ ] Checker: POST /verifications → 201
- [ ] Checker: POST /ratings → 201
- [ ] GET /leaderboard → 200, sorted by rating
- [ ] Worker not in leaderboard if no ratings
- [ ] Leaderboard updates after each rating
- [ ] Worker: cannot POST /verifications → 403

**Effort**: 3-4 hours

**Cumulative by Friday**: 9-12 hours  
**Total Week 2**: 13-17 hours  
**TIER 1 CHECKPOINT (Week 4)**: All above complete ✅

---

## 🏢 Week 3: HR Module

### Monday-Tuesday: Contracts

**Requirements**:
- GET /contracts (list contracts)
- POST /contracts (create contract with template)
- GET /contracts/:id (view contract)
- PUT /contracts/:id (update contract)

**Implementation Checklist**:
- [ ] Create ContractTemplate (admin/manager sets up once)
- [ ] Contract references template_id
- [ ] Status: draft → signed → active → expired
- [ ] Encryption: document_url encrypted at-rest
- [ ] Soft delete: deleted_at timestamp
- [ ] Test: Manager creates contract from template

**Database Relations**:
- ContractTemplate (1) ← → (N) Contracts
- User (worker) ← → (N) Contracts
- Hotel (1) ← → (N) Contracts

**Permission Matrix**:
| Endpoint | Worker | Checker | Manager | Admin |
|----------|--------|---------|---------|-------|
| GET /contracts | ✅* | ❌ | ✅* | ✅ |
| POST /contracts | ❌ | ❌ | ✅* | ✅ |

**Scoping Rules**:
- Worker: sees own contracts only
- Manager: sees contracts for workers at own hotels only
- Admin: sees all contracts

**Testing**:
- [ ] Manager: POST /contracts → 201, status draft
- [ ] Manager: PUT /contracts → status signed
- [ ] Worker: GET own contracts → 200
- [ ] Worker: GET other worker's contracts → 403
- [ ] Admin: GET all contracts → 200

**Effort**: 3-4 hours

---

### Tuesday-Wednesday: Documents

**Requirements**:
- GET /documents (list worker documents)
- POST /documents (upload document, manager)
- DELETE /documents/:id (delete after expiry)

**Implementation Checklist**:
- [ ] Document types: passport, visa, work_permit, certification, etc
- [ ] Store in DO Spaces encrypted
- [ ] Track expiry_date for auto-deletion
- [ ] Soft delete with deleted_at
- [ ] Encryption: AES-256-GCM for sensitive docs
- [ ] Test: Upload passport, verify storage

**Database Relations**:
- Worker (1) ← → (N) WorkerDocuments
- Hotel (1) ← → (N) WorkerDocuments (scoping)

**Permission Matrix**:
| Endpoint | Worker | Checker | Manager | Admin |
|----------|--------|---------|---------|-------|
| GET /documents | ✅* | ❌ | ✅* | ✅ |
| POST /documents | ❌ | ❌ | ✅* | ✅ |
| DELETE /documents | ❌ | ❌ | ✅* | ✅ |

**Testing**:
- [ ] Manager: POST /documents → 201, file in Spaces
- [ ] Worker: GET own documents → 200
- [ ] Delete: only after expiry_date passed
- [ ] Soft delete: deleted_at set, document hidden

**Effort**: 2-3 hours

---

### Wednesday-Friday: Payroll

**Requirements**:
- GET /payroll (list payroll records)
- POST /payroll (create payroll, manager)
- GET /payroll/:id (view payroll, encrypted)

**Implementation Checklist**:
- [ ] Payroll: status draft → calculated → approved → paid
- [ ] Encryption: AES-256-GCM stored in DB
- [ ] Key: in environment only, never logged
- [ ] Decryption: in-memory only
- [ ] Line items: hours, deductions, taxes
- [ ] Audit log: EVERY access logged
- [ ] 7-year retention: never deletable
- [ ] Test: Create payroll, view (encrypted), audit log

**Database Relations**:
- Worker (1) ← → (N) Payroll
- Hotel (1) ← → (N) Payroll
- Payroll (1) ← → (N) PayrollLineItems

**Permission Matrix**:
| Endpoint | Worker | Checker | Manager | Admin |
|----------|--------|---------|---------|-------|
| GET /payroll | ✅* | ❌ | ✅* | ✅ |
| POST /payroll | ❌ | ❌ | ✅* | ✅ |

**Encryption Implementation**:
```typescript
// Encrypt on save
const encrypted = await encryptAES256(JSON.stringify({
  salary: 2500,
  deductions: 250,
  taxes: 500
}));

await db.payroll.create({
  data: {
    worker_id: workerId,
    encrypted_data: encrypted,
    encryption_key_id: 'v1'  // Reference to key version
  }
});

// Decrypt on read (in-memory only)
const encrypted = payroll.encrypted_data;
const decrypted = await decryptAES256(encrypted);
const data = JSON.parse(decrypted);

// Never log decrypted data
logger.info('Payroll viewed', { worker_id, timestamp });  // ✅ Safe
logger.info('Payroll viewed', { ...data });  // ❌ Never do this
```

**Audit Logging** (must log):
- Who viewed payroll
- When
- From what IP
- No decrypted content in logs

**Testing**:
- [ ] Manager: POST /payroll → 201
- [ ] Worker: GET own payroll → 200, decrypted view
- [ ] Worker: GET other payroll → 403
- [ ] Audit log: verify every access logged
- [ ] Encryption: verify DB stores encrypted bytes
- [ ] Cannot delete payroll (7yr retention enforced)

**Effort**: 4-5 hours

**Cumulative Week 3**: 9-12 hours  
**TIER 2 BEGINS** (Weeks 5-8): All above hardened

---

## 👷 Week 4: Staffing Module (Complex Concurrency)

### Monday-Wednesday: Work Requests + Assignments

**Requirements** (MOST COMPLEX):
- POST /work-requests (create, manager)
- GET /available-workers (list free workers)
- POST /assign-workers (assign, MUST BE TRANSACTIONAL)

**CRITICAL: Concurrency Safety**

**Problem**: Two managers both try to assign same worker at same time.

**Solution**: Database transaction + lock
```typescript
async function assignWorker(workRequestId, workerId, managerId) {
  return await db.$transaction(async (tx) => {
    // LOCK: Prevent concurrent assignments
    const existingAssignment = await tx.workerAssignments.findFirst({
      where: {
        worker_id: workerId,
        status: { in: ['ASSIGNED', 'IN_PROGRESS'] }
      }
    });

    // CHECK: If worker already assigned, fail gracefully
    if (existingAssignment) {
      throw new ConflictError(
        `Worker already assigned. Available after: ${existingAssignment.completed_at}`
      );
    }

    // CREATE: New assignment (only if check passed)
    const assignment = await tx.workerAssignments.create({
      data: {
        worker_id: workerId,
        work_request_id: workRequestId,
        assigned_by_manager_id: managerId,
        status: 'ASSIGNED',
        assigned_at: new Date()
      }
    });

    // UPDATE: Work request status
    const workRequest = await tx.workRequests.findUnique({
      where: { id: workRequestId },
      include: {
        _count: {
          select: {
            worker_assignments: {
              where: { status: { in: ['ASSIGNED', 'IN_PROGRESS'] } }
            }
          }
        }
      }
    });

    const filled = workRequest._count.worker_assignments;
    const needed = workRequest.workers_needed;

    if (filled >= needed) {
      await tx.workRequests.update({
        where: { id: workRequestId },
        data: { status: 'FILLED', filled_at: new Date() }
      });
    }

    return assignment;
  });
}
```

**Implementation Checklist**:
- [ ] WorkRequest status: OPEN → PARTIALLY_FILLED → FILLED
- [ ] Assignment status: ASSIGNED → IN_PROGRESS → COMPLETED
- [ ] Unique constraint: (worker_id, status) WHERE status IN (ASSIGNED, IN_PROGRESS)
- [ ] Transaction with lock on worker_assignments
- [ ] Test: Concurrent assignment attempts (should only 1 succeed)

**Database Relations**:
- Hotel (1) ← → (N) WorkRequests
- WorkRequest (1) ← → (N) WorkerAssignments
- User (worker) ← → (N) WorkerAssignments
- User (manager) creates WorkRequest

**Permission Matrix**:
| Endpoint | Worker | Checker | Manager | Admin |
|----------|--------|---------|---------|-------|
| POST /work-requests | ❌ | ❌ | ✅* | ✅ |
| GET /available-workers | ❌ | ❌ | ✅* | ✅ |
| POST /assign-workers | ❌ | ❌ | ✅* | ✅ |

**CRITICAL RULE** (from MASTER_ARCHITECTURE):
> **Workers do NOT see room numbers in work requests**
> - Workers see: hotel, date, time, position, duration
> - Workers do NOT see: room numbers, specific tasks
> - Manager assigns rooms AFTER worker accepts (manual/email)

**Testing**:
- [ ] Concurrent assignment: Manager 1 assigns, Manager 2 gets error
- [ ] Worker sees availability (no room details)
- [ ] WorkRequest filled when workers_needed met
- [ ] Transactional safety: no orphaned data
- [ ] Cannot assign worker already assigned

**Effort**: 6-8 hours (most complex)

---

### Thursday-Friday: Daily Operations

**Requirements**:
- POST /operations (create daily operation after assignment)
- GET /operations (list operations)

**Implementation Checklist**:
- [ ] Daily operation: actual room assignment (AFTER work accepted)
- [ ] Manager fills in room_number, room_type, tasks
- [ ] Link to WorkerAssignment
- [ ] Status: ASSIGNED → IN_PROGRESS → COMPLETED
- [ ] Test: Create operation, worker sees it

**Database Relations**:
- WorkerAssignment (1) ← → (N) DailyOperations
- Room (1) ← → (N) DailyOperations

**Permission Matrix**:
| Endpoint | Worker | Checker | Manager | Admin |
|----------|--------|---------|---------|-------|
| POST /operations | ❌ | ❌ | ✅* | ✅ |
| GET /operations | ✅ | ✅ | ✅ | ✅ |

**Testing**:
- [ ] Manager: POST /operations → 201
- [ ] Worker: GET operations → see assigned rooms
- [ ] Update status as work progresses

**Effort**: 2-3 hours

**Cumulative Week 4**: 8-11 hours  
**TIER 1 COMPLETE BY FRIDAY (Week 4 end)** ✅

---

## 🔔 Week 5-6: Notifications + Polish

### Notifications Implementation

**Requirements** (from API_STANDARDS.md):
- Trigger notifications on events (task assigned, verified, rated)
- Send via multiple channels: APNs (iOS), FCM (Android), email, in-app

**Implementation Checklist**:
- [ ] Notification service (listens to events)
- [ ] APNs integration (Apple Push)
- [ ] FCM integration (Firebase Cloud Messaging)
- [ ] Email service (SendGrid/Resend)
- [ ] In-app notifications (database store)
- [ ] Mark as read endpoint
- [ ] Test: Task assigned → worker receives push

**Effort**: 4-5 hours

---

### Testing & Hardening

**Testing Checklist**:
- [ ] All endpoints: auth, permissions, validation
- [ ] Edge cases: concurrent assignments, task status transitions
- [ ] Error handling: 400, 401, 403, 404, 409, 500
- [ ] Database constraints: unique, foreign keys, cascades
- [ ] Performance: queries under 100ms (add indexes if needed)

**Error Handling**:
- [ ] Global error middleware catches all exceptions
- [ ] Consistent error response format
- [ ] Detailed errors in dev, generic in prod
- [ ] Logging of all errors to Sentry

**Logging**:
- [ ] Winston logger configured
- [ ] Request ID on every log entry
- [ ] Structured JSON logs
- [ ] Different log levels (debug, info, warn, error)

**Effort**: 4-6 hours

---

## 📊 Module Dependency Graph

```
Auth (Week 1)
├── ✅ No dependencies

Hotels (Week 1)
├── Requires: Auth

Rooms (Week 1)
├── Requires: Auth, Hotels

Tasks (Week 2)
├── Requires: Auth, Hotels, Rooms

Photos (Week 2)
├── Requires: Auth, Tasks

Quality (Week 2)
├── Requires: Auth, Tasks

Contracts (Week 3)
├── Requires: Auth, Hotels

Documents (Week 3)
├── Requires: Auth, Hotels

Payroll (Week 3)
├── Requires: Auth, Hotels

WorkRequests (Week 4)
├── Requires: Auth, Hotels

Assignments (Week 4)
├── Requires: Auth, Hotels, Workers (Tasks assigns workers)

DailyOperations (Week 4)
├── Requires: Auth, Hotels, Rooms, Assignments

Notifications (Week 5)
├── Requires: All above (triggers from all modules)
```

---

## ✅ Success Criteria by Tier

### TIER 1 (Week 4): Demo-Ready

**Must Have**:
- ✅ Auth: signup, login, JWT, roles
- ✅ Hotels: list, create, view
- ✅ Rooms: list, create, view
- ✅ Tasks: create, assign, complete (with photos)
- ✅ Quality: verify, rate, leaderboard
- ✅ Mobile: worker + checker role UIs
- ✅ Frontend: dashboard showing tasks

**Known Limitations** (OK for demo):
- ⚠️ No notifications yet (can be added week 5)
- ⚠️ No HR module (can be added week 3)
- ⚠️ No staffing (can be added week 4)
- ⚠️ Edge cases may not be handled
- ⚠️ Performance not optimized

**Demo Checklist**:
- [ ] Manager logs in → sees hotels
- [ ] Manager creates task → assigns worker
- [ ] Worker logs in → sees task
- [ ] Worker completes task with photos
- [ ] Checker logs in → verifies task
- [ ] Checker rates worker → leaderboard updates
- [ ] Worker sees new rating in app

---

### TIER 2 (Weeks 5-8): Stable MVP

**Must Have** (all Tier 1 + hardening + HR + Staffing):
- ✅ All Tier 1 features
- ✅ HR: contracts, documents, payroll
- ✅ Staffing: work requests, assignments (with concurrency safety)
- ✅ Notifications: APNs, FCM, email, in-app
- ✅ Error handling: comprehensive
- ✅ Testing: all endpoints tested
- ✅ Logging: Winston + request IDs
- ✅ Performance: queries indexed, <500ms response
- ✅ Security: GDPR basics, audit logging, encryption

**Hardening Checklist**:
- [ ] Edge cases handled (concurrent assignments, status transitions)
- [ ] Input validation: Zod on all endpoints
- [ ] Permission enforcement: every endpoint checked
- [ ] Database constraints: unique, foreign keys, cascades
- [ ] Error messages: helpful but not exposing internals
- [ ] Logging: all sensitive actions logged
- [ ] Monitoring: Sentry configured, health checks working
- [ ] Encryption: payroll encrypted, docs encrypted

**Deployment Checklist**:
- [ ] Environment variables: all secrets in .env, not in code
- [ ] Database: migrations applied, indices created
- [ ] API: all endpoints responding correctly
- [ ] Auth: JWT working, refresh tokens working
- [ ] Roles: each role can only access permitted endpoints
- [ ] Hotel scoping: managers see only own hotels
- [ ] Notifications: push working on iOS and Android
- [ ] File storage: photos in DO Spaces, accessible

**Operations Checklist**:
- [ ] Monitoring: error tracking (Sentry) set up
- [ ] Logging: structured logs (Winston) configured
- [ ] Backups: database backups automated
- [ ] Health check: endpoint returns 200 OK
- [ ] Rate limiting: 100 req/min per IP enforced

**Ready For**:
- Single hotel operations
- 50-200 concurrent users
- Limited scale testing
- Client pilot deployment

---

### TIER 3 (Weeks 8-10, Optional): Production

**Must Have** (all Tier 2 + production hardening):
- ✅ Load testing: verified for 500+ concurrent users
- ✅ Security review: passed penetration testing
- ✅ Disaster recovery: backup/restore tested
- ✅ Team training: ops team trained, runbooks written
- ✅ On-call setup: incident response process ready

**Production Checklist**:
- [ ] Load test: simulate 500 concurrent users
- [ ] Latency: p95 response time <500ms
- [ ] Database: slow query log reviewed, indices optimized
- [ ] Security: SQL injection, XSS, CSRF checked
- [ ] HTTPS: SSL certificate valid
- [ ] GDPR: compliance audit passed
- [ ] Backup: test restore from backup
- [ ] Failover: database replica failover tested
- [ ] Monitoring: alerts configured for critical errors
- [ ] Team: on-call rotation established

**Production Runbooks**:
- [ ] How to roll back a release
- [ ] How to scale up (add servers)
- [ ] How to troubleshoot slow API
- [ ] How to investigate security incident
- [ ] How to restore from backup
- [ ] How to handle database failover

---

## 🚀 Weekly Standup Questions

**Daily (4 PM IST)**:
- "Is what I'm building in the MVP scope?"
  - Feature: ✅ In MASTER_ARCHITECTURE Section 4
  - Database table: ✅ In MASTER_ARCHITECTURE Section 7
  - Timeline: ✅ In MASTER_ARCHITECTURE Section 15
  - Answer all 3 → Build it. If any "No" → Escalate

**Friday (3 PM IST)**:
- "What's the status of my module?"
  - Routes: X% complete
  - Controller: X% complete
  - Service: X% complete
  - Tests: X% complete
  - Blockers: [list]

---

## 📝 Implementation Notes

1. **One module at a time**: Don't work on Auth + Hotels simultaneously
2. **Tests as you go**: Write tests for each endpoint before moving on
3. **Commit frequently**: Small commits are easier to debug
4. **Review code**: Have someone review before merging
5. **Documentation**: Update README as you add modules
6. **Performance**: Profile queries, add indices if needed
7. **Error handling**: Handle edge cases, test error paths
8. **Security**: Check permissions on every endpoint

---

## 🎯 Metrics

**Code Quality**:
- TypeScript strict mode: enabled
- Linting: ESLint passing
- Type coverage: 100% in modules
- Test coverage: 80%+ for critical paths

**Performance**:
- API response: <500ms p95
- Database query: <100ms p95
- Endpoint throughput: 100+ req/sec per server

**Reliability**:
- Error rate: <0.1%
- Availability: 99.9%
- MTTR (mean time to recover): <1 hour
