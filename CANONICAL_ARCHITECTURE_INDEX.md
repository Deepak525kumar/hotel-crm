# CANONICAL ARCHITECTURE INDEX

**Date:** 2026-06-10
**Status:** AUTHORITATIVE
**Scope:** Hotel CRM — Marketplace model — Sprint 1 through Sprint 2

This index is the single reference for locating canonical decisions. Every frozen document is listed with its scope, status, and supersession relationships.

---

## 1. DOCUMENT REGISTRY

### 1.1 Frozen / Approved Documents (canonical authority)

| Document | Location | Status | Scope |
|----------|----------|--------|-------|
| PRISMA_SCHEMA_V2_FREEZE.md | docs/ (main branch) | APPROVED_WITH_MINOR_FOLLOWUPS | DB schema, models, enums, constraints |
| API_SPEC_V1_PATCH_V2.md | docs/ (main branch) | APPROVED_WITH_PATCHES | API contract, DTOs, endpoint surface |
| MARKETPLACE_REFACTOR_MASTER_PLAN.md | docs/ (main branch) | FROZEN | Entity chain, routing, module strategy |
| SCHEMA_RECONCILIATION_DECISION.md | claude/peaceful-planck-u39n66 | FINAL | MVP overrides to V2 freeze |
| PR2_ARCHITECTURE_COMPLIANCE_AUDIT.md | claude/peaceful-planck-u39n66 | FINAL | Implementation compliance findings |
| PR2_SALVAGE_PLAN.md | claude/peaceful-planck-u39n66 | FINAL | File-level salvage/discard decisions |

### 1.2 Working Documents (informational, not authoritative)

| Document | Location | Purpose |
|----------|----------|---------|
| SPRINT_1_SALVAGE_AND_REFACTOR_PLAN.md | claude/epic-hawking-t190p5 | Prior plan; superseded by FINAL_REMEDIATION_PLAN |
| SPRINT_1_COMPLIANCE_REPORT.md | claude/epic-hawking-t190p5 | Compliance snapshot |
| SPRINT_1_FINAL_REMEDIATION_PLAN.md | claude/epic-hawking-t190p5 | Current authoritative sprint plan |
| ARCHITECTURE_RECONCILIATION_REPORT.md | claude/epic-hawking-t190p5 | Conflict resolution log |
| GOVERNANCE_RECONSTRUCTION_REPORT.md | claude/epic-hawking-t190p5 | Document recovery log |
| CANONICAL_ARCHITECTURE_INDEX.md | claude/epic-hawking-t190p5 | This file |

---

## 2. CANONICAL ENTITY CHAIN

```
Admin
  └── Hotel
        ├── Manager (User with MANAGER role + HotelWorker enrollment)
        └── HotelWorker (User with WORKER/CHECKER role + HotelWorker enrollment)
              └── WorkRequest (posted by Hotel)
                    └── WorkApplication (submitted by Worker)
                          └── WorkerAssignment (approved by Manager)
                                ├── Attendance
                                ├── QualityVerification
                                └── Rating
```

Authority: MARKETPLACE_REFACTOR_MASTER_PLAN.md Part 2.

---

## 3. MVP MODEL INVENTORY (13 models)

| Model | Status | Notes |
|-------|--------|-------|
| User | KEEP | Drop permissions col; keep hotel_ids col for MVP |
| Hotel | KEEP | V2 fields |
| HotelWorker | ADD | Canonical enrollment entity; Sprint 1 missing |
| Session | KEEP | Add @unique to refresh_token |
| WorkRequest | ADD | Marketplace core; version field for optimistic locking |
| WorkApplication | ADD | Marketplace core |
| WorkerAssignment | ADD | application_id non-nullable FK |
| Attendance | ADD | |
| QualityVerification | ADD | |
| Rating | ADD | |
| Notification | ADD | V2 enum values |
| AuditLog | KEEP/MODIFY | actor_role type alignment |
| UserDocument | ADD | Identity verification |

Authority: PRISMA_SCHEMA_V2_FREEZE.md + SCHEMA_RECONCILIATION_DECISION.md §2.

---

## 4. REMOVED MODELS (4 legacy)

| Model | Reason |
|-------|--------|
| Task | Replaced by WorkRequest/WorkerAssignment chain |
| Photo | Absent from V2 |
| Calendar | Explicitly REMOVE per MARKETPLACE_REFACTOR_MASTER_PLAN |
| CalendarEvent | Explicitly REMOVE per MARKETPLACE_REFACTOR_MASTER_PLAN |

---

## 5. DEFERRED MODELS (9 Phase 2)

Contract, ContractTemplate, Document, DocumentVersion, Payment, PaymentSchedule, Dispute, Message, MessageThread.

---

## 6. CANONICAL ENUMS

