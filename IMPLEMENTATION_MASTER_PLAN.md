# IMPLEMENTATION MASTER PLAN
**Hotel CRM — MVP**
**Version**: 1.0
**Date**: 2026-06-08
**Status**: APPROVED FOR EXECUTION

---

## EXECUTIVE SUMMARY

This document is the single source of truth for executing the Hotel CRM MVP. Architecture decisions are frozen for the modules listed below. Engineers execute against this plan without redesigning.

**Stack**: Node.js + Express + TypeScript + Prisma + PostgreSQL (backend) · React Native + Expo (mobile) · Next.js + TailwindCSS (web)
**Target**: DigitalOcean Frankfurt · Single-droplet modular monolith
**MVP Timeline**: 6 weeks from sprint start

---

## 1. FINAL MODULE DEPENDENCY GRAPH

```
┌─────────────────────────────────────────────────────────────┐
│                      LAYER 0 — FROZEN                        │
│                                                             │
│   ┌─────────┐    ┌──────────────────┐    ┌─────────────┐   │
│   │  Auth   │    │     Hotels       │    │   Workers   │   │
│   │(User,   │    │(Hotel, Room,     │    │(User WORKER │   │
│   │Session) │    │ Task, TaskPhoto) │    │   role)     │   │
│   └────┬────┘    └────────┬─────────┘    └──────┬──────┘   │
└────────┼─────────────────┼──────────────────────┼──────────┘
         │                 │                      │
         └────────────────►▼◄─────────────────────┘
                           │
┌──────────────────────────▼──────────────────────────────────┐
│                    LAYER 1 — STAFFING                        │
│                                                             │
│   ┌──────────────┐          ┌──────────────────────┐        │
│   │ WorkRequest  │─────────►│   WorkerAssignment   │        │
│   │(Manager post │          │(Worker assigned to   │        │
│   │  a shift)    │          │    a request)        │        │
│   └──────────────┘          └──────────┬───────────┘        │
└─────────────────────────────────────────┼───────────────────┘
                                          │
┌─────────────────────────────────────────▼───────────────────┐
│                    LAYER 2 — OPERATIONS                      │
│                                                             │
│   ┌──────────────────┐       ┌──────────────────────┐       │
│   │  DailyOperation  │       │      Attendance      │       │
│   │  (room-level     │       │  (start/complete     │       │
│   │   work item)     │       │   assignment clock)  │       │
│   └──────────────────┘       └──────────────────────┘       │
└─────────────────────────────────────────────────────────────┘
                                          │
┌─────────────────────────────────────────▼───────────────────┐
│                    LAYER 3 — QUALITY                         │
│                                                             │
│   ┌──────────────────────┐    ┌───────────────────────┐     │
│   │  QualityVerification │    │        Rating         │     │
│   │  (Checker scores     │    │  (Checker rates       │     │
│   │   completed task)    │    │   worker 0-5)         │     │
│   └──────────────────────┘    └───────────────────────┘     │
└─────────────────────────────────────────────────────────────┘
                                          │
┌─────────────────────────────────────────▼───────────────────┐
│                    LAYER 4 — SUPPORT                         │
│   Notifications · Calendar · Analytics · HR (Contracts,     │
│   Payroll, Documents)                                        │
└─────────────────────────────────────────────────────────────┘
```

### Dependency Rules
- Nothing in Layer N may reference a model from Layer N+1.
- `Auth` is imported by every module — never the reverse.
- `Notifications` is a write-only dependency: any module may emit a notification, no module reads from Notifications.
- `AuditLog` is write-only from any service via `BaseService`.
- `HR` (Contracts, Payroll, Documents) is parallel to Staffing/Quality — no cross-dependency.

---

## 2. BACKEND IMPLEMENTATION ORDER

Each item is a discrete unit of work: schema confirmed → service implemented → controller wired → route tested.

### Phase A — Foundation (Week 1, Days 1–3)
These must be complete before any feature work begins.

| # | Task | File(s) | Effort |
|---|------|---------|--------|
| A1 | Install missing production dependencies | `backend/package.json` | 0.5d |
| A2 | Run first Prisma migration (`db:migrate dev`) | `prisma/migrations/` | 0.5d |
| A3 | Seed script: hotels, users (all roles), rooms | `prisma/seed.ts` | 1d |
| A4 | Complete Auth service (signup, login, refresh, logout, /me, profile update) | `modules/auth/service.ts` | 1d |
| A5 | Validate Auth end-to-end with JWT middleware | `modules/auth/`, `middleware/auth.ts` | 0.5d |

**Missing dependencies to install (A1)**:
```
bcrypt @types/bcrypt          # password hashing
helmet                        # security headers
express-rate-limit            # rate limiting
multer @types/multer          # file upload
aws-sdk / @aws-sdk/client-s3  # DO Spaces (S3-compatible)
@sendgrid/mail                # email
node-cron                     # scheduled jobs (document expiry, payroll reminders)
jest @types/jest ts-jest supertest @types/supertest  # testing
```

### Phase B — Hotels & CRM Core (Week 1, Days 4–5)

| # | Task | File(s) | Effort |
|---|------|---------|--------|
| B1 | Hotel CRUD (list, get, create, update, deactivate) | `modules/crm/service.ts` | 1d |
| B2 | Room CRUD (list by hotel, get, create, update status) | `modules/crm/service.ts` | 0.5d |
| B3 | Task CRUD (create, assign, list by hotel/worker, update status) | `modules/crm/service.ts` | 1d |
| B4 | TaskPhoto upload to DO Spaces (before/after) | `modules/crm/service.ts` | 0.5d |

### Phase C — Staffing Module (Week 2)

| # | Task | File(s) | Effort |
|---|------|---------|--------|
| C1 | WorkRequest: create, list (by hotel, by status), cancel | `modules/staffing/service.ts` | 1d |
| C2 | Available workers query (no conflicting ASSIGNED/IN_PROGRESS assignment on that date) | `modules/staffing/service.ts` | 1d |
| C3 | WorkerAssignment: assign workers to request, auto-update request status (OPEN→PARTIALLY_FILLED→FILLED) | `modules/staffing/service.ts` | 1d |
| C4 | Assignment lifecycle: start (`IN_PROGRESS`), complete (`COMPLETED`) | `modules/staffing/service.ts` | 0.5d |
| C5 | Reassignment: cancel existing, create new with `previous_assignment_id` | `modules/staffing/service.ts` | 0.5d |
| C6 | DailyOperation: create per room from assignment, update status | `modules/calendar/service.ts` | 1d |

### Phase D — Quality Module (Week 3, Days 1–3)

| # | Task | File(s) | Effort |
|---|------|---------|--------|
| D1 | QualityVerification: submit score (0–100), link to task, enforce one-per-task | `modules/quality/service.ts` | 1d |
| D2 | Rating: submit 0–5 score for worker per task, enforce one-per-task | `modules/quality/service.ts` | 0.5d |
| D3 | WorkerOverallRating: recalculate aggregate on every new rating (upsert) | `modules/quality/service.ts` | 0.5d |
| D4 | Leaderboard: global + by-hotel, sorted by average score | `modules/quality/service.ts` | 0.5d |

### Phase E — Notifications (Week 3, Days 4–5)

| # | Task | File(s) | Effort |
|---|------|---------|--------|
| E1 | Notification service: `emit()` creates DB record + triggers push/email async | `modules/notifications/service.ts` | 1d |
| E2 | Wire notifications into: task assigned, quality verified, rating received, assignment started/completed | All services | 0.5d |
| E3 | Push notification delivery (APNS + FCM) — device token storage on User model or separate table | `modules/notifications/service.ts` | 1d |

### Phase F — Analytics & Calendar (Week 4, Days 1–2)

| # | Task | File(s) | Effort |
|---|------|---------|--------|
| F1 | Analytics: dashboard stats (tasks today, workers on shift, rooms cleaned, verifications pending) | `modules/analytics/service.ts` | 1d |
| F2 | Calendar: daily operations view (hotel + date filter, grouped by room) | `modules/calendar/service.ts` | 0.5d |

### Phase G — HR Module (Week 4, Days 3–5)

| # | Task | File(s) | Effort |
|---|------|---------|--------|
| G1 | Contract CRUD (create from template, sign, expire, terminate) | `modules/hr/service.ts` | 1d |
| G2 | ContractTemplate CRUD | `modules/hr/service.ts` | 0.5d |
| G3 | WorkerDocument upload (encrypted URL to DO Spaces, SHA-256 hash) | `modules/hr/service.ts` | 1d |
| G4 | Payroll: create, approve, pay (AES-256 encryption of sensitive fields) | `modules/hr/service.ts` | 1d |
| G5 | Document expiry cron job (daily check → emit notifications) | `modules/hr/service.ts` | 0.5d |
| G6 | DataRetentionLog: create on contract/payroll creation, cron for GDPR deletion reminders | `modules/hr/service.ts` | 0.5d |