| Enum | Values |
|------|--------|
| UserRole | WORKER, CHECKER, MANAGER, ADMIN |
| HotelWorkerStatus | INVITED, ACTIVE, SUSPENDED, REMOVED |
| WorkRequestStatus | OPEN, FILLED, IN_PROGRESS, COMPLETED, CANCELLED |
| ApplicationStatus | PENDING, ACCEPTED, REJECTED, WITHDRAWN |
| AssignmentStatus | CONFIRMED, IN_PROGRESS, COMPLETED, NO_SHOW, CANCELLED |
| AttendanceStatus | PRESENT, ABSENT, LATE, EXCUSED |
| VerificationStatus | PENDING, APPROVED, REJECTED |
| NotificationChannel | EMAIL, SMS, PUSH, IN_APP |

Authority: PRISMA_SCHEMA_V2_FREEZE.md §Enums.

---

## 7. CANONICAL API SURFACE

### 7.1 Auth (5 endpoints — no public signup)

```
POST   /api/v1/auth/login
POST   /api/v1/auth/refresh
POST   /api/v1/auth/logout
GET    /api/v1/auth/me
POST   /api/v1/auth/password-reset
```

### 7.2 CRM Hotels

```
GET    /api/v1/crm/hotels
POST   /api/v1/crm/hotels
GET    /api/v1/crm/hotels/:id
PATCH  /api/v1/crm/hotels/:id
DELETE /api/v1/crm/hotels/:id
```

### 7.3 CRM Hotel Workers

```
GET    /api/v1/crm/hotels/:id/workers
POST   /api/v1/crm/hotels/:id/workers
GET    /api/v1/crm/hotels/:id/workers/:workerId
PATCH  /api/v1/crm/hotels/:id/workers/:workerId
DELETE /api/v1/crm/hotels/:id/workers/:workerId
```

### 7.4 Users

```
GET    /api/v1/users
GET    /api/v1/users/:id
PATCH  /api/v1/users/:id
DELETE /api/v1/users/:id
```

### 7.5 GDPR

```
GET    /api/v1/gdpr/export
DELETE /api/v1/gdpr/delete
GET    /api/v1/gdpr/consent
POST   /api/v1/gdpr/consent
DELETE /api/v1/gdpr/consent
```

Authority: API_SPEC_V1_PATCH_V2.md + patches PATCH-01 through PATCH-07.

---

## 8. RBAC MATRIX

| Role | Hotels | Workers | Users | WorkRequests |
|------|--------|---------|-------|-------------|
| ADMIN | CRUD | CRUD | CRUD | CRUD |
| MANAGER | RU (own hotel) | CRUD (own hotel) | R | CRUD (own hotel) |
| CHECKER | R | R | — | R |
| WORKER | — | — | R (self) | R |

Source of permissions truth: `ROLE_PERMISSIONS` static map in `lib/permissions.ts`.
Note: CHECKER is excluded from hotel management per API_SPEC_V1_PATCH_V2 PATCH-07.

---

## 9. JWT PAYLOAD SPECIFICATION

### AccessTokenPayload (canonical)

```typescript
{
  sub: string;          // user.id
  email: string;
  role: string;         // UserRole enum value
  hotel_ids: string[];  // KEPT for MVP — removed from API DTOs, present in token
  permissions: string[]; // from ROLE_PERMISSIONS[role]
  iat: number;
  exp: number;
}
```

### Key rules
- `hotel_ids` is present in JWT payload for MVP (checkHotelAccess compatibility).
- `hotel_ids` is NOT present in any User API response DTO (PATCH-04).
- JWT signing uses HS256.
- Access token: signed with `JWT_SECRET`.
- Refresh token: signed with `JWT_REFRESH_SECRET ?? JWT_SECRET`.

Authority: SCHEMA_RECONCILIATION_DECISION §7.1, API_SPEC_V1_PATCH_V2 PATCH-04, PR2_ARCHITECTURE_COMPLIANCE_AUDIT BLOCKER I-1.

---

## 10. ROUTE PREFIX DECISION

`/api/v1/crm/` is the canonical prefix for hotel CRM operations.

Authority: MARKETPLACE_REFACTOR_MASTER_PLAN Part 4 — "Hotels endpoints at `/api/v1/crm/hotels`".

---

## 11. OPEN DECISIONS (unresolved as of 2026-06-10)

| ID | Question | Blocks |
|----|----------|--------|
| D-1 | argon2 vs bcrypt for password hashing | auth/service.ts implementation |
| D-2 | Presence/absence of public /signup endpoint | auth/routes.ts |
| D-3 | ADMIN bypass in checkHotelAccess | middleware/rbac.ts |
| D-4 | WorkApplication.worker_id nullable vs non-nullable | schema + service |