### Phase H — Security Hardening (Week 5, Day 1)

| # | Task | File(s) | Effort |
|---|------|---------|--------|
| H1 | Helmet.js headers, CORS lockdown, rate limiting on auth endpoints | `app.ts`, `middleware/` | 0.5d |
| H2 | Input sanitization review (Zod schemas on all request bodies) | All controllers | 0.5d |
| H3 | Audit log wired into HR and payroll read/download operations | `modules/hr/service.ts` | 0.5d |

---

## 3. MOBILE IMPLEMENTATION ORDER

> **Architecture note**: The current repo has two separate apps (`worker-app`, `checker-app`). These should be **merged into one app** with role-based navigation switching before feature work begins. This is a Day 1 mobile task.

### Phase M0 — Consolidation (Week 1)

| # | Task | Effort |
|---|------|--------|
| M0.1 | Merge worker-app and checker-app into single `mobile/app` with Expo Router role guard | 1d |
| M0.2 | API client setup: Axios or fetch wrapper, base URL config, JWT attach via interceptor | 0.5d |
| M0.3 | Auth store (Zustand): login, logout, token refresh, persist to SecureStore | 1d |
| M0.4 | Login screen, role-based root redirect (Worker → worker tabs, Checker → checker tabs) | 0.5d |
| M0.5 | Remove Supabase dependency — replace with direct API calls to Express backend | 0.5d |

### Phase M1 — Worker Screens (Week 2–3)

| # | Screen | Depends On | Effort |
|---|--------|------------|--------|
| M1.1 | Home: today's assignment summary (shift date, hotel, rooms count) | C3, C4 | 0.5d |
| M1.2 | Assignment detail: shift info, start button | C4 | 0.5d |
| M1.3 | Room list: rooms for current assignment, tap to open task | C6 | 0.5d |
| M1.4 | Task detail: description, status, start/complete buttons | B3 | 0.5d |
| M1.5 | Photo capture: camera → upload before/after photos | B4 | 1d |
| M1.6 | My ratings: personal leaderboard position, score history | D3, D4 | 0.5d |
| M1.7 | Notification list + mark read | E1, E2 | 0.5d |

### Phase M2 — Checker Screens (Week 3–4)

| # | Screen | Depends On | Effort |
|---|--------|------------|--------|
| M2.1 | Home: list of completed tasks pending verification (hotel filter) | D1 | 0.5d |
| M2.2 | Task verification: view photos, enter quality score 0–100, notes, submit | D1 | 1d |
| M2.3 | Worker rating: 0–5 stars, optional comment, submit | D2 | 0.5d |
| M2.4 | Leaderboard: hotel leaderboard sorted by rating | D4 | 0.5d |
| M2.5 | Notification list | E1 | 0.5d |

### Phase M3 — Manager Screens (Week 4–5)
> Manager UI is lower priority for MVP mobile. If time-constrained, defer M3 to web frontend.

| # | Screen | Depends On | Effort |
|---|--------|------------|--------|
| M3.1 | Work request creation (date, shift times, workers needed, position) | C1 | 1d |
| M3.2 | Worker assignment (select from available workers list) | C2, C3 | 1d |
| M3.3 | Daily operations calendar view | F2 | 0.5d |
| M3.4 | Analytics dashboard (tasks today, pending verifications, leaderboard) | F1 | 0.5d |

---

## 4. DATABASE MIGRATION ORDER

All migrations are generated by Prisma (`prisma migrate dev --name <slug>`). Execute in this order.

| # | Migration Name | Tables Created/Modified | When |
|---|---------------|------------------------|------|
| 001 | `init_auth` | User, Session | Week 1, Day 1 |
| 002 | `init_hotels` | Hotel, Room | Week 1, Day 1 |
| 003 | `init_tasks` | Task, TaskPhoto | Week 1, Day 1 |
| 004 | `init_quality` | QualityVerification, Rating, WorkerOverallRating | Week 1, Day 1 |
| 005 | `init_staffing` | WorkRequest, WorkerAssignment, DailyOperation | Week 1, Day 1 |
| 006 | `init_hr` | Contract, ContractTemplate, ContractLineItem, WorkerDocument, RequiredDocument, Payroll, PayrollLineItem, DataRetentionLog | Week 1, Day 1 |
| 007 | `init_support` | Notification, AuditLog, ConsentLog | Week 1, Day 1 |
| 008 | `add_device_tokens` | Add `device_token`, `device_platform` to User | Week 3 (before push notifications) |
| 009 | `add_indexes` | Composite indexes: (hotel_id, status), (worker_id, shift_date), (task_id, status) for query performance | Week 5 |

**Note**: Migrations 001–007 can all be run as one initial migration since no data exists yet. Split them logically for documentation purposes. In practice: `prisma migrate dev --name init_all` creates all tables in one pass.

**Production promotion**: Never run `db:push` in production. Always `prisma migrate deploy` (applies pending migrations without prompting).

---

## 5. API ROLLOUT ORDER

APIs are released in groups matching backend phases. "Released" means: implemented, tested, and documented.

### Group 1 — Auth (Week 1)
```
POST   /api/v1/auth/signup
POST   /api/v1/auth/login
POST   /api/v1/auth/refresh
POST   /api/v1/auth/logout
GET    /api/v1/auth/me
PUT    /api/v1/auth/profile
```

### Group 2 — Hotels & Tasks (Week 1–2)
```
GET    /api/v1/crm/hotels
POST   /api/v1/crm/hotels
GET    /api/v1/crm/hotels/:hotel_id
GET    /api/v1/crm/hotels/:hotel_id/rooms
POST   /api/v1/crm/hotels/:hotel_id/rooms
PATCH  /api/v1/crm/rooms/:room_id/status
POST   /api/v1/crm/hotels/:hotel_id/tasks
GET    /api/v1/crm/hotels/:hotel_id/tasks
GET    /api/v1/crm/tasks/:task_id
PATCH  /api/v1/crm/tasks/:task_id/status
POST   /api/v1/crm/tasks/:task_id/photos
```

### Group 3 — Staffing (Week 2)
```
POST   /api/v1/staffing/work-requests
GET    /api/v1/staffing/work-requests              (filter: hotel_id, status, date)
GET    /api/v1/staffing/work-requests/:id
PATCH  /api/v1/staffing/work-requests/:id/cancel
GET    /api/v1/staffing/available-workers          (?hotel_id=&date=)
POST   /api/v1/staffing/work-requests/:id/assign-workers
POST   /api/v1/staffing/assignments/:id/start
POST   /api/v1/staffing/assignments/:id/complete
POST   /api/v1/staffing/assignments/:id/reassign
GET    /api/v1/staffing/assignments/:id
```

### Group 4 — Quality (Week 3)
```
POST   /api/v1/quality/verifications
GET    /api/v1/quality/verifications/:task_id
POST   /api/v1/quality/ratings
GET    /api/v1/quality/ratings/worker/:worker_id
GET    /api/v1/quality/leaderboard
GET    /api/v1/quality/leaderboard/by-hotel/:hotel_id
```

### Group 5 — Notifications (Week 3)
```
GET    /api/v1/notifications
POST   /api/v1/notifications/:id/read
POST   /api/v1/notifications/read-all
```

### Group 6 — Calendar & Analytics (Week 4)
```
GET    /api/v1/calendar/hotels/:hotel_id/operations   (?date=)
POST   /api/v1/calendar/hotels/:hotel_id/operations
GET    /api/v1/analytics/stats
GET    /api/v1/analytics/hotel-summary/:hotel_id
GET    /api/v1/analytics/leaderboard
```

### Group 7 — HR (Week 4)
```
GET    /api/v1/hr/contracts
POST   /api/v1/hr/contracts
GET    /api/v1/hr/contracts/:id
PATCH  /api/v1/hr/contracts/:id/sign
PATCH  /api/v1/hr/contracts/:id/terminate
GET    /api/v1/hr/contract-templates
POST   /api/v1/hr/contract-templates
POST   /api/v1/hr/workers/:worker_id/documents
GET    /api/v1/hr/workers/:worker_id/documents
DELETE /api/v1/hr/documents/:id
GET    /api/v1/hr/payroll
POST   /api/v1/hr/payroll
PATCH  /api/v1/hr/payroll/:id/approve
PATCH  /api/v1/hr/payroll/:id/pay
```

---

## 6. TESTING STRATEGY

### Framework Setup (Phase A — do this first)
```bash
# Install
npm install --save-dev jest @types/jest ts-jest supertest @types/supertest

# jest.config.ts
{
  preset: 'ts-jest',
  testEnvironment: 'node',
  coverageThreshold: { global: { lines: 80 } },
  setupFilesAfterFramework: ['./tests/setup.ts']
}
```

Use a **separate test database** (`DATABASE_URL_TEST` in `.env.test`). Never run tests against dev or production DB.

### Test Pyramid

**Unit Tests** (70% of test effort)
- One `*.service.test.ts` per module
- Mock Prisma client using `jest.mock('../lib/db')`
- Test: business logic, validation rules, error cases, permission checks
- Target: every public method in every service

**Integration Tests** (25% of test effort)
- One `*.routes.test.ts` per module using Supertest
- Real database (test DB, reset between test suites with `prisma migrate reset`)
- Test: full request → response cycle, auth middleware, RBAC enforcement, 4xx/5xx responses
- Critical flows to cover:
  - Full staffing flow: create request → assign workers → start → complete
  - Full quality flow: complete task → verify → rate → check leaderboard updated
  - Auth flow: signup → login → refresh → logout

**E2E Tests** (5% — Phase 2, post-MVP)
- Deferred. Document as tech debt at MVP completion.

### Test Execution
```bash
npm test               # Run all tests
npm run test:watch     # Watch mode for development
npm run test:coverage  # Coverage report (must be ≥80%)
npm run test:integration  # Integration tests only (slower, requires DB)
```

### Testing Per Module Priority

| Priority | Module | Rationale |
|----------|--------|-----------|
| P0 | Auth | Everything depends on it |
| P0 | Staffing (WorkRequest, Assignment) | Core business logic, double-booking guard |
| P1 | Quality (Verification, Rating, Leaderboard) | Score calculation correctness |
| P1 | Notifications | Silent failures are hard to debug |
| P2 | HR | Complex encryption, GDPR rules |
| P2 | CRM (Hotels, Tasks) | Simpler CRUD |
| P3 | Analytics, Calendar | Read-only, lower risk |

---

## 7. CRITICAL PATH

The critical path is the sequence where any delay directly delays MVP launch.

```
Week 1:  A1 (deps) → A2 (migrations) → A3 (seed) → A4 (auth service) → A5 (auth e2e)
           └── B1 (hotels) → B2 (rooms) → B3 (tasks)

Week 2:  C1 (work requests) → C2 (available workers) → C3 (assignments) → C4 (lifecycle)
           └── M0 (mobile consolidation) → M1.1–M1.4 (worker screens)

Week 3:  D1 (quality verification) → D2 (rating) → D3 (aggregates) → D4 (leaderboard)
           └── E1 (notifications) → E2 (wire notifications)
           └── M1.5 (photo capture) → M2.1–M2.3 (checker screens)

Week 4:  F1 (analytics) → F2 (calendar) → G1–G4 (HR core)
           └── M2.4 (leaderboard) → M3.1–M3.2 (manager screens)

Week 5:  H1–H3 (security hardening) → Integration test pass → Staging deploy
           └── QA regression sweep

Week 6:  Bug fixes → Performance review → Production deploy → Smoke tests
```

**Single longest chain** (nothing can be parallelized here):
`Auth → WorkRequest → WorkerAssignment → Task → QualityVerification → Rating → Leaderboard`

This chain must never slip. All other modules are parallel opportunities.

---

## 8. PARALLELIZATION OPPORTUNITIES

These workstreams can run simultaneously once the Foundation (Phase A) is complete.

### After Week 1 Foundation

| Track | Owner | Work |
|-------|-------|------|
| **Track BE-1** | Backend Eng 1 | Staffing module (C1–C6) |
| **Track BE-2** | Backend Eng 2 | HR module (G1–G6) — no dependency on Staffing |
| **Track MOB** | Mobile Eng | Mobile consolidation + Auth screens (M0, M1.1–M1.4) |
| **Track QA** | QA Eng | Auth + CRM test suite while backend builds Staffing |

### After Week 2 Staffing Complete

| Track | Owner | Work |
|-------|-------|------|
| **Track BE-1** | Backend Eng 1 | Quality module (D1–D4) |
| **Track BE-2** | Backend Eng 2 | Notifications + Analytics (E1–E3, F1–F2) |
| **Track MOB** | Mobile Eng | Worker screens M1.5–M1.7, Checker screens M2.1–M2.3 |
| **Track QA** | QA Eng | Staffing integration tests |

### Independent at Any Time
- Database index optimization (Migration 009) — can be done any week
- Frontend web scaffolding — completely independent of mobile
- DevOps: staging environment setup on DigitalOcean — no code dependency
- Documentation: API_STANDARDS.md, RBAC_PERMISSION_MATRIX.md — no code dependency

---

## 9. TEAM ASSIGNMENTS

Assumes a team of 4: 2 Backend Engineers, 1 Mobile Engineer, 1 QA Engineer.

### Backend Engineer 1 — Core & Staffing
**Weeks 1–2**: Foundation (A1–A5), Hotels/CRM (B1–B4), Staffing (C1–C6)
**Weeks 3–4**: Quality (D1–D4), Calendar/Analytics (F1–F2)
**Week 5**: Integration support, bug fixes
**Owns**: `modules/auth`, `modules/crm`, `modules/staffing`, `modules/quality`, `modules/calendar`, `modules/analytics`

### Backend Engineer 2 — HR & Notifications
**Week 1**: Participates in Foundation (A1–A3 jointly), begins HR schema review
**Weeks 2–3**: HR module (G1–G6), Notifications (E1–E3)
**Week 4**: Security hardening (H1–H3), missing API endpoints, integration gaps
**Week 5**: DevOps — Docker production config, DigitalOcean setup, CI pipeline
**Owns**: `modules/hr`, `modules/notifications`, deployment config, security middleware

### Mobile Engineer — Apps
**Week 1**: Mobile consolidation + API client + Auth (M0)
**Weeks 2–3**: Worker screens (M1.1–M1.7), photo upload
**Weeks 3–4**: Checker screens (M2.1–M2.5)
**Week 4–5**: Manager screens (M3.1–M3.4), notification handling
**Owns**: `mobile/app` (unified), all screens, Zustand stores, API integration layer

### QA Engineer — Testing & Validation
**Week 1**: Set up Jest/Supertest framework, write Auth test suite
**Week 2**: CRM + Staffing test suites
**Week 3**: Quality + Notifications test suites
**Week 4**: HR test suite, end-to-end staging test flows
**Week 5**: Full regression pass on staging, performance baseline, security scan
**Owns**: `backend/tests/`, test database setup, CI test integration

---

## 10. RISK ANALYSIS

### R1 — Double-booking Race Condition (HIGH)
**Risk**: Two managers assign the same worker simultaneously, violating the unique constraint on `(worker_id, status IN (ASSIGNED, IN_PROGRESS))`.
**Mitigation**: Enforce at DB level (existing partial unique index). Backend service must catch `P2002` Prisma unique constraint error and return HTTP 409. Write a concurrent integration test.
**Owner**: Backend Eng 1 · **Week**: 2

### R2 — Push Notification Complexity (MEDIUM)
**Risk**: APNS (iOS) and FCM (Android) require separate credentials, certificate management, and error handling. Failures are silent.
**Mitigation**: Implement push as fire-and-forget with structured error logging. Notification is already persisted in DB before push attempt — app can always poll. Set up APNS sandbox for testing in Week 3.
**Owner**: Backend Eng 2 · **Week**: 3

### R3 — Payroll Encryption Key Management (MEDIUM)
**Risk**: AES-256 encryption of payroll fields requires key rotation strategy. Lost key = lost data. Wrong implementation = false security.
**Mitigation**: Use `encryption_key_id` field (already in schema) to version keys. Store keys in environment variables initially (not DB). Document key rotation procedure before Week 4.
**Owner**: Backend Eng 2 · **Week**: 4

### R4 — Mobile App Merger Regression (MEDIUM)
**Risk**: Merging worker-app and checker-app into one app could break existing (minimal) scaffolding and delay Week 2 feature work.
**Mitigation**: Merger is Day 1 mobile task. If it takes more than 1.5 days, abort and keep two apps with shared `packages/` workspace for API client and stores.
**Owner**: Mobile Eng · **Week**: 1

### R5 — Scope Creep on HR Module (LOW-MEDIUM)
**Risk**: HR (contracts, payroll, documents) is complex and has GDPR requirements. Can expand indefinitely.
**Mitigation**: MVP scope is strictly: create, upload, list, approve, pay. No contract PDF generation, no automated payroll calculation. Those are Phase 2.
**Owner**: Backend Eng 2 · **Week**: 4

### R6 — DigitalOcean Spaces Latency (LOW)
**Risk**: Photo uploads from mobile to DO Spaces (Frankfurt) could be slow for workers in poor connectivity.
**Mitigation**: Upload photos asynchronously — mark task as completable without photos, upload in background. Implement client-side retry with exponential backoff.
**Owner**: Mobile Eng · **Week**: 3

### R7 — Supabase Dependency in Mobile (LOW)
**Risk**: `@supabase/supabase-js` is installed in both mobile apps despite the architecture decision to use the Express monolith. Unused code, potential confusion.
**Mitigation**: Remove during M0.5 (Week 1). Zero functional risk — it's not wired up.
**Owner**: Mobile Eng · **Week**: 1

---

## 11. DEFINITION OF MVP COMPLETE

MVP is complete when **all** of the following are true:

### Functional Completeness
- [ ] A Manager can create a hotel and add rooms
- [ ] A Manager can create a WorkRequest (shift) for a date and time
- [ ] A Manager can see available workers and assign them to a WorkRequest
- [ ] A Worker receives a push notification when assigned to a shift
- [ ] A Worker can start and complete their assignment via the mobile app
- [ ] A Worker can view room tasks and mark them complete
- [ ] A Worker can upload before/after photos for a task
- [ ] A Checker can see completed tasks pending verification
- [ ] A Checker can submit a quality score (0–100) for a completed task
- [ ] A Checker can rate a worker (0–5) after verification
- [ ] Worker leaderboard is visible and correctly ranked by average rating
- [ ] Managers can upload and view worker HR documents (passport, work permit)
- [ ] Managers can create contracts and mark them as signed
- [ ] All users receive in-app notifications for relevant events

### Technical Completeness
- [ ] All API endpoints return correct HTTP status codes and consistent response envelope
- [ ] JWT authentication and RBAC enforced on all protected routes
- [ ] Hotel scoping enforced (managers/workers cannot access data from other hotels)
- [ ] Database migrations applied cleanly from zero on a fresh environment
- [ ] Test coverage ≥ 80% on backend service layer
- [ ] All integration tests pass on CI
- [ ] No `throw new Error('Not implemented')` remaining in any service
- [ ] Zod validation on all request bodies
- [ ] AuditLog written for all HR data access operations
- [ ] Payroll data encrypted at rest

### Operational Completeness
- [ ] Staging environment running on DigitalOcean (separate from production)
- [ ] `.env.example` updated with all required variables
- [ ] `README.md` updated with current setup instructions
- [ ] Production deploy runbook documented (migrations, env vars, startup)
- [ ] Error alerting configured (Sentry DSN or equivalent)

---

## 12. PRODUCTION READINESS CHECKLIST

### Infrastructure
- [ ] DigitalOcean Managed PostgreSQL 15 provisioned (Frankfurt)
- [ ] DigitalOcean Redis 7 provisioned (Frankfurt)
- [ ] DigitalOcean Spaces bucket created (`hotel-crm-prod`) with CDN enabled
- [ ] DigitalOcean Droplet or App Platform configured (min 2GB RAM)
- [ ] Nginx reverse proxy configured with SSL termination (Let's Encrypt)
- [ ] Cloudflare DNS pointed at Droplet IP
- [ ] Firewall rules: only ports 80, 443, 22 open

### Application
- [ ] `NODE_ENV=production` set
- [ ] `JWT_SECRET` is ≥ 64 characters, randomly generated, stored in secrets manager
- [ ] `DATABASE_URL` uses SSL (`?sslmode=require`)
- [ ] All optional env vars from `.env.example` populated
- [ ] `npm run build` produces clean TypeScript compile (zero errors)
- [ ] `prisma migrate deploy` run (NOT `db:push`)
- [ ] Database seeded with at minimum one admin user and one hotel

### Security
- [ ] Helmet.js enabled (sets X-Frame-Options, CSP, HSTS headers)
- [ ] Rate limiting on `/api/v1/auth/*` (max 10 req/min per IP)
- [ ] CORS `origin` set to production domain only (not `*`)
- [ ] Passwords hashed with bcrypt (cost factor ≥ 12)
- [ ] DO Spaces bucket is private (no public ACL on sensitive documents)
- [ ] Presigned URLs used for document/photo access (not permanent public links)
- [ ] `console.log` replaced by Winston logger (no secrets in logs)

### Observability
- [ ] Health check endpoint `/api/v1/health` returns 200 with DB connectivity check
- [ ] Structured JSON logs flowing to DigitalOcean log sink or Papertrail
- [ ] Sentry DSN configured (or equivalent error tracking)
- [ ] Uptime monitoring configured (UptimeRobot or DigitalOcean uptime)
- [ ] Database connection pool size set (`connection_limit=10` in DATABASE_URL)

### Mobile Release
- [ ] Expo EAS Build configured for production
- [ ] `app.json` production bundle identifier set (`com.hotelcrm.app`)
- [ ] API base URL points to production (`https://api.hotelcrm.com`)
- [ ] TestFlight (iOS) and Play Console internal track (Android) builds submitted
- [ ] APNS production certificate configured in EAS secrets
- [ ] FCM server key configured in EAS secrets

### GDPR / Compliance
- [ ] Privacy policy URL accessible from app
- [ ] ConsentLog written on first login (PRIVACY_POLICY, HR_DATA_PROCESSING)
- [ ] DataRetentionLog entries created for every new contract and payroll record
- [ ] Document expiry cron job running (daily)
- [ ] Data deletion procedure documented and tested

### Runbook
- [ ] Deploy procedure: `git pull → npm run build → prisma migrate deploy → pm2 restart`
- [ ] Rollback procedure: `pm2 restart` with previous build
- [ ] Database backup: DigitalOcean Managed DB daily backups confirmed enabled
- [ ] On-call contact list defined

---

## EFFORT ESTIMATES

### Development Effort

| Module | Backend | Mobile | Total |
|--------|---------|--------|-------|
| Foundation (deps, migrations, seed) | 3d | — | 3d |
| Auth | 1d | 2d | 3d |
| Hotels / CRM | 3d | 2d | 5d |
| Staffing (WorkRequest, Assignment) | 4d | 3d | 7d |
| Quality (Verification, Rating, Leaderboard) | 3d | 2d | 5d |
| Notifications | 2.5d | 1d | 3.5d |
| Calendar & Analytics | 1.5d | 1d | 2.5d |
| HR (Contracts, Payroll, Documents) | 5d | 1d | 6d |
| Security Hardening | 1.5d | — | 1.5d |
| Mobile Consolidation | — | 3d | 3d |
| Manager Screens (mobile) | — | 3d | 3d |
| **Total** | **25.5d** | **18d** | **43.5d** |

**Team-days**: ~44 engineer-days across 4 engineers ≈ **6 calendar weeks** (allowing 20% buffer for integration, reviews, rework).

### QA Effort

| Activity | Effort |
|----------|--------|
| Test framework setup + Auth suite | 2d |
| CRM + Staffing test suites | 3d |
| Quality + Notifications test suites | 2d |
| HR test suite | 2d |
| Full staging regression pass | 3d |
| Performance baseline + security scan | 1d |
| Bug verification cycle | 2d |
| **Total QA** | **15d** |

### Deployment Effort

| Activity | Effort |
|----------|--------|
| Staging environment setup (DigitalOcean, Nginx, SSL) | 1d |
| CI/CD pipeline (GitHub Actions: test → build → deploy to staging) | 1d |
| Production environment provisioning | 0.5d |
| Production deploy + smoke tests | 0.5d |
| EAS Build setup + first TestFlight/Play Console submit | 1d |
| **Total Deployment** | **4d** |

### Grand Total
| Category | Effort |
|----------|--------|
| Development | 43.5 engineer-days |
| QA | 15 engineer-days |
| Deployment | 4 engineer-days |
| **Total** | **~62.5 engineer-days** |

At 4 engineers × 6 weeks × 5 days = 120 available engineer-days. **MVP uses ~52% of capacity**, leaving buffer for bugs, reviews, and scope discovered during implementation.

---

## APPENDIX: PENDING FINALIZATION

The following modules have architectural decisions pending. No implementation should begin until the decision is recorded here.

| Module | Open Question | Decision Needed By |
|--------|--------------|-------------------|
| **WorkApplication** | Schema shows no `WorkApplication` model — workers are directly assigned. Is there a worker self-application flow, or is it always manager-push? | Week 1, Day 1 |
| **Attendance** | Not a distinct table in the schema. Is `WorkerAssignment.started_at` / `completed_at` sufficient for attendance, or do we need a separate Attendance record per day? | Week 1, Day 1 |
| **WorkRequest status** | When all assigned workers cancel/reassign, does WorkRequest revert to OPEN or stay PARTIALLY_FILLED? Define the state machine. | Week 2 |
| **Rating trigger** | Rating is submitted by Checker after verification. Can a rating exist without a QualityVerification? Should they be submitted together (one form) or separately? | Week 3 |

> **Action**: Resolve these in a 30-minute sync at the start of Week 1. Update this document and commit the decisions.

---

*This plan is the execution contract. Any change to scope, order, or assignment requires updating this document and team acknowledgment.*
